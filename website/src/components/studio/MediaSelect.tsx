import { ChevronDown, Clapperboard } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/i18n/LanguageProvider";
import { api, API_PROVIDERS, getMediaDefaults, setMediaDefaults, type ConfigResponse, type MediaDefaults } from "@/lib/studio";
import { cn } from "@/lib/utils";

/**
 * 「出图 / 出片」设置：图片/视频供应商、模型、档位在这里统一选，存 localStorage（ao-media-defaults）。
 * 两种渲染：顶栏胶囊（点开浮层）与运行弹窗右栏（embedded，直接摊开）——**同一个组件、同一份默认值**，
 * 改一处两边都变，不再出现"弹窗里改的和右上角的哪个算数"。
 * 候选只来自 /api/config：图片供应商已配 key 在前、已下架的只对配过 key 的露出；视频供应商表含各家档位。
 */
export function MediaSelect({ embedded }: { embedded?: boolean } = {}) {
  const { t } = useLanguage();
  const m = t.studio.shell.media;
  const [open, setOpen] = useState(!!embedded);
  const [cfg, setCfg] = useState<ConfigResponse | null>(null);
  const [d, setD] = useState<MediaDefaults>(getMediaDefaults);
  const [imgModels, setImgModels] = useState<Record<string, string[] | "loading" | "error">>({});
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    api.config().then(setCfg).catch(() => setCfg(null));
    if (embedded) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open, embedded]);
  // 另一处（顶栏 / 弹窗）改了默认值，这边跟着刷新
  useEffect(() => {
    const sync = () => setD(getMediaDefaults());
    window.addEventListener("ao-media-defaults", sync);
    return () => window.removeEventListener("ao-media-defaults", sync);
  }, []);

  const save = (next: MediaDefaults) => { setD(next); setMediaDefaults(next); };
  const label = (id: string) => { const p = API_PROVIDERS.find((x) => x.id === id); return p?.shortName || p?.name || cfg?.customProviders?.find((c) => c.id === id)?.name || id; };
  const hasKey = (id: string) => !!cfg?.providers[id]?.hasKey;
  const withKey = (id: string, text: string) => (hasKey(id) ? text : `${text} · ${m.noKey}`);
  const removed = new Set(cfg?.removedProviders ?? []);
  const delisted = (id: string) => !!API_PROVIDERS.find((p) => p.id === id)?.delisted || removed.has(id);
  // 图片供应商：已配 key 在前，其余按注册表顺序；已下架的只对配过 key 的露出（与顶栏供应商下拉同一规则）
  const imageProviders = (cfg?.imageProviders ?? [])
    .filter((id) => !delisted(id) || hasKey(id))
    .sort((a, b) => Number(hasKey(b)) - Number(hasKey(a)));
  const videoProviders = (cfg?.videoProviders ?? []).slice().sort((a, b) => Number(b.hasKey) - Number(a.hasKey));
  const vp = videoProviders.find((v) => v.id === d.video.provider);
  const tier = vp?.tiers?.[d.video.model];

  useEffect(() => {
    const pid = d.image.provider;
    if (!open || !pid || imgModels[pid] !== undefined) return;
    setImgModels((p) => ({ ...p, [pid]: "loading" }));
    api.providerModels({ provider: pid })
      .then((r) => setImgModels((p) => ({ ...p, [pid]: r.ok && r.models?.length ? r.models : "error" })))
      .catch(() => setImgModels((p) => ({ ...p, [pid]: "error" })));
  }, [open, d.image.provider]); // eslint-disable-line react-hooks/exhaustive-deps

  const selCls = "h-8 w-full rounded-lg border border-border/70 bg-background px-2 text-xs outline-none focus:border-primary/50";
  const row = (lab: string, el: React.ReactNode) => (
    <label className="grid grid-cols-[64px_1fr] items-center gap-2 text-xs text-muted-foreground">{lab}{el}</label>
  );
  const imgList = d.image.provider ? imgModels[d.image.provider] : undefined;
  const [customModel, setCustomModel] = useState(false);
  // 档位：有候选就下拉（含"自定义…"回到手填），没候选就手填
  const tierSelect = (opts: string[], value: string, onChange: (v: string) => void, suffix = "") =>
    opts.length > 0 && (value === "" || opts.includes(value)) ? (
      <select className={selCls} value={value} onChange={(e) => onChange(e.target.value === "__custom__" ? "" : e.target.value)}>
        <option value="">—</option>
        {opts.map((x) => <option key={x} value={x}>{x}{suffix}</option>)}
      </select>
    ) : (
      <input className={selCls} value={value} onChange={(e) => onChange(e.target.value)} />
    );
  const summary = [d.image.provider ? `🎨 ${label(d.image.provider)}` : "", d.video.provider ? `🎬 ${d.video.provider}` : ""].filter(Boolean).join(" · ");

  const panel = (
    <div className={cn(embedded ? "rounded-2xl border border-border/60 bg-card/40 p-3" : "absolute right-0 z-50 mt-1.5 w-80 rounded-xl border border-border/70 bg-card p-3 shadow-xl")}>
      <p className="text-xs font-semibold">🎨🎬 {m.title}</p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{m.desc}</p>
      {cfg && imageProviders.every((id) => !hasKey(id)) && videoProviders.every((v) => !v.hasKey) && (
        <p className="mt-2 rounded-lg bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-600 dark:text-amber-400">{m.noProviders}</p>
      )}
      <div className="mt-3 space-y-1.5">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">🎨 {m.image}</p>
        {row(m.provider, (
          <select className={selCls} value={d.image.provider} onChange={(e) => save({ ...d, image: { provider: e.target.value, model: "" } })}>
            <option value="">— {m.followText}</option>
            {imageProviders.map((id) => <option key={id} value={id}>{withKey(id, label(id))}</option>)}
          </select>
        ))}
        {row(m.model, (
          imgList === "loading" ? <span className="text-xs">{m.loading}</span> : (
            <input list="ao-media-img-models" className={selCls} value={d.image.model} placeholder={Array.isArray(imgList) ? imgList[0] : "gpt-image-2"} onChange={(e) => save({ ...d, image: { ...d.image, model: e.target.value } })} />
          )
        ))}
        <datalist id="ao-media-img-models">{Array.isArray(imgList) && imgList.map((x) => <option key={x} value={x} />)}</datalist>
      </div>
      <div className="mt-3 space-y-1.5">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">🎬 {m.video}</p>
        {row(m.provider, (
          <select className={selCls} value={d.video.provider} onChange={(e) => {
            const v = videoProviders.find((x) => x.id === e.target.value);
            const m0 = v?.models[0] ?? "";
            const t0 = v?.tiers?.[m0];
            setCustomModel(false);
            save({ ...d, video: { provider: e.target.value, model: m0, resolution: t0?.resolutions[0] ?? v?.resolutions[0] ?? "", duration: t0?.durations[0] != null ? String(t0.durations[0]) : "", ratio: t0?.ratios?.[0] ?? "" } });
          }}>
            <option value="">—</option>
            {videoProviders.map((v) => <option key={v.id} value={v.id}>{withKey(v.id, label(v.id))}</option>)}
          </select>
        ))}
        {row(m.model, (
          // 模型是下拉：用户得**看得见**这家有哪些模型（sora-2 只有 720p、sora-2-pro 才有 1080p 这种区别只有列出来才知道）
          vp && !customModel ? (
            <select className={selCls} value={vp.models.includes(d.video.model) ? d.video.model : ""} onChange={(e) => {
              if (e.target.value === "__custom__") { setCustomModel(true); return; }
              const tm = vp.tiers?.[e.target.value];
              save({ ...d, video: { ...d.video, model: e.target.value, resolution: tm?.resolutions[0] ?? "", duration: tm?.durations[0] != null ? String(tm.durations[0]) : "", ratio: tm?.ratios?.[0] ?? "" } });
            }}>
              <option value="">—</option>
              {vp.models.map((x) => <option key={x} value={x}>{x}</option>)}
              <option value="__custom__">{m.customModel}</option>
            </select>
          ) : (
            <input className={selCls} value={d.video.model} placeholder="model id" onChange={(e) => save({ ...d, video: { ...d.video, model: e.target.value } })} />
          )
        ))}
        {row(m.resolution, tierSelect(tier?.resolutions ?? vp?.resolutions ?? [], d.video.resolution, (v) => save({ ...d, video: { ...d.video, resolution: v } })))}
        {row(m.duration, tierSelect((tier?.durations ?? vp?.durations ?? []).map(String), d.video.duration, (v) => save({ ...d, video: { ...d.video, duration: v } }), "s"))}
        {row(m.ratio, tierSelect(tier?.ratios ?? vp?.ratios ?? [], d.video.ratio, (v) => save({ ...d, video: { ...d.video, ratio: v } })))}
      </div>
    </div>
  );

  if (embedded) return panel;
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={m.title}
        className="flex h-8 items-center gap-1.5 rounded-lg border border-border/70 bg-card/60 px-2.5 text-sm text-foreground outline-none transition-colors hover:border-border"
      >
        <Clapperboard className="size-3.5 shrink-0 opacity-60" />
        <span className="max-w-[88px] truncate text-xs md:max-w-[180px]">{summary || m.pill}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-60" />
      </button>
      {open && panel}
    </div>
  );
}
