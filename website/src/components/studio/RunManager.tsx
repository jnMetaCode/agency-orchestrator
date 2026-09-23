import { createContext, useCallback, useContext, useEffect, useReducer, useRef, type ReactNode } from "react";
import { api, runRole, runWorkflow, type SseHandler, type WorkflowStepMeta } from "@/lib/studio";
import { useLanguage } from "@/i18n/LanguageProvider";

/** 某步暂停等待人工输入（human_input / approval 节点）。 */
export interface PendingInput {
  stepId: string;
  prompt: string;
  type: "human_input" | "approval";
}

export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface LiveStep {
  id: string;
  emoji?: string;
  name?: string;
  avatarSeed?: string;
  cur?: number;
  total?: number;
  content: string;
  meta?: string;
  /** 验收核验未满足的条目（来自 step-verify-item 事件），展示为核验详情而非正文 */
  verifyItems?: string[];
  /** 步骤失败原因（step-failed 事件）。以前没有这个事件，报错被当成正文、步骤还打绿勾 */
  error?: string;
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
      /** 交付物步骤 id（模板声明）：RunViewer 导出/复制默认只取这些步 */
      deliverables?: string[];
      materialize?: boolean;
    }
  | { kind: "role"; title: string; role: string; emoji?: string; name?: string; task: string; provider?: string; lang?: string };

type WorkflowRequest = Extract<RunRequest, { kind: "workflow" }>;

export interface RunInstance {
  id: string;
  title: string;
  kind: "workflow" | "role";
  state: RunState;
  steps: LiveStep[];
  terminal: string;
  /** 开跑前的媒体花费预览（几条片 × 几秒 × 哪档），引擎算好发来；纯文本步骤没有 */
  preflight?: string[];
  summary: string | null;
  error: string | null;
  startedAt: number;
  ctrl: AbortController;
  _stderr: string;
  /** 工作流运行才有：原始请求，供「对某步提意见重做」复用 file/provider/cast/inputs */
  source?: WorkflowRequest;
  /** 服务端运行 id，用于把人工输入写回该子进程 stdin */
  runId?: string;
  /** 非空时表示某步正等待人工输入，前端应弹输入框 */
  pendingInput?: PendingInput | null;
  /** 本次运行产物的保存目录（绝对路径,来自服务端 output-dir 事件） */
  outputDir?: string;
  /** 专家咨询自动落盘的工作流文件（来自 workflow-saved 事件），完成后提示用户去「工作流」页 */
  savedWorkflow?: string;
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
  /** 把人工输入提交回正在等待的运行（human_input / approval 节点） */
  submitInput: (id: string, text: string) => void;
}

const Ctx = createContext<RunManagerValue | null>(null);

let counter = 0;

// 长任务（工作流跑几分钟很常见）完成/失败时，用户多半已切去别的窗口——系统通知
// 把人叫回来，是"跑完了没人知道"这个留存漏点的最小修复。仅在页面不可见时才弹。
function notifyRunEnd(title: string, ok: boolean, body: string) {
  try {
    if (typeof Notification === "undefined" || typeof document === "undefined") return;
    if (document.visibilityState === "visible") return;
    if (Notification.permission !== "granted") return;
    new Notification(`${ok ? "✅" : "❌"} ${title}`, { body });
  } catch {
    /* 通知失败绝不影响运行本身 */
  }
}

// human_input/approval 暂停等输入时同样把人叫回来——错过弹框运行会一直干等，
// 比"跑完了没人知道"更伤（token 已花，产出卡在半路）。仅页面不可见时弹。
function notifyInputNeeded(title: string, prompt: string) {
  try {
    if (typeof Notification === "undefined" || typeof document === "undefined") return;
    if (document.visibilityState === "visible") return;
    if (Notification.permission !== "granted") return;
    new Notification(`⏸ ${title}`, { body: prompt });
  } catch {
    /* 通知失败绝不影响运行本身 */
  }
}

export function RunProvider({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  const runsRef = useRef<Map<string, RunInstance>>(new Map());
  const openRef = useRef<string | null>(null);
  const [, force] = useReducer((x) => x + 1, 0);

  // 一条 stdout 行会发两个 SSE 事件，每个都 force 一次 = 整个 Studio（含 276 张角色卡）跟着重渲染；
  // 合并到一帧里只渲染一次。视觉上没区别，打字框在长运行里不再卡。
  const frame = useRef(0);
  const touch = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => { frame.current = 0; force(); });
  }, []);

  // 刷新 / 关标签 / 点到站外链接时，服务端一看到响应流断开就 SIGTERM 子进程——正在跑的（可能按秒计费的）
  // 运行会被无声杀掉。运行只活在内存里、SSE 也接不回来，所以这里至少要让浏览器弹一句"确定离开？"。
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      const busy = [...runsRef.current.values()].some((r) => r.state === "running");
      if (!busy) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);

  const start = useCallback(
    (request: RunRequest): string => {
      const id = `run-${++counter}`;
      const ctrl = new AbortController();

      // 借用户点「运行」这个手势申请通知权限（浏览器要求在用户手势里请求）
      try {
        if (typeof Notification !== "undefined" && Notification.permission === "default") {
          void Notification.requestPermission();
        }
      } catch { /* noop */ }

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
          case "start":
            inst.runId = data.runId;
            break;
          case "await-input":
            inst.pendingInput = { stepId: data.stepId, prompt: data.prompt, type: data.type };
            notifyInputNeeded(inst.title, data.prompt || "");
            break;
          case "step-header":
            // 某步推进了 → 清掉等待态（用户已提交、或本就不需要输入）
            inst.pendingInput = null;
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
          case "step-failed":
            if (inst.kind === "role") {
              const id0 = inst.steps[0]?.id ?? "single";
              upsert(id0, { status: "failed", error: data.error });
            } else if (data.id) {
              upsert(data.id, { status: "failed", error: data.error });
            }
            break;
          case "step-skipped":
            // reason 为空 = 汇总尾部"⏭️ 跳过 N 步"那行来的，不覆盖先前"条件不满足"之类的原因
            if (data.id) upsert(data.id, { status: "skipped", ...(data.reason ? { meta: data.reason } : {}) });
            break;
          case "step-verify-item": {
            const i = inst.steps.findIndex((s) => s.id === data.id);
            const prev = i >= 0 ? inst.steps[i].verifyItems ?? [] : [];
            upsert(data.id, { verifyItems: [...prev, data.text] });
            break;
          }
          case "preflight":
            inst.preflight = Array.isArray(data.lines) ? data.lines.map(String) : [];
            break;
          case "workflow-summary":
            inst.summary = data.text;
            break;
          case "output-dir":
            inst.outputDir = data.dir;
            break;
          case "workflow-saved":
            inst.savedWorkflow = data.file;
            break;
          case "stdout":
            inst.terminal += data.text;
            break;
          case "stderr":
            inst._stderr += data.text;
            inst.terminal += data.text;
            break;
          case "done": {
            inst.pendingInput = null;
            inst.steps = inst.steps.map((s) => (s.status === "running" ? { ...s, status: "done" } : s));
            const hasContent = inst.steps.some((s) => s.content.trim());
            const failedSteps = inst.steps.filter((s) => s.status === "failed");
            // 有步骤失败 = 出错，哪怕别的步骤有产出——以前只看"有没有内容"，而失败报错本身被当成了内容，
            // 于是撞额度、401 这类失败整次显示「已完成」，通知也报成功
            if (data?.code && data.code !== 0 && (failedSteps.length > 0 || !hasContent)) {
              const msg = inst._stderr.trim();
              inst.error = failedSteps.length
                ? `${t.studio.run.stepsFailedPrefix}${failedSteps.slice(0, 3).map((s) => `${s.name ?? s.id}：${s.error ?? ""}`).join("\n")}`
                : msg ? msg.split("\n").filter(Boolean).slice(-3).join("\n") : `${t.studio.run.runFailedExitCodePrefix}${data.code}${t.studio.run.runFailedExitCodeSuffix}`;
              inst.state = "error";
            } else if (inst.state !== "error") {
              inst.state = "done";
            }
            notifyRunEnd(inst.title, inst.state === "done", inst.state === "done" ? t.studio.run.notifyDoneBody : t.studio.run.notifyFailBody);
            break;
          }
          case "error":
            inst.error = data.message || t.studio.run.runError;
            inst.state = "error";
            inst.steps = inst.steps.map((s) => (s.status === "running" ? { ...s, status: "failed" } : s));
            notifyRunEnd(inst.title, false, t.studio.run.notifyFailBody);
            break;
        }
        touch();
      };

      const starter =
        request.kind === "workflow"
          ? runWorkflow(
              { file: request.file, inputs: request.inputs, provider: request.provider, resume: request.resume, fromStep: request.fromStep, feedback: request.feedback, materialize: request.materialize },
              onEvent,
              ctrl.signal,
            )
          : runRole({ role: request.role, task: request.task, provider: request.provider, lang: request.lang }, onEvent, ctrl.signal);

      // 流正常结束却没收到 done / error（代理提前收口、服务端异常退出）：状态会永远停在"运行中"，
      // 转圈转到天荒地老、还挡着 beforeunload 的离开确认。收口成失败。
      starter.then(() => {
        if (ctrl.signal.aborted || inst.state !== "running") return;
        inst.state = "error";
        inst.error = inst.error || t.studio.run.runError;
        inst.steps = inst.steps.map((s) => (s.status === "running" ? { ...s, status: "failed" } : s));
        touch();
      });
      starter.catch((e: any) => {
        if (ctrl.signal.aborted) return;
        inst.error = e?.message || String(e);
        inst.state = "error";
        // 请求本身挂了（不是引擎发的 error 事件）：正在跑的步骤不会再收到任何事件，别让它们的转圈永远转下去
        inst.steps = inst.steps.map((s) => (s.status === "running" ? { ...s, status: "failed" } : s));
        touch();
      });

      return id;
    },
    [touch, t],
  );

  const stop = useCallback(
    (id: string) => {
      const inst = runsRef.current.get(id);
      if (!inst) return;
      inst.ctrl.abort();
      // 用户主动停的：状态是 error（带说明），不是 done——以前标 done，绿色「已完成」徽章下面步骤还在转圈
      if (inst.state === "running") {
        inst.state = "error";
        inst.error = t.studio.run.stoppedByUser;
        inst.steps = inst.steps.map((s) => (s.status === "running" ? { ...s, status: "failed" } : s));
      }
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
        title: `${src.title}${t.studio.run.reworkTitlePrefix}${stepName}${t.studio.run.reworkTitleSuffix}`,
        resume: "last",
        fromStep: stepId,
        feedback: feedback.trim(),
      });
    },
    [start, t],
  );

  const submitInput = useCallback(
    (id: string, text: string) => {
      const inst = runsRef.current.get(id);
      if (!inst?.runId || !inst.pendingInput) return;
      // 乐观清除等待态；引擎收到输入后会继续推进。发送失败要把弹框**还回来**：引擎还在等 stdin，
      // 弹框没了用户就没有任何办法再提交，这条运行只能挂着
      const pending = inst.pendingInput;
      inst.pendingInput = null;
      touch();
      api.runInput(inst.runId, text).catch((e) => {
        inst.error = e?.message || String(e);
        inst.pendingInput = pending;
        touch();
      });
    },
    [touch],
  );

  const value: RunManagerValue = {
    runs: Array.from(runsRef.current.values()),
    openId: openRef.current,
    start,
    stop,
    remove,
    open,
    rerunWithFeedback,
    submitInput,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRunManager() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useRunManager must be used within RunProvider");
  return ctx;
}
