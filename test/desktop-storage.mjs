// Exercise actual desktop storage IPC handlers with real temporary files and fake native dialogs.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';

const source = fs.readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('function desktopSettingsFile()'), source.indexOf('\nconst base ='));
const start = source.indexOf('    const trusted = (event)');
const end = source.indexOf('    Menu.setApplicationMenu(null);', start);
assert(start > 0 && end > start && helpers.includes('ensureWritableDirectory'));
const root = fs.mkdtempSync(path.join(tmpdir(), 'ao-desktop-storage-'));
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('  ✓ ' + name); }
function fixture(name, env = {}) {
  const userData = path.join(root, name);
  const handlers = {}, queued = [], calls = [];
  const state = { picked: { canceled: true, filePaths: [] }, confirm: 1, denied: '' };
  const localFs = { ...fs, accessSync(dir, mode) {
    if (dir === state.denied) throw Object.assign(new Error('test permission denied'), { code: 'EACCES' });
    return fs.accessSync(dir, mode);
  } };
  const event = { senderFrame: { url: 'http://127.0.0.1:8799/studio' } };
  const context = {
    fs: localFs, path, process: { env, pid: process.pid },
    app: { getPath: () => userData },
    ipcMain: { handle: (channel, fn) => { handlers[channel] = fn; } },
    base: () => 'http://127.0.0.1:8799/', mainWindow: { isDestroyed: () => false },
    dialog: {
      showOpenDialog: async () => state.picked,
      showMessageBox: async (_window, options) => { calls.push(options); return { response: state.confirm }; },
    },
    shell: { openPath: async dir => { calls.push(dir); return ''; } },
    stopBackend: () => calls.push('stop'), boot: () => calls.push('boot'),
    setTimeout: fn => { queued.push(fn); },
  };
  runInNewContext(helpers + '\n' + source.slice(start, end), context);
  return { userData, state, calls, queued,
    invoke: (name, lang = 'zh', request = event) => handlers['ao-desktop:' + name](request, lang),
    settings: () => fs.readFileSync(path.join(userData, 'desktop-settings.json'), 'utf8'),
  };
}
try {
  await test('cancel directory picker or confirmation leaves settings and engine untouched', async () => {
    const f = fixture('cancel');
    assert.equal((await f.invoke('choose-data-dir')).canceled, true);
    f.state.picked = { canceled: false, filePaths: [path.join(root, 'cancel-target')] };
    assert.equal((await f.invoke('choose-data-dir')).canceled, true);
    assert.equal(fs.existsSync(path.join(f.userData, 'desktop-settings.json')), false);
    assert.equal(f.queued.length, 0);
  });
  await test('switch persists outside business directory, restarts after reply, preserves old data', async () => {
    const f = fixture('switch'), target = path.join(root, 'custom');
    fs.mkdirSync(f.userData); fs.writeFileSync(path.join(f.userData, 'old-data'), 'preserve');
    f.state.picked = { canceled: false, filePaths: [target] }; f.state.confirm = 0;
    const result = await f.invoke('choose-data-dir');
    assert.equal(result.ok, true); assert.equal(result.status.activeDir, target);
    assert.equal(JSON.parse(f.settings()).dataDir, target);
    assert.match(f.calls[0].detail, /role-libraries/);
    assert.equal(f.calls.includes('stop'), false);
    f.queued.shift()(); assert.deepEqual(f.calls.slice(-2), ['stop', 'boot']);
    assert.equal(fs.readFileSync(path.join(f.userData, 'old-data'), 'utf8'), 'preserve');
    assert.equal(fixture('switch').invoke('storage-status').activeDir, target);
    assert.equal(fs.existsSync(path.join(target, 'desktop-settings.json')), false);
  });
  await test('restore default saves selection and preserves custom files', async () => {
    const f = fixture('switch'), target = f.invoke('storage-status').activeDir;
    fs.writeFileSync(path.join(target, 'keep-me'), 'keep'); f.state.confirm = 0;
    const result = await f.invoke('reset-data-dir', 'en');
    assert.equal(result.ok, true); assert.equal(result.status.activeDir, f.userData);
    assert.equal(JSON.parse(f.settings()).dataDir, undefined);
    assert.equal(fs.readFileSync(path.join(target, 'keep-me'), 'utf8'), 'keep');
    assert.equal(f.queued.length, 1);
    assert.equal(fixture('switch').invoke('storage-status').source, 'default');
  });
  await test('permission failure or non-directory selection cannot change current configuration', async () => {
    const f = fixture('failure'), denied = path.join(root, 'denied');
    f.state.denied = denied; f.state.confirm = 0;
    f.state.picked = { canceled: false, filePaths: [denied] };
    assert.match((await f.invoke('choose-data-dir')).error, /目录不可写/);
    const file = path.join(root, 'not-a-directory'); fs.writeFileSync(file, 'file');
    f.state.picked.filePaths = [file];
    assert.equal((await f.invoke('choose-data-dir')).ok, false);
    assert.equal(f.invoke('storage-status').source, 'default');
    assert.equal(f.queued.length, 0); assert.equal(f.calls.length, 0);
  });
  await test('environment override disables switch and reset; untrusted renderer cannot invoke IPC', async () => {
    const override = path.join(root, 'environment'), f = fixture('env', { AO_DATA_DIR: override });
    assert.equal(f.invoke('storage-status').canChange, false);
    assert.equal((await f.invoke('choose-data-dir')).ok, false);
    assert.equal((await f.invoke('reset-data-dir')).ok, false);
    assert.equal(f.invoke('storage-status').activeDir, override);
    assert.equal(f.queued.length, 0);
    await assert.rejects(f.invoke('choose-data-dir', 'zh', { senderFrame: { url: 'https://example.com/' } }), /untrusted/);
  });
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log(`Desktop storage: ${passed} scenarios passed`);
