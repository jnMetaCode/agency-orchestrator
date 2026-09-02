// 探测本机已安装的「订阅制 CLI provider」——这些 provider 直接复用本机已登录的
// claude / gemini / codex 等 CLI，无需在 AO 里另配 API key。用于「零配置首跑」：
// 装了 Claude Code 的开发者一句话就能跑，不用先去配 key（见漏斗最顶端的激活墙）。

import { existsSync } from 'node:fs';
import { join, delimiter } from 'node:path';
// 「装在哪」这份知识与真正 spawn 时共用同一份 —— 两边各说各话就会出现
// 「探测说已安装、跑起来说找不到」（本仓库刚踩过）
import { extraBinDirs, hasExtraBinDirs } from '../utils/bin-lookup.js';


/** 订阅制 CLI provider 名 → 它实际调用的可执行文件名（与各 connector 的 command 对齐）。 */
export const CLI_PROVIDER_BINS: Record<string, string> = {
  'claude-code': 'claude',
  // Google 的 Antigravity CLI（Gemini CLI 的继任者，2026-06-18 起）——二进制名是 agy
  'antigravity-cli': 'agy',
  'copilot-cli': 'copilot',
  'codex-cli': 'codex',
  'openclaw-cli': 'openclaw',
  'hermes-cli': 'hermes',
  // 腾讯 CodeBuddy CLI；WorkBuddy 桌面版内置的就是它（macOS 安装位置见 utils/bin-lookup.ts）
  'codebuddy-cli': 'codebuddy',
  // Cline CLI（npm install -g cline）
  'cline-cli': 'cline',
  // 已停服的排最后：装了仍探测得到（存量用户还能显式使用），但绝不被自动选中
  'gemini-cli': 'gemini',
};

/**
 * 已停服/弃用的 CLI provider → 用户可读的原因。
 * 这些 provider 保留可用（存量用户显式指定仍能跑），但：
 * - 零配置自动选择（autoProvider / Studio recommended）永远跳过它们
 * - doctor / Studio 供应商卡要带「已停服」标注，不能和活跃 CLI 平级展示
 */
export const DEPRECATED_CLI_PROVIDERS: Record<string, string> = {
  'gemini-cli': 'Google 已于 2026-06-18 停服（仅企业版 Code Assist 许可可用），推荐 antigravity-cli',
};

/** 某可执行文件是否在 PATH 上（跨平台，不起 shell，避免注入与 which 缺失问题）。 */
export function isOnPath(bin: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const PATH = env.PATH || env.Path || '';
  if (!PATH && !hasExtraBinDirs(bin)) return false;
  // Windows 下可执行文件带扩展名，按 PATHEXT 逐个试。
  const exts = process.platform === 'win32'
    ? (env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').map((e) => e.toLowerCase())
    : [''];
  const dirs = [...PATH.split(delimiter), ...extraBinDirs(bin, env)];
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

/**
 * 探测本机已安装且「可推荐」的 CLI provider —— 即排除已停服项。
 * 零配置自动选择（autoProvider、Studio recommended）必须用这个而不是上面的全量版：
 * 把新用户自动导向一条已死的路径，比让他去配 key 更糟。
 */
export function detectUsableCliProviders(env: NodeJS.ProcessEnv = process.env): string[] {
  return detectInstalledCliProviders(env).filter((name) => !(name in DEPRECATED_CLI_PROVIDERS));
}
