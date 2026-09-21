/**
 * claude-code 长输出不丢段（不依赖本机装没装 claude）。
 *
 * 真机事实（claude 2.1.271, macOS, 2026-09-15）：输出超过 CLI 的单段上限时自动续写成多轮，
 * `--output-format json` 的 result 只装最后一段（从 1 写到 400、上限压到 300 token → result 是 301–400，
 * subtype 仍是 success）；`stream-json --verbose` 的 assistant 消息拼起来才是完整的 1–400。
 * 真实工作流里一步 8.9 万 token 的代码因此丢了约三分之二，运行照样报成功。
 */
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseResultJson, ClaudeCodeConnector } from '../src/connectors/claude-code.js';

let passed = 0, failed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (err) { console.log(`  ❌ ${name}: ${err instanceof Error ? err.message : err}`); failed++; }
}
function assert(c: boolean, m: string): void { if (!c) throw new Error(m); }

const seg = (text: string) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const cont = { type: 'user', message: { content: [{ type: 'text', text: 'continue' }] } };
const streamOf = (events: object[]) => events.map((e) => JSON.stringify(e)).join('\n') + '\n';

console.log('\n─── claude-code 长输出（stream-json）───');

await test('多轮续写：拼接全部 assistant 分段，不只取 result 的最后一段', () => {
  const out = streamOf([
    { type: 'system', subtype: 'init' },
    seg('1\n2\n'), cont, seg('3\n4\n'), cont, seg('5\n6'),
    { type: 'result', subtype: 'success', is_error: false, result: '5\n6', num_turns: 3, usage: { input_tokens: 7, output_tokens: 9 } },
  ]);
  const r = parseResultJson(out);
  assert(r.result === '1\n2\n3\n4\n5\n6', `应拼成完整正文，实际 ${JSON.stringify(r.result)}`);
  assert(r.usage.output_tokens === 9 && r.usage.input_tokens === 7, 'usage 应取 result 事件');
});

await test('单段输出：原样取 result', () => {
  const r = parseResultJson(streamOf([seg('只有一段'), { type: 'result', result: '只有一段', usage: { output_tokens: 3 } }]));
  assert(r.result === '只有一段', `实际 ${r.result}`);
});

await test('出错时保留 result 的错误信息，不拼 assistant 文本', () => {
  const r = parseResultJson(streamOf([seg('半截'), seg('又半截'), { type: 'result', is_error: true, result: 'API Error: 529' }]));
  assert(r.is_error === true && r.result === 'API Error: 529', `实际 ${JSON.stringify(r)}`);
});

await test('CodeBuddy 整段对话数组：多条 assistant 文本同样拼接', () => {
  const out = JSON.stringify([
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
    { type: 'message', role: 'assistant', content: [{ type: 'text', text: '前半' }] },
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'continue' }] },
    { type: 'message', role: 'assistant', content: [{ type: 'text', text: '后半' }] },
    { type: 'result', result: '后半', usage: { output_tokens: 4 } },
  ]);
  const r = parseResultJson(out);
  assert(r.result === '前半后半', `实际 ${r.result}`);
});

await test('不是事件流的多行文本：抛错，交给调用方的纯文本兜底', () => {
  let threw = false;
  try { parseResultJson('第一行\n第二行'); } catch { threw = true; }
  assert(threw, '非 JSON 多行文本应抛错');
});

if (process.platform === 'win32') {
  console.log('  ⏭️  Windows 跳过端到端（假 CLI 用 shebang 脚本）');
} else {
  await test('端到端：claude 用 stream-json --verbose 调用，拿到完整三段', async () => {
    const binDir = mkdtempSync(join(tmpdir(), 'ao-fake-claude-stream-'));
    const fake = join(binDir, 'claude');
    writeFileSync(fake, `#!/usr/bin/env node
const argv = process.argv.slice(2);
process.stdin.resume();
process.stdin.on('end', () => {
  const i = argv.indexOf('--output-format');
  const ok = argv[i + 1] === 'stream-json' && argv.includes('--verbose');
  const seg = (text) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
  if (!ok) { process.stdout.write(JSON.stringify({ type: 'result', result: 'ONLY-LAST-SEGMENT', usage: {} })); return; }
  process.stdout.write([seg('第一段'), seg('第二段'), seg('第三段'),
    JSON.stringify({ type: 'result', result: '第三段', num_turns: 3, usage: { input_tokens: 1, output_tokens: 30 } })].join('\\n') + '\\n');
});
`);
    chmodSync(fake, 0o755);
    try {
      const c = new ClaudeCodeConnector({ command: fake, displayName: 'fake claude', installHint: '', providerId: 'claude-code', streamJson: true });
      const r = await c.chat('角色', '任务', { provider: 'claude-code', model: '', timeout: 20_000 } as any);
      assert(r.content === '第一段第二段第三段', `应拿到完整三段，实际 ${r.content}`);
      assert(r.usage.output_tokens === 30, `usage 应取 result 事件，实际 ${JSON.stringify(r.usage)}`);
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });
}

console.log(`\n  ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
