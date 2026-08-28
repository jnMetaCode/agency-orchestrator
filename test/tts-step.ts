/**
 * 配音步骤（type: tts）—— 后期三件套的第一件。
 *
 * 走 OpenAI 兼容的 `POST {base}/audio/speech`：和 type: image 同一套供应商/key/端点漂移机制，
 * 不引入新依赖、不新开供应商表。这里钉住四类事：
 *   1. 解析期就拦住的配置错（model / voice 必填、acceptance 不支持、task 就是文案）；
 *   2. 请求参数原样到达（模型、音色、语速、格式、风格指令）；
 *   3. 「这家没有语音端点」要说成能力不存在，而不是让用户回去反复检查 voice；
 *   4. 200 却回 JSON / 回 0 字节 —— 绝不能把一段 JSON 当 mp3 写进 assets，
 *      那在成片里是一条打不开的"配音"。
 */
import http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSpeech } from '../src/connectors/tts.js';
import { parseWorkflow } from '../src/core/parser.js';
import type { LLMConfig } from '../src/types.js';

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
const MP3 = Buffer.from([0xff, 0xfb, 0x90, 0x64, 0x00, 0x11, 0x22, 0x33]);
const cfg = (o: Record<string, unknown> = {}): LLMConfig =>
  ({ provider: 'lanox', model: 'gpt-5.6-sol', api_key: 'sk-t', ...o } as unknown as LLMConfig);
const wf = (steps: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ao-tts-wf-'));
  const f = join(dir, 'w.yaml');
  writeFileSync(f, `name: "x"\nllm:\n  provider: "lanox"\n  model: "m"\nsteps:\n${steps}`, 'utf-8');
  return f;
};
const parseErr = (steps: string): string => {
  const f = wf(steps);
  try { parseWorkflow(f); return ''; } catch (e) { return e instanceof Error ? e.message : String(e); }
  finally { rmSync(join(f, '..'), { recursive: true, force: true }); }
};

console.log('\n─── 解析期就拦住的错误（别烧一次调用才发现）───');

await test('tts 步骤不需要 role，task 就是要念的文案', () => {
  const w = parseWorkflow(wf('  - id: vo\n    type: tts\n    task: "夜色落下来了"\n    tts:\n      model: "gpt-4o-mini-tts"\n      voice: "alloy"\n    output: vo_mp3\n'));
  assert(w.steps[0].type === 'tts' && !w.steps[0].role, '应通过且无需 role');
  assert(w.steps[0].tts?.voice === 'alloy', 'tts 配置应解析出来');
});

await test('缺 model 或缺 voice → 解析期报，且点明"音色各家互不通用，不猜"', () => {
  const noModel = parseErr('  - id: vo\n    type: tts\n    task: "t"\n    tts:\n      voice: "alloy"\n');
  const noVoice = parseErr('  - id: vo\n    type: tts\n    task: "t"\n    tts:\n      model: "m"\n');
  const noTts = parseErr('  - id: vo\n    type: tts\n    task: "t"\n');
  for (const [what, msg] of [['缺 model', noModel], ['缺 voice', noVoice], ['整块都没写', noTts]] as const) {
    assert(/tts:\s*\{\s*model/.test(msg) && /不猜/.test(msg), `${what} 应报清楚，实际：${msg.slice(0, 120)}`);
  }
});

await test('tts 步骤缺 task → 报"task 就是要念的文案"', () => {
  const msg = parseErr('  - id: vo\n    type: tts\n    tts:\n      model: "m"\n      voice: "v"\n');
  assert(/缺少 task/.test(msg) && /要念的文案/.test(msg), `应点明 task 是什么，实际：${msg.slice(0, 120)}`);
});

await test('tts 步骤上写 acceptance → 明确报不支持（核验的是文本产出，不是音频）', () => {
  const msg = parseErr('  - id: vo\n    type: tts\n    task: "t"\n    acceptance: "1. 好听"\n    tts:\n      model: "m"\n      voice: "v"\n');
  assert(/acceptance/.test(msg) && /暂不支持/.test(msg), `应明说不支持，实际：${msg.slice(0, 120)}`);
});

await test('全是媒体步骤的工作流不必填顶层 llm.model（tts 与 image/video 同待遇）', () => {
  const f = mkdtempSync(join(tmpdir(), 'ao-tts-only-'));
  const p = join(f, 'w.yaml');
  writeFileSync(p, 'name: "x"\nllm:\n  provider: "lanox"\nsteps:\n  - id: vo\n    type: tts\n    task: "念一句"\n    tts:\n      model: "m"\n      voice: "v"\n    output: vo_mp3\n', 'utf-8');
  assert(parseWorkflow(p).steps.length === 1, '纯配音工作流不该被"缺 model"挡住');
  rmSync(f, { recursive: true, force: true });
});

console.log('\n─── 请求形状 ───');
{
  const seen: Array<{ url: string; auth: string; body: Record<string, unknown> }> = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d));
    req.on('end', () => {
      seen.push({ url: String(req.url), auth: String(req.headers.authorization), body: JSON.parse(b || '{}') });
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      res.end(MP3);
    });
  });
  const port = await listen(srv);

  await test('打的是 /audio/speech，参数原样到达，拿回的是音频字节', async () => {
    const r = await generateSpeech(
      cfg({ base_url: `http://127.0.0.1:${port}/v1` }),
      '夜色落下来了',
      { model: 'gpt-4o-mini-tts', voice: 'nova', speed: 1.1, format: 'mp3', instructions: '低沉、克制' },
    );
    assert(r.buffer.equals(MP3) && r.ext === 'mp3' && r.mime === 'audio/mpeg', '应拿到音频字节与正确扩展名');
    const req = seen[0];
    assert(req.url === '/v1/audio/speech', `路径不对：${req.url}`);
    assert(req.auth === 'Bearer sk-t', `Authorization 不对：${req.auth}`);
    assert(req.body.model === 'gpt-4o-mini-tts' && req.body.voice === 'nova' && req.body.input === '夜色落下来了'
      && req.body.speed === 1.1 && req.body.response_format === 'mp3' && req.body.instructions === '低沉、克制',
      `参数没原样到达：${JSON.stringify(req.body)}`);
  });

  await test('不填 speed / instructions 就不发这两个字段（别替用户塞默认值）', async () => {
    seen.length = 0;
    await generateSpeech(cfg({ base_url: `http://127.0.0.1:${port}/v1` }), 't', { model: 'm', voice: 'v' });
    assert(!('speed' in seen[0].body) && !('instructions' in seen[0].body), `不该出现：${JSON.stringify(seen[0].body)}`);
    assert(seen[0].body.response_format === 'mp3', 'format 缺省应是 mp3');
  });

  srv.close();
}

console.log('\n─── 说清"这家没这个能力"，而不是让人回去查参数 ───');

await test('404 → 点破多半是这家没有 /audio/speech 端点', async () => {
  const srv = http.createServer((_q, res) => { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"error":"not found"}'); });
  const port = await listen(srv);
  let msg = '';
  try { await generateSpeech(cfg({ base_url: `http://127.0.0.1:${port}/v1` }), 't', { model: 'm', voice: 'v' }); }
  catch (e) { msg = e instanceof Error ? e.message : String(e); }
  srv.close();
  assert(/没有 \/audio\/speech 端点/.test(msg), `应点破能力不存在，实际：${msg.slice(0, 200)}`);
});

await test('200 却回 JSON → 识破（否则一段 JSON 会被当 mp3 写进 assets）', async () => {
  const srv = http.createServer((_q, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"error":{"message":"no such route"}}'); });
  const port = await listen(srv);
  let msg = '';
  try { await generateSpeech(cfg({ base_url: `http://127.0.0.1:${port}/v1` }), 't', { model: 'm', voice: 'v' }); }
  catch (e) { msg = e instanceof Error ? e.message : String(e); }
  srv.close();
  assert(/不是音频而是 JSON/.test(msg), `应识破 JSON 冒充音频，实际：${msg.slice(0, 200)}`);
});

await test('200 却回 0 字节 → 报出来，不写一个空文件', async () => {
  const srv = http.createServer((_q, res) => { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(); });
  const port = await listen(srv);
  let msg = '';
  try { await generateSpeech(cfg({ base_url: `http://127.0.0.1:${port}/v1` }), 't', { model: 'm', voice: 'v' }); }
  catch (e) { msg = e instanceof Error ? e.message : String(e); }
  srv.close();
  assert(/0 字节/.test(msg), `应报 0 字节，实际：${msg.slice(0, 200)}`);
});

await test('Anthropic 协议的供应商：说"没有语音合成端点"，而不是"图片"', async () => {
  let msg = '';
  try { await generateSpeech(cfg({ provider: 'claude', base_url: undefined }), 't', { model: 'm', voice: 'v' }); }
  catch (e) { msg = e instanceof Error ? e.message : String(e); }
  assert(/语音合成端点/.test(msg) && !/图片/.test(msg), `报错该说配音的事，实际：${msg.slice(0, 200)}`);
});

await test('不支持的 format 当场报，不发出去换一句厂商 400', async () => {
  let msg = '';
  try { await generateSpeech(cfg(), 't', { model: 'm', voice: 'v', format: 'ogg' }); }
  catch (e) { msg = e instanceof Error ? e.message : String(e); }
  assert(/format 只支持/.test(msg), `应当场报格式错，实际：${msg.slice(0, 200)}`);
});

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
