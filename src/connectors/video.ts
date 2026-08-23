/**
 * 文生视频（`type: video` 步骤的执行端）。
 *
 * 与文生图最大的不同是**它是异步任务**：建任务拿 task_id → 轮询状态 → 成品是一个
 * 带签名的下载链接。一次少则几十秒、多则几分钟，而且按秒计费，所以这里的纪律是：
 *   - 不替用户放大 duration / resolution（写多少是多少，钱是用户的）
 *   - 轮询到失败就立刻停，把厂商的 error.code/message 原样带出来（别翻译成"生成失败"）
 *   - 有整体超时，超时明说"任务还在跑，钱可能已经花了"，而不是假装什么都没发生
 *
 * 端点形状见 api-providers.ts 的 VIDEO_PROVIDERS（秘塔/MiniMax 的两条路径已实探核实）。
 */
import { VIDEO_PROVIDER_MAP, type VideoProviderSpec } from './api-providers.js';
import type { LLMConfig } from '../types.js';

export interface VideoStepOptions {
  /** 视频供应商 id（缺省用 llm.provider） */
  provider?: string;
  /** 视频模型（必填——各家编码互不通用，不猜） */
  model?: string;
  /** 如 "768P" / "1080P" / "2K"（原样透传） */
  resolution?: string;
  /** 秒 */
  duration?: number;
  /** 如 "16:9" */
  ratio?: string;
  /** 整个任务（建 + 轮询 + 下载）的上限毫秒，默认 10 分钟 */
  timeout?: number;
  /** 轮询间隔毫秒，默认 5 秒 */
  poll_interval?: number;
}

export interface GeneratedVideo {
  /** 视频字节 */
  buffer: Buffer;
  mime: 'video/mp4';
  /** 厂商任务 id（诊断用：出问题时拿它去控制台对账） */
  taskId: string;
  /** 厂商回执里的实际计费秒数（拿不到就没有） */
  seconds?: number;
  /** 成品下载地址（签名链接，会过期；只作诊断展示） */
  sourceUrl?: string;
}

/** 解析出"打哪 + 用什么 key"。视频供应商是独立的一张表，别拿聊天/图片的 provider 硬套。 */
export function resolveVideoAccess(
  config: LLMConfig,
  opts: VideoStepOptions,
): { spec: VideoProviderSpec; baseUrl: string; apiKey: string } {
  const id = (opts.provider || config.provider || '').trim();
  const spec = VIDEO_PROVIDER_MAP[id];
  if (!spec) {
    const known = Object.keys(VIDEO_PROVIDER_MAP).join(' / ') || '（暂无）';
    throw new Error(
      `视频步骤（type: video）需要一个**视频供应商**，当前 provider "${id || '未指定'}" 不是。\n` +
      `  可用：${known}。在该步写 video: { provider: "metaso", model: "MiniMax-H3" }，或把 llm.provider 设成它。\n` +
      `  说明：聊天/图片的 provider（deepseek、openai、各家聚合商）走的是另一套协议，没有视频任务端点。`
    );
  }
  const baseUrl = (config.base_url || process.env[spec.envBase] || spec.defaultBaseUrl).replace(/\/+$/, '');
  const apiKey = config.api_key || process.env[spec.envKey] || '';
  if (!apiKey) {
    throw new Error(`视频步骤缺少 ${spec.id} 的 API key（环境变量 ${spec.envKey}，或在 Studio「供应商」页配置）。`);
  }
  return { spec, baseUrl, apiKey };
}

/** MiniMax 形状的建任务请求体。别的形状以后按 spec.shape 分支，不要在这里硬塞。 */
function createBody(opts: VideoStepOptions, prompt: string): string {
  return JSON.stringify({
    model: opts.model,
    content: [{ type: 'text', text: prompt }],
    ...(opts.resolution ? { resolution: opts.resolution } : {}),
    ...(opts.duration ? { duration: opts.duration } : {}),
    ...(opts.ratio ? { ratio: opts.ratio } : {}),
  });
}

interface MiniMaxTask {
  id?: string;
  status?: string;
  content?: { url?: string };
  error?: { code?: string; message?: string };
  usage?: { total_seconds?: number };
}

/**
 * 从查询响应里挑出**我们这一条**任务。
 *
 * 秘塔的 GET /v2/query/video_generation 实测**不严格匹配 task_id**：传 task_id=1 也回
 * HTTP 200，并把账号里所有任务都列出来。拿 items[0] 当结果 = 迟早把别人的（或上一条的）
 * 视频当成本次产出——并发跑两个视频步骤时必然张冠李戴。所以按 id 精确过滤，找不到就
 * 当作"还没出现在列表里"继续轮询。
 */
function pickTask(json: unknown, taskId: string): MiniMaxTask | undefined {
  const items = (json as { items?: MiniMaxTask[] })?.items;
  if (!Array.isArray(items)) return undefined;
  return items.find((it) => String(it?.id ?? '') === taskId);
}

const DONE_OK = new Set(['succeeded', 'success', 'finished', 'completed']);
const DONE_FAIL = new Set(['failed', 'fail', 'error', 'canceled', 'cancelled']);

export async function generateVideo(
  config: LLMConfig,
  prompt: string,
  opts: VideoStepOptions,
  onNotice?: (msg: string) => void,
): Promise<GeneratedVideo> {
  if (!opts.model) {
    throw new Error(
      '视频步骤缺少模型：请在该步写 video: { model: "<视频模型>" }（如 MiniMax-H3）。' +
      '各家视频模型编码互不通用，引擎不猜——猜错就是等几分钟再收到"模型不存在"。'
    );
  }
  const { spec, baseUrl, apiKey } = resolveVideoAccess(config, opts);
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
  const totalMs = opts.timeout && opts.timeout > 0 ? opts.timeout : 10 * 60_000;
  const pollMs = opts.poll_interval && opts.poll_interval > 0 ? opts.poll_interval : 5_000;
  const deadline = Date.now() + totalMs;

  // ── 1. 建任务 ─────────────────────────────────────────────────────────────
  const createRes = await fetch(`${baseUrl}/${spec.createPath}`, {
    method: 'POST',
    headers,
    body: createBody(opts, prompt),
    signal: AbortSignal.timeout(Math.min(60_000, totalMs)),
  });
  const createText = await createRes.text();
  if (!createRes.ok) {
    // 余额不足、参数不合法这类都在这儿；原样带出厂商正文，别自己编原因
    throw new Error(`视频任务创建失败：HTTP ${createRes.status} ${createText.slice(0, 300)}`);
  }
  let taskId = '';
  try {
    taskId = String((JSON.parse(createText) as { task_id?: string | number }).task_id ?? '');
  } catch {
    throw new Error(`视频任务创建失败：响应不是 JSON（${createText.slice(0, 200)}）`);
  }
  if (!taskId) {
    throw new Error(`视频任务创建失败：响应里没有 task_id（${createText.slice(0, 200)}）`);
  }
  onNotice?.(`🎬 视频任务已创建（task_id=${taskId}），开始轮询…（按秒计费，中途中断也可能已产生费用）`);

  // ── 2. 轮询 ───────────────────────────────────────────────────────────────
  let last = '';
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    const q = await fetch(`${baseUrl}/${spec.queryPath}?task_id=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });
    const qText = await q.text();
    if (!q.ok) {
      // 查询挂了不代表任务挂了（限流/瞬时 5xx 都可能）——记下来继续等，别把用户的钱扔了
      onNotice?.(`⚠️ 查询任务状态失败：HTTP ${q.status}（继续等待）`);
      continue;
    }
    let task: MiniMaxTask | undefined;
    try { task = pickTask(JSON.parse(qText), taskId); } catch { /* 非 JSON：当作瞬时异常继续等 */ }
    if (!task) continue;                       // 任务还没出现在列表里
    const status = String(task.status ?? '').toLowerCase();
    if (status && status !== last) {
      onNotice?.(`   任务状态：${status}`);
      last = status;
    }
    if (DONE_FAIL.has(status)) {
      const e = task.error;
      throw new Error(
        `视频生成失败（task_id=${taskId}）：${e?.message || status}${e?.code ? `（code ${e.code}）` : ''}。` +
        `拿这个 task_id 可以去服务商控制台对账。`
      );
    }
    if (DONE_OK.has(status)) {
      const url = task.content?.url;
      if (!url) {
        throw new Error(`视频任务已完成但没有下载地址（task_id=${taskId}）：${qText.slice(0, 200)}`);
      }
      // ── 3. 下载成品（签名链接，有效期短，拿到就下） ──────────────────────
      const dl = await fetch(url, { signal: AbortSignal.timeout(Math.max(60_000, deadline - Date.now())) });
      if (!dl.ok) {
        throw new Error(`下载生成的视频失败：HTTP ${dl.status}（${url.slice(0, 80)}…，签名链接可能已过期）`);
      }
      const buffer = Buffer.from(await dl.arrayBuffer());
      return { buffer, mime: 'video/mp4', taskId, seconds: task.usage?.total_seconds, sourceUrl: url };
    }
  }
  throw new Error(
    `视频生成超时（task_id=${taskId}，等了 ${Math.round(totalMs / 1000)}s，最后状态：${last || '未知'}）。` +
    `任务多半还在服务商那边跑、费用可能已产生——去控制台按 task_id 查成品，` +
    `或给这一步调大 video: { timeout: <毫秒> }。`
  );
}
