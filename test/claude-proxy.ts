/**
 * 测试 Claude 代理「可见 + 可管理」：读取已配代理 / 探测可达 / 一键移除。
 * 全程走 AO_CLAUDE_DIR 沙箱，绝不触碰真实 ~/.claude。
 */
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readClaudeProxyStatus, clearClaudeProxy, probeProxyReachable } from '../src/utils/claude-apply.js';

let passed = 0, failed = 0;
function assert(c: boolean, m: string): void { if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; } }

console.log('\n─── Claude 代理可见/可管理 (claude-proxy) ───');

const sandbox = mkdtempSync(join(tmpdir(), 'ao-proxy-test-'));
const savedDir = process.env.AO_CLAUDE_DIR;
process.env.AO_CLAUDE_DIR = sandbox;
const settings = join(sandbox, 'settings.json');
const read = (): any => JSON.parse(readFileSync(settings, 'utf-8'));
const backupCount = () => readdirSync(sandbox).filter((f) => f.includes('.ao-backup-')).length;

async function main() {
  // 1) 无 settings：无 configured
  assert(readClaudeProxyStatus().configured === undefined, '无配置：configured 为空');

  // 2) 写了代理：读得出（优先 HTTPS_PROXY）
  writeFileSync(settings, JSON.stringify({ env: { HTTP_PROXY: 'http://127.0.0.1:7890', HTTPS_PROXY: 'http://127.0.0.1:7890' }, theme: 'dark' }, null, 2), 'utf-8');
  assert(readClaudeProxyStatus().configured === 'http://127.0.0.1:7890', '配了代理：读得出 configured');

  // 3) 一键移除：删 HTTP(S)_PROXY、保留其它、留备份
  const before = backupCount();
  const r = clearClaudeProxy();
  assert(r.changed === true, '移除：changed=true');
  assert(r.backup !== null && backupCount() === before + 1, '移除：写前有备份');
  assert(read().theme === 'dark', '移除：保留用户 theme');
  assert(read().env === undefined, '移除：env 空了连 env 一起删');

  // 4) 幂等：没代理时再移除不报错、不改动
  assert(clearClaudeProxy().changed === false, '移除幂等：无代理时 changed=false');

  // 5) 坏 JSON：不覆写
  writeFileSync(settings, '{ bad json', 'utf-8');
  const broken = readFileSync(settings, 'utf-8');
  assert(clearClaudeProxy().changed === false, '坏 JSON：不动、changed=false');
  assert(readFileSync(settings, 'utf-8') === broken, '坏 JSON：原文件未被覆写');

  // 6) 可达探测：活端口 true、死端口 false、坏 URL false
  const srv = createServer();
  await new Promise<void>((res) => srv.listen(0, '127.0.0.1', () => res()));
  const port = (srv.address() as any).port;
  assert((await probeProxyReachable(`http://127.0.0.1:${port}`)) === true, '探测：活端口可达');
  await new Promise<void>((res) => srv.close(() => res()));
  assert((await probeProxyReachable(`http://127.0.0.1:${port}`)) === false, '探测：死端口不可达');
  assert((await probeProxyReachable('not-a-url')) === false, '探测：坏 URL 返回 false');
}

main()
  .then(() => {
    rmSync(sandbox, { recursive: true, force: true });
    if (savedDir === undefined) delete process.env.AO_CLAUDE_DIR; else process.env.AO_CLAUDE_DIR = savedDir;
    console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
    if (failed > 0) process.exit(1);
  })
  .catch((err) => {
    rmSync(sandbox, { recursive: true, force: true });
    console.error(err);
    process.exit(1);
  });
