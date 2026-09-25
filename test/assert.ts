/**
 * 机械断言测试。
 *
 * 这个模块的存在理由就是一次真实事故:要模型产出 6 个文件,它给了 5 个,
 * 剩下 5 个格式完好,模型验收员说"满足标准",编译也过——整节内容带着绿灯没了。
 * 所以本测试的第一条就是复现那个形态,并确认它**这次会被拦下**。
 */
import { checkAssert, buildAssertReworkBlock, countChars, resolveAssert } from '../src/core/assert.js';
import { parseWorkflow, validateWorkflow } from '../src/core/parser.js';
import { buildDAG } from '../src/core/dag.js';
import { executeDAG } from '../src/core/executor.js';
import { saveResults } from '../src/output/reporter.js';
import { mkdirSync, readFileSync } from 'node:fs';
import type { LLMConnector, LLMResult, LLMConfig } from '../src/types.js';
import { resolve } from 'node:path';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}: ${err instanceof Error ? err.message : err}`);
    failed++;
  }
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg);
}

/** 造一段含 n 个文件块的产出，形态与真实课节转换产出一致。 */
function outputWithFiles(n: number): string {
  let s = '下面是本模块的课节文件：\n\n';
  for (let i = 1; i <= n; i++) {
    s += `### lessons/w4.${i}-第${i}节.mdx\n\`\`\`mdx\n---\nid: "w4.${i}"\n---\n正文${i}\n\`\`\`\n\n`;
  }
  return s;
}

console.log('\n=== 机械断言 (assert) ===');

// ── emits_files：那次真实事故的形态
test('emits_files: 要 6 个只给 5 个 → 拦下，并说清差多少', () => {
  const r = checkAssert(outputWithFiles(5), { emits_files: 6 });
  assert(r.pass === false, '少一个文件必须判不通过');
  assert(r.failures.length === 1, `应只有一条未通过，实得 ${r.failures.length}`);
  assert(/要求 6 个.*实际 5 个/.test(r.failures[0]), `报错要说清差多少，实得：${r.failures[0]}`);
});

test('emits_files: 数量正好 → 通过', () => {
  assert(checkAssert(outputWithFiles(6), { emits_files: 6 }).pass === true, '6=6 应通过');
});

test('emits_files: 多给一个也算不合格（结构约定是双向的）', () => {
  assert(checkAssert(outputWithFiles(7), { emits_files: 6 }).pass === false, '7≠6 应判不通过');
});

test('emits_files: 一个文件块都没有 → 拦下（整步空转的形态）', () => {
  const r = checkAssert('我已经完成了全部 6 个课节文件的编写。', { emits_files: 6 });
  assert(r.pass === false, '嘴上说完成、实际零产出，必须拦');
  assert(/实际 0 个/.test(r.failures[0]), `应报实际 0 个，实得：${r.failures[0]}`);
});

// ── min_bytes：断流/截断的形态
test('min_bytes: 产出被截断 → 拦下', () => {
  const r = checkAssert('开头写了一点就断了', { min_bytes: 2000 });
  assert(r.pass === false, '过短应判不通过');
  assert(/疑似截断/.test(r.failures[0]), '应提示疑似截断');
});

test('min_bytes: 按 UTF-8 字节数算，不是字符数', () => {
  // 10 个汉字 = 30 字节
  assert(checkAssert('一二三四五六七八九十', { min_bytes: 30 }).pass === true, '30 字节应达标');
  assert(checkAssert('一二三四五六七八九十', { min_bytes: 31 }).pass === false, '31 字节应不达标');
});

// ── max_bytes：写飞了的形态（视频提示词超字数会被厂商在提交这一步直接拒）
test('max_bytes: 产出超长 → 拦下', () => {
  const r = checkAssert('电影感的'.repeat(200), { max_bytes: 900 });
  assert(r.pass === false, '超长应判不通过');
  assert(/产出太长/.test(r.failures[0]), `应提示产出太长，实得：${r.failures[0]}`);
});

test('max_bytes: 边界按 UTF-8 字节，恰好等于上限算通过', () => {
  // 10 个汉字 = 30 字节
  assert(checkAssert('一二三四五六七八九十', { max_bytes: 30 }).pass === true, '恰好 30 字节应达标');
  assert(checkAssert('一二三四五六七八九十', { max_bytes: 29 }).pass === false, '29 字节上限应不达标');
});

test('min_bytes + max_bytes: 区间内通过，两侧各自报各自的话', () => {
  const spec = { min_bytes: 20, max_bytes: 40 };
  assert(checkAssert('一二三四五六七八九十', spec).pass === true, '30 字节落在区间内');
  assert(/疑似截断/.test(checkAssert('短', spec).failures[0]), '偏短报截断');
  assert(/产出太长/.test(checkAssert('一二三四五六七八九十一二三四五', spec).failures[0]), '偏长报太长');
});

// ── matches：数小节这类计数
test('matches: 裸模式默认多行，"^## " 数的是小节数', () => {
  const md = '## 一\n正文\n## 二\n正文\n## 三\n';
  assert(checkAssert(md, { matches: { '^## ': 3 } }).pass === true, '应命中 3 次');
  assert(checkAssert(md, { matches: { '^## ': 4 } }).pass === false, '要求 4 次应不通过');
});

test('matches: 计数用 matchAll，不会把多次命中误报成 1 次', () => {
  // 这是回归测试：早期若用 text.match(re) 且 re 无 g 标志，只会返回第一个匹配，
  // "命中 3 次"会被数成 1 次 —— 一个自己就会说谎的计数器。
  const r = checkAssert('## 一\n## 二\n## 三\n', { matches: { '^## ': 3 } });
  assert(r.pass === true, `计数器说谎了：${r.failures.join('; ')}`);
});

test('matches: 支持 /pattern/flags 写法', () => {
  assert(checkAssert('AbC abc ABC', { matches: { '/abc/gi': 3 } }).pass === true, '忽略大小写应命中 3 次');
});

// ── contains
test('contains: 缺少必须出现的内容 → 拦下并点名', () => {
  const r = checkAssert('随便写了点东西', { contains: ['## 验收清单'] });
  assert(r.pass === false, '缺失应判不通过');
  assert(r.failures[0].includes('## 验收清单'), '报错要点名缺的是哪一条');
});

// ── 多条同时不过：要一次列全
test('多条不满足时全部列出，不能只报第一条', () => {
  const r = checkAssert('短', { emits_files: 3, min_bytes: 500, contains: ['甲', '乙'] });
  assert(r.pass === false, '应不通过');
  assert(r.failures.length === 4, `应列出 4 条，实得 ${r.failures.length}：${r.failures.join(' | ')}`);
});

// ── 纯函数性质
test('是纯函数：同样输入两次结论一致，且不改动入参', () => {
  const spec = { emits_files: 6, contains: ['x'] };
  const frozen = JSON.stringify(spec);
  const a = checkAssert(outputWithFiles(5), spec);
  const b = checkAssert(outputWithFiles(5), spec);
  assert(JSON.stringify(a) === JSON.stringify(b), '两次结论应一致');
  assert(JSON.stringify(spec) === frozen, 'spec 不该被改动');
});

// ── 返工提示
test('返工提示逐条列出缺什么，并要求给完整产出', () => {
  const block = buildAssertReworkBlock(['产出的文件块数量不对:要求 6 个,实际 5 个']);
  assert(block.includes('要求 6 个'), '应带上具体差多少');
  assert(block.includes('完整'), '应要求给完整产出，而不是只补差的那部分');
});

// ── 解析期校验
/** 解析 + 校验，只挑与 assert 有关的错误（role 能否加载等与本测试无关）。 */
function assertErrors(body: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'ao-assert-'));
  const f = join(dir, 'wf.yaml');
  writeFileSync(f, body, 'utf8');
  const wf = parseWorkflow(f);
  const all = validateWorkflow(wf, resolve('agency-agents'));
  return all.filter((e) => e.includes('assert'));
}

const BASE = (assertBlock: string) => `name: t
llm:
  provider: claude-code
  model: sonnet
steps:
  - id: a
    role: engineering/engineering-sre
    task: 做点事
${assertBlock}
`;

test('解析期：不认识的 assert 字段要报错', () => {
  const errs = assertErrors(BASE('    assert:\n      emit_files: 6\n'));
  assert(errs.some((e) => e.includes('不认识字段')), `应报未知字段，实得：${errs.join('; ')}`);
});

test('解析期：assert.matches 里的非法正则要报错（否则是个哑弹检查）', () => {
  const errs = assertErrors(BASE('    assert:\n      matches:\n        "[unclosed": 2\n'));
  assert(errs.some((e) => e.includes('不是合法正则')), `应报非法正则，实得：${errs.join('; ')}`);
});

test('解析期：空 assert 要报错（空断言永远通过，等于没写）', () => {
  const errs = assertErrors(BASE('    assert: {}\n'));
  assert(errs.some((e) => e.includes('空断言')), `应报空断言，实得：${errs.join('; ')}`);
});

test('解析期：emits_files 写成字符串要报错', () => {
  const errs = assertErrors(BASE('    assert:\n      emits_files: "6"\n'));
  assert(errs.some((e) => e.includes('非负整数')), `应报类型错，实得：${errs.join('; ')}`);
});

// ── min_chars / max_chars：写作类模板的"字数"，按非空白字符数，可引用输入变量
test('countChars: 非空白字符按码点计，中文一字一计，空格换行不算', () => {
  assert(countChars('你好，世界') === 5, `"你好，世界" 应为 5，实际 ${countChars('你好，世界')}`);
  assert(countChars('  a b\n\nc ') === 3, '空白不计');
  assert(countChars('😀😀') === 2, 'emoji 按码点各算一个，不是 4');
});

test('min_chars: 数字写法，写短了 → 拦下，报的是"字"不是字节', () => {
  const r = checkAssert('一二三四五', { min_chars: 6 });
  assert(!r.pass && r.failures[0].includes('至少 6 字') && r.failures[0].includes('实际 5 字'), r.failures.join('; '));
});

test('max_chars: 超长 → 拦下；区间内通过', () => {
  assert(!checkAssert('一二三四五', { max_chars: 4 }).pass, '5 字超过上限 4 应拦下');
  assert(checkAssert('一二三四五', { min_chars: 5, max_chars: 5 }).pass, '恰好等于上下限通过');
});

test('resolveAssert: "{{length}} * 0.7" 按本次输入算成数字', () => {
  const ctx = new Map([['length', '3000']]);
  const r = resolveAssert({ min_chars: '{{length}} * 0.7', max_chars: '{{length}}*1.3', min_bytes: 10 }, ctx);
  assert(r.min_chars === 2100 && r.max_chars === 3900, `应为 2100 / 3900，实际 ${r.min_chars} / ${r.max_chars}`);
  assert(r.min_bytes === 10, '其它字段原样');
});

test('resolveAssert: 变量为空 → 该条跳过并告警，不算失败、不让整步红', () => {
  const warns: string[] = [];
  const r = resolveAssert({ min_chars: '{{length}} * 0.7', max_chars: 900 }, new Map([['length', '']]), (m) => warns.push(m));
  assert(r.min_chars === undefined && r.max_chars === 900, '空变量那条变 undefined，另一条保留');
  assert(warns.length === 1 && warns[0].includes('{{length}} * 0.7') && warns[0].includes('跳过'), `告警要带原文与"跳过"：${warns.join('|')}`);
  assert(checkAssert('短', r).pass, 'min_chars 跳过后不再拦');
});

test('解析期：min_chars 允许 "{{变量}} * 系数" 字符串，乱写的字符串要报错', () => {
  const ok = assertErrors(`name: t
llm:
  provider: claude-code
  model: sonnet
inputs:
  - name: length
    default: "3000"
steps:
  - id: a
    role: engineering/engineering-sre
    task: 写 {{length}} 字
    assert:
      min_chars: "{{length}} * 0.7"
      max_chars: 5000
`);
  assert(ok.length === 0, `合法写法不该报错：${ok.join('; ')}`);
  const bad = assertErrors(BASE('    assert:\n      min_chars: "大概三千字"\n'));
  assert(bad.some((e) => e.includes('min_chars') && e.includes('{{length}} * 0.7')), `乱写要报错并给出示例写法：${bad.join('; ')}`);
  const neg = assertErrors(BASE('    assert:\n      max_chars: -1\n'));
  assert(neg.some((e) => e.includes('max_chars')), '负数要报错');
});

test('解析期：min_chars 引用了不存在的变量要在 validate 就报，别等运行期"本条跳过"', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ao-assert-'));
  const f = join(dir, 'wf.yaml');
  writeFileSync(f, BASE('    assert:\n      min_chars: "{{nope}} * 0.7"\n'), 'utf8');
  const errs = validateWorkflow(parseWorkflow(f), resolve('agency-agents'));
  assert(errs.some((e) => e.includes('nope')), `应点名未定义变量 nope，实得：${errs.join('; ')}`);
});

test('解析期：合法 assert 不报错', () => {
  const errs = assertErrors(BASE('    assert:\n      emits_files: 6\n      min_bytes: 100\n      max_bytes: 900\n      matches:\n        "^## ": 6\n'));
  assert(errs.length === 0, `不该报错，实得：${errs.join('; ')}`);
});

test('解析期：max_bytes 写成字符串要报错', () => {
  const errs = assertErrors(BASE('    assert:\n      max_bytes: "900"\n'));
  assert(errs.some((e) => e.includes('非负整数')), `应报类型错，实得：${errs.join('; ')}`);
});

test('解析期：min_bytes 大于 max_bytes 要在解析期就报（否则每步必然返工一轮再失败）', () => {
  const errs = assertErrors(BASE('    assert:\n      min_bytes: 900\n      max_bytes: 100\n'));
  assert(errs.some((e) => e.includes('没有产出能同时满足')), `应报区间矛盾，实得：${errs.join('; ')}`);
});

test('resolveAssert: contains 里的 {{变量}} 要渲染（不渲染就是拿字面量去找，必然失败）', () => {
  const ctx = new Map([['product', '灵犀音箱'], ['empty', '']]);
  const r = resolveAssert({ contains: ['固定串', '{{product}}'] }, ctx);
  assert(JSON.stringify(r.contains) === JSON.stringify(['固定串', '灵犀音箱']), `实际 ${JSON.stringify(r.contains)}`);
  const warns: string[] = [];
  const r2 = resolveAssert({ contains: ['{{empty}}', '保留'] }, ctx, (m) => warns.push(m));
  assert(JSON.stringify(r2.contains) === JSON.stringify(['保留']), '渲染后为空的那条跳过，而不是留个空串（空串永远"包含"）');
  assert(warns.some((w) => /contains/.test(w)), '跳过要告警');
});

// ── 断言结果要进档案 ──
// 以前只往终端打一行「⟳ 机械断言未过…定向返工一轮」。跑完再回来翻 metadata.json，
// 看不出这一步是被 min_chars/max_bytes 逼着重写过的——小说线尤其需要这条痕迹。
{
  const dir = mkdtempSync(join(tmpdir(), 'ao-assert-archive-'));
  mkdirSync(join(dir, 'x'), { recursive: true });
  writeFileSync(join(dir, 'x', 'y.md'), '---\nname: 测试角色\ndescription: 测试用\n---\n你是测试角色。\n', 'utf-8');
  const wfPath2 = join(dir, 'wf.yaml');
  writeFileSync(wfPath2, [
    'name: assert-archive', `agents_dir: ${dir}`, 'verify: false',
    'llm:', '  provider: deepseek', '  model: deepseek-chat',
    'steps:',
    '  - id: tight', '    role: x/y', '    task: 写点什么', '    assert:', '      max_bytes: 10', '    output: a',
    '  - id: loose', '    role: x/y', '    task: 再写点什么', '    assert:', '      min_chars: 1', '    output: b', '    depends_on: [tight]', '',
  ].join('\n'), 'utf-8');

  class TwoShot implements LLMConnector {
    calls = 0;
    async chat(_s: string, user: string, _c: LLMConfig): Promise<LLMResult> {
      this.calls++;
      // 第一次给超长（撞 max_bytes），返工那次给短的 —— 与真机形态一致
      const long = user.includes('写点什么') && !user.includes('产出太长');
      return { content: long ? '这是一段很长很长的产出'.repeat(5) : '短', usage: { input_tokens: 1, output_tokens: 1 } };
    }
  }
  const wf2 = parseWorkflow(wfPath2);
  const res = await executeDAG(buildDAG(wf2), {
    connector: new TwoShot(), agentsDir: dir, llmConfig: wf2.llm, concurrency: 1, inputs: new Map(),
  });
  res.name = wf2.name;
  const tight = res.steps.find((s) => s.id === 'tight');
  const loose = res.steps.find((s) => s.id === 'loose');
  test('返工过的步骤在 StepResult 里留痕', () => {
    assert(tight?.assertion?.reworked === true && tight?.assertion?.pass === true, `实际 ${JSON.stringify(tight?.assertion)}`);
    // 同 verification.firstFailed：返工成功后 failed 清空，"是哪一条逼着它重写"要留住——
    // 模板作者调阈值（emits_files: 3 是不是要高了）看的就是它
    assert(tight?.assertion?.firstFailed?.[0]?.includes('产出太长') === true,
      `第一轮是哪条不过要留痕（实际 ${JSON.stringify(tight?.assertion?.firstFailed)}）`);
    assert(loose?.assertion?.firstFailed === undefined, '一次就过的不写这个字段');
  });
  test('一次就过的步骤记 reworked=false（而不是什么都不记）', () => {
    assert(loose?.assertion?.pass === true && loose?.assertion?.reworked === false, `实际 ${JSON.stringify(loose?.assertion)}`);
  });
  test('assertion 进 metadata.json，返工过的步骤文件头也写一行', () => {
    const out = saveResults(res, join(dir, 'out'));
    const meta = JSON.parse(readFileSync(join(out, 'metadata.json'), 'utf-8'));
    const m = meta.steps.find((s: { id: string }) => s.id === 'tight');
    assert(m?.assertion?.reworked === true, `实际 ${JSON.stringify(m?.assertion)}`);
    const f1 = readFileSync(join(out, 'steps', '1-tight.md'), 'utf-8');
    assert(/机械断言 ✓/.test(f1), `返工过的步骤头部写一行（实际头部：${f1.split('\n---\n')[0].slice(0, 120)}）`);
    assert(f1.indexOf('机械断言') < f1.indexOf('\n---\n'), '写在头部引用块里，不混进产出正文');
    const f2 = readFileSync(join(out, 'steps', '2-loose.md'), 'utf-8');
    assert(!/机械断言/.test(f2), '一次就过的不占这一行（常态不该刷屏）');
  });
}

// ── Studio 的运行记录也读同一份 metadata：徽标只在返工时出现 ──
// 前端没有单测环境（同 studio-demo-guard 的做法），按源码钉住这条约定：
// 删掉那个 `?.reworked` 判断不会有任何构建报错，只会让每个步骤都挂上「断言返工」。
test('Studio 的断言徽标只在 reworked 时出现', () => {
  const src = readFileSync('website/src/components/studio/RunsPanel.tsx', 'utf-8');
  assert(/s\.assertion\?\.reworked &&/.test(src), 'RunsPanel 按 assertion.reworked 判断');
  const t = readFileSync('website/src/i18n/translations.ts', 'utf-8');
  assert(/assertReworked:/.test(t) && /assertReworkedTitle:/.test(t), '中英文案都在（title 说清为什么返工）');
  assert((t.match(/assertReworked:/g) || []).length === 2, `中英各一份（实际 ${(t.match(/assertReworked:/g) || []).length}）`);
  const lib = readFileSync('website/src/lib/studio.ts', 'utf-8');
  assert(/assertion\?:/.test(lib), 'RunStep 类型里有 assertion，否则 TS 会把它当不存在');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
