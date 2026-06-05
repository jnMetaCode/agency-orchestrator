import { CheckCircle2, Loader2, X, XCircle } from "lucide-react";
import { useRunManager } from "./RunManager";
import { cn } from "@/lib/utils";

export function RunDock() {
  const { runs, openId, open, remove } = useRunManager();
  // Show every run that isn't currently open in the viewer.
  const docked = runs.filter((r) => r.id !== openId);
  if (!docked.length) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-72 flex-col gap-2">
      {docked.map((r) => {
        const running = r.state === "running";
        const done = r.steps.filter((s) => s.status === "done").length;
        return (
          <button
            key={r.id}
            onClick={() => open(r.id)}
            className={cn(
              "group flex items-center gap-2.5 rounded-xl border bg-card/95 px-3 py-2.5 text-left shadow-lg backdrop-blur transition-colors hover:border-primary/50",
              running ? "border-primary/40" : "border-border/70",
            )}
          >
            {running ? (
              <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
            ) : r.state === "error" ? (
              <XCircle className="size-4 shrink-0 text-red-500" />
            ) : (
              <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{r.title}</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {running ? (r.steps.length ? `运行中 · ${done}/${r.steps.length} 步` : "运行中…") : r.state === "error" ? "出错" : "已完成 · 点击查看"}
              </span>
            </span>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                remove(r.id);
              }}
              className="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
              title="移除"
            >
              <X className="size-3.5" />
            </span>
          </button>
        );
      })}
    </div>
  );
}
