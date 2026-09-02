/**
 * "这个 CLI 装在哪" —— 探测与真正 spawn **必须共用同一份答案**。
 *
 * 踩过的坑：有些 CLI 的官方安装位置默认不在 PATH 上（Antigravity 的 install.sh 装到
 * `~/.local/bin`，Windows 装到 `%LOCALAPPDATA%\\agy\\bin`）。当时只给"探测"加了这些目录，
 * 结果 doctor / Studio 说"已安装"、点下去却报"找不到 agy 命令，请先安装" —— 两边各说各话，
 * 是最难自证的一类失败。所以把这份知识抽到这里，两边都从这儿读。
 *
 * 只对**确认过安装位置**的命令加目录，不搞"把 ~/.local/bin 全局加进 PATH"那种大范围改动：
 * 那会悄悄改变其它 CLI 的解析结果，属于用一个新风险换一个小便利。
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

/** 二进制名 → 除 PATH 之外还应该查的目录（官方安装位置）。 */
const EXTRA_BIN_DIRS: Record<string, (env: NodeJS.ProcessEnv) => string[]> = {
  // Google Antigravity CLI：install.sh → ~/.local/bin；Windows install.ps1 → %LOCALAPPDATA%\agy\bin
  agy: (env) => [
    join(homedir(), '.local', 'bin'),
    ...(env.LOCALAPPDATA ? [join(env.LOCALAPPDATA, 'agy', 'bin')] : []),
  ],
  // 腾讯 CodeBuddy CLI：npm 全局装的在 PATH 上；WorkBuddy 桌面版（macOS）把同一个 CLI 打包在
  // app 内部、不进 PATH（实测 WorkBuddy 5.1.7 / codebuddy 2.103.3）。Windows/Linux 的打包位置
  // 没有实证，不猜——那两端请 npm 全局安装。
  codebuddy: () => [
    '/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin',
    join(homedir(), 'Applications', 'WorkBuddy.app', 'Contents', 'Resources', 'app.asar.unpacked', 'cli', 'bin'),
  ],
};

/** 该命令有没有额外的已知安装目录（有的话，PATH 为空也值得再查一遍）。 */
export function hasExtraBinDirs(bin: string): boolean {
  return bin in EXTRA_BIN_DIRS;
}

/** 除 PATH 之外还要查的目录；未登记的命令返回空数组。 */
export function extraBinDirs(bin: string, env: NodeJS.ProcessEnv = process.env): string[] {
  return EXTRA_BIN_DIRS[bin]?.(env) ?? [];
}
