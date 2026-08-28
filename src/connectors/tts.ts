/**
 * 文字转语音（`type: tts` 步骤的执行端）——短剧流水线的"配音"那一段。
 *
 * 为什么是 OpenAI 兼容的 `POST {base}/audio/speech` 而不是别的：
 *   1. 它和 `type: image` 走的 `/images/generations` 是同一套供应商/key/端点漂移机制，
 *      不引入任何新依赖、不新开一张供应商表——用户已经配好的中转站大多直接就有这条。
 *   2. 免费的 Edge TTS 要自己实现一套逆向出来的鉴权（Sec-MS-GEC）+ WebSocket 协议，
 *      微软随时能改，坏了是我们的锅、用户的片；而这条是白纸黑字的公开协议。
 * 没有这条端点的供应商会拿到 404/400——和视频那边一样，**说清是"这家没有这个能力"**，
 * 不要让用户以为是自己参数写错了。
 *
 * 与图片/视频同一条纪律：**model 与 voice 都不猜**。音色名各家各的（OpenAI 的 alloy/nova、
 * 别家的中文音色 id 完全不同），猜错要么 400、要么拿回一条不是你要的嗓子的成品。
 */
import { postApiEndpoint, isGatewayRouteMissShell } from './endpoint.js';
import { resolveImageAccess } from './image.js';
import type { LLMConfig } from '../types.js';

export interface TtsStepOptions {
  /** 语音供应商 id（缺省用 llm.provider）。与 image.provider / video.provider 对称 */
  provider?: string;
  /** 语音模型（必填，不猜） */
  model?: string;
  /** 音色（必填，不猜——各家音色 id 互不通用） */
  voice?: string;
  /** 语速，多数实现支持 0.25–4.0，默认不传（由服务端默认值决定） */
  speed?: number;
  /** 输出格式：mp3（默认）/ wav / opus / aac / flac / pcm */
  format?: string;
  /** 额外风格指令（部分模型支持 instructions 字段，如"用低沉、克制的语气"） */
  instructions?: string;
}

export interface GeneratedSpeech {
  buffer: Buffer;
  /** 落盘扩展名（不含点） */
  ext: string;
  mime: string;
}

const FORMAT_MIME: Record<string, string> = {
  mp3: 'audio/mpeg', opus: 'audio/ogg', aac: 'audio/aac',
  flac: 'audio/flac', wav: 'audio/wav', pcm: 'audio/pcm',
};

/**
 * 合成一段语音。返回音频字节 —— 落盘与变量约定由 executor 负责，这里只管拿到字节。
 */
export async function generateSpeech(
  config: LLMConfig,
  text: string,
  opts: TtsStepOptions,
  onNotice?: (msg: string) => void,
): Promise<GeneratedSpeech> {
  if (!opts.model) {
    throw new Error(
      '配音步骤缺少模型：请在该步写 tts: { model: "<语音模型>", voice: "<音色>" }。' +
      '各家语音模型编码互不通用，引擎不猜——见服务商文档，或在 Studio「供应商」页点「获取模型列表」。'
    );
  }
  if (!opts.voice) {
    throw new Error(
      `配音步骤缺少音色：请在该步写 tts: { model: "${opts.model}", voice: "<音色>" }。` +
      '音色 id 各家各的（如 OpenAI 的 alloy / nova），猜错要么被拒、要么拿回一条不是你要的嗓子的成品。'
    );
  }
  const format = (opts.format || 'mp3').toLowerCase();
  if (!FORMAT_MIME[format]) {
    throw new Error(`tts.format 只支持 ${Object.keys(FORMAT_MIME).join(' / ')}，实际 "${opts.format}"`);
  }
  if (opts.speed !== undefined && (!Number.isFinite(opts.speed) || opts.speed <= 0)) {
    throw new Error(`tts.speed 需要一个正数，实际 "${opts.speed}"`);
  }

  // 供应商/端点/key 的解析与图片步骤完全同源（含"这家走 Anthropic 协议、没有这个端点"的当场说破）
  const { baseUrl, apiKey } = resolveImageAccess(config, opts, { step: '配音步骤（type: tts）', ability: '语音合成端点' });
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
  const timeoutMs = config.timeout && config.timeout > 0 ? config.timeout : 300_000;

  const body = JSON.stringify({
    model: opts.model,
    input: text,
    voice: opts.voice,
    response_format: format,
    ...(opts.speed !== undefined ? { speed: opts.speed } : {}),
    ...(opts.instructions ? { instructions: opts.instructions } : {}),
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await postApiEndpoint({ baseUrl, path: 'audio/speech', headers, body, signal: ctrl.signal, onNotice });
    if (!r.response.ok) {
      const errText = (await r.response.text()).slice(0, 400);
      // 404 在这条链路上几乎总是"这家没有语音端点"，而不是用户参数写错——别让人去反复检查 voice
      const hint = r.response.status === 404
        ? `供应商 "${opts.provider || config.provider}" 似乎没有 /audio/speech 端点（不是所有中转站都开这条）。换一家带语音能力的供应商，或给这步单独配 tts: { provider: … }。`
        : '';
      throw new Error(`语音合成失败（HTTP ${r.response.status}）：${errText}${hint ? `\n        ${hint}` : ''}`);
    }
    const raw = Buffer.from(await r.response.arrayBuffer());
    // 200 但回的是 JSON = 网关把"路由不存在"包成了成功响应（图片那边真遇到过）。
    // 不识破就会把一段 JSON 当成 mp3 写进 assets，播放器上是一条打不开的"成片"。
    const head = raw.subarray(0, 200).toString('utf-8');
    if (raw.length === 0) throw new Error('语音合成返回了 0 字节（供应商侧没有生成音频）');
    if (head.trimStart().startsWith('{') || isGatewayRouteMissShell(head)) {
      throw new Error(`语音合成返回的不是音频而是 JSON：${head.slice(0, 300)}（多半是这家没有 /audio/speech 端点）`);
    }
    return { buffer: raw, ext: format === 'pcm' ? 'pcm' : format, mime: FORMAT_MIME[format] };
  } finally {
    clearTimeout(timer);
  }
}
