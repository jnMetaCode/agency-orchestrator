/**
 * GitHub Copilot CLI Connector
 * 通过本地 `copilot` CLI 调用，直接使用 GitHub Copilot 订阅额度
 *
 * 安装: npm install -g @github/copilot
 * 认证: copilot 首次运行会引导 GitHub 登录，之后自动认证
 */
import { CLIBaseConnector } from './cli-base.js';
import type { LLMConfig } from '../types.js';

export class CopilotCLIConnector extends CLIBaseConnector {
  constructor() {
    super({
      command: 'copilot',
      displayName: 'GitHub Copilot CLI',
      buildArgs: (prompt: string, config: LLMConfig) => {
        const args: string[] = [];
        if (config.model) args.push('--model', config.model);
        args.push('-p', prompt);
        return args;
      },
    });
  }
}
