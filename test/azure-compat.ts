/**
 * 测试 OpenAI 兼容连接器的 Azure 兼容（issue #38）
 * Azure 的 gpt 模型只认 max_completion_tokens + api-key header。
 */
import http from 'node:http';
import { OpenAICompatibleConnector } from '../src/connectors/openai-compatible.js';

let passed = 0, failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; }
}

console.log('\n─── OpenAI 兼容连接器 · Azure 兼容 (#38) ───');

let captured: { body: any; headers: any } | null = null;
const srv = http.createServer((req, res) => {
  let b = '';
  req.on('data', (d) => (b += d));
  req.on('end', () => {
    captured = { body: JSON.parse(b), headers: req.headers };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  });
});

await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
const port = (srv.address() as any).port;

const az = new OpenAICompatibleConnector({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port}/azure` });
assert(az.isAzure === true, 'azure base_url 识别为 Azure');
await az.chat('s', 'u', { provider: 'openai', model: 'gpt-4o', max_tokens: 100 });
assert(captured !== null && 'max_completion_tokens' in captured!.body, 'Azure 用 max_completion_tokens');
assert(captured !== null && !('max_tokens' in captured!.body), 'Azure 不再发 max_tokens');
assert(captured !== null && captured!.headers['api-key'] === 'k', 'Azure 带 api-key header');

const oa = new OpenAICompatibleConnector({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port}/v1` });
assert(oa.isAzure === false, '普通端点不判为 Azure');
await oa.chat('s', 'u', { provider: 'openai', model: 'gpt-4o', max_tokens: 100 });
assert(captured !== null && 'max_tokens' in captured!.body, '普通端点仍用 max_tokens');
assert(captured !== null && captured!.headers['api-key'] === undefined, '普通端点不带 api-key header');

// 环境变量显式覆盖（非 Azure 也能用 max_completion_tokens，覆盖 o系列推理模型）
process.env.AO_OPENAI_TOKENS_PARAM = 'max_completion_tokens';
const ov = new OpenAICompatibleConnector({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port}/v1` });
await ov.chat('s', 'u', { provider: 'openai', model: 'o1', max_tokens: 100 });
assert(captured !== null && 'max_completion_tokens' in captured!.body, 'AO_OPENAI_TOKENS_PARAM 覆盖生效');
delete process.env.AO_OPENAI_TOKENS_PARAM;

// 供应商专有参数透传（#90）：params 原样并入请求体，但不能覆盖核心字段
const pp = new OpenAICompatibleConnector({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port}/v1` });
await pp.chat('s', 'u', {
  provider: 'deepseek', model: 'deepseek-reasoner', max_tokens: 100,
  params: { reasoning_effort: 'high', top_p: 0.9, stream: false, model: '不许覆盖' },
});
assert(captured !== null && captured!.body.reasoning_effort === 'high', 'params.reasoning_effort 透传进请求体 (#90)');
assert(captured !== null && captured!.body.top_p === 0.9, 'params.top_p 透传进请求体');
assert(captured !== null && captured!.body.stream === true, 'params 不能覆盖 stream（流式解析保护）');
assert(captured !== null && captured!.body.model === 'deepseek-reasoner', 'params 不能覆盖 model');

// ── #99：推理模型（o系列/gpt-5）按模型名自动切 max_completion_tokens + 放大默认上限 + 400 自动重试 ──
console.log('\n─── 推理模型自适应 (#99) ───');
const rm = new OpenAICompatibleConnector({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port}/v1` });
await rm.chat('s', 'u', { provider: 'openai', model: 'o1-mini', max_tokens: 100 });
assert(captured !== null && 'max_completion_tokens' in captured!.body, '#99 o系列模型(o1-mini)非 Azure 也自动用 max_completion_tokens');
await rm.chat('s', 'u', { provider: 'openai', model: 'gpt-5', max_tokens: 100 });
assert(captured !== null && 'max_completion_tokens' in captured!.body, '#99 gpt-5 自动用 max_completion_tokens');
await rm.chat('s', 'u', { provider: 'openai', model: 'gpt-4o', max_tokens: 100 });
assert(captured !== null && 'max_tokens' in captured!.body && !('max_completion_tokens' in captured!.body), '#99 gpt-4o 不误判（仍 max_tokens）');

// 未显式指定 max_tokens 时的默认上限：推理模型放大到 32768，普通仍 4096
await rm.chat('s', 'u', { provider: 'openai', model: 'o1' });
assert(captured !== null && captured!.body.max_completion_tokens === 32768, '#99 推理模型默认上限放大到 32768');
await rm.chat('s', 'u', { provider: 'openai', model: 'gpt-4o' });
assert(captured !== null && captured!.body.max_tokens === 4096, '#99 普通模型默认上限仍 4096');

// 关键回归(audit Finding 1)：非推理的 Azure 部署(gpt-4/gpt-4o,输出上限仅 4k~16k)默认上限**不**放大到
// 32768(否则会被端点以「过大」400 拒),仍是 4096；只是参数名因 Azure 用 max_completion_tokens。
const azd = new OpenAICompatibleConnector({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port}/azure` });
await azd.chat('s', 'u', { provider: 'openai', model: 'gpt-4o' });
assert(captured !== null && captured!.body.max_completion_tokens === 4096, '#99 非推理 Azure 部署默认上限仍 4096(不放大,防过大 400)');

srv.close();

// 端点只认 max_completion_tokens：模型名没被识别（如自定义部署名）→ 首发 max_tokens 遭 400，自动切参重试
let calls = 0;
const srv2 = http.createServer((req, res) => {
  let b = '';
  req.on('data', (d) => (b += d));
  req.on('end', () => {
    const body = JSON.parse(b);
    calls++;
    if (calls === 1 && 'max_tokens' in body) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." } }));
      return;
    }
    captured = { body, headers: req.headers };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  });
});
await new Promise<void>((r) => srv2.listen(0, '127.0.0.1', () => r()));
const port2 = (srv2.address() as any).port;
const rt = new OpenAICompatibleConnector({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port2}/v1` });
const res2 = await rt.chat('s', 'u', { provider: 'openai', model: 'custom-deploy-name', max_tokens: 100 });
assert(calls === 2, '#99 首发 400 后自动重试了恰好一次');
assert(captured !== null && 'max_completion_tokens' in captured!.body && !('max_tokens' in captured!.body), '#99 重试改用 max_completion_tokens');
assert(res2.content.includes('ok'), '#99 切参重试后成功拿到内容');
srv2.close();

// 反向(audit Finding 2)：聚合端点只认 max_tokens,但模型名(o1)被我们猜成 max_completion_tokens →
// 400 后应**反向**自动切回 max_tokens 重试,不再是单向死路。
let calls3 = 0;
const srv3 = http.createServer((req, res) => {
  let b = '';
  req.on('data', (d) => (b += d));
  req.on('end', () => {
    const body = JSON.parse(b);
    calls3++;
    if (calls3 === 1 && 'max_completion_tokens' in body) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: "Unknown parameter: 'max_completion_tokens'. Did you mean 'max_tokens'?" } }));
      return;
    }
    captured = { body, headers: req.headers };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  });
});
await new Promise<void>((r) => srv3.listen(0, '127.0.0.1', () => r()));
const port3 = (srv3.address() as any).port;
const rv = new OpenAICompatibleConnector({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port3}/v1` });
const res3 = await rv.chat('s', 'u', { provider: 'openai', model: 'o1', max_tokens: 100 });
assert(calls3 === 2, '#99 反向：首发 max_completion_tokens 遭 400 后自动重试一次');
assert(captured !== null && 'max_tokens' in captured!.body && !('max_completion_tokens' in captured!.body), '#99 反向：重试改回 max_tokens');
assert(res3.content.includes('ok'), '#99 反向切参后成功拿到内容');
srv3.close();

// value 过大类 400 不应被误判为参数名问题去切参(会白切一次仍失败)——直接抛错
let calls4 = 0;
const srv4 = http.createServer((req, res) => {
  let b = '';
  req.on('data', (d) => (b += d));
  req.on('end', () => {
    calls4++;
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'max_completion_tokens is too large: maximum is 4096.' } }));
  });
});
await new Promise<void>((r) => srv4.listen(0, '127.0.0.1', () => r()));
const port4 = (srv4.address() as any).port;
const rvv = new OpenAICompatibleConnector({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port4}/v1` });
let threw400 = false;
try { await rvv.chat('s', 'u', { provider: 'openai', model: 'o1', max_tokens: 999999 }); } catch { threw400 = true; }
assert(threw400 && calls4 === 1, '#99 「数值过大」400 不触发切参重试（只发一次即抛错）');
srv4.close();

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
