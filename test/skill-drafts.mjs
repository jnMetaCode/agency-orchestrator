import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSkillDrafts } from '../web/skill-drafts.js';

const root = mkdtempSync(join(tmpdir(), 'ao-drafts-'));
after(() => rmSync(root, { recursive: true, force: true }));
const directory = join(root, 'drafts');
const sourceId = 'a'.repeat(64);
const source = { kind: 'skill', name: 'Review', body: 'Original method' };
const store = createSkillDrafts({ directory, resolveSource: id => id === sourceId ? source : undefined });
const input = { name: 'My method', body: 'Edited method', sourceResourceId: sourceId };
const request = (preview, changes = {}) => ({ ...preview.after, expectedRevision: preview.expectedRevision, targetRevision: preview.targetRevision, ...changes });
let saved;

test('preview and cancellation create no directory; invalid confirmation also writes nothing', () => {
  const preview = store.preview(input);
  assert.equal(preview.before, null);
  assert(!existsSync(directory));
  assert.throws(() => store.save(request(preview, { targetRevision: '' })), { code: 'TARGET_PREVIEW_REQUIRED' });
  assert(!existsSync(directory));
  assert.throws(() => store.save(request(preview, { body: 'Changed after preview' })), { code: 'TARGET_PREVIEW_CHANGED' });
  assert(!existsSync(directory));
});
test('explicit save persists a personal draft without modifying or executing the source', () => {
  const preview = store.preview(input);
  saved = store.save(request(preview));
  assert.equal(saved.body, input.body);
  assert.equal(saved.sourceName, 'Review');
  assert.equal(source.body, 'Original method');
  assert.equal(saved.pending, false);
  assert.equal(store.check(saved.id).draft.id, saved.id);
  assert.throws(() => store.save(request(preview)), { code: 'DRAFT_CHANGED' });
  assert.deepEqual(readdirSync(directory), [saved.id]);
  if (process.platform !== 'win32') assert.equal(statSync(join(directory, saved.id, 'draft.json')).mode & 0o777, 0o600);
});
test('lists omit bodies and revision tokens; editing requires current revision', () => {
  const list = store.list();
  assert.equal(list.items.length, 1);
  assert(!('body' in list.items[0]));
  assert(!('revision' in list.items[0]));
  assert.throws(() => store.preview({ id: saved.id, ...input }), { code: 'DRAFT_CHANGED' });
  const preview = store.preview({ id: saved.id, ...input, expectedRevision: saved.revision });
  assert.equal(preview.before.body, input.body);
});
test('external modifications after preview reject save and preserve the external bytes', () => {
  const preview = store.preview({ ...input, id: saved.id, expectedRevision: saved.revision });
  const file = join(directory, saved.id, 'draft.json');
  const external = JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), body: 'External edit' });
  writeFileSync(file, external);
  assert.throws(() => store.save(request(preview)), { code: 'DRAFT_CHANGED' });
  assert.equal(readFileSync(file, 'utf8'), external);
});
test('repeated edits retain at most five backups; original Skill stays unchanged', () => {
  for (let i = 0; i < 8; i++) {
    const current = store.detail(saved.id);
    const preview = store.preview({ id: current.id, expectedRevision: current.revision, name: current.name, body: `Method ${i}` });
    store.save(request(preview));
  }
  const files = readdirSync(join(directory, saved.id));
  assert.equal(files.filter(name => name.startsWith('draft.json.ao-backup-')).length, 5);
  assert.equal(source.body, 'Original method');
});
test('invalid paths, overlarge text and unavailable sources are rejected without new drafts', () => {
  const before = readdirSync(directory);
  assert.throws(() => store.detail('../outside'), { code: 'DRAFT_INVALID' });
  assert.throws(() => store.preview({ name: 'x', body: 'x'.repeat(128 * 1024 + 1) }), { code: 'DRAFT_INVALID' });
  assert.throws(() => store.preview({ ...input, sourceResourceId: 'b'.repeat(64) }), { code: 'DRAFT_SOURCE_CHANGED' });
  assert.deepEqual(readdirSync(directory), before);
});
test('missing save result can be checked without creating data; tokens do not survive restart', () => {
  const preview = store.preview(input);
  assert.deepEqual(store.check(preview.id), { saved: false });
  assert(!existsSync(join(directory, preview.id)));
  const restarted = createSkillDrafts({ directory, resolveSource: () => source });
  assert.throws(() => restarted.save(request(preview)), { code: 'DRAFT_CHANGED' });
});

test('pending journal blocks preview; malformed saved data is reported without exposing its contents', () => {
  const current = store.detail(saved.id), dir = join(directory, saved.id);
  const journal = join(dir, '.ao-config-transaction.json');
  writeFileSync(journal, '{}');
  assert.throws(() => store.preview({ id: current.id, expectedRevision: current.revision, name: 'x', body: 'y' }), { code: 'DRAFT_PENDING' });
  rmSync(journal);
  const file = join(dir, 'draft.json'), previous = readFileSync(file);
  writeFileSync(file, 'private broken content');
  assert.throws(() => store.detail(current.id), { code: 'DRAFT_UNAVAILABLE' });
  assert.equal(store.list().partial, true);
  writeFileSync(file, previous);
});

test('HTTP responses are not cached and errors expose no filesystem paths', async () => {
  const { default: express } = await import('express');
  const { registerSkillDraftRoutes } = await import('../web/skill-drafts.js');
  const app = express(); app.use(express.json());
  registerSkillDraftRoutes(app, { directory: join(root, 'http'), resolveSource: () => source });
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const url = `http://127.0.0.1:${server.address().port}/api/skill-drafts`;
  try {
    const list = await fetch(url);
    assert.equal(list.headers.get('cache-control'), 'no-store');
    assert.deepEqual((await list.json()).items, []);
    const invalid = await fetch(`${url}/invalid`);
    assert.equal(invalid.status, 400);
    assert(!(await invalid.text()).includes(root));
    const response = await fetch(`${url}/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const preview = await response.json(); assert.equal(response.status, 200);
    assert(!existsSync(join(root, 'http')));
    const save = await fetch(`${url}/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request(preview)) });
    assert.equal(save.status, 200);
    assert.equal((await save.json()).body, input.body);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
