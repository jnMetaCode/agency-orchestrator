import { Loader2, RefreshCw, TerminalSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";

export function StudioGate({ checking, onRetry }: { checking: boolean; onRetry: () => void }) {
  const cmd = "node web/server.js";
  return (
    <div className="mx-auto max-w-xl py-20 text-center">
      <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
        <TerminalSquare className="size-7" />
      </div>
      <h2 className="mt-5 text-xl font-bold">Studio 需要本地引擎</h2>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
        真实运行工作流要调用本地 <code className="rounded bg-muted px-1.5 py-0.5">ao</code> CLI 和你的模型 API key，
        所以 Studio 必须连本地后端。在项目根目录跑下面这条命令启动引擎（默认 <code className="rounded bg-muted px-1.5 py-0.5">:8088</code>）：
      </p>
      <div className="mx-auto mt-5 flex max-w-sm items-center justify-between rounded-xl border border-border/70 bg-card/60 px-4 py-3 font-mono text-sm">
        <span>{cmd}</span>
        <CopyButton value={cmd} />
      </div>
      <div className="mt-6">
        <Button onClick={onRetry} disabled={checking}>
          {checking ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {checking ? "检测中…" : "重新检测"}
        </Button>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">提示：公开部署的官网无法真跑（不会暴露你的 key）。Studio 仅在本地连上引擎时可用。</p>
    </div>
  );
}
