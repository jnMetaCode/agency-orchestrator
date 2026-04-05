/**
 * OpenClaw CLI Connector
 * 通过本地 `openclaw` CLI 调用，支持 OAuth 和 API key 多种认证方式
 *
 * 安装: npm install -g openclaw@latest
 * 认证: openclaw onboard --install-daemon（引导配置）
 *
 * 注意: openclaw agent 必须指定 --agent <id>，否则会报
 * "Pass --to <E.164>, --session-id, or --agent to choose a session"
 * 默认使用 "main" agent，可通过 YAML agent 字段、model 字段或 OPENCLAW_AGENT 环境变量覆盖
 * 优先级: agent > model > OPENCLAW_AGENT > "main"
 *
 * ⚠️ 如果在 OpenClaw 内部运行 ao workflow，不应使用此 provider，
 *   否则会产生 OpenClaw → ao → OpenClaw 环形调用导致超时。
 *   请改用直连 API provider（如 openai + base_url 指向百炼）。
 */
import { CLIBaseConnector } from './cli-base.js';
import type { LLMConfig } from '../types.js';

/** 检测当前是否可能运行在 CLI 宿主环境内（OpenClaw / Claude Code 等通过子进程调用 ao） */
function isInsideCLIHost(): boolean {
  // OpenClaw 或其他 CLI 宿主通常通过子进程调 ao，ppid 不是终端
  // 这里检测已知的环境变量标记
  return !!(
    process.env.OPENCLAW_SESSION_ID ||
    process.env.OPENCLAW_AGENT_ID ||
    process.env.OPENCLAW_SESSION
  );
}

export class OpenClawCLIConnector extends CLIBaseConnector {
  constructor() {
    if (isInsideCLIHost()) {
      console.warn(
        '\n⚠️  检测到当前在 OpenClaw 环境内运行，使用 openclaw-cli provider 会导致环形调用。\n' +
        '   建议将 YAML 中的 provider 改为直连 API，例如:\n' +
        '   llm:\n' +
        '     provider: "openai"\n' +
        '     base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1"\n' +
        '     model: "your-model"\n'
      );
    }
    super({
      command: 'openclaw',
      displayName: 'OpenClaw CLI',
      installHint: 'npm install -g openclaw@latest && openclaw onboard --install-daemon',
      buildArgs: (prompt: string, config: LLMConfig) => {
        // 优先 agent 字段，model 作为向后兼容 fallback（旧版用 model 传 agent ID）
        const agentId = config.agent || config.model || process.env.OPENCLAW_AGENT || 'main';
        return ['agent', '--agent', agentId, '--message', prompt];
      },
      parseOutput: (stdout: string) => {
        // OpenClaw 的 stdout 可能混入插件日志（如 ShellWard 的 ANSI 彩色输出）
        // 过滤掉 [plugins] 前缀行和 ANSI 控制码行
        return stdout
          .split('\n')
          .filter(line => {
            const clean = line.replace(/\x1b\[[0-9;]*m/g, '').trim();
            return clean && !clean.startsWith('[plugins]');
          })
          .join('\n')
          .trim();
      },
    });
  }
}
