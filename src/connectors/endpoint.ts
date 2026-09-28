/**
 * 端点地址与 HTTP 发送的公共逻辑 —— 被 OpenAI 兼容连接器、Ollama 连接器、
 * Studio 的「测试连接」和 `ao doctor` 共用，保证四处对「地址配错」的处理完全一致。
 *
 * 解决的两类真实故障：
 *  1. 配置的 base_url 与最终地址差一跳（http→https / 带不带 www / 反代规范化），
 *     上游 301/302 后 Node 按 fetch 规范把 POST 降级成 GET，端点只收 POST → 405；
 *  2. base_url 少写/多写 /v1，路径对不上 → 404/405。
 */
import { detectEnvProxy, envProxyStatus } from '../utils/env-proxy.js';

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
  const found = detectEnvProxy(env);
  if (!found) return '';
  const st = envProxyStatus();
  if (st.installed) {
    // 已经在走代理还失败 —— 别再让用户去查 Node 走不走代理这件事了，问题在代理那头
    return [
      `本次请求已按 ${found.name}=${found.url} 走代理，仍然失败 ——`,
      `  多半是代理本身没起来/需要认证/该地址在代理那头也不通，先用 curl 走同一个代理验一下；`,
      `  确认要直连可设 AO_NO_PROXY=1 关掉代理接管。`,
    ].join('\n  ');
  }
  const why = st.reason === 'disabled'
    ? `但你设了 AO_NO_PROXY=${String(env.AO_NO_PROXY)}，代理接管已被关掉`
    : st.reason === 'unavailable'
      ? `但代理接管没能启用（${st.detail || '依赖不可用'}），当前是直连`
      : '但本次请求没有走它（代理接管尚未初始化）';
  return [
    `检测到代理环境变量 ${found.name}=${found.url}，${why} ——`,
    `  Node 的 fetch 默认不读这些变量（curl / 浏览器会读），所以会出现"curl 能通、AO 连不上"。`,
    `  去掉 AO_NO_PROXY（或修好该依赖）即可让 AO 自己走代理；也可以换用不需要代理的中转商端点。`,
  ].join('\n  ');
}

/**
 * 中转网关明说「这个 key 所在分组下没有该模型的可用渠道」。new-api 系网关（PackyCode 等）回的是
 * 503 + `model_not_found`「分组 default 下模型 X 无可用渠道」——状态码像临时故障，其实是账号配置问题，
 * 重试多少次都一样（2026-09-14 真 key 实测：按 5xx 重试 5 次白等 43 秒，提示还叫人"稍后重试"）。
 * executor 的重试分级用同一口径判定不重试。
 */
export function isModelUnavailable(text: string): boolean {
  return /model_not_found|无可用渠道|no available channel/i.test(text);
}

/**
 * 429 里分两种完全不同的事，处理方式相反：
 *  · **限流**（每分钟请求数/并发超了）——等一会儿真的会好，该退避重试；
 *  · **套餐用量耗尽**（包月 plan 的额度用完、余额/积分为 0）——**重试一万次也一样**，要去充值或换一家。
 * 两者都回 429，只有正文分得开。#184 真机：MiniMax 包月 key 回
 * `HTTP 429 已达到 Token Plan 用量上限：请升级 Token Plan 套餐或购买积分补充用量。(2056)`，
 * 而引擎按限流退避重试了一轮，最后还告诉用户"稍后重试，或降低并发"——两句建议都是错的。
 * 匹配只认**明说额度/用量耗尽**的说法，不碰"并发超限""请求过快"这类真限流措辞。
 */
export function isQuotaExhausted(text: string): boolean {
  return /insufficient_quota|exceeded your current quota|quota (?:has been )?(?:exceeded|exhausted|used up)|out of credits?|用量上限|额度已用[完尽]|额度不足|额度已耗尽|余额不足|积分不足|欠费/i.test(text);
}

/**
 * 中转网关明说「只放行官方 Claude Code 客户端」。PackyCode 的 cc 分组（Claude Code 专用）即如此：
 * 直连 /v1/messages 回 403「only accessible via the official Claude CLI」，按 Claude Code 协议手搓的
 * 探测请求回 400「请选择使用正确的 Claude Code 客户端」（2026-09-15 真 key 实测）。
 * key 是好的——本机 claude CLI 走中转照常能跑，只是直连 API / 「测试连接」这类非官方客户端会被拒。
 */
export function isOfficialClaudeClientOnly(text: string): boolean {
  return /only accessible via the official claude (cli|code)|正确的 ?claude code ?客户端/i.test(text);
}

/**
 * 中转网关明说「只放行官方 Codex 客户端」。PackyCode 的 codex 分组即是：/v1/responses 回
 * 「请使用标准 Codex 客户端请求，请避免任何基于我方 API 二次分发的 API 转接接入」（2026-09-16 真 key 实测）。
 */
export function isOfficialCodexClientOnly(text: string): boolean {
  return /标准\s*codex\s*客户端|standard codex client/i.test(text);
}

/**
 * 模型只收 Responses 协议，不收 chat completions：PackyCode 的 codex 分组对 /v1/chat/completions
 * 回 400 `protocol_not_supported`「模型 X 不支持 chat completions 协议」——分组里**每个**模型都如此
 * （gpt-5.5 / gpt-5.6-sol / gpt-6-astra 实测一致），所以不是"这个模型没上架"，而是整条协议不通。
 * AO 的直连打的就是 /v1/chat/completions，这类分组只能走 Codex CLI 中转。
 */
export function isChatProtocolUnsupported(text: string): boolean {
  return /"code"\s*:\s*"protocol_not_supported"|不支持\s*chat completions\s*协议/i.test(text);
}

/**
 * 余额/额度不足：new-api 系回 403「用户额度不足, 剩余额度: ＄-0.02」这类正文（2026-09-16 真机撞上）。
 * 状态码是 403，会掉进「鉴权没过、核对 key」那条通用提示里 —— key 和地址都没问题，是账户没钱了，
 * 让人去查 key 只会白费时间。也认 402 系网关常见的英文写法。
 */
export function isInsufficientBalance(text: string): boolean {
  return /额度不足|余额不足|欠费|insufficient[_ ](quota|balance|credit|funds)|insufficient quota/i.test(text);
}

/**
 * 网关认得这把 key，但拒绝这种调用：new-api 系回 403 + `code: access_denied`「访问被拒绝」。
 * PackyCode 的 cc 分组（Claude Code 专用）走 OpenAI 兼容 /v1/chat/completions 时就是这句，
 * 正文里**没有**"官方客户端"字样（2026-09-15 真 key 实测），所以单独认 access_denied。
 * 这时让人"核对 key 是否复制完整"是误导——key 没错，是分组不放行。
 */
export function isGatewayAccessDenied(text: string): boolean {
  return /"code"\s*:\s*"access_denied"/i.test(text);
}

/** 把 HTTP 错误码翻成用户能照做的排查话术（连接器与「测试连接」共用）。body 可选：有正文时能认出"模型不可用"这类伪装成 5xx 的账号问题 */
export function endpointHint(status: number, url: string, baseUrl: string, drift?: string, body?: string): string {
  const lines = [`请求地址: POST ${url}`];
  if (drift) lines.push(`发生了跳转/换路径: ${drift} —— 建议把 base_url 直接改成最终地址`);
  if (body && isInsufficientBalance(body)) {
    lines.push(
      '账户额度不足：网关已经明说余额不够（有的家会显示成负数）—— key 和地址都没问题，去中转商控制台充值即可',
      '别在这儿反复重试：余额不补上，换模型、换端点都一样过不去',
    );
  } else if (body && isOfficialClaudeClientOnly(body)) {
    lines.push(
      '只放行官方 Claude Code 客户端：这个 key 所在的分组是 Claude Code 专用的，直连 API 与「测试连接」都会被拒 —— key 本身没问题',
      '要用它：选 claude-code 供应商并配这家的 Claude Code 中转（本机 claude CLI 走中转，实跑正常）；要直连 API：去中转商控制台换一个 API 分组（如 PackyCode 的 claude-officially）',
    );
  } else if (body && isOfficialCodexClientOnly(body)) {
    lines.push(
      '只放行官方 Codex 客户端：这个 key 所在的分组是 Codex 专用的，直连 API 与「测试连接」都会被拒 —— key 本身没问题',
      '要用它：给 Codex 配这家的中转（供应商选 codex-cli）；要直连 API：去中转商控制台换一个 API 分组（如 PackyCode 的 bailian）',
    );
  } else if (body && isChatProtocolUnsupported(body)) {
    lines.push(
      '该模型只收 Responses 协议、不收 chat completions —— AO 直连打的是 /v1/chat/completions，所以用不了（同分组的其它模型也一样）',
      '换一个收 chat completions 的分组/模型（如 PackyCode 的 bailian 分组、qwen3.8-max），或给 Codex 配这家的中转（供应商选 codex-cli）',
    );
  } else if (body && isGatewayAccessDenied(body)) {
    lines.push(
      '访问被拒绝（access_denied）：网关认得这把 key，但它所在的分组不允许这种调用 —— 不是 key 复制错了',
      '常见于 Claude Code 专用分组（如 PackyCode 的 cc）：配成 Claude Code 中转、供应商选 claude-code 即可使用；要直连 API，去中转商控制台换一个 API 分组（如 claude-officially）',
    );
  } else if (body && isModelUnavailable(body)) {
    lines.push(
      '模型不可用：该 key 所在的分组里没有这个模型的可用渠道 —— 这是账号配置问题，不是临时故障，重试无用',
      '去中转商控制台给这个令牌换一个包含该模型的分组，或换成该分组下能用的模型（配好 key 点「获取模型列表」看实际可用的）',
    );
  } else if (status === 404 || status === 405) {
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
  } else if (status === 429 && body && isQuotaExhausted(body)) {
    lines.push(
      '429 但不是限流：这家明说**套餐用量/额度已耗尽** —— 这是账单问题，不是临时故障，重试无用（引擎也已不再重试）',
      '去该供应商控制台充值/升级套餐，或在「供应商」里换一家；包月 plan 的额度通常按自然月重置，也可以等下个周期',
    );
  } else if (status === 429) {
    lines.push('429 = 被限流：稍后重试，或在「供应商」里降低并发/换一家');
  } else if (status >= 500) {
    lines.push('5xx = 上游服务异常：多为中转商侧故障，稍后重试或换一家；若持续如此可用「测试连接」确认');
  }
  return `\n  ${lines.join('\n  ')}`;
}
