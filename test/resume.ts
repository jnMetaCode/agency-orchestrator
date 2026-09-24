/**
 * Resume / --from 测试
 * 覆盖: skipStepIds 计算（纯函数）+ 完整 run→save→resume 往返（Mock LLM）
 * DAG: L0=[analyze]  L1=[tech_review, design_review]  L2=[final_summary]
 */
import { resolve, join } from 'node:path';
import { existsSync, readFileSync, rmSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { parseWorkflow } from '../src/core/parser.js';
import { buildDAG } from '../src/core/dag.js';
import { executeDAG } from '../src/core/executor.js';
import {
  saveResults,
  loadPreviousContext,
  getCompletedStepIds,
  computeResumeSkipIds,
  findLatestOutput,
} from '../src/output/reporter.js';
import type { LLMConnector, LLMResult, LLMConfig } from '../src/types.js';

const agentsDir = [
  resolve(import.meta.dirname!, '../node_modules/agency-agents-zh'),
  resolve(import.meta.dirname!, '../agency-agents-zh'),
  resolve(import.meta.dirname!, '../../agency-agents-zh'),
].find(d => existsSync(d)) || resolve(import.meta.dirname!, '../../agency-agents-zh');

const wfPath = resolve(import.meta.dirname!, '../workflows/product-review.yaml');
const tmpOut = resolve(import.meta.dirname!, '../.test-output-resume');

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve(fn()).then(() => {
    console.log(`  ✅ ${name}`);
    passed++;
  }).catch((err) => {
    console.log(`  ❌ ${name}: ${err instanceof Error ? err.message : err}`);
    failed++;
  });
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg);
}

/** 每次调用回显被调步骤标记，便于断言"哪些步骤真的重跑了" */
class CountingConnector implements LLMConnector {
  calls = 0;
  async chat(_sys: string, user: string, _cfg: LLMConfig): Promise<LLMResult> {
    this.calls++;
    const content = `OUT#${this.calls} for: ${user.slice(0, 24)}`;
    return { content, usage: { input_tokens: 10, output_tokens: 10 } };
  }
}

const dag = buildDAG(parseWorkflow(wfPath));

// ─── computeResumeSkipIds 纯函数 ───
console.log('\n=== computeResumeSkipIds ===');

const allDone = ['analyze', 'tech_review', 'design_review', 'final_summary'];

await test('无 fromStep：跳过所有已完成步骤', () => {
  const skip = computeResumeSkipIds(dag, allDone);
  assert(skip.size === 4, `应跳过 4 个，实际 ${skip.size}`);
});

await test('无 fromStep：只跳过实际已完成的（部分完成场景）', () => {
  const skip = computeResumeSkipIds(dag, ['analyze', 'tech_review']);
  assert(skip.size === 2 && skip.has('analyze') && skip.has('tech_review'), `实际: ${[...skip]}`);
});

await test('--from final_summary：跳过 L0+L1，重跑 L2', () => {
  const skip = computeResumeSkipIds(dag, allDone, 'final_summary');
  assert(skip.has('analyze') && skip.has('tech_review') && skip.has('design_review'), `应跳过上游: ${[...skip]}`);
  assert(!skip.has('final_summary'), 'final_summary 不应被跳过（要重跑）');
});

await test('--from design_review：跳过 analyze 与同层的 tech_review（按依赖，不按层级），重跑 design_review 及下游', () => {
  const skip = computeResumeSkipIds(dag, allDone, 'design_review');
  assert(skip.has('analyze') && skip.has('tech_review'), `上游与不相关的同层兄弟都该复用，实际: ${[...skip]}`);
  assert(!skip.has('design_review') && !skip.has('final_summary'), 'design_review 及其下游 final_summary 要重跑');
});

await test('短剧流水线 --from shot3：shot1/shot2/定妆图/剧本全部复用，只重跑 shot3 与合成', async () => {
  const { parseWorkflow: pw } = await import('../src/core/parser.js');
  const { buildDAG: bd } = await import('../src/core/dag.js');
  const d = bd(pw('workflows/短剧流水线.yaml'));
  // 一次「不配旁白」的完整成功运行：无条件步骤全 completed，条件为假的旁白/配音全 skipped。
  // （这份清单以前漏了 atmosphere_lock —— 而 shot*_prompt 都依赖它，漏写等于假设它没跑过。）
  const done = ['script', 'atmosphere_lock', 'character_prompt', 'shot1_prompt', 'shot2_prompt', 'shot3_prompt', 'character', 'shot1', 'shot2', 'shot3', 'film', 'pack'];
  const skippedByCondition = ['narration1', 'narration2', 'narration3', 'vo1', 'vo2', 'vo3'];
  const skip = computeResumeSkipIds(d, done, 'shot3', skippedByCondition);
  assert(skip.has('shot1') && skip.has('shot2') && skip.has('character') && skip.has('script'), `应复用 shot1/shot2，实际跳过: ${[...skip]}`);
  assert(!skip.has('shot3') && !skip.has('film') && !skip.has('pack'), 'shot3 与下游 film/pack 要重跑');
});

await test('中间插了一步：下游不能拿旧产物充数', async () => {
  // 真机撞到的静默错误：两步工作流跑完后在中间插一步、把下游 task 改成引用新变量，再 --resume last。
  // 新步骤跑了，下游却被当成"已完成"整个跳过 —— 交付物还是没见过新步骤产出的旧货，一个字都不提示。
  // 而"改完再 resume"正是本项目主推的迭代方式。
  const { resumeSkipDetail } = await import('../src/output/reporter.js');
  const inserted = {
    levels: [['draft'], ['enrich'], ['polish']],
    nodes: new Map<string, { step: { depends_on?: string[] } }>([
      ['draft', { step: {} }],
      ['enrich', { step: { depends_on: ['draft'] } }],
      ['polish', { step: { depends_on: ['enrich'] } }],
    ]),
  };
  const r = resumeSkipDetail(inserted, ['draft', 'polish']);   // 上一轮没有 enrich
  assert(r.skip.has('draft') && !r.skip.has('polish'), `polish 的上游变了，不能复用：${[...r.skip]}`);
  assert(r.staleDownstream.includes('polish'), `要点名说清为什么重跑：${r.staleDownstream}`);

  // 传递性：再挂一步在 polish 下游，也一起作废
  const deeper = {
    levels: [['draft'], ['enrich'], ['polish'], ['pack']],
    nodes: new Map<string, { step: { depends_on?: string[] } }>([
      ...inserted.nodes,
      ['pack', { step: { depends_on: ['polish'] } }],
    ]),
  };
  const r2 = resumeSkipDetail(deeper, ['draft', 'polish', 'pack']);
  assert(!r2.skip.has('pack') && r2.staleDownstream.includes('pack'), `传递作废：${[...r2.skip]}`);

  // 上一轮按 condition 跳过的上游不算"会重跑"——否则短剧流水线里常年为假的配音会让 film 每次重合成
  const cond = {
    levels: [['a'], ['vo'], ['film']],
    nodes: new Map<string, { step: { depends_on?: string[] } }>([
      ['a', { step: {} }],
      ['vo', { step: { depends_on: ['a'] } }],
      ['film', { step: { depends_on: ['a', 'vo'] } }],
    ]),
  };
  assert(resumeSkipDetail(cond, ['a', 'film'], undefined, ['vo']).skip.has('film'), '条件为假的上游不作废下游');
  assert(!resumeSkipDetail(cond, ['a', 'film']).skip.has('film'), '没说它是被条件跳过的，就照旧保守作废');
});

await test('改过 id / 删掉的步骤不算进"跳过"，并单独点名', async () => {
  // 真机：把 polish 改名成 polish_v2 再 resume，明明只复用了 1 步，却报"跳过已完成步骤: 2 个"。
  // 留着这些名字不会出错（执行器按 id 查，查不到就是没跳过），但数字是虚的——
  // 而这个数字正是用户判断"我那几条付费视频步骤到底复用了没有"的依据。
  const { vanishedStepIds } = await import('../src/output/reporter.js');
  const doneWithOldIds = [...allDone, 'polish', 'old_step'];
  const skip = computeResumeSkipIds(dag, doneWithOldIds, 'final_summary');
  assert(!skip.has('polish') && !skip.has('old_step'), `当前工作流里没有的 step 不该算进跳过：${[...skip]}`);
  assert(skip.size === 3, `只数真的能复用的 3 个，实际 ${skip.size}`);
  const gone = vanishedStepIds(dag, doneWithOldIds);
  assert(gone.length === 2 && gone.includes('polish') && gone.includes('old_step'), `点名消失的那些：${gone}`);
  assert(vanishedStepIds(dag, allDone).length === 0, '没改过 id 时不报');
});

await test('--from analyze：什么都不跳（全部重跑）', () => {
  const skip = computeResumeSkipIds(dag, allDone, 'analyze');
  assert(skip.size === 0, `应跳 0 个，实际: ${[...skip]}`);
});

await test('--from 不存在的步骤：抛错', () => {
  let threw = false;
  try { computeResumeSkipIds(dag, allDone, 'no_such_step'); } catch { threw = true; }
  assert(threw, '应对不存在的 fromStep 抛错');
});

await test('未完成的上游不会被误跳（completed 与 fromStep 交集）', () => {
  // 上次只完成了 analyze，从 final_summary 恢复：只能跳 analyze
  const skip = computeResumeSkipIds(dag, ['analyze'], 'final_summary');
  assert(skip.size === 1 && skip.has('analyze'), `实际: ${[...skip]}`);
});

// ─── 完整往返: run → save → resume --from ───
console.log('\n=== Resume round-trip (run → save → --from) ===');

await test('首次运行 + 保存 metadata', async () => {
  rmSync(tmpOut, { recursive: true, force: true });
  const conn = new CountingConnector();
  const result = await executeDAG(buildDAG(parseWorkflow(wfPath)), {
    connector: conn,
    agentsDir,
    llmConfig: parseWorkflow(wfPath).llm,
    concurrency: 2,
    inputs: new Map([['prd_content', '# 登录系统 PRD']]),
  });
  result.name = 'product-review-resume-test';
  // 模拟 run() 的行为：把原始用户 input 写进 result.inputs，供下次 resume 恢复
  result.inputs = { prd_content: '# 登录系统 PRD' };
  // 模拟 run() 的行为：记录源工作流路径，供历史记录重跑/续跑定位源文件
  result.file = wfPath;
  assert(conn.calls === 4, `首跑应调用 4 次，实际 ${conn.calls}`);

  const dir = saveResults(result, tmpOut);
  assert(existsSync(resolve(dir, 'metadata.json')), 'metadata.json 应存在');
  const meta = JSON.parse(readFileSync(resolve(dir, 'metadata.json'), 'utf-8'));
  assert(meta.file === wfPath, `metadata.file 应为源工作流路径，实际 ${meta.file}`);

  const completed = getCompletedStepIds(dir);
  assert(completed.length === 4, `应记录 4 个已完成步骤，实际 ${completed.length}`);
});

await test('loadPreviousContext 恢复 inputs + 各步 output', () => {
  const dir = findLatestOutput(tmpOut)!;
  const ctx = loadPreviousContext(dir);
  assert(ctx.get('prd_content') === '# 登录系统 PRD', '应恢复原始 input');
  assert(!!ctx.get('requirements'), 'analyze 的 output(requirements) 应恢复');
  assert(!!ctx.get('tech_report') && !!ctx.get('design_report'), 'L1 两步 output 应恢复');
  assert(!!ctx.get('final_report'), 'final_summary 的 output 应恢复');
  // 回归：恢复的产出必须是正文，不能带 step 文件头（> emoji **name** | 步骤 i/n ... ---）
  const restored = ctx.get('requirements') as string;
  assert(!restored.startsWith('>'), `resume 产出不应带文件头，实际开头: ${restored.slice(0, 40)}`);
  assert(!restored.includes('\n---\n'), 'resume 产出不应残留文件头分隔符 \\n---\\n');
});

await test('--from final_summary：仅重跑 1 步，上游复用旧输出', async () => {
  const dir = findLatestOutput(tmpOut)!;
  const ctx = loadPreviousContext(dir);                 // run() 会把它注入 inputs
  const skip = computeResumeSkipIds(dag, getCompletedStepIds(dir), 'final_summary');

  const conn = new CountingConnector();
  const result = await executeDAG(buildDAG(parseWorkflow(wfPath)), {
    connector: conn,
    agentsDir,
    llmConfig: parseWorkflow(wfPath).llm,
    concurrency: 2,
    inputs: ctx,            // 恢复的上游 output 作为输入
    skipStepIds: skip,
  });

  assert(conn.calls === 1, `应只重跑 final_summary 一步，实际调用 ${conn.calls} 次`);

  const byId = new Map(result.steps.map(s => [s.id, s]));
  assert(byId.get('analyze')!.status === 'completed', 'analyze 应为 completed(跳过)');
  assert(byId.get('analyze')!.output === ctx.get('requirements'), '跳过步骤应沿用旧 output');
  assert(byId.get('final_summary')!.status === 'completed', 'final_summary 应重跑完成');
  assert(byId.get('final_summary')!.output!.startsWith('OUT#1'), 'final_summary 应是本次新生成的输出');
  // 复用步骤要带 reused：ao ledger 靠它避免把上次的工作再算一遍
  assert(byId.get('analyze')!.reused === true, `analyze 是复用的，应标 reused，实际 ${byId.get('analyze')!.reused}`);
  assert(byId.get('final_summary')!.reused === undefined, 'final_summary 是本次执行的，不应标 reused');
});

// 真实故障：调度时「resume 复用」判定排在「pending」之前。循环回跳把循环体重置成 pending 后，
// 名单里的步骤又被标成复用、根本不重跑——审稿步对着同一份旧稿审满 max_iterations 轮，
// 白烧 token，最后报「循环达上限」。
await test('--from <循环步骤>：回跳后循环体真的重跑，而不是又被当成复用', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ao-resume-loop-'));
  const loopWf = join(dir, 'loop.yaml');
  writeFileSync(loopWf, [
    'name: "loop-resume"', `agents_dir: "${agentsDir}"`, 'verify: false',
    'llm: { provider: "deepseek", model: "m" }',
    'steps:',
    '  - id: write', '    role: "marketing/marketing-content-creator"', '    task: "写稿 {{review_notes}}"', '    output: draft',
    '  - id: review', '    role: "marketing/marketing-content-creator"', '    task: "审 {{draft}}"', '    output: review_notes',
    '    depends_on: [write]',
    '    loop: { back_to: write, max_iterations: 3, exit_condition: "{{review_notes}} contains APPROVED" }', '',
  ].join('\n'), 'utf-8');
  // write 第 n 次产出 DRAFT-n；review 只认重写过的稿子（DRAFT-2 起）才给 APPROVED
  const seen: string[] = [];
  let writes = 0;
  const conn: LLMConnector = {
    async chat(_sys: string, user: string): Promise<LLMResult> {
      if (user.includes('写稿')) { writes++; seen.push(`write#${writes}`); return { content: `DRAFT-${writes + 1}`, usage: { input_tokens: 1, output_tokens: 1 } }; }
      seen.push(`review(${user.match(/DRAFT-\d+/)?.[0]})`);
      return { content: user.includes('DRAFT-1') ? '不行，重写' : 'APPROVED', usage: { input_tokens: 1, output_tokens: 1 } };
    },
  };
  const loopDag = buildDAG(parseWorkflow(loopWf));
  // 上一次运行留下的：write 已完成（DRAFT-1），现在从 review 续跑
  const skip = computeResumeSkipIds(loopDag, ['write', 'review'], 'review');
  assert(skip.has('write') && !skip.has('review'), '前提：write 在复用名单里，review 要重跑');
  const result = await executeDAG(loopDag, {
    connector: conn, agentsDir, llmConfig: parseWorkflow(loopWf).llm, concurrency: 1,
    inputs: new Map([['draft', 'DRAFT-1'], ['review_notes', '']]),
    skipStepIds: skip,
  });
  assert(writes === 1, `回跳后 write 必须真的重跑一次，实际 ${writes} 次（轨迹 ${seen.join(' → ')}）`);
  assert(seen.join(' → ') === 'review(DRAFT-1) → write#1 → review(DRAFT-2)', `轨迹应为 审旧稿 → 重写 → 审新稿，实际 ${seen.join(' → ')}`);
  const review = result.steps.find((x) => x.id === 'review')!;
  assert(review.output === 'APPROVED' && !review.loopExhausted, '第二轮过审退出，不该报循环达上限');
  assert(result.steps.find((x) => x.id === 'write')!.reused !== true, '重跑过的 write 不该再标 reused');
  rmSync(dir, { recursive: true, force: true });
});

// 真实故障：恢复产出时用 endsWith(`-${id}.md`) 找文件，id 带连字符会串——`review` 先撞上
// `1-final-review.md`，把另一步的正文当成自己的回灌给下游，毫无报错。
await test('loadPreviousContext：带连字符的 step id 不串文件', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ao-resume-hyphen-'));
  mkdirSync(join(dir, 'steps'), { recursive: true });
  writeFileSync(join(dir, 'metadata.json'), JSON.stringify({
    name: 'x', inputs: {},
    steps: [
      { id: 'final-review', status: 'completed', output_var: 'final_out' },
      { id: 'review', status: 'completed', output_var: 'review_out' },
    ],
  }), 'utf-8');
  writeFileSync(join(dir, 'steps', '1-final-review.md'), '> 头\n---\nFINAL 的正文', 'utf-8');
  writeFileSync(join(dir, 'steps', '2-review.md'), '> 头\n---\nREVIEW 的正文', 'utf-8');
  const ctx = loadPreviousContext(dir);
  assert(ctx.get('review_out') === 'REVIEW 的正文', `review 应读到自己的产出，实际「${ctx.get('review_out')}」`);
  assert(ctx.get('final_out') === 'FINAL 的正文', 'final-review 读到自己的');
  rmSync(dir, { recursive: true, force: true });
});

await test('清理临时输出', () => {
  rmSync(tmpOut, { recursive: true, force: true });
  assert(!existsSync(tmpOut), '临时目录应被清理');
});

// ─── 结果 ───
console.log('\n' + '='.repeat(50));
console.log(`  Resume 测试: ${passed} 通过, ${failed} 失败 (共 ${passed + failed} 项)`);
if (failed === 0) console.log('  全部通过!');
else process.exit(1);
console.log('='.repeat(50) + '\n');
