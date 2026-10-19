import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync, existsSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { FileJobStore, JobStoreError } from '../src/core/job-store.js';

const root = mkdtempSync(join(tmpdir(), 'ao-job-store-'));
const moduleUrl = pathToFileURL(resolve('src/core/job-store.ts')).href;
const snapshot = { workflowHash: 'a'.repeat(64), requestHash: 'b'.repeat(64), briefRevision: 'v1' };
let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) { await fn(); console.log(`  ✓ ${name}`); passed++; }
const code = (value: string) => (error: unknown) => error instanceof JobStoreError && error.code === value;
const workerSource = (dir: string, script: string) => `
  import fs from 'node:fs';
  import { syncBuiltinESMExports } from 'node:module';
  import { FileJobStore } from ${JSON.stringify(moduleUrl)};
  const store = new FileJobStore(${JSON.stringify(dir)});
  ${script}
`;
const worker = (dir: string, script: string) => spawnSync(process.execPath,
  ['--import', 'tsx', '--input-type=module', '-e', workerSource(dir, script)], { encoding: 'utf-8', timeout: 15000 });
try {
  await test('create persists UUID, snapshot, queued state and event as one record', () => {
    const dir = join(root, 'basic');
    const store = new FileJobStore(dir);
    const result = store.create('request-private-key', snapshot);
    assert(result.created);
    assert.match(result.job.id, /^[a-f0-9-]{36}$/);
    assert.equal(result.job.status, 'queued');
    assert.equal(result.job.events[0].sequence, 1);
    assert.deepEqual(new FileJobStore(dir).get(result.job.id), result.job);
    assert(!readFileSync(join(dir, `${result.job.id}.json`), 'utf-8').includes('request-private-key'));
    assert(!('requestKeyHash' in result.job));
    if (process.platform !== 'win32') assert.equal(statSync(join(dir, `${result.job.id}.json`)).mode & 0o777, 0o600);
  });
  await test('idempotent retries survive a new process; object key order does not matter', () => {
    const dir = join(root, 'retry');
    const store = new FileJobStore(dir);
    const first = store.create('same-request', snapshot);
    const result = worker(dir, `console.log(JSON.stringify(store.create('same-request', ${JSON.stringify(snapshot)})));`);
    assert.equal(result.status, 0, result.stderr);
    const second = JSON.parse(result.stdout);
    assert.equal(second.created, false);
    assert.equal(second.job.id, first.job.id);
    assert.equal(store.create('same-request', { briefRevision: 'v1', requestHash: snapshot.requestHash, workflowHash: snapshot.workflowHash }).created, false);
    assert.throws(() => store.create('same-request', { ...snapshot, requestHash: 'c'.repeat(64) }), code('JOB_CONFLICT'));
    assert.equal(store.list().length, 1);
  });
  await test('stale revisions, invalid transitions and terminal resurrection are rejected', () => {
    const store = new FileJobStore(join(root, 'transitions'));
    const { job } = store.create('state', snapshot);
    const running = store.transition(job.id, 'running', 1);
    assert.equal(running.revision, 2);
    assert.throws(() => store.transition(job.id, 'completed', 1), code('JOB_CONFLICT'));
    assert.equal(store.transition(job.id, 'running', 2).revision, 2);
    assert.equal(store.transition(job.id, 'waiting_input', 2).revision, 3);
    assert.throws(() => store.transition(job.id, 'completed', 3), code('JOB_CONFLICT'));
    store.transition(job.id, 'running', 3);
    const done = store.transition(job.id, 'completed', 4);
    assert.throws(() => store.transition(job.id, 'running', done.revision), code('JOB_CONFLICT'));
    assert.equal(store.get(job.id).status, 'completed');
  });
  await test('bounded event history reports reset rather than silently omitting events', () => {
    const dir = join(root, 'events');
    const store = new FileJobStore(dir, 3);
    const { job } = store.create('events', snapshot);
    store.transition(job.id, 'running', 1);
    store.transition(job.id, 'paused', 2);
    store.transition(job.id, 'running', 3);
    assert.equal(store.events(job.id, 0).resetRequired, true);
    assert.deepEqual(store.events(job.id, 0).events, []);
    assert.deepEqual(store.events(job.id, 2).events.map(event => event.sequence), [3, 4]);
    assert.throws(() => store.events(job.id, 5), code('JOB_INVALID'));
    assert.equal(new FileJobStore(dir).get(job.id).revision, 4);
  });
  await test('snapshot fields are references only; invalid IDs never access outside records', () => {
    const dir = join(root, 'validation');
    const store = new FileJobStore(dir);
    assert.throws(() => store.create('key', { ...snapshot, api_key: 'fake-secret' } as any), code('JOB_INVALID'));
    assert.throws(() => store.create('key', { ...snapshot, connectionProfileId: 'https://user:password@host' }), code('JOB_INVALID'));
    assert.throws(() => store.get('../outside'), code('JOB_INVALID'));
    assert.throws(() => store.list(10000), code('JOB_INVALID'));
    assert(!existsSync(dir));
  });
  await test('corrupt record fails closed without parser data in the error', () => {
    const dir = join(root, 'corrupt');
    const store = new FileJobStore(dir);
    const { job } = store.create('key', snapshot);
    writeFileSync(join(dir, `${job.id}.json`), '{"secret": fake-secret}');
    assert.throws(() => store.get(job.id), (error: unknown) => code('JOB_STORE_CORRUPT')(error) && !String(error).includes('fake-secret'));
    assert.throws(() => store.create('another', snapshot), code('JOB_STORE_CORRUPT'));
    assert.equal(readdirSync(dir).filter(name => name.endsWith('.json')).length, 1);
  });
  await test('returned snapshots are isolated and missing records do not create directories', () => {
    const dir = join(root, 'isolation');
    const store = new FileJobStore(dir);
    assert.deepEqual(store.list(), []);
    assert.throws(() => store.get('12345678-1234-4234-8234-123456789abc'), code('JOB_NOT_FOUND'));
    assert(!existsSync(dir));
    const { job } = store.create('key', snapshot);
    job.snapshot.briefRevision = 'changed'; job.events[0].status = 'failed';
    assert.equal(store.get(job.id).snapshot.briefRevision, 'v1');
    assert.equal(store.get(job.id).events[0].status, 'queued');
  });
  await test('optional display names persist; old unnamed records remain readable', () => {
    const dir = join(root, 'display-name');
    const store = new FileJobStore(dir);
    const named = store.create('named', snapshot, { displayName: '研究方案' }).job;
    assert.equal(new FileJobStore(dir).get(named.id).displayName, '研究方案');
    assert.equal(store.create('named', snapshot, { displayName: 'new label' }).job.displayName, '研究方案');
    const old = store.create('unnamed', snapshot).job;
    assert.equal(store.get(old.id).displayName, undefined);
    assert.throws(() => store.create('invalid', snapshot, { displayName: 'bad\nname' }), code('JOB_INVALID'));
    assert.throws(() => store.create('extra', snapshot, { displayName: 'safe', api_key: 'fake-secret' } as any), code('JOB_INVALID'));
  });
  await test('invalid persisted event metadata is rejected without exposing extra fields', () => {
    const dir = join(root, 'event-corruption');
    const store = new FileJobStore(dir);
    const { job } = store.create('key', snapshot);
    const path = join(dir, `${job.id}.json`);
    const raw = JSON.parse(readFileSync(path, 'utf-8'));
    raw.events[0].secret = 'fake-secret';
    writeFileSync(path, JSON.stringify(raw));
    assert.throws(() => store.get(job.id), code('JOB_STORE_CORRUPT'));
  });
  await test('partial snapshot write failure leaves the previous revision and releases lock', () => {
    const dir = join(root, 'partial');
    const store = new FileJobStore(dir);
    const { job } = store.create('key', snapshot);
    const before = readFileSync(join(dir, `${job.id}.json`), 'utf-8');
    const result = worker(dir, `
      const write = fs.writeFileSync;
      fs.writeFileSync = (fd, data, ...args) => {
        if (String(data).includes('"requestKeyHash"')) { write(fd, 'partial', ...args); throw new Error('disk full'); }
        return write(fd, data, ...args);
      };
      syncBuiltinESMExports();
      try { store.transition(${JSON.stringify(job.id)}, 'running', 1); } catch { process.exit(17); }
    `);
    assert.equal(result.status, 17, result.stderr);
    assert.equal(readFileSync(join(dir, `${job.id}.json`), 'utf-8'), before);
    assert(!readdirSync(dir).some(name => name.endsWith('.job-tmp') || name.endsWith('.lock')));
  });
  for (const stage of ['before', 'after']) await test(`SIGKILL ${stage} rename leaves one recoverable committed revision`, () => {
    const dir = join(root, `kill-${stage}`);
    const store = new FileJobStore(dir);
    const { job } = store.create('key', snapshot);
    const result = worker(dir, `
      const rename = fs.renameSync;
      fs.renameSync = (from, to) => {
        if (${JSON.stringify(stage)} === 'after') rename(from, to);
        process.kill(process.pid, 'SIGKILL');
      };
      syncBuiltinESMExports();
      store.transition(${JSON.stringify(job.id)}, 'running', 1);
    `);
    assert.notEqual(result.status, 0);
    assert(!result.error, String(result.error));
    const retry = new FileJobStore(dir).create('key', snapshot);
    assert.equal(retry.created, false);
    assert.equal(retry.job.id, job.id);
    assert.equal(retry.job.revision, stage === 'before' ? 1 : 2);
    assert(!readdirSync(dir).some(name => name.endsWith('.job-tmp') || name.endsWith('.lock')));
  });
  for (const stage of ['before', 'after']) await test(`creation retry after SIGKILL ${stage} commit creates no duplicate job`, () => {
    const dir = join(root, `create-kill-${stage}`);
    const result = worker(dir, `
      const rename = fs.renameSync;
      fs.renameSync = (from, to) => {
        if (${JSON.stringify(stage)} === 'after') rename(from, to);
        process.kill(process.pid, 'SIGKILL');
      };
      syncBuiltinESMExports();
      store.create('recover-create', ${JSON.stringify(snapshot)});
    `);
    assert.notEqual(result.status, 0);
    assert(!result.error, String(result.error));
    const store = new FileJobStore(dir);
    const retried = store.create('recover-create', snapshot);
    assert.equal(retried.created, stage === 'before');
    assert.equal(store.list().length, 1);
    assert.equal(store.create('recover-create', snapshot).job.id, retried.job.id);
    assert(!readdirSync(dir).some(name => name.endsWith('.job-tmp') || name.endsWith('.lock')));
  });
  await test('two real processes racing one request create exactly one job', async () => {
    const dir = join(root, 'race');
    new FileJobStore(dir).create('bootstrap', snapshot);
    const script = `
      for (let n = 0; n < 100; n++) {
        try { console.log(JSON.stringify(store.create('raced-key', ${JSON.stringify(snapshot)}))); break; }
        catch (e) { if (!String(e).includes('另一个 AO')) throw e; await new Promise(r => setTimeout(r, 20)); }
      }
    `;
    const results = await Promise.all([1, 2].map(() => new Promise<any>((done, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', workerSource(dir, script)], { timeout: 15000 });
      let out = '', err = '';
      child.stdout.on('data', chunk => { out += chunk; }); child.stderr.on('data', chunk => { err += chunk; });
      child.once('error', reject); child.once('close', status => {
        try { if (status !== 0) throw new Error(err); done(JSON.parse(out)); } catch (error) { reject(error); }
      });
    })));
    assert.equal(results[0].job.id, results[1].job.id);
    assert.equal(results.filter(result => result.created).length, 1);
    assert.equal(new FileJobStore(dir).list().length, 2);
  });
  await test('two real writers cannot both commit a transition from one revision', async () => {
    const dir = join(root, 'revision-race');
    const store = new FileJobStore(dir);
    const { job } = store.create('key', snapshot);
    const statuses = await Promise.all(['running', 'cancelled'].map(status => new Promise<string>((done, reject) => {
      const script = `
        for (let n = 0; n < 100; n++) {
          try { store.transition(${JSON.stringify(job.id)}, ${JSON.stringify(status)}, 1); console.log('committed'); break; }
          catch (e) {
            if (e.code === 'JOB_CONFLICT') { console.log('conflict'); break; }
            if (!String(e).includes('另一个 AO')) throw e;
            await new Promise(r => setTimeout(r, 20));
          }
        }
      `;
      const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', workerSource(dir, script)], { timeout: 15000 });
      let out = '', err = '';
      child.stdout.on('data', chunk => { out += chunk; }); child.stderr.on('data', chunk => { err += chunk; });
      child.once('error', reject); child.once('close', status => status === 0 ? done(out.trim()) : reject(new Error(err)));
    })));
    assert.deepEqual(statuses.sort(), ['committed', 'conflict']);
    const current = store.get(job.id);
    assert.equal(current.revision, 2);
    assert.equal(current.events.length, 2);
  });
  if (process.platform !== 'win32') await test('symlink record and its target are never replaced', () => {
    const dir = join(root, 'link');
    const store = new FileJobStore(dir);
    const { job } = store.create('key', snapshot);
    const path = join(dir, `${job.id}.json`), real = join(dir, 'real');
    writeFileSync(real, readFileSync(path)); rmSync(path); symlinkSync(real, path);
    assert.throws(() => store.transition(job.id, 'running', 1), code('JOB_STORE_CORRUPT'));
    assert.equal(JSON.parse(readFileSync(real, 'utf-8')).revision, 1);
  });
  await test('a directory with a valid record filename is rejected', () => {
    const dir = join(root, 'directory-record');
    const store = new FileJobStore(dir);
    const { job } = store.create('key', snapshot);
    const path = join(dir, `${job.id}.json`);
    rmSync(path); mkdirSync(path);
    assert.throws(() => store.get(job.id), code('JOB_STORE_CORRUPT'));
  });
} finally { rmSync(root, { recursive: true, force: true }); }
console.log(`Job store: ${passed} scenarios passed`);
