import { Boxes, History, KeyRound, Users } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { KeysDialog } from "@/components/studio/KeysDialog";
import { RolesPicker } from "@/components/studio/RolesPicker";
import { RunDock } from "@/components/studio/RunDock";
import { RunProvider, useRunManager } from "@/components/studio/RunManager";
import { RunViewer } from "@/components/studio/RunViewer";
import { RunsPanel } from "@/components/studio/RunsPanel";
import { StudioGate } from "@/components/studio/StudioGate";
import { WorkflowsPanel } from "@/components/studio/WorkflowsPanel";
import { useBackend } from "@/components/studio/useBackend";
import { PROVIDERS } from "@/lib/studio";
import { cn } from "@/lib/utils";

type Tab = "roles" | "workflows" | "runs";

const TABS: { id: Tab; label: string; icon: typeof Users; hint: string }[] = [
  { id: "roles", label: "角色组队", icon: Users, hint: "勾 1 个对话 · 勾多个合成团队" },
  { id: "workflows", label: "工作流", icon: Boxes, hint: "运行模板 · 勾多个对比" },
  { id: "runs", label: "运行历史", icon: History, hint: "查看产物 · 从某步重跑" },
];

function StudioInner() {
  const { status, version, recheck } = useBackend();
  const { start, open } = useRunManager();
  const [tab, setTab] = useState<Tab>("roles");
  const [provider, setProvider] = useState("");
  const [keysOpen, setKeysOpen] = useState(false);

  return (
    <>
      <main className="pt-20">
        <div className="border-b border-border/60 bg-muted/20">
          <div className="container-page py-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-2xl font-extrabold tracking-tight">Studio</h1>
                <p className="mt-1 text-sm text-muted-foreground">勾选角色组队、运行工作流、迭代重跑——全部本地真跑。</p>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
                    status === "online" && "bg-emerald-500/15 text-emerald-500",
                    status === "offline" && "bg-red-500/15 text-red-500",
                    status === "checking" && "bg-muted text-muted-foreground",
                  )}
                >
                  <span className={cn("size-1.5 rounded-full", status === "online" ? "bg-emerald-500" : status === "offline" ? "bg-red-500" : "bg-muted-foreground")} />
                  {status === "online" ? `引擎在线 v${version ?? ""}` : status === "offline" ? "引擎离线" : "检测中"}
                </span>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Provider
                  <select
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    className="h-9 rounded-lg border border-border/70 bg-card/60 px-2 text-sm text-foreground outline-none"
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p} value={p}>
                        {p || "默认"}
                      </option>
                    ))}
                  </select>
                </label>
                <Button size="sm" variant="outline" onClick={() => setKeysOpen(true)}>
                  <KeyRound className="size-4" />
                  密钥
                </Button>
              </div>
            </div>

            {status === "online" && (
              <div className="mt-5 flex flex-wrap gap-2">
                {TABS.map((tb) => {
                  const Icon = tb.icon;
                  const on = tab === tb.id;
                  return (
                    <button
                      key={tb.id}
                      onClick={() => setTab(tb.id)}
                      className={cn(
                        "flex items-center gap-2 rounded-xl border px-4 py-2.5 text-left transition-colors",
                        on ? "border-primary bg-primary/10" : "border-border/70 bg-card/60 hover:border-primary/40",
                      )}
                    >
                      <Icon className={cn("size-4", on ? "text-primary" : "text-muted-foreground")} />
                      <span>
                        <span className={cn("block text-sm font-semibold", on && "text-primary")}>{tb.label}</span>
                        <span className="block text-[11px] text-muted-foreground">{tb.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="container-page py-8">
          {status !== "online" ? (
            <StudioGate checking={status === "checking"} onRetry={recheck} />
          ) : tab === "roles" ? (
            <RolesPicker provider={provider} onRun={start} />
          ) : tab === "workflows" ? (
            <WorkflowsPanel provider={provider} onRun={start} />
          ) : (
            <RunsPanel provider={provider} onRun={start} />
          )}
        </div>
      </main>

      <RunViewer
        onViewHistory={() => {
          open(null);
          setTab("runs");
        }}
      />
      <RunDock />
      {keysOpen && <KeysDialog onClose={() => setKeysOpen(false)} />}
      <SiteFooter />
    </>
  );
}

export default function Studio() {
  return (
    <RunProvider>
      <StudioInner />
    </RunProvider>
  );
}
