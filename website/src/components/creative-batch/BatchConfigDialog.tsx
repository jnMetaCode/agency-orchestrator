import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Download, ExternalLink, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageProvider";
import { useDialog } from "@/components/ui/use-dialog";
import {
  api,
  type CreativeBatchArtifact,
  type CreativeBatchCapability,
  type CreativeBatchConfig,
  type CreativeBatchItem,
  type CreativeBatchRun,
  type CreativeBatchRunItem,
} from "@/lib/studio";
import { track } from "@/lib/track";

const terminal = new Set<CreativeBatchRun["status"]>(["completed", "partial", "failed", "cancelled"]);
const money = (value?: number) => value == null ? "—" : `¥${value.toFixed(2)}`;
const newIdempotencyKey = () => `ao-creative-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

export function BatchConfigDialog({ items, initialRunId, onClose, onSubmitted }: {
  items: CreativeBatchItem[]; initialRunId?: string; onClose: () => void; onSubmitted?: (runId: string) => void;
}) {
  const { lang } = useLanguage();
  const en = lang === "en";
  const dialogRef = useDialog({ onEscape: onClose });
  const [capability, setCapability] = useState<CreativeBatchCapability | null>(null);
  const [quote, setQuote] = useState<Awaited<ReturnType<typeof api.creativeBatchPrecheck>> | null>(null);
  const [run, setRun] = useState<CreativeBatchRun | null>(() => initialRunId ? { id: initialRunId, status: "unknown" } : null);
  const [runItems, setRunItems] = useState<CreativeBatchRunItem[]>([]);
  const [artifacts, setArtifacts] = useState<CreativeBatchArtifact[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [retryKey, setRetryKey] = useState(newIdempotencyKey);
  const [retryQuote, setRetryQuote] = useState<Awaited<ReturnType<typeof api.creativeBatchRetryPrecheck>> | null>(null);
  const promptMode = capability?.template?.promptModes.includes("passthrough") ? "passthrough" : "optimize";
  const config = useMemo<CreativeBatchConfig>(() => ({
    promptMode,
    outputsPerPrompt: 1,
    ...(capability?.fixed?.model && capability.configurable?.model ? { model: capability.fixed.model } : {}),
    ...(capability?.fixed?.size && capability.configurable?.size ? { size: capability.fixed.size } : {}),
  }), [capability, promptMode]);
  const imageArtifacts = useMemo(() => artifacts.filter((artifact) => artifact.mimeType?.startsWith("image/")), [artifacts]);
  const hiddenArtifactCount = artifacts.length - imageArtifacts.length;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    if (!initialRunId) return;
    api.creativeBatchRun(initialRunId).then((value) => setRun(value.run)).catch((value) => setError(value instanceof Error ? value.message : String(value)));
  }, [initialRunId]);

  useEffect(() => {
    let alive = true;
    api.creativeBatchCapability()
      .then((value) => { if (alive) setCapability(value); })
      .catch(() => { if (alive) setCapability({ ok: false, available: false, reasonCode: "no_engine", message: en ? "Batch generation needs the local AO engine." : "批量出图需要本地 AO 引擎。" }); });
    return () => { alive = false; };
  }, [en]);

  useEffect(() => {
    if (!run || terminal.has(run.status)) return;
    let cancelled = false;
    let querying = false;
    const timer = window.setInterval(async () => {
      if (querying) return;
      querying = true;
      try {
        const value = await api.creativeBatchRun(run.id);
        if (!cancelled) { setRun(value.run); setError(""); }
      } catch (value) {
        if (!cancelled) setError(value instanceof Error ? value.message : String(value));
      } finally { querying = false; }
    }, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [run?.id, run?.status]);

  useEffect(() => {
    if (!run || !terminal.has(run.status)) return;
    Promise.all([api.creativeBatchItems(run.id), api.creativeBatchArtifacts(run.id)])
      .then(([taskResult, artifactResult]) => { setRunItems(taskResult.items); setArtifacts(artifactResult.artifacts); })
      .catch(() => { /* 终态已知，明细可在重新打开后再取 */ });
  }, [run?.id, run?.status]);

  const precheck = async () => {
    setBusy(true); setError(""); setQuote(null);
    track("creative_batch_precheck", { selected_count: items.length, prompt_mode: promptMode });
    try {
      const checked = await api.creativeBatchPrecheck({ items, config });
      setQuote(checked);
      if (checked.estimatedCost == null && checked.sufficient) await submit(checked);
    }
    catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setBusy(false); }
  };

  const submit = async (checked = quote) => {
    if (!checked) return;
    setBusy(true); setError("");
    try {
      const value = await api.creativeBatchSubmit({ quoteId: checked.quoteId, idempotencyKey, items, config });
      setRun(value.run);
      onSubmitted?.(value.run.id);
      try { localStorage.setItem("ao.creative.batch.lastRun", value.run.id); } catch { /* noop */ }
      track("creative_batch_submit", { selected_count: items.length, estimated_cost: checked.estimatedCost, result: "ok" });
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
      track("creative_batch_submit", { selected_count: items.length, result: "error" });
    } finally { setBusy(false); }
  };

  const precheckRetry = async () => {
    if (!run) return;
    setBusy(true); setError(""); setRetryQuote(null);
    try { setRetryQuote(await api.creativeBatchRetryPrecheck(run.id)); }
    catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setBusy(false); }
  };

  const retryFailed = async () => {
    if (!run || !retryQuote) return;
    setBusy(true); setError("");
    try {
      const value = await api.creativeBatchRetryFailed(run.id, { quoteId: retryQuote.quoteId, idempotencyKey: retryKey });
      setRun(value.run); setRunItems([]); setArtifacts([]); setRetryQuote(null);
      setRetryKey(newIdempotencyKey());
      onSubmitted?.(value.run.id);
      try { localStorage.setItem("ao.creative.batch.lastRun", value.run.id); } catch { /* noop */ }
      track("creative_batch_retry_failed", { failed_count: run.failed ?? runItems.filter((item) => item.status === "failed").length });
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setBusy(false); }
  };

  const refreshRun = async () => {
    if (!run) return;
    setBusy(true); setError("");
    try { setRun((await api.creativeBatchRun(run.id)).run); }
    catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setBusy(false); }
  };

  const statusLabel = (status: CreativeBatchRun["status"]) => ({
    pending: en ? "Queued" : "等待中", running: en ? "Generating" : "生成中", completed: en ? "Completed" : "已完成",
    partial: en ? "Partially completed" : "部分完成", failed: en ? "Failed" : "失败", cancelled: en ? "Cancelled" : "已取消", unknown: en ? "Updating" : "状态更新中",
  })[status];

  return (
    <div ref={dialogRef} className="fixed inset-0 z-[80] flex justify-end bg-black/45" role="dialog" aria-modal="true" aria-label={en ? "Batch image generation" : "批量出图"}>
      <button tabIndex={-1} aria-label={en ? "Close" : "关闭"} className="absolute inset-0 cursor-default" onClick={onClose} />
      <section className="relative flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-border bg-background p-5 shadow-2xl outline-none">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">{en ? "Batch image generation" : "批量出图"}</h2>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <img src="/sponsors/logo-shengsuanyun-icon.png" alt="" className="size-4 rounded" />
              {en ? "Powered by ShengSuanYun LoomLoom" : "由胜算云 LoomLoom 提供批量能力"}
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-5" /></button>
        </header>

        {!capability ? (
          <p className="mt-8 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{en ? "Checking batch service…" : "正在检测批量服务…"}</p>
        ) : !capability.available ? (
          <div className="mt-8 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
            <p className="flex items-start gap-2 text-amber-700 dark:text-amber-300"><AlertCircle className="mt-0.5 size-4 shrink-0" />{capability.message || (en ? "Batch generation is not available." : "批量出图暂不可用。")}</p>
            {capability.reasonCode === "no_engine" ? (
              <>
                <p className="mt-3 leading-relaxed">{en ? "Select multiple prompts, generate images in a batch, and reopen saved tasks to view progress and results. Use the desktop app or local Studio to run this feature; the public website introduces it." : "勾选多条提示词即可批量出图，生成记录支持查看进度和结果。请在桌面 App 或本地工作台使用，官网提供功能介绍。"}</p>
                <a href="https://github.com/jnMetaCode/agency-orchestrator/releases/latest" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-primary hover:underline"><Download className="size-4" />{en ? "Download desktop app" : "下载桌面版"}</a>
                <p className="mt-2 text-xs text-muted-foreground">{en ? "CLI users: run ao web, then open the Creative Library on your local site." : "命令行用户可运行 ao web，再打开本地站点的创意库。"}</p>
              </>
            ) : <a href="/studio?tab=providers" className="mt-3 inline-flex text-primary hover:underline">{en ? "Open provider settings" : "打开供应商配置"}</a>}
          </div>
        ) : run ? (
          <div className="mt-6 space-y-4">
            {capability.demo && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                <strong>{en ? "Local demo mode" : "本地演示模式"}</strong>
                <p className="mt-1">{en ? "These are placeholder images for previewing the workflow. No real model was called and no generation fee was charged." : "当前结果是用于预览流程的占位图，没有调用真实模型，也不会产生生成费用。"}</p>
              </div>
            )}
            <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
              <div className="flex items-center justify-between gap-3">
                <strong>{statusLabel(run.status)}</strong>
                {!terminal.has(run.status) && <Loader2 className="size-4 animate-spin text-primary" />}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {run.completed ?? 0} / {run.total ?? run.itemCount ?? items.length} {en ? "completed" : "已完成"}
                {!!run.failed && ` · ${run.failed} ${en ? "failed" : "失败"}`}
              </p>
              {run.actualCost != null && <p className="mt-1 text-xs text-muted-foreground">{en ? "Actual cost" : "实际费用"}：{money(run.actualCost)}</p>}
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="font-mono text-[10px] text-muted-foreground">Run {run.id.slice(0, 8)}</p>
                <button onClick={refreshRun} disabled={busy} className="inline-flex items-center gap-1 text-[11px] text-primary disabled:opacity-50"><RefreshCw className={busy ? "size-3 animate-spin" : "size-3"} />{en ? "Refresh" : "刷新"}</button>
              </div>
            </div>
            {error && <p className="whitespace-pre-line break-words rounded-lg bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">{error}</p>}
            {runItems.some((item) => item.error) && (
              <div className="space-y-2">
                {runItems.filter((item) => item.error).map((item) => <p key={item.taskId} className="rounded-lg bg-red-500/10 p-2 text-xs text-red-600 dark:text-red-400">{item.title || item.promptId}：{item.error}</p>)}
              </div>
            )}
            {imageArtifacts.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                {imageArtifacts.map((artifact) => artifact.accessUrl && (
                  <div key={artifact.artifactId} className="overflow-hidden rounded-xl border border-border/70">
                    {artifact.mimeType?.startsWith("image/") && <img src={artifact.accessUrl} alt="" className="aspect-square w-full object-cover" referrerPolicy="no-referrer" />}
                    {(() => {
                      const source = runItems.find((item) => item.promptId === artifact.promptId || item.sourceRowIndex === artifact.sourceRowIndex);
                      return source?.title ? <p className="truncate border-t border-border/60 px-2 pt-2 text-xs font-medium" title={source.title}>{source.title}</p> : null;
                    })()}
                    <a href={`${artifact.accessUrl}?download=1`} download className="flex items-center justify-center gap-1.5 p-2 text-xs text-primary hover:bg-muted/50"><Download className="size-3.5" />{en ? "Download" : "下载"}</a>
                  </div>
                ))}
              </div>
            )}
            {hiddenArtifactCount > 0 && <p className="text-center text-[11px] text-muted-foreground">{en ? `${hiddenArtifactCount} intermediate text artifact(s) hidden` : `已隐藏 ${hiddenArtifactCount} 个中间文本产物`}</p>}
            {terminal.has(run.status) && (run.failed || runItems.some((item) => item.status === "failed")) ? (
              <div className="rounded-xl border border-border/70 p-4 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span>{en ? "Retry failed items only" : "仅重试失败项"}</span>
                  {retryQuote?.estimatedCost != null && <strong>{money(retryQuote.estimatedCost)}</strong>}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{en ? "A new child run will be created; the original run stays unchanged." : "将创建一个新的子任务，原任务记录保持不变。"}</p>
                {!retryQuote ? (
                  <button onClick={precheckRetry} disabled={busy} className="mt-3 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-primary/40 text-xs font-medium text-primary disabled:opacity-50">
                    {busy && <Loader2 className="size-3.5 animate-spin" />}{en ? "Estimate retry cost" : "预估重试费用"}
                  </button>
                ) : (
                  <button onClick={retryFailed} disabled={busy || !retryQuote.sufficient} className="mt-3 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-primary text-xs font-medium text-primary-foreground disabled:opacity-50">
                    {busy && <Loader2 className="size-3.5 animate-spin" />}{en ? "Confirm retry" : "确认重试"}{retryQuote.estimatedCost != null && ` · ${money(retryQuote.estimatedCost)}`}
                  </button>
                )}
              </div>
            ) : null}
            {error && <p className="whitespace-pre-line break-words rounded-lg bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">{error}</p>}
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {capability.demo && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                <strong>{en ? "Local demo mode" : "本地演示模式"}</strong>
                <p className="mt-1">{en ? "Submitting will return placeholder images only; it will not call ShengSuanYun or charge your account." : "提交后只会返回流程占位图，不会调用胜算云，也不会扣除账户费用。"}</p>
              </div>
            )}
            <div className="rounded-xl border border-border/70 p-4 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">{en ? "Prompts" : "提示词"}</span><strong>{items.length} {en ? "items" : "条"}</strong></div>
              <div className="mt-3 flex justify-between gap-4"><span className="text-muted-foreground">{en ? "Template" : "模板"}</span><strong className="text-right">{capability.template?.name || capability.template?.id || "—"}</strong></div>
              <div className="mt-3 flex justify-between gap-4"><span className="text-muted-foreground">{en ? "Image model" : "图片模型"}</span><strong className="text-right">{capability.fixed?.model || (capability.template?.modelPolicy === "template_managed" ? (en ? "Managed by ShengSuanYun template" : "由胜算云模板决定") : (en ? "Configurable" : "可配置"))}</strong></div>
              <div className="mt-3 flex justify-between"><span className="text-muted-foreground">{en ? "Prompt handling" : "提示词处理"}</span><strong>{promptMode === "optimize" ? (en ? "Organized by template" : "由模板整理") : (en ? "Use as-is" : "原样使用")}</strong></div>
              {capability.fixed?.size && <div className="mt-3 flex justify-between"><span className="text-muted-foreground">{en ? "Size" : "尺寸"}</span><strong>{capability.fixed.size}</strong></div>}
            </div>
            {promptMode === "optimize" && <p className="rounded-lg bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300">{en ? "This ShengSuanYun template organizes each prompt before image generation, so the final prompt may differ from the selected text." : "当前胜算云通用文生图模板会先整理每条提示词再出图，最终使用的提示词可能与所选文本不同。"}</p>}
            <p className="text-xs leading-relaxed text-muted-foreground">{en ? "You are selecting prompt text, not the sample images shown on the cards. Sample images are not sent as references. In production, prompts are sent to ShengSuanYun and the underlying model provider, and stored locally so the task can be recovered." : "这里选择的是提示词文本，不是卡片上的案例图片；案例图不会作为参考图发送。正式环境会将提示词发送给胜算云及实际模型服务商，并在本机保存以便恢复任务。"}</p>
            {quote && (quote.estimatedCost != null || quote.availableBalance != null || !quote.sufficient) && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
                {quote.estimatedCost != null && <div className="flex justify-between"><span>{en ? "Estimated cost" : "预计费用"}</span><strong>{money(quote.estimatedCost)}</strong></div>}
                {quote.availableBalance != null && <div className="mt-2 flex justify-between text-xs text-muted-foreground"><span>{en ? "Available balance" : "可用余额"}</span><span>{money(quote.availableBalance)}</span></div>}
                {!quote.sufficient && <p className="mt-2 text-xs text-red-500">{en ? "Insufficient balance" : "余额不足，暂时无法提交"}</p>}
              </div>
            )}
            {error && <p className="whitespace-pre-line break-words rounded-lg bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">{error}</p>}
            {!quote ? (
              <button onClick={precheck} disabled={busy} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary font-medium text-primary-foreground disabled:opacity-50">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}{busy ? (en ? "Checking…" : "正在校验并估价…") : (en ? "Estimate cost" : "校验并预估费用")}
              </button>
            ) : (
              <button onClick={() => submit()} disabled={busy || !quote.sufficient} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary font-medium text-primary-foreground disabled:opacity-50">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}{busy ? (en ? "Submitting…" : "正在提交…") : `${en ? "Confirm and submit" : "确认并提交"}${quote.estimatedCost != null ? ` · ${money(quote.estimatedCost)}` : ""}`}
              </button>
            )}
            <a href={capability.provider?.learnMoreUrl} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-primary">{en ? "Learn about ShengSuanYun" : "了解胜算云"}<ExternalLink className="size-3" /></a>
          </div>
        )}
      </section>
    </div>
  );
}
