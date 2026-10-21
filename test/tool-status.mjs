import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { readToolStatuses, registerToolStatusRoute } from '../web/tool-status.js';

const root = mkdtempSync(join(tmpdir(), 'ao-tool-status-'));
const claudeDir = join(root, 'claude'), codexDir = join(root, 'codex');
mkdirSync(claudeDir); mkdirSync(codexDir);
const claude = join(claudeDir, 'settings.json'), codex = join(codexDir, 'config.toml');
const secret = 'sk-private-fixture-DO-NOT-RETURN';
const options = { claudeDir, codexDir, installed: ['claude-code'],
  claudeOwnership: () => ({ managed: false }), codexOwnership: () => ({ managed: false }) };
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('  ✓ ' + name); }
let server;
try {
  await test('missing files and command detection do not imply login or an official configuration', () => {
    const { tools } = readToolStatuses(options);
    assert.equal(tools[0].configuration, 'missing'); assert.equal(tools[0].installed, true);
    assert.equal(tools[1].configuration, 'missing'); assert.equal(tools[1].installed, false);
    assert(!JSON.stringify(tools).includes('official'));
  });
  await test('read actual external Codex provider, Claude models and sanitized endpoint origins', () => {
    writeFileSync(claude, JSON.stringify({ env: { ANTHROPIC_BASE_URL: `https://user:${secret}@claude.example/private/${secret}?key=${secret}#${secret}`, ANTHROPIC_AUTH_TOKEN: secret, ANTHROPIC_MODEL: 'claude-model' } }));
    writeFileSync(codex, `model_provider = "external"\nmodel = "codex-model"\n[model_providers.external]\nbase_url = "https://codex.example/private/${secret}?key=${secret}"\n`);
    const report = readToolStatuses(options), [c, x] = report.tools;
    assert.equal(c.endpointOrigin, 'https://claude.example'); assert.equal(c.environmentModel, 'claude-model');
    assert.equal(c.model, undefined);
    assert.equal(x.endpointOrigin, 'https://codex.example'); assert.equal(x.provider, 'external');
    assert.equal(x.model, 'codex-model'); assert.equal(x.providerMissing, false);
    assert(!JSON.stringify(report).includes(secret)); assert(!JSON.stringify(report).includes('/private/'));
  });
  await test('model declarations remain separate and unselected endpoints are not guessed', () => {
    writeFileSync(claude, JSON.stringify({ model: 'setting-model', env: { ANTHROPIC_MODEL: 'env-model' } }));
    writeFileSync(codex, '[model_providers.openai]\nbase_url="https://possible.example/v1"\n');
    const { tools } = readToolStatuses(options);
    assert.equal(tools[0].model, 'setting-model'); assert.equal(tools[0].environmentModel, 'env-model');
    assert.equal(tools[1].endpointUnresolved, true); assert.equal(tools[1].endpointOrigin, undefined);
  });
  await test('invalid and non-object configurations are explicit and parser input never escapes', () => {
    for (const value of [`{"token":"${secret}",`, '[]', 'null', '{"env":[]}','{"model":123}']) {
      writeFileSync(claude, value);
      assert.equal(readToolStatuses(options).tools[0].configuration, 'invalid');
    }
    writeFileSync(codex, `key = "${secret}\n`);
    const report = readToolStatuses(options);
    assert.equal(report.tools[1].configuration, 'invalid'); assert(!JSON.stringify(report).includes(secret));
  });
  await test('invalid endpoint values and accidentally pasted label credentials are not exposed', () => {
    writeFileSync(claude, JSON.stringify({ model: secret, env: { ANTHROPIC_BASE_URL: 'not-a-url-' + secret } }));
    const report = readToolStatuses(options);
    assert.equal(report.tools[0].endpointInvalid, true);
    assert(!JSON.stringify(report).includes(secret));
    writeFileSync(claude, JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'file:///private/key' } }));
    assert.equal(readToolStatuses(options).tools[0].endpointInvalid, true);
  });
  await test('large/non-regular files are rejected; missing custom providers are identified', () => {
    writeFileSync(claude, 'x'.repeat(1024 * 1024 + 1));
    assert.equal(readToolStatuses(options).tools[0].configuration, 'unreadable');
    rmSync(claude); mkdirSync(claude);
    assert.equal(readToolStatuses(options).tools[0].configuration, 'unreadable');
    rmSync(claude, { recursive: true }); writeFileSync(claude, '{}');
    for (const provider of ['missing', '__proto__']) {
      writeFileSync(codex, `model_provider = "${provider}"\n`);
      assert.equal(readToolStatuses(options).tools[1].providerMissing, true);
    }
  });
  await test('ownership conflicts, interrupted recovery and errors remain distinct', () => {
    writeFileSync(codex, 'model="test"\n');
    const { tools } = readToolStatuses({ ...options, claudeOwnership: () => ({ tampered: true }), codexOwnership: () => ({ recoveryPending: true, managed: true }) });
    assert.equal(tools[0].management, 'changed'); assert.equal(tools[0].conflict, true);
    assert.equal(tools[1].recoveryPending, true);
    const failed = readToolStatuses({ ...options, claudeOwnership: () => { throw Error(secret); } });
    assert.equal(failed.tools[0].management, 'unknown'); assert(!JSON.stringify(failed).includes(secret));
  });
  await test('configuration changed during inspection is not reported as a current snapshot', () => {
    const { tools } = readToolStatuses({ ...options, claudeOwnership: () => { writeFileSync(claude, '{"model":"new"}'); return { managed: true }; } });
    assert.equal(tools[0].configuration, 'changing'); assert.equal(tools[0].model, undefined);
  });
  await test('HTTP refresh is no-store, never modifies files, and failure responses hide exceptions', async () => {
    const app = express(); let fail = false;
    registerToolStatusRoute(app, { ...options, detectInstalled: () => { if (fail) throw Error(secret); return ['claude-code']; } });
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/tools/status`;
    const before = [readFileSync(claude), readFileSync(codex), readdirSync(claudeDir), readdirSync(codexDir)];
    for (let n = 0; n < 2; n++) {
      const response = await fetch(url); assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const text = await response.text(); assert(!text.includes(secret)); assert.equal(JSON.parse(text).tools.length, 2);
    }
    assert.deepEqual([readFileSync(claude), readFileSync(codex), readdirSync(claudeDir), readdirSync(codexDir)], before);
    fail = true; const response = await fetch(url); assert.equal(response.status, 500); assert(!(await response.text()).includes(secret));
  });
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  rmSync(root, { recursive: true, force: true });
}
console.log(`Tool status: ${passed} scenarios passed`);
