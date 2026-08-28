/**
 * 零成本探测：某个 OpenAI 兼容中转站有没有**视频 / 图片 / 语音**端点、视频是哪种"形状"。
 * （函数名与 `--video-probe` 是视频先落地时留下的；现在图片与语音也一并探，一次跑覆盖三样。）
 *
 * 为什么要探而不是"都显示"：视频不像聊天有统一格式——建任务路径 / 请求体 / 轮询 / 状态词每家都不同，
 * 不知道形状连请求都发不出去，把所有中转站都列进视频供应商只会让用户选中一个必失败的。
 * 为什么零成本：请求体故意不合法（model 是 __ao_probe__），最多拿回 400/402，绝不会真建任务；
 * 路径存在回 4xx、不存在回 404，**再打一条乱写路径做对照**——有的站什么路径都回 200/404，不对照分不清。
 * 顺手拉 GET /models，看有没有视频模型名（sora / veo / kling / seedance / hailuo / wan / vidu / pixverse…）。
 */
export interface VideoProbeTarget { id: string; baseUrl: string; apiKey: string }
export interface VideoProbeResult {
  id: string;
  baseUrl: string;
  /** 每种候选形状的判定 */
  shapes: Array<{ shape: string; path: string; status: number | 'timeout' | 'error'; verdict: 'exists' | 'missing' | 'unreliable' | 'unknown' }>;
  /** /models 里像视频模型的名字（最多 12 个） */
  videoModels: string[];
  /** 图片端点 POST /images/generations 的判定（同一套探针逻辑） */
  image: { status: number | 'timeout' | 'error'; verdict: 'exists' | 'missing' | 'unreliable' | 'unknown' };
  /**
   * 语音端点 POST /audio/speech 的判定（type: tts 用它）。
   * 不是所有中转站都开这条——不先探的话，用户要等工作流跑到配音那一步才知道这家不行，
   * 而那时前面的图片/视频步骤已经花过钱了。
   */
  speech: { status: number | 'timeout' | 'error'; verdict: 'exists' | 'missing' | 'unreliable' | 'unknown' };
  /** /models 里像语音模型的名字（最多 8 个） */
  speechModels: string[];
  /** 对照路径的状态：全站兜底时它不是 404 */
  controlStatus: number | 'timeout' | 'error';
  summary: string;
}

const VIDEO_MODEL_RE = /sora|veo|kling|seedance|hailuo|minimax-h|wan\d|vidu|pixverse|imagine|video|runway|luma|hunyuan-?video|cogvideo/i;
// 语音模型名。和视频那条一样只是「看起来像」，用于提示而不用于判定。
const SPEECH_MODEL_RE = /tts|speech|voice|audio-?(preview|out)|cosyvoice|fish-?speech|elevenlabs/i;

/** 候选形状：路径相对 baseUrl（baseUrl 通常已含 /v1） */
export const VIDEO_SHAPE_CANDIDATES = [
  { shape: 'apimart', path: 'videos/generations', body: { model: '__ao_probe__', prompt: 'probe' } },
  { shape: 'openai-videos', path: 'videos', body: { model: '__ao_probe__', prompt: 'probe' } },
  { shape: 'minimax', path: 'video_generation', body: { model: '__ao_probe__', content: [{ type: 'text', text: 'probe' }] } },
];

type Fetch = typeof fetch;

async function hit(fetchImpl: Fetch, url: string, init: RequestInit, timeoutMs: number): Promise<{ status: number | 'timeout' | 'error'; text: string }> {
  try {
    const r = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    return { status: r.status, text: (await r.text()).slice(0, 200) };
  } catch (e) {
    return { status: (e as Error)?.name === 'TimeoutError' ? 'timeout' : 'error', text: String((e as Error)?.message || e) };
  }
}

export async function probeVideoEndpoints(
  target: VideoProbeTarget,
  opts: { fetchImpl?: Fetch; timeoutMs?: number } = {},
): Promise<VideoProbeResult> {
  const f = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const base = target.baseUrl.replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${target.apiKey}` };

  // 对照：乱写路径。它若不是 404，说明这站"什么都回"，后面的判定都要打折。
  const control = await hit(f, `${base}/__ao_probe_no_such_path__`, { method: 'POST', headers, body: '{}' }, timeoutMs);
  const controlIs404 = control.status === 404;

  const judge = (status: number | 'timeout' | 'error'): VideoProbeResult['shapes'][number]['verdict'] => {
    if (typeof status !== 'number') return 'unknown';
    if (status === 404 || status === 405) return 'missing';
    return controlIs404 ? 'exists' : 'unreliable';
  };
  const img = await hit(f, `${base}/images/generations`, { method: 'POST', headers, body: JSON.stringify({ model: '__ao_probe__', prompt: 'probe', n: 1 }) }, timeoutMs);
  const image = { status: img.status, verdict: judge(img.status) };
  // 语音同理：model / voice 都写成 __ao_probe__，最多拿回 400「模型不存在」，绝不会真合成、不花钱
  const sp = await hit(f, `${base}/audio/speech`, { method: 'POST', headers, body: JSON.stringify({ model: '__ao_probe__', input: 'probe', voice: '__ao_probe__' }) }, timeoutMs);
  const speech = { status: sp.status, verdict: judge(sp.status) };

  const shapes: VideoProbeResult['shapes'] = [];
  for (const c of VIDEO_SHAPE_CANDIDATES) {
    const r = await hit(f, `${base}/${c.path}`, { method: 'POST', headers, body: JSON.stringify(c.body) }, timeoutMs);
    // 400/401/402/403/422/200… 且对照 404 → 路径真在；对照也不是 404 → 分不清真存在还是兜底
    shapes.push({ shape: c.shape, path: c.path, status: r.status, verdict: judge(r.status) });
  }

  const models = await hit(f, `${base}/models`, { method: 'GET', headers }, timeoutMs);
  let videoModels: string[] = [];
  let speechModels: string[] = [];
  try {
    const j = JSON.parse(models.text.length >= 200 ? await (await f(`${base}/models`, { headers, signal: AbortSignal.timeout(timeoutMs) })).text() : models.text);
    const ids: string[] = (Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : []).map((m: { id?: string }) => String(m?.id ?? '')).filter(Boolean);
    videoModels = ids.filter((id) => VIDEO_MODEL_RE.test(id)).slice(0, 12);
    speechModels = ids.filter((id) => SPEECH_MODEL_RE.test(id) && !VIDEO_MODEL_RE.test(id)).slice(0, 8);
  } catch { /* 拉不到就当没有 */ }

  const exists = shapes.filter((s) => s.verdict === 'exists');
  const summary = exists.length
    ? `有视频端点（形状：${exists.map((s) => s.shape).join(' / ')}）${videoModels.length ? `，/models 里有 ${videoModels.length} 个视频模型` : ''}——可按该形状接入`
    : !controlIs404
      ? `对照路径回 ${String(control.status)}（全站兜底），探不出真假——找该站要文档`
      : videoModels.length
        ? `三种已知形状都不在，但 /models 里有视频模型名（${videoModels.slice(0, 3).join(', ')}…）——它走的是别的形状，找该站要文档`
        : `没探到视频端点，/models 里也没有视频模型名`;
  const imgNote = image.verdict === 'exists' ? '；图片端点 /images/generations 存在' : image.verdict === 'missing' ? '；没有图片端点' : '';
  // 真机实测（2026-08-28，Agnes / 多元探索）：`/audio/speech` **路径在**（回 503 而非 404），
  // 但 `/models` 里一个语音模型都没有 —— 路径存在 ≠ 有可用模型。这时不能说"可用"，
  // 那会把人送去猜一个不存在的 model id，白撞一次 400。
  const spNote = speech.verdict === 'exists'
    ? (speechModels.length
      ? `；语音端点 /audio/speech 存在，type: tts 可用（如 ${speechModels.slice(0, 2).join(', ')}）`
      : '；语音端点 /audio/speech 路径存在，但 /models 里没有语音模型名——要向该站确认它到底上架了哪个语音模型，别猜 model id')
    : speech.verdict === 'missing' ? '；没有语音端点（type: tts 用不了这家）' : '';
  return { id: target.id, baseUrl: base, shapes, videoModels, image, speech, speechModels, controlStatus: control.status, summary: summary + imgNote + spNote };
}
