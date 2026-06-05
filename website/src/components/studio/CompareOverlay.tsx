import { CheckCircle2, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { runWorkflow, type Workflow } from "@/lib/studio";
import { Markdown } from "./Markdown";

interface ColState {
  status: "pending" | "running" | "done" | "error";
  text: string;
  error?: string;
}

export function CompareOverlay({ workflows, provider, onClose }: { workflows: Workflow[]; provider: string; onClose: () => void }) {
  const [cols, setCols] = useState<Record<string, ColState>>(() =>
    Object.fromEntries(workflows.map((w) => [w.file, { status: "pending", text: "" }])),
  );
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let cancelled = false;

    (async () => {
      for (const w of workflows) {
        if (cancelled) break;
        setCols((c) => ({ ...c, [w.file]: { ...c[w.file], status: "running" } }));
        const inputs: Record<string, string> = {};
        (w.inputs ?? []).forEach((i) => (inputs[i.name] = i.default ?? ""));
        await runWorkflow(
          { file: w.file, inputs, provider: provider || undefined },
          (event, data) => {
            if (event === "step-content") {
              setCols((c) => ({ ...c, [w.file]: { ...c[w.file], text: c[w.file].text + data.text + "\n" } }));
            } else if (event === "error") {
              setCols((c) => ({ ...c, [w.file]: { ...c[w.file], status: "error", error: data.message } }));
            } else if (event === "done") {
              setCols((c) => ({ ...c, [w.file]: { ...c[w.file], status: c[w.file].status === "error" ? "error" : "done" } }));
            }
          },
          ctrl.signal,
        ).catch(() => {
          if (!ctrl.signal.aborted) setCols((c) => ({ ...c, [w.file]: { ...c[w.file], status: "error", error: "运行失败" } }));
        });
      }
    })();

    return () => {
      cancelled = true;
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/50 backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-border/60 bg-background px-5 py-3.5">
        <h3 className="font-semibold">对比运行 · {workflows.length} 个模板（顺序执行）</h3>
        <Button size="sm" variant="ghost" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>
      <div className="flex flex-1 gap-4 overflow-auto bg-background p-5">
        {workflows.map((w) => {
          const col = cols[w.file];
          return (
            <div key={w.file} className="flex min-w-[300px] max-w-[380px] flex-1 flex-col rounded-2xl border border-border/70 bg-card/60">
              <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
                <span className="truncate text-sm font-semibold">{w.name}</span>
                {col.status === "running" && <Loader2 className="size-4 shrink-0 animate-spin text-primary" />}
                {col.status === "done" && <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />}
                {col.status === "pending" && <span className="shrink-0 text-xs text-muted-foreground">等待</span>}
                {col.status === "error" && <span className="shrink-0 text-xs text-red-500">出错</span>}
              </div>
              <div className="flex-1 overflow-auto p-4">
                {col.error && <p className="text-sm text-red-500">{col.error}</p>}
                {col.text ? (
                  <Markdown>{col.text}</Markdown>
                ) : (
                  !col.error && <p className="text-sm text-muted-foreground">{col.status === "running" ? "生成中…" : "等待执行"}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
