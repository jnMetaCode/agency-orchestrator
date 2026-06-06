import { Check, Copy, Download, Loader2, Minus, Square, Terminal, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/components/ui/copy-button";
import { StepList } from "./StepList";
import { useRunManager } from "./RunManager";
import { downloadText, safeFilename } from "@/lib/download";
import { cn } from "@/lib/utils";

export function RunViewer({ onViewHistory }: { onViewHistory?: () => void }) {
  const { runs, openId, open, stop, rerunWithFeedback } = useRunManager();
  const run = runs.find((r) => r.id === openId) || null;
  const [showTerminal, setShowTerminal] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { copied, copy } = useCopy();

  const running = run?.state === "running";
  const contentLen = run ? run.steps.reduce((n, s) => n + s.content.length, 0) : 0;

  // Auto-scroll to bottom while streaming.
  useEffect(() => {
    if (running && scrollRef.current && !showTerminal) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [contentLen, running, showTerminal]);

  const fullText = useMemo(() => {
    if (!run) return "";
    return run.steps
      .filter((s) => s.content.trim())
      .map((s) => (run.kind === "role" ? s.content.trim() : `## ${s.name ?? s.id}\n\n${s.content.trim()}`))
      .join("\n\n---\n\n");
  }, [run]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && run) open(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run, open]);

  if (!run) return null;
  const doneCount = run.steps.filter((s) => s.status === "done").length;

  return (
    <div className="fixed inset-0 z-[60] flex items-stretch justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-6">
      <div className="flex w-full max-w-2xl flex-col overflow-hidden rounded-none border border-border/70 bg-background shadow-2xl sm:max-h-[84vh] sm:rounded-2xl">
        {/* header */}
        <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-gradient-to-r from-primary/[0.07] to-transparent px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            {running && <Loader2 className="size-4 shrink-0 animate-spin text-primary" />}
            <h3 className="truncate font-semibold">{run.title}</h3>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                running && "bg-primary/15 text-primary",
                run.state === "done" && "bg-emerald-500/15 text-emerald-500",
                run.state === "error" && "bg-red-500/15 text-red-500",
              )}
            >
              {running ? (run.steps.length ? `运行中 ${doneCount}/${run.steps.length}` : "运行中") : run.state === "done" ? "完成" : "出错"}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button size="icon" variant="ghost" title="终端输出" onClick={() => setShowTerminal((v) => !v)}>
              <Terminal className="size-4" />
            </Button>
            {running && (
              <Button size="sm" variant="ghost" title="后台运行（继续在后台跑）" onClick={() => open(null)}>
                <Minus className="size-4" />
                后台
              </Button>
            )}
            {running ? (
              <Button size="sm" variant="outline" onClick={() => stop(run.id)}>
                <Square className="size-3.5" />
                停止
              </Button>
            ) : (
              <Button size="icon" variant="ghost" onClick={() => open(null)}>
                <X className="size-4" />
              </Button>
            )}
          </div>
        </div>

        {/* body */}
        <div ref={scrollRef} className="flex-1 overflow-auto p-5">
          {run.error && (
            <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">{run.error}</div>
          )}
          {showTerminal ? (
            <pre className="overflow-auto rounded-xl border border-border/70 bg-[#0b0e16] p-4 font-mono text-xs leading-relaxed text-white/80">
              {run.terminal || "（暂无终端输出）"}
            </pre>
          ) : run.steps.length === 0 && running ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
              <Loader2 className="size-6 animate-spin text-primary" />
              <p className="text-sm">正在唤起团队、规划步骤…</p>
            </div>
          ) : (
            <StepList
              steps={run.steps}
              onFeedback={
                run.kind === "workflow" && !running && run.state === "done" && run.source
                  ? (stepId, feedback) => rerunWithFeedback(run.id, stepId, feedback)
                  : undefined
              }
            />
          )}
          {run.summary && !running && (
            <div className="mt-4 rounded-xl border border-primary/30 bg-primary/[0.06] px-4 py-3 text-sm font-medium text-primary">
              {run.summary}
            </div>
          )}
        </div>

        {/* footer */}
        <div className="flex items-center justify-between gap-2 border-t border-border/60 px-5 py-3">
          <span className="truncate text-xs text-muted-foreground">
            {running ? "可点「后台」离开，任务继续跑" : run.state === "done" ? "✓ 已存入运行历史" : ""}
          </span>
          <div className="flex shrink-0 gap-2">
            {!!fullText && (
              <>
                <Button size="sm" variant="outline" onClick={() => copy(fullText)}>
                  {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                  {copied ? "已复制" : "复制"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => downloadText(safeFilename(`${run.title}-${new Date().toISOString().slice(0, 10)}`), fullText)}
                >
                  <Download className="size-3.5" />
                  下载 .md
                </Button>
              </>
            )}
            {!running && run.state === "done" && onViewHistory && (
              <Button size="sm" variant="ghost" onClick={() => onViewHistory()}>
                查看历史
              </Button>
            )}
            {!running && (
              <Button size="sm" onClick={() => open(null)}>
                关闭
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
