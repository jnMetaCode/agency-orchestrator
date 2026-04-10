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

/**
 * 命令行参数安全长度上限
 * claude -p 等 CLI 工具通过命令行参数传大 prompt 会严重变慢
 * （12KB prompt: 命令行参数 330s+ vs stdin 61s）
 * 设为 4KB，超过就自动走 stdin
 */
const ARG_SAFE_LIMIT = 4 * 1024;

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

    const timeout = config.timeout || 300_000;  // 默认 5 分钟，effort=low 正常 1-3 分钟内响应

    return new Promise<LLMResult>((resolve, reject) => {
      const child = spawn(this.cfg.command, args, {
        env: { ...process.env },
        stdio: [useStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });

      let stdout = '';
      let stderr = '';
      let killed = false;
      let receivedBytes = 0;
      let lastProgressTime = 0;

      const timer = timeout
        ? setTimeout(() => {
            killed = true;
            child.kill('SIGTERM');
            // SIGTERM 后 5s 仍未退出则强制 SIGKILL，防止僵尸进程
            setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 5000);
          }, timeout)
        : null;

      child.stdout!.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
        receivedBytes += chunk.length;
        // 每 10 秒最多显示一次接收进度，让用户知道没卡死
        const now = Date.now();
        if (now - lastProgressTime > 10_000) {
          lastProgressTime = now;
          const kb = (receivedBytes / 1024).toFixed(1);
          process.stderr.write(`  📡 已接收 ${kb}KB...\n`);
        }
      });
      child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      if (useStdin && child.stdin) {
        child.stdin.on('error', () => {});  // 防止子进程提前退出导致 write EPIPE 崩溃
        child.stdin.write(fullPrompt);
        child.stdin.end();
      }

      child.on('error', (err: NodeJS.ErrnoException) => {
        if (timer) clearTimeout(timer);
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
        if (timer) clearTimeout(timer);

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

        // 检测 CLI 输出中的 API 错误（进程 exit 0 但内容是错误信息）
        // 只匹配明确的 API/网络错误模式，避免误判正常内容
        if (content.length < 500) {
          const apiErrorPattern = /^API Error:|^ECONNRESET|^ETIMEDOUT|^ECONNREFUSED|^Unable to connect|^socket hang up/im;
          if (apiErrorPattern.test(content)) {
            reject(new Error(`${this.cfg.displayName} API 错误: ${content.slice(0, 300)}`));
            return;
          }
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
