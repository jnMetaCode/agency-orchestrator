import { ChevronDown, Clapperboard } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/i18n/LanguageProvider";
import { api, API_PROVIDERS, getMediaDefaults, setMediaDefaults, type ConfigResponse, type MediaDefaults } from "@/lib/studio";
import { cn } from "@/lib/utils";

/**
 * 顶栏「出图 / 出片」：媒体供应商与模型在这里统一切换（与文本的供应商/模型胶囊并列），
 * 创意出片模板运行时自动填入，弹窗里只展示不再逐个选——出图出片和换文本模型是同一种动作。
 * 候选只来自 /api/config：已配 key 的图片供应商、视频供应商表（含各家档位）。
 */
export function MediaSelect() {
  const { t } = useLanguage();
  const m = t.studio.shell.media;
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState<ConfigResponse | null>(null);
  const [d, setD] = useState<MediaDefaults>(getMediaDefaults);
  const [imgModels, setImgModels] = useState<Record<string, string[] | "loading" | "error">>({});
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    api.config().then(setCfg).catch(() => setCfg(null));
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const save = (next: MediaDefaults) => { setD(next); setMediaDefaults(next); };
  const label = (id: string) => API_PROVIDERS.find((p) => p.id === id)?.shortName || cfg?.customProviders?.find((c) => c.id === id)?.name || id;
  const imageProviders = (cfg?.imageProviders ?? []).filter((id) => cfg?.providers[id]?.hasKey);
  const videoProviders = cfg?.videoProviders ?? [];
  const vp = videoProviders.find((v) => v.id === d.video.provider);

  const ensureImgModels = (pid: string) => {
    if (!pid || imgModels[pid] !== undefined) return;
    setImgModels((p) => ({ ...p, [pid]: "loading" }));
    api.providerModels({ provider: pid })
      .then((r) => setImgModels((p) => ({ ...p, [pid]: r.ok && r.models?.length ? r.models : "error" })))
      .catch(() => setImgModels((p) => ({ ...p, [pid]: "error" })));
  };
  useEffect(() => { if (open && d.image.provider) ensureImgModels(d.image.provider); }, [open, d.image.provider]); // eslint-disable-line react-hooks/exhaustive-deps

  const selCls = "h-8 w-full rounded-lg border border-border/70 bg-background px-2 text-xs outline-none focus:border-primary/50";
  const row = (lab: string, el: React.ReactNode) => (
    <label className="grid grid-cols-[64px_1fr] items-center gap-2 text-xs text-muted-foreground">{lab}{el}</label>
  );
  const imgList = d.image.provider ? imgModels[d.image.provider] : undefined;
  const summary = [d.image.provider ? `🎨 ${label(d.image.provider)}` : "", d.video.provider ? `🎬 ${d.video.provider}` : ""].filter(Boolean).join(" · ");

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
      {open && (
        <div className="absolute right-0 z-50 mt-1.5 w-80 rounded-xl border border-border/70 bg-card p-3 shadow-xl">
          <p className="text-xs font-semibold">{m.title}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{m.desc}</p>
          {cfg && imageProviders.length === 0 && videoProviders.every((v) => !v.hasKey) && (
            <p className="mt-2 rounded-lg bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-600 dark:text-amber-400">{m.noProviders}</p>
          )}
          <div className="mt-3 space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">🎨 {m.image}</p>
            {row(m.provider, (
              <select className={selCls} value={d.image.provider} onChange={(e) => save({ ...d, image: { provider: e.target.value, model: "" } })}>
                <option value="">— {m.followText}</option>
                {imageProviders.map((id) => <option key={id} value={id}>{label(id)}</option>)}
              </select>
            ))}
            {row(m.model, (
              imgList === "loading" ? <span className="text-xs">{m.loading}</span> : (
                <input
                  list="ao-media-img-models"
                  className={selCls}
                  value={d.image.model}
                  placeholder={Array.isArray(imgList) ? imgList[0] : "gpt-image-2"}
                  onChange={(e) => save({ ...d, image: { ...d.image, model: e.target.value } })}
                />
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
                save({ ...d, video: { provider: e.target.value, model: m0, resolution: t0?.resolutions[0] ?? v?.resolutions[0] ?? "", duration: t0?.durations[0] != null ? String(t0.durations[0]) : "" } });
              }}>
                <option value="">—</option>
                {videoProviders.slice().sort((a, b) => Number(b.hasKey) - Number(a.hasKey)).map((v) => <option key={v.id} value={v.id}>{v.id}{v.hasKey ? "" : ` · ${m.noKey}`}</option>)}
              </select>
            ))}
            {row(m.model, (
              <input list="ao-media-vid-models" className={selCls} value={d.video.model} onChange={(e) => {
                // 换模型 → 档位跟着换（sora 720p / veo 固定 8s / H3 2K）
                const tm = vp?.tiers?.[e.target.value];
                save({ ...d, video: { ...d.video, model: e.target.value, ...(tm ? { resolution: tm.resolutions[0] ?? d.video.resolution, duration: tm.durations[0] != null ? String(tm.durations[0]) : d.video.duration } : {}) } });
              }} />
            ))}
            <datalist id="ao-media-vid-models">{vp?.models.map((x) => <option key={x} value={x} />)}</datalist>
            {row(m.resolution, (
              <input list="ao-media-vid-res" className={selCls} value={d.video.resolution} onChange={(e) => save({ ...d, video: { ...d.video, resolution: e.target.value } })} />
            ))}
            <datalist id="ao-media-vid-res">{(vp?.tiers?.[d.video.model]?.resolutions ?? vp?.resolutions ?? []).map((x) => <option key={x} value={x} />)}</datalist>
            {row(m.duration, (
              <input list="ao-media-vid-dur" className={cn(selCls)} value={d.video.duration} onChange={(e) => save({ ...d, video: { ...d.video, duration: e.target.value } })} />
            ))}
            <datalist id="ao-media-vid-dur">{(vp?.tiers?.[d.video.model]?.durations ?? vp?.durations ?? []).map((x) => <option key={x} value={String(x)} />)}</datalist>
          </div>
        </div>
      )}
    </div>
  );
}
