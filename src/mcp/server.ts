/**
 * MCP Server — 通过 MCP 协议暴露工作流操作
 *
 * 6 个工具，每个都是对现有函数的薄封装。
 * 传输层: StdioServerTransport (stdin/stdout JSON-RPC)
 *
 * 重要: 所有日志必须输出到 stderr，stdout 是 MCP 协议通道。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolve, relative, dirname, join } from 'node:path';
import { aoUserDir, defaultOutputDir, defaultWorkflowsDir } from '../utils/paths.js';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';

import { run, finalOutput } from '../index.js';
import { parseWorkflow, validateWorkflow } from '../core/parser.js';
import { buildDAG, formatDAG } from '../core/dag.js';
import { listAgents } from '../agents/loader.js';
import { composeWorkflow } from '../cli/compose.js';
import { CLI_PROVIDER_IDS, isCliProvider, pickAutoProvider } from '../providers/detect.js';
import { CLAUDE_DEFAULT_MODEL, API_PROVIDERS, API_PROVIDER_MAP, ANTHROPIC_PROVIDERS } from '../connectors/api-providers.js';

/**
 * run_workflow 可选的 provider。此前是手抄的一份：CLI 那半和别处一样，API 那半却只有
 * deepseek / claude / openai 三家——引擎支持的其余二十来家，经 MCP 一律被参数校验拒掉。
 * 现在从注册表生成，新接一家不用再记得来改这里。
 */
const MCP_PROVIDER_IDS = [...new Set([
  ...CLI_PROVIDER_IDS, 'claude', 'ollama',
  ...API_PROVIDERS.map((p) => p.id), ...ANTHROPIC_PROVIDERS.map((p) => p.id),
])] as [string, ...string[]];

/**
 * MCP 宿主的 cwd 不由用户决定（Claude Desktop 一类常以 `/` 启动），所以产物不能按 cwd 相对落盘：
 * 真机上 cwd=/ 时，工作流跑完 21.9 秒才在存档那一步报 `mkdir 'ao-output/…'` 失败，产物全丢。
 * 显式配了 AO_OUTPUT_DIR / AO_WORKFLOWS_DIR / AO_HOME 就听用户的，否则落到用户级的 ~/.ao 下
 * （teams / prompts / roles 本来就住那儿）。
 */
export function mcpOutputDir(): string {
  if (process.env.AO_OUTPUT_DIR || process.env.AO_HOME) return defaultOutputDir();
  return join(aoUserDir(), 'ao-output');
}
export function mcpWorkflowsDir(): string {
  if (process.env.AO_WORKFLOWS_DIR || process.env.AO_HOME) return defaultWorkflowsDir('ao-workflows');
  return join(aoUserDir(), 'ao-workflows');
}

/** 自动查找 agents 目录 */
function findAgentsDir(hint?: string): string {
  if (hint && existsSync(resolve(hint))) return resolve(hint);
  const candidates = [
    resolve('agency-agents-zh'),
    resolve('agency-agents'),
    resolve('../agency-agents-zh'),
    resolve('../agency-agents'),
    resolve('agents'),
    resolve('node_modules/agency-agents-zh'),
    resolve('node_modules/agency-agents'),
    // Windows: 必须用 fileURLToPath，不能用 new URL(url).pathname（会得到 "/C:/..." 非法路径）
    resolve(dirname(fileURLToPath(import.meta.url)), '../../node_modules/agency-agents-zh'),
    resolve(dirname(fileURLToPath(import.meta.url)), '../../node_modules/agency-agents'),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return resolve(hint || './agency-agents-zh');
}

/** 递归查找 YAML 文件 */
function findYamlFiles(dir: string, result: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      findYamlFiles(full, result);
    } else if (entry.endsWith('.yaml') || entry.endsWith('.yml')) {
      result.push(full);
    }
  }
}

/** 列出 workflows 目录下的 YAML 文件 */
function discoverWorkflows(): Array<{ file: string; name: string; description: string }> {
  const workflowsDir = resolve('workflows');
  if (!existsSync(workflowsDir)) return [];

  const files: string[] = [];
  findYamlFiles(workflowsDir, files);

  return files.map(f => {
    try {
      const content = readFileSync(f, 'utf-8');
      const doc = yaml.load(content) as Record<string, unknown>;
      return {
        file: relative(process.cwd(), f),
        name: (doc?.name as string) || '(unnamed)',
        description: (doc?.description as string) || '',
      };
    } catch {
      return { file: relative(process.cwd(), f), name: '(parse error)', description: '' };
    }
  });
}

/**
 * 静默执行函数 — 临时屏蔽 stdout 输出（引用计数，并发安全）
 * composeWorkflow 等函数内部有 console.log，会污染 MCP 协议通道
 */
let suppressCount = 0;
let origStdoutWrite: typeof process.stdout.write | null = null;

async function silentCall<T>(fn: () => Promise<T>): Promise<T> {
  if (suppressCount === 0) {
    origStdoutWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = () => true;
  }
  suppressCount++;
  try {
    return await fn();
  } finally {
    suppressCount--;
    if (suppressCount === 0 && origStdoutWrite) {
      process.stdout.write = origStdoutWrite;
      origStdoutWrite = null;
    }
  }
}

export async function startServer(verbose = false): Promise<void> {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve('../../package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

  const server = new McpServer({
    name: 'agency-orchestrator',
    version: pkg.version || '0.0.0',
  });

  // ─── Tool 1: run_workflow ───
  server.tool(
    'run_workflow',
    'Execute a YAML workflow with the DAG engine',
    {
      path: z.string().describe('Path to workflow YAML file'),
      inputs: z.record(z.string(), z.string()).optional().describe('Key-value input variables'),
      provider: z.enum(MCP_PROVIDER_IDS).optional().describe('Override LLM provider'),
      model: z.string().optional().describe('Override model name'),
    },
    async ({ path: workflowPath, inputs, provider, model }) => {
      try {
        const absPath = resolve(workflowPath);
        if (!existsSync(absPath)) {
          return { content: [{ type: 'text' as const, text: `文件不存在: ${workflowPath}` }], isError: true };
        }

        const llmOverride: Record<string, string> = {};
        if (provider) llmOverride.provider = provider;
        if (model) llmOverride.model = model;
        // 只换 provider 没给 model：YAML 里的 model 是另一家的编码，不能沿用（deepseek-chat 会被原样递给
        // claude CLI）。与 `ao run --provider` 同一规则：CLI 类清空，API 类回退到该家注册表里的默认模型。
        else if (provider) {
          const fallback = isCliProvider(provider) ? '' : API_PROVIDER_MAP[provider]?.defaultModel;
          if (fallback !== undefined) llmOverride.model = fallback;
        }

        const result = await silentCall(() =>
          run(absPath, (inputs || {}) as Record<string, string>, {
            quiet: true,
            outputDir: mcpOutputDir(),
            llmOverride: Object.keys(llmOverride).length > 0 ? llmOverride : undefined,
          }),
        );

        // 交付物口径与 CLI 导出 / summary ⭐ 一致：声明了 deliverables 取声明的，否则最后一个完成步
        const output = finalOutput(result) || '(no output)';
        const tokenSummary = `Tokens: ${result.totalTokens.input} in / ${result.totalTokens.output} out`;
        // 花了多少媒体（按秒计费的视频尤其）也要报回去：quiet: true 把引擎自己的花费行吞了，
        // 调用方（另一个 agent）对这次花销一无所知
        const media = result.steps.filter((st) => st.videoAsset || st.imageAsset || st.audioAsset);
        const secs = result.steps.reduce((n, st) => n + (st.videoAsset?.seconds ?? 0), 0);
        const mediaSummary = media.length
          ? `\n媒体产物: ${media.length} 个${secs > 0 ? `（视频合计 ${secs} 秒，按秒计费）` : ''}`
          : '';

        // 存档目录报回去：产出可能很长（这里只回交付物），调用方要看全过程、媒体文件、resume 都靠它
        const archive = result.outputDir ? `\n存档: ${result.outputDir}` : '';

        // 失败必须说出口。以前无论跑成什么样都按成功回，于是一条 approval 工作流在 MCP 下
        // （不可交互，askOnStdin 直接拒）回给调用方的是「(no output) / Tokens: 0 in / 0 out」——
        // 另一个 agent 完全看不出它没跑成，更看不出为什么，只会拿着空产出接着往下做。
        const failed = result.steps.filter((st) => st.status === 'failed');
        const skipped = result.steps.filter((st) => st.status === 'skipped');
        if (!result.success || failed.length > 0) {
          const done = result.steps.filter((st) => st.status === 'completed').length;
          const lines = [`工作流未全部完成：${done}/${result.steps.length} 步`];
          for (const st of failed) lines.push(`❌ ${st.id}: ${st.error || '未知错误'}`);
          if (skipped.length) lines.push(`⏭️ 跳过 ${skipped.length} 步: ${skipped.map((st) => st.id).join(', ')}`);
          if (done > 0) lines.push('', '已完成步骤的产出：', output);
          return {
            content: [{ type: 'text' as const, text: `${lines.join('\n')}\n\n---\n${tokenSummary}${mediaSummary}${archive}` }],
            isError: true,
          };
        }

        return {
          content: [{ type: 'text' as const, text: `${output}\n\n---\n${tokenSummary}${mediaSummary}${archive}` }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `执行失败: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ─── Tool 2: validate_workflow ───
  server.tool(
    'validate_workflow',
    'Validate a workflow YAML without executing',
    {
      path: z.string().describe('Path to workflow YAML file'),
    },
    async ({ path: workflowPath }) => {
      try {
        const absPath = resolve(workflowPath);
        if (!existsSync(absPath)) {
          return { content: [{ type: 'text' as const, text: `文件不存在: ${workflowPath}` }], isError: true };
        }

        const workflow = parseWorkflow(absPath);
        const errors = validateWorkflow(workflow);

        if (errors.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `✅ ${workflow.name} — 校验通过\n步骤数: ${workflow.steps.length}\n输入数: ${(workflow.inputs || []).length}`,
            }],
          };
        } else {
          return {
            content: [{
              type: 'text' as const,
              text: `❌ ${workflow.name} — 校验失败:\n${errors.map(e => `  - ${e}`).join('\n')}`,
            }],
            isError: true,
          };
        }
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `校验错误: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ─── Tool 3: list_workflows ───
  server.tool(
    'list_workflows',
    'List available workflow templates from the workflows/ directory',
    {},
    async () => {
      try {
        const workflows = discoverWorkflows();
        if (workflows.length === 0) {
          return { content: [{ type: 'text' as const, text: '未找到工作流文件（workflows/ 目录不存在或为空）' }] };
        }

        const lines = workflows.map(w => `- ${w.file}: ${w.name}${w.description ? ` — ${w.description}` : ''}`);
        return {
          content: [{ type: 'text' as const, text: `共 ${workflows.length} 个工作流:\n\n${lines.join('\n')}` }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `列出工作流失败: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ─── Tool 4: plan_workflow ───
  server.tool(
    'plan_workflow',
    'Show the DAG execution plan for a workflow',
    {
      path: z.string().describe('Path to workflow YAML file'),
    },
    async ({ path: workflowPath }) => {
      try {
        const absPath = resolve(workflowPath);
        if (!existsSync(absPath)) {
          return { content: [{ type: 'text' as const, text: `文件不存在: ${workflowPath}` }], isError: true };
        }

        const workflow = parseWorkflow(absPath);
        const errors = validateWorkflow(workflow);
        if (errors.length > 0) {
          return {
            content: [{ type: 'text' as const, text: `校验失败:\n${errors.map(e => `  - ${e}`).join('\n')}` }],
            isError: true,
          };
        }

        const dag = buildDAG(workflow);
        const dagText = formatDAG(dag);
        // 媒体花费也要报：CLI 的 ao plan 一直有，MCP 这边以前只给 DAG——调用方看到一张干净的图就
        // 直接 run_workflow，几条按秒计费的视频钱就这么花出去了，全程没人提过一句。
        const { summarizeMediaSpend } = await import('../media/preflight.js');
        const spend = summarizeMediaSpend(workflow, new Map());
        const spendText = spend.lines.length ? `\n\n${spend.lines.join('\n')}` : '';
        return {
          content: [{ type: 'text' as const, text: `${workflow.name}\n\n${dagText}${spendText}` }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `计划失败: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ─── Tool 5: compose_workflow ───
  server.tool(
    'compose_workflow',
    'Generate a workflow YAML from a natural language description using AI',
    {
      description: z.string().describe('One-sentence workflow description'),
      provider: z.enum(MCP_PROVIDER_IDS).optional().describe('LLM provider (default: an installed CLI provider, else a keyed one)'),
      model: z.string().optional().describe('Model name'),
    },
    async ({ description, provider, model }) => {
      try {
        const agentsDir = findAgentsDir();
        // 与 CLI 同一套零配置选择：本机装了 claude-code / codex-cli 就直接用它（复用登录态）。
        // 以前这里硬编码兜底 deepseek——于是同一台装了 claude-code 的机器上，`ao compose` 能跑，
        // 经 MCP 调 compose_workflow 却报「缺少 API Key」。MCP 宿主基本都是这种机器。
        const llmProvider = pickAutoProvider(provider || process.env.AO_PROVIDER, 'deepseek').provider;
        // CLI 类 provider 不认模型名（用它自己的默认）；API 类回退到该家注册表里的默认模型
        const llmModel = model || process.env.AO_MODEL || (
          isCliProvider(llmProvider) ? ''
          : llmProvider === 'claude' ? CLAUDE_DEFAULT_MODEL
          : API_PROVIDER_MAP[llmProvider]?.defaultModel || 'gpt-4o'
        );

        const result = await silentCall(() =>
          composeWorkflow({
            description,
            agentsDir,
            llmConfig: { provider: llmProvider, model: llmModel },
            saveDir: mcpWorkflowsDir(),
          }),
        );

        let text = `✅ 工作流已生成: ${result.relativePath}\n\n${result.yaml}`;
        if (result.warnings.length > 0) {
          text += `\n\n⚠️ 校验警告:\n${result.warnings.map(w => `  - ${w}`).join('\n')}`;
        }

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `生成失败: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ─── Tool 6: list_roles ───
  server.tool(
    'list_roles',
    'List available AI roles from the agents directory',
    {
      agents_dir: z.string().optional().describe('Path to agents directory (auto-resolved if omitted)'),
    },
    async ({ agents_dir }) => {
      try {
        const agentsDir = findAgentsDir(agents_dir);
        const agents = listAgents(agentsDir, true);

        const lines = agents.map(a => {
          const emoji = a.emoji || ' ';
          return `${emoji} ${a.name} — ${a.description || '(无描述)'}`;
        });

        return {
          content: [{ type: 'text' as const, text: `共 ${agents.length} 个角色:\n\n${lines.join('\n')}` }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `列出角色失败: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ─── Start server ───
  if (verbose) {
    console.error('[ao-mcp] Starting MCP server...');
  }

  // stdin/stdout 是 JSON-RPC 传输通道：工作流里的 approval / human_input 节点绝不能去读它——
  // 会把下一条协议消息当成「用户的回答」吃掉，还往 stdout 写提示，把整条会话搞坏。
  process.env.AO_NON_INTERACTIVE = '1';
  const transport = new StdioServerTransport();
  await server.connect(transport);

  if (verbose) {
    console.error('[ao-mcp] Server connected via stdio');
  }
}
