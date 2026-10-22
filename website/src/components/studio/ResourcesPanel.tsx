import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/i18n/LanguageProvider";
import { api, type CatalogResource, type ResourceCatalog } from "@/lib/studio";

export function ResourcesPanel({ offline }: { offline: boolean }) {
  const { t } = useLanguage(); const p = t.studio.resources;
  const [report, setReport] = useState<ResourceCatalog | null>(null);
  const [loading, setLoading] = useState(false), [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "skill" | "mcp">("all");
  const [showShadowed, setShowShadowed] = useState(false);
  const [host, setHost] = useState("all"), [limit, setLimit] = useState(60);
  const [detail, setDetail] = useState<CatalogResource | null>(null);
  const [detailLoading, setDetailLoading] = useState(false), [detailFailed, setDetailFailed] = useState(false);
  const generation = useRef(0), detailGeneration = useRef(0);
  const detailSection = useRef<HTMLElement>(null);
  const clearDetail = () => { detailGeneration.current++; setDetail(null); setDetailLoading(false); setDetailFailed(false); };
  const refresh = useCallback(async () => {
    if (offline) return;
    const request = ++generation.current;
    detailGeneration.current++; setDetail(null); setDetailLoading(false); setDetailFailed(false);
    setLoading(true); setFailed(false);
    try { const next = await api.resources(); if (generation.current === request) setReport(next); }
    catch { if (generation.current === request) setFailed(true); }
    finally { if (generation.current === request) setLoading(false); }
  }, [offline]);
  useEffect(() => {
    if (offline) { setReport(null); setLoading(false); setFailed(false); clearDetail(); }
    else void refresh();
    return () => { generation.current++; detailGeneration.current++; };
  }, [offline, refresh]);
  useEffect(() => { setLimit(60); clearDetail(); }, [query, kind, host, showShadowed]);
  useEffect(() => { if (detail || detailLoading || detailFailed) detailSection.current?.scrollIntoView({ block: "nearest" }); }, [detail, detailLoading, detailFailed]);
  const open = async (item: CatalogResource) => {
    if (offline || loading || failed) return;
    const request = ++detailGeneration.current;
    setDetail(null); setDetailLoading(true); setDetailFailed(false);
    try { const next = await api.resource(item.id); if (detailGeneration.current === request) setDetail(next); }
    catch { if (detailGeneration.current === request) setDetailFailed(true); }
    finally { if (detailGeneration.current === request) setDetailLoading(false); }
  };
  const names = { ao: "AO", "claude-code": "Claude Code", "codex-cli": "Codex CLI" };
  const sourceName = (id: string) => id.startsWith("skills-") ? `${p.skillSource} ${Number(id.slice(7)) + 1}` : names[id.slice(4) as keyof typeof names] || p.unknown;
  const filtered = (report?.items || []).filter(item => (showShadowed || item.selection !== "shadowed") && (kind === "all" || item.kind === kind) && (host === "all" || item.host === host)
    && `${item.name} ${item.reference || ""} ${item.description || ""} ${item.endpointOrigin || ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <section aria-labelledby="resources-title" className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 id="resources-title" className="text-2xl font-bold">{p.title}</h1><p className="mt-2 max-w-3xl text-sm text-muted-foreground">{p.description}</p></div>
      <Button variant="outline" size="sm" disabled={offline || loading} onClick={() => void refresh()}><RefreshCw className={loading ? "animate-spin" : ""} />{loading ? p.loading : p.refresh}</Button>
    </div>
    <p className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">{p.scope}</p>
    <div aria-live="polite" className="text-sm text-muted-foreground">
      {offline ? p.offline : failed ? p.failed : loading ? p.loading : report ? `${p.checkedAt} ${new Date(report.checkedAt).toLocaleTimeString()}` : ""}
      {failed && report && <p>{p.previous} {p.checkedAt} {new Date(report.checkedAt).toLocaleTimeString()}</p>}
    </div>
    {!offline && report && <>
      <details className="rounded-xl border border-border p-3 text-sm"><summary className="cursor-pointer">{p.sources}</summary>
        <ul className="mt-2 space-y-1">{report.sources.map(source => <li key={source.id}>{sourceName(source.id)} · {p.sourceStatus[source.status]}{source.skipped > 0 ? ` · ${p.skipped} ${source.skipped}` : ""}</li>)}</ul><p className="mt-2 text-muted-foreground">{p.sourceHint}</p>
      </details>
      {report.truncated && <p className="text-sm text-amber-600 dark:text-amber-400">{p.truncated}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-w-48 flex-1 items-center gap-2 rounded-xl border border-border px-3 py-2"><Search className="size-4 shrink-0" /><input aria-label={p.search} placeholder={p.search} value={query} onChange={e => setQuery(e.target.value)} className="min-w-0 w-full bg-transparent text-sm outline-none" /></label>
        <select aria-label={p.kindLabel} value={kind} onChange={e => setKind(e.target.value as typeof kind)} className="rounded-xl border border-border bg-background p-2 text-sm"><option value="all">{p.all}</option><option value="skill">Skills</option><option value="mcp">MCP</option></select>
        <select aria-label={p.hostLabel} value={host} onChange={e => setHost(e.target.value)} className="rounded-xl border border-border bg-background p-2 text-sm"><option value="all">{p.allHosts}</option>{Object.entries(names).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
      </div>
      <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={showShadowed} onChange={e => setShowShadowed(e.target.checked)} />{p.showShadowed}</label>
      <p className="text-sm text-muted-foreground">{p.count.replace("{count}", String(filtered.length))}</p>
      {!filtered.length && <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">{report.items.length ? p.noMatches : p.empty}</p>}
      <div className="grid gap-3 md:grid-cols-2" aria-busy={loading}>{filtered.slice(0, limit).map(item => <article key={item.id} className="min-w-0 rounded-xl border border-border p-4" data-resource-kind={item.kind}>
        <div className="flex items-start justify-between gap-2"><h2 className="break-all font-semibold">{item.name}</h2><span className="text-xs text-muted-foreground">{item.kind === "skill" ? "Skill" : "MCP"}</span></div>
        <p className="mt-1 text-xs text-muted-foreground">{names[item.host]} · {sourceName(item.sourceId)}</p>
        {item.description && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{item.description}</p>}
        <p className="mt-2 text-sm">{p.status[item.status]}</p>
        {item.selection && <p className="mt-1 text-xs text-muted-foreground">{p.selection[item.selection]}</p>}
        {item.transport && <p className="mt-1 break-all text-xs text-muted-foreground">{p.transport} {item.transport} {item.endpointOrigin || ""}</p>}
        <Button variant="outline" size="sm" className="mt-3" disabled={loading || failed} onClick={() => void open(item)} aria-label={`${p.view} ${item.name}`}>{p.view}</Button>
      </article>)}</div>
      {filtered.length > limit && <Button variant="outline" onClick={() => setLimit(n => n + 60)}>{p.more}</Button>}
      {(detailLoading || detailFailed || detail) && <section ref={detailSection} aria-labelledby="resource-detail-title" className="rounded-xl border border-border p-4">
        <div className="flex items-center justify-between gap-2"><h2 id="resource-detail-title" className="font-semibold">{p.detail}</h2><Button variant="ghost" size="sm" aria-label={p.close} onClick={clearDetail}><X /></Button></div>
        <div aria-live="polite">{detailLoading ? p.loading : detailFailed ? p.detailFailed : ""}</div>
        {detail && <div className="mt-3 space-y-2 text-sm">
          <h3 className="break-all font-semibold">{detail.name}</h3><p>{p.status[detail.status]}</p><p>{names[detail.host]} · {sourceName(detail.sourceId)} · {detail.scope === "user" ? p.userScope : p.aoScope}</p>
          {detail.reference && <p className="break-all">{p.reference} {detail.reference}</p>}
          {detail.format && <p>{p.format} {detail.format}</p>}
          {detail.selection && <p>{p.selection[detail.selection]}</p>}
          {detail.kind === "mcp" && <><p>{p.transport} {detail.transport}</p><p className="break-all">{p.endpoint} {detail.endpointOrigin || p.unknown}</p><p>{p.configuredState} {p.enabled[detail.configuredState || "unknown"]}</p><p>{p.mcpDetails}</p></>}
          {detail.kind === "skill" && <><p>{p.skillDetails}</p>{detail.body !== undefined && <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 font-mono text-xs">{detail.body}</pre>}</>}
        </div>}
      </section>}
    </>}
  </section>;
}
