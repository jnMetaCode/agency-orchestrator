import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/i18n/LanguageProvider";
import { cn } from "@/lib/utils";

type Phase = "idle" | "running" | "done";
const STEP_MS = 950;

/**
 * 纯前端的"在线演示"：无后端时让访客也能直观看到多专家按步协作。
 * 复用首页 oneLiner 的真实专家数据（角色 / 用时 / 产出摘要），脚本化逐步播放，不调用任何真实模型。
 */
export function StudioDemo() {
  const { t } = useLanguage();
  const d = t.oneLiner;
  const s = t.studioDemo;
  const [phase, setPhase] = useState<Phase>("idle");
  const [active, setActive] = useState(-1); // 正在运行的步骤下标；小于它的视为已完成
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  const play = () => {
    clearTimers();
    setPhase("running");
    setActive(0);
    d.steps.forEach((_, i) => {
      timers.current.push(window.setTimeout(() => setActive(i + 1), (i + 1) * STEP_MS));
    });
    timers.current.push(window.setTimeout(() => setPhase("done"), d.steps.length * STEP_MS + 400));
  };

  return (
    <section className="mx-auto mt-12 max-w-3xl">
      <div className="mb-4 text-center">
        <h3 className="text-lg font-bold">{s.title}</h3>
        <p className="mx-auto mt-1.5 max-w-xl text-sm text-muted-foreground">{s.desc}</p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/70 bg-[#0b0e16] shadow-2xl shadow-black/40">
        <div className="flex items-center gap-2 border-b border-white/10 bg-white/[0.03] px-4 py-3">
          <span className="h-3 w-3 rounded-full bg-[#ff5f56]" />
          <span className="h-3 w-3 rounded-full bg-[#ffbd2e]" />
          <span className="h-3 w-3 rounded-full bg-[#27c93f]" />
          <span className="ml-3 font-mono text-xs text-white/40">ao compose --run</span>
        </div>

        <div className="space-y-1 p-5 font-mono text-[13px] leading-relaxed">
          <p className="text-white/60">
            <span className="text-emerald-400">$</span> ao compose <span className="text-amber-300">"{s.prompt}"</span> --run
          </p>
          <p className="pt-2 text-white/40">
            {`workflow · ${d.steps.length} steps · deepseek-chat`}
          </p>
          <div className="my-2 h-px bg-white/10" />

          {d.steps.map((step, i) => {
            const done = i < active;
            const running = i === active && phase === "running";
            const queued = i >= active && phase !== "done" && !running;
            return (
              <div
                key={step.name}
                className={cn(
                  "flex items-baseline gap-2 transition-opacity",
                  queued ? "opacity-30" : "opacity-100",
                )}
              >
                <span className="shrink-0 translate-y-0.5">
                  {done || phase === "done" ? (
                    <Check className="size-3.5 text-emerald-400" />
                  ) : running ? (
                    <Loader2 className="size-3.5 animate-spin text-amber-300" />
                  ) : (
                    <span className="inline-block size-3.5 text-center text-white/30">·</span>
                  )}
                </span>
                <span className="shrink-0">{step.emoji}</span>
                <span className="shrink-0 font-semibold text-white">{step.name}</span>
                {(done || phase === "done") && <span className="shrink-0 text-white/40">{step.time}</span>}
                {running && <span className="shrink-0 text-amber-300/80">{s.running}…</span>}
                {(done || phase === "done") && <span className="text-white/55">→ {step.out}</span>}
              </div>
            );
          })}

          {phase === "done" && (
            <>
              <div className="my-2 h-px bg-white/10" />
              <p className="text-emerald-400/90">✓ {s.done}</p>
            </>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-col items-center gap-2">
        <Button onClick={play} disabled={phase === "running"} variant={phase === "idle" ? "default" : "outline"}>
          {phase === "running" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : phase === "done" ? (
            <RotateCcw className="size-4" />
          ) : (
            <Play className="size-4" />
          )}
          {phase === "done" ? s.replay : s.play}
        </Button>
        <p className="text-center text-xs text-muted-foreground">{s.note}</p>
      </div>
    </section>
  );
}
