import { Boxes, Check, ChevronDown, Loader2, Play, Sparkles, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import type { ComposeResult, Workflow } from "@/lib/studio";
import { RoleAvatar } from "./RoleAvatar";
import type { RunRequest } from "./RunManager";

export function ComposePreview({
  result,
  meta,
  loadingMeta,
  provider,
  onRun,
  onClose,
  onGoToWorkflows,
}: {
  result: ComposeResult;
  meta: Workflow | null;
  loadingMeta: boolean;
  provider: string;
  onRun: (r: RunRequest) => void;
  onClose: () => void;
  onGoToWorkflows?: () => void;
}) {
  const [showYaml, setShowYaml] = useState(false);
  const steps = meta?.steps ?? [];
  const name = meta?.name || "新团队";

  const run = () => {
    onRun({ kind: "workflow", title: name, file: result.file, provider: provider || undefined, cast: meta?.steps });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[58] flex items-stretch justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose}>
      <div
        className="flex w-full max-w-2xl flex-col overflow-hidden rounded-none border border-border/70 bg-background shadow-2xl sm:max-h-[86vh] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-gradient-to-r from-primary/[0.07] to-transparent px-5 py-4">
          <h3 className="flex items-center gap-2 font-bold">
            <Sparkles className="size-4 text-primary" />
            AI 合成了一支团队
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5">
          {!!result.warnings?.length && (
            <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/[0.08] px-4 py-2.5 text-xs text-amber-600 dark:text-amber-400">
              <TriangleAlert className="mr-1 inline size-3.5" />
              {result.warnings.join("；")}
            </div>
          )}

          <div className="mb-1 text-sm font-semibold">{name}</div>
          {meta?.description && <p className="mb-3 text-xs text-muted-foreground">{meta.description}</p>}

          {loadingMeta ? (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> 解析编排…
            </p>
          ) : steps.length ? (
            <ol className="space-y-2">
              {steps.map((s, i) => (
                <li key={s.id} className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/60 px-3 py-2.5">
                  <span className="w-4 shrink-0 text-right text-xs text-muted-foreground">{i + 1}</span>
                  <RoleAvatar seed={s.role || s.id} name={s.name} className="size-8" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{s.name ?? s.id}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{s.role}</span>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="py-4 text-sm text-muted-foreground">已生成工作流，展开下方 YAML 查看详情。</p>
          )}

          <button
            onClick={() => setShowYaml((v) => !v)}
            className="mt-4 flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={`size-3.5 transition-transform ${showYaml ? "rotate-180" : ""}`} />
            查看工作流 YAML
          </button>
          {showYaml && (
            <div className="relative mt-2">
              <div className="absolute right-2 top-2">
                <CopyButton value={result.yaml} className="border-white/10 bg-white/5 text-white/60" />
              </div>
              <pre className="max-h-72 overflow-auto rounded-xl border border-border/70 bg-[#0b0e16] p-4 font-mono text-xs leading-relaxed text-white/85">
                {result.yaml}
              </pre>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-5 py-3">
          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-500">
            <Check className="size-3.5" />
            已存入「工作流」,下次可直接用{steps.length ? ` · ${steps.length} 步` : ""}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              取消
            </Button>
            {onGoToWorkflows && (
              <Button variant="outline" onClick={onGoToWorkflows}>
                <Boxes className="size-4" />
                去工作流
              </Button>
            )}
            <Button onClick={run}>
              <Play className="size-4" />
              运行这支团队
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
