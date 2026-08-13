import { Check, ChevronDown, Cloud, Copy, Loader2, MonitorCog, Plus, Settings2, Sparkles, Terminal, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/i18n/LanguageProvider";
import { api, API_PROVIDERS, CLI_RELAY_GLOBAL_WRITE, CLI_RELAY_PRESETS, CLI_RELAY_SUPPORT, DEFAULT_PROVIDER, PROVIDER_LABELS, providerLogo, type CliRelayPreset, type ConfigResponse } from "@/lib/studio";
import { cn } from "@/lib/utils";
import { ClaudeHealthCard } from "./ClaudeHealthCard";
import { ProviderConfigView, type ConfigTarget } from "./ProviderConfigView";

// provider 列表/模型建议的唯一来源是 lib/studio.ts 的 API_PROVIDERS —— 新增一家 provider 只用改那一处。
const API_META = API_PROVIDERS;

function ActiveButton({ on, onClick }: { on: boolean; onClick: () => void }) {
  const { t } = useLanguage();
  return on ? (
    <span className="inline-flex items-center gap-1 rounded-lg bg-primary/15 px-2.5 py-1.5 text-xs font-semibold text-primary">
      <Check className="size-3.5" /> {t.studio.providers.inUse}
    </span>
  ) : (
    <Button size="sm" variant="outline" onClick={onClick}>
      {t.studio.providers.setActive}
    </Button>
  );
}

/**
 * 紧凑供应商行（CC Switch 风格）：名称+徽章+状态一行看完,所有配置输入都收进
 * 全屏 ProviderConfigView。主列表两列排布,一屏能看完全部供应商。
 */
function ProviderRow({
  name,
  logo,
  statusLine,
  statusTone = "muted",
  flagship,
  advanced,
  sponsor,
  active,
  onSetActive,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  name: string;
  logo?: string;
  statusLine: string;
  statusTone?: "muted" | "ok";
  flagship?: boolean;
  advanced?: boolean;
  sponsor?: boolean;
  active: boolean;
  onSetActive: () => void;
  onEdit: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
}) {
  const { t } = useLanguage();
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 rounded-xl border bg-card/60 px-4 py-3",
        flagship ? "border-gold/60 bg-gold/[0.04]" : advanced ? "border-gold/60 bg-gold/[0.04]" : active ? "border-primary/60" : "border-border/70",
      )}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        {logo && (
          <img src={logo} alt="" className="size-7 shrink-0 rounded-lg object-contain" onError={(e) => (e.currentTarget.style.display = "none")} />
        )}
        <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold">{name}</span>
          {flagship && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-gold/15 px-1.5 py-0.5 text-[10px] font-semibold text-gold">
              <Sparkles className="size-2.5" /> {t.studio.providers.flagshipTag}
            </span>
          )}
          {advanced && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-gold/15 px-1.5 py-0.5 text-[10px] font-semibold text-gold">
              <Sparkles className="size-2.5" /> {t.studio.providers.advancedTag}
            </span>
          )}
          {sponsor && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-gold/15 px-1.5 py-0.5 text-[10px] font-semibold text-gold">
              <Sparkles className="size-2.5" /> {t.studio.providers.sponsorTag}
            </span>
          )}
        </span>
        <span className={cn("block truncate text-[11px]", statusTone === "ok" ? "font-medium text-emerald-500" : "text-muted-foreground")}>
          {statusLine}
        </span>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <ActiveButton on={active} onClick={onSetActive} />
        <button
          onClick={onEdit}
          className="grid size-8 place-items-center rounded-lg border border-border/70 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          title={t.studio.providers.configure}
        >
          <Settings2 className="size-3.5" />
        </button>
        {onDuplicate && (
          <button
            onClick={onDuplicate}
            className="grid size-8 place-items-center rounded-lg border border-border/70 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            title={t.studio.providers.duplicateCta}
          >
            <Copy className="size-3.5" />
          </button>
        )}
        {onDelete && (
          <button
            onClick={() => { if (window.confirm(t.studio.providers.customProviderDeleteConfirm)) onDelete(); }}
            className="grid size-8 place-items-center rounded-lg border border-border/70 text-muted-foreground transition-colors hover:border-red-500/40 hover:text-red-500"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </span>
    </div>
  );
}

/**
 * CLI 中转商行（如赞助商 Cubence）：一个中转商同时支持多个 CLI,每个 CLI 的中转配置
 * 是独立的 —— 用一个「配置中转 ▾」下拉让用户选给哪个 CLI 配,而不是并排一堆裸按钮。
 */
function RelayVendorRow({ preset, onConfigure }: { preset: CliRelayPreset; onConfigure: (cliId: string) => void }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    // 普通卡片宽度（不再 sm:col-span-2 通栏——中转商和 CLI 卡片同规格，别喧宾夺主）；内容窄屏自动换行
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-card/60 px-4 py-3">
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold">{preset.name}</span>
          {preset.sponsor && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-gold/15 px-1.5 py-0.5 text-[10px] font-semibold text-gold">
              <Sparkles className="size-2.5" /> {t.studio.providers.sponsorTag}
            </span>
          )}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">{t.studio.providers.cliRelayVendorLine}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {/* 注册领取 Key 的入口不放这里（冗余 + 撑大行高）——点「配置中转」进去的配置页右上角已有同一个链接 */}
        <div className="relative" ref={ref}>
          <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
            <Settings2 className="size-3.5" /> {t.studio.providers.cliRelayConfigureCta} <ChevronDown className="size-3 opacity-60" />
          </Button>
          {open && (
            <div className="absolute right-0 top-full z-20 mt-1 min-w-44 rounded-xl border border-border/60 bg-background/95 p-1.5 shadow-lg backdrop-blur-xl">
              {Object.keys(preset.baseUrls).map((cliId) => (
                <button
                  key={cliId}
                  type="button"
                  onClick={() => { setOpen(false); onConfigure(cliId); }}
                  className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted"
                >
                  {PROVIDER_LABELS[cliId] ?? cliId}
                </button>
              ))}
            </div>
          )}
        </div>
      </span>
    </div>
  );
}

export function ProvidersPanel({ active, onSetActive }: { active: string; onSetActive: (p: string) => void }) {
  const { t } = useLanguage();
  const [cfg, setCfg] = useState<ConfigResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<ConfigTarget | null>(null);
  const load = () => {
    setFailed(false);
    // 演示站没有引擎后端：config 拉不到时退回空配置，照样展示供应商卡片（可看、可填，只是无法实际运行 / 测试），不再弹「加载失败」
    api.config().then(setCfg).catch(() => setCfg({ providers: {}, cli: [], defaultProvider: "" }));
  };
  useEffect(load, []);

  const eff = active || DEFAULT_PROVIDER;
  // cli 项兼容新旧两种形态：{name,installed} 或裸字符串
  const cliItems = (cfg?.cli ?? []).map((c) => (typeof c === "string" ? { name: c, installed: false } : c));
  const installedCli = cfg?.installedCli ?? cliItems.filter((c) => c.installed).map((c) => c.name);
  // 推荐零配置路径：本机已装 CLI、且当前选中的 provider 既不是它、又没配 key 时，给一条横幅引导一键切换。
  const activeHasKey = !!cfg?.providers?.[eff]?.hasKey;
  const showRecommend = installedCli.length > 0 && !installedCli.includes(eff) && !activeHasKey;

  // CompShare / APINEBULA / RootFlowAI 的名称/说明走 i18n（英文站不露中文）；其余 provider 是品牌名+URL，语言无关
  // （RootFlowAI 赞助已下架，但仍是可用供应商，文案继续走 i18n）
  const displayName = (id: string, fallback: string) =>
    id === "compshare" ? t.studio.providers.compshareName
    : id === "apinebula" ? t.studio.providers.apinebulaName
    : id === "rootflowai" ? t.studio.providers.rootflowaiName
    : id === "cubence" ? t.studio.providers.cubenceName
    : id === "volcengine" ? t.studio.providers.volcengineName
    : id === "duoyuanx" ? t.studio.providers.duoyuanxName
    : fallback;
  const displayHint = (id: string, fallback: string) =>
    id === "compshare" ? t.studio.providers.compshareHint
    : id === "apinebula" ? t.studio.providers.apinebulaHint
    : id === "rootflowai" ? t.studio.providers.rootflowaiHint
    : id === "cubence" ? t.studio.providers.cubenceHint
    : id === "volcengine" ? t.studio.providers.volcengineHint
    : id === "duoyuanx" ? t.studio.providers.duoyuanxHint
    : fallback.replace("{etc}", t.studio.providers.etc);

  const keyStatus = (id: string): { line: string; tone: "muted" | "ok" } => {
    const s = cfg?.providers?.[id];
    return s?.hasKey
      ? { line: `${t.studio.providers.keySet}${s.fromEnv ? t.studio.providers.fromEnv : ""}`, tone: "ok" }
      : { line: t.studio.providers.keyNotSet, tone: "muted" };
  };

  // 「复制为供应商」：把某个品牌供应商复制成一个自定义供应商——预填品牌端点 + 当前(或默认)
  // 模型,用户改成同品牌另一个模型、起名、填 key 后保存,再「设为当前」启用。复用现成的
  // 自定义供应商机制,不引入平行档案系统(见与用户确认的轻量方案)。
  const duplicateProvider = (id: string, name: string, baseUrl?: string, defaultModel?: string) => {
    const model = cfg?.providers?.[id]?.model || defaultModel || "";
    setEditing({
      kind: "add-custom",
      prefill: {
        id: `${id}-copy`,
        name: `${name}${t.studio.providers.duplicateSuffix}`,
        baseUrl,
        model,
        note: `${t.studio.providers.duplicateNote}${name}`,
      },
    });
  };

  // CLI 中转商 = 内置预设 + 远程清单增量（同名以内置为准）
  const relayPresets = [
    ...CLI_RELAY_PRESETS,
    ...(cfg?.relayPresets ?? []).filter((r) => !CLI_RELAY_PRESETS.some((b) => b.name === r.name)),
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border/60 bg-muted/30 px-4 py-2.5 text-xs leading-relaxed text-muted-foreground">
        {t.studio.providers.privacyBeforeLocal}<strong>{t.studio.providers.privacyLocal}</strong>{t.studio.providers.privacyBeforeCode}<code className="rounded bg-muted px-1 py-0.5">.local/web-keys.json</code>{t.studio.providers.privacyAfter}
      </div>

      {/* 系统 Claude Code 体检/急救：被别的软件或手动写坏时一键恢复官方登录 */}
      <ClaudeHealthCard />

      {/* 零配置推荐：探测到本机已装订阅制 CLI 时，引导一键切换，绕开 key 墙 */}
      {showRecommend && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/[0.07] px-4 py-3 text-sm">
          <span className="text-foreground">
            {t.studio.providers.recommendPre}
            <strong>{PROVIDER_LABELS[installedCli[0]] ?? installedCli[0]}</strong>
            {t.studio.providers.recommendPost}
          </span>
          <Button size="sm" className="ml-auto" onClick={() => onSetActive(installedCli[0])}>
            {t.studio.providers.recommendUse}
          </Button>
        </div>
      )}

      {failed ? (
        <p className="py-10 text-center text-sm text-red-500">{t.studio.providers.loadFailed}</p>
      ) : !cfg ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> {t.studio.providers.loading}
        </div>
      ) : (
        <>
          <section>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold">
              <Cloud className="size-4 text-primary" /> {t.studio.providers.cloudApiTitle} <span className="font-normal text-muted-foreground">· {t.studio.providers.cloudApiHint}</span>
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {API_META
                .filter((m) => !(cfg.removedProviders ?? []).includes(m.id))
                // 已下架的赞助商不再向新用户露出；但自己配过 key 的照常显示 ——
                // 配置还在、还能跑，却把入口抽走的话，用户只会以为"我的 key 丢了"
                .filter((m) => !m.delisted || cfg?.providers?.[m.id]?.hasKey)
                .map((m) => {
                const st = keyStatus(m.id);
                return (
                  <ProviderRow
                    key={m.id}
                    name={displayName(m.id, m.name)}
                    logo={providerLogo(m.id)}
                    statusLine={st.line}
                    statusTone={st.tone}
                    flagship={m.flagship}
                    advanced={m.advanced}
                    sponsor={m.sponsor}
                    active={eff === m.id}
                    onSetActive={() => onSetActive(m.id)}
                    onEdit={() => setEditing({ kind: "api", id: m.id, name: displayName(m.id, m.name), hint: displayHint(m.id, m.hint), defaultBaseUrl: m.defaultBaseUrl, suggestions: m.modelSuggestions, signupUrl: m.signupUrl })}
                    onDuplicate={() => duplicateProvider(m.id, displayName(m.id, m.name), m.defaultBaseUrl, m.modelSuggestions?.[0])}
                  />
                );
              })}
              {/* 远程清单上架的赞助商:官网 push 即上/下架,不用发版。运行链路同自定义供应商 */}
              {(cfg.remoteProviders ?? []).map((m) => {
                const st = keyStatus(m.id);
                return (
                  <ProviderRow
                    key={m.id}
                    name={m.name}
                    logo={providerLogo(m.id)}
                    statusLine={st.line}
                    statusTone={st.tone}
                    sponsor={m.sponsor}
                    active={eff === m.id}
                    onSetActive={() => onSetActive(m.id)}
                    onEdit={() => setEditing({ kind: "api", id: m.id, name: m.name, hint: m.note || m.homepageUrl, defaultBaseUrl: m.baseUrl, suggestions: m.modelSuggestions, signupUrl: m.signupUrl })}
                    onDuplicate={() => duplicateProvider(m.id, m.name, m.baseUrl, m.defaultModel || m.modelSuggestions?.[0])}
                  />
                );
              })}
            </div>
          </section>

          <section>
            <h3 className="mb-3 flex items-center justify-between gap-2 text-sm font-bold">
              <span className="flex items-center gap-2">
                <Plus className="size-4 text-primary" /> {t.studio.providers.customProvidersTitle}{" "}
                <span className="font-normal text-muted-foreground">· {t.studio.providers.customProvidersHint}</span>
              </span>
              <Button size="sm" variant="outline" onClick={() => setEditing({ kind: "add-custom" })}>
                <Plus className="size-3.5" /> {t.studio.providers.addCustomProvider}
              </Button>
            </h3>
            {(cfg.customProviders ?? []).length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {(cfg.customProviders ?? []).map((cp) => {
                  const st = keyStatus(cp.id);
                  return (
                    <ProviderRow
                      key={cp.id}
                      name={cp.name}
                      statusLine={st.line}
                      statusTone={st.tone}
                      active={eff === cp.id}
                      onSetActive={() => onSetActive(cp.id)}
                      onEdit={() => setEditing({ kind: "api", id: cp.id, name: cp.name, hint: cp.homepageUrl || cp.note, isCustom: true, customMeta: { note: cp.note, homepageUrl: cp.homepageUrl } })}
                      onDelete={async () => {
                        await api.deleteCustomProvider(cp.id);
                        load();
                      }}
                    />
                  );
                })}
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold">
              <MonitorCog className="size-4 text-emerald-500" /> {t.studio.providers.localModelTitle} <span className="font-normal text-muted-foreground">· {t.studio.providers.localModelHint}</span>
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <ProviderRow
                name="Ollama"
                statusLine={cfg.providers.ollama?.model || cfg.providers.ollama?.baseUrl || "http://localhost:11434"}
                active={eff === "ollama"}
                onSetActive={() => onSetActive("ollama")}
                onEdit={() => setEditing({ kind: "ollama" })}
              />
            </div>
          </section>

          <section>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold">
              <Terminal className="size-4 text-muted-foreground" /> {t.studio.providers.localCliTitle} <span className="font-normal text-muted-foreground">· {t.studio.providers.localCliHint}</span>
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {/* CLI 中转商（如赞助商 Cubence）排区块首行：「配置中转 ▾」下拉选给哪个 CLI 配(端点预填) */}
              {relayPresets.map((r) => (
                <RelayVendorRow
                  key={r.name}
                  preset={r}
                  onConfigure={(cliId) => setEditing({ kind: "cli-relay", id: cliId, name: PROVIDER_LABELS[cliId] ?? cliId, globalWrite: CLI_RELAY_GLOBAL_WRITE.has(cliId), initialBaseUrl: r.baseUrls[cliId], initialSonnetModel: r.sonnetModel, initialOpusModel: r.opusModel, initialHaikuModel: r.haikuModel })}
                />
              ))}
              {cliItems.map(({ name: id, installed }) => {
                const relayConfigured = !!cfg.providers[id]?.hasKey;
                const statusLine = installed
                  ? t.studio.providers.cliInstalledBadge
                  : relayConfigured
                    ? t.studio.providers.cliRelaySet
                    : t.studio.providers.cliRequirement;
                return (
                  <div key={id} className={cn("flex items-center justify-between gap-2 rounded-xl border bg-card/60 px-4 py-3", installed ? "border-emerald-500/50" : eff === id ? "border-primary/60" : "border-border/70")}>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{PROVIDER_LABELS[id] ?? id}</span>
                      <span className={cn("block truncate text-[11px]", installed || relayConfigured ? "font-medium text-emerald-500" : "text-muted-foreground")}>
                        {statusLine}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <ActiveButton on={eff === id} onClick={() => onSetActive(id)} />
                      {CLI_RELAY_SUPPORT.has(id) && (
                        <button
                          onClick={() => setEditing({ kind: "cli-relay", id, name: PROVIDER_LABELS[id] ?? id, globalWrite: CLI_RELAY_GLOBAL_WRITE.has(id) })}
                          className="grid size-8 place-items-center rounded-lg border border-border/70 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                          title={t.studio.providers.cliRelayToggle}
                        >
                          <Settings2 className="size-3.5" />
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}

            </div>
          </section>
        </>
      )}

      {editing && (
        <ProviderConfigView
          target={editing}
          relayPresets={relayPresets}
          status={
            editing.kind === "api" || editing.kind === "cli-relay"
              ? cfg?.providers[editing.id]
              : editing.kind === "ollama"
                ? cfg?.providers.ollama
                : undefined
          }
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
