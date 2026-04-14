/**
 * OpenAI Codex CLI Connector
 * 通过本地 `codex` CLI 调用，直接使用 ChatGPT Plus/Pro 订阅额度
 *
 * 安装: npm install -g @openai/codex
 * 认证: codex 首次运行会引导 OpenAI 登录，之后自动认证
 */
import { CLIBaseConnector } from './cli-base.js';
import type { LLMConfig } from '../types.js';

export class CodexCLIConnector extends CLIBaseConnector {
  constructor() {
    super({
      command: 'codex',
      displayName: 'OpenAI Codex CLI',
      buildArgs: (prompt: string, _config: LLMConfig) => {
        return ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', prompt];
      },
      buildStdinArgs: (_config: LLMConfig) => {
        return ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-'];
      },
    });
  }
}
