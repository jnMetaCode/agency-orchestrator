/**
 * YAML → WorkflowDefinition 解析器
 */
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import type { WorkflowDefinition, StepDefinition } from '../types.js';
import { t } from '../i18n.js';

export function parseWorkflow(filePath: string): WorkflowDefinition {
  const raw = readFileSync(filePath, 'utf-8');
  const doc = yaml.load(raw) as Record<string, unknown>;

  // 基本校验
  if (!doc || typeof doc !== 'object') {
    throw new Error(t('parse.bad_yaml', { path: filePath }));
  }
  if (!doc.name || typeof doc.name !== 'string') {
    throw new Error(t('parse.missing_name'));
  }
  if (!doc.steps || !Array.isArray(doc.steps) || doc.steps.length === 0) {
    throw new Error(t('parse.missing_steps'));
  }
  if (!doc.llm || typeof doc.llm !== 'object') {
    throw new Error(t('parse.missing_llm'));
  }

  const llm = doc.llm as Record<string, unknown>;
  if (!llm.provider) {
    throw new Error(t('parse.missing_provider'));
  }
  // CLI providers (claude-code, gemini-cli, copilot-cli, codex-cli, openclaw-cli, hermes-cli) 和 ollama 不需要 model
  const cliProviders = ['claude-code', 'gemini-cli', 'copilot-cli', 'codex-cli', 'openclaw-cli', 'hermes-cli', 'ollama'];
  if (!llm.model && !cliProviders.includes(llm.provider as string)) {
    throw new Error(t('parse.missing_model'));
  }

  // 校验每个 step
  const stepIds = new Set<string>();
  const steps = doc.steps as StepDefinition[];

  for (const step of steps) {
    if (!step.id) throw new Error(t('parse.missing_step_id'));
    if (stepIds.has(step.id)) throw new Error(`step id 重复: ${step.id}`);
    stepIds.add(step.id);

    if (step.type !== 'approval' && !step.role) {
      throw new Error(`step "${step.id}" 缺少 role`);
    }
    if (!step.task && step.type !== 'approval') {
      throw new Error(`step "${step.id}" 缺少 task`);
    }

    // depends_on 的引用校验在 validateWorkflow() 中处理
  }

  return {
    name: doc.name as string,
    description: doc.description as string | undefined,
    agents_dir: (doc.agents_dir as string) || './agents',
    llm: doc.llm as WorkflowDefinition['llm'],
    concurrency: (doc.concurrency as number) || 2,
    inputs: doc.inputs as WorkflowDefinition['inputs'],
    steps,
  };
}

/**
 * 验证工作流定义（不执行），返回错误列表
 */
export function validateWorkflow(workflow: WorkflowDefinition): string[] {
  const errors: string[] = [];
  const stepIds = new Set(workflow.steps.map(s => s.id));
  const stepById = new Map(workflow.steps.map(s => [s.id, s]));

  // step.output 唯一性检查：两个 step 不能 output 到同一个变量名
  // 否则下游引用拿到的值取决于 context Map 的写入顺序，不可预期
  const outputToSteps = new Map<string, string[]>();
  for (const step of workflow.steps) {
    if (!step.output) continue;
    const owners = outputToSteps.get(step.output) || [];
    owners.push(step.id);
    outputToSteps.set(step.output, owners);
  }
  for (const [outName, owners] of outputToSteps) {
    if (owners.length > 1) {
      errors.push(`output 变量 "${outName}" 被多个 step 同时产出: ${owners.join(', ')}（重名会让下游引用结果不确定）`);
    }
  }

  // 计算每个 step 的 DAG 上游 step ids（递归 depends_on 闭包，不含自身）。
  // 用于校验"变量必须来自 inputs 或当前 step 的上游"——和 autoFix 的拓扑约束保持一致
  function upstreamStepIds(stepId: string): Set<string> {
    const out = new Set<string>();
    const stack = [stepId];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      const step = stepById.get(cur);
      if (!step) continue;
      for (const dep of step.depends_on || []) {
        if (out.has(dep)) continue;
        out.add(dep);
        stack.push(dep);
      }
    }
    return out;
  }

  for (const step of workflow.steps) {
    // 检查 depends_on 引用
    if (step.depends_on) {
      for (const dep of step.depends_on) {
        if (!stepIds.has(dep)) {
          errors.push(`step "${step.id}" 依赖不存在的 step: "${dep}"`);
        }
        if (dep === step.id) {
          errors.push(`step "${step.id}" 不能依赖自己`);
        }
      }
    }

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

    // 检查 {{变量}} 引用：必须来自 inputs，或来自当前 step 的 DAG 上游 step.output
    // （之前只检查"任意 step 是否产出该变量"，让"早期 step 引用下游 output"这种
    // 拓扑反向错误漏过 validate，到 run 阶段才崩。和 autoFix 的拓扑约束对齐）
    // 范围: step.task / step.condition / step.loop.exit_condition / step.prompt
    const refTexts: string[] = [];
    if (step.task) refTexts.push(step.task);
    if (step.condition) refTexts.push(step.condition);
    if (step.loop?.exit_condition) refTexts.push(step.loop.exit_condition);
    if (step.prompt) refTexts.push(step.prompt);

    const varRefs: string[] = [];
    for (const text of refTexts) {
      const matches = text.match(/\{\{(\w+)\}\}/g) || [];
      varRefs.push(...matches);
    }
    if (varRefs.length === 0) continue;

    const upStepIds = upstreamStepIds(step.id);
    const upstreamOutputs = new Set<string>();
    for (const id of upStepIds) {
      const s = stepById.get(id);
      if (s?.output) upstreamOutputs.add(s.output);
    }

    const reportedVars = new Set<string>();  // 同 step 内同名变量只报一次
    for (const ref of varRefs) {
      const varName = ref.slice(2, -2);
      if (varName === '_loop_iteration') continue;
      if (reportedVars.has(varName)) continue;
      const inputDef = workflow.inputs?.find(i => i.name === varName);
      if (inputDef) continue;
      if (upstreamOutputs.has(varName)) continue;
      // 不在 inputs 也不在上游 outputs：错误
      // 区分两种错误信息，方便 autoFix / repairWithLLM 处理
      const producedBySomeStep = workflow.steps.some(s => s.output === varName);
      if (producedBySomeStep) {
        errors.push(`step "${step.id}" 引用了未定义的变量: {{${varName}}} (该变量由非上游 step 产出，需要把对应 step 加进 depends_on)`);
      } else {
        errors.push(`step "${step.id}" 引用了未定义的变量: {{${varName}}}`);
      }
      reportedVars.add(varName);
    }
  }

  // 检查循环依赖
  const cycleError = detectCycle(workflow.steps);
  if (cycleError) errors.push(cycleError);

  return errors;
}

function detectCycle(steps: StepDefinition[]): string | null {
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const adj = new Map<string, string[]>();

  for (const step of steps) {
    adj.set(step.id, step.depends_on || []);
  }

  function dfs(id: string): boolean {
    visited.add(id);
    inStack.add(id);
    for (const dep of adj.get(id) || []) {
      if (inStack.has(dep)) return true;
      if (!visited.has(dep) && dfs(dep)) return true;
    }
    inStack.delete(id);
    return false;
  }

  for (const step of steps) {
    if (!visited.has(step.id) && dfs(step.id)) {
      return '工作流存在循环依赖';
    }
  }
  return null;
}
