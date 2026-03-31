/**
 * OpenClaw CLI Connector
 * 通过本地 `openclaw` CLI 调用，支持 OAuth 和 API key 多种认证方式
 *
 * 安装: npm install -g openclaw@latest
 * 认证: openclaw onboard --install-daemon（引导配置）
 *
 * 注意: openclaw agent 必须指定 --agent <id>，否则会报
 * "Pass --to <E.164>, --session-id, or --agent to choose a session"
 * 默认使用 "main" agent，可通过 YAML model 字段或 OPENCLAW_AGENT 环境变量覆盖
 */
import { CLIBaseConnector } from './cli-base.js';
import type { LLMConfig } from '../types.js';

export class OpenClawCLIConnector extends CLIBaseConnector {
  constructor() {
    super({
      command: 'openclaw',
      displayName: 'OpenClaw CLI',
      buildArgs: (prompt: string, config: LLMConfig) => {
        // model 字段复用为 agent id，例如 model: "my-agent"
        const agentId = config.model || process.env.OPENCLAW_AGENT || 'main';
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
