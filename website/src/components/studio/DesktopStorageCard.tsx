import { FolderCog, FolderOpen, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/i18n/LanguageProvider";

/** Electron 专属的数据目录设置；官网和普通 ao web 没有 preload bridge，整张卡不显示。 */
export function DesktopStorageCard() {
  const bridge = window.aoDesktop;
  const { t, lang } = useLanguage();
  const tr = t.studio.providers.desktopStorage;
  const [status, setStatus] = useState<AoDesktopStorageStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bridge) return;
    bridge.storageStatus().then(setStatus).catch(() => setStatus(null));
  }, [bridge]);

  if (!bridge || !status) return null;

  const act = async (kind: "choose" | "reset") => {
    setBusy(true);
    setError(null);
    try {
      const result = kind === "choose" ? await bridge.chooseDataDir(lang) : await bridge.resetDataDir(lang);
      if (result.error) setError(result.error);
      if (result.status) setStatus(result.status);
    } catch (err) {
      // 确认切换后 Electron 会重载页面，旧 renderer 的 promise 可能被销毁；此时不显示假错误。
      if (document.visibilityState === "visible") setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const open = async () => {
    setError(null);
    try {
      const result = await bridge.openDataDir();
      if (result.error) setError(result.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="rounded-xl border border-border/60 bg-card/50 px-4 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <FolderCog className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{tr.title}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{tr.hint}</p>
          <code className="mt-2 block break-all rounded-lg bg-muted/60 px-2.5 py-2 text-[11px] text-foreground">{status.activeDir}</code>
          {status.source === "environment" && <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">{tr.environmentOverride}</p>}
          {error && <p className="mt-1.5 text-[11px] text-red-500">{error}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={open}>
            <FolderOpen className="size-3.5" /> {tr.open}
          </Button>
          <Button size="sm" onClick={() => act("choose")} disabled={busy || !status.canChange}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <FolderCog className="size-3.5" />} {tr.choose}
          </Button>
          {status.source === "settings" && (
            <Button size="sm" variant="outline" onClick={() => act("reset")} disabled={busy}>
              <RotateCcw className="size-3.5" /> {tr.reset}
            </Button>
          )}
        </div>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{tr.moveWarning}</p>
    </div>
  );
}
