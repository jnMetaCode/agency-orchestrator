/**
 * 跨平台拉起本地 CLI 子进程（Windows 不再走 shell）。
 *
 * 为什么不能用 `shell: true`（issue #102 的根因）：
 * Node 在 shell 模式下会把 file + args **用空格裸拼成一整行**交给 cmd.exe，
 * 不做任何引号/转义处理（见 normalizeSpawnArguments）。而我们送进去的 prompt
 * 必然长这样：
 *
 *     <system>\n<角色系统提示词>\n</system>\n\n<任务>
 *
 * cmd.exe 会把 `<` 当输入重定向、`>` 当输出重定向、换行当命令结束，于是每一次
 * 调用都以 `命令语法不正确。(exit 1)` 收场 —— issue #102 里 hermes / gemini /
 * codex 在 Windows 下"全部调用不了"就是这个，与这些 CLI 自身是否下线无关。
 * 顺带一提，裸拼还会把空串参数直接吃掉（`--tools ""` 变成 `--tools --effort`）。
 *
 * 正确做法是绕开 cmd.exe，让参数原样进子进程：
 *   1. 解析出真实可执行文件（PATH × PATHEXT）；
 *   2. `.exe` / `.com` → 直接 spawn，参数由 Node 按 CommandLineToArgvW 规则转义；
 *   3. `.cmd` / `.bat`（npm 全局包在 Windows 上就是这种 shim，且 Node 出于安全
 *      不允许不带 shell 直接 spawn）→ 从 shim 里抠出它真正要跑的 JS 入口，
 *      用当前 node 直接跑，参数照样原样传；
 *   4. 抠不出来才退回 cmd.exe，并自己做引号转义（含换行/引号的参数过不了 cmd，
 *      这时给一句说得清的报错，而不是继续吐"命令语法不正确"）。
 */
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, extname, join, sep } from 'node:path';
// 与安装探测共用「这个 CLI 装在哪」——只给探测加目录会造成
// 「doctor 说已安装、一跑却报找不到命令」（Antigravity 装在 ~/.local/bin，默认不在 PATH）
import { extraBinDirs, hasExtraBinDirs } from '../utils/bin-lookup.js';

/** 在 PATH 上找到命令对应的真实文件（Windows 按 PATHEXT 逐个试）。找不到返回 null。 */
export function findExecutable(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (command.includes('/') || command.includes('\\')) {
    return existsSync(command) ? command : null;
  }
  const PATH = env.PATH || env.Path || '';
  if (!PATH && !hasExtraBinDirs(command)) return null;
  const exts = platform === 'win32'
    ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  for (const dir of [...PATH.split(delimiter), ...extraBinDirs(command, env)]) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = join(dir, command + ext);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/**
 * 从 Windows 的 npm/pnpm `.cmd` shim 里抠出它真正执行的 JS 入口。
 * shim 末行长这样：
 *   ... "%_prog%"  "%dp0%\node_modules\@google\gemini-cli\dist\index.js" %*
 * 返回绝对路径（相对 shim 所在目录解析）；不是这种形状就返回 null，交给上层兜底。
 */
export function parseNpmShim(content: string, shimDir: string): string | null {
  // 两种写法都要认：`%dp0%\...`（npm 的 shim 变量）和 `%~dp0\...`（批处理内置）
  const m = content.match(/%(?:dp0%|~dp0)[\\/]*([^"%\r\n]+?\.(?:js|mjs|cjs))/i);
  if (!m) return null;
  const rel = m[1].trim().replace(/^[\\/]+/, '').replace(/[\\/]/g, sep);
  if (!rel) return null;
  return join(shimDir, rel);
}

/**
 * 按 CommandLineToArgvW 的规则给单个参数加引号（反斜杠在引号前要翻倍）。
 * 只用于最后的 cmd.exe 兜底路径。
 */
export function quoteWinArg(arg: string): string {
  const escaped = arg
    .replace(/(\\*)"/g, '$1$1\\"')
    .replace(/(\\*)$/, '$1$1');
  return `"${escaped}"`;
}

/**
 * 拼 `cmd.exe /d /s /c` 用的命令行（整体再包一层引号，cmd 会剥掉最外层）。
 * 含换行或引号的参数没法安全穿过 cmd.exe 的解析器，这里直接抛出可读的错误 ——
 * 与其让它变成一句莫名其妙的"命令语法不正确"，不如说清是哪个 CLI、该怎么绕。
 */
export function buildCmdLine(file: string, args: string[], displayName = file): string {
  for (const a of args) {
    if (/[\r\n"]/.test(a)) {
      throw new Error(
        `无法通过 cmd.exe 调用 ${displayName}（${file} 是批处理脚本，且参数含换行或引号）。\n` +
        `  解决办法：把该 CLI 装成真正的可执行文件（.exe），或改用直连 API 的 provider。`
      );
    }
  }
  return '"' + [file, ...args].map(quoteWinArg).join(' ') + '"';
}

/** spawnCLI 实际会用的启动方式（导出仅供测试断言用）。 */
export interface CLILaunchPlan {
  file: string;
  args: string[];
  /** true 时走 cmd.exe，需要 windowsVerbatimArguments */
  viaCmd: boolean;
  /** true 表示用当前进程的 execPath 当 Node 跑脚本（桌面端下它其实是 Electron） */
  nodeRuntime?: boolean;
}

/**
 * 决定怎么启动一个 CLI 命令。非 Windows 一律直连（spawn 自己会查 PATH）。
 * `displayName` 只用于兜底路径的报错文案。
 */
export function planLaunch(
  command: string,
  args: string[],
  displayName = command,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): CLILaunchPlan {
  if (platform !== 'win32') {
    // POSIX 下一般把裸命令交给 Node 按 PATH 解析即可（保持既有行为）。
    // 唯一的例外：这个命令有已知的官方安装目录、而它**不在 PATH 上** —— Antigravity 的
    // install.sh 就装到 ~/.local/bin，很多 shell 并不会把它加进 PATH。此时若还交给 Node，
    // 就会出现"doctor 说已安装、一跑却 ENOENT"这种两边各说各话的失败，所以补成绝对路径。
    if (hasExtraBinDirs(command) && !command.includes('/')) {
      const resolvedPosix = findExecutable(command, env, platform);
      if (resolvedPosix) return { file: resolvedPosix, args, viaCmd: false };
    }
    return { file: command, args, viaCmd: false };
  }

  const resolved = findExecutable(command, env, platform);
  // 找不到就原样交给 Node：会抛 ENOENT，上层"没装 / 不在 PATH"的中文提示照旧生效
  if (!resolved) return { file: command, args, viaCmd: false };

  const ext = extname(resolved).toLowerCase();
  if (ext === '.cmd' || ext === '.bat') {
    let shimText = '';
    try { shimText = readFileSync(resolved, 'utf-8'); } catch { /* 读不到就走兜底 */ }
    const entry = shimText ? parseNpmShim(shimText, dirname(resolved)) : null;
    if (entry && existsSync(entry)) {
      return { file: process.execPath, args: [entry, ...args], viaCmd: false, nodeRuntime: true };
    }
    return {
      file: env.ComSpec || env.COMSPEC || 'cmd.exe',
      args: ['/d', '/s', '/c', buildCmdLine(resolved, args, displayName)],
      viaCmd: true,
    };
  }

  return { file: resolved, args, viaCmd: false };
}

/** 拉起 CLI 子进程：参数原样送达，不经过任何 shell 解析。 */
export function spawnCLI(
  command: string,
  args: string[],
  options: SpawnOptions = {},
  displayName = command,
): ChildProcess {
  const plan = planLaunch(command, args, displayName);
  // 桌面端的引擎进程其实是 Electron 以 ELECTRON_RUN_AS_NODE=1 跑起来的，此时
  // process.execPath 指向 Electron 二进制 —— 不显式带上这个变量，拿它去执行 shim
  // 里的 JS 会拉起一个 GUI 实例而不是跑脚本。这里显式补齐，不依赖 env 恰好被继承。
  const needsElectronAsNode = plan.nodeRuntime && !!(process.versions as { electron?: string }).electron;
  const env = needsElectronAsNode
    ? { ...(options.env ?? process.env), ELECTRON_RUN_AS_NODE: '1' }
    : options.env;

  return spawn(plan.file, plan.args, {
    ...options,
    ...(env ? { env } : {}),
    shell: false,
    ...(plan.viaCmd ? { windowsVerbatimArguments: true } : {}),
  });
}
