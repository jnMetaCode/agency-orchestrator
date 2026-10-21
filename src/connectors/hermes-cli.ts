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
 *   普通提示词保持 -z；只有超过 argv 硬上限时，切到官方 chat --query-file - 协议。
 *   该协议用 --oneshot --format stream-json 明确退出并只取最终 result，不能将文本流当最终答案。
 *   官方协议：https://github.com/NousResearch/hermes-agent/blob/main/website/docs/reference/cli-commands.md
 */
import { CLIBaseConnector } from './cli-base.js';
import type { LLMConfig } from '../types.js';

/** The documented terminal result is authoritative; streamed deltas may be incomplete. */
export function parseHermesStreamOutput(stdout: string): string {
  const lines = stdout.split(/\r?\n/).filter(line => line.trim());
  let terminal: { type?: unknown; exit_code?: unknown; text?: unknown } | undefined;
  for (const line of lines) {
    const event = JSON.parse(line);
    if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Invalid Hermes stream');
    terminal = event;
  }
  if (terminal?.type !== 'result' || terminal.exit_code !== 0 || typeof terminal.text !== 'string') {
    throw new Error('Hermes stream did not finish successfully');
  }
  return terminal.text.trim();
}

export function hermesStderrHint(stderr: string): string | undefined {
  if (/unrecognized arguments|unknown (?:option|argument)|no such option|invalid choice/i.test(stderr)
    && /query-file|stream-json|--format|--oneshot/.test(stderr)) {
    return '超长提示词需要 Hermes 支持 chat --query-file 与 --format stream-json，请升级 Hermes 后重试；提示词不会被截断，也不会回退到 -z。';
  }
  return undefined;
}

export class HermesCLIConnector extends CLIBaseConnector {
  constructor() {
    super({
      command: 'hermes',
      displayName: 'Hermes Agent CLI',
      stdinOnOverflow: true,
      buildStdinArgs: (config: LLMConfig) => {
        const args = ['chat', '--query-file', '-', '--oneshot', '--format', 'stream-json'];
        if (config.model) args.push('--model', config.model);
        return args;
      },
      parseStdinOutput: parseHermesStreamOutput,
      stderrHint: hermesStderrHint,
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
