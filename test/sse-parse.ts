/**
 * 流式响应（SSE）解析的两个边角。都不是臆测：SSE 规范里 `data:` 后的空格是可选的，
 * 而「最后一行没有换行」是任何手写网关都可能干的事。两种情况下调用其实**成功了**，
 * 连接器却报「模型返回了空正文」或者悄悄少一截。
 */
import { createServer } from 'node:http';
import { OpenAICompatibleConnector } from '../src/connectors/openai-compatible.js';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; }
}

async function chatAgainst(body: string): Promise<{ content?: string; error?: string }> {
  const server = createServer((req, res) => {
    req.resume();
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const conn = new OpenAICompatibleConnector({ apiKey: 'test', baseUrl: url });
    const r = await conn.chat('sys', 'user', { provider: 'deepseek', model: 'x', timeout: 10_000 } as any);
    return { content: r.content };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  } finally {
    server.close(); server.closeAllConnections?.();
  }
}
const chunk = (text: string, finish?: string) => JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: finish ?? null }] });

console.log('\n─── SSE 解析 ───');
{
  const r = await chatAgainst(`data: ${chunk('你好，')}\n\ndata: ${chunk('世界', 'stop')}\n\ndata: [DONE]\n\n`);
  assert(r.content === '你好，世界', `标准写法照常（实际 ${JSON.stringify(r)}）`);
}
{
  const r = await chatAgainst(`data:${chunk('你好，')}\n\ndata:${chunk('世界', 'stop')}\n\ndata:[DONE]\n\n`);
  assert(r.content === '你好，世界', `\`data:\` 后没有空格也认（实际 ${JSON.stringify(r).slice(0, 120)}）`);
}
{
  const r = await chatAgainst(`data: ${chunk('你好，')}\n\ndata: ${chunk('世界', 'stop')}`);
  assert(r.content === '你好，世界', `最后一行没有换行结尾，最后一个 chunk 不丢（实际 ${JSON.stringify(r).slice(0, 120)}）`);
}
{
  const r = await chatAgainst(`: keep-alive\n\nevent: message\ndata: ${chunk('好', 'stop')}\n\n`);
  assert(r.content === '好', '注释行 / event 行照常忽略');
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed > 0 ? 1 : 0);
