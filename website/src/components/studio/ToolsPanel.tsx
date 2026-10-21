import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/i18n/LanguageProvider";
import { api, type ToolStatusReport } from "@/lib/studio";

export function ToolsPanel({ offline, onSettings }: { offline: boolean; onSettings: () => void }) {
  const { t } = useLanguage();
  const p = t.studio.tools;
  const [report, setReport] = useState<ToolStatusReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    if (offline) return;
    const request = ++generation.current;
    setLoading(true); setFailed(false);
    try {
      const next = await api.toolStatus();
      if (generation.current === request) setReport(next);
    } catch { if (generation.current === request) setFailed(true); }
    finally { if (generation.current === request) setLoading(false); }
  }, [offline]);
  useEffect(() => {
    if (offline) { setReport(null); setLoading(false); setFailed(false); }
    else void refresh();
    return () => { generation.current++; };
  }, [offline, refresh]);

  return (
    <section aria-labelledby="tools-title" className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 id="tools-title" className="text-2xl font-bold">{p.title}</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{p.description}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={offline || loading}>
            <RefreshCw className={loading ? "animate-spin" : ""} />{loading ? p.loading : p.refresh}
          </Button>
          <Button variant="outline" size="sm" onClick={onSettings}><Settings />{p.settings}</Button>
        </div>
      </div>
      <p className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">{p.scope}</p>
      <div aria-live="polite" className="text-sm text-muted-foreground">
        {offline ? p.offline : failed ? p.failed : loading ? p.loading : report ? `${p.checkedAt} ${new Date(report.checkedAt).toLocaleTimeString()}` : ""}
        {failed && report && <p className="mt-1">{p.previous} {p.checkedAt} {new Date(report.checkedAt).toLocaleTimeString()}</p>}
      </div>
      {!offline && report && <div className="grid gap-4 md:grid-cols-2" aria-busy={loading}>
        {report.tools.map(tool => (
          <article key={tool.id} className="rounded-2xl border border-border p-5" data-tool-id={tool.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">{tool.id === "claude-code" ? "Claude Code" : "Codex CLI"}</h2>
              <span className="rounded-full bg-muted px-3 py-1 text-xs">{tool.installed ? p.detected : p.notDetected}</span>
            </div>
            <dl className="mt-4 space-y-3 text-sm">
              <div><dt className="text-muted-foreground">{p.configurationLabel}</dt><dd>{p.configuration[tool.configuration]}</dd></div>
              {tool.configuration === "present" && <>
                <div><dt className="text-muted-foreground">{p.managementLabel}</dt><dd>{p.management[tool.management]}</dd></div>
                <div><dt className="text-muted-foreground">{p.endpointLabel}</dt><dd className="break-all">{tool.endpointInvalid ? p.endpointInvalid : tool.endpointOrigin || p.endpointUnset}</dd></div>
                <div><dt className="text-muted-foreground">{p.modelLabel}</dt><dd className="break-all">{tool.model || p.modelUnset}</dd></div>
                {tool.provider && <div><dt className="text-muted-foreground">{p.providerLabel}</dt><dd className="break-all">{tool.provider}</dd></div>}
              </>}
            </dl>
            {(tool.conflict || tool.recoveryPending || tool.providerMissing) && <div className="mt-4 space-y-2 rounded-xl bg-amber-500/10 p-3 text-sm">
              {tool.conflict && <p>{p.conflict}</p>}
              {tool.recoveryPending && <p>{p.recovery}</p>}
              {tool.providerMissing && <p>{p.providerMissing}</p>}
            </div>}
          </article>
        ))}
      </div>}
    </section>
  );
}
