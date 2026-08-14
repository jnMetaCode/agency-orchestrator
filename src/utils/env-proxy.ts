/**
 * 让 AO 自己的 HTTP 请求走环境里配的代理。
 *
 * 为什么需要这个模块：**Node 的 `fetch` 默认不读 `HTTP(S)_PROXY`**（curl、浏览器都读）。
 * 于是在"必须走代理才能访问 OpenAI / Gemini / xAI / Anthropic 官方端点"的机器上，
 * 用户 curl 验得好好的地址，AO 一跑就是 `fetch failed / UND_ERR_CONNECT_TIMEOUT`，
 * 然后一路去怀疑 base_url、key、最后怀疑我们的代码。
 *
 * 做法：环境里确实配了代理时，才接管全局 dispatcher（Node 内置 fetch 用的就是这个
 * dispatcher，用户态 undici 设的能生效——已实测）。
 *
 * 没用 undici 现成的 `EnvHttpProxyAgent`：它自己去读 `process.env`，**且忽略显式传入的
 * httpProxy/httpsProxy**（实测：传了假代理地址，请求仍打到 env 里那个真代理）。这会造成
 * 最难查的一类故障——"看着接管了，实际走的是另一个代理"，而且测试根本没法隔离。
 * 这里改成自己按 origin 路由：命中 no_proxy 的走直连 Agent，其余走 ProxyAgent，
 * 参数从哪来一目了然，行为可测。
 *
 * 三条自我约束：
 *  1. **没配代理就什么都不做** —— 绝大多数用户（走国内中转商的）行为一个字节都不变；
 *  2. **回环地址一律不走代理** —— Ollama、Studio 自己的 127.0.0.1、测试里的假端点都在本机，
 *     经代理绕一圈轻则变慢重则直接不通。curl 也不自动排除回环，但那是它的历史包袱，
 *     不该照抄；
 *  3. **`AO_NO_PROXY=1` 是逃生开关** —— 代理接管属于"改全局网络行为"，必须留一条退路。
 *
 * undici 装不上/加载失败一律**降级为原来的行为**（不代理）而不是报错退出：连不上顶多是
 * 一次失败，因为一个可选依赖起不来才是真的坏。
 */

/** 常见的代理环境变量名，按优先级排（https 优先于 http，与 curl 一致）。 */
const PROXY_ENV_NAMES = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'] as const;

/** 本机地址：即便配了代理也直连（见文件头第 2 条）。 */
const LOOPBACK_NO_PROXY = ['localhost', '127.0.0.1', '::1', '0.0.0.0'];

export interface EnvProxyResult {
  /** 是否真的接管了全局 dispatcher */
  installed: boolean;
  /** 为什么是这个结果 —— doctor 与错误提示要据此说不同的话 */
  reason: 'installed' | 'no-env' | 'disabled' | 'unavailable';
  /** 生效的代理地址（**已抹掉账号密码**，只留 scheme://host:port） */
  via?: string;
  /** 命中的环境变量名（诊断用） */
  envName?: string;
  /** unavailable 时的具体原因 */
  detail?: string;
}

/** 代理地址里常带 `user:pass@`——回显前一律抹掉，绝不进日志/报错。 */
export function maskProxyUrl(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s.includes('://') ? s : `http://${s}`);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '(无法解析)';
  }
}

/** 环境里配的第一个代理变量（名字 + 已脱敏的地址）；没配返回 null。 */
export function detectEnvProxy(env: NodeJS.ProcessEnv = process.env): { name: string; url: string } | null {
  const name = PROXY_ENV_NAMES.find((n) => (env[n] || '').trim());
  return name ? { name, url: maskProxyUrl(String(env[name])) } : null;
}

/** 用户显式关掉了代理接管（`AO_NO_PROXY=1/true/yes`）。 */
export function proxyDisabledByUser(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|yes|on)$/i.test(String(env.AO_NO_PROXY || '').trim());
}

/**
 * 把回环地址并进 no_proxy（保留用户自己写的），这样本机服务不会被绕进代理。
 * 只回值不改 process.env —— 副作用留给调用方，测试才好断言。
 */
export function buildNoProxy(env: NodeJS.ProcessEnv = process.env): string {
  const existing = String(env.NO_PROXY || env.no_proxy || '').trim();
  const have = new Set(existing.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  const merged = [...have];
  for (const h of LOOPBACK_NO_PROXY) if (!have.has(h)) merged.push(h);
  return merged.join(',');
}

/** 只用到这几个成员，不引 undici 的类型（它是可选依赖，类型不该成为硬依赖）。 */
interface Dispatcherish {
  dispatch(opts: unknown, handler: unknown): boolean;
  close?(): Promise<void>;
  destroy?(err?: unknown): Promise<void>;
}

/**
 * 这个目标要不要绕过代理。no_proxy 的通行语义：
 *  - `*` 全部直连；
 *  - 精确匹配主机名；
 *  - `example.com` 同时匹配它的子域（`a.example.com`），写成 `.example.com` 也认。
 * 端口不参与匹配（与 curl 的常见用法一致，够用且不易误伤）。
 */
export function shouldBypassProxy(origin: string, noProxy: string[]): boolean {
  if (!origin) return false;
  let host = '';
  try { host = new URL(origin).hostname.toLowerCase(); } catch { return false; }
  if (!host) return false;
  for (const rule of noProxy) {
    if (rule === '*') return true;
    const r = rule.replace(/^\./, '');
    if (host === r || host.endsWith(`.${r}`)) return true;
  }
  return false;
}

let cached: Promise<EnvProxyResult> | null = null;
let last: EnvProxyResult = { installed: false, reason: 'no-env' };

/** 最近一次安装结果（同步读，给报错文案/doctor 用）。 */
export function envProxyStatus(): EnvProxyResult {
  return last;
}

/**
 * 按环境变量接管全局 dispatcher。**幂等**：多次调用只装一次。
 * 入口处调用（CLI / 引擎 run / web server），越早越好——装之前发出的请求不受影响。
 */
export async function installEnvProxy(env: NodeJS.ProcessEnv = process.env): Promise<EnvProxyResult> {
  if (cached) return cached;
  cached = (async (): Promise<EnvProxyResult> => {
    const found = detectEnvProxy(env);
    if (!found) return { installed: false, reason: 'no-env' };
    if (proxyDisabledByUser(env)) {
      return { installed: false, reason: 'disabled', via: found.url, envName: found.name };
    }
    try {
      const undici = await import('undici');
      const { ProxyAgent, Agent, setGlobalDispatcher } = undici as unknown as {
        ProxyAgent: new (url: string) => Dispatcherish;
        Agent: new () => Dispatcherish;
        setGlobalDispatcher: (d: unknown) => void;
      };
      if (typeof ProxyAgent !== 'function' || typeof Agent !== 'function' || typeof setGlobalDispatcher !== 'function') {
        return { installed: false, reason: 'unavailable', via: found.url, envName: found.name, detail: 'undici 缺少 ProxyAgent/Agent' };
      }
      const proxyUrl = String(env[found.name]).trim();
      const noProxy = buildNoProxy(env).split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
      const viaProxy = new ProxyAgent(proxyUrl);
      const direct = new Agent();
      // 全局 dispatcher = 一个按目标 origin 分流的壳：本机/no_proxy 命中走直连，其余走代理。
      // undici 只要求它有 dispatch；close/destroy 一并转发，免得连接池泄漏。
      const router = {
        dispatch(opts: { origin?: string | URL }, handler: unknown) {
          const origin = typeof opts?.origin === 'string' ? opts.origin : opts?.origin?.href ?? '';
          return (shouldBypassProxy(origin, noProxy) ? direct : viaProxy).dispatch(opts, handler);
        },
        close: () => Promise.all([viaProxy.close?.(), direct.close?.()]).then(() => undefined),
        destroy: (err?: unknown) => Promise.all([viaProxy.destroy?.(err), direct.destroy?.(err)]).then(() => undefined),
      };
      setGlobalDispatcher(router);
      return { installed: true, reason: 'installed', via: found.url, envName: found.name };
    } catch (err) {
      // 装不上就退回原行为（不代理）——为一个可选依赖崩掉整个进程是本末倒置
      return {
        installed: false,
        reason: 'unavailable',
        via: found.url,
        envName: found.name,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  })().then((r) => {
    last = r;
    return r;
  });
  return cached;
}

/** 仅测试用：清掉记忆化，让下一次调用重新判定。 */
export function resetEnvProxyForTest(): void {
  cached = null;
  last = { installed: false, reason: 'no-env' };
}
