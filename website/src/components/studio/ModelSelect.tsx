import { Check, ChevronDown, Cpu, ListPlus, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/i18n/LanguageProvider";
import { api, API_PROVIDER_MAP, CLI_PROVIDER_IDS, DEFAULT_PROVIDER, groupModelsByVendor } from "@/lib/studio";
import { cn } from "@/lib/utils";

/**
 * 顶栏模型快切:显示当前供应商正在用的模型,点选即保存为该供应商的默认模型 ——
 * 解决"同一家聚合商下换模型(如胜算云的 DeepSeek ↔ Claude)要钻进配置页"的问题。
 *
 * 列表来源分两层:
 *  1. 精简推荐集(远程清单 providerOverrides > 前端内置 modelSuggestions)+ 当前模型。
 *  2. 推荐集为空(自定义供应商 / 远程清单上架的 / 前端 dist 尚不认识的 id)→ **自动实拉**
 *     该供应商的 GET /models;有推荐集时底部也留「拉取全部模型」按钮手动拉全量。
 *     之前只有第 1 层:自定义供应商永远只显示「当前这一个」,赞助商反馈"下拉框只有一个
 *     模型、换不了别家模型"就是这条兜底造成的。
 * 全量目录按厂商分组(聚合商 /models 常上百个、混各家),否则没法扫。
 * CLI provider(claude-code 等)用各自工具的登录态选模型,这里不显示。
 */
export function ModelSelect({ provider }: { provider: string }) {
  const { t } = useLanguage();
  const p = t.studio.providers;
  const eff = provider || DEFAULT_PROVIDER;
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [models, setModels] = useState<string[] | null>(null);
  // 实拉 /models 的结果(分组展示);null = 还没拉
  const [fetched, setFetched] = useState<{ models: string[]; vendors?: Record<string, string> } | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // 远程清单下发的换代模型建议（providerOverrides）——比打包进前端的静态建议新
  const [remoteSuggestions, setRemoteSuggestions] = useState<string[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // 当前供应商已保存的模型（切换供应商时刷新）
  useEffect(() => {
    setModels(null);
    setFetched(null);
    setFetchError(null);
    setRemoteSuggestions(null);
    // model 为空 = 用引擎默认(按钮显示"默认模型"),不在前端猜具体默认值
    api
      .config()
      .then((c) => {
        setCurrent(c.providers[eff]?.model || "");
        setRemoteSuggestions(c.providers[eff]?.modelSuggestions ?? null);
      })
      .catch(() => setCurrent(""));
  }, [eff]);

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

  if (CLI_PROVIDER_IDS.has(eff)) return null;

  const fetchAll = async () => {
    if (fetching) return;
    setFetching(true);
    setFetchError(null);
    try {
      const r = await api.providerModels({ provider: eff });
      if (r.ok && r.models && r.models.length > 0) setFetched({ models: r.models, vendors: r.vendors });
      else setFetchError(r.error || p.modelsEmpty);
    } catch (e: any) {
      setFetchError(e?.message || String(e));
    } finally {
      setFetching(false);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && models === null) {
      // 顶栏快切默认只给「精简推荐集 + 当前模型」——不倒整个目录:聚合商 /models 常有上百个,
      // 还混着图像/视频/向量/TTS 等非对话模型(如 doubao-seedance、flux、bge),快切里没意义。
      const suggestions = remoteSuggestions ?? API_PROVIDER_MAP[eff]?.modelSuggestions ?? [];
      // 当前已选但不在推荐集里的模型也带上,避免下拉里看不到自己正在用的那个。
      setModels(current && !suggestions.includes(current) ? [current, ...suggestions] : suggestions);
      // 没有推荐集(自定义/远程/前端不认识的供应商)→ 直接实拉,别让用户只看到一个。
      if (suggestions.length === 0 && fetched === null) void fetchAll();
    }
  };

  const pick = async (m: string) => {
    setSaving(true);
    setOpen(false);
    try {
      await api.saveConfig({ provider: eff, model: m });
      setCurrent(m);
    } finally {
      setSaving(false);
    }
  };

  const item = (m: string) => (
    <button
      key={m}
      type="button"
      onClick={() => pick(m)}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left font-mono text-xs transition-colors hover:bg-muted",
        m === current ? "bg-muted text-foreground" : "text-foreground",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{m}</span>
      {m === current && <Check className="size-3.5 shrink-0 text-gold" />}
    </button>
  );

  const list = models ?? [];
  // 实拉到全量后以它为准(推荐集里的已包含在内;当前模型若不在目录里仍置顶保留)
  const showFetched = fetched !== null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={toggle}
        title={p.modelSelectTitle}
        className="flex h-8 items-center gap-1.5 rounded-lg border border-border/70 bg-card/60 px-2.5 text-sm text-foreground outline-none transition-colors hover:border-border"
      >
        <Cpu className="size-3.5 shrink-0 opacity-60" />
        <span className="max-w-[140px] truncate font-mono text-xs">{saving ? "…" : current || p.modelDefaultLabel}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-60" />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1.5 max-h-[60vh] w-72 overflow-auto rounded-xl border border-border/70 bg-card p-1 shadow-xl">
          {showFetched ? (
            <>
              {current && !fetched.models.includes(current) && item(current)}
              {groupModelsByVendor(fetched.models, fetched.vendors).map(([vendor, ms]) => (
                <div key={vendor}>
                  <div className="px-2.5 pb-0.5 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">{vendor}</div>
                  {ms.map(item)}
                </div>
              ))}
            </>
          ) : (
            <>
              {list.length === 0 && !fetching && (
                <div className="px-2.5 py-2 text-xs text-muted-foreground">{fetchError || p.modelsEmpty}</div>
              )}
              {list.map(item)}
              {fetching ? (
                <div className="flex items-center gap-1.5 px-2.5 py-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  {p.modelsFetching}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void fetchAll()}
                  className="mt-1 flex w-full items-center gap-1.5 rounded-lg border-t border-border/50 px-2.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <ListPlus className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{p.modelsFetchAll}</span>
                </button>
              )}
              {fetchError && list.length > 0 && (
                <div className="px-2.5 pb-1.5 text-[11px] text-destructive">{fetchError}</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
