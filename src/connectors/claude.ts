/**
 * Claude API Connector
 */
import Anthropic from '@anthropic-ai/sdk';
import { normalizeBaseUrl } from './endpoint.js';
import type { LLMConnector, LLMResult, LLMConfig } from '../types.js';

/**
 * 把用户填的地址整成 Anthropic SDK 要的 base。
 *
 * SDK 自己会往 base 后面接 `/v1/messages`，所以 base **不能自带 /v1** ——
 * 而 Studio 的 Claude 预设默认值恰恰是 `https://api.anthropic.com/v1`，用户
 * 照抄文档 curl 地址时也常常带上 `/v1` 甚至 `/v1/messages`。不削掉就会拼出
 * `/v1/v1/messages` 直接 404。这里沿用 openai-compatible 那套「少写多写都能用」
 * 的容错口径：先过 normalizeBaseUrl（补协议、去引号/尾斜杠/端点后缀），再削掉
 * 末尾的 /messages 与 /v1。
 *
 * 注意：Anthropic 协议的中转商基址不一定是根路径 —— 例如 AICodeMirror 是
 * `https://api.aicodemirror.com/api/claudecode`，SDK 会打到
 * `.../api/claudecode/v1/messages`，所以只能削末尾的 /v1，不能整段重写。
 */
export function normalizeAnthropicBaseUrl(raw: string | undefined | null): string {
  const s = normalizeBaseUrl(raw);
  if (!s) return '';
  return s
    .replace(/\/messages$/i, '')
    .replace(/\/v1$/i, '')
    .replace(/\/+$/, '');
}

export class ClaudeConnector implements LLMConnector {
  private client: Anthropic;

  constructor(apiKey?: string, baseUrl?: string) {
    // base_url 此前被 factory 丢掉、SDK 也没设过 —— 结果是：在 YAML/Studio 里给
    // provider: claude 配中转地址会被**静默忽略**，请求照旧打到 Anthropic 官方，
    // 拿中转 key 去打必然 401，且用户完全看不出是配置没生效。
    const base = normalizeAnthropicBaseUrl(baseUrl) || normalizeAnthropicBaseUrl(process.env.ANTHROPIC_BASE_URL);
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
      ...(base ? { baseURL: base } : {}),
      // SDK 默认 maxRetries=2，会在 executor 的重试之外再静默重试，叠加成最多 ~18 次且不可见。
      // 重试/退避统一由 executor 负责，这里关掉 SDK 自带重试。
      maxRetries: 0,
    });

    if (!this.client.apiKey) {
      throw new Error(
        '缺少 ANTHROPIC_API_KEY\n' +
        '请设置环境变量: export ANTHROPIC_API_KEY=your-key\n' +
        '或在 workflow YAML 中配置'
      );
    }
  }

  /** 实际生效的接入点（诊断用：配了中转却没生效时，一眼能看出打到哪儿） */
  get baseUrl(): string {
    return String(this.client.baseURL || '');
  }

  async chat(systemPrompt: string, userMessage: string, config: LLMConfig): Promise<LLMResult> {
    // executor 传入的 config.timeout 是 ms（每次重试会递增）。SDK 默认仅 10min，会无视该配置；
    // 这里把它作为单请求 timeout 传给 SDK。timeout=0/未设（不限时）→ 不传，退回 SDK 默认。
    const requestTimeout = config.timeout && config.timeout > 0 ? config.timeout : undefined;
    const response = await this.client.messages.create(
      {
        // 供应商专有参数（如 thinking 预算）铺底，核心字段随后覆盖
        ...(config.params ?? {}),
        model: config.model!,
        max_tokens: config.max_tokens || 4096,
        ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
        system: systemPrompt,
        messages: [
          { role: 'user', content: userMessage },
        ],
      },
      requestTimeout !== undefined ? { timeout: requestTimeout } : undefined,
    );

    const content = response.content
      .filter(block => block.type === 'text')
      .map(block => block.type === 'text' ? block.text : '')
      .join('\n');

    return {
      content,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    };
  }
}
