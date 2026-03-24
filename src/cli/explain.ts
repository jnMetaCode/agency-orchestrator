/**
 * ao explain — 用自然语言解释 workflow 的 DAG 执行计划
 */
import type { WorkflowDefinition, StepDefinition } from '../types.js';

interface DAGLayer {
  level: number;
  steps: StepDefinition[];
  isParallel: boolean;
}

/**
 * 将 workflow 步骤分层（拓扑排序）
 */
function buildLayers(steps: StepDefinition[]): DAGLayer[] {
  const stepMap = new Map<string, StepDefinition>();
  const inDegree = new Map<string, number>();
  const deps = new Map<string, string[]>();

  for (const s of steps) {
    stepMap.set(s.id, s);
    deps.set(s.id, s.depends_on || []);
    inDegree.set(s.id, (s.depends_on || []).length);
  }

  const layers: DAGLayer[] = [];
  const remaining = new Set(steps.map(s => s.id));

  while (remaining.size > 0) {
    // 找到所有入度为 0 的节点
    const ready: StepDefinition[] = [];
    for (const id of remaining) {
      if ((inDegree.get(id) || 0) === 0) {
        ready.push(stepMap.get(id)!);
      }
    }

    if (ready.length === 0) {
      // 不应到达这里（循环依赖在 validate 里检查了）
      break;
    }

    layers.push({
      level: layers.length + 1,
      steps: ready,
      isParallel: ready.length > 1,
    });

    // 移除已处理节点，减少后续节点入度
    for (const s of ready) {
      remaining.delete(s.id);
      for (const [id, depList] of deps) {
        if (depList.includes(s.id)) {
          inDegree.set(id, (inDegree.get(id) ?? 0) - 1);
        }
      }
    }
  }

  return layers;
}

/**
 * 从 role 路径提取可读的角色名
 * engineering/engineering-code-reviewer → 代码审查员
 */
function formatRole(role: string): string {
  // 取最后一段，去掉分类前缀
  const parts = role.split('/');
  const name = parts[parts.length - 1];
  // 去掉重复的分类前缀 (如 engineering-engineering-xxx → engineering-xxx)
  return name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * 生成 workflow 的自然语言解释
 */
export function explainWorkflow(workflow: Pick<WorkflowDefinition, 'name' | 'steps' | 'inputs'>): string {
  const layers = buildLayers(workflow.steps);
  const lines: string[] = [];

  lines.push(`这个工作流「${workflow.name}」执行以下操作：`);
  lines.push('');

  // 输入变量
  if (workflow.inputs && workflow.inputs.length > 0) {
    lines.push('输入变量:');
    for (const input of workflow.inputs) {
      const req = input.required ? '必填' : '可选';
      const desc = input.description ? ` — ${input.description}` : '';
      lines.push(`  • ${input.name} (${req})${desc}`);
    }
    lines.push('');
  }

  // 执行层级
  for (const layer of layers) {
    const parallelTag = layer.isParallel ? '并行' : '顺序';
    lines.push(`第 ${layer.level} 层（${parallelTag}）：`);

    for (const step of layer.steps) {
      const role = formatRole(step.role);
      // 取 task 的第一行作为摘要
      const firstLine = (step.task || '').split('\n')[0].trim();
      const taskSummary = firstLine.slice(0, 60);
      const truncated = firstLine.length > 60 || (step.task || '').includes('\n');
      lines.push(`  • ${step.id} (${role})`);
      if (taskSummary) {
        lines.push(`    ${taskSummary}${truncated ? '...' : ''}`);
      }

      // 标注条件
      if (step.condition) {
        lines.push(`    ⚡ 条件: ${step.condition}`);
      }

      // 标注循环
      if (step.loop) {
        lines.push(`    🔄 循环: 回到 ${step.loop.back_to}，最多 ${step.loop.max_iterations} 轮`);
        lines.push(`    📋 退出条件: ${step.loop.exit_condition}`);
      }
    }
    lines.push('');
  }

  // 汇总
  const totalSteps = workflow.steps.length;
  const maxParallel = layers.length > 0 ? Math.max(...layers.map(l => l.steps.length)) : 0;
  const hasLoop = workflow.steps.some(s => s.loop);
  const hasCondition = workflow.steps.some(s => s.condition);

  lines.push(`总计 ${totalSteps} 个步骤，${layers.length} 层执行，最大并行度 ${maxParallel}。`);
  if (hasLoop) lines.push('包含循环逻辑（部分步骤可能重复执行）。');
  if (hasCondition) lines.push('包含条件分支（部分步骤可能被跳过）。');

  return lines.join('\n');
}
