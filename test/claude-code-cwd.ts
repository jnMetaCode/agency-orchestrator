/**
 * claude-code 连接器在空临时目录里启动（不依赖本机装没装 claude）。
 *
 * 真机事实（claude 2.1.271, macOS, 2026-09-15）：同一句「上下文里有没有出现 X」，在 AO 仓库里跑答「有」
 * （项目记忆被自动加载），在空临时目录里跑答「没有」。关了工具也照样注入，所以 AO 的角色产出会混进
 * 用户私有记忆。这里用一个假的 claude（把自己的 cwd 当结果输出）钉住：默认在临时目录启动、跑完删掉；
 * AO_CLI_INHERIT_CWD=1 时沿用当前目录。
 */
import { mkdtempSync, writeFileSync, chmodSync, existsSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeCodeConnector } from '../src/connectors/claude-code.js';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (err) { console.log(`  ❌ ${name}: ${err instanceof Error ? err.message : err}`); failed++; }
}
function assert(c: boolean, m: string): void { if (!c) throw new Error(m); }

console.log('\n─── claude-code 启动目录 ───');

if (process.platform === 'win32') {
  console.log('  ⏭️  Windows 跳过（假 CLI 用 shebang 脚本）');
} else {
  const binDir = mkdtempSync(join(tmpdir(), 'ao-fake-claude-bin-'));
  const fake = join(binDir, 'claude');
  writeFileSync(fake, `#!/usr/bin/env node
let d = '';
process.stdin.on('data', (c) => { d += c; });
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({ type: 'result', result: process.cwd(), usage: { input_tokens: 1, output_tokens: 1 } }));
});
`);
  chmodSync(fake, 0o755);

  const connector = new ClaudeCodeConnector({
    command: fake,
    displayName: 'fake claude',
    installHint: '',
    providerId: 'claude-code',
  });
  const cfg = { provider: 'claude-code', model: '', timeout: 20_000 } as any;
  const old = process.env.AO_CLI_INHERIT_CWD;

  await test('默认：在空临时目录里启动，跑完删掉', async () => {
    delete process.env.AO_CLI_INHERIT_CWD;
    const r = await connector.chat('角色', '任务', cfg);
    const here = realpathSync(process.cwd());
    assert(r.content !== here, `不应在当前目录启动，实际 ${r.content}`);
    assert(r.content.startsWith(realpathSync(tmpdir())) && r.content.includes('ao-claude-'), `应在 ao-claude- 临时目录，实际 ${r.content}`);
    assert(!existsSync(r.content), `跑完应删除临时目录：${r.content}`);
  });

  await test('AO_CLI_INHERIT_CWD=1：沿用当前目录（旧行为）', async () => {
    process.env.AO_CLI_INHERIT_CWD = '1';
    const r = await connector.chat('角色', '任务', cfg);
    assert(realpathSync(r.content) === realpathSync(process.cwd()), `应为当前目录，实际 ${r.content}`);
  });

  if (old === undefined) delete process.env.AO_CLI_INHERIT_CWD; else process.env.AO_CLI_INHERIT_CWD = old;
  rmSync(binDir, { recursive: true, force: true });
}

console.log(`\n  ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
