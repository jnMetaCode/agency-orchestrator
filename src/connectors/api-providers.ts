/**
 * OpenAI 兼容型云端 API provider 的统一注册表。
 *
 * 新增一家聚合商 / 官方 API（未来会越来越多），只需在这里加一条 ——
 * factory.ts（连接器构造）、cli.ts（--api-key/--base-url 落盘 env 变量路由、
 * --model 默认值）、web/server.js（Studio 供应商面板的 key 存取 + 默认模型）
 * 都从这里读，不用三处分别改。
 *
 * 不在此列的 provider：claude（原生 SDK，非 OpenAI 兼容）、
 * claude-code/gemini-cli/... 等本地 CLI、ollama（本地模型，无需 key）——
 * 这些走各自专属逻辑，不适合塞进这张表。
 */
export interface ApiProviderSpec {
  id: string;
  /** 存 API key 的环境变量名 */
  envKey: string;
  /** 存自定义 base_url 的环境变量名 */
  envBase: string;
  /** 未设置 base_url 时的默认接入点 */
  defaultBaseUrl: string;
  /** 未指定 --model 时的默认模型（无通用默认值的 provider 留空，强制用户自选） */
  defaultModel?: string;
}

export const API_PROVIDERS: ApiProviderSpec[] = [
  { id: 'deepseek', envKey: 'DEEPSEEK_API_KEY', envBase: 'DEEPSEEK_BASE_URL', defaultBaseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat' },
  { id: 'openai', envKey: 'OPENAI_API_KEY', envBase: 'OPENAI_BASE_URL', defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-5.5' },
  // 优云智算 / CompShare ModelVerse（赞助商）—— 模型如 deepseek-ai/DeepSeek-R1，无通用默认模型
  { id: 'compshare', envKey: 'COMPSHARE_API_KEY', envBase: 'COMPSHARE_BASE_URL', defaultBaseUrl: 'https://api.modelverse.cn/v1' },
  // APINEBULA（旗舰赞助商）—— 银河录像局旗下 AI 聚合平台，聚合 Claude / GPT / Gemini 满血直连
  // （此处直连走 OpenAI 兼容 /v1）；同一账号给编码 CLI 配中转的端点按格式不同：Claude Code 走
  // Anthropic 兼容根路径 https://apinebula.ai（不带 /v1）、Codex 走 /v1、Gemini 走根路径，见前端 CLI_RELAY_PRESETS。
  { id: 'apinebula', envKey: 'APINEBULA_API_KEY', envBase: 'APINEBULA_BASE_URL', defaultBaseUrl: 'https://apinebula.ai/v1', defaultModel: 'gpt-5.5' },
  // Agnes AI —— key 只从 env / 配置读,绝不在代码里写死(写死=随包公开,免费额度会被刷爆)
  { id: 'agnes', envKey: 'AGNES_API_KEY', envBase: 'AGNES_BASE_URL', defaultBaseUrl: 'https://apihub.agnes-ai.com/v1', defaultModel: 'agnes-2.0-flash' },
  // RootFlowAI（赞助商）—— 大模型 API 聚合平台，聚合 Claude / GPT / Gemini
  { id: 'rootflowai', envKey: 'ROOTFLOWAI_API_KEY', envBase: 'ROOTFLOWAI_BASE_URL', defaultBaseUrl: 'https://api.rootflowai.com/v1', defaultModel: 'claude-sonnet-5' },
  // Cubence（赞助商）—— API 中转：一个 key 直连 Claude / GPT / Gemini 等多家模型
  // （OpenAI 兼容端点 /v1）；同一账号还可给本地 CLI 配中转（见 CLI_RELAY_PRESETS）
  { id: 'cubence', envKey: 'CUBENCE_API_KEY', envBase: 'CUBENCE_BASE_URL', defaultBaseUrl: 'https://api.cubence.com/v1', defaultModel: 'claude-sonnet-5' },
  // CCSub（赞助商）—— AI API 中转：一个 key 通 Claude / GPT / Gemini / DeepSeek 全家桶，
  // 统一端点 www.ccsub.net 同时兼容 Anthropic 与 OpenAI 协议（此处走 OpenAI 兼容 /v1）
  { id: 'ccsub', envKey: 'CCSUB_API_KEY', envBase: 'CCSUB_BASE_URL', defaultBaseUrl: 'https://www.ccsub.net/v1', defaultModel: 'claude-sonnet-5' },
  // 火山引擎（赞助商）—— 字节跳动火山方舟 Ark：豆包 / Kimi / GLM 等模型。直连走 OpenAI 兼容
  // 主数据面 /api/v3；key 用官方环境变量名 ARK_API_KEY（console.volcengine.com/ark 创建）。
  // 给 Claude Code / Codex 配中转的另一用法见前端 CLI_RELAY_PRESETS（Anthropic 兼容 /api/compatible）。
  { id: 'volcengine', envKey: 'ARK_API_KEY', envBase: 'VOLCENGINE_BASE_URL', defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3', defaultModel: 'doubao-seed-2-1-pro-260628' },
  // 多元探索 DuoyuanX（赞助商）—— 全球 AI 模型 API 聚合与源头直供：一个 key 通 OpenAI /
  // Claude / Gemini / DeepSeek 等数百款模型。OpenAI 兼容端点 duoyuanx.com/v1。
  // 默认模型必须选平台实际上架且已定价的：claude-sonnet-5 未上架（报"价格尚未由管理员设置"），
  // claude-sonnet-4-6 实测可用（2026-07-17 真 key 连通验证）。
  { id: 'duoyuanx', envKey: 'DUOYUANX_API_KEY', envBase: 'DUOYUANX_BASE_URL', defaultBaseUrl: 'https://duoyuanx.com/v1', defaultModel: 'claude-sonnet-4-6' },
];

export const API_PROVIDER_MAP: Record<string, ApiProviderSpec> = Object.fromEntries(
  API_PROVIDERS.map((p) => [p.id, p]),
);
