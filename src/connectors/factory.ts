/**
 * LLM Connector 工厂 — 根据 LLMConfig 创建对应的 connector
 */
import type { LLMConfig, LLMConnector } from '../types.js';
import { ClaudeConnector } from './claude.js';
import { OllamaConnector } from './ollama.js';
import { OpenAICompatibleConnector } from './openai-compatible.js';

export function createConnector(config: LLMConfig): LLMConnector {
  switch (config.provider) {
    case 'claude':
      return new ClaudeConnector(config.api_key);
    case 'ollama':
      return new OllamaConnector(config.base_url);
    case 'deepseek':
      return new OpenAICompatibleConnector({
        apiKey: config.api_key || process.env.DEEPSEEK_API_KEY,
        baseUrl: config.base_url || 'https://api.deepseek.com/v1',
      });
    case 'openai':
      return new OpenAICompatibleConnector({
        apiKey: config.api_key || process.env.OPENAI_API_KEY,
        baseUrl: config.base_url || 'https://api.openai.com/v1',
      });
    default:
      throw new Error(`暂不支持 provider: ${config.provider}（支持 claude / deepseek / openai / ollama）`);
  }
}
