/**
 * ao init --workflow — 交互式创建 workflow YAML
 */
import { createInterface } from 'readline';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

export interface WorkflowStep {
  id: string;
  role: string;
  task: string;
  output: string;
}

export interface WorkflowOptions {
  name: string;
  description: string;
  roles: WorkflowStep[];
  concurrency: number;
  hasInputs: boolean;
  inputs: { name: string; description: string; required: boolean }[];
}

/** Escape double quotes for YAML string values */
function yamlEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function generateWorkflowYaml(opts: WorkflowOptions): string {
  const lines: string[] = [
    `name: "${yamlEscape(opts.name)}"`,
    `description: "${yamlEscape(opts.description)}"`,
    '',
    'agents_dir: "agency-agents-zh"',
    '',
    'llm:',
    '  provider: deepseek',
    '  model: deepseek-chat',
    '  max_tokens: 4096',
    '',
    `concurrency: ${opts.concurrency}`,
  ];

  if (opts.hasInputs && opts.inputs.length > 0) {
    lines.push('', 'inputs:');
    for (const input of opts.inputs) {
      lines.push(`  - name: "${yamlEscape(input.name)}"`);
      lines.push(`    description: "${yamlEscape(input.description)}"`);
      lines.push(`    required: ${input.required}`);
    }
  }

  lines.push('', 'steps:');
  for (let i = 0; i < opts.roles.length; i++) {
    const step = opts.roles[i];
    lines.push(`  - id: "${yamlEscape(step.id)}"`);
    lines.push(`    role: "${yamlEscape(step.role)}"`);
    // 单行 task 用引号，多行用 block scalar
    if (step.task.includes('\n')) {
      lines.push(`    task: |`);
      for (const taskLine of step.task.split('\n')) {
        lines.push(`      ${taskLine}`);
      }
    } else {
      lines.push(`    task: "${yamlEscape(step.task)}"`);
    }
    lines.push(`    output: "${yamlEscape(step.output)}"`);
    if (i > 0) {
      lines.push(`    depends_on: [${opts.roles[i - 1].id}]`);
    }
  }

  return lines.join('\n') + '\n';
}

export async function interactiveInitWorkflow(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise(res => rl.question(q, res));

  console.log('\n  📝 创建新的工作流\n');

  const name = await ask('  工作流名称: ');
  if (!name.trim()) {
    console.log('  已取消');
    rl.close();
    return;
  }
  const description = await ask('  简短描述: ');
  const concurrencyStr = await ask('  并行度 (默认 2): ');
  const concurrency = parseInt(concurrencyStr) || 2;

  // 收集角色
  const roles: WorkflowStep[] = [];
  console.log('\n  添加步骤（输入空角色名结束）:');
  console.log('  提示: 用 `ao roles` 查看所有可用角色\n');

  let stepNum = 1;
  while (true) {
    const role = await ask(`  步骤 ${stepNum} 角色 (如 engineering/engineering-code-reviewer): `);
    if (!role.trim()) break;
    const task = await ask(`  步骤 ${stepNum} 任务描述: `);
    const id = await ask(`  步骤 ${stepNum} ID (如 review): `);
    const output = await ask(`  步骤 ${stepNum} 输出变量名 (如 review_result): `);
    roles.push({
      id: id.trim() || `step_${stepNum}`,
      role: role.trim(),
      task: task.trim(),
      output: output.trim() || `output_${stepNum}`,
    });
    stepNum++;
  }

  if (roles.length === 0) {
    console.log('  未添加任何步骤，已取消');
    rl.close();
    return;
  }

  // 收集输入
  const hasInputsAnswer = await ask('\n  需要输入变量吗？(y/N): ');
  const hasInputs = hasInputsAnswer.toLowerCase() === 'y';
  const inputs: { name: string; description: string; required: boolean }[] = [];

  if (hasInputs) {
    console.log('  添加输入变量（输入空名称结束）:\n');
    while (true) {
      const inputName = await ask('  变量名: ');
      if (!inputName.trim()) break;
      const inputDesc = await ask('  描述: ');
      const requiredAnswer = await ask('  必填？(Y/n): ');
      inputs.push({
        name: inputName.trim(),
        description: inputDesc.trim(),
        required: requiredAnswer.toLowerCase() !== 'n',
      });
    }
  }

  rl.close();

  // 生成并保存
  const yamlContent = generateWorkflowYaml({ name, description, roles, concurrency, hasInputs, inputs });
  const fileName = name.toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '')
    + '.yaml';
  const workflowsDir = resolve('workflows');
  const outputPath = resolve(workflowsDir, fileName);

  if (!existsSync(workflowsDir)) {
    mkdirSync(workflowsDir, { recursive: true });
  }

  writeFileSync(outputPath, yamlContent, 'utf-8');
  console.log(`\n  ✅ 已生成: ${outputPath}`);
  console.log('  接下来可以:');
  console.log(`    ao plan workflows/${fileName}      查看执行计划`);
  console.log(`    ao run workflows/${fileName}       运行工作流\n`);
}
