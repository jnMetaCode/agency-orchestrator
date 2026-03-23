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
export { saveResults } from './output/reporter.js';

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

import { parseWorkflow, validateWorkflow } from './core/parser.js';
import { buildDAG, formatDAG } from './core/dag.js';
import { executeDAG, type ExecutorOptions } from './core/executor.js';
import { ClaudeConnector } from './connectors/claude.js';
import { OllamaConnector } from './connectors/ollama.js';
import { OpenAICompatibleConnector } from './connectors/openai-compatible.js';
import { saveResults, printStepResult, printStepRunning, clearRunningLine, printSummary } from './output/reporter.js';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { LLMConnector } from './types.js';

/**
 * 一行运行工作流（高级 API）
 */
export async function run(
  workflowPath: string,
  inputs: Record<string, string>,
  options?: { outputDir?: string; quiet?: boolean }
): Promise<import('./types.js').WorkflowResult> {
  const workflow = parseWorkflow(workflowPath);

  // 自动解析 agents_dir
  workflow.agents_dir = resolveAgentsDir(workflow.agents_dir, workflowPath);

  // 校验
  const errors = validateWorkflow(workflow);
  if (errors.length > 0) {
    throw new Error(`工作流校验失败:\n${errors.map(e => `  - ${e}`).join('\n')}`);
  }

  // 构建 DAG
  const dag = buildDAG(workflow);

  // 创建 connector
  let connector: LLMConnector;
  switch (workflow.llm.provider) {
    case 'claude':
      connector = new ClaudeConnector(workflow.llm.api_key);
      break;
    case 'ollama':
      connector = new OllamaConnector(workflow.llm.base_url);
      break;
    case 'deepseek':
      connector = new OpenAICompatibleConnector({
        apiKey: workflow.llm.api_key || process.env.DEEPSEEK_API_KEY,
        baseUrl: workflow.llm.base_url || 'https://api.deepseek.com/v1',
      });
      break;
    case 'openai':
      connector = new OpenAICompatibleConnector({
        apiKey: workflow.llm.api_key || process.env.OPENAI_API_KEY,
        baseUrl: workflow.llm.base_url || 'https://api.openai.com/v1',
      });
      break;
    default:
      throw new Error(`暂不支持 provider: ${workflow.llm.provider}（支持 claude / deepseek / openai / ollama）`);
  }

  // 构建输入
  const inputMap = new Map(Object.entries(inputs));

  // 检查必填输入 + 注入默认值
  for (const def of workflow.inputs || []) {
    if (def.required && !inputMap.has(def.name)) {
      throw new Error(`缺少必填输入: ${def.name}`);
    }
    // 可选输入未提供时使用默认值
    if (!inputMap.has(def.name) && def.default !== undefined) {
      inputMap.set(def.name, def.default);
    }
    // 可选输入无默认值且未提供 → 设为空字符串（避免模板引擎崩溃）
    if (!inputMap.has(def.name)) {
      inputMap.set(def.name, '');
    }
  }

  // 执行
  let stepCounter = 0;
  const totalSteps = workflow.steps.length;
  const quiet = options?.quiet ?? false;

  if (!quiet) {
    console.log(`\n  工作流: ${workflow.name}`);
    console.log(`  步骤数: ${totalSteps} | 并发: ${workflow.concurrency} | 模型: ${workflow.llm.model}`);
    console.log('─'.repeat(50));
  }

  const result = await executeDAG(dag, {
    connector,
    agentsDir: workflow.agents_dir,
    llmConfig: workflow.llm,
    concurrency: workflow.concurrency || 2,
    inputs: inputMap,
    onBatchStart: quiet ? undefined : (nodes) => {
      printStepRunning(nodes);
    },
    onBatchComplete: quiet ? undefined : (nodes) => {
      clearRunningLine();
      for (const node of nodes) {
        stepCounter++;
        printStepResult(node, stepCounter, totalSteps);
      }
    },
  } satisfies ExecutorOptions);

  result.name = workflow.name;

  // 保存结果
  const outputDir = options?.outputDir || '.ao-output';
  const outputPath = saveResults(result, outputDir);

  if (!quiet) {
    printSummary(result, outputPath);
  }

  return result;
}

/**
 * 自动查找 agents 目录
 * 优先级：YAML 中指定的路径 → 相对于 workflow 文件 → 常见位置
 */
function resolveAgentsDir(agentsDir: string, workflowPath: string): string {
  // 1. 如果 YAML 中指定的路径存在，直接用
  const absolute = resolve(agentsDir);
  if (existsSync(absolute)) return absolute;

  // 2. 相对于 workflow 文件所在目录
  const relToWorkflow = resolve(dirname(workflowPath), agentsDir);
  if (existsSync(relToWorkflow)) return relToWorkflow;

  // 3. 常见位置（包括 npm 依赖自带的）
  const candidates = [
    resolve('agency-agents-zh'),
    resolve('../agency-agents-zh'),
    resolve('node_modules/agency-agents-zh'),
    resolve(dirname(new URL(import.meta.url).pathname), '../../node_modules/agency-agents-zh'),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }

  // 找不到就返回原值，让后续报错
  return agentsDir;
}
