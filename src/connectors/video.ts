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
  // 步骤指定了另一家：文本供应商的 base_url / api_key 不能带过去（与 image 同一条规则）
  if (id !== config.provider) config = { ...config, base_url: undefined, api_key: undefined } as LLMConfig;
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

/** 一次轮询看到的任务状态，已归一到与厂商无关的形状。 */
export interface VideoTaskState {
  /** 已归一：pending | done | failed。厂商各自的状态词由 shape 负责翻译 */
  phase: 'pending' | 'done' | 'failed';
  /** phase=done 时的成品下载地址 */
  url?: string;
  /** phase=failed 时的厂商原文（原样带出，不翻译） */
  error?: string;
  /** 厂商回执里的计费秒数（拿得到才有） */
  seconds?: number;
  /** 进度百分比（拿得到才有，用于提示） */
  progress?: number;
}

/**
 * 各家视频 API 的形状适配器。
 *
 * 两家实测下来差得很远——**这层抽象存在的理由就是别让第二家把第一家的代码搅烂**：
 *                      秘塔（MiniMax 协议）            APIMart（自家网关）
 *   建任务路径          v2/video_generation           v1/videos/generations
 *   提示词字段          content:[{type,text}]          prompt
 *   宽高比字段          ratio                          aspect_ratio
 *   建任务回执          {task_id}                      {code,data:[{task_id}]}
 *   查询                列表接口 + 自己按 id 过滤       GET v1/tasks/{id}
 *   完成状态词          succeeded                      completed
 *   成品地址            items[].content.url            data.result.videos[].url
 * 加一家只该新增一个 adapter，不该改到 generateVideo 的主流程。
 */
interface VideoShapeAdapter {
  createPath: string;
  createBody(opts: VideoStepOptions, prompt: string): string;
  /** 从建任务回执里取 task_id；取不到返回空串（调用方会连同原文一起报错） */
  parseCreate(json: unknown): string;
  /** 查询用的完整 URL（有的家把 id 放路径、有的放 query） */
  queryUrl(baseUrl: string, taskId: string): string;
  /** 解析查询响应；返回 undefined = 这一轮没看到我们那条任务，继续等 */
  parseQuery(json: unknown, taskId: string): VideoTaskState | undefined;
}

const DONE_OK = new Set(['succeeded', 'success', 'finished', 'completed']);
const DONE_FAIL = new Set(['failed', 'fail', 'error', 'canceled', 'cancelled']);
const phaseOf = (status: string): VideoTaskState['phase'] =>
  DONE_OK.has(status) ? 'done' : DONE_FAIL.has(status) ? 'failed' : 'pending';

interface MiniMaxTask {
  id?: string;
  status?: string;
  content?: { url?: string };
  error?: { code?: string; message?: string };
  usage?: { total_seconds?: number };
}

const SHAPES: Record<string, VideoShapeAdapter> = {
  // ── 秘塔科技：MiniMax 官方协议换了个 Host ─────────────────────────────────
  minimax: {
    createPath: 'v2/video_generation',
    createBody: (opts, prompt) => JSON.stringify({
      model: opts.model,
      content: [{ type: 'text', text: prompt }],
      ...(opts.resolution ? { resolution: opts.resolution } : {}),
      ...(opts.duration ? { duration: opts.duration } : {}),
      ...(opts.ratio ? { ratio: opts.ratio } : {}),
    }),
    parseCreate: (j) => String((j as { task_id?: string | number })?.task_id ?? ''),
    queryUrl: (base, id) => `${base}/v2/query/video_generation?task_id=${encodeURIComponent(id)}`,
    /**
     * 实测**不严格匹配 task_id**：传 task_id=1 也回 200 并列出账号里所有任务。
     * 拿 items[0] 当结果 = 迟早把别人的（或上一条的）视频当成本次产出——并发跑两个
     * 视频步骤时必然张冠李戴。所以按 id 精确过滤，找不到就当"还没出现在列表里"继续等。
     */
    parseQuery: (json, taskId) => {
      const items = (json as { items?: MiniMaxTask[] })?.items;
      if (!Array.isArray(items)) return undefined;
      const t = items.find((it) => String(it?.id ?? '') === taskId);
      if (!t) return undefined;
      const status = String(t.status ?? '').toLowerCase();
      return {
        phase: phaseOf(status),
        url: t.content?.url,
        error: t.error ? `${t.error.message || status}${t.error.code ? `（code ${t.error.code}）` : ''}` : undefined,
        seconds: t.usage?.total_seconds,
      };
    },
  },

  // ── APIMart：自家网关，任务查询是标准的 GET /v1/tasks/{id} ─────────────────
  // 端点已探测核实（2026-08-25，带真 key）：
  //   POST /v1/videos/generations  → 402 insufficient balance（路径在、鉴权通）
  //   GET  /v1/tasks/<假 id>       → 400 Invalid task ID format（路径在，还校验 id 格式）
  //   乱写路径                      → 404 Invalid URL（对照组：说明上面两条不是兜底响应）
  apimart: {
    createPath: 'videos/generations',
    createBody: (opts, prompt) => JSON.stringify({
      model: opts.model,
      prompt,
      ...(opts.duration ? { duration: opts.duration } : {}),
      // 这家叫 aspect_ratio 不叫 ratio；分辨率档位也不同（720p/1080p/4k，不是 768P/2K）——
      // 原样透传，不替用户换算：档位名是厂商的事，猜错就是一次白花的生成
      ...(opts.ratio ? { aspect_ratio: opts.ratio } : {}),
      ...(opts.resolution ? { resolution: opts.resolution } : {}),
    }),
    // {"code":200,"data":[{"status":"submitted","task_id":"task_01K8…"}]}
    parseCreate: (j) => {
      const d = (j as { data?: Array<{ task_id?: string }> | { task_id?: string } })?.data;
      const first = Array.isArray(d) ? d[0] : d;
      return String(first?.task_id ?? '');
    },
    queryUrl: (base, id) => `${base}/tasks/${encodeURIComponent(id)}`,
    parseQuery: (json) => {
      const d = (json as {
        data?: {
          status?: string; progress?: number; actual_time?: number;
          result?: { videos?: Array<{ url?: string } | string> };
          error?: { code?: number; message?: string };
        };
      })?.data;
      if (!d) return undefined;
      const status = String(d.status ?? '').toLowerCase();
      const v = d.result?.videos?.[0];
      return {
        phase: phaseOf(status),
        url: typeof v === 'string' ? v : v?.url,
        error: d.error ? `${d.error.message || status}${d.error.code ? `（code ${d.error.code}）` : ''}` : undefined,
        seconds: d.actual_time,
        progress: d.progress,
      };
    },
  },
};

/**
 * 正在跑的视频任务（task_id → 供应商）。
 *
 * 视频是唯一一种「进程没了、活还在别人服务器上跑、钱照花」的步骤：一次几十秒到几分钟，
 * 用户 Ctrl-C 之后终端上什么都不留，想去控制台查都不知道查哪一条。所以把在飞的任务
 * 登记下来，中断时把 task_id 打出去（见 pendingVideoTasks / describePendingVideoTasks）。
 */
const inFlight = new Map<string, string>();

/** 中断/退出时用：有在飞的视频任务就给出一句能照着去对账的提示，没有则返回 null。 */
export function describePendingVideoTasks(): string | null {
  if (inFlight.size === 0) return null;
  const lines = [...inFlight].map(([id, provider]) => `     ${provider}  task_id=${id}`);
  return `⚠️  还有 ${inFlight.size} 个视频任务在服务商那边跑（按秒计费，中断进程不会停止它们）：\n`
    + lines.join('\n')
    + `\n     拿 task_id 去服务商控制台查成品或取消；已产生的费用不会因为这里中断而退回。`;
}

export async function generateVideo(
  config: LLMConfig,
  prompt: string,
  opts: VideoStepOptions,
  onNotice?: (msg: string) => void,
): Promise<GeneratedVideo> {
  if (!opts.model) {
    throw new Error(
      '视频步骤缺少模型：请在该步写 video: { model: "<视频模型>" }（秘塔填 MiniMax-H3）。\n' +
      '  各家视频模型编码互不通用，引擎不猜——猜错就是等几分钟再收到"模型不存在"。\n' +
      '  提示词不会写？21 个题材模板与在线生成器：https://prompts.aiolaola.com/build.html'
    );
  }
  const { spec, baseUrl, apiKey } = resolveVideoAccess(config, opts);
  const shape = SHAPES[spec.shape];
  if (!shape) throw new Error(`视频供应商 ${spec.id} 的协议形状 "${spec.shape}" 没有对应的适配器（见 video.ts 的 SHAPES）`);
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
  const totalMs = opts.timeout && opts.timeout > 0 ? opts.timeout : 10 * 60_000;
  const pollMs = opts.poll_interval && opts.poll_interval > 0 ? opts.poll_interval : 5_000;
  const deadline = Date.now() + totalMs;

  // ── 1. 建任务 ─────────────────────────────────────────────────────────────
  const createRes = await fetch(`${baseUrl}/${shape.createPath}`, {
    method: 'POST',
    headers,
    body: shape.createBody(opts, prompt),
    signal: AbortSignal.timeout(Math.min(60_000, totalMs)),
  });
  const createText = await createRes.text();
  if (!createRes.ok) {
    // 余额不足、参数不合法这类都在这儿；原样带出厂商正文，别自己编原因
    throw new Error(`视频任务创建失败：HTTP ${createRes.status} ${createText.slice(0, 300)}`);
  }
  let taskId = '';
  try {
    taskId = shape.parseCreate(JSON.parse(createText));
  } catch {
    throw new Error(`视频任务创建失败：响应不是 JSON（${createText.slice(0, 200)}）`);
  }
  if (!taskId) {
    throw new Error(`视频任务创建失败：响应里没有 task_id（${createText.slice(0, 200)}）`);
  }
  inFlight.set(taskId, spec.id);
  onNotice?.(`🎬 视频任务已创建（task_id=${taskId}），开始轮询…（按秒计费，中途中断也可能已产生费用）`);

  // 建任务之后的每一条出口都必须摘掉登记，包括意料之外的抛错。
  // inFlight 的语义是"此刻正在轮询的任务"——漏摘一处，长跑的 Studio 进程就会越积越多，
  // 中断提示还会把早已结束的任务报成在飞的。用 finally 收口，比逐个出口记得删可靠。
  try {
    // ── 2. 轮询 ─────────────────────────────────────────────────────────────
    let last = '';
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollMs));

      // **查询失败绝不能连累任务**：任务已经在跑、钱已经花了，这里一次网络抖动就抛错
      // 等于把成品扔了。HTTP 5xx 与网络异常/超时是同一类瞬时故障，处理方式必须一致——
      // 都记一行、继续等，直到整体 deadline 才认输。
      let qText = '';
      try {
        const q = await fetch(shape.queryUrl(baseUrl, taskId), {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(30_000),
        });
        qText = await q.text();
        if (!q.ok) {
          onNotice?.(`⚠️ 查询任务状态失败：HTTP ${q.status}（任务仍在跑，继续等待）`);
          continue;
        }
      } catch (e) {
        onNotice?.(`⚠️ 查询任务状态出错：${e instanceof Error ? e.message.slice(0, 80) : e}（任务仍在跑，继续等待）`);
        continue;
      }

      let task: VideoTaskState | undefined;
      try { task = shape.parseQuery(JSON.parse(qText), taskId); } catch { /* 非 JSON：当作瞬时异常继续等 */ }
      if (!task) continue;                       // 这一轮没看到我们那条，继续等
      const label = task.progress != null ? `${task.phase} ${task.progress}%` : task.phase;
      if (label !== last) {
        onNotice?.(`   任务状态：${label}`);
        last = label;
      }
      if (task.phase === 'failed') {
        throw new Error(
          `视频生成失败（task_id=${taskId}）：${task.error || '厂商未给出原因'}。` +
          `拿这个 task_id 可以去服务商控制台对账。`
        );
      }
      if (task.phase === 'done') {
        const url = task.url;
        if (!url) {
          throw new Error(`视频任务已完成但没有下载地址（task_id=${taskId}）：${qText.slice(0, 200)}`);
        }
        // ── 3. 下载成品 ───────────────────────────────────────────────────
        // 片子已经生成、钱已经花了，**一次抖动不该判死**：失败重试一次再放弃。
        // 签名链接有效期短，所以只补一次、不做长退避——真过期了重试也没用，
        // 那时错误里带着 task_id，用户还能去控制台自己下。
        const buffer = await downloadWithRetry(url, Math.max(60_000, deadline - Date.now()), taskId, onNotice);
        return { buffer, mime: 'video/mp4', taskId, seconds: task.seconds, sourceUrl: url };
      }
    }
    throw new Error(
      `视频生成超时（task_id=${taskId}，等了 ${Math.round(totalMs / 1000)}s，最后状态：${last || '未知'}）。` +
      `任务多半还在服务商那边跑、费用可能已产生——去控制台按 task_id 查成品，` +
      `或给这一步调大 video: { timeout: <毫秒> }。`
    );
  } finally {
    inFlight.delete(taskId);
  }
}

/** 下载成品，失败重试一次。理由见调用处：钱已经花了，别让一次抖动白花。 */
async function downloadWithRetry(
  url: string,
  timeoutMs: number,
  taskId: string,
  onNotice?: (msg: string) => void,
): Promise<Buffer> {
  let lastErr = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const dl = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (dl.ok) return Buffer.from(await dl.arrayBuffer());
      lastErr = `HTTP ${dl.status}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message.slice(0, 80) : String(e);
    }
    if (attempt === 1) {
      onNotice?.(`⚠️ 下载成品失败（${lastErr}），2 秒后重试一次…`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error(
    `下载生成的视频失败（${lastErr}）：${url.slice(0, 80)}…\n` +
    `  片子多半已经生成、费用也已产生——拿 task_id=${taskId} 去服务商控制台下载。`
  );
}
