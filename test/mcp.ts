/**
 * MCP Server 集成测试
 *
 * 通过 MCP Client SDK 启动 ao serve 子进程，发送 JSON-RPC 请求验证 6 个工具。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';

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

await test('run_workflow returns error on missing file', async () => {
  const result = await client.callTool({
    name: 'run_workflow',
    arguments: { path: '/nonexistent/workflow.yaml' },
  });
  assert(result.isError === true, 'Should be error');
  const text = (result.content as Array<{ text: string }>)[0].text;
  assert(text.includes('不存在'), `Should mention missing file: ${text}`);
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
