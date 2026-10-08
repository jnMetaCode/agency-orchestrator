import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { finished } from 'node:stream/promises';
import { join, resolve } from 'node:path';
import { extract } from 'tar';

export const OPTIONAL_ROLE_LIBRARIES = [
  { id: 'pt-br', pkg: 'agency-agents-pt-br', label: 'Português (BR)' },
  { id: 'ko', pkg: 'agency-agents-ko', label: '한국어' },
  { id: 'ar', pkg: 'agency-agents-ar', label: 'العربية' },
  { id: 'id', pkg: 'agency-agents-id', label: 'Bahasa Indonesia' },
  { id: 'ru', pkg: 'agency-agents-ru', label: 'Русский' },
];

const MAX_ARCHIVE_BYTES = 15 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 50 * 1024 * 1024;

export function roleLibraryRoot(dataDir) {
  return join(resolve(dataDir), 'role-libraries');
}

export function optionalRoleLibrary(id) {
  return OPTIONAL_ROLE_LIBRARIES.find((lib) => lib.id === id) || null;
}

/** 用户按需安装目录优先；npm 用户手工安装在 node_modules 的包仍兼容。 */
export function findOptionalRoleLibrary(root, dataDir, id) {
  const lib = optionalRoleLibrary(id);
  if (!lib) return '';
  const managed = join(roleLibraryRoot(dataDir), lib.pkg);
  if (existsSync(managed)) return managed;
  const npmInstalled = join(resolve(root), 'node_modules', lib.pkg);
  return existsSync(npmInstalled) ? npmInstalled : '';
}

async function fetchBuffer(url, { fetchImpl, signal, limit, label }) {
  const response = await fetchImpl(url, { signal, headers: { accept: 'application/json, application/octet-stream' } });
  if (!response.ok) throw new Error(`${label}下载失败：HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > limit) throw new Error(`${label}超过大小限制`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > limit) throw new Error(`${label}超过大小限制`);
  return bytes;
}

function countMarkdownFiles(dir) {
  let count = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const entry of readdirSync(cur, { withFileTypes: true })) {
      const full = join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md' && entry.name !== 'CATALOG.md') count++;
    }
  }
  return count;
}

/**
 * 从 npm 官方仓库下载固定白名单中的角色库。
 * - 包名不接受前端输入，只由 OPTIONAL_ROLE_LIBRARIES 映射；
 * - tarball 只接受 registry.npmjs.org HTTPS 地址并校验 npm 的 sha512 integrity；
 * - 拒绝链接、越界路径与异常膨胀，先解到临时目录，完整校验后再原子改名。
 */
export async function installOptionalRoleLibrary(id, options) {
  const lib = optionalRoleLibrary(id);
  if (!lib) throw new Error('不支持的角色库');
  const fetchImpl = options?.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('当前运行环境不支持下载');
  const target = join(roleLibraryRoot(options.dataDir), lib.pkg);
  if (existsSync(target)) return { id: lib.id, pkg: lib.pkg, dir: target, installed: true, alreadyInstalled: true };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 45_000);
  const parent = roleLibraryRoot(options.dataDir);
  const staging = join(parent, `.${lib.pkg}.install-${process.pid}-${Date.now()}`);
  try {
    mkdirSync(parent, { recursive: true });
    const metaBytes = await fetchBuffer(
      `https://registry.npmjs.org/${encodeURIComponent(lib.pkg)}/latest`,
      { fetchImpl, signal: controller.signal, limit: 1024 * 1024, label: '角色库元数据' },
    );
    let meta;
    try { meta = JSON.parse(metaBytes.toString('utf8')); }
    catch { throw new Error('角色库元数据不是有效 JSON'); }
    if (meta?.name !== lib.pkg || typeof meta?.dist?.tarball !== 'string') throw new Error('角色库元数据不匹配');
    const tarballUrl = new URL(meta.dist.tarball);
    if (tarballUrl.protocol !== 'https:' || tarballUrl.hostname !== 'registry.npmjs.org') throw new Error('角色库下载地址不可信');
    const integrity = String(meta.dist.integrity || '');
    if (!integrity.startsWith('sha512-')) throw new Error('角色库缺少 SHA-512 完整性信息');

    const archive = await fetchBuffer(tarballUrl.href, {
      fetchImpl, signal: controller.signal, limit: MAX_ARCHIVE_BYTES, label: '角色库',
    });
    const actual = createHash('sha512').update(archive).digest('base64');
    if (actual !== integrity.slice('sha512-'.length)) throw new Error('角色库完整性校验失败');

    mkdirSync(staging, { recursive: true });
    let extractedBytes = 0;
    const unpack = extract({
      cwd: staging,
      strip: 1,
      strict: true,
      preservePaths: false,
      noChmod: true,
      filter(entryPath, entry) {
        const normalized = String(entryPath).replaceAll('\\', '/');
        if (!normalized.startsWith('package/')) return false;
        const relative = normalized.slice('package/'.length);
        if (!relative || relative.startsWith('/') || relative.split('/').includes('..')) return false;
        if (relative === 'node_modules' || relative.startsWith('node_modules/')) return false;
        if (entry.type === 'SymbolicLink' || entry.type === 'Link') return false;
        extractedBytes += Number(entry.size || 0);
        if (extractedBytes > MAX_EXTRACTED_BYTES) throw new Error('角色库解包后超过大小限制');
        return true;
      },
    });
    unpack.end(archive);
    await finished(unpack);

    const manifest = JSON.parse(readFileSync(join(staging, 'package.json'), 'utf8'));
    if (manifest?.name !== lib.pkg) throw new Error('解包后的角色库名称不匹配');
    const roles = countMarkdownFiles(staging);
    if (roles < 100) throw new Error(`角色库内容不完整（只找到 ${roles} 个角色）`);
    if (existsSync(target)) rmSync(staging, { recursive: true, force: true });
    else renameSync(staging, target);
    return { id: lib.id, pkg: lib.pkg, version: String(manifest.version || ''), dir: target, roles, installed: true };
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    if (error?.name === 'AbortError') throw new Error('角色库下载超时');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

