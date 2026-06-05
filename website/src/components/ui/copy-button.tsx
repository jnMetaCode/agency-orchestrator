import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export function useCopy(timeout = 1800) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), timeout);
    return () => window.clearTimeout(id);
  }, [copied, timeout]);
  const copy = useCallback((text: string) => {
    navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => {});
  }, []);
  return { copied, copy };
}

export function CopyButton({
  value,
  label,
  copiedLabel,
  className,
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
}) {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      onClick={() => copy(value)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-muted/50 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
        className,
      )}
    >
      {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
      {label != null && <span>{copied ? copiedLabel ?? label : label}</span>}
    </button>
  );
}
