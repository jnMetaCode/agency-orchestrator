/**
 * 文生图步骤的**端到端**测试：in-process 跑真 run()（解析 → DAG → 执行器 → reporter 落盘）。
 *
 * 为什么单测不够：generateImage / parser / reporter 各自的单测全绿时，执行器把
 * imageAsset 从 node 传进 StepResult 的那一环仍然断过（upsert 有两个调用点，补丁只落在
 * 恢复路径上，assets 根本不落盘）——那个 bug 是手工端到端跑出来的。这里把同样的链路
 * 固化成自动化：上游文字步骤 → 变量流进图片提示词 → PNG 落盘 → md/metadata 全对。
 */
import http from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { run } from '../src/index.js';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; }
}
const listen = async (srv: http.Server): Promise<number> => {
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  return (srv.address() as { port: number }).port;
};
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_BYTES = Buffer.from(PNG_B64, 'base64');

console.log('\n─── 端到端：文字步 → 图片步（协议 A）───');
{
  const imagePrompts: string[] = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d));
    req.on('end', () => {
      if (/chat\/completions/.test(String(req.url))) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '春日限定海报文案' }, finish_reason: 'stop' }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
      }
      if (/images\/generations/.test(String(req.url))) {
        imagePrompts.push(String((JSON.parse(b) as { prompt?: string }).prompt));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }));
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"error":"nope"}');
    });
  });
  const port = await listen(srv);

  const dir = mkdtempSync(join(tmpdir(), 'ao-e2e-img-'));
  const wf = join(dir, 'w.yaml');
  writeFileSync(wf, [
    'name: "图e2e"',
    'agents_dir: "agency-agents-zh"',
    'llm:',
    '  provider: "lanox"',
    '  model: "gpt-5.6-sol"',
    `  base_url: "http://127.0.0.1:${port}/v1"`,
    'steps:',
    '  - id: idea',
    '    role: "engineering/engineering-ai-engineer"',
    '    task: "想一句文案"',
    '    output: copy_text',
    '  - id: poster',
    '    type: image',
    '    task: "为 {{copy_text}} 出图"',
    '    image:',
    '      model: "gpt-image-2"',
    '    output: poster_img',
    '    depends_on: [idea]',
  ].join('\n'), 'utf-8');

  const saved = process.env.LANOX_API_KEY;
  process.env.LANOX_API_KEY = 'sk-e2e';
  try {
    const result = await run(wf, {}, { quiet: true, outputDir: join(dir, 'out') });
    assert(result.success === true, `运行应成功（${result.steps.map((s) => `${s.id}:${s.status}`).join(', ')}）`);
    assert(imagePrompts[0]?.includes('春日限定海报文案'), `上游产出应流进图片提示词，实际：${imagePrompts[0]}`);

    const poster = result.steps.find((s) => s.id === 'poster');
    // 正是漏过 bug 的那一环：node.imageAsset → StepResult.imageAsset
    assert(poster?.imageAsset?.filename === 'poster.png', `StepResult 应带 imageAsset（实际 ${JSON.stringify(poster?.imageAsset)}）`);
    assert(poster?.output === '![poster](assets/poster.png)', `输出变量应是 markdown 引用（实际 ${poster?.output}）`);

    // 运行目录名带时间戳，直接扫
    const dirs = (await import('node:fs')).readdirSync(join(dir, 'out'));
    const rd = join(dir, 'out', dirs.find((d) => d.startsWith('图e2e'))!);
    assert(readFileSync(join(rd, 'assets', 'poster.png')).equals(PNG_BYTES), 'PNG 应落进 assets/ 且字节一致');
    assert(readFileSync(join(rd, 'steps', '2-poster.md'), 'utf-8').includes('](../assets/poster.png)'), '步骤 md 引用应补 ../');
    const meta = JSON.parse(readFileSync(join(rd, 'metadata.json'), 'utf-8')) as { steps: Array<{ id: string; imageAsset?: { filename?: string; base64?: string } }> };
    const metaPoster = meta.steps.find((s) => s.id === 'poster');
    assert(metaPoster?.imageAsset?.filename === 'poster.png' && !metaPoster?.imageAsset?.base64, 'metadata 只留 filename、不留 base64');
  } finally {
    if (saved === undefined) delete process.env.LANOX_API_KEY; else process.env.LANOX_API_KEY = saved;
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log('\n─── 端到端：Images API 不存在 → 自动降级 Responses 工具（协议 B）───');
{
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d));
    req.on('end', () => {
      if (/images\/generations/.test(String(req.url))) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end('{"error":"not found"}');
      }
      if (String(req.url) === '/v1/responses') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ object: 'response', status: 'completed', output: [{ type: 'image_generation_call', status: 'completed', result: PNG_B64 }] }));
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"error":"nope"}');
    });
  });
  const port = await listen(srv);
  const dir = mkdtempSync(join(tmpdir(), 'ao-e2e-img-b-'));
  const wf = join(dir, 'w.yaml');
  writeFileSync(wf, [
    'name: "图e2eB"',
    'agents_dir: "agency-agents-zh"',
    'llm:',
    '  provider: "lanox"',
    '  model: "gpt-5.6-sol"',
    `  base_url: "http://127.0.0.1:${port}/v1"`,
    'steps:',
    '  - id: pic',
    '    type: image',
    '    task: "出一张图"',
    '    image:',
    '      model: "gpt-image-2"',
  ].join('\n'), 'utf-8');
  const saved = process.env.LANOX_API_KEY;
  process.env.LANOX_API_KEY = 'sk-e2e';
  try {
    const result = await run(wf, {}, { quiet: true, outputDir: join(dir, 'out') });
    assert(result.success === true, '纯图片工作流（无文字步）也应跑通');
    const dirs = (await import('node:fs')).readdirSync(join(dir, 'out'));
    const rd = join(dir, 'out', dirs.find((d) => d.startsWith('图e2eB'))!);
    assert(readFileSync(join(rd, 'assets', 'pic.png')).equals(PNG_BYTES), '降级到协议 B 后 PNG 同样落盘');
    assert(existsSync(join(rd, 'steps', '1-pic.md')), '步骤 md 存在');
  } finally {
    if (saved === undefined) delete process.env.LANOX_API_KEY; else process.env.LANOX_API_KEY = saved;
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed > 0 ? 1 : 0);
