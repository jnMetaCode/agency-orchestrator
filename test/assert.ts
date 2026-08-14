/**
 * 机械断言测试。
 *
 * 这个模块的存在理由就是一次真实事故:要模型产出 6 个文件,它给了 5 个,
 * 剩下 5 个格式完好,模型验收员说"满足标准",编译也过——整节内容带着绿灯没了。
 * 所以本测试的第一条就是复现那个形态,并确认它**这次会被拦下**。
 */
import { checkAssert, buildAssertReworkBlock } from '../src/core/assert.js';
import { parseWorkflow, validateWorkflow } from '../src/core/parser.js';
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

test('解析期：合法 assert 不报错', () => {
  const errs = assertErrors(BASE('    assert:\n      emits_files: 6\n      min_bytes: 100\n      matches:\n        "^## ": 6\n'));
  assert(errs.length === 0, `不该报错，实得：${errs.join('; ')}`);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
