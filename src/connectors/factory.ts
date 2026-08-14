/**
 * LLM Connector 工厂 — 根据 LLMConfig 创建对应的 connector
 */
import type { LLMConfig, LLMConnector } from '../types.js';
import { ClaudeConnector } from './claude.js';
import { ClaudeCodeConnector } from './claude-code.js';
import { GeminiCLIConnector } from './gemini-cli.js';
import { AntigravityCLIConnector } from './antigravity-cli.js';
import { CopilotCLIConnector } from './copilot-cli.js';
import { CodexCLIConnector } from './codex-cli.js';
import { OpenClawCLIConnector } from './openclaw-cli.js';
import { HermesCLIConnector } from './hermes-cli.js';
import { OllamaConnector } from './ollama.js';
import { OpenAICompatibleConnector } from './openai-compatible.js';
import { API_PROVIDER_MAP, ANTHROPIC_PROVIDER_MAP } from './api-providers.js';

export function createConnector(config: LLMConfig): LLMConnector {
  switch (config.provider) {
    // ── 免 API key（用订阅 / 免费额度）──
    case 'claude-code':
      return new ClaudeCodeConnector();
    case 'gemini-cli':
      return new GeminiCLIConnector();
    // Gemini CLI 的继任者（Google 已于 2026-06-18 停掉前者）
    case 'antigravity-cli':
      return new AntigravityCLIConnector();
    case 'copilot-cli':
      return new CopilotCLIConnector();
    case 'codex-cli':
      return new CodexCLIConnector();
    case 'openclaw-cli':
      return new OpenClawCLIConnector();
    case 'hermes-cli':
      return new HermesCLIConnector();
    case 'ollama':
      return new OllamaConnector(config.base_url);

    // ── 需要 API key ──
    case 'claude':
      // base_url 必须往下传：Anthropic 协议的中转商就是靠它接入的，少传这一个参数
      // 会让所有中转配置静默失效（照旧打官方端点 → 401）
      return new ClaudeConnector(config.api_key, config.base_url);
    default: {
      // Anthropic 原生协议的中转商（AICodeMirror 等）：与 claude 同一个连接器，但各用
      // 各的 env 变量名与默认端点 —— 共用 ANTHROPIC_* 会把用户的 claude-code 订阅
      // CLI 一起改道（见 web/server.js applyKeys 的说明）。
      const anth = ANTHROPIC_PROVIDER_MAP[config.provider];
      if (anth) {
        return new ClaudeConnector(
          config.api_key || process.env[anth.envKey],
          config.base_url || process.env[anth.envBase] || anth.defaultBaseUrl,
        );
      }

      // OpenAI 兼容聚合 API（deepseek/openai 官方 + 各赞助商）统一走注册表；
      // 新增一家只需在 api-providers.ts 加一条，这里不用改。
      // 注：deepseek 不 fallback OPENAI_BASE_URL —— issue #16: 用户设了
      // OPENAI_BASE_URL=openai.com 后切到 deepseek 会用 OpenAI endpoint + DeepSeek
      // key 调，得到 405。每个 provider 用自己专属 env,这里的逐 provider 查表天然满足。
      const spec = API_PROVIDER_MAP[config.provider];
      if (spec) {
        return new OpenAICompatibleConnector({
          apiKey: config.api_key || process.env[spec.envKey],
          baseUrl: config.base_url || process.env[spec.envBase] || spec.defaultBaseUrl,
        });
      }
      // 未知 provider：如果提供了 base_url，当作 OpenAI 兼容 API 处理
      if (config.base_url) {
        return new OpenAICompatibleConnector({
          apiKey: config.api_key || process.env.OPENAI_API_KEY,
          baseUrl: config.base_url,
        });
      }
      throw new Error(
        `暂不支持 provider: ${config.provider}\n` +
        '如需使用自定义 API，请配置 base_url 字段（兼容 OpenAI 格式）:\n' +
        '  llm:\n' +
        `    provider: "${config.provider}"\n` +
        '    base_url: "https://your-api-endpoint/v1"\n' +
        '    api_key: "your-key"\n' +
        '    model: "model-name"\n\n' +
        '内置 provider:\n' +
        '  免 API key: claude-code / antigravity-cli / gemini-cli / copilot-cli / codex-cli / openclaw-cli / hermes-cli / ollama\n' +
        '  需 API key: claude / deepseek / openai'
      );
    }
  }
}
