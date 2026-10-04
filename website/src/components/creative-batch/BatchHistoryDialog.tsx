import { useEffect, useState } from "react";
import { AlertCircle, ChevronRight, Loader2, X } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageProvider";
import { useDialog } from "@/components/ui/use-dialog";
import { api, type CreativeBatchRun } from "@/lib/studio";

const statusText = (status: CreativeBatchRun["status"], en: boolean) => ({
  pending: en ? "Queued" : "等待中",
  running: en ? "Generating" : "生成中",
  completed: en ? "Completed" : "已完成",
  partial: en ? "Partially completed" : "部分完成",
  failed: en ? "Failed" : "失败",
  cancelled: en ? "Cancelled" : "已取消",
  unknown: en ? "Updating" : "状态更新中",
})[status];

export function BatchHistoryDialog({ onClose, onOpenRun }: { onClose: () => void; onOpenRun: (runId: string) => void }) {
  const { lang } = useLanguage();
  const en = lang === "en";
  const dialogRef = useDialog({ onEscape: onClose });
  const [runs, setRuns] = useState<CreativeBatchRun[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    let alive = true;
    api.creativeBatchRuns()
      .then((value) => { if (alive) setRuns(value.runs); })
      .catch((value) => { if (alive) { setError(value instanceof Error ? value.message : String(value)); setRuns([]); } });
    return () => { alive = false; };
  }, []);

  return (
    <div ref={dialogRef} className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-label={en ? "Batch task history" : "批量任务历史"}>
      <button tabIndex={-1} aria-label={en ? "Close" : "关闭"} className="absolute inset-0 cursor-default" onClick={onClose} />
      <section className="relative max-h-[80vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-border bg-background p-5 shadow-2xl outline-none">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">{en ? "Batch task history" : "批量任务历史"}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{en ? "The latest 20 tasks stored on this device" : "本机保存的最近 20 个任务"}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-5" /></button>
        </header>
        {runs === null ? (
          <p className="mt-8 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{en ? "Loading…" : "正在加载…"}</p>
        ) : error ? (
          <p className="mt-6 flex items-start gap-2 rounded-xl bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400"><AlertCircle className="mt-0.5 size-4 shrink-0" />{error}</p>
        ) : runs.length === 0 ? (
          <p className="mt-8 text-center text-sm text-muted-foreground">{en ? "No batch tasks yet" : "还没有批量任务"}</p>
        ) : (
          <div className="mt-5 space-y-2">
            {runs.map((run) => (
              <button key={run.id} onClick={() => onOpenRun(run.id)} className="flex w-full items-center justify-between gap-4 rounded-xl border border-border/70 p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/30">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm">{statusText(run.status, en)}</strong>
                    {run.parentRunId && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{en ? "Retry" : "重试任务"}</span>}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {run.itemCount ?? 0} {en ? "items" : "条"}
                    {run.createdAt && ` · ${new Date(run.createdAt).toLocaleString()}`}
                    {` · ${run.id.slice(0, 8)}`}
                  </p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
