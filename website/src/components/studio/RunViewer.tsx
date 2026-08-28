import { Check, ChevronDown, Copy, Download, FileDown, Loader2, MessageSquare, Minus, Scale, Square, Terminal, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tip";
import { useCopy } from "@/components/ui/copy-button";
import { useLanguage } from "@/i18n/LanguageProvider";
import { StepList } from "./StepList";
import { useRunManager, type PendingInput } from "./RunManager";
import { BaselineCompareOverlay } from "./BaselineCompareOverlay";
import { downloadText, safeFilename } from "@/lib/download";
import { downloadExport, type Workflow } from "@/lib/studio";
import { track } from "@/lib/track";
import { cn } from "@/lib/utils";

export function RunViewer({ onViewHistory, onGoProviders }: { onViewHistory?: () => void; onGoProviders?: () => void }) {
  const { t, lang } = useLanguage();
  const { runs, openId, open, stop, rerunWithFeedback, submitInput } = useRunManager();
  const run = runs.find((r) => r.id === openId) || null;
  const [showTerminal, setShowTerminal] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { copied, copy } = useCopy();

  const running = run?.state === "running";
  const contentLen = run ? run.steps.reduce((n, s) => n + s.content.length, 0) : 0;

  // Auto-scroll to bottom while streaming.
  useEffect(() => {
    if (running && scrollRef.current && !showTerminal) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [contentLen, running, showTerminal]);

  const fullText = useMemo(() => {
    if (!run) return "";
    return run.steps
      .filter((s) => s.content.trim())
      .map((s) => (run.kind === "role" ? s.content.trim() : `## ${s.name ?? s.id}\n\n${s.content.trim()}`))
      .join("\n\n---\n\n");
  }, [run]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && run) open(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run, open]);

  const doExport = async (format: "docx" | "pdf" | "xlsx" | "pptx" | "skill" | "plan") => {
    if (!run || !fullText) return;
    setExportOpen(false);
    setExporting(format);
    setExportErr(null);
    track("export", { format });
    try {
      await downloadExport(fullText, format, run.title);
    } catch (e: unknown) {
      setExportErr(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(null);
    }
  };

  if (!run) return null;
  const doneCount = run.steps.filter((s) => s.status === "done").length;
  const EXPORTS: Array<{ fmt: "docx" | "pdf" | "xlsx" | "pptx" | "skill" | "plan"; label: string }> = [
    { fmt: "docx", label: lang === "en" ? "Word (.docx)" : "Word 文档 (.docx)" },
    { fmt: "pptx", label: lang === "en" ? "PowerPoint (.pptx)" : "PPT 演示 (.pptx)" },
    { fmt: "pdf", label: "PDF" },
    { fmt: "xlsx", label: lang === "en" ? "Excel (.xlsx)" : "Excel 表格 (.xlsx)" },
    { fmt: "skill", label: lang === "en" ? "Save as Skill (.md)" : "存为 Skill (.md)" },
    { fmt: "plan", label: lang === "en" ? "Executable plan (.md)" : "存为可执行计划 (.md)" },
  ];

  return (
    <>
    <div className="fixed inset-0 z-[60] flex items-stretch justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-6">
      <div className="flex w-full max-w-2xl flex-col overflow-hidden rounded-none border border-border/70 bg-background shadow-2xl sm:max-h-[84vh] sm:rounded-2xl">
        {/* header */}
        <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-gradient-to-r from-primary/[0.07] to-transparent px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            {running && <Loader2 className="size-4 shrink-0 animate-spin text-primary" />}
            <h3 className="truncate font-semibold">{run.title}</h3>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                running && "bg-primary/15 text-primary",
                run.state === "done" && "bg-emerald-500/15 text-emerald-500",
                run.state === "error" && "bg-red-500/15 text-red-500",
              )}
            >
              {running ? (run.steps.length ? `${t.studio.run.running} ${doneCount}/${run.steps.length}` : t.studio.run.running) : run.state === "done" ? t.studio.run.done : t.studio.run.error}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Tip label={t.studio.run.terminalOutput}>
              <Button size="icon" variant="ghost" onClick={() => setShowTerminal((v) => !v)}>
                <Terminal className="size-4" />
              </Button>
            </Tip>
            {running && (
              <Button size="sm" variant="ghost" title={t.studio.run.backgroundTitle} onClick={() => open(null)}>
                <Minus className="size-4" />
                {t.studio.run.background}
              </Button>
            )}
            {running ? (
              <Button size="sm" variant="outline" onClick={() => stop(run.id)}>
                <Square className="size-3.5" />
                {t.studio.run.stop}
              </Button>
            ) : (
              <Tip label={t.studio.run.close}>
                <Button size="icon" variant="ghost" onClick={() => open(null)}>
                  <X className="size-4" />
                </Button>
              </Tip>
            )}
          </div>
        </div>

        {/* body */}
        <div ref={scrollRef} className="flex-1 overflow-auto p-5">
          {run.error && (
            <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
              {run.error}
              {/* 认证类错误不能是死路：报错 → 一键跳到密钥配置，闭环掉"看着 401 干瞪眼" */}
              {onGoProviders && /401|403|unauthor|invalid.{0,8}(key|token)|api.?key|认证|未设置|无效/i.test(run.error) && (
                <div className="mt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      open(null);
                      onGoProviders();
                    }}
                  >
                    {t.studio.run.goConfigureKey}
                  </Button>
                </div>
              )}
            </div>
          )}
          {showTerminal ? (
            <pre className="overflow-auto rounded-xl border border-border/70 bg-[#0b0e16] p-4 font-mono text-xs leading-relaxed text-white/80">
              {run.terminal || t.studio.run.noTerminalOutput}
            </pre>
          ) : run.steps.length === 0 && running ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
              {/* 媒体花费预览：视频按秒计费，钱在接下来这几步花出去——开跑那一刻就要让人看见 */}
              {!!run.preflight?.length && (
                <div className="mb-2 w-full max-w-md rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-left text-xs leading-relaxed text-foreground">
                  <div className="mb-1 font-semibold">{t.studio.run.preflightTitle}</div>
                  {run.preflight.map((l, i) => <div key={i} className="whitespace-pre-wrap">{l}</div>)}
                </div>
              )}
              <Loader2 className="size-6 animate-spin text-primary" />
              <p className="text-sm">{t.studio.run.summoningTeam}</p>
            </div>
          ) : (
            <StepList
              steps={run.steps}
              // 图片/视频产物在 md 里是 assets/x.mp4 相对路径，浏览器会解析成 /studio/assets/… → 404 放不了；
              // 运行目录一到（output-dir 事件）就改写成资产接口地址，跑完当场能播
              assetBase={run.outputDir ? `/api/runs/${encodeURIComponent(run.outputDir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "")}/assets` : undefined}
              onFeedback={
                run.kind === "workflow" && !running && run.state === "done" && run.source
                  ? (stepId, feedback) => rerunWithFeedback(run.id, stepId, feedback)
                  : undefined
              }
            />
          )}
          {run.pendingInput && running && (
            <RunInputBox pending={run.pendingInput} onSubmit={(text) => submitInput(run.id, text)} />
          )}
          {run.summary && !running && (
            <div className="mt-4 rounded-xl border border-primary/30 bg-primary/[0.06] px-4 py-3 text-sm font-medium text-primary">
              {run.summary}
            </div>
          )}
        </div>

        {/* footer */}
        <div className="flex items-center justify-between gap-2 border-t border-border/60 px-5 py-3">
          <span className={cn("min-w-0 truncate text-xs", exportErr ? "text-red-500" : "text-muted-foreground")}>
            {exportErr ? `导出失败：${exportErr}` : running ? t.studio.run.backgroundHint : run.state === "done" ? (
              <>
                {t.studio.run.savedToHistory}
                {/* 专家咨询自动落盘为可复用工作流——明确告知去处（用户反馈"不知道保存到哪里去了"） */}
                {run.savedWorkflow && <span className="ml-2">{t.studio.run.savedToWorkflows}</span>}
                {/* 保存位置:用户反馈"不知道文件存在哪"——显示绝对路径,点击复制 */}
                {run.outputDir && (
                  <button
                    type="button"
                    onClick={() => copy(run.outputDir!)}
                    title={t.studio.run.copyPath}
                    className="ml-2 inline-flex max-w-[320px] items-center gap-1 truncate align-bottom font-mono text-[11px] text-muted-foreground/80 hover:text-foreground"
                  >
                    📁 <span className="truncate">{run.outputDir}</span>
                  </button>
                )}
              </>
            ) : ""}
          </span>
          <div className="flex shrink-0 gap-2">
            {!!fullText && (
              <>
                <Button size="sm" variant="outline" onClick={() => copy(fullText)}>
                  {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                  {copied ? t.studio.run.copied : t.studio.run.copy}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => downloadText(safeFilename(`${run.title}-${new Date().toISOString().slice(0, 10)}`), fullText)}
                >
                  <Download className="size-3.5" />
                  {t.studio.run.downloadMd}
                </Button>
                {/* 导出为 Word/PDF/Excel(给人)或 Skill/可执行计划(给机器)*/}
                <div className="relative">
                  <Button size="sm" variant="outline" onClick={() => setExportOpen((v) => !v)}>
                    {exporting ? <Loader2 className="size-3.5 animate-spin" /> : <FileDown className="size-3.5" />}
                    {lang === "en" ? "Export" : "导出"}
                    <ChevronDown className="size-3 opacity-60" />
                  </Button>
                  {exportOpen && (
                    <div className="absolute bottom-full right-0 z-10 mb-1 min-w-44 rounded-xl border border-border/60 bg-background/95 p-1.5 shadow-lg backdrop-blur-xl">
                      {EXPORTS.map((e, i) => (
                        <div key={e.fmt}>
                          {i === 3 && <div className="my-1 border-t border-border/50" />}
                          <button
                            onClick={() => doExport(e.fmt)}
                            disabled={!!exporting}
                            className="block w-full rounded-lg px-3 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                          >
                            {e.label}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
            {/* 价值时刻:工作流跑完后,一键对比"单个 AI"——直观看多智能体到底强在哪 */}
            {!running && run.kind === "workflow" && run.state === "done" && run.source && (
              <Button
                size="sm"
                onClick={() => { track("compare_open", { from: "run" }); setShowCompare(true); }}
                title={lang === "en" ? "Run a single-shot baseline and blind-judge both" : "再跑一次单个 AI 基线并盲评,看多智能体强在哪"}
              >
                <Scale className="size-3.5" />
                {lang === "en" ? "vs Single AI" : "对比单个 AI"}
              </Button>
            )}
            {/* 失败/中断的运行更需要这个入口——历史详情里有「继续运行」可从失败步续跑 */}
            {!running && (run.state === "done" || run.state === "error") && onViewHistory && (
              <Button size="sm" variant="ghost" onClick={() => onViewHistory()}>
                {run.state === "error" ? t.studio.run.viewHistoryContinue : t.studio.run.viewHistory}
              </Button>
            )}
            {!running && (
              <Button size="sm" onClick={() => open(null)}>
                {t.studio.run.close}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
    {showCompare && run.source && (
      <BaselineCompareOverlay
        wf={{ file: run.source.file, filename: run.source.file.split("/").pop() ?? run.source.file, name: run.title } as Workflow}
        inputs={run.source.inputs ?? {}}
        provider={run.source.provider}
        onClose={() => setShowCompare(false)}
      />
    )}
    </>
  );
}

/** 运行中某步暂停等待人工输入时的弹层：human_input 给输入框，approval 给通过/驳回。 */
function RunInputBox({ pending, onSubmit }: { pending: PendingInput; onSubmit: (text: string) => void }) {
  const { t } = useLanguage();
  const [text, setText] = useState("");
  const isApproval = pending.type === "approval";

  const submit = (val?: string) => {
    const v = val ?? text;
    if (!isApproval && !v.trim()) return;
    onSubmit(v);
    setText("");
  };

  return (
    <div className="mt-4 rounded-xl border border-primary/45 bg-primary/[0.06] px-4 py-3 shadow-sm">
      <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-primary">
        <MessageSquare className="size-4" />
        {isApproval ? t.studio.run.needApproval : t.studio.run.needInput}
      </div>
      <p className="mb-2.5 whitespace-pre-wrap text-sm text-foreground">{pending.prompt}</p>
      {isApproval ? (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => submit("yes")}>{t.studio.run.approveContinue}</Button>
          <Button size="sm" variant="outline" onClick={() => submit("no")}>{t.studio.run.reject}</Button>
        </div>
      ) : (
        <>
          <textarea
            autoFocus
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
            }}
            placeholder={t.studio.run.inputPlaceholder}
            className="w-full resize-none rounded-lg border border-border/70 bg-background px-3 py-2 text-sm outline-none focus:border-primary/60"
          />
          <div className="mt-2 flex justify-end">
            <Button size="sm" disabled={!text.trim()} onClick={() => submit()}>
              {t.studio.run.submitContinue}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
