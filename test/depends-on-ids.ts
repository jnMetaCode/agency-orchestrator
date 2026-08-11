/**
 * depends_on 写成输出变量名的确定性修复（issue #103，同类 #94）。
 *
 * LLM 编排时最常见的结构错误：depends_on 要写 **step id**，模型却写成了上游的
 * **output 变量名**。这类错误此前是修复链的盲区 —— 它进得了 runVariableFixChain，
 * 但阶段 0 只会「补」依赖、阶段 1 只改 {{变量}}、阶段 2 靠 extractUndefinedVarNames
 * 提变量名（这类报错提不出东西），三个阶段都动不了，于是原样抛给用户。
 *
 * 修复必须是外科手术式的：只改 depends_on 里的那个 token，绝不能碰 task 正文里
 * 同名的 {{变量}} 引用（那些本来就是对的）。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { autoFixDependsOnIds } from '../src/cli/compose.js';
import { parseWorkflow, validateWorkflow } from '../src/core/parser.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
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

const dir = mkdtempSync(join(tmpdir(), 'ao-depfix-'));
function write(name: string, yaml: string): string {
  const p = join(dir, name);
  writeFileSync(p, yaml, 'utf-8');
  return p;
}
function errorsOf(p: string): string[] {
  const r = validateWorkflow(parseWorkflow(p)) as unknown;
  return Array.isArray(r) ? (r as string[]) : ((r as { errors: string[] }).errors ?? []);
}

const HEAD = `name: "t"
agents_dir: "agency-agents-zh"
llm:
  provider: claude-code
steps:
`;

console.log('\n─── depends_on 写成输出变量名（#103） ───');

await test('把输出变量名改写成产出它的 step id，改完校验通过', async () => {
  const p = write('basic.yaml', HEAD + `  - id: analyze
    role: "a/b"
    task: "分析"
    output: analysis_result
  - id: compile
    role: "a/b"
    task: "汇总 {{analysis_result}}"
    output: final
    depends_on: [analysis_result]
`);
  assert(errorsOf(p).length > 0, '修复前应当报错');
  const r = await autoFixDependsOnIds(p);
  assert(r.fixed === 1, `应修 1 处，实际 ${r.fixed}`);
  assert(r.details[0].from === 'analysis_result' && r.details[0].to === 'analyze', JSON.stringify(r.details));
  assert(errorsOf(p).length === 0, `修完应无错，实际 ${errorsOf(p).join(' / ')}`);
});

await test('只动 depends_on，task 正文里的同名 {{变量}} 一个不碰', async () => {
  const p = write('surgical.yaml', HEAD + `  - id: analyze
    role: "a/b"
    task: "分析"
    output: analysis_result
  - id: compile
    role: "a/b"
    task: "汇总 {{analysis_result}}，再复述一次 {{analysis_result}}"
    output: final
    depends_on: [analysis_result]
`);
  await autoFixDependsOnIds(p);
  const text = readFileSync(p, 'utf-8');
  assert((text.match(/\{\{analysis_result\}\}/g) ?? []).length === 2, '变量引用被误伤了');
  assert(/depends_on: \[analyze\]/.test(text), `depends_on 没改对：${text}`);
});

await test('多行列表写法同样能改', async () => {
  const p = write('block.yaml', HEAD + `  - id: analyze
    role: "a/b"
    task: "分析"
    output: analysis_result
  - id: research
    role: "a/b"
    task: "调研"
    output: research_notes
  - id: compile
    role: "a/b"
    task: "汇总 {{analysis_result}} {{research_notes}}"
    output: final
    depends_on:
      - analysis_result
      - research
`);
  const r = await autoFixDependsOnIds(p);
  assert(r.fixed === 1, `应只改 1 处（research 本来就是真 id），实际 ${r.fixed}`);
  assert(errorsOf(p).length === 0, errorsOf(p).join(' / '));
});

await test('目标 id 本来就在依赖里 → 删掉多余那条，不留 [analyze, analyze]', async () => {
  const p = write('dup-flow.yaml', HEAD + `  - id: analyze
    role: "a/b"
    task: "分析"
    output: analysis_result
  - id: compile
    role: "a/b"
    task: "汇总 {{analysis_result}}"
    output: final
    depends_on: [analyze, analysis_result]
`);
  const r = await autoFixDependsOnIds(p);
  assert(r.fixed === 1, `应修 1 处，实际 ${r.fixed}`);
  const deps = parseWorkflow(p).steps.find((s) => s.id === 'compile')!.depends_on!;
  assert(deps.length === 1 && deps[0] === 'analyze', `依赖应去重为 [analyze]，实际 ${JSON.stringify(deps)}`);
  assert(errorsOf(p).length === 0, errorsOf(p).join(' / '));
});

await test('多行列表里的重复同样删干净', async () => {
  const p = write('dup-block.yaml', HEAD + `  - id: analyze
    role: "a/b"
    task: "分析"
    output: analysis_result
  - id: compile
    role: "a/b"
    task: "汇总 {{analysis_result}}"
    output: final
    depends_on:
      - analyze
      - analysis_result
`);
  await autoFixDependsOnIds(p);
  const deps = parseWorkflow(p).steps.find((s) => s.id === 'compile')!.depends_on!;
  assert(deps.length === 1 && deps[0] === 'analyze', `实际 ${JSON.stringify(deps)}`);
});

console.log('\n─── 拒绝乱改（宁可报错也不连错边） ───');

await test('对不上任何 output 的假 id 不动它', async () => {
  const p = write('unknown.yaml', HEAD + `  - id: a
    role: "a/b"
    task: "t"
    output: out_a
  - id: b
    role: "a/b"
    task: "t"
    depends_on: [完全不存在的东西]
`);
  const r = await autoFixDependsOnIds(p);
  assert(r.fixed === 0, '不该乱猜');
  assert(errorsOf(p).length > 0, '应保留报错交给用户/LLM');
});

await test('同名 output 出现多次（有歧义）不动它', async () => {
  const p = write('ambiguous.yaml', HEAD + `  - id: a1
    role: "a/b"
    task: "t"
    output: dup
  - id: a2
    role: "a/b"
    task: "t"
    output: dup
  - id: b
    role: "a/b"
    task: "t"
    depends_on: [dup]
`);
  const r = await autoFixDependsOnIds(p);
  assert(r.fixed === 0, '有歧义时必须放弃修复');
});

await test('改写会成环时放弃（不制造死锁 DAG）', async () => {
  const p = write('cycle.yaml', HEAD + `  - id: a
    role: "a/b"
    task: "t"
    output: out_a
    depends_on: [out_b]
  - id: b
    role: "a/b"
    task: "t"
    output: out_b
    depends_on: [a]
`);
  const r = await autoFixDependsOnIds(p);
  assert(r.fixed === 0, `a→b 且 b→a 会成环，必须放弃，实际改了 ${r.fixed}`);
});

await test('自己的 output 写进自己的 depends_on → 不改（否则自依赖）', async () => {
  const p = write('self.yaml', HEAD + `  - id: a
    role: "a/b"
    task: "t"
    output: out_a
    depends_on: [out_a]
`);
  const r = await autoFixDependsOnIds(p);
  assert(r.fixed === 0, '不能把自己连给自己');
});

await test('本来就正确的工作流不被改动（幂等）', async () => {
  const p = write('ok.yaml', HEAD + `  - id: a
    role: "a/b"
    task: "t"
    output: out_a
  - id: b
    role: "a/b"
    task: "用 {{out_a}}"
    depends_on: [a]
`);
  const before = readFileSync(p, 'utf-8');
  const r = await autoFixDependsOnIds(p);
  assert(r.fixed === 0, '没错就不该动');
  assert(readFileSync(p, 'utf-8') === before, '文件被无谓改写了');
});

console.log('\n─── 报错文案要能自解释（手写 YAML 的人也看得懂） ───');

await test('报错直接点破"这是输出变量名，应该写哪个 step id"', () => {
  const p = write('msg.yaml', HEAD + `  - id: analyze
    role: "a/b"
    task: "分析"
    output: analysis_result
  - id: compile
    role: "a/b"
    task: "汇总 {{analysis_result}}"
    depends_on: [analysis_result]
`);
  const e = errorsOf(p).join(' ');
  assert(e.includes('输出变量名'), `应说明是输出变量名：${e}`);
  assert(e.includes('"analyze"'), `应指出该写哪个 step id：${e}`);
});

rmSync(dir, { recursive: true, force: true });

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
