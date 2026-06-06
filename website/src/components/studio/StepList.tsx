import { Check, Download, Loader2, MessageSquarePlus, RotateCw } from "lucide-react";
import { useState } from "react";
import { CopyButton } from "@/components/ui/copy-button";
import { Markdown } from "./Markdown";
import { RoleAvatar } from "./RoleAvatar";
import type { LiveStep } from "./RunManager";
import { downloadText, safeFilename } from "@/lib/download";
import { cn } from "@/lib/utils";

export function StepList({
  steps,
  onFeedback,
}: {
  steps: LiveStep[];
  /** 提供时，已完成的步骤会显示「提意见重做」入口（仅工作流运行、且运行已结束时传入） */
  onFeedback?: (stepId: string, feedback: string) => void;
}) {
  if (!steps.length) return null;
  return (
    <div className="space-y-3">
      {steps.map((s) => {
        const running = s.status === "running";
        const pending = s.status === "pending";
        return (
          <div
            key={s.id}
            className={cn(
              "rounded-2xl border transition-all",
              running ? "border-primary/50 bg-card/70 shadow-lg shadow-primary/10" : "border-border/70 bg-card/50",
              pending && "opacity-55",
            )}
          >
            <div className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5 text-sm font-semibold">
                {running ? (
                  <Loader2 className="size-5 shrink-0 animate-spin text-primary" />
                ) : s.avatarSeed ? (
                  <RoleAvatar seed={s.avatarSeed} name={s.name} className="size-6" />
                ) : (
                  <span className="shrink-0">{s.emoji ?? "•"}</span>
                )}
                <span className="truncate">{s.name ?? s.id}</span>
                {s.cur != null && s.total != null && (
                  <span className="shrink-0 rounded-full bg-muted/70 px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">
                    {s.cur}/{s.total}
                  </span>
                )}
                {s.status === "done" && <Check className="size-3.5 shrink-0 text-emerald-500" />}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {s.meta && <span className="hidden text-xs text-muted-foreground sm:inline">{s.meta}</span>}
                {s.content && <CopyButton value={s.content} label="复制" copiedLabel="已复制" />}
                {s.content && (
                  <button
                    type="button"
                    title="下载本步 .md"
                    onClick={() => downloadText(safeFilename(s.name ?? s.id), s.content)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-muted/50 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Download className="size-3.5" />
                  </button>
                )}
              </div>
            </div>

            {!pending && (
              <div className="max-h-[460px] overflow-auto border-t border-border/60 px-4 py-3">
                {s.content ? (
                  <>
                    <Markdown>{s.content}</Markdown>
                    {running && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-primary align-middle" />}
                  </>
                ) : (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    {running && <Loader2 className="size-3.5 animate-spin" />}
                    {running ? "思考中…" : "—"}
                  </p>
                )}
              </div>
            )}

            {onFeedback && s.status === "done" && s.content.trim() && (
              <StepFeedback stepName={s.name ?? s.id} onSubmit={(text) => onFeedback(s.id, text)} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 单个步骤的「提意见重做」入口：折叠态一个按钮，展开后输入意见交回给该专家。 */
function StepFeedback({ stepName, onSubmit }: { stepName: string; onSubmit: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  if (!open) {
    return (
      <div className="border-t border-border/60 px-4 py-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          <MessageSquarePlus className="size-3.5" />
          提意见重做
        </button>
      </div>
    );
  }

  const submit = () => {
    if (!text.trim()) return;
    onSubmit(text.trim());
    setText("");
    setOpen(false);
  };

  return (
    <div className="space-y-2 border-t border-border/60 px-4 py-3">
      <textarea
        autoFocus
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder={`想让「${stepName}」怎么改？例如：结尾加个反转 / 预算压到 5000 以内…`}
        className="w-full resize-none rounded-lg border border-border/70 bg-background px-3 py-2 text-sm outline-none focus:border-primary/60"
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">带着这步上一版产出 + 你的意见，让 Ta 在原稿上改</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!text.trim()}
            onClick={submit}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <RotateCw className="size-3.5" />
            交给 Ta 重做
          </button>
        </div>
      </div>
    </div>
  );
}
