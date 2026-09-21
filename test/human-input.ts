/**
 * 测试 human_input 人工输入节点：
 *  - parser 接受无 role/task 的 human_input 节点
 *  - executeDAG：预填 output 变量时不阻塞、直接采用，并把值注入下游；该步不调 LLM
 */
import { executeDAG } from '../src/core/executor.js';
import { buildDAG } from '../src/core/dag.js';
import { parseWorkflow } from '../src/core/parser.js';
import type { WorkflowDefinition, LLMConnector, LLMResult, LLMConfig } from '../src/types.js';
import { resolve } from 'node:path';
import { existsSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void>): Promise<void> {
  return fn().then(() => { console.log(`  ✅ ${name}`); passed++; })
    .catch((err) => { console.log(`  ❌ ${name}: ${err instanceof Error ? err.message : err}`); failed++; });
}
function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg);
}

const userMessages: string[] = [];
let chatCalls = 0;
class CaptureConnector implements LLMConnector {
  async chat(_sys: string, user: string, _config: LLMConfig): Promise<LLMResult> {
    chatCalls++; userMessages.push(user);
    return { content: 'written', usage: { input_tokens: 1, output_tokens: 1 } };
  }
}

const agentsDir = [
  resolve(import.meta.dirname!, '../node_modules/agency-agents-zh'),
  resolve(import.meta.dirname!, '../agency-agents-zh'),
  resolve(import.meta.dirname!, '../../agency-agents-zh'),
].find(d => existsSync(d)) || resolve(import.meta.dirname!, '../../agency-agents-zh');

console.log('\n─── human_input 人工输入节点 ───');

await test('parser 接受无 role/task 的 human_input 节点', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ao-hi-'));
  const file = join(dir, 'hi.yaml');
  writeFileSync(file, [
    'name: hi-test',
    'agents_dir: agency-agents-zh',
    'llm:',
    '  provider: deepseek',
    '  model: deepseek-chat',
    'steps:',
    '  - id: ask',
    '    type: human_input',
    '    prompt: "往哪个方向写?"',
    '    output: hint',
    '  - id: write',
    '    role: product/product-manager',
    '    task: "用 {{hint}} 写"',
    '    output: result',
    '    depends_on: [ask]',
  ].join('\n'), 'utf-8');
  const wf = parseWorkflow(file);  // 不应抛 "缺少 role/task"
  assert(wf.steps[0].type === 'human_input', 'ask 应为 human_input 节点');
  unlinkSync(file);
});

await test('executeDAG：预填即采用，注入下游，且该步不调 LLM', async () => {
  chatCalls = 0; userMessages.length = 0;
  const workflow: WorkflowDefinition = {
    name: 'hi',
    agents_dir: agentsDir,
    llm: { provider: 'deepseek', model: 'deepseek-chat' },
    steps: [
      { id: 'ask', role: '', type: 'human_input', task: '', prompt: '往哪个方向?', output: 'hint' },
      { id: 'write', role: 'product/product-manager', task: '用 {{hint}} 写', output: 'result', depends_on: ['ask'] },
    ],
  };
  const dag = buildDAG(workflow);
  const result = await executeDAG(dag, {
    connector: new CaptureConnector(),
    agentsDir,
    llmConfig: workflow.llm,
    concurrency: 1,
    inputs: new Map([['hint', '科幻悬疑']]),  // 预填 → 不阻塞 stdin
  });
  assert(chatCalls === 1, `应只调 1 次 LLM（write），实际 ${chatCalls}`);
  assert(userMessages[0].includes('科幻悬疑'), 'write 应收到注入的人工输入');
  const ask = result.steps.find(s => s.id === 'ask');
  assert(ask?.status === 'completed', 'ask 步骤应完成');
});

// 真实故障：cron / Docker / CI 下 stdin 是关着的，readline 的 question 回调在 EOF 时永远不触发，
// 进度计时器又让进程永不退出——运行就挂死在人工节点上，上游花钱跑完的步骤一个字不落盘。
// 必须用真 CLI + 真的关闭的 stdin 来测：进程内造不出「整个进程因此挂住」这件事。
await test('stdin 已关闭（< /dev/null）：人工节点立刻失败、照常落盘，而不是永远挂住', async () => {
  const { spawn } = await import('node:child_process');
  const { readdirSync, readFileSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'ao-human-eof-'));
  const wf = join(dir, 'wf.yaml');
  writeFileSync(wf, [
    'name: "eof"', 'agents_dir: "agency-agents-zh"', 'llm: { provider: "ollama", model: "none" }',
    'steps:', '  - id: gate', '    type: approval', '    prompt: "继续吗"', '    output: decision', '',
  ].join('\n'), 'utf-8');
  const out = join(dir, 'out');
  const child = spawn(process.execPath, [resolve('dist/cli.js'), 'run', wf, '--output', out], {
    stdio: ['ignore', 'pipe', 'pipe'],   // 'ignore' = /dev/null：一上来就是 EOF
    env: { ...process.env, AO_NO_MODEL_HINT: '1', AO_NO_UPDATE_CHECK: '1' },
  });
  let log = '';
  child.stdout.on('data', (c) => { log += c; });
  child.stderr.on('data', (c) => { log += c; });
  const code = await new Promise<number | 'timeout'>((res) => {
    const t = setTimeout(() => { child.kill('SIGKILL'); res('timeout'); }, 20_000);
    child.once('exit', (c) => { clearTimeout(t); res(c ?? -1); });
  });
  assert(code !== 'timeout', '20 秒内必须自己结束（修复前会永远挂住）');
  assert(code === 1, `应以失败退出（实际 ${code}）`);
  assert(/标准输入已关闭/.test(log) && /-i /.test(log), '报错要说清原因，并指路 -i 预填');
  const runs = existsSync(out) ? readdirSync(out) : [];
  assert(runs.length === 1, '结果照常落盘（可 --resume）');
  const meta = JSON.parse(readFileSync(join(out, runs[0], 'metadata.json'), 'utf-8'));
  assert(meta.steps?.[0]?.status === 'failed', `gate 标为失败（实际 ${meta.steps?.[0]?.status}）`);
});

await test('不可交互的宿主（MCP：stdin 是 JSON-RPC 通道）：人工节点不碰 stdin，直接失败', async () => {
  const wfPath = join(mkdtempSync(join(tmpdir(), 'ao-human-mcp-')), 'wf.yaml');
  writeFileSync(wfPath, [
    'name: "mcp"', 'agents_dir: "agency-agents-zh"', 'llm: { provider: "ollama", model: "none" }',
    'steps:', '  - id: ask', '    type: human_input', '    prompt: "方向？"', '    output: hint', '',
  ].join('\n'), 'utf-8');
  const workflow = parseWorkflow(wfPath);
  const before = process.stdin.listenerCount('data') + process.stdin.listenerCount('readable') + process.stdin.listenerCount('keypress');
  process.env.AO_NON_INTERACTIVE = '1';
  try {
    const result = await executeDAG(buildDAG(workflow), {
      connector: new CaptureConnector(), agentsDir: resolve('node_modules/agency-agents-zh'),
      llmConfig: workflow.llm, concurrency: 1, inputs: new Map(),
    });
    const ask = result.steps.find(s => s.id === 'ask');
    assert(ask?.status === 'failed' && /不可交互/.test(ask.error || ''), `ask 应失败并说明原因（实际 ${ask?.status}: ${ask?.error}）`);
  } finally {
    delete process.env.AO_NON_INTERACTIVE;
  }
  const after = process.stdin.listenerCount('data') + process.stdin.listenerCount('readable') + process.stdin.listenerCount('keypress');
  assert(after === before, '没有在 stdin 上挂任何监听（readline 没被打开）');
});

console.log(`\nhuman_input 测试: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);
