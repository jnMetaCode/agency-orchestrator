/**
 * 端点容错：base_url 配错/被跳转时不再一句「API error 405」了事。
 *
 * 真实故障：用户在 Studio 里配的 base_url 与中转商最终地址差一跳（http→https、带不带 www、
 * 路径少写 /v1），Node/undici 按 fetch 规范把 301/302 的 POST 降级成 GET，上游 /chat/completions
 * 只收 POST → 回 405 {"detail":"Method Not Allowed"}，用户只看到「API error 405」无从查起。
 */
import http from 'node:http';
import {
  OpenAICompatibleConnector,
  normalizeBaseUrl,
  chatEndpointCandidates,
  joinEndpoint,
  sameCredentialScope,
  isGatewayRouteMissShell,
  envProxyHint,
} from '../src/connectors/openai-compatible.js';
import { OllamaConnector } from '../src/connectors/ollama.js';

let passed = 0, failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; }
}

console.log('\n─── OpenAI 兼容连接器 · base_url 配错/跳转容错 ───');

// ── base_url 规整 ─────────────────────────────────────────────────────────────
assert(normalizeBaseUrl('  https://api.x.com/v1/  ') === 'https://api.x.com/v1', '去掉首尾空白与尾斜杠');
assert(normalizeBaseUrl('"https://api.x.com/v1"') === 'https://api.x.com/v1', '去掉复制带上的引号');
assert(normalizeBaseUrl('https://api.x.com/v1/chat/completions') === 'https://api.x.com/v1', '整条 curl 地址只留 base');
assert(normalizeBaseUrl('https://api.x.com/v1?key=sk-secret') === 'https://api.x.com/v1', '抹掉写在 query 里的 key（凭证不该留在配置里）');
// Azure 部署地址离了 ?api-version= 必 404，这个 query 不能被当成垃圾清掉
assert(normalizeBaseUrl('https://x.openai.azure.com/openai/deployments/d/?api-version=2024-02-01') ===
  'https://x.openai.azure.com/openai/deployments/d?api-version=2024-02-01', '保留 Azure 的 api-version');
assert(joinEndpoint('https://x.azure.com/d?api-version=2024-02-01', 'chat/completions') ===
  'https://x.azure.com/d/chat/completions?api-version=2024-02-01', '拼端点时路径接在 query 之前');
assert(chatEndpointCandidates('https://api.x.com?api-version=1')[1] ===
  'https://api.x.com/v1/chat/completions?api-version=1', '兜底候选同样保住 query');
assert(normalizeBaseUrl('api.x.com/v1') === 'https://api.x.com/v1', '只写域名时补 https');
assert(normalizeBaseUrl('') === '', '空值原样返回');

// ── 候选端点：少写/多写 /v1 各有兜底 ──────────────────────────────────────────
assert(
  JSON.stringify(chatEndpointCandidates('https://api.x.com')) ===
    JSON.stringify(['https://api.x.com/chat/completions', 'https://api.x.com/v1/chat/completions']),
  '没写版本段 → 兜底试 /v1',
);
assert(
  JSON.stringify(chatEndpointCandidates('https://api.x.com/v1')) ===
    JSON.stringify(['https://api.x.com/v1/chat/completions', 'https://api.x.com/chat/completions']),
  '写了 /v1 → 兜底试根路径',
);
assert(chatEndpointCandidates('https://x.openai.azure.com/openai/deployments/gpt', { azure: true }).length === 1,
  'Azure 不做 /v1 猜测');

// ── 测试用上游：只在指定路径、且只对 POST 返回 SSE，其余按 FastAPI 风格回 405 ──
function sseOnly(path: string) {
  const seen: Array<{ method: string; url: string; auth?: string }> = [];
  const srv = http.createServer((req, res) => {
    seen.push({ method: req.method!, url: req.url!, auth: req.headers.authorization as string | undefined });
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      if (req.url !== path || req.method !== 'POST') {
        // FastAPI/Starlette 对「路径在但方法不对」的标准回法，即用户截图里的报文
        res.writeHead(req.url === path ? 405 : 404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: req.url === path ? 'Method Not Allowed' : 'Not Found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  return { srv, seen };
}
const listen = async (srv: http.Server, host = '127.0.0.1'): Promise<number> => {
  await new Promise<void>((r) => srv.listen(0, host, () => r()));
  return (srv.address() as { port: number }).port;
};
const cfg = { provider: 'openai' as const, model: 'gpt-4o', max_tokens: 100 };

// ── 1. 跳转不再把 POST 降级成 GET（用户报的 405 就是这条）────────────────────
{
  const up = sseOnly('/v1/chat/completions');
  const upPort = await listen(up.srv);
  const redirector = http.createServer((req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${upPort}${req.url}` });
    res.end();
  });
  const redirPort = await listen(redirector);

  const c = new OpenAICompatibleConnector({ apiKey: 'k', baseUrl: `http://127.0.0.1:${redirPort}/v1` });
  const r = await c.chat('s', 'u', cfg);
  assert(r.content === 'ok', '302 跳转后仍以 POST 重发 → 请求成功（修复 405 Method Not Allowed）');
  assert(up.seen.every((s) => s.method === 'POST'), '跳转目标收到的是 POST 而不是被降级的 GET');
  assert(up.seen[0]?.auth === 'Bearer k', '同机跳转仍带上 API key');
  redirector.close(); up.srv.close();
}

// ── 2. base_url 少写 /v1：405 后自动改用 /v1 候选 ─────────────────────────────
{
  const up = sseOnly('/v1/chat/completions');
  const port = await listen(up.srv);
  const c = new OpenAICompatibleConnector({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port}` });
  const r = await c.chat('s', 'u', cfg);
  assert(r.content === 'ok', 'base_url 少写 /v1 时自动补上重试成功');
  assert(up.seen.some((s) => s.url === '/chat/completions') && up.seen.some((s) => s.url === '/v1/chat/completions'),
    '先按用户填的拼，失败才试候选（不改变默认行为）');
  // 第二轮请求直接复用探测到的地址，不再重复试错路径
  const before = up.seen.length;
  await c.chat('s', 'u', cfg);
  assert(up.seen.length - before === 1, '探测到的可用地址被复用，后续请求不再重复探测');
  up.srv.close();
}

// ── 3. base_url 多写 /v1（写成 .../v1/v1）：回落到根路径 ──────────────────────
{
  const up = sseOnly('/chat/completions');
  const port = await listen(up.srv);
  const c = new OpenAICompatibleConnector({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port}/v1` });
  const r = await c.chat('s', 'u', cfg);
  assert(r.content === 'ok', 'base_url 多写版本段时回落到根路径成功');
  up.srv.close();
}

// ── 4. 两种拼法都不通：报错必须说清「打的哪个地址、为什么 405」───────────────
{
  const up = sseOnly('/nowhere');
  const port = await listen(up.srv);
  const c = new OpenAICompatibleConnector({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port}/v1` });
  const msg = await c.chat('s', 'u', cfg).then(() => '', (e: Error) => e.message);
  assert(/API error 404/.test(msg), '仍如实报出上游状态码');
  assert(msg.includes('请求地址: POST'), '错误里带上实际请求地址');
  assert(msg.includes('供应商'), '错误里给出可照做的排查指引');
  up.srv.close();
}

// ── 5. 跨域跳转不把 key 送出去 ────────────────────────────────────────────────
{
  const up = sseOnly('/v1/chat/completions');
  const upPort = await listen(up.srv, 'localhost');
  const redirector = http.createServer((req, res) => {
    res.writeHead(301, { location: `http://localhost:${upPort}${req.url}` });
    res.end();
  });
  const redirPort = await listen(redirector, '127.0.0.1');
  const c = new OpenAICompatibleConnector({ apiKey: 'k', baseUrl: `http://127.0.0.1:${redirPort}/v1` });
  await c.chat('s', 'u', cfg).catch(() => {});
  assert(up.seen.length > 0 && up.seen.every((s) => s.auth === undefined), '跳到别的域名时不带 Authorization（防 key 外泄）');
  redirector.close(); up.srv.close();
}

// ── 6. 404 但上游给了结构化 error（如「模型不存在」）→ 不当成地址配错去试别的路径 ──
{
  const seen: string[] = [];
  const srv = http.createServer((req, res) => {
    seen.push(req.url!);
    let b = ''; req.on('data', (d) => (b += d));
    req.on('end', () => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'model gpt-4o does not exist', type: 'invalid_request_error' } }));
    });
  });
  const port = await listen(srv);
  const c = new OpenAICompatibleConnector({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port}/v1` });
  const msg = await c.chat('s', 'u', cfg).then(() => '', (e: Error) => e.message);
  assert(seen.length === 1, 'API 层的 404（模型不存在）不触发换路径重试');
  assert(msg.includes('does not exist'), '上游的业务错误原文不被兜底请求盖掉');
  srv.close();
}

// ── 7. 本机地址补 http 而不是 https（Ollama 等自建服务）──────────────────────
assert(normalizeBaseUrl('localhost:11434') === 'http://localhost:11434', '本机地址补 http');
assert(normalizeBaseUrl('127.0.0.1:8000/v1') === 'http://127.0.0.1:8000/v1', '本机 IP 补 http');

// ── 8. 端点无视 stream:true，直接回整个 JSON → 照样取到内容（否则是「跑成功但没产出」）──
{
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: '非流式回答' }, finish_reason: 'stop' }] }));
    });
  });
  const port = await listen(srv);
  const c = new OpenAICompatibleConnector({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port}/v1` });
  const r = await c.chat('s', 'u', cfg);
  assert(r.content === '非流式回答', '非流式 JSON 响应能解析出内容');
  srv.close();
}

// ── 9. content-type 标了 json、实际发的是 SSE → 退回按行解析，不两头落空 ──────
{
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '半' } }] })}\n\n`);
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: '流' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  const port = await listen(srv);
  const c = new OpenAICompatibleConnector({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port}/v1` });
  const r = await c.chat('s', 'u', cfg);
  assert(r.content === '半流', 'content-type 与实际格式不符时仍能取到内容');
  srv.close();
}

// ── 10. 缓存的端点后来失效 → 清缓存重探，不整轮卡死在坏地址上 ────────────────
{
  let alive = true;
  const seen: string[] = [];
  const srv = http.createServer((req, res) => {
    seen.push(req.url!);
    let b = ''; req.on('data', (d) => (b += d));
    req.on('end', () => {
      const okPath = alive ? '/v1/chat/completions' : '/chat/completions';
      if (req.url !== okPath) {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ detail: 'Method Not Allowed' }));
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  const port = await listen(srv);
  const c = new OpenAICompatibleConnector({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port}/v1` });
  assert((await c.chat('s', 'u', cfg)).content === 'ok', '首轮探测到可用端点');
  alive = false;  // 上游改了路由：原来那个地址不通了
  assert((await c.chat('s', 'u', cfg)).content === 'ok', '缓存端点失效后自动重探候选并跑通');
  srv.close();
}

// ── 11. 跳转带不带 key 的边界：多段 TLD 不能被当成同域（否则跳一下就把 key 骗走）──
const scope = (from: string, to: string) => sameCredentialScope(new URL(from), new URL(to));
assert(scope('https://api.x.com/v1', 'https://api.x.com/v2'), '同 host：带 key');
assert(scope('https://x.com/v1', 'https://www.x.com/v1'), '父子域（x.com → www.x.com）：带 key');
assert(scope('https://api.x.com/v1', 'https://x.com/v1'), '子域回父域：带 key');
assert(!scope('https://api.example.co.uk/v1', 'https://evil.co.uk/v1'), '多段 TLD 下的不同注册域：不带 key');
assert(!scope('https://api.x.com/v1', 'https://x.com.evil.net/v1'), '后缀伪装域名：不带 key');
assert(!scope('https://api.x.com/v1', 'http://api.x.com/v1'), '降级到明文 http：不带 key');

// ── 12. Ollama 也走「跳转保持 POST」（远程 Ollama 常挂反代后面）─────────────────
{
  const seen: Array<{ method: string; url: string }> = [];
  const srv = http.createServer((req, res) => {
    seen.push({ method: req.method!, url: req.url! });
    let b = ''; req.on('data', (d) => (b += d));
    req.on('end', () => {
      if (req.url !== '/api/chat' || req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'method not allowed' }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: { content: '本地回答' }, eval_count: 3, prompt_eval_count: 5 }));
    });
  });
  const port = await listen(srv);
  const redirector = http.createServer((req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${port}${req.url}` });
    res.end();
  });
  const rport = await listen(redirector);
  const c = new OllamaConnector(`http://127.0.0.1:${rport}`);
  const r = await c.chat('s', 'u', { provider: 'ollama', model: 'llama3' });
  assert(r.content === '本地回答', 'Ollama：被 302 跳转后仍以 POST 重发');
  assert(seen.every((x) => x.method === 'POST'), 'Ollama：跳转目标收到的不是被降级的 GET');
  srv.close(); redirector.close();
}
assert(new OllamaConnector('localhost:11434') instanceof OllamaConnector, 'Ollama：只写 localhost:11434 也能构造（补 http）');

// ── 13. 网关对不存在的路径回「200 + 正文写着接口不存在」（LanoX 实测就是这样）──────
// 按状态码判路径的逻辑对它全线失效：/v1 兜底不触发、解析又捞不到 content，
// 表现成最难查的那种失败「跑完了但什么都没生成」。这里钉住两件事：能自动换到 /v1；
// 两个候选都被挡回来时必须报错说清是地址问题，绝不能静悄悄返回空内容。
{
  const shell = JSON.stringify({ data: null, code: '404', codeMsg: '接口不存在' });
  const seen: string[] = [];
  const srv = http.createServer((req, res) => {
    seen.push(req.url!);
    let b = ''; req.on('data', (d) => (b += d));
    req.on('end', () => {
      if (req.url === '/v1/chat/completions') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });  // 关键：不是 404
      res.end(shell);
    });
  });
  const port = await listen(srv);
  const c = new OpenAICompatibleConnector({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port}` });
  const r = await c.chat('s', 'u', cfg);
  assert(r.content === 'ok', '200 + 「接口不存在」壳 → 自动换到 /v1 候选（不再当成功）');
  assert(seen[0] === '/chat/completions' && seen.includes('/v1/chat/completions'), '先按用户填的拼，被挡回来才试 /v1');
  srv.close();
}
{
  // 两个候选都是这种壳 → 必须抛错并点破是地址问题
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: null, code: '404', codeMsg: '接口不存在' }));
    });
  });
  const port = await listen(srv);
  const c = new OpenAICompatibleConnector({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port}/v1` });
  let msg = '';
  try { await c.chat('s', 'u', cfg); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
  assert(/接口不存在/.test(msg) && /base_url/.test(msg), '两个候选都被挡 → 报错点破地址没走对，而不是返回空内容');
  srv.close();
}
// 判据本身要保守：正常响应哪怕正文里出现 "code":"404" 也不能被当成路由未命中
{
  const ok = JSON.stringify({ choices: [{ message: { content: '错误码 "code":"404" 的含义是…' } }] });
  assert(!isGatewayRouteMissShell(ok), '带 choices 的正常响应不会被误判为「接口不存在」');
  assert(isGatewayRouteMissShell('{"data":null,"code":"404","codeMsg":"接口不存在"}'), '网关壳能被认出来');
  assert(!isGatewayRouteMissShell('{"data":[],"code":"200"}'), '业务码 200 不是路由未命中');
}

// ── 14. 配了代理但 Node 的 fetch 不走它 —— "curl 能通、AO 连不上"的头号原因 ──────
// 这条不改网络行为，只保证报错里把话说清楚；重点是**别把代理里的账号密码打进日志**。
{
  assert(envProxyHint({} as NodeJS.ProcessEnv) === '', '没配代理时不出提示（别制造噪音）');
  const hint = envProxyHint({ HTTPS_PROXY: 'http://127.0.0.1:7890' } as NodeJS.ProcessEnv);
  assert(/HTTPS_PROXY/.test(hint) && /127\.0\.0\.1:7890/.test(hint), '配了代理时点破，并回显地址');
  assert(/fetch/.test(hint) || /curl/.test(hint), '要说清"curl 能通不代表 AO 能通"');
  const withCreds = envProxyHint({ ALL_PROXY: 'http://alice:s3cret@proxy.internal:8080' } as NodeJS.ProcessEnv);
  assert(!/s3cret/.test(withCreds) && !/alice/.test(withCreds), '代理地址里的账号密码绝不能打进错误信息');
  assert(/proxy\.internal:8080/.test(withCreds), '去掉凭证后仍要能看出打的是哪个代理');
  // 大小写两种写法都要认（很多人只 export 小写的）
  assert(envProxyHint({ https_proxy: 'http://127.0.0.1:1080' } as NodeJS.ProcessEnv) !== '', '小写 https_proxy 也要认');
}

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
