/**
 * OpenCode CLI Connector
 * 通过本地 `opencode` CLI（`npm install -g opencode-ai`）调用，用它已配置的供应商/账号
 * （`opencode auth login` 或 ~/.config/opencode/opencode.json）跑 AO 步骤，AO 不另配 key。
 *
 * 真机事实（opencode 1.18.27, 2026-09-03）：
 *   - `opencode run --format json [-m provider/model] "<消息>"`：一次性任务，输出 NDJSON 事件流，
 *     答案在 `type:"text"` 事件的 `part.text`（可能多段，按顺序拼），`step_finish` 带 token 数。
 *   - **stdin 必须写完就关**：stdin 是管道且不关，它会一直等（4 分钟都不退出）；写入内容后 end()，
 *     它把 stdin 内容并进消息，模型能看到 —— 长角色提示词走 stdin 没问题。stdin 'ignore' 时 3~5s 退出。
 *   - `-m` 的格式是 `provider/model`（如 `agnes/agnes-2.0-flash`），留空用它配置里的默认模型。
 *   - 它是 agentic 工具，没有关工具的开关。每次调用用 `--dir` 指到一个空的临时目录，跑完删掉——
 *     模型就算想写文件也落不到用户项目里。
 *   - 没有 `-s` 之类的系统提示词参数，角色走基类的 `<system>…</system>` 包装。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLIBaseConnector } from './cli-base.js';
import type { LLMConfig, LLMResult } from '../types.js';

/** 从 `--format json` 的 NDJSON 里拼出答案：所有 text 事件按顺序连接。 */
export function parseOpenCodeJson(stdout: string): string {
  const parts: string[] = [];
  for (const line of stdout.split('\n')) {
    const s = line.trim();
    if (!s.startsWith('{')) continue;
    let obj: any;
    try { obj = JSON.parse(s); } catch { continue; }
    if (obj?.type === 'text' && typeof obj.part?.text === 'string') parts.push(obj.part.text);
  }
  return parts.join('').trim();
}

const STDIN_PROMPT = '请按 stdin 收到的内容作答：其中 <system> 段是你的角色设定，其后是任务。直接输出结果，不要调用任何工具。';

export class OpenCodeCLIConnector extends CLIBaseConnector {
  constructor() {
    super({
      command: 'opencode',
      displayName: 'OpenCode CLI',
      installHint: 'npm install -g opencode-ai，然后 opencode auth login（或在 ~/.config/opencode/opencode.json 配供应商）',
      supportsStdin: true,
      buildArgs: (prompt: string, config: LLMConfig) => [...commonArgs(config), prompt],
      buildStdinArgs: (config: LLMConfig) => [...commonArgs(config), STDIN_PROMPT],
      parseOutput: parseOpenCodeJson,
      emptyOutputHint: '排查：终端跑 `opencode run "说 你好"` 看是否已配好供应商（opencode auth login）；-m 要写成 provider/model。',
    });
  }

  /** 每次在空临时目录里跑（--dir），跑完删掉——它的工具调用落不到用户项目。 */
  override async chat(systemPrompt: string, userMessage: string, config: LLMConfig): Promise<LLMResult> {
    const sandbox = mkdtempSync(join(tmpdir(), 'ao-opencode-'));
    try {
      return await super.chat(systemPrompt, userMessage, { ...config, __opencode_dir: sandbox } as LLMConfig);
    } finally {
      try { rmSync(sandbox, { recursive: true, force: true }); } catch {}
    }
  }
}

function commonArgs(config: LLMConfig): string[] {
  const args = ['run', '--format', 'json'];
  const dir = (config as any).__opencode_dir;
  if (dir) args.push('--dir', dir);
  if (config.model && config.model !== 'opencode-cli') args.push('-m', config.model);
  return args;
}
