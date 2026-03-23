# Condition + Loop + Department Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add conditional branching, loop iteration, and 5 department collaboration workflow templates to agency-orchestrator.

**Architecture:** Condition evaluation is a pure function in a new `condition.ts` module. Loop iteration is implemented as an inner loop inside the existing level-based `executeDAG`, using index-based iteration so we can jump back. Types are extended with `condition`, `loop`, and `iterations` fields. New workflow templates go in `workflows/department-collab/`.

**Tech Stack:** TypeScript, js-yaml (existing), custom test harness (existing pattern in `test/run.ts` and `test/e2e.ts`)

**Spec:** `docs/superpowers/specs/2026-03-23-condition-loop-workflows-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/types.ts` | Add `condition`, `depends_on_mode`, `loop` to `StepDefinition`; add `iterations` to `StepResult` |
| `src/core/condition.ts` | **New.** Parse and evaluate condition strings (`contains`/`equals`) |
| `src/core/executor.ts` | Add condition check before step execution; add loop logic with level index backtracking |
| `src/core/parser.ts` | Add validation for `loop.back_to` (exists) and `max_iterations` (valid number) |
| `src/core/dag.ts` | Add `back_to` ancestor validation in `buildDAG`; update `formatDAG` to show condition/loop info |
| `src/output/reporter.ts` | Handle `iterations` field in output; update skip reason text for condition skips |
| `test/condition.ts` | **New.** Unit tests for condition evaluation |
| `test/e2e-condition.ts` | **New.** E2E tests for condition branching workflows |
| `test/e2e-loop.ts` | **New.** E2E tests for loop iteration workflows |
| `workflows/department-collab/hiring-pipeline.yaml` | **New.** Recruitment workflow with condition branching |
| `workflows/department-collab/content-publish.yaml` | **New.** Content publishing with review loop |
| `workflows/department-collab/incident-response.yaml` | **New.** Incident response with 3-way condition |
| `workflows/department-collab/marketing-campaign.yaml` | **New.** Marketing with approval + condition |
| `workflows/department-collab/code-review.yaml` | **New.** Code review with review loop |

---

### Task 1: Add types for condition and loop

**Files:**
- Modify: `src/types.ts:30-38` (StepDefinition)
- Modify: `src/types.ts:88-96` (StepResult)

- [ ] **Step 1: Add `condition` and `loop` to `StepDefinition`**

In `src/types.ts`, add after the existing `prompt?: string` field (line 37):

```typescript
  condition?: string;           // 如 "{{category}} contains bug"
  depends_on_mode?: 'all' | 'any_completed';  // 默认 'all'（任一跳过→跳过），'any_completed' = 只要有一个完成就执行
  loop?: {
    back_to: string;            // 跳回的步骤 id
    max_iterations: number;     // 最大循环次数，必填，上限 10
    exit_condition: string;     // 退出条件，同 condition 语法
  };
```

- [ ] **Step 2: Add `iterations` to `StepResult`**

In `src/types.ts`, add after `tokens` field (line 95):

```typescript
  iterations?: number;          // 该步骤实际执行次数（循环场景 > 1）
```

- [ ] **Step 3: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat: add condition and loop types to StepDefinition"
```

---

### Task 2: Implement condition evaluator

**Files:**
- Create: `src/core/condition.ts`
- Test: `test/condition.ts`

- [ ] **Step 1: Write failing tests for condition evaluation**

Create `test/condition.ts`:

```typescript
/**
 * 条件表达式求值测试
 */
import { evaluateCondition } from '../src/core/condition.js';

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

console.log('\n=== Condition Evaluator ===');

// contains 运算符
test('contains: 匹配子串', () => {
  const ctx = new Map([['category', 'this is a bug_fix issue']]);
  assert(evaluateCondition('{{category}} contains bug', ctx) === true, '应匹配 bug');
});

test('contains: 大小写不敏感', () => {
  const ctx = new Map([['type', 'BUG_FIX']]);
  assert(evaluateCondition('{{type}} contains bug', ctx) === true, '应忽略大小写');
});

test('contains: 不匹配时返回 false', () => {
  const ctx = new Map([['category', 'new_feature']]);
  assert(evaluateCondition('{{category}} contains bug', ctx) === false, '不应匹配');
});

test('contains: 关键词有空格（引号包裹）', () => {
  const ctx = new Map([['msg', 'this is a bug fix']]);
  assert(evaluateCondition('{{msg}} contains "bug fix"', ctx) === true, '应匹配带空格的关键词');
});

// equals 运算符
test('equals: 精确匹配', () => {
  const ctx = new Map([['answer', 'yes']]);
  assert(evaluateCondition('{{answer}} equals yes', ctx) === true, '应精确匹配');
});

test('equals: 大小写不敏感', () => {
  const ctx = new Map([['answer', 'YES']]);
  assert(evaluateCondition('{{answer}} equals yes', ctx) === true, '应忽略大小写');
});

test('equals: trim 后匹配', () => {
  const ctx = new Map([['answer', '  yes  ']]);
  assert(evaluateCondition('{{answer}} equals yes', ctx) === true, '应 trim 后匹配');
});

test('equals: 不匹配时返回 false', () => {
  const ctx = new Map([['answer', 'maybe yes']]);
  assert(evaluateCondition('{{answer}} equals yes', ctx) === false, 'equals 不应做子串匹配');
});

// 边界情况
test('变量替换后再求值', () => {
  const ctx = new Map([['feedback', '文案质量不错，通过']]);
  assert(evaluateCondition('{{feedback}} contains 通过', ctx) === true, '应处理中文');
});

test('未知运算符抛错', () => {
  const ctx = new Map([['x', 'hello']]);
  try {
    evaluateCondition('{{x}} matches hello', ctx);
    throw new Error('应该抛错');
  } catch (err) {
    assert((err as Error).message.includes('不支持的条件运算符'), '应提示不支持');
  }
});

test('格式错误抛错', () => {
  const ctx = new Map([['x', 'hello']]);
  try {
    evaluateCondition('bad format', ctx);
    throw new Error('应该抛错');
  } catch (err) {
    assert((err as Error).message.includes('条件格式错误'), '应提示格式错误');
  }
});

// 结果
console.log('\n' + '='.repeat(50));
console.log(`  Condition 测试: ${passed} 通过, ${failed} 失败 (共 ${passed + failed} 项)`);
if (failed === 0) console.log('  全部通过!');
else process.exit(1);
console.log('='.repeat(50) + '\n');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx test/condition.ts`
Expected: FAIL — module `../src/core/condition.js` not found

- [ ] **Step 3: Implement condition evaluator**

Create `src/core/condition.ts`:

```typescript
/**
 * 条件表达式求值
 *
 * 支持的语法:
 *   {{变量}} contains 关键词
 *   {{变量}} equals 关键词
 *   关键词可用引号包裹: {{var}} contains "bug fix"
 *
 * 大小写不敏感，自动 trim
 */
import { renderTemplate } from './template.js';

const CONDITION_REGEX = /^(.+?)\s+(contains|equals)\s+(.+)$/is;

export function evaluateCondition(
  condition: string,
  context: Map<string, string>
): boolean {
  // 先替换变量
  const rendered = renderTemplate(condition, context);

  const match = rendered.match(CONDITION_REGEX);
  if (!match) {
    throw new Error(`条件格式错误: "${condition}"。支持的格式: <text> contains <keyword> 或 <text> equals <keyword>`);
  }

  // 将换行符替换为空格，避免多行 LLM 输出导致匹配问题
  const left = match[1].trim().replace(/\n/g, ' ').toLowerCase();
  const operator = match[2].toLowerCase();
  // 去掉引号包裹
  const right = match[3].trim().replace(/^["']|["']$/g, '').toLowerCase();

  switch (operator) {
    case 'contains':
      return left.includes(right);
    case 'equals':
      return left === right;
    default:
      throw new Error(`不支持的条件运算符: "${operator}"。支持 contains 和 equals`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx test/condition.ts`
Expected: All tests PASS

- [ ] **Step 5: Run existing tests to verify no regression**

Run: `npx tsx test/run.ts`
Expected: All existing tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/condition.ts test/condition.ts
git commit -m "feat: add condition evaluator with contains/equals operators"
```

---

### Task 3: Add condition support to executor

**Files:**
- Modify: `src/core/executor.ts:56-72` (condition check before execution)
- Modify: `src/output/reporter.ts:75-77` (skip reason text)
- Test: `test/e2e-condition.ts`

- [ ] **Step 1: Write failing E2E tests for condition branching**

Create `test/e2e-condition.ts`:

```typescript
/**
 * E2E: 条件分支测试
 * 用 Mock Connector 验证条件跳过逻辑
 */
import { resolve } from 'node:path';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { parseWorkflow, validateWorkflow } from '../src/core/parser.js';
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

const agentsDir = resolve(import.meta.dirname!, '../../agency-agents-zh');

// 创建临时 workflow 文件
const tmpDir = resolve(import.meta.dirname!, '../.test-tmp');
mkdirSync(tmpDir, { recursive: true });

function writeTmpWorkflow(name: string, yaml: string): string {
  const path = resolve(tmpDir, `${name}.yaml`);
  writeFileSync(path, yaml, 'utf-8');
  return path;
}

/** Mock：返回包含特定关键词的内容 */
function mockWithKeyword(keyword: string): LLMConnector {
  return {
    async chat(_sys: string, _msg: string, _cfg: LLMConfig): Promise<LLMResult> {
      return {
        content: `分析结果: ${keyword}`,
        usage: { input_tokens: 100, output_tokens: 50 },
      };
    }
  };
}

/** Mock：记录调用次数 */
class CountingMock implements LLMConnector {
  calls: string[] = [];
  responses: Map<string, string>;

  constructor(responses: Map<string, string>) {
    this.responses = responses;
  }

  async chat(sys: string, msg: string, _cfg: LLMConfig): Promise<LLMResult> {
    // 通过 message 内容推断步骤
    const stepHint = msg.slice(0, 50);
    this.calls.push(stepHint);

    // 按关键词匹配返回
    for (const [key, val] of this.responses) {
      if (msg.includes(key) || sys.includes(key)) {
        return { content: val, usage: { input_tokens: 100, output_tokens: 50 } };
      }
    }
    return { content: 'default response', usage: { input_tokens: 100, output_tokens: 50 } };
  }
}

console.log('\n=== E2E: 条件分支 ===');

await test('condition 满足时正常执行', async () => {
  const path = writeTmpWorkflow('cond-match', `
name: "条件匹配测试"
agents_dir: "${agentsDir}"
llm:
  provider: claude
  model: test
steps:
  - id: classify
    role: "product/product-manager"
    task: "判断类型"
    output: category
  - id: bug_flow
    role: "engineering/engineering-software-architect"
    task: "处理 bug: {{category}}"
    depends_on: [classify]
    condition: "{{category}} contains bug"
`);

  const wf = parseWorkflow(path);
  const dag = buildDAG(wf);
  const mock = mockWithKeyword('bug_fix');

  const result = await executeDAG(dag, {
    connector: mock,
    agentsDir,
    llmConfig: wf.llm,
    concurrency: 2,
    inputs: new Map(),
  });

  assert(result.steps.length === 2, '应有 2 步');
  assert(result.steps[0].status === 'completed', 'classify 应完成');
  assert(result.steps[1].status === 'completed', 'bug_flow 应完成（条件匹配）');
});

await test('condition 不满足时步骤被跳过', async () => {
  const path = writeTmpWorkflow('cond-skip', `
name: "条件跳过测试"
agents_dir: "${agentsDir}"
llm:
  provider: claude
  model: test
steps:
  - id: classify
    role: "product/product-manager"
    task: "判断类型"
    output: category
  - id: bug_flow
    role: "engineering/engineering-software-architect"
    task: "处理 bug: {{category}}"
    depends_on: [classify]
    condition: "{{category}} contains bug"
  - id: feature_flow
    role: "engineering/engineering-software-architect"
    task: "处理 feature: {{category}}"
    depends_on: [classify]
    condition: "{{category}} contains feature"
`);

  const wf = parseWorkflow(path);
  const dag = buildDAG(wf);
  const mock = mockWithKeyword('new_feature');

  const result = await executeDAG(dag, {
    connector: mock,
    agentsDir,
    llmConfig: wf.llm,
    concurrency: 2,
    inputs: new Map(),
  });

  const bugStep = result.steps.find(s => s.id === 'bug_flow')!;
  const featureStep = result.steps.find(s => s.id === 'feature_flow')!;
  assert(bugStep.status === 'skipped', 'bug_flow 应被跳过（条件不匹配）');
  assert(featureStep.status === 'completed', 'feature_flow 应完成（条件匹配）');
});

await test('condition 跳过时下游也被跳过', async () => {
  const path = writeTmpWorkflow('cond-cascade', `
name: "条件级联跳过测试"
agents_dir: "${agentsDir}"
llm:
  provider: claude
  model: test
steps:
  - id: classify
    role: "product/product-manager"
    task: "判断类型"
    output: category
  - id: bug_flow
    role: "engineering/engineering-software-architect"
    task: "处理 bug: {{category}}"
    depends_on: [classify]
    condition: "{{category}} contains bug"
    output: bug_result
  - id: bug_detail
    role: "engineering/engineering-software-architect"
    task: "详细处理: {{bug_result}}"
    depends_on: [bug_flow]
`);

  const wf = parseWorkflow(path);
  const dag = buildDAG(wf);
  const mock = mockWithKeyword('new_feature');  // 不是 bug

  const result = await executeDAG(dag, {
    connector: mock,
    agentsDir,
    llmConfig: wf.llm,
    concurrency: 2,
    inputs: new Map(),
  });

  assert(result.steps.find(s => s.id === 'bug_flow')!.status === 'skipped', 'bug_flow 被跳过');
  assert(result.steps.find(s => s.id === 'bug_detail')!.status === 'skipped', 'bug_detail 也被跳过');
});

await test('depends_on_mode: any_completed — 互斥分支下游不被跳过', async () => {
  const path = writeTmpWorkflow('cond-any-completed', `
name: "互斥分支汇聚测试"
agents_dir: "${agentsDir}"
llm:
  provider: claude
  model: test
steps:
  - id: classify
    role: "product/product-manager"
    task: "判断类型"
    output: category
  - id: branch_a
    role: "engineering/engineering-software-architect"
    task: "分支A: {{category}}"
    depends_on: [classify]
    condition: "{{category}} contains typeA"
    output: result
  - id: branch_b
    role: "engineering/engineering-software-architect"
    task: "分支B: {{category}}"
    depends_on: [classify]
    condition: "{{category}} contains typeB"
    output: result
  - id: summary
    role: "product/product-manager"
    task: "汇总: {{result}}"
    depends_on: [branch_a, branch_b]
    depends_on_mode: any_completed
`);

  const wf = parseWorkflow(path);
  const dag = buildDAG(wf);
  const mock = mockWithKeyword('this is typeA data');

  const result = await executeDAG(dag, {
    connector: mock,
    agentsDir,
    llmConfig: wf.llm,
    concurrency: 2,
    inputs: new Map(),
  });

  assert(result.steps.find(s => s.id === 'branch_a')!.status === 'completed', 'branch_a 应完成');
  assert(result.steps.find(s => s.id === 'branch_b')!.status === 'skipped', 'branch_b 应跳过');
  assert(result.steps.find(s => s.id === 'summary')!.status === 'completed', 'summary 不应被跳过（any_completed 模式）');
});

// 清理
rmSync(tmpDir, { recursive: true });

console.log('\n' + '='.repeat(50));
console.log(`  条件分支 E2E: ${passed} 通过, ${failed} 失败 (共 ${passed + failed} 项)`);
if (failed === 0) console.log('  全部通过!');
else process.exit(1);
console.log('='.repeat(50) + '\n');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx test/e2e-condition.ts`
Expected: FAIL — condition field is ignored, steps execute regardless

- [ ] **Step 3: Add condition check to executor**

In `src/core/executor.ts`, add import at top:

```typescript
import { evaluateCondition } from './condition.js';
```

In the `executeStep` function, add condition check at the beginning (after `node.status = 'running'` on line 161, before the approval check on line 166):

```typescript
  // 条件检查
  if (node.step.condition) {
    const conditionMet = evaluateCondition(node.step.condition, opts.context);
    if (!conditionMet) {
      node.status = 'skipped';
      return '';  // 返回空，调用方会处理 skipped 状态
    }
  }
```

Then modify `markDownstreamSkipped` to support `depends_on_mode: any_completed`. When a step has `depends_on_mode: 'any_completed'`, it should only be skipped if **all** its dependencies are skipped/failed (not just any one):

```typescript
function markDownstreamSkipped(dag: DAG, skippedStepId: string): void {
  for (const level of dag.levels) {
    for (const node of level) {
      if (node.status !== 'pending') continue;
      if (!node.step.depends_on?.includes(skippedStepId)) continue;

      if (node.step.depends_on_mode === 'any_completed') {
        // 只有当所有依赖都不是 completed 时才跳过
        const allDepsResolved = node.step.depends_on.every(depId => {
          const depNode = dag.levels.flat().find(n => n.step.id === depId);
          return depNode && (depNode.status === 'skipped' || depNode.status === 'failed');
        });
        if (!allDepsResolved) continue; // 还有依赖未决，暂不跳过
      }

      node.status = 'skipped';
      markDownstreamSkipped(dag, node.step.id);
    }
  }
}
```

Then in the `executeDAG` function, update the result handling (around line 97) to check for the skipped status set by condition evaluation. After `if (result.status === 'fulfilled')` block, add handling for condition-skipped:

```typescript
        if (result.status === 'fulfilled') {
          // 检查是否被条件跳过（executeStep 内部设置了 skipped）
          if (node.status === 'skipped') {
            // 条件不满足，标记下游跳过
            markDownstreamSkipped(dag, node.step.id);
          } else {
            node.status = 'completed';
            node.result = result.value;
            if (node.step.output) {
              context.set(node.step.output, result.value);
            }
          }
        }
```

- [ ] **Step 4: Run condition E2E tests**

Run: `npx tsx test/e2e-condition.ts`
Expected: All PASS

- [ ] **Step 5: Run all existing tests to verify no regression**

Run: `npx tsx test/run.ts && npx tsx test/e2e.ts`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/executor.ts test/e2e-condition.ts
git commit -m "feat: add condition branching support to executor"
```

---

### Task 4: Add loop iteration to executor

**Files:**
- Modify: `src/core/executor.ts:51-129` (main loop rewrite to index-based + inner loop)
- Test: `test/e2e-loop.ts`

- [ ] **Step 1: Write failing E2E tests for loop iteration**

Create `test/e2e-loop.ts`:

```typescript
/**
 * E2E: 循环迭代测试
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

const agentsDir = resolve(import.meta.dirname!, '../../agency-agents-zh');
const tmpDir = resolve(import.meta.dirname!, '../.test-tmp-loop');
mkdirSync(tmpDir, { recursive: true });

function writeTmpWorkflow(name: string, yaml: string): string {
  const path = resolve(tmpDir, `${name}.yaml`);
  writeFileSync(path, yaml, 'utf-8');
  return path;
}

console.log('\n=== E2E: 循环迭代 ===');

await test('loop: exit_condition 第 1 轮就满足 → 不循环', async () => {
  const path = writeTmpWorkflow('loop-exit-immediately', `
name: "立即退出循环"
agents_dir: "${agentsDir}"
llm:
  provider: claude
  model: test
steps:
  - id: draft
    role: "product/product-manager"
    task: "写草稿"
    output: copy
  - id: review
    role: "product/product-manager"
    task: "审核: {{copy}}"
    depends_on: [draft]
    output: feedback
  - id: revise
    role: "product/product-manager"
    task: "修改: {{feedback}}"
    depends_on: [review]
    output: copy
    loop:
      back_to: review
      max_iterations: 3
      exit_condition: "{{feedback}} contains 通过"
`);

  const wf = parseWorkflow(path);
  const dag = buildDAG(wf);

  // review 立即返回"通过"
  const mock: LLMConnector = {
    callCount: 0,
    async chat(_sys: string, _msg: string, _cfg: LLMConfig): Promise<LLMResult> {
      (this as any).callCount++;
      if (_msg.includes('审核')) {
        return { content: '质量很好，通过', usage: { input_tokens: 50, output_tokens: 30 } };
      }
      return { content: '草稿内容', usage: { input_tokens: 50, output_tokens: 30 } };
    }
  } as any;

  const result = await executeDAG(dag, {
    connector: mock,
    agentsDir,
    llmConfig: wf.llm,
    concurrency: 1,
    inputs: new Map(),
  });

  assert(result.success === true, '应成功');
  // draft + review + revise = 3 次调用（revise 仍然执行，但之后检查条件发现已通过，不再循环）
  assert((mock as any).callCount === 3, `应调用 3 次，实际: ${(mock as any).callCount}`);
});

await test('loop: 需要多轮迭代才通过', async () => {
  const path = writeTmpWorkflow('loop-multi', `
name: "多轮循环"
agents_dir: "${agentsDir}"
llm:
  provider: claude
  model: test
steps:
  - id: draft
    role: "product/product-manager"
    task: "写草稿"
    output: copy
  - id: review
    role: "product/product-manager"
    task: "审核: {{copy}}"
    depends_on: [draft]
    output: feedback
  - id: revise
    role: "product/product-manager"
    task: "修改: {{feedback}}"
    depends_on: [review]
    output: copy
    loop:
      back_to: review
      max_iterations: 3
      exit_condition: "{{feedback}} contains 通过"
`);

  const wf = parseWorkflow(path);
  const dag = buildDAG(wf);

  let reviewCount = 0;
  const mock: LLMConnector = {
    async chat(_sys: string, msg: string, _cfg: LLMConfig): Promise<LLMResult> {
      if (msg.includes('审核')) {
        reviewCount++;
        // 第 2 次 review 才通过
        if (reviewCount >= 2) {
          return { content: '修改后质量达标，通过', usage: { input_tokens: 50, output_tokens: 30 } };
        }
        return { content: '不合格，需要修改标题', usage: { input_tokens: 50, output_tokens: 30 } };
      }
      return { content: '稿件内容 v' + reviewCount, usage: { input_tokens: 50, output_tokens: 30 } };
    }
  };

  const result = await executeDAG(dag, {
    connector: mock,
    agentsDir,
    llmConfig: wf.llm,
    concurrency: 1,
    inputs: new Map(),
  });

  assert(result.success === true, '应成功');
  assert(reviewCount === 2, `review 应执行 2 次，实际: ${reviewCount}`);
});

await test('loop: 达到 max_iterations 强制退出', async () => {
  const path = writeTmpWorkflow('loop-max', `
name: "达到上限"
agents_dir: "${agentsDir}"
llm:
  provider: claude
  model: test
steps:
  - id: draft
    role: "product/product-manager"
    task: "写草稿"
    output: copy
  - id: review
    role: "product/product-manager"
    task: "审核: {{copy}}"
    depends_on: [draft]
    output: feedback
  - id: revise
    role: "product/product-manager"
    task: "修改: {{feedback}}"
    depends_on: [review]
    output: copy
    loop:
      back_to: review
      max_iterations: 2
      exit_condition: "{{feedback}} contains 通过"
`);

  const wf = parseWorkflow(path);
  const dag = buildDAG(wf);

  // review 永远不通过
  let totalCalls = 0;
  const mock: LLMConnector = {
    async chat(_sys: string, _msg: string, _cfg: LLMConfig): Promise<LLMResult> {
      totalCalls++;
      return { content: '不合格，需修改', usage: { input_tokens: 50, output_tokens: 30 } };
    }
  };

  const result = await executeDAG(dag, {
    connector: mock,
    agentsDir,
    llmConfig: wf.llm,
    concurrency: 1,
    inputs: new Map(),
  });

  // 应强制退出而不是死循环
  assert(result.success === true, '达到上限应仍然算成功（用最后一版结果）');
  // draft(1) + review(1) + revise(1) + review(2) + revise(2) = 5
  assert(totalCalls === 5, `应调用 5 次，实际: ${totalCalls}`);
});

await test('loop: _loop_iteration 变量注入', async () => {
  const path = writeTmpWorkflow('loop-var', `
name: "循环变量"
agents_dir: "${agentsDir}"
llm:
  provider: claude
  model: test
steps:
  - id: draft
    role: "product/product-manager"
    task: "写草稿"
    output: copy
  - id: review
    role: "product/product-manager"
    task: "第 {{_loop_iteration}} 轮审核: {{copy}}"
    depends_on: [draft]
    output: feedback
  - id: revise
    role: "product/product-manager"
    task: "修改: {{feedback}}"
    depends_on: [review]
    output: copy
    loop:
      back_to: review
      max_iterations: 2
      exit_condition: "{{feedback}} contains 通过"
`);

  const wf = parseWorkflow(path);
  const dag = buildDAG(wf);

  const receivedMsgs: string[] = [];
  let reviewCount = 0;
  const mock: LLMConnector = {
    async chat(_sys: string, msg: string, _cfg: LLMConfig): Promise<LLMResult> {
      if (msg.includes('轮审核')) {
        receivedMsgs.push(msg);
        reviewCount++;
        if (reviewCount >= 2) {
          return { content: '通过', usage: { input_tokens: 50, output_tokens: 30 } };
        }
      }
      return { content: '内容', usage: { input_tokens: 50, output_tokens: 30 } };
    }
  };

  await executeDAG(dag, {
    connector: mock,
    agentsDir,
    llmConfig: wf.llm,
    concurrency: 1,
    inputs: new Map(),
  });

  // 第一次 review 应包含 "第 1 轮"，第二次应包含 "第 2 轮"
  assert(receivedMsgs.length >= 2, `应至少有 2 次 review 消息`);
  assert(receivedMsgs[0].includes('第 1 轮'), `第一次应是第 1 轮，实际: ${receivedMsgs[0]}`);
  assert(receivedMsgs[1].includes('第 2 轮'), `第二次应是第 2 轮，实际: ${receivedMsgs[1]}`);
});

// 清理
rmSync(tmpDir, { recursive: true });

console.log('\n' + '='.repeat(50));
console.log(`  循环迭代 E2E: ${passed} 通过, ${failed} 失败 (共 ${passed + failed} 项)`);
if (failed === 0) console.log('  全部通过!');
else process.exit(1);
console.log('='.repeat(50) + '\n');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx test/e2e-loop.ts`
Expected: FAIL — loop field is ignored

- [ ] **Step 3: Rewrite executeDAG to support loops**

In `src/core/executor.ts`, convert the level iteration from `for...of` to `while` with index. The key changes:

1. Replace `for (const level of dag.levels)` (line 51) with `let levelIndex = 0; while (levelIndex < dag.levels.length)`
2. After processing each batch, check for `loop` on completed steps
3. If loop exit condition is NOT met and iterations remain, reset nodes from `back_to` level to current level and set `levelIndex` back
4. Track iteration counts per loop step using a `Map<string, number>`
5. Inject/update `_loop_iteration` in context during loops
6. Use overwrite strategy for `stepResults` — replace existing entries for same step ID

The full implementation of the modified `executeDAG` function:

Replace the main loop section (lines 51-129) with:

```typescript
  const loopIterations = new Map<string, number>(); // stepId → current iteration count

  let levelIndex = 0;
  while (levelIndex < dag.levels.length) {
    const level = dag.levels[levelIndex];
    const { onBatchStart, onBatchComplete } = options;
    const allTasks = level.map(id => dag.nodes.get(id)!);

    // 过滤掉已被标记为 skipped 的节点
    const tasks = allTasks.filter(node => {
      if (node.status === 'skipped') {
        node.endTime = Date.now();
        node.startTime = node.endTime;
        upsertStepResult(stepResults, {
          id: node.step.id,
          role: node.step.role,
          status: 'skipped',
          duration: 0,
          tokens: { input: 0, output: 0 },
        });
        onStepComplete?.(node);
        return false;
      }
      return true;
    });

    // 按 concurrency 分批执行
    for (let i = 0; i < tasks.length; i += concurrency) {
      const batch = tasks.slice(i, i + concurrency);

      onBatchStart?.(batch);

      const results = await Promise.allSettled(
        batch.map(node => executeStep(node, {
          connector,
          agentsDir,
          llmConfig,
          context,
          timeout,
          maxRetry,
          onStepStart,
        }))
      );

      // 处理结果
      for (let j = 0; j < batch.length; j++) {
        const node = batch[j];
        const result = results[j];

        if (result.status === 'fulfilled') {
          if (node.status === 'skipped') {
            // 条件不满足跳过
            markDownstreamSkipped(dag, node.step.id);
          } else {
            node.status = 'completed';
            node.result = result.value;
            if (node.step.output) {
              context.set(node.step.output, result.value);
            }
          }
        } else {
          node.status = 'failed';
          node.error = result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);
          markDownstreamSkipped(dag, node.step.id);
        }

        node.endTime = Date.now();

        const iterCount = loopIterations.get(node.step.id) || 0;
        upsertStepResult(stepResults, {
          id: node.step.id,
          role: node.step.role,
          status: node.status as StepResult['status'],
          output: node.result,
          error: node.error,
          duration: (node.endTime || 0) - (node.startTime || 0),
          tokens: node.tokenUsage || { input: 0, output: 0 },
          iterations: iterCount > 0 ? iterCount + 1 : undefined,
        });

        onStepComplete?.(node);
      }

      onBatchComplete?.(batch);
    }

    // 检查本层是否有需要循环的步骤
    let loopTriggered = false;
    for (const id of level) {
      const node = dag.nodes.get(id)!;
      if (node.step.loop && node.status === 'completed') {
        const loop = node.step.loop;
        const currentIter = (loopIterations.get(id) || 0) + 1;

        // 检查退出条件
        const shouldExit = evaluateCondition(loop.exit_condition, context);
        const maxIter = Math.min(loop.max_iterations, 10); // 硬上限 10

        if (!shouldExit && currentIter < maxIter) {
          loopIterations.set(id, currentIter);
          context.set('_loop_iteration', String(currentIter + 1));

          // 找到 back_to 所在的 level index
          const backToLevel = dag.levels.findIndex(l => l.includes(loop.back_to));
          if (backToLevel < 0) {
            throw new Error(`loop.back_to "${loop.back_to}" 不在 DAG 层级中`);
          }

          // 重置 back_to 到当前层之间的所有节点
          for (let li = backToLevel; li <= levelIndex; li++) {
            for (const nodeId of dag.levels[li]) {
              const n = dag.nodes.get(nodeId)!;
              n.status = 'pending';
              n.result = undefined;
              n.error = undefined;
              n.startTime = undefined;
              n.endTime = undefined;
              n.tokenUsage = undefined;
            }
          }

          levelIndex = backToLevel;
          loopTriggered = true;
          break; // 只处理第一个循环触发
        } else {
          // 循环结束，清理 _loop_iteration
          context.delete('_loop_iteration');
        }
      }
    }

    if (!loopTriggered) {
      levelIndex++;
    }
  }
```

Also add this helper function at the bottom of the file:

```typescript
/** 按 step id 覆盖或插入 stepResult（循环场景用覆盖策略） */
function upsertStepResult(results: StepResult[], entry: StepResult): void {
  const idx = results.findIndex(r => r.id === entry.id);
  if (idx >= 0) {
    results[idx] = entry;
  } else {
    results.push(entry);
  }
}
```

Also ensure `_loop_iteration` is initialized for steps that reference it. In the main while loop, before executing a batch, check if any step in the current level or its loop range references `_loop_iteration` and set it to `"1"` if not already present:

```typescript
  // 在循环范围内的步骤首次执行前，初始化 _loop_iteration
  // 仅在有 loop 的工作流中设置，避免污染非循环工作流的 context
  const hasLoops = workflow.steps.some(s => s.loop);
  if (hasLoops && !context.has('_loop_iteration')) {
    context.set('_loop_iteration', '1');
  }
```

Add this right before the main `while` loop. Note: the `workflow` object is not directly available in `executeDAG` — pass it through or check `dag.nodes` for any step with a `loop` field:

```typescript
  const hasLoops = Array.from(dag.nodes.values()).some(n => n.step.loop);
  if (hasLoops) {
    context.set('_loop_iteration', '1');
  }
```

- [ ] **Step 4: Run loop E2E tests**

Run: `npx tsx test/e2e-loop.ts`
Expected: All PASS

- [ ] **Step 5: Run ALL tests**

Run: `npx tsx test/run.ts && npx tsx test/e2e.ts && npx tsx test/condition.ts && npx tsx test/e2e-condition.ts && npx tsx test/e2e-loop.ts`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/executor.ts test/e2e-loop.ts
git commit -m "feat: add loop iteration support to executor"
```

---

### Task 5: Add validation for condition and loop in parser and DAG

**Files:**
- Modify: `src/core/parser.ts:64-103` (validateWorkflow)
- Modify: `src/core/dag.ts:15-43` (buildDAG — back_to ancestor check)
- Modify: `src/core/dag.ts:94-117` (formatDAG — display condition/loop info)

- [ ] **Step 1: Add loop validation to parser.ts**

In `src/core/parser.ts` `validateWorkflow` function, add after the `depends_on` check block (around line 79):

```typescript
    // 检查 loop 配置
    if (step.loop) {
      if (!step.loop.back_to) {
        errors.push(`step "${step.id}" 的 loop 缺少 back_to`);
      } else if (!stepIds.has(step.loop.back_to)) {
        errors.push(`step "${step.id}" 的 loop.back_to 引用不存在的 step: "${step.loop.back_to}"`);
      }
      if (!step.loop.max_iterations || step.loop.max_iterations < 1) {
        errors.push(`step "${step.id}" 的 loop.max_iterations 必须 >= 1`);
      }
      if (step.loop.max_iterations > 10) {
        errors.push(`step "${step.id}" 的 loop.max_iterations 不能超过 10`);
      }
      if (!step.loop.exit_condition) {
        errors.push(`step "${step.id}" 的 loop 缺少 exit_condition`);
      }
    }
```

Also add `_loop_iteration` as a known variable in the variable reference check. Update the variable check section (around line 88) to also allow `_loop_iteration`:

```typescript
      if (!inputDef && !isOutput && varName !== '_loop_iteration') {
```

- [ ] **Step 2: Add back_to ancestor validation to dag.ts**

In `src/core/dag.ts` `buildDAG` function, after building the levels (line 42, before the `return`), add:

```typescript
  // 验证 loop.back_to 指向祖先节点
  for (const step of workflow.steps) {
    if (step.loop?.back_to) {
      const backToLevel = levels.findIndex(l => l.includes(step.loop!.back_to));
      const currentLevel = levels.findIndex(l => l.includes(step.id));
      if (backToLevel < 0 || currentLevel < 0) {
        throw new Error(`loop 验证失败: "${step.id}" 或 "${step.loop.back_to}" 不在 DAG 中`);
      }
      if (backToLevel >= currentLevel) {
        throw new Error(`step "${step.id}" 的 loop.back_to "${step.loop.back_to}" 必须在其之前的层级（当前层 ${currentLevel + 1}，back_to 层 ${backToLevel + 1}）`);
      }
    }
  }
```

- [ ] **Step 3: Update formatDAG to show condition and loop info**

In `src/core/dag.ts` `formatDAG`, after the dependency display (line 111), add:

```typescript
      if (step.condition) {
        lines.push(`         条件: ${step.condition}`);
      }
      if (step.loop) {
        lines.push(`         循环: → ${step.loop.back_to} (最多 ${step.loop.max_iterations} 次)`);
      }
```

- [ ] **Step 4: Run all tests**

Run: `npx tsx test/run.ts && npx tsx test/e2e.ts && npx tsx test/condition.ts && npx tsx test/e2e-condition.ts && npx tsx test/e2e-loop.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/parser.ts src/core/dag.ts
git commit -m "feat: add condition/loop validation in parser and DAG"
```

---

### Task 6: Update reporter for condition skip reason

**Files:**
- Modify: `src/output/reporter.ts:75-77`

- [ ] **Step 1: Update skip reason text**

In `src/output/reporter.ts`, update the skipped case in `printStepResult` (line 75-76):

```typescript
  } else if (node.status === 'skipped') {
    const reason = node.step.condition ? '条件不满足' : '上游失败/跳过';
    console.log(`  跳过 (${reason})`);
  }
```

- [ ] **Step 2: Run all tests**

Run: `npx tsx test/run.ts && npx tsx test/e2e.ts && npx tsx test/condition.ts && npx tsx test/e2e-condition.ts && npx tsx test/e2e-loop.ts`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add src/output/reporter.ts
git commit -m "feat: show condition skip reason in reporter output"
```

---

### Task 7: Update test script in package.json

**Files:**
- Modify: `package.json:45`

- [ ] **Step 1: Add new test files to test script**

Update the `test` script in `package.json`:

```json
"test": "npx tsx test/run.ts && npx tsx test/condition.ts && npx tsx test/e2e.ts && npx tsx test/e2e-condition.ts && npx tsx test/e2e-loop.ts"
```

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add condition and loop tests to test script"
```

---

### Task 8: Create department collaboration workflow templates

**Files:**
- Create: `workflows/department-collab/hiring-pipeline.yaml`
- Create: `workflows/department-collab/content-publish.yaml`
- Create: `workflows/department-collab/incident-response.yaml`
- Create: `workflows/department-collab/marketing-campaign.yaml`
- Create: `workflows/department-collab/code-review.yaml`

- [ ] **Step 1: Create directory**

```bash
mkdir -p workflows/department-collab
```

- [ ] **Step 2: Create hiring-pipeline.yaml**

```yaml
name: "招聘评估流程"
description: "HR 筛选简历 → 按岗位类型分流技术/业务评估 → 薪酬方案 → 最终审批"

agents_dir: "agency-agents-zh"

llm:
  provider: deepseek
  model: deepseek-chat
  max_tokens: 4096

concurrency: 2

inputs:
  - name: resume
    description: "候选人简历内容"
    required: true
  - name: job_title
    description: "应聘岗位名称"
    required: true

steps:
  - id: screen
    role: "hr/hr-recruiter"
    task: |
      请筛选以下简历，评估候选人是否符合「{{job_title}}」岗位要求：

      1. 基本条件匹配度
      2. 工作经验相关性
      3. 技能匹配程度
      4. 判断岗位类型，只回答一个词：技术岗 或 非技术岗

      简历：
      {{resume}}
    output: screen_result

  - id: tech_eval
    role: "engineering/engineering-software-architect"
    task: |
      请对以下候选人进行技术面评估：

      筛选报告：
      {{screen_result}}

      请评估：
      1. 技术深度和广度
      2. 系统设计能力
      3. 编码能力评估建议
      4. 技术成长潜力
    depends_on: [screen]
    condition: "{{screen_result}} contains 技术岗"
    output: eval_result

  - id: biz_eval
    role: "product/product-manager"
    task: |
      请对以下候选人进行业务面评估：

      筛选报告：
      {{screen_result}}

      请评估：
      1. 业务理解能力
      2. 沟通协作能力
      3. 项目管理经验
      4. 发展潜力
    depends_on: [screen]
    condition: "{{screen_result}} contains 非技术岗"
    output: eval_result

  - id: salary
    role: "hr/hr-recruiter"
    task: |
      基于以下评估结果，制定薪酬方案建议：

      岗位：{{job_title}}
      评估报告：
      {{eval_result}}

      请输出：
      1. 建议薪资范围
      2. 福利方案
      3. 谈判策略建议
    depends_on: [tech_eval, biz_eval]
    depends_on_mode: any_completed

  - id: final_approval
    type: approval
    prompt: "请审阅薪酬方案，输入 yes 确认发 offer，或输入修改意见："
    depends_on: [salary]
```

- [ ] **Step 3: Create content-publish.yaml**

```yaml
name: "内容发布流程"
description: "选题策划 → 文案撰写 → 品牌审核（不通过打回修改，最多 3 轮）→ 法务合规 → 发布清单"

agents_dir: "agency-agents-zh"

llm:
  provider: deepseek
  model: deepseek-chat
  max_tokens: 4096

concurrency: 1

inputs:
  - name: topic
    description: "内容主题"
    required: true
  - name: platform
    description: "发布平台（公众号/小红书/抖音等）"
    required: true

steps:
  - id: plan
    role: "marketing/marketing-content-creator"
    task: |
      请为以下主题制定内容策划方案：

      主题：{{topic}}
      平台：{{platform}}

      请输出：
      1. 选题角度
      2. 目标受众
      3. 内容大纲
      4. 预期效果
    output: content_plan

  - id: write
    role: "marketing/marketing-content-creator"
    task: |
      根据以下策划方案撰写完整文案：

      {{content_plan}}

      平台：{{platform}}
      要求：符合平台调性，有吸引力
    depends_on: [plan]
    output: copy

  - id: brand_review
    role: "design/design-brand-guardian"
    task: |
      请审核以下文案是否符合品牌规范：

      {{copy}}

      审核要点：
      1. 品牌调性一致性
      2. 用语规范性
      3. 视觉建议
      如合格请回复「通过」，否则给出具体修改意见。
    depends_on: [write]
    output: brand_feedback

  - id: revise
    role: "marketing/marketing-content-creator"
    task: |
      根据品牌审核反馈修改文案（第 {{_loop_iteration}} 轮修改）：

      原稿：
      {{copy}}

      审核意见：
      {{brand_feedback}}

      请输出修改后的完整文案。
    depends_on: [brand_review]
    output: copy
    loop:
      back_to: brand_review
      max_iterations: 3
      exit_condition: "{{brand_feedback}} contains 通过"

  - id: legal_review
    role: "support/support-legal-compliance-checker"
    task: |
      请对以下即将发布的内容进行法务合规审查：

      {{copy}}

      审查要点：
      1. 广告法合规性
      2. 知识产权风险
      3. 敏感词检查
      4. 免责声明建议
    depends_on: [revise]
    output: legal_report

  - id: publish_checklist
    role: "marketing/marketing-content-creator"
    task: |
      综合以下信息，输出最终发布清单：

      最终文案：
      {{copy}}

      法务审查：
      {{legal_report}}

      平台：{{platform}}

      请输出：
      1. 发布时间建议
      2. 标签/话题建议
      3. 注意事项
    depends_on: [legal_review]
```

- [ ] **Step 4: Create incident-response.yaml**

```yaml
name: "故障响应流程"
description: "故障分类 → 按类型分流给对应团队分析 → 复盘汇总"

agents_dir: "agency-agents-zh"

llm:
  provider: deepseek
  model: deepseek-chat
  max_tokens: 4096

concurrency: 2

inputs:
  - name: incident_report
    description: "故障报告内容（告警信息、影响范围等）"
    required: true

steps:
  - id: classify
    role: "engineering/engineering-sre"
    task: |
      请分析以下故障报告，判断故障类型并给出初步评估：

      {{incident_report}}

      请输出：
      1. 故障严重程度（P0/P1/P2/P3）
      2. 影响范围
      3. 故障类型（只回答一个：后端故障 / 前端故障 / 基础设施故障）
      4. 初步判断的根因方向
    output: classification

  - id: backend_analysis
    role: "engineering/engineering-backend-architect"
    task: |
      请深入分析以下后端故障：

      故障分类报告：
      {{classification}}

      原始报告：
      {{incident_report}}

      请输出：
      1. 根因分析
      2. 修复方案
      3. 临时缓解措施
      4. 预计恢复时间
    depends_on: [classify]
    condition: "{{classification}} contains 后端故障"
    output: analysis_result

  - id: frontend_analysis
    role: "engineering/engineering-frontend-developer"
    task: |
      请深入分析以下前端故障：

      故障分类报告：
      {{classification}}

      原始报告：
      {{incident_report}}

      请输出：
      1. 根因分析
      2. 修复方案
      3. 回滚方案
      4. 用户影响评估
    depends_on: [classify]
    condition: "{{classification}} contains 前端故障"
    output: analysis_result

  - id: infra_analysis
    role: "engineering/engineering-devops-automator"
    task: |
      请深入分析以下基础设施故障：

      故障分类报告：
      {{classification}}

      原始报告：
      {{incident_report}}

      请输出：
      1. 根因分析
      2. 修复方案
      3. 容灾切换建议
      4. 基础设施加固建议
    depends_on: [classify]
    condition: "{{classification}} contains 基础设施故障"
    output: analysis_result

  - id: postmortem
    role: "engineering/engineering-sre"
    task: |
      请根据以下信息撰写故障复盘报告：

      故障分类：
      {{classification}}

      详细分析：
      {{analysis_result}}

      请输出完整复盘文档：
      1. 时间线
      2. 根因总结
      3. 修复措施
      4. 改进项（短期/长期）
      5. 经验教训
    depends_on: [backend_analysis, frontend_analysis, infra_analysis]
    depends_on_mode: any_completed
```

- [ ] **Step 5: Create marketing-campaign.yaml**

```yaml
name: "营销活动策划"
description: "市场调研 → 创意策划 → 预算审批 → 投放方案 → 效果分析"

agents_dir: "agency-agents-zh"

llm:
  provider: deepseek
  model: deepseek-chat
  max_tokens: 4096

concurrency: 2

inputs:
  - name: product
    description: "产品/服务名称和简介"
    required: true
  - name: budget
    description: "预算范围"
    required: true
  - name: goal
    description: "营销目标（拉新/促活/品牌等）"
    required: true

steps:
  - id: research
    role: "product/product-trend-researcher"
    task: |
      请为以下产品进行市场调研分析：

      产品：{{product}}
      营销目标：{{goal}}
      预算：{{budget}}

      请输出：
      1. 目标市场分析
      2. 竞品营销策略
      3. 目标受众画像
      4. 渠道建议
    output: research_report

  - id: creative
    role: "marketing/marketing-content-creator"
    task: |
      基于以下市场调研，制定创意策划方案：

      {{research_report}}

      营销目标：{{goal}}
      预算：{{budget}}

      请输出：
      1. 活动主题和创意概念
      2. 内容矩阵规划
      3. 关键传播节点
      4. 预期 KPI
    depends_on: [research]
    output: creative_plan

  - id: budget_approval
    type: approval
    prompt: "请审阅营销方案和预算分配，输入 yes 批准执行，或输入修改意见："
    task: "{{creative_plan}}"
    depends_on: [creative]
    output: approval_result

  - id: channel_plan
    role: "marketing/marketing-social-media-strategist"
    task: |
      已批准的营销方案如下，请制定详细的多渠道投放计划：

      {{creative_plan}}

      预算：{{budget}}

      请输出：
      1. 各渠道预算分配
      2. 投放时间表
      3. 素材需求清单
      4. A/B 测试计划
    depends_on: [budget_approval]
    condition: "{{approval_result}} contains yes"
    output: channel_plan

  - id: analysis
    role: "product/product-feedback-synthesizer"
    task: |
      请为以下营销活动设计效果评估框架：

      投放计划：
      {{channel_plan}}

      请输出：
      1. 核心监测指标
      2. 数据采集方案
      3. 归因模型建议
      4. 优化迭代机制
    depends_on: [channel_plan]
```

- [ ] **Step 6: Create code-review.yaml**

```yaml
name: "代码评审流程"
description: "架构/安全/性能并行评审 → 汇总 → 不通过则打回重审（最多 2 轮）"

agents_dir: "agency-agents-zh"

llm:
  provider: deepseek
  model: deepseek-chat
  max_tokens: 4096

concurrency: 3

inputs:
  - name: code
    description: "待评审的代码或 PR 描述"
    required: true
  - name: context
    description: "代码背景说明（功能目的、影响范围等）"
    required: true

steps:
  - id: arch_review
    role: "engineering/engineering-software-architect"
    task: |
      请从架构角度评审以下代码：

      背景：{{context}}

      代码：
      {{code}}

      请评估：
      1. 架构合理性
      2. 设计模式使用
      3. 可维护性
      4. 改进建议
    output: arch_report

  - id: security_review
    role: "engineering/engineering-security-engineer"
    task: |
      请从安全角度评审以下代码：

      背景：{{context}}

      代码：
      {{code}}

      请检查：
      1. OWASP Top 10 风险
      2. 输入验证
      3. 认证授权
      4. 数据保护
    output: security_report

  - id: perf_review
    role: "testing/testing-performance-benchmarker"
    task: |
      请从性能角度评审以下代码：

      背景：{{context}}

      代码：
      {{code}}

      请评估：
      1. 时间复杂度
      2. 内存使用
      3. 并发安全性
      4. 性能瓶颈和优化建议
    output: perf_report

  - id: summary
    role: "engineering/engineering-code-reviewer"
    task: |
      请综合以下三方面评审结果，给出最终评审结论：

      ## 架构评审
      {{arch_report}}

      ## 安全评审
      {{security_report}}

      ## 性能评审
      {{perf_report}}

      请输出：
      1. 总体结论（通过 / 需修改 / 不通过）
      2. 必须修改的问题清单
      3. 建议改进项
      如所有评审都没有严重问题，回复「通过」。
    depends_on: [arch_review, security_review, perf_review]
    output: review_feedback

  - id: revision_request
    role: "engineering/engineering-code-reviewer"
    task: |
      第 {{_loop_iteration}} 轮评审反馈已出，请整理需要开发者修改的具体内容：

      评审结论：
      {{review_feedback}}

      请输出结构化的修改要求清单。
    depends_on: [summary]
    output: revision_list
    loop:
      back_to: arch_review
      max_iterations: 2
      exit_condition: "{{review_feedback}} contains 通过"
```

- [ ] **Step 7: Validate all workflow templates parse correctly**

Run: `for f in workflows/department-collab/*.yaml; do echo "--- $f ---"; npx tsx -e "import {parseWorkflow,validateWorkflow} from './src/core/parser.js'; const w = parseWorkflow('$f'); const e = validateWorkflow(w); if(e.length) { console.error(e); process.exit(1); } else console.log('OK:', w.name, w.steps.length, 'steps');"; done`

Expected: All 5 workflows parse and validate successfully

- [ ] **Step 8: Commit**

```bash
git add workflows/department-collab/
git commit -m "feat: add 5 department collaboration workflow templates"
```

---

### Task 9: Final integration test and cleanup

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 2: Build check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit any remaining changes**

If any files were modified during testing, commit them.
