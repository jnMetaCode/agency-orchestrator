/** Durable run registration only: subscriptions and worker lifetime remain unchanged. */
import { createHash, randomUUID } from 'node:crypto';
import { basename } from 'node:path';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
  return value;
}
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

/** A child can remain in the map while inherited pipes drain after process exit. */
export function isRunActive(child) {
  return !!child && child.exitCode === null && child.signalCode === null;
}

export class RunJobRegistry {
  constructor(store) { this.store = store; }
  register({ clientRequestId, workflowText, request, connection }) {
    const requestId = clientRequestId === undefined ? randomUUID() : clientRequestId;
    // Hash the complete request/settings in memory; never write request bodies or keys to records.
    const workflowHash = hash(workflowText);
    const snapshot = { workflowHash, requestHash: hash({ workflowHash, request, connection }) };
    const displayName = typeof request.file === 'string'
      ? Array.from(basename(request.file).replace(/\.ya?ml$/i, '').replace(/[\x00-\x1f\x7f]/g, '').trim()).slice(0, 160).join('') : undefined;
    const result = this.store.create(requestId, snapshot, { displayName: displayName || undefined });
    return { ...result, requestId };
  }
  start(id) { return this.change(id, 'running'); }
  finish(id, { code, signal, stopped = false, error = false }) {
    return this.change(id, error ? 'failed' : code === 0 && !signal ? 'completed'
      : signal || stopped ? 'interrupted' : 'failed');
  }
  change(id, status) {
    const job = this.store.get(id);
    if (['completed', 'failed', 'cancelled', 'interrupted'].includes(job.status)) return job;
    return this.store.transition(id, status, job.revision);
  }
}

export function jobHttpError(error, res) {
  const statuses = { JOB_INVALID: 400, JOB_NOT_FOUND: 404, JOB_CONFLICT: 409, JOB_STORE_CORRUPT: 503 };
  const status = statuses[error?.code] || 503;
  // Native filesystem errors can expose paths; keep public messages stable and bounded.
  const code = statuses[error?.code] ? error.code : 'JOB_STORAGE_ERROR';
  return res.status(status).json({ code, error: status === 400 ? 'Invalid job request'
    : status === 404 ? 'Job not found' : status === 409 ? 'Job changed or request ID conflicts'
      : 'Job records are unavailable' });
}

export function registerJobReadRoutes(app, store, { isActive = () => false } = {}) {
  const observed = job => ({ ...job, activeInThisInstance: !!isActive(job.id) });
  const cursor = (value, fallback) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
      throw Object.assign(new Error('Invalid cursor'), { code: 'JOB_INVALID' });
    }
    return Number(value);
  };
  app.get('/api/jobs', (req, res) => {
    try { res.json({ jobs: store.list(cursor(req.query.limit, 50)).map(observed) }); }
    catch (error) { jobHttpError(error, res); }
  });
  app.get('/api/jobs/:id', (req, res) => {
    try { res.json({ job: observed(store.get(req.params.id)) }); }
    catch (error) { jobHttpError(error, res); }
  });
  app.get('/api/jobs/:id/events', (req, res) => {
    try {
      const result = store.events(req.params.id, cursor(req.query.afterSequence, 0));
      res.json({ ...result, job: observed(result.job) });
    }
    catch (error) { jobHttpError(error, res); }
  });
}
