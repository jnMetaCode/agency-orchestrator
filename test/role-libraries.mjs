// Offline installation: real tar extraction and filesystem, no package registry requests.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { create } from 'tar';
import { installOptionalRoleLibrary, findOptionalRoleLibrary, roleLibraryRoot } from '../web/role-libraries.js';

const root = mkdtempSync(join(tmpdir(), 'ao-role-install-'));
const pkg = 'agency-agents-ko';
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('  ✓ ' + name); }
async function fixture(name, count = 100) {
  const work = join(root, name), files = join(work, 'package'); mkdirSync(files, { recursive: true });
  writeFileSync(join(files, 'package.json'), JSON.stringify({ name: pkg, version: '1.0.0' }));
  mkdirSync(join(files, 'engineering'));
  for (let n = 0; n < count; n++) writeFileSync(join(files, 'engineering', `role-${n}.md`), '# Test role');
  const archivePath = join(work, 'roles.tgz');
  await create({ gzip: true, cwd: work, file: archivePath }, ['package']);
  const archive = readFileSync(archivePath), dataDir = join(work, 'data');
  const meta = { name: pkg, dist: { tarball: `https://registry.npmjs.org/${pkg}/-/roles.tgz`,
    integrity: 'sha512-' + createHash('sha512').update(archive).digest('base64') } };
  const requested = [];
  const fetchImpl = async url => {
    requested.push(url);
    return new Response(url.endsWith('/latest') ? JSON.stringify(meta) : archive);
  };
  return { dataDir, meta, archive, fetchImpl, requested };
}
const noStaging = dataDir => assert.deepEqual(readdirSync(roleLibraryRoot(dataDir)).filter(n => n.startsWith('.')), []);
try {
  await test('install persists across engine/root changes; repeat install performs no download', async () => {
    const f = await fixture('persist');
    const result = await installOptionalRoleLibrary('ko', f);
    assert.equal(result.roles, 100); assert.equal(result.installed, true);
    assert.equal(findOptionalRoleLibrary(join(root, 'new-app-version'), f.dataDir, 'ko'), result.dir);
    assert.equal((await installOptionalRoleLibrary('ko', { dataDir: f.dataDir, fetchImpl: () => { throw Error('must not download'); } })).alreadyInstalled, true);
    assert.equal(f.requested.length, 2); noStaging(f.dataDir);
  });
  await test('offline failure leaves no installation or staging; retry can succeed', async () => {
    const f = await fixture('offline');
    await assert.rejects(installOptionalRoleLibrary('ko', { dataDir: f.dataDir, fetchImpl: async () => { throw Error('fetch failed'); } }), /fetch failed/);
    assert.equal(findOptionalRoleLibrary(root, f.dataDir, 'ko'), ''); noStaging(f.dataDir);
    assert.equal((await installOptionalRoleLibrary('ko', f)).installed, true);
  });
  await test('corrupt archive integrity cannot produce a visible library', async () => {
    const f = await fixture('integrity'); f.meta.dist.integrity = 'sha512-invalid';
    await assert.rejects(installOptionalRoleLibrary('ko', f), /完整性/);
    assert.equal(findOptionalRoleLibrary(root, f.dataDir, 'ko'), ''); noStaging(f.dataDir);
  });
  await test('incomplete package is removed after extraction', async () => {
    const f = await fixture('incomplete', 2);
    await assert.rejects(installOptionalRoleLibrary('ko', f), /内容不完整/);
    assert.equal(existsSync(join(roleLibraryRoot(f.dataDir), pkg)), false); noStaging(f.dataDir);
  });
  await test('unapproved language cannot invoke the downloader', async () => {
    await assert.rejects(installOptionalRoleLibrary('../arbitrary', { dataDir: root, fetchImpl: () => { throw Error('must not fetch'); } }), /不支持/);
  });
} finally { rmSync(root, { recursive: true, force: true }); }
console.log(`Role libraries: ${passed} scenarios passed`);
