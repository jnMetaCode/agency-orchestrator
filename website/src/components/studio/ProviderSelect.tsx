import { Check, ChevronDown, Settings2, Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/i18n/LanguageProvider";
import { api, API_PROVIDERS, CLI_PROVIDER_IDS, CLI_RELAY_PRESETS, PROVIDER_LABELS, relayPresetClis, type CliRelayPreset, type CustomProviderMeta, type RemoteProviderMeta } from "@/lib/studio";
import { sponsorsByTier } from "@/content/sponsors";
import { cn } from "@/lib/utils";

// 旗舰赞助商对应的 provider id（金色高亮 + 星标 + 徽章）
const FLAGSHIP_ID = sponsorsByTier("flagship")[0]?.id;
// 普通赞助商对应的 provider id（中性「赞助商」标记，不抢旗舰风头），来自统一注册表。
const SPONSOR_IDS = API_PROVIDERS.filter((p) => p.sponsor).map((p) => p.id);
// 进阶赞助商 id（主色/紫色高亮 + 星标，介于旗舰金与普通赞助商之间），来自统一注册表。
const ADVANCED_IDS = API_PROVIDERS.filter((p) => p.advanced).map((p) => p.id);

/**
 * Studio 顶部 provider 选择器。原生 <select> 无法给单个选项上色/加徽章，
 * 这里用一个轻量自定义下拉，把旗舰赞助商（APINEBULA）金色高亮 + 星标 + 旗舰徽章并置顶。
 * 选项按「聚合平台 / 模型公司 / 本地 CLI / 本地模型 / 自定义」分组——14+ 项平铺看不懂,
 * 分组后"想配某家模型公司的 API"一眼能找到。
 */
export function ProviderSelect({ value, onChange, onOpenProviders }: { value: string; onChange: (p: string) => void; onOpenProviders?: () => void }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  // 自定义/远程清单上架的供应商也要能在这里切换/显示名称，不能只认静态 PROVIDERS 列表。
  // 演示站没有引擎后端时拉不到 config —— 静默回退为空列表，下拉里只有内置 provider。
  const [customProviders, setCustomProviders] = useState<CustomProviderMeta[]>([]);
  const [remoteProviders, setRemoteProviders] = useState<RemoteProviderMeta[]>([]);
  const [relayPresets, setRelayPresets] = useState<CliRelayPreset[]>(CLI_RELAY_PRESETS);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.config().then((c) => {
      setCustomProviders(c.customProviders ?? []);
      setRemoteProviders(c.remoteProviders ?? []);
      // 远程清单可能补充新中转商；内置的（Cubence）优先，同名去重
      setRelayPresets([...CLI_RELAY_PRESETS, ...(c.relayPresets ?? []).filter((r) => !CLI_RELAY_PRESETS.some((b) => b.name === r.name))]);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const labelFor = (p: string) =>
    p === "" ? t.studio.shell.providerDefault
    : PROVIDER_LABELS[p]
      ?? customProviders.find((c) => c.id === p)?.name
      ?? remoteProviders.find((r) => r.id === p)?.name
      ?? p;
  const isFlagship = (p: string) => !!FLAGSHIP_ID && p === FLAGSHIP_ID;
  const isAdvanced = (p: string) => ADVANCED_IDS.includes(p);
  const isSponsor = (p: string) => SPONSOR_IDS.includes(p) || !!remoteProviders.find((r) => r.id === p)?.sponsor;
  const selectedFlagship = isFlagship(value);
  const selectedAdvanced = isAdvanced(value);

  const g = t.studio.providers;
  // CLI 中转商（如赞助商 Cubence）：不是可选的运行方式（它服务于本地 CLI），但要在
  // 这里露出——紧跟「本地 CLI」组渲染（语义相邻），点击跳到供应商页完成中转配置。
  // 之前排在整个下拉末尾，会被 max-h 截到可视区外（macOS 悬浮滚动条不显示，像"消失"了）。
  const relayBlock =
    relayPresets.length > 0 && onOpenProviders ? (
      <>
        <div className="px-2.5 pb-0.5 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
          {g.groupCliRelay}
        </div>
        {relayPresets.map((r) => (
          <button
            key={r.name}
            type="button"
            title={`${g.cliRelayVendorPrefix}${relayPresetClis(r).join(" / ")}`}
            onClick={() => {
              onOpenProviders();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted"
          >
            <span className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{r.name}</span>
            {r.sponsor && (
              <span className="shrink-0 rounded-full bg-gold/15 px-1.5 py-0.5 text-[10px] font-semibold text-gold">
                {g.sponsorTag}
              </span>
            )}
            <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground">
              <Settings2 className="size-3" />
              {g.relayGoConfigure}
            </span>
          </button>
        ))}
      </>
    ) : null;
  const groups: { label: string; ids: string[] }[] = [
    // 聚合平台：内置聚合商(旗舰/赞助商在前) + 远程清单上架的赞助商
    // videoOnly 的供应商（秘塔等）只跑 type: video 步骤，没有 chat 端点——不进这个下拉
    { label: g.groupAggregators, ids: [...API_PROVIDERS.filter((p) => !p.vendor && !p.videoOnly).map((p) => p.id), ...remoteProviders.map((r) => r.id)] },
    // 模型公司官方 API
    { label: g.groupVendors, ids: API_PROVIDERS.filter((p) => p.vendor && !p.videoOnly).map((p) => p.id) },
    { label: g.groupCli, ids: [...CLI_PROVIDER_IDS] },
    { label: g.groupLocal, ids: ["ollama"] },
    ...(customProviders.length > 0 ? [{ label: g.groupCustom, ids: customProviders.map((c) => c.id) }] : []),
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t.studio.shell.providerSelectTitle}
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm outline-none transition-colors",
          selectedFlagship || selectedAdvanced
            ? "border-gold/60 bg-gold/10 font-semibold text-gold"
            : "border-border/70 bg-card/60 text-foreground hover:border-border",
        )}
      >
        {(selectedFlagship || selectedAdvanced) && <Star className="size-3.5 shrink-0 fill-gold text-gold" />}
        <span className="max-w-[160px] truncate">{labelFor(value)}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-60" />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1.5 max-h-[min(80vh,calc(100vh-11rem))] w-64 overflow-auto rounded-xl border border-border/70 bg-card p-1 shadow-xl">
          {groups.map((group) =>
            group.ids.length === 0 ? null : (
              <div key={group.label}>
                <div className="px-2.5 pb-0.5 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                  {group.label}
                </div>
                {group.ids.map((p) => {
                  const flag = isFlagship(p);
                  const adv = isAdvanced(p);
                  const sponsor = isSponsor(p);
                  const on = p === value;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        onChange(p);
                        setOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors",
                        flag || adv ? "font-semibold text-gold hover:bg-gold/10"
                        : "text-foreground hover:bg-muted",
                        on && !flag && !adv && "bg-muted",
                        on && (flag || adv) && "bg-gold/10",
                      )}
                    >
                      {flag || adv ? (
                        <Star className="size-4 shrink-0 fill-gold text-gold" />
                      ) : (
                        <span className="size-4 shrink-0" />
                      )}
                      <span className="min-w-0 flex-1 truncate">{labelFor(p)}</span>
                      {flag && (
                        <span className="shrink-0 rounded-full bg-gold/15 px-1.5 py-0.5 text-[10px] font-semibold text-gold">
                          {t.studio.providers.flagshipTag}
                        </span>
                      )}
                      {adv && (
                        <span className="shrink-0 rounded-full bg-gold/15 px-1.5 py-0.5 text-[10px] font-semibold text-gold">
                          {t.studio.providers.advancedTag}
                        </span>
                      )}
                      {sponsor && (
                        <span className="shrink-0 rounded-full bg-gold/15 px-1.5 py-0.5 text-[10px] font-semibold text-gold">
                          {t.studio.providers.sponsorTag}
                        </span>
                      )}
                      {on && <Check className="size-4 shrink-0 text-gold" />}
                    </button>
                  );
                })}
                {group.label === g.groupCli && relayBlock}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
