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
import { t } from '../i18n.js';

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

    const timeout = config.timeout || 600_000;  // 默认 10 分钟（gateway/MiniMax 等 CLI provider 可能单步 5+ 分钟）

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
          process.stderr.write(`  ${t('stream.received', { size: kb })}\n`);
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
          // 启发式识别"首次未认证"类错误（各 CLI 工具首次运行时都要求登录），给中文引导
          const authPattern = /auth method|not authenticated|not logged in|please (login|sign[\s-]*in)|unauthorized|credentials|_API_KEY/i;
          const looksLikeAuth = authPattern.test(stderr);
          const hint = looksLikeAuth
            ? `\n  提示: 首次使用 ${this.cfg.displayName} 需要先在终端跑一次 \`${this.cfg.command}\` 完成账号登录，或设置对应的 API KEY 环境变量`
            : '';
          reject(new Error(`${this.cfg.displayName} 调用失败 (exit ${code}): ${stderr.slice(0, 500)}${hint}`));
          return;
        }

        const content = this.cfg.parseOutput
          ? this.cfg.parseOutput(stdout)
          : stdout.trim();

        // 空内容是严重错误（LLM 应当返回内容）。区分两类原因给具体 hint，避免上层
        // 拿到空字符串后报出迷惑性的"无效 YAML"错误。
        if (!content) {
          const stderrSnippet = stderr.trim().slice(0, 400);
          const hint = stderrSnippet
            ? `stderr: ${stderrSnippet}`
            : `进程退出码 ${code} 但 stdout/stderr 都为空。可能原因: CLI 命令格式已变（参考 issue #14 hermes 的 chat -q → -z）/ agent 或 model 配置不对 / CLI 需要先认证。建议在终端直接跑一次:\n    ${this.cfg.command} ${args.slice(0, 4).join(' ')}${args.length > 4 ? ' ...' : ''}\n  看真实输出再调整 ao 配置`;
          reject(new Error(`${this.cfg.displayName} 返回空内容。${hint}`));
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
