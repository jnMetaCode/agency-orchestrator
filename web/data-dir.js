/**
 * Studio 可写数据目录的解析（issue #99）
 *
 * 背景：`DATA_DIR` 原来是 `AO_DATA_DIR || ROOT`，而 ROOT = 包的安装目录。
 * 这在两种场景下成立、在第三种下必然炸：
 *
 *   ① 开发仓库直跑     ROOT = 仓库根，可写            ✅
 *   ② 打包桌面端       Electron 传 AO_DATA_DIR       ✅
 *   ③ **npm i -g**     ROOT = /opt/homebrew/lib/node_modules/agency-orchestrator
 *                      —— root 所有、当前用户不可写   ❌
 *
 * ③ 的表现:用户在 Studio 里粘贴 API key，点保存，拿到一个 500 和一串
 * `EACCES: permission denied, mkdir '.../.local'` 的堆栈。这是**第一次使用时**
 * 就会撞上的墙 —— 配 key 是所有人的第一步。
 *
 * 修法：ROOT 不适合放数据时，回落到 `~/.ao`（团队 / 提示词 / 角色 / 版本检查
 * 一直就在这儿，见 src/utils/paths.ts、src/cli/team.ts）。
 *
 * 🔴 判据不能只用「可写」：nvm 之类的 npm 前缀是**用户所有、可写的**，
 *    写进去不报错，但 `npm i -g agency-orchestrator@latest` 会把整个目录换掉，
 *    key 和自存的工作流一起消失 —— 不报错的数据丢失比 500 更难查。
 *    所以只要 ROOT 落在 node_modules 里，无论可不可写都不当数据目录。
 */
import { accessSync, constants, existsSync, mkdirSync, cpSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';

/** ROOT 是否是被安装出来的产物（全局或项目依赖），而非源码仓库。 */
export function isInstalledPackage(root) {
  return root.split(sep).includes('node_modules');
}

function writable(p) {
  try { accessSync(p, constants.W_OK); return true; } catch { return false; }
}

/**
 * 决定 Studio 往哪儿写（keys / 生成的工作流 / 运行产物 / scaffold）。
 * 优先级：AO_DATA_DIR（桌面端注入）> AO_HOME（引擎侧同名开关）> 可写的源码 ROOT > ~/.ao
 *
 * deps 只为测试注入（canWrite / home），生产不传。
 */
export function resolveDataDir(root, env = process.env, deps = {}) {
  const canWrite = deps.canWrite || writable;
  const home = deps.home || homedir();
  if (env.AO_DATA_DIR) return resolve(env.AO_DATA_DIR);
  if (env.AO_HOME) return resolve(env.AO_HOME);
  if (!isInstalledPackage(root) && canWrite(root)) return root;
  return join(home, '.ao');
}

/**
 * 一次性搬家:把**上一版真的写进了安装目录**的数据挪到新的 DATA_DIR。
 *
 * 只有一种人会命中:npm 前缀用户所有(nvm/自定义 prefix)、旧版把 key 和自存工作流
 * 写进了 node_modules。他们升级后如果什么都不做,会以为"我的 key 没了"——
 * 那是最容易被当成新 bug 的一类回归。
 *
 * 只搬小东西(.local 里的 key / 自定义供应商、ao-workflows 里的 YAML),
 * **不搬 ao-output**:历史产物可能几个 G,启动时静默拷贝几分钟是另一种事故。
 * 目标已存在就不覆盖(用户在新位置存过的东西永远优先)。
 */
export function migrateLegacyData(root, dataDir, deps = {}) {
  const fs = deps.fs || nodeFs();
  if (!root || !dataDir || root === dataDir) return [];
  if (!isInstalledPackage(root)) return [];   // 源码仓库不参与搬家
  const moved = [];
  for (const name of ['.local', 'ao-workflows']) {
    const from = join(root, name);
    const to = join(dataDir, name);
    try {
      if (!fs.existsSync(from) || fs.existsSync(to)) continue;
      fs.mkdirSync(dirname(to), { recursive: true });
      fs.cpSync(from, to, { recursive: true });
      moved.push(name);
    } catch { /* 搬不动就算了:旧位置的文件原样留着,不能因为搬家失败起不来 */ }
  }
  return moved;
}

function nodeFs() {
  // 延迟引入,保持上面的纯函数可以脱离 fs 单测
  // eslint-disable-next-line no-undef
  return { existsSync, mkdirSync, cpSync };
}
