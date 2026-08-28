/**
 * 文生视频步骤（type: video）。
 *
 * 视频 API 与图片最大的不同是**异步**：建任务 → 轮询 → 下载签名链接。这里钉住的除了
 * 正常链路，主要是几条真机探出来的坑与花钱纪律：
 *   - 查询接口**不严格匹配 task_id**（秘塔实测：传 task_id=1 也回全量列表），
 *     必须按 id 精确过滤，否则并发跑两个视频步骤会张冠李戴
 *   - 失败要原样带出厂商的 error.code/message，超时要说清"任务还在跑、钱可能花了"
 *   - 模型必填（不猜）、非视频 provider 给可读报错、mp4 的 base64 绝不进 metadata
 */
import http from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateVideo, resolveVideoAccess } from '../src/connectors/video.js';
import { parseWorkflow } from '../src/core/parser.js';
import { saveResults } from '../src/output/reporter.js';
import type { LLMConfig, WorkflowResult } from '../src/types.js';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return new Promise<void>((r) => r(fn())).then(
    () => { console.log(`  ✅ ${name}`); passed++; },
    (err) => { console.log(`  ❌ ${name}: ${err instanceof Error ? err.message : err}`); failed++; },
  );
}
function assert(c: boolean, m: string): void { if (!c) throw new Error(m); }
const listen = async (srv: http.Server): Promise<number> => {
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  return (srv.address() as { port: number }).port;
};
const MP4 = Buffer.from('0000001c667479706d70343200000000', 'hex');   // 够用的假 mp4 头
const cfg = (o: Record<string, unknown> = {}): LLMConfig =>
  ({ provider: 'metaso', api_key: 'mk-test', ...o } as unknown as LLMConfig);

await test('video.provider 指定另一家时，不带文本供应商的 base_url / api_key', () => {
  const prev = process.env.METASO_API_KEY; process.env.METASO_API_KEY = 'mk-env';
  try {
    const r = resolveVideoAccess(cfg({ provider: 'deepseek', api_key: 'dk-text', base_url: 'https://text.example/v1' }), { provider: 'metaso' });
    assert(r.apiKey === 'mk-env', `应用 metaso 自己的 key，实际 ${r.apiKey}`);
    assert(!/text\.example/.test(r.baseUrl), `不应带上文本供应商 base_url，实际 ${r.baseUrl}`);
  } finally { if (prev === undefined) delete process.env.METASO_API_KEY; else process.env.METASO_API_KEY = prev; }
});

/**
 * 一个按秘塔实测契约行为的假服务：
 *   POST /v2/video_generation        → {"task_id": "…"}
 *   GET  /v2/query/video_generation  → {"items":[…]}（**故意忽略 task_id 参数、返回全量**）
 *   GET  /file.mp4                   → mp4 字节
 */
function fakeMetaso(opts: {
  status?: string;                 // 目标任务的最终状态
  pendingRounds?: number;          // 前几轮返回 processing
  error?: { code: string; message: string };
  createStatus?: number;
  createBody?: string;
} = {}) {
  const seen: { createBody?: any; queries: number } = { queries: 0 };
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://x');
    if (req.method === 'POST' && url.pathname.endsWith('/v2/video_generation')) {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        seen.createBody = JSON.parse(body || '{}');
        if (opts.createStatus && opts.createStatus >= 400) {
          res.writeHead(opts.createStatus, { 'Content-Type': 'application/json' });
          return res.end(opts.createBody ?? '{"type":"error","error":{"message":"boom"}}');
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ task_id: '2091363060444401664' }));
      });
      return;
    }
    if (url.pathname.endsWith('/v2/query/video_generation')) {
      seen.queries++;
      const pending = (opts.pendingRounds ?? 0) >= seen.queries;
      // 第一条是**别人的**已完成任务：拿 items[0] 当结果就会取错（真机上就是这个形状）
      const items: any[] = [
        { id: '2090760201004867584', status: 'succeeded', content: { url: `http://127.0.0.1:${port}/other.mp4` }, usage: { total_seconds: 4 } },
        {
          id: '2091363060444401664',
          status: pending ? 'processing' : (opts.status ?? 'succeeded'),
          ...(opts.error ? { error: opts.error } : {}),
          ...(!pending && (opts.status ?? 'succeeded') === 'succeeded'
            ? { content: { url: `http://127.0.0.1:${port}/mine.mp4?expires=1&signature=x` }, usage: { total_seconds: 5 } }
            : {}),
        },
      ];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ items, total: items.length }));
    }
    if (url.pathname === '/mine.mp4') {
      res.writeHead(200, { 'Content-Type': 'video/mp4' });
      return res.end(MP4);
    }
    if (url.pathname === '/other.mp4') {
      res.writeHead(200, { 'Content-Type': 'video/mp4' });
      return res.end(Buffer.from('WRONG-VIDEO'));
    }
    res.writeHead(404).end('{}');
  });
  let port = 0;
  return { srv, seen, setPort: (p: number) => { port = p; } };
}

console.log('\n─── 解析期就拦住的错误（视频更贵更慢，别等几分钟才发现） ───');

await test('video 步骤不需要 role，task 就是视频提示词', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ao-vid-wf-'));
  const f = join(dir, 'w.yaml');
  writeFileSync(f, 'name: "x"\nllm:\n  provider: "metaso"\n  model: "m"\nsteps:\n  - id: a\n    type: video\n    task: "一只猫跳上窗台"\n    video:\n      model: "MiniMax-H3"\n', 'utf-8');
  const wf = parseWorkflow(f);
  assert(wf.steps[0].type === 'video' && !wf.steps[0].role, '应通过且无需 role');
  rmSync(dir, { recursive: true, force: true });
});

await test('缺 video.model 在解析期就报错（不猜模型编码）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ao-vid-wf-'));
  const f = join(dir, 'w.yaml');
  writeFileSync(f, 'name: "x"\nllm:\n  provider: "metaso"\n  model: "m"\nsteps:\n  - id: a\n    type: video\n    task: "猫"\n', 'utf-8');
  let msg = '';
  try { parseWorkflow(f); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
  assert(/video: \{ model/.test(msg), `报错应指明要写 video.model，实际：${msg}`);
  rmSync(dir, { recursive: true, force: true });
});

await test('video 步骤：acceptance 放行（抽帧看图验收）、assert 直接报错不静默忽略', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ao-vid-wf-'));
  const f = join(dir, 'w.yaml');
  writeFileSync(f, 'name: "x"\nllm:\n  provider: "metaso"\n  model: "m"\nsteps:\n  - id: a\n    type: video\n    task: "猫"\n    acceptance: "有猫"\n    video:\n      model: "MiniMax-H3"\n', 'utf-8');
  assert(parseWorkflow(f).steps[0].acceptance === '有猫', 'acceptance 应通过解析');
  writeFileSync(f, 'name: "x"\nllm:\n  provider: "metaso"\n  model: "m"\nsteps:\n  - id: a\n    type: video\n    task: "猫"\n    assert:\n      contains: ["x"]\n    video:\n      model: "MiniMax-H3"\n', 'utf-8');
  let msg = '';
  try { parseWorkflow(f); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
  assert(/assert/.test(msg) && /不支持/.test(msg), `应明说不支持 assert，实际：${msg}`);
  rmSync(dir, { recursive: true, force: true });
});

console.log('\n─── 端点与凭证解析 ───');

await test('完全不认识的 provider 给可读报错，并列出可用的视频供应商', () => {
  let msg = '';
  try { resolveVideoAccess(cfg({ provider: 'no-such-vendor' }), {}); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
  assert(/不是/.test(msg) && /metaso/.test(msg), `应点破并给出可用项，实际：${msg}`);
});

await test('OpenAI 兼容但不在视频表的（deepseek）按 openai-videos 形状解析；真没端点时 404 说清并指向 doctor --video-probe', async () => {
  const r = resolveVideoAccess(cfg({ provider: 'deepseek' }), {});
  assert(r.spec.shape === 'openai-videos' && r.spec.id === 'deepseek', `应合成 openai-videos 形状，实际 ${JSON.stringify(r.spec)}`);
  const srv = http.createServer((_req, res) => { res.writeHead(404).end('{"error":"not found"}'); });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()));
  const port = (srv.address() as { port: number }).port;
  try {
    let msg = '';
    try { await generateVideo(cfg({ provider: 'deepseek', base_url: `http://127.0.0.1:${port}/v1` }), '猫', { model: 'sora-2', poll_interval: 10 }); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
    assert(/没有视频端点/.test(msg) && /video-probe/.test(msg) && /metaso/.test(msg), `404 应说清并给出路，实际：${msg.slice(0, 160)}`);
  } finally { srv.close(); }
});

await test('缺 key 时报错指明环境变量名', () => {
  const saved = process.env.METASO_API_KEY;
  delete process.env.METASO_API_KEY;
  let msg = '';
  try { resolveVideoAccess({ provider: 'metaso' } as LLMConfig, {}); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
  if (saved) process.env.METASO_API_KEY = saved;
  assert(/METASO_API_KEY/.test(msg), `应指明 env 名，实际：${msg}`);
});

await test('video.provider 可覆盖 llm.provider（一条工作流里文本走一家、视频走另一家）', () => {
  // 视频供应商用**自己**的 key（env），不是 llm.api_key——那把是文本供应商的
  const prev = process.env.METASO_API_KEY; process.env.METASO_API_KEY = 'mk-env';
  try {
    const r = resolveVideoAccess(cfg({ provider: 'deepseek' }), { provider: 'metaso' });
    assert(r.spec.id === 'metaso' && r.baseUrl.includes('metaso.cn'), `应解析到秘塔，实际 ${r.spec?.id} ${r.baseUrl}`);
  } finally { if (prev === undefined) delete process.env.METASO_API_KEY; else process.env.METASO_API_KEY = prev; }
});

console.log('\n─── 异步链路：建任务 → 轮询 → 下载 ───');

await test('完整链路跑通，拿到 mp4 字节与计费秒数', async () => {
  const fake = fakeMetaso({ pendingRounds: 1 });
  const port = await listen(fake.srv);
  fake.setPort(port);
  try {
    const v = await generateVideo(
      cfg({ base_url: `http://127.0.0.1:${port}` }),
      '一只猫跳上窗台',
      { model: 'MiniMax-H3', resolution: '768P', duration: 5, ratio: '16:9', poll_interval: 10 },
    );
    assert(v.buffer.equals(MP4), '应拿到我们那条任务的 mp4');
    assert(v.taskId === '2091363060444401664', `task_id 应带回，实际 ${v.taskId}`);
    assert(v.seconds === 5, `应带回计费秒数，实际 ${v.seconds}`);
    assert(fake.seen.queries >= 2, '应至少轮询到 processing 之后再拿结果');
  } finally { fake.srv.close(); }
});

await test('按 task_id 精确过滤——绝不把列表里别人的成品当自己的', async () => {
  const fake = fakeMetaso();
  const port = await listen(fake.srv);
  fake.setPort(port);
  try {
    const v = await generateVideo(
      cfg({ base_url: `http://127.0.0.1:${port}` }),
      'x',
      { model: 'MiniMax-H3', poll_interval: 10 },
    );
    assert(!v.buffer.toString().includes('WRONG-VIDEO'), '取到了列表里第一条（别人的）任务——按 id 过滤失效');
    assert(v.buffer.equals(MP4), '应取自己那条');
  } finally { fake.srv.close(); }
});

await test('resolution / duration / ratio 原样进请求体（不替用户放大）', async () => {
  const fake = fakeMetaso();
  const port = await listen(fake.srv);
  fake.setPort(port);
  try {
    await generateVideo(
      cfg({ base_url: `http://127.0.0.1:${port}` }),
      '猫',
      { model: 'MiniMax-H3', resolution: '2K', duration: 7, ratio: '9:16', poll_interval: 10 },
    );
    const b = fake.seen.createBody;
    assert(b.model === 'MiniMax-H3' && b.resolution === '2K' && b.duration === 7 && b.ratio === '9:16',
      `参数没原样透传：${JSON.stringify(b)}`);
    assert(b.content?.[0]?.text === '猫', `提示词应放在 content[0].text，实际 ${JSON.stringify(b.content)}`);
  } finally { fake.srv.close(); }
});

await test('任务失败时原样带出厂商的 code/message 与 task_id', async () => {
  const fake = fakeMetaso({ status: 'failed', error: { code: '1000', message: 'video generation failed' } });
  const port = await listen(fake.srv);
  fake.setPort(port);
  let msg = '';
  try {
    await generateVideo(cfg({ base_url: `http://127.0.0.1:${port}` }), 'x', { model: 'MiniMax-H3', poll_interval: 10 });
  } catch (e) { msg = e instanceof Error ? e.message : String(e); } finally { fake.srv.close(); }
  assert(/video generation failed/.test(msg) && /1000/.test(msg) && /2091363060444401664/.test(msg),
    `报错要能拿去对账，实际：${msg}`);
});

await test('建任务就被拒（如余额不足）→ 原样报出，不轮询', async () => {
  const fake = fakeMetaso({ createStatus: 402, createBody: '{"type":"error","error":{"type":"insufficient_balance_error","message":"H3 积分余额不足 (1008)"}}' });
  const port = await listen(fake.srv);
  fake.setPort(port);
  let msg = '';
  try {
    await generateVideo(cfg({ base_url: `http://127.0.0.1:${port}` }), 'x', { model: 'MiniMax-H3', poll_interval: 10 });
  } catch (e) { msg = e instanceof Error ? e.message : String(e); } finally { fake.srv.close(); }
  assert(/402/.test(msg) && /余额不足/.test(msg), `应原样带出厂商正文，实际：${msg}`);
  assert(fake.seen.queries === 0, '建任务失败后不该再轮询');
});

await test('超时报错带 task_id，并说清"任务可能还在跑、费用可能已产生"', async () => {
  const fake = fakeMetaso({ pendingRounds: 999 });
  const port = await listen(fake.srv);
  fake.setPort(port);
  let msg = '';
  try {
    await generateVideo(cfg({ base_url: `http://127.0.0.1:${port}` }), 'x',
      { model: 'MiniMax-H3', poll_interval: 10, timeout: 120 });
  } catch (e) { msg = e instanceof Error ? e.message : String(e); } finally { fake.srv.close(); }
  assert(/超时/.test(msg) && /2091363060444401664/.test(msg) && /费用/.test(msg), `实际：${msg}`);
});

await test('缺 model 时连请求都不发', async () => {
  let msg = '';
  try { await generateVideo(cfg(), 'x', {}); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
  assert(/video: \{ model/.test(msg), `实际：${msg}`);
});

console.log('\n─── 第二家（APIMart）：形状完全不同，主流程不该为它改一行 ───');

/**
 * APIMart 形状的假服务。与秘塔那家没有一处相同：
 *   建任务 POST v1/videos/generations，提示词字段是 prompt、宽高比字段是 aspect_ratio
 *   回执    {"code":200,"data":[{"status":"submitted","task_id":"task_01K8…"}]}
 *   查询    GET v1/tasks/{id}（id 在路径里，不是 query）
 *   完成词  completed（不是 succeeded），成品在 data.result.videos[].url
 */
function fakeApimart(opts: { failWith?: string; pendingRounds?: number } = {}) {
  const seen: { createBody?: any; queries: string[]; uploadBytes?: number; uploadContentType?: string } = { queries: [] };
  const MP4X = Buffer.from('0000001c66747970415049', 'hex');
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://x');
    if (req.method === 'POST' && url.pathname.endsWith('/uploads/images')) {
      let n = 0;
      req.on('data', (c) => { n += c.length; });
      req.on('end', () => {
        seen.uploadBytes = n;
        seen.uploadContentType = String(req.headers['content-type'] || '');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ url: `http://127.0.0.1:${port}/f/image/abc.png`, filename: 'first.png', bytes: n }));
      });
      return;
    }
    if (req.method === 'POST' && url.pathname.endsWith('/videos/generations')) {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        seen.createBody = JSON.parse(body || '{}');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 200, data: [{ status: 'submitted', task_id: 'task_01K8SGYNNNVBQTXNR4MM964S7K' }] }));
      });
      return;
    }
    if (url.pathname.includes('/tasks/')) {
      seen.queries.push(url.pathname);
      const pending = (opts.pendingRounds ?? 0) >= seen.queries.length;
      const body = opts.failWith
        ? { code: 200, data: { id: 'task_01K8SGYNNNVBQTXNR4MM964S7K', status: 'failed', error: { code: 5001, message: opts.failWith } } }
        : pending
          ? { code: 200, data: { id: 'task_01K8SGYNNNVBQTXNR4MM964S7K', status: 'processing', progress: 42 } }
          : { code: 200, data: { id: 'task_01K8SGYNNNVBQTXNR4MM964S7K', status: 'completed', progress: 100, actual_time: 37, result: { videos: [{ url: `http://127.0.0.1:${port}/out.mp4` }] } } };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(body));
    }
    if (url.pathname === '/out.mp4') { res.writeHead(200, { 'Content-Type': 'video/mp4' }); return res.end(MP4X); }
    res.writeHead(404).end('{}');
  });
  let port = 0;
  return { srv, seen, MP4X, setPort: (p: number) => { port = p; } };
}

console.log('\n─── 火山方舟 ark 形状（2026-08-26 真机核实的响应） ───');

await test('方舟：POST contents/generations/tasks → 轮询 status → content.video_url 直链下载；首帧图进 content[]', async () => {
  const seen: { create?: any; polls: number } = { polls: 0 };
  const MP4A = Buffer.from('0000001c6674797041524b00', 'hex');
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://x');
    if (req.method === 'POST' && url.pathname === '/api/v3/contents/generations/tasks') {
      let body = ''; req.on('data', (c) => { body += c; });
      req.on('end', () => { seen.create = JSON.parse(body); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ id: 'cgt-2026-x' })); });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/v3/contents/generations/tasks/cgt-2026-x') {
      seen.polls++;
      const done = seen.polls >= 2;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(done
        ? { id: 'cgt-2026-x', model: 'doubao-seedance-1-0-pro-fast-251015', status: 'succeeded', content: { video_url: `http://127.0.0.1:${(res.socket as any).localPort}/signed.mp4?X-Tos-Signature=abc` }, usage: { completion_tokens: 49005 }, duration: 5, resolution: '480p', ratio: '16:9' }
        : { id: 'cgt-2026-x', status: 'running' }));
    }
    if (url.pathname === '/signed.mp4') { res.writeHead(200, { 'Content-Type': 'video/mp4' }); return res.end(MP4A); }
    res.writeHead(404).end('{}');
  });
  const port = await listen(srv);
  try {
    const v = await generateVideo(
      { provider: 'volcengine', api_key: 'ark-t', base_url: `http://127.0.0.1:${port}/api/v3` } as unknown as LLMConfig,
      '一只橘猫',
      { provider: 'volcengine', model: 'doubao-seedance-1-0-pro-fast-251015', duration: 5, resolution: '480p', ratio: '16:9', poll_interval: 10, image: 'https://cdn.example.com/first.png' },
    );
    assert(v.buffer.equals(MP4A) && v.taskId === 'cgt-2026-x' && v.seconds === 5, `实际 ${v.taskId} ${v.seconds}`);
    const b = seen.create;
    assert(b.model === 'doubao-seedance-1-0-pro-fast-251015' && b.resolution === '480p' && b.duration === 5 && b.ratio === '16:9', `字段：${JSON.stringify(b)}`);
    assert(Array.isArray(b.content) && b.content[0].type === 'text' && b.content[0].text === '一只橘猫', 'content[0] 是文本');
    assert(b.content[1]?.type === 'image_url' && b.content[1].image_url?.url === 'https://cdn.example.com/first.png' && b.content[1].role === 'first_frame', `首帧图项：${JSON.stringify(b.content[1])}`);
  } finally { srv.close(); }
});

console.log('\n─── OpenAI Videos 形状（任何 OpenAI 兼容中转站都可按它试） ───');

function fakeOpenAIVideos() {
  const seen: { create?: any; createContentType?: string; contentAuth?: string; polls: number } = { polls: 0 };
  const MP4O = Buffer.from('0000001c667479704f50454e', 'hex');
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://x');
    if (req.method === 'POST' && url.pathname === '/v1/videos') {
      let body = ''; req.on('data', (c) => { body += c; });
      req.on('end', () => {
        seen.createContentType = String(req.headers['content-type'] || '');
        try { seen.create = JSON.parse(body); } catch { seen.create = { raw: body.slice(0, 400) }; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'video_123', object: 'video', status: 'queued', model: 'sora-2', seconds: '8', size: '1280x720' }));
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/v1/videos/video_123/content') {
      seen.contentAuth = String(req.headers['authorization'] || '');
      res.writeHead(200, { 'Content-Type': 'video/mp4' }); return res.end(MP4O);
    }
    if (req.method === 'GET' && url.pathname === '/v1/videos/video_123') {
      seen.polls++;
      const done = seen.polls >= 2;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ id: 'video_123', object: 'video', status: done ? 'completed' : 'in_progress', progress: done ? 100 : 40, seconds: '8', error: null }));
    }
    res.writeHead(404).end('{}');
  });
  return { srv, seen, MP4O };
}

await test('不在视频表的 OpenAI 兼容供应商（如 openai）按 openai-videos 形状：POST /videos → 轮询 → 带鉴权下载 /content', async () => {
  const fake = fakeOpenAIVideos();
  const port = await listen(fake.srv);
  const prev = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'sk-env';
  try {
    const v = await generateVideo(
      { provider: 'openai', api_key: 'sk-t', base_url: `http://127.0.0.1:${port}/v1` } as unknown as LLMConfig,
      '一只橘猫',
      { model: 'sora-2', duration: 8, ratio: '16:9', poll_interval: 10 },
    );
    assert(v.buffer.equals(fake.MP4O) && v.taskId === 'video_123', '应拿到 OpenAI 形状的 mp4 与 id');
    const b = fake.seen.create;
    assert(b.model === 'sora-2' && b.prompt === '一只橘猫' && b.seconds === '8' && b.size === '1280x720', `字段应按 OpenAI Videos：${JSON.stringify(b)}`);
    assert(/^Bearer /.test(fake.seen.contentAuth || ''), '下载 /content 必须带 Authorization');
    assert(v.seconds === 8, `计费秒数取 seconds，实际 ${v.seconds}`);
  } finally { fake.srv.close(); if (prev === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prev; }
});

await test('Agnes（openai-videos 变体）：建任务自动带 mode:"text"，size 原样透传档位名 720P（真机 2026-08-26 核实）', async () => {
  const fake = fakeOpenAIVideos();
  const port = await listen(fake.srv);
  const prev = process.env.AGNES_API_KEY; process.env.AGNES_API_KEY = 'ak-env';
  try {
    await generateVideo({ provider: 'agnes', api_key: 'ak', base_url: `http://127.0.0.1:${port}/v1` } as unknown as LLMConfig, '猫', { provider: 'agnes', model: 'agnes-video-2.5-flash', duration: 4, resolution: '720P', poll_interval: 10 });
    const b = fake.seen.create;
    assert(b.mode === 'text' && b.size === '720P' && b.seconds === '4' && b.model === 'agnes-video-2.5-flash', `实际 ${JSON.stringify(b)}`);
  } finally { fake.srv.close(); if (prev === undefined) delete process.env.AGNES_API_KEY; else process.env.AGNES_API_KEY = prev; }
});

await test('只在 config.provider 里给供应商（脚本的调法）时，Agnes 的 mode:"text" 也要带上', async () => {
  const fake = fakeOpenAIVideos();
  const port = await listen(fake.srv);
  try {
    await generateVideo({ provider: 'agnes', api_key: 'ak', base_url: `http://127.0.0.1:${port}/v1` } as unknown as LLMConfig, '猫', { model: 'agnes-video-2.5-flash', duration: 4, resolution: '720P', poll_interval: 10 });
    assert(fake.seen.create?.mode === 'text', `应带 mode:text，实际 ${JSON.stringify(fake.seen.create)}`);
  } finally { fake.srv.close(); }
});

await test('openai-videos 带本地首帧图：不上传，直接 multipart 内联 input_reference', async () => {
  const fake = fakeOpenAIVideos();
  const port = await listen(fake.srv);
  try {
    await generateVideo(
      { provider: 'openai', api_key: 'sk-t', base_url: `http://127.0.0.1:${port}/v1` } as unknown as LLMConfig,
      '猫',
      { model: 'sora-2', duration: 4, poll_interval: 10, image_bytes: Buffer.from('89504e47', 'hex'), image_name: 'cover.png' },
    );
    assert(/multipart\/form-data/.test(fake.seen.createContentType || ''), `应为 multipart，实际 ${fake.seen.createContentType}`);
    assert(/input_reference/.test(fake.seen.create?.raw || ''), '表单里应有 input_reference');
  } finally { fake.srv.close(); }
});

console.log('\n─── 图生视频（首帧图） ───');

await test('APIMart 本地首帧图：先走 /uploads/images 拿 URL，sora/veo 放 image_urls[]', async () => {
  const fake = fakeApimart();
  const port = await listen(fake.srv);
  fake.setPort(port);
  try {
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    await generateVideo(
      { provider: 'apimart', api_key: 'sk-t', base_url: `http://127.0.0.1:${port}` } as unknown as LLMConfig,
      '橘猫',
      { model: 'veo3.1-fast', duration: 8, poll_interval: 10, image_bytes: png, image_name: 'cover.png' },
    );
    assert((fake.seen.uploadBytes ?? 0) > png.length && /multipart\/form-data/.test(fake.seen.uploadContentType || ''), `应以 multipart 上传，实际 ${fake.seen.uploadContentType} ${fake.seen.uploadBytes}`);
    const b = fake.seen.createBody;
    assert(Array.isArray(b.image_urls) && b.image_urls[0].includes('/f/image/abc.png'), `veo 应把上传得到的 URL 放 image_urls[]，实际 ${JSON.stringify(b)}`);
    assert(b.first_frame_image === undefined, 'veo 不该用 first_frame_image');
  } finally { fake.srv.close(); }
});

await test('APIMart 字段按模型：可灵的档位叫 mode、Wan 的宽高比叫 size（文档逐页核对）', async () => {
  const fake = fakeApimart();
  const port = await listen(fake.srv);
  fake.setPort(port);
  const c = { provider: 'apimart', api_key: 'sk-t', base_url: `http://127.0.0.1:${port}` } as unknown as LLMConfig;
  try {
    await generateVideo(c, '猫', { model: 'kling-v3', resolution: 'pro', ratio: '9:16', duration: 5, poll_interval: 10 });
    let b = fake.seen.createBody;
    assert(b.mode === 'pro' && b.resolution === undefined && b.aspect_ratio === '9:16', `可灵应发 mode，实际 ${JSON.stringify(b)}`);
    await generateVideo(c, '猫', { model: 'wan2.7', resolution: '1080P', ratio: '1:1', duration: 5, poll_interval: 10 });
    b = fake.seen.createBody;
    assert(b.size === '1:1' && b.aspect_ratio === undefined && b.resolution === '1080P', `Wan 应发 size，实际 ${JSON.stringify(b)}`);
  } finally { fake.srv.close(); }
});

await test('APIMart 上的 MiniMax-H3 用 first_frame_image；公网 URL 不上传直接用', async () => {
  const fake = fakeApimart();
  const port = await listen(fake.srv);
  fake.setPort(port);
  try {
    await generateVideo(
      { provider: 'apimart', api_key: 'sk-t', base_url: `http://127.0.0.1:${port}` } as unknown as LLMConfig,
      '橘猫',
      { model: 'MiniMax-H3', duration: 5, poll_interval: 10, image: 'https://cdn.example.com/first.png' },
    );
    assert(fake.seen.uploadBytes === undefined, '公网 URL 不该触发上传');
    assert(fake.seen.createBody.first_frame_image === 'https://cdn.example.com/first.png', `H3 应用 first_frame_image，实际 ${JSON.stringify(fake.seen.createBody)}`);
  } finally { fake.srv.close(); }
});

await test('秘塔：公网 URL 进 content[] 的 image_url 项（role=first_frame）；本地图明确报错而不是白花一次', async () => {
  const fake = fakeMetaso();
  const port = await listen(fake.srv);
  fake.setPort(port);
  try {
    await generateVideo(cfg({ base_url: `http://127.0.0.1:${port}` }), '橘猫', { model: 'MiniMax-H3', poll_interval: 10, image: 'https://cdn.example.com/first.png' });
    const c = fake.seen.createBody.content;
    assert(Array.isArray(c) && c.some((x: any) => x.type === 'image_url' && x.image_url?.url === 'https://cdn.example.com/first.png' && x.role === 'first_frame'), `content 里应有 image_url 项，实际 ${JSON.stringify(c)}`);
    let msg = '';
    try {
      await generateVideo(cfg({ base_url: `http://127.0.0.1:${port}` }), '橘猫', { model: 'MiniMax-H3', poll_interval: 10, image_bytes: Buffer.from('x'), image_name: 'a.png' });
    } catch (e) { msg = e instanceof Error ? e.message : String(e); }
    assert(/公网 URL/.test(msg) && /APIMart/.test(msg), `本地图应报"只收公网 URL"并给出路，实际：${msg.slice(0, 120)}`);
  } finally { fake.srv.close(); }
});

await test('APIMart 全链路：建任务 → 轮询 → 下载', async () => {
  const fake = fakeApimart({ pendingRounds: 1 });
  const port = await listen(fake.srv);
  fake.setPort(port);
  try {
    const v = await generateVideo(
      { provider: 'apimart', api_key: 'sk-t', base_url: `http://127.0.0.1:${port}` } as unknown as LLMConfig,
      '一只橘猫跳上窗台',
      { model: 'veo3.1-fast', duration: 8, ratio: '16:9', resolution: '720p', poll_interval: 10 },
    );
    assert(v.buffer.equals(fake.MP4X), '应拿到 APIMart 那条 mp4');
    assert(v.taskId === 'task_01K8SGYNNNVBQTXNR4MM964S7K', `task_id 要从 data[0] 里取出来，实际 ${v.taskId}`);
    assert(v.seconds === 37, `计费秒数应取 actual_time，实际 ${v.seconds}`);
  } finally { fake.srv.close(); }
});

await test('APIMart 的字段名与秘塔不同，必须按它的来（prompt / aspect_ratio）', async () => {
  const fake = fakeApimart();
  const port = await listen(fake.srv);
  fake.setPort(port);
  try {
    await generateVideo(
      { provider: 'apimart', api_key: 'sk-t', base_url: `http://127.0.0.1:${port}` } as unknown as LLMConfig,
      '橘猫',
      { model: 'veo3.1-fast', duration: 8, ratio: '9:16', resolution: '1080p', poll_interval: 10 },
    );
    const b = fake.seen.createBody;
    assert(b.prompt === '橘猫', `提示词该放 prompt（秘塔那家是 content[]），实际 ${JSON.stringify(b).slice(0, 120)}`);
    assert(b.aspect_ratio === '9:16' && b.ratio === undefined, `宽高比字段该叫 aspect_ratio，实际 ${JSON.stringify(b)}`);
    assert(b.resolution === '1080p' && b.duration === 8, '分辨率与时长原样透传');
    assert(fake.seen.queries.every((q) => q.includes('task_01K8')), `查询该把 id 放路径里，实际 ${fake.seen.queries[0]}`);
  } finally { fake.srv.close(); }
});

await test('APIMart 失败时原样带出它的 code/message', async () => {
  const fake = fakeApimart({ failWith: 'content policy violation' });
  const port = await listen(fake.srv);
  fake.setPort(port);
  let msg = '';
  try {
    await generateVideo(
      { provider: 'apimart', api_key: 'sk-t', base_url: `http://127.0.0.1:${port}` } as unknown as LLMConfig,
      'x', { model: 'veo3.1-fast', poll_interval: 10 },
    );
  } catch (e) { msg = e instanceof Error ? e.message : String(e); } finally { fake.srv.close(); }
  assert(/content policy violation/.test(msg) && /5001/.test(msg) && /task_01K8/.test(msg), `实际：${msg}`);
});

await test('两家共存：同一份步骤配置换个 provider 就跑另一家', () => {
  const a = resolveVideoAccess({ provider: 'metaso', api_key: 'k' } as LLMConfig, {});
  const b = resolveVideoAccess({ provider: 'apimart', api_key: 'k' } as LLMConfig, {});
  assert(a.spec.shape === 'minimax' && b.spec.shape === 'apimart', '两家该解析到不同的协议形状');
  assert(a.baseUrl !== b.baseUrl, '端点不同');
});

console.log('\n─── 中断时要能说清钱花在哪 ───');

await test('任务在飞时能报出 task_id（进程退出不会停掉服务商那边的活）', async () => {
  const fake = fakeMetaso({ pendingRounds: 999 });
  const port = await listen(fake.srv);
  fake.setPort(port);
  const { describePendingVideoTasks } = await import('../src/connectors/video.js');
  assert(describePendingVideoTasks() === null, '没有在飞任务时不该有提示');
  const p = generateVideo(cfg({ base_url: `http://127.0.0.1:${port}` }), 'x',
    { model: 'MiniMax-H3', poll_interval: 10, timeout: 400 }).catch(() => {});
  // 等它把任务建出来（建任务是同步一发一收，10ms 足够）
  await new Promise((r) => setTimeout(r, 120));
  const msg = describePendingVideoTasks();
  assert(!!msg && /2091363060444401664/.test(msg!), `中断提示应带 task_id，实际：${msg}`);
  assert(/按秒计费|不会停止/.test(msg!), '要说清中断不会停掉任务、费用不退');
  await p;
  fake.srv.close();
});

await test('任务失败后不再挂在"在飞"名单里', async () => {
  const fake = fakeMetaso({ status: 'failed', error: { code: '1', message: 'boom' } });
  const port = await listen(fake.srv);
  fake.setPort(port);
  const { describePendingVideoTasks } = await import('../src/connectors/video.js');
  try {
    await generateVideo(cfg({ base_url: `http://127.0.0.1:${port}` }), 'x', { model: 'MiniMax-H3', poll_interval: 10 });
  } catch { /* 预期失败 */ } finally { fake.srv.close(); }
  const msg = describePendingVideoTasks();
  assert(msg === null || !/2091363060444401664/.test(msg), `失败的任务不该还挂着：${msg}`);
});

console.log('\n─── 瞬时故障不能把一个已付费的任务扔掉 ───');

await test('查询接口网络异常时继续等，不是当场抛错', async () => {
  // 任务已经在跑、钱已经花了。查询这一跳出网络问题就抛错 = 把成品扔了。
  // 假服务：前两次查询直接掐断连接，第三次才正常返回 succeeded。
  let queries = 0;
  let port = 0;
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://x');
    if (req.method === 'POST' && url.pathname.endsWith('/v2/video_generation')) {
      let b = ''; req.on('data', (c) => { b += c; });
      req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ task_id: 'T1' })); });
      return;
    }
    if (url.pathname.endsWith('/v2/query/video_generation')) {
      queries++;
      if (queries <= 2) { req.socket.destroy(); return; }        // 掐断：模拟网络抖动
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ items: [{ id: 'T1', status: 'succeeded', content: { url: `http://127.0.0.1:${port}/f.mp4` }, usage: { total_seconds: 5 } }] }));
    }
    if (url.pathname === '/f.mp4') { res.writeHead(200, { 'Content-Type': 'video/mp4' }); return res.end(MP4); }
    res.writeHead(404).end('{}');
  });
  port = await listen(srv);
  try {
    const v = await generateVideo(cfg({ base_url: `http://127.0.0.1:${port}` }), 'x',
      { model: 'MiniMax-H3', poll_interval: 10, timeout: 20000 });
    assert(v.buffer.equals(MP4), '抖动过去后应正常拿到成品');
    assert(queries >= 3, `应至少熬过两次失败的查询，实际查了 ${queries} 次`);
  } finally { srv.close(); }
});

await test('下载成品失败会重试一次；两次都失败时报错带上 task_id', async () => {
  let hits = 0;
  let port = 0;
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://x');
    if (req.method === 'POST' && url.pathname.endsWith('/v2/video_generation')) {
      let b = ''; req.on('data', (c) => { b += c; });
      req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ task_id: 'T2' })); });
      return;
    }
    if (url.pathname.endsWith('/v2/query/video_generation')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ items: [{ id: 'T2', status: 'succeeded', content: { url: `http://127.0.0.1:${port}/gone.mp4` } }] }));
    }
    if (url.pathname === '/gone.mp4') { hits++; res.writeHead(403).end('expired'); return; }
    res.writeHead(404).end('{}');
  });
  port = await listen(srv);
  let msg = '';
  try {
    await generateVideo(cfg({ base_url: `http://127.0.0.1:${port}` }), 'x', { model: 'MiniMax-H3', poll_interval: 10, timeout: 20000 });
  } catch (e) { msg = e instanceof Error ? e.message : String(e); } finally { srv.close(); }
  assert(hits === 2, `应重试一次（共 2 次下载尝试），实际 ${hits}`);
  assert(/T2/.test(msg) && /控制台/.test(msg), `报错要能拿去自救，实际：${msg}`);
});

await test('无论从哪条出口退出，都不留在"在飞"名单里', async () => {
  const { describePendingVideoTasks } = await import('../src/connectors/video.js');
  const before = describePendingVideoTasks();
  assert(before === null, `上面的用例应已清干净，实际还挂着：${before}`);
});

console.log('\n─── 产物落盘 ───');

await test('mp4 落到 assets/，base64 绝不进 metadata.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ao-vid-out-'));
  const result = {
    workflowName: 'v',
    steps: [{
      id: 'clip', role: '', status: 'completed', output: '[▶ clip.mp4](assets/clip.mp4)',
      duration: 1000, tokens: { input: 0, output: 0 },
      videoAsset: { filename: 'clip.mp4', base64: MP4.toString('base64'), seconds: 5 },
    }],
    totalDuration: 1000, totalTokens: { input: 0, output: 0 }, completedSteps: 1, totalSteps: 1,
  } as unknown as WorkflowResult;
  const out = saveResults(result, dir, 'v');
  const mp4 = join(out, 'assets', 'clip.mp4');
  assert(existsSync(mp4), 'mp4 应落到 assets/');
  assert(readFileSync(mp4).equals(MP4), 'mp4 字节应完整');
  const meta = readFileSync(join(out, 'metadata.json'), 'utf-8');
  assert(!/base64/.test(meta) && meta.includes('clip.mp4'), 'metadata 只该留 filename，不该带 base64');
  assert(/"seconds": 5/.test(meta), 'metadata 应保留计费秒数（对账用）');
  rmSync(dir, { recursive: true, force: true });
});

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
