/**
 * Cline CLI Connector
 * 通过本地 `cline` CLI 调用（Cline CLI 2.x/3.x，`npm install -g cline`），用它已配置的
 * 供应商/账号（`cline auth`）跑 AO 步骤，AO 这边不用再配 key。
 *
 * 真机事实（cline 3.0.61, 2026-09-02）：
 *   - 提示词是位置参数，一次性任务、跑完退出；`--json` 输出 NDJSON，最后一行 `type:"run_result"`
 *     带 `text` / `usage` / `finishReason`，这才是答案（前面几十行是 reasoning/hook 事件）。
 *   - `-s <系统提示词>` 整个替换它自带的 agentic 系统提示词，23KB 的角色 .md 原样传入没问题。
 *     所以这里**不走 stdin**：shell 管道（真 FIFO）它读，但 Node spawn 的 stdio 管道是
 *     socketpair、普通文件也不行——它只在 stdin 是 FIFO 时才读，AO 这边送进去的内容它看不见
 *     （mimic 复现三种都试过）。角色走 `-s`、任务走位置参数，两段都是命令行参数。
 *   - 提示词里**必须有空白字符**（空格或换行都行）：纯中文无空格的一串会被当成"未知命令"
 *     拒绝（"Unknown command or unquoted prompt"）。短任务兜底补一个空格。
 *   - `-t <秒>` 是它自己的超时（默认 0 不限时），必须和 AO 的单步超时对齐，否则 AO 这边超时
 *     杀进程时它还在跑。
 *   - 它是 agentic 工具，工具调用默认自动批准且没有"关工具"的开关。所以每次调用都把
 *     `-c` 指到一个空的临时目录：就算模型想写文件，也落不到用户的项目里。
 *   - `-p` 是 plan 模式，不是 print！别按 Claude Code 的习惯传。
 *   - 认证/模型来自 ~/.cline/data（或 CLINE_DATA_DIR）；`cline auth -p <provider> -k <key> -b <base_url> -m <model>`
 *     一次配好。AO 的 `model` 字段 → `-m`，留空用它配置里的默认。
 *   - 3.0.61 在 Node < 22.15 会往 stderr 打一行 trust store 警告，无害。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLIBaseConnector, ARG_HARD_LIMIT_POSIX, ARG_HARD_LIMIT_WIN } from './cli-base.js';
import type { LLMConfig, LLMResult } from '../types.js';

/** 从 `--json` 的 NDJSON 里取最终答案：优先 run_result.text，其次 done 事件的 text。 */
export function parseClineJson(stdout: string): string {
  let runResult = '';
  let doneText = '';
  for (const line of stdout.split('\n')) {
    const s = line.trim();
    if (!s.startsWith('{')) continue;
    let obj: any;
    try { obj = JSON.parse(s); } catch { continue; }
    if (obj?.type === 'run_result' && typeof obj.text === 'string') runResult = obj.text;
    else if (obj?.type === 'agent_event' && obj.event?.type === 'done' && typeof obj.event.text === 'string') doneText = obj.event.text;
  }
  return (runResult || doneText).trim();
}

/** 保证提示词含空白：否则 cline 把它当命令名拒绝。 */
export function ensureWhitespace(prompt: string): string {
  return /\s/.test(prompt) ? prompt : `${prompt} `;
}

/** 系统提示词 + 任务两段都走命令行参数，超过系统上限只能明确报错（不能悄悄截断角色）。 */
export function checkArgBudget(systemPrompt: string, userMessage: string, platform: NodeJS.Platform = process.platform): void {
  const units = (s: string) => (platform === 'win32' ? s.length : Buffer.byteLength(s, 'utf-8'));
  const hard = platform === 'win32' ? ARG_HARD_LIMIT_WIN : ARG_HARD_LIMIT_POSIX;
  // 超限判定和报错描述必须用同一把尺量同一段：之前判定按平台单位、报错却按 .length
  // 重新挑段再量字节——中英混排时真正超限的是字节多的那段，报出来的却可能是另一段的体积，
  // 用户照着裁了半天 KB 数纹丝不动
  const seg = units(systemPrompt) >= units(userMessage) ? systemPrompt : userMessage;
  if (units(seg) > hard) {
    const kb = (Buffer.byteLength(seg, 'utf-8') / 1024).toFixed(1);
    throw new Error(
      `Cline CLI 只能从命令行参数接收提示词（它不读 AO 送进 stdin 的内容），而本步有一段提示词 ${kb}KB，超过了系统命令行长度上限。\n` +
      `  解决办法（任选其一）：\n` +
      `  1. 换成支持 stdin 的 CLI provider（claude-code / codex-cli / codebuddy-cli）或直连 API 的 provider；\n` +
      `  2. 精简该步骤的角色提示词或输入变量。`
    );
  }
}

export class ClineCLIConnector extends CLIBaseConnector {
  constructor() {
    super({
      command: 'cline',
      displayName: 'Cline CLI',
      installHint: 'npm install -g cline，然后 cline auth -p <provider> -k <key>（或 cline auth 交互配置）',
      // 不声明 supportsStdin：见文件头——它只读真 FIFO，AO 的管道它当空。
      buildArgs: (prompt: string, config: LLMConfig) => {
        const c = config as LLMConfig & { __cline_cwd?: string; __cline_system?: string };
        const secs = Math.max(1, Math.ceil((config.timeout || 600_000) / 1000));
        const args = ['--json', '-t', String(secs)];
        if (c.__cline_cwd) args.push('-c', c.__cline_cwd);
        if (c.__cline_system) args.push('-s', c.__cline_system);
        if (config.model && config.model !== 'cline-cli') args.push('-m', config.model);
        args.push(ensureWhitespace(prompt));
        return args;
      },
      parseOutput: parseClineJson,
      emptyOutputHint: '排查：终端跑 `cline "说 你好"` 看是否已 `cline auth` 配好供应商。',
    });
  }

  /**
   * 角色走 `-s`（基类不再把 <system> 拼进提示词），任务走位置参数；每次在空临时目录里跑（-c），
   * 跑完删掉——它的工具调用落不到用户项目。
   */
  override async chat(systemPrompt: string, userMessage: string, config: LLMConfig): Promise<LLMResult> {
    checkArgBudget(systemPrompt, userMessage);
    const sandbox = mkdtempSync(join(tmpdir(), 'ao-cline-'));
    try {
      const cfg = { ...config, __cline_cwd: sandbox, __cline_system: systemPrompt || undefined } as LLMConfig;
      const res = await super.chat('', userMessage, cfg);
      // 基类按它收到的 ('' + 任务) 估 token，角色走了 -s 会被漏算——按真实两段重估
      return {
        ...res,
        usage: {
          input_tokens: Math.ceil((systemPrompt.length + userMessage.length) / 4),
          output_tokens: res.usage?.output_tokens ?? Math.ceil(res.content.length / 4),
        },
      };
    } finally {
      try { rmSync(sandbox, { recursive: true, force: true }); } catch {}
    }
  }
}
