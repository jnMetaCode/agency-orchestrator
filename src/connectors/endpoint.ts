/**
 * 端点地址与 HTTP 发送的公共逻辑 —— 被 OpenAI 兼容连接器、Ollama 连接器、
 * Studio 的「测试连接」和 `ao doctor` 共用，保证四处对「地址配错」的处理完全一致。
 *
 * 解决的两类真实故障：
 *  1. 配置的 base_url 与最终地址差一跳（http→https / 带不带 www / 反代规范化），
 *     上游 301/302 后 Node 按 fetch 规范把 POST 降级成 GET，端点只收 POST → 405；
 *  2. base_url 少写/多写 /v1，路径对不上 → 404/405。
 */
/** query 里这些参数是凭证，绝不留在配置/日志/错误信息里 */
const SECRET_QUERY_PARAMS = /^(key|api[-_]?key|token|access[-_]?token|auth|password|secret)$/i;

/** 把 base_url 拆成「路径部分」和「要保留的 query」——Azure 的 ?api-version= 必须留着 */
function splitQuery(url: string): { head: string; query: string } {
  const i = url.indexOf('?');
  if (i < 0) return { head: url, query: '' };
  const kept = url.slice(i + 1).split('&').filter((kv) => kv && !SECRET_QUERY_PARAMS.test(kv.split('=')[0]));
  return { head: url.slice(0, i), query: kept.join('&') };
}

/** 在 base_url 后面接端点路径。query 必须留在最后（`?api-version=` 不能被路径顶到中间去） */
export function joinEndpoint(baseUrl: string, path: string): string {
  const { head, query } = splitQuery(String(baseUrl || ''));
  const url = `${head.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  return query ? `${url}?${query}` : url;
}

/**
 * 规整用户填的 base_url —— 粘贴出错是「配了 key 却连不上」的第一大来源。
 * 处理：首尾空白/引号、缺协议、fragment、尾部斜杠、以及整条粘贴的完整端点地址
 * （`.../v1/chat/completions` → `.../v1`）。
 * query 保留（Azure 部署地址依赖 `?api-version=`），但把写在 query 里的 key 抹掉——
 * 那是凭证，该走 Authorization 头，留在这儿会漏进日志和错误信息。
 */
export function normalizeBaseUrl(raw: string | undefined | null): string {
  let s = String(raw ?? '').trim();
  if (!s) return '';
  s = s.replace(/^['"`]+|['"`]+$/g, '').trim();       // 复制时带上的引号
  // 只写了域名 → 补协议。本机地址（Ollama/自建服务）补 http，其余补 https，
  // 否则把 `localhost:11434` 补成 https 反而连不上。
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(s) || /^[^/]*\.local(:|\/|$)/i.test(s);
    s = `${isLocal ? 'http' : 'https'}://${s}`;
  }
  s = s.replace(/#.*$/, '');                           // fragment
  const { head, query } = splitQuery(s);
  // 照抄文档 curl 里的完整地址：把端点后缀去掉，只留 base
  const path = head.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '').replace(/\/completions$/i, '').replace(/\/+$/, '');
  return query ? `${path}?${query}` : path;
}

/** 跳转/换路径后请求实际打到了哪儿——错误信息和「测试连接」都要报出来 */
export interface ChatPostResult {
  response: Response;
  /** 实际发出请求的最终地址 */
  url: string;
  /** 与配置的 base_url 拼出来的地址不一致时的说明（发生了跳转 / 换了候选路径） */
  drift?: string;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 3;

/**
 * base_url 少写/多写 `/v1` 是第二大常见配错（一个填成根地址、一个把版本段写两遍）。
 * 主候选先按用户填的拼，404/405 时自动试另一种拼法。
 * Azure 的路径形如 `/openai/deployments/<name>`，不做 /v1 猜测。
 */
export function chatEndpointCandidates(baseUrl: string, opts?: { azure?: boolean }): string[] {
  return endpointCandidates(baseUrl, 'chat/completions', opts);
}

/** 同上，但端点路径可指定 —— Anthropic 协议的中转要打 `messages`，坑完全一样 */
export function endpointCandidates(baseUrl: string, path: string, opts?: { azure?: boolean }): string[] {
  const base = String(baseUrl || '');
  const primary = joinEndpoint(base, path);
  if (opts?.azure) return [primary];
  const { head, query } = splitQuery(base);
  const basePath = head.replace(/\/+$/, '');
  const alt = /\/v\d+$/.test(basePath)
    ? basePath.replace(/\/v\d+$/, '')       // 多写了版本段 → 回落到根路径
    : `${basePath}/v1`;                      // 少写了 /v1 → 补上
  return [primary, joinEndpoint(query ? `${alt}?${query}` : alt, path)];
}

/**
 * 「确实是 Azure 部署地址」的严格判定 —— 只用来决定要不要放弃 /v1 兜底。
 * isAzure（决定 api-key 头 / token 参数名）沿用宽松匹配保持既有行为；但宽松匹配会把
 * 任何域名里带 "azure" 字样的中转也算进来，那些端点其实是普通 OpenAI 兼容站，
 * 不该因此丢掉 /v1 兜底能力。
 */
export function isAzureDeploymentUrl(baseUrl: string): boolean {
  const s = String(baseUrl || '');
  return /\.azure\.com|\.azure-api\.net/i.test(s) || /\/openai\/deployments\//i.test(s);
}

/**
 * 跳转后是否还能安全带上 Authorization：同 host，或互为父子域（api.x.com ↔ x.com ↔ www.x.com，
 * 这正是「差一跳」最常见的形态），或本机；否则宁可 401 也不把 key 送到别的域。
 *
 * 不用「取最后两段域名」判同域：那对 example.co.uk 这类多段 TLD 会把 evil.co.uk 也算成同域，
 * 等于跳转就能把用户的 key 骗走。
 */
export function sameCredentialScope(from: URL, to: URL): boolean {
  const local = (h: string) => h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
  if (to.protocol !== 'https:' && !local(to.hostname)) return false;
  const a = from.hostname.toLowerCase();
  const b = to.hostname.toLowerCase();
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

function stripAuth(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([k]) => !/^(authorization|api-key|x-api-key)$/i.test(k)),
  );
}

/** 手动跟随跳转，**保持 POST 和请求体**。Node/undici 按 fetch 规范会把 301/302 的 POST 降级成 GET，
 *  而上游的 /chat/completions 只收 POST → 回 405 `{"detail":"Method Not Allowed"}`，
 *  用户看到的就是「配好了 key 却一点就报 405」。这里自己跟跳转，绕开这个降级。 */
async function postPreservingMethod(
  url: string,
  opts: { headers: Record<string, string>; body: string; signal?: AbortSignal; onNotice?: (msg: string) => void },
): Promise<ChatPostResult> {
  let target = url;
  let headers = { ...opts.headers };
  let drift: string | undefined;
  for (let hop = 0; ; hop++) {
    const response = await fetch(target, {
      method: 'POST', headers, body: opts.body, signal: opts.signal, redirect: 'manual',
    });
    const loc = response.headers.get('location');
    if (!REDIRECT_STATUSES.has(response.status) || !loc || hop >= MAX_REDIRECTS) {
      return { response, url: target, drift };
    }
    await response.body?.cancel().catch(() => {});
    const next = new URL(loc, target);
    if (!sameCredentialScope(new URL(target), next)) {
      headers = stripAuth(headers);
      opts.onNotice?.(`⚠️  跳转到了不同域名 ${next.origin}，出于安全未带上 API key（请把 base_url 直接改成最终地址）`);
    }
    opts.onNotice?.(`🔄 ${target} 被 ${response.status} 跳转到 ${next.href}，已保持 POST 重发（建议把 base_url 改成最终地址）`);
    drift = `${url} → ${next.href}`;
    target = next.href;
  }
}

/**
 * 这次 4xx 是「地址没走对」还是「API 层的业务错误」？
 * 405 = 方法不匹配，必是路由没走对；404 则要看内容 —— 不少聚合商用 404 表示「模型不存在」，
 * 那是已经进到 API 层的正经报错，不能拿去试别的路径（否则会用一条更没信息量的
 * `{"detail":"Not Found"}` 盖掉「模型不存在」这种真正有用的提示）。
 *
 * 判据是「这条报错在说模型吗」，而不是「有没有 error 字段」：Anthropic 协议的端点
 * 连路径不存在都回 `{"type":"error","error":{"type":"not_found_error"}}`，
 * 按有无 error 字段判会把整条 Anthropic 中转链路的路径兜底全掐掉。
 */
/**
 * 「HTTP 200，但正文其实是网关在说『接口不存在』」——有的中转商（LanoX 实测）对不存在的
 * 路径不回 404，而是 `200 {"data":null,"code":"404","codeMsg":"接口不存在"}`。
 * 按状态码判路径的逻辑对它全线失效：/v1 兜底不会触发，解析又捞不到 content，
 * 最终表现成最难查的那种失败——「跑完了，什么都没生成」。
 *
 * 判据保守：正文里带 404/405 的业务码，且**没有**任何成功响应必有的字段。真·成功响应
 * 即便正文里恰好出现 "code":"404" 字样（模型把它写进回答里）也一定带 choices/content。
 */
export function isGatewayRouteMissShell(text: string): boolean {
  const s = String(text || '').slice(0, 1000);
  if (!/"code"\s*:\s*"?(404|405)"?/.test(s)) return false;
  if (/"choices"|"content"|"delta"|"message"\s*:\s*\{/.test(s)) return false;
  return true;
}

async function isRoutingMiss(response: Response): Promise<boolean> {
  if (response.status === 405) return true;
  if (response.status === 200) {
    // 只在 JSON 正文上判：成功的流式响应是 text/event-stream，clone 后读它等于把整段流
    // 缓冲住（连接器还要边收边解析），代价远大于这点兜底。
    if (!/application\/json/i.test(response.headers.get('content-type') || '')) return false;
    return isGatewayRouteMissShell(await response.clone().text().catch(() => ''));
  }
  if (response.status !== 404) return false;
  // clone 读一份，别把 body 消费掉——调用方还要拿它做错误信息
  const body = await response.clone().text().catch(() => '');
  return !/model|deployment/i.test(body.slice(0, 400));
}

/**
 * 向 OpenAI 兼容端点发起一次 chat/completions 请求，顺带修掉两类「配错就 405/404」的坑：
 *  1. 跳转把 POST 降级成 GET（见 postPreservingMethod）
 *  2. base_url 少写/多写 /v1（404/405 自动试另一种拼法）
 * 连接器与 Studio 的「测试连接」共用这一份，避免出现「测试通过但运行失败」。
 */
export async function postChatCompletions(opts: {
  baseUrl: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
  /** 已确认可用的完整地址：传了就不再探测候选（同一连接器的后续请求复用） */
  endpoint?: string;
  azure?: boolean;
  onNotice?: (msg: string) => void;
}): Promise<ChatPostResult> {
  return postApiEndpoint({ ...opts, path: 'chat/completions' });
}

/**
 * 同上，但端点路径可指定。Anthropic 协议的中转（Claude Code 那条）打的是 `messages`，
 * 踩的坑一模一样：地址差一跳被 301/302 降级成 GET、base 少写/多写 /v1。
 */
export async function postApiEndpoint(opts: {
  baseUrl: string;
  path: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
  endpoint?: string;
  azure?: boolean;
  onNotice?: (msg: string) => void;
}): Promise<ChatPostResult> {
  const candidates = opts.endpoint ? [opts.endpoint] : endpointCandidates(opts.baseUrl, opts.path, { azure: opts.azure });
  let result!: ChatPostResult;
  for (let i = 0; i < candidates.length; i++) {
    result = await postPreservingMethod(candidates[i], opts);
    if (i === candidates.length - 1 || !(await isRoutingMiss(result.response))) break;
    await result.response.body?.cancel().catch(() => {});
    // 200 那种「正文里才写着接口不存在」的，报状态码没意义，说人话
    const why = result.response.status === 200 ? '返回了「接口不存在」' : `返回 ${result.response.status}`;
    opts.onNotice?.(`🔄 ${candidates[i]} ${why}，改用 ${candidates[i + 1]} 重试…`);
  }
  if (!result.drift && result.url !== candidates[0]) result.drift = `${candidates[0]} → ${result.url}`;
  return result;
}

/**
 * 「curl 能通，AO 连不上」的头号原因：环境里配了代理，而 **Node 的 fetch 默认不读
 * `HTTP(S)_PROXY`**（curl、浏览器都读）。表现是 `fetch failed / UND_ERR_CONNECT_TIMEOUT`，
 * 而用户刚用 curl 验过同一个地址是通的，于是会一路去怀疑 base_url、key、甚至我们的代码。
 *
 * 这里只负责**把话说清楚**，不擅自改全局网络行为。检测到代理变量就在报错里点破。
 * 代理地址里可能带账号密码（`http://user:pass@host`）—— 只回显 scheme://host:port，
 * 绝不把凭证打进日志。
 */
export function envProxyHint(env: NodeJS.ProcessEnv = process.env): string {
  const names = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'];
  const hit = names.find((n) => (env[n] || '').trim());
  if (!hit) return '';
  const raw = String(env[hit]).trim();
  let shown = raw;
  try {
    const u = new URL(raw.includes('://') ? raw : `http://${raw}`);
    shown = `${u.protocol}//${u.host}`;   // 丢掉可能存在的 user:pass
  } catch { shown = '(无法解析)'; }
  return [
    `检测到代理环境变量 ${hit}=${shown}，但 Node 的 fetch 默认不走它（curl / 浏览器会走）——`,
    `  "curl 能通、AO 连不上" 基本都是这个原因，别急着怀疑 base_url 或 key。`,
    `  可选做法：① 换用不需要代理的中转商端点（Studio 供应商页有一批）；`,
    `  ② 用支持 --use-env-proxy 的 Node 版本启动（\`node --help | grep -i proxy\` 可确认你的 Node 有没有这个开关）；`,
    `  ③ 让代理软件开启系统级 TUN/透明代理，使 Node 的直连也被接管。`,
  ].join('\n  ');
}

/** 把 HTTP 错误码翻成用户能照做的排查话术（连接器与「测试连接」共用） */
export function endpointHint(status: number, url: string, baseUrl: string, drift?: string): string {
  const lines = [`请求地址: POST ${url}`];
  if (drift) lines.push(`发生了跳转/换路径: ${drift} —— 建议把 base_url 直接改成最终地址`);
  if (status === 404 || status === 405) {
    lines.push(
      status === 405
        ? '405 = 地址存在但不接受 POST：多为 base_url 被 301/302 跳转（http→https、带不带 www）后请求被降级成 GET，或填成了网页/控制台地址'
        : '404 = 该地址不存在',
      `核对 base_url（当前 ${baseUrl || '(空)'}）：应是 API 接入点（多为 .../v1），不要填官网首页、也不要带 /chat/completions；本次已自动试过带/不带 /v1 两种拼法`,
      '改的地方：Studio 在「供应商」面板里改，CLI 用 --base-url 或对应的 *_BASE_URL 环境变量',
      '若该中转商只提供 Anthropic 协议端点，请改用「Claude Code 中转」那栏配置，OpenAI 兼容这栏用不了',
    );
  } else if (status >= 300 && status < 400) {
    lines.push(`${status} = 还在跳转：跳了 ${MAX_REDIRECTS} 次仍没到终点，多为 base_url 指向了会反复重定向的地址，请直接填中转商文档里的最终地址`);
  } else if (status === 401 || status === 403) {
    lines.push('401/403 = 鉴权没过：核对 API key 是否复制完整、是否与该 base_url 属于同一家、账号是否还有额度');
  } else if (status === 429) {
    lines.push('429 = 被限流：稍后重试，或在「供应商」里降低并发/换一家');
  } else if (status >= 500) {
    lines.push('5xx = 上游服务异常：多为中转商侧故障，稍后重试或换一家；若持续如此可用「测试连接」确认');
  }
  return `\n  ${lines.join('\n  ')}`;
}
