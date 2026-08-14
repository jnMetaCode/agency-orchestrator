/**
 * Antigravity CLI Connector（Google）
 *
 * 背景：Google 已于 2026-06-18 停掉 Gemini CLI，继任者是 Antigravity CLI。所以 AO 里那个
 * `gemini-cli` provider 对新用户其实已经是死入口（issue #86）。这里补上继任者。
 *
 * 安装: curl -fsSL https://antigravity.google/cli/install.sh | bash   （Windows 见官方 install.ps1）
 *       二进制名是 **agy**，装在 ~/.local/bin（Windows: %LOCALAPPDATA%\agy\bin）
 * 认证: 首次交互运行时走系统钥匙串/浏览器登录，之后**用缓存的登录态**，
 *       没有 API key 环境变量 —— 与 claude-code 一样属于"订阅制、免 key"那一类。
 *
 * 关键参数（取自官方 headless 文档）：
 *   -p / --print / --prompt   跑一次就退出的非交互模式
 *   --output-format text|json|stream-json
 *   --model <slug>  --effort low|medium|high
 *   --print-timeout <时长>    默认 5m
 *
 * 两个有意为之的取舍：
 *  1. **用 text 而不是 json**：json 的具体字段形状官方文档没写全，猜结构解析等于给自己
 *     埋一个"跑完了但什么都没解析出来"。text 就是纯回答正文，够用且不会错。
 *  2. **不传 --dangerously-skip-permissions**：那是"自动批准所有工具调用"，而 AO 是把
 *     这些 CLI 当文本生成器用、往往就在用户的项目目录里跑 —— 默认自动放行等于替用户
 *     承担改文件的风险。保持默认（读它自己的 permissions 配置）。
 */
import { CLIBaseConnector } from './cli-base.js';
import type { LLMConfig } from '../types.js';

/** 官方只认这三档；写错了 CLI 会直接报参数错误，不如不传。 */
const EFFORTS = new Set(['low', 'medium', 'high']);

/**
 * AO 的单步超时（毫秒）→ agy 的 `--print-timeout`。
 *
 * 必须传：agy 自己默认 5 分钟，而 AO 的 CLI provider 默认等 10 分钟。不同步的话，
 * 长步骤会先被 agy 自己掐断，AO 这边看到的是"没输出"，最难查的那种。
 */
export function printTimeoutArg(timeoutMs?: number): string {
  const ms = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 600_000;
  return `${Math.max(1, Math.ceil(ms / 60_000))}m`;
}

/** 构建命令行参数（抽出来单测：这类拼装错了要等真跑才发现） */
export function buildAntigravityArgs(prompt: string, config: LLMConfig): string[] {
  const args = ['-p', prompt, '--output-format', 'text'];
  // provider 名本身不是模型名（用户在 YAML 里只写 provider 时 model 会是它），别当 slug 传下去
  if (config.model && config.model !== 'antigravity-cli') args.push('--model', config.model);
  const effort = String((config.params as Record<string, unknown> | undefined)?.effort ?? '').toLowerCase();
  if (EFFORTS.has(effort)) args.push('--effort', effort);
  args.push('--print-timeout', printTimeoutArg(config.timeout));
  return args;
}

export class AntigravityCLIConnector extends CLIBaseConnector {
  constructor() {
    super({
      command: 'agy',
      displayName: 'Antigravity CLI',
      installHint: 'curl -fsSL https://antigravity.google/cli/install.sh | bash（二进制名 agy，装完先跑一次 agy 登录）',
      // 官方文档只写了 -p 带提示词这一种非交互用法，没写 stdin 能读提示词 ——
      // 没确认的通道不能开：切过去只会让模型收到一个字面量 "-"（gemini/codex 那边的教训）
      supportsStdin: false,
      buildArgs: buildAntigravityArgs,
    });
  }
}
