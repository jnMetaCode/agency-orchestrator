import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import { readResourceCatalog, registerResourceCatalogRoutes } from '../web/resource-catalog.js';

const root = mkdtempSync(join(tmpdir(), 'ao-resources-'));
const first = join(root, 'first'), second = join(root, 'second'); mkdirSync(first); mkdirSync(second);
const claudeMcpFile = join(root, 'claude.json'), codexFile = join(root, 'codex.toml');
const options = { skillDirs: [first, second], claudeMcpFile, codexFile };
const secret = 'sk-fixture-resources-secret12345';
const skill = (dir, name, body) => { mkdirSync(join(dir, name), { recursive: true }); writeFileSync(join(dir, name, 'SKILL.md'), body); };
const fixture = () => {
  writeFileSync(claudeMcpFile, JSON.stringify({ mcpServers: { remote: { type: 'http', url: `https://user:${secret}@example.test/private-path?key=${secret}`, headers: { Authorization: secret } },
    local: { command: process.execPath, args: ['-e', `require('fs').writeFileSync(${JSON.stringify(join(root, 'executed'))},'bad')`], env: { TOKEN: secret } } },
    projects: { '/private-project-path': { mcpServers: { outsideScope: { command: 'do-not-run' } } } } }));
  writeFileSync(codexFile, `model="private-model"\n[mcp_servers.codex]\nurl="https://codex.example/private-path?key=${secret}"\nenabled=false\n[mcp_servers.codex.oauth]\nclient_secret="${secret}"\n`);
};
fixture();
skill(first, 'review', '---\nname: Review\ndescription: Review code safely\n---\n# Method\nDo not execute this text.\n');
skill(second, 'review', '---\nname: Other\ndescription: shadowed\n---\nsecond version');
skill(second, 'legacy', 'Legacy instructions, no frontmatter');
after(() => rmSync(root, { recursive: true, force: true }));

test('first AO skill reference and shadowed sources are separate; legacy remains visible', () => {
  const report = readResourceCatalog(options);
  const reviews = report.items.filter(x => x.reference === 'review');
  assert.deepEqual(reviews.map(x => x.selection), ['first-match', 'shadowed']);
  assert.equal(reviews[0].name, 'Review');
  assert(!JSON.stringify(report).includes('Do not execute this text'));
  assert.equal(report.items.find(x => x.reference === 'legacy').format, 'legacy');
});
test('skill details are fresh plain instructions, not executed HTML or scripts', () => {
  const item = readResourceCatalog(options).items.find(x => x.reference === 'review');
  const before = readFileSync(join(first, 'review', 'SKILL.md'), 'utf8');
  writeFileSync(join(first, 'review', 'SKILL.md'), `<script>window.resourceInjected=true</script>\n${secret}`);
  const detail = readResourceCatalog(options, item.id);
  assert(detail.body.includes('<script>')); assert(!detail.body.includes(secret));
  assert.equal(detail.format, 'legacy');
  writeFileSync(join(first, 'review', 'SKILL.md'), before);
});
test('MCP transport is only a declaration, secret-bearing config never returned', () => {
  const report = readResourceCatalog(options), text = JSON.stringify(report);
  const remote = report.items.find(x => x.name === 'remote');
  assert.equal(remote.transport, 'http'); assert.equal(remote.endpointOrigin, 'https://example.test');
  assert.equal(remote.configuredState, 'unknown');
  assert.equal(report.items.find(x => x.name === 'codex').configuredState, 'disabled');
  const local = report.items.find(x => x.name === 'local');
  assert.equal(local.transport, 'stdio'); assert.equal(local.hasArguments, true);
  assert(!existsSync(join(root, 'executed')));
  for (const forbidden of [secret, 'private-path', 'private-project-path', 'outsideScope', 'client_secret', 'Authorization', 'writeFileSync', root]) assert(!text.includes(forbidden));
  assert(!JSON.stringify(readResourceCatalog(options, remote.id)).includes(secret));
});
test('malformed declarations, unknown transports and missing explicit Claude type are not accepted', () => {
  writeFileSync(claudeMcpFile, JSON.stringify({ mcpServers: { invalid: null, noType: { url: 'https://example.test' }, bad: { type: 'http', url: 'file:///private' }, ws: { type: 'ws', url: 'wss://user:secret@example.test/key' } } }));
  const items = readResourceCatalog(options).items;
  assert.equal(items.find(x => x.name === 'invalid').status, 'invalid');
  for (const name of ['noType', 'bad']) assert.equal(items.find(x => x.name === name).status, 'unsupported');
  assert.equal(items.find(x => x.name === 'ws').endpointOrigin, 'wss://example.test');
  fixture();
});
test('missing, invalid root, invalid server table and overlarge sources have distinct states', () => {
  let report = readResourceCatalog({ ...options, skillDirs: [join(root, 'missing')], claudeMcpFile: join(root, 'none') });
  assert.equal(report.sources[0].status, 'missing'); assert.equal(report.sources[1].status, 'missing');
  for (const text of ['[]', 'null', '{broken', '{"mcpServers":[]}']) {
    writeFileSync(claudeMcpFile, text); assert.equal(readResourceCatalog(options).sources.find(x => x.id === 'mcp-claude-code').status, 'invalid');
  }
  writeFileSync(claudeMcpFile, 'x'.repeat(1024 * 1024 + 1));
  assert.equal(readResourceCatalog(options).sources.find(x => x.id === 'mcp-claude-code').status, 'unreadable');
  fixture();
});
test('unreadable skill does not disappear or hide a readable lower priority copy', () => {
  skill(first, 'huge', 'x'.repeat(256 * 1024 + 1)); skill(second, 'huge', 'fallback');
  const items = readResourceCatalog(options).items.filter(x => x.reference === 'huge');
  assert.equal(items[0].status, 'unreadable'); assert.equal(items[1].selection, 'first-match');
});
test('unsafe references are visible but never described as usable AO step references', () => {
  skill(first, 'dot.name', 'instructions');
  const item = readResourceCatalog(options).items.find(x => x.reference === 'dot.name');
  assert.equal(item.status, 'unsupported'); assert.equal(item.selection, 'unknown');
});
test('symlinked skill entries and config files are skipped without following targets', { skip: process.platform === 'win32' }, () => {
  const linked = join(first, 'linked'); symlinkSync(join(second, 'legacy'), linked, 'dir');
  const target = join(root, 'config-target'); writeFileSync(target, `{"mcpServers":{"forbidden":{"command":"${secret}"}}}`);
  const link = join(root, 'config-link'); symlinkSync(target, link);
  const report = readResourceCatalog({ ...options, claudeMcpFile: link });
  assert.equal(report.sources[0].status, 'partial'); assert.equal(report.sources[0].skipped, 1);
  assert.equal(report.sources.find(x => x.id === 'mcp-claude-code').status, 'unreadable');
  assert(!report.items.some(x => x.reference === 'linked' || x.name === 'forbidden'));
  rmSync(linked); rmSync(link);
});
test('count/source limits are explicit and every configured source still reports its status', () => {
  const many = join(root, 'many'); mkdirSync(many);
  for (let i = 0; i < 305; i++) skill(many, `item-${i}`, 'instruction');
  const report = readResourceCatalog({ ...options, skillDirs: [many] });
  assert.equal(report.items.length, 300); assert(report.truncated);
  assert.equal(report.sources.find(x => x.id === 'mcp-codex-cli').status, 'partial');
  assert(readResourceCatalog({ ...options, skillDirs: Array.from({ length: 18 }, (_, i) => join(root, `no-${i}`)) }).truncated);
});
test('HTTP uses opaque identifiers, no-store, no raw exception and no file modification', async () => {
  const app = express(); let fail = false;
  registerResourceCatalogRoutes(app, { ...options, getSkillDirs: () => { if (fail) throw Error(secret); return options.skillDirs; } });
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/resources`;
    const before = [readFileSync(claudeMcpFile), readFileSync(codexFile), readdirSync(root).sort()];
    const response = await fetch(url); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    const report = await response.json(); const item = report.items.find(x => x.reference === 'legacy'); assert(/^[a-f0-9]{64}$/.test(item.id));
    const detail = await fetch(`${url}/${item.id}`); assert.equal(detail.status, 200); assert.equal(detail.headers.get('cache-control'), 'no-store');
    assert((await detail.json()).body.includes('Legacy instructions'));
    assert.equal((await fetch(`${url}/arbitrary-file`)).status, 404);
    assert.equal((await fetch(`${url}/${'0'.repeat(64)}`)).status, 404);
    fail = true; const error = await fetch(url); assert.equal(error.status, 500); assert(!(await error.text()).includes(secret));
    assert.deepEqual([readFileSync(claudeMcpFile), readFileSync(codexFile), readdirSync(root).sort()], before);
    assert(!existsSync(join(root, 'executed')));
  } finally { await new Promise(r => server.close(r)); }
});
