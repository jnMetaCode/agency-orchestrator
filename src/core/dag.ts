/**
 * DAG 构建和拓扑排序
 */
import type { WorkflowDefinition, DAGNode } from '../types.js';
import { t } from '../i18n.js';

export interface DAG {
  nodes: Map<string, DAGNode>;
  /** 拓扑排序后的执行层级，每层内的节点可并行 */
  levels: string[][];
}

/**
 * 从 WorkflowDefinition 构建 DAG
 */
export function buildDAG(workflow: WorkflowDefinition): DAG {
  const nodes = new Map<string, DAGNode>();

  // 创建所有节点
  for (const step of workflow.steps) {
    nodes.set(step.id, {
      step,
      dependencies: step.depends_on || [],
      dependents: [],
      status: 'pending',
    });
  }

  // 构建反向依赖（谁依赖我）
  for (const [id, node] of nodes) {
    for (const dep of node.dependencies) {
      const depNode = nodes.get(dep);
      if (!depNode) {
        throw new Error(`step "${id}" 依赖不存在的 step: "${dep}"`);
      }
      depNode.dependents.push(id);
    }
  }

  // 拓扑排序 — 按层分组（同层可并行）
  const levels = topologicalLevels(nodes);

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
      // 光在更早的层级还不够，必须真的是**依赖链上的祖先**。回跳只重置「back_to 的后代 ∩ 循环节点的祖先」，
      // back_to 是不相干的旁支时这个交集是空的：什么都不重跑，循环空转到 max_iterations，最后报一句
      // 「循环达上限」——用户看到的是"审了 3 轮都没过"，实际一轮都没改。
      const ancestors = new Set<string>();
      const stack = [...(nodes.get(step.id)?.dependencies ?? [])];
      while (stack.length) {
        const cur = stack.pop()!;
        if (ancestors.has(cur)) continue;
        ancestors.add(cur);
        stack.push(...(nodes.get(cur)?.dependencies ?? []));
      }
      if (!ancestors.has(step.loop.back_to)) {
        throw new Error(`step "${step.id}" 的 loop.back_to "${step.loop.back_to}" 不在它的依赖链上——回跳只会重跑两者之间的步骤，所以 back_to 必须是 "${step.id}" 直接或间接 depends_on 的步骤`);
      }
    }
  }

  return { nodes, levels };
}

/**
 * 拓扑排序，返回执行层级
 * 每个层级内的节点互不依赖，可并行执行
 *
 * 例如:
 *   A → B → D
 *   A → C → D
 * 结果: [[A], [B, C], [D]]
 */
function topologicalLevels(nodes: Map<string, DAGNode>): string[][] {
  const inDegree = new Map<string, number>();
  for (const [id, node] of nodes) {
    inDegree.set(id, node.dependencies.length);
  }

  const levels: string[][] = [];
  const remaining = new Set(nodes.keys());

  while (remaining.size > 0) {
    // 找出当前入度为 0 的节点
    const currentLevel: string[] = [];
    for (const id of remaining) {
      if (inDegree.get(id) === 0) {
        currentLevel.push(id);
      }
    }

    if (currentLevel.length === 0) {
      throw new Error('工作流存在循环依赖，无法拓扑排序');
    }

    // 移除本层节点，更新入度
    for (const id of currentLevel) {
      remaining.delete(id);
      const node = nodes.get(id)!;
      for (const dep of node.dependents) {
        inDegree.set(dep, inDegree.get(dep)! - 1);
      }
    }

    levels.push(currentLevel);
  }

  return levels;
}

/**
 * 格式化 DAG 为可读文本（用于 `ao plan` 命令）
 */
export function formatDAG(dag: DAG): string {
  const lines: string[] = [`${t('dag.title')}\n`];

  for (let i = 0; i < dag.levels.length; i++) {
    const level = dag.levels[i];
    const parallel = level.length > 1;

    for (let j = 0; j < level.length; j++) {
      const node = dag.nodes.get(level[j])!;
      const step = node.step;
      const prefix = parallel ? (j === 0 ? '┌' : j === level.length - 1 ? '└' : '├') : '→';
      const tag = parallel ? t('dag.parallel') : '';

      lines.push(`  ${t('dag.layer', { n: i + 1 })} ${prefix} [${step.id}] ${step.role || step.type}${tag}`);

      if (node.dependencies.length > 0) {
        lines.push(`         ${t('dag.deps')}: ${node.dependencies.join(', ')}`);
      }
      if (step.condition) {
        lines.push(`         ${t('dag.condition')}: ${step.condition}`);
      }
      if (step.loop) {
        lines.push(`         ${t('dag.loop', { to: step.loop.back_to, n: step.loop.max_iterations })}`);
      }
    }
    if (i < dag.levels.length - 1) lines.push('  │');
  }

  return lines.join('\n');
}
