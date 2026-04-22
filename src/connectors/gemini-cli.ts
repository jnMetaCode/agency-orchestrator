/**
 * Gemini CLI Connector
 * 通过本地 `gemini` CLI 调用，Google 账号免费使用（1000 次/天，Gemini 2.5 Pro）
 *
 * 安装: npm install -g @google/gemini-cli
 * 认证: gemini 首次运行会引导 Google 账号登录，之后自动认证
 */
import { CLIBaseConnector } from './cli-base.js';
import type { LLMConfig } from '../types.js';

export class GeminiCLIConnector extends CLIBaseConnector {
  constructor() {
    super({
      command: 'gemini',
      displayName: 'Gemini CLI',
      buildArgs: (prompt: string, config: LLMConfig) => {
        const args: string[] = [];
        if (config.model) args.push('-m', config.model);
        args.push('-p', prompt);
        return args;
      },
    });
  }
}
