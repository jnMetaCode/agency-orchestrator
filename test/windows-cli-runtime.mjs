// Run on real Windows with desktop Electron installed; no provider or credentials.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'win32') {
  console.log('Windows runtime integration: skipped on ' + process.platform);
} else {
  const electron = createRequire(new URL('../desktop/package.json', import.meta.url))('electron');
  const root = mkdtempSync(join(tmpdir(), 'ao-windows-runtime-'));
  const args = ['中文 "quoted" & <literal>', 'line1\nline2', ''];
  try {
    writeFileSync(join(root, 'dsh.cmd'), '@echo off\r\n"%dp0%\\entry.mjs" %*\r\n');
    writeFileSync(join(root, 'entry.mjs'), `
      if (import.meta.main) console.log(JSON.stringify({
        file: process.execPath, version: process.versions.node,
        electronMode: process.env.ELECTRON_RUN_AS_NODE ?? null, args: process.argv.slice(2)
      }));
    `);
    const worker = join(root, 'worker.mjs');
    const moduleURL = new URL('../dist/connectors/spawn-cli.js', import.meta.url).href;
    writeFileSync(worker, `
      import { spawnCLI } from ${JSON.stringify(moduleURL)};
      try {
        const child = spawnCLI('dsh', ${JSON.stringify(args)}, {
          env: process.env, stdio: ['ignore', 'pipe', 'pipe']
        });
        child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
        child.on('error', error => { console.error(error.message); process.exitCode = 43; });
        child.on('close', code => { process.exitCode = code ?? 44; });
      } catch (error) { console.error(error.message); process.exitCode = 42; }
    `);
    const base = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      /^(systemroot|windir|temp|tmp|userprofile|home)$/i.test(key)));
    function run(path, override) {
      const env = { ...base, PATH: path, PATHEXT: '.EXE;.CMD', ELECTRON_RUN_AS_NODE: '1' };
      if (override) env.AO_CLI_NODE_PATH = override;
      const result = spawnSync(electron, [worker], { env, encoding: 'utf8', timeout: 20000, windowsHide: true });
      assert.ifError(result.error);
      return result;
    }
    for (const result of [run(root + ';' + dirname(process.execPath)), run(root, process.execPath)]) {
      assert.equal(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout.trim());
      assert.equal(output.file.toLowerCase(), process.execPath.toLowerCase());
      assert.equal(output.electronMode, null);
      assert.deepEqual(output.args, args);
    }
    const missing = run(root);
    assert.equal(missing.status, 42, missing.stderr);
    assert.match(missing.stderr, /尚未启动 dsh/);
    assert.equal(missing.stdout, '');
    const invalid = run(root, join(root, 'missing-node.exe'));
    assert.equal(invalid.status, 42, invalid.stderr);
    assert.match(invalid.stderr, /AO_CLI_NODE_PATH/);
    assert.equal(invalid.stdout, '');
    console.log('Windows + real Electron: PATH fallback, explicit Node, missing Node and invalid override passed');
  } finally { rmSync(root, { recursive: true, force: true }); }
}
