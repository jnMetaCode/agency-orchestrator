import { Check, GitCompare, Loader2, Play, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, type Workflow } from "@/lib/studio";
import { cn } from "@/lib/utils";
import { RoleAvatar } from "./RoleAvatar";
import type { RunRequest } from "./RunManager";
import { CompareOverlay } from "./CompareOverlay";

function CastStack({ steps }: { steps: NonNullable<Workflow["steps"]> }) {
  const shown = steps.slice(0, 6);
  const extra = steps.length - shown.length;
  return (
    <div className="flex items-center">
      <div className="flex -space-x-2">
        {shown.map((s, i) => (
          <RoleAvatar
            key={s.id}
            seed={s.role || s.id}
            name={s.name ?? s.id}
            title={s.name ?? s.id}
            className="size-8 ring-2 ring-card"
            style={{ zIndex: shown.length - i }}
          />
        ))}
      </div>
      {extra > 0 && <span className="ml-2 text-xs text-muted-foreground">+{extra}</span>}
    </div>
  );
}

function InputsDialog({ wf, provider, onClose, onRun }: { wf: Workflow; provider: string; onClose: () => void; onRun: (r: RunRequest) => void }) {
  const inputs = wf.inputs ?? [];
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    inputs.forEach((i) => (init[i.name] = i.default ?? ""));
    return init;
  });

  const submit = () => {
    onRun({ kind: "workflow", title: wf.name, file: wf.file, inputs: vals, provider: provider || undefined, cast: wf.steps });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[55] grid place-items-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-border/70 bg-background p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{wf.name}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        {wf.description && <p className="mt-1 text-sm text-muted-foreground">{wf.description}</p>}
        <div className="mt-4 space-y-3">
          {inputs.map((inp) => (
            <label key={inp.name} className="block">
              <span className="text-sm font-medium">
                {inp.name}
                {inp.required && <span className="text-red-500"> *</span>}
              </span>
              {inp.description && <span className="block text-xs text-muted-foreground">{inp.description}</span>}
              <textarea
                value={vals[inp.name] ?? ""}
                onChange={(e) => setVals((p) => ({ ...p, [inp.name]: e.target.value }))}
                rows={2}
                className="mt-1 w-full rounded-xl border border-border/70 bg-card/60 px-3 py-2 text-sm outline-none focus:border-primary/50"
              />
            </label>
          ))}
          {!inputs.length && <p className="text-sm text-muted-foreground">该工作流无需输入，可直接运行。</p>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit}>
            <Play className="size-4" />
            运行
          </Button>
        </div>
      </div>
    </div>
  );
}

export function WorkflowsPanel({ provider, onRun }: { provider: string; onRun: (r: RunRequest) => void }) {
  const [wfs, setWfs] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Record<string, Workflow>>({});
  const [inputsFor, setInputsFor] = useState<Workflow | null>(null);
  const [compare, setCompare] = useState<Workflow[] | null>(null);

  useEffect(() => {
    api
      .workflows()
      .then(setWfs)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return wfs.filter((w) => !n || (w.name + (w.description ?? "")).toLowerCase().includes(n));
  }, [wfs, q]);

  const pickedList = Object.values(picked);

  const togglePick = (w: Workflow) =>
    setPicked((p) => {
      const n = { ...p };
      if (n[w.file]) delete n[w.file];
      else n[w.file] = w;
      return n;
    });

  const runOne = (w: Workflow) => {
    if (w.inputs && w.inputs.length) setInputsFor(w);
    else onRun({ kind: "workflow", title: w.name, file: w.file, provider: provider || undefined, cast: w.steps });
  };

  if (loading)
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> 加载工作流…
      </div>
    );
  if (err) return <p className="py-20 text-center text-sm text-red-500">加载失败：{err}</p>;

  return (
    <div className="pb-28">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索工作流模板…"
          className="h-10 w-full rounded-xl border border-border/70 bg-card/60 pl-9 pr-3 text-sm outline-none focus:border-primary/50"
        />
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((w) => {
          const on = !!picked[w.file];
          return (
            <div
              key={w.file}
              className={cn(
                "flex flex-col rounded-2xl border bg-card/60 p-4 transition-colors",
                on ? "border-primary ring-1 ring-primary/40" : "border-border/70",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold leading-snug">{w.name}</h3>
                <button
                  onClick={() => togglePick(w)}
                  title="勾选以对比运行"
                  className={cn(
                    "grid size-5 shrink-0 place-items-center rounded-md border transition-colors",
                    on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background",
                  )}
                >
                  {on && <Check className="size-3.5" />}
                </button>
              </div>
              {w.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{w.description}</p>}
              {!!(w.steps && w.steps.length) && (
                <div className="mt-3">
                  <CastStack steps={w.steps} />
                </div>
              )}
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {w.steps?.length ?? 0} 步{w.private ? " · 我的" : ""}
                </span>
                <Button size="sm" onClick={() => runOne(w)}>
                  <Play className="size-3.5" />
                  运行
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {pickedList.length >= 2 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/95 backdrop-blur-xl">
          <div className="container-page flex items-center justify-between gap-3 py-4">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-sm font-semibold text-primary">
              <GitCompare className="size-4" />
              已勾选 {pickedList.length} 个模板
            </span>
            <div className="flex items-center gap-2">
              <button onClick={() => setPicked({})} className="text-xs text-muted-foreground hover:text-foreground">
                清空
              </button>
              <Button onClick={() => setCompare(pickedList)}>
                <GitCompare className="size-4" />
                对比运行
              </Button>
            </div>
          </div>
        </div>
      )}

      {inputsFor && <InputsDialog wf={inputsFor} provider={provider} onClose={() => setInputsFor(null)} onRun={onRun} />}
      {compare && <CompareOverlay workflows={compare} provider={provider} onClose={() => setCompare(null)} />}
    </div>
  );
}
