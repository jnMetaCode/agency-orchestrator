/**
 * Studio 的「网络代理」设置（issue #105）。
 *
 * 为什么需要：AO 早就会走 `HTTP(S)_PROXY`（见 env-proxy.ts），但那只对**从终端启动**的人有用。
 * 桌面版是从 Dock / 开始菜单点开的，进程根本拿不到用户 shell 里 export 的变量；不会设环境变量的
 * 用户更多。对他们来说"支持代理"等于不支持。
 *
 * 做法：Studio 里存一个代理地址（`<data>/.local/web-network.json`），启动时和保存时写进本进程的
 * 代理环境变量——于是三条路同时生效，不用各接一遍：
 *   1. Studio 自己的请求（测试连接、拉模型列表、远程清单）→ reinstallEnvProxy 接管 dispatcher；
 *   2. spawn 出的 `ao run` 子进程继承 env → 子进程里的 installEnvProxy 照常接管；
 *   3. 再往下的编码 CLI（claude / codex / gemini…）同样继承，它们自己认这几个变量。
 *
 * 只收 http/https 代理：undici 的 ProxyAgent 走 HTTP CONNECT，不会说 SOCKS。Clash / V2RayN /
 * sing-box 的混合端口同时就是 HTTP 代理，所以拒绝 socks 时把这一点说出来，而不是只说"不支持"。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** 写进 env 的变量名：大小写都写——curl 系工具优先读小写，Node 系多读大写。 */
const WRITE_NAMES = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'] as const;
/** 保存了 Studio 代理时要让位的变量：留着 ALL_PROXY 会让部分 CLI 走另一个代理。 */
const ALL_NAMES = [...WRITE_NAMES, 'ALL_PROXY', 'all_proxy'] as const;

export type ProxyInputResult = { ok: true; url: string } | { ok: false; error: string };

/** 规整用户填的代理地址。空串合法（= 清除），由调用方在此之前处理。 */
export function normalizeProxyInput(raw: unknown): ProxyInputResult {
  const s = String(raw ?? '').trim().replace(/^["']|["']$/g, '');
  if (!s) return { ok: false, error: '代理地址为空' };
  if (/^socks/i.test(s)) {
    return {
      ok: false,
      error: '暂不支持 SOCKS 代理。Clash / V2RayN / sing-box 的「混合端口」同时就是 HTTP 代理——填 http://127.0.0.1:<混合端口> 即可（Clash 默认 7890）',
    };
  }
  let u: URL;
  try { u = new URL(s.includes('://') ? s : `http://${s}`); }
  catch { return { ok: false, error: `代理地址无法解析：${s.slice(0, 80)}（示例：http://127.0.0.1:7890）` }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, error: `只支持 http / https 代理，收到的是 ${u.protocol.replace(':', '')}` };
  }
  if (!u.hostname) return { ok: false, error: '代理地址缺少主机名（示例：http://127.0.0.1:7890）' };
  // 只留 origin（含账号密码）——路径/query 对代理没有意义，留着只会在比较时制造"看着一样其实不等"
  const auth = u.username ? `${u.username}${u.password ? `:${u.password}` : ''}@` : '';
  return { ok: true, url: `${u.protocol}//${auth}${u.host}` };
}

/** 读已保存的代理；文件不存在/损坏/内容非法一律当没配（损坏的设置不该让 Studio 起不来）。 */
export function readProxySetting(file: string): string {
  try {
    if (!existsSync(file)) return '';
    const obj = JSON.parse(readFileSync(file, 'utf-8')) as { proxy?: unknown };
    const r = normalizeProxyInput(obj?.proxy);
    return r.ok ? r.url : '';
  } catch {
    return '';
  }
}

/** 保存（空串 = 清除）。地址里可能带账号密码，文件权限收到 0600，同 web-keys.json 的处境。 */
export function writeProxySetting(file: string, url: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(url ? { proxy: url } : {}, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
}

/** 启动时拍下用户 shell 里原本的代理变量，清除 Studio 设置时据此还原（而不是一删了之）。 */
export function snapshotProxyEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const snap: Record<string, string> = {};
  for (const n of ALL_NAMES) if ((env[n] || '').trim()) snap[n] = String(env[n]);
  return snap;
}

/**
 * 把 Studio 的代理设置落到 env 上。
 *  - 有设置：Studio 里显式填的优先于 shell 里的（用户此刻看得见、改得了的那个说了算）；
 *  - 无设置：还原成启动时的 shell 原样——清除 Studio 代理不该顺手把用户 export 的也清掉。
 */
export function applyProxySetting(url: string, shellSnapshot: Record<string, string>, env: NodeJS.ProcessEnv = process.env): void {
  for (const n of ALL_NAMES) delete env[n];
  if (url) {
    for (const n of WRITE_NAMES) env[n] = url;
  } else {
    for (const [n, v] of Object.entries(shellSnapshot)) env[n] = v;
  }
}
