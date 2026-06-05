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
  hasKey: boolean;
  fromEnv: boolean;
  baseUrl: string;
  supportsBaseUrl: boolean;
}

export interface ConfigResponse {
  providers: Record<string, ProviderKeyStatus>;
  defaultProvider: string;
}

export const api = {
  health: () => getJSON<{ ok: boolean; version: string }>("/health"),
  config: () => getJSON<ConfigResponse>("/config"),
  saveConfig: (body: { provider: string; apiKey?: string; baseUrl?: string }) =>
    postJSON<{ ok: boolean }>("/config", body),
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
  body: { file: string; inputs?: Record<string, string>; provider?: string; resume?: string | boolean; fromStep?: string },
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

export const PROVIDERS = ["", "claude-code", "deepseek", "openclaw-cli", "gemini-cli"];
