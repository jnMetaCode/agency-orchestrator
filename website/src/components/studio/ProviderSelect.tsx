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
  // 已配 key 的供应商——组内排前（用户真能用的先看见；旗舰/赞助商标记不受影响，只是次序）
  const [keyed, setKeyed] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.config().then((c) => {
      setCustomProviders(c.customProviders ?? []);
      setRemoteProviders(c.remoteProviders ?? []);
      setKeyed(new Set(Object.entries(c.providers).filter(([, v]) => !!v.hasKey).map(([k]) => k)));
      setRemoved(c.removedProviders ?? []);
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
  // 组内排序按**层级**：旗舰 → 进阶 → 赞助商 → 普通 → 已下架；每层内已配 key 的在前。
  // 上一版只按"有 key 在前"，把配过 key 的已下架多元探索和非赞助的 Agnes 顶到了赞助商前面。
  // 已下架的（内置 delisted / 远程清单 removedProviders）只对配过 key 或当前正选中的用户露出，排最后。
  const [removed, setRemoved] = useState<string[]>([]);
  const isDelisted = (p: string) => !!API_PROVIDERS.find((x) => x.id === p)?.delisted || removed.includes(p);
  const tier = (p: string) => (isDelisted(p) ? 4 : isFlagship(p) ? 0 : isAdvanced(p) ? 1 : isSponsor(p) ? 2 : 3);
  const keyedFirst = (ids: string[]) =>
    ids
      .filter((p) => !isDelisted(p) || keyed.has(p) || p === value)
      .map((p, i) => ({ p, i }))
      .sort((a, b) => tier(a.p) - tier(b.p) || Number(keyed.has(b.p)) - Number(keyed.has(a.p)) || a.i - b.i)
      .map((x) => x.p);
  // 只做图/视频的供应商（秘塔等）没有对话端点，不能当文本供应商选——但它们是赞助商，必须在这里看得见：
  // 单独一组，带标，点了去它的配置页；真正选用是在「出图 / 出片」胶囊里。
  const mediaOnly = API_PROVIDERS.filter((p) => p.videoOnly && (!isDelisted(p.id) || keyed.has(p.id)));
  const mediaBlock = mediaOnly.length > 0 && onOpenProviders ? (
    <>
      <div className="px-2.5 pb-0.5 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">{g.groupMedia}</div>
      {mediaOnly.map((p) => (
        <button
          key={p.id}
          type="button"
          title={g.mediaOnlyHint}
          onClick={() => { onOpenProviders(); setOpen(false); }}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted"
        >
          <span className="size-4 shrink-0 text-center text-xs">🎬</span>
          <span className="min-w-0 flex-1 truncate">{labelFor(p.id)}</span>
          {p.sponsor && <span className="shrink-0 rounded-full bg-gold/15 px-1.5 py-0.5 text-[10px] font-semibold text-gold">{g.sponsorTag}</span>}
          {keyed.has(p.id) && <Check className="size-4 shrink-0 text-gold" />}
          <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground"><Settings2 className="size-3" />{g.mediaGoConfigure}</span>
        </button>
      ))}
    </>
  ) : null;
  const groups: { label: string; ids: string[] }[] = [
    // 聚合平台：内置聚合商(旗舰/赞助商在前) + 远程清单上架的赞助商
    // videoOnly 的供应商（秘塔等）只跑 type: video 步骤，没有 chat 端点——不进这个下拉
    // 组内先按赞助层级排（旗舰 → 赞助商 → 其余），再按"配过 key 的靠前"。
    // 不排的话顺序就是 API_PROVIDERS 的声明位置，像「火山引擎 · Agent Plan 套餐」这种
    // 紧挨赞助商声明、自己却不标赞助商的条目，会白占一个赞助位（同 ProvidersPanel）。
    { label: g.groupAggregators, ids: keyedFirst([...API_PROVIDERS.filter((p) => !p.vendor && !p.videoOnly).slice().sort((a, b) => (a.flagship ? 0 : a.sponsor ? 1 : 2) - (b.flagship ? 0 : b.sponsor ? 1 : 2)).map((p) => p.id), ...remoteProviders.map((r) => r.id)]) },
    // 模型公司官方 API
    { label: g.groupVendors, ids: keyedFirst(API_PROVIDERS.filter((p) => p.vendor && !p.videoOnly).map((p) => p.id)) },
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
        <span className="max-w-[96px] truncate md:max-w-[160px]">{labelFor(value)}</span>
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
                      {sponsor && !isDelisted(p) && (
                        <span className="shrink-0 rounded-full bg-gold/15 px-1.5 py-0.5 text-[10px] font-semibold text-gold">
                          {t.studio.providers.sponsorTag}
                        </span>
                      )}
                      {isDelisted(p) && (
                        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {t.studio.providers.delistedTag}
                        </span>
                      )}
                      {on && <Check className="size-4 shrink-0 text-gold" />}
                    </button>
                  );
                })}
                {group.label === g.groupAggregators && mediaBlock}
                {group.label === g.groupCli && relayBlock}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
