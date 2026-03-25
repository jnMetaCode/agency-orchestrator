# MCP Server Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MCP Server mode (`ao serve`) so AI tools like Claude Code and Cursor can invoke workflow operations via the standard MCP stdio protocol.

**Architecture:** Single file `src/mcp/server.ts` (~250 lines) wrapping existing functions as 6 MCP tools. Entry point via `ao serve` in `src/cli.ts`. Uses `@modelcontextprotocol/sdk` StdioServerTransport.

**Tech Stack:** `@modelcontextprotocol/sdk` (v1.28.0), TypeScript, existing agency-orchestrator API surface.

**Spec:** `docs/superpowers/specs/2026-03-26-mcp-server-design.md`

---

### Task 1: Add MCP SDK dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the MCP SDK**

```bash
cd /Users/yx/work/wenzhang/agency-orchestrator
npm install @modelcontextprotocol/sdk
```

- [ ] **Step 2: Verify installation**

```bash
node -e "import('@modelcontextprotocol/sdk/server/index.js').then(() => console.log('OK'))"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add @modelcontextprotocol/sdk dependency for MCP Server mode"
```

---

### Task 2: Create MCP server with 6 tool handlers

**Files:**
- Create: `src/mcp/server.ts`

**Context:** This is the core of the MCP Server. It defines 6 tools as thin wrappers around existing functions from `src/index.ts`. All tools follow the same error-handling pattern: validate params → call function in try/catch → return structured MCP content. The server uses `StdioServerTransport` for stdin/stdout JSON-RPC communication. All console output MUST go to stderr (not stdout) to avoid corrupting the MCP protocol.

- [ ] **Step 1: Write the failing test**

Create `test/mcp.ts`:

```typescript
/**
 * MCP Server 单元测试
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  return Promise.resolve(fn()).then(
    () => { console.log(`  ✅ ${name}`); passed++; },
    (err) => { console.log(`  ❌ ${name}: ${err instanceof Error ? err.message : err}`); failed++; },
  );
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg);
}

// ─── MCP Server Integration Tests ───

console.log('\n─── MCP Server ───');

// Start server as child process via MCP client
const transport = new StdioClientTransport({
  command: 'npx',
  args: ['tsx', resolve('src/cli.ts'), 'serve'],
});

const client = new Client({ name: 'test-client', version: '1.0.0' });
await client.connect(transport);

await test('list_tools returns 6 tools', async () => {
  const result = await client.listTools();
  assert(result.tools.length === 6, `Expected 6 tools, got ${result.tools.length}`);
  const names = result.tools.map(t => t.name).sort();
  assert(names.includes('run_workflow'), 'Missing run_workflow');
  assert(names.includes('validate_workflow'), 'Missing validate_workflow');
  assert(names.includes('list_workflows'), 'Missing list_workflows');
  assert(names.includes('plan_workflow'), 'Missing plan_workflow');
  assert(names.includes('compose_workflow'), 'Missing compose_workflow');
  assert(names.includes('list_roles'), 'Missing list_roles');
});

await test('validate_workflow succeeds on valid file', async () => {
  const result = await client.callTool({
    name: 'validate_workflow',
    arguments: { path: resolve('workflows/story-creation.yaml') },
  });
  const text = (result.content as Array<{ text: string }>)[0].text;
  assert(text.includes('校验通过') || text.includes('pass'), `Unexpected: ${text}`);
  assert(!result.isError, 'Should not be error');
});

await test('validate_workflow returns error on missing file', async () => {
  const result = await client.callTool({
    name: 'validate_workflow',
    arguments: { path: '/nonexistent/workflow.yaml' },
  });
  assert(result.isError === true, 'Should be error');
});

await test('list_workflows returns workflow entries', async () => {
  const result = await client.callTool({
    name: 'list_workflows',
    arguments: {},
  });
  const text = (result.content as Array<{ text: string }>)[0].text;
  assert(text.includes('story-creation'), `Should include story-creation: ${text}`);
});

await test('plan_workflow returns DAG text', async () => {
  const result = await client.callTool({
    name: 'plan_workflow',
    arguments: { path: resolve('workflows/story-creation.yaml') },
  });
  const text = (result.content as Array<{ text: string }>)[0].text;
  assert(text.includes('Level') || text.includes('level') || text.includes('层'), `Should contain DAG levels: ${text}`);
});

await test('run_workflow returns error on missing file', async () => {
  const result = await client.callTool({
    name: 'run_workflow',
    arguments: { path: '/nonexistent/workflow.yaml' },
  });
  assert(result.isError === true, 'Should be error');
  const text = (result.content as Array<{ text: string }>)[0].text;
  assert(text.includes('不存在') || text.includes('not found') || text.includes('文件'), `Should mention missing file: ${text}`);
});

await test('list_roles returns roles', async () => {
  const result = await client.callTool({
    name: 'list_roles',
    arguments: {},
  });
  const text = (result.content as Array<{ text: string }>)[0].text;
  assert(text.length > 100, `Should return substantial role list, got ${text.length} chars`);
});

await client.close();

// Summary
console.log(`\n  MCP: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx tsx test/mcp.ts
```

Expected: FAIL — `ao serve` command not recognized or server module not found.

- [ ] **Step 3: Create `src/mcp/server.ts`**

```typescript
/**
 * MCP Server — 通过 MCP 协议暴露工作流操作
 *
 * 6 个工具，每个都是对现有函数的薄封装。
 * 传输层: StdioServerTransport (stdin/stdout JSON-RPC)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolve, relative } from 'node:path';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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
    './agency-agents-zh',
    '../agency-agents-zh',
    './agents',
    'node_modules/agency-agents-zh',
  ];
  for (const dir of candidates) {
    const full = resolve(dir);
    if (existsSync(full)) return full;
  }
  return resolve(hint || './agency-agents-zh');
}

/** 列出 workflows 目录下的 YAML 文件 */
function discoverWorkflows(): Array<{ file: string; name: string; description: string }> {
  const pattern = resolve('workflows');
  if (!existsSync(pattern)) return [];

  const files: string[] = [];
  findYamlFiles(pattern, files);

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

export async function startServer(verbose = false): Promise<void> {
  const server = new McpServer({
    name: 'agency-orchestrator',
    version: '0.4.0',
  });

  // ─── Tool 1: run_workflow ───
  server.tool(
    'run_workflow',
    'Execute a YAML workflow with the DAG engine',
    {
      path: z.string().describe('Path to workflow YAML file'),
      inputs: z.record(z.string()).optional().describe('Key-value input variables'),
      provider: z.enum(['deepseek', 'claude', 'openai', 'ollama']).optional().describe('Override LLM provider'),
      model: z.string().optional().describe('Override model name'),
    },
    async ({ path: workflowPath, inputs, provider, model }) => {
      try {
        const absPath = resolve(workflowPath);
        if (!existsSync(absPath)) {
          return { content: [{ type: 'text', text: `文件不存在: ${workflowPath}` }], isError: true };
        }

        const llmOverride: Record<string, string> = {};
        if (provider) llmOverride.provider = provider;
        if (model) llmOverride.model = model;

        const result = await run(absPath, inputs || {}, {
          quiet: true,
          llmOverride: Object.keys(llmOverride).length > 0 ? llmOverride : undefined,
        });

        // Extract final step output
        const lastStep = result.steps[result.steps.length - 1];
        const output = lastStep?.output || '(no output)';
        const tokenSummary = `Tokens: ${result.totalTokens.input} in / ${result.totalTokens.output} out`;

        return {
          content: [{ type: 'text', text: `${output}\n\n---\n${tokenSummary}` }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `执行失败: ${err instanceof Error ? err.message : String(err)}` }],
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
          return { content: [{ type: 'text', text: `文件不存在: ${workflowPath}` }], isError: true };
        }

        const workflow = parseWorkflow(absPath);
        const errors = validateWorkflow(workflow);

        if (errors.length === 0) {
          return {
            content: [{
              type: 'text',
              text: `✅ ${workflow.name} — 校验通过\n步骤数: ${workflow.steps.length}\n输入数: ${(workflow.inputs || []).length}`,
            }],
          };
        } else {
          return {
            content: [{
              type: 'text',
              text: `❌ ${workflow.name} — 校验失败:\n${errors.map(e => `  - ${e}`).join('\n')}`,
            }],
            isError: true,
          };
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `校验错误: ${err instanceof Error ? err.message : String(err)}` }],
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
          return { content: [{ type: 'text', text: '未找到工作流文件（workflows/ 目录不存在或为空）' }] };
        }

        const lines = workflows.map(w => `- ${w.file}: ${w.name}${w.description ? ` — ${w.description}` : ''}`);
        return {
          content: [{ type: 'text', text: `共 ${workflows.length} 个工作流:\n\n${lines.join('\n')}` }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `列出工作流失败: ${err instanceof Error ? err.message : String(err)}` }],
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
          return { content: [{ type: 'text', text: `文件不存在: ${workflowPath}` }], isError: true };
        }

        const workflow = parseWorkflow(absPath);
        const errors = validateWorkflow(workflow);
        if (errors.length > 0) {
          return {
            content: [{ type: 'text', text: `校验失败:\n${errors.map(e => `  - ${e}`).join('\n')}` }],
            isError: true,
          };
        }

        const dag = buildDAG(workflow);
        const dagText = formatDAG(dag);
        return {
          content: [{ type: 'text', text: `${workflow.name}\n\n${dagText}` }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `计划失败: ${err instanceof Error ? err.message : String(err)}` }],
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
        const llmProvider = provider || 'deepseek';
        const llmModel = model || (llmProvider === 'deepseek' ? 'deepseek-chat' : llmProvider === 'claude' ? 'claude-sonnet-4-20250514' : 'gpt-4o');

        const result = await composeWorkflow({
          description,
          agentsDir,
          llmConfig: { provider: llmProvider, model: llmModel },
        });

        let text = `✅ 工作流已生成: ${result.relativePath}\n\n${result.yaml}`;
        if (result.warnings.length > 0) {
          text += `\n\n⚠️ 校验警告:\n${result.warnings.map(w => `  - ${w}`).join('\n')}`;
        }

        return { content: [{ type: 'text', text }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `生成失败: ${err instanceof Error ? err.message : String(err)}` }],
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
          content: [{ type: 'text', text: `共 ${agents.length} 个角色:\n\n${lines.join('\n')}` }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `列出角色失败: ${err instanceof Error ? err.message : String(err)}` }],
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
```

**Important notes for implementer:**
- `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js` uses Zod schemas for tool parameters — the SDK bundles zod, import from `zod` directly. If `zod` is not resolvable, check if the SDK re-exports it or install it as a peer dependency.
- All logging must go to `stderr` (use `console.error`), never `stdout` — stdout is the MCP protocol channel.
- The underlying `composeWorkflow()` function uses `console.log` internally. Since MCP uses stdout for the protocol, any `console.log` from that function will corrupt the transport. Wrap the call by temporarily redirecting `process.stdout.write` to suppress output, or pass `quiet: true` if supported. The `run()` function already supports `quiet: true`.
- Do NOT use `-v` as shorthand for `--verbose` in `handleServe` — it conflicts with `--version` / `-v` in the CLI's main switch.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx tsx test/mcp.ts
```

Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server.ts test/mcp.ts
git commit -m "feat: add MCP server with 6 workflow tools"
```

---

### Task 3: Add `ao serve` CLI command

**Files:**
- Modify: `src/cli.ts:28-69` (switch statement)

**Context:** Add `case 'serve'` to the CLI switch. It should import `startServer` from `./mcp/server.js` and call it with an optional `--verbose` flag.

- [ ] **Step 1: Write the failing test**

Add to `test/mcp.ts` (before the client connection block), a test that verifies the CLI recognizes the `serve` command:

```typescript
// Test that `ao serve --help` doesn't error with "unknown command"
import { execSync } from 'node:child_process';

await test('ao serve is a recognized command', async () => {
  // ao serve starts an infinite server, so we just check it doesn't print "未知命令"
  // by spawning it and killing after a short delay
  const { spawn } = await import('node:child_process');
  const proc = spawn('npx', ['tsx', resolve('src/cli.ts'), 'serve'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 3000,
  });

  let stderr = '';
  proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

  // Give it a moment to start, then kill
  await new Promise(r => setTimeout(r, 1000));
  proc.kill('SIGTERM');

  // If it was an unknown command, stderr would contain "未知命令"
  assert(!stderr.includes('未知命令'), `Should not be unknown command, got: ${stderr}`);
});
```

- [ ] **Step 2: Add `serve` case to `src/cli.ts`**

Add after `case 'demo':` block (line ~52):

```typescript
    case 'serve':
      await handleServe();
      break;
```

And add the handler function:

```typescript
async function handleServe(): Promise<void> {
  const verbose = args.includes('--verbose');
  try {
    const { startServer } = await import('./mcp/server.js');
    await startServer(verbose);
  } catch (err) {
    console.error(`MCP 服务器启动失败: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
```

Also add `serve` to the `knownCmds` array (line ~59):

```typescript
const knownCmds = ['run', 'validate', 'plan', 'explain', 'compose', 'demo', 'roles', 'init', 'serve'];
```

And add to `printHelp()`:

```
    serve                             启动 MCP Server（供 Claude Code / Cursor 调用）
```

- [ ] **Step 3: Run tests**

```bash
npx tsx test/mcp.ts
```

Expected: All tests PASS including the new CLI recognition test.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add 'ao serve' CLI command for MCP Server mode"
```

---

### Task 4: Add MCP test to test suite and update package.json

**Files:**
- Modify: `package.json:47` (test script)

- [ ] **Step 1: Add mcp test to the test script**

In `package.json`, append `&& npx tsx test/mcp.ts` to the `test` script.

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

Expected: All tests pass including the new MCP tests.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add MCP server tests to test suite"
```

---

### Task 5: Update README with MCP Server documentation

**Files:**
- Modify: `README.md` (Chinese, add MCP section)
- Modify: `README.en.md` (English, add MCP section)

**Context:** Add a new section documenting `ao serve` and MCP configuration. Place it after the "CLI Reference" section. Include config examples for Claude Code and Cursor.

- [ ] **Step 1: Add MCP section to README.md (Chinese)**

After CLI Reference section, add:

```markdown
### MCP Server 模式

AI 编程工具（Claude Code、Cursor 等）可通过 MCP 协议直接调用工作流操作：

```bash
ao serve              # 启动 MCP stdio 服务器
ao serve --verbose    # 带调试日志
```

配置 Claude Code（`settings.json`）：

```json
{
  "mcpServers": {
    "agency-orchestrator": {
      "command": "npx",
      "args": ["agency-orchestrator", "serve"]
    }
  }
}
```

配置 Cursor（`.cursor/mcp.json`）：

```json
{
  "mcpServers": {
    "agency-orchestrator": {
      "command": "npx",
      "args": ["agency-orchestrator", "serve"]
    }
  }
}
```

提供 6 个工具: `run_workflow`、`validate_workflow`、`list_workflows`、`plan_workflow`、`compose_workflow`、`list_roles`。
```

- [ ] **Step 2: Add MCP section to README.en.md (English)**

Same content, translated to English.

- [ ] **Step 3: Add `ao serve` to CLI Reference table in both READMEs**

Add `ao serve` line to the CLI command list.

- [ ] **Step 4: Update Roadmap — mark MCP Server as done**

Change `- [ ] **v0.4** — MCP Server mode,` to `- [x] **v0.4** — MCP Server mode,` (partial — just MCP Server part).

- [ ] **Step 5: Commit**

```bash
git add README.md README.en.md
git commit -m "docs: add MCP Server mode documentation"
```
