/**
 * OpenAI Compatible Connector
 * 支持 DeepSeek、智谱、通义、Moonshot 等兼容 OpenAI 格式的 API
 *
 * 默认使用 streaming 模式，避免长生成任务被服务端 60s 超时断开（DeepSeek 等常见问题）
 */
import type { LLMConnector, LLMResult, LLMConfig } from '../types.js';

/** 估算 token 数：CJK 字符按 1.5 token/char，ASCII 按 0.25 token/char */
function estimateTokens(text: string): number {
  let cjk = 0, ascii = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) > 0x2e80) cjk++; else ascii++;
  }
  return Math.ceil(cjk * 1.5 + ascii / 4);
}

export class OpenAICompatibleConnector implements LLMConnector {
  private apiKey: string;
  private baseUrl: string;

  constructor(options: { apiKey?: string; baseUrl?: string } = {}) {
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY || '';
    this.baseUrl = options.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

    // 去掉末尾的 /
    this.baseUrl = this.baseUrl.replace(/\/+$/, '');

    if (!this.apiKey) {
      throw new Error('缺少 API Key，请通过参数或环境变量传入');
    }
  }

  async chat(systemPrompt: string, userMessage: string, config: LLMConfig): Promise<LLMResult> {
    const maxContinuations = 3;  // 最多续写 3 次
    let fullContent = '';

    for (let continuation = 0; continuation <= maxContinuations; continuation++) {
      // 构建消息：首次用原始 prompt，续写时追加已有内容让模型接着写
      const messages: Array<{role: string; content: string}> = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ];
      if (continuation > 0 && fullContent) {
        messages.push(
          { role: 'assistant', content: fullContent },
          { role: 'user', content: '你的回答被中断了，请从中断处继续写完，不要重复已写的内容。' },
        );
      }

      const fetchTimeout = config.timeout || 300_000;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), fetchTimeout);

      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: config.model!,
            max_tokens: config.max_tokens || 4096,
            stream: true,
            messages,
          }),
        });
      } catch (err) {
        clearTimeout(timer);
        throw err;
      }

      if (!response.ok) {
        clearTimeout(timer);
        const text = await response.text();
        throw new Error(`API error ${response.status}: ${text}`);
      }

      let chunk: string;
      try {
        chunk = await this.readStream(response);
      } catch (err) {
        clearTimeout(timer);
        // stream 断开，检查是否有部分内容
        const partial = (err as any).partialContent as string | undefined;
        if (partial && partial.length > 200) {
          fullContent += partial;
          process.stderr.write(`  🔄 断点续写 (${continuation + 1}/${maxContinuations})，已累计 ${fullContent.length} 字符...\n`);
          continue;  // 自动续写
        }
        // 没有可用的部分内容，向上抛出
        const streamErr = new Error(`streaming terminated (已收到 ${fullContent.length} 字符): ${err instanceof Error ? err.message : err}`);
        (streamErr as any).partialContent = fullContent.length > 200 ? fullContent : undefined;
        throw streamErr;
      } finally {
        clearTimeout(timer);
      }

      // 正常完成
      fullContent += chunk;
      break;
    }

    return {
      content: fullContent,
      usage: {
        // 流式模式下 usage 在最后一个 chunk，已在 readStream 中尝试提取
        // 兜底用字符估算（CJK 字符 ≈ 1-2 token，英文 ≈ 0.25 token/char）
        input_tokens: estimateTokens(systemPrompt + userMessage),
        output_tokens: estimateTokens(fullContent),
      },
    };
  }

  /**
   * 读取 SSE 流并拼接内容
   * 格式: data: {"choices":[{"delta":{"content":"token"}}]}\n\n
   * 结束: data: [DONE]\n\n
   */
  private async readStream(response: Response): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Response body is null');

    const decoder = new TextDecoder();
    let content = '';
    let buffer = '';
    let lastProgressTime = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // 每 10 秒显示接收进度，让用户知道没卡死
        const now = Date.now();
        if (now - lastProgressTime > 10_000 && content.length > 0) {
          lastProgressTime = now;
          process.stderr.write(`  📡 已生成 ${content.length} 字...\n`);
        }

        // 按行解析 SSE
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';  // 最后一行可能不完整，留到下次

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);  // 去掉 "data: "
          if (data === '[DONE]') continue;

          try {
            const chunk = JSON.parse(data);
            // 检查流式错误响应
            if (chunk.error) {
              throw new Error(`API stream error: ${chunk.error.message || JSON.stringify(chunk.error)}`);
            }
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) content += delta;
          } catch (e) {
            // 重新抛出 API 错误，忽略 JSON 解析失败
            if (e instanceof Error && e.message.startsWith('API stream error')) throw e;
          }
        }
      }
    } catch (err) {
      reader.cancel().catch(() => {});  // 释放连接资源
      // 流被服务端断开（DeepSeek ~60s 超时等）
      // 始终抛出错误让 executor 重试，部分内容附在 error 上供最后兜底
      const streamErr = new Error(`streaming terminated (已收到 ${content.length} 字符): ${err instanceof Error ? err.message : err}`);
      (streamErr as any).partialContent = content.length > 200 ? content : undefined;
      process.stderr.write(`\n  ⚠️  流式连接中断 (${err instanceof Error ? err.message : err})，已收到 ${content.length} 字符\n`);
      throw streamErr;
    }

    reader.cancel().catch(() => {});  // 正常结束也释放 reader
    return content;
  }
}
