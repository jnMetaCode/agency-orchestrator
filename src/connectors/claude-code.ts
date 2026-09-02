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
import { writeFileSync, unlinkSync } from 'node:fs';
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
}

const CLAUDE_CODE: ClaudeShapedCLIOptions = {
  command: 'claude',
  displayName: 'Claude Code CLI',
  installHint: 'npm install -g @anthropic-ai/claude-code',
  providerId: 'claude-code',
  extraArgs: ['--no-session-persistence'],
};

/**
 * 取出 `--output-format json` 里的最终结果对象。
 * Claude Code 打印单个 `{type:"result", result, usage}`；CodeBuddy 打印整段对话的**数组**
 * （user/assistant 消息 + 文件快照 + 最后一个 `type:"result"`，实测 2.103.3），
 * 直接当对象读会拿到 undefined → 误报"返回空内容"。
 */
export function parseResultJson(stdout: string): any {
  const json = JSON.parse(stdout);
  if (Array.isArray(json)) {
    const result = [...json].reverse().find((m) => m && m.type === 'result');
    if (result) return result;
    // 没有 result 元素：退而取最后一条 assistant 文本，别把整个数组当空
    const assistant = [...json].reverse().find((m) => m && m.role === 'assistant');
    const text = Array.isArray(assistant?.content)
      ? assistant.content.filter((c: any) => typeof c?.text === 'string').map((c: any) => c.text).join('\n')
      : '';
    return { result: text, usage: {} };
  }
  return json;
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
    const args = ['-p', '-', '--output-format', 'json', '--tools', '', '--effort', 'low', ...(this.opts.extraArgs ?? [])];
    if (systemPromptFile) {
      args.push('--system-prompt-file', systemPromptFile);
    }
    if (config.model && config.model !== this.opts.providerId) {
      args.push('--model', config.model);
    }

    try {
      return await this._exec(args, userMessage, timeout);
    } finally {
      if (systemPromptFile) {
        try { unlinkSync(systemPromptFile); } catch {}
      }
    }
  }

  private _exec(args: string[], stdinData: string, timeout: number): Promise<LLMResult> {
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

          const content = (json.result || '').trim();
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
          const content = stdout.trim();
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
