import { useEffect, useState } from "react";
import { api, withToken, runWorkflow, getMediaDefaults, setMediaDefaults, type ConfigResponse } from "@/lib/studio";

/** Runs the same durable workflow jobs as Studio; no second video execution API. */
export function VideoGenerator({ prompt: initial, en }: { prompt: string; en: boolean }) {
  const [cfg, setCfg] = useState<ConfigResponse | null>(null);
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState(initial);
  const [provider, setProvider] = useState(getMediaDefaults().video.provider || "");
  const [model, setModel] = useState("");
  const [resolution, setResolution] = useState("");
  const [duration, setDuration] = useState("");
  const [ratio, setRatio] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [runId, setRunId] = useState("");
  const [url, setUrl] = useState("");
  useEffect(() => { api.config().then(setCfg).catch(() => setError(en ? "Start the local engine to generate videos." : "请启动本地引擎后生成视频。")); }, [en]);
  const providers = (cfg?.videoProviders || []).filter(p => p.hasKey);
  const selected = providers.find(p => p.id === provider) || providers[0];
  const selectedModel = selected?.models.includes(model) ? model : selected?.models[0] || "";
  const tiers = selected?.tiers?.[selectedModel];
  const resolutions = tiers?.resolutions || selected?.resolutions || [];
  const durations = (tiers?.durations || selected?.durations || []).map(String);
  const ratios = tiers?.ratios || selected?.ratios || [];
  const res = resolutions.includes(resolution) ? resolution : resolutions[0] || "";
  const seconds = durations.length && !durations.includes(duration) ? durations[0] : duration;
  const aspect = ratios.includes(ratio) ? ratio : ratios[0] || "";
  const canSubmit = !!selected && !!prompt.trim() && !!selectedModel && Number.isSafeInteger(Number(seconds)) && Number(seconds) > 0 && !busy;
  const run = async () => {
    if (!selected || !canSubmit) return;
    setBusy(true); setError(""); setUrl(""); setRunId(""); setStatus(en ? "Starting…" : "正在创建任务…");
    let output = "";
    let done = false;
    let stepFailed = false;
    try {
      const workflows = await api.workflows();
      const wf = workflows.find(w => w.name === "创意库视频直出");
      if (!wf) throw new Error(en ? "Update the engine to use direct video generation." : "未找到视频直出模板，请更新本地引擎。");
      const defaults = getMediaDefaults();
      setMediaDefaults({ ...defaults, video: { ...defaults.video, provider: selected.id, model: selectedModel, resolution: res, duration: seconds, ratio: aspect } });
      await runWorkflow({ file: wf.file, inputs: { prompt, video_provider: selected.id, video_model: selectedModel, video_resolution: res, video_duration: seconds, video_ratio: aspect } }, (event, data) => {
        if (event === "start") setRunId(data.runId);
        if (event === "output-dir") output = String(data.dir).split(/[\\/]/).filter(Boolean).pop() || "";
        if (event === "step-start") setStatus(en ? "Generating video…" : "视频生成中，请等待…");
        if (event === "step-fail" || event === "step-failed" || event === "error") { stepFailed = true; setError(data.error || data.message || (en ? "Generation failed" : "生成失败")); }
        if (event === "done") {
          done = true;
          if (data.code === 0 && !data.cancelled && !stepFailed && output) { setUrl(withToken(`/api/runs/${encodeURIComponent(output)}/assets/clip.mp4`)); setStatus(en ? "Complete" : "生成完成"); }
          else setError(en ? "Generation did not complete. Check My runs before retrying." : "生成未完成。请先到「我的运行」检查任务，再决定是否重试。");
        }
      });
      if (!done) throw new Error(en ? "Connection interrupted. Check My runs before retrying." : "连接中断，请先到「我的运行」检查，避免重复下单。");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const select = (label: string, value: string, values: string[], change: (v: string) => void) => <label className="grid gap-1 text-xs">{label}<select disabled={busy} className="rounded border border-border bg-background p-2" value={value} onChange={e => change(e.target.value)}>{values.map(v => <option key={v} value={v}>{v}</option>)}</select></label>;
  return <div className="mt-3 space-y-3 rounded-lg border border-border p-3">
    <textarea aria-label={en ? "Video prompt" : "视频提示词"} disabled={busy} className="min-h-32 w-full rounded border border-border bg-background p-2 text-xs" value={prompt} onChange={e => setPrompt(e.target.value)} />
    {!cfg && !error && <p className="text-xs">{en ? "Connecting…" : "正在连接本地引擎…"}</p>}
    {cfg && !providers.length && <p className="text-xs">{en ? "Configure a video provider in Studio Settings first." : "请先到工作台设置中配置视频供应商密钥。"}</p>}
    {!!providers.length && <><div className="grid grid-cols-2 gap-2">
      {select(en ? "Provider" : "供应商", selected?.id || "", providers.map(p => p.id), setProvider)}
      {select(en ? "Model" : "模型", selectedModel, selected?.models || [], setModel)}
      {resolutions.length > 0 && select(en ? "Resolution" : "分辨率", res, resolutions, setResolution)}
      {durations.length ? select(en ? "Seconds" : "秒数", seconds, durations, setDuration) : (
        <label className="grid gap-1 text-xs">{en ? "Seconds" : "秒数"}
          <input type="number" min="1" step="1" disabled={busy} value={duration}
            onChange={e => setDuration(e.target.value)} className="rounded border border-border bg-background p-2" />
        </label>
      )}
      {ratios.length > 0 && select(en ? "Aspect ratio" : "比例", aspect, ratios, setRatio)}
    </div><p className="text-xs text-muted-foreground">{en ? "Generation uses your provider balance. Review the prompt and settings before submitting." : "生成将消耗供应商余额，请先替换提示词中的占位变量并核对档位。"}</p>
    <button disabled={!canSubmit} onClick={run} className="rounded bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-50">{busy ? (en ? "Generating…" : "生成中…") : (en ? "Generate video" : "生成视频")}</button></>}
    {status && <p role="status" className="text-xs">{status}</p>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {runId && <div className="flex gap-3 text-xs"><a className="text-primary underline" href="/studio?tab=runs">{en ? "My runs" : "查看我的运行"}</a>{busy && <button onClick={() => api.cancelRun(runId).catch(() => setError(en ? "Could not cancel" : "取消失败，请到我的运行检查"))}>{en ? "Cancel" : "取消任务"}</button>}</div>}
    {url && <><video controls preload="metadata" src={url} className="w-full rounded" /><a href={url} download="clip.mp4" className="text-xs text-primary underline">{en ? "Download MP4" : "下载 MP4"}</a></>}
  </div>;
}
