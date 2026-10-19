/** web/run-stream.js：运行事件缓冲（断开只退订、重开从头重放、体积有上限、结束后保留一阵再清） */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const { RunStreamHub } = await import(pathToFileURL(resolve('web/run-stream.js')).href);
let passed = 0;
function test(name: string, fn: () => void) { fn(); console.log(`  ✓ ${name}`); passed++; }
function collector() {
  const got: { type: string; data: any }[] = [];
  let ended = false;
  return { got, get ended() { return ended; }, sub: { send: (type: string, data: any) => got.push({ type, data }), end: () => { ended = true; } } };
}

test('late subscriber gets the full history, then live events', () => {
  const hub = new RunStreamHub();
  const s = hub.create('r1', { title: 'demo' });
  s.push('start', { runId: 'r1' });
  s.push('step-header', { id: 'a' });
  const c = collector();
  s.subscribe(c.sub);
  s.push('step-content', { id: 'a', text: 'x' });
  assert.deepEqual(c.got.map(e => e.type), ['start', 'step-header', 'step-content']);
});

test('subscribe after a sequence number only replays newer events', () => {
  const hub = new RunStreamHub();
  const s = hub.create('r1');
  s.push('start', {}); s.push('stdout', { text: 'a' }); s.push('stdout', { text: 'b' });
  const c = collector();
  s.subscribe(c.sub, 2);
  assert.deepEqual(c.got.map(e => e.data.text), ['b']);
});

test('unsubscribe stops delivery but the stream keeps recording', () => {
  const hub = new RunStreamHub();
  const s = hub.create('r1');
  const c = collector();
  const off = s.subscribe(c.sub);
  off();
  s.push('stdout', { text: 'later' });
  assert.equal(c.got.length, 0);
  assert.equal(s.events.length, 1);
});

test('over the size cap only raw terminal output is dropped; structural events survive', () => {
  const hub = new RunStreamHub({ maxRawChars: 10 });
  const s = hub.create('r1');
  s.push('step-header', { id: 'a' });
  s.push('stdout', { text: '1234567890' });
  s.push('step-content', { id: 'a', text: 'kept' });
  s.push('stdout', { text: 'abcdef' });
  const types = s.events.map((e: any) => e.type);
  assert.deepEqual(types, ['step-header', 'step-content', 'stdout']);
  const c = collector();
  s.subscribe(c.sub);
  assert.match(c.got[0].data.text, /省略/);
});

test('finish ends live subscribers; late subscribers get history and are closed at once', () => {
  const timers: (() => void)[] = [];
  const hub = new RunStreamHub({ retainMs: 1000, setTimer: (fn: () => void) => { timers.push(fn); return {}; } });
  const s = hub.create('r1');
  const live = collector();
  s.subscribe(live.sub);
  s.push('done', { code: 0 });
  s.finish();
  assert(live.ended);
  const late = collector();
  s.subscribe(late.sub);
  assert(late.ended && late.got.some(e => e.type === 'done'));
  assert.equal(hub.list()[0].done, true);
  timers.forEach(fn => fn());
  assert.equal(hub.get('r1'), undefined, 'expired after the retention window');
});

test('events pushed after finish are ignored', () => {
  const hub = new RunStreamHub();
  const s = hub.create('r1');
  s.finish();
  s.push('stdout', { text: 'stray' });
  assert.equal(s.events.length, 0);
});

console.log(`Run stream buffer: ${passed} scenarios passed`);
