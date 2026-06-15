import { Loader2, RefreshCw, TerminalSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { useLanguage } from "@/i18n/LanguageProvider";

export function StudioGate({ checking, onRetry }: { checking: boolean; onRetry: () => void }) {
  const { t } = useLanguage();
  const cmd = "node web/server.js";
  return (
    <div className="mx-auto mt-12 max-w-xl rounded-2xl border border-border/60 bg-card/30 px-6 py-12 text-center">
      <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
        <TerminalSquare className="size-7" />
      </div>
      <h2 className="mt-5 text-xl font-bold">{t.studio.shell.gateTitle}</h2>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
        {t.studio.shell.gateExplainBefore} <code className="rounded bg-muted px-1.5 py-0.5">ao</code> {t.studio.shell.gateExplainMiddle}
        <code className="rounded bg-muted px-1.5 py-0.5">:8088</code>{t.studio.shell.gateExplainAfter}
      </p>
      <div className="mx-auto mt-5 flex max-w-sm items-center justify-between rounded-xl border border-border/70 bg-card/60 px-4 py-3 font-mono text-sm">
        <span>{cmd}</span>
        <CopyButton value={cmd} />
      </div>
      <div className="mt-6">
        <Button onClick={onRetry} disabled={checking}>
          {checking ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {checking ? t.studio.shell.gateChecking : t.studio.shell.gateRecheck}
        </Button>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">{t.studio.shell.gateHint}</p>
    </div>
  );
}
