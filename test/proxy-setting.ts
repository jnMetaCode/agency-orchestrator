/**
 * Studio 的「网络代理」设置（issue #105）。
 *
 * 真实缺口：AO 会走 HTTP(S)_PROXY，但桌面版从 Dock / 开始菜单启动，拿不到用户 shell 里的变量，
 * 对那批用户"支持代理"等于不支持。这里钉：
 *   1. 地址规整：裸 host:port 能用、socks 拒绝时**告诉用户混合端口就是 HTTP 代理**、其它协议拒绝；
 *   2. 落到 env：Studio 填的优先于 shell；**清除时还原 shell 原样**而不是一删了之；
 *   3. 运行中改代理两个方向都真的生效——尤其「清掉之后请求确实直连」：只清记忆化不换 dispatcher
 *      的话，界面显示未配置、流量还在走旧代理，是最难查的那类故障；
 *   4. 存盘文件损坏不让 Studio 起不来。
 */
import http from 'node:http';
import { connect as netConnect } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installEnvProxy, reinstallEnvProxy, resetEnvProxyForTest } from '../src/utils/env-proxy.js';
import {
  applyProxySetting,
  normalizeProxyInput,
  readProxySetting,
  snapshotProxyEnv,
  writeProxySetting,
} from '../src/utils/proxy-setting.js';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; }
}
const listen = async (srv: http.Server): Promise<number> => {
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  return (srv.address() as { port: number }).port;
};

console.log('\n─── 地址规整 ───');
{
  const bare = normalizeProxyInput('127.0.0.1:7890');
  assert(bare.ok && bare.url === 'http://127.0.0.1:7890', '裸 host:port 自动补 http://（Clash 面板上抄下来的就是这种）');
  const full = normalizeProxyInput('  "http://127.0.0.1:7890/"  ');
  assert(full.ok && full.url === 'http://127.0.0.1:7890', '去引号、去空白、去尾斜杠');
  const auth = normalizeProxyInput('http://user:p%40ss@proxy.corp:8080');
  assert(auth.ok && auth.url === 'http://user:p%40ss@proxy.corp:8080', '带账号密码的公司代理原样保留（含转义）');
  const socks = normalizeProxyInput('socks5://127.0.0.1:7891');
  assert(!socks.ok && /混合端口/.test(socks.error) && /7890/.test(socks.error), 'socks 拒绝，并说清混合端口就是 HTTP 代理');
  const ftp = normalizeProxyInput('ftp://x:21');
  assert(!ftp.ok && /http/.test(ftp.error), '其它协议拒绝');
  assert(!normalizeProxyInput('').ok, '空串不是合法地址（清除由调用方先处理）');
  assert(!normalizeProxyInput('http://').ok, '解析不了的地址拒绝');
}

console.log('\n─── 落到 env：Studio 优先，清除时还原 shell 原样 ───');
{
  const env = { https_proxy: 'http://shell:1', ALL_PROXY: 'socks5://shell:2', PATH: '/bin' } as NodeJS.ProcessEnv;
  const snap = snapshotProxyEnv(env);
  assert(snap.https_proxy === 'http://shell:1' && snap.ALL_PROXY === 'socks5://shell:2' && !('PATH' in snap), '快照只拍代理变量');

  applyProxySetting('http://127.0.0.1:7890', snap, env);
  assert(env.HTTPS_PROXY === 'http://127.0.0.1:7890' && env.https_proxy === 'http://127.0.0.1:7890'
    && env.HTTP_PROXY === 'http://127.0.0.1:7890' && env.http_proxy === 'http://127.0.0.1:7890', '大小写四个变量都写（curl 系读小写，Node 系读大写）');
  assert(env.ALL_PROXY === undefined, 'shell 里的 ALL_PROXY 让位——留着会让部分 CLI 走另一个代理');
  assert(env.PATH === '/bin', '不碰无关变量');

  applyProxySetting('', snap, env);
  assert(env.https_proxy === 'http://shell:1' && env.ALL_PROXY === 'socks5://shell:2', '清除 Studio 设置 → 还原 shell 原样');
  assert(env.HTTPS_PROXY === undefined && env.HTTP_PROXY === undefined, 'Studio 写进去的不残留');
}

console.log('\n─── 存盘 ───');
{
  const dir = mkdtempSync(join(tmpdir(), 'ao-proxy-setting-'));
  const file = join(dir, '.local', 'web-network.json');
  assert(readProxySetting(file) === '', '文件不存在 = 没配');
  writeProxySetting(file, 'http://127.0.0.1:7890');
  assert(readProxySetting(file) === 'http://127.0.0.1:7890', '写入后读回');
  writeProxySetting(file, '');
  assert(readProxySetting(file) === '' && !/proxy/.test(readFileSync(file, 'utf-8')), '清除后文件里不留地址');
  writeFileSync(file, '{not json', 'utf-8');
  assert(readProxySetting(file) === '', '文件损坏当没配（坏设置不该让 Studio 起不来）');
  writeFileSync(file, JSON.stringify({ proxy: 'socks5://127.0.0.1:7891' }), 'utf-8');
  assert(readProxySetting(file) === '', '手改成不支持的协议也当没配，而不是启动就装一个必败的代理');
  rmSync(dir, { recursive: true, force: true });
}

console.log('\n─── 运行中换代理 / 清代理：两个方向都真的生效 ───');
{
  resetEnvProxyForTest();
  const target = http.createServer((_req, res) => { res.writeHead(200); res.end('from-target'); });
  const targetPort = await listen(target);
  // undici 的 ProxyAgent 对 http 目标也走 CONNECT，假代理必须处理 'connect'（见 test/env-proxy.ts）
  const mkProxy = async (hits: string[]) => {
    const p = http.createServer();
    p.on('connect', (req, clientSocket, head) => {
      hits.push(String(req.url));
      const upstream = netConnect(targetPort, '127.0.0.1', () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head?.length) upstream.write(head);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      });
      upstream.on('error', () => clientSocket.destroy());
      clientSocket.on('error', () => upstream.destroy());
    });
    return { server: p, port: await listen(p) };
  };
  const hitsA: string[] = [];
  const hitsB: string[] = [];
  const a = await mkProxy(hitsA);
  const b = await mkProxy(hitsB);
  // target.test 本机解析不了：能拿到 from-target 就只可能是经代理转出去的
  const get = () => fetch('http://target.test:18080/x').then((x) => x.text()).catch((e) => `ERR ${e?.cause?.code || e?.message}`);

  const env = {} as NodeJS.ProcessEnv;
  const none = await installEnvProxy(env);
  assert(none.installed === false, '起步：没配代理');

  applyProxySetting(`http://127.0.0.1:${a.port}`, {}, env);
  const r1 = await reinstallEnvProxy(env);
  assert(r1.installed === true && r1.via === `http://127.0.0.1:${a.port}`, '从没配到配上：接管');
  assert((await get()) === 'from-target' && hitsA.length === 1, `请求走代理 A（A 收到 ${hitsA.length} 次）`);

  applyProxySetting(`http://127.0.0.1:${b.port}`, {}, env);
  const r2 = await reinstallEnvProxy(env);
  assert(r2.via === `http://127.0.0.1:${b.port}`, '换成代理 B');
  assert((await get()) === 'from-target' && hitsB.length === 1 && hitsA.length === 1, `新请求走 B、不再走 A（A=${hitsA.length} B=${hitsB.length}）`);

  applyProxySetting('', {}, env);
  const r3 = await reinstallEnvProxy(env);
  assert(r3.installed === false && r3.reason === 'no-env', '清掉：状态回到未接管');
  const direct = await get();
  assert(direct.startsWith('ERR') && hitsA.length === 1 && hitsB.length === 1,
    `清掉之后不再经过任何代理（target.test 解析失败才对；实际 ${direct}，A=${hitsA.length} B=${hitsB.length}）`);
  // 光看"失败了"不够：旧 dispatcher 被 close 之后请求同样会失败。必须证明网络还**能用**——
  // 不换回直连 dispatcher 的话，清掉代理 = Studio 从此所有请求全挂（变异测试验过这条会红）。
  const alive = await fetch(`http://127.0.0.1:${targetPort}/x`).then((x) => x.text()).catch((e) => `ERR ${e?.cause?.code || e?.message}`);
  assert(alive === 'from-target', `清掉之后普通请求照常能发（实际 ${alive}）`);

  a.server.close(); b.server.close(); target.close();
  a.server.closeAllConnections?.(); b.server.closeAllConnections?.(); target.closeAllConnections?.();
  resetEnvProxyForTest();
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed > 0 ? 1 : 0);
