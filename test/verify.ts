/**
 * acceptance 自动核验 + 一轮自动返工 测试：
 * parseVerify 宽松解析 → buildReworkBlock 拼装 → executeDAG 全链路（未过→返工→复核 /
 * 首检通过 / 核验不可用跳过 / 三级开关）→ metadata/summary/步骤文件展示 → validate 类型校验
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseWorkflow, validateWorkflow } from '../src/core/parser.js';
import { buildDAG } from '../src/core/dag.js';
import { executeDAG } from '../src/core/executor.js';
import { saveResults, formatVerification } from '../src/output/reporter.js';
import { parseVerify, buildReworkBlock, formatFailedItems } from '../src/core/verify.js';
import type { LLMConnector, LLMResult, LLMConfig, WorkflowDefinition } from '../src/types.js';

let passed = 0, failed = 0;
function assert(c: boolean, m: string): void { if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; } }

console.log('\n─── acceptance 自动核验（verify）───');

// ── parseVerify：宽松解析 ──
assert(parseVerify('{"pass": true, "failed": []}')?.pass === true, 'parseVerify: 纯 JSON 通过');
const p1 = parseVerify('好的，结论如下：\n```json\n{"pass": false, "failed": [{"criterion": "不超过 200 字", "why": "共 450 字"}]}\n```');
assert(p1?.pass === false && p1.failed[0].criterion === '不超过 200 字', 'parseVerify: 带前言/代码块也能抽出 JSON');
const p2 = parseVerify('{"pass": true, "failed": [{"criterion": "有风险章节", "why": "缺失"}]}');
assert(p2?.pass === false, 'parseVerify: pass=true 但列了未满足条目 → 以条目为准判未过（保守裁决）');
assert(parseVerify('模型跑偏了没有输出 JSON') === null, 'parseVerify: 无 JSON → null');
assert(parseVerify('{"pass": "yes"}') === null, 'parseVerify: pass 非布尔 → null');
assert(parseVerify('{"pass": false}') === null, 'parseVerify: pass=false 但给不出条目 → 核验不可用（不做空清单返工）');
assert(parseVerify('{"pass": false, "failed": [{}]}') === null, 'parseVerify: pass=false 且条目全空 → 核验不可用');
const p3 = parseVerify('{"pass": false, "failed": [{"criterion": "1. 三节\\n2. 标风险", "why": "第\\n二节缺失"}]}');
assert(p3?.failed[0].criterion === '1. 三节 2. 标风险' && p3.failed[0].why === '第 二节缺失', 'parseVerify: 条目内嵌换行被压平成单行（下游 CLI 行/文件头/SSE 都按单行消费）');

// ── buildReworkBlock / formatFailedItems ──
const rb = buildReworkBlock([{ criterion: '包含风险章节', why: '整段缺失' }], '这是上一版产出全文');
assert(rb.includes('这是上一版产出全文') && rb.includes('包含风险章节') && rb.includes('不要从零重写'), 'buildReworkBlock: 含上一版产出 + 未满足条目 + 原稿修改指令');
const rbEn = buildReworkBlock([{ criterion: 'has a risks section', why: 'missing' }], 'previous deliverable text');
assert(rbEn.includes('do NOT rewrite from scratch'), 'buildReworkBlock: 英文条目走英文措辞');
assert(formatFailedItems([{ criterion: '条目', why: '原因' }])[0] === '条目（原因）', 'formatFailedItems: 中文用全角括号');

// ── 临时角色库 + 工作流（不依赖外部角色包）──
const dir = mkdtempSync(join(tmpdir(), 'ao-verify-'));
mkdirSync(join(dir, 'x'), { recursive: true });
writeFileSync(join(dir, 'x', 'y.md'), `---\nname: 测试角色\ndescription: 测试用\n---\n你是测试角色。\n`, 'utf-8');

function makeWf(extra = ''): WorkflowDefinition {
  const wfPath = join(dir, `wf-${Math.random().toString(36).slice(2)}.yaml`);
  writeFileSync(wfPath, `name: verify-test
agents_dir: ${dir}
llm:
  provider: deepseek
  model: deepseek-chat
inputs:
  - name: topic
    required: true
steps:
  - id: a
    role: x/y
    task: 围绕 {{topic}} 写一段介绍
    acceptance: |
      1. 必须提到 {{topic}}
      2. 不超过 200 字
${extra}    output: out_a
`, 'utf-8');
  return parseWorkflow(wfPath);
}

/** 可编排的 mock：按"生成/核验"分流，核验按第几次给不同结论 */
class ScriptedConnector implements LLMConnector {
  calls: { system: string; user: string }[] = [];
  verifyCount = 0;
  constructor(
    private verifyReplies: string[],           // 第 n 次核验的回复
    private drafts = ['第一版草稿', '返工后的成稿'],  // 第 n 次生成的产出
  ) {}
  private genCount = 0;
  async chat(system: string, user: string, _c: LLMConfig): Promise<LLMResult> {
    this.calls.push({ system, user });
    if (user.includes('待验收产出') || user.includes('Deliverable under review')) {
      const reply = this.verifyReplies[Math.min(this.verifyCount, this.verifyReplies.length - 1)];
      this.verifyCount++;
      return { content: reply, usage: { input_tokens: 10, output_tokens: 5 } };
    }
    const content = this.drafts[Math.min(this.genCount, this.drafts.length - 1)];
    this.genCount++;
    return { content, usage: { input_tokens: 100, output_tokens: 50 } };
  }
}

async function runOnce(wf: WorkflowDefinition, mock: ScriptedConnector, verify: boolean | undefined) {
  return executeDAG(buildDAG(wf), {
    connector: mock,
    agentsDir: dir,
    llmConfig: wf.llm,
    concurrency: 1,
    inputs: new Map([['topic', '长城']]),
    verify,
  });
}

// ── 场景 A：未过 → 返工一轮 → 复核通过 ──
{
  const mock = new ScriptedConnector([
    '{"pass": false, "failed": [{"criterion": "不超过 200 字", "why": "超长"}]}',
    '{"pass": true, "failed": []}',
  ]);
  const wf = makeWf();
  const result = await runOnce(wf, mock, true);
  const step = result.steps.find(s => s.id === 'a')!;
  assert(step.output === '返工后的成稿', 'A: 最终产出是返工版');
  assert(step.verification?.pass === true && step.verification.reworked === true, 'A: verification = 返工后通过');
  const rework = mock.calls.find(c => c.user.includes('验收核对发现以下条目未满足'));
  assert(!!rework && rework.user.includes('第一版草稿') && rework.user.includes('不超过 200 字'), 'A: 返工请求带上一版产出 + 未满足条目');
  const verifyCall = mock.calls.find(c => c.user.includes('待验收产出'));
  assert(!!verifyCall && verifyCall.user.includes('必须提到 长城'), 'A: 核验请求含渲染后的验收标准');
  assert(step.tokens.input === 100 + 10 + 100 + 10 && step.tokens.output === 50 + 5 + 50 + 5, 'A: token 跨生成/核验/返工累加');

  // 展示层：metadata / summary / 步骤文件
  result.name = wf.name;
  const outDir = saveResults(result, join(dir, 'out'));
  const meta = JSON.parse(readFileSync(join(outDir, 'metadata.json'), 'utf-8'));
  assert(meta.steps[0].verification?.pass === true && meta.steps[0].verification?.reworked === true, 'A: metadata.json 带 verification');
  const summary = readFileSync(join(outDir, 'summary.md'), 'utf-8');
  assert(summary.includes('验收 ✓（返工 1 轮后通过）'), 'A: summary.md 带验收徽章');
  const stepFile = readFileSync(join(outDir, 'steps', '1-a.md'), 'utf-8');
  assert(stepFile.includes('🔍 验收 ✓') && stepFile.indexOf('🔍') < stepFile.indexOf('\n---\n'), 'A: 步骤文件头部展示核验结果（不混入正文）');
}

// ── 场景 B：首检通过，不返工 ──
{
  const mock = new ScriptedConnector(['{"pass": true, "failed": []}']);
  const result = await runOnce(makeWf(), mock, true);
  const step = result.steps.find(s => s.id === 'a')!;
  assert(step.output === '第一版草稿' && step.verification?.pass === true && step.verification.reworked === false, 'B: 首检通过 → 原产出 + pass 不返工');
  assert(mock.verifyCount === 1, 'B: 只核验一次');
}

// ── 场景 C：返工后复核仍未过 → 保留返工版 + ⚠️ 记录 ──
{
  const mock = new ScriptedConnector([
    '{"pass": false, "failed": [{"criterion": "不超过 200 字", "why": "超长"}]}',
    '{"pass": false, "failed": [{"criterion": "不超过 200 字", "why": "仍超长"}]}',
  ]);
  const result = await runOnce(makeWf(), mock, true);
  const step = result.steps.find(s => s.id === 'a')!;
  assert(step.status === 'completed', 'C: 验收不过不判步骤失败');
  assert(step.output === '返工后的成稿' && step.verification?.pass === false && step.verification.reworked === true, 'C: 保留返工版并如实记未通过');
  assert(step.verification!.failed[0].includes('仍超长'), 'C: failed 条目取复核结果');
  assert(formatVerification(step.verification)?.includes('1 条未满足') === true, 'C: formatVerification 未过措辞');
}

// ── 场景 D：核验器两次都吐不出 JSON → 跳过核验，不拦产出 ──
{
  const mock = new ScriptedConnector(['模型跑偏没有 JSON', '还是没有 JSON']);
  const result = await runOnce(makeWf(), mock, true);
  const step = result.steps.find(s => s.id === 'a')!;
  assert(step.output === '第一版草稿' && step.verification === undefined, 'D: 核验不可用 → 无 verification、产出照常');
  assert(mock.verifyCount === 2, 'D: 核验解析失败重试一次后放弃');
}

// ── 场景 E：三级开关 ──
{
  const mock = new ScriptedConnector(['{"pass": false, "failed": [{"criterion": "x", "why": "y"}]}']);
  const result = await runOnce(makeWf(), mock, undefined);  // executeDAG 库级直调不传 = 不核验
  assert(mock.verifyCount === 0 && result.steps[0].verification === undefined, 'E: executeDAG 不传 verify → 不核验（库级向后兼容）');
}
{
  const mock = new ScriptedConnector(['{"pass": false, "failed": [{"criterion": "x", "why": "y"}]}']);
  await runOnce(makeWf('    verify: false\n'), mock, true);  // step.verify: false 优先
  assert(mock.verifyCount === 0, 'E: step.verify: false 单步关闭（覆盖全局开）');
}

// ── validate / parse：verify 字段 ──
{
  const wf = makeWf();
  assert(wf.verify === undefined, 'parse: 未写顶层 verify → undefined（run() 按默认开处理）');
  const badTop = { ...wf, verify: 'false' as unknown as boolean };
  assert(validateWorkflow(badTop).some(e => e.includes('顶层 verify 必须是布尔值')), 'validate: 顶层 verify 字符串被报出');
  const badStep = { ...wf, steps: wf.steps.map(s => ({ ...s, verify: 'no' as unknown as boolean })) };
  assert(validateWorkflow(badStep).some(e => e.includes('verify 必须是布尔值')), 'validate: step.verify 非布尔被报出');
}

rmSync(dir, { recursive: true, force: true });
// ── 验收员的判定口径（2026-08-28 真机 11 次采样定的） ──────────────────────
// 原先是"宁严勿松：条目只做到一部分也算未满足"。对可数条目对，对**质性**条目
// （"写明了色调和光源"）等于放任评判者无限细分——产出写了"暖阳侧逆光"，它仍判
// "未明确光源类型"。实测 11/11 全部触发返工、多数返工后仍判未过：每跑一次白付一轮，
// 且验收长期显示未过，**用户会学会无视验收**。改口径后同一批样本 0/4 返工、4/4 通过，
// 而故意写坏的产出照样被判不过（空泛器材 / 形容词分镜 / 混进 IP 名，三种都抓到）。
{
  // 精确匹配**旧的那两行原句**，而不是禁某个词——"只做到一部分算未满足"这句话
  // 现在是有限定地合法存在的（限定在"标准明确枚举的东西"上），钝着禁会误伤它自己。
  const src = readFileSync('src/core/verify.ts', 'utf-8');

  assert(/不要发明标准里没有的更严要求/.test(src) && /do not invent stricter requirements/i.test(src),
    '判定口径：不许发明标准里没写的更严要求（中英两版都有）');
  assert(/引用产出中的原话/.test(src) && /举不出原话就说明它其实满足了/.test(src) && /MUST quote the deliverable/i.test(src),
    '判定口径：判未满足必须引用产出原话——防"发明缺陷"的主闸');
  assert(/明确枚举/.test(src) && /explicitly ENUMERATES/.test(src),
    '判定口径：严格口径限定在标准明确枚举的东西上，不是全局');
  assert(!/逐条核对下面的产出是否满足验收标准，宁严勿松/.test(src)
      && !/Check the deliverable against EACH criterion; partially met counts as NOT met/.test(src),
    '判定口径：旧的无差别严格口径没有回来（它会让质性条目每次都判不过，用户就开始无视验收）');
  assert(/不要求字句对上/.test(src) && /exact phrasing is not required/i.test(src),
    '判定口径：措辞不同但满足同一意图算满足');
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
