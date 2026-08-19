/**
 * Gemini CLI Connector —— ⚠️ 已停服（存量企业许可除外）
 *
 * Google 已于 2026-06-18 停止为免费/AI Pro/Ultra 用户提供 Gemini CLI 服务，
 * 仅 Gemini Code Assist Standard/Enterprise 许可仍可用（issue #86）。
 * 保留此 connector 是为了不搞坏存量企业用户；新用户请用继任者 antigravity-cli（`agy`）。
 * 软下线登记见 src/providers/detect.ts 的 DEPRECATED_CLI_PROVIDERS。
 */
import { CLIBaseConnector } from './cli-base.js';
import type { LLMConfig } from '../types.js';

export class GeminiCLIConnector extends CLIBaseConnector {
  constructor() {
    super({
      command: 'gemini',
      displayName: 'Gemini CLI',
      installHint: 'npm install -g @google/gemini-cli',
      // gemini 非交互模式会读管道输入并拼进上下文（`echo "..." | gemini`），保持既有行为
      supportsStdin: true,
      buildArgs: (prompt: string, config: LLMConfig) => {
        const args: string[] = [];
        if (config.model) args.push('-m', config.model);
        args.push('-p', prompt);
        return args;
      },
    });
  }
}
