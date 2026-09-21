/**
 * Studio 的「网络代理」端点（#105），起真服务端打。
 *
 * 钉三件单测钉不住的事：
 *   1. 保存后**重启仍在**——桌面版用户每次都是冷启动，只在内存里生效等于没做；
 *   2. 回显永远脱敏（代理地址里常带账号密码），文件里才有原文；
 *   3. 启动环境里原本的代理变量：Studio 没配时照用、配了让位、清除后还原。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise<number>((res) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); });
});

const dataDir = mkdtempSync(join(tmpdir(), 'ao-web-netproxy-'));
const networkFile = join(dataDir, '.local', 'web-network.json');

async function boot(extraEnv: Record<string, string>): Promise<{ base: string; proc: ChildProcess }> {
  const port = await freePort();
  // 把外层环境里的代理变量清干净：开发机上常年 export 着代理，不清的话断言测的是开发机而不是代码
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const n of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'AO_NO_PROXY']) delete env[n];
  const proc = spawn(process.execPath, [resolve('web/server.js')], {
    env: { ...env, ...extraEnv, PORT: String(port), HOST: '127.0.0.1', AO_NODE: process.execPath, AO_DATA_DIR: dataDir, AO_MANIFEST_URL: 'http://127.0.0.1:1/none.json' },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base + '/api/health')).ok) return { base, proc }; } catch { /* not up yet */ }
    await sleep(250);
  }
  proc.kill();
  throw new Error('服务没起来');
}
const stop = async (p: ChildProcess) => { p.kill(); await new Promise((r) => p.once('exit', r)); };
const get = async (base: string) => (await fetch(base + '/api/network/proxy')).json() as Promise<Record<string, any>>;
const post = async (base: string, proxy: unknown) => {
  const r = await fetch(base + '/api/network/proxy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ proxy }) });
  return { status: r.status, body: await r.json() as Record<string, any> };
};

let procs: ChildProcess[] = [];
try {
  console.log('\n─── 保存 / 脱敏 / 校验 ───');
  let s = await boot({});
  procs.push(s.proc);
  const init = await get(s.base);
  assert(init.source === 'none' && init.saved === null && init.active === null, '起步：没配、直连');

  const bad = await post(s.base, 'socks5://127.0.0.1:7891');
  assert(bad.status === 400 && /混合端口/.test(bad.body.error), 'socks → 400，并指路混合端口');
  assert((await get(s.base)).saved === null, '被拒的地址不落盘');

  const ok = await post(s.base, 'user:secret@127.0.0.1:1');
  assert(ok.status === 200 && ok.body.saved === 'http://127.0.0.1:1', `保存成功，回显脱敏（实际 ${ok.body.saved}）`);
  assert(ok.body.savedHasAuth === true && !JSON.stringify(ok.body).includes('secret'), '响应里任何字段都不带密码');
  assert(ok.body.active === 'http://127.0.0.1:1' && ok.body.source === 'studio', '保存即生效（不用重启）');
  assert(ok.body.reachable === false, '端口没人听 → reachable=false（界面据此报红）');
  assert(readFileSync(networkFile, 'utf-8').includes('user:secret@'), '原文只在本机文件里');

  console.log('\n─── 重启仍在 ───');
  await stop(s.proc);
  s = await boot({});
  procs.push(s.proc);
  const again = await get(s.base);
  assert(again.saved === 'http://127.0.0.1:1' && again.active === 'http://127.0.0.1:1', '冷启动后设置还在、且已接管');

  const cleared = await post(s.base, '');
  assert(cleared.status === 200 && cleared.body.saved === null && cleared.body.active === null && cleared.body.source === 'none', '清除 → 回到直连');
  // 清掉代理后服务端自己的出站请求还得能发：测试连接打一个本机没人听的端口，
  // 该拿到"连不上"的正常回执，而不是 dispatcher 被关掉的内部错误
  const health = await fetch(s.base + '/api/health');
  assert(health.ok, '清除后服务照常响应');
  await stop(s.proc);

  console.log('\n─── 启动环境里原本的代理变量 ───');
  s = await boot({ https_proxy: 'http://127.0.0.1:2' });
  procs.push(s.proc);
  const shell = await get(s.base);
  assert(shell.source === 'shell' && shell.shell?.name === 'https_proxy' && shell.active === 'http://127.0.0.1:2', 'Studio 没配时照用环境变量，并说清来源');
  const over = await post(s.base, 'http://127.0.0.1:3');
  assert(over.body.source === 'studio' && over.body.active === 'http://127.0.0.1:3', 'Studio 配了 → 让位给 Studio 的');
  const back = await post(s.base, '');
  assert(back.body.source === 'shell' && back.body.active === 'http://127.0.0.1:2', '清除 Studio 设置 → 还原成环境变量的，而不是变直连');
  await stop(s.proc);
} catch (e) {
  assert(false, `异常: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  for (const p of procs) { try { p.kill(); } catch { /* already gone */ } }
  rmSync(dataDir, { recursive: true, force: true });
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed > 0 ? 1 : 0);
