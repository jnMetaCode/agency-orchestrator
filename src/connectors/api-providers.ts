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
  // RootFlowAI —— 大模型 API 聚合平台（赞助已于 2026-08 下架，provider 保留可用，
  // 免得已配好 key 的用户突然连不上）
  { id: 'rootflowai', envKey: 'ROOTFLOWAI_API_KEY', envBase: 'ROOTFLOWAI_BASE_URL', defaultBaseUrl: 'https://api.rootflowai.com/v1', defaultModel: 'claude-sonnet-5' },
  // Cubence（赞助商）—— API 中转：一个 key 直连 Claude / GPT / Gemini 等多家模型
  // （OpenAI 兼容端点 /v1）；同一账号还可给本地 CLI 配中转（见 CLI_RELAY_PRESETS）
  { id: 'cubence', envKey: 'CUBENCE_API_KEY', envBase: 'CUBENCE_BASE_URL', defaultBaseUrl: 'https://api.cubence.com/v1', defaultModel: 'claude-sonnet-5' },
  // CCSub（赞助商）—— AI API 中转：一个 key 通 Claude / GPT / Gemini / DeepSeek 全家桶，
  // CCSub —— 统一端点 www.ccsub.net 同时兼容 Anthropic 与 OpenAI 协议（此处走 OpenAI 兼容 /v1）；
  // 赞助已于 2026-08 下架，provider 保留可用（同 RootFlowAI，不搞坏已配好 key 的用户）
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
  // LanoX AI（赞助商）—— 全球模型聚合：GPT / Claude / Gemini / Qwen / Grok 等 500+ 款。
  // 直连走 OpenAI 兼容 api.lanox.ai/v1。官方文档口径：Base URL `https://api.lanox.ai`，
  // 鉴权 `Authorization: Bearer`，三个端点 GET /v1/models、POST /v1/chat/completions、
  // POST /v1/responses；**OpenAI / Qwen / Gemini 共用 OpenAI 兼容端点，Claude 走 Anthropic
  // Messages 原生端点**（所以 Claude 系模型请用 provider: claude + base_url，见 CLI_RELAY_PRESETS
  // 的 anthropicApiBaseUrl；实测 /v1/messages 对 x-api-key 与 Bearer 两种头都认）。
  // 注意 base 要带 /v1：文档写的 Base URL 是根地址，照抄进来会打到 /chat/completions，而它对
  // 不存在的路径回的是 **HTTP 200 + 正文 {"code":"404"}**（不是 404）——引擎已能识别这种网关壳
  // 并自动改试 /v1（见 endpoint.ts 的 isGatewayRouteMissShell），但默认值这里直接给对的。
  // **不设 defaultModel**：无 key 拿不到它实际上架并已定价的模型名，猜一个写进去就是
  // 多元探索踩过的坑（默认模型平台没上架 → 一跑就报错）。留空 = 强制用户在下拉里自选，
  // 配了 key 点「获取模型列表」即拉全量；确认后再补默认值（或走清单 providerOverrides）。
  { id: 'lanox', envKey: 'LANOX_API_KEY', envBase: 'LANOX_BASE_URL', defaultBaseUrl: 'https://api.lanox.ai/v1' },
  // 胜算云 ShengSuanYun（赞助商）—— 面向 AI 原生团队的模型 API 聚合：Claude / ChatGPT /
  // Gemini 等海内外大模型 + 多媒体模型，合规 API 直供（不做逆向）。
  // 端点已探测核实：OpenAI 兼容在 **router.shengsuanyun.com/api/v1**（api.shengsuanyun.com
  // 那个域名整站 404，别照着主域猜），无 key 时 /api/v1/chat/completions 回 401
  // invalid_api_key（存在、仅鉴权失败），而同级乱写路径回的是 404 —— 401 不是全站兜底。
  // 与 LanoX 不同，**它的模型清单 GET /api/v1/models 无需 key 就能拉**，且每个模型自带
  // pricing 与 support_apis，所以默认模型不用猜：claude-sonnet-5 在列、已定价、
  // support_apis 含 /v1/chat/completions（2026-08-14 实拉核实）。模型名带厂商前缀。
  { id: 'shengsuanyun', envKey: 'SHENGSUANYUN_API_KEY', envBase: 'SHENGSUANYUN_BASE_URL', defaultBaseUrl: 'https://router.shengsuanyun.com/api/v1', defaultModel: 'anthropic/claude-sonnet-5' },
];

export const API_PROVIDER_MAP: Record<string, ApiProviderSpec> = Object.fromEntries(
  API_PROVIDERS.map((p) => [p.id, p]),
);

/**
 * **Anthropic 原生协议**的云端 provider（走 ClaudeConnector，不是 OpenAI 兼容）。
 *
 * 单独一张表而不是塞进 API_PROVIDERS：那张表的语义是"OpenAI 兼容，统一走
 * OpenAICompatibleConnector"，混进 Anthropic 协议的会被用错协议去请求
 * （POST /v1/chat/completions → 404），且这种错要等真跑起来才暴露。
 *
 * 与 `claude` 的区别：`claude` 是官方端点 + ANTHROPIC_API_KEY，这里是中转商各自的
 * 端点与 key（各用各的 env 变量名，互不串台 —— 共用一个变量名正是之前把 claude-code
 * 订阅 CLI 一起改道的根因）。
 */
export interface AnthropicProviderSpec {
  id: string;
  envKey: string;
  envBase: string;
  defaultBaseUrl: string;
  defaultModel?: string;
}

export const ANTHROPIC_PROVIDERS: AnthropicProviderSpec[] = [
  // AICodeMirror（赞助商）—— Claude / Codex / Gemini 官方高稳定中转。
  // 直连走 Anthropic Messages 协议：base 不带 /v1，客户端自己接 /v1/messages
  // （已探测核实：/api/claudecode 前缀 401=存在，根 /v1/chat/completions 404=没有
  // OpenAI 兼容端点）。同一账号给编码 CLI 配中转见前端 CLI_RELAY_PRESETS。
  {
    id: 'aicodemirror',
    envKey: 'AICODEMIRROR_API_KEY',
    envBase: 'AICODEMIRROR_BASE_URL',
    defaultBaseUrl: 'https://api.aicodemirror.com/api/claudecode',
    defaultModel: 'claude-sonnet-5',
  },
];

export const ANTHROPIC_PROVIDER_MAP: Record<string, AnthropicProviderSpec> = Object.fromEntries(
  ANTHROPIC_PROVIDERS.map((p) => [p.id, p]),
);
