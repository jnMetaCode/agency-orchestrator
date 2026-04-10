/** 工作流 YAML 定义的类型 */

export interface WorkflowDefinition {
  name: string;
  description?: string;
  agents_dir: string;
  llm: LLMConfig;
  concurrency?: number;       // 最大并行步骤数，默认 2
  inputs?: InputDefinition[];
  steps: StepDefinition[];
}

export interface LLMConfig {
  provider: 'claude' | 'openai' | 'ollama' | 'deepseek' | 'claude-code' | 'gemini-cli' | 'copilot-cli' | 'codex-cli' | 'openclaw-cli' | (string & {});
  base_url?: string;          // 自定义 API 地址（DeepSeek、智谱等）
  api_key?: string;           // 可在 YAML 中配置，也可用环境变量
  model?: string;              // CLI providers 可省略（使用 CLI 默认模型）
  agent?: string;             // openclaw-cli 专用：agent ID（默认 "main"）
  max_tokens?: number;        // 默认 4096
  timeout?: number;           // 单步超时 ms，API 默认 120000，CLI 默认 300000
  retry?: number;             // 失败重试次数，默认 3
}

export interface InputDefinition {
  name: string;
  description?: string;
  required?: boolean;
  default?: string;            // 可选输入的默认值
}

export interface StepDefinition {
  id: string;
  role: string;               // agency-agents 路径，如 "engineering/engineering-sre"
  name?: string;              // 自定义显示名（覆盖角色文件的 name）
  emoji?: string;             // 自定义 emoji（覆盖角色文件的 emoji）
  task: string;               // 任务描述，支持 {{变量}} 模板
  output?: string;            // 输出变量名
  depends_on?: string[];      // 依赖的步骤 id
  type?: 'normal' | 'approval'; // 节点类型
  prompt?: string;            // approval 类型的提示文本
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
}

export interface StepResult {
  id: string;
  role: string;
  agentName?: string;             // 角色显示名（如"趋势研究员"）
  agentEmoji?: string;            // 角色 emoji
  status: 'completed' | 'failed' | 'skipped';
  output?: string;
  output_var?: string;            // 输出变量名（用于 resume 时重建 context）
  error?: string;
  duration: number;
  tokens: { input: number; output: number };
  iterations?: number;          // 该步骤实际执行次数（循环场景 > 1）
}
