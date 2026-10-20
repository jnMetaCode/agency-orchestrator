/**
 * 星图 AstraFlow（UCloud ModelVerse）视频：POST /v1/tasks/submit → GET /v1/tasks/status?task_id= → 下载 output.urls[0]。
 * 假服务按 2026-10-20 官方文档的报文造（MiniMax-H3 / Seedance 2.5 两页逐字段核对），统计下了几单。
 */
import http from 'node:http';
import { generateVideo, resolveVideoAccess } from '../src/connectors/video.js';
import { API_PROVIDERS, VIDEO_PROVIDERS } from '../src/connectors/api-providers.js';
import type { LLMConfig } from '../src/types.js';

let passed = 0, failed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.log(`  ❌ ${name}: ${e instanceof Error ? e.message : e}`); failed++; }
}
function assert(c: boolean, m: string): void { if (!c) throw new Error(m); }
const MP4 = Buffer.from('0000001c667479706d70343200000000', 'hex');

const state = { submits: [] as any[], polls: 0, fail: false, auth: [] as string[] };
const srv = http.createServer((req, res) => {
  state.auth.push(String(req.headers.authorization));
  const url = new URL(req.url || '/', 'http://x');
  if (req.method === 'POST' && url.pathname === '/v1/tasks/submit') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      state.submits.push(JSON.parse(body));
      res.writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ output: { task_id: `h3-${state.submits.length}` }, request_id: 'req_x' }));
    });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/v1/tasks/status') {
    state.polls++;
    const id = url.searchParams.get('task_id');
    const running = state.polls % 2 === 1;
    const output = state.fail && !running
      ? { task_id: id, task_status: 'Failure', error_message: 'content moderation rejected' }
      : running ? { task_id: id, task_status: 'Running' }
        : { task_id: id, task_status: 'Success', urls: [`http://127.0.0.1:${port}/cdn/${id}.mp4`] };
    res.writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ output, usage: { duration: 5, output_video_duration: 6 }, request_id: '' }));
    return;
  }
  if (url.pathname.startsWith('/cdn/')) { res.writeHead(200, { 'Content-Type': 'video/mp4' }).end(MP4); return; }
  res.writeHead(404).end('404 page not found');
});
await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
const port = (srv.address() as { port: number }).port;
const cfg = { provider: 'astraflow', api_key: 'sk-astra', base_url: `http://127.0.0.1:${port}/v1` } as unknown as LLMConfig;
const silent = () => {};

console.log('\n=== 星图 AstraFlow 视频（ModelVerse 任务接口） ===');
try {
  await test('同一个 key 同时是对话供应商和视频供应商（与 APIMart 同一做法）', () => {
    const api = API_PROVIDERS.find((p) => p.id === 'astraflow');
    const vid = VIDEO_PROVIDERS.find((p) => p.id === 'astraflow');
    assert(!!api && !!vid && api.envKey === vid.envKey && api.defaultBaseUrl === vid.defaultBaseUrl, '两张表的 key 与地址必须一致');
    assert(vid!.shape === 'modelverse', `形状应为 modelverse，实际 ${vid!.shape}`);
    const access = resolveVideoAccess(cfg, {});
    assert(access.spec.id === 'astraflow' && access.baseUrl === `http://127.0.0.1:${port}/v1`, '应解析到 astraflow 并沿用 base_url');
  });

  await test('文生视频：请求体与文档一致，轮询到成品并下载，记下实际出片秒数', async () => {
    const v = await generateVideo(cfg, '一只猫跳上窗台', { model: 'MiniMax-H3', resolution: '768P', duration: 6, ratio: '16:9', poll_interval: 10 }, silent);
    const body = state.submits[0];
    assert(body.model === 'MiniMax-H3', 'model 字段');
    assert(JSON.stringify(body.input) === JSON.stringify({ content: [{ type: 'text', text: '一只猫跳上窗台' }] }), `input.content 不对：${JSON.stringify(body.input)}`);
    assert(JSON.stringify(body.parameters) === JSON.stringify({ resolution: '768P', duration: 6, ratio: '16:9' }), `parameters 不对：${JSON.stringify(body.parameters)}`);
    assert(v.taskId === 'h3-1' && v.buffer.equals(MP4) && v.seconds === 6, `成品不对：${v.taskId} ${v.seconds}`);
    assert(state.auth.every((a) => a === 'Bearer sk-astra' || a === 'undefined'), '建任务与轮询都带 Bearer key');
  });

  await test('首帧图（公网 URL）按文档写进 content：image_url + role first_frame', async () => {
    await generateVideo(cfg, '让他跑起来', { model: 'doubao-seedance-2-5-260628', image: 'https://example.com/a.jpg', poll_interval: 10 }, silent);
    const content = state.submits.at(-1).input.content;
    assert(JSON.stringify(content[1]) === JSON.stringify({ type: 'image_url', image_url: { url: 'https://example.com/a.jpg' }, role: 'first_frame' }), `首帧图格式不对：${JSON.stringify(content)}`);
  });

  await test('厂商报失败：原样带出 error_message 与 task_id', async () => {
    state.fail = true;
    let msg = '';
    try { await generateVideo(cfg, '猫', { model: 'MiniMax-H3', poll_interval: 10 }, silent); } catch (e) { msg = String(e); }
    state.fail = false;
    assert(/content moderation rejected/.test(msg) && /task_id=h3-/.test(msg), `应带出厂商原因，实际：${msg}`);
  });

  await test('本地首帧图：文档写明只收公网 URL——建任务前就拒绝，一单都不下', async () => {
    const before = state.submits.length;
    let msg = '';
    try {
      await generateVideo(cfg, '猫', { model: 'MiniMax-H3', image: 'cover.png', image_bytes: Buffer.from('89504e47', 'hex'), image_name: 'cover.png', poll_interval: 10 }, silent);
    } catch (e) { msg = String(e); }
    assert(state.submits.length === before, '不应建任务');
    assert(/公网 URL/.test(msg), `应说明只收公网 URL，实际：${msg}`);
  });
} finally {
  srv.close();
}
console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed) process.exit(1);
