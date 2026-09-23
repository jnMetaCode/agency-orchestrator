/**
 * 写 ~/.codex 的两条路径（applyCodexRelay / clearCodexRelay）。
 *
 * 这两个文件里装着用户的 Codex 登录态：`auth.json` 除了 `OPENAI_API_KEY` 还有 OAuth tokens。
 * 以前 clear 那条**一个备份都不留**，而且解析失败时按空文件处理——手改坏过 config.toml 的人
 * 点一下「切回官方」，整份配置连同登录态就没了，且无从恢复。
 */
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; }
}

// CODEX_DIR 取自 HOME，所以换个 HOME 就能在沙箱里跑
const home = mkdtempSync(join(tmpdir(), 'ao-codex-'));
const prevHome = process.env.HOME;
process.env.HOME = home;
const { applyCodexRelay, clearCodexRelay } = await import(`../src/utils/codex-relay.js?t=${Date.now()}`);
const dir = join(home, '.codex');
const toml = join(dir, 'config.toml');
const auth = join(dir, 'auth.json');

try {
  console.log('\n─── 正常写入 / 清除 ───');
  applyCodexRelay({ providerId: 'ao-relay', name: 'AO', baseUrl: 'https://x/v1', apiKey: 'sk-1' });
  assert(readFileSync(toml, 'utf-8').includes('ao-relay'), '写进了 config.toml');
  assert(JSON.parse(readFileSync(auth, 'utf-8')).OPENAI_API_KEY === 'sk-1', '写进了 auth.json');
  if (process.platform !== 'win32') {
    assert((statSync(auth).mode & 0o777) === 0o600, `凭证文件权限 0600（实际 ${(statSync(auth).mode & 0o777).toString(8)}）`);
  }
  // 用户自己的其它内容必须留着
  writeFileSync(auth, JSON.stringify({ OPENAI_API_KEY: 'sk-1', tokens: { refresh: 'r1' } }, null, 2), 'utf-8');
  clearCodexRelay('ao-relay');
  const after = JSON.parse(readFileSync(auth, 'utf-8'));
  assert(after.OPENAI_API_KEY === undefined && after.tokens?.refresh === 'r1', '清除只删 key，OAuth tokens 原样留着');
  assert(readdirSync(dir).some((f) => f.includes('.ao-backup-')), '清除也留了备份（以前这条路径一个备份都不留）');

  console.log('\n─── config.toml 解析不了时：停手，别把配置覆盖成空的 ───');
  writeFileSync(toml, 'this is [not valid toml', 'utf-8');
  writeFileSync(auth, JSON.stringify({ tokens: { refresh: 'r2' } }, null, 2), 'utf-8');
  const before = readFileSync(toml, 'utf-8');
  let msg = '';
  try { clearCodexRelay('ao-relay'); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
  assert(/解析失败/.test(msg) && /不动它/.test(msg), `当场报错并说清（实际：${msg.slice(0, 60)}）`);
  assert(readFileSync(toml, 'utf-8') === before, '坏掉的 config.toml 原样没动');
  assert(JSON.parse(readFileSync(auth, 'utf-8')).tokens?.refresh === 'r2', 'auth.json 里的登录态也没被顺手清掉');

  let msg2 = '';
  try { applyCodexRelay({ providerId: 'ao-relay', name: 'AO', baseUrl: 'https://x/v1', apiKey: 'sk-2' }); }
  catch (e) { msg2 = e instanceof Error ? e.message : String(e); }
  assert(/解析失败/.test(msg2), 'apply 同样停手（它以前会把坏文件当空的、写出一份只剩中转的配置）');
} catch (e) {
  assert(false, `异常: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed > 0 ? 1 : 0);
