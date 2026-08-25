import { Check, Download, GitCompare, Loader2, Paperclip, Play, Scale, Search, Star, Trash2, Workflow as WorkflowIcon, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tip } from "@/components/ui/tip";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "@/i18n/LanguageProvider";
import { Button } from "@/components/ui/button";
import { api, type WorkflowInput, type ConfigResponse, API_PROVIDERS, recentUsage, type RunSummary, getFavWorkflows, setFavWorkflows, getMediaDefaults, mediaDefaultFor, setMediaDefaults, type CommunityTemplate, type Workflow } from "@/lib/studio";
import { track } from "@/lib/track";
import { cn } from "@/lib/utils";
import { RoleAvatar } from "./RoleAvatar";
import type { RunRequest } from "./RunManager";
import { CompareOverlay } from "./CompareOverlay";
import { BaselineCompareOverlay } from "./BaselineCompareOverlay";
import { WorkflowCanvas } from "./WorkflowCanvas";

function CastStack({ steps }: { steps: NonNullable<Workflow["steps"]> }) {
  const shown = steps.slice(0, 6);
  const extra = steps.length - shown.length;
  return (
    <div className="flex items-center">
      <div className="flex -space-x-2">
        {shown.map((s, i) => (
          <RoleAvatar
            key={s.id}
            seed={s.role || s.id}
            name={s.name ?? s.id}
            title={s.name ?? s.id}
            className="size-8 ring-2 ring-card"
            style={{ zIndex: shown.length - i }}
          />
        ))}
      </div>
      {extra > 0 && <span className="ml-2 text-xs text-muted-foreground">+{extra}</span>}
    </div>
  );
}

function InputsDialog({ wf, provider, onClose, onRun, onCompare }: { wf: Workflow; provider: string; onClose: () => void; onRun: (r: RunRequest) => void; onCompare: (inputs: Record<string, string>) => void }) {
  const { t, lang } = useLanguage();
  const inputs = wf.inputs ?? [];
  // 下拉候选的动态源：供应商/档位表来自 /api/config；模型列表按供应商实拉（视频供应商用内置表）
  const hasDynamic = inputs.some((i) => i.source || i.options);
  const [cfg, setCfg] = useState<ConfigResponse | null>(null);
  const [modelLists, setModelLists] = useState<Record<string, string[] | "loading" | "error">>({});
  useEffect(() => { if (hasDynamic) api.config().then(setCfg).catch(() => setCfg(null)); }, [hasDynamic]);
  // 选了候选之外的值 → 该输入切到手填模式
  const [custom, setCustom] = useState<Record<string, boolean>>({});
  const providerLabel = (id: string) => {
    const p = cfg?.providers[id];
    const known = (API_PROVIDERS.find((x) => x.id === id)?.shortName) || cfg?.customProviders?.find((c) => c.id === id)?.name || id;
    return p && !p.hasKey ? `${known} · ${t.studio.workflows.inputNoKey}` : known;
  };
  const optionsFor = (inp: WorkflowInput, vals: Record<string, string>): { value: string; label: string }[] | "loading" | null => {
    if (inp.options?.length) return inp.options.map((o) => ({ value: o, label: o }));
    if (!inp.source) return null;
    if (!cfg) return "loading";
    const keyedFirst = (ids: string[]) => [...ids.filter((id) => cfg.providers[id]?.hasKey), ...ids.filter((id) => !cfg.providers[id]?.hasKey)];
    if (inp.source === "styles") {
      const cat = { live: lang === "en" ? "Live action" : "真人", "3d": "3D", "2d": "2D" } as const;
      return (cfg.styles ?? []).map((s) => ({ value: s.name, label: `${cat[s.category]} · ${lang === "en" ? s.nameEn : s.name}` }));
    }
    if (inp.source === "image_providers") return keyedFirst(cfg.imageProviders ?? []).map((id) => ({ value: id, label: providerLabel(id) }));
    if (inp.source === "video_providers") return (cfg.videoProviders ?? []).slice().sort((a, b) => Number(b.hasKey) - Number(a.hasKey)).map((v) => ({ value: v.id, label: v.hasKey ? v.id : `${v.id} · ${t.studio.workflows.inputNoKey}` }));
    const pid = (inp.source_from ? vals[inp.source_from] : "") || provider;
    const vp = cfg.videoProviders?.find((v) => v.id === pid);
    // 档位按已选模型（找同一 source_from 下 source=models 的那个输入的值）；没选模型用 provider 级并集
    const modelInput = inputs.find((i) => i.source === "models" && i.source_from === inp.source_from);
    const tier = modelInput ? vp?.tiers?.[vals[modelInput.name] ?? ""] : undefined;
    if (inp.source === "video_resolutions") return (tier?.resolutions ?? vp?.resolutions ?? []).map((r) => ({ value: r, label: r }));
    if (inp.source === "video_durations") return (tier?.durations ?? vp?.durations ?? []).map((d) => ({ value: String(d), label: `${d}s` }));
    if (inp.source === "models") {
      if (vp) return vp.models.map((m) => ({ value: m, label: m }));
      if (!pid) return [];
      const cached = modelLists[pid];
      if (cached === undefined || cached === "loading") return "loading";
      if (cached === "error") return [];
      return cached.map((m) => ({ value: m, label: m }));
    }
    return null;
  };
  // 媒体类输入（source 指向供应商/模型/档位）优先取顶栏「出图 / 出片」里选好的，其次才是模板默认值
  const media = getMediaDefaults();
  const isMediaInput = (i: WorkflowInput) => !!i.source;
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    inputs.forEach((i) => (init[i.name] = mediaDefaultFor(i, media) || i.default || ""));
    return init;
  });
  // 媒体输入放右栏面板（紧凑行）；运行时记为默认，下次自动预填
  const mediaInputs = inputs.filter(isMediaInput);
  // 需要实拉模型列表的供应商（按当前选择算出来），在 effect 里拉——渲染期不发请求、不 setState
  const neededModelProviders = inputs
    .filter((i) => i.source === "models")
    .map((i) => (i.source_from ? vals[i.source_from] : "") || provider)
    .filter((pid) => pid && !cfg?.videoProviders?.some((v) => v.id === pid));
  const neededKey = neededModelProviders.join("|");
  useEffect(() => {
    if (!cfg) return;
    for (const pid of neededKey.split("|").filter(Boolean)) {
      if (modelLists[pid] !== undefined) continue;
      setModelLists((p) => ({ ...p, [pid]: "loading" }));
      api.providerModels({ provider: pid })
        .then((r) => setModelLists((p) => ({ ...p, [pid]: r.ok && r.models?.length ? r.models : "error" })))
        .catch(() => setModelLists((p) => ({ ...p, [pid]: "error" })));
    }
  }, [cfg, neededKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [materialize, setMaterialize] = useState(false);
  // 从文件读入输入变量（#96）：浏览器端 FileReader 读文本填进值，不经服务器路径，
  // 与引擎的 AO_NO_AT_FILE 防护（禁止网页按路径读服务器文件）互不冲突。
  // 上限 200KB：值最终经 `-i k=v` 进程参数传给 CLI，留足 ARG_MAX 余量。
  const FILE_LIMIT = 200 * 1024;
  const [fileMeta, setFileMeta] = useState<Record<string, string>>({});
  const [fileErr, setFileErr] = useState<string | null>(null);
  const filePickFor = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pickFileFor = (name: string) => {
    filePickFor.current = name;
    fileInputRef.current?.click();
  };
  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    const name = filePickFor.current;
    if (!f || !name) return;
    if (f.size > FILE_LIMIT) {
      setFileErr(`${t.studio.workflows.inputFileTooLargePrefix}${f.name}（${Math.ceil(f.size / 1024)} KB）`);
      return;
    }
    const r = new FileReader();
    r.onload = () => {
      setVals((p) => ({ ...p, [name]: String(r.result ?? "") }));
      setFileMeta((p) => ({ ...p, [name]: `${f.name} · ${Math.max(1, Math.ceil(f.size / 1024))} KB` }));
      setFileErr(null);
    };
    r.onerror = () => setFileErr(`${t.studio.workflows.inputFileReadFailPrefix}${f.name}`);
    r.readAsText(f);
  };

  const rememberMedia = () => {
    if (!mediaInputs.length) return;
    const d = getMediaDefaults();
    for (const i of mediaInputs) {
      const v = vals[i.name] ?? "";
      if (i.source === "image_providers") d.image.provider = v;
      else if (i.source === "video_providers") d.video.provider = v;
      else if (i.source === "video_resolutions") d.video.resolution = v;
      else if (i.source === "video_durations") d.video.duration = v;
      else if (i.source === "models" && i.source_from?.startsWith("image")) d.image.model = v;
      else if (i.source === "models" && i.source_from?.startsWith("video")) d.video.model = v;
    }
    setMediaDefaults(d);
  };
  const submit = () => {
    rememberMedia();
    onRun({ kind: "workflow", title: wf.name, file: wf.file, inputs: vals, provider: provider || undefined, cast: wf.steps, materialize });
    onClose();
  };
  const compare = () => {
    onCompare(vals);
    onClose();
  };

  const isMedia = mediaInputs.length > 0;
  const hasMediaStep = !!wf.steps?.some((st) => st.type === "image" || st.type === "video");
  const m = t.studio.shell.media;
  // 一个输入 = 标签行 + 说明 + 控件。compact = 右栏「出图 / 出片」面板：标签与控件同行，说明进 title
  const field = (inp: WorkflowInput, compact: boolean) => {
    const opts = optionsFor(inp, vals);
    const cur = vals[inp.name] ?? "";
    const inList = opts !== null && opts !== "loading" && opts.some((o) => o.value === cur);
    const showSelect = opts !== null && !custom[inp.name] && (cur === "" || inList || opts === "loading");
    const title = inp.label || inp.name;
    const control = !showSelect ? (
      <textarea
        value={cur}
        onChange={(e) => setVals((p) => ({ ...p, [inp.name]: e.target.value }))}
        rows={compact ? 1 : 2}
        className={cn("w-full rounded-xl border border-border/70 bg-card/60 px-3 py-2 text-sm outline-none focus:border-primary/50", compact ? "h-9 resize-none py-1.5 text-xs" : "mt-1")}
      />
    ) : (
      <select
        value={inList ? cur : ""}
        disabled={opts === "loading"}
        onChange={(e) => {
          if (e.target.value === "__custom__") { setCustom((p) => ({ ...p, [inp.name]: true })); return; }
          setVals((p) => ({ ...p, [inp.name]: e.target.value }));
        }}
        className={cn("w-full rounded-xl border border-border/70 bg-card/60 px-3 text-sm outline-none focus:border-primary/50", compact ? "h-9 text-xs" : "mt-1 h-10")}
      >
        {opts === "loading" ? (
          <option value="">{t.studio.workflows.inputModelsLoading}</option>
        ) : (
          <>
            <option value="">{inp.required ? "—" : `— ${t.studio.workflows.inputFollowText}`}</option>
            {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            <option value="__custom__">{t.studio.workflows.inputCustom}</option>
          </>
        )}
      </select>
    );
    if (compact) return (
      <label key={inp.name} className="grid grid-cols-[76px_1fr] items-center gap-2" title={inp.description || ""}>
        <span className="truncate text-xs text-muted-foreground">{title}{inp.required && <span className="text-red-500">*</span>}</span>
        {control}
      </label>
    );
    return (
      <label key={inp.name} className="block">
        <span className="flex items-center justify-between text-sm font-medium">
          <span>{title}{inp.required && <span className="text-red-500"> *</span>}</span>
          {/* #96：识别技术文档类场景——把 .md/.txt/代码等文本文件内容一键填进输入；下拉项不需要 */}
          {!showSelect && (
            <Tip label={t.studio.workflows.inputFromFile}>
              <button type="button" onClick={() => pickFileFor(inp.name)} className="inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-xs font-normal text-muted-foreground transition-colors hover:text-primary">
                <Paperclip className="size-3.5" />
                {t.studio.workflows.inputFromFileShort}
              </button>
            </Tip>
          )}
        </span>
        {inp.description && <span className="block text-xs text-muted-foreground">{inp.description}</span>}
        {control}
        {fileMeta[inp.name] && <span className="mt-0.5 block text-[11px] text-muted-foreground">📎 {fileMeta[inp.name]}</span>}
      </label>
    );
  };
  const contentInputs = inputs.filter((i) => !isMediaInput(i));

  return (
    <div className="fixed inset-0 z-[55] grid place-items-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      {/* 有出图/出片设置时放宽成两栏：左=内容，右=媒体设置；正文可滚动，按钮固定在底部 */}
      <div className={cn("flex max-h-[88vh] w-full flex-col rounded-2xl border border-border/70 bg-background shadow-2xl", isMedia ? "max-w-4xl" : "max-w-lg")} onClick={(e) => e.stopPropagation()}>
        <div className="px-5 pt-5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{wf.name}</h3>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
          </div>
          {wf.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{wf.description}</p>}
        </div>
        <div className={cn("min-h-0 flex-1 overflow-auto px-5 py-4", isMedia && "grid gap-5 md:grid-cols-[1fr_300px]")}>
          <div className="space-y-3">
            {contentInputs.map((inp) => field(inp, false))}
            {fileErr && <p className="text-xs text-red-500">{fileErr}</p>}
            <input ref={fileInputRef} type="file" accept=".md,.txt,.markdown,.json,.yaml,.yml,.csv,.log,.html,.css,.js,.ts,.tsx,.py,.java,.go,.rs,.sh,.xml,.toml,.ini,text/*" hidden onChange={onFilePicked} />
            {!inputs.length && <p className="text-sm text-muted-foreground">{t.studio.workflows.noInputsNeeded}</p>}
            {!hasMediaStep && (
              <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-xl border border-border/70 bg-card/40 p-3">
                <input type="checkbox" checked={materialize} onChange={(e) => setMaterialize(e.target.checked)} className="mt-0.5" />
                <span className="text-sm">
                  <span className="font-medium">{lang === "en" ? "Develop project (write code to files)" : "开发项目（把生成的代码写成真实文件）"}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {lang === "en" ? "If the workflow produces code, save it as a runnable scaffold on disk. The run log shows where." : "若工作流会产出代码，跑完落盘成可运行脚手架到本地；运行日志里显示路径。"}
                  </span>
                </span>
              </label>
            )}
          </div>
          {isMedia && (
            <aside className="h-fit space-y-2 rounded-2xl border border-border/60 bg-card/40 p-3">
              <p className="text-xs font-semibold">🎨🎬 {m.title}</p>
              <p className="text-[11px] leading-relaxed text-muted-foreground">{m.panelHint}</p>
              {mediaInputs.some((i) => i.source === "image_providers" || (i.source === "models" && i.source_from?.startsWith("image"))) && (
                <p className="pt-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">🎨 {m.image}</p>
              )}
              {mediaInputs.filter((i) => i.source === "image_providers" || (i.source === "models" && i.source_from?.startsWith("image"))).map((i) => field(i, true))}
              {mediaInputs.some((i) => i.source?.startsWith("video") || (i.source === "models" && i.source_from?.startsWith("video"))) && (
                <p className="pt-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">🎬 {m.video}</p>
              )}
              {mediaInputs.filter((i) => i.source?.startsWith("video") || (i.source === "models" && i.source_from?.startsWith("video"))).map((i) => field(i, true))}
            </aside>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border/60 px-5 py-3">
          <Button variant="ghost" onClick={onClose}>{t.studio.workflows.cancel}</Button>
          <Button variant="outline" onClick={compare} title={lang === "en" ? "Run the workflow and a single-shot baseline, then blind-judge both" : "跑工作流 + 单次基线并盲评对比"}>
            <Scale className="size-4" />
            {lang === "en" ? "vs Single-shot" : "对比单次"}
          </Button>
          <Button onClick={submit}>
            <Play className="size-4" />
            {t.studio.workflows.run}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function WorkflowsPanel({ provider, onRun, demo, onInstallPrompt, filter }: { provider: string; onRun: (r: RunRequest) => void; demo?: boolean; onInstallPrompt?: () => void; /** 只展示满足条件的模板（「创意出片」用）；设了就不再显示社区模板区 */ filter?: (w: Workflow) => boolean }) {
  const { t, lang } = useLanguage();
  const [wfs, setWfs] = useState<Workflow[]>([]);
  // 最近 30 天运行记录——「最近运行」区按工作流文件聚合（用户隐式的"常用"，排在显式 ☆ 之后）
  const [runs, setRuns] = useState<RunSummary[]>([]);
  useEffect(() => { if (!demo) api.runs().then(setRuns).catch(() => setRuns([])); }, [demo]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Record<string, Workflow>>({});
  const [inputsFor, setInputsFor] = useState<Workflow | null>(null);
  const [compare, setCompare] = useState<Workflow[] | null>(null);
  const [baseline, setBaseline] = useState<{ wf: Workflow; inputs: Record<string, string> } | null>(null);
  const [canvasFor, setCanvasFor] = useState<Workflow | null>(null);
  // 社区模板（远程清单收录制）：非 demo 时拉取；空列表整节隐藏
  const [community, setCommunity] = useState<CommunityTemplate[]>([]);
  const [importing, setImporting] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [confirmImport, setConfirmImport] = useState<CommunityTemplate | null>(null);
  // 删除确认框（应用内，替代 window.confirm）
  const [confirmDel, setConfirmDel] = useState<Workflow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);
  // 用户自选「常用」：点星收藏（localStorage）。首次无记录时用编辑推荐(featured)做种子。
  const [favs, setFavs] = useState<Set<string>>(() => getFavWorkflows() ?? new Set());
  const seededRef = useRef(false);
  // ?wf=<文件名> 深链：从创意库等入口直接带着模板进来，列表加载完就把运行对话框打开。
  // 只认一次（deepLinkRef），否则用户关掉对话框后每次列表刷新都会被强行弹回来。
  const deepLinkRef = useRef(false);
  const toggleFav = (w: Workflow) =>
    setFavs((prev) => {
      const n = new Set(prev);
      if (n.has(w.file)) n.delete(w.file); else n.add(w.file);
      setFavWorkflows(n);
      return n;
    });

  useEffect(() => {
    setLoading(true);
    if (demo) {
      // 演示模式：用内置模板的静态快照，可浏览、看步骤，但运行时引导安装
      import("@/lib/demo")
        .then((m) => m.demoWorkflows(lang))
        .then(setWfs)
        .catch(() => setWfs([]))
        .finally(() => setLoading(false));
      return;
    }
    api
      .workflows(lang)
      .then(setWfs)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [lang, demo]);

  // ?wf=<文件名> 深链：列表到位后把那条模板的运行对话框直接打开。
  // 找不到就退而求其次填进搜索框——总比把人扔在 30 个模板里自己翻强。
  useEffect(() => {
    if (deepLinkRef.current || wfs.length === 0) return;
    const want = new URLSearchParams(window.location.search).get("wf");
    if (!want) { deepLinkRef.current = true; return; }
    deepLinkRef.current = true;
    const hit = wfs.find((w) => w.filename === want || w.filename === `${want}.yaml` || w.name === want);
    if (hit) setInputsFor(hit); else setQ(want.replace(/\.yaml$/, ""));
  }, [wfs]);

  // 首次（localStorage 无收藏记录）用编辑推荐做种子，让新用户也有「常用」默认值。
  useEffect(() => {
    if (seededRef.current || wfs.length === 0) return;
    seededRef.current = true;
    if (getFavWorkflows() === null) {
      const seed = new Set(wfs.filter((w) => w.featured).map((w) => w.file));
      if (seed.size > 0) { setFavWorkflows(seed); setFavs(seed); }
    }
  }, [wfs]);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return wfs.filter((w) => (!filter || filter(w)) && (!n || (w.name + (w.description ?? "")).toLowerCase().includes(n)));
  }, [wfs, q, filter]);

  // 分组：「我的工作流」最顶（用户自己组/存的是核心资产，按最近修改倒序，#92），
  // 其次 ⭐ 常用，再按类目（一人公司系列置顶 → 开发 → 内容 → 商业 → 职场 → 其他）。
  const CATEGORY_ORDER = ["一人公司", "开发", "内容创作", "商业 / 产品", "职场 / 学术", "其他"];
  const groups = useMemo(() => {
    // 我的工作流排序：☆ 置顶优先（点星即钉住，代替拖拽排序——网格里拖拽换行难用，
    // 且手动顺序和"最近修改"信号打架），其余按最近修改倒序。
    const mine = filtered
      .filter((w) => w.private)
      .sort((a, b) => (favs.has(b.file) ? 1 : 0) - (favs.has(a.file) ? 1 : 0) || (b.mtime ?? 0) - (a.mtime ?? 0));
    const fav = filtered.filter((w) => favs.has(w.file) && !w.private);
    const byCat = new Map<string, Workflow[]>();
    for (const w of filtered) {
      if (w.private) continue; // 我的工作流只在顶部分区出现，不再混入类目
      // 收藏的也仍按类目展示一份，方便浏览；顶部「常用」组只是把它们额外置顶。
      const c = w.category || "其他";
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c)!.push(w);
    }
    const cats = [...byCat.keys()].sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a), ib = CATEGORY_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    // 最近运行：按次数倒序取前 6（搜索时不显示——搜索结果本身就是用户要的）
    const byFile = new Map(filtered.map((w) => [w.file, w] as const));
    const recent = q.trim() ? [] : recentUsage(runs, (r) => (r.file ? [r.file] : undefined)).map(([f]) => byFile.get(f)).filter((w): w is Workflow => !!w).slice(0, 6);
    return { mine, fav, recent, cats: cats.map((c) => [c, byCat.get(c)!] as [string, Workflow[]]) };
  }, [filtered, favs, runs, q]);

  useEffect(() => {
    if (demo) return;
    api.communityTemplates().then(setCommunity).catch(() => setCommunity([]));
  }, [demo]);

  const importCommunity = (c: CommunityTemplate) => {
    if (demo) return onInstallPrompt?.();
    setConfirmImport(c); // 应用内确认（本文件约定：不用 window.confirm，桌面端带 127.0.0.1 抬头观感差）
  };

  const doImportCommunity = async () => {
    const c = confirmImport;
    if (!c) return;
    setConfirmImport(null);
    setImporting(c.url);
    setImportMsg(null);
    try {
      const r = await api.communityImport(c.url);
      setImportMsg(lang === "en" ? `Imported "${r.name}" (${r.steps} steps) — see My Workflows.` : `已导入「${r.name}」（${r.steps} 步）——在「我的工作流」分区。`);
      api.workflows(lang).then(setWfs).catch(() => {});
    } catch (e) {
      setImportMsg((lang === "en" ? "Import failed: " : "导入失败：") + (e instanceof Error ? e.message : String(e)));
    } finally {
      setImporting(null);
    }
  };

  const pickedList = Object.values(picked);

  const togglePick = (w: Workflow) =>
    setPicked((p) => {
      const n = { ...p };
      if (n[w.file]) delete n[w.file];
      else n[w.file] = w;
      return n;
    });

  const runOne = (w: Workflow) => {
    if (demo) return onInstallPrompt?.();
    track("workflow_run", { file: w.filename });
    if (w.inputs && w.inputs.length) setInputsFor(w);
    else onRun({ kind: "workflow", title: w.name, file: w.file, provider: provider || undefined, cast: w.steps });
  };

  // 对比单次基线：需引擎，demo 引导安装；有输入先填，再开对比视图
  const compareOne = (w: Workflow) => {
    if (demo) return onInstallPrompt?.();
    track("compare_open", { from: "card" });
    if (w.inputs && w.inputs.length) setInputsFor(w); // 复用输入对话框（含「对比单次」按钮）
    else setBaseline({ wf: w, inputs: {} });
  };

  // 下载 YAML 原文（#98）：拿走即可在 CLI / Claude Code / 别的机器直接用
  const downloadOne = async (w: Workflow) => {
    if (demo) return onInstallPrompt?.();
    track("workflow_download", { file: w.filename });
    try {
      const text = await api.workflowYaml(w.file);
      const url = URL.createObjectURL(new Blob([text], { type: "text/yaml" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = w.filename || `${w.name}.yaml`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      window.alert((lang === "en" ? "Download failed: " : "下载失败：") + (e instanceof Error ? e.message : String(e)));
    }
  };

  // 删除用户工作流（#92）：仅 deletable（自动组队/画布保存的）；服务端再限一层目录。
  // 确认走应用内 ConfirmDialog（原生 window.confirm 带 "127.0.0.1 显示" 抬头，观感差）。
  const doDelete = async () => {
    const w = confirmDel;
    if (!w) return;
    setDeleting(true);
    setDelErr(null);
    track("workflow_delete", { file: w.filename });
    try {
      // 文件已被外部删掉（手动清理等）→ 视为删除成功：用户要的是"让它消失"，幂等处理
      await api.deleteWorkflow(w.file).catch((e) => {
        if (!/not found/i.test(e instanceof Error ? e.message : String(e))) throw e;
      });
      setWfs((p) => p.filter((x) => x.file !== w.file));
      setPicked((p) => {
        if (!p[w.file]) return p;
        const n = { ...p };
        delete n[w.file];
        return n;
      });
      setFavs((prev) => {
        if (!prev.has(w.file)) return prev;
        const n = new Set(prev);
        n.delete(w.file);
        setFavWorkflows(n);
        return n;
      });
      setConfirmDel(null);
    } catch (e) {
      setDelErr((lang === "en" ? "Delete failed: " : "删除失败：") + (e instanceof Error ? e.message : String(e)));
    } finally {
      setDeleting(false);
    }
  };

  if (loading)
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> {t.studio.workflows.loading}
      </div>
    );
  if (err) return <p className="py-20 text-center text-sm text-red-500">{`${t.studio.workflows.loadFailed}${err}`}</p>;

  return (
    <div className="pb-28">
      <div className={cn("relative max-w-md", filter && "hidden")}>
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t.studio.workflows.searchPlaceholder}
          className="h-10 w-full rounded-xl border border-border/70 bg-card/60 pl-9 pr-3 text-sm outline-none focus:border-primary/50"
        />
      </div>

      {(() => {
        const renderCard = (w: Workflow) => {
          const on = !!picked[w.file];
          return (
            <div
              key={w.file}
              className={cn(
                "flex flex-col rounded-2xl border bg-card/60 p-4 transition-colors",
                on ? "border-primary ring-1 ring-primary/40" : "border-border/70",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="flex items-center gap-1.5 font-semibold leading-snug">
                  <Tip
                    label={
                      w.private
                        ? favs.has(w.file) ? (lang === "en" ? "Unpin" : "取消常用（不再置顶）") : (lang === "en" ? "Pin to top" : "设为常用（置顶）")
                        : favs.has(w.file) ? (lang === "en" ? "Unpin" : "取消常用") : (lang === "en" ? "Pin" : "设为常用")
                    }
                  >
                    <button
                      onClick={() => toggleFav(w)}
                      className="shrink-0 text-muted-foreground/50 transition-colors hover:text-amber-400"
                    >
                      <Star className={cn("size-3.5", favs.has(w.file) && "fill-amber-400 text-amber-400")} />
                    </button>
                  </Tip>
                  {w.name}
                </h3>
                <Tip label={t.studio.workflows.checkToCompare}>
                  <button
                    onClick={() => togglePick(w)}
                    className={cn(
                      "grid size-5 shrink-0 place-items-center rounded-md border transition-colors",
                      on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background",
                    )}
                  >
                    {on && <Check className="size-3.5" />}
                  </button>
                </Tip>
              </div>
              {(() => {
                const kinds = new Set((w.steps ?? []).map((s) => s.type).filter((x): x is string => x === "image" || x === "video"));
                return kinds.size > 0 ? (
                  <div className="mt-1.5 flex gap-1">
                    {kinds.has("image") && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">🎨 {t.studio.shell.media.image} · PNG</span>}
                    {kinds.has("video") && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">🎬 {t.studio.shell.media.video} · MP4</span>}
                  </div>
                ) : null;
              })()}
              {w.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{w.description}</p>}
              {!!(w.steps && w.steps.length) && (
                <div className="mt-3">
                  <CastStack steps={w.steps} />
                </div>
              )}
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {/* 私有工作流已独立成「我的工作流」分区，卡片上不再重复 "· 我的" 后缀 */}
                  {`${w.steps?.length ?? 0} ${t.studio.workflows.steps}`}
                </span>
                <div className="flex items-center gap-1.5">
                  <Tip label={lang === "en" ? "View as canvas" : "画布视图（可视化编辑）"}>
                    <Button size="sm" variant="ghost" onClick={() => (demo ? onInstallPrompt?.() : setCanvasFor(w))}>
                      <WorkflowIcon className="size-3.5" />
                    </Button>
                  </Tip>
                  <Tip label={lang === "en" ? "Compare vs single-shot baseline" : "对比单次基线（多智能体强在哪）"}>
                    <Button size="sm" variant="ghost" onClick={() => compareOne(w)}>
                      <Scale className="size-3.5" />
                    </Button>
                  </Tip>
                  <Tip label={lang === "en" ? "Download YAML" : "下载 YAML（CLI / 其他机器可用）"}>
                    <Button size="sm" variant="ghost" onClick={() => downloadOne(w)}>
                      <Download className="size-3.5" />
                    </Button>
                  </Tip>
                  {w.deletable && !demo && (
                    <Tip label={lang === "en" ? "Delete this workflow" : "删除此工作流"}>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { setDelErr(null); setConfirmDel(w); }}
                        className="text-muted-foreground hover:text-red-500"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </Tip>
                  )}
                  <Tip label={lang === "en" ? "Run this workflow" : "运行此工作流"}>
                    <Button size="sm" onClick={() => runOne(w)}>
                      <Play className="size-3.5" />
                      {t.studio.workflows.run}
                    </Button>
                  </Tip>
                </div>
              </div>
            </div>
          );
        };
        const Section = ({ title, items, star, hint }: { title: string; items: Workflow[]; star?: boolean; hint?: string }) => (
          <section className="mt-6">
            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-muted-foreground">
              {star && <Star className="size-3.5 fill-amber-400 text-amber-400" />}
              {title}
              <span className="font-normal text-muted-foreground/60">· {items.length}</span>
              {hint && <span className="ml-1 truncate font-normal text-xs text-muted-foreground/60">{hint}</span>}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{items.map(renderCard)}</div>
          </section>
        );
        // 「创意出片」等筛选视图：条目少，不分组、不分类，直接平铺
        if (filter) return <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{filtered.map(renderCard)}</div>;
        return (
          <>
            {groups.mine.length > 0 && (
              <Section
                title={lang === "en" ? "My Workflows" : "我的工作流"}
                items={groups.mine}
                hint={lang === "en" ? "yours — composed or saved from canvas; ☆ pins to top, otherwise newest first" : "自动组队 / 画布保存的都在这；点 ☆ 设为常用即置顶，其余按最近修改排序"}
              />
            )}
            {groups.fav.length > 0 && <Section title={lang === "en" ? "Favorites" : "常用（点 ☆ 设为常用）"} items={groups.fav} star />}
            {groups.recent.length > 0 && <Section title={lang === "en" ? "Recently run" : "最近运行"} items={groups.recent} hint={lang === "en" ? "most-run in the last 30 days, from local run history" : "近 30 天跑得最多的，来自本机运行历史"} />}
            {groups.cats.map(([c, items]) => <Section key={c} title={c} items={items} />)}
            {!demo && !filter && community.length > 0 && (
              <section className="mt-8">
                <h2 className="mb-3 flex items-baseline gap-2 text-sm font-bold">
                  {lang === "en" ? "Community Templates" : "社区模板"}
                  <span className="font-normal text-muted-foreground/60">· {community.length}</span>
                  <span className="ml-1 truncate font-normal text-xs text-muted-foreground/60">
                    {lang === "en" ? "curated via the remote manifest; validated on import" : "远程清单收录制；导入前经引擎校验"}
                  </span>
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {community.map((c) => (
                    <div key={c.url} className="flex flex-col rounded-2xl border border-dashed border-border/70 bg-card/40 p-4">
                      <h3 className="font-semibold leading-snug">{c.name}</h3>
                      {c.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{c.description}</p>}
                      <div className="mt-3 flex items-center justify-between">
                        <span className="truncate text-xs text-muted-foreground">{c.author ? `by ${c.author}` : c.category ?? ""}</span>
                        <Button size="sm" variant="outline" disabled={importing === c.url} onClick={() => importCommunity(c)}>
                          {importing === c.url ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                          {lang === "en" ? "Import" : "导入"}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                {importMsg && <p className="mt-2 text-xs text-muted-foreground">{importMsg}</p>}
              </section>
            )}
            {filtered.length === 0 && <p className="mt-10 text-center text-sm text-muted-foreground">{lang === "en" ? "No matching workflows" : "没有匹配的工作流"}</p>}
          </>
        );
      })()}

      {pickedList.length >= 2 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/95 backdrop-blur-xl">
          <div className="container-page flex items-center justify-between gap-3 py-4">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-sm font-semibold text-primary">
              <GitCompare className="size-4" />
              {`${t.studio.workflows.checkedPrefix}${pickedList.length}${t.studio.workflows.checkedSuffix}`}
            </span>
            <div className="flex items-center gap-2">
              <button onClick={() => setPicked({})} className="text-xs text-muted-foreground hover:text-foreground">
                {t.studio.workflows.clear}
              </button>
              <Button onClick={() => (demo ? onInstallPrompt?.() : setCompare(pickedList))}>
                <GitCompare className="size-4" />
                {t.studio.workflows.compareRun}
              </Button>
            </div>
          </div>
        </div>
      )}

      {inputsFor && (
        <InputsDialog
          wf={inputsFor}
          provider={provider}
          onClose={() => setInputsFor(null)}
          onRun={onRun}
          onCompare={(inputs) => setBaseline({ wf: inputsFor, inputs })}
        />
      )}
      {confirmDel && (
        <ConfirmDialog
          danger
          title={lang === "en" ? "Delete workflow" : "删除工作流"}
          body={
            lang === "en"
              ? `Delete "${confirmDel.name}"? The YAML file will be removed from disk. This cannot be undone.`
              : `确定删除「${confirmDel.name}」？其 YAML 文件将从磁盘移除，此操作不可恢复。`
          }
          confirmLabel={lang === "en" ? "Delete" : "删除"}
          cancelLabel={lang === "en" ? "Cancel" : "取消"}
          busy={deleting}
          error={delErr}
          onConfirm={doDelete}
          onClose={() => { setConfirmDel(null); setDelErr(null); }}
        />
      )}
      {confirmImport && (
        <ConfirmDialog
          title={lang === "en" ? "Import community template" : "导入社区模板"}
          body={
            lang === "en"
              ? `Import "${confirmImport.name}" into My Workflows? It will be validated by the engine before saving.`
              : `把「${confirmImport.name}」导入到我的工作流？保存前会先经引擎校验。`
          }
          confirmLabel={lang === "en" ? "Import" : "导入"}
          cancelLabel={lang === "en" ? "Cancel" : "取消"}
          onConfirm={doImportCommunity}
          onClose={() => setConfirmImport(null)}
        />
      )}
      {compare && <CompareOverlay workflows={compare} provider={provider} onClose={() => setCompare(null)} />}
      {baseline && <BaselineCompareOverlay wf={baseline.wf} inputs={baseline.inputs} provider={provider} onClose={() => setBaseline(null)} />}
      {canvasFor && (
        <WorkflowCanvas
          file={canvasFor.file}
          name={canvasFor.name}
          onClose={() => setCanvasFor(null)}
          onSaved={() => { if (!demo) api.workflows(lang).then(setWfs).catch(() => {}); }}
        />
      )}
    </div>
  );
}
