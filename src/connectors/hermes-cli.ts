/**
 * Hermes Agent CLI Connector
 * 通过本地 `hermes` CLI 调用，利用 Hermes Agent 的自主推理能力执行任务
 *
 * 安装: curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
 * 文档: https://hermes-agent.nousresearch.com/
 *
 * 使用 hermes -z "prompt" 的 oneshot 模式（非交互式）
 * 旧版 hermes chat -q 已废弃，详见 issue #14
 * 支持 --model 指定模型（如 anthropic/claude-sonnet-4、openai/gpt-4o 等）
 *
 * ⚠️ hermes 的 `-z` 只接受字面量提示词，不认 `-`（不会去读 stdin），
 *   所以这里不声明 supportsStdin —— 提示词一律走命令行参数（见 cli-base 的 chooseTransport）。
 */
import { CLIBaseConnector } from './cli-base.js';
import type { LLMConfig } from '../types.js';

export class HermesCLIConnector extends CLIBaseConnector {
  constructor() {
    super({
      command: 'hermes',
      displayName: 'Hermes Agent CLI',
      installHint: 'curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash',
      buildArgs: (prompt: string, config: LLMConfig) => {
        const args = ['-z', prompt];
        if (config.model) {
          args.push('--model', config.model);
        }
        return args;
      },
    });
  }
}
