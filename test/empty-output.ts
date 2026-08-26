/**
 * 空正文不算成功：推理模型"只想不写"、网关丢正文、finish_reason=stop 但 content 为空——都要抛错并说明原因，
 * 不能把空字符串当完成往下游传（真机：一句话出短片第 1 步 0 token 被记为完成，后两步全崩）。
 */
import http from 'node:http';
import { OpenAICompatibleConnector } from '../src/connectors/openai-compatible.js';
import { generateVideo } from '../src/connectors/video.js';
import type { LLMConfig } from '../src/types.js';

let passed = 0, failed = 0;
function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return new Promise<void>((r) => r(fn())).then(() => { console.log(`  ✅ ${name}`); passed++; }, (e) => { console.log(`  ❌ ${name}: ${e instanceof Error ? e.message : e}`); failed++; });
}
const assert = (c: boolean, m: string) => { if (!c) throw new Error(m); };
const sse = (chunks: object[]) => chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
const serve = async (body: string) => {
  const srv = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(body); });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  return { srv, port: (srv.address() as { port: number }).port };
};

await test('只流了 reasoning_content、正文为空 → 抛错并点明"只返回了思考内容"', async () => {
  const { srv, port } = await serve(sse([
    { choices: [{ delta: { reasoning_content: '让我想想……' } }] },
    { choices: [{ delta: { reasoning_content: '再想想。' } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
  ]));
  try {
    const c = new OpenAICompatibleConnector({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port}/v1` });
    let msg = '';
    try { await c.chat('sys', 'hi', { provider: 'openai', model: 'm' } as LLMConfig); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
    assert(/思考内容/.test(msg) && /reasoning/.test(msg), `应点明只返回了思考内容，实际：${msg.slice(0, 120)}`);
  } finally { srv.close(); }
});

await test('正文为空且无 reasoning → 抛错说明空正文与 finish_reason', async () => {
  const { srv, port } = await serve(sse([{ choices: [{ delta: {}, finish_reason: 'stop' }] }]));
  try {
    const c = new OpenAICompatibleConnector({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port}/v1` });
    let msg = '';
    try { await c.chat('sys', 'hi', { provider: 'openai', model: 'm' } as LLMConfig); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
    assert(/空正文/.test(msg) && /stop/.test(msg), `实际：${msg.slice(0, 120)}`);
  } finally { srv.close(); }
});

await test('正常正文照常返回（守卫不误伤）', async () => {
  const { srv, port } = await serve(sse([{ choices: [{ delta: { reasoning_content: '想' } }] }, { choices: [{ delta: { content: '正文' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]));
  try {
    const c = new OpenAICompatibleConnector({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port}/v1` });
    const r = await c.chat('sys', 'hi', { provider: 'openai', model: 'm' } as LLMConfig);
    assert(r.content === '正文', `实际 ${r.content}`);
  } finally { srv.close(); }
});

await test('视频步骤空提示词不发请求（连接器层：空 prompt 直接拒）', async () => {
  // 执行器在建任务前拦；这里确认连接器对空提示词也不会去建任务——用一个不监听的端口：真发了会 ECONNREFUSED
  let msg = '';
  try { await generateVideo({ provider: 'metaso', api_key: 'k', base_url: 'http://127.0.0.1:9' } as unknown as LLMConfig, '   ', { model: 'MiniMax-H3', poll_interval: 10 }); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
  assert(/提示词/.test(msg) && !/ECONNREFUSED/.test(msg), `应在发请求前拦住，实际：${msg.slice(0, 120)}`);
});

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
