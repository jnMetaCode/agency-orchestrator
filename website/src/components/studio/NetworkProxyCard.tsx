import { ChevronDown, Loader2, Network } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/i18n/LanguageProvider";
import { api, type NetworkProxyStatus } from "@/lib/studio";
import { cn } from "@/lib/utils";

/**
 * AO 自己的网络代理设置（#105）。桌面版从 Dock / 开始菜单启动，拿不到用户 shell 里 export 的
 * HTTPS_PROXY，只能在界面里配。和上面体检卡里的"Claude 全局代理"不是一回事：那个写
 * ~/.claude/settings.json、只影响用户全局的 Claude Code；这个管 AO 引擎自己发请求。
 *
 * 平时收成一行；配了但连不上（Clash 没开）时自动展开——那正是"所有供应商都连不上"的根因，
 * 不能让用户去挨个怀疑 key。
 */
export function NetworkProxyCard() {
  const { t } = useLanguage();
  const tr = t.studio.providers.netProxy;
  const [st, setSt] = useState<NetworkProxyStatus | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 旧后端 / 演示站没有这个端点 → 整张卡不显示
    api.networkProxy().then(setSt).catch(() => setSt(null));
  }, []);

  if (!st) return null;

  const save = (proxy: string) => {
    setBusy(true);
    setError(null);
    api.setNetworkProxy(proxy)
      .then((next) => { setSt(next); setDraft(""); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const unreachable = st.source === "studio" && st.reachable === false;
  const open = expanded || unreachable || !!error;
  // 一行结论：走的哪个代理、谁配的；没走就说直连
  const summary = st.reason === "disabled"
    ? tr.disabledByEnv
    : st.active
      ? `${st.source === "shell" ? tr.viaShell : tr.viaStudio} ${st.active}`
      : st.reason === "unavailable"
        ? `${tr.unavailable}${st.detail ? `（${st.detail}）` : ""}`
        : tr.direct;

  return (
    <div className={cn("rounded-xl border px-4 py-3", unreachable ? "border-red-500/50 bg-red-500/[0.05]" : "border-border/60 bg-card/50")}>
      <div className="flex cursor-pointer select-none items-center gap-2.5" onClick={() => setExpanded((v) => !v)}>
        <Network className={cn("size-4 shrink-0", unreachable ? "text-red-500" : st.active ? "text-emerald-500" : "text-muted-foreground")} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{tr.title}</span>
          <span className={cn("block truncate text-[11px]", unreachable ? "font-medium text-red-500" : "text-muted-foreground")}>
            {unreachable ? `${tr.unreachable} · ${st.saved}` : summary}
          </span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </div>

      {open && (
        <div className="mt-2.5 space-y-2 text-[12px]">
          <p className="text-muted-foreground">{tr.hint}</p>
          {st.source === "shell" && st.shell && (
            <p className="text-muted-foreground">
              {tr.shellNote} <code className="rounded bg-muted px-1 py-0.5 text-foreground">{st.shell.name}={st.shell.url}</code>
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) save(draft.trim()); }}
              placeholder={st.saved ?? "http://127.0.0.1:7890"}
              spellCheck={false}
              className="h-8 min-w-0 flex-1 rounded-lg border border-border/70 bg-background px-2.5 font-mono text-[12px] outline-none focus:border-primary/50"
            />
            <Button size="sm" onClick={() => save(draft.trim())} disabled={busy || !draft.trim()}>
              {busy && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
              {tr.save}
            </Button>
            {st.saved && (
              <Button size="sm" variant="outline" onClick={() => save("")} disabled={busy}>
                {tr.clear}
              </Button>
            )}
          </div>
          {/* 能选别填：探到系统代理（Clash 开着「系统代理」）就给一键采用 */}
          {st.system && st.system !== st.saved && (
            <p className="text-muted-foreground">
              {tr.systemFound} <code className="rounded bg-muted px-1 py-0.5 text-foreground">{st.system}</code>{" "}
              <button className="font-medium text-primary hover:underline disabled:opacity-50" disabled={busy} onClick={() => save(st.system!)}>
                {tr.useSystem}
              </button>
            </p>
          )}
          {st.saved && st.savedHasAuth && <p className="text-muted-foreground">{tr.authMasked}</p>}
          {unreachable && <p className="font-medium text-red-500">{tr.unreachableHint}</p>}
          {error && <p className="text-red-500">{error}</p>}
        </div>
      )}
    </div>
  );
}
