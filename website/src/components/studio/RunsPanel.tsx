import { ArrowLeft, CheckCircle2, ChevronDown, Clock, Download, Loader2, Play, RotateCcw, Trash2, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CopyButton } from "@/components/ui/copy-button";
import { Tip } from "@/components/ui/tip";
import { api, type RunSummary } from "@/lib/studio";
import { downloadText, safeFilename } from "@/lib/download";
import { useLanguage } from "@/i18n/LanguageProvider";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown";
import type { RunRequest } from "./RunManager";

function DetailPane({ id, provider, onRun }: { id: string; provider: string; onRun: (r: RunRequest) => void }) {
  const { t, lang } = useLanguage();
  const [run, setRun] = useState<RunSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    setRun(null);
    setErr(null);
    api
      .run(id)
      .then((raw) => {
        // The detail endpoint omits id and uses total* fields — normalize them.
        const r = raw as RunSummary & { totalDuration?: string; totalTokens?: RunSummary["tokens"] };
        const norm: RunSummary = {
          ...r,
          id,
          duration: r.duration ?? r.totalDuration,
          tokens: r.tokens ?? r.totalTokens,
        };
        setRun(norm);
        // auto-expand the final deliverable
        const last = [...(norm.steps ?? [])].reverse().find((s) => s.content?.trim());
        setOpen(last?.id ?? null);
      })
      .catch((e) => setErr(e.message));
  }, [id]);

  const fullText = useMemo(() => {
    if (!run?.steps) return "";
    return run.steps
      .filter((s) => s.content?.trim())
      .map((s) => `## ${s.agentName ?? s.id}\n\n${s.content!.trim()}`)
      .join("\n\n---\n\n");
  }, [run]);

  const finalStep = useMemo(() => {
    const ss = run?.steps ?? [];
    return [...ss].reverse().find((s) => s.content?.trim()) ?? null;
  }, [run]);

  // 未完成的 run（含 human_input 等输入时被中断的）：续跑起点优先取第一个失败步
  // （条件分支正常跳过的步不该作为起点），没有失败步再退回第一个非完成步
  const firstIncomplete = useMemo(() => {
    if (!run || run.success) return null;
    const ss = run.steps ?? [];
    return ss.find((s) => s.status === "failed") ?? ss.find((s) => s.status !== "completed") ?? null;
  }, [run]);

  if (err) return <p className="p-6 text-sm text-red-500">{err}</p>;
  if (!run)
    return (
      <p className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> {t.studio.runs.loadingDetail}
      </p>
    );

  const canResume = !!run.file;
  const baseName = `${run.name}-${run.id.replace(`${run.name}-`, "")}`;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-bold">
            {run.success ? <CheckCircle2 className="size-4 shrink-0 text-emerald-500" /> : <XCircle className="size-4 shrink-0 text-red-500" />}
            <span className="truncate">{run.name}</span>
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {run.duration && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" />
                {run.duration}
              </span>
            )}
            {run.tokens && <span>{(run.tokens.input ?? 0) + (run.tokens.output ?? 0)} tokens</span>}
            <span>{(run.steps ?? []).length} {t.studio.runs.stepsUnit}</span>
          </p>
        </div>
        {finalStep && (
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <CopyButton value={finalStep.content!} label={t.studio.runs.copyResult} copiedLabel={t.studio.runs.copied} />
            <Button size="sm" onClick={() => downloadText(safeFilename(baseName), finalStep.content!)}>
              <Download className="size-3.5" /> {t.studio.runs.downloadResult}
            </Button>
            <Button size="sm" variant="ghost" title={t.studio.runs.downloadAllTitle} onClick={() => downloadText(safeFilename(baseName + t.studio.runs.fullProcessSuffix), fullText)}>
              {t.studio.runs.downloadAll}
            </Button>
          </div>
        )}
      </div>

      <div className="flex-1 space-y-2.5 overflow-auto p-5">
        {!canResume && <p className="text-xs text-muted-foreground">{t.studio.runs.cannotResume}</p>}
        {canResume && firstIncomplete && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/[0.06] px-4 py-3">
            <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
              {t.studio.runs.incompleteHintPrefix}
              <span className="font-semibold text-foreground">{firstIncomplete.agentName ?? firstIncomplete.id}</span>
              {t.studio.runs.incompleteHintSuffix}
            </p>
            <Button
              size="sm"
              onClick={() =>
                onRun({
                  kind: "workflow",
                  title: `${t.studio.runs.resumeFromPrefix}${firstIncomplete.agentName ?? firstIncomplete.id}${t.studio.runs.resumeFromSuffix} · ${run.name}`,
                  file: run.file!,
                  provider: provider || undefined,
                  resume: run.id,
                  fromStep: firstIncomplete.id,
                })
              }
            >
              <Play className="size-3.5" /> {t.studio.runs.continueRun}
            </Button>
          </div>
        )}
        {(run.steps ?? []).map((s, i) => {
          const isOpen = open === s.id;
          const isFinal = finalStep?.id === s.id && (run.steps ?? []).length > 1;
          return (
            <div
              key={s.id}
              className={cn("overflow-hidden rounded-xl border bg-card/60", isFinal ? "border-primary/50 ring-1 ring-primary/20" : "border-border/70")}
            >
              <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                <button onClick={() => setOpen(isOpen ? null : s.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium">
                  <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
                  <span className="w-4 shrink-0 text-right text-xs text-muted-foreground">{i + 1}</span>
                  <span className="shrink-0">{s.agentEmoji ?? "•"}</span>
                  <span className="truncate">{s.agentName ?? s.id}</span>
                  {isFinal && <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">✦ {t.studio.runs.finalResult}</span>}
                  {s.status === "failed" && <span className="shrink-0 rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-500">{t.studio.runs.stepFailed}</span>}
                  {s.status === "skipped" && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{t.studio.runs.stepSkipped}</span>}
                  {s.verification && (
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                        s.verification.pass ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
                      )}
                      title={s.verification.reworked ? t.studio.runs.verifyReworkedTitle : undefined}
                    >
                      {s.verification.pass
                        ? `${t.studio.runs.verifyPass}${s.verification.reworked ? t.studio.runs.verifyReworkedSuffix : ""}`
                        : `${t.studio.runs.verifyFailPrefix}${s.verification.failed.length}${t.studio.runs.verifyFailSuffix}`}
                    </span>
                  )}
                  {s.duration && <span className="shrink-0 text-xs text-muted-foreground">{s.duration}</span>}
                </button>
                <div className="flex shrink-0 items-center gap-1.5">
                  {s.content && (
                    <Tip label={t.studio.shell.copy}>
                      <CopyButton value={s.content} />
                    </Tip>
                  )}
                  {s.content && (
                    <Tip label={t.studio.runs.downloadStep}>
                      <button
                        type="button"
                        onClick={() => downloadText(safeFilename(`${baseName}-${i + 1}-${s.agentName ?? s.id}`), s.content!)}
                        className="inline-flex items-center rounded-lg border border-border/70 bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <Download className="size-3.5" />
                      </button>
                    </Tip>
                  )}
                  {canResume && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        onRun({
                          kind: "workflow",
                          title: `${t.studio.runs.resumeFromPrefix}${s.agentName ?? s.id}${t.studio.runs.resumeFromSuffix} · ${run.name}`,
                          file: run.file!,
                          provider: provider || undefined,
                          resume: run.id,
                          fromStep: s.id,
                        })
                      }
                    >
                      <RotateCcw className="size-3.5" />
                      <span className="hidden sm:inline">{t.studio.runs.resume}</span>
                    </Button>
                  )}
                </div>
              </div>
              {isOpen && !s.content && s.error && (
                <p className="border-t border-border/60 px-3 py-2.5 text-xs leading-relaxed text-red-500">{s.error}</p>
              )}
              {isOpen && s.content && (
                <div className="max-h-[60vh] overflow-auto border-t border-border/60 px-3 py-2.5">
                  {s.acceptance && (
                    <div className="mb-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2 text-xs">
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">{lang === "en" ? "✅ Acceptance criteria" : "✅ 验收标准"}</span>
                      <p className="mt-1 whitespace-pre-wrap leading-relaxed text-muted-foreground">{s.acceptance}</p>
                    </div>
                  )}
                  {s.verification && !s.verification.pass && s.verification.failed.length > 0 && (
                    <div className="mb-2.5 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-xs">
                      <span className="font-semibold text-amber-600 dark:text-amber-400">{t.studio.runs.verifyUnmetTitle}</span>
                      <ul className="mt-1 space-y-0.5 leading-relaxed text-muted-foreground">
                        {s.verification.failed.map((f, fi) => (
                          <li key={fi}>· {f}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <Markdown>{s.content}</Markdown>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 运行时刻按**本地时区**渲染（#101）。
 * 产物目录名里的时间戳是 UTC（引擎用 toISOString 生成），以前列表直接把它当字符串显示，
 * 于是北京用户看到的时间永远差 8 小时。后端现在给绝对时刻（startedAt，UTC ISO），
 * 这里交给 toLocale* 按浏览器所在时区渲染 —— 跟随系统时区，无需任何配置。
 */
function runDate(r: RunSummary): Date | null {
  if (!r.startedAt) return null;
  const d = new Date(r.startedAt);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 本地日历日 key（不能用 toISOString，那是 UTC 的"今天"） */
function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type StatusFilter = "all" | "ok" | "bad";

export function RunsPanel({ provider, onRun }: { provider: string; onRun: (r: RunRequest) => void }) {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "zh-CN";
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  // 管理模式：出复选框做批量删除；平时每条 hover 出单条删除
  const [manage, setManage] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .runs()
      .then(setRuns)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return runs.filter(
      (r) =>
        (!n || r.name.toLowerCase().includes(n)) &&
        (filter === "all" || (filter === "ok" ? r.success : !r.success)),
    );
  }, [runs, q, filter]);

  // 按本地日历日分组（今天 / 昨天 / 具体日期），列表已按时间倒序
  const groups = useMemo(() => {
    const today = localDayKey(new Date());
    const yest = localDayKey(new Date(Date.now() - 86_400_000));
    const out: { key: string; label: string; items: RunSummary[] }[] = [];
    for (const r of filtered) {
      const d = runDate(r);
      const key = d ? localDayKey(d) : "—";
      const label = !d
        ? "—"
        : key === today
          ? t.studio.runs.groupToday
          : key === yest
            ? t.studio.runs.groupYesterday
            : d.toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(r);
      else out.push({ key, label, items: [r] });
    }
    return out;
  }, [filtered, locale, t]);

  async function deletePending() {
    if (!pending) return;
    setBusy(true);
    setDelErr(null);
    const done: string[] = [];
    try {
      for (const id of pending) {
        await api.deleteRun(id);
        done.push(id);
      }
      setPending(null);
    } catch (e) {
      // 批量删到一半失败：已删的照样从列表移除，对话框保持打开并显示原因。
      // 待删列表要剔掉已经删成功的，否则用户点「重试」会对已删项再来一次 → 必然 404 卡死。
      setPending((prev) => (prev ?? []).filter((id) => !done.includes(id)));
      setDelErr((e as Error).message);
    } finally {
      if (done.length) {
        setRuns((prev) => prev.filter((r) => !done.includes(r.id)));
        setChecked((prev) => {
          const next = new Set(prev);
          for (const id of done) next.delete(id);
          return next;
        });
        if (sel && done.includes(sel)) setSel(null);
      }
      setBusy(false);
    }
  }

  if (loading)
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> {t.studio.runs.loadingHistory}
      </div>
    );
  if (err) return <p className="py-20 text-center text-sm text-red-500">{t.studio.runs.loadFailed}{err}</p>;
  if (!runs.length) return <p className="py-20 text-center text-sm text-muted-foreground">{t.studio.runs.empty}</p>;

  return (
    <div className="grid gap-4 md:grid-cols-[300px_1fr]">
      {/* left: history menu */}
      {/* 管理模式下即使选中了某条也要留在列表（否则手机端一进管理就看不到要删的东西） */}
      <aside className={cn("flex-col", sel && !manage ? "hidden md:flex" : "flex")}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t.studio.runs.searchPlaceholder}
          className="mb-2 h-9 w-full rounded-lg border border-border/70 bg-card/60 px-3 text-sm outline-none focus:border-primary/50"
        />
        <div className="mb-2 flex items-center gap-1">
          {([
            ["all", t.studio.runs.filterAll],
            ["ok", t.studio.runs.filterSuccess],
            ["bad", t.studio.runs.filterFailed],
          ] as [StatusFilter, string][]).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-xs transition-colors",
                filter === k ? "border-primary bg-primary/10 text-foreground" : "border-border/70 text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => {
              setManage((v) => !v);
              setChecked(new Set());
            }}
            className="ml-auto rounded-lg border border-border/70 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {manage ? t.studio.runs.exitManage : t.studio.runs.manage}
          </button>
        </div>

        {manage && (
          <div className="mb-2 flex items-center gap-2">
            <button
              onClick={() => setChecked(checked.size === filtered.length ? new Set() : new Set(filtered.map((r) => r.id)))}
              className="rounded-lg border border-border/70 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {t.studio.runs.selectAll}
            </button>
            <span className="text-xs text-muted-foreground">
              {t.studio.runs.selectedPrefix}{checked.size}{t.studio.runs.selectedSuffix}
            </span>
            <Button size="sm" variant="destructive" className="ml-auto" disabled={!checked.size} onClick={() => setPending([...checked])}>
              <Trash2 className="size-3.5" /> {t.studio.runs.deleteSelected}
            </Button>
          </div>
        )}

        <div className="max-h-[70vh] space-y-1.5 overflow-auto pr-1">
          {!filtered.length && <p className="px-1 py-6 text-center text-xs text-muted-foreground">{t.studio.runs.noMatch}</p>}
          {groups.map((g) => (
            <div key={g.key} className="space-y-1.5">
              <p className="px-1 pt-2 text-[11px] font-semibold text-muted-foreground/70">{g.label}</p>
              {g.items.map((r) => {
                const on = sel === r.id;
                const d = runDate(r);
                return (
                  <div
                    key={r.id}
                    className={cn(
                      "group flex items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-colors",
                      on ? "border-primary bg-primary/10" : "border-border/70 bg-card/50 hover:border-primary/40",
                    )}
                  >
                    {manage && (
                      <input
                        type="checkbox"
                        checked={checked.has(r.id)}
                        onChange={(e) =>
                          setChecked((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(r.id);
                            else next.delete(r.id);
                            return next;
                          })
                        }
                        className="mt-1 size-3.5 shrink-0 accent-primary"
                      />
                    )}
                    <button onClick={() => setSel(r.id)} className="flex min-w-0 flex-1 items-start gap-2.5 text-left">
                      {r.success ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-red-500" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{r.name}</span>
                        <span className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span>{(r.completedCount ?? r.stepCount ?? 0)}/{r.stepCount ?? 0} {t.studio.runs.stepsUnit}</span>
                          {r.duration && <span>· {r.duration}</span>}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground/70">
                          {d ? d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : r.id.replace(`${r.name}-`, "")}
                        </span>
                      </span>
                    </button>
                    {!manage && (
                      <Tip label={t.studio.runs.deleteOne}>
                        <button
                          type="button"
                          onClick={() => setPending([r.id])}
                          className="mt-0.5 shrink-0 rounded-lg p-1 text-muted-foreground/60 opacity-0 transition-opacity hover:text-red-500 focus-visible:opacity-100 group-hover:opacity-100"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </Tip>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </aside>

      {/* right: detail */}
      <section className={cn("min-h-[60vh] rounded-2xl border border-border/70 bg-card/30", sel ? "block" : "hidden md:block")}>
        {sel ? (
          <>
            <button onClick={() => setSel(null)} className="flex items-center gap-1.5 px-5 pt-4 text-xs text-muted-foreground hover:text-foreground md:hidden">
              <ArrowLeft className="size-3.5" />
              {t.studio.runs.backToList}
            </button>
            <DetailPane id={sel} provider={provider} onRun={onRun} />
          </>
        ) : (
          <div className="grid h-full place-items-center p-10 text-center text-sm text-muted-foreground">
            {t.studio.runs.selectHint}
          </div>
        )}
      </section>

      {pending && (
        <ConfirmDialog
          danger
          busy={busy}
          error={delErr}
          title={t.studio.runs.deleteTitle}
          body={
            pending.length > 1
              ? `${t.studio.runs.deleteBodyBatchPrefix}${pending.length}${t.studio.runs.deleteBodyBatchSuffix}`
              : t.studio.runs.deleteBodyOne
          }
          confirmLabel={t.studio.runs.deleteConfirm}
          cancelLabel={t.studio.runs.deleteCancel}
          onConfirm={deletePending}
          onClose={() => {
            setPending(null);
            setDelErr(null);
          }}
        />
      )}
    </div>
  );
}
