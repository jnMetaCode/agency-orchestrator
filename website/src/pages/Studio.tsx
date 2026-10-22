import { Clapperboard, Download, History, KeyRound, Monitor, Library, Rocket, Settings, TriangleAlert, WandSparkles } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { ChatPanel, type ChatRole, type ChatSeed } from "@/components/studio/ChatPanel";
import { CreativePanel } from "@/components/studio/CreativePanel";
import { MediaSelect } from "@/components/studio/MediaSelect";
import { ModelSelect } from "@/components/studio/ModelSelect";
import { ProviderSelect } from "@/components/studio/ProviderSelect";
import { ResourcesPanel } from "@/components/studio/ResourcesPanel";
import { ToolsPanel } from "@/components/studio/ToolsPanel";
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
// 顶栏提供任务、运行、创意、工具状态、资源发现和设置入口。
// 旧的 5 tab（roles/workflows/runs/usage/providers）保留为子视图 id，?tab= 深链兼容。
type Tab = "start" | "runs" | "create" | "tools" | "resources" | "settings";
type StartView = "roles" | "workflows";
type SettingsView = "providers" | "usage";
type LegacyTab = Tab | StartView | SettingsView;

const TAB_META: { id: Tab; icon: typeof Rocket }[] = [
  { id: "start", icon: Rocket },
  { id: "runs", icon: History },
  { id: "create", icon: Clapperboard },
  { id: "tools", icon: Monitor },
  { id: "resources", icon: Library },
  { id: "settings", icon: Settings },
];

/** 旧 tab id → 新 tab + 子视图（创意库深链 ?tab=workflows 等仍然有效） */
function resolveTab(qp: string | null): { tab: Tab; start?: StartView; settings?: SettingsView } {
  switch (qp) {
    case "roles": return { tab: "start", start: "roles" };
    case "workflows": return { tab: "start", start: "workflows" };
    case "providers": return { tab: "settings", settings: "providers" };
    case "usage": return { tab: "settings", settings: "usage" };
    case "resources": case "tools": case "runs": case "create": case "settings": case "start": return { tab: qp };
    default: return { tab: "start" };
  }
}

function StudioInner() {
  const { t, lang, prefix } = useLanguage();
  const { status, version, stale, latest, updateAvailable, blocked } = useBackend();
  // 防御：任一 tab 文案缺失也不要让整个 Studio 渲染崩溃（否则所有 tab 都点不动）
  const TABS = TAB_META.map((tb) => ({
    ...tb,
    label: t.studio.shell.tabs[tb.id]?.label ?? tb.id,
    hint: t.studio.shell.tabs[tb.id]?.hint ?? "",
  }));
  const { start, open } = useRunManager();
  // ?tab=workflows 深链：创意库的视频卡要能一步跳到「一句话出短片」，
  // 落在默认的"角色组队"页再让用户自己找，等于把闭环断在最后一米。
  const [searchParams, setSearchParams] = useSearchParams();
  const initial = resolveTab(searchParams.get("tab"));
  const [tab, setTabState] = useState<Tab>(initial.tab);
  const [startView, setStartView] = useState<StartView>(initial.start ?? "roles");
  const [settingsView, setSettingsView] = useState<SettingsView>(initial.settings ?? "providers");
  const [provider, setProviderState] = useState(getActiveProvider);
  const [keyedHas, setKeyedHas] = useState<Record<string, boolean>>({});
  const [installOpen, setInstallOpen] = useState(false);
  const offline = status !== "online";

  useEffect(() => {
    const next = resolveTab(searchParams.get("tab"));
    setTabState(next.tab);
    if (next.start) setStartView(next.start);
    if (next.settings) setSettingsView(next.settings);
  }, [searchParams]);

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
  // Accept legacy tab IDs; the URL preserves direct links and browser history.
  // 接受旧 id：代码里各处 setTab("providers") / setTab("workflows") 不用改，自动落到对应子视图
  const setTab = useCallback(
    (id: LegacyTab) => {
      setSearchParams(prev => { const next = new URLSearchParams(prev); next.set("tab", id); return next; });
      const r = resolveTab(id);
      if (r.start) setStartView(r.start);
      if (r.settings) setSettingsView(r.settings);
      setTabState(r.tab);
    },
    [setSearchParams],
  );
  // 子视图切换条（开始做事 / 设置 两个 tab 下各有两个子视图）
  const subNav = (items: [string, string][], value: string, onChange: (v: string) => void, extra?: React.ReactNode) => (
    <div className="mb-4 flex flex-wrap items-center gap-1">
      {items.map(([id, label]) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-medium transition-colors",
            value === id ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
      {extra}
    </div>
  );
  const subLabel = (id: LegacyTab | "prompt") => t.studio.shell.tabs[id]?.label ?? id;
  const startSubNav = subNav(
    [["roles", subLabel("roles")], ["workflows", subLabel("workflows")]],
    startView,
    (v) => setTab(v as StartView),
    // 提示词工坊是独立页（/prompt），这里只给入口不重复 tab
    <Link to={prefix("/prompt")} className="ml-auto inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-primary">
      <WandSparkles className="size-3.5" /> {subLabel("prompt")}
    </Link>,
  );
  const settingsSubNav = subNav([["providers", subLabel("providers")], ["usage", subLabel("usage")]], settingsView, (v) => setTab(v as SettingsView));
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
    // Read-only tools/resources views use dedicated sanitized endpoints. Avoid
    // fetching unrelated provider settings (whose URLs may contain credentials).
    if (status === "online" && tab !== "tools" && tab !== "resources") refreshConfig();
  }, [status, refreshConfig, tab]);

  const tabNavigation = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = tabNavigation.current;
    if (!nav) return;
    const keepActiveVisible = () => {
      if (nav.scrollWidth > nav.clientWidth) {
        nav.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    };
    keepActiveVisible();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(keepActiveVisible);
    observer?.observe(nav);
    return () => observer?.disconnect();
  }, [tab, status]);
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
              <nav ref={tabNavigation} className="flex flex-1 gap-1 overflow-x-auto rounded-xl bg-muted/50 p-1">
                {TABS.map((tb) => {
                  const Icon = tb.icon;
                  const on = tab === tb.id;
                  return (
                    <button
                      key={tb.id}
                      onClick={() => setTab(tb.id)}
                      aria-label={tb.label}
                      aria-current={on ? "page" : undefined}
                      title={`${tb.label} · ${tb.hint}`}
                      className={cn(
                        // 窄屏保留图标，文字进入可访问名称和 title。
                        "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors md:px-3",
                        on ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4" />
                      <span className="hidden md:inline">{tb.label}</span>
                    </button>
                  );
                })}
              </nav>
            )}

            <div className="ml-auto flex items-center gap-1.5 md:gap-2">
              <span
                title={
                  status === "online" && stale ? t.studio.shell.engineStaleTitle
                  : status === "online" ? `${t.studio.shell.engineOnline} v${version ?? ""}`
                  : status === "offline" ? t.studio.shell.engineOffline
                  : t.studio.shell.engineChecking
                }
                className={cn(
                  // 窄屏只留状态点（文字进 title）
                  "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium lg:px-2.5",
                  status === "online" && !stale && "bg-emerald-500/15 text-emerald-500",
                  ((status === "online" && stale) || status === "offline") && "bg-amber-500/15 text-amber-600 dark:text-amber-400",
                  status === "checking" && "bg-muted text-muted-foreground",
                )}
              >
                <span className={cn("size-1.5 rounded-full", status === "online" && !stale ? "bg-emerald-500" : status === "checking" ? "bg-muted-foreground" : "bg-amber-500")} />
                <span className="hidden lg:inline">{status === "online" ? (stale ? t.studio.shell.statusStale : t.studio.shell.statusOnline) : status === "offline" ? t.studio.shell.statusOffline : t.studio.shell.statusChecking}</span>
              </span>
              {updateAvailable && (
                <button
                  title={t.studio.shell.updateAvailableTitle}
                  onClick={() => window.open("https://github.com/jnMetaCode/agency-orchestrator/releases/latest", "_blank")}
                  className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/25"
                >
                  ↑ <span className="hidden lg:inline">{t.studio.shell.updateAvailable} </span>v{latest}
                </button>
              )}
              {tab !== "tools" && tab !== "resources" && <>
                <ProviderSelect value={provider} onChange={setProvider} onOpenProviders={() => setTab("providers")} />
                <ModelSelect provider={provider} />
              </>}
              {tab === "create" && <MediaSelect />}
              <Button size="sm" variant="outline" onClick={() => setTab("providers")}>
                <KeyRound className="size-4" />
                <span className="hidden sm:inline">{t.studio.shell.keys}</span>
              </Button>
            </div>
          </div>
        </div>

        <div className="container-page py-8">
          {needKeyWarning && tab !== "tools" && tab !== "resources" && (
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
          {tab === "resources" ? (
            <ResourcesPanel offline={offline} />
          ) : tab === "tools" ? (
            <ToolsPanel offline={offline} onSettings={() => setTab("providers")} />
          ) : tab === "settings" && settingsView === "providers" ? (
            // 供应商/API 面板在线、离线都能进、能填（演示站没有引擎也照样展示卡片，只是无法实际运行）
            <>
              {settingsSubNav}
              <ProvidersPanel active={provider} onSetActive={(p) => setProvider(p)} offline={offline} />
            </>
          ) : offline ? (
            <>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/[0.07] px-4 py-3">
                <div className="min-w-0">
                  {/* 403 = 引擎在、来源守卫拦了（用域名访问没设 AO_ALLOWED_HOSTS）。这时喊「去装引擎」是误导，原样给服务端的指引 */}
                  <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">{blocked ? t.studio.demo.blockedTitle : t.studio.demo.bannerTitle}</span>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{blocked ?? t.studio.demo.bannerDesc}</p>
                </div>
                {!blocked && <Button size="sm" onClick={() => setInstallOpen(true)}>
                  <Download className="size-4" />
                  {t.studio.demo.bannerInstall}
                </Button>}
              </div>
              {/* 演示模式也按 tab 显示真实内容（可浏览，只是不能真跑）；运行类操作引导安装 */}
              {tab === "start" && startView === "workflows" ? (
                <>
                  {startSubNav}
                  <WorkflowsPanel provider={provider} onRun={start} demo onInstallPrompt={() => setInstallOpen(true)} />
                </>
              ) : tab === "create" ? (
                <CreativePanel provider={provider} onRun={start} demo onInstallPrompt={() => setInstallOpen(true)} />
              ) : tab === "runs" ? (
                <p className="mx-auto max-w-md py-16 text-center text-sm text-muted-foreground">
                  {lang === "en"
                    ? "Run History — demo mode has no records yet. Once you run workflows locally, each run's outputs, duration and tokens show here, and you can re-run from any step."
                    : "运行历史 —— 演示模式还没有记录。本地实际跑过工作流后，这里会列出每次运行的产物、耗时与 token，并支持从任意步骤重跑。"}
                </p>
              ) : tab === "settings" ? (
                <p className="mx-auto max-w-md py-16 text-center text-sm text-muted-foreground">
                  {lang === "en"
                    ? "Usage — demo mode has no data yet. After real local runs, this tab charts token usage and estimated cost by day and by role."
                    : "用量统计 —— 演示模式还没有数据。本地实际调用后，这里按天 / 按角色统计 token 用量与估算成本。"}
                </p>
              ) : (
                <>
                  {startSubNav}
                  <RolesPicker provider={provider} onRun={() => setInstallOpen(true)} demo onInstallPrompt={() => setInstallOpen(true)} />
                  <StudioDemo />
                </>
              )}
            </>
          ) : tab === "start" ? (
            <>
              {startSubNav}
              {startView === "roles" ? (
                <RolesPicker provider={provider} onRun={start} onGoToWorkflows={() => setTab("workflows")} onPlainChat={openPlainChat} taskSeed={taskSeed} />
              ) : (
                <WorkflowsPanel provider={provider} onRun={start} />
              )}
            </>
          ) : tab === "create" ? (
            <CreativePanel provider={provider} onRun={start} />
          ) : tab === "runs" ? (
            <RunsPanel provider={provider} onRun={start} />
          ) : (
            <>
              {settingsSubNav}
              <Suspense fallback={<div className="py-20 text-center text-sm text-muted-foreground">…</div>}>
                <UsagePanel />
              </Suspense>
            </>
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
