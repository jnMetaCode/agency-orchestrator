import { Loader2, TriangleAlert } from "lucide-react";
import { Button } from "./button";
import { useDialog } from "./use-dialog";

/**
 * 应用内确认框——替代 window.confirm（原生框带 "127.0.0.1:8088 显示" 抬头，观感差，
 * 样式也跟不了主题）。危险操作（删除等）用 danger，确认键红色。
 * error 非空时显示在框内并保持打开，让用户看到失败原因后自己决定重试或取消。
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const dialogRef = useDialog({ onEscape: busy ? undefined : onClose });
  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={busy ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={dialogRef}
        className="w-full max-w-sm rounded-2xl border border-border/70 bg-background p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="flex items-center gap-2 font-semibold">
          {danger && <TriangleAlert className="size-4 shrink-0 text-red-500" />}
          {title}
        </h3>
        {body && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>}
        {error && <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/[0.08] px-3 py-2 text-xs text-red-500">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? "destructive" : "default"} size="sm" onClick={onConfirm} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
