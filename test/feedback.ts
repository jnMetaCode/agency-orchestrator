/**
 * 测试 --feedback 对话式返工：
 *  - buildFeedbackBlock 拼接逻辑（含/不含上一版产出）
 *  - executeDAG 只对目标步骤注入反馈，其它步骤不受影响
 */
import { executeDAG, buildFeedbackBlock } from '../src/core/executor.js';
import { buildDAG } from '../src/core/dag.js';
import type { WorkflowDefinition, LLMConnector, LLMResult, LLMConfig } from '../src/types.js';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void>): Promise<void> {
  return fn().then(() => {
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

// 记录每次 chat 调用收到的 (stepIndex via order) userMessage
const userMessages: string[] = [];

class CaptureConnector implements LLMConnector {
  async chat(_sys: string, user: string, _config: LLMConfig): Promise<LLMResult> {
    userMessages.push(user);
    return { content: `out`, usage: { input_tokens: 1, output_tokens: 1 } };
  }
}

const agentsDir = [
  resolve(import.meta.dirname!, '../node_modules/agency-agents-zh'),
  resolve(import.meta.dirname!, '../agency-agents-zh'),
  resolve(import.meta.dirname!, '../../agency-agents-zh'),
].find(d => existsSync(d)) || resolve(import.meta.dirname!, '../../agency-agents-zh');

console.log('\n─── --feedback 对话式返工 ───');

await test('buildFeedbackBlock 含上一版产出', async () => {
  const block = buildFeedbackBlock('结尾太平淡，加个反转', '从前有座山。');
  assert(block.includes('结尾太平淡，加个反转'), '应包含用户意见');
  assert(block.includes('从前有座山。'), '应包含上一版产出');
  assert(block.includes('不要从零重写'), '应提示在原稿基础上修改');
});

await test('buildFeedbackBlock 无上一版产出时退化为纯意见', async () => {
  const block = buildFeedbackBlock('再短一点', undefined);
  assert(block.includes('再短一点'), '应包含用户意见');
  assert(!block.includes('上一版的产出'), '无旧稿时不应出现旧稿引导语');
});

await test('executeDAG 只对目标步骤注入反馈', async () => {
  userMessages.length = 0;
  const workflow: WorkflowDefinition = {
    name: 'fb',
    agents_dir: agentsDir,
    llm: { provider: 'deepseek', model: 'deepseek-chat' },
    steps: [
      { id: 'write', role: 'product/product-manager', task: '写一段', output: 'draft' },
      { id: 'review', role: 'product/product-manager', task: '审阅 {{draft}}', output: 'rev', depends_on: ['write'] },
    ],
  };
  const dag = buildDAG(workflow);
  await executeDAG(dag, {
    connector: new CaptureConnector(),
    agentsDir,
    llmConfig: workflow.llm,
    concurrency: 1,
    inputs: new Map(),
    feedback: { stepId: 'write', text: '加点数据支撑', previousOutput: '旧版正文' },
  });

  const writeMsg = userMessages.find(m => m.startsWith('写一段'));
  const reviewMsg = userMessages.find(m => m.startsWith('审阅'));
  assert(!!writeMsg, 'write 步骤应被调用');
  assert(!!reviewMsg, 'review 步骤应被调用');
  assert(writeMsg!.includes('加点数据支撑'), 'write（目标步骤）应注入反馈');
  assert(writeMsg!.includes('旧版正文'), 'write 应注入上一版产出');
  assert(!reviewMsg!.includes('加点数据支撑'), 'review（非目标步骤）不应注入反馈');
});

console.log(`\n反馈测试: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);
