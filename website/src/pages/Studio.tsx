import { BarChart3, Boxes, Download, History, KeyRound, Plug, TriangleAlert, Users } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { ChatPanel, type ChatRole, type ChatSeed } from "@/components/studio/ChatPanel";
import { ModelSelect } from "@/components/studio/ModelSelect";
import { ProviderSelect } from "@/components/studio/ProviderSelect";
import { ProvidersPanel } from "@/components/studio/ProvidersPanel";
import { RolesPicker } from "@/components/studio/RolesPicker";
import { RunDock } from "@/components/studio/RunDock";
import { RunProvider, useRunManager } from "@/components/studio/RunManager";
import { RunViewer } from "@/components/studio/RunViewer";
import { RunsPanel } from "@/components/studio/RunsPanel";
import { StudioDemo } from "@/components/studio/StudioDemo";
import { InstallPrompt } from "@/components/studio/InstallPrompt";
import { WorkflowsPanel } from "@/components/studio/WorkflowsPanel";
import { useBackend } from "@/components/studio/useBackend";
import { useLanguage } from "@/i18n/LanguageProvider";
import { API_PROVIDERS, api, DEFAULT_PROVIDER, getActiveProvider, hasExplicitProvider, setActiveProvider } from "@/lib/studio";
import { cn } from "@/lib/utils";

// recharts(~390kB)只在用量 tab 用 → 懒加载，避免拖累 Studio 首屏与演示模式
const UsagePanel = lazy(() => import("@/components/studio/UsagePanel").then((m) => ({ default: m.UsagePanel })));

// 需要 API key 的 provider，来自 lib/studio.ts 的统一注册表。**当前默认 provider
// （DEFAULT_PROVIDER，2026-08-17 起是 apinebula）必须在列**——否则新用户没填 key 时
// 不会弹「需要配置 key」提示，直接运行才报认证错（commit 61e84a6 改默认后遗漏过一次；
// 换默认位时留意这条）。新增 provider 只需改 API_PROVIDERS，这里自动跟上。
const KEYED = API_PROVIDERS.map((p) => p.id);

// 提示词优化已在顶部主导航单独成页(/prompt)，Studio 内不再重复一个 tab。
type Tab = "roles" | "workflows" | "runs" | "usage" | "providers";

const TAB_META: { id: Tab; icon: typeof Users }[] = [
  { id: "roles", icon: Users },
  { id: "workflows", icon: Boxes },
  { id: "runs", icon: History },
  { id: "usage", icon: BarChart3 },
  { id: "providers", icon: Plug },
];

function StudioInner() {
  const { t, lang } = useLanguage();
  const { status, version, stale } = useBackend();
  // 防御：任一 tab 文案缺失也不要让整个 Studio 渲染崩溃（否则所有 tab 都点不动）
  const TABS = TAB_META.map((tb) => ({
    ...tb,
    label: t.studio.shell.tabs[tb.id]?.label ?? tb.id,
    hint: t.studio.shell.tabs[tb.id]?.hint ?? "",
  }));
  const { start, open } = useRunManager();
  const [tab, setTabState] = useState<Tab>("roles");
  const [provider, setProviderState] = useState(getActiveProvider);
  const [keyedHas, setKeyedHas] = useState<Record<string, boolean>>({});
  const [installOpen, setInstallOpen] = useState(false);
  const offline = status !== "online";

  // 对话（不组队）：普通对话与单角色对话共用一个面板。面板常驻挂载，open 开关；
  // seed 是从任务输入框带来的首条消息；role 非空 = 带该角色人设聊
  const [chatOpen, setChatOpen] = useState(false);
  const [chatSeed, setChatSeed] = useState<ChatSeed | null>(null);
  const [chatRole, setChatRole] = useState<ChatRole | null>(null);
  const seedCounter = useRef(0);
  // refreshConfig / setTab 必须定义在引用它们的回调（escalateToTeam 等）之前，否则
  // 依赖数组 [setTab] 在渲染时求值会命中 TDZ（Cannot access 'setTab' before initialization），
  // 整个 Studio 白屏。见下方 escalateToTeam 的 [setTab] 依赖。
  const refreshConfig = useCallback(() => {
    api
      .config()
      .then((c) => {
        setKeyedHas(Object.fromEntries(Object.entries(c.providers).map(([k, v]) => [k, !!v.hasKey])));
        // 零配置首跑：用户没显式选过 provider 时，采用后端推荐（已装 CLI 优先）。
        // 不写 localStorage —— 保持「智能默认」，用户一旦手选即固定。
        if (c.recommended && !hasExplicitProvider()) setProviderState(c.recommended);
      })
      .catch(() => {});
  }, []);
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
  const openPlainChat = useCallback((seedText?: string, role?: ChatRole) => {
    setChatRole(role ?? null);
    if (seedText) setChatSeed({ text: seedText, n: ++seedCounter.current });
    setChatOpen(true);
  }, []);
  // 聊天 → 组队升级桥：关面板、切到角色页、把问题填进「AI 自动组队」输入框
  const [taskSeed, setTaskSeed] = useState<{ text: string; n: number } | null>(null);
  const escalateToTeam = useCallback((text: string) => {
    setChatOpen(false);
    setTaskSeed({ text, n: ++seedCounter.current });
    setTab("roles");
  }, [setTab]);

  const setProvider = useCallback((p: string) => {
    setActiveProvider(p);
    setProviderState(p);
  }, []);

  useEffect(() => {
    if (status === "online") refreshConfig();
  }, [status, refreshConfig]);

  const effProvider = provider || DEFAULT_PROVIDER;
  const needKeyWarning = status === "online" && KEYED.includes(effProvider) && keyedHas[effProvider] === false;

  return (
    <>
      <main className="pt-20">
        <div className="sticky top-16 z-30 border-b border-border/60 bg-background/85 backdrop-blur-xl">
          <div className="container-page flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
            <span className="flex items-center gap-2 font-bold">
              <img src="/logo/ao-app-icon.svg" alt="AO" className="size-7" />
              {t.nav.studio}
            </span>

            {status !== "checking" && (
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
                title={
                  status === "online" && stale ? t.studio.shell.engineStaleTitle
                  : status === "online" ? `${t.studio.shell.engineOnline} v${version ?? ""}`
                  : status === "offline" ? t.studio.shell.engineOffline
                  : t.studio.shell.engineChecking
                }
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                  status === "online" && !stale && "bg-emerald-500/15 text-emerald-500",
                  ((status === "online" && stale) || status === "offline") && "bg-amber-500/15 text-amber-600 dark:text-amber-400",
                  status === "checking" && "bg-muted text-muted-foreground",
                )}
              >
                <span className={cn("size-1.5 rounded-full", status === "online" && !stale ? "bg-emerald-500" : status === "checking" ? "bg-muted-foreground" : "bg-amber-500")} />
                {status === "online" ? (stale ? t.studio.shell.statusStale : t.studio.shell.statusOnline) : status === "offline" ? t.studio.shell.statusOffline : t.studio.shell.statusChecking}
              </span>
              <ProviderSelect value={provider} onChange={setProvider} onOpenProviders={() => setTab("providers")} />
              <ModelSelect provider={provider} />
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
          {tab === "providers" ? (
            // 供应商/API 面板在线、离线都能进、能填（演示站没有引擎也照样展示卡片，只是无法实际运行）
            <ProvidersPanel active={provider} onSetActive={(p) => setProvider(p)} offline={offline} />
          ) : offline ? (
            <>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/[0.07] px-4 py-3">
                <div className="min-w-0">
                  <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">{t.studio.demo.bannerTitle}</span>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{t.studio.demo.bannerDesc}</p>
                </div>
                <Button size="sm" onClick={() => setInstallOpen(true)}>
                  <Download className="size-4" />
                  {t.studio.demo.bannerInstall}
                </Button>
              </div>
              {/* 演示模式也按 tab 显示真实内容（可浏览，只是不能真跑）；运行类操作引导安装 */}
              {tab === "workflows" ? (
                <WorkflowsPanel provider={provider} onRun={start} demo onInstallPrompt={() => setInstallOpen(true)} />
              ) : tab === "runs" ? (
                <p className="mx-auto max-w-md py-16 text-center text-sm text-muted-foreground">
                  {lang === "en"
                    ? "Run History — demo mode has no records yet. Once you run workflows locally, each run's outputs, duration and tokens show here, and you can re-run from any step."
                    : "运行历史 —— 演示模式还没有记录。本地实际跑过工作流后，这里会列出每次运行的产物、耗时与 token，并支持从任意步骤重跑。"}
                </p>
              ) : tab === "usage" ? (
                <p className="mx-auto max-w-md py-16 text-center text-sm text-muted-foreground">
                  {lang === "en"
                    ? "Usage — demo mode has no data yet. After real local runs, this tab charts token usage and estimated cost by day and by role."
                    : "用量统计 —— 演示模式还没有数据。本地实际调用后，这里按天 / 按角色统计 token 用量与估算成本。"}
                </p>
              ) : (
                <>
                  <RolesPicker provider={provider} onRun={() => setInstallOpen(true)} demo onInstallPrompt={() => setInstallOpen(true)} />
                  <StudioDemo />
                </>
              )}
            </>
          ) : tab === "roles" ? (
            <RolesPicker provider={provider} onRun={start} onGoToWorkflows={() => setTab("workflows")} onPlainChat={openPlainChat} taskSeed={taskSeed} />
          ) : tab === "workflows" ? (
            <WorkflowsPanel provider={provider} onRun={start} />
          ) : tab === "runs" ? (
            <RunsPanel provider={provider} onRun={start} />
          ) : tab === "usage" ? (
            <Suspense fallback={<div className="py-20 text-center text-sm text-muted-foreground">…</div>}>
              <UsagePanel />
            </Suspense>
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
        onGoProviders={() => setTab("providers")}
      />
      <ChatPanel open={chatOpen} seed={chatSeed} role={chatRole} provider={effProvider} onClose={() => setChatOpen(false)} onEscalate={escalateToTeam} />
      <RunDock />
      {installOpen && <InstallPrompt onClose={() => setInstallOpen(false)} />}
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
