// 探测本机已安装的「订阅制 CLI provider」——这些 provider 直接复用本机已登录的
// claude / gemini / codex 等 CLI，无需在 AO 里另配 API key。用于「零配置首跑」：
// 装了 Claude Code 的开发者一句话就能跑，不用先去配 key（见漏斗最顶端的激活墙）。

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, delimiter } from 'node:path';

/**
 * 有些 CLI 的官方安装位置**默认不在 PATH 上**（Antigravity 的 install.sh 装到 ~/.local/bin，
 * Windows 装到 %LOCALAPPDATA%\\agy\\bin）。只查 PATH 会得出"没装"的错误结论 ——
 * 用户明明装好了，AO 却不给他零配置那条路。这里按二进制名补几个已知目录。
 */
const EXTRA_BIN_DIRS: Record<string, (env: NodeJS.ProcessEnv) => string[]> = {
  agy: (env) => [
    join(homedir(), '.local', 'bin'),
    ...(env.LOCALAPPDATA ? [join(env.LOCALAPPDATA, 'agy', 'bin')] : []),
  ],
};

/** 订阅制 CLI provider 名 → 它实际调用的可执行文件名（与各 connector 的 command 对齐）。 */
export const CLI_PROVIDER_BINS: Record<string, string> = {
  'claude-code': 'claude',
  // Google 的 Antigravity CLI（Gemini CLI 的继任者，2026-06-18 起）——二进制名是 agy
  'antigravity-cli': 'agy',
  'gemini-cli': 'gemini',
  'copilot-cli': 'copilot',
  'codex-cli': 'codex',
  'openclaw-cli': 'openclaw',
  'hermes-cli': 'hermes',
};

/** 某可执行文件是否在 PATH 上（跨平台，不起 shell，避免注入与 which 缺失问题）。 */
export function isOnPath(bin: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const PATH = env.PATH || env.Path || '';
  if (!PATH && !EXTRA_BIN_DIRS[bin]) return false;
  // Windows 下可执行文件带扩展名，按 PATHEXT 逐个试。
  const exts = process.platform === 'win32'
    ? (env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').map((e) => e.toLowerCase())
    : [''];
  const dirs = [...PATH.split(delimiter), ...(EXTRA_BIN_DIRS[bin]?.(env) ?? [])];
  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of exts) {
      if (existsSync(join(dir, bin + ext))) return true;
    }
  }
  return false;
}

/**
 * 探测本机已安装的订阅制 CLI provider（可零配置直接用）。
 * 返回 provider 名数组，顺序即偏好顺序（claude-code 优先）。
 */
export function detectInstalledCliProviders(env: NodeJS.ProcessEnv = process.env): string[] {
  return Object.entries(CLI_PROVIDER_BINS)
    .filter(([, bin]) => isOnPath(bin, env))
    .map(([name]) => name);
}
