/**
 * Claude Code CLI Connector
 * 通过本地 `claude` CLI 调用，直接��用 Claude Max/Pro 订阅额度，无需 API key
 *
 * 安装: npm install -g @anthropic-ai/claude-code
 * 认证: claude 登录后自动使用订阅额度
 */
import { CLIBaseConnector } from './cli-base.js';
import type { LLMConfig } from '../types.js';

export class ClaudeCodeConnector extends CLIBaseConnector {
  constructor() {
    super({
      command: 'claude',
      displayName: 'Claude Code CLI',
      buildArgs: (prompt: string, config: LLMConfig) => {
        const args = ['-p', prompt, '--output-format', 'text'];
        if (config.model && config.model !== 'claude-code') {
          args.push('--model', config.model);
        }
        return args;
      },
      buildStdinArgs: (config: LLMConfig) => {
        // claude -p - 从 stdin 读取 prompt
        const args = ['-p', '-', '--output-format', 'text'];
        if (config.model && config.model !== 'claude-code') {
          args.push('--model', config.model);
        }
        return args;
      },
    });
  }
}
