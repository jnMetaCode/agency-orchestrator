/**
 * Claude Code CLI Connector
 * 通过本地 `claude` CLI 调用，直接使用 Claude Max/Pro 订阅额度，无需 API key
 *
 * 安装: npm install -g @anthropic-ai/claude-code
 * 认证: claude 登录后自动使用订阅额度
 *
 * 关键: 使用 --output-format json 而非 text
 * text 格式在管道模式下有缓冲问题，长输出（>1000 字）会导致子进程挂起
 * json 格式一次性输出完整结果，包含 usage 等元数据
 */
import { writeFileSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { t } from '../i18n.js';
import { decodeProcessOutput } from './cli-base.js';
import { spawnCLI } from './spawn-cli.js';
import type { LLMConnector, LLMResult, LLMConfig } from '../types.js';

const NOT_FOUND_PATTERN = /not recognized as an internal or external command|不是内部或外部命令|command not found|不是可运行的程序/i;

/**
 * "Claude Code 形态"的 CLI 都能复用这套调用方式：`-p -` 读 stdin、`--output-format json`、
 * `--system-prompt-file`、`--tools ""` 关工具。腾讯 CodeBuddy（WorkBuddy 内置的就是它）
 * 命令行参数与 Claude Code 逐项对齐，只是命令名、安装方式和个别专属开关不同，
 * 所以这里把差异抽成配置，而不是复制一份 200 行的连接器。
 */
export interface ClaudeShapedCLIOptions {
  /** 可执行文件名（spawn-cli 负责 PATH + 已知安装目录的解析） */
  command: string;
  /** 用于报错文案 */
  displayName: string;
  /** ENOENT 时的安装提示 */
  installHint: string;
  /** provider id：YAML 里 model 等于它时视为"未指定模型"，不往 CLI 传 */
  providerId: string;
  /** 该 CLI 独有的附加参数（如 claude 的 --no-session-persistence，别的 CLI 不认） */
  extraArgs?: string[];
  /**
   * 用 `--output-format stream-json --verbose` 取全部分段。单段输出超过 CLI 的输出上限时，claude 会自动续写成
   * 多轮，而 `--output-format json` 的 `result` **只装最后一段**——真机（claude 2.1.271, 2026-09-15）：
   * 让它从 1 写到 400 并把输出上限压到 300 token，json 的 result 是 301–400、subtype 仍是 success；
   * stream-json 三条 assistant 消息拼起来是完整的 1–400。实际工作流里一步 8.9 万 token 的代码丢了约三分之二。
   * 只给实测过的 CLI 打开（CodeBuddy 未实测，仍用 json）。
   */
  streamJson?: boolean;
}

const CLAUDE_CODE: ClaudeShapedCLIOptions = {
  command: 'claude',
  displayName: 'Claude Code CLI',
  installHint: 'npm install -g @anthropic-ai/claude-code',
  providerId: 'claude-code',
  extraArgs: ['--no-session-persistence'],
  streamJson: true,
};

/**
 * 取出 `--output-format json` 里的最终结果对象。
 * Claude Code 打印单个 `{type:"result", result, usage}`；CodeBuddy 打印整段对话的**数组**
 * （user/assistant 消息 + 文件快照 + 最后一个 `type:"result"`，实测 2.103.3），
 * 直接当对象读会拿到 undefined → 误报"返回空内容"。
 */
/**
 * 剥掉答案首尾**独占一行**的控制标签（`</thinking_mode>` 这类 snake_case 标签，或 `<thinking>`）。
 * 真机（2026-09-13，Studio 跑两步小工作流）：Claude Code 的 `result` 开头混进一行 `</thinking_mode>`，
 * 原样进了交付物、导出的 Word 第一行就是它。AO 自己的提示词里没有这个标签，是模型侧偶发泄漏。
 * 只动首尾、只认"整行就是一个无属性标签"——正文里讨论 XML、代码块里的标签一概不碰。
 */
export function stripStrayControlTags(text: string): string {
  const TAG_LINE = /^[ \t]*<\/?(?:thinking|[a-z]+(?:_[a-z]+)+)>[ \t]*$/;
  const lines = text.split('\n');
  while (lines.length && (TAG_LINE.test(lines[0]) || !lines[0].trim())) lines.shift();
  while (lines.length && (TAG_LINE.test(lines[lines.length - 1]) || !lines[lines.length - 1].trim())) lines.pop();
  return lines.join('\n');
}

export function parseResultJson(stdout: string): any {
  const trimmed = stdout.trim();
  let json: any;
  try {
    json = JSON.parse(trimmed);
  } catch (err) {
    // stream-json：一行一个事件。解析不了就把原错误抛回去，走调用方的纯文本兜底
    const events = parseJsonLines(trimmed);
    if (!events) throw err;
    return fromConversation(events);
  }
  if (Array.isArray(json)) return fromConversation(json);
  return json;
}

function parseJsonLines(text: string): any[] | null {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const events: any[] = [];
  for (const line of lines) {
    try { events.push(JSON.parse(line)); } catch { return null; }
  }
  return events;
}

/** 一条 assistant 消息里的文本：stream-json 是 {type:'assistant', message:{content}}，CodeBuddy 数组是 {role:'assistant', content} */
function assistantText(m: any): string {
  const content = m?.message?.content ?? m?.content;
  return Array.isArray(content)
    ? content.filter((c: any) => typeof c?.text === 'string').map((c: any) => c.text).join('\n')
    : '';
}

/**
 * 整段对话（stream-json 事件或 CodeBuddy 数组）→ 结果对象。
 * 续写成多轮时 result 只装最后一段，所以有多条 assistant 文本就按顺序拼起来当正文；
 * usage / is_error 仍取 result 事件。
 */
function fromConversation(events: any[]): any {
  const result = [...events].reverse().find((m) => m && m.type === 'result');
  const texts = events
    .filter((m) => m && (m.type === 'assistant' || m.role === 'assistant'))
    .map(assistantText)
    .filter(Boolean);
  if (result) {
    return texts.length > 1 && !result.is_error ? { ...result, result: texts.join('') } : result;
  }
  // 没有 result 元素：退而取 assistant 文本，别把整段对话当空
  return { result: texts.join('\n'), usage: {} };
}

export class ClaudeCodeConnector implements LLMConnector {
  protected readonly opts: ClaudeShapedCLIOptions;

  constructor(opts: ClaudeShapedCLIOptions = CLAUDE_CODE) {
    this.opts = opts;
  }

  async chat(systemPrompt: string, userMessage: string, config: LLMConfig): Promise<LLMResult> {
    const timeout = config.timeout || 600_000;  // 默认 10 分钟

    // 用临时文件传系统 prompt（避免命令行过长）
    let systemPromptFile: string | undefined;
    if (systemPrompt) {
      systemPromptFile = join(tmpdir(), `ao-sysprompt-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
      // 0600：系统提示词可能含专有角色定义，限制为仅当前用户可读
      writeFileSync(systemPromptFile, systemPrompt, { encoding: 'utf-8', mode: 0o600 });
    }

    // 使用 json 格式：text 格式在管道中会缓冲挂起
    const format = this.opts.streamJson ? ['--output-format', 'stream-json', '--verbose'] : ['--output-format', 'json'];
    const args = ['-p', '-', ...format, '--tools', '', '--effort', 'low', ...(this.opts.extraArgs ?? [])];
    if (systemPromptFile) {
      args.push('--system-prompt-file', systemPromptFile);
    }
    if (config.model && config.model !== this.opts.providerId) {
      args.push('--model', config.model);
    }

    // 在空临时目录里启动：claude 会按启动目录自动加载项目记忆（~/.claude/projects/<cwd>/memory）
    // 和 CLAUDE.md。关了工具也照样注入——真机（2026-09-15）：在 AO 仓库里跑「一人公司」模板，
    // 用户私有记忆里的项目名写进了启动包，别人复现不了，分享报告还会带出私有信息。
    // 不用 --bare：它不读钥匙串 / OAuth，订阅登录用户会直接不可用。要沿用旧行为设 AO_CLI_INHERIT_CWD=1。
    const sandbox = process.env.AO_CLI_INHERIT_CWD === '1' ? undefined : mkdtempSync(join(tmpdir(), 'ao-claude-'));

    try {
      return await this._exec(args, userMessage, timeout, sandbox);
    } finally {
      if (systemPromptFile) {
        try { unlinkSync(systemPromptFile); } catch {}
      }
      if (sandbox) {
        try { rmSync(sandbox, { recursive: true, force: true }); } catch {}
      }
    }
  }

  private _exec(args: string[], stdinData: string, timeout: number, cwd?: string): Promise<LLMResult> {
    return new Promise<LLMResult>((resolve, reject) => {
      // 不走 shell：Windows 下 shell:true 会把参数裸拼给 cmd.exe，空串参数会被直接吃掉
      // （`--tools ""` 变成 `--tools --effort`，等于禁用工具的开关失效）—— 见 issue #102
      const { command, displayName, installHint } = this.opts;
      const notFoundError = () => new Error(
        `找不到 ${command} 命令，请先安装 ${displayName}\n` +
        `安装: ${installHint}\n` +
        '参考: https://github.com/jnMetaCode/agency-orchestrator#llm-配置'
      );
      const child = spawnCLI(command, args, {
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        ...(cwd ? { cwd } : {}),
      }, displayName);

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let killed = false;
      let receivedBytes = 0;
      let lastProgressTime = 0;

      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
        setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 5000);
      }, timeout);

      child.stdout!.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk);
        receivedBytes += chunk.length;
        const now = Date.now();
        if (now - lastProgressTime > 10_000) {
          lastProgressTime = now;
          const kb = (receivedBytes / 1024).toFixed(1);
          process.stderr.write(`  ${t('stream.received', { size: kb })}\n`);
        }
      });
      child.stderr!.on('data', (chunk: Buffer) => { stderrChunks.push(chunk); });

      child.stdin!.on('error', () => {});
      child.stdin!.write(stdinData);
      child.stdin!.end();

      child.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        if (err.code === 'ENOENT') {
          reject(notFoundError());
        } else {
          reject(new Error(`${displayName} 调用失败: ${err.message}`));
        }
      });

      child.on('close', (code) => {
        clearTimeout(timer);

        if (killed) {
          reject(new Error(`${displayName} 超时 (${timeout / 1000}s)，可在 YAML 中设置 timeout 增加等待时间`));
          return;
        }

        const stdout = decodeProcessOutput(stdoutChunks);
        const stderr = decodeProcessOutput(stderrChunks);

        if (code !== 0 && !stdout.trim()) {
          // 兜底识别"命令未安装"：spawn-cli 落到 cmd.exe 兜底路径时，命令不存在
          // Node 收不到 ENOENT（cmd.exe 自己吞了、改成打印错误 + 非零退出）
          if (NOT_FOUND_PATTERN.test(stderr)) {
            reject(notFoundError());
            return;
          }
          reject(new Error(`${displayName} 调用失败 (exit ${code}): ${stderr.slice(0, 500)}`));
          return;
        }

        // 解析 JSON 响应
        try {
          const json = parseResultJson(stdout);

          if (json.is_error) {
            reject(new Error(`${displayName} 错误: ${json.result?.slice(0, 300) || 'unknown error'}`));
            return;
          }

          const content = stripStrayControlTags((json.result || '').trim());
          if (!content) {
            reject(new Error(`${displayName} 返回空内容`));
            return;
          }

          // 从 JSON 中提取真实 usage
          const usage = json.usage || json.modelUsage || {};
          resolve({
            content,
            usage: {
              input_tokens: usage.input_tokens || usage.inputTokens || 0,
              output_tokens: usage.output_tokens || usage.outputTokens || 0,
            },
          });
        } catch {
          // JSON 解析失败，回退到原始文本
          const content = stripStrayControlTags(stdout.trim());
          if (!content) {
            reject(new Error(`${displayName} 返回空内容，stderr: ${stderr.slice(0, 500)}`));
            return;
          }

          // 检测 API 错误
          if (content.length < 500) {
            const apiErrorPattern = /^API Error:|^ECONNRESET|^ETIMEDOUT|^ECONNREFUSED|^Unable to connect|^socket hang up/im;
            if (apiErrorPattern.test(content)) {
              reject(new Error(`${displayName} API 错误: ${content.slice(0, 300)}`));
              return;
            }
          }

          resolve({
            content,
            usage: { input_tokens: 0, output_tokens: 0 },
          });
        }
      });
    });
  }
}
