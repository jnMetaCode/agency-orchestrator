import { createContext, useCallback, useContext, useReducer, useRef, type ReactNode } from "react";
import { runRole, runWorkflow, type SseHandler, type WorkflowStepMeta } from "@/lib/studio";

export type StepStatus = "pending" | "running" | "done";

export interface LiveStep {
  id: string;
  emoji?: string;
  name?: string;
  avatarSeed?: string;
  cur?: number;
  total?: number;
  content: string;
  meta?: string;
  status: StepStatus;
}

export type RunState = "running" | "done" | "error";

export type RunRequest =
  | {
      kind: "workflow";
      title: string;
      file: string;
      inputs?: Record<string, string>;
      provider?: string;
      resume?: string | boolean;
      fromStep?: string;
      feedback?: string;
      cast?: WorkflowStepMeta[];
    }
  | { kind: "role"; title: string; role: string; emoji?: string; name?: string; task: string; provider?: string };

type WorkflowRequest = Extract<RunRequest, { kind: "workflow" }>;

export interface RunInstance {
  id: string;
  title: string;
  kind: "workflow" | "role";
  state: RunState;
  steps: LiveStep[];
  terminal: string;
  summary: string | null;
  error: string | null;
  startedAt: number;
  ctrl: AbortController;
  _stderr: string;
  /** 工作流运行才有：原始请求，供「对某步提意见重做」复用 file/provider/cast/inputs */
  source?: WorkflowRequest;
}

interface RunManagerValue {
  runs: RunInstance[];
  openId: string | null;
  start: (request: RunRequest) => string;
  stop: (id: string) => void;
  remove: (id: string) => void;
  open: (id: string | null) => void;
  /** 对已完成工作流运行中的某一步提意见，带着「上一版产出 + 意见」让该专家返工 */
  rerunWithFeedback: (id: string, stepId: string, feedback: string) => string | null;
}

const Ctx = createContext<RunManagerValue | null>(null);

let counter = 0;

export function RunProvider({ children }: { children: ReactNode }) {
  const runsRef = useRef<Map<string, RunInstance>>(new Map());
  const openRef = useRef<string | null>(null);
  const [, force] = useReducer((x) => x + 1, 0);

  const touch = useCallback(() => force(), []);

  const start = useCallback(
    (request: RunRequest): string => {
      const id = `run-${++counter}`;
      const ctrl = new AbortController();

      const seeded: LiveStep[] =
        request.kind === "role"
          ? [{ id: "single", content: "", status: "running", name: request.name ?? request.role.split("/").pop(), avatarSeed: request.role }]
          : (request.cast ?? []).map((s) => ({
              id: s.id,
              name: s.name ?? s.id,
              emoji: s.emoji,
              avatarSeed: s.role || s.id,
              content: "",
              status: "pending" as StepStatus,
            }));

      const inst: RunInstance = {
        id,
        title: request.title,
        kind: request.kind,
        state: "running",
        steps: seeded,
        terminal: "",
        summary: null,
        error: null,
        startedAt: Date.now(),
        ctrl,
        _stderr: "",
        source: request.kind === "workflow" ? request : undefined,
      };
      runsRef.current.set(id, inst);
      openRef.current = id;
      touch();

      const avatarOf = (stepId: string) =>
        request.kind === "workflow" ? request.cast?.find((c) => c.id === stepId)?.role : undefined;

      const upsert = (stepId: string, patch: Partial<LiveStep>) => {
        const i = inst.steps.findIndex((s) => s.id === stepId);
        if (i === -1) {
          inst.steps = [...inst.steps, { id: stepId, content: "", status: "running", ...patch }];
        } else {
          const copy = inst.steps.slice();
          copy[i] = { ...copy[i], ...patch, content: patch.content ?? copy[i].content };
          inst.steps = copy;
        }
      };

      const onEvent: SseHandler = (event, data) => {
        switch (event) {
          case "step-header":
            upsert(data.id, {
              emoji: data.emoji,
              name: data.name,
              cur: data.cur,
              total: data.total,
              status: "running",
              avatarSeed: avatarOf(data.id),
            });
            break;
          case "step-content": {
            const i = inst.steps.findIndex((s) => s.id === data.id);
            const prev = i >= 0 ? inst.steps[i].content : "";
            upsert(data.id, { content: prev + data.text + "\n", status: "running" });
            break;
          }
          case "content": {
            const id0 = inst.steps[0]?.id ?? "single";
            upsert(id0, { content: (inst.steps[0]?.content ?? "") + data.text + "\n", status: "running" });
            break;
          }
          case "step-done":
            if (inst.kind === "role") {
              const id0 = inst.steps[0]?.id ?? "single";
              upsert(id0, { meta: data.meta, status: "done" });
            } else if (data.id) {
              upsert(data.id, { meta: data.meta, status: "done" });
            }
            break;
          case "workflow-summary":
            inst.summary = data.text;
            break;
          case "stdout":
            inst.terminal += data.text;
            break;
          case "stderr":
            inst._stderr += data.text;
            inst.terminal += data.text;
            break;
          case "done": {
            inst.steps = inst.steps.map((s) => (s.status === "running" ? { ...s, status: "done" } : s));
            const hasContent = inst.steps.some((s) => s.content.trim());
            if (data?.code && data.code !== 0 && !hasContent) {
              const msg = inst._stderr.trim();
              inst.error = msg ? msg.split("\n").filter(Boolean).slice(-3).join("\n") : `运行失败（退出码 ${data.code}）`;
              inst.state = "error";
            } else if (inst.state !== "error") {
              inst.state = "done";
            }
            break;
          }
          case "error":
            inst.error = data.message || "运行出错";
            inst.state = "error";
            break;
        }
        touch();
      };

      const starter =
        request.kind === "workflow"
          ? runWorkflow(
              { file: request.file, inputs: request.inputs, provider: request.provider, resume: request.resume, fromStep: request.fromStep, feedback: request.feedback },
              onEvent,
              ctrl.signal,
            )
          : runRole({ role: request.role, task: request.task, provider: request.provider }, onEvent, ctrl.signal);

      starter.catch((e: any) => {
        if (ctrl.signal.aborted) return;
        inst.error = e?.message || String(e);
        inst.state = "error";
        touch();
      });

      return id;
    },
    [touch],
  );

  const stop = useCallback(
    (id: string) => {
      const inst = runsRef.current.get(id);
      if (!inst) return;
      inst.ctrl.abort();
      if (inst.state === "running") inst.state = "done";
      touch();
    },
    [touch],
  );

  const remove = useCallback(
    (id: string) => {
      const inst = runsRef.current.get(id);
      if (inst && inst.state === "running") inst.ctrl.abort();
      runsRef.current.delete(id);
      if (openRef.current === id) openRef.current = null;
      touch();
    },
    [touch],
  );

  const open = useCallback(
    (id: string | null) => {
      openRef.current = id;
      touch();
    },
    [touch],
  );

  const rerunWithFeedback = useCallback(
    (id: string, stepId: string, feedback: string): string | null => {
      const inst = runsRef.current.get(id);
      if (!inst?.source || !feedback.trim()) return null;
      const src = inst.source;
      const stepName = inst.steps.find((s) => s.id === stepId)?.name ?? stepId;
      // resume: "last" → 复用本次刚跑完的输出（mtime 最新），只重跑该步及其下游
      return start({
        ...src,
        title: `${src.title}（返工·${stepName}）`,
        resume: "last",
        fromStep: stepId,
        feedback: feedback.trim(),
      });
    },
    [start],
  );

  const value: RunManagerValue = {
    runs: Array.from(runsRef.current.values()),
    openId: openRef.current,
    start,
    stop,
    remove,
    open,
    rerunWithFeedback,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRunManager() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useRunManager must be used within RunProvider");
  return ctx;
}
