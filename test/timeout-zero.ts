/**
 * `timeout: 0` = 不限时。executor 的注释、超时失败提示（「或 --timeout 0 不限时」）都这么承诺，
 * 但三个连接器里写的是 `config.timeout || 默认值`——0 被吃成 600s / 300s，`timeout ? 计时器 : null`
 * 那条分支成了死代码。后果：显式要求不限时的长步骤照样 600s 被杀，而且因为 attemptTimeout 是 0，
 * 重试时也不会放宽，五次都死在同一个 600s 上。
 *
 * 真等 600 秒测不了，所以钉「有没有上那个计时器」：记录连接器运行期间 setTimeout 的全部时长。
 */
import http from 'node:http';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenAICompatibleConnector } from '../src/connectors/openai-compatible.js';
import { ClaudeCodeConnector } from '../src/connectors/claude-code.js';
import { CLIBaseConnector } from '../src/connectors/cli-base.js';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; }
}

/** 运行 fn 期间记录所有 setTimeout 的时长。 */
async function recordTimers<T>(fn: () => Promise<T>): Promise<{ result: T; delays: number[] }> {
  const real = globalThis.setTimeout;
  const delays: number[] = [];
  (globalThis as any).setTimeout = ((cb: any, ms?: number, ...rest: any[]) => {
    delays.push(Number(ms ?? 0));
    return real(cb, ms, ...rest);
  }) as typeof setTimeout;
  try { return { result: await fn(), delays }; } finally { globalThis.setTimeout = real; }
}

console.log('\n─── API 连接器 ───');
{
  const srv = http.createServer((rq, rs) => {
    rq.resume();
    rs.writeHead(200, { 'Content-Type': 'application/json' });
    rs.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}/v1`;
  const conn = new OpenAICompatibleConnector({ apiKey: 'test', baseUrl: url });

  const zero = await recordTimers(() => conn.chat('s', 'u', { provider: 'openai', model: 'm', timeout: 0 } as any));
  assert(zero.result.content === 'ok', 'timeout: 0 请求正常完成（没有被 setTimeout(…, 0) 立刻中断）');
  assert(!zero.delays.includes(300_000), `timeout: 0 不上 300s 总计时器（实际上了：${JSON.stringify(zero.delays)}）`);
  assert(zero.delays.includes(90_000), '停顿检测还在——不限时不等于对面挂死也不管');

  const unset = await recordTimers(() => conn.chat('s', 'u', { provider: 'openai', model: 'm' } as any));
  assert(unset.delays.includes(300_000), '没写 timeout 仍是默认 300s（默认行为不变）');
  const explicit = await recordTimers(() => conn.chat('s', 'u', { provider: 'openai', model: 'm', timeout: 45_000 } as any));
  assert(explicit.delays.includes(45_000) && !explicit.delays.includes(300_000), '显式 45s 照用');
  srv.close(); srv.closeAllConnections?.();
}

if (process.platform === 'win32') {
  console.log('  ⏭️  Windows 跳过 CLI 连接器部分（假 CLI 用 shebang 脚本）');
} else {
  console.log('\n─── CLI 连接器（假 CLI） ───');
  const binDir = mkdtempSync(join(tmpdir(), 'ao-fake-cli-timeout0-'));
  const fakeClaude = join(binDir, 'claude');
  writeFileSync(fakeClaude, `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } }) + '\\n'
    + JSON.stringify({ type: 'result', result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } }) + '\\n');
});
`);
  chmodSync(fakeClaude, 0o755);
  const fakeGeneric = join(binDir, 'generic');
  writeFileSync(fakeGeneric, `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on('end', () => process.stdout.write('ok'));
process.stdin.on('error', () => {});
setTimeout(() => { process.stdout.write('ok'); process.exit(0); }, 300);
`);
  chmodSync(fakeGeneric, 0o755);
  try {
    const cc = new ClaudeCodeConnector({ command: fakeClaude, displayName: 'fake claude', installHint: '', providerId: 'claude-code', streamJson: true });
    const z = await recordTimers(() => cc.chat('角色', '任务', { provider: 'claude-code', model: '', timeout: 0 } as any));
    assert(z.result.content === 'ok' && !z.delays.includes(600_000), `claude-code：timeout: 0 不上 600s 杀进程计时器（实际 ${JSON.stringify(z.delays)}）`);
    const d = await recordTimers(() => cc.chat('角色', '任务', { provider: 'claude-code', model: '' } as any));
    assert(d.delays.includes(600_000), 'claude-code：没写 timeout 仍是默认 600s');

    const base = new CLIBaseConnector({ command: fakeGeneric, displayName: 'fake', installHint: '', buildArgs: () => [], supportsStdin: true } as any);
    const bz = await recordTimers(() => base.chat('角色', '任务', { provider: 'x', model: '', timeout: 0 } as any));
    assert(!bz.delays.includes(600_000), `cli-base：timeout: 0 不上 600s 计时器（实际 ${JSON.stringify(bz.delays)}）`);
    const bd = await recordTimers(() => base.chat('角色', '任务', { provider: 'x', model: '' } as any));
    assert(bd.delays.includes(600_000), 'cli-base：没写 timeout 仍是默认 600s');
  } catch (e) {
    assert(false, `异常: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed > 0 ? 1 : 0);
