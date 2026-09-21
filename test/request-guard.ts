/**
 * Studio 服务端的请求来源守卫（web/request-guard.js）。
 *
 * 「只听 127.0.0.1」挡不住浏览器：用户开着 Studio 时访问的任何网页都能往回环端口发请求。
 * 这里钉的每一条要么是一种真实攻击，要么是一种"修了安全、砸了正常用法"的回归：
 *   攻击：DNS 重绑定（Host 是对方域名）、跨站表单 POST（Origin 是别人的站）、沙箱 iframe（Origin: null）；
 *   正常：localhost / 127.0.0.1 / ::1 互通、vite dev 代理、Docker 用主机名访问、反代域名走白名单、curl 无 Origin。
 * 后半段起真服务端：守卫真的挂在 /api 上、key 真的不再出现在 argv 回显里。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// @ts-expect-error 纯 JS 模块，无类型声明
import { checkRequestSource, hostnameOf, isLoopbackHost, parseAllowedHosts } from '../web/request-guard.js';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; }
}
const LOCAL = { boundHost: '127.0.0.1', allowedHosts: [] as string[] };

console.log('\n─── 回环绑定（默认安装） ───');
assert(checkRequestSource({ ...LOCAL, host: '127.0.0.1:8088' }).ok, '127.0.0.1 放行');
assert(checkRequestSource({ ...LOCAL, host: 'localhost:8088' }).ok, 'localhost 放行');
assert(checkRequestSource({ ...LOCAL, host: '[::1]:8088' }).ok, 'IPv6 回环放行');
assert(checkRequestSource({ ...LOCAL, host: 'LOCALHOST:8088', origin: 'http://localhost:8088' }).ok, '大小写不敏感');
{
  const r = checkRequestSource({ ...LOCAL, host: 'evil.example:8088', origin: 'http://evil.example:8088' });
  assert(!r.ok && r.reason === 'host', 'DNS 重绑定：Host 是对方域名 → 拒绝（此时 Origin 与 Host「同源」，只有 Host 规则拦得住）');
}
assert(!checkRequestSource({ ...LOCAL, host: '192.168.1.5:8088' }).ok, '回环绑定下局域网 IP 的 Host 也不认（它不可能是打给我们的）');
assert(!checkRequestSource({ ...LOCAL, host: '' }).ok, '空 Host 拒绝');
assert(!checkRequestSource({ ...LOCAL, host: '127.0.0.1.evil.example' }).ok, '「127.0.0.1.evil.example」不是回环');
{
  const r = checkRequestSource({ ...LOCAL, host: '127.0.0.1:8088', origin: 'https://evil.example' });
  assert(!r.ok && r.reason === 'origin', '跨站表单 POST：Origin 是别人的站 → 拒绝');
}
assert(!checkRequestSource({ ...LOCAL, host: '127.0.0.1:8088', origin: 'null' }).ok, 'Origin: null（沙箱 iframe / file://）拒绝');
assert(!checkRequestSource({ ...LOCAL, host: '127.0.0.1:8088', origin: 'garbage' }).ok, '解析不了的 Origin 拒绝');
assert(checkRequestSource({ ...LOCAL, host: 'localhost:8088', origin: 'http://localhost:5173' }).ok, 'vite dev server 代理过来（Origin 是另一个回环端口）放行');
assert(checkRequestSource({ ...LOCAL, host: '127.0.0.1:8088', origin: 'http://localhost:8088' }).ok, 'localhost ↔ 127.0.0.1 混用放行');
assert(checkRequestSource({ ...LOCAL, host: '127.0.0.1:8088' }).ok, '没有 Origin 头（curl / 脚本 / 同源 GET）不受 Origin 规则影响');

console.log('\n─── 白名单 ───');
{
  const p = { boundHost: '127.0.0.1', allowedHosts: parseAllowedHosts(' AO.Example.com , studio.lan ') };
  assert(p.allowedHosts.join() === 'ao.example.com,studio.lan', '白名单解析：去空白、转小写');
  assert(checkRequestSource({ ...p, host: 'ao.example.com', origin: 'https://ao.example.com' }).ok, '反代域名在白名单 → 放行');
  assert(!checkRequestSource({ ...p, host: 'other.example.com' }).ok, '不在白名单的域名仍拒绝');
}

console.log('\n─── 非回环绑定（Docker / NAS：部署者自己选择了暴露到局域网） ───');
{
  const lan = { boundHost: '0.0.0.0', allowedHosts: [] as string[] };
  assert(checkRequestSource({ ...lan, host: 'nas.local:8088', origin: 'http://nas.local:8088' }).ok, '用主机名访问不被升级砸掉（不强制 Host）');
  assert(checkRequestSource({ ...lan, host: '192.168.1.5:8088', origin: 'http://192.168.1.5:8088' }).ok, '用局域网 IP 访问放行');
  assert(!checkRequestSource({ ...lan, host: '192.168.1.5:8088', origin: 'https://evil.example' }).ok, '跨站 Origin 在任何绑定下都拒绝');
  const strict = { boundHost: '0.0.0.0', allowedHosts: ['nas.local'] };
  assert(!checkRequestSource({ ...strict, host: 'evil.example' }).ok, '配了白名单 → 非回环绑定也按白名单收紧');
  assert(checkRequestSource({ ...strict, host: 'nas.local:8088' }).ok, '白名单内放行');
}

console.log('\n─── 小工具 ───');
assert(hostnameOf('[::1]:8088') === '::1' && hostnameOf('a.b:1') === 'a.b' && hostnameOf('') === '', 'hostnameOf 处理 IPv6 / 端口 / 空');
assert(isLoopbackHost('127.8.9.1') && isLoopbackHost('app.localhost') && !isLoopbackHost('localhost.evil.example'), '回环判定：127/8、*.localhost 是，localhost.evil 不是');

// ── 起真服务端 ──
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise<number>((res) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); });
});
/** fetch 不让改 Host 头，用 http.request 手发。 */
const raw = (port: number, path: string, headers: Record<string, string>, method = 'GET', body?: string) =>
  new Promise<{ status: number; body: string }>((res, rej) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (r) => {
      let buf = '';
      r.on('data', (c) => { buf += c; });
      r.on('end', () => res({ status: r.statusCode || 0, body: buf }));
    });
    req.on('error', rej);
    if (body) req.write(body);
    req.end();
  });

console.log('\n─── 真服务端：守卫挂在 /api 上 ───');
const dataDir = mkdtempSync(join(tmpdir(), 'ao-web-guard-'));
let server: ChildProcess | null = null;
try {
  const port = await freePort();
  // 预置一份 0644 的老 key 文件：保存时应当被收紧到 0600
  mkdirSync(join(dataDir, '.local'), { recursive: true });
  writeFileSync(join(dataDir, '.local', 'web-keys.json'), '{}', { mode: 0o644 });
  server = spawn(process.execPath, [resolve('web/server.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', AO_NODE: process.execPath, AO_DATA_DIR: dataDir, AO_MANIFEST_URL: 'http://127.0.0.1:1/none.json' },
    stdio: 'ignore',
  });
  let up = false;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) { up = true; break; } } catch { /* not up yet */ }
    await sleep(250);
  }
  assert(up, '服务启动');
  if (up) {
    const rebind = await raw(port, '/api/config', { Host: `evil.example:${port}` });
    assert(rebind.status === 403 && /AO_ALLOWED_HOSTS/.test(rebind.body), `重绑定 Host → 403，且告诉合法用户怎么放行（实际 ${rebind.status}）`);
    assert(!/apiKey|sk-/.test(rebind.body), '403 响应里没有任何配置内容');
    const csrf = await raw(port, '/api/claude/proxy/clear', { Host: `127.0.0.1:${port}`, Origin: 'https://evil.example', 'Content-Length': '0' }, 'POST');
    assert(csrf.status === 403, `无请求体的跨站 POST（不需要预检的那种）→ 403（实际 ${csrf.status}）`);
    const okGet = await raw(port, '/api/health', { Host: `localhost:${port}` });
    assert(okGet.status === 200, '正常请求照常 200');
    const page = await raw(port, '/', { Host: `evil.example:${port}` });
    assert(page.status !== 403, '静态页不受守卫影响（只管 /api）');

    const trav = await raw(port, '/api/runs/..%2F..%2F..%2Fetc', { Host: `127.0.0.1:${port}` });
    assert(trav.status === 404, `/api/runs/:id 路径穿越 → 404（实际 ${trav.status}）`);

    // ── key 不进 argv：界面回显的命令行里不能有它，但上游必须照样收到它 ──
    {
      const KEY = 'sk-test-guard-0123456789';
      const seenAuth: string[] = [];
      const upstream = http.createServer((rq, rs) => {
        seenAuth.push(String(rq.headers.authorization || ''));
        rq.resume();
        rs.writeHead(200, { 'Content-Type': 'application/json' });
        rs.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '好的，已完成。' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
      });
      await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', () => r()));
      const upPort = (upstream.address() as { port: number }).port;
      const hdr = { Host: `127.0.0.1:${port}`, 'Content-Type': 'application/json' };
      await raw(port, '/api/config', hdr, 'POST', JSON.stringify({ provider: 'deepseek', apiKey: KEY, baseUrl: `http://127.0.0.1:${upPort}/v1`, model: 'fake-model' }));
      mkdirSync(join(dataDir, 'ao-workflows'), { recursive: true });
      const wf = join(dataDir, 'ao-workflows', 'guard.yaml');
      writeFileSync(wf, [
        'name: "guard"', 'agents_dir: "agency-agents-zh"', 'verify: false',
        'llm: { provider: "deepseek", model: "fake-model" }',
        'steps:', '  - id: only', '    role: "marketing/marketing-content-creator"', '    task: "说一句话"', '    output: out', '',
      ].join('\n'), 'utf-8');
      const run = await raw(port, '/api/run', hdr, 'POST', JSON.stringify({ file: wf, provider: 'deepseek' }));
      assert(run.status === 200 && /event: start/.test(run.body), '工作流跑起来了（SSE 有 start 事件）');
      assert(!run.body.includes(KEY), '整条 SSE 流里（含回显的命令行）都没有 key');
      assert(!/--api-key/.test(run.body), '回显的命令行里不再有 --api-key');
      assert(seenAuth.some((a) => a === `Bearer ${KEY}`), `上游照样收到了 key——经环境变量传过去的（上游看到 ${seenAuth.length} 次请求）`);
      upstream.close(); upstream.closeAllConnections?.();
    }

    if (process.platform !== 'win32') {
      const save = await raw(port, '/api/config', { Host: `127.0.0.1:${port}`, 'Content-Type': 'application/json' }, 'POST', JSON.stringify({ provider: 'deepseek', apiKey: 'sk-test-guard' }));
      const mode = statSync(join(dataDir, '.local', 'web-keys.json')).mode & 0o777;
      assert(save.status === 200 && mode === 0o600, `保存 key 后文件权限收紧到 0600，老的 0644 文件也一样（实际 ${mode.toString(8)}）`);
    }
  }
} catch (e) {
  assert(false, `异常: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  try { server?.kill(); } catch { /* already gone */ }
  rmSync(dataDir, { recursive: true, force: true });
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed > 0 ? 1 : 0);
