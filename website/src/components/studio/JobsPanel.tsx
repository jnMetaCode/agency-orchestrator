import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { api, type StudioJob } from "@/lib/studio";
import { jobObservation } from "@/lib/job-observation";
import { useLanguage } from "@/i18n/LanguageProvider";
import { cn } from "@/lib/utils";

function useJobList(refresh: number) {
  const [jobs, setJobs] = useState<StudioJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      if (!alive) return;
      if (document.hidden) { timer = setTimeout(load, 5000); return; }
      try {
        const result = await api.jobs(50);
        if (!alive) return;
        setJobs(result.jobs); setError(null); setCheckedAt(new Date().toISOString());
      } catch (err) { if (alive) setError(err instanceof Error ? err.message : String(err)); }
      finally {
        if (alive) {
          setLoading(false);
          timer = setTimeout(load, 5000);
        }
      }
    };
    void load();
    return () => { alive = false; clearTimeout(timer); };
  }, [refresh]);
  return { jobs, loading, error, checkedAt };
}

function JobDetail({ id, refresh, stale }: { id: string; refresh: string; stale: boolean }) {
  const { t, lang } = useLanguage();
  const text = t.studio.jobs;
  const [detail, setDetail] = useState<{ job: StudioJob; resetRequired: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setDetail(null); setError(null);
    api.jobEvents(id).then(result => { if (alive) setDetail(result); })
      .catch(err => { if (alive) setError(err instanceof Error ? err.message : String(err)); });
    return () => { alive = false; };
  }, [id, refresh]);
  const status = (value: string) => Object.prototype.hasOwnProperty.call(text.statuses, value)
    ? (text.statuses as Record<string, string>)[value] : text.unknown;
  if (error) return <p role="alert" className="p-4 text-sm text-red-500">{error}</p>;
  if (!detail) return <p role="status" className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{text.loading}</p>;
  const job = detail.job;
  const observation = jobObservation(job, stale);
  return <section aria-label={text.details} className="min-w-0 rounded-xl border border-border/70 bg-card/40 p-4">
    <h3 className="break-words font-semibold">{job.displayName || text.taskFallback.replace("{id}", job.id.slice(0, 8))}</h3>
    <div className="mt-2 flex items-center gap-2"><span className="break-all font-mono text-xs text-muted-foreground">{job.id}</span><CopyButton value={job.id} label={text.copyId} copiedLabel={text.copied} /></div>
    <p className="mt-3 text-sm">{status(job.status)}</p>
    <p className={cn("mt-2 text-xs leading-relaxed", observation === "unconfirmed" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>{text.observations[observation]}</p>
    <h4 className="mt-5 text-sm font-semibold">{text.events}</h4>
    {detail.resetRequired && <p className="mt-2 text-xs text-muted-foreground">{text.expired}</p>}
    <ol className="mt-2 space-y-2">
      {[...job.events].reverse().map(event => <li key={event.sequence} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border/40 py-2 text-sm">
        <span className="text-xs text-muted-foreground">#{event.sequence}</span><span>{status(event.status)}</span>
        <time className="text-xs text-muted-foreground" dateTime={event.at}>{new Date(event.at).toLocaleString(lang === "en" ? "en-US" : "zh-CN")}</time>
      </li>)}
    </ol>
    <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{text.artifactsHint}</p>
  </section>;
}

export function JobsPanel({ onHistory }: { onHistory: () => void }) {
  const { t, lang } = useLanguage();
  const text = t.studio.jobs;
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const { jobs, loading, error, checkedAt } = useJobList(refresh);
  const visible = jobs.filter(job => filter === "all" || jobObservation(job, !!error) === filter);
  const status = (value: string) => Object.prototype.hasOwnProperty.call(text.statuses, value)
    ? (text.statuses as Record<string, string>)[value] : text.unknown;
  const selectedJob = jobs.find(job => job.id === selected);
  const detailRefresh = `${refresh}:${selectedJob?.revision}:${selectedJob?.activeInThisInstance}:${!!error}`;
  // A selection absent from the latest list is not silently replaced with another task.
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-semibold">{text.title}</h2><p className="mt-1 text-xs text-muted-foreground">{text.limit}</p></div>
      <div className="flex gap-2"><Button variant="outline" size="sm" onClick={onHistory}>{text.history}</Button><Button variant="outline" size="sm" onClick={() => setRefresh(value => value + 1)}><RefreshCw className="size-3.5" />{text.refresh}</Button></div>
    </div>
    <p className="rounded-lg border border-border/60 p-3 text-xs leading-relaxed text-muted-foreground">{text.boundary}</p>
    {checkedAt && <p className="text-xs text-muted-foreground">{text.checkedAt} <time dateTime={checkedAt}>{new Date(checkedAt).toLocaleTimeString(lang === "en" ? "en-US" : "zh-CN")}</time></p>}
    {error && <div role="alert" className="space-y-1 text-sm text-red-500"><p>{error}</p>{jobs.length > 0 && <p className="text-xs">{text.stale}</p>}</div>}
    <select aria-label={text.filter} value={filter} onChange={event => setFilter(event.target.value)} className="rounded-lg border border-border/70 bg-background px-3 py-2 text-sm">
      <option value="all">{text.all}</option><option value="active">{text.activeFilter}</option><option value="unconfirmed">{text.unconfirmedFilter}</option><option value="recorded">{text.endedFilter}</option>
    </select>
    {loading && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{text.loading}</p>}
    {!loading && !error && jobs.length === 0 && <p className="py-8 text-sm text-muted-foreground">{text.empty}</p>}
    {!loading && jobs.length > 0 && visible.length === 0 && <p className="py-4 text-sm text-muted-foreground">{text.noMatches}</p>}
    <div className="grid items-start gap-4 md:grid-cols-[minmax(220px,300px)_1fr]">
      <div className="space-y-2" role="group" aria-label={text.title}>
        {visible.map(job => <button key={job.id} type="button" aria-pressed={selected === job.id} onClick={() => setSelected(job.id)} className={cn("w-full rounded-xl border p-3 text-left transition-colors", selected === job.id ? "border-primary bg-primary/5" : "border-border/70 bg-card/40 hover:border-primary/50")}>
          <span className="block break-words text-sm font-medium">{job.displayName || text.taskFallback.replace("{id}", job.id.slice(0, 8))}</span>
          <span className="mt-1 block text-xs text-muted-foreground">{status(job.status)}</span>
          <span className={cn("mt-1 block text-xs", jobObservation(job, !!error) === "unconfirmed" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>{text.observationLabels[jobObservation(job, !!error)]}</span>
          <time className="mt-2 block text-xs text-muted-foreground" dateTime={job.updatedAt}>{new Date(job.updatedAt).toLocaleString(lang === "en" ? "en-US" : "zh-CN")}</time>
        </button>)}
      </div>
      {selected ? <JobDetail id={selected} refresh={detailRefresh} stale={!!error} /> : jobs.length > 0 ? <p className="p-4 text-sm text-muted-foreground">{text.select}</p> : null}
    </div>
  </div>;
}
