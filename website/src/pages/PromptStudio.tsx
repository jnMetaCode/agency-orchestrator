import { useState } from "react";
import { Sparkles } from "lucide-react";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { InstallPrompt } from "@/components/studio/InstallPrompt";
import { ModelSelect } from "@/components/studio/ModelSelect";
import { PromptLab } from "@/components/studio/PromptLab";
import { ProviderSelect } from "@/components/studio/ProviderSelect";
import { useBackend } from "@/components/studio/useBackend";
import { useLanguage } from "@/i18n/LanguageProvider";
import { useSeo } from "@/lib/useSeo";
import { getActiveProvider, setActiveProvider } from "@/lib/studio";

/**
 * 独立「提示词优化」页（顶部导航入口，挨着专家库）。
 * 公开站(无后端→demo)也能优化/测试——走 Cloudflare Pages Function 代理的免费额度；
 * 保存/版本/多结果评分等需本地引擎,演示时引导安装。本地 ao web 则全功能。
 */
export default function PromptStudio() {
  const { t, lang } = useLanguage();
  useSeo(
    lang === "en" ? "Prompt Generator — AI turns your idea into an effective prompt | Agency Orchestrator"
      : "提示生成 — AI 帮你生成更有效的提示词 | Agency Orchestrator",
    lang === "en" ? "Generate, test and compare prompts with AI. System & user prompt generation, free to try."
      : "用 AI 生成、测试、对比提示词。系统/用户提示词生成,免费试用。",
  );
  const { status } = useBackend();
  const [installOpen, setInstallOpen] = useState(false);
  const [provider, setProviderState] = useState(getActiveProvider);
  const [configRevision, setConfigRevision] = useState(0);
  const offline = status !== "online";
  const changeProvider = (next: string) => {
    setActiveProvider(next);
    setProviderState(next);
    setConfigRevision((value) => value + 1);
  };

  return (
    <>
      <main className="pt-20">
        <div className="container-page py-8">
          <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
                <Sparkles className="size-6 text-primary" />
                {t.nav.prompt}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {lang === "en"
                  ? "Generate, test and compare prompts — turn a rough idea into reusable assets. Free to try here; install for the full flow."
                  : "一句想法生成可用提示词——可测试 · 可对比 · 可沉淀的资产。这里可免费试用；完整流程本地安装后使用。"}
              </p>
            </div>
            {!offline && (
              <div className="flex items-center gap-2">
                <ProviderSelect value={provider} onChange={changeProvider} onOpenProviders={() => { window.location.href = "/studio?tab=providers"; }} />
                <ModelSelect provider={provider} onModelChange={() => setConfigRevision((value) => value + 1)} />
              </div>
            )}
          </header>
          <PromptLab provider={provider} demo={offline} onInstallPrompt={() => setInstallOpen(true)} hideHeader configRevision={configRevision} />
        </div>
      </main>
      {installOpen && <InstallPrompt onClose={() => setInstallOpen(false)} />}
      <SiteFooter />
    </>
  );
}
