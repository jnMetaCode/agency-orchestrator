/** 工作流 YAML 定义的类型 */

export interface WorkflowDefinition {
  name: string;
  description?: string;
  agents_dir: string;
  llm: LLMConfig;
  concurrency?: number;       // 最大并行步骤数，默认 2
  verify?: boolean;           // acceptance 自动核验+未过自动返工一轮（默认开）。false = 整个工作流关闭
  inputs?: InputDefinition[];
  steps: StepDefinition[];
}

export interface LLMConfig {
  provider: 'claude' | 'openai' | 'ollama' | 'deepseek' | 'claude-code' | 'antigravity-cli' | 'gemini-cli' | 'copilot-cli' | 'codex-cli' | 'openclaw-cli' | 'hermes-cli' | (string & {});
  base_url?: string;          // 自定义 API 地址（DeepSeek、智谱等）
  api_key?: string;           // 可在 YAML 中配置，也可用环境变量
  model?: string;              // CLI providers 可省略（使用 CLI 默认模型）
  agent?: string;             // openclaw-cli 专用：agent ID（默认 "main"）
  max_tokens?: number;        // 默认 4096
  temperature?: number;       // 采样温度。未设置=用 provider 默认；设 0=近确定性（可复现、适合评测/抽取类任务）
  params?: Record<string, unknown>; // 供应商专有参数，原样并入请求体（如 DeepSeek/OpenAI 的 reasoning 档位、Anthropic thinking）。核心字段（model/messages/stream 等）不可被覆盖
  timeout?: number;           // 单步超时 ms。未设置时按 provider 默认（API 120000 / CLI·ollama 600000）并按输入规模动态抬高首次超时（每 1K 字符 +8s，最多 +600000）。因超时触发重试时，下一次 timeout 自动 x1.5（上限 3600000 / 60min）。设为 0 表示不限时；显式设置则不做动态调整
  retry?: number;             // 失败重试次数，默认 3
}

export interface InputDefinition {
  name: string;
  description?: string;
  required?: boolean;
  default?: string;            // 可选输入的默认值
  /** Studio 里显示的名称（缺省显示变量名） */
  label?: string;
  /** 输入形态：url = 单行、不给"扩写/从文件读入"（如首帧参考图）；缺省多行文本 */
  format?: 'text' | 'url';
  /**
   * 条件可见：与 step.condition 同语法（`{{other_input}} contains X` / equals），**只能引用其他输入**。
   * 为假时 Studio 不渲染该输入、CLI 不把它当必填缺失。引擎照常把它的默认值放进上下文——
   * 步骤引用它不会炸。来由：短剧流水线 15 个输入里，语音供应商/模型/音色在选了"不配音"时仍然
   * 摆在那里，用户不知道要不要填。
   */
  show_when?: string;
  /** 静态候选值（Studio 渲染成下拉；仍可手填自定义值） */
  options?: string[];
  /**
   * 动态候选源（Studio 从引擎配置实时取，引擎本身不消费）：
   *   image_providers / video_providers / tts_providers —— 已配 key 的图片 / 视频 / 语音供应商
   *   models —— 该供应商的模型列表（视频供应商用内置表，其余实拉 /models）
   *   video_resolutions / video_durations —— 该视频供应商的档位表（各家不通用）
   * 带 provider 参数的源用 source_from 指向存放供应商 id 的那个输入。
   */
  source?: 'image_providers' | 'video_providers' | 'tts_providers' | 'models' | 'video_resolutions' | 'video_durations' | 'video_ratios' | 'styles';
  source_from?: string;
}

export interface StepDefinition {
  id: string;
  role: string;               // agency-agents 路径，如 "engineering/engineering-sre"
  name?: string;              // 自定义显示名（覆盖角色文件的 name）
  emoji?: string;             // 自定义 emoji（覆盖角色文件的 emoji）
  task: string;               // 任务描述，支持 {{变量}} 模板
  acceptance?: string;        // 验收标准（支持 {{变量}}）：注入 prompt 末尾要求产出满足；产出后自动核验，未过自动返工一轮；随产出展示，并作盲评评分锚点
  verify?: boolean;           // false = 本步关闭 acceptance 自动核验（优先级高于顶层 verify）
  assert?: StepAssert;        // 机械断言：不过模型、不过网络的结构校验（数文件块 / 字节数 / 正则命中次数）。
                              // 与 acceptance 分工：模型审内容，脚本审结构。未过 = 定向返工一轮，仍不过则本步失败。
  output?: string;            // 输出变量名
  skill?: string;             // 给本步挂一个方法论 skill（注入 system prompt），如 "test-driven-development"
  skills?: string[];          // 多个 skill（与 skill 合并）
  depends_on?: string[];      // 依赖的步骤 id
  type?: 'normal' | 'approval' | 'human_input' | 'image' | 'video' | 'concat' | 'tts'; // 节点类型（image/video/tts = 文生图/文生视频/文字转语音：task 即提示词或文案；concat = ffmpeg 合成多段视频 + 配音/字幕/BGM）
  /**
   * type: concat 专用——把上游多段 mp4（视频步骤的输出变量）按顺序合成一条；需要本机 ffmpeg。
   * 后期三件套（配音 / 字幕 / BGM）都在这一步做完，全程本机 ffmpeg，不花厂商的钱。
   */
  concat?: {
    inputs: string[];
    size?: string;
    fps?: number;
    /** 逐段配音：上游 tts 步骤的输出变量，与 inputs 一一对应（这段不配音就留空串） */
    voiceover?: string[];
    /** 旁白人声音量倍数，默认 1.0 */
    voice_volume?: number;
    /** 片段自带音轨的音量倍数；有旁白时默认 0.3，没旁白时原样。视频模型本来就出声（常是对白），压多少由你定 */
    clip_volume?: number;
    /** 逐段字幕文案，与 inputs 一一对应；按各段实际时长排轴后烧进画面 */
    subtitles?: string[];
    /** 字幕样式（ffmpeg force_style）：字号 / 颜色 / 描边 / 底边距 / 字体 */
    subtitle_style?: { font?: string; size?: number; color?: string; outline?: number; margin?: number };
    /** 背景音乐：本地音频路径，或上游 tts 步骤的输出变量。循环铺满全片、末尾 2 秒淡出 */
    bgm?: string;
    /** BGM 音量倍数，默认 0.25（有人声时压得住，别盖过台词） */
    bgm_volume?: number;
  };
  /** type: tts 专用——文字转语音（model 与 voice 都必填：音色 id 各家互不通用，不猜） */
  tts?: { provider?: string; model?: string; voice?: string; speed?: number; format?: string; instructions?: string };
  /** type: image 专用——图片模型与参数（model 必填：各家图片模型编码互不通用，不猜） */
  image?: { provider?: string; model?: string; size?: string; quality?: string; background?: string };
  /**
   * type: video 专用——文生视频参数（model 必填，同图片：各家编码互不通用，不猜）。
   * 视频是**异步任务**（建任务 → 轮询 → 下载），一次跑几十秒到几分钟，且按秒计费，
   * 所以 duration 写多少就是花多少钱——默认不替用户放大。
   */
  video?: {
    provider?: string;    // 视频供应商 id（缺省取 llm.provider）
    /**
     * 图生视频：首帧参考图。可以是公网 URL、上游图片步骤的输出变量（markdown 图片引用）、
     * 或本地文件路径。两家厂商都只收公网 URL：APIMart 有上传接口（引擎自动上传，72 小时有效）；
     * 秘塔没有——本地图片走秘塔会明确报错，不会偷偷把 base64 塞进去白花一次。
     */
    image?: string;
    model?: string;       // 如 "MiniMax-H3"
    resolution?: string;  // 如 "768P" / "1080P" / "2K"（原样透传，各家档位名不同）
    duration?: number;    // 秒
    ratio?: string;       // 如 "16:9"
    timeout?: number;     // 整个任务（建 + 轮询 + 下载）的上限毫秒，默认 10 分钟
    poll_interval?: number; // 轮询间隔毫秒，默认 5 秒
  };
  prompt?: string;            // approval / human_input 类型的提示文本
  condition?: string;           // 如 "{{category}} contains bug"
  depends_on_mode?: 'all' | 'any_completed';  // 默认 'all'（任一跳过→跳过），'any_completed' = 只要有一个完成就执行
  llm?: Partial<LLMConfig>;   // 步骤级 LLM 配置，覆盖全局 llm
  loop?: {
    back_to: string;            // 跳回的步骤 id
    max_iterations: number;     // 最大循环次数，必填，上限 10
    exit_condition: string;     // 退出条件，同 condition 语法
  };
}

/** DAG 执行相关类型 */

export interface DAGNode {
  step: StepDefinition;
  dependencies: string[];     // 依赖的 node id
  dependents: string[];       // 被谁依赖
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  result?: string;
  error?: string;
  startTime?: number;
  endTime?: number;
  tokenUsage?: { input: number; output: number };
  agentName?: string;         // 角色显示名（如"趋势研究员"）
  agentEmoji?: string;        // 角色 emoji
  acceptance?: string;        // 执行时渲染后的验收标准（executeStep 写入，进 StepResult/metadata）
  verification?: StepVerification; // acceptance 自动核验结果（executeStep 写入）
  /** type: image 的产物（base64 只在内存里过一道手，saveResults 落成 assets/ 下的文件） */
  imageAsset?: { filename: string; base64: string };
  /** type: video 的产物（与 imageAsset 同一套落盘机制；mp4 比 png 大，base64 只在落盘前存在） */
  videoAsset?: { filename: string; base64: string; seconds?: number };
  /** type: tts 的产物（同一套落盘机制）——配音音频 */
  audioAsset?: { filename: string; base64: string };
}

/**
 * acceptance 自动核验结果。验收不过是质量信号而非执行错误：步骤不会因此 failed，
 * 最坏情况是"带 ⚠️ 标记的返工版"照常流向下游。
 */
/**
 * 机械断言（core/assert.ts 执行）。全部为「与」关系，纯函数判定。
 * 存在的理由：acceptance 由模型判，判不出「本该有 6 个却只给了 5 个」——
 * 少的那个不在它眼前。数量、体量这类事实交给数数，不交给概率。
 */
export interface StepAssert {
  emits_files?: number;              // 产出里的文件块数量必须恰好等于此值（解析规则与 --materialize 完全一致）
  min_bytes?: number;                // 产出最小字节数（UTF-8），防截断
  max_bytes?: number;                // 产出最大字节数（UTF-8），防超长——提示词过长会被视频厂商直接拒收
  contains?: string[];               // 必须出现的字面串
  matches?: Record<string, number>;  // 正则 → 必须命中的次数。裸模式默认 gm；也可写 /pattern/flags
}

export interface StepVerification {
  pass: boolean;              // 最终产出是否通过核验（返工后复核不可用时保守记 false）
  failed: string[];           // 未满足条目（"条目（原因）"），pass=true 时为空
  reworked: boolean;          // 是否触发过自动返工
}

/** LLM Connector 相关类型 */

export interface LLMResult {
  content: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface LLMConnector {
  chat(systemPrompt: string, userMessage: string, config: LLMConfig): Promise<LLMResult>;
}

/** Agent Loader 相关类型 */

export interface AgentDefinition {
  name: string;
  description: string;
  emoji?: string;
  tools?: string;
  rolePath?: string;          // 角色路径，如 "engineering/engineering-sre"
  systemPrompt: string;       // frontmatter 之后的完整 markdown 内容
}

/** 执行结果 */

export interface WorkflowResult {
  name: string;
  success: boolean;
  steps: StepResult[];
  totalDuration: number;
  totalTokens: { input: number; output: number };
  /** 原始用户输入（用于 --resume 时恢复） */
  inputs?: Record<string, string>;
  /** 源工作流文件绝对路径（随 metadata 存档，供历史记录重跑/续跑定位源文件） */
  file?: string;
}

export interface StepResult {
  id: string;
  role: string;
  agentName?: string;             // 角色显示名（如"趋势研究员"）
  agentEmoji?: string;            // 角色 emoji
  status: 'completed' | 'failed' | 'skipped';
  output?: string;
  output_var?: string;            // 输出变量名（用于 resume 时重建 context）
  acceptance?: string;            // 该步的验收标准（渲染后），随 metadata 存档供查看器展示
  error?: string;
  duration: number;
  tokens: { input: number; output: number };
  iterations?: number;          // 该步骤实际执行次数（循环场景 > 1）
  verification?: StepVerification; // acceptance 自动核验结果（进 metadata，查看器/summary 展示）
  /** type: image 的产物。base64 仅在 saveResults 落盘前存在，metadata 里只留 filename */
  imageAsset?: { filename: string; base64?: string };
  /** type: video 的产物。同上：metadata 里只留 filename 与时长 */
  videoAsset?: { filename: string; base64?: string; seconds?: number };
  audioAsset?: { filename: string; base64?: string };
}
