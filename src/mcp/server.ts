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
import { resolve, relative, dirname } from 'node:path';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';

import { run } from '../index.js';
import { parseWorkflow, validateWorkflow } from '../core/parser.js';
import { buildDAG, formatDAG } from '../core/dag.js';
import { listAgents } from '../agents/loader.js';
import { composeWorkflow } from '../cli/compose.js';

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
      provider: z.enum(['claude-code', 'gemini-cli', 'copilot-cli', 'codex-cli', 'openclaw-cli', 'hermes-cli', 'deepseek', 'claude', 'openai', 'ollama']).optional().describe('Override LLM provider'),
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

        const result = await silentCall(() =>
          run(absPath, (inputs || {}) as Record<string, string>, {
            quiet: true,
            llmOverride: Object.keys(llmOverride).length > 0 ? llmOverride : undefined,
          }),
        );

        const lastStep = result.steps[result.steps.length - 1];
        const output = lastStep?.output || '(no output)';
        const tokenSummary = `Tokens: ${result.totalTokens.input} in / ${result.totalTokens.output} out`;

        return {
          content: [{ type: 'text' as const, text: `${output}\n\n---\n${tokenSummary}` }],
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
        return {
          content: [{ type: 'text' as const, text: `${workflow.name}\n\n${dagText}` }],
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
      provider: z.enum(['deepseek', 'claude', 'openai', 'ollama']).optional().describe('LLM provider (default: deepseek)'),
      model: z.string().optional().describe('Model name'),
    },
    async ({ description, provider, model }) => {
      try {
        const agentsDir = findAgentsDir();
        const llmProvider = provider || process.env.AO_PROVIDER as any || 'deepseek';
        const defaultModels: Record<string, string> = {
          deepseek: 'deepseek-chat',
          claude: 'claude-sonnet-4-20250514',
          openai: 'gpt-4o',
          ollama: 'llama3',
        };
        const llmModel = model || process.env.AO_MODEL || defaultModels[llmProvider] || 'gpt-4o';

        const result = await silentCall(() =>
          composeWorkflow({
            description,
            agentsDir,
            llmConfig: { provider: llmProvider, model: llmModel },
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
        const agents = listAgents(agentsDir);

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

  const transport = new StdioServerTransport();
  await server.connect(transport);

  if (verbose) {
    console.error('[ao-mcp] Server connected via stdio');
  }
}
