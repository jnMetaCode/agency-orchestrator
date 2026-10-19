/**
 * 就绪执行（无循环工作流）：依赖一了结就开跑，槽位一空就补。
 * 以前按层、层内再按批：同批里快步骤要等慢步骤，一条分支能往下走了也得等另一条分支整层跑完。
 * 用任务文本里的标记控制快慢/失败，记每步起止时间和同时在跑的数量。
 */
import { resolve } from 'node:path';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { parseWorkflow } from '../src/core/parser.js';
import { buildDAG } from '../src/core/dag.js';
import { executeDAG } from '../src/core/executor.js';
import type { LLMConnector, LLMResult, LLMConfig } from '../src/types.js';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (err) { console.log(`  ❌ ${name}: ${err instanceof Error ? err.message : err}`); failed++; }
}
function assert(condition: boolean, msg: string): void { if (!condition) throw new Error(msg); }

/** 任务文本里的 [id] 是步骤标记；含 SLOW 慢 300ms，含 FAIL 直接失败，其余 20ms */
class TimedConnector implements LLMConnector {
  start = new Map<string, number>();
  end = new Map<string, number>();
  active = 0;
  maxActive = 0;
  async chat(_system: string, user: string, _config: LLMConfig): Promise<LLMResult> {
    const id = /\[(\w+)\]/.exec(user)?.[1] ?? '?';
    this.start.set(id, Date.now());
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      await new Promise(r => setTimeout(r, /SLOW/.test(user) ? 300 : 20));
      if (/FAIL/.test(user)) throw new Error(`mock failure ${id}`);
      return { content: `done ${id}`, usage: { input_tokens: 1, output_tokens: 1 } };
    } finally {
      this.active--;
      this.end.set(id, Date.now());
    }
  }
}

const tmpDir = resolve(import.meta.dirname!, '../.test-tmp-ready-queue');
const agentsDir = resolve(import.meta.dirname!, '../node_modules/agency-agents-zh');
mkdirSync(tmpDir, { recursive: true });
let serial = 0;

async function run(steps: string, opts: { concurrency?: number; provider?: string } = {}) {
  const yamlPath = resolve(tmpDir, `wf-${serial++}.yaml`);
  writeFileSync(yamlPath, `
name: ready queue
agents_dir: ${agentsDir}
llm:
  provider: ${opts.provider ?? 'claude'}
  model: test
  timeout: 5000
  retry: 0
concurrency: ${opts.concurrency ?? 2}
steps:
${steps}`);
  const wf = parseWorkflow(yamlPath);
  const mock = new TimedConnector();
  const result = await executeDAG(buildDAG(wf), {
    connector: mock, agentsDir, llmConfig: wf.llm, concurrency: wf.concurrency ?? 2, inputs: new Map(), verify: false,
  });
  return { mock, result };
}
const step = (id: string, task: string, deps: string[] = [], extra = '') => `
  - id: ${id}
    role: product/product-manager
    task: "[${id}] ${task}"
    output: out_${id}${deps.length ? `\n    depends_on: [${deps.join(', ')}]` : ''}${extra}`;

console.log('\n=== 就绪执行（无循环工作流） ===');

await test('分支不再齐步走：快分支的下游不等慢分支', async () => {
  const { mock } = await run(step('a', 'SLOW') + step('b', 'fast') + step('c', 'fast', ['b']));
  assert(mock.start.get('c')! < mock.end.get('a')!, `c 应在 a 结束前开始（c 开始 ${mock.start.get('c')! - mock.start.get('a')!}ms，a 结束 ${mock.end.get('a')! - mock.start.get('a')!}ms）`);
});

await test('槽位一空就补：同层快步骤不等慢步骤', async () => {
  const { mock } = await run(step('s', 'SLOW') + step('f1', 'fast') + step('f2', 'fast') + step('f3', 'fast'));
  assert(mock.start.get('f2')! < mock.end.get('s')! && mock.start.get('f3')! < mock.end.get('s')!, 'f2、f3 应在慢步骤 s 结束前开始');
  assert(mock.maxActive <= 2, `并发不能超过 concurrency=2，实际 ${mock.maxActive}`);
});

await test('并发上限始终有效', async () => {
  const many = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => step(id, id === 'a' ? 'SLOW' : 'fast')).join('');
  const { mock } = await run(many, { concurrency: 3 });
  assert(mock.maxActive === 3, `应恰好用满 3 个槽位，实际最大并发 ${mock.maxActive}`);
});

await test('失败只拖下游：无关分支照常跑完', async () => {
  const { result } = await run(step('a', 'FAIL') + step('b', 'fast', ['a']) + step('c', 'SLOW') + step('d', 'fast', ['c']));
  const st = Object.fromEntries(result.steps.map(s => [s.id, s.status]));
  assert(st.a === 'failed' && st.b === 'skipped' && st.c === 'completed' && st.d === 'completed', `状态不符：${JSON.stringify(st)}`);
  assert(!result.success, '有失败步骤时整体不算成功');
});

await test('any_completed 合并步：等所有依赖了结后基于已完成分支执行', async () => {
  const { result, mock } = await run(step('a', 'FAIL') + step('b', 'SLOW')
    + step('m', 'merge {{out_b}}', ['a', 'b'], '\n    depends_on_mode: any_completed'));
  const st = Object.fromEntries(result.steps.map(s => [s.id, s.status]));
  assert(st.m === 'completed', `合并步应执行，实际 ${st.m}`);
  assert(mock.start.get('m')! >= mock.end.get('b')!, '合并步必须等慢依赖 b 结束');
});

await test('结果按拓扑顺序呈现，不随完成先后变化', async () => {
  const { result } = await run(step('a', 'SLOW') + step('b', 'fast') + step('c', 'fast', ['b']) + step('d', 'fast', ['a']));
  const ids = result.steps.map(s => s.id).join(',');
  assert(ids === 'a,b,c,d', `顺序应为 a,b,c,d（a 最后才完成），实际 ${ids}`);
});

await test('CLI 供应商仍然严格串行', async () => {
  const { mock } = await run(step('a', 'fast') + step('b', 'fast') + step('c', 'fast'), { provider: 'codex-cli', concurrency: 3 });
  assert(mock.maxActive === 1, `CLI 共享同一账户额度，最大并发应为 1，实际 ${mock.maxActive}`);
});

rmSync(tmpDir, { recursive: true, force: true });
console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed) process.exit(1);
