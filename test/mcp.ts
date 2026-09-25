/**
 * MCP Server 集成测试
 *
 * 通过 MCP Client SDK 启动 ao serve 子进程，发送 JSON-RPC 请求验证 6 个工具。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve, join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { tmpdir } from 'node:os';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}: ${err instanceof Error ? err.message : err}`);
    failed++;
  }
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
  assert(text.includes('校验通过'), `Unexpected: ${text}`);
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

// 花费要在花之前说清楚：调用方（另一个 agent）看到一张干净的 DAG 就直接 run_workflow，
// 几条按秒计费的视频钱就这么花出去了。CLI 的 ao plan 一直报，MCP 这边以前只给 DAG。
await test('plan_workflow 报出媒体花费（按秒计费的视频尤其）', async () => {
  const result = await client.callTool({
    name: 'plan_workflow',
    arguments: { path: resolve('workflows/一句话出短片.yaml') },
  });
  const text = (result.content as Array<{ text: string }>)[0].text;
  assert(/出片|出图|配音/.test(text), `应带媒体花费行（实际尾部：${text.slice(-200)}）`);
});

await test('run_workflow returns error on missing file', async () => {
  const result = await client.callTool({
    name: 'run_workflow',
    arguments: { path: '/nonexistent/workflow.yaml' },
  });
  assert(result.isError === true, 'Should be error');
  const text = (result.content as Array<{ text: string }>)[0].text;
  assert(text.includes('不存在'), `Should mention missing file: ${text}`);
});

await test('跑不成必须说出口：不可交互的 approval 步骤不能按成功回', async () => {
  // MCP 下 stdin 是 JSON-RPC 通道，approval 只能当场拒（executor 的 AO_NON_INTERACTIVE 分支）。
  // 以前无论跑成什么样都按成功回，调用方（另一个 agent）拿到的是「(no output) / Tokens: 0 in / 0 out」——
  // 看不出没跑成，更看不出为什么，只会拿着空产出接着往下做。
  const dir = mkdtempSync(join(tmpdir(), 'ao-mcp-appr-'));
  const wf = join(dir, 'a.yaml');
  writeFileSync(wf, [
    'name: "要人点头"', `agents_dir: "${resolve('node_modules/agency-agents-zh')}"`, 'verify: false',
    'llm:', '  provider: "deepseek"', '  model: "m"', '  api_key: "k"',
    'steps:', '  - id: gate', '    type: approval', '    role: "marketing/marketing-content-creator"',
    '    task: "确认"', '    prompt: "继续吗？"', '    output: gate_out', '',
  ].join('\n'), 'utf-8');
  try {
    const result = await client.callTool({ name: 'run_workflow', arguments: { path: wf } });
    const text = (result.content as Array<{ text: string }>)[0].text;
    assert(result.isError === true, `没跑成要标 isError（实际 ${String(result.isError)}：${text.slice(0, 120)}）`);
    assert(/未全部完成/.test(text) && /gate/.test(text), `要点名是哪一步（实际：${text.slice(0, 160)}）`);
    assert(/不可交互|人工输入/.test(text), `要说清为什么（实际：${text.slice(0, 160)}）`);
    assert(/存档/.test(text), '要给出存档目录，调用方才能去看过程与 resume');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test('compose_workflow 的 provider 与 CLI 同一套零配置选择（不再硬兜底 deepseek）', async () => {
  // 以前这里硬编码 provider: 'deepseek'：同一台装了 claude-code 的机器上，`ao compose` 零配置能跑，
  // 经 MCP 调 compose_workflow 却报「缺少 API Key」——而 MCP 宿主基本都是装了 CLI 的机器。
  // 这里不真调模型（那要花钱），只钉住入参契约：provider 枚举得容得下 CLI 类。
  const tools = await client.listTools();
  const compose = tools.tools.find((t) => t.name === 'compose_workflow');
  const schema = JSON.stringify(compose?.inputSchema ?? {});
  assert(/claude-code/.test(schema), `provider 枚举要含 CLI 类（实际：${schema.slice(0, 200)}）`);
  assert(/codex-cli/.test(schema), 'CLI 名单来自注册表，不是手抄的四个');
});

await test('MCP 的产物不按 cwd 落盘（宿主的 cwd 不由用户决定）', async () => {
  // 真机：MCP 宿主常以 cwd=/ 启动服务，工作流跑完 21.9 秒才在存档那步报
  // `mkdir 'ao-output/…'` 失败，产物全丢。显式配了 env 就听用户的，否则落到用户级 ~/.ao。
  const { mcpOutputDir, mcpWorkflowsDir } = await import('../src/mcp/server.js');
  const saved = { out: process.env.AO_OUTPUT_DIR, wf: process.env.AO_WORKFLOWS_DIR, home: process.env.AO_HOME };
  delete process.env.AO_OUTPUT_DIR; delete process.env.AO_WORKFLOWS_DIR; delete process.env.AO_HOME;
  try {
    assert(mcpOutputDir().startsWith(join(homedir(), '.ao')), `默认落用户级目录（实际 ${mcpOutputDir()}）`);
    assert(mcpWorkflowsDir().startsWith(join(homedir(), '.ao')), `compose 产物同理（实际 ${mcpWorkflowsDir()}）`);
    assert(!mcpOutputDir().startsWith('ao-output'), '绝不是 cwd 相对路径');
    process.env.AO_OUTPUT_DIR = '/tmp/ao-explicit';
    assert(mcpOutputDir() === '/tmp/ao-explicit', '显式配了就听用户的');
  } finally {
    for (const [k, v] of [['AO_OUTPUT_DIR', saved.out], ['AO_WORKFLOWS_DIR', saved.wf], ['AO_HOME', saved.home]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
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
