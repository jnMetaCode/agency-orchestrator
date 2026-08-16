import { ChevronDown, Globe, LifeBuoy, Loader2, Network, RotateCw, ShieldAlert, ShieldCheck, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tip";
import { useLanguage } from "@/i18n/LanguageProvider";
import { api, type ClaudeHealth, type ClaudeProxyStatus, type ClaudeRepairResult, type ClaudeSwitchStatus } from "@/lib/studio";
import { cn } from "@/lib/utils";

/**
 * 系统 Claude Code 体检/急救卡片。检测本机全局 ~/.claude/settings*.json 是否被别的
 * 软件（cc-switch 等切换器）或手动写坏 —— 假 token / 中转地址会顶掉官方登录、把请求
 * 改道，导致整机 CLI 不可用且 /login 也救不回来。红灯时一键把劫持 env 键删掉（写前
 * 已备份、可回滚），恢复官方登录。跟 AO 自己的中转配置完全隔离，只做减法。
 */
export function ClaudeHealthCard() {
  const { t } = useLanguage();
  const tr = t.studio.providers.repair;
  const [health, setHealth] = useState<ClaudeHealth | null>(null);
  const [status, setStatus] = useState<ClaudeSwitchStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [result, setResult] = useState<ClaudeRepairResult | null>(null);
  const [proxy, setProxy] = useState<ClaudeProxyStatus | null>(null);
  const [proxyBusy, setProxyBusy] = useState(false);
  // 折叠态：健康时这张卡平时不需要看,收成一行别把供应商列表顶出首屏;
  // 有事(被劫持/代理不可达/刚修复完/有残留)时**自动展开**,该看见的时候一定看得见
  const [expanded, setExpanded] = useState(false);

  const check = () => {
    setLoading(true);
    setFailed(false);
    setResult(null);
    setApplyError(null);
    Promise.all([
      api.claudeHealth(),
      // status / proxy 端点在旧后端可能不存在 —— 拿不到就当"无"，不影响体检主流程
      api.claudeSwitchStatus().catch(() => null),
      api.claudeProxy().catch(() => null),
    ])
      .then(([h, s, p]) => {
        setHealth(h);
        setStatus(s);
        setProxy(p);
      })
      // 演示站/无后端时静默隐藏（返回 null），不打扰用户
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  };

  // 代理"可管理"：更新为当前系统代理 / 移除改回直连。都会刷新体检 + 代理状态。
  const updateProxy = () => {
    setProxyBusy(true);
    api.syncClaudeProxy().then(() => check()).catch(() => setFailed(true)).finally(() => setProxyBusy(false));
  };
  const removeProxy = () => {
    setProxyBusy(true);
    api.clearClaudeProxy().then(() => check()).catch(() => setFailed(true)).finally(() => setProxyBusy(false));
  };
  useEffect(check, []);

  const repair = () => {
    setRepairing(true);
    api
      .repairClaude()
      .then((r) => {
        setResult(r);
        setHealth(r.health);
      })
      .catch(() => setFailed(true))
      .finally(() => setRepairing(false));
  };

  // AO 主动切换后的"切回官方"：复用后端 restore（删中转 env 键 + 清 AO 标记，写前已备份）
  const restore = () => {
    setRestoring(true);
    api
      .restoreClaude()
      .then((r) => {
        setStatus(r.status);
        check(); // 刷新体检 + 状态
      })
      .catch(() => setFailed(true))
      .finally(() => setRestoring(false));
  };

  // 写入全局：把已配置的 Claude Code 中转写进 ~/.claude/settings.json，让系统 claude 直接用。
  // key 存服务端，前端只传 provider id；未配置中转时后端会返回友好错误提示。
  const applyGlobal = () => {
    setApplying(true);
    setApplyError(null);
    api
      .applyClaude("claude-code")
      .then((r) => {
        setStatus(r.status);
        check(); // 刷新为"已切换（蓝色）"状态
      })
      .catch((e) => setApplyError(e?.message || String(e)))
      .finally(() => setApplying(false));
  };

  // 无后端（演示站）：体检失败就整卡隐藏，不干扰主流程。
  if (failed && !health) return null;

  // AO 主动切换 vs 外部劫持：靠 _aoManagedProvider 标记区分。
  // AO 切的（aoManaged）不报红警，显示"已切到 X · 可一键切回"；只有非 AO 的劫持才算 foreignHijack。
  const aoManaged = !!status?.managed;
  const hijacked = !!health && !health.healthy && !aoManaged;
  const shellRemaining = result?.shellOverridesRemaining ?? Object.keys(health?.shellOverrides ?? {});
  const skipped = result?.skipped ?? health?.files.filter((f) => f.parseError).map((f) => ({ path: f.path, reason: f.parseError! })) ?? [];

  // 这些情况用户必须看到,不吃折叠:被劫持 / 刚执行过修复(要看结果) / 写入报错 /
  // 代理不可达或漂移 / shell 残留 / 有文件被跳过
  const attention = hijacked || !!result || !!applyError
    || proxy?.reachable === false || !!proxy?.drift
    || shellRemaining.length > 0 || skipped.length > 0;
  const open = expanded || attention;

  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3",
        hijacked
          ? "border-red-500/50 bg-red-500/[0.05]"
          : aoManaged
            ? "border-primary/40 bg-primary/[0.04]"
            : "border-border/60 bg-card/50",
      )}
    >
      <div className="flex cursor-pointer select-none items-center gap-2.5" onClick={() => setExpanded((v) => !v)}>
        {loading ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        ) : hijacked ? (
          <ShieldAlert className="size-4 shrink-0 text-red-500" />
        ) : aoManaged ? (
          <ShieldCheck className="size-4 shrink-0 text-primary" />
        ) : (
          <ShieldCheck className="size-4 shrink-0 text-emerald-500" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{tr.title}</span>
          {/* 收起时标题下那行直接给结论(正常/已切换/被劫持),而不是一句固定说明 —— 一行也要有信息量 */}
          <span className={cn("block truncate text-[11px]", !open && !loading
            ? (hijacked ? "font-medium text-red-500" : aoManaged ? "text-primary" : "text-emerald-500")
            : "text-muted-foreground")}>
            {!open && !loading ? (hijacked ? tr.hijacked : aoManaged ? tr.managed : tr.healthy) : tr.subtitle}
          </span>
        </span>
        {/* 收起时代理状态也压缩成一个点:可达绿、不可达红 —— Clash 没开导致连不上时,收着也能看见 */}
        {!open && !loading && proxy?.configured && (
          <span className={cn("hidden shrink-0 items-center gap-1 text-[11px] sm:flex", proxy.reachable === false ? "font-medium text-red-500" : "text-muted-foreground")}>
            <Network className="size-3" />
            {proxy.reachable === false ? tr.proxyUnreachable : tr.proxyReachable}
          </span>
        )}
        <Tip label={tr.recheck}>
          <button
            onClick={(e) => { e.stopPropagation(); check(); }}
            disabled={loading || repairing}
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-border/70 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
          >
            <RotateCw className={cn("size-3.5", loading && "animate-spin")} />
          </button>
        </Tip>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </div>

      {!loading && open && (
        <div className="mt-2.5 space-y-2 text-[12px]">
          {/* 修复完成横幅 */}
          {result?.changed && <p className="font-medium text-emerald-500">✓ {tr.done} · {tr.doneHint}</p>}
          {result?.proxySync?.configured && (
            <p className="font-medium text-emerald-500">✓ {tr.proxySynced} · {result.proxySync.proxyUrl}</p>
          )}
          {result && !result.changed && !hijacked && <p className="text-muted-foreground">{tr.noChange}</p>}

          {/* AO 主动切换：不是"被搞坏"，显示已切到哪、提供一键切回 */}
          {aoManaged && !result && (
            <>
              <p className="font-medium text-primary">{tr.managed}</p>
              {status?.baseUrl && (
                <p className="text-muted-foreground">
                  {tr.managedTo}{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-foreground">
                    {status.managedProviderId ? `${status.managedProviderId} · ` : ""}
                    {status.baseUrl}
                  </code>
                </p>
              )}
              <Button size="sm" variant="outline" onClick={restore} disabled={restoring} className="mt-1">
                {restoring ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Undo2 className="mr-1.5 size-3.5" />}
                {restoring ? tr.restoring : tr.restoreBtn}
              </Button>
            </>
          )}

          {/* 绿灯 + 写入全局（从官方切到已配置的中转） */}
          {!hijacked && !aoManaged && !result && (
            <>
              <p className="font-medium text-emerald-500">{tr.healthy}</p>
              <p className="text-muted-foreground">{tr.connectionRepairHint}</p>
              <Button size="sm" onClick={repair} disabled={repairing} className="mt-1">
                {repairing ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <LifeBuoy className="mr-1.5 size-3.5" />}
                {repairing ? tr.repairing : tr.connectionRepairBtn}
              </Button>
              <p className="text-muted-foreground">{tr.applyHint}</p>
              <Button size="sm" variant="outline" onClick={applyGlobal} disabled={applying} className="mt-1">
                {applying ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Globe className="mr-1.5 size-3.5" />}
                {applying ? tr.applying : tr.applyBtn}
              </Button>
              {applyError && <p className="text-red-500">{applyError}</p>}
            </>
          )}

          {/* 红灯：被劫持 */}
          {hijacked && (
            <>
              <p className="font-medium text-red-500">{tr.hijacked}</p>
              {health?.baseUrl && (
                <p className="text-muted-foreground">
                  {tr.redirectedTo} <code className="rounded bg-muted px-1 py-0.5 text-foreground">{health.baseUrl}</code>
                </p>
              )}
              <Button size="sm" onClick={repair} disabled={repairing} className="mt-1">
                {repairing ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <LifeBuoy className="mr-1.5 size-3.5" />}
                {repairing ? tr.repairing : tr.repairBtn}
              </Button>
            </>
          )}

          {/* 代理「可见 + 可管理」：配了代理就持久显示，探测可达、提示漂移、可更新/移除。
              不埋雷 —— 哪天 Clash 没开导致 claude 连不上，这里会红字标出，而不是让你抓瞎。 */}
          {proxy?.configured && (
            <div
              className={cn(
                "rounded-lg border px-2.5 py-1.5",
                proxy.reachable === false ? "border-red-500/40 bg-red-500/[0.05]" : "border-border/60 bg-muted/30",
              )}
            >
              <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <Network className={cn("size-3.5 shrink-0", proxy.reachable === false ? "text-red-500" : "text-muted-foreground")} />
                <span className="text-muted-foreground">{tr.proxyConfigured}</span>
                <code className="rounded bg-muted px-1 py-0.5 text-foreground">{proxy.configured}</code>
                {proxy.reachable === true && <span className="text-emerald-500">· {tr.proxyReachable}</span>}
                {proxy.reachable === false && <span className="font-medium text-red-500">· {tr.proxyUnreachable}</span>}
              </p>
              {proxy.drift && proxy.systemProxy && (
                <p className="mt-0.5 text-amber-600 dark:text-amber-400">
                  {tr.proxyDrift}（{proxy.systemProxy}）
                </p>
              )}
              <div className="mt-1 flex flex-wrap gap-2">
                {proxy.systemProxy && (proxy.drift || proxy.reachable === false) && (
                  <Button size="sm" variant="outline" onClick={updateProxy} disabled={proxyBusy}>
                    {tr.proxyUpdate}
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={removeProxy} disabled={proxyBusy} className="text-muted-foreground">
                  {proxyBusy ? tr.proxyRemoving : tr.proxyRemove}
                </Button>
              </div>
            </div>
          )}

          {/* 备份提示 */}
          {result?.files.some((f) => f.backup) && <p className="text-muted-foreground">{tr.backupNote}</p>}

          {/* shell 层残留（工具改不了，提示手动删） */}
          {shellRemaining.length > 0 && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/[0.06] px-2.5 py-1.5">
              <p className="text-amber-600 dark:text-amber-400">{tr.shellRemaining}</p>
              <code className="mt-0.5 block break-all text-foreground">{shellRemaining.join("  ")}</code>
            </div>
          )}

          {/* 解析失败被跳过的文件 */}
          {skipped.length > 0 && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/[0.06] px-2.5 py-1.5">
              <p className="text-amber-600 dark:text-amber-400">{tr.skippedNote}</p>
              {skipped.map((s) => (
                <code key={s.path} className="mt-0.5 block break-all text-foreground">
                  {s.path}
                </code>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
