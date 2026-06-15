import { BarChart3, Boxes, History, KeyRound, Plug, TriangleAlert, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { ProvidersPanel } from "@/components/studio/ProvidersPanel";
import { RolesPicker } from "@/components/studio/RolesPicker";
import { RunDock } from "@/components/studio/RunDock";
import { RunProvider, useRunManager } from "@/components/studio/RunManager";
import { RunViewer } from "@/components/studio/RunViewer";
import { RunsPanel } from "@/components/studio/RunsPanel";
import { StudioGate } from "@/components/studio/StudioGate";
import { StudioDemo } from "@/components/studio/StudioDemo";
import { UsagePanel } from "@/components/studio/UsagePanel";
import { WorkflowsPanel } from "@/components/studio/WorkflowsPanel";
import { useBackend } from "@/components/studio/useBackend";
import { useLanguage } from "@/i18n/LanguageProvider";
import { api, getActiveProvider, PROVIDER_LABELS, PROVIDERS, setActiveProvider } from "@/lib/studio";
import { cn } from "@/lib/utils";

const KEYED = ["deepseek", "compshare", "openai", "claude"];

type Tab = "roles" | "workflows" | "runs" | "usage" | "providers";

const TAB_META: { id: Tab; icon: typeof Users }[] = [
  { id: "roles", icon: Users },
  { id: "workflows", icon: Boxes },
  { id: "runs", icon: History },
  { id: "usage", icon: BarChart3 },
  { id: "providers", icon: Plug },
];

function StudioInner() {
  const { t } = useLanguage();
  const { status, version, recheck } = useBackend();
  const TABS = TAB_META.map((tb) => ({
    ...tb,
    label: t.studio.shell.tabs[tb.id].label,
    hint: t.studio.shell.tabs[tb.id].hint,
  }));
  const { start, open } = useRunManager();
  const [tab, setTabState] = useState<Tab>("roles");
  const [provider, setProviderState] = useState(getActiveProvider);
  const [keyedHas, setKeyedHas] = useState<Record<string, boolean>>({});

  const setProvider = useCallback((p: string) => {
    setActiveProvider(p);
    setProviderState(p);
  }, []);

  const refreshConfig = useCallback(() => {
    api
      .config()
      .then((c) => setKeyedHas(Object.fromEntries(Object.entries(c.providers).map(([k, v]) => [k, !!v.hasKey]))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (status === "online") refreshConfig();
  }, [status, refreshConfig]);

  // Refresh key status whenever leaving the providers tab (so the warning clears).
  const setTab = useCallback(
    (t: Tab) => {
      setTabState((prev) => {
        if (prev === "providers" && t !== "providers") refreshConfig();
        return t;
      });
    },
    [refreshConfig],
  );

  const effProvider = provider || "deepseek";
  const needKeyWarning = status === "online" && KEYED.includes(effProvider) && keyedHas[effProvider] === false;

  return (
    <>
      <main className="pt-20">
        <div className="sticky top-16 z-30 border-b border-border/60 bg-background/85 backdrop-blur-xl">
          <div className="container-page flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
            <span className="flex items-center gap-2 font-bold">
              <span className="grid size-7 place-items-center rounded-lg bg-primary text-sm text-primary-foreground">ao</span>
              Studio
            </span>

            {status === "online" && (
              <nav className="flex flex-1 gap-1 overflow-x-auto rounded-xl bg-muted/50 p-1">
                {TABS.map((tb) => {
                  const Icon = tb.icon;
                  const on = tab === tb.id;
                  return (
                    <button
                      key={tb.id}
                      onClick={() => setTab(tb.id)}
                      title={tb.hint}
                      className={cn(
                        "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                        on ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4" />
                      {tb.label}
                    </button>
                  );
                })}
              </nav>
            )}

            <div className="ml-auto flex items-center gap-2">
              <span
                title={status === "online" ? `${t.studio.shell.engineOnline} v${version ?? ""}` : status === "offline" ? t.studio.shell.engineOffline : t.studio.shell.engineChecking}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                  status === "online" && "bg-emerald-500/15 text-emerald-500",
                  status === "offline" && "bg-amber-500/15 text-amber-600 dark:text-amber-400",
                  status === "checking" && "bg-muted text-muted-foreground",
                )}
              >
                <span className={cn("size-1.5 rounded-full", status === "online" ? "bg-emerald-500" : status === "offline" ? "bg-amber-500" : "bg-muted-foreground")} />
                {status === "online" ? t.studio.shell.statusOnline : status === "offline" ? t.studio.shell.statusOffline : t.studio.shell.statusChecking}
              </span>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                title={t.studio.shell.providerSelectTitle}
                className="h-8 rounded-lg border border-border/70 bg-card/60 px-2 text-sm text-foreground outline-none"
              >
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {p === "" ? t.studio.shell.providerDefault : (PROVIDER_LABELS[p] ?? p)}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="outline" onClick={() => setTab("providers")}>
                <KeyRound className="size-4" />
                <span className="hidden sm:inline">{t.studio.shell.keys}</span>
              </Button>
            </div>
          </div>
        </div>

        <div className="container-page py-8">
          {needKeyWarning && (
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/[0.08] px-4 py-3">
              <span className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                <TriangleAlert className="size-4 shrink-0" />
                {`${t.studio.shell.noKeyWarningPrefix}「${effProvider}」${t.studio.shell.noKeyWarningSuffix}`}
              </span>
              <Button size="sm" variant="outline" onClick={() => setTab("providers")}>
                <KeyRound className="size-4" />
                {t.studio.shell.setUpNow}
              </Button>
            </div>
          )}
          {status !== "online" ? (
            <>
              <StudioDemo />
              <StudioGate checking={status === "checking"} onRetry={recheck} />
            </>
          ) : tab === "roles" ? (
            <RolesPicker provider={provider} onRun={start} onGoToWorkflows={() => setTab("workflows")} />
          ) : tab === "workflows" ? (
            <WorkflowsPanel provider={provider} onRun={start} />
          ) : tab === "runs" ? (
            <RunsPanel provider={provider} onRun={start} />
          ) : tab === "usage" ? (
            <UsagePanel />
          ) : (
            <ProvidersPanel active={provider} onSetActive={(p) => setProvider(p)} />
          )}
        </div>
      </main>

      <RunViewer
        onViewHistory={() => {
          open(null);
          setTab("runs");
        }}
      />
      <RunDock />
      <SiteFooter />
    </>
  );
}

export default function Studio() {
  return (
    <RunProvider>
      <StudioInner />
    </RunProvider>
  );
}
