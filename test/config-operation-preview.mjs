import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTargetPreviews, claudeTargetSummary } from '../web/config-operation-preview.js';

const target = { providerId: 'relay', baseUrl: 'https://user:secret@example.test/private-key?key=private-query', apiKey: 'sk-fixture-secret-123456', model: 'small', sonnetModel: 'medium', apiKeyField: 'ANTHROPIC_AUTH_TOKEN' };
const operation = 'claude/global/apply';
const source = 'a'.repeat(64);
let time = 1_790_000_000_000;
const previews = createTargetPreviews({ now: () => time, ttlMs: 300_000 });
const issue = () => previews.issue(operation, source, target);

test('exact target accepted; key order does not change identity', () => {
  const p = issue();
  previews.verify(p.targetRevision, operation, source, Object.fromEntries(Object.entries(target).reverse()));
  assert.equal(p.expiresAt, new Date(time + 300_000).toISOString());
});
test('every changed target field invalidates confirmation, including hidden URL parts and key', () => {
  const p = issue();
  for (const [name, value] of Object.entries(target)) {
    assert.throws(() => previews.verify(p.targetRevision, operation, source, { ...target, [name]: value + '-changed' }), { code: 'TARGET_PREVIEW_CHANGED' });
  }
});
test('source, operation and scope cannot be substituted', () => {
  const p = issue();
  for (const [op, revision] of [['claude/global/restore', source], ['claude/task/apply', source], [operation, 'b'.repeat(64)]]) {
    assert.throws(() => previews.verify(p.targetRevision, op, revision, target), { code: 'TARGET_PREVIEW_CHANGED' });
  }
});
test('missing, forged and oversized tokens fail without credential content', () => {
  assert.throws(() => previews.verify(undefined, operation, source, target), { code: 'TARGET_PREVIEW_REQUIRED', status: 400 });
  for (const token of ['wrong', `${time}.` + '0'.repeat(64), issue().targetRevision + '0', 'x'.repeat(10000)]) {
    assert.throws(() => previews.verify(token, operation, source, target), error => error.status === 409 && !error.message.includes(target.apiKey));
  }
});
test('expires at boundary and cannot be revived by replay', () => {
  const p = issue(); time += 299_999;
  previews.verify(p.targetRevision, operation, source, target);
  time++;
  assert.throws(() => previews.verify(p.targetRevision, operation, source, target), { code: 'TARGET_PREVIEW_CHANGED' });
});
test('backend restart invalidates previous target preview', () => {
  const p = issue();
  const restarted = createTargetPreviews({ now: () => time });
  assert.throws(() => restarted.verify(p.targetRevision, operation, source, target), { code: 'TARGET_PREVIEW_CHANGED' });
});
test('public summary contains no key or URL credentials/path/query', () => {
  const p = { ...issue(), summary: claudeTargetSummary(target) };
  const text = JSON.stringify(p);
  for (const secret of [target.apiKey, 'user:', 'secret@', 'private-key', 'private-query']) assert(!text.includes(secret));
  assert.equal(p.summary.endpointOrigin, 'https://example.test');
  assert.equal(p.summary.credentialField, 'ANTHROPIC_AUTH_TOKEN');
  assert.equal(p.summary.model, 'small');
});
test('invalid origins and accidental key labels are not echoed', () => {
  const summary = claudeTargetSummary({ ...target, baseUrl: 'file:///private-secret', model: target.apiKey });
  assert.equal(summary.endpointOrigin, undefined);
  assert(!JSON.stringify(summary).includes(target.apiKey));
});
