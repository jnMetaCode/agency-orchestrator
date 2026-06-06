import { Loader2, MessageSquare, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, type Role } from "@/lib/studio";
import { Markdown } from "./Markdown";
import { RoleAvatar } from "./RoleAvatar";
import type { RunRequest } from "./RunManager";

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
  const seed = `${role.category}/${role.id}`;
  const [full, setFull] = useState<Role | null>(role.content ? role : null);
  const [loading, setLoading] = useState(!role.content);
  const [task, setTask] = useState("");

  useEffect(() => {
    if (role.content) return;
    api
      .role(role.category, role.id)
      .then(setFull)
      .catch(() => setFull(role))
      .finally(() => setLoading(false));
  }, [role]);

  const chat = () => {
    if (!task.trim()) return;
    onRun({ kind: "role", title: `单独对话 · ${role.name}`, role: seed, name: role.name, task: task.trim(), provider: provider || undefined });
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
                <Loader2 className="size-4 animate-spin" /> 加载角色能力…
              </p>
            ) : full?.content ? (
              <Markdown>{full.content}</Markdown>
            ) : (
              <p className="text-sm text-muted-foreground">（无更多说明）</p>
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
              placeholder={`想问 ${role.name} 什么？`}
              className="h-10 flex-1 rounded-xl border border-border/70 bg-card/60 px-3 text-sm outline-none focus:border-primary/50"
            />
            <Button onClick={chat} disabled={!task.trim()}>
              <MessageSquare className="size-4" />
              对话
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
