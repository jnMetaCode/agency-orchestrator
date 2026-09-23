import { Loader2, Trophy, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/i18n/LanguageProvider";
import { useDialog } from "@/components/ui/use-dialog";
import { Button } from "@/components/ui/button";
import { api, type CompareResult, type Workflow } from "@/lib/studio";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown";

/**
 * 多智能体 vs 单次基线 对比视图（把 EVAL_FINDINGS 的核心证明产品化）。
 * 调 /api/compare：跑完整工作流 + 单次基线 + 双向盲评，并排展示 + 评审结论。
 * 非流式——一次跑完返回，过程中显示 loading（可能一两分钟）。
 */
/** 对比结果缓存（同文件 + 同输入 + 同 provider）：跨 overlay 开关存活，页面刷新才清。 */
const compareCache = new Map<string, Promise<CompareResult>>();

export function BaselineCompareOverlay({
  wf,
  inputs,
  provider,
  onClose,
}: {
  wf: Workflow;
  inputs: Record<string, string>;
  /** 缺省 = 让后端用默认 provider（RunViewer 里 run.source.provider 本就可选） */
  provider?: string;
  onClose: () => void;
}) {
  const { lang } = useLanguage();
  const zh = lang !== "en";
  const [state, setState] = useState<"running" | "done" | "error">("running");
  const [result, setResult] = useState<CompareResult | null>(null);
  const [err, setErr] = useState<string>("");
  const dialogRef = useDialog({ onEscape: onClose });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode 双调用守卫
    started.current = true;
    // 请求挂在组件外的缓存上：对比要跑完整工作流 + 单次基线 + 盲评（真金白银），关掉 overlay 再打开
    // 以前会从头再跑一遍、上一次的结论也丢了；服务端也没法中途取消。同参数命中就复用同一个 promise。
    const key = JSON.stringify([wf.file, inputs, provider || ""]);
    let p = compareCache.get(key);
    if (!p) {
      p = api.compare({ file: wf.file, inputs, provider: provider || undefined });
      compareCache.set(key, p);
      p.catch(() => compareCache.delete(key)); // 失败的不缓存，下次能重试
    }
    p.then((r) => { setResult(r); setState("done"); })
      .catch((e) => { setErr(e?.message || String(e)); setState("error"); });
  }, [wf.file, inputs, provider]);

  const v = result?.verdict;
  const winnerLabel =
    v?.winner === "multi-agent" ? (zh ? "✅ 多智能体胜" : "✅ Multi-agent wins")
    : v?.winner === "baseline" ? (zh ? "❌ 单次基线胜" : "❌ Single-shot wins")
    : (zh ? "➖ 打平" : "➖ Tie");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={(zh ? "多智能体 vs 单次基线 · " : "Multi-agent vs Single-shot · ") + wf.name}
      ref={dialogRef}
      className="fixed inset-0 z-[60] flex flex-col bg-black/50 backdrop-blur-sm"
    >
      <div className="flex items-center justify-between border-b border-border/60 bg-background px-5 py-3.5">
        <h3 className="flex items-center gap-2 font-semibold">
          <Trophy className="size-4 text-primary" />
          {(zh ? "多智能体 vs 单次基线 · " : "Multi-agent vs Single-shot · ") + wf.name}
        </h3>
        <Button size="sm" variant="ghost" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>

      {/* 评审横幅 */}
      {state === "done" && (
        <div className="border-b border-border/60 bg-background px-5 py-3">
          {v ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span
                className={cn(
                  "rounded-full px-3 py-1 text-sm font-bold",
                  v.winner === "multi-agent" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : v.winner === "baseline" ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                  : "bg-muted text-muted-foreground",
                )}
              >
                {winnerLabel}
              </span>
              <span className="text-sm text-muted-foreground">
                {(zh ? "多智能体 " : "Multi-agent ")}<b className="text-foreground">{v.multiScore.toFixed(1)}</b>
                {" · "}{(zh ? "单次基线 " : "Single-shot ")}<b className="text-foreground">{v.baseScore.toFixed(1)}</b>
              </span>
              <span className={cn("text-xs", v.consistent ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400")}>
                {v.consistent ? (zh ? "高可信" : "high confidence") : (zh ? "低可信（疑位置偏置）" : "low confidence (position bias)")}
              </span>
            </div>
          ) : (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              {zh ? "评审未给出可信评分（judge 解析失败），下面两份产出可人工对比。" : "Judge returned no reliable score; compare the two outputs below manually."}
            </p>
          )}
          {v?.reasons?.length ? (
            <ul className="mt-1.5 space-y-0.5">
              {v.reasons.map((r, i) => (
                <li key={i} className="text-xs text-muted-foreground">· {r}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      {/* 内容 */}
      <div className="flex flex-1 gap-4 overflow-auto bg-background p-5">
        {state === "running" && (
          <div className="m-auto flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="size-6 animate-spin text-primary" />
            <p className="max-w-sm text-center text-sm">
              {zh
                ? "对比中…正在跑完整多智能体工作流 + 单次基线 + 双向盲评，可能需要一两分钟。"
                : "Comparing… running the full multi-agent workflow + single-shot baseline + blind judging. May take a minute or two."}
            </p>
          </div>
        )}
        {state === "error" && <p className="m-auto max-w-md text-center text-sm text-red-500">{err}</p>}
        {state === "done" && result && (
          <>
            <Pane title={zh ? "多智能体（AO 工作流）" : "Multi-agent (AO workflow)"} highlight={v?.winner === "multi-agent"} text={result.multiOutput} empty={zh ? "（无产出）" : "(no output)"} />
            <Pane title={zh ? "单次基线（一句话直接要成品）" : "Single-shot baseline"} highlight={v?.winner === "baseline"} text={result.baselineOutput} empty={zh ? "（无产出）" : "(no output)"} />
          </>
        )}
      </div>
    </div>
  );
}

function Pane({ title, text, highlight, empty }: { title: string; text: string; highlight?: boolean; empty: string }) {
  return (
    <div className={cn("flex min-w-[300px] flex-1 flex-col rounded-2xl border bg-card/60", highlight ? "border-primary ring-1 ring-primary/40" : "border-border/70")}>
      <div className="border-b border-border/60 px-4 py-2.5 text-sm font-semibold">{title}</div>
      <div className="flex-1 overflow-auto p-4">
        {text ? <Markdown>{text}</Markdown> : <p className="text-sm text-muted-foreground">{empty}</p>}
      </div>
    </div>
  );
}
