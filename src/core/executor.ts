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
import { createConnector } from '../connectors/factory.js';
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
  /** resume 模式: 跳过这些步骤（使用 context 中已有的输出） */
  skipStepIds?: Set<string>;
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

  const isCLI = llmConfig.provider.endsWith('-cli') || llmConfig.provider === 'claude-code';
  const isLocal = llmConfig.provider === 'ollama';
  const timeout = llmConfig.timeout || (isCLI ? 600_000 : isLocal ? 600_000 : 120_000);
  const maxRetry = llmConfig.retry ?? 5;

  // CLI provider 强制串行：共享同一账户额度，并发会触发限速反而更慢
  const effectiveConcurrency = isCLI ? 1 : concurrency;

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

    // 过滤掉已被标记为 skipped 的节点 和 resume 跳过的节点
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
      // resume 模式：跳过已有输出的步骤
      if (options.skipStepIds?.has(node.step.id)) {
        node.status = 'completed';
        node.result = node.step.output ? context.get(node.step.output) : undefined;
        node.startTime = Date.now();
        node.endTime = node.startTime;
        upsertStepResult(stepResults, {
          id: node.step.id,
          role: node.step.role,
          status: 'completed',
          output: node.result,
          output_var: node.step.output,
          duration: 0,
          tokens: { input: 0, output: 0 },
        });
        onStepComplete?.(node);
        return false;
      }
      return true;
    });

    // 按 effectiveConcurrency 分批执行
    for (let i = 0; i < tasks.length; i += effectiveConcurrency) {
      const batch = tasks.slice(i, i + effectiveConcurrency);

      // 预加载角色名和 emoji，让 onBatchStart 能显示（步骤级配置优先）
      for (const node of batch) {
        if (!node.agentName && node.step.role) {
          try {
            const agentInfo = loadAgent(agentsDir, node.step.role);
            node.agentName = node.step.name || agentInfo.name;
            node.agentEmoji = node.step.emoji || agentInfo.emoji;
          } catch { /* executeStep 里会再加载并报错 */ }
        }
      }

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
          agentName: node.agentName,
          agentEmoji: node.agentEmoji,
          status: node.status as StepResult['status'],
          output: node.result,
          output_var: node.step.output,
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
        const maxIter = Math.min(loop.max_iterations, 50); // 安全上限 50（防止无限循环）

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

  // 条件检查（变量未定义等异常视为条件不满足，跳过而非崩溃）
  if (node.step.condition) {
    let conditionMet = false;
    try {
      conditionMet = evaluateCondition(node.step.condition, opts.context);
    } catch {
      process.stderr.write(`\n  ⚠️  ${node.step.id} 条件评估失败: ${node.step.condition}，跳过该步骤\n`);
    }
    if (!conditionMet) {
      node.status = 'skipped';
      return '';  // 返回空，调用方会处理 skipped 状态
    }
  }

  // 人工审批节点
  if (node.step.type === 'approval') {
    return await handleApproval(node, opts.context);
  }

  // 加载角色定义（步骤级 name/emoji 优先）
  const agent = loadAgent(opts.agentsDir, node.step.role);
  node.agentName = node.step.name || agent.name;
  node.agentEmoji = node.step.emoji || agent.emoji;
  const systemPrompt = agent.systemPrompt;

  // 渲染任务模板
  const userMessage = renderTemplate(node.step.task, opts.context);

  // 步骤级 LLM 配置覆盖
  const stepLlm = node.step.llm;
  const effectiveConfig: LLMConfig = stepLlm
    ? { ...opts.llmConfig, ...stepLlm } as LLMConfig
    : opts.llmConfig;
  // connector 把 api_key / base_url 存在构造时的私有字段，chat(config) 不会再读
  // 所以 step 级覆盖任一凭证字段时必须重建 connector
  const needsNewConnector = !!(stepLlm && (
    (stepLlm.provider && stepLlm.provider !== opts.llmConfig.provider) ||
    stepLlm.base_url !== undefined ||
    stepLlm.api_key !== undefined
  ));
  const effectiveConnector = needsNewConnector ? createConnector(effectiveConfig) : opts.connector;

  // timeout / retry / CLI 判定必须基于 effectiveConfig，否则 step 级覆盖这几个字段时会被全局值吃掉
  const effectiveIsCLI = effectiveConfig.provider.endsWith('-cli') || effectiveConfig.provider === 'claude-code';
  const effectiveIsLocal = effectiveConfig.provider === 'ollama';
  // timeout 策略：
  // - 用户显式设置（含 timeout: 0 表示不限时）→ 第一次按此值
  // - 未设置 → provider 默认（API 120s / CLI/ollama 600s）
  // - 因超时触发 retry 时，下一轮 timeout x1.5（上限 900s）
  //   非超时类错误（429/500/ECONNRESET 等）保持原 timeout，避免无谓放大
  const defaultTimeout = effectiveIsCLI ? 600_000 : effectiveIsLocal ? 600_000 : 120_000;
  const baseTimeout = effectiveConfig.timeout !== undefined ? effectiveConfig.timeout : defaultTimeout;
  const effectiveMaxRetry = effectiveConfig.retry ?? opts.maxRetry;
  const TIMEOUT_CAP = 900_000;

  // 带重试的 LLM 调用（timeout 在网络超时类错误重试时自动延长）
  let lastError: Error | null = null;
  let attemptTimeout = baseTimeout;
  for (let attempt = 0; attempt <= effectiveMaxRetry; attempt++) {
    try {
      // attemptTimeout 同时传给 connector（控制内层 fetch/CLI timeout）和 withTimeout（外层兜底），
      // 否则 connector 内部还按旧 timeout 硬断，递增就白加了
      const attemptConfig = { ...effectiveConfig, timeout: attemptTimeout };
      const result = await withTimeout(
        effectiveConnector.chat(systemPrompt, userMessage, attemptConfig),
        attemptTimeout
      );
      node.tokenUsage = { input: result.usage.input_tokens, output: result.usage.output_tokens };
      return result.content;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < effectiveMaxRetry && isRetryable(lastError)) {
        const errorClass = classifyError(lastError);
        // connection 类错误（超时/ECONNRESET/aborted/socket hang up 等）→ 下一次 timeout x1.5
        // 上限 900s，0=不限时保持不变，rate_limit / server_error 保持原值避免无谓放大
        let nextTimeout = attemptTimeout;
        if (errorClass === 'connection' && attemptTimeout > 0 && attemptTimeout < TIMEOUT_CAP) {
          nextTimeout = Math.min(Math.round(attemptTimeout * 1.5), TIMEOUT_CAP);
        }
        // 分级退避：rate_limit 最长，connection 中等，server_error 最短
        const baseByClass = effectiveIsCLI
          ? { rate_limit: 15_000, connection: 10_000, server_error: 5_000 }
          : { rate_limit: 5_000,  connection: 2_000,  server_error: 1_000 };
        const base = baseByClass[errorClass as keyof typeof baseByClass] || 1_000;
        const jitter = Math.random() * 0.3;  // 0-30% 抖动，防止并发步骤同时重试
        const delay = Math.round(base * Math.pow(2, attempt) * (1 + jitter));
        const extendHint = nextTimeout !== attemptTimeout
          ? `（timeout 延长至 ${Math.round(nextTimeout / 1000)}s）`
          : '';
        process.stderr.write(`\n  ⚠️  ${node.step.id} 失败 (${lastError.message.slice(0, 80)})，${Math.round(delay / 1000)}s 后重试${extendHint} (${attempt + 1}/${effectiveMaxRetry})...\n`);
        attemptTimeout = nextTimeout;
        await sleep(delay);
        continue;
      }
      break;  // 不可重试的错误，立即停止
    }
  }

  // 重试全部耗尽：检查是否有部分内容可兜底
  if (lastError && (lastError as any).partialContent) {
    const partial = (lastError as any).partialContent as string;
    process.stderr.write(`\n  ⚠️  ${node.step.id} 重试耗尽，使用部分结果 (${partial.length} 字符)\n`);
    return partial;
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
  if (!ms) return promise;  // 0 = 不限时（CLI provider 写完自动停）
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`超时 (${ms}ms)，可用 --timeout 或 YAML llm.timeout 延长`)),
      ms
    );
    promise
      .then(val => { clearTimeout(timer); resolve(val); })
      .catch(err => { clearTimeout(timer); reject(err); });
  });
}

/** 错误分级：不同错误类型使用不同退避策略（借鉴 Claude Code 架构） */
function classifyError(error: Error): 'rate_limit' | 'server_error' | 'connection' | 'non_retryable' {
  const msg = error.message.toLowerCase();
  // 限速：需要更长退避。用 \b 边界匹配，避免 "1429ms" / "429 ids" 等子串误判
  if (/\b429\b/.test(msg) || msg.includes('rate'))
    return 'rate_limit';
  // 服务端错误：短退避即可。5xx 状态码用 \b 边界匹配，避免 "500ms" / "450000ms" 等误判
  if (/\b5\d\d\b/.test(msg) || msg.includes('api 错误'))
    return 'server_error';
  // 连接断开/超时：中等退避（"超时"识别中文 withTimeout 抛出的消息）
  if (msg.includes('econnreset') || msg.includes('econnrefused') ||
      msg.includes('etimedout') || msg.includes('socket hang up') ||
      msg.includes('terminated') || msg.includes('aborted') ||
      msg.includes('timeout') || msg.includes('超时'))
    return 'connection';
  return 'non_retryable';
}

function isRetryable(error: Error): boolean {
  return classifyError(error) !== 'non_retryable';
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
