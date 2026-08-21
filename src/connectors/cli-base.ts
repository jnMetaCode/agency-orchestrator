/**
 * CLI Connector 通用基类
 * 通过本地 AI CLI 工具调用，使用用户的订阅额度，无需 API key
 *
 * 支持: Claude Code / Gemini CLI / Copilot CLI / Codex CLI / OpenClaw CLI
 *
 * 当 prompt 过长（超过 ARG_MAX 安全阈值）时，自动切换为 stdin 传输，
 * 避免 ENAMETOOLONG 错误（GitHub issue #1）
 */
import { hasImageInput, stripImageDataUris } from '../utils/vision.js';
import { spawnCLI } from './spawn-cli.js';
import type { LLMConnector, LLMResult, LLMConfig } from '../types.js';
import { t } from '../i18n.js';

/**
 * 命令行参数安全长度上限
 * claude -p 等 CLI 工具通过命令行参数传大 prompt 会严重变慢
 * （12KB prompt: 命令行参数 330s+ vs stdin 61s）
 * 设为 4KB，超过就自动走 stdin —— 仅限确实会读 stdin 的 CLI，见 supportsStdin
 */
export const ARG_SAFE_LIMIT = 4 * 1024;

/**
 * 命令行参数硬上限（超过这个只能报错，不能硬塞）
 * - Windows：CreateProcess 的命令行上限是 32767 个 UTF-16 字符，留出余量按 30000 个字符算
 * - Linux：单个参数上限 MAX_ARG_STRLEN = 128KB，按字节留出余量算 100KB
 */
export const ARG_HARD_LIMIT_WIN = 30_000;
export const ARG_HARD_LIMIT_POSIX = 100 * 1024;

export type PromptTransport = 'arg' | 'stdin' | 'overflow';

/**
 * 决定 prompt 怎么送进 CLI。
 *
 * 关键修正：以前只要 prompt 超过 4KB 就无脑走 stdin，参数用 `buildArgs('-')` 生成。
 * 但只有个别 CLI（codex exec `-`、claude `-p -`）真的会把 `-` 当"从 stdin 读"，
 * hermes `-z -` / copilot `-p -` / openclaw `--message -` 只会把它当成**字面量提示词
 * "-"**。而角色系统提示词普遍 10~25KB，等于这些 provider 跑真实工作流时，模型收到
 * 的提示词永远是一个减号 —— 输出自然是驴唇不对马嘴。
 * 所以：只有声明了 supportsStdin 的 CLI 才允许切 stdin，其余一律走命令行参数
 * （Windows 修好转义后同样安全），真的超过系统上限时明确报错而不是悄悄送 "-"。
 */
export function chooseTransport(
  prompt: string,
  supportsStdin: boolean,
  platform: NodeJS.Platform = process.platform,
): PromptTransport {
  const bytes = Buffer.byteLength(prompt, 'utf-8');
  if (supportsStdin && bytes > ARG_SAFE_LIMIT) return 'stdin';
  // Windows 按 UTF-16 字符数算（中文 1 字符 = 1 wchar 但 3 字节），POSIX 按字节算
  const units = platform === 'win32' ? prompt.length : bytes;
  const hard = platform === 'win32' ? ARG_HARD_LIMIT_WIN : ARG_HARD_LIMIT_POSIX;
  if (units > hard) return 'overflow';
  return 'arg';
}

/**
 * 解码子进程输出。Windows 下报错未必是 UTF-8：命令找不到时 cmd.exe 吐的
 * "'gemini' 不是内部或外部命令..."（走 spawn-cli 的 cmd 兜底路径时仍会遇到），
 * 以及不少 CLI 自己的中文输出，用的都是系统当前 ANSI/OEM 代码页（中文 Windows
 * 通常是 GBK/CP936），不是 UTF-8。之前直接 toString('utf8') 会把这段本来很清楚的
 * 报错解码成乱码，用户看到的是一堆问号方块，完全看不出"其实是命令没装/不在 PATH"。
 * 这里先按严格 UTF-8 校验，非法字节序列（真正的 CLI 输出都应该是合法 UTF-8）就
 * 判定为别的代码页，回退按 GBK 解码——对中文 Windows 用户是压倒性最常见的情况。
 */
export function decodeProcessOutput(chunks: Buffer[]): string {
  const buf = Buffer.concat(chunks);
  if (buf.length === 0) return '';
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    if (process.platform === 'win32') {
      try {
        return new TextDecoder('gbk').decode(buf);
      } catch {
        // 当前 Node 不含该 ICU 编码数据等极端情况，走最终兜底
      }
    }
    return buf.toString('utf-8');
  }
}

export interface CLIConnectorConfig {
  /** CLI 命令名 */
  command: string;
  /** 显示名称（用于错误消息） */
  displayName: string;
  /** 安装提示（ENOENT 时显示） */
  installHint?: string;
  /** 构建命令行参数 */
  buildArgs: (fullPrompt: string, config: LLMConfig) => string[];
  /**
   * 该 CLI 是否真的会从 stdin 读取 prompt。
   * 只有确认支持的才置 true（codex exec 的 `-`、gemini 的管道输入），
   * 否则长 prompt 切到 stdin 只会让模型收到一个字面量 "-"。
   */
  supportsStdin?: boolean;
  /** 构建 stdin 模式的参数（prompt 过长时使用，默认用 buildArgs 替换 prompt 为 '-'） */
  buildStdinArgs?: (config: LLMConfig) => string[];
  /** 从 stdout 提取内容（默认 trim） */
  parseOutput?: (stdout: string) => string;
  /**
   * 该 CLI 特有的"空输出"排查提示（追加在通用提示之后）。
   * 通用那段只能说到"可能没认证/参数变了"，而每个 CLI 卡住的真实原因往往很具体
   * （如 Antigravity 在等工具调用的人工审批），说清楚才省得用户去猜。
   */
  emptyOutputHint?: string;
}

export class CLIBaseConnector implements LLMConnector {
  constructor(private cfg: CLIConnectorConfig) {}

  async chat(systemPrompt: string, userMessage: string, config: LLMConfig): Promise<LLMResult> {
    // 图片输入（data URI）：CLI 订阅类 provider 不支持——必须剥离，几 MB base64
    // 原样进提示词是 token 炸弹。警告一行，指路 API provider。
    if (hasImageInput(userMessage)) {
      process.stderr.write(`  ⚠️ ${this.cfg.displayName} 不支持图片输入，已跳过图片（要用图片请换 openai/claude 等支持 vision 的 API provider，并选 vision 模型）\n`);
      userMessage = stripImageDataUris(userMessage, '[图片输入已跳过：该 provider 不支持]');
    }
    const fullPrompt = systemPrompt
      ? `<system>\n${systemPrompt}\n</system>\n\n${userMessage}`
      : userMessage;

    const transport = chooseTransport(fullPrompt, !!this.cfg.supportsStdin);
    if (transport === 'overflow') {
      const kb = (Buffer.byteLength(fullPrompt, 'utf-8') / 1024).toFixed(1);
      throw new Error(
        `${this.cfg.displayName} 不支持从 stdin 读取提示词，而本步提示词有 ${kb}KB，超过了系统命令行长度上限。\n` +
        `  解决办法（任选其一）：\n` +
        `  1. 换成支持 stdin 的 CLI provider（claude-code / codex-cli）或直连 API 的 provider；\n` +
        `  2. 精简该步骤的角色提示词或输入变量。`
      );
    }
    const useStdin = transport === 'stdin';

    const args = useStdin
      ? (this.cfg.buildStdinArgs?.(config) ?? this.cfg.buildArgs('-', config))
      : this.cfg.buildArgs(fullPrompt, config);

    const timeout = config.timeout || 600_000;  // 默认 10 分钟（gateway/MiniMax 等 CLI provider 可能单步 5+ 分钟）

    return new Promise<LLMResult>((resolve, reject) => {
      // Windows 下不能走 shell:true —— Node 会把参数裸拼给 cmd.exe，prompt 里的
      // `<system>`/换行会被当成重定向和命令分隔符（issue #102）。spawnCLI 负责绕开。
      const child = spawnCLI(this.cfg.command, args, {
        env: { ...process.env },
        stdio: [useStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      }, this.cfg.displayName);

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
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
        stdoutChunks.push(chunk);
        receivedBytes += chunk.length;
        // 每 10 秒最多显示一次接收进度，让用户知道没卡死
        const now = Date.now();
        if (now - lastProgressTime > 10_000) {
          lastProgressTime = now;
          const kb = (receivedBytes / 1024).toFixed(1);
          process.stderr.write(`  ${t('stream.received', { size: kb })}\n`);
        }
      });
      child.stderr!.on('data', (chunk: Buffer) => { stderrChunks.push(chunk); });

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

        const stdout = decodeProcessOutput(stdoutChunks);
        const stderr = decodeProcessOutput(stderrChunks);

        if (code !== 0 && !stdout.trim()) {
          // 兜底识别"命令未安装"：spawn-cli 现在优先直连可执行文件（走 ENOENT 分支），
          // 但仍有落到 cmd.exe 的兜底路径——那时 cmd.exe 自己吞掉 ENOENT、改成打印
          // 错误 + 非零退出，只能靠文案识别。
          const notFoundPattern = /not recognized as an internal or external command|不是内部或外部命令|command not found|不是可运行的程序/i;
          const looksLikeNotFound = notFoundPattern.test(stderr);
          if (looksLikeNotFound) {
            reject(new Error(
              `找不到 ${this.cfg.command} 命令，请先安装 ${this.cfg.displayName}\n` +
              (this.cfg.installHint ? `安装: ${this.cfg.installHint}\n` : '') +
              `参考: https://github.com/jnMetaCode/agency-orchestrator#llm-配置`
            ));
            return;
          }
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
          const extra = this.cfg.emptyOutputHint ? `\n  ${this.cfg.emptyOutputHint}` : '';
          reject(new Error(`${this.cfg.displayName} 返回空内容。${hint}${extra}`));
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
