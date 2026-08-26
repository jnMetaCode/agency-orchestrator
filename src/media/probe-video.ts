/**
 * 零成本探测：某个 OpenAI 兼容中转站有没有视频端点、是哪种"形状"。
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
  /** 对照路径的状态：全站兜底时它不是 404 */
  controlStatus: number | 'timeout' | 'error';
  summary: string;
}

const VIDEO_MODEL_RE = /sora|veo|kling|seedance|hailuo|minimax-h|wan\d|vidu|pixverse|imagine|video|runway|luma|hunyuan-?video|cogvideo/i;

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

  const shapes: VideoProbeResult['shapes'] = [];
  for (const c of VIDEO_SHAPE_CANDIDATES) {
    const r = await hit(f, `${base}/${c.path}`, { method: 'POST', headers, body: JSON.stringify(c.body) }, timeoutMs);
    let verdict: VideoProbeResult['shapes'][number]['verdict'] = 'unknown';
    if (typeof r.status === 'number') {
      if (r.status === 404 || r.status === 405) verdict = 'missing';
      else if (!controlIs404) verdict = 'unreliable';           // 对照也不是 404：分不清真存在还是兜底
      else verdict = 'exists';                                    // 400/401/402/403/422/200… 且对照 404 → 路径真在
    }
    shapes.push({ shape: c.shape, path: c.path, status: r.status, verdict });
  }

  const models = await hit(f, `${base}/models`, { method: 'GET', headers }, timeoutMs);
  let videoModels: string[] = [];
  try {
    const j = JSON.parse(models.text.length >= 200 ? await (await f(`${base}/models`, { headers, signal: AbortSignal.timeout(timeoutMs) })).text() : models.text);
    const ids: string[] = (Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : []).map((m: { id?: string }) => String(m?.id ?? '')).filter(Boolean);
    videoModels = ids.filter((id) => VIDEO_MODEL_RE.test(id)).slice(0, 12);
  } catch { /* 拉不到就当没有 */ }

  const exists = shapes.filter((s) => s.verdict === 'exists');
  const summary = exists.length
    ? `有视频端点（形状：${exists.map((s) => s.shape).join(' / ')}）${videoModels.length ? `，/models 里有 ${videoModels.length} 个视频模型` : ''}——可按该形状接入`
    : !controlIs404
      ? `对照路径回 ${String(control.status)}（全站兜底），探不出真假——找该站要文档`
      : videoModels.length
        ? `三种已知形状都不在，但 /models 里有视频模型名（${videoModels.slice(0, 3).join(', ')}…）——它走的是别的形状，找该站要文档`
        : `没探到视频端点，/models 里也没有视频模型名`;
  return { id: target.id, baseUrl: base, shapes, videoModels, controlStatus: control.status, summary };
}
