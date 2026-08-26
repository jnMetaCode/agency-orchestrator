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
  // 方舟 Agent Plan 套餐：**另一把专属 key + 另一个 base**（/api/plan/v3，用 /api/v3 会按量扣费），所以单独成一条——
  // 同一台机器上"文本/图片走套餐、视频走按量"才配得开。文本模型按套餐页写 ark-code-latest（Auto 路由）；
  // 图片 doubao-seedream-5.0-lite 真机通（2026-08-26）；Medium 没有视频配额（Large 起），故不进 VIDEO_PROVIDERS。
  { id: 'volcengine-plan', envKey: 'ARK_PLAN_API_KEY', envBase: 'VOLCENGINE_PLAN_BASE_URL', defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3', defaultModel: 'ark-code-latest' },
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
  // APIMart（赞助商）—— OpenAI 兼容网关，主打 AI 图片/视频生成的低价供给（GPT-Image-2
  // 低至 $0.006/张），同一个 key 也通聊天模型。接进来的真正理由是 **/v1/images/generations
  // 正是引擎 `type: image` 步骤打的第一个端点**，创意库「一键出图」走的也是同一条路。
  // 端点已探测核实（2026-08-23）：
  //   无 key   → /v1/models、/v1/chat/completions、/v1/images/generations 三条均回
  //              401 {"type":"apimart_error","message":"invalid API key"}（路径存在、仅鉴权失败）
  //   带 key   → 402 insufficient balance（余额为 0 的账户）——鉴权链路通，是余额拦的
  // 两种口径都不是"对不存在的路径回 200"的网关假壳，路径真实。
  // **不设 defaultModel / modelSuggestions**：零余额账户连 GET /v1/models 也回 402，
  // 模型编码一个都没核实过，猜一个写进去就是多元探索踩过的坑（默认模型平台没上架 → 一跑就报错）。
  // 留空 = 强制用户自选；配了 key 点「获取模型列表」即拉真实全量（同 LanoX 的处理）。
  { id: 'apimart', envKey: 'APIMART_API_KEY', envBase: 'APIMART_BASE_URL', defaultBaseUrl: 'https://api.apimart.ai/v1' },

  // ── 第一方厂商官方 API（非赞助商，2026-08 补齐）────────────────────────────
  // **范围是有意收住的：只收这五家主流**（2026-08-14 决定）。cc-switch 还带着
  // OpenRouter / 硅基流动 / MiniMax 等，Groq、Mistral 也都实测可用 —— 我们不跟进：
  // 供应商列表同时是赞助商的货架，每多一条都在稀释曝光；长尾需求用 Studio 的
  // 「添加自定义供应商」填个 OpenAI 兼容端点就能用，不必进内置注册表。
  // 想再加请先确认这是商务上的决定，别当成"顺手补齐"。
  // 端点均已无 key 实测存在（401/400 = 鉴权失败而非 404）。**一律不设 defaultModel**：
  // 拿不到各家原生模型清单（要 key），而各家的编码互不通用，猜一个就是给用户埋一个
  // "跑起来才报模型不存在"。配了 key 在 Studio 点「获取模型列表」即拉真实全量——
  // 这五家都提供 OpenAI 兼容的 GET /models。
  //
  // Gemini：gemini-cli 已于 2026-06-18 停服，而云端列表里一直没有 Gemini 直连，
  // 用户想用只能绕聚合商。这里补的是 Google 官方的 **OpenAI 兼容层**
  // （/v1beta/openai，不是原生 generateContent）。
  // **env 名必须与 gemini-cli 那条分开**：server.js 的 KEY_ENV 里 gemini-cli 用的是
  // GEMINI_API_KEY / GOOGLE_GEMINI_BASE_URL，共用会把用户本机的 CLI 一起改道 ——
  // 与 ANTHROPIC_BASE_URL 那次是同一个坑（有断言钉着）。
  { id: 'gemini', envKey: 'GOOGLE_GENAI_API_KEY', envBase: 'GOOGLE_GENAI_BASE_URL', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  // xAI Grok —— 官方 OpenAI 兼容端点
  { id: 'xai', envKey: 'XAI_API_KEY', envBase: 'XAI_BASE_URL', defaultBaseUrl: 'https://api.x.ai/v1' },
  // 月之暗面 Moonshot（Kimi）—— 官方 OpenAI 兼容端点
  { id: 'moonshot', envKey: 'MOONSHOT_API_KEY', envBase: 'MOONSHOT_BASE_URL', defaultBaseUrl: 'https://api.moonshot.cn/v1' },
  // 智谱 GLM —— 开放平台 v4（路径自带版本段 /paas/v4，**不是** /v1）
  { id: 'zhipu', envKey: 'ZHIPU_API_KEY', envBase: 'ZHIPU_BASE_URL', defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  // 阿里通义千问 —— DashScope 的 OpenAI **兼容模式**端点（原生 DashScope 协议不通用）；
  // key 用官方环境变量名 DASHSCOPE_API_KEY
  { id: 'qwen', envKey: 'DASHSCOPE_API_KEY', envBase: 'DASHSCOPE_BASE_URL', defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
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

/**
 * 文生视频供应商（`type: video` 步骤的端点表）。
 *
 * **第三张表，别往前两张里塞**：视频不是 OpenAI 兼容的一次性请求，而是
 * 「建任务 → 轮询状态 → 下载成品」的异步流程，请求体与响应形状都跟 chat/images 无关。
 * 混进 API_PROVIDERS 会让 Studio 的模型下拉、省钱模式、图片端点推断全部误判。
 *
 * 秘塔科技（赞助商）的 MiniMax H3：端点是把 MiniMax 官方 API 换了个 Host，
 * 2026-08-23 用真实 key 实探核实：
 *   建任务  POST {base}/v2/video_generation      → {"task_id":"…"}
 *   查状态  GET  {base}/v2/query/video_generation → {"items":[…],"total":n}
 *   成品    items[].content.url（files.metaso.cn 的签名链接，带 expires）
 * 坑：**查询接口不严格匹配 task_id**——传 task_id=1 也照样 200 并列出账号里所有任务，
 * 所以必须自己按 id 过滤，拿 items[0] 当结果迟早张冠李戴（见 video.ts）。
 * v1 路径、/files/retrieve 都是 404，只有 v2 这两条在。
 */
export interface VideoProviderSpec {
  id: string;
  envKey: string;
  envBase: string;
  defaultBaseUrl: string;
  /**
   * 协议形状。路径、请求体、回执解析全在 video.ts 的 SHAPES 里按这个键分派——
   * **接第二家时才知道这层抽象立不立得住**：秘塔与 APIMart 从路径到字段名到状态词
   * 没有一处相同，加 APIMart 只新增了一个 adapter，主流程一行没动。
   */
  shape: 'minimax' | 'apimart' | 'openai-videos' | 'ark';
  /** 建任务时额外固定字段（如 Agnes 的 openai-videos 变体要求 mode:"text"）；有首帧图时用 createExtraWithImage */
  createExtra?: Record<string, unknown>;
  createExtraWithImage?: Record<string, unknown>;
  /**
   * 已核实的视频模型（Studio 下拉候选；仍可手填）。档位**按模型**给——同一家网关上
   * sora-2 只有 720p、veo3 固定 8 秒、MiniMax-H3 是 2K/768P，按供应商一刀切必错。
   */
  models?: Array<{
    id: string;
    resolutions?: string[];
    durations?: number[];
    ratios?: string[];
    /**
     * 同一网关上各模型的字段名都不一样（文档逐页核对）：可灵的档位叫 mode（std/pro/4k），
     * Wan / PixVerse / Grok 的宽高比叫 size，MiniMax 系的首帧图叫 first_frame_image。缺省 = resolution / aspect_ratio / image_urls。
     */
    fields?: { resolution?: 'resolution' | 'mode'; ratio?: 'aspect_ratio' | 'size'; image?: 'image_urls' | 'first_frame_image' };
  }>;
}

export const VIDEO_PROVIDERS: VideoProviderSpec[] = [
  {
    id: 'metaso',
    envKey: 'METASO_API_KEY',
    envBase: 'METASO_BASE_URL',
    defaultBaseUrl: 'https://metaso.cn/api/minimax',
    shape: 'minimax',
    // 档位来自内置模板真机跑过的取值
    models: [{ id: 'MiniMax-H3', resolutions: ['480p', '512p', '768P', '2K'], durations: [4, 5, 6, 7, 8, 9, 10], ratios: ['16:9', '9:16', '1:1'] }],
  },
  // APIMart（赞助商）—— 同一个 key 既是 OpenAI 兼容网关（见上面 API_PROVIDERS），
  // 也提供视频：Sora2 / VEO3 / 可灵 / 海螺 / MiniMax-H3 等一堆模型，走自家任务接口。
  // **它同时出现在两张表里是有意的**：聊天/图片走 API_PROVIDERS，视频走这里，
  // 共用 APIMART_API_KEY 一把钥匙（Studio 里也只用配一次）。
  // 端点已探测核实（2026-08-25，带真 key、零余额）：
  //   POST /v1/videos/generations → 402 insufficient balance（路径在、鉴权通）
  //   GET  /v1/tasks/<假 id>      → 400 Invalid task ID format（路径在，还校验 id 格式）
  //   乱写路径                     → 404 Invalid URL —— 对照组证明上面两条不是兜底响应
  // 注意档位名与秘塔不通用（720p/1080p/4k vs 768P/2K），我们原样透传、不替用户换算。
  {
    id: 'apimart',
    envKey: 'APIMART_API_KEY',
    envBase: 'APIMART_BASE_URL',
    defaultBaseUrl: 'https://api.apimart.ai/v1',
    shape: 'apimart',
    // 模型编码与档位取自 docs.apimart.ai 各模型页（2026-08-25 抓取）：
    //   sora-2 720p / 4·8·12·16·20s；sora-2-pro 720p·1024p·1080p；veo3.1-* 720p·1080p·4k / 固定 8s；
    //   MiniMax-H3 2K·768P / 4–15s。图生视频：sora/veo 用 image_urls[]，H3 用 first_frame_image，都只收公网 URL，
    //   本地图先走 POST /v1/uploads/images（72 小时有效）。
    // 每条的档位/字段名都来自 docs.apimart.ai 对应模型页（2026-08-26 逐页抓取），不是猜的；
    // 秒数区间型的（3–15 等）按整数展开给下拉。
    models: [
      { id: 'sora-2', resolutions: ['720p'], durations: [4, 8, 12, 16, 20], ratios: ['16:9', '9:16'] },
      { id: 'sora-2-pro', resolutions: ['720p', '1024p', '1080p'], durations: [4, 8, 12, 16, 20], ratios: ['16:9', '9:16'] },
      { id: 'veo3.1-fast', resolutions: ['720p', '1080p', '4k'], durations: [8], ratios: ['16:9', '9:16'] },
      { id: 'veo3.1-quality', resolutions: ['720p', '1080p', '4k'], durations: [8], ratios: ['16:9', '9:16'] },
      { id: 'veo3.1-lite', resolutions: ['720p', '1080p', '4k'], durations: [8], ratios: ['16:9', '9:16'] },
      { id: 'seedance-2.5', resolutions: ['480p', '720p', '1080p'], durations: [4, 5, 6, 8, 10, 12, 15, 20, 30], ratios: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'] },
      { id: 'kling-v3', resolutions: ['std', 'pro', '4k'], durations: [3,4,5,6,7,8,9,10,11,12,13,14,15], ratios: ['16:9', '9:16', '1:1'], fields: { resolution: 'mode' } },
      { id: 'MiniMax-H3', resolutions: ['2K', '768P'], durations: [4,5,6,7,8,9,10,11,12,13,14,15], ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], fields: { image: 'first_frame_image' } },
      { id: 'MiniMax-Hailuo-2.3', resolutions: ['768p', '1080p'], durations: [6, 10], fields: { image: 'first_frame_image' } },
      { id: 'MiniMax-Hailuo-2.3-Fast', resolutions: ['768p', '1080p'], durations: [6, 10], fields: { image: 'first_frame_image' } },
      { id: 'wan2.7', resolutions: ['720P', '1080P'], durations: [2,3,4,5,6,7,8,9,10,11,12,13,14,15], ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'], fields: { ratio: 'size' } },
      { id: 'viduq3-pro', resolutions: ['540p', '720p', '1080p'], durations: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16], ratios: ['16:9', '9:16', '4:3', '3:4', '1:1'] },
      { id: 'viduq3-turbo', resolutions: ['540p', '720p', '1080p'], durations: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16], ratios: ['16:9', '9:16', '4:3', '3:4', '1:1'] },
      { id: 'pixverse-v6', resolutions: ['360p', '540p', '720p', '1080p'], durations: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15], ratios: ['16:9', '4:3', '1:1', '3:4', '9:16', '2:3', '3:2', '21:9'], fields: { ratio: 'size' } },
      { id: 'grok-imagine-1.5-video-ext', resolutions: ['480p', '720p'], durations: [6,7,8,9,10,11,12,13,14,15], ratios: ['16:9', '9:16', '1:1', '3:2', '2:3'], fields: { ratio: 'size' } },
    ],
  },
];

// Agnes AI —— OpenAI Videos 形状的变体（2026-08-26 真机核实：POST /v1/videos 建任务、GET /v1/videos/{id} 轮询、
// GET /v1/videos/{id}/content 下载，status queued/in_progress/completed；只多一个必填 mode：文生视频 "text"）。
// 与 APIMart 同理，它同时在 API_PROVIDERS（聊天/图片）与这里（视频），一把 AGNES_API_KEY 通用。
// size 不是 OpenAI 的 WxH 而是档位名 720P/960P/2K（服务端 400 原话列出）；seconds "4" 真机出片 1280x704/4.46s 带音轨；其余秒数未逐个核实，只列 4/8/12。
VIDEO_PROVIDERS.push({
  id: 'agnes',
  envKey: 'AGNES_API_KEY',
  envBase: 'AGNES_BASE_URL',
  defaultBaseUrl: 'https://apihub.agnes-ai.com/v1',
  shape: 'openai-videos',
  createExtra: { mode: 'text' },
  models: [
    { id: 'agnes-video-2.5-flash', resolutions: ['720P', '960P', '2K'], durations: [4, 8, 12], ratios: ['16:9', '9:16'] },
    { id: 'agnes-video-2.5', resolutions: ['720P', '960P', '2K'], durations: [4, 8, 12], ratios: ['16:9', '9:16'] },
    { id: 'agnes-video-v2.0', resolutions: ['720P', '960P', '2K'], durations: [4, 8, 12], ratios: ['16:9', '9:16'] },
  ],
});

// 火山方舟（赞助商）—— 自家形状 'ark'（2026-08-26 真机核实，按量 key）：
//   POST {base}/contents/generations/tasks {model, content:[{type:text,text}], resolution, duration, ratio} → {id}
//   GET  {base}/contents/generations/tasks/{id} → {status: queued|running|succeeded|failed, content:{video_url 签名直链}, usage, duration…}
// 与 APIMart / Agnes 同理，它也在 API_PROVIDERS（聊天/图片），一把 ARK_API_KEY 通用。
// **两个 base**：按量 key 用 /api/v3；Agent Plan 套餐 key 必须用 /api/plan/v3（VOLCENGINE_BASE_URL），且 Medium 没有视频配额（Large 起）。
// 档位只写真机核实过的：resolution 三档由服务端逐个校验通过；duration/ratio 只有 5s / 16:9 真出过片（其余服务端校验顺序在 seed 之后，探不出，不猜）。
// 2.x 系列（2-0 / 2-0-fast / 2-0-mini / 2-5）id 来自 /models，但本账号未开通、未核实档位，先不列进候选——开通后照此补。
VIDEO_PROVIDERS.push({
  id: 'volcengine',
  envKey: 'ARK_API_KEY',
  envBase: 'VOLCENGINE_BASE_URL',
  defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  shape: 'ark',
  models: [
    { id: 'doubao-seedance-1-0-pro-fast-251015', resolutions: ['480p', '720p', '1080p'], durations: [5], ratios: ['16:9'] },
    { id: 'doubao-seedance-1-0-pro-250528', resolutions: ['480p', '720p', '1080p'], durations: [5], ratios: ['16:9'] },
  ],
});

export const VIDEO_PROVIDER_MAP: Record<string, VideoProviderSpec> = Object.fromEntries(
  VIDEO_PROVIDERS.map((p) => [p.id, p]),
);
