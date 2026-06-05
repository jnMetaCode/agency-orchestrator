import { Check, Loader2 } from "lucide-react";
import { CopyButton } from "@/components/ui/copy-button";
import { Markdown } from "./Markdown";
import { RoleAvatar } from "./RoleAvatar";
import type { LiveStep } from "./RunManager";
import { cn } from "@/lib/utils";

export function StepList({ steps }: { steps: LiveStep[] }) {
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
              <div className="flex shrink-0 items-center gap-2">
                {s.meta && <span className="hidden text-xs text-muted-foreground sm:inline">{s.meta}</span>}
                {s.content && <CopyButton value={s.content} label="复制" copiedLabel="已复制" />}
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
          </div>
        );
      })}
    </div>
  );
}
