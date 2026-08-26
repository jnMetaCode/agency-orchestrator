import { Check, Download, Loader2, MessageSquarePlus, RotateCw } from "lucide-react";
import { useState } from "react";
import { CopyButton } from "@/components/ui/copy-button";
import { Tip } from "@/components/ui/tip";
import { Markdown } from "./Markdown";
import { RoleAvatar } from "./RoleAvatar";
import type { LiveStep } from "./RunManager";
import { useLanguage } from "@/i18n/LanguageProvider";
import { downloadText, safeFilename } from "@/lib/download";
import { cn } from "@/lib/utils";

export function StepList({
  steps,
  onFeedback,
  assetBase,
}: {
  steps: LiveStep[];
  /** 实时视图里产物链接是相对路径（assets/x.mp4），知道运行目录后改写成 /api/runs/<id>/assets 才能播 */
  assetBase?: string;
  /** 提供时，已完成的步骤会显示「提意见重做」入口（仅工作流运行、且运行已结束时传入） */
  onFeedback?: (stepId: string, feedback: string) => void;
}) {
  const { t } = useLanguage();
  if (!steps.length) return null;
  return (
    <div className="space-y-3">
      {steps.map((s) => {
        const running = s.status === "running";
        const pending = s.status === "pending";
        // CLI 结果行形如 "33.1s | 345 tokens | 验收 ✓"——把验收段拆出来做成彩色徽章
        const verifMatch = s.meta?.match(/^(.*?)(?:\s*\|\s*)?(验收\s*[✓⚠️].*)$/);
        const baseMeta = verifMatch ? verifMatch[1] : s.meta;
        const verifText = verifMatch?.[2];
        const verifPass = verifText?.includes("✓");
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
                {baseMeta && <span className="hidden text-xs text-muted-foreground sm:inline">{baseMeta}</span>}
                {verifText && (
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                      verifPass ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
                    )}
                  >
                    {verifText}
                  </span>
                )}
                {s.content && <CopyButton value={s.content} label={t.studio.shell.copy} copiedLabel={t.studio.shell.copied} />}
                {s.content && (
                  <Tip label={t.studio.shell.downloadStep}>
                    <button
                      type="button"
                      onClick={() => downloadText(safeFilename(s.name ?? s.id), s.content)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-muted/50 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Download className="size-3.5" />
                    </button>
                  </Tip>
                )}
              </div>
            </div>

            {!pending && !!s.verifyItems?.length && (
              <div className="border-t border-border/60 bg-amber-500/[0.06] px-4 py-2.5 text-xs">
                <span className="font-semibold text-amber-600 dark:text-amber-400">{t.studio.shell.verifyUnmet}</span>
                <ul className="mt-1 space-y-0.5 text-muted-foreground">
                  {s.verifyItems.map((it, i) => (
                    <li key={i}>· {it}</li>
                  ))}
                </ul>
              </div>
            )}

            {!pending && (
              <div className="max-h-[460px] overflow-auto border-t border-border/60 px-4 py-3">
                {s.content ? (
                  <>
                    <Markdown>{assetBase ? s.content.replace(/\]\((?:\.\.\/)?assets\//g, `](${assetBase}/`) : s.content}</Markdown>
                    {running && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-primary align-middle" />}
                  </>
                ) : (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    {running && <Loader2 className="size-3.5 animate-spin" />}
                    {running ? t.studio.shell.thinking : "—"}
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
  const { t } = useLanguage();
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
          {t.studio.shell.feedbackOpen}
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
        placeholder={`${t.studio.shell.feedbackPlaceholderPrefix}「${stepName}」${t.studio.shell.feedbackPlaceholderSuffix}`}
        className="w-full resize-none rounded-lg border border-border/70 bg-background px-3 py-2 text-sm outline-none focus:border-primary/60"
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">{t.studio.shell.feedbackHint}</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {t.studio.shell.cancel}
          </button>
          <button
            type="button"
            disabled={!text.trim()}
            onClick={submit}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <RotateCw className="size-3.5" />
            {t.studio.shell.feedbackSubmit}
          </button>
        </div>
      </div>
    </div>
  );
}
