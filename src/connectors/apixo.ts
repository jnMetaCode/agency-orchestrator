/** APIXO Generation API: submit once, then poll; credentials stay on the API host. */
export const APIXO_MEDIA_ID = 'apixo-media';
export const APIXO_MEDIA_BASE = 'https://api.apixo.ai/api/v1';
export function apixoResult(json: any): { phase: 'pending' | 'done' | 'failed'; url?: string; error?: string } {
  if (!json || typeof json !== 'object') return { phase: 'failed', error: 'APIXO response is invalid' };
  if (json.code !== undefined && json.code !== 200) return { phase: 'failed', error: String(json.message || `APIXO code ${json.code}`) };
  const d = json.data || {};
  if (d.state === 'failed') return { phase: 'failed', error: String(d.failMsg || 'APIXO task failed') };
  if (d.state !== 'success') return { phase: 'pending' };
  let result;
  try { result = typeof d.resultJson === 'string' ? JSON.parse(d.resultJson) : d.resultJson; }
  catch { return { phase: 'failed', error: 'APIXO resultJson is invalid' }; }
  const url = result?.resultUrls?.[0];
  return typeof url === 'string' && /^https?:\/\//.test(url)
    ? { phase: 'done', url } : { phase: 'failed', error: 'APIXO result URL missing' };
}
export async function apixoImage(apiKey: string, model: string, prompt: string, size?: string, background?: string, timeout = 300_000, baseUrl = APIXO_MEDIA_BASE): Promise<Buffer> {
  if (model !== 'seedream-5-5') throw new Error('APIXO 图片目前支持 seedream-5-5');
  const signal = AbortSignal.timeout(timeout);
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/generateTask/${model}`, { method: 'POST', headers, signal,
    body: JSON.stringify({ request_type: 'async', input: { mode: 'text-to-image', prompt, output_format: 'png',
      ...(size ? { size } : { resolution: '1.5k', aspect_ratio: '1:1' }), ...(background ? { background } : {}) } }) });
  if (!res.ok) throw new Error(`APIXO submit HTTP ${res.status}`);
  const created = await res.json() as any;
  const id = created.code === 200 && created.data?.taskId;
  if (!id) throw new Error(String(created.message || 'APIXO taskId missing'));
  try {
    while (true) {
      await new Promise<void>((resolve, reject) => { const timer = setTimeout(done, 3000); function done() { signal.removeEventListener('abort', abort); resolve(); } function abort() { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); } signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); });
      let q: Response;
      try { q = await fetch(`${baseUrl.replace(/\/+$/, '')}/statusTask/${model}?taskId=${encodeURIComponent(id)}`, { headers, signal }); } catch (error) { if (signal.aborted) throw error; continue; }
      if (q.status === 429 || q.status >= 500) continue;
      if (!q.ok) throw new Error(`APIXO query HTTP ${q.status}`);
      const task = apixoResult(await q.json());
      if (task.phase === 'failed') throw new Error(task.error);
      if (task.phase === 'done') {
        const download = await fetch(task.url!, { signal });
        if (!download.ok) throw new Error(`APIXO download HTTP ${download.status}`);
        return Buffer.from(await download.arrayBuffer());
      }
    }
  } catch (error) { throw new Error(`APIXO task ${id}: ${error instanceof Error ? error.message : String(error)}; 请先在控制台确认任务，避免重复生成`); }
}
