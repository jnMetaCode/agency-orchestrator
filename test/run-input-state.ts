import assert from 'node:assert/strict';
import { reconcileRunInput } from '../website/src/lib/run-input-state.js';

const first = { stepId: 'same-step', inputRequestId: 'first', prompt: 'First?', type: 'human_input' as const };
const next = { ...first, inputRequestId: 'next', prompt: 'Next?' };
const owner = () => ({ state: 'running', pendingInput: first as typeof first | null, _inputVersion: 0 });
const deferred = () => {
  let resolve!: (value: { active: boolean; pendingInput: typeof first | null }) => void;
  const promise = new Promise<{ active: boolean; pendingInput: typeof first | null }>(r => { resolve = r; });
  return { promise, resolve };
};
{
  const run = owner();
  await reconcileRunInput(run, async () => ({ active: true, pendingInput: null }));
  assert.equal(run.pendingInput, null);
  await reconcileRunInput(run, async () => ({ active: true, pendingInput: next }));
  assert.equal(run.pendingInput, next);
}
{
  const run = owner(), response = deferred();
  const refresh = reconcileRunInput(run, () => response.promise);
  run._inputVersion++; run.pendingInput = next;
  response.resolve({ active: true, pendingInput: first });
  assert.equal(await refresh, false);
  assert.equal(run.pendingInput, next);
}
{
  const run = owner(), older = deferred();
  const firstRefresh = reconcileRunInput(run, () => older.promise);
  await reconcileRunInput(run, async () => ({ active: true, pendingInput: next }));
  older.resolve({ active: true, pendingInput: first });
  assert.equal(await firstRefresh, false);
  assert.equal(run.pendingInput, next);
}
{
  const run = owner(), response = deferred();
  const refresh = reconcileRunInput(run, () => response.promise);
  run.state = 'done'; run.pendingInput = null;
  response.resolve({ active: true, pendingInput: first });
  assert.equal(await refresh, false);
  assert.equal(run.pendingInput, null);
}
{
  const run = owner();
  await reconcileRunInput(run, async () => ({ active: false, pendingInput: first }));
  assert.equal(run.pendingInput, null);
}
{
  const run = owner();
  await assert.rejects(reconcileRunInput(run, async () => { throw Error('offline'); }));
  assert.equal(run.pendingInput, first);
}
console.log('Input reconciliation: consumed, new question, stale stream snapshot, overlapping queries, terminal, inactive and offline cases passed');
