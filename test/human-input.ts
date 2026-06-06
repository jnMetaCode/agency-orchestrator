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

console.log(`\nhuman_input 测试: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);
