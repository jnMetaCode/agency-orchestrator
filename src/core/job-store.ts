/** Local registry foundation; does not schedule workers or automatically resume side effects. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, lstatSync, openSync, writeFileSync, fsyncSync,
  closeSync, renameSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { withConfigLock } from '../utils/config-transaction.js';
import { assertNotSymlink } from '../utils/config-safety.js';

export type JobStatus = 'queued' | 'running' | 'waiting_input' | 'paused' | 'cancelling'
  | 'completed' | 'failed' | 'cancelled' | 'interrupted';
/** References only: caller must hash the complete logical request, including inputs and policy. */
export interface JobSnapshot {
  requestHash: string;
  workflowHash: string;
  briefRevision?: string;
  connectionProfileId?: string;
  connectionRevision?: string;
}
export interface JobEvent { sequence: number; at: string; type: 'created' | 'status_changed'; status: JobStatus }
export interface JobRecord {
  id: string; revision: number; status: JobStatus; createdAt: string; updatedAt: string;
  displayName?: string;
  snapshot: JobSnapshot; events: JobEvent[];
}
interface StoredJob extends JobRecord { version: 1; requestKeyHash: string }
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const transitions: Record<JobStatus, readonly JobStatus[]> = {
  queued: ['running', 'cancelled'],
  running: ['waiting_input', 'paused', 'cancelling', 'completed', 'failed', 'interrupted'],
  waiting_input: ['running', 'paused', 'cancelling', 'failed', 'interrupted'],
  paused: ['running', 'cancelled'],
  cancelling: ['cancelled', 'completed', 'failed', 'interrupted'],
  interrupted: ['cancelled'],
  completed: [], failed: [], cancelled: [],
};
export class JobStoreError extends Error {
  constructor(public readonly code: 'JOB_CONFLICT' | 'JOB_NOT_FOUND' | 'JOB_INVALID' | 'JOB_STORE_CORRUPT', message: string) {
    super(message); this.name = 'JobStoreError';
  }
}
function invalid(ok: unknown, message: string): asserts ok {
  if (!ok) throw new JobStoreError('JOB_INVALID', message);
}
function validSnapshot(value: JobSnapshot): void {
  invalid(value && typeof value === 'object' && !Array.isArray(value), 'Invalid job snapshot');
  invalid(Object.keys(value).every(key => ['requestHash', 'workflowHash', 'briefRevision', 'connectionProfileId', 'connectionRevision'].includes(key)),
    'Job snapshot accepts references only, not credentials or request bodies');
  invalid(typeof value.requestHash === 'string' && HASH.test(value.requestHash)
    && typeof value.workflowHash === 'string' && HASH.test(value.workflowHash), 'Invalid request/workflow hash');
  for (const key of ['briefRevision', 'connectionProfileId', 'connectionRevision'] as const) {
    const item = value[key];
    invalid(item === undefined || typeof item === 'string' && /^[\w.-]{1,128}$/.test(item), 'Invalid snapshot reference');
  }
}
function publicJob(value: StoredJob): JobRecord {
  return structuredClone({ id: value.id, revision: value.revision, status: value.status,
    createdAt: value.createdAt, updatedAt: value.updatedAt, displayName: value.displayName,
    snapshot: value.snapshot, events: value.events });
}

/** Per-job snapshot and bounded event history commit together in a single atomic replacement.
 * All cooperating writers use one directory lock. Creation scans records to avoid a second index
 * transaction; intended for low-volume local use, not a distributed queue or large job database.
 */
export class FileJobStore {
  private readonly directory: string;
  constructor(directory: string, private readonly maxEvents = 128) {
    invalid(typeof directory === 'string' && directory.trim().length > 0, 'Invalid job directory');
    invalid(Number.isSafeInteger(maxEvents) && maxEvents >= 2 && maxEvents <= 1000, 'Invalid event retention');
    this.directory = resolve(directory);
  }
  private path(id: string): string {
    invalid(typeof id === 'string' && ID.test(id), 'Invalid job ID');
    return join(this.directory, `${id}.json`);
  }
  private read(id: string): StoredJob {
    const path = this.path(id);
    try {
      assertNotSymlink(path);
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('invalid file');
      const job: StoredJob = JSON.parse(readFileSync(path, 'utf-8'));
      validSnapshot(job.snapshot);
      if (job.version !== 1 || job.id !== id || !HASH.test(job.requestKeyHash)
        || !Object.hasOwn(transitions, job.status) || !Number.isSafeInteger(job.revision) || job.revision < 1
        || typeof job.createdAt !== 'string' || typeof job.updatedAt !== 'string'
        || job.displayName !== undefined && (typeof job.displayName !== 'string' || !job.displayName.length
          || job.displayName.length > 200 || /[\x00-\x1f\x7f]/.test(job.displayName))
        || !Array.isArray(job.events) || !job.events.length || job.events.length > 1000 || job.events.length > job.revision
        || job.events.some((event, index) => event.sequence !== job.revision - job.events.length + index + 1
          || !Object.hasOwn(transitions, event.status) || typeof event.at !== 'string'
          || Object.keys(event).some(key => !['sequence', 'at', 'type', 'status'].includes(key))
          || !['created', 'status_changed'].includes(event.type))
        || job.events.at(-1)!.status !== job.status) throw new Error('invalid');
      return job;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new JobStoreError('JOB_NOT_FOUND', 'Job not found');
      // Never include JSON parser text: a corrupted file may contain sensitive material.
      throw new JobStoreError('JOB_STORE_CORRUPT', `Job record cannot be read safely: ${id}`);
    }
  }
  private ids(): string[] {
    try { return readdirSync(this.directory).filter(name => name.endsWith('.json') && ID.test(name.slice(0, -5))).map(name => name.slice(0, -5)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
  private write(job: StoredJob): void {
    const path = this.path(job.id);
    assertNotSymlink(path);
    const temp = `${path}.${randomUUID()}.job-tmp`;
    const fd = openSync(temp, 'wx', 0o600);
    try {
      try { writeFileSync(fd, JSON.stringify(job) + '\n', 'utf-8'); fsyncSync(fd); }
      finally { closeSync(fd); }
      assertNotSymlink(path);
      renameSync(temp, path);
    } finally { try { unlinkSync(temp); } catch { /* Renamed or preserve write failure. */ } }
  }
  private locked<T>(action: () => T): T {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    return withConfigLock(this.directory, () => {
      // A killed writer may leave an unpublished replacement. The committed record is canonical.
      for (const name of readdirSync(this.directory)) {
        const parts = name.split('.');
        if (parts.length !== 4 || !ID.test(parts[0]) || parts[1] !== 'json' || !ID.test(parts[2]) || parts[3] !== 'job-tmp') continue;
        const path = join(this.directory, name);
        if (lstatSync(path).isFile()) unlinkSync(path);
      }
      return action();
    });
  }
  create(requestId: string, snapshot: JobSnapshot, options: { displayName?: string } = {}): { job: JobRecord; created: boolean } {
    invalid(typeof requestId === 'string' && requestId.length > 0 && requestId.length <= 256, 'Invalid request ID');
    validSnapshot(snapshot);
    invalid(options && typeof options === 'object' && Object.keys(options).every(key => key === 'displayName'), 'Invalid job options');
    const displayName = options.displayName;
    invalid(displayName === undefined || typeof displayName === 'string' && displayName.length > 0
      && displayName.length <= 200 && !/[\x00-\x1f\x7f]/.test(displayName), 'Invalid display name');
    const requestKeyHash = createHash('sha256').update(requestId).digest('hex');
    return this.locked(() => {
      for (const id of this.ids()) {
        const old = this.read(id);
        if (old.requestKeyHash !== requestKeyHash) continue;
        // Compare canonical fields rather than relying on caller object property order.
        if (Object.keys({ ...old.snapshot, ...snapshot }).some(key =>
          old.snapshot[key as keyof JobSnapshot] !== snapshot[key as keyof JobSnapshot])) {
          throw new JobStoreError('JOB_CONFLICT', 'Request ID already belongs to a different task');
        }
        return { job: publicJob(old), created: false };
      }
      const at = new Date().toISOString();
      const job: StoredJob = { version: 1, requestKeyHash, id: randomUUID(), revision: 1, status: 'queued',
        createdAt: at, updatedAt: at, displayName, snapshot: structuredClone(snapshot),
        events: [{ sequence: 1, at, type: 'created', status: 'queued' }] };
      this.write(job);
      return { job: publicJob(job), created: true };
    });
  }
  get(id: string): JobRecord { return publicJob(this.read(id)); }
  list(limit = 50): JobRecord[] {
    invalid(Number.isSafeInteger(limit) && limit >= 1 && limit <= 200, 'Invalid list limit');
    return this.ids().map(id => this.get(id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)).slice(0, limit);
  }
  transition(id: string, status: JobStatus, expectedRevision: number): JobRecord {
    this.path(id);
    invalid(Object.hasOwn(transitions, status), 'Invalid job status');
    invalid(Number.isSafeInteger(expectedRevision) && expectedRevision > 0, 'Invalid expected revision');
    return this.locked(() => {
      const job = this.read(id);
      if (job.revision !== expectedRevision) throw new JobStoreError('JOB_CONFLICT', 'Job changed; refresh before submitting');
      if (job.status === status) return publicJob(job);
      if (!transitions[job.status].includes(status)) throw new JobStoreError('JOB_CONFLICT', 'Invalid job state transition');
      job.status = status; job.updatedAt = new Date().toISOString(); job.revision++;
      job.events.push({ sequence: job.revision, at: job.updatedAt, type: 'status_changed', status });
      job.events = job.events.slice(-this.maxEvents);
      this.write(job);
      return publicJob(job);
    });
  }
  events(id: string, afterSequence = 0): { job: JobRecord; events: JobEvent[]; resetRequired: boolean } {
    const job = this.get(id);
    invalid(Number.isSafeInteger(afterSequence) && afterSequence >= 0 && afterSequence <= job.revision, 'Invalid event cursor');
    const resetRequired = afterSequence < job.events[0].sequence - 1;
    return { job, events: resetRequired ? [] : job.events.filter(event => event.sequence > afterSequence), resetRequired };
  }
}
