/**
 * 媒体端点零成本探测（视频 / 图片 / 语音）：路径存在回 4xx、不存在 404、对照乱写路径；
 * 全站兜底（对照不是 404）要判成"探不出"，不能把兜底 200 当成"有端点"。
 * /models 里的视频与语音模型名要能捞出来。
 * 语音这条尤其重要：不先探，用户要等工作流跑到配音那一步才知道这家不行——
 * 而那时前面的图片/视频步骤已经花过钱了。
 */
import http from 'node:http';
import { probeVideoEndpoints } from '../src/media/probe-video.js';

let passed = 0, failed = 0;
function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return new Promise<void>((r) => r(fn())).then(() => { console.log(`  ✅ ${name}`); passed++; }, (e) => { console.log(`  ❌ ${name}: ${e instanceof Error ? e.message : e}`); failed++; });
}
const assert = (c: boolean, m: string) => { if (!c) throw new Error(m); };
const listen = async (srv: http.Server): Promise<number> => { await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r())); return (srv.address() as { port: number }).port; };

await test('APIMart 形状存在（400）、其余 404、对照 404 → 判定 exists，且不发合法请求体', async () => {
  const bodies: string[] = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => { b += d; });
    req.on('end', () => {
      bodies.push(b);
      if (req.url === '/v1/videos/generations') { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end('{"error":"invalid model"}'); }
      if (req.url === '/v1/models') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'gpt-5.5' }, { id: 'sora-2' }, { id: 'veo3.1-fast' }, { id: 'bge-m3' }] })); }
      res.writeHead(404).end('{}');
    });
  });
  const port = await listen(srv);
  try {
    const r = await probeVideoEndpoints({ id: 'x', baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'k' }, { timeoutMs: 3000 });
    const ap = r.shapes.find((s) => s.shape === 'apimart');
    assert(ap?.verdict === 'exists' && ap.status === 400, `apimart 形状应判 exists，实际 ${JSON.stringify(ap)}`);
    assert(r.shapes.filter((s) => s.shape !== 'apimart').every((s) => s.verdict === 'missing'), '其余形状应判 missing');
    assert(r.videoModels.join(',') === 'sora-2,veo3.1-fast', `应捞出视频模型名，实际 ${r.videoModels}`);
    assert(r.image.verdict === 'missing', `该假站没有 /images/generations，应判 missing，实际 ${JSON.stringify(r.image)}`);
    assert(/有视频端点/.test(r.summary) && /apimart/.test(r.summary), `摘要：${r.summary}`);
    assert(bodies.every((b) => b.includes('__ao_probe__') || b === '{}' || b === ''), '请求体必须是故意不合法的探针，不能是真任务');
  } finally { srv.close(); }
});

await test('图片端点 /images/generations 回 400 且对照 404 → image.verdict=exists', async () => {
  const srv = http.createServer((req, res) => {
    if (req.url === '/v1/images/generations') { res.writeHead(400).end('{"error":"bad model"}'); return; }
    res.writeHead(404).end('{}');
  });
  const port = await listen(srv);
  try {
    const r = await probeVideoEndpoints({ id: 'i', baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'k' }, { timeoutMs: 3000 });
    assert(r.image.verdict === 'exists' && /图片端点/.test(r.summary), `实际 ${JSON.stringify(r.image)} ${r.summary}`);
  } finally { srv.close(); }
});

await test('全站兜底（什么路径都 200）→ 判 unreliable，不能当成有视频端点', async () => {
  const srv = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); });
  const port = await listen(srv);
  try {
    const r = await probeVideoEndpoints({ id: 'y', baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'k' }, { timeoutMs: 3000 });
    assert(r.controlStatus === 200, '对照应是 200');
    assert(r.shapes.every((s) => s.verdict === 'unreliable'), `全部应判 unreliable，实际 ${JSON.stringify(r.shapes)}`);
    assert(/兜底/.test(r.summary), `摘要应说明兜底：${r.summary}`);
  } finally { srv.close(); }
});

await test('三种形状都不在、但 /models 有视频模型名 → 提示"别的形状，要文档"', async () => {
  const srv = http.createServer((req, res) => {
    if (req.url === '/v1/models') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'kling-v3' }] })); }
    res.writeHead(404).end('{}');
  });
  const port = await listen(srv);
  try {
    const r = await probeVideoEndpoints({ id: 'z', baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'k' }, { timeoutMs: 3000 });
    assert(r.shapes.every((s) => s.verdict === 'missing') && /别的形状/.test(r.summary), `摘要：${r.summary}`);
  } finally { srv.close(); }
});

await test('语音端点：/audio/speech 在（400）→ exists；探针请求体必须不合法（零成本）', async () => {
  const seen: Array<{ url: string; body: string }> = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => { b += d; });
    req.on('end', () => {
      seen.push({ url: String(req.url), body: b });
      if (req.url === '/v1/audio/speech') { res.writeHead(400).end('{"error":"model not found"}'); return; }
      if (req.url === '/v1/models') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'gpt-4o-mini-tts' }, { id: 'cosyvoice-v2' }, { id: 'deepseek-chat' }, { id: 'sora-2' }] })); }
      res.writeHead(404).end('{}');
    });
  });
  const port = await listen(srv);
  try {
    const r = await probeVideoEndpoints({ id: 's', baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'k' }, { timeoutMs: 3000 });
    assert(r.speech.verdict === 'exists' && r.speech.status === 400, `语音端点应判 exists，实际 ${JSON.stringify(r.speech)}`);
    assert(/语音端点 \/audio\/speech 存在/.test(r.summary), `摘要应点明语音可用：${r.summary}`);
    // 零成本的关键：model 与 voice 都是占位符，服务端不可能真合成
    const call = seen.find((x) => x.url === '/v1/audio/speech')!;
    const body = JSON.parse(call.body) as { model: string; voice: string; input: string };
    assert(body.model === '__ao_probe__' && body.voice === '__ao_probe__', `探针必须用占位模型/音色，实际 ${call.body}`);
    // 语音模型名捞出来，且不能把视频模型（sora-2）混进来
    assert(r.speechModels.includes('gpt-4o-mini-tts') && r.speechModels.includes('cosyvoice-v2'), `应捞出语音模型，实际 ${r.speechModels.join(',')}`);
    assert(!r.speechModels.includes('sora-2'), '视频模型不该混进语音模型名单');
    assert(!r.speechModels.includes('deepseek-chat'), '聊天模型不该混进语音模型名单');
  } finally { srv.close(); }
});

await test('端点在但 /models 里没有语音模型 → 说"要确认"，不能说"可用"（真机实测的坑）', async () => {
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => { b += d; });
    req.on('end', () => {
      // Agnes / 多元探索的真实形态：路径在（503），但模型表里一个语音模型都没有
      if (req.url === '/v1/audio/speech') { res.writeHead(503).end('{"error":"upstream"}'); return; }
      if (req.url === '/v1/models') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'deepseek-chat' }, { id: 'agnes-video-2.5-flash' }] })); }
      res.writeHead(404).end('{}');
    });
  });
  const port = await listen(srv);
  try {
    const r = await probeVideoEndpoints({ id: 'p', baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'k' }, { timeoutMs: 3000 });
    assert(r.speech.verdict === 'exists', `路径确实在，应判 exists，实际 ${JSON.stringify(r.speech)}`);
    assert(r.speechModels.length === 0, '不该把视频/聊天模型当成语音模型');
    assert(/路径存在，但/.test(r.summary) && /别猜 model id/.test(r.summary), `不能说成"可用"：${r.summary}`);
    assert(!/type: tts 可用/.test(r.summary), `路径在但没模型时不能承诺可用：${r.summary}`);
  } finally { srv.close(); }
});

await test('没有语音端点（404）→ 说清"这家用不了 type: tts"，而不是沉默', async () => {
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => { b += d; });
    req.on('end', () => {
      if (req.url === '/v1/models') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'deepseek-chat' }] })); }
      res.writeHead(404).end('{}');
    });
  });
  const port = await listen(srv);
  try {
    const r = await probeVideoEndpoints({ id: 'n', baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'k' }, { timeoutMs: 3000 });
    assert(r.speech.verdict === 'missing', `应判 missing，实际 ${JSON.stringify(r.speech)}`);
    assert(/没有语音端点/.test(r.summary) && /type: tts/.test(r.summary), `摘要要说清用不了配音：${r.summary}`);
  } finally { srv.close(); }
});

await test('全站兜底（对照不是 404）→ 语音也判"探不出"，不能报喜', async () => {
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => { b += d; });
    req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}'); });
  });
  const port = await listen(srv);
  try {
    const r = await probeVideoEndpoints({ id: 'f', baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'k' }, { timeoutMs: 3000 });
    assert(r.speech.verdict === 'unreliable', `兜底站的语音端点应判 unreliable，实际 ${JSON.stringify(r.speech)}`);
    assert(!/语音端点 \/audio\/speech 存在/.test(r.summary), `不能把兜底 200 说成"语音可用"：${r.summary}`);
  } finally { srv.close(); }
});

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
