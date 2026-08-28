/**
 * Studio 数据目录解析 + 旧数据迁移（issue #99）
 *
 * 起因是一个真实报错:全局安装后在 Studio 里粘贴 API key → 500
 * `EACCES: permission denied, mkdir '/opt/homebrew/lib/node_modules/agency-orchestrator/.local'`。
 * 根因是 DATA_DIR 直接等于包的安装目录。
 *
 * 🔴 这里必须钉死三件事,少一件就会以另一种方式复发:
 *   ① 只读的全局安装 → ~/.ao(原始 bug)
 *   ② **可写**的全局安装(nvm 前缀)也要走 ~/.ao —— 否则不报错,但下次
 *      `npm i -g` 会把 key 和自存工作流一起换掉,变成静默的数据丢失
 *   ③ 源码仓库直跑保持写仓库根 —— 开发者的 ao-output 不该忽然搬家
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveDataDir, isInstalledPackage, migrateLegacyData } from '../web/data-dir.js';

let passed = 0, failed = 0;
function assert(c: boolean, m: string): void { if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; } }

console.log('\n─── Studio 数据目录 (#99) ───');

const HOME = '/Users/someone';
const GLOBAL = '/opt/homebrew/lib/node_modules/agency-orchestrator';
const NVM = '/Users/someone/.nvm/versions/node/v22.0.0/lib/node_modules/agency-orchestrator';
const LOCALDEP = '/Users/someone/proj/node_modules/agency-orchestrator';
const REPO = '/Users/someone/dev/agency-orchestrator';
const rw = { canWrite: () => true, home: HOME };
const ro = { canWrite: () => false, home: HOME };

// ── ① 只读的全局安装:原始 bug ──
assert(resolveDataDir(GLOBAL, {}, ro) === join(HOME, '.ao'), '只读的全局安装 → ~/.ao(原始 500 的场景)');

// ── ② 可写的全局安装也不能写进 node_modules ──
assert(resolveDataDir(NVM, {}, rw) === join(HOME, '.ao'), 'nvm 前缀可写,仍然 → ~/.ao(否则升级会静默清空)');
assert(resolveDataDir(LOCALDEP, {}, rw) === join(HOME, '.ao'), '项目内依赖(npx)同样 → ~/.ao');
assert(isInstalledPackage(GLOBAL) && isInstalledPackage(LOCALDEP), 'node_modules 里的路径都算「装出来的」');
assert(!isInstalledPackage(REPO), '源码仓库不算「装出来的」');

// ── ③ 源码仓库保持旧行为 ──
assert(resolveDataDir(REPO, {}, rw) === REPO, '源码仓库直跑 → 仓库根(旧行为不变)');
assert(resolveDataDir(REPO, {}, ro) === join(HOME, '.ao'), '仓库根不可写 → 也回落 ~/.ao');

// ── env 优先级:桌面端注入的 AO_DATA_DIR 必须最高 ──
assert(resolveDataDir(GLOBAL, { AO_DATA_DIR: '/tmp/electron-userdata' }, ro) === '/tmp/electron-userdata', 'AO_DATA_DIR 优先(桌面端)');
assert(resolveDataDir(GLOBAL, { AO_HOME: '/tmp/aohome' }, ro) === '/tmp/aohome', 'AO_HOME 次之(与引擎侧同名开关一致)');
assert(resolveDataDir(GLOBAL, { AO_DATA_DIR: '/tmp/a', AO_HOME: '/tmp/b' }, ro) === '/tmp/a', 'AO_DATA_DIR 压过 AO_HOME');

// ── 迁移:旧版真的写进了安装目录的人,升级后不该觉得"key 没了" ──
{
  const tmp = mkdtempSync(join(tmpdir(), 'ao-migrate-'));
  const oldRoot = join(tmp, 'node_modules', 'agency-orchestrator');
  const newDir = join(tmp, 'home', '.ao');
  mkdirSync(join(oldRoot, '.local'), { recursive: true });
  mkdirSync(join(oldRoot, 'ao-workflows'), { recursive: true });
  mkdirSync(join(oldRoot, 'ao-output', 'run-1'), { recursive: true });
  writeFileSync(join(oldRoot, '.local', 'web-keys.json'), '{"openai":{"apiKey":"sk-old"}}');
  writeFileSync(join(oldRoot, 'ao-workflows', 'legacy.yaml'), 'name: old\n');
  writeFileSync(join(oldRoot, 'ao-output', 'run-1', 'summary.md'), '# 几个 G 的历史产物\n');

  const moved = migrateLegacyData(oldRoot, newDir);
  assert(moved.includes('.local') && moved.includes('ao-workflows'), '迁移搬走 .local 与 ao-workflows');
  assert(readFileSync(join(newDir, '.local', 'web-keys.json'), 'utf-8').includes('sk-old'), 'key 内容原样到达新位置');
  assert(!existsSync(join(newDir, 'ao-output')), 'ao-output 不搬(可能几个 G,启动时静默拷贝是另一种事故)');
  assert(existsSync(join(oldRoot, '.local', 'web-keys.json')), '旧位置保留原件(搬家不是搬空)');

  // 已经在新位置有东西时不能覆盖
  const again = migrateLegacyData(oldRoot, newDir);
  assert(again.length === 0, '再跑一次不重复迁移(目标已存在就不动)');

  // 源码仓库不参与迁移
  const repoRoot = join(tmp, 'dev', 'agency-orchestrator');
  mkdirSync(join(repoRoot, '.local'), { recursive: true });
  writeFileSync(join(repoRoot, '.local', 'web-keys.json'), '{}');
  assert(migrateLegacyData(repoRoot, join(tmp, 'home2', '.ao')).length === 0, '源码仓库不触发迁移');
  assert(migrateLegacyData(oldRoot, oldRoot).length === 0, '源与目标相同时不迁移');

  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
