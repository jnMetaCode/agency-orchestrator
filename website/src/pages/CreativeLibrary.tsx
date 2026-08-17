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
function readGenPref(): GenPref {
  try { return JSON.parse(localStorage.getItem(GEN_PREF_KEY) || "{}") as GenPref; } catch { return {}; }
}
function writeGenPref(patch: GenPref): void {
  try { localStorage.setItem(GEN_PREF_KEY, JSON.stringify({ ...readGenPref(), ...patch })); } catch { /* noop */ }
}
// 尺寸原样透传给各家 API；"默认"= 不发这个字段（各家默认档不同，不替用户选）
const SIZES = ["", "1024x1024", "1536x1024", "1024x1536"];

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
      <h3 className="font-semibold leading-snug">{p.title}</h3>
      {p.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{p.description}</p>}
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
    for (const p of DATA.prompts) set.set(p.category, (set.get(p.category) ?? 0) + 1);
    return [...set.entries()].sort((a, b) => b[1] - a[1]);
  }, []);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return DATA.prompts.filter(
      (p) => (cat === "all" || p.category === cat) && (!n || (p.title + p.description + p.prompt).toLowerCase().includes(n)),
    );
  }, [q, cat]);

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
            {lang === "en"
              ? `${DATA.count} ready-to-use image generation prompts (${DATA.model}). Copy and paste into your image tool.`
              : `${DATA.count} 条可直接取用的图像生成提示词（${DATA.model}）。复制后粘进你的图像工具即可。`}
          </p>

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
            <span className="text-sm text-muted-foreground">{filtered.length} {lang === "en" ? "prompts" : "条"}</span>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <button
              onClick={() => setCat("all")}
              className={cn("rounded-full px-3 py-1.5 text-xs font-medium transition-colors", cat === "all" ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:text-foreground")}
            >
              {lang === "en" ? "All" : "全部"}
            </button>
            {categories.map(([c, n]) => (
              <button
                key={c}
                onClick={() => setCat(c)}
                className={cn("rounded-full px-3 py-1.5 text-xs font-medium transition-colors", cat === c ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:text-foreground")}
              >
                {c} <span className="opacity-60">{n}</span>
              </button>
            ))}
          </div>

          {/* 卡片 */}
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pageItems.map((p) => <PromptCard key={p.id} p={p} gen={gen} onOpenGen={ensureGen} />)}
          </div>
          {filtered.length === 0 && <p className="mt-10 text-center text-sm text-muted-foreground">{lang === "en" ? "No matching prompts" : "没有匹配的提示词"}</p>}

          {/* 分页 */}
          {totalPages > 1 && (
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

          {/* 出处署名（CC BY 4.0 要求） */}
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
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
