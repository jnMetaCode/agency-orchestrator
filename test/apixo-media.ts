import assert from 'node:assert/strict';
import { generateImage } from '../src/connectors/image.js';
import { generateVideo } from '../src/connectors/video.js';
import { apixoResult } from '../src/connectors/apixo.js';
const original = globalThis.fetch;
const calls: Array<{ url: string; init?: RequestInit }> = [];
let failed = false;
globalThis.fetch = (async (url: any, init?: RequestInit) => {
  const u = String(url); calls.push({ url: u, init });
  if (u.includes('/generateTask/')) return Response.json({ code: 200, data: { taskId: 'test-task' } });
  if (u.includes('/statusTask/')) return Response.json({ code: 200, data: failed ? { state: 'failed', failMsg: 'quota exhausted' } : { state: 'success', resultJson: JSON.stringify({ resultUrls: ['https://files.example/result'] }) } });
  assert.equal(u, 'https://files.example/result');
  assert.equal((init?.headers as any)?.Authorization, undefined, 'download must not leak API key');
  return new Response(new Uint8Array([1, 2, 3]));
}) as typeof fetch;
try {
  const config = { provider: 'apixo-media', api_key: 'mock-key', model: 'unused' };
  const img = await generateImage(config, 'test', { model: 'seedream-5-5', size: '1024x1024' });
  assert.equal(img.via, 'apixo-task');
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)).input, { mode: 'text-to-image', prompt: 'test', output_format: 'png', size: '1024x1024' });
  calls.length = 0;
  let persisted = '';
  const video = await generateVideo(config, 'video', { model: 'grok-imagine-video', duration: 6, resolution: '480p', ratio: '16:9', poll_interval: 1 }, undefined, { onTask: (id: string) => { persisted = id; } });
  assert.equal(video.taskId, 'test-task');
  assert.equal(persisted, 'test-task');
  assert.equal(JSON.parse(String(calls[0].init?.body)).input.duration, 6);
  calls.length = 0;
  await generateVideo(config, 'video', { model: 'grok-imagine-video', poll_interval: 1 }, undefined, { resumeTaskId: 'test-task' });
  assert(!calls.some(c => c.url.includes('/generateTask/')), 'resuming must not submit another paid task');
  failed = true;
  await assert.rejects(generateVideo(config, 'video', { model: 'grok-imagine-video', poll_interval: 1 }), /quota exhausted/);
  assert.equal(apixoResult({ code: 200, data: { state: 'success', resultJson: 'bad' } }).phase, 'failed');
  await assert.rejects(generateVideo(config, 'video', { model: 'grok-imagine-video', duration: 31 }), /6–30/);
  console.log('APIXO image, video, resume, failure, validation and credential isolation checks passed');
} finally { globalThis.fetch = original; }
