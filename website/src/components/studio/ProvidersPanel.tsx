import { Check, Cloud, Eye, EyeOff, Loader2, MonitorCog, Plug, Terminal, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/i18n/LanguageProvider";
import { api, PROVIDER_LABELS, type ConfigResponse } from "@/lib/studio";
import { cn } from "@/lib/utils";

const API_META = [
  { id: "deepseek", name: "DeepSeek", hint: "platform.deepseek.com" },
  { id: "compshare", name: "CompShare", hint: "console.compshare.cn" },
  { id: "openai", name: "OpenAI", hint: "gpt-4o {etc} · platform.openai.com" },
  { id: "claude", name: "Claude (Anthropic)", hint: "console.anthropic.com" },
];

type TestState = { status: "idle" | "testing" | "ok" | "fail"; msg?: string };

function ActiveButton({ on, onClick }: { on: boolean; onClick: () => void }) {
  const { t } = useLanguage();
  return on ? (
    <span className="inline-flex items-center gap-1 rounded-lg bg-primary/15 px-2.5 py-1.5 text-xs font-semibold text-primary">
      <Check className="size-3.5" /> {t.studio.providers.inUse}
    </span>
  ) : (
    <Button size="sm" variant="outline" onClick={onClick}>
      {t.studio.providers.setActive}
    </Button>
  );
}

function useTest(provider: string, enabled: boolean) {
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const run = async () => {
    setTest({ status: "testing" });
    try {
      const r = await api.testProvider(provider);
      setTest(r.ok ? { status: "ok", msg: r.note || `${r.latencyMs}ms` } : { status: "fail", msg: r.error });
    } catch (e: any) {
      setTest({ status: "fail", msg: e?.message });
    }
  };
  return { test, run, enabled };
}

function TestRow({ provider, enabled }: { provider: string; enabled: boolean }) {
  const { t } = useLanguage();
  const { test, run } = useTest(provider, enabled);
  return (
    <>
      <Button size="sm" variant="outline" onClick={run} disabled={!enabled || test.status === "testing"}>
        {test.status === "testing" ? <Loader2 className="size-3.5 animate-spin" /> : <Plug className="size-3.5" />}
        {t.studio.providers.testConnection}
      </Button>
      {test.status === "ok" && (
        <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
          <Check className="size-3.5" /> {t.studio.providers.ok} · {test.msg}
        </span>
      )}
      {test.status === "fail" && (
        <span className="inline-flex min-w-0 items-center gap-1 text-xs text-red-500">
          <XCircle className="size-3.5 shrink-0" /> <span className="truncate">{test.msg}</span>
        </span>
      )}
    </>
  );
}

function ApiCard({
  meta,
  status,
  active,
  onSetActive,
  onChanged,
}: {
  meta: (typeof API_META)[number];
  status?: ConfigResponse["providers"][string];
  active: boolean;
  onSetActive: () => void;
  onChanged: () => void;
}) {
  const { t } = useLanguage();
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(status?.baseUrl ?? "");
  const [model, setModel] = useState(status?.model ?? "");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setBaseUrl(status?.baseUrl ?? "");
    setModel(status?.model ?? "");
  }, [status?.baseUrl, status?.model]);

  const save = async () => {
    setSaving(true);
    try {
      await api.saveConfig({ provider: meta.id, apiKey: key, baseUrl, model });
      setKey("");
      onChanged();
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
      setModel("");
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  // 赞助商 CompShare 的名称/说明走 i18n（英文站不露中文）；其余 provider 是品牌名+URL，语言无关
  const displayName = meta.id === "compshare" ? t.studio.providers.compshareName : meta.name;
  const displayHint = meta.id === "compshare" ? t.studio.providers.compshareHint : meta.hint.replace("{etc}", t.studio.providers.etc);

  return (
    <div className={cn("rounded-2xl border bg-card/60 p-5", active ? "border-primary/60" : "border-border/70")}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{displayName}</span>
        </div>
        <ActiveButton on={active} onClick={onSetActive} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {displayHint} · {status?.hasKey ? <span className="text-emerald-500">{t.studio.providers.keySet}{status.fromEnv ? t.studio.providers.fromEnv : ""}</span> : t.studio.providers.keyNotSet}
      </p>

      <div className="mt-3 flex gap-2">
        <div className="relative flex-1">
          <input
            type={show ? "text" : "password"}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={status?.hasKey ? t.studio.providers.pasteNewKey : t.studio.providers.pasteKey}
            className="h-10 w-full rounded-xl border border-border/70 bg-background px-3 pr-9 font-mono text-sm outline-none focus:border-primary/50"
          />
          <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <Button onClick={save} disabled={saving || (!key.trim() && baseUrl === (status?.baseUrl ?? "") && model === (status?.model ?? ""))}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : t.studio.providers.save}
        </Button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={t.studio.providers.baseUrlPlaceholder} className="h-9 rounded-xl border border-border/70 bg-background px-3 text-sm outline-none focus:border-primary/50" />
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={t.studio.providers.modelPlaceholder} className="h-9 rounded-xl border border-border/70 bg-background px-3 text-sm outline-none focus:border-primary/50" />
      </div>

      <div className="mt-3 flex items-center gap-3">
        <TestRow provider={meta.id} enabled={!!status?.hasKey} />
        {status?.hasKey && !status.fromEnv && (
          <button onClick={clear} className="ml-auto text-xs text-muted-foreground hover:text-red-500">
            {t.studio.providers.clear}
          </button>
        )}
      </div>
    </div>
  );
}

function OllamaCard({ status, active, onSetActive, onChanged }: { status?: ConfigResponse["providers"][string]; active: boolean; onSetActive: () => void; onChanged: () => void }) {
  const { t } = useLanguage();
  const [baseUrl, setBaseUrl] = useState(status?.baseUrl ?? "http://localhost:11434");
  const [model, setModel] = useState(status?.model ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setBaseUrl(status?.baseUrl ?? "http://localhost:11434");
    setModel(status?.model ?? "");
  }, [status?.baseUrl, status?.model]);

  const save = async () => {
    setSaving(true);
    try {
      await api.saveConfig({ provider: "ollama", baseUrl, model });
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={cn("rounded-2xl border bg-card/60 p-5", active ? "border-primary/60" : "border-border/70")}>
      <div className="flex items-center justify-between">
        <span className="font-semibold">Ollama</span>
        <ActiveButton on={active} onClick={onSetActive} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {t.studio.providers.ollamaDescBeforeServe}<code className="rounded bg-muted px-1 py-0.5">ollama serve</code>{t.studio.providers.ollamaDescBeforePull}<code className="rounded bg-muted px-1 py-0.5">ollama pull llama3</code>{t.studio.providers.ollamaDescAfter}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:11434" className="h-9 rounded-xl border border-border/70 bg-background px-3 text-sm outline-none focus:border-primary/50" />
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={t.studio.providers.ollamaModelPlaceholder} className="h-9 rounded-xl border border-border/70 bg-background px-3 text-sm outline-none focus:border-primary/50" />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : t.studio.providers.save}
        </Button>
        <TestRow provider="ollama" enabled />
      </div>
    </div>
  );
}

export function ProvidersPanel({ active, onSetActive }: { active: string; onSetActive: (p: string) => void }) {
  const { t } = useLanguage();
  const [cfg, setCfg] = useState<ConfigResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const load = () => {
    setFailed(false);
    api.config().then(setCfg).catch(() => setFailed(true));
  };
  useEffect(load, []);

  const eff = active || "deepseek";

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border/60 bg-muted/30 px-4 py-2.5 text-xs leading-relaxed text-muted-foreground">
        {t.studio.providers.privacyBeforeLocal}<strong>{t.studio.providers.privacyLocal}</strong>{t.studio.providers.privacyBeforeCode}<code className="rounded bg-muted px-1 py-0.5">.local/web-keys.json</code>{t.studio.providers.privacyAfter}
      </div>

      {failed ? (
        <p className="py-10 text-center text-sm text-red-500">{t.studio.providers.loadFailed}</p>
      ) : !cfg ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> {t.studio.providers.loading}
        </div>
      ) : (
        <>
          <section>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold">
              <Cloud className="size-4 text-primary" /> {t.studio.providers.cloudApiTitle} <span className="font-normal text-muted-foreground">· {t.studio.providers.cloudApiHint}</span>
            </h3>
            <div className="grid gap-4 lg:grid-cols-2">
              {API_META.map((m) => (
                <ApiCard key={m.id} meta={m} status={cfg.providers[m.id]} active={eff === m.id} onSetActive={() => onSetActive(m.id)} onChanged={load} />
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold">
              <MonitorCog className="size-4 text-emerald-500" /> {t.studio.providers.localModelTitle} <span className="font-normal text-muted-foreground">· {t.studio.providers.localModelHint}</span>
            </h3>
            <OllamaCard status={cfg.providers.ollama} active={eff === "ollama"} onSetActive={() => onSetActive("ollama")} onChanged={load} />
          </section>

          <section>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold">
              <Terminal className="size-4 text-muted-foreground" /> {t.studio.providers.localCliTitle} <span className="font-normal text-muted-foreground">· {t.studio.providers.localCliHint}</span>
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {cfg.cli.map((id) => (
                <div key={id} className={cn("flex items-center justify-between rounded-2xl border bg-card/60 px-4 py-3", eff === id ? "border-primary/60" : "border-border/70")}>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{PROVIDER_LABELS[id] ?? id}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{t.studio.providers.cliRequirement}</span>
                  </span>
                  <ActiveButton on={eff === id} onClick={() => onSetActive(id)} />
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
