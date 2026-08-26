// 创意提示词库：图像生成（Nano Banana / Gemini）提示词,独立于专家库,方便直接取用。
// 内容来自 CC BY 4.0 开源库,UI 标注出处与作者署名（见底部 + 每张卡片）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, ExternalLink, Search, Download, Loader2, Sparkles } from "lucide-react";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { useLanguage } from "@/i18n/LanguageProvider";
import { useSeo } from "@/lib/useSeo";
import { track } from "@/lib/track";
import { cn } from "@/lib/utils";
import dataset from "@/content/creative-prompts.json";
import { API_PROVIDER_MAP, api } from "@/lib/studio";

interface CreativePrompt {
  id: string;
  title: string;
  description: string;
  /** 扩充池那批来自英文源，标题/描述由 scripts/translate-extra-titles.mjs 补的中文；
   *  正文永远保持原文（模型吃的是它）。中文界面优先显示这两个字段。 */
  titleZh?: string;
  descZh?: string;
  prompt: string;
  category: string;
  author: string;
  authorUrl: string;
  image: string;
  source: string;
}
interface Source { name: string; url: string; license: string; licenseUrl: string }
const DATA = dataset as {
  model: string; count: number; sources: Source[]; prompts: CreativePrompt[];
};

/** 能跑文生图的供应商（后端按引擎口径筛过）+ 给人看的名字。 */
interface GenEnv { ok: boolean; providers: { id: string; label: string }[] }

/**
 * 生成设置（供应商 + 图片模型 + 尺寸）在卡片之间共享并记住。
 * 库里 229 张卡片，每开一张都重填一遍模型编码不合理——而图片模型编码恰恰是最难记的那一项。
 * 写不进（隐私模式/禁用 storage）就静默降级成"每次重填"，绝不因此报错。
 */
const GEN_PREF_KEY = "ao.creative.gen";
type GenPref = { provider?: string; model?: string; size?: string };
/** 本地自托管的成片（/video-previews/…）可以直接自动播；外链的不行 */
const isLocalPreview = (u: string) => u.startsWith("/video-previews/");

/**
 * 示例成片：本地的像 GIF 一样静音自动循环，进入视口才加载（21 条同屏不抢带宽）；点一下切成带控件正常播。
 * React 不会把 muted 可靠写进 DOM 属性，Chrome 就会以为没静音而拒绝 autoplay ——所以用 ref 直接设 muted 再主动 play()。
 */
function AutoVideo({ src, local, expanded, onExpand }: { src: string; local: boolean; expanded: boolean; onExpand: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [inView, setInView] = useState(!local);
  useEffect(() => {
    const el = ref.current;
    if (!el || !local) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setInView(true); io.disconnect(); } }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [local]);
  useEffect(() => {
    const el = ref.current;
    if (!el || !inView) return;
    if (local && !expanded) { el.muted = true; el.defaultMuted = true; }
    el.play().catch(() => { /* 浏览器拒绝自动播就静止显示首帧，不报错 */ });
  }, [inView, local, expanded]);
  const quiet = local && !expanded;
  return (
    <video
      ref={ref}
      className="mt-2.5 max-h-64 w-full cursor-pointer rounded-lg border border-border/60 bg-black"
      src={inView ? src : undefined}
      controls={!quiet}
      autoPlay={inView}
      muted={quiet}
      loop={quiet}
      playsInline
      preload={inView ? "auto" : "none"}
      onClick={() => { if (quiet) onExpand(); }}
      onError={(e) => { (e.currentTarget as HTMLVideoElement).style.display = "none"; }}
    />
  );
}

// 示例成片的出片方（角标 + 返利链接）。只写真出过片的；链接与 sponsors.ts 里的赞助商条目一致。
const PREVIEW_VENDORS: Record<string, { name: string; nameEn: string; url: string }> = {
  metaso: { name: "秘塔科技", nameEn: "MetaSota", url: "https://metaso.cn/minimax-h3/?s=gt533367" },
  volcengine: { name: "火山引擎", nameEn: "Volcengine", url: "https://www.volcengine.com/activity/ai618?utm_campaign=hw&utm_content=hw&utm_medium=devrel_tool_web&utm_source=OWO&utm_term=agency-agents-zh" },
  apimart: { name: "APIMart", nameEn: "APIMart", url: "https://apimart.ai" },
  agnes: { name: "Agnes AI", nameEn: "Agnes AI", url: "https://agnes-ai.com" },
};

function readGenPref(): GenPref {
  try { return JSON.parse(localStorage.getItem(GEN_PREF_KEY) || "{}") as GenPref; } catch { return {}; }
}
function writeGenPref(patch: GenPref): void {
  try { localStorage.setItem(GEN_PREF_KEY, JSON.stringify({ ...readGenPref(), ...patch })); } catch { /* noop */ }
}
// 尺寸原样透传给各家 API；"默认"= 不发这个字段（各家默认档不同，不替用户选）
const SIZES = ["", "1024x1024", "1536x1024", "1024x1536"];

/**
 * 视频提示词模板（来自姊妹项目 ai-shortfilm-prompts，MIT 同作者）。
 * 与图片提示词是**两种数据形态**：图片一条 = 一段成品提示词；视频一条 = 题材模板
 * （变量表 + 5 段式正文），所以卡片长得不一样，不能复用 PromptCard。
 */
interface VideoTemplate {
  id: string;
  kind: "genre" | "module" | "community";
  lang: string;
  title: string;
  /** 社区池那批是英文成品单条，标题由 translate-extra-titles.mjs 补的中文 */
  titleZh?: string;
  descZh?: string;
  category: string;
  description: string;
  variables: { name: string; example: string }[];
  prompt: string;
  /** 示例成片（外链）。社区池里 18 条有，题材模板暂时没有——见 scripts/gen-video-previews.mjs */
  preview?: string;
  /** 示例成片由谁出的（供应商 / 模型 / 档位）——卡片角标 + 赞助商返利链接 */
  previewBy?: { provider: string; model: string; resolution?: string; seconds?: number };
  source: string;
  license: string;
  author: string;
}
interface VideoData { upstream: string; site: string; count: number; templates: VideoTemplate[] }

function VideoCard({ t }: { t: VideoTemplate }) {
  const { lang } = useLanguage();
  const en = lang === "en";
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  // 示例成片**点了才加载**：OpenAI 官方那几条单个 17~48MB，一页 24 张卡自动预载会把
  // 流量打爆；preload="none" 也只能省下载、省不掉 24 个黑框，所以干脆按需换入。
  const [showVideo, setShowVideo] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(t.prompt);
      setCopied(true);
      track("video_prompt_copy", { id: t.id, category: t.category });
      setTimeout(() => setCopied(false), 1500);
    } catch { /* noop */ }
  };
  return (
    <div className="flex flex-col rounded-xl border border-border/60 bg-card/50 p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold leading-snug">{(!en && t.titleZh) || t.title}</h3>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
          t.kind === "module" ? "bg-muted text-muted-foreground"
          : t.kind === "community" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
          : "bg-primary/10 text-primary")}>
          {t.kind === "module" ? (en ? "Building block" : "构件") : t.category}
        </span>
      </div>
      <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{(!en && t.descZh) || t.description}</p>

      {t.variables.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {t.variables.slice(0, 6).map((v) => (
            <span key={v.name} title={v.example} className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {v.name}
            </span>
          ))}
        </div>
      )}

      {/* 自己出的示例成片（本地 /video-previews/，480 宽无音轨约 0.1MB）：像 GIF 一样静音自动循环，不用点；
          外链示例（OpenAI showcase / 推特 CDN，17–48MB）仍保留点击才加载 */}
      {t.preview && (isLocalPreview(t.preview) || showVideo) && (
        <AutoVideo src={t.preview} local={isLocalPreview(t.preview)} expanded={showVideo} onExpand={() => setShowVideo(true)} />
      )}

      {open && t.prompt && (
        <pre className="mt-2.5 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-muted/40 p-2.5 text-[11px] leading-relaxed">{t.prompt}</pre>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        {t.preview && t.previewBy && (
          <a
            href={PREVIEW_VENDORS[t.previewBy.provider]?.url ?? "#"}
            target="_blank"
            rel="noreferrer"
            onClick={() => track("sponsor_click", { id: t.previewBy!.provider, from: "video-preview" })}
            title={en ? "This sample clip was generated with this provider's API" : "这条示例成片就是用这家的 API 出的"}
            className="inline-flex items-center gap-1 rounded-full bg-gold/10 px-2 py-0.5 text-[11px] font-medium text-gold hover:bg-gold/20"
          >
            🎬 {(en ? PREVIEW_VENDORS[t.previewBy.provider]?.nameEn : PREVIEW_VENDORS[t.previewBy.provider]?.name) ?? t.previewBy.provider} · {t.previewBy.model}{t.previewBy.resolution ? ` · ${t.previewBy.resolution}` : ""}{t.previewBy.seconds ? ` × ${t.previewBy.seconds}s` : ""} ↗
          </a>
        )}
        {t.preview && !showVideo && !isLocalPreview(t.preview) && (
          <button
            onClick={() => { setShowVideo(true); track("video_preview_play", { id: t.id }); }}
            className="inline-flex items-center gap-1 rounded-lg border border-primary/40 bg-primary/5 px-2.5 py-1.5 font-medium text-primary transition-colors hover:bg-primary/10"
          >
            ▶ {en ? "Play sample" : "看示例成片"}
          </button>
        )}
        {t.prompt && (
          <>
            <button onClick={() => setOpen((o) => !o)} className="rounded-lg border border-border/70 px-2.5 py-1.5 transition-colors hover:border-primary/50">
              {open ? (en ? "Hide" : "收起") : (en ? "View prompt" : "看提示词")}
            </button>
            <button onClick={copy} className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-2.5 py-1.5 transition-colors hover:border-primary/50">
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? (en ? "Copied" : "已复制") : (en ? "Copy" : "复制")}
            </button>
          </>
        )}
        <a href={t.source} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary">
          {en ? "Full breakdown" : "原文与拆解"} <ExternalLink className="size-3" />
        </a>
      </div>
    </div>
  );
}

function PromptCard({ p, gen, onOpenGen }: { p: CreativePrompt; gen: GenEnv | null; onOpenGen: () => void }) {
  const { lang } = useLanguage();
  const en = lang === "en";
  const [copied, setCopied] = useState(false);
  // 一键生成：提示词就是卡片上的 prompt，用户只需选供应商 + 填图片模型
  const [genOpen, setGenOpen] = useState(false);
  const [genProvider, setGenProvider] = useState(() => readGenPref().provider ?? "");
  const [genModel, setGenModel] = useState(() => readGenPref().model ?? "");
  const [genSize, setGenSize] = useState(() => readGenPref().size ?? "");
  const [busy, setBusy] = useState(false);
  const [genImg, setGenImg] = useState<string | null>(null);
  // 真实出图尺寸（从 PNG 头量的）——不少服务商把 size 当建议，照实显示，
  // 否则用户会以为是自己把参数写错了（实测 LanoX/gpt-image-2 就不按 size 出）
  const [genDim, setGenDim] = useState<{ width: number; height: number } | null>(null);
  const [genErr, setGenErr] = useState<string | null>(null);
  // 记住的供应商可能已经不在列表里了（key 删了 / 换了机器）——那时下拉会显示第一项，
  // 而状态里还是旧 id。**显示值与发送值必须是同一个表达式**，否则报错会指向界面上没选的那家。
  const effProvider = gen?.providers.some((pr) => pr.id === genProvider)
    ? genProvider
    : gen?.providers[0]?.id ?? "";
  const doGenerate = async () => {
    if (!gen?.ok || !effProvider) return;   // 无后端 / 无可用供应商：面板里已显示提示
    setBusy(true); setGenErr(null); setGenImg(null); setGenDim(null);
    track("creative_generate", { id: p.id, category: p.category });
    try {
      const r = await api.generateImage({
        provider: effProvider,
        model: genModel.trim(),
        prompt: p.prompt,
        ...(genSize ? { size: genSize } : {}),
      });
      if (r.ok && r.dataUrl) {
        setGenImg(r.dataUrl);
        if (r.width && r.height) setGenDim({ width: r.width, height: r.height });
      }
      else setGenErr(r.error || (en ? "Generation failed" : "生成失败"));
    } catch (e) { setGenErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(p.prompt); setCopied(true); track("creative_prompt_copy", { id: p.id, category: p.category, source: p.source }); setTimeout(() => setCopied(false), 1500); } catch { /* noop */ }
  };
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/60">
      {p.image && (
        <img
          src={p.image}
          alt={p.title}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          className="aspect-[4/3] w-full bg-muted/40 object-cover"
        />
      )}
      <div className="flex flex-1 flex-col p-4">
      <div className="mb-1 flex items-center gap-2">
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">{p.category}</span>
        <span className="text-[10px] text-muted-foreground/60">{p.source}</span>
      </div>
      <h3 className="font-semibold leading-snug">{(!en && p.titleZh) || p.title}</h3>
      {((!en && p.descZh) || p.description) && (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{(!en && p.descZh) || p.description}</p>
      )}
      <pre className="mt-3 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-2.5 text-[11px] leading-relaxed text-foreground/90">{p.prompt}</pre>
      <div className="mt-3 flex items-center justify-between gap-2">
        {p.author ? (
          <a href={p.authorUrl || undefined} target="_blank" rel="noreferrer" className="truncate text-[11px] text-muted-foreground hover:text-foreground">
            @{p.author}
          </a>
        ) : <span />}
        <span className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={copy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-2.5 py-1.5 text-xs font-medium transition-colors hover:border-primary/50 hover:text-primary"
          >
            {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
            {copied ? (en ? "Copied" : "已复制") : (en ? "Copy" : "复制提示词")}
          </button>
          <button
            onClick={() => { onOpenGen(); setGenOpen((v) => !v); }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Sparkles className="size-3.5" />
            {en ? "Generate" : "生成"}
          </button>
        </span>
      </div>
      {genOpen && (
        <div className="mt-3 rounded-xl border border-border/60 bg-muted/30 p-3 text-xs">
          {/* 公开演示站没有引擎后端 —— 说清怎么在本机用，别给一个点了必失败的按钮 */}
          {!gen ? (
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />{en ? "Checking engine…" : "正在检测引擎…"}
            </p>
          ) : !gen.ok ? (
            <p className="leading-relaxed text-amber-600 dark:text-amber-400">
              {en
                ? "This is the public demo site (no engine). Run locally to generate for real: npx agency-orchestrator web, then open this page on localhost."
                : "这是公开演示站，没有引擎后端。要真生成：本机跑 npx agency-orchestrator web，再在 localhost 打开本页即可。"}
            </p>
          ) : gen && gen.providers.length === 0 ? (
            <p className="leading-relaxed text-amber-600 dark:text-amber-400">
              {en
                ? "No image-capable provider with a key yet — configure one in Studio → Providers first. Image generation needs an OpenAI-compatible API provider; local coding CLIs (Claude Code etc.) and Anthropic-protocol relays have no image endpoint."
                : "还没有能出图且配好 key 的供应商 —— 先去 工作台 → 供应商 配一个。文生图需要 OpenAI 兼容的 API 供应商：本地编码 CLI（Claude Code 等）与 Anthropic 协议中转都没有图片端点。"}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={effProvider}
                  onChange={(e) => { setGenProvider(e.target.value); writeGenPref({ provider: e.target.value }); }}
                  className="h-8 rounded-lg border border-border/70 bg-background px-2"
                >
                  {gen?.providers.map((pr) => <option key={pr.id} value={pr.id}>{pr.label}</option>)}
                </select>
                <input
                  value={genModel}
                  onChange={(e) => { setGenModel(e.target.value); writeGenPref({ model: e.target.value }); }}
                  placeholder={en ? "image model, e.g. gpt-image-2" : "图片模型，如 gpt-image-2"}
                  className="h-8 min-w-0 flex-1 rounded-lg border border-border/70 bg-background px-2"
                />
                <select
                  value={genSize}
                  onChange={(e) => { setGenSize(e.target.value); writeGenPref({ size: e.target.value }); }}
                  className="h-8 rounded-lg border border-border/70 bg-background px-2"
                >
                  {SIZES.map((s) => <option key={s || "auto"} value={s}>{s || (en ? "default size" : "默认尺寸")}</option>)}
                </select>
                <button
                  onClick={doGenerate}
                  disabled={busy || !genModel.trim()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 font-medium text-primary-foreground disabled:opacity-50"
                >
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                  {busy ? (en ? "Generating…" : "生成中…") : (en ? "Go" : "出图")}
                </button>
              </div>
              {/* 图片模型必填且不猜 —— 与引擎同一条纪律，placeholder 只是示例。
                  这一步可能要跑 30-120 秒，别让用户以为卡死了 */}
              {busy && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {en ? "Image models usually take 30–120s — keep this panel open." : "出图普遍要 30-120 秒，这个面板别关。"}
                </p>
              )}
              {genErr && <p className="mt-2 whitespace-pre-line break-words text-red-500">{genErr}</p>}
              {genImg && (
                <div className="mt-2">
                  <img src={genImg} alt={p.title} className="max-h-80 w-auto rounded-lg border border-border/60" />
                  {genDim && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {genDim.width}×{genDim.height}
                      {genSize && `${genDim.width}x${genDim.height}` !== genSize && (
                        <span className="ml-1 text-amber-600 dark:text-amber-400">
                          {en ? `(you asked ${genSize} — this provider treats size as a hint)` : `（你选的是 ${genSize} —— 这家把尺寸当建议而非硬约束）`}
                        </span>
                      )}
                    </p>
                  )}
                  <a
                    href={genImg}
                    download={`${p.id}.png`}
                    className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                  >
                    <Download className="size-3" />{en ? "Download PNG" : "下载 PNG"}
                  </a>
                </div>
              )}
            </>
          )}
        </div>
      )}
      </div>
    </div>
  );
}

export default function CreativeLibrary() {
  const { lang } = useLanguage();
  useSeo(
    lang === "en"
      ? `Creative Library — ${DATA.count}+ Nano Banana / Gemini image prompts | Agency Orchestrator`
      : `创意库 — ${DATA.count}+ Nano Banana / Gemini 图像生成提示词大全 | Agency Orchestrator`,
    lang === "en"
      ? `${DATA.count}+ ready-to-copy Nano Banana / Gemini (Google) AI image generation prompts, browse by category, free.`
      : `${DATA.count}+ 条可直接复制的 Nano Banana / Gemini(谷歌)AI 图像生成中文提示词,按分类浏览,免费取用。`,
  );
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  // 图片 / 视频两个页签。视频那份数据 200KB+，**按需 import**——这是一张公开 SEO 页，
  // 绝大多数访客只是来复制图片提示词的，不该为他们把首包撑大一倍。
  const [media, setMedia] = useState<"image" | "video">("image");
  // 图片扩充池（MIT 源，1100 条）：**不默认加载**。/creative 是公开 SEO 页，
  // 默认那 229 条是带中文标题与作者署名的策展集、也是有静态页的那批；扩充池 1.9MB，
  // 让每个只是来复制一条提示词的访客都下载它不合理——点了才拉。
  const [extra, setExtra] = useState<CreativePrompt[] | null>(null);
  const [extraLoading, setExtraLoading] = useState(false);
  const loadExtra = useCallback(() => {
    if (extra || extraLoading) return;
    setExtraLoading(true);
    import("@/content/creative-prompts-extra.json")
      .then((m) => {
        const d = (m.default ?? m) as unknown as { prompts: CreativePrompt[] };
        setExtra(d.prompts ?? []);
        track("creative_extra_load", { count: (d.prompts ?? []).length });
      })
      .catch(() => setExtra([]))
      .finally(() => setExtraLoading(false));
  }, [extra, extraLoading]);
  const imagePrompts = useMemo(() => (extra ? [...DATA.prompts, ...extra] : DATA.prompts), [extra]);
  const [videoData, setVideoData] = useState<VideoData | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);
  useEffect(() => {
    if (media !== "video" || videoData || videoLoading) return;
    setVideoLoading(true);
    // 两份数据：姊妹项目的 5 段式题材模板（有变量表）+ 社区成品单条（英文、无变量）。
    // 社区那份只有 35KB，跟主数据一起拉，不值得再让用户多点一次。
    Promise.all([
      import("@/content/video-prompts.json"),
      import("@/content/video-prompts-community.json").catch(() => null),
    ])
      .then(([a, b]) => {
        const base = ((a as any).default ?? a) as VideoData;
        const extraT = b ? (((b as any).default ?? b).templates ?? []) as VideoTemplate[] : [];
        setVideoData({ ...base, templates: [...base.templates, ...extraT] });
      })
      .catch(() => setVideoData({ upstream: "", site: "", count: 0, templates: [] }))
      .finally(() => setVideoLoading(false));
  }, [media, videoData, videoLoading]);

  // 语言过滤：两套语言的模板都在同一份数据里；某语言缺条目时退回中文，别给空列表
  const videoItems = useMemo(() => {
    const all = videoData?.templates ?? [];
    const want = lang === "en" ? "en" : "zh";
    // lang: "any" = 社区池那批英文成品单条，中英界面都该看得到（它没有中英两版）
    const hit = all.filter((t) => t.lang === want || t.lang === "any");
    return hit.length ? hit : all.filter((t) => t.lang === "zh" || t.lang === "any");
  }, [videoData, lang]);
  const videoCategories = useMemo(() => {
    const set = new Map<string, number>();
    for (const t of videoItems) set.set(t.category, (set.get(t.category) ?? 0) + 1);
    // 「构件」永远排最后：它不是题材，是零件，别插在题材中间干扰选择
    return [...set.entries()].sort((a, b) =>
      (a[0] === "构件" ? 1 : b[0] === "构件" ? -1 : 0) || b[1] - a[1]);
  }, [videoItems]);
  const videoFiltered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return videoItems.filter(
      (t) => (cat === "all" || t.category === cat)
        && (!n || (t.title + t.description + t.prompt + (t.titleZh ?? "") + (t.descZh ?? "")).toLowerCase().includes(n)),
    );
  }, [videoItems, q, cat]);
  useEffect(() => { setCat("all"); setPage(1); }, [media]);

  // 一键生成的运行环境：本地 Studio 有引擎（可真生成），公开演示站没有（/api/* 落到 SPA
  // 兜底回 HTML，解析必失败 → 走 catch，按钮降级成"怎么在本机跑"的提示）。
  // null = 还没探测完；候选只留「引擎认可能出图」∩「已配 key」——没 key 生成必失败，不如引导先配。
  // 只在用户第一次展开「生成」面板时才探（这是一张公开 SEO 页面，绝大多数访客只是来复制
  // 提示词的——不该为他们每次访问都打一次后端）。probed 防并发重复请求。
  const [gen, setGen] = useState<GenEnv | null>(null);
  const probed = useRef(false);
  const ensureGen = useCallback(() => {
    if (probed.current) return;
    probed.current = true;
    api.config()
      .then((c) => {
        // imageProviders 是后端按引擎 resolveImageAccess 的口径给的；老引擎没有这个字段
        // （前端新、引擎旧的版本漂移）→ 退回按 family 筛，但仍剔掉 CLI 那几个假 api 成员
        const capable = c.imageProviders
          ?? Object.entries(c.providers ?? {})
            .filter(([id, v]) => v.family === "api" && !id.endsWith("-cli") && id !== "claude" && id !== "aicodemirror")
            .map(([id]) => id);
        const name = (id: string) =>
          API_PROVIDER_MAP[id]?.shortName
          || API_PROVIDER_MAP[id]?.name
          || c.customProviders?.find((x) => x.id === id)?.name
          || c.remoteProviders?.find((x) => x.id === id)?.name
          || id;
        const providers = capable
          .filter((id) => c.providers?.[id]?.hasKey)
          .map((id) => ({ id, label: name(id) }));
        setGen({ ok: true, providers });
      })
      .catch(() => setGen({ ok: false, providers: [] }));
  }, []);

  const categories = useMemo(() => {
    const set = new Map<string, number>();
    for (const p of imagePrompts) set.set(p.category, (set.get(p.category) ?? 0) + 1);
    return [...set.entries()].sort((a, b) => b[1] - a[1]);
  }, [imagePrompts]);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return imagePrompts.filter(
      (p) => (cat === "all" || p.category === cat)
        && (!n || (p.title + p.description + p.prompt + (p.titleZh ?? "") + (p.descZh ?? "")).toLowerCase().includes(n)),
    );
  }, [q, cat, imagePrompts]);

  // 分页：每页 24 条（带图卡片多了渲染重）。筛选/搜索/分类变化时回到第 1 页。
  const PAGE_SIZE = 24;
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [q, cat]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <>
      <main className="pt-24">
        <div className="container-page pb-20">
          {/* 头部 */}
          <h1 className="text-2xl font-bold">{lang === "en" ? "Creative Library" : "创意库"}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {media === "image"
              ? (lang === "en"
                ? `${DATA.count} ready-to-use image generation prompts (${DATA.model}). Copy and paste into your image tool.`
                : `${DATA.count} 条可直接取用的图像生成提示词（${DATA.model}）。复制后粘进你的图像工具即可。`)
              : (lang === "en"
                ? "Text-to-video templates: pick a genre, fill a few variables, get a full 5-part cinematic prompt. Run them with a `type: video` step in a workflow."
                : "文生视频模板：挑题材、填几个变量，拿到完整的 5 段式电影感提示词。工作流里用 `type: video` 步骤可以直接出片。")}
          </p>

          {/* 图片 / 视频：两种数据形态，卡片长得不一样（图片是成品提示词，视频是带变量的题材模板） */}
          <div className="mt-4 inline-flex rounded-xl border border-border/70 bg-card/50 p-1">
            {(["image", "video"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMedia(m)}
                className={cn("rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors",
                  media === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {m === "image" ? (lang === "en" ? "Images" : "图片") : (lang === "en" ? "Video" : "视频")}
                <span className="ml-1.5 opacity-60">{m === "image" ? imagePrompts.length : (videoData ? videoItems.length : 71)}</span>
              </button>
            ))}
          </div>

          {/* 搜索 + 分类 */}
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative max-w-md flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={lang === "en" ? "Search prompts…" : "搜索提示词…"}
                className="h-10 w-full rounded-xl border border-border/70 bg-card/60 pl-9 pr-3 text-sm outline-none focus:border-primary/50"
              />
            </div>
            <span className="text-sm text-muted-foreground">{(media === "image" ? filtered.length : videoFiltered.length)} {lang === "en" ? "prompts" : "条"}</span>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <button
              onClick={() => setCat("all")}
              className={cn("rounded-full px-3 py-1.5 text-xs font-medium transition-colors", cat === "all" ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:text-foreground")}
            >
              {lang === "en" ? "All" : "全部"}
            </button>
            {(media === "image" ? categories : videoCategories).map(([c, n]) => (
              <button
                key={c}
                onClick={() => setCat(c)}
                className={cn("rounded-full px-3 py-1.5 text-xs font-medium transition-colors", cat === c ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:text-foreground")}
              >
                {c} <span className="opacity-60">{n}</span>
              </button>
            ))}
          </div>

          {/* 扩充池入口：默认不加载，点了才拉（见上面的说明） */}
          {media === "image" && !extra && (
            <button
              onClick={loadExtra}
              disabled={extraLoading}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-60"
            >
              {extraLoading
                ? <><Loader2 className="size-3.5 animate-spin" />{lang === "en" ? "Loading…" : "加载中…"}</>
                : <><Sparkles className="size-3.5" />{lang === "en" ? "Load 1,349 more prompts (~2MB)" : "再加载 1349 条提示词（约 2MB）"}</>}
            </button>
          )}

          {/* 卡片 */}
          {media === "image" ? (
            <>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {pageItems.map((p) => <PromptCard key={p.id} p={p} gen={gen} onOpenGen={ensureGen} />)}
              </div>
              {filtered.length === 0 && <p className="mt-10 text-center text-sm text-muted-foreground">{lang === "en" ? "No matching prompts" : "没有匹配的提示词"}</p>}
            </>
          ) : (
            <>
              {videoLoading && !videoData && (
                <p className="mt-10 text-center text-sm text-muted-foreground">{lang === "en" ? "Loading templates…" : "正在加载模板…"}</p>
              )}
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {videoFiltered.map((t) => <VideoCard key={`${t.lang}-${t.id}`} t={t} />)}
              </div>
              {videoData && videoFiltered.length === 0 && (
                <p className="mt-10 text-center text-sm text-muted-foreground">{lang === "en" ? "No matching templates" : "没有匹配的模板"}</p>
              )}
              {videoData && videoFiltered.length > 0 && (
                <div className="mt-6 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-xs leading-relaxed">
                  {lang === "en"
                    ? <>Want it filmed, not just copied? Run the built-in <strong>「一句话出短片」</strong> workflow in the Studio — a role writes the 5-part prompt from one sentence and a <code>type: video</code> step renders the mp4. </>
                    : <>不想只复制、想直接出片？在工作台跑内置模板 <strong>「一句话出短片」</strong>——角色按 5 段式把你的一句话写成提示词，<code>type: video</code> 步骤直接出 mp4。</>}
                  <a
                    href="/studio?tab=create&wf=%E4%B8%80%E5%8F%A5%E8%AF%9D%E5%87%BA%E7%9F%AD%E7%89%87.yaml"
                    className="ml-1 inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
                  >
                    {lang === "en" ? "Open it in the Studio" : "直接打开这个模板"} <ExternalLink className="size-3" />
                  </a>
                </div>
              )}
            </>
          )}

          {/* 分页（只图片需要：视频模板 28 条，一页放得下） */}
          {media === "image" && totalPages > 1 && (
            <div className="mt-8 flex items-center justify-center gap-3 text-sm">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-3 py-1.5 transition-colors hover:border-primary/50 disabled:opacity-40"
              >
                <ChevronLeft className="size-4" /> {lang === "en" ? "Prev" : "上一页"}
              </button>
              <span className="text-muted-foreground">{safePage} / {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
                className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-3 py-1.5 transition-colors hover:border-primary/50 disabled:opacity-40"
              >
                {lang === "en" ? "Next" : "下一页"} <ChevronRight className="size-4" />
              </button>
            </div>
          )}

          {/* 出处署名：视频那批来自姊妹项目（MIT），与图片那批的 CC BY 4.0 不是一回事，分开写 */}
          {media === "video" ? (
            <div className="mt-10 rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
              {lang === "en" ? "Video templates from the sister project " : "视频模板来自姊妹项目 "}
              <a href={videoData?.upstream || "https://github.com/jnMetaCode/ai-shortfilm-prompts"} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-foreground hover:text-primary">
                ai-shortfilm-prompts <ExternalLink className="size-3" />
              </a>
              {" · MIT · "}
              <a href={videoData?.site || "https://prompts.aiolaola.com"} target="_blank" rel="noreferrer" className="hover:text-foreground">
                {lang === "en" ? "full library & online generator" : "完整模板库与在线生成器"}
              </a>
              <br />
              {lang === "en" ? "Community singles from " : "「社区热门 / 写实风光 / 官方样例」来自 "}
              <a href="https://github.com/zhangchenchen/awesome_sora2_prompt" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-foreground hover:text-primary">
                awesome_sora2_prompt <ExternalLink className="size-3" />
              </a>
              {lang === "en"
                ? " (MIT; the “Official” ones are OpenAI’s published Sora showcase prompts). Prompts naming real people or IP were dropped, but the filter is best-effort — check compliance yourself."
                : "（MIT；其中「官方样例」原文是 OpenAI 公开的 Sora showcase）。指名真人与影视 IP 的已剔除，但过滤不可能穷尽，商用前请自行判断合规。"}
            </div>
          ) : (
          <div className="mt-10 rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
            {lang === "en" ? "Prompts & previews from " : "提示词与预览图来自 "}
            {DATA.sources.map((s, i) => (
              <span key={s.url}>
                {i > 0 && "、"}
                <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-foreground hover:text-primary">
                  {s.name} <ExternalLink className="size-3" />
                </a>
              </span>
            ))}
            {" · "}
            <a href={DATA.sources[0].licenseUrl} target="_blank" rel="noreferrer" className="hover:text-foreground">CC BY 4.0</a>
            {lang === "en" ? "。Credit to the original authors." : "，版权归原作者,已按 CC BY 4.0 署名。"}
            {extra && extra.length > 0 && (
              <>
                {lang === "en" ? " Extra pool from " : " 扩充池来自 "}
                <a href="https://github.com/jau123/nanobanana-trending-prompts" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-foreground hover:text-primary">
                  nanobanana-trending-prompts <ExternalLink className="size-3" />
                </a>
                {lang === "en" ? " (CC BY 4.0, per-prompt author credit) and " : "（CC BY 4.0，逐条署名到作者）与 "}
                <a href="https://github.com/YouMind-OpenLab/ai-image-prompts-skill" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-foreground hover:text-primary">
                  ai-image-prompts-skill <ExternalLink className="size-3" />
                </a>
                {lang === "en" ? " (MIT)." : "（MIT）。"}
                <br />
                {lang === "en"
                  ? "Extra-pool prompts are community-sourced (mostly from X) — some name real people or IP. Check compliance yourself before commercial use."
                  : "扩充池取自社区（多来自 X），其中部分提示词会指名真人或影视 IP —— 商用前请自行判断合规，我们不代为过滤。"}
              </>
            )}
          </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
