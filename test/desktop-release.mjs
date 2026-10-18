/** Offline tests: release gates never contact GitHub or build/sign real installers. */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { stageRelease, verifyRelease } from '../scripts/verify-desktop-release.mjs';

const root = mkdtempSync(join(tmpdir(), 'ao-release-gate-'));
const expected = { tag: 'desktop-v0.4.12', version: '0.4.12', sha: 'a'.repeat(40), runId: '1234' };
const names = {
  mac: ['Agency Orchestrator-0.4.12-arm64.dmg', 'Agency Orchestrator-0.4.12.dmg'],
  win: ['Agency Orchestrator Setup 0.4.12.exe', 'Agency Orchestrator Setup 0.4.12.exe.blockmap'],
  linux: ['Agency Orchestrator-0.4.12.AppImage'],
};
let passed = 0;
let serial = 0;
async function test(name, fn) { await fn(); console.log(`  ✓ ${name}`); passed++; }
async function fixture() {
  const dir = join(root, String(serial++));
  mkdirSync(dir);
  const artifacts = join(dir, 'artifacts');
  mkdirSync(artifacts);
  for (const platform of Object.keys(names)) {
    const source = join(dir, platform);
    mkdirSync(source);
    for (const name of names[platform]) writeFileSync(join(source, name), `fake-installer-${name}`);
    await stageRelease(source, join(artifacts, `desktop-${platform}`), platform, expected);
  }
  return { dir, artifacts, output: join(dir, 'verified') };
}
function metaPath(f, platform) { return join(f.artifacts, `desktop-${platform}`, 'build-provenance.json'); }
function editMeta(f, platform, change) {
  const path = metaPath(f, platform);
  const value = JSON.parse(readFileSync(path, 'utf-8'));
  change(value);
  writeFileSync(path, JSON.stringify(value));
}
async function rejectsBeforeOutput(f, pattern) {
  await assert.rejects(verifyRelease(f.artifacts, f.output, expected), pattern);
  assert(!existsSync(f.output), 'invalid inputs must not create a publish directory');
}
try {
  await test('all platforms validate and only installers/blockmaps/checksums enter publication', async () => {
    const f = await fixture();
    const result = await verifyRelease(f.artifacts, f.output, expected);
    assert.equal(result.length, 8);
    assert.deepEqual(readdirSync(f.output).sort(), result.sort());
    assert(!existsSync(join(f.output, 'build-provenance.json')));
    await assert.rejects(verifyRelease(f.artifacts, f.output, expected), /EEXIST/);
  });
  for (const platform of Object.keys(names)) await test(`missing ${platform} blocks publication`, async () => {
    const f = await fixture();
    rmSync(join(f.artifacts, `desktop-${platform}`), { recursive: true });
    await rejectsBeforeOutput(f, /ENOENT/);
  });
  for (const key of ['tag', 'version', 'sha', 'runId', 'platform']) await test(`mismatched ${key} blocks mixed builds`, async () => {
    const f = await fixture();
    editMeta(f, 'win', meta => { meta[key] = 'wrong'; });
    await rejectsBeforeOutput(f, /mismatched|invalid provenance/);
  });
  await test('same-size tampering is detected by hash', async () => {
    const f = await fixture();
    const path = join(f.artifacts, 'desktop-win', names.win[0]);
    writeFileSync(path, 'x'.repeat(readFileSync(path).length));
    await rejectsBeforeOutput(f, /corrupted/);
  });
  await test('checksum manifest corruption blocks publication', async () => {
    const f = await fixture();
    writeFileSync(join(f.artifacts, 'desktop-mac', 'SHA256SUMS-mac.txt'), 'incorrect');
    await rejectsBeforeOutput(f, /checksum manifest/);
  });
  await test('unexpected artifact file cannot be published', async () => {
    const f = await fixture();
    writeFileSync(join(f.artifacts, 'desktop-win', 'notes.txt'), 'unrelated');
    await rejectsBeforeOutput(f, /unexpected/);
  });
  await test('traversal and duplicate entries in metadata are rejected', async () => {
    for (const name of ['../outside-0.4.12.exe', names.win[0]]) {
      const f = await fixture();
      editMeta(f, 'win', meta => { meta.files[1].name = name; });
      await rejectsBeforeOutput(f, /Invalid|duplicate/);
    }
  });
  for (const variant of ['missing-x64', 'missing-arm64', 'empty', 'wrong-version', 'prerelease-as-stable']) await test(`staging rejects ${variant}`, async () => {
    const f = await fixture();
    const source = join(f.dir, 'mac');
    if (variant === 'missing-x64') rmSync(join(source, names.mac[1]));
    if (variant === 'missing-arm64') rmSync(join(source, names.mac[0]));
    if (variant === 'empty') writeFileSync(join(source, names.mac[0]), '');
    if (variant === 'wrong-version' || variant === 'prerelease-as-stable') {
      rmSync(join(source, names.mac[0]));
      writeFileSync(join(source, variant === 'wrong-version' ? 'Old-0.4.123-arm64.dmg' : 'Old-0.4.12-beta.1-arm64.dmg'), 'old');
    }
    const output = join(f.dir, 'new-stage');
    await assert.rejects(stageRelease(source, output, 'mac', expected), /Missing|Empty|Invalid/);
    assert(!existsSync(output));
  });
  await test('tag/version mismatch fails before creating staging', async () => {
    const f = await fixture();
    await assert.rejects(stageRelease(join(f.dir, 'mac'), join(f.dir, 'bad'), 'mac', { ...expected, tag: 'desktop-v0.4.11' }), /Tag/);
  });
  if (process.platform !== 'win32') await test('symlink installers cannot bypass file validation', async () => {
    const f = await fixture();
    const path = join(f.artifacts, 'desktop-win', names.win[0]);
    rmSync(path);
    symlinkSync(join(f.dir, 'win', names.win[0]), path);
    await rejectsBeforeOutput(f, /regular file/);
  });
  await test('workflow publishes only after matrix success and verification; failure cannot overwrite existing releases', async () => {
    const workflow = load(readFileSync('.github/workflows/release-desktop.yml', 'utf-8'));
    assert.equal(workflow.permissions.contents, 'read');
    assert.equal(workflow.jobs.publish.needs, 'build');
    assert.equal(workflow.jobs.publish.if, undefined, 'default success gate must not be bypassed');
    for (const job of Object.values(workflow.jobs)) {
      const checkout = job.steps.find(step => step.uses === 'actions/checkout@v4');
      assert.equal(checkout.with.ref, 'refs/tags/${{ inputs.tag || github.ref_name }}');
    }
    assert(!workflow.jobs.build.steps.some(step => step.uses?.includes('action-gh-release')));
    const steps = workflow.jobs.publish.steps;
    const verify = steps.findIndex(step => step.run?.includes('verify-desktop-release.mjs verify'));
    const existing = steps.findIndex(step => step.uses === 'actions/github-script@v7');
    const upload = steps.findIndex(step => step.uses === 'softprops/action-gh-release@v2');
    const publish = steps.findIndex(step => step.run?.includes('gh release edit'));
    assert(verify >= 0 && existing > verify && upload > existing && publish > upload);
    assert.equal(steps[upload].with.draft, true);
    assert.equal(steps[upload].with.make_latest, 'false');
    assert.equal(steps[upload].with.fail_on_unmatched_files, true);
    assert.equal(workflow.concurrency['cancel-in-progress'], false);
  });
  for (const status of [404, 503, 'existing']) await test(`release preflight handles ${status} without overwriting`, async () => {
    const workflow = load(readFileSync('.github/workflows/release-desktop.yml', 'utf-8'));
    const script = workflow.jobs.publish.steps.find(step => step.uses === 'actions/github-script@v7').with.script;
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const check = new AsyncFunction('github', 'context', 'process', script);
    let calls = 0;
    const github = { rest: { repos: { getReleaseByTag: async input => {
      calls++;
      assert.equal(input.tag, expected.tag);
      if (status !== 'existing') throw Object.assign(new Error('API error'), { status });
      return { data: { draft: true } };
    } } } };
    const execute = () => check(github, { repo: { owner: 'test', repo: 'test' } }, { env: { RELEASE_TAG: expected.tag } });
    if (status === 404) await execute();
    else await assert.rejects(execute(), status === 503 ? /API error/ : /already exists/);
    assert.equal(calls, 1);
  });
} finally { rmSync(root, { recursive: true, force: true }); }
console.log(`Desktop release gate: ${passed} scenarios passed`);
