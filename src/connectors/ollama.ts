/**
 * Ollama Connector — 本地模型，不需要 API key
 */
import type { LLMConnector, LLMResult, LLMConfig } from '../types.js';
import { normalizeBaseUrl, joinEndpoint, postApiEndpoint } from './endpoint.js';

export class OllamaConnector implements LLMConnector {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    // 规整地址：允许只写 `localhost:11434`（本机自动补 http），去掉尾斜杠/引号
    this.baseUrl = normalizeBaseUrl(baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434');
  }

  async chat(systemPrompt: string, userMessage: string, config: LLMConfig): Promise<LLMResult> {
    const numPredict = config.max_tokens || 8192;
    const numCtx = estimateNumCtx(systemPrompt, userMessage, numPredict);

    let response: Response;
    try {
      // 远程 Ollama 常挂在反代/隧道后面，一旦发生 301/302，Node 会把 POST 降级成 GET，
      // /api/chat 只收 POST → 405，报错完全看不出是地址差一跳。这里跟连接器共用同一套
      // 「跳转保持 POST」的发送逻辑（端点固定，不做 /v1 猜测）。
      const post = await postApiEndpoint({
        baseUrl: this.baseUrl,
        path: 'api/chat',
        endpoint: joinEndpoint(this.baseUrl, 'api/chat'),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model || 'llama3.1',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          stream: false,
          options: {
            num_predict: numPredict,
            num_ctx: numCtx,
            // 供应商专有参数并入 ollama options（top_k/repeat_penalty 等）
            ...(config.params ?? {}),
            ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
          },
        }),
      });
      response = post.response;
    } catch (err: any) {
      if (err?.cause?.code === 'ECONNREFUSED' || err?.message?.includes('ECONNREFUSED')) {
        throw new Error(`无法连接 Ollama (${this.baseUrl})，请确认 ollama 已启动。Docker 环境请设置 OLLAMA_BASE_URL=http://host.docker.internal:11434`);
      }
      throw err;
    }

    if (!response.ok) {
      const text = await response.text();
      if (response.status === 404 && text.includes('not found')) {
        const model = config.model || 'llama3.1';
        throw new Error(`Ollama 模型 "${model}" 未找到，请先运行: ollama pull ${model}`);
      }
      throw new Error(`Ollama error ${response.status}: ${text}`);
    }

    const data = await response.json() as {
      message: { content: string };
      eval_count?: number;
      prompt_eval_count?: number;
    };

    return {
      content: data.message.content,
      usage: {
        input_tokens: data.prompt_eval_count || 0,
        output_tokens: data.eval_count || 0,
      },
    };
  }
}

/**
 * 根据实际输入长度自适应计算 num_ctx，避免 Ollama 默认 2048 截断，
 * 同时小输入不分配多余显存，提升推理速度。
 */
function estimateNumCtx(systemPrompt: string, userMessage: string, numPredict: number): number {
  const text = systemPrompt + userMessage;
  // CJK 字符约 1.5-2 token/字，ASCII 约 0.25 token/字，按实际比例加权
  let tokens = 0;
  for (let i = 0; i < text.length; i++) {
    tokens += text.charCodeAt(i) > 0x7F ? 1.5 : 0.3;
  }
  const estimatedInputTokens = Math.ceil(tokens);
  const buffer = 512;
  const computed = estimatedInputTokens + numPredict + buffer;
  // 下限 4096（部分模型低于此值行为异常），上限 131072（主流模型极限）
  return Math.min(Math.max(computed, 4096), 131072);
}
