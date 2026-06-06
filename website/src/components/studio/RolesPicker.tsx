import { Check, Loader2, MessageSquare, Search, Sparkles, Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, type ComposeResult, type Role, type Workflow } from "@/lib/studio";
import { cn } from "@/lib/utils";
import { ComposePreview } from "./ComposePreview";
import { RoleAvatar } from "./RoleAvatar";
import { RoleDetail } from "./RoleDetail";
import type { RunRequest } from "./RunManager";

function roleKey(r: Role) {
  return `${r.category}/${r.id}`;
}

export function RolesPicker({
  provider,
  onRun,
  onGoToWorkflows,
}: {
  provider: string;
  onRun: (r: RunRequest) => void;
  onGoToWorkflows?: () => void;
}) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [selected, setSelected] = useState<Record<string, Role>>({});

  // compose tray state
  const [task, setTask] = useState("");
  const [teamName, setTeamName] = useState("");
  const [composing, setComposing] = useState(false);
  const [composeErr, setComposeErr] = useState<string | null>(null);
  const [detail, setDetail] = useState<Role | null>(null);
  const [preview, setPreview] = useState<{ result: ComposeResult; meta: Workflow | null; loading: boolean } | null>(null);

  useEffect(() => {
    api
      .roles()
      .then((r) => setRoles(r))
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  const categories = useMemo(() => {
    const map = new Map<string, string>();
    roles.forEach((r) => map.set(r.category, r.categoryName || r.category));
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [roles]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return roles.filter((r) => {
      if (cat !== "all" && r.category !== cat) return false;
      if (!needle) return true;
      return (r.name + r.description + r.categoryName).toLowerCase().includes(needle);
    });
  }, [roles, q, cat]);

  const selectedList = Object.values(selected);
  const count = selectedList.length;

  const toggle = (r: Role) => {
    setComposeErr(null);
    setSelected((prev) => {
      const key = roleKey(r);
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = r;
      return next;
    });
  };

  const clearSel = () => setSelected({});

  const doSingleChat = () => {
    const r = selectedList[0];
    if (!r || !task.trim()) return;
    onRun({ kind: "role", title: `单独对话 · ${r.name}`, role: roleKey(r), emoji: undefined, name: r.name, task: task.trim(), provider });
  };

  const doComposeRun = async () => {
    if (count < 2 || !task.trim()) return;
    setComposing(true);
    setComposeErr(null);
    try {
      const res = await api.compose({
        description: task.trim(),
        roles: selectedList.map(roleKey),
        name: teamName.trim() || undefined,
        provider: provider || undefined,
      });
      // Preview the composed team before running (not a black box).
      setPreview({ result: res, meta: null, loading: true });
      try {
        const wfs = await api.workflows();
        const meta = wfs.find((w) => w.file === res.file) ?? null;
        setPreview({ result: res, meta, loading: false });
      } catch {
        setPreview({ result: res, meta: null, loading: false });
      }
    } catch (e: any) {
      setComposeErr(e?.message || "合成失败");
    } finally {
      setComposing(false);
    }
  };

  if (loading)
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> 加载角色…
      </div>
    );
  if (err) return <p className="py-20 text-center text-sm text-red-500">加载角色失败：{err}</p>;

  return (
    <div className="pb-40">
      {/* onboarding hint */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border/60 bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
        <span>💡 用法:</span>
        <span><b className="text-foreground">勾 1 个</b> → 单独对话</span>
        <span><b className="text-foreground">勾 2 个以上</b> → AI 合成团队并运行</span>
        <span>点<b className="text-foreground">头像</b>看角色详情</span>
      </div>

      {/* filter bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索角色…"
            className="h-10 w-full rounded-xl border border-border/70 bg-card/60 pl-9 pr-3 text-sm outline-none focus:border-primary/50"
          />
        </div>
        <span className="text-sm text-muted-foreground">{filtered.length} 个角色</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <button
          onClick={() => setCat("all")}
          className={cn(
            "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
            cat === "all" ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:text-foreground",
          )}
        >
          全部
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setCat(c.id)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              cat === c.id ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:text-foreground",
            )}
          >
            {c.name}
          </button>
        ))}
      </div>

      {/* role grid */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((r) => {
          const key = roleKey(r);
          const on = !!selected[key];
          return (
            <button
              key={key}
              onClick={() => toggle(r)}
              className={cn(
                "group relative flex flex-col rounded-2xl border bg-card/60 p-4 text-left transition-all hover:-translate-y-0.5",
                on ? "border-primary ring-1 ring-primary/40" : "border-border/70 hover:border-primary/40",
              )}
            >
              <span
                className={cn(
                  "absolute right-3 top-3 grid size-5 place-items-center rounded-md border transition-colors",
                  on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background",
                )}
              >
                {on && <Check className="size-3.5" />}
              </span>
              <div className="flex items-center gap-3">
                <span
                  role="button"
                  tabIndex={0}
                  title="查看角色详情"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDetail(r);
                  }}
                  className="rounded-full ring-offset-2 ring-offset-card transition-shadow hover:ring-2 hover:ring-primary/50"
                >
                  <RoleAvatar seed={key} name={r.name} color={r.color} className="size-12" />
                </span>
                <div className="min-w-0 pr-5">
                  <span className="block text-xs font-medium text-primary">{r.categoryName}</span>
                  <span className="block truncate font-semibold">{r.name}</span>
                </div>
              </div>
              <span className="mt-2.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{r.description}</span>
            </button>
          );
        })}
      </div>

      {/* selection tray */}
      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/95 backdrop-blur-xl">
          <div className="container-page py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-sm font-semibold text-primary">
                  {count >= 2 ? <Users className="size-4" /> : <MessageSquare className="size-4" />}
                  已选 {count}
                </span>
                <div className="hidden min-w-0 gap-1.5 overflow-x-auto sm:flex">
                  {selectedList.map((r) => (
                    <span
                      key={roleKey(r)}
                      className="flex shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-muted/50 py-1 pl-1 pr-2.5 text-xs"
                    >
                      <RoleAvatar seed={roleKey(r)} name={r.name} color={r.color} className="size-5" />
                      {r.name}
                    </span>
                  ))}
                </div>
              </div>
              <button onClick={clearSel} className="shrink-0 text-xs text-muted-foreground hover:text-foreground">
                <X className="mr-1 inline size-3.5" />
                清空
              </button>
            </div>

            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
              {count >= 2 && (
                <input
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder="团队名称（可留空自动命名）"
                  className="h-10 rounded-xl border border-border/70 bg-card/60 px-3 text-sm outline-none focus:border-primary/50 sm:w-56"
                />
              )}
              <input
                value={task}
                onChange={(e) => setTask(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (count >= 2 ? doComposeRun() : doSingleChat());
                }}
                placeholder={count >= 2 ? "这个团队要完成什么？（AI 据此设计步骤）" : "想问这个角色什么？"}
                className="h-10 flex-1 rounded-xl border border-border/70 bg-card/60 px-3 text-sm outline-none focus:border-primary/50"
              />
              {count >= 2 ? (
                <Button onClick={doComposeRun} disabled={composing || !task.trim()}>
                  {composing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  合成团队并运行
                </Button>
              ) : (
                <Button onClick={doSingleChat} disabled={!task.trim()}>
                  <MessageSquare className="size-4" />
                  单独对话
                </Button>
              )}
            </div>
            {composeErr && <p className="mt-2 text-xs text-red-500">{composeErr}</p>}
          </div>
        </div>
      )}

      {detail && <RoleDetail role={detail} provider={provider} onClose={() => setDetail(null)} onRun={onRun} />}
      {preview && (
        <ComposePreview
          result={preview.result}
          meta={preview.meta}
          loadingMeta={preview.loading}
          provider={provider}
          onRun={onRun}
          onClose={() => setPreview(null)}
          onGoToWorkflows={
            onGoToWorkflows
              ? () => {
                  setPreview(null);
                  onGoToWorkflows();
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
