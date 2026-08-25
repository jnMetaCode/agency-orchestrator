import { ExternalLink, Sparkles, WandSparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { useLanguage } from "@/i18n/LanguageProvider";
import type { RunRequest } from "@/components/studio/RunManager";
import { WorkflowsPanel } from "@/components/studio/WorkflowsPanel";
import type { Workflow } from "@/lib/studio";

/** 含文生图 / 文生视频步骤的模板 */
export const isCreativeWorkflow = (w: Workflow) => !!w.steps?.some((s) => s.type === "image" || s.type === "video");

/**
 * Studio「创意出片」：把引擎的图片/视频能力从工作流列表里拎出来单独露出——
 * 桌面小白用户打开 Studio 应当一眼看到"能出图出片"，而不是在 27 个模板里找。
 * 列表复用 WorkflowsPanel（filter 只留媒体模板），顶部给创意库与提示词工坊入口。
 */
export function CreativePanel({ provider, onRun, demo, onInstallPrompt }: { provider: string; onRun: (r: RunRequest) => void; demo?: boolean; onInstallPrompt?: () => void }) {
  const { t, prefix } = useLanguage();
  const c = t.studio.shell.creative;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-border/60 bg-card/50 p-4">
        <div className="min-w-0 max-w-2xl">
          <h2 className="flex items-center gap-2 text-base font-bold"><Sparkles className="size-4 text-primary" />{c.title}</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{c.desc}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link to={prefix("/creative")} className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary/50 hover:text-primary">
            {c.openLibrary} <ExternalLink className="size-3" />
          </Link>
          <Link to={prefix("/prompt")} className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary/50 hover:text-primary">
            <WandSparkles className="size-3.5" /> {c.promptLab}
          </Link>
        </div>
      </div>
      <WorkflowsPanel provider={provider} onRun={onRun} demo={demo} onInstallPrompt={onInstallPrompt} filter={isCreativeWorkflow} />
    </div>
  );
}
