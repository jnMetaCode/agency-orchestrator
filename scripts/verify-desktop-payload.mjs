#!/usr/bin/env node
// 校验桌面端产物——三件事，都吃过亏或会直接让安装包不可用：
//
//  1. **构建期依赖不该进安装包**。desktop 把整个 ../node_modules 原样拷进 app/node_modules，
//     于是 typescript（23MB）、@types（2.5MB）这类运行时一行都不 require 的东西，
//     跟着每个平台的安装包发给每一个用户。electron-builder 的 filter 摘掉了它们，
//     这里是防止哪天 filter 被改坏 / 新的纯构建期依赖又混进来。
//  2. **.bin 里不能有悬空软链**。摘包时若只删目录、不删 node_modules/.bin 下指向它的软链，
//     mac 打包会当场失败（真出过一次）。这条检查比"包小了多少"更要紧。
//  3. **main / preload 必须进 app.asar**。目录设置等 Electron 能力只经 preload 安全桥接；
//     漏打 preload 时网页仍能打开，但按钮全部静默失效，发布后才发现最难排查。
//
// 用法：
//   node scripts/verify-desktop-payload.mjs <electron-builder 产物根，如 desktop/release>
//
// 退出码 0 = 合格；1 = 有问题（CI 据此 fail）。

import { existsSync, readdirSync, lstatSync, statSync, readlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';

/** 运行时一行都不 require、只在构建期用的包：进了安装包就是纯浪费 */
const BUILD_ONLY = ['typescript', '@types', 'tsx', 'esbuild', '@esbuild'];

function fail(msg, hint) {
  console.error(`\n❌ 桌面端产物校验失败：${msg}`);
  if (hint) console.error(`   ${hint}`);
  process.exit(1);
}

/** 在产物根里递归找 .../resources/app/node_modules（mac 是 Contents/Resources，大小写不敏感） */
export function findPackedNodeModules(root) {
  const r = resolve(root);
  if (!existsSync(r)) fail(`产物目录不存在：${r}（electron-builder 没产出 unpacked 目录？）`);
  const hits = [];
  const stack = [r];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = join(cur, e.name);
      const norm = full.replace(/\\/g, '/').toLowerCase();
      if (norm.endsWith('resources/app/node_modules')) hits.push(full);
      else if (!norm.endsWith('/node_modules')) stack.push(full);   // 不往 node_modules 里面钻
    }
  }
  return hits;
}

/** 找 electron-builder 生成的 app.asar；入口文件漏打包时应用会直接白屏/启动失败。 */
export function findPackedAsars(root) {
  const hits = [];
  const stack = [resolve(root)];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = join(cur, e.name);
      if (e.isFile() && e.name === 'app.asar') hits.push(full);
      else if (e.isDirectory() && e.name !== 'node_modules') stack.push(full);
    }
  }
  return hits;
}

/** 返回目录里所有悬空的软链（相对目标按软链自身所在目录解析，别按 cwd） */
export function danglingLinks(dir) {
  if (!existsSync(dir)) return [];
  const bad = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let st;
    try { st = lstatSync(p); } catch { continue; }
    if (!st.isSymbolicLink()) continue;
    const target = resolve(dirname(p), readlinkSync(p));
    if (!existsSync(target)) bad.push(`${name} -> ${readlinkSync(p)}`);
  }
  return bad;
}

function dirSizeKB(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = join(cur, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { stack.push(full); continue; }
      try { total += statSync(full).size; } catch { /* 读不到就跳过 */ }
    }
  }
  return Math.round(total / 1024);
}

const root = process.argv[2];
if (!root) fail('用法: node scripts/verify-desktop-payload.mjs <产物根，如 desktop/release>');

const found = findPackedNodeModules(root);
if (found.length === 0) fail(`在 ${resolve(root)} 里没找到 resources/app/node_modules`, '桌面产物的 extraResources 没落地？');

for (const nm of found) {
  const shipped = BUILD_ONLY.filter((p) => existsSync(join(nm, p)));
  if (shipped.length) {
    fail(
      `安装包里带着纯构建期依赖：${shipped.join('、')}\n   位置：${nm}`,
      'desktop/package.json 的 build.extraResources 里那条 node_modules 的 filter 被改坏了？（连同 .bin 下对应的软链一起摘）',
    );
  }
  const bad = danglingLinks(join(nm, '.bin'));
  if (bad.length) {
    fail(
      `node_modules/.bin 里有悬空软链：${bad.join('、')}\n   位置：${nm}`,
      '摘包时只删了目录、没删指向它的软链——mac 打包会当场失败。把对应的 !.bin/<名字> 一起写进 filter。',
    );
  }
  console.log(`✅ 桌面端载荷合格：${nm}`);
  console.log(`   无构建期依赖（${BUILD_ONLY.join('、')}）✓  .bin 无悬空软链 ✓  约 ${(dirSizeKB(nm) / 1024).toFixed(1)} MB`);
}

const archives = findPackedAsars(root);
if (!archives.length) fail(`在 ${resolve(root)} 里没找到 app.asar`, 'electron-builder 没产出可运行应用？');
let asar;
try {
  const require = createRequire(import.meta.url);
  asar = require(resolve('desktop/node_modules/@electron/asar'));
} catch (err) {
  fail(`无法读取 app.asar：${err?.message || err}`, '先在 desktop/ 运行 npm ci');
}
for (const archive of archives) {
  const entries = new Set(asar.listPackage(archive));
  const missing = ['/main.cjs', '/preload.cjs'].filter((name) => !entries.has(name));
  if (missing.length) fail(`${archive} 缺少桌面入口：${missing.join('、')}`, 'desktop/package.json 的 build.files 是否漏了 preload.cjs？');
  console.log(`✅ 桌面入口完整：${archive}（main.cjs + preload.cjs）`);
}
