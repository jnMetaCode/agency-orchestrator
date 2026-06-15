import { Check, Copy, Loader2, MessageSquare, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/i18n/LanguageProvider";
import { api, type Role } from "@/lib/studio";
import { Markdown } from "./Markdown";
import { RoleAvatar } from "./RoleAvatar";
import type { RunRequest } from "./RunManager";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export function RoleDetail({
  role,
  provider,
  onClose,
  onRun,
}: {
  role: Role;
  provider: string;
  onClose: () => void;
  onRun: (r: RunRequest) => void;
}) {
  const { t, lang } = useLanguage();
  const seed = `${role.category}/${role.id}`;
  const [full, setFull] = useState<Role | null>(role.content ? role : null);
  const [loading, setLoading] = useState(!role.content);
  const [task, setTask] = useState("");
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);

  const copyPrompt = async () => {
    if (!full?.content) return;
    const ok = await copyText(full.content);
    setCopied(ok ? "ok" : "fail");
    setTimeout(() => setCopied(null), 1800);
  };

  useEffect(() => {
    if (role.content) return;
    api
      .role(role.category, role.id, lang)
      .then(setFull)
      .catch(() => setFull(role))
      .finally(() => setLoading(false));
  }, [role, lang]);

  const chat = () => {
    if (!task.trim()) return;
    onRun({ kind: "role", title: `${t.studio.roles.singleChat} · ${role.name}`, role: seed, name: role.name, task: task.trim(), provider: provider || undefined, lang });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[58] flex items-stretch justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose}>
      <div
        className="flex w-full max-w-2xl flex-col overflow-hidden rounded-none border border-border/70 bg-background shadow-2xl sm:max-h-[86vh] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border/60 bg-gradient-to-r from-primary/[0.07] to-transparent px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <RoleAvatar seed={seed} name={role.name} color={role.color} className="size-12" />
            <div className="min-w-0">
              <h3 className="truncate text-lg font-bold">{role.name}</h3>
              <span className="text-xs font-medium text-primary">{role.categoryName}</span>
            </div>
          </div>
          <button onClick={onClose} className="shrink-0 text-muted-foreground hover:text-foreground">
            <X className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          <p className="text-sm leading-relaxed text-muted-foreground">{role.description}</p>
          <div className="mt-4 rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
            {loading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> {t.studio.roles.loadingAbilities}
              </p>
            ) : full?.content ? (
              <>
                <div className="mb-2 flex justify-end">
                  <button
                    type="button"
                    onClick={copyPrompt}
                    className={
                      "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors " +
                      (copied === "ok"
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
                        : copied === "fail"
                          ? "border-red-500/40 bg-red-500/10 text-red-500"
                          : "border-border/70 text-muted-foreground hover:border-primary/40 hover:text-foreground")
                    }
                  >
                    {copied === "ok" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {copied === "ok" ? t.studio.roles.copied : copied === "fail" ? t.studio.roles.copyFailed : t.studio.roles.copyPrompt}
                  </button>
                </div>
                <Markdown>{full.content}</Markdown>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t.studio.roles.noMoreInfo}</p>
            )}
          </div>
        </div>

        <div className="border-t border-border/60 px-5 py-3">
          <div className="flex gap-2">
            <input
              value={task}
              onChange={(e) => setTask(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) chat();
              }}
              placeholder={`${t.studio.roles.askPrefix}${role.name}${t.studio.roles.askSuffix}`}
              className="h-10 flex-1 rounded-xl border border-border/70 bg-card/60 px-3 text-sm outline-none focus:border-primary/50"
            />
            <Button onClick={chat} disabled={!task.trim()}>
              <MessageSquare className="size-4" />
              {t.studio.roles.chat}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
