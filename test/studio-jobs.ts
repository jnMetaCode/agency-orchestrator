/** Real run-route body + file store; injected child processes avoid sockets and LLM requests. */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { FileJobStore } from '../src/core/job-store.js';

const helpers = await import(pathToFileURL(resolve('web/run-jobs.js')).href);
const parser = await import(pathToFileURL(resolve('web/run-output-parser.js')).href);
const source = readFileSync('web/server.js', 'utf-8');
const start = source.indexOf("app.post('/api/run',");
const end = source.indexOf('// ── Feed input', start);
assert(start > 0 && end > start);
const route = source.slice(start, end);
const root = mkdtempSync(join(tmpdir(), 'ao-studio-jobs-'));
let sequence = 0, passed = 0;
async function test(name: string, fn: () => void | Promise<void>) { await fn(); console.log(`  ✓ ${name}`); passed++; }
class Response extends EventEmitter {
  statusCode = 200; headersSent = false; writableEnded = false; payload: any; chunks: string[] = [];
  status(value: number) { this.statusCode = value; return this; }
  json(value: unknown) { this.payload = value; this.writableEnded = true; return this; }
  setHeader() {} flushHeaders() { this.headersSent = true; }
  write(value: string) { this.chunks.push(value); }
  end() { this.writableEnded = true; this.emit('close'); }
}
class Child extends EventEmitter {
  stdout = new EventEmitter(); stderr = new EventEmitter(); killed = false;
  exitCode: number | null = null; signalCode: string | null = null;
  kill(signal: string) { this.killed = true; this.emit('close', null, signal); return true; }
}
function fixture() {
  const dir = join(root, String(sequence++)); mkdirSync(dir);
  const file = join(dir, 'workflow.yaml'); writeFileSync(file, 'name: example');
  const store = new FileJobStore(join(dir, 'jobs'));
  const registry = new helpers.RunJobRegistry(store);
  const children: Child[] = [], logs: string[] = [];
  const activeRuns = new Map();
  let failSpawn = false, key = 'fake-key';
  let handler: any;
  const context = {
    app: { post: (_path: string, fn: any) => { handler = fn; } },
    resolve, basename, join, readFileSync, existsSync,
    isAllowedWorkflow: (value: string) => value === file,
    DATA_DIR: dir, OUTPUT_DIR: dir, CLI: '/cli.js', NODE_BIN: process.execPath,
    cleanLLMConfig: () => ({ model: 'test-model', api_key: key, params: { thinking: 'off' } }),
    runJobs: registry, activeRuns, jobHttpError: helpers.jobHttpError, randomUUID: () => crypto.randomUUID(),
    createRunOutputParser: parser.createRunOutputParser, process: { env: {} },
    console: { log: (...args: unknown[]) => logs.push(args.join(' ')), error: (...args: unknown[]) => logs.push(args.join(' ')) },
    spawn: () => { if (failSpawn) throw new Error('spawn failed'); const child = new Child(); children.push(child); return child; },
  };
  runInNewContext(route, context);
  const run = (body: object = {}) => { const res = new Response(); handler({ body: { file, ...body } }, res); return res; };
  return { file, dir, store, registry, children, logs, activeRuns, run,
    failSpawn: () => { failSpawn = true; }, rotateKey: () => { key = 'rotated-fake-key'; } };
}
function startEvent(res: Response) {
  const frames = res.chunks.join('').split('\n\n');
  const frame = frames.find(value => value.startsWith('event: start\n'));
  assert(frame, res.chunks.join(''));
  return JSON.parse(frame.slice(frame.indexOf('data: ') + 6));
}
try {
  await test('run registers before spawn and commits completion only after close', () => {
    const f = fixture(), res = f.run({ clientRequestId: 'one' });
    const event = startEvent(res);
    assert.equal(event.runId, event.jobId);
    assert.equal(f.store.get(event.jobId).status, 'running');
    f.children[0].emit('exit', 0, null);
    assert.equal(f.store.get(event.jobId).status, 'running');
    f.children[0].stdout.emit('data', Buffer.from('final buffered output\n'));
    f.children[0].emit('close', 0, null);
    assert.equal(f.store.get(event.jobId).status, 'completed');
    assert.equal(f.store.get(event.jobId).revision, 3);
    assert(res.chunks.join('').includes('final buffered output'));
    assert.equal(f.activeRuns.size, 0);
    assert.equal(f.children[0].killed, false);
    assert.equal(f.store.get(event.jobId).displayName, 'workflow');
  });
  await test('same request ID never spawns twice; input order is canonical', () => {
    const f = fixture();
    const first = startEvent(f.run({ clientRequestId: 'same', inputs: { a: '1', b: '2' } }));
    const retry = f.run({ clientRequestId: 'same', inputs: { b: '2', a: '1' } });
    assert.equal(retry.statusCode, 409); assert.equal(retry.payload.code, 'JOB_ALREADY_EXISTS');
    assert.equal(retry.payload.jobId, first.jobId); assert.equal(retry.headersSent, false);
    assert.equal(f.children.length, 1);
  });
  await test('changed task or workflow with reused request ID conflicts before execution', () => {
    const f = fixture(); f.run({ clientRequestId: 'same', inputs: { task: 'original' } });
    const changed = f.run({ clientRequestId: 'same', inputs: { task: 'changed' } });
    assert.equal(changed.statusCode, 409); assert.equal(changed.payload.code, 'JOB_CONFLICT');
    writeFileSync(f.file, 'name: changed');
    assert.equal(f.run({ clientRequestId: 'same', inputs: { task: 'original' } }).payload.code, 'JOB_CONFLICT');
    assert.equal(f.children.length, 1);
  });
  await test('explicit provider credential changes conflict without persisting keys or prompts', () => {
    const f = fixture(); const started = startEvent(f.run({ clientRequestId: 'one', provider: 'test', inputs: { task: 'private-prompt' }, feedback: 'private-feedback' }));
    assert(!JSON.stringify(started).includes('private-prompt'));
    assert(!JSON.stringify(started).includes('fake-key'));
    assert(!JSON.stringify(started).includes('private-feedback'));
    f.rotateKey();
    assert.equal(f.run({ clientRequestId: 'one', provider: 'test', inputs: { task: 'private-prompt' }, feedback: 'private-feedback' }).payload.code, 'JOB_CONFLICT');
    const json = readdirSync(join(f.dir, 'jobs')).filter(name => name.endsWith('.json')).map(name => readFileSync(join(f.dir, 'jobs', name), 'utf-8')).join('');
    for (const secret of ['fake-key', 'private-prompt', 'private-feedback']) {
      assert(!json.includes(secret)); assert(!f.logs.join('').includes(secret));
    }
  });
  await test('sync spawn failure is persisted; async spawn error cleans active map once', () => {
    const sync = fixture(); sync.failSpawn();
    const res = sync.run(); assert.equal(sync.store.list()[0].status, 'failed'); assert(res.writableEnded);
    const async = fixture(); const asyncRes = async.run();
    async.children[0].emit('error', Object.assign(new Error('not installed'), { code: 'ENOENT' }));
    const revision = async.store.list()[0].revision;
    async.children[0].emit('close', -2, null);
    assert.equal(async.store.list()[0].status, 'failed'); assert.equal(async.store.list()[0].revision, revision);
    assert.equal(async.activeRuns.size, 0); assert(asyncRes.writableEnded);
  });
  await test('nonzero and signal exits are not recorded as successful completion', () => {
    for (const [exit, signal, expected] of [[7, null, 'failed'], [null, 'SIGTERM', 'interrupted']] as const) {
      const f = fixture(); f.run(); f.children[0].emit('close', exit, signal);
      assert.equal(f.store.list()[0].status, expected);
    }
  });
  await test('disconnect retains existing stop behavior and records interruption', () => {
    const f = fixture(), res = f.run(); res.end();
    assert(f.children[0].killed); assert.equal(f.store.list()[0].status, 'interrupted');
  });
  await test('storage failure during registration still runs the workflow, untracked and without leaking details', () => {
    // Bookkeeping must not block work: one corrupt record would otherwise stop every Studio run.
    const f = fixture(); f.registry.register = () => { throw new Error('fake-key and private path'); };
    const res = f.run(); assert.equal(res.statusCode, 200); assert.equal(f.children.length, 1);
    const output = res.chunks.join('');
    assert(output.includes('JOB_STORAGE_ERROR') && !output.includes('fake-key') && !f.logs.join(' ').includes('fake-key'));
    f.children[0].emit('close', 0, null);
    assert.equal(f.store.list().length, 0); assert(res.writableEnded); assert.equal(f.activeRuns.size, 0);
  });
  await test('a corrupt record in the real store does not block new runs', () => {
    const f = fixture(); const first = startEvent(f.run()); f.children[0].emit('close', 0, null);
    writeFileSync(join(f.dir, 'jobs', `${first.jobId}.json`), '{ broken');
    const res = f.run(); assert.equal(res.statusCode, 200); assert.equal(f.children.length, 2);
    assert(res.chunks.join('').includes('JOB_STORE_CORRUPT'));
  });
  await test('final persistence failure is reported without crashing or falsely committing completion', () => {
    const f = fixture(), res = f.run();
    f.registry.finish = () => { throw new Error('simulated disk full'); };
    f.children[0].emit('close', 0, null);
    assert(res.chunks.join('').includes('JOB_STORAGE_ERROR'));
    assert(res.writableEnded); assert.equal(f.activeRuns.size, 0);
    assert.equal(f.store.list()[0].status, 'running');
  });
  await test('completed jobs still deduplicate after recreating the registry', () => {
    const f = fixture(), res = f.run({ clientRequestId: 'restart-key' });
    const first = startEvent(res);
    f.children[0].emit('close', 0, null);
    const registry = new helpers.RunJobRegistry(new FileJobStore(join(f.dir, 'jobs')));
    const again = registry.register({ clientRequestId: 'restart-key', workflowText: readFileSync(f.file, 'utf-8'),
      request: { file: f.file, args: ['/cli.js', 'run', f.file] }, connection: { childLlmEnv: {}, childApiKey: '' } });
    assert.equal(again.created, false); assert.equal(again.job.id, first.jobId); assert.equal(again.job.status, 'completed');
  });
  await test('invalid request ID is rejected without a worker or task record', () => {
    const f = fixture(); const res = f.run({ clientRequestId: '' });
    assert.equal(res.statusCode, 400); assert.equal(f.children.length, 0); assert.equal(f.store.list().length, 0);
  });
  await test('read routes survive new store instances and validate cursors and paths', () => {
    const f = fixture(); const start = startEvent(f.run({ clientRequestId: 'one' }));
    f.children[0].emit('close', 0, null);
    const handlers = new Map<string, any>();
    helpers.registerJobReadRoutes({ get: (path: string, fn: any) => handlers.set(path, fn) }, new FileJobStore(join(f.dir, 'jobs')));
    const invoke = (path: string, query = {}, id = start.jobId) => {
      const res = new Response(); handlers.get(path)({ query, params: { id } }, res); return res;
    };
    assert.equal(invoke('/api/jobs').payload.jobs.length, 1);
    assert.equal(invoke('/api/jobs/:id').payload.job.status, 'completed');
    assert.deepEqual(invoke('/api/jobs/:id/events', { afterSequence: '1' }).payload.events.map((event: any) => event.sequence), [2, 3]);
    assert.equal(invoke('/api/jobs', { limit: '1000000' }).statusCode, 400);
    assert.equal(invoke('/api/jobs/:id/events', { afterSequence: 'bad' }).statusCode, 400);
    assert.equal(invoke('/api/jobs/:id', {}, '../outside').statusCode, 400);
    assert.equal(invoke('/api/jobs/:id', {}, '12345678-1234-4234-8234-123456789abc').statusCode, 404);
  });
  await test('activity observation is local and ephemeral, never inferred from persisted running state', () => {
    const f = fixture(), started = startEvent(f.run());
    const handlers = new Map<string, any>();
    const app = { get: (path: string, fn: any) => handlers.set(path, fn) };
    const invoke = (path: string) => {
      const res = new Response(); handlers.get(path)({ query: {}, params: { id: started.jobId } }, res); return res.payload;
    };
    helpers.registerJobReadRoutes(app, f.store, { isActive: (id: string) => helpers.isRunActive(f.activeRuns.get(id)) });
    assert.equal(invoke('/api/jobs').jobs[0].activeInThisInstance, true);
    assert.equal(invoke('/api/jobs/:id/events').job.activeInThisInstance, true);
    assert.equal(f.store.get(started.jobId).revision, 2);
    // Exited workers can still have unread pipes; map presence alone is not active evidence.
    f.children[0].exitCode = 0;
    assert.equal(invoke('/api/jobs/:id').job.activeInThisInstance, false);
    helpers.registerJobReadRoutes(app, new FileJobStore(join(f.dir, 'jobs')));
    const recovered = invoke('/api/jobs/:id').job;
    assert.equal(recovered.status, 'running');
    assert.equal(recovered.activeInThisInstance, false);
    assert(!readFileSync(join(f.dir, 'jobs', `${started.jobId}.json`), 'utf-8').includes('activeInThisInstance'));
    f.children[0].emit('close', 0, null);
    assert.equal(invoke('/api/jobs/:id').job.activeInThisInstance, false);
  });
} finally { rmSync(root, { recursive: true, force: true }); }
console.log(`Studio job integration: ${passed} scenarios passed`);
