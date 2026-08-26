/**
 * 视频端点零成本探测：路径存在回 4xx、不存在 404、对照乱写路径；全站兜底（对照不是 404）要判成"探不出"，
 * 不能把兜底 200 当成"有视频端点"。/models 里的视频模型名要能捞出来。
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
    assert(/有视频端点/.test(r.summary) && /apimart/.test(r.summary), `摘要：${r.summary}`);
    assert(bodies.every((b) => b.includes('__ao_probe__') || b === '{}' || b === ''), '请求体必须是故意不合法的探针，不能是真任务');
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

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
