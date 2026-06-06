// Shared types + API client for the Studio (talks to web/server.js backend).

export interface Role {
  id: string;
  category: string;
  categoryName: string;
  name: string;
  description: string;
  color?: string;
  content?: string;
}

export interface WorkflowStepMeta {
  id: string;
  role: string;
  name?: string;
  emoji?: string;
}

export interface WorkflowInput {
  name: string;
  description?: string;
  required?: boolean;
  default?: string;
}

export interface Workflow {
  file: string;
  filename: string;
  name: string;
  description?: string;
  inputs?: WorkflowInput[];
  steps?: WorkflowStepMeta[];
  provider?: string;
  private?: boolean;
}

export interface RunStepSummary {
  id: string;
  status: string;
  agentName?: string;
  agentEmoji?: string;
  duration?: string;
  tokens?: { input: number; output: number };
  content?: string;
}

export interface RunSummary {
  id: string;
  name: string;
  success: boolean;
  duration?: string;
  tokens?: { input: number; output: number };
  stepCount?: number;
  completedCount?: number;
  file?: string;
  steps?: RunStepSummary[];
}

export interface ComposeResult {
  file: string;
  yaml: string;
  warnings?: string[];
}

export type SseHandler = (event: string, data: any) => void;

const API = "/api";

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const j = await res.json();
      msg = j.error || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json();
}

export interface ProviderKeyStatus {
  family: "api" | "local";
  hasKey?: boolean;
  fromEnv?: boolean;
  baseUrl: string;
  model?: string;
  supportsBaseUrl?: boolean;
  configured?: boolean;
}

export interface ConfigResponse {
  providers: Record<string, ProviderKeyStatus>;
  cli: string[];
  defaultProvider: string;
}

const ACTIVE_KEY = "ao-active-provider";
export function getActiveProvider(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(ACTIVE_KEY) ?? "";
}
export function setActiveProvider(p: string) {
  window.localStorage.setItem(ACTIVE_KEY, p);
}

export interface UsageDay {
  date: string;
  input: number;
  output: number;
  runs: number;
}
export interface UsageRole {
  role: string;
  name: string;
  runs: number;
  input: number;
  output: number;
}
export interface UsageResponse {
  totalRuns: number;
  totalInput: number;
  totalOutput: number;
  totalTokens: number;
  byDay: UsageDay[];
  byRole: UsageRole[];
  firstDate: string | null;
  lastDate: string | null;
}

/** Rough USD price per 1M tokens (input/output) for cost estimation. */
export const PRICING: Record<string, { label: string; in: number; out: number }> = {
  deepseek: { label: "DeepSeek", in: 0.27, out: 1.1 },
  "gpt-4o": { label: "OpenAI GPT-4o", in: 2.5, out: 10 },
  "claude-sonnet": { label: "Claude Sonnet", in: 3, out: 15 },
  gemini: { label: "Gemini 1.5 Pro", in: 1.25, out: 5 },
};

export const api = {
  health: () => getJSON<{ ok: boolean; version: string }>("/health"),
  usage: () => getJSON<UsageResponse>("/usage"),
  config: () => getJSON<ConfigResponse>("/config"),
  saveConfig: (body: { provider: string; apiKey?: string; baseUrl?: string; model?: string }) =>
    postJSON<{ ok: boolean }>("/config", body),
  testProvider: (provider: string) =>
    postJSON<{ ok: boolean; latencyMs?: number; error?: string; note?: string }>("/test-provider", { provider }),
  roles: () => getJSON<Role[]>("/roles"),
  role: (category: string, id: string) => getJSON<Role>(`/roles/${category}/${id}`),
  workflows: () => getJSON<Workflow[]>("/workflows"),
  runs: () => getJSON<RunSummary[]>("/runs"),
  run: (id: string) => getJSON<RunSummary>(`/runs/${encodeURIComponent(id)}`),
  compose: (body: { description: string; roles: string[]; name?: string; provider?: string }) =>
    postJSON<ComposeResult>("/compose", body),
};

/** Parse a Server-Sent-Events stream coming from a POST response body. */
async function streamSse(
  path: string,
  body: unknown,
  onEvent: SseHandler,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    let msg = `${res.status}`;
    try {
      const j = await res.json();
      msg = j.error || msg;
    } catch {
      /* ignore */
    }
    onEvent("error", { message: msg });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  const dispatch = (chunk: string) => {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of chunk.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) return;
    let data: any = dataLines.join("\n");
    try {
      data = JSON.parse(data);
    } catch {
      /* keep raw string */
    }
    onEvent(event, data);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      dispatch(buf.slice(0, idx));
      buf = buf.slice(idx + 2);
    }
  }
  if (buf.trim()) dispatch(buf);
}

export function runWorkflow(
  body: { file: string; inputs?: Record<string, string>; provider?: string; resume?: string | boolean; fromStep?: string; feedback?: string },
  onEvent: SseHandler,
  signal?: AbortSignal,
) {
  return streamSse("/run", body, onEvent, signal);
}

export function runRole(
  body: { role: string; task: string; provider?: string },
  onEvent: SseHandler,
  signal?: AbortSignal,
) {
  return streamSse("/run-role", body, onEvent, signal);
}

export const PROVIDERS = ["", "deepseek", "openai", "claude", "claude-code", "gemini-cli", "openclaw-cli", "ollama"];

export const PROVIDER_LABELS: Record<string, string> = {
  "": "默认 (DeepSeek)",
  deepseek: "DeepSeek",
  openai: "OpenAI",
  claude: "Claude",
  "claude-code": "Claude Code CLI",
  "gemini-cli": "Gemini CLI",
  "openclaw-cli": "OpenClaw CLI",
  ollama: "Ollama (本地)",
};
