#!/usr/bin/env node
/** Stage per-platform assets, then verify all current-run assets before any Release write. */
import { createHash } from 'node:crypto';
import { createReadStream, readdirSync, lstatSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const PLATFORMS = ['mac', 'win', 'linux'];
const META = 'build-provenance.json';
const extensions = { mac: /\.dmg(?:\.blockmap)?$/, win: /\.exe(?:\.blockmap)?$/, linux: /\.AppImage$/ };
function requireValue(ok, message) { if (!ok) throw new Error(message); }
async function digest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
function regular(path) { requireValue(lstatSync(path).isFile(), `Not a regular file: ${path}`); }
function identity(expected) {
  requireValue(typeof expected.version === 'string' && /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(expected.version)
    && expected.tag === `desktop-v${expected.version}`, 'Tag does not match desktop version');
  requireValue(/^[0-9a-f]{40}$/.test(expected.sha) && /^\d+$/.test(expected.runId), 'Missing build SHA or workflow run ID');
}
function assetNames(names, platform, version) {
  requireValue(PLATFORMS.includes(platform), 'Unknown platform');
  const versionPattern = new RegExp(`(^|[^0-9])${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:-arm64|-x64)?\\.(?:dmg|exe|AppImage)(?:\\.blockmap)?$`);
  requireValue(names.length > 0 && new Set(names).size === names.length, `Missing or duplicate ${platform} assets`);
  for (const name of names) requireValue(name === basename(name) && !/[\\\r\n]/.test(name)
    && extensions[platform].test(name) && versionPattern.test(name), `Invalid ${platform} asset: ${name}`);
  const installers = names.filter(name => !name.endsWith('.blockmap'));
  if (platform === 'mac') {
    requireValue(installers.some(name => /-arm64\.dmg$/.test(name))
      && installers.some(name => !/-(?:arm64|universal)\.dmg$/.test(name)), 'Missing mac arm64 or x64 installer');
  } else requireValue(installers.length > 0, `Missing ${platform} installer`);
}
function checksums(files) { return files.map(file => `${file.sha256}  ${file.name}\n`).join(''); }

export async function stageRelease(source, output, platform, expected) {
  identity(expected);
  requireValue(PLATFORMS.includes(platform), 'Unknown platform');
  const names = readdirSync(source).filter(name => extensions[platform].test(name)).sort();
  assetNames(names, platform, expected.version);
  const files = [];
  for (const name of names) {
    const path = join(source, name);
    regular(path);
    const size = lstatSync(path).size;
    requireValue(size > 0, `Empty installer: ${name}`);
    files.push({ name, size, sha256: await digest(path) });
  }
  mkdirSync(output); // Refuse stale staging directories rather than mix runs.
  for (const file of files) copyFileSync(join(source, file.name), join(output, file.name));
  writeFileSync(join(output, META), JSON.stringify({ ...expected, platform, files }, null, 2) + '\n');
  writeFileSync(join(output, `SHA256SUMS-${platform}.txt`), checksums(files));
}

export async function verifyRelease(root, output, expected) {
  identity(expected);
  const validated = [];
  const usedNames = new Set();
  for (const platform of PLATFORMS) {
    const dir = join(root, `desktop-${platform}`);
    requireValue(lstatSync(dir).isDirectory() && !lstatSync(dir).isSymbolicLink(), `Missing ${platform} artifact directory`);
    regular(join(dir, META));
    const meta = JSON.parse(readFileSync(join(dir, META), 'utf-8'));
    for (const key of ['tag', 'version', 'sha', 'runId']) requireValue(meta[key] === expected[key], `${platform}: mismatched ${key}`);
    requireValue(meta.platform === platform && Array.isArray(meta.files), `${platform}: invalid provenance`);
    assetNames(meta.files.map(file => file.name), platform, expected.version);
    const checksumName = `SHA256SUMS-${platform}.txt`;
    const allowed = new Set([META, checksumName, ...meta.files.map(file => file.name)]);
    requireValue(readdirSync(dir).every(name => allowed.has(name)), `${platform}: unexpected artifact file`);
    for (const file of meta.files) {
      const path = join(dir, file.name);
      regular(path);
      requireValue(file.size > 0 && lstatSync(path).size === file.size && await digest(path) === file.sha256, `${platform}: corrupted asset ${file.name}`);
      requireValue(!usedNames.has(file.name), `Duplicate release asset: ${file.name}`);
      usedNames.add(file.name);
      validated.push({ source: path, name: file.name });
    }
    regular(join(dir, checksumName));
    requireValue(readFileSync(join(dir, checksumName), 'utf-8') === checksums(meta.files), `${platform}: checksum manifest mismatch`);
    validated.push({ source: join(dir, checksumName), name: checksumName });
  }
  // Publish only a fresh directory, populated after every platform has passed.
  mkdirSync(output);
  for (const file of validated) copyFileSync(file.source, join(output, file.name));
  return validated.map(file => file.name);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const version = JSON.parse(readFileSync('desktop/package.json', 'utf-8')).version;
    const expected = { version, tag: process.env.RELEASE_TAG, runId: process.env.GITHUB_RUN_ID,
      sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim() };
    const [mode, source, output, platform] = process.argv.slice(2);
    if (mode === 'stage') await stageRelease(source, output, platform, expected);
    else if (mode === 'verify') console.log('Verified release assets:', await verifyRelease(source, output, expected));
    else throw new Error('Usage: verify-desktop-release.mjs stage|verify source output [platform]');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
