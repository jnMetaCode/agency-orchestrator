// Shared types + API client for the Studio (talks to web/server.js backend).

export interface Role {
  id: string;
  category: string;
  categoryName: string;
  name: string;
  description: string;
  color?: string;
  content?: string;
  /** 用户自建角色（「我的」分类，~/.ao/roles）——可删除 */
  custom?: boolean;
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
  category?: string;
  featured?: boolean;
  /** 文件修改时间(ms)——「我的工作流」按此倒序 */
  mtime?: number;
  /** 仅自动组队/画布保存的用户工作流可删（服务端限制在用户目录内） */
  deletable?: boolean;
}

export interface RunStepSummary {
  id: string;
  status: string;
  agentName?: string;
  agentEmoji?: string;
  duration?: string;
  tokens?: { input: number; output: number };
  content?: string;
  /** 该步声明的验收标准（运行时渲染后），来自 metadata.json */
  acceptance?: string;
  /** acceptance 自动核验结果，来自 metadata.json（未核验的步骤没有该字段） */
  verification?: { pass: boolean; failed: string[]; reworked: boolean };
  /** 失败原因（含"运行被中断"），来自 metadata.json */
  error?: string;
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
  /** 完成时刻（UTC ISO）。目录名里的时间戳是 UTC，显示一律用这个字段按本地时区渲染。 */
  startedAt?: string;
}

export interface ComposeResult {
  file: string;
  yaml: string;
  warnings?: string[];
}

// ── 可编辑画布 graph 模型（与服务端 src/canvas/graph.ts 对齐）──
export interface CanvasNode {
  id: string;
  position: { x: number; y: number };
  /** 该步骤的完整 YAML 定义，保真往返用。 */
  data: Record<string, unknown>;
}
export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
}
export interface CanvasGraphResponse {
  name: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  file: string;
  /** 仅用户目录(COMPOSED_DIR)的工作流可就地保存；内置模板只读。 */
  editable: boolean;
}

export interface TeamRole {
  role: string;
  name?: string;
  emoji?: string;
  note?: string;
}

export interface Team {
  slug: string;
  name: string;
  description?: string;
  roles: TeamRole[];
  lang?: string;
  provider?: string;
  source?: string;
  created?: string;
}

// ── Prompt Lab ──
export type PromptMode = "system" | "user";
export interface PromptVersion {
  content: string;
  note?: string;
  created?: string;
  source?: "original" | "optimize" | "manual" | "garden";
}
export interface PromptRecord {
  kind: "prompt";
  name: string;
  mode: PromptMode;
  favorite?: boolean;
  versions: PromptVersion[];
  created?: string;
}
export interface GardenSeed {
  id: string;
  name: string;
  mode: PromptMode;
  lang: string;
  tags: string[];
  content: string;
}
export interface ScoreResult {
  ranking: { label: string; score: number; reason: string }[];
  best: string | null;
}

// ── 普通对话（闲聊不组队）──
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type SseHandler = (event: string, data: any) => void;

const API = "/api";

/** 把报告 Markdown 导出成 Word/PDF/Excel/Skill/计划,并触发浏览器下载。 */
export async function downloadExport(markdown: string, format: "docx" | "pdf" | "xlsx" | "skill" | "plan", name: string): Promise<void> {
  const res = await fetch(`${API}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ markdown, format, name }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `导出失败 (${res.status})`);
  const blob = await res.blob();
  const cd = res.headers.get("content-disposition") || "";
  const m = cd.match(/filename\*=UTF-8''([^;]+)/);
  const fname = m ? decodeURIComponent(m[1]) : `${name}.${format}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

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
    let payload: any = undefined;
    try {
      payload = await res.json();
      msg = payload.error || msg;
    } catch {
      /* ignore */
    }
    const err = new Error(msg) as Error & { body?: any };
    if (payload) err.body = payload; // 结构化错误体（如 no_credentials 引导）挂上，调用方可读
    throw err;
  }
  return res.json();
}

async function putJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "PUT",
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

async function delJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { method: "DELETE" });
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
  /** 远程清单 providerOverrides 下发的换代模型建议（比打包进前端的静态建议新） */
  modelSuggestions?: string[];
  /** 仅 claude-code：Sonnet/Opus/Haiku 档位 → 中转商实际模型的映射（ANTHROPIC_DEFAULT_*_MODEL） */
  sonnetModel?: string;
  opusModel?: string;
  haikuModel?: string;
}

export interface CliProviderStatus {
  name: string;
  installed: boolean;
}

export interface CustomProviderMeta {
  id: string;
  name: string;
  note?: string;
  homepageUrl?: string;
  createdAt: number;
}

/** 远程清单上架的赞助商供应商（官网 providers-manifest.json,上/下架不发版）。 */
export interface RemoteProviderMeta {
  id: string;
  name: string;
  note?: string;
  homepageUrl?: string;
  baseUrl: string;
  defaultModel?: string;
  modelSuggestions?: string[];
  sponsor?: boolean;
  signupUrl?: string;
}

export interface ConfigResponse {
  providers: Record<string, ProviderKeyStatus>;
  cli: (string | CliProviderStatus)[];
  /** 本机已探测到、可零配置直接用的订阅制 CLI provider 名。 */
  installedCli?: string[];
  /** 推荐默认 provider：已装 CLI 优先 > 已配 key > 默认。 */
  recommended?: string;
  /** 用户自己加的自定义供应商（任意 OpenAI 兼容 endpoint）。 */
  customProviders?: CustomProviderMeta[];
  /** 远程清单：增量上架的赞助商 / CLI 中转商 / 下架的内置 id。 */
  remoteProviders?: RemoteProviderMeta[];
  relayPresets?: CliRelayPreset[];
  removedProviders?: string[];
  defaultProvider: string;
  /** 角色库下拉可选项:zh/en + 已安装的官方语言包(agency-agents-ko 等) */
  roleLibs?: { id: string; label: string }[];
}

/**
 * 预设的常见 OpenAI 兼容 endpoint —— 点一下帮用户填名称+base_url。
 * 收录原则：只收「官方大厂/模型厂商自己的端点」（用户刚需,且不和赞助商抢生意）；
 * 第三方聚合商/中转商的展示位留给付费赞助商（通过远程清单 providers-manifest.json
 * 上架,出现在云端 API 区,不进这个图库）。
 */
export interface CustomProviderPreset {
  name: string;
  baseUrl: string;
}
// 便捷预设 = 点一下自动填 名称+base_url 的「快捷键」，纯工具性质（无 logo/推广，跟赞助无关）。
// 只留主流大厂（用户真会用的），长尾厂商删掉减噪——删了也不影响：手动填 URL 仍可加任意 OpenAI 兼容端点。
export const CUSTOM_PROVIDER_PRESETS: CustomProviderPreset[] = [
  { name: "阿里云 DashScope (Qwen)", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  { name: "火山方舟 Volcengine Ark", baseUrl: "https://ark.cn-beijing.volces.com/api/v3" },
  { name: "Zhipu GLM 智谱", baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
  { name: "Moonshot Kimi", baseUrl: "https://api.moonshot.cn/v1" },
  { name: "Mistral AI", baseUrl: "https://api.mistral.ai/v1" },
];

const ACTIVE_KEY = "ao-active-provider";
export function getActiveProvider(): string {
  if (typeof window === "undefined") return DEFAULT_PROVIDER;
  // 空串（老用户存过的「默认」）也归一到旗舰默认
  return window.localStorage.getItem(ACTIVE_KEY) || DEFAULT_PROVIDER;
}
export function setActiveProvider(p: string) {
  window.localStorage.setItem(ACTIVE_KEY, p);
}
/** 用户是否显式选过 provider（localStorage 有非空值）。没选过 → 可采用后端推荐的零配置 provider。 */
export function hasExplicitProvider(): boolean {
  if (typeof window === "undefined") return false;
  return !!window.localStorage.getItem(ACTIVE_KEY);
}

// ── 用户自选「常用」工作流（点星收藏，存 localStorage，按机器） ──
const FAV_KEY = "ao-fav-workflows";
/** 返回收藏的工作流 key 集合；首次（无记录）返回 null，调用方可用编辑推荐做种子。 */
export function getFavWorkflows(): Set<string> | null {
  if (typeof window === "undefined") return new Set();
  const raw = window.localStorage.getItem(FAV_KEY);
  if (raw == null) return null;
  try { return new Set(JSON.parse(raw) as string[]); } catch { return new Set(); }
}
export function setFavWorkflows(keys: Set<string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(FAV_KEY, JSON.stringify([...keys]));
}

// ── 用户自选「常用」角色（点星收藏，存 localStorage，按机器；key = "category/id"） ──
const FAV_ROLES_KEY = "ao-fav-roles";
export function getFavRoles(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try { return new Set(JSON.parse(window.localStorage.getItem(FAV_ROLES_KEY) || "[]") as string[]); } catch { return new Set(); }
}
export function setFavRoles(keys: Set<string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(FAV_ROLES_KEY, JSON.stringify([...keys]));
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

export interface CompareVerdict {
  multiScore: number;
  baseScore: number;
  winner: "multi-agent" | "baseline" | "tie";
  consistent: boolean;
  reasons: string[];
}
export interface CompareResult {
  multiOutput: string;
  baselineOutput: string;
  verdict: CompareVerdict | null;
}

// 系统 Claude Code 体检/急救（后端 src/utils/claude-repair.ts 的返回结构）
export interface ClaudeHealth {
  healthy: boolean;
  files: { path: string; exists: boolean; parseError?: string; hijackKeys: Record<string, string> }[];
  shellOverrides: Record<string, string>;
  baseUrl?: string;
}
export interface ClaudeRepairResult {
  ok: boolean;
  changed: boolean;
  files: { path: string; removedKeys: string[]; backup: string | null; removedEmptyEnv: boolean }[];
  shellOverridesRemaining: string[];
  skipped: { path: string; reason: string }[];
  proxySync?: { configured: boolean; changed: boolean; proxyUrl?: string; backup: string | null; reason?: string };
  health: ClaudeHealth;
}
// 系统 Claude Code 全局切换状态 / 切回官方（后端 src/utils/claude-apply.ts）
export interface ClaudeSwitchStatus {
  managed: boolean;            // AO 主动切换且 env 与指纹一致（被外部改走时为 false，好让红灯照报）
  managedProviderId?: string;
  baseUrl?: string;
  active: boolean;            // env 里是否存在 ANTHROPIC_BASE_URL（已切到中转）
  tampered?: boolean;         // 有 AO 标记但 env 被别的工具/手动改走了（此时按劫持处理）
}
export interface ClaudeRestoreResult {
  ok: boolean;
  changed: boolean;
  files: { path: string; removedKeys: string[]; backup: string | null; removedEmptyEnv: boolean }[];
  shellOverridesRemaining: string[];
  skipped: { path: string; reason: string }[];
  removedAoMarker: boolean;
  proxySync: { configured: boolean; changed: boolean; proxyUrl?: string; backup: string | null; reason?: string };
  status: ClaudeSwitchStatus;
}
export interface ClaudeApplyResult {
  ok: boolean;
  path: string;
  backup: string | null;
  writtenKeys: string[];
  status: ClaudeSwitchStatus;
}
// 代理「可见 + 可管理」：settings.json 里配的代理是否可达、是否和当前系统代理漂移
export interface ClaudeProxyStatus {
  configured?: string;  // settings.json 里配的代理（没配则无）
  systemProxy?: string; // 当前 macOS 系统代理
  drift: boolean;       // 配的 ≠ 系统代理，建议更新
  reachable?: boolean;  // 配了代理时探测是否可连（false = Clash 没开?）
}

// 从模型 id 推断所属厂商，给「获取模型列表」的大列表分组用（对齐 cc-switch 的按 vendor 分组）。
// 聚合商 /models 常有上百个还混各家，扁平一堆没法扫；按厂商分组后一眼定位。
// 优先用带命名空间的前缀（如 "deepseek-ai/DeepSeek-V3.2" → deepseek-ai），否则按关键词猜。
const MODEL_VENDOR_RULES: [RegExp, string][] = [
  [/claude|anthropic/i, "Anthropic"],
  [/gpt|^o[13]\b|chatgpt|openai|dall|whisper/i, "OpenAI"],
  [/gemini|palm|imagen|veo|^google/i, "Google"],
  [/deepseek/i, "DeepSeek"],
  [/qwen|qwq|tongyi/i, "Qwen 通义"],
  [/doubao|seedance|seedream|bytedance|ui-tars/i, "ByteDance 豆包"],
  [/minimax|hailuo|abab/i, "MiniMax"],
  [/moonshot|kimi/i, "Moonshot"],
  [/glm|zhipu|cogview/i, "Zhipu 智谱"],
  [/llama|meta-/i, "Meta"],
  [/mistral|mixtral|codestral/i, "Mistral"],
  [/(^|\/)(yi-|01-ai)|lingyi/i, "01.AI 零一"],
  [/flux|stable-?diffusion|sd3|black-?forest/i, "图像模型"],
  [/bge|bce|embedding|rerank|m3e|jina/i, "向量/重排"],
  [/tts|speech|voice|indextts|cosyvoice/i, "语音模型"],
];
export function modelVendor(id: string): string {
  for (const [re, name] of MODEL_VENDOR_RULES) if (re.test(id)) return name;
  // 带命名空间前缀但没命中规则的，用前缀本身兜底（如 "SomeOrg/xxx" → SomeOrg）
  const ns = id.includes("/") ? id.split("/")[0] : "";
  return ns || "其它";
}
/** 按厂商把模型分组并排序，各组内保持原序；组按名称排序，「其它」永远垫底。 */
export function groupModelsByVendor(models: string[]): [string, string[]][] {
  const groups: Record<string, string[]> = {};
  for (const m of models) (groups[modelVendor(m)] ??= []).push(m);
  return Object.entries(groups).sort((a, b) =>
    a[0] === "其它" ? 1 : b[0] === "其它" ? -1 : a[0].localeCompare(b[0]),
  );
}

// 有正方形图标素材的赞助商/供应商 → website/public/sponsors/logo-<id>-icon.png（served at /sponsors/…）。
// 只对确有文件的 id 返回路径，避免其它供应商拿到 404 的 <img>。
const PROVIDER_LOGO_IDS = new Set(["compshare", "cubence", "apinebula", "rootflowai", "ccsub", "volcengine", "duoyuanx"]);
export function providerLogo(id: string): string | undefined {
  return PROVIDER_LOGO_IDS.has(id) ? `/sponsors/logo-${id}-icon.png` : undefined;
}

export const api = {
  health: () => getJSON<{ ok: boolean; version: string; stale?: boolean }>("/health"),
  usage: () => getJSON<UsageResponse>("/usage"),
  config: () => getJSON<ConfigResponse>("/config"),
  // sonnetModel/opusModel/haikuModel 仅 claude-code 用（模型映射，对齐 cc-switch）
  saveConfig: (body: { provider: string; apiKey?: string; baseUrl?: string; model?: string; sonnetModel?: string; opusModel?: string; haikuModel?: string }) =>
    // backups 只有 codex-cli 这条中转会带（写了 ~/.codex 前自动备份的原文件路径）；
    // baseUrl 是后端规整后的地址（去掉误贴的 /chat/completions 等），前端据此回填输入框
    postJSON<{ ok: boolean; backups?: string[]; baseUrl?: string }>("/config", body),
  // apiKey/baseUrl/model 可选覆盖:配置页里"填了就能测",不用先保存
  testProvider: (provider: string, overrides?: { apiKey?: string; baseUrl?: string; model?: string }) =>
    postJSON<{ ok: boolean; latencyMs?: number; error?: string; note?: string }>("/test-provider", { provider, ...overrides }),
  createCustomProvider: (body: { id: string; name: string; note?: string; homepageUrl?: string; baseUrl: string; apiKey?: string; model?: string }) =>
    postJSON<{ ok: boolean }>("/custom-providers", body),
  // 拉取供应商真实可用模型列表（OpenAI 兼容 GET /models）；baseUrl/apiKey 可覆盖（未保存时先试拉）；
  // protocol:"anthropic" = Anthropic 兼容端点（claude-code 中转商），认证头用 x-api-key
  providerModels: (body: { provider?: string; baseUrl?: string; apiKey?: string; protocol?: "anthropic" }) =>
    postJSON<{ ok: boolean; models?: string[]; error?: string; source?: string }>("/provider-models", body),
  // 本机 cc-switch 已配供应商（一键导入 key 用；key 只回脱敏预览，原文不出后端）
  ccswitchProviders: () =>
    getJSON<{ ok: boolean; providers?: { id: string; name: string; appType: string; baseUrl: string; keyPreview: string; isCurrent: boolean }[] }>("/ccswitch-providers"),
  ccswitchImport: (body: { source: string; provider: string; includeBaseUrl?: boolean }) =>
    postJSON<{ ok: boolean; keyPreview?: string }>("/ccswitch-import", body),
  deleteCustomProvider: (id: string) => delJSON<{ ok: boolean }>(`/custom-providers/${encodeURIComponent(id)}`),
  updateCustomProvider: (id: string, body: { name?: string; note?: string; homepageUrl?: string }) =>
    putJSON<{ ok: boolean }>(`/custom-providers/${encodeURIComponent(id)}`, body),
  roles: (lang?: string) => getJSON<Role[]>(`/roles${lang && lang !== "zh" ? `?lang=${encodeURIComponent(lang)}` : ""}`),
  // 我的角色（用户自建，~/.ao/roles）：创建后即出现在角色组队「我的」分类里，可组队/单聊/存团队
  createMyRole: (body: { name: string; description?: string; systemPrompt: string; color?: string; emoji?: string }) =>
    postJSON<{ id: string; role: string; name: string }>("/roles/my", body),
  updateMyRole: (id: string, body: { name?: string; description?: string; systemPrompt?: string; color?: string; emoji?: string }) =>
    putJSON<{ id: string; role: string; name: string }>(`/roles/my/${encodeURIComponent(id)}`, body),
  deleteMyRole: (id: string) => delJSON<{ ok: boolean }>(`/roles/my/${encodeURIComponent(id)}`),
  // 嵌套角色 id 带子路径(如 unity/unity-architect)——%2F 编码后 Express 仍按单段匹配并自动解码
  role: (category: string, id: string, lang?: string) =>
    getJSON<Role>(`/roles/${encodeURIComponent(category)}/${encodeURIComponent(id)}${lang && lang !== "zh" ? `?lang=${encodeURIComponent(lang)}` : ""}`),
  workflows: (lang?: string) => getJSON<Workflow[]>(`/workflows${lang === "en" ? "?lang=en" : ""}`),
  // 仅用户工作流可删（服务端限制目录）；下载复用 /workflows/yaml 原文
  deleteWorkflow: (file: string) => delJSON<{ ok: boolean }>(`/workflows?file=${encodeURIComponent(file)}`),
  workflowYaml: async (file: string): Promise<string> => {
    const res = await fetch(`${API}/workflows/yaml?file=${encodeURIComponent(file)}`);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.text();
  },
  // ── 可编辑画布：工作流 YAML ↔ graph（转换在引擎侧，前端只碰 graph JSON）──
  workflowGraph: (file: string) => getJSON<CanvasGraphResponse>(`/workflows/graph?file=${encodeURIComponent(file)}`),
  saveWorkflowGraph: (body: { file?: string; name: string; nodes: CanvasNode[]; edges: CanvasEdge[]; baseYaml?: string }) =>
    // autoFixes：保存时服务端确定性补上的缺失 depends_on 边（#91，同 compose #87 修复链）
    postJSON<{ file: string; overwritten: boolean; errors?: string[]; autoFixes?: { step: string; addedDep: string }[] }>("/workflows/graph", body),
  runs: () => getJSON<RunSummary[]>("/runs"),
  run: (id: string) => getJSON<RunSummary>(`/runs/${encodeURIComponent(id)}`),
  deleteRun: (id: string) => delJSON<{ ok: boolean }>(`/runs/${encodeURIComponent(id)}`),
  // budget:true = 省钱模式，轻活步骤自动降便宜档（后端 R3.2，桌面/web 同一后端）
  compose: (body: { description: string; roles: string[]; name?: string; provider?: string; lang?: string; budget?: boolean; roleLang?: string }) =>
    postJSON<ComposeResult>("/compose", body),
  // 团队 / Loadout：可复用角色阵容，与 `ao team` CLI 共用 ~/.ao/teams
  teams: () => getJSON<{ teams: Team[] }>("/teams").then((r) => r.teams),
  saveTeam: (body: { name: string; description?: string; roles: TeamRole[]; lang?: string; provider?: string }) =>
    postJSON<{ ok: boolean; slug: string; file: string }>("/teams", body),
  deleteTeam: (slug: string) => delJSON<{ ok: boolean }>(`/teams/${encodeURIComponent(slug)}`),
  // 把人工输入写回正在等待的运行（human_input / approval 节点暂停时）
  runInput: (runId: string, text: string) =>
    postJSON<{ ok: boolean }>("/run-input", { runId, text }),
  // ── 多智能体 vs 单次基线对比（本地引擎，非流式，可能较慢）──
  compare: (body: { file: string; inputs: Record<string, string>; provider?: string }) =>
    postJSON<CompareResult>("/compare", body),
  // ── 对话：不组队，直接用当前 provider 的模型回答（多轮历史整包带上）。
  // role（如 "engineering/engineering-sre"）可选 = 带该角色人设的多轮对话 ──
  chat: (body: { messages: ChatMessage[]; provider?: string; lang?: string; role?: string; roleLang?: string }) =>
    postJSON<{ content: string; usage?: { input_tokens: number; output_tokens: number } }>("/chat", body),
  // ── Prompt Lab ──
  optimizePrompt: (body: { rawPrompt: string; mode: PromptMode; provider?: string; lang?: string; model?: string }) =>
    postJSON<{ optimized: string }>("/prompt/optimize", body),
  testPrompt: (body: { prompt: string; mode: PromptMode; testInput: string; provider?: string; model?: string }) =>
    postJSON<{ output: string }>("/prompt/test", body),
  scorePrompts: (body: { testInput: string; candidates: { label: string; output: string }[]; provider?: string; lang?: string }) =>
    postJSON<ScoreResult>("/prompt/score", body),
  // ── 系统 Claude Code 急救：诊断/修复被别的软件或手动写坏的全局 ~/.claude/settings.json ──
  claudeHealth: () => getJSON<ClaudeHealth>("/claude/health"),
  repairClaude: () => postJSON<ClaudeRepairResult>("/claude/repair", {}),
  claudeSwitchStatus: () => getJSON<ClaudeSwitchStatus>("/claude/status"),
  restoreClaude: () => postJSON<ClaudeRestoreResult>("/claude/restore", {}),
  // 把已配置的中转写入全局 ~/.claude/settings.json（后端从 web-keys.json 解析 key，前端只传 provider id）
  applyClaude: (provider: string) => postJSON<ClaudeApplyResult>("/claude/apply", { provider }),
  claudeProxy: () => getJSON<ClaudeProxyStatus>("/claude/proxy"),
  syncClaudeProxy: () => postJSON<{ ok: boolean; configured: boolean; changed: boolean; proxyUrl?: string }>("/claude/proxy/sync", {}),
  clearClaudeProxy: () => postJSON<{ ok: boolean; changed: boolean }>("/claude/proxy/clear", {}),
  prompts: () => getJSON<{ prompts: PromptRecord[] }>("/prompts").then((r) => r.prompts),
  savePrompt: (body: { name: string; mode: PromptMode; versions: PromptVersion[]; favorite?: boolean }) =>
    postJSON<{ ok: boolean; slug: string }>("/prompts", body),
  deletePrompt: (slug: string) => delJSON<{ ok: boolean }>(`/prompts/${encodeURIComponent(slug)}`),
  promptGarden: () => getJSON<{ seeds: GardenSeed[] }>("/prompt/garden").then((r) => r.seeds),
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
  body: { file: string; inputs?: Record<string, string>; provider?: string; resume?: string | boolean; fromStep?: string; feedback?: string; materialize?: boolean },
  onEvent: SseHandler,
  signal?: AbortSignal,
) {
  return streamSse("/run", body, onEvent, signal);
}

export function runRole(
  body: { role: string; task: string; provider?: string; lang?: string; roleLang?: string },
  onEvent: SseHandler,
  signal?: AbortSignal,
) {
  return streamSse("/run-role", body, onEvent, signal);
}

// 默认 provider：旗舰赞助商 APINEBULA（取代原来的 DeepSeek 默认）
// 默认 provider 位 = 进阶赞助商定制权益（2026-07-17 调整：apinebula → duoyuanx，
// 与服务端 AO_PROVIDER 兜底、无凭证引导首位保持一致）
export const DEFAULT_PROVIDER = "duoyuanx";

/**
 * 需要 API key 的云端聚合 provider 的统一注册表（Studio 前端专用）。
 * 新增一家（未来会越来越多）只需在这里加一条 —— ProvidersPanel 的卡片/模型建议、
 * 顶部 provider 下拉、"需配置 key" 判断、赞助商标记都从这里派生，不用五处分别改。
 * 中英文 hint 文案（仅赞助商需要）单独在 i18n/translations.ts 里维护。
 * 后端连接逻辑（env 变量名、默认 base_url/模型）对应的注册表在 src/connectors/api-providers.ts。
 */
export interface ApiProviderMeta {
  id: string;
  name: string;
  /** 下拉选择器里的短名，缺省用 name（如 Claude 卡片名带 "(Anthropic)" 后缀，下拉里只要短名） */
  shortName?: string;
  hint: string;
  /** 默认接入点（展示用,和后端 src/connectors/api-providers.ts 保持一致）——留空 base_url 时实际用的就是它 */
  defaultBaseUrl?: string;
  /** 注册/领取 key 的直达链接（赞助商带推广参数） */
  signupUrl?: string;
  /** true=模型公司官方 API(如 DeepSeek/Anthropic/OpenAI),false/缺省=聚合平台 */
  vendor?: boolean;
  flagship?: boolean;
  /** 进阶赞助商 —— 视觉与旗舰同款金色高亮+星标,仅徽章文案不同(进阶赞助商),用于置顶展示的重点赞助商 */
  advanced?: boolean;
  sponsor?: boolean;
  modelSuggestions?: string[];
}

// 「一个 key 通 Claude/GPT/Gemini 等多家」的跨家中转，没 key 时的常用模型兜底：
// 各家旗舰对话模型，够日常直接挑；要全量仍是填 key 后点「获取模型列表」。
// 只列仓库内已知的真实模型名（不臆造），换代时随版本更新，或走远程清单 providerOverrides 覆盖。
export const COMMON_RELAY_MODELS = [
  "claude-opus-4-8",
  "claude-sonnet-5",
  "claude-haiku-4-5-20251001",
  "gpt-5.5",
  "gpt-5.4-mini",
  "gpt-4o",
  "gemini-3.5-flash",
  "deepseek-chat",
  "deepseek-reasoner",
];

// modelSuggestions 是「没配 key / 拉取失败」时的静态兜底展示——真实列表优先走该
// 供应商的 GET /models（配了 key 即生效）；模型换代时优先改官网远程清单的
// providerOverrides（push 即生效，不用发版），这里的静态基线随版本更新兜底。
export const API_PROVIDERS: ApiProviderMeta[] = [
  // 进阶赞助商 多元探索 DuoyuanX —— 置顶第一 + 主色(紫)高亮；全球 AI 模型 API 聚合与源头直供：
  // 一个 key 通 OpenAI/Claude/Gemini/DeepSeek 等数百款；专属链接注册送 3 元
  { id: "duoyuanx", name: "多元探索", shortName: "多元探索", hint: "duoyuanx.com · 注册送 3 元", defaultBaseUrl: "https://duoyuanx.com/v1", signupUrl: "https://duoyuanx.com/register?aff=LErO", advanced: true, modelSuggestions: COMMON_RELAY_MODELS },
  // 旗舰赞助商 APINEBULA —— 金色高亮（大屏特有）
  { id: "apinebula", name: "APINEBULA", hint: "apinebula.ai", defaultBaseUrl: "https://apinebula.ai/v1", signupUrl: "https://apinebula.ai/V6ekjG", flagship: true, modelSuggestions: ["gpt-5.5", "claude-opus-4-8", "claude-sonnet-5", "gemini-3.5-flash", "deepseek-chat"] },
  // 普通赞助商 RootFlowAI —— 前 3 位，紧跟两家旗舰/赞助商之后
  { id: "rootflowai", name: "RootFlowAI", hint: "rootflowai.com", defaultBaseUrl: "https://api.rootflowai.com/v1", signupUrl: "https://rootflowai.com/register?utm_source=agency-agents-zh&utm_medium=sponsor&utm_campaign=studio", sponsor: true, modelSuggestions: COMMON_RELAY_MODELS },
  // 赞助商 Cubence —— API 中转：一个 key 通用多家模型（此为直连 API 用法；
  // 给本地 CLI 配中转的另一用法见 CLI_RELAY_PRESETS，两者共用同一账号）
  { id: "cubence", name: "Cubence", hint: "api.cubence.com", defaultBaseUrl: "https://api.cubence.com/v1", signupUrl: "https://cubence.com/signup?code=SCW29JP9&source=agency", sponsor: true, modelSuggestions: COMMON_RELAY_MODELS },
  // CCSub（赞助商）—— 一个 key 通 Claude/GPT/Gemini/DeepSeek 全家桶,官方约 1/3 价,注册送 $5;
  // 统一端点 www.ccsub.net 同时兼容 Anthropic 与 OpenAI（此处直连走 OpenAI 兼容 /v1）
  { id: "ccsub", name: "CCSub", hint: "www.ccsub.net · 注册送 $5", defaultBaseUrl: "https://www.ccsub.net/v1", signupUrl: "https://www.ccsub.net/register?ref=8G5W4JK4", sponsor: true, modelSuggestions: COMMON_RELAY_MODELS },
  // 火山引擎（赞助商）—— 字节跳动火山方舟：豆包/Kimi/GLM 等，注册领 2500 万 Tokens；
  // 直连走 OpenAI 兼容 /api/v3（配 key 后可点「获取模型列表」拉全量），Claude Code 中转见 CLI_RELAY_PRESETS
  { id: "volcengine", name: "火山引擎", hint: "ark.cn-beijing.volces.com", defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3", signupUrl: "https://www.volcengine.com/activity/ai618?utm_campaign=hw&utm_content=hw&utm_medium=devrel_tool_web&utm_source=OWO&utm_term=agency-agents-zh", sponsor: true, modelSuggestions: ["doubao-seed-2-1-pro-260628"] },
  // 普通赞助商 CompShare（优云智算）—— 排在赞助商组最后一位
  { id: "compshare", name: "CompShare", hint: "console.compshare.cn", defaultBaseUrl: "https://api.modelverse.cn/v1", signupUrl: "https://passport.compshare.cn/register?referral_code=ETD3L5JBM13CtKARkMORot&ytag=GPU_YY_YX_git_agency-agents", sponsor: true, modelSuggestions: ["deepseek-ai/DeepSeek-V3.2", "deepseek-ai/DeepSeek-R1", "Qwen/Qwen3-Coder-480B-A35B-Instruct", "MiniMaxAI/MiniMax-M2.7"] },
  { id: "deepseek", name: "DeepSeek", hint: "platform.deepseek.com", defaultBaseUrl: "https://api.deepseek.com/v1", vendor: true, modelSuggestions: ["deepseek-chat", "deepseek-reasoner"] },
  // 默认端点**不带 /v1**：Anthropic 客户端（SDK / claude CLI）自己会接 /v1/messages，
  // base 里再写一遍就成了 /v1/v1/messages。这里是用户配中转时照抄的形状样板，写错等于
  // 教错——doctor 也按同一口径提示（多写 /v1 会被明确指出来）。
  { id: "claude", name: "Claude (Anthropic)", shortName: "Claude", hint: "console.anthropic.com", defaultBaseUrl: "https://api.anthropic.com", vendor: true, modelSuggestions: ["claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5-20251001"] },
  { id: "openai", name: "OpenAI", hint: "gpt-5.5 {etc} · platform.openai.com", defaultBaseUrl: "https://api.openai.com/v1", vendor: true, modelSuggestions: ["gpt-5.5", "gpt-5.4-mini", "gpt-4o"] },
  { id: "agnes", name: "Agnes AI", hint: "agnes-2.0-flash · agnes-ai.com", defaultBaseUrl: "https://apihub.agnes-ai.com/v1", modelSuggestions: ["agnes-2.0-flash", "agnes-1.5-flash"] },
];

export const API_PROVIDER_MAP: Record<string, ApiProviderMeta> = Object.fromEntries(
  API_PROVIDERS.map((p) => [p.id, p]),
);

/**
 * 支持"自定义中转"的本地 CLI provider —— 这些官方 CLI 都能把请求指向第三方中转
 * 服务（如 Cubence），不需要登录官方账号也能用，前端只收集 base_url + token 两个
 * 字段。claude-code / gemini-cli 走环境变量（ANTHROPIC_BASE_URL+ANTHROPIC_AUTH_TOKEN
 * / GOOGLE_GEMINI_BASE_URL+GEMINI_API_KEY），只影响 AO spawn 出的子进程，不碰用户
 * 全局配置。codex-cli 比较特殊：它没有环境变量覆盖机制，只能通过改写用户 home 目录
 * 下的 ~/.codex/config.toml + auth.json 生效——这两个文件在项目之外，保存前
 * 后端会自动备份原文件（.ao-backup-<时间戳>），但仍然是全局生效（会影响你在 AO
 * 之外直接用 codex 命令行的行为），需要在 UI 里对这一条给更明确的提示。
 */
export const CLI_RELAY_SUPPORT = new Set(["claude-code", "gemini-cli", "codex-cli"]);
/** 中转配置是"全局生效"（写用户 home 目录下的真实 CLI 配置文件）而非仅影响 AO 子进程的 provider。 */
export const CLI_RELAY_GLOBAL_WRITE = new Set(["codex-cli"]);

/** CLI 中转商预设：点一下自动填对应 CLI 的 base_url（不同 CLI 的端点可能不同），token 用户自己填。 */
export interface CliRelayPreset {
  name: string;
  sponsor?: boolean;
  /** 注册/领取 token 的直达链接（赞助商带推广参数） */
  signupUrl?: string;
  /** provider id → 该 CLI 应填的中转 base_url */
  baseUrls: Record<string, string>;
  /**
   * 该中转商的 **Anthropic Messages 协议**接入点，用于 AO 直连（provider: claude + base_url），
   * 不是给本地 CLI 用的。填了就会在「Claude (Anthropic)」供应商配置页出现一键填充。
   * 只列确认过是 Anthropic 协议的（AICodeMirror 的 /api/claudecode 即是；对齐 cc-switch
   * 的 opencode/openclaw 预设：@ai-sdk/anthropic、api: "anthropic-messages"）。
   */
  anthropicApiBaseUrl?: string;
  /** 可选的 Claude Code 三档模型映射预填（中转商模型名 ≠ claude 官方名时用，对齐 cc-switch） */
  sonnetModel?: string;
  opusModel?: string;
  haikuModel?: string;
}
export const CLI_RELAY_PRESETS: CliRelayPreset[] = [
  // APINEBULA（旗舰赞助商）—— 银河录像局旗下 AI 聚合平台，一个账号给三个编码 CLI 配中转，
  // 但**同一域名不同格式端点不同**：Claude Code 走 Anthropic 兼容端点（根路径，**不带 /v1**）、
  // Codex 走 OpenAI 兼容 /v1、Gemini CLI 走 Google 端点（根路径）。填错会 401，所以这里锁死映射。
  // 聚合模型名用 claude/gpt/gemini 官方名（见 apinebula defaultProvider 的 modelSuggestions），无需三档重映射。
  {
    name: "APINEBULA",
    sponsor: true,
    signupUrl: "https://apinebula.ai/V6ekjG",
    baseUrls: {
      "claude-code": "https://apinebula.ai",
      "gemini-cli": "https://apinebula.ai",
      "codex-cli": "https://apinebula.ai/v1",
    },
  },
  // Cubence（赞助商）—— 专业 API 中转服务商,支持 Claude Code / Codex / Gemini CLI;
  // 主端点 api.cubence.com(与 cc-switch 预设一致;另有 api-cf/api-dmit/api-bwg 备用线路,
  // 见 docs.cubence.com);Codex 走 /v1,另两个是根路径
  {
    name: "Cubence",
    sponsor: true,
    signupUrl: "https://cubence.com/signup?code=SCW29JP9&source=agency",
    baseUrls: {
      "claude-code": "https://api.cubence.com",
      "gemini-cli": "https://api.cubence.com",
      "codex-cli": "https://api.cubence.com/v1",
    },
  },
  // 火山引擎（赞助商）—— 火山方舟给 Claude Code 配中转走 Anthropic 兼容端点 /api/compatible，
  // Codex 走主数据面 /api/v3（原生 Responses API）；豆包模型名 ≠ claude 官方名，三档统一映射
  // doubao-seed-2-1-pro（端点与模型对齐 cc-switch 的「豆包 Seed」预设）。gemini-cli 无对应端点，不列。
  {
    name: "火山引擎",
    sponsor: true,
    signupUrl: "https://www.volcengine.com/activity/ai618?utm_campaign=hw&utm_content=hw&utm_medium=devrel_tool_web&utm_source=OWO&utm_term=agency-agents-zh",
    baseUrls: {
      "claude-code": "https://ark.cn-beijing.volces.com/api/compatible",
      "codex-cli": "https://ark.cn-beijing.volces.com/api/v3",
    },
    sonnetModel: "doubao-seed-2-1-pro-260628",
    opusModel: "doubao-seed-2-1-pro-260628",
    haikuModel: "doubao-seed-2-1-pro-260628",
  },
  // AICodeMirror（赞助商）—— Claude / Codex / Gemini 官方高稳定中转。
  // 三个端点各不相同，且**都不是**其它中转商那种"根路径 / /v1"布局，抄错必 401：
  //   Claude Code → /api/claudecode（Anthropic 兼容，CLI 自己接 /v1/messages）
  //   Gemini CLI  → /api/gemini
  //   Codex       → /api/codex/backend-api/codex（ChatGPT backend 风格；AO 写 codex
  //                 config.toml 时 wire_api="responses"，实际请求落到 .../codex/responses，
  //                 与它宣传的"Codex 官方渠道"一致，不是 OpenAI 兼容的 /v1）
  // 注意域名：官网/注册页是 aicodemirror.ai，**API 主机是 aicodemirror.com**（.ai 的
  // api 子域也可达，但以 .com 为准，与官方一键配置脚本一致）。
  // 已探测核实：/api/claudecode、/api/codex、/api/gemini 三个前缀均返回 401（存在、仅 key 无效），
  // 而同级不存在的前缀（如 /api/zzz、根 /v1/chat/completions）返回 404 —— 401 不是网关对全站的
  // 兜底应答，确实代表路径存在。前缀之下的具体子路径被鉴权网关挡住，无法无 key 验证，
  // 取值以官方一键配置脚本 / 官方接入文档为准。
  {
    name: "AICodeMirror",
    sponsor: true,
    signupUrl: "https://www.aicodemirror.ai/register?invitecode=XO5L7R",
    // 直连 API 走 Anthropic Messages 协议（不是 OpenAI 兼容——根 /v1/chat/completions
    // 实测 404），所以不进 API_PROVIDERS 那张 OpenAI 兼容表，而是配在 provider: claude
    // 上。SDK 会自己接 /v1/messages，落到 /api/claudecode/v1/messages（实测 401=存在）。
    anthropicApiBaseUrl: "https://api.aicodemirror.com/api/claudecode",
    baseUrls: {
      "claude-code": "https://api.aicodemirror.com/api/claudecode",
      "gemini-cli": "https://api.aicodemirror.com/api/gemini",
      "codex-cli": "https://api.aicodemirror.com/api/codex/backend-api/codex",
    },
  },
];

// CLI 列表必须和后端 web/server.js 的 CLI_PROVIDERS 对齐——之前漏了 codex/copilot/hermes,
// 导致面板里能看到、顶部下拉却选不了(用户实测 codex 已检测到但无法切换)
export const CLI_PROVIDER_IDS = new Set(["claude-code", "gemini-cli", "codex-cli", "copilot-cli", "openclaw-cli", "hermes-cli"]);
export const PROVIDERS = [...API_PROVIDERS.map((p) => p.id), ...CLI_PROVIDER_IDS, "ollama"];

// 仅品牌名（语言无关）。
export const PROVIDER_LABELS: Record<string, string> = {
  ...Object.fromEntries(API_PROVIDERS.map((p) => [p.id, p.shortName ?? p.name])),
  "claude-code": "Claude Code CLI",
  "gemini-cli": "Gemini CLI",
  "codex-cli": "Codex CLI",
  "copilot-cli": "Copilot CLI",
  "openclaw-cli": "OpenClaw CLI",
  "hermes-cli": "Hermes CLI",
  ollama: "Ollama",
};
