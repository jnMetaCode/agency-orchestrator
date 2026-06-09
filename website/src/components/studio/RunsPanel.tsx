import { ArrowLeft, CheckCircle2, ChevronDown, Clock, Download, Loader2, RotateCcw, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { api, type RunSummary } from "@/lib/studio";
import { downloadText, safeFilename } from "@/lib/download";
import { useLanguage } from "@/i18n/LanguageProvider";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown";
import type { RunRequest } from "./RunManager";

function DetailPane({ id, provider, onRun }: { id: string; provider: string; onRun: (r: RunRequest) => void }) {
  const { t } = useLanguage();
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
                  {s.duration && <span className="shrink-0 text-xs text-muted-foreground">{s.duration}</span>}
                </button>
                <div className="flex shrink-0 items-center gap-1.5">
                  {s.content && <CopyButton value={s.content} />}
                  {s.content && (
                    <button
                      type="button"
                      title={t.studio.runs.downloadStep}
                      onClick={() => downloadText(safeFilename(`${baseName}-${i + 1}-${s.agentName ?? s.id}`), s.content!)}
                      className="inline-flex items-center rounded-lg border border-border/70 bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Download className="size-3.5" />
                    </button>
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
              {isOpen && s.content && (
                <div className="max-h-[60vh] overflow-auto border-t border-border/60 px-3 py-2.5">
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

export function RunsPanel({ provider, onRun }: { provider: string; onRun: (r: RunRequest) => void }) {
  const { t } = useLanguage();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    api
      .runs()
      .then(setRuns)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return runs.filter((r) => !n || r.name.toLowerCase().includes(n));
  }, [runs, q]);

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
      <aside className={cn("flex-col", sel ? "hidden md:flex" : "flex")}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t.studio.runs.searchPlaceholder}
          className="mb-2 h-9 w-full rounded-lg border border-border/70 bg-card/60 px-3 text-sm outline-none focus:border-primary/50"
        />
        <div className="max-h-[70vh] space-y-1.5 overflow-auto pr-1">
          {filtered.map((r) => {
            const on = sel === r.id;
            return (
              <button
                key={r.id}
                onClick={() => setSel(r.id)}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors",
                  on ? "border-primary bg-primary/10" : "border-border/70 bg-card/50 hover:border-primary/40",
                )}
              >
                {r.success ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-red-500" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.name}</span>
                  <span className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{(r.completedCount ?? r.stepCount ?? 0)}/{r.stepCount ?? 0} {t.studio.runs.stepsUnit}</span>
                    {r.duration && <span>· {r.duration}</span>}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground/70">{r.id.replace(`${r.name}-`, "")}</span>
                </span>
              </button>
            );
          })}
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
    </div>
  );
}
