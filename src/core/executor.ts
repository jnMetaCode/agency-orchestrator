/**
 * DAG 执行引擎 — 核心调度器
 */
import type {
  WorkflowDefinition,
  DAGNode,
  LLMConnector,
  LLMConfig,
  WorkflowResult,
  StepResult,
} from '../types.js';
import type { DAG } from './dag.js';
import { renderTemplate } from './template.js';
import { evaluateCondition } from './condition.js';
import { loadAgent } from '../agents/loader.js';
import { createInterface } from 'node:readline';

export interface ExecutorOptions {
  connector: LLMConnector;
  agentsDir: string;
  llmConfig: LLMConfig;
  concurrency: number;
  inputs: Map<string, string>;
  /** 每步完成的回调 */
  onStepComplete?: (node: DAGNode) => void;
  onStepStart?: (node: DAGNode) => void;
  /** 一批并行步骤开始前的回调 */
  onBatchStart?: (nodes: DAGNode[]) => void;
  /** 一批并行步骤全部完成后的回调（按顺序） */
  onBatchComplete?: (nodes: DAGNode[]) => void;
}

export async function executeDAG(dag: DAG, options: ExecutorOptions): Promise<WorkflowResult> {
  const {
    connector,
    agentsDir,
    llmConfig,
    concurrency,
    inputs,
    onStepComplete,
    onStepStart,
  } = options;

  // 变量上下文：inputs + 每步的 output
  const context = new Map(inputs);
  const startTime = Date.now();
  const stepResults: StepResult[] = [];

  const timeout = llmConfig.timeout || 120_000;
  const maxRetry = llmConfig.retry ?? 3;

  const loopIterations = new Map<string, number>();
  const hasLoops = Array.from(dag.nodes.values()).some(n => n.step.loop);
  if (hasLoops) {
    context.set('_loop_iteration', '1');
  }

  let levelIndex = 0;
  while (levelIndex < dag.levels.length) {
    // 同层节点可并行，但受 concurrency 限制
    const { onBatchStart, onBatchComplete } = options;
    const allTasks = dag.levels[levelIndex].map(id => dag.nodes.get(id)!);

    // 过滤掉已被标记为 skipped 的节点
    const tasks = allTasks.filter(node => {
      if (node.status === 'skipped') {
        node.endTime = Date.now();
        node.startTime = node.endTime;
        const iterCount = loopIterations.get(node.step.id) || 0;
        upsertStepResult(stepResults, {
          id: node.step.id,
          role: node.step.role,
          status: 'skipped',
          duration: 0,
          tokens: { input: 0, output: 0 },
          iterations: iterCount > 0 ? iterCount + 1 : undefined,
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
          // 标记所有下游为 skipped
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
    for (const id of dag.levels[levelIndex]) {
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

  const totalDuration = Date.now() - startTime;
  const totalTokens = stepResults.reduce(
    (acc, s) => ({
      input: acc.input + s.tokens.input,
      output: acc.output + s.tokens.output,
    }),
    { input: 0, output: 0 }
  );

  return {
    name: '',  // 由调用方填充
    success: stepResults.every(s => s.status !== 'failed'),
    steps: stepResults,
    totalDuration,
    totalTokens,
  };
}

async function executeStep(
  node: DAGNode,
  opts: {
    connector: LLMConnector;
    agentsDir: string;
    llmConfig: LLMConfig;
    context: Map<string, string>;
    timeout: number;
    maxRetry: number;
    onStepStart?: (node: DAGNode) => void;
  }
): Promise<string> {
  node.status = 'running';
  node.startTime = Date.now();
  opts.onStepStart?.(node);

  // 条件检查
  if (node.step.condition) {
    const conditionMet = evaluateCondition(node.step.condition, opts.context);
    if (!conditionMet) {
      node.status = 'skipped';
      return '';  // 返回空，调用方会处理 skipped 状态
    }
  }

  // 人工审批节点
  if (node.step.type === 'approval') {
    return await handleApproval(node, opts.context);
  }

  // 加载角色定义
  const agent = loadAgent(opts.agentsDir, node.step.role);
  const systemPrompt = agent.systemPrompt;

  // 渲染任务模板
  const userMessage = renderTemplate(node.step.task, opts.context);

  // 带重试的 LLM 调用
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= opts.maxRetry; attempt++) {
    try {
      const result = await withTimeout(
        opts.connector.chat(systemPrompt, userMessage, opts.llmConfig),
        opts.timeout
      );
      node.tokenUsage = { input: result.usage.input_tokens, output: result.usage.output_tokens };
      return result.content;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < opts.maxRetry && isRetryable(lastError)) {
        // 指数退避: 1s, 2s, 4s
        await sleep(1000 * Math.pow(2, attempt));
        continue;
      }
    }
  }

  throw lastError || new Error(`step "${node.step.id}" 执行失败`);
}

async function handleApproval(
  node: DAGNode,
  context: Map<string, string>
): Promise<string> {
  const prompt = node.step.prompt
    ? renderTemplate(node.step.prompt, context)
    : '请确认是否继续 (yes/no):';

  // 如果有 input 引用，先显示内容
  if (node.step.task) {
    const content = renderTemplate(node.step.task, context);
    console.log('\n' + content);
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`\n⏸️  ${prompt} `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function markDownstreamSkipped(dag: DAG, failedId: string): void {
  const node = dag.nodes.get(failedId);
  if (!node) return;
  for (const depId of node.dependents) {
    const depNode = dag.nodes.get(depId);
    if (!depNode || depNode.status !== 'pending') continue;

    if (depNode.step.depends_on_mode === 'any_completed') {
      // 只有当所有依赖都是 skipped 或 failed 时才跳过
      const allDepsSkippedOrFailed = depNode.dependencies.every(d => {
        const dNode = dag.nodes.get(d);
        return dNode && (dNode.status === 'skipped' || dNode.status === 'failed');
      });
      if (!allDepsSkippedOrFailed) continue; // 还有依赖未决或已完成，暂不跳过
    }

    depNode.status = 'skipped';
    markDownstreamSkipped(dag, depId);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`超时 (${ms}ms)`)), ms);
    promise
      .then(val => { clearTimeout(timer); resolve(val); })
      .catch(err => { clearTimeout(timer); reject(err); });
  });
}

function isRetryable(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return msg.includes('429') || msg.includes('rate') ||
         msg.includes('500') || msg.includes('502') ||
         msg.includes('503') || msg.includes('timeout') ||
         msg.includes('econnreset');
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** 按 step id 覆盖或插入 stepResult（循环场景用覆盖策略） */
function upsertStepResult(results: StepResult[], entry: StepResult): void {
  const idx = results.findIndex(r => r.id === entry.id);
  if (idx >= 0) {
    results[idx] = entry;
  } else {
    results.push(entry);
  }
}
