/**
 * CLI Connector 通用基类
 * 通过本地 AI CLI 工具调用，使用用户的订阅额度，无需 API key
 *
 * 支持: Claude Code / Gemini CLI / Copilot CLI / Codex CLI / OpenClaw CLI
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { LLMConnector, LLMResult, LLMConfig } from '../types.js';

const execFileAsync = promisify(execFile);

export interface CLIConnectorConfig {
  /** CLI 命令名 */
  command: string;
  /** 显示名称（用于错误消息） */
  displayName: string;
  /** 构建命令行参数 */
  buildArgs: (fullPrompt: string, config: LLMConfig) => string[];
  /** 从 stdout 提取内容（默认 trim） */
  parseOutput?: (stdout: string) => string;
}

export class CLIBaseConnector implements LLMConnector {
  constructor(private cfg: CLIConnectorConfig) {}

  async chat(systemPrompt: string, userMessage: string, config: LLMConfig): Promise<LLMResult> {
    const fullPrompt = systemPrompt
      ? `<system>\n${systemPrompt}\n</system>\n\n${userMessage}`
      : userMessage;

    const args = this.cfg.buildArgs(fullPrompt, config);
    const timeout = config.timeout || 180000;

    try {
      const { stdout, stderr } = await execFileAsync(this.cfg.command, args, {
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env },
      });

      const content = this.cfg.parseOutput
        ? this.cfg.parseOutput(stdout)
        : stdout.trim();

      if (!content && stderr) {
        throw new Error(`${this.cfg.displayName} 返回空内容，stderr: ${stderr.slice(0, 500)}`);
      }

      return {
        content,
        usage: {
          input_tokens: Math.ceil((systemPrompt.length + userMessage.length) / 4),
          output_tokens: Math.ceil(content.length / 4),
        },
      };
    } catch (err: any) {
      if (err.killed || err.signal === 'SIGTERM') {
        throw new Error(`${this.cfg.displayName} 超时 (${timeout / 1000}s)，可在 YAML 中设置 timeout 增加等待时间`);
      }
      // 区分"未安装"和"执行失败"
      if (err.code === 'ENOENT') {
        throw new Error(
          `找不到 ${this.cfg.command} 命令，请先安装 ${this.cfg.displayName}\n` +
          `参考: https://github.com/jnMetaCode/agency-orchestrator#llm-配置`
        );
      }
      throw new Error(`${this.cfg.displayName} 调用失败: ${err.message}`);
    }
  }
}
