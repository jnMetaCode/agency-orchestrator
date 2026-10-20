/** Protocol-level continuation checks without sockets, credentials, or paid requests. */
import assert from 'node:assert/strict';
import { generateVideo } from '../src/connectors/video.js';

const originalFetch = globalThis.fetch;
const bytes = new Uint8Array([0, 0, 0, 28, 102, 116, 121, 112]);
const config = { provider: 'astraflow', api_key: 'test-only-not-a-real-key', base_url: 'https://vendor.invalid/v1' };
let passed = 0;
try {
  for (const scenario of ['existing', 'transient', 'missing', 'failed'] as const) {
    const calls: { path: string; method: string }[] = [];
    const tracked: string[] = [];
    let queries = 0, submits = 0;
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      calls.push({ path: url.pathname + url.search, method: init?.method ?? 'GET' });
      if (url.pathname === '/v1/tasks/submit') {
        submits++;
        return Response.json({ output: { task_id: 'replacement-task' } });
      }
      if (url.pathname === '/v1/tasks/status') {
        queries++;
        if (queries === 1 && scenario === 'transient') return new Response('temporary', { status: 503 });
        if (queries === 1 && scenario === 'missing') return new Response('missing', { status: 404 });
        if (queries === 1 && scenario === 'failed') return Response.json({ output: { task_status: 'Failure', error_message: 'rejected' } });
        return Response.json({ output: { task_status: 'Success', urls: ['https://cdn.invalid/clip.mp4'] }, usage: { output_video_duration: 5 } });
      }
      if (url.href === 'https://cdn.invalid/clip.mp4') return new Response(bytes);
      throw Error('Unexpected request');
    };
    const video = await generateVideo(config, 'test prompt', { model: 'MiniMax-H3', poll_interval: 1, timeout: 1000 }, undefined,
      { resumeTaskId: 'existing-task', onTask: id => tracked.push(id) });
    const replacement = scenario === 'missing' || scenario === 'failed';
    assert.equal(submits, replacement ? 1 : 0);
    assert.equal(video.taskId, replacement ? 'replacement-task' : 'existing-task');
    assert.deepEqual(tracked, [video.taskId]);
    assert.deepEqual(new Uint8Array(video.buffer), bytes);
    assert.equal(video.seconds, 5);
    assert.equal(calls[0].path, '/v1/tasks/status?task_id=existing-task');
    if (!replacement) assert(calls.every(call => call.method === 'GET'));
    console.log(`  ✓ ModelVerse continuation ${scenario}: ${submits} submit requests`);
    passed++;
  }
} finally { globalThis.fetch = originalFetch; }
console.log(`ModelVerse continuation: ${passed} scenarios passed (mock transport, no live billing verification)`);
