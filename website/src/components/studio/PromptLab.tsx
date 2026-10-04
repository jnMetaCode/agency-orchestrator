import { Bookmark, Check, Copy, FlaskConical, Loader2, Scale, Sparkles, Sprout, Star, Trash2, UserPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/i18n/LanguageProvider";
import { API_PROVIDER_MAP, api, type GardenSeed, type PromptMode, type PromptRecord, type ScoreResult } from "@/lib/studio";
import { cn } from "@/lib/utils";

const STR = {
  zh: {
    title: "提示生成", sub: "一句想法生成可用提示词——可测试 · 可对比 · 可沉淀的资产",
    modeUser: "任务提示词", modeSystem: "角色/系统提示词",
    rawPlaceholder: "粘贴你的原始提示词或一句想法…（例如：帮我写个朋友圈文案卖咖啡）",
    optimize: "一键生成", optimizing: "生成中…",
    garden: "从模板起手", original: "原始", optimized: "生成版", copy: "复制", copied: "已复制",
    adopt: "采纳生成版", testTitle: "实测对比", testPlaceholder: "样例输入（system 模式下作为用户消息；user 模式可留空）",
    runTest: "测试两版", testing: "测试中…", scoreBtn: "AI 评分对比", scoring: "评分中…",
    best: "胜出", saveName: "给这条提示词起个名字", save: "保存", saving: "保存中…", saved: "已保存",
    saveNeedName: "请先起个名字", saveNeedOpt: "先生成或填写内容再保存",
    myPrompts: "我的提示词", empty: "还没有保存的提示词", versions: "版", delete: "删除", load: "载入",
    needRaw: "请先输入原始提示词", fav: "收藏",
    saveAsRole: "存为我的角色", roleNamePh: "角色名称，如：朋友圈文案专家", roleSaving: "保存中…",
    roleSaved: "已存为角色——在「角色组队 → 我的」里就能用它组队", roleSaveFailed: "存为角色失败",
    execution: "执行配置", provider: "服务商", model: "文本模型",
    mediaFallback: "已检测到图片/视频模型，提示词生成将自动使用上方文本模型。",
  },
  en: {
    title: "Prompt Generator", sub: "Turn a rough idea into a working prompt — test · compare · save as an asset",
    modeUser: "Task prompt", modeSystem: "Role/system prompt",
    rawPlaceholder: "Paste your raw prompt or a rough idea… (e.g. write a tweet selling coffee)",
    optimize: "Generate", optimizing: "Generating…",
    garden: "Start from a template", original: "Original", optimized: "Generated", copy: "Copy", copied: "Copied",
    adopt: "Adopt generated", testTitle: "Test & compare", testPlaceholder: "Sample input (used as user message in system mode; optional in user mode)",
    runTest: "Test both", testing: "Testing…", scoreBtn: "AI score", scoring: "Scoring…",
    best: "winner", saveName: "Name this prompt", save: "Save", saving: "Saving…", saved: "Saved",
    saveNeedName: "Name it first", saveNeedOpt: "Generate or write content first",
    myPrompts: "My Prompts", empty: "No saved prompts yet", versions: "ver", delete: "Delete", load: "Load",
    needRaw: "Enter a raw prompt first", fav: "Favorite",
    saveAsRole: "Save as my role", roleNamePh: "Role name, e.g. Tweet copywriter", roleSaving: "Saving…",
    roleSaved: "Saved as a role — use it under Build a Team → My Roles", roleSaveFailed: "Failed to save as role",
    execution: "Execution", provider: "Provider", model: "Text model",
    mediaFallback: "An image/video model was configured; prompt generation will automatically use the text model shown above.",
  },
};

function slug(name: string) {
  return name.trim().replace(/[\s/\\:*?"<>|]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "prompt";
}

export function PromptLab({ provider, demo, onInstallPrompt, hideHeader, configRevision = 0 }: { provider: string; demo?: boolean; onInstallPrompt?: () => void; hideHeader?: boolean; configRevision?: number }) {
  const { lang } = useLanguage();
  const L = STR[lang === "en" ? "en" : "zh"];

  const [mode, setMode] = useState<PromptMode>("user");
  // 演示站(免费额度走 CF Function 代理 Agnes)可选文本模型；本地用配好的 provider，不显示。
  const DEMO_MODELS = ["agnes-2.0-flash", "agnes-1.5-flash"];
  const [model, setModel] = useState(DEMO_MODELS[0]);
  const [raw, setRaw] = useState("");
  const [optimized, setOptimized] = useState<string | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [testInput, setTestInput] = useState("");
  const [outs, setOuts] = useState<{ original?: string; optimized?: string }>({});
  const [testing, setTesting] = useState(false);
  const [score, setScore] = useState<ScoreResult | null>(null);
  const [scoring, setScoring] = useState(false);

  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // system 模式的生成结果本质是一段角色 system prompt——可一键存进 ~/.ao/roles，
  // 出现在「角色组队 → 我的」里直接组队（提示生成 → 角色 的闭环）。
  const [roleName, setRoleName] = useState("");
  const [savingRole, setSavingRole] = useState(false);
  const [roleMsg, setRoleMsg] = useState<string | null>(null);
  const [prompts, setPrompts] = useState<PromptRecord[]>([]);
  const [garden, setGarden] = useState<GardenSeed[]>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showGarden, setShowGarden] = useState(false);
  const [execution, setExecution] = useState<{ provider: string; model: string; fallbackFrom?: string } | null>(null);

  const refresh = () => { if (!demo) api.prompts().then(setPrompts).catch(() => setPrompts([])); };
  useEffect(refresh, [demo]);
  useEffect(() => { api.promptGarden().then(setGarden).catch(() => setGarden([])); }, []);
  useEffect(() => {
    if (demo) { setExecution(null); return; }
    let alive = true;
    api.config().then((cfg) => {
      if (!alive) return;
      const status = cfg.providers[provider];
      const remote = cfg.remoteProviders?.find((item) => item.id === provider);
      const custom = cfg.customProviders?.find((item) => item.id === provider);
      setExecution({
        provider: API_PROVIDER_MAP[provider]?.shortName || API_PROVIDER_MAP[provider]?.name || remote?.name || custom?.name || provider,
        model: status?.effectiveModel || status?.model || (lang === "en" ? "Engine default" : "引擎默认"),
        fallbackFrom: status?.textFallbackFrom,
      });
    }).catch(() => { if (alive) setExecution(null); });
    return () => { alive = false; };
  }, [demo, provider, lang, configRevision]);

  const gardenForMode = useMemo(
    () => garden.filter((s) => s.mode === mode && (s.lang === (lang === "en" ? "en" : "zh"))),
    [garden, mode, lang],
  );

  const copy = (key: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => { setCopiedKey(key); setTimeout(() => setCopiedKey(null), 1200); });
  };

  // 优化是「单次 LLM 调用」——演示站也能用（CF Pages Function 代理免费额度）。
  // 端点不存在 / 没配额度时再引导安装。
  const doOptimize = async () => {
    if (!raw.trim()) { setErr(L.needRaw); return; }
    setOptimizing(true); setErr(null); setScore(null); setOuts({});
    try {
      const { optimized: opt } = await api.optimizePrompt({ rawPrompt: raw.trim(), mode, provider, lang, model: demo ? model : undefined });
      setOptimized(opt);
    } catch (e: any) {
      if (demo) onInstallPrompt?.();
      else setErr(e?.message || "optimize failed");
    } finally { setOptimizing(false); }
  };

  const doTest = async () => {
    setTesting(true); setErr(null); setScore(null);
    try {
      const targets: [keyof typeof outs, string][] = [["original", raw.trim()]];
      if (optimized) targets.push(["optimized", optimized]);
      const results = await Promise.all(
        targets.map(([, p]) => api.testPrompt({ prompt: p, mode, testInput: testInput.trim(), provider, model: demo ? model : undefined })),
      );
      const next: typeof outs = {};
      targets.forEach(([k], i) => { next[k] = results[i].output; });
      setOuts(next);
    } catch (e: any) {
      if (demo) onInstallPrompt?.();
      else setErr(e?.message || "test failed");
    } finally { setTesting(false); }
  };

  const doScore = async () => {
    if (demo) return onInstallPrompt?.();  // 多结果评分较重，演示站引导安装
    if (!outs.original || !outs.optimized) return;
    setScoring(true); setErr(null);
    try {
      const r = await api.scorePrompts({
        testInput: testInput.trim(),
        candidates: [{ label: L.original, output: outs.original }, { label: L.optimized, output: outs.optimized }],
        provider, lang,
      });
      setScore(r);
    } catch (e: any) { setErr(e?.message || "score failed"); }
    finally { setScoring(false); }
  };

  const doSave = async () => {
    if (demo) return onInstallPrompt?.();
    if (!name.trim()) { setMsg(L.saveNeedName); return; }
    if (!raw.trim() && !optimized) { setMsg(L.saveNeedOpt); return; }
    setSaving(true); setMsg(null);
    try {
      const now = new Date().toISOString();
      const versions = [];
      if (raw.trim()) versions.push({ content: raw.trim(), source: "original" as const, created: now });
      if (optimized) versions.push({ content: optimized, source: "optimize" as const, created: now, note: lang === "en" ? "optimized" : "一键优化" });
      await api.savePrompt({ name: name.trim(), mode, versions });
      setMsg(`✅ ${L.saved}`); refresh();
    } catch (e: any) { setMsg(e?.message || "save failed"); }
    finally { setSaving(false); }
  };

  const doSaveAsRole = async () => {
    if (demo) return onInstallPrompt?.();
    if (!optimized || !roleName.trim()) return;
    setSavingRole(true); setRoleMsg(null);
    try {
      // 描述用原始想法（组队 LLM 靠它了解角色定位），截断防超长
      const desc = raw.trim().split("\n")[0].slice(0, 100);
      await api.createMyRole({ name: roleName.trim(), description: desc, systemPrompt: optimized });
      setRoleMsg(`✅ ${L.roleSaved}`);
      setRoleName("");
    } catch (e: any) { setRoleMsg(e?.message || L.roleSaveFailed); }
    finally { setSavingRole(false); }
  };

  const loadRecord = (r: PromptRecord) => {
    setMode(r.mode);
    setName(r.name);
    setRaw(r.versions[0]?.content ?? "");
    setOptimized(r.versions.length > 1 ? r.versions[r.versions.length - 1].content : null);
    setOuts({}); setScore(null); setErr(null);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const del = async (r: PromptRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    try { await api.deletePrompt(slug(r.name)); refresh(); } catch { /* ignore */ }
  };

  const Pane = ({ k, label, text }: { k: string; label: string; text?: string }) => (
    <div className="flex min-w-0 flex-1 flex-col rounded-xl border border-border/70 bg-card/50">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5">
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
        {text && (
          <button onClick={() => copy(k, text)} className="text-muted-foreground hover:text-foreground" title={L.copy}>
            {copiedKey === k ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
          </button>
        )}
      </div>
      <pre className="max-h-72 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 text-xs leading-relaxed">{text || ""}</pre>
    </div>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
      <div className="min-w-0">
        {/* 独立「提示词优化」页(PromptStudio)已有页头时隐藏,避免标题重复 */}
        {!hideHeader && (
          <div className="mb-4">
            <h2 className="flex items-center gap-2 text-lg font-bold"><Sparkles className="size-5 text-primary" />{L.title}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{L.sub}</p>
          </div>
        )}

        {/* mode + garden */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg bg-muted/60 p-0.5">
            {(["user", "system"] as PromptMode[]).map((m) => (
              <button key={m} onClick={() => setMode(m)}
                className={cn("rounded-md px-3 py-1 text-xs font-medium transition-colors", mode === m ? "bg-background text-primary shadow-sm" : "text-muted-foreground")}>
                {m === "user" ? L.modeUser : L.modeSystem}
              </button>
            ))}
          </div>
          {/* 演示站可选模型（免费额度走 Agnes）；本地用配好的 provider，不显示 */}
          {demo && (
            <div className="inline-flex rounded-lg bg-muted/60 p-0.5">
              {DEMO_MODELS.map((m) => (
                <button key={m} onClick={() => setModel(m)} title={m}
                  className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-colors", model === m ? "bg-background text-primary shadow-sm" : "text-muted-foreground")}>
                  {m.replace(/^agnes-/, "").replace(/-flash$/, "")}
                </button>
              ))}
            </div>
          )}
          <div className="relative">
            <Button size="sm" variant="ghost" onClick={() => setShowGarden((v) => !v)}><Sprout className="size-4" />{L.garden}</Button>
            {showGarden && gardenForMode.length > 0 && (
              <div className="absolute z-20 mt-1 w-72 rounded-xl border border-border/70 bg-popover p-1 shadow-xl">
                {gardenForMode.map((s) => (
                  <button key={s.id} onClick={() => { setRaw(s.content); setShowGarden(false); }}
                    className="block w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-muted">
                    <span className="font-medium">{s.name}</span>
                    <span className="ml-1 text-muted-foreground">· {s.tags.join(" / ")}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {!demo && execution && (
          <div className="mb-3 rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <strong>{L.execution}</strong>
              <span className="text-muted-foreground">{L.provider}：<span className="font-medium text-foreground">{execution.provider}</span></span>
              <span className="min-w-0 text-muted-foreground">{L.model}：<span className="break-all font-mono font-medium text-foreground">{execution.model}</span></span>
            </div>
            {execution.fallbackFrom && <p className="mt-1 text-amber-600 dark:text-amber-400">{L.mediaFallback}</p>}
          </div>
        )}

        <textarea value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={L.rawPlaceholder}
          className="h-32 w-full resize-y rounded-xl border border-border/70 bg-card/60 p-3 text-sm outline-none focus:border-primary/50" />

        <div className="mt-3 flex items-center gap-2">
          <Button onClick={doOptimize} disabled={optimizing || !raw.trim()}>
            {optimizing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}{optimizing ? L.optimizing : L.optimize}
          </Button>
        </div>
        {err && <p className="mt-2 text-xs text-red-500">{err}</p>}

        {/* before / after */}
        {optimized && (
          <div className="mt-4">
            <div className="flex flex-col gap-3 sm:flex-row">
              <Pane k="orig" label={L.original} text={raw} />
              <Pane k="opt" label={L.optimized} text={optimized} />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
              {/* system 模式：生成的就是角色 system prompt，起个名就能存进「角色组队 → 我的」 */}
              {mode === "system" && (
                <>
                  <input value={roleName} onChange={(e) => setRoleName(e.target.value)} placeholder={L.roleNamePh}
                    className="h-8 rounded-lg border border-border/70 bg-card/60 px-2.5 text-xs outline-none focus:border-primary/50 sm:w-52" />
                  <Button size="sm" variant="outline" onClick={doSaveAsRole} disabled={savingRole || !roleName.trim()}>
                    {savingRole ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
                    {savingRole ? L.roleSaving : L.saveAsRole}
                  </Button>
                </>
              )}
              <Button size="sm" variant="outline" onClick={() => { setRaw(optimized); setOptimized(null); setOuts({}); setScore(null); }}>
                <Check className="size-4" />{L.adopt}
              </Button>
            </div>
            {roleMsg && <p className="mt-1.5 text-right text-xs text-muted-foreground">{roleMsg}</p>}
          </div>
        )}

        {/* test & compare */}
        <div className="mt-6 rounded-xl border border-border/60 bg-muted/20 p-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><FlaskConical className="size-4 text-primary" />{L.testTitle}</h3>
          <textarea value={testInput} onChange={(e) => setTestInput(e.target.value)} placeholder={L.testPlaceholder}
            className="h-16 w-full resize-y rounded-lg border border-border/70 bg-card/60 p-2.5 text-sm outline-none focus:border-primary/50" />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={doTest} disabled={testing || !raw.trim()}>
              {testing ? <Loader2 className="size-4 animate-spin" /> : <FlaskConical className="size-4" />}{testing ? L.testing : L.runTest}
            </Button>
            {outs.original && outs.optimized && (
              <Button size="sm" variant="outline" onClick={doScore} disabled={scoring}>
                {scoring ? <Loader2 className="size-4 animate-spin" /> : <Scale className="size-4" />}{scoring ? L.scoring : L.scoreBtn}
              </Button>
            )}
          </div>
          {(outs.original || outs.optimized) && (
            <div className="mt-3 flex flex-col gap-3 sm:flex-row">
              <Pane k="to" label={L.original} text={outs.original} />
              {outs.optimized !== undefined && <Pane k="tp" label={L.optimized} text={outs.optimized} />}
            </div>
          )}
          {score && (
            <div className="mt-3 flex flex-wrap gap-2">
              {score.ranking.map((r) => (
                <span key={r.label} className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs",
                  score.best === r.label ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>
                  {score.best === r.label && <Star className="size-3 fill-current" />}
                  <b>{r.label}</b> {r.score}/10 · {r.reason}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* save */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={L.saveName}
            className="h-9 flex-1 rounded-lg border border-border/70 bg-card/60 px-3 text-sm outline-none focus:border-primary/50 sm:max-w-xs" />
          <Button size="sm" variant="outline" onClick={doSave} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Bookmark className="size-4" />}{saving ? L.saving : L.save}
          </Button>
          {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
        </div>
      </div>

      {/* my prompts */}
      <aside className="lg:border-l lg:border-border/60 lg:pl-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Bookmark className="size-4" />{L.myPrompts}</h3>
        {prompts.length === 0 ? (
          <p className="text-xs text-muted-foreground">{L.empty}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {prompts.map((r) => (
              <button key={r.name} onClick={() => loadRecord(r)}
                className="group flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-card/60 px-3 py-2 text-left text-xs transition-colors hover:border-primary/50">
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    {r.favorite && <Star className="size-3 fill-amber-400 text-amber-400" />}
                    <span className="truncate font-medium">{r.name}</span>
                  </span>
                  <span className="text-muted-foreground">[{r.mode === "system" ? L.modeSystem : L.modeUser}] · {r.versions.length} {L.versions}</span>
                </span>
                <span role="button" tabIndex={0} title={L.delete} onClick={(e) => del(r, e)}
                  className="shrink-0 text-muted-foreground/50 opacity-0 transition-all hover:text-red-500 group-hover:opacity-100">
                  <Trash2 className="size-3.5" />
                </span>
              </button>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
