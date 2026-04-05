/**
 * CLI Connector 通用基类
 * 通过本地 AI CLI 工具调用，使用用户的订阅额度，无需 API key
 *
 * 支持: Claude Code / Gemini CLI / Copilot CLI / Codex CLI / OpenClaw CLI
 *
 * 当 prompt 过长（超过 ARG_MAX 安全阈值）时，自动切换为 stdin 传输，
 * 避免 ENAMETOOLONG 错误（GitHub issue #1）
 */
import { spawn } from 'node:child_process';
import type { LLMConnector, LLMResult, LLMConfig } from '../types.js';

/** 命令行参数安全长度上限（128KB，留余量） */
const ARG_SAFE_LIMIT = 128 * 1024;

export interface CLIConnectorConfig {
  /** CLI 命令名 */
  command: string;
  /** 显示名称（用于错误消息） */
  displayName: string;
  /** 安装提示（ENOENT 时显示） */
  installHint?: string;
  /** 构建命令行参数 */
  buildArgs: (fullPrompt: string, config: LLMConfig) => string[];
  /** 构建 stdin 模式的参数（prompt 过长时使用，默认用 buildArgs 替换 prompt 为 '-'） */
  buildStdinArgs?: (config: LLMConfig) => string[];
  /** 从 stdout 提取内容（默认 trim） */
  parseOutput?: (stdout: string) => string;
}

export class CLIBaseConnector implements LLMConnector {
  constructor(private cfg: CLIConnectorConfig) {}

  async chat(systemPrompt: string, userMessage: string, config: LLMConfig): Promise<LLMResult> {
    const fullPrompt = systemPrompt
      ? `<system>\n${systemPrompt}\n</system>\n\n${userMessage}`
      : userMessage;

    const promptBytes = Buffer.byteLength(fullPrompt, 'utf-8');
    const useStdin = promptBytes > ARG_SAFE_LIMIT;

    const args = useStdin
      ? (this.cfg.buildStdinArgs?.(config) ?? this.cfg.buildArgs('-', config))
      : this.cfg.buildArgs(fullPrompt, config);

    const timeout = config.timeout || 180000;

    return new Promise<LLMResult>((resolve, reject) => {
      const child = spawn(this.cfg.command, args, {
        env: { ...process.env },
        stdio: [useStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });

      let stdout = '';
      let stderr = '';
      let killed = false;

      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
      }, timeout);

      child.stdout!.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      if (useStdin && child.stdin) {
        child.stdin.write(fullPrompt);
        child.stdin.end();
      }

      child.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        if (err.code === 'ENOENT') {
          reject(new Error(
            `找不到 ${this.cfg.command} 命令，请先安装 ${this.cfg.displayName}\n` +
            (this.cfg.installHint ? `安装: ${this.cfg.installHint}\n` : '') +
            `参考: https://github.com/jnMetaCode/agency-orchestrator#llm-配置`
          ));
        } else {
          reject(new Error(`${this.cfg.displayName} 调用失败: ${err.message}`));
        }
      });

      child.on('close', (code) => {
        clearTimeout(timer);

        if (killed) {
          reject(new Error(`${this.cfg.displayName} 超时 (${timeout / 1000}s)，可在 YAML 中设置 timeout 增加等待时间`));
          return;
        }

        if (code !== 0 && !stdout.trim()) {
          reject(new Error(`${this.cfg.displayName} 调用失败 (exit ${code}): ${stderr.slice(0, 500)}`));
          return;
        }

        const content = this.cfg.parseOutput
          ? this.cfg.parseOutput(stdout)
          : stdout.trim();

        if (!content && stderr) {
          reject(new Error(`${this.cfg.displayName} 返回空内容，stderr: ${stderr.slice(0, 500)}`));
          return;
        }

        resolve({
          content,
          usage: {
            input_tokens: Math.ceil((systemPrompt.length + userMessage.length) / 4),
            output_tokens: Math.ceil(content.length / 4),
          },
        });
      });
    });
  }
}
