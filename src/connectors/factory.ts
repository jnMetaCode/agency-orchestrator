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
import { CodeBuddyCLIConnector } from './codebuddy-cli.js';
import { ClineCLIConnector } from './cline-cli.js';
import { OpenCodeCLIConnector } from './opencode-cli.js';
import { DshCLIConnector } from './dsh-cli.js';
import { OllamaConnector } from './ollama.js';
import { OpenAICompatibleConnector } from './openai-compatible.js';
import { API_PROVIDER_MAP, ANTHROPIC_PROVIDER_MAP } from './api-providers.js';

export function createConnector(config: LLMConfig): LLMConnector {
  switch (config.provider) {
    // ── 免 API key（用订阅 / 免费额度）──
    case 'claude-code':
      return new ClaudeCodeConnector();
    case 'gemini-cli':
      // 已停服（2026-06-18，存量企业许可除外）——显式指定仍可用，但要说清楚，
      // 否则用户跑挂了会以为是 AO 的问题
      console.warn('  ⚠️ gemini-cli 已停服（仅企业版 Code Assist 许可可用），新用户请改用 antigravity-cli');
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
    // 腾讯 CodeBuddy CLI（WorkBuddy 桌面版内置同一个二进制）：会员额度，免 key
    case 'codebuddy-cli':
      return new CodeBuddyCLIConnector();
    // Cline CLI：用它 `cline auth` 配好的供应商/账号，AO 不另配 key
    case 'cline-cli':
      return new ClineCLIConnector();
    // OpenCode CLI：用它配好的供应商（opencode auth login / opencode.json）
    case 'opencode-cli':
      return new OpenCodeCLIConnector();
    // DeepSeek Harness（开发者预览）：用它配好的供应商
    case 'dsh-cli':
      return new DshCLIConnector();
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
        // 没 key 在这里就点名：连接器自己不知道 provider 是谁，只会说"缺少 API Key"——
        // 用户配了出片用的 Agnes、文本供应商却没配，看到那句只会以为是 Agnes 的 key 没生效。
        if (!(config.api_key || process.env[spec.envKey])) {
          throw new Error(`缺少 API Key：文本供应商「${config.provider}」没配 key（环境变量 ${spec.envKey}，或在 Studio「设置 → 供应商」里填）。出图/出片供应商的 key 是另一把，不通用。`);
        }
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
        '  免 API key: claude-code / antigravity-cli / gemini-cli / copilot-cli / codex-cli / openclaw-cli / hermes-cli / codebuddy-cli / cline-cli / opencode-cli / dsh-cli / ollama\n' +
        '  需 API key: claude / deepseek / openai'
      );
    }
  }
}
