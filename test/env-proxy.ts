/**
 * 代理接管：让 AO 自己的请求走 `HTTP(S)_PROXY`。
 *
 * 真实故障：Node 的 fetch **默认不读**这些变量（curl、浏览器都读），于是在"必须走代理
 * 才能访问 OpenAI / Gemini / xAI / Anthropic 官方端点"的机器上，用户 curl 验得好好的地址，
 * AO 一跑就是 `fetch failed / UND_ERR_CONNECT_TIMEOUT`，然后一路去怀疑 base_url 和 key。
 *
 * 这里钉四件事（每一条都对应一种"修好了反而更糟"的失败）：
 *   1. 配了代理 → 请求真的从代理走（不是只把提示语改好看了）；
 *   2. **本机地址永远直连** —— 否则 Ollama、Studio 自己的 127.0.0.1、以及本套测试里的
 *      假端点全会被绕进代理，等于给所有本地用户制造新故障；
 *   3. `AO_NO_PROXY=1` 能关掉（改全局网络行为必须留退路）；
 *   4. 代理地址里的账号密码不进日志。
 */
import http from 'node:http';
import { connect as netConnect } from 'node:net';
import {
  buildNoProxy,
  detectEnvProxy,
  installEnvProxy,
  maskProxyUrl,
  proxyDisabledByUser,
  resetEnvProxyForTest,
} from '../src/utils/env-proxy.js';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; }
}
const listen = async (srv: http.Server): Promise<number> => {
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  return (srv.address() as { port: number }).port;
};

console.log('\n─── 代理变量的识别与脱敏 ───');

assert(detectEnvProxy({} as NodeJS.ProcessEnv) === null, '没配代理时返回 null（不制造噪音）');
assert(detectEnvProxy({ HTTPS_PROXY: 'http://127.0.0.1:7890' } as NodeJS.ProcessEnv)?.name === 'HTTPS_PROXY', '识别 HTTPS_PROXY');
assert(detectEnvProxy({ https_proxy: 'http://127.0.0.1:7890' } as NodeJS.ProcessEnv)?.name === 'https_proxy', '小写写法同样认（很多人只 export 小写的）');
// https 优先于 http，与 curl 一致
assert(
  detectEnvProxy({ HTTP_PROXY: 'http://a:1', HTTPS_PROXY: 'http://b:2' } as NodeJS.ProcessEnv)?.name === 'HTTPS_PROXY',
  '两个都配时 https 优先',
);
assert(maskProxyUrl('http://alice:s3cret@proxy.internal:8080') === 'http://proxy.internal:8080', '抹掉代理地址里的账号密码');
assert(!maskProxyUrl('http://alice:s3cret@proxy.internal:8080').includes('s3cret'), '密码绝不出现在回显里');
assert(maskProxyUrl('127.0.0.1:7890') === 'http://127.0.0.1:7890', '没写协议时按 http 补全');

assert(proxyDisabledByUser({ AO_NO_PROXY: '1' } as NodeJS.ProcessEnv), 'AO_NO_PROXY=1 视为关闭');
assert(proxyDisabledByUser({ AO_NO_PROXY: 'true' } as NodeJS.ProcessEnv), 'true 同样视为关闭');
assert(!proxyDisabledByUser({ AO_NO_PROXY: '0' } as NodeJS.ProcessEnv), 'AO_NO_PROXY=0 不算关闭');
assert(!proxyDisabledByUser({} as NodeJS.ProcessEnv), '没设就不算关闭');

console.log('\n─── no_proxy 合并（本机地址永远直连） ───');
{
  const merged = buildNoProxy({} as NodeJS.ProcessEnv).split(',');
  for (const h of ['localhost', '127.0.0.1', '::1']) {
    assert(merged.includes(h), `默认排除 ${h}`);
  }
  const withUser = buildNoProxy({ NO_PROXY: 'corp.example.com' } as NodeJS.ProcessEnv).split(',');
  assert(withUser.includes('corp.example.com'), '用户自己写的 no_proxy 要保留');
  assert(withUser.includes('localhost'), '保留用户配置的同时仍排除本机');
  const dedup = buildNoProxy({ no_proxy: 'localhost' } as NodeJS.ProcessEnv).split(',').filter((h) => h === 'localhost');
  assert(dedup.length === 1, '用户已经写了 localhost 时不重复添加');
}

console.log('\n─── 真的从代理走（起一个会做 CONNECT 隧道的假代理） ───');
{
  resetEnvProxyForTest();
  // undici 的 ProxyAgent **对 http 目标也走 CONNECT 隧道**（不是发绝对地址的普通请求），
  // 所以假代理必须处理 'connect' 事件；用 http.createServer 的 request 回调是收不到的
  // —— 这一点踩过：假代理"没收到请求"看着像产品代码没接管，其实是测试的代理不合格。
  const target = http.createServer((_req, res) => { res.writeHead(200); res.end('from-target'); });
  const targetPort = await listen(target);

  const connects: string[] = [];
  const proxy = http.createServer();
  proxy.on('connect', (req, clientSocket, head) => {
    connects.push(String(req.url));
    // 隧道到本机的目标服务：请求里的主机名（target.test）在本机根本解析不了，
    // 能拿到响应就只可能是经由这个代理转出去的
    const upstream = netConnect(targetPort, '127.0.0.1', () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstream.destroy());
  });
  const proxyPort = await listen(proxy);

  const env = { HTTP_PROXY: `http://127.0.0.1:${proxyPort}`, HTTPS_PROXY: `http://127.0.0.1:${proxyPort}` } as NodeJS.ProcessEnv;
  const r = await installEnvProxy(env);
  assert(r.installed === true, `配了代理就该接管（实际 ${r.reason}${r.detail ? ': ' + r.detail : ''}）`);
  assert(r.via === `http://127.0.0.1:${proxyPort}`, '回显的代理地址正确');

  // 端口别用 9/19/25 这类：它们在 fetch 规范的 blocked ports 名单里，请求会在发出前就被拒，
  // 表现成"代理什么都没收到"，看着像接管失败（踩过）
  const body = await fetch('http://target.test:18080/x').then((x) => x.text()).catch((e) => `ERR ${e?.cause?.code || e?.message}`);
  assert(body === 'from-target', `请求确实从代理出去了（target.test 本机解析不了，实际拿到 ${body}）`);
  assert(connects.some((u) => u.startsWith('target.test:')), `代理收到了 CONNECT 目标（实际 ${JSON.stringify(connects)}）`);
  proxy.close(); target.close();
}

console.log('\n─── 本机地址不走代理（否则 Ollama / Studio / 本套测试全遭殃） ───');
{
  // 沿用上一段已装好的全局 dispatcher —— 正是"用户机器上配着代理"的真实状态
  let proxyHits = 0;
  const proxy = http.createServer((req, res) => { proxyHits++; res.writeHead(502); res.end('should not happen'); });
  const proxyPort = await listen(proxy);
  const target = http.createServer((req, res) => { res.writeHead(200); res.end('local'); });
  const targetPort = await listen(target);

  resetEnvProxyForTest();
  const env = { HTTP_PROXY: `http://127.0.0.1:${proxyPort}`, HTTPS_PROXY: `http://127.0.0.1:${proxyPort}` } as NodeJS.ProcessEnv;
  await installEnvProxy(env);

  const a = await fetch(`http://127.0.0.1:${targetPort}/x`).then((r) => r.text());
  const b = await fetch(`http://localhost:${targetPort}/x`).then((r) => r.text());
  assert(a === 'local' && b === 'local', '本机请求直达目标服务');
  assert(proxyHits === 0, `本机流量一次都不该经过代理（实际 ${proxyHits} 次）`);
  proxy.close(); target.close();
}

console.log('\n─── 开关与降级 ───');
{
  resetEnvProxyForTest();
  const off = await installEnvProxy({ HTTPS_PROXY: 'http://127.0.0.1:1', AO_NO_PROXY: '1' } as NodeJS.ProcessEnv);
  assert(off.installed === false && off.reason === 'disabled', 'AO_NO_PROXY=1 时不接管');
  assert(off.via === 'http://127.0.0.1:1', '关掉了也要能说清是哪个代理（诊断需要）');

  resetEnvProxyForTest();
  const none = await installEnvProxy({} as NodeJS.ProcessEnv);
  assert(none.installed === false && none.reason === 'no-env', '没配代理时什么都不做（绝大多数用户行为不变）');

  resetEnvProxyForTest();
  const first = await installEnvProxy({ HTTPS_PROXY: 'http://127.0.0.1:1' } as NodeJS.ProcessEnv);
  const second = await installEnvProxy({} as NodeJS.ProcessEnv);
  assert(second === first, '幂等：多次调用只装一次，后续调用直接返回同一结果');
}

// 装过全局 dispatcher 会影响同进程后续请求，这里是最后一段，跑完即退出
console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
