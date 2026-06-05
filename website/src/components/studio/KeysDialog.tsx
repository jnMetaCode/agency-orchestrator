import { Check, Eye, EyeOff, KeyRound, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, type ConfigResponse } from "@/lib/studio";

const PROVIDER_META: { id: string; name: string; hint: string; recommended?: boolean }[] = [
  { id: "deepseek", name: "DeepSeek", hint: "推荐 · 性价比甜区。platform.deepseek.com 获取", recommended: true },
  { id: "openai", name: "OpenAI", hint: "gpt-4o 等 · platform.openai.com" },
  { id: "claude", name: "Claude (Anthropic)", hint: "ANTHROPIC_API_KEY · console.anthropic.com" },
];

function ProviderRow({
  meta,
  status,
  onSaved,
}: {
  meta: (typeof PROVIDER_META)[number];
  status: ConfigResponse["providers"][string] | undefined;
  onSaved: () => void;
}) {
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(status?.baseUrl ?? "");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setBaseUrl(status?.baseUrl ?? "");
  }, [status?.baseUrl]);

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      await api.saveConfig({ provider: meta.id, apiKey: key, baseUrl: status?.supportsBaseUrl ? baseUrl : undefined });
      setKey("");
      onSaved();
    } catch (e: any) {
      setErr(e?.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setSaving(true);
    try {
      await api.saveConfig({ provider: meta.id, apiKey: "" });
      setKey("");
      setBaseUrl("");
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border/70 bg-card/60 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{meta.name}</span>
          {meta.recommended && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">推荐</span>}
        </div>
        {status?.hasKey ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-500">
            <Check className="size-3.5" />
            已设置{status.fromEnv ? "（来自环境变量）" : ""}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">未设置</span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{meta.hint}</p>

      <div className="mt-3 flex gap-2">
        <div className="relative flex-1">
          <input
            type={show ? "text" : "password"}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={status?.hasKey ? "粘贴新 key 以替换…" : "粘贴 API key…"}
            className="h-10 w-full rounded-xl border border-border/70 bg-background px-3 pr-9 font-mono text-sm outline-none focus:border-primary/50"
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <Button onClick={save} disabled={saving || !key.trim()}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : "保存"}
        </Button>
      </div>

      {status?.supportsBaseUrl && (
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="自定义 base_url（可留空用默认）"
          className="mt-2 h-9 w-full rounded-xl border border-border/70 bg-background px-3 text-sm outline-none focus:border-primary/50"
        />
      )}

      {err && <p className="mt-2 text-xs text-red-500">{err}</p>}
      {status?.hasKey && !status.fromEnv && (
        <button onClick={clear} className="mt-2 text-xs text-muted-foreground hover:text-red-500">
          清除已保存的 key
        </button>
      )}
    </div>
  );
}

export function KeysDialog({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const [cfg, setCfg] = useState<ConfigResponse | null>(null);
  const [failed, setFailed] = useState(false);

  const load = () => {
    setFailed(false);
    return api
      .config()
      .then(setCfg)
      .catch(() => setFailed(true));
  };
  useEffect(() => {
    load();
  }, []);

  const handleSaved = () => {
    load();
    onChanged?.();
  };

  return (
    <div className="fixed inset-0 z-[65] grid place-items-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-border/70 bg-background p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-semibold">
            <KeyRound className="size-4 text-primary" />
            模型 API Key
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          key 只保存在<strong>本机</strong>（<code className="rounded bg-muted px-1 py-0.5">.local/web-keys.json</code>，已 gitignore），
          仅用于本地引擎调用模型，<strong>不上传任何服务器</strong>。CLI 类 provider（claude-code / gemini-cli 等）无需 key。
        </p>

        <div className="mt-4 space-y-3">
          {failed ? (
            <p className="py-6 text-center text-sm text-red-500">读取配置失败，请先启动本地引擎（node web/server.js）。</p>
          ) : !cfg ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> 加载…
            </div>
          ) : (
            PROVIDER_META.map((m) => <ProviderRow key={m.id} meta={m} status={cfg.providers[m.id]} onSaved={handleSaved} />)
          )}
        </div>

        <div className="mt-5 text-right">
          <Button variant="ghost" onClick={onClose}>
            完成
          </Button>
        </div>
      </div>
    </div>
  );
}
