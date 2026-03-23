/**
 * 循环迭代 E2E 测试
 * 验证: exit_condition 立即退出、多轮迭代、max_iterations 强制退出、_loop_iteration 变量注入
 */
import { resolve } from 'node:path';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { parseWorkflow } from '../src/core/parser.js';
import { buildDAG } from '../src/core/dag.js';
import { executeDAG } from '../src/core/executor.js';
import type { LLMConnector, LLMResult, LLMConfig } from '../src/types.js';

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

const tmpDir = resolve(import.meta.dirname!, '../.test-tmp-loop');
const agentsDir = resolve(import.meta.dirname!, '../node_modules/agency-agents-zh');

mkdirSync(tmpDir, { recursive: true });

const baseLlm = `
llm:
  provider: claude
  model: test
  max_tokens: 1024
  timeout: 5000
  retry: 0
`;

function makeWorkflowYaml(maxIterations: number): string {
  return `
name: 循环测试
description: loop iteration test
agents_dir: ${agentsDir}
${baseLlm}
inputs:
  - name: topic
    required: true
steps:
  - id: draft
    role: product/product-manager
    task: "撰写关于 {{topic}} 的文案"
    output: copy
  - id: review
    role: product/product-manager
    task: "审查文案: {{copy}}"
    output: feedback
    depends_on:
      - draft
  - id: revise
    role: product/product-manager
    task: "根据反馈修改文案: {{feedback}}"
    output: copy
    depends_on:
      - review
    loop:
      back_to: review
      max_iterations: ${maxIterations}
      exit_condition: "{{feedback}} contains 通过"
`;
}

// ─── Test 1: exit_condition 首轮即满足 → 不循环 ───
console.log('\n=== E2E: 循环迭代 ===');

await test('exit_condition 首轮满足: 无循环', async () => {
  const yamlPath = resolve(tmpDir, 'loop-exit-first.yaml');
  writeFileSync(yamlPath, makeWorkflowYaml(3));

  let callCount = 0;
  const mock: LLMConnector = {
    async chat(_sys: string, user: string, _cfg: LLMConfig): Promise<LLMResult> {
      callCount++;
      let content: string;
      if (user.includes('撰写')) {
        content = '初始文案内容';
      } else if (user.includes('审查')) {
        content = '通过，文案质量很好';  // 首轮即通过
      } else {
        content = '修改后的文案';
      }
      return { content, usage: { input_tokens: 10, output_tokens: 10 } };
    },
  };

  const wf = parseWorkflow(yamlPath);
  const dag = buildDAG(wf);
  const result = await executeDAG(dag, {
    connector: mock,
    agentsDir,
    llmConfig: wf.llm,
    concurrency: 1,
    inputs: new Map([['topic', '产品发布']]),
  });

  assert(result.success, '工作流应成功');
  assert(callCount === 3, `应有 3 次 LLM 调用 (draft+review+revise)，实际: ${callCount}`);
  assert(result.steps.length === 3, `应有 3 步结果，实际: ${result.steps.length}`);
  // revise 步骤不应有 iterations（没有循环）
  const reviseStep = result.steps.find(s => s.id === 'revise')!;
  assert(reviseStep.iterations === undefined, `revise 不应有 iterations，实际: ${reviseStep.iterations}`);
});

// ─── Test 2: 多轮迭代 — 第一轮不通过，第二轮通过 ───
await test('multi-round: 1次循环后通过', async () => {
  const yamlPath = resolve(tmpDir, 'loop-multi-round.yaml');
  writeFileSync(yamlPath, makeWorkflowYaml(5));

  let callCount = 0;
  let reviewCount = 0;
  const mock: LLMConnector = {
    async chat(_sys: string, user: string, _cfg: LLMConfig): Promise<LLMResult> {
      callCount++;
      let content: string;
      if (user.includes('撰写')) {
        content = '初始文案';
      } else if (user.includes('审查')) {
        reviewCount++;
        content = reviewCount === 1 ? '不合格，需要修改' : '通过，很好';
      } else {
        content = '修改后的文案 v' + callCount;
      }
      return { content, usage: { input_tokens: 10, output_tokens: 10 } };
    },
  };

  const wf = parseWorkflow(yamlPath);
  const dag = buildDAG(wf);
  const result = await executeDAG(dag, {
    connector: mock,
    agentsDir,
    llmConfig: wf.llm,
    concurrency: 1,
    inputs: new Map([['topic', '产品发布']]),
  });

  assert(result.success, '工作流应成功');
  // draft(1) + review(1) + revise(1) + review(2) + revise(2) = 5
  assert(callCount === 5, `应有 5 次 LLM 调用，实际: ${callCount}`);
  // upsert 策略：结果仍为 3 步
  assert(result.steps.length === 3, `应有 3 步结果(upsert)，实际: ${result.steps.length}`);
});

// ─── Test 3: max_iterations 强制退出 ───
await test('max_iterations: 强制退出', async () => {
  const yamlPath = resolve(tmpDir, 'loop-max-iter.yaml');
  writeFileSync(yamlPath, makeWorkflowYaml(2));

  let callCount = 0;
  const mock: LLMConnector = {
    async chat(_sys: string, user: string, _cfg: LLMConfig): Promise<LLMResult> {
      callCount++;
      let content: string;
      if (user.includes('撰写')) {
        content = '初始文案';
      } else if (user.includes('审查')) {
        content = '不合格，继续修改';  // 永远不通过
      } else {
        content = '修改后的文案';
      }
      return { content, usage: { input_tokens: 10, output_tokens: 10 } };
    },
  };

  const wf = parseWorkflow(yamlPath);
  const dag = buildDAG(wf);
  const result = await executeDAG(dag, {
    connector: mock,
    agentsDir,
    llmConfig: wf.llm,
    concurrency: 1,
    inputs: new Map([['topic', '产品发布']]),
  });

  assert(result.success, '工作流应成功（max_iterations 不算失败）');
  // draft(1) + review(1) + revise(1) + review(2) + revise(2) = 5
  assert(callCount === 5, `应有 5 次 LLM 调用 (max_iterations=2)，实际: ${callCount}`);
});

// ─── Test 4: _loop_iteration 变量注入 ───
await test('_loop_iteration 变量正确注入', async () => {
  const yamlPath = resolve(tmpDir, 'loop-var-inject.yaml');
  // 特殊 workflow，task 中包含 {{_loop_iteration}}
  writeFileSync(yamlPath, `
name: 循环变量注入测试
description: verify _loop_iteration variable
agents_dir: ${agentsDir}
${baseLlm}
inputs:
  - name: topic
    required: true
steps:
  - id: draft
    role: product/product-manager
    task: "撰写关于 {{topic}} 的文案"
    output: copy
  - id: review
    role: product/product-manager
    task: "第 {{_loop_iteration}} 轮审查: {{copy}}"
    output: feedback
    depends_on:
      - draft
  - id: revise
    role: product/product-manager
    task: "第 {{_loop_iteration}} 轮修改: {{feedback}}"
    output: copy
    depends_on:
      - review
    loop:
      back_to: review
      max_iterations: 3
      exit_condition: "{{feedback}} contains 通过"
`);

  let reviewCount = 0;
  const capturedIterations: string[] = [];
  const mock: LLMConnector = {
    async chat(_sys: string, user: string, _cfg: LLMConfig): Promise<LLMResult> {
      // 捕获 review 步骤中的 _loop_iteration 值
      const iterMatch = user.match(/第 (\d+) 轮审查/);
      if (iterMatch) {
        capturedIterations.push(iterMatch[1]);
        reviewCount++;
      }
      const reviseMatch = user.match(/第 (\d+) 轮修改/);
      if (reviseMatch) {
        capturedIterations.push('revise-' + reviseMatch[1]);
      }

      let content: string;
      if (user.includes('撰写')) {
        content = '初始文案';
      } else if (user.includes('审查')) {
        content = reviewCount < 2 ? '不合格' : '通过';
      } else {
        content = '修改版';
      }
      return { content, usage: { input_tokens: 10, output_tokens: 10 } };
    },
  };

  const wf = parseWorkflow(yamlPath);
  const dag = buildDAG(wf);
  const result = await executeDAG(dag, {
    connector: mock,
    agentsDir,
    llmConfig: wf.llm,
    concurrency: 1,
    inputs: new Map([['topic', '产品发布']]),
  });

  assert(result.success, '工作流应成功');
  // 第一轮: _loop_iteration = "1", 第二轮: _loop_iteration = "2"
  assert(capturedIterations[0] === '1', `第一轮 review 应为 1，实际: ${capturedIterations[0]}`);
  assert(capturedIterations[1] === 'revise-1', `第一轮 revise 应为 1，实际: ${capturedIterations[1]}`);
  assert(capturedIterations[2] === '2', `第二轮 review 应为 2，实际: ${capturedIterations[2]}`);
  assert(capturedIterations[3] === 'revise-2', `第二轮 revise 应为 2，实际: ${capturedIterations[3]}`);
});

// 清理临时目录
rmSync(tmpDir, { recursive: true });

// ─── 结果 ───
console.log('\n' + '='.repeat(50));
console.log(`  E2E Loop 测试: ${passed} 通过, ${failed} 失败 (共 ${passed + failed} 项)`);
if (failed === 0) {
  console.log('  全部通过!');
} else {
  process.exit(1);
}
console.log('='.repeat(50) + '\n');
