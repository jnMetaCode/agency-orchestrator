/**
 * Ollama Connector — 本地模型，不需要 API key
 */
import type { LLMConnector, LLMResult, LLMConfig } from '../types.js';

export class OllamaConnector implements LLMConnector {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    const raw = baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    this.baseUrl = raw.replace(/\/+$/, '');
  }

  async chat(systemPrompt: string, userMessage: string, config: LLMConfig): Promise<LLMResult> {
    const numPredict = config.max_tokens || 8192;
    const numCtx = estimateNumCtx(systemPrompt, userMessage, numPredict);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
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
          },
        }),
      });
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
