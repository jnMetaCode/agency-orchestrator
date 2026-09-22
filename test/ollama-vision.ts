/**
 * ollama 连接器的图片输入：起一个假的 Ollama，断言
 * ① 消息里的 data URI 被拆成 `images`（base64 数组）、文本里留 [图片N] 占位、base64 不再出现在文本里；
 * ② num_ctx 把图片算进去——真机 12 张缩略图只按文本估成 4096，Ollama 直接 400
 *    "request (11867 tokens) exceeds the available context"。
 */
import { createServer } from 'node:http';
import { OllamaConnector } from '../src/connectors/ollama.js';

let passed = 0, failed = 0;
function assert(c: boolean, m: string): void { if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; } }
console.log('\n─── ollama 图片输入 ───');

const seen: any[] = [];
const server = createServer((req, res) => {
  let body = ''; req.on('data', (d) => { body += d; }).on('end', () => {
    seen.push(JSON.parse(body));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: { role: 'assistant', content: 'ok' }, done: true, prompt_eval_count: 1, eval_count: 1 }));
  });
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const c = new OllamaConnector(url);
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const jpg = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const cfg = { provider: 'ollama', model: 'qwen2.5vl:3b', max_tokens: 100 } as any;

await c.chat('sys', `候选 1：data:image/png;base64,${png}\n候选 2：data:image/jpeg;base64,${jpg}\n候选 3：data:image/png;base64,${png}\n只输出 JSON`, cfg);
const m = seen[0].messages.find((x: any) => x.role === 'user');
assert(Array.isArray(m.images) && m.images.length === 3, '三张图进了 images 数组');
assert(m.images[0] === png && m.images[1] === jpg && m.images[2] === png, 'images 里是裸 base64、顺序不变');
assert(!m.content.includes('base64,') && m.content.includes('[图片1]') && m.content.includes('[图片2]'), '文本里只剩占位，没有 base64');
const withImages = seen[0].options.num_ctx;

await c.chat('sys', '没有图的普通消息', cfg);
assert(!('images' in seen[1].messages[1]), '没图时不带 images 字段（老版本 Ollama 对空数组也可能报错）');
assert(withImages > 4096 && seen[1].options.num_ctx === 4096, `num_ctx 把图片算进去了：3 张图 ${withImages} > 下限 4096，不带图仍是下限 ${seen[1].options.num_ctx}`);

// 12 张图必须超过 Ollama 默认的 4096 上下文（真机撞过的那个数）
const twelve = Array.from({ length: 12 }, (_, i) => `候选 ${i + 1}：data:image/png;base64,${png}`).join('\n');
await c.chat('sys', twelve, cfg);
assert(seen[2].options.num_ctx > 12000, `12 张图的 num_ctx = ${seen[2].options.num_ctx}，得盖住真机报的 11867`);

server.close();
console.log(`\n通过 ${passed}，失败 ${failed}`);
if (failed) process.exit(1);
