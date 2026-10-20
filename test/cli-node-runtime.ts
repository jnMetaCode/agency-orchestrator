import assert from 'node:assert/strict';
import { supportsImportMetaMain, selectCLINodeRuntime, probeNodeCapability } from '../src/connectors/cli-node-runtime.js';

for (const version of ['20.18.3', '22.14.0', '22.17.9', '23.11.0', '24.0.0', '24.1.9', 'invalid']) {
  assert.equal(supportsImportMetaMain(version), false, version);
}
for (const version of ['22.18.0', '22.21.0', '24.2.0', '24.9.0', '25.0.0', 'v26.1.0']) {
  assert.equal(supportsImportMetaMain(version), true, version);
}
const current = { file: '/engine', version: '20.18.3', electron: true };
const compatible = { ...current, version: '22.18.0' };
let probes = 0;
assert.equal(selectCLINodeRuntime(compatible, {}, '/external', () => { throw Error('must not probe'); }), compatible);
const selected = selectCLINodeRuntime(current, {}, '/external node', file => { probes++; return file === '/external node'; });
assert.equal(selected.file, '/external node');
assert.equal(selected.electron, false);
assert.equal(probes, 1);
assert.throws(() => selectCLINodeRuntime(current, {}, null), /尚未启动 dsh/);
assert.throws(() => selectCLINodeRuntime(current, {}, '/bad', () => false), /未找到兼容/);
assert.throws(() => selectCLINodeRuntime(compatible, { AO_CLI_NODE_PATH: '/bad' }, '/good', () => false), /AO_CLI_NODE_PATH/);
assert.equal(selectCLINodeRuntime(compatible, { AO_CLI_NODE_PATH: '/explicit node' }, '/other', () => true).file, '/explicit node');
assert.throws(() => selectCLINodeRuntime(current, { AO_CLI_NODE_PATH: 'node --bad-flag' }, '/good', () => true), /AO_CLI_NODE_PATH/);
assert.throws(() => selectCLINodeRuntime(current, { AO_CLI_NODE_PATH: current.file }, null, () => { throw Error('must not probe Electron'); }), /不能指向 Electron/);
assert.equal(probeNodeCapability('/definitely-not-installed-ao-node', {}), false);
assert.equal(probeNodeCapability(process.execPath, { ...process.env, ELECTRON_RUN_AS_NODE: '1' }), supportsImportMetaMain(process.versions.node));
console.log('CLI Node runtime: version boundaries, selection, override failures and actual Node capability probe passed');
