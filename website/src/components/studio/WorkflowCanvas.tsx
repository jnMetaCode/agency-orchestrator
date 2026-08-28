// 工作流可视化画布（可编辑）。借鉴 n8n 的节点编辑交互，但用 AO 自己的 React 栈
// (@xyflow/react + dagre)实现，绑定到 AO 的 YAML/角色模型。
// graph 转换在引擎侧（保真往返），保存走 /api/workflows/graph（带成环校验 + 用户工作流就地覆盖）。
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  addEdge,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import { CheckCircle2, Loader2, Plus, Save, Trash2, Wand2, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, type CanvasEdge, type CanvasNode, type Role } from "@/lib/studio";
import { useRunManager } from "./RunManager";

const NODE_W = 230;
const NODE_H = 92;

type StepData = Record<string, unknown>;

/** 执行态（Phase 2 点亮）：运行工作流时按步状态给节点着色。 */
type ExecStatus = "running" | "done" | "error" | "pending";
const ExecStatusCtx = createContext<Record<string, ExecStatus>>({});

/** dagre 自动布局（rankdir LR，参考 n8n）。 */
function autoLayout(nodes: { id: string; position: { x: number; y: number } }[], edges: { source: string; target: string }[]) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 48, ranksep: 96, marginx: 24, marginy: 24 });
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return new Map(nodes.map((n) => {
    const p = g.node(n.id);
    return [n.id, { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 }];
  }));
}

/** 加入 source→target 后是否成环（target 已能到达 source）。 */
function wouldCycle(source: string, target: string, edges: { source: string; target: string }[]): boolean {
  if (source === target) return true;
  const adj = new Map<string, string[]>();
  for (const e of edges) (adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push(e.target);
  const seen = new Set<string>();
  const stack = [target];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === source) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const nx of adj.get(cur) ?? []) stack.push(nx);
  }
  return false;
}

function AOStepNode({ id, data, selected }: NodeProps<Node<StepData>>) {
  const role = String(data.role ?? "");
  const isApproval = data.type === "approval" || data.type === "human_input";
  const exec = useContext(ExecStatusCtx)[id];
  // 执行态边框优先于普通态：运行中=蓝(脉冲)、成功=绿、失败=红
  const execBorder =
    exec === "running" ? "border-blue-500 ring-2 ring-blue-500/40 animate-pulse"
    : exec === "done" ? "border-emerald-500"
    : exec === "error" ? "border-red-500 ring-2 ring-red-500/40"
    : "";
  return (
    <div
      className={`rounded-xl border bg-card px-3 py-2 shadow-sm ${execBorder || (selected ? "border-primary ring-2 ring-primary/40" : isApproval ? "border-amber-500/60" : "border-border/70")}`}
      style={{ width: NODE_W }}
    >
      <Handle type="target" position={Position.Left} className="!size-2.5 !bg-primary/60" />
      <div className="flex items-center gap-1.5">
        <span className="text-base leading-none">{String(data.emoji ?? "") || (isApproval ? "✋" : "🤖")}</span>
        <span className="truncate text-sm font-semibold">{String(data.name ?? "") || role || (data.type === "approval" ? "签字闸门" : data.type === "human_input" ? "等待输入" : "")}</span>
        {exec === "running" && <Loader2 className="size-3.5 shrink-0 animate-spin text-blue-500" />}
        {exec === "done" && <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />}
        {exec === "error" && <XCircle className="size-3.5 shrink-0 text-red-500" />}
        {!exec && !!data.skill && <span className="ml-auto rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">{String(data.skill)}</span>}
      </div>
      <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{String(data.task ?? data.prompt ?? "") || "—"}</p>
      <Handle type="source" position={Position.Right} className="!size-2.5 !bg-primary/60" />
    </div>
  );
}

const nodeTypes = { aoStep: AOStepNode };

function toRfNode(n: CanvasNode): Node<StepData> {
  return { id: n.id, type: "aoStep", position: n.position, data: { ...n.data, id: n.id } };
}

/** 取某个节点上的 assert（没有就当空对象），避免每处都写一遍类型断言。 */
function assertOf(n: { data?: Record<string, unknown> } | null | undefined): Record<string, unknown> {
  return ((n?.data as Record<string, unknown> | undefined)?.assert ?? {}) as Record<string, unknown>;
}

export function WorkflowCanvas({ file, name, onClose, onSaved }: { file: string; name: string; onClose: () => void; onSaved?: (newFile: string) => void }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<StepData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [editable, setEditable] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const idSeq = useRef(1);

  // Phase 2 执行态点亮：找本工作流最近一次运行，按步状态着色（随 SSE 实时更新）。
  const { runs } = useRunManager();
  const activeRun = useMemo(
    () => [...runs].reverse().find((r) => r.kind === "workflow" && r.source?.file === file),
    [runs, file],
  );
  const execStatus = useMemo<Record<string, ExecStatus>>(() => {
    if (!activeRun) return {};
    const map: Record<string, ExecStatus> = {};
    for (const s of activeRun.steps) {
      map[s.id] = s.status === "done" ? "done"
        : s.status === "running" ? (activeRun.state === "error" ? "error" : "running") // 失败时停在该步 → 红
        : "pending";
    }
    return map;
  }, [activeRun]);
  const isRunning = activeRun?.state === "running";

  useEffect(() => {
    let alive = true;
    api.roles().then((r) => alive && setRoles(r)).catch(() => {});
    api
      .workflowGraph(file)
      .then((g) => {
        if (!alive) return;
        const needsLayout = g.nodes.every((n) => n.position.x === 0 && n.position.y === 0);
        const pos = needsLayout ? autoLayout(g.nodes, g.edges) : null;
        setNodes(g.nodes.map((n) => toRfNode(pos ? { ...n, position: pos.get(n.id)! } : n)));
        setEdges(g.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })));
        setEditable(g.editable);
        setLoaded(true);
      })
      .catch((e) => alive && setErr(e?.message || "加载失败"));
    return () => { alive = false; };
  }, [file, setNodes, setEdges]);

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return;
      setEdges((eds) => {
        if (eds.some((e) => e.source === conn.source && e.target === conn.target)) return eds;
        if (wouldCycle(conn.source!, conn.target!, eds)) {
          setMsg("⚠️ 不能连成环——工作流必须是有向无环图");
          return eds;
        }
        setMsg(null);
        return addEdge({ id: `${conn.source}->${conn.target}`, source: conn.source!, target: conn.target! }, eds);
      });
    },
    [setEdges],
  );

  const selected = useMemo(() => nodes.find((n) => n.id === selectedId) ?? null, [nodes, selectedId]);

  const patchSelected = useCallback(
    (patch: StepData) => {
      if (!selectedId) return;
      setNodes((nds) => nds.map((n) => (n.id === selectedId ? { ...n, data: { ...n.data, ...patch } } : n)));
    },
    [selectedId, setNodes],
  );

  /**
   * 机械检查（assert）的合并写入。
   * ⚠️ 必须 **合并** 而不是整个替换：`matches`（正则→次数）这一档故意不在界面上暴露
   * （面向零代码用户，正则不该出现在这里），但它会随 YAML 原样带进来。
   * 如果这里直接覆盖整个 assert，用户在界面上改一下字数，手写的 matches 就被静默洗掉了。
   */
  const patchAssert = useCallback(
    (kv: Record<string, unknown>) => {
      const cur = ((selected?.data as Record<string, unknown> | undefined)?.assert ?? {}) as Record<string, unknown>;
      const next: Record<string, unknown> = { ...cur, ...kv };
      for (const k of Object.keys(next)) {
        const v = next[k];
        if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) delete next[k];
      }
      // 空对象等于没写（引擎那边空 assert 会在解析期报错），所以清空时要整个删掉
      patchSelected({ assert: Object.keys(next).length ? next : undefined } as StepData);
    },
    [selected, patchSelected],
  );

  const addStep = useCallback(() => {
    let id = `step_${idSeq.current++}`;
    while (nodes.some((n) => n.id === id)) id = `step_${idSeq.current++}`;
    const defaultRole = roles[0] ? `${roles[0].category}/${roles[0].id}` : "";
    const node: Node<StepData> = {
      id,
      type: "aoStep",
      position: { x: 80 + nodes.length * 24, y: 80 + nodes.length * 24 },
      data: { id, role: defaultRole, task: "" },
    };
    setNodes((nds) => [...nds, node]);
    setSelectedId(id);
  }, [nodes, roles, setNodes]);

  const relayout = useCallback(() => {
    const pos = autoLayout(nodes, edges);
    setNodes((nds) => nds.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position })));
  }, [nodes, edges, setNodes]);

  const save = useCallback(async () => {
    setSaving(true);
    setMsg(null);
    try {
      const outNodes: CanvasNode[] = nodes.map((n) => ({ id: n.id, position: n.position, data: { ...n.data, id: n.id } }));
      const outEdges: CanvasEdge[] = edges.map((e) => ({ id: e.id, source: e.source, target: e.target }));
      const res = await api.saveWorkflowGraph({ file, name, nodes: outNodes, edges: outEdges });
      const fixNote = res.autoFixes?.length ? `，自动补了 ${res.autoFixes.length} 条缺失的依赖连线` : "";
      setMsg(`✅ ${res.overwritten ? "已保存（就地覆盖）" : "已另存为新工作流"}${fixNote}`);
      // 服务端补了边的话，把画布同步成落盘后的真实形状（否则用户看到的图少几条线）
      if (res.autoFixes?.length) {
        setEdges((eds) => {
          const next = [...eds];
          for (const f of res.autoFixes!) {
            if (!next.some((e) => e.source === f.addedDep && e.target === f.step)) {
              next.push({ id: `${f.addedDep}->${f.step}`, source: f.addedDep, target: f.step });
            }
          }
          return next;
        });
      }
      onSaved?.(res.file);
    } catch (e: any) {
      // postJSON 把结构化错误体挂在 e.body 上——之前读 e.errors 永远是 undefined，
      // 用户只看到 "invalid workflow"，不知道哪步错（#91 的"删了还是报错"体感来源）
      const errs = (e?.body?.errors ?? e?.errors) as string[] | undefined;
      setMsg(`❌ 保存失败：${errs?.length ? errs.join("；") : e?.message || "未知错误"}`);
    } finally {
      setSaving(false);
    }
  }, [nodes, edges, file, name, onSaved, setEdges]);

  const stop = useCallback((e: React.MouseEvent) => e.stopPropagation(), []);

  return (
    <ExecStatusCtx.Provider value={execStatus}>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex h-[85vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border/60 bg-background shadow-xl" onClick={stop}>
        {/* 工具栏 */}
        <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
          <span className="truncate text-sm font-semibold">🗺️ {name}</span>
          {loaded && !editable && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">内置模板 · 编辑后将另存为副本</span>}
          {activeRun && (
            <span className="flex items-center gap-2 rounded-full bg-muted/60 px-2.5 py-0.5 text-[10px] text-muted-foreground">
              {isRunning ? <Loader2 className="size-3 animate-spin text-blue-500" /> : activeRun.state === "error" ? <XCircle className="size-3 text-red-500" /> : <CheckCircle2 className="size-3 text-emerald-500" />}
              {isRunning ? "运行中" : activeRun.state === "error" ? "失败" : "已完成"} · 执行态已点亮
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={addStep} disabled={!loaded} title="添加步骤">
              <Plus className="size-3.5" /> 步骤
            </Button>
            <Button size="sm" variant="outline" onClick={relayout} disabled={!loaded} title="自动布局">
              <Wand2 className="size-3.5" /> 布局
            </Button>
            <Button size="sm" onClick={save} disabled={!loaded || saving}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              {editable ? "保存" : "另存为副本"}
            </Button>
            <button onClick={onClose} className="ml-1 text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>
        </div>

        {msg && <div className="border-b border-border/60 bg-muted/30 px-4 py-1.5 text-xs">{msg}</div>}

        <div className="relative flex flex-1 overflow-hidden">
          {err ? (
            <p className="grid h-full w-full place-items-center text-sm text-red-500">{err}</p>
          ) : !loaded ? (
            <div className="grid h-full w-full place-items-center text-sm text-muted-foreground">
              <span className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> 加载工作流图…</span>
            </div>
          ) : (
            <>
              <div className="flex-1">
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  onNodeClick={(_, n) => setSelectedId(n.id)}
                  onPaneClick={() => setSelectedId(null)}
                  deleteKeyCode={["Backspace", "Delete"]}
                  fitView
                  proOptions={{ hideAttribution: true }}
                >
                  <Background />
                  <Controls showInteractive={false} />
                  <MiniMap pannable zoomable />
                </ReactFlow>
              </div>

              {/* 节点编辑侧栏 */}
              {selected && (
                <div className="w-72 shrink-0 overflow-y-auto border-l border-border/60 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-semibold">编辑步骤</span>
                    <button onClick={() => setSelectedId(null)} className="text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button>
                  </div>
                  <label className="mb-1 block text-xs text-muted-foreground">步骤 id</label>
                  <div className="mb-3 truncate rounded-lg bg-muted/50 px-2.5 py-1.5 text-xs">{selected.id}</div>

                  {selected.data.type === "approval" || selected.data.type === "human_input" ? (
                    <>
                      {/* 签字闸门 / 等待输入节点：没有 role/task，只编辑提示语 */}
                      <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/[0.08] px-2.5 py-1.5 text-xs text-amber-600 dark:text-amber-400">
                        {selected.data.type === "approval" ? "✋ 签字闸门：运行到此暂停，等你放行" : "✋ 等待输入：运行到此暂停，等你回答"}
                      </div>
                      <label className="mb-1 block text-xs text-muted-foreground">提示语（支持 {"{{变量}}"}）</label>
                      <textarea
                        value={String(selected.data.prompt ?? "")}
                        onChange={(e) => patchSelected({ prompt: e.target.value })}
                        rows={6}
                        className="mb-4 w-full resize-y rounded-lg border border-border/70 bg-background px-2.5 py-2 text-xs outline-none focus:border-primary/50"
                      />
                    </>
                  ) : (
                    <>
                  <label className="mb-1 block text-xs text-muted-foreground">角色</label>
                  <select
                    value={String(selected.data.role ?? "")}
                    onChange={(e) => patchSelected({ role: e.target.value })}
                    className="mb-3 h-9 w-full rounded-lg border border-border/70 bg-background px-2 text-xs outline-none focus:border-primary/50"
                  >
                    {!roles.some((r) => `${r.category}/${r.id}` === selected.data.role) && (
                      <option value={String(selected.data.role ?? "")}>{String(selected.data.role ?? "(未选)")}</option>
                    )}
                    {roles.map((r) => {
                      const path = `${r.category}/${r.id}`;
                      return <option key={path} value={path}>{r.name}（{r.categoryName}）</option>;
                    })}
                  </select>

                  <label className="mb-1 block text-xs text-muted-foreground">显示名（可选）</label>
                  <input
                    value={String(selected.data.name ?? "")}
                    onChange={(e) => patchSelected({ name: e.target.value || undefined })}
                    className="mb-3 h-9 w-full rounded-lg border border-border/70 bg-background px-2.5 text-xs outline-none focus:border-primary/50"
                  />

                  <label className="mb-1 block text-xs text-muted-foreground">任务（支持 {"{{变量}}"}）</label>
                  <textarea
                    value={String(selected.data.task ?? "")}
                    onChange={(e) => patchSelected({ task: e.target.value })}
                    rows={6}
                    className="mb-3 w-full resize-y rounded-lg border border-border/70 bg-background px-2.5 py-2 text-xs outline-none focus:border-primary/50"
                  />

                  <label className="mb-1 block text-xs text-muted-foreground">验收标准（可选，产出必须满足）</label>
                  <textarea
                    value={String(selected.data.acceptance ?? "")}
                    onChange={(e) => patchSelected({ acceptance: e.target.value || undefined })}
                    rows={3}
                    placeholder={"1. 可核对的条件…\n2. …"}
                    className="mb-3 w-full resize-y rounded-lg border border-border/70 bg-background px-2.5 py-2 text-xs outline-none focus:border-primary/50"
                  />

                  <label className="mb-1 block text-xs text-muted-foreground">
                    机械检查（可选，不问 AI，直接数）
                  </label>
                  <p className="mb-1.5 text-[11px] leading-relaxed text-muted-foreground/80">
                    上面的「验收标准」是让 AI 判内容好不好；这里是脚本直接数结构。
                    差一个文件、被截断这类问题 AI 判不出来——它看不见「本该有几个」。
                  </p>
                  <div className="mb-2 grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      min={0}
                      value={String(assertOf(selected).emits_files ?? "")}
                      onChange={(e) => patchAssert({ emits_files: e.target.value === "" ? undefined : Number(e.target.value) })}
                      placeholder="必须产出几个文件"
                      className="h-9 w-full rounded-lg border border-border/70 bg-background px-2.5 text-xs outline-none focus:border-primary/50"
                    />
                    <input
                      type="number"
                      min={0}
                      value={String(assertOf(selected).min_bytes ?? "")}
                      onChange={(e) => patchAssert({ min_bytes: e.target.value === "" ? undefined : Number(e.target.value) })}
                      placeholder="最少多少字节（防截断）"
                      className="h-9 w-full rounded-lg border border-border/70 bg-background px-2.5 text-xs outline-none focus:border-primary/50"
                    />
                    <input
                      type="number"
                      min={0}
                      value={String(assertOf(selected).max_bytes ?? "")}
                      onChange={(e) => patchAssert({ max_bytes: e.target.value === "" ? undefined : Number(e.target.value) })}
                      placeholder="最多多少字节（防写飞）"
                      className="h-9 w-full rounded-lg border border-border/70 bg-background px-2.5 text-xs outline-none focus:border-primary/50"
                    />
                  </div>
                  <textarea
                    value={(assertOf(selected).contains as string[] | undefined)?.join("\n") ?? ""}
                    onChange={(e) => patchAssert({ contains: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })}
                    rows={2}
                    placeholder={"必须出现的内容，每行一条"}
                    className="mb-3 w-full resize-y rounded-lg border border-border/70 bg-background px-2.5 py-2 text-xs outline-none focus:border-primary/50"
                  />

                  <label className="mb-1 block text-xs text-muted-foreground">skill（可选）</label>
                  <input
                    value={String(selected.data.skill ?? "")}
                    onChange={(e) => patchSelected({ skill: e.target.value || undefined })}
                    placeholder="如 test-driven-development"
                    className="mb-4 h-9 w-full rounded-lg border border-border/70 bg-background px-2.5 text-xs outline-none focus:border-primary/50"
                  />
                    </>
                  )}

                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full text-red-500 hover:text-red-600"
                    onClick={() => {
                      setNodes((nds) => nds.filter((n) => n.id !== selected.id));
                      setEdges((eds) => eds.filter((e) => e.source !== selected.id && e.target !== selected.id));
                      setSelectedId(null);
                    }}
                  >
                    <Trash2 className="size-3.5" /> 删除此步骤
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
    </ExecStatusCtx.Provider>
  );
}
