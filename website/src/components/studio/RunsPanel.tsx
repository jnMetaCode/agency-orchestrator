import { CheckCircle2, ChevronDown, Clock, Loader2, RotateCcw, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { api, type RunSummary } from "@/lib/studio";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown";
import type { RunRequest } from "./RunManager";

function RunDetail({ id, provider, onRun }: { id: string; provider: string; onRun: (r: RunRequest) => void }) {
  const [run, setRun] = useState<RunSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    api
      .run(id)
      .then((r) => {
        setRun(r);
        setOpen(r.steps?.[r.steps.length - 1]?.id ?? null);
      })
      .catch((e) => setErr(e.message));
  }, [id]);

  if (err) return <p className="px-4 py-3 text-sm text-red-500">{err}</p>;
  if (!run)
    return (
      <p className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> 加载详情…
      </p>
    );

  const canResume = !!run.file;

  return (
    <div className="space-y-2 border-t border-border/60 bg-muted/20 p-4">
      {!canResume && <p className="text-xs text-muted-foreground">该记录缺少源文件路径，无法重跑。</p>}
      {(run.steps ?? []).map((s) => {
        const isOpen = open === s.id;
        return (
          <div key={s.id} className="overflow-hidden rounded-xl border border-border/70 bg-card/60">
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <button onClick={() => setOpen(isOpen ? null : s.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium">
                <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
                <span className="shrink-0">{s.agentEmoji ?? "•"}</span>
                <span className="truncate">{s.agentName ?? s.id}</span>
                {s.duration && <span className="shrink-0 text-xs text-muted-foreground">{s.duration}</span>}
              </button>
              <div className="flex shrink-0 items-center gap-1.5">
                {s.content && <CopyButton value={s.content} />}
                {canResume && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      onRun({
                        kind: "workflow",
                        title: `从「${s.agentName ?? s.id}」重跑 · ${run.name}`,
                        file: run.file!,
                        provider: provider || undefined,
                        resume: run.id,
                        fromStep: s.id,
                      })
                    }
                  >
                    <RotateCcw className="size-3.5" />
                    从此步重跑
                  </Button>
                )}
              </div>
            </div>
            {isOpen && s.content && (
              <div className="max-h-80 overflow-auto border-t border-border/60 px-3 py-2.5">
                <Markdown>{s.content}</Markdown>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function RunsPanel({ provider, onRun }: { provider: string; onRun: (r: RunRequest) => void }) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    api
      .runs()
      .then(setRuns)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading)
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> 加载历史…
      </div>
    );
  if (err) return <p className="py-20 text-center text-sm text-red-500">加载失败：{err}</p>;
  if (!runs.length) return <p className="py-20 text-center text-sm text-muted-foreground">还没有运行记录。去「角色组队」或「工作流」跑一个吧。</p>;

  return (
    <div className="space-y-2.5">
      {runs.map((r) => {
        const isOpen = openId === r.id;
        return (
          <div key={r.id} className="overflow-hidden rounded-2xl border border-border/70 bg-card/60">
            <button onClick={() => setOpenId(isOpen ? null : r.id)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
              <div className="flex min-w-0 items-center gap-3">
                {r.success ? <CheckCircle2 className="size-5 shrink-0 text-emerald-500" /> : <XCircle className="size-5 shrink-0 text-red-500" />}
                <div className="min-w-0">
                  <div className="truncate font-semibold">{r.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{r.id}</div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                <span>
                  {r.completedCount ?? r.stepCount ?? 0}/{r.stepCount ?? 0} 步
                </span>
                {r.duration && (
                  <span className="inline-flex items-center gap-1">
                    <Clock className="size-3.5" />
                    {r.duration}
                  </span>
                )}
                <ChevronDown className={cn("size-4 transition-transform", isOpen && "rotate-180")} />
              </div>
            </button>
            {isOpen && <RunDetail id={r.id} provider={provider} onRun={onRun} />}
          </div>
        );
      })}
    </div>
  );
}
