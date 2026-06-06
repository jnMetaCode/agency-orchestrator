/**
 * agency-orchestrator — 公开 API
 *
 * 使用方式:
 *   import { run, validate, plan } from 'agency-orchestrator';
 */

export { parseWorkflow, validateWorkflow } from './core/parser.js';
export { buildDAG, formatDAG } from './core/dag.js';
export { executeDAG } from './core/executor.js';
export { evaluateCondition } from './core/condition.js';
export { renderTemplate, extractVariables } from './core/template.js';
export { loadAgent, listAgents } from './agents/loader.js';
export { ClaudeConnector } from './connectors/claude.js';
export { OllamaConnector } from './connectors/ollama.js';
export { OpenAICompatibleConnector } from './connectors/openai-compatible.js';
export { createConnector } from './connectors/factory.js';
export { saveResults, loadPreviousContext, findLatestOutput, computeResumeSkipIds } from './output/reporter.js';
export { composeWorkflow, buildRoleCatalog, extractYamlFromResponse } from './cli/compose.js';

export type {
  WorkflowDefinition,
  StepDefinition,
  LLMConfig,
  LLMConnector,
  LLMResult,
  AgentDefinition,
  WorkflowResult,
  StepResult,
  DAGNode,
} from './types.js';
import type { InputDefinition } from './types.js';

/**
 * 计算真正缺失的必填输入：required 且未提供且**无默认值**。
 * 有 default 的 required 输入不算缺失（默认值会填上），否则像 story-creation 这类带
 * default 的旗舰模板 `ao run xxx.yaml` 开箱即跑会被误判为缺参。纯函数，便于测试。
 */
export function findMissingInputs(
  inputs: InputDefinition[] | undefined,
  provided: { has(name: string): boolean },
): InputDefinition[] {
  return (inputs || []).filter(
    def => def.required && !provided.has(def.name) && def.default === undefined
  );
}

/**
 * 弱模型档位提示：质量评测（EVAL_FINDINGS.md）显示多智能体的增益依赖模型能力——
 * 本地小模型上交接链会放大漂移、产出可能不如单次。仅对 ollama（最常见的弱档来源）给一行
 * 软提示，不阻断；返回 null 表示无需提示。设 AO_NO_MODEL_HINT=1 可关闭。
 */
export function modelCapabilityHint(provider: string): string | null {
  if (provider === 'ollama') {
    return '  💡 本地 Ollama：多智能体质量取决于模型能力，小模型(<~30B)可能不如单次 prompt。'
      + '追求质量建议用 DeepSeek/Claude/Gemini 或 70B+ 本地模型（详见 EVAL_FINDINGS.md）。'
      + '（AO_NO_MODEL_HINT=1 关闭）';
  }
  return null;
}

import { parseWorkflow, validateWorkflow } from './core/parser.js';
import { buildDAG, formatDAG } from './core/dag.js';
import { executeDAG, type ExecutorOptions } from './core/executor.js';
import { createConnector } from './connectors/factory.js';
import { loadAgent } from './agents/loader.js';
import { saveResults, printStepResult, printStepRunning, clearRunningLine, printSummary, loadPreviousContext, getCompletedStepIds, findLatestOutput, computeResumeSkipIds, loadStepOutput } from './output/reporter.js';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 一行运行工作流（高级 API）
 */
export async function run(
  workflowPath: string,
  inputs: Record<string, string>,
  options?: {
    outputDir?: string;
    quiet?: boolean;
    /** --watch 模式：终端实时进度 UI */
    watch?: boolean;
    /** resume 目录：从上次运行的输出中加载已完成步骤 */
    resumeDir?: string;
    /** 从指定步骤开始重新执行（跳过之前的步骤） */
    fromStep?: string;
    /**
     * 对话式返工：对 fromStep 步骤注入修改意见，让该专家带着"上一版产出 + 你的意见"
     * 在原稿基础上修改重做。需配合 resumeDir + fromStep 使用。
     */
    feedback?: string;
    /** 覆盖 LLM 配置（例如来自 ao demo） */
    llmOverride?: Partial<import('./types.js').LLMConfig>;
  }
): Promise<import('./types.js').WorkflowResult> {
  const workflow = parseWorkflow(workflowPath);

  // 自动解析 agents_dir
  workflow.agents_dir = resolveAgentsDir(workflow.agents_dir, workflowPath);

  // 校验（agents_dir 已解析为绝对路径，顺带校验 role 真实存在）
  const errors = validateWorkflow(workflow, workflow.agents_dir);
  if (errors.length > 0) {
    throw new Error(`工作流校验失败 / Workflow validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`);
  }

  // 构建 DAG
  const dag = buildDAG(workflow);

  // --feedback 早校验：在创建 connector / 真正执行前就把用法错误说清楚，
  // 避免被"缺少 API key"之类的下游报错掩盖。
  const feedbackTextEarly = options?.feedback?.trim();
  if (feedbackTextEarly) {
    if (!options?.fromStep) {
      throw new Error('--feedback 需要配合 --from <步骤ID> 使用：指定要把意见交给哪个专家返工');
    }
    if (!workflow.steps.some(s => s.id === options.fromStep)) {
      throw new Error(`--from 指定的步骤 "${options.fromStep}" 不存在，无法应用 --feedback`);
    }
  }

  // Apply LLM override (e.g., from ao demo)
  if (options?.llmOverride) {
    Object.assign(workflow.llm, options.llmOverride);
  }

  // 创建 connector
  const connector = createConnector(workflow.llm);

  // 构建输入
  const inputMap = new Map(Object.entries(inputs));

  // Resume: 先把上一次运行的原始输入 + 步骤输出恢复到 inputMap，
  // 这样 --resume --from 不需要用户重复传 -i
  const resumeDir = options?.resumeDir;
  const fromStep = options?.fromStep;
  if (resumeDir) {
    const prevContext = loadPreviousContext(resumeDir);
    for (const [key, value] of prevContext) {
      // 命令行显式传入的 -i 优先，只补全没有的
      if (!inputMap.has(key)) inputMap.set(key, value);
    }
  }

  // 检查必填输入 + 注入默认值。
  const missingInputs = findMissingInputs(workflow.inputs, inputMap);
  if (missingInputs.length > 0) {
    const names = missingInputs.map(i => i.name).join(', ');
    const lines = [
      `缺少必填输入 / Missing required inputs: ${names}`,
      '',
      '请通过 -i 传入（支持多次，支持 @文件 读取） / Pass with -i (repeatable, @file supported):',
    ];
    for (const def of missingInputs) {
      const desc = def.description ? `  # ${def.description}` : '';
      lines.push(`  -i ${def.name}="..."${desc}`);
      lines.push(`  -i ${def.name}=@path/to/file${desc}`);
    }
    throw new Error(lines.join('\n'));
  }
  for (const def of workflow.inputs || []) {
    // 可选输入未提供时使用默认值
    if (!inputMap.has(def.name) && def.default !== undefined) {
      inputMap.set(def.name, def.default);
    }
    // 可选输入无默认值且未提供 → 设为空字符串（避免模板引擎崩溃）
    if (!inputMap.has(def.name)) {
      inputMap.set(def.name, '');
    }
  }

  // Resume: 计算 skipStepIds + 兼容旧 output 变量名
  let skipStepIds: Set<string> | undefined;

  if (resumeDir) {
    // 兼容变量重命名：如果旧 metadata 的 output_var 和新 YAML 的 output 不同，
    // 按 step id 匹配，把旧内容也映射到新变量名
    const metadata = JSON.parse(readFileSync(join(resumeDir, 'metadata.json'), 'utf-8'));
    for (const savedStep of metadata.steps) {
      if (savedStep.status !== 'completed' || !savedStep.output_var) continue;
      const currentStep = workflow.steps.find(s => s.id === savedStep.id);
      if (currentStep?.output && currentStep.output !== savedStep.output_var) {
        const oldValue = inputMap.get(savedStep.output_var);
        if (oldValue && !inputMap.has(currentStep.output)) {
          inputMap.set(currentStep.output, oldValue);
        }
      }
    }

    skipStepIds = computeResumeSkipIds(dag, getCompletedStepIds(resumeDir), fromStep);

    if (!options?.quiet) {
      console.log(`  恢复自: ${resumeDir}`);
      console.log(`  跳过已完成步骤: ${skipStepIds.size} 个`);
      if (fromStep) console.log(`  从步骤 [${fromStep}] 开始重新执行`);
    }
  }

  // 对话式返工：把修改意见 + 上一版产出注入到 fromStep 步骤（用法已在前面早校验）
  let feedbackOption: ExecutorOptions['feedback'];
  if (feedbackTextEarly && fromStep) {
    const previousOutput = resumeDir ? loadStepOutput(resumeDir, fromStep) ?? undefined : undefined;
    feedbackOption = { stepId: fromStep, text: feedbackTextEarly, previousOutput };
    if (!options?.quiet) {
      console.log(`  💬 已向步骤 [${fromStep}] 提交修改意见${previousOutput ? '（含上一版产出）' : ''}`);
    }
  }

  // 执行
  let stepCounter = 0;
  const totalSteps = workflow.steps.length;
  const quiet = options?.quiet ?? false;
  const useWatch = options?.watch ?? false;

  // --watch 模式：使用终端 UI 渲染器
  let watchCallback: ((event: import('./cli/watch.js').ProgressEvent) => void) | undefined;
  if (useWatch) {
    const { createWatchRenderer } = await import('./cli/watch.js');
    watchCallback = createWatchRenderer(
      workflow.name,
      workflow.steps.map(s => s.id),
      workflow.steps.map(s => s.role),
    );
  }

  if (!quiet && !useWatch) {
    console.log(`\n  工作流: ${workflow.name}`);
    const isCLI = workflow.llm.provider.endsWith('-cli') || workflow.llm.provider === 'claude-code';
    const displayConcurrency = isCLI ? 1 : (workflow.concurrency || 2);
    console.log(`  步骤数: ${totalSteps} | 并发: ${displayConcurrency}${isCLI && (workflow.concurrency || 2) > 1 ? '（CLI 模式自动串行）' : ''} | 模型: ${workflow.llm.model || workflow.llm.provider}`);
    if (!process.env.AO_NO_MODEL_HINT) {
      const hint = modelCapabilityHint(workflow.llm.provider);
      if (hint) console.log(hint);
    }

    // 显示参与者阵容（步骤级 name/emoji 优先）
    const seen = new Map<string, string>();  // name → emoji
    for (const step of workflow.steps) {
      try {
        const agent = loadAgent(workflow.agents_dir, step.role);
        const name = step.name || agent.name;
        const emoji = step.emoji || agent.emoji || '🤖';
        if (!seen.has(name)) {
          seen.set(name, emoji);
        }
      } catch { /* 校验阶段已检查 */ }
    }
    if (seen.size > 0) {
      console.log(`  参与者: ${Array.from(seen.entries()).map(([n, e]) => `${e} ${n}`).join(' | ')}`);
    }

    console.log('─'.repeat(50));
  }

  const result = await executeDAG(dag, {
    connector,
    agentsDir: workflow.agents_dir,
    llmConfig: workflow.llm,
    concurrency: workflow.concurrency || 2,
    inputs: inputMap,
    skipStepIds,
    feedback: feedbackOption,
    onBatchStart: quiet ? undefined : useWatch ? (nodes) => {
      for (const node of nodes) {
        watchCallback!({ type: 'step_start', stepId: node.step.id, role: node.step.role, total: totalSteps, completed: stepCounter });
      }
    } : (nodes) => {
      printStepRunning(nodes);
    },
    onBatchComplete: quiet ? undefined : useWatch ? (nodes) => {
      for (const node of nodes) {
        stepCounter++;
        const elapsed = node.endTime && node.startTime ? node.endTime - node.startTime : undefined;
        const type = node.status === 'skipped' ? 'step_skip' : node.status === 'failed' ? 'step_error' : 'step_done';
        watchCallback!({ type, stepId: node.step.id, role: node.step.role, elapsed, total: totalSteps, completed: stepCounter });
      }
    } : (nodes) => {
      clearRunningLine();
      for (const node of nodes) {
        stepCounter++;
        printStepResult(node, stepCounter, totalSteps);
      }
    },
  } satisfies ExecutorOptions);

  result.name = workflow.name;
  // 保存原始用户输入，便于 --resume 下次恢复
  result.inputs = Object.fromEntries(
    Array.from(inputMap.entries()).filter(([k]) =>
      (workflow.inputs || []).some(i => i.name === k)
    )
  );

  // 保存结果
  const outputDir = options?.outputDir || 'ao-output';
  const outputPath = saveResults(result, outputDir);

  if (!quiet) {
    printSummary(result, outputPath, workflowPath);
  }

  return result;
}

/**
 * 自动查找 agents 目录
 * 优先级：YAML 中指定的路径 → 相对于 workflow 文件 → 常见位置
 */
/**
 * 在常见位置查找角色库目录；找到返回绝对路径，找不到返回 null（不抛错）。
 * 供 validate/plan 等只读路径做"best-effort role 校验"复用。
 */
export function findAgentsDir(agentsDir: string, workflowPath: string): string | null {
  // 1. 如果 YAML 中指定的路径存在，直接用
  const absolute = resolve(agentsDir);
  if (existsSync(absolute)) return absolute;

  // 2. 相对于 workflow 文件所在目录
  const relToWorkflow = resolve(dirname(workflowPath), agentsDir);
  if (existsSync(relToWorkflow)) return relToWorkflow;

  // 3. 按用户指定的 agents_dir 名字，在常见位置查找同名目录
  // （尊重用户意图：指定 "agency-agents" 不会 fallback 到 "agency-agents-zh"）
  const baseName = agentsDir.replace(/[\/\\]+$/, '').split(/[\/\\]/).pop() || agentsDir;
  // Windows: 必须用 fileURLToPath，不能用 new URL(url).pathname，
  // 否则会得到 "/C:/Users/..." 非法路径，所有 scriptDir 相关候选都失效
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const sameNameCandidates = [
    resolve(baseName),
    resolve('..', baseName),
    resolve('node_modules', baseName),
    // 包内置：agency-agents/ 与 dist/ 同级（随 npm 包一起分发）
    resolve(scriptDir, '..', baseName),
    // 包依赖：agency-agents-zh 等通过 dependencies 装到 node_modules
    resolve(scriptDir, '..', 'node_modules', baseName),
    resolve(scriptDir, '../../node_modules', baseName),
  ];
  for (const dir of sameNameCandidates) {
    if (existsSync(dir)) return dir;
  }
  return null;
}

function resolveAgentsDir(agentsDir: string, workflowPath: string): string {
  const found = findAgentsDir(agentsDir, workflowPath);
  if (found) return found;

  const baseName = agentsDir.replace(/[\/\\]+$/, '').split(/[\/\\]/).pop() || agentsDir;
  // 找不到用户指定的目录 → 明确报错（不再静默回退到另一语言版本，
  // 否则英文工作流会在中文角色库上跑，用户得到中文角色名一脸懵）
  const initCmd = baseName === 'agency-agents' ? 'ao init --lang en'
                : baseName === 'agency-agents-zh' ? 'ao init'
                : `ao init  # 或手动准备目录: ${agentsDir}`;
  throw new Error(
    [
      `找不到角色库目录 "${baseName}" / Role library "${baseName}" not found`,
      ``,
      `  请先运行 / Please run: ${initCmd}`,
      ``,
      `已搜索位置 / Searched:`,
      `  - ${resolve(agentsDir)}`,
      `  - ${resolve(dirname(workflowPath), agentsDir)}`,
      `  - ${resolve('..', baseName)}`,
      `  - ${resolve('node_modules', baseName)}`,
    ].join('\n')
  );
}
