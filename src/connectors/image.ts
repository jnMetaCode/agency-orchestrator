/**
 * 文生图（`type: image` 步骤的执行端）。
 *
 * 一个"图片 API"在市面上有两种协议形状，都要认：
 *  A. OpenAI 经典 Images API：`POST {base}/images/generations`，响应 `data[0].b64_json | url`。
 *     绝大多数聚合商有这条。
 *  B. Responses API + image_generation 工具：`POST {base}/responses`，响应在
 *     `output[]` 里找 `type: "image_generation_call"`，`result` 是 base64 / URL / data URL。
 *     LanoX 文档**明说** chat 端点不支持图片工具、必须走这条 —— 所以 A 打不通时自动降到 B。
 *
 * 落盘/传变量的约定见 executor：这里只负责"拿到图片字节"。
 */
import { API_PROVIDER_MAP } from './api-providers.js';
import { postApiEndpoint, isGatewayRouteMissShell } from './endpoint.js';
import type { LLMConfig } from '../types.js';

export interface ImageStepOptions {
  /** 图片模型（必填——各家的图片模型编码互不通用，不猜） */
  model?: string;
  /** 如 "1024x1024" */
  size?: string;
  /** 如 high / medium / low（各家档位名不同，原样透传） */
  quality?: string;
  /** 如 transparent（协议 B 的 background） */
  background?: string;
}

export interface GeneratedImage {
  /** 图片字节 */
  buffer: Buffer;
  /** 目前各家一律回 png（我们也显式请求 png） */
  mime: 'image/png';
  /** 走的哪条协议（诊断/测试用） */
  via: 'images-api' | 'responses-tool';
}

/**
 * 解析出"打哪 + 用什么 key"。图片步骤只支持 OpenAI 兼容的 API provider ——
 * CLI（claude-code / agy…）是编码工具不是图片端点，claude 原生协议也没有图片 API。
 * 报错必须把这条说清，别让用户拿 CLI provider 撞一头雾水。
 */
export function resolveImageAccess(config: LLMConfig): { baseUrl: string; apiKey: string } {
  const spec = API_PROVIDER_MAP[config.provider];
  const baseUrl = config.base_url || (spec ? process.env[spec.envBase] || spec.defaultBaseUrl : '');
  const apiKey = config.api_key || (spec ? process.env[spec.envKey] || '' : '');
  if (!baseUrl) {
    throw new Error(
      `图片步骤（type: image）需要一个 OpenAI 兼容的 API provider（如 lanox / shengsuanyun / openai / apinebula），` +
      `当前 provider "${config.provider}" 没有可用的图片端点。` +
      `本地 CLI（claude-code / antigravity-cli 等）与 claude 原生协议都没有图片 API —— ` +
      `请给这一步单独配 llm: { provider: <API provider> }（步骤级配置只影响本步）。`
    );
  }
  if (!apiKey) {
    throw new Error(`图片步骤缺少 ${config.provider} 的 API key（${spec ? spec.envKey : 'api_key'}）。`);
  }
  return { baseUrl, apiKey };
}

/** 从 data URL / 裸 base64 / http URL 拿到字节。 */
async function toBuffer(result: string): Promise<Buffer> {
  const s = String(result || '').trim();
  if (/^https?:\/\//.test(s)) {
    const r = await fetch(s, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`下载生成的图片失败：HTTP ${r.status}（${s.slice(0, 80)}…）`);
    return Buffer.from(await r.arrayBuffer());
  }
  const b64 = s.startsWith('data:') ? s.slice(s.indexOf(',') + 1) : s;
  return Buffer.from(b64, 'base64');
}

/** 这次失败是"这条路不存在"（该换协议）还是"业务错误"（换协议也没用，直接报）。 */
function isRouteMiss(status: number, body: string): boolean {
  if (status === 404 || status === 405) return true;
  if (status === 200 && isGatewayRouteMissShell(body)) return true;   // LanoX 那种 200 壳
  // 部分网关对"模型不支持该端点"回 400 + 明说 —— 也值得换条路试
  if (status === 400 && /not support|unsupported|不支持|image_generation.*responses|use \/v1\/responses/i.test(body)) return true;
  return false;
}

export async function generateImage(
  config: LLMConfig,
  prompt: string,
  opts: ImageStepOptions,
  onNotice?: (msg: string) => void,
): Promise<GeneratedImage> {
  if (!opts.model) {
    // 与文本侧"不猜默认模型"同一条纪律：图片模型编码更是各家各的（gpt-image-2 /
    // seedance / nano-banana…），猜错就是烧钱后报"模型不存在"
    throw new Error(
      '图片步骤缺少模型：请在该步写 image: { model: "<图片模型>" }。' +
      '各家可用的图片模型在 Studio「供应商」页配 key 后点「获取模型列表」查看（或看该服务商文档）。'
    );
  }
  const { baseUrl, apiKey } = resolveImageAccess(config);
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
  const timeoutMs = config.timeout && config.timeout > 0 ? config.timeout : 300_000;

  // ── 协议 A：Images API ──────────────────────────────────────────────────────
  const bodyA = JSON.stringify({
    model: opts.model,
    prompt,
    n: 1,
    ...(opts.size ? { size: opts.size } : {}),
    ...(opts.quality ? { quality: opts.quality } : {}),
    ...(opts.background ? { background: opts.background } : {}),
  });
  const ctrlA = new AbortController();
  const timerA = setTimeout(() => ctrlA.abort(), timeoutMs);
  let aStatus = 0; let aText = '';
  try {
    const a = await postApiEndpoint({ baseUrl, path: 'images/generations', headers, body: bodyA, signal: ctrlA.signal, onNotice });
    aStatus = a.response.status;
    aText = await a.response.text();
    if (a.response.ok && !isGatewayRouteMissShell(aText)) {
      const j = JSON.parse(aText) as { data?: Array<{ b64_json?: string; url?: string }> };
      const item = j.data?.[0];
      const raw = item?.b64_json || item?.url;
      if (raw) return { buffer: await toBuffer(raw), mime: 'image/png', via: 'images-api' };
      // 200 但没有图片字段 → 当路由未命中处理，去试协议 B（有网关这么干）
    }
    if (!isRouteMiss(aStatus, aText)) {
      throw new Error(`图片生成失败：HTTP ${aStatus} ${aText.slice(0, 300)}`);
    }
  } catch (err) {
    // 连接类错误直接抛（换协议也是同一个网络）；只有明确的"这条路不存在"才继续
    if (err instanceof Error && /图片生成失败|下载生成的图片失败/.test(err.message)) throw err;
    if (aStatus === 0 && !(err instanceof Error && err.name === 'AbortError')) {
      if (err instanceof Error && /fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET/i.test(err.message)) throw err;
    }
    if (!isRouteMiss(aStatus, aText)) throw err;
  } finally {
    clearTimeout(timerA);
  }
  onNotice?.(`🔄 该端点没有 Images API（${aStatus || '无响应'}），改用 Responses + image_generation 工具重试…`);

  // ── 协议 B：Responses + image_generation 工具 ──────────────────────────────
  // 顶层 model 是"编排图片工具的文本模型"（网关强校验非空），工具里的 model 才是图片模型。
  // 文本模型用步骤/全局 llm.model；没有就复用图片模型名（部分网关接受）。
  const bodyB = JSON.stringify({
    model: config.model && config.model !== opts.model ? config.model : opts.model,
    input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
    tools: [{
      type: 'image_generation',
      model: opts.model,
      output_format: 'png',
      ...(opts.size ? { size: opts.size } : {}),
      ...(opts.quality ? { quality: opts.quality } : {}),
      ...(opts.background ? { background: opts.background } : {}),
    }],
    tool_choice: { type: 'image_generation' },
    stream: false,
  });
  const ctrlB = new AbortController();
  const timerB = setTimeout(() => ctrlB.abort(), timeoutMs);
  try {
    const b = await postApiEndpoint({ baseUrl, path: 'responses', headers, body: bodyB, signal: ctrlB.signal, onNotice });
    const text = await b.response.text();
    if (!b.response.ok || isGatewayRouteMissShell(text)) {
      throw new Error(
        `图片生成失败（两种协议都试过）：HTTP ${b.response.status} ${text.slice(0, 300)}\n` +
        `  已试：POST …/images/generations（${aStatus || '无响应'}）与 POST …/responses。` +
        `请确认该服务商确实提供图片生成、以及 image.model（当前 "${opts.model}"）在其上架列表里。`
      );
    }
    const j = JSON.parse(text) as { output?: Array<{ type?: string; result?: string }> };
    const call = j.output?.find((o) => o?.type === 'image_generation_call' && o.result);
    if (!call?.result) {
      throw new Error(`图片生成失败：Responses 返回里没有 image_generation_call 结果（${text.slice(0, 200)}）`);
    }
    return { buffer: await toBuffer(call.result), mime: 'image/png', via: 'responses-tool' };
  } finally {
    clearTimeout(timerB);
  }
}
