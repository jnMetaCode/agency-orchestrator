import { LifeBuoy, Loader2, RotateCw, ShieldAlert, ShieldCheck, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tip";
import { useLanguage } from "@/i18n/LanguageProvider";
import { api, type ClaudeHealth, type ClaudeRepairResult, type ClaudeSwitchStatus } from "@/lib/studio";
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
  const [result, setResult] = useState<ClaudeRepairResult | null>(null);

  const check = () => {
    setLoading(true);
    setFailed(false);
    setResult(null);
    Promise.all([
      api.claudeHealth(),
      // status 端点在旧后端可能不存在 —— 拿不到就当"未管理"，不影响体检主流程
      api.claudeSwitchStatus().catch(() => null),
    ])
      .then(([h, s]) => {
        setHealth(h);
        setStatus(s);
      })
      // 演示站/无后端时静默隐藏（返回 null），不打扰用户
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
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

  // 无后端（演示站）：体检失败就整卡隐藏，不干扰主流程。
  if (failed && !health) return null;

  // AO 主动切换 vs 外部劫持：靠 _aoManagedProvider 标记区分。
  // AO 切的（aoManaged）不报红警，显示"已切到 X · 可一键切回"；只有非 AO 的劫持才算 foreignHijack。
  const aoManaged = !!status?.managed;
  const hijacked = !!health && !health.healthy && !aoManaged;
  const shellRemaining = result?.shellOverridesRemaining ?? Object.keys(health?.shellOverrides ?? {});
  const skipped = result?.skipped ?? health?.files.filter((f) => f.parseError).map((f) => ({ path: f.path, reason: f.parseError! })) ?? [];

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
      <div className="flex items-center gap-2.5">
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
          <span className="block text-[11px] text-muted-foreground">{tr.subtitle}</span>
        </span>
        <Tip label={tr.recheck}>
          <button
            onClick={check}
            disabled={loading || repairing}
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-border/70 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
          >
            <RotateCw className={cn("size-3.5", loading && "animate-spin")} />
          </button>
        </Tip>
      </div>

      {!loading && (
        <div className="mt-2.5 space-y-2 text-[12px]">
          {/* 修复完成横幅 */}
          {result?.changed && (
            <p className="font-medium text-emerald-500">
              ✓ {tr.done} · {tr.doneHint}
            </p>
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

          {/* 绿灯 */}
          {!hijacked && !aoManaged && !result && <p className="font-medium text-emerald-500">{tr.healthy}</p>}

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
