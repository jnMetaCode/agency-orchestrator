/**
 * 文生图步骤（type: image）。
 *
 * 图片 API 在市面上有两种协议形状：OpenAI 经典 Images API（/images/generations）和
 * Responses + image_generation 工具（LanoX 文档明说 chat 端点不支持图片工具、必须走后者）。
 * 这里钉住：两种协议都能出图、A 打不通自动降到 B、参数原样到达、以及三条纪律——
 * 图片模型必填（不猜）、CLI provider 给可读报错（不是图片端点）、base64 绝不进 metadata。
 */
import http from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateImage, resolveImageAccess } from '../src/connectors/image.js';
import { parseWorkflow } from '../src/core/parser.js';
import { saveResults } from '../src/output/reporter.js';
import type { LLMConfig, WorkflowResult } from '../src/types.js';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve(fn()).then(
    () => { console.log(`  ✅ ${name}`); passed++; },
    (err) => { console.log(`  ❌ ${name}: ${err instanceof Error ? err.message : err}`); failed++; },
  );
}
function assert(c: boolean, m: string): void { if (!c) throw new Error(m); }
const listen = async (srv: http.Server): Promise<number> => {
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  return (srv.address() as { port: number }).port;
};
// 1x1 红色 PNG
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_BYTES = Buffer.from(PNG_B64, 'base64');
const cfg = (o: Record<string, unknown> = {}): LLMConfig =>
  ({ provider: 'lanox', model: 'gpt-5.6-sol', api_key: 'sk-t', ...o } as unknown as LLMConfig);

console.log('\n─── 解析期就拦住的错误（别烧一次调用才发现） ───');

await test('image 步骤不需要 role，task 就是图片提示词', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ao-img-wf-'));
  const f = join(dir, 'w.yaml');
  writeFileSync(f, 'name: "x"\nllm:\n  provider: "lanox"\n  model: "m"\nsteps:\n  - id: a\n    type: image\n    task: "画一只猫"\n    image:\n      model: "gpt-image-2"\n', 'utf-8');
  const wf = parseWorkflow(f);
  assert(wf.steps[0].type === 'image' && !wf.steps[0].role, '应通过且无需 role');
  rmSync(dir, { recursive: true, force: true });
});

await test('缺 image.model 在解析期就报清楚（与文本侧"不猜默认模型"同一条纪律）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ao-img-wf2-'));
  const f = join(dir, 'w.yaml');
  writeFileSync(f, 'name: "x"\nllm:\n  provider: "lanox"\n  model: "m"\nsteps:\n  - id: a\n    type: image\n    task: "画一只猫"\n', 'utf-8');
  let msg = '';
  try { parseWorkflow(f); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
  assert(/image.*model/i.test(msg), `应点名缺 image.model，实际：${msg.slice(0, 80)}`);
  rmSync(dir, { recursive: true, force: true });
});

await test('image.provider 指定另一家：走它的端点和 key，不带文本供应商的 base_url / api_key', () => {
  const prevKey = process.env.LANOX_API_KEY; process.env.LANOX_API_KEY = 'lk-img';
  try {
    const textCfg = { provider: 'deepseek', api_key: 'dk-text', base_url: 'https://text.example/v1', model: 'deepseek-chat' } as unknown as LLMConfig;
    const r = resolveImageAccess(textCfg, { provider: 'lanox' });
    assert(r.apiKey === 'lk-img', `应用 lanox 自己的 key，实际 ${r.apiKey}`);
    assert(!/text\.example/.test(r.baseUrl), `不应带上文本供应商的 base_url，实际 ${r.baseUrl}`);
    // 不指定时保持原行为：跟文本供应商走
    const same = resolveImageAccess(textCfg, {});
    assert(same.baseUrl === 'https://text.example/v1' && same.apiKey === 'dk-text', '未指定 image.provider 时仍沿用 llm 配置');
  } finally { if (prevKey === undefined) delete process.env.LANOX_API_KEY; else process.env.LANOX_API_KEY = prevKey; }
});

await test('CLI provider 不是图片端点——报错要把这条说清并给出路', () => {
  let msg = '';
  try { resolveImageAccess(cfg({ provider: 'claude-code', api_key: undefined, base_url: undefined })); }
  catch (e) { msg = e instanceof Error ? e.message : String(e); }
  assert(/claude-code/.test(msg) && /llm:/.test(msg), `应点名 provider 并给"步骤级 llm 覆盖"的出路，实际：${msg.slice(0, 100)}`);
});

await test('Anthropic 原生协议没有图片端点——当场说清，而不是去打官方端点撞 404', () => {
  for (const p of ['claude', 'aicodemirror']) {
    let msg = '';
    // 注意这两家都**有** base_url（不会掉进"没有可用端点"那条分支），所以必须显式拦
    try { resolveImageAccess(cfg({ provider: p, base_url: 'https://api.anthropic.com' })); }
    catch (e) { msg = e instanceof Error ? e.message : String(e); }
    assert(/没有图片生成端点/.test(msg) && /llm:/.test(msg), `${p} 应点破并给出路，实际：${msg.slice(0, 100)}`);
  }
});

await test('step id 带路径字符在解析期就拦（id 会拼进产物文件名）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ao-img-wf3-'));
  const f = join(dir, 'w.yaml');
  for (const bad of ['../escape', 'a/b', 'x:y', '.hidden']) {
    writeFileSync(f, `name: "x"\nllm:\n  provider: "lanox"\n  model: "m"\nsteps:\n  - id: "${bad}"\n    role: "r/r"\n    task: "t"\n`, 'utf-8');
    let msg = '';
    try { parseWorkflow(f); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
    assert(/路径字符/.test(msg), `id "${bad}" 应被拦，实际：${msg.slice(0, 60)}`);
  }
  // 中文 / 下划线 / 连字符照常放行
  writeFileSync(f, 'name: "x"\nllm:\n  provider: "lanox"\n  model: "m"\nsteps:\n  - id: "写文案-步骤_1"\n    role: "r/r"\n    task: "t"\n', 'utf-8');
  assert(parseWorkflow(f).steps[0].id === '写文案-步骤_1', '中文 id 不该被误伤');
  rmSync(dir, { recursive: true, force: true });
});

await test('image 步骤上写 acceptance/assert → 解析期明确报不支持（不静默忽略）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ao-img-wf4-'));
  const f = join(dir, 'w.yaml');
  writeFileSync(f, 'name: "x"\nllm:\n  provider: "lanox"\n  model: "m"\nsteps:\n  - id: a\n    type: image\n    task: "t"\n    acceptance: "1. 好看"\n    image:\n      model: "m2"\n', 'utf-8');
  let msg = '';
  try { parseWorkflow(f); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
  assert(/acceptance/.test(msg) && /不支持|暂不/.test(msg), `应明说不支持，实际：${msg.slice(0, 80)}`);
  rmSync(dir, { recursive: true, force: true });
});

console.log('\n─── 协议 A：Images API ───');
{
  const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d));
    req.on('end', () => {
      seen.push({ url: String(req.url), body: JSON.parse(b || '{}') });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }));
    });
  });
  const port = await listen(srv);

  await test('b64_json 直接成图，参数原样到达', async () => {
    const r = await generateImage(cfg({ base_url: `http://127.0.0.1:${port}/v1` }), '画一只猫', { model: 'gpt-image-2', size: '1024x1024', quality: 'high' });
    assert(r.via === 'images-api' && r.buffer.equals(PNG_BYTES), '应走协议 A 且字节一致');
    const req = seen[0];
    assert(req.url === '/v1/images/generations', `路径不对：${req.url}`);
    assert(req.body.model === 'gpt-image-2' && req.body.prompt === '画一只猫' && req.body.size === '1024x1024' && req.body.quality === 'high', `参数没原样到达：${JSON.stringify(req.body)}`);
  });
  srv.close();
}

await test('返回 url 时自动下载成字节', async () => {
  const fileSrv = http.createServer((_q, res) => { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PNG_BYTES); });
  const fPort = await listen(fileSrv);
  const api = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d));
    req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ data: [{ url: `http://127.0.0.1:${fPort}/x.png` }] })); });
  });
  const aPort = await listen(api);
  const r = await generateImage(cfg({ base_url: `http://127.0.0.1:${aPort}/v1` }), 'p', { model: 'm' });
  assert(r.buffer.equals(PNG_BYTES), 'URL 形态也要拿到同样的字节');
  fileSrv.close(); api.close();
});

console.log('\n─── 协议 B 兜底：A 不存在时自动降级 ───');
{
  const seen: string[] = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d));
    req.on('end', () => {
      seen.push(String(req.url));
      if (/images\/generations/.test(String(req.url))) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end('{"error":"not found"}');
      }
      if (String(req.url) === '/v1/responses') {
        const body = JSON.parse(b) as { tools?: Array<Record<string, unknown>>; model?: string };
        // 工具里带图片模型、顶层是文本模型 —— LanoX 文档的形状
        if (body.tools?.[0]?.model !== 'gpt-image-2') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end('{"error":"tool model missing"}');
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ object: 'response', status: 'completed', output: [{ type: 'image_generation_call', status: 'completed', result: PNG_B64 }] }));
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"error":"nope"}');
    });
  });
  const port = await listen(srv);

  await test('Images API 404 → 自动改走 Responses + image_generation 工具', async () => {
    const r = await generateImage(cfg({ base_url: `http://127.0.0.1:${port}/v1` }), 'p', { model: 'gpt-image-2' });
    assert(r.via === 'responses-tool' && r.buffer.equals(PNG_BYTES), '应降级成功且字节一致');
    assert(seen.some((u) => /images\/generations/.test(u)) && seen.includes('/v1/responses'), `应先试 A 再试 B：${JSON.stringify(seen)}`);
  });
  srv.close();
}

await test('两条协议都不通时，报错说清试过哪两条路', async () => {
  const srv = http.createServer((_q, res) => { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"error":"nope"}'); });
  const port = await listen(srv);
  const msg = await generateImage(cfg({ base_url: `http://127.0.0.1:${port}/v1` }), 'p', { model: 'm' }).then(() => '', (e: Error) => e.message);
  assert(/images\/generations/.test(msg) && /responses/.test(msg), `报错应列出两条已试路径，实际：${msg.slice(0, 160)}`);
  srv.close();
});

await test('B 回 200 却没有图片时，报错要带上 A 说的那句原因（真机最常见的形态）', async () => {
  // 实测胜算云：A 明说 `model "X" does not support request path "/v1/images/generations"`，
  // B 则被网关当普通文本请求跑了 —— HTTP 200、正文里压根没有 image_generation_call。
  // 此前这一支只甩 200 字原始 JSON，把 A 那句唯一能解释原因的话丢了。
  const srv = http.createServer((q, res) => {
    if (/images\/generations/.test(String(q.url))) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end('{"error":{"message":"model \\"m\\" does not support request path \\"/v1/images/generations\\""}}');
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ object: 'response', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '好的' }] }] }));
  });
  const port = await listen(srv);
  const msg = await generateImage(cfg({ base_url: `http://127.0.0.1:${port}/v1` }), 'p', { model: 'm' }).then(() => '', (e: Error) => e.message);
  assert(/does not support request path/.test(msg), `应带上 A 的原文诊断，实际：${msg.slice(0, 200)}`);
  assert(/image_generation_call/.test(msg) && /"m"/.test(msg), `应说清 B 的形态与用的模型名，实际：${msg.slice(0, 200)}`);
  srv.close();
});

await test('实际尺寸与请求的 size 不一致时要说破（真机：LanoX 把 size 当建议）', async () => {
  // 造一张 2x1 的 PNG：宽高写在 IHDR 里，settle 从头 24 字节读，不解码整图
  const png2x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP8//8/AwwwMSABADkGAxqCLdWmAAAAAElFTkSuQmCC',
    'base64',
  );
  const srv = http.createServer((_q, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ b64_json: png2x1.toString('base64') }] }));
  });
  const port = await listen(srv);
  const notices: string[] = [];
  const img = await generateImage(
    cfg({ base_url: `http://127.0.0.1:${port}/v1` }),
    'p',
    { model: 'm', size: '1024x1024' },
    (m) => notices.push(m),
  );
  assert(img.width === 2 && img.height === 1, `真实尺寸应从 PNG 头量出来，实际 ${img.width}x${img.height}`);
  assert(notices.some((n) => /2x1/.test(n) && /1024x1024/.test(n)), `尺寸对不上要说破，实际提示：${notices.join(' / ')}`);
  // 没请求 size 就不该无端报警（各家默认档不同，那不是"没生效"）
  const notices2: string[] = [];
  await generateImage(cfg({ base_url: `http://127.0.0.1:${port}/v1` }), 'p', { model: 'm' }, (m) => notices2.push(m));
  assert(!notices2.some((n) => /不一致/.test(n)), `没写 size 时不该报尺寸不符，实际：${notices2.join(' / ')}`);
  srv.close();
});

await test('缺 image.model 时不发任何请求（连烧钱的机会都不给）', async () => {
  let hits = 0;
  const srv = http.createServer((_q, res) => { hits++; res.writeHead(200); res.end('{}'); });
  const port = await listen(srv);
  const msg = await generateImage(cfg({ base_url: `http://127.0.0.1:${port}/v1` }), 'p', {}).then(() => '', (e: Error) => e.message);
  assert(/image.*model/i.test(msg) && hits === 0, `应本地拦下（请求数 ${hits}）`);
  srv.close();
});

console.log('\n─── 落盘约定（reporter） ───');

await test('assets 落成真文件、base64 摘掉、步骤 md 里补 ../、metadata 只留 filename', () => {
  const out = mkdtempSync(join(tmpdir(), 'ao-img-save-'));
  const result: WorkflowResult = {
    name: '图测', file: 'w.yaml', success: true,
    steps: [{
      id: 'poster', role: '', agentName: '文生图', agentEmoji: '🎨', status: 'completed',
      output: '![poster](assets/poster.png)', output_var: 'img',
      duration: 1000, tokens: { input: 0, output: 0 },
      imageAsset: { filename: 'poster.png', base64: PNG_B64 },
    }],
    totalDuration: 1000, totalTokens: { input: 0, output: 0 }, inputs: {},
  } as unknown as WorkflowResult;
  const dir = saveResults(result, out);
  assert(readFileSync(join(dir, 'assets', 'poster.png')).equals(PNG_BYTES), 'assets/poster.png 应是原始字节');
  const md = readFileSync(join(dir, 'steps', '1-poster.md'), 'utf-8');
  assert(md.includes('](../assets/poster.png)'), `步骤 md 在 steps/ 里，引用应补 ../：${md.slice(-80)}`);
  const meta = JSON.parse(readFileSync(join(dir, 'metadata.json'), 'utf-8')) as { steps: Array<{ imageAsset?: { filename: string; base64?: string } }> };
  assert(meta.steps[0].imageAsset?.filename === 'poster.png', 'metadata 应留 filename');
  assert(!JSON.stringify(meta).includes(PNG_B64.slice(0, 24)), 'base64 绝不能进 metadata（一张 2MB 图会把它撑成巨型 JSON）');
  assert(!existsSync(join(dir, 'assets', 'poster.png.b64')), '不留中间产物');
  rmSync(out, { recursive: true, force: true });
});

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
