/**
 * 测试 step.llm 的 YAML 解析 (Issue #3 端到端)
 */
import { parseWorkflow, validateWorkflow } from '../src/core/parser.js';
import { resolve } from 'node:path';

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

console.log('\n─── Step LLM YAML 解析 (Issue #3) ───');

test('解析含 step.llm 的 YAML', () => {
  const workflow = parseWorkflow(resolve('test/fixtures/step-llm-test.yaml'));
  assert(workflow.steps.length === 2, `应有 2 步, got ${workflow.steps.length}`);

  const stepA = workflow.steps[0];
  assert(stepA.llm !== undefined, 'step_a 应有 llm');
  assert(stepA.llm!.model === 'deepseek-reasoner', `step_a.llm.model should be deepseek-reasoner, got ${stepA.llm!.model}`);
  assert(stepA.llm!.provider === undefined, 'step_a.llm.provider 应为 undefined (继承全局)');

  const stepB = workflow.steps[1];
  assert(stepB.llm !== undefined, 'step_b 应有 llm');
  assert(stepB.llm!.provider === 'openai', `step_b.llm.provider should be openai, got ${stepB.llm!.provider}`);
  assert(stepB.llm!.model === 'gpt-4o', `step_b.llm.model should be gpt-4o, got ${stepB.llm!.model}`);
});

test('validate 仍然通过', () => {
  const workflow = parseWorkflow(resolve('test/fixtures/step-llm-test.yaml'));
  const errors = validateWorkflow(workflow);
  assert(errors.length === 0, `不应有错误, got: ${errors.join(', ')}`);
});

test('无 step.llm 的步骤正常解析', () => {
  const workflow = parseWorkflow(resolve('workflows/product-review.yaml'));
  for (const step of workflow.steps) {
    assert(step.llm === undefined, `step ${step.id} 不应有 llm 字段`);
  }
});

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
