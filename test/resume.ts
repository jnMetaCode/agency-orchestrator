/**
 * Resume / --from 测试
 * 覆盖: skipStepIds 计算（纯函数）+ 完整 run→save→resume 往返（Mock LLM）
 * DAG: L0=[analyze]  L1=[tech_review, design_review]  L2=[final_summary]
 */
import { resolve } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
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

await test('--from design_review：只跳 L0（同层 tech_review 一起重跑）', () => {
  const skip = computeResumeSkipIds(dag, allDone, 'design_review');
  assert(skip.size === 1 && skip.has('analyze'), `应只跳 analyze，实际: ${[...skip]}`);
  assert(!skip.has('tech_review'), '同层 tech_review 按层级语义应重跑');
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
  assert(conn.calls === 4, `首跑应调用 4 次，实际 ${conn.calls}`);

  const dir = saveResults(result, tmpOut);
  assert(existsSync(resolve(dir, 'metadata.json')), 'metadata.json 应存在');

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
