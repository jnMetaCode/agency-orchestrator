/**
 * CLI 新功能测试 — generateWorkflowYaml + explainWorkflow
 */
import { generateWorkflowYaml } from '../src/cli/init-workflow.js';
import { explainWorkflow } from '../src/cli/explain.js';

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

// ─── generateWorkflowYaml ───

console.log('\n─── generateWorkflowYaml ───');

test('生成包含基本字段的 YAML', () => {
  const yaml = generateWorkflowYaml({
    name: '代码审查',
    description: '多角色代码审查流水线',
    roles: [
      { id: 'review', role: 'engineering/engineering-code-reviewer', task: '审查代码', output: 'review_result' },
      { id: 'security', role: 'engineering/engineering-security-engineer', task: '安全检查', output: 'security_result' },
    ],
    concurrency: 2,
    hasInputs: true,
    inputs: [{ name: 'code', description: '待审查代码', required: true }],
  });

  assert(yaml.includes('name: "代码审查"'), '应包含 name');
  assert(yaml.includes('role: "engineering/engineering-code-reviewer"'), '应包含 role');
  assert(yaml.includes('concurrency: 2'), '应包含 concurrency');
  assert(yaml.includes('required: true'), '应包含 input required');
  assert(yaml.includes('depends_on: [review]'), '第二个步骤应依赖第一个');
});

test('单步骤不应有 depends_on', () => {
  const yaml = generateWorkflowYaml({
    name: 'Simple',
    description: 'test',
    roles: [{ id: 'step1', role: 'engineering/engineering-code-reviewer', task: 'review', output: 'result' }],
    concurrency: 1,
    hasInputs: false,
    inputs: [],
  });

  assert(!yaml.includes('depends_on'), '单步骤不应有 depends_on');
  assert(!yaml.includes('inputs:'), '无输入时不应有 inputs 段');
});

test('多行 task 正确缩进', () => {
  const yaml = generateWorkflowYaml({
    name: 'Test',
    description: 'test',
    roles: [{ id: 's1', role: 'r/r', task: 'line1\nline2\nline3', output: 'out' }],
    concurrency: 1,
    hasInputs: false,
    inputs: [],
  });

  assert(yaml.includes('task: |'), '多行 task 使用 block scalar');
  assert(yaml.includes('      line1'), 'task 行正确缩进');
});

// ─── explainWorkflow ───

console.log('\n─── explainWorkflow ───');

test('解释并行步骤', () => {
  const explanation = explainWorkflow({
    name: '代码审查',
    steps: [
      { id: 'a', role: 'engineering/reviewer', task: '审查代码质量', output: 'r1' },
      { id: 'b', role: 'engineering/security', task: '安全检查', output: 'r2' },
      { id: 'c', role: 'engineering/summary', task: '汇总结果', depends_on: ['a', 'b'], output: 'r3' },
    ] as any,
    inputs: [],
  });

  assert(explanation.includes('并行'), '应标注并行');
  assert(explanation.includes('第 1 层'), '应有第 1 层');
  assert(explanation.includes('第 2 层'), '应有第 2 层');
  assert(explanation.includes('总计 3 个步骤'), '应显示总步骤数');
});

test('解释循环步骤', () => {
  const explanation = explainWorkflow({
    name: '迭代审查',
    steps: [
      { id: 'review', role: 'engineering/reviewer', task: '审查代码', output: 'result',
        loop: { back_to: 'review', max_iterations: 3, exit_condition: '{{result}} contains 通过' } },
    ] as any,
    inputs: [],
  });

  assert(explanation.includes('循环'), '应提及循环');
  assert(explanation.includes('最多 3'), '应显示最大循环次数');
});

test('解释条件分支', () => {
  const explanation = explainWorkflow({
    name: '条件流',
    steps: [
      { id: 'check', role: 'r/r', task: '检查', output: 'out', condition: '{{x}} contains yes' },
    ] as any,
    inputs: [],
  });

  assert(explanation.includes('条件'), '应提及条件');
});

test('显示输入变量', () => {
  const explanation = explainWorkflow({
    name: '有输入',
    steps: [{ id: 's1', role: 'r/r', task: '做事', output: 'out' }] as any,
    inputs: [{ name: 'code', description: '代码内容', required: true }],
  });

  assert(explanation.includes('code'), '应显示输入变量名');
  assert(explanation.includes('必填'), '应显示必填标记');
});

test('空步骤不崩溃', () => {
  const explanation = explainWorkflow({
    name: '空工作流',
    steps: [] as any,
    inputs: [],
  });

  assert(explanation.includes('总计 0 个步骤'), '应显示 0 步骤');
  assert(explanation.includes('最大并行度 0'), '应显示并行度 0');
});

test('单行 task 不使用 block scalar', () => {
  const yaml = generateWorkflowYaml({
    name: 'Test',
    description: 'test',
    roles: [{ id: 's1', role: 'r/r', task: 'single line task', output: 'out' }],
    concurrency: 1,
    hasInputs: false,
    inputs: [],
  });

  assert(!yaml.includes('task: |'), '单行 task 不应使用 block scalar');
  assert(yaml.includes('task: "single line task"'), '单行 task 应用引号包裹');
});

test('name 含双引号时正确转义', () => {
  const yaml = generateWorkflowYaml({
    name: 'My "cool" workflow',
    description: 'test "desc"',
    roles: [{ id: 's1', role: 'r/r', task: 'do', output: 'out' }],
    concurrency: 1,
    hasInputs: false,
    inputs: [],
  });

  assert(yaml.includes('name: "My \\"cool\\" workflow"'), '应转义 name 中的双引号');
  assert(yaml.includes('description: "test \\"desc\\""'), '应转义 description 中的双引号');
});

test('多行 task 第一行短但有省略号', () => {
  const explanation = explainWorkflow({
    name: '多行',
    steps: [{ id: 's1', role: 'r/r', task: '短首行\n第二行很长很长', output: 'out' }] as any,
    inputs: [],
  });

  assert(explanation.includes('短首行...'), '多行 task 应显示省略号');
});

// ─── 汇总 ───
console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
