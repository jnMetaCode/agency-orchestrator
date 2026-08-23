/**
 * 文生视频步骤的**端到端**测试：in-process 跑真 run()（解析 → DAG → 执行器 → reporter 落盘）。
 *
 * 为什么单测不够：连接器 14 条单测全绿、模板 validate 也过，真机跑内置模板
 *「一句话出短片」时仍然当场炸了——`video: { provider: "{{video_provider}}" }` 里的
 * provider **没过变量渲染**，引擎拿着字面量 "{{video_provider}}" 去查视频供应商表。
 * 执行器当时只渲染了 model。这个 bug 单测照不到（连接器收到的是已渲染的值），
 * 只有把"解析 → 渲染 → 连接器"整条链路跑一遍才会暴露。这里把它钉死。
 */
import http from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
const MP4 = Buffer.from('0000001c667479706d70343200000000', 'hex');

/** 一个同时提供「文本流式补全」与「秘塔形状视频任务」的假服务。 */
function fakeServer(seen: { create?: any; prompts: string[] }) {
  return http.createServer((req, res) => {
    const url = String(req.url || '');
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      if (/chat\/completions/.test(url)) {
        try { seen.prompts.push(JSON.parse(body).messages.map((m: any) => m.content).join('\n')); } catch { /* ignore */ }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '核心主题：治愈系 | 暖橘调 | 超写实' }, finish_reason: 'stop' }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
      }
      if (/v2\/video_generation/.test(url) && req.method === 'POST') {
        seen.create = JSON.parse(body || '{}');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ task_id: '900001' }));
      }
      if (/v2\/query\/video_generation/.test(url)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          items: [{
            id: '900001', status: 'succeeded',
            content: { url: `http://127.0.0.1:${(res.socket as any).localPort}/clip.mp4` },
            usage: { total_seconds: 5 },
          }],
          total: 1,
        }));
      }
      if (/clip\.mp4/.test(url)) {
        res.writeHead(200, { 'Content-Type': 'video/mp4' });
        return res.end(MP4);
      }
      res.writeHead(404).end('{}');
    });
  });
}

console.log('\n─── 端到端：变量化的 provider / model → 出片 → 落盘 ───');
{
  const seen: { create?: any; prompts: string[] } = { prompts: [] };
  const srv = fakeServer(seen);
  const port = await listen(srv);
  const dir = mkdtempSync(join(tmpdir(), 'ao-e2e-video-'));
  const wf = join(dir, 'v.yaml');
  // provider / model / resolution 全部走变量——内置模板「一句话出短片」就是这么写的
  writeFileSync(wf, [
    'name: "出片"',
    'llm:',
    '  provider: "metaso"',
    `  base_url: "http://127.0.0.1:${port}"`,
    '  api_key: "mk-test"',
    'inputs:',
    '  - name: video_provider',
    '    required: true',
    '  - name: video_model',
    '    required: true',
    'steps:',
    '  - id: clip',
    '    type: video',
    '    task: "一只橘猫跳上窗台"',
    '    video:',
    '      provider: "{{video_provider}}"',
    '      model: "{{video_model}}"',
    '      resolution: "768P"',
    '      duration: 5',
    '    output: clip_mp4',
  ].join('\n'), 'utf-8');

  try {
    const result = await run(wf, { video_provider: 'metaso', video_model: 'MiniMax-H3' },
      { quiet: true, outputDir: join(dir, 'out') });
    assert(result.success === true, `运行应成功（${result.steps.map((s) => `${s.id}:${s.status}`).join(', ')} ${result.steps[0]?.error ?? ''}）`);
    assert(seen.create?.model === 'MiniMax-H3',
      `provider/model 必须先过变量渲染再进连接器（厂商实际收到 model=${seen.create?.model}）`);
    assert(seen.create?.resolution === '768P' && seen.create?.duration === 5, 'resolution/duration 应原样透传');
    const { readdirSync } = await import('node:fs');
    const outDir = join(dir, 'out', readdirSync(join(dir, 'out'))[0]);
    assert(existsSync(join(outDir, 'assets', 'clip.mp4')), 'mp4 应落到 assets/');
    assert(readFileSync(join(outDir, 'assets', 'clip.mp4')).equals(MP4), 'mp4 字节应完整');
    const clip = result.steps.find((st) => st.id === 'clip');
    assert(/\(assets\/clip\.mp4\)/.test(clip?.output ?? ''), `输出变量应是指向 assets/ 的 markdown 链接（实际 ${clip?.output}）`);
    assert(clip?.videoAsset?.filename === 'clip.mp4', `StepResult 应带 videoAsset（实际 ${JSON.stringify(clip?.videoAsset)}）`);
    const meta = readFileSync(join(outDir, 'metadata.json'), 'utf-8');
    assert(meta.includes('clip.mp4') && !/base64/.test(meta), 'metadata 只留 filename，不带 base64');
    assert(/"seconds": 5/.test(meta), 'metadata 应保留计费秒数');
  } catch (e) {
    assert(false, `端到端跑挂了：${e instanceof Error ? e.message : e}`);
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log('\n─── 端到端：上游文字步的产出流进视频提示词 ───');
{
  const seen: { create?: any; prompts: string[] } = { prompts: [] };
  const srv = fakeServer(seen);
  const port = await listen(srv);
  const dir = mkdtempSync(join(tmpdir(), 'ao-e2e-video2-'));
  const roles = join(dir, 'roles', 'design');
  const wf = join(dir, 'v.yaml');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(roles, { recursive: true });
  writeFileSync(join(roles, 'p.md'), '---\nname: 提示词工程师\n---\n\n你写视频提示词。\n', 'utf-8');
  writeFileSync(wf, [
    'name: "文字→出片"',
    `agents_dir: "${join(dir, 'roles')}"`,
    'llm:',
    '  provider: "openai"',
    '  model: "gpt-test"',
    `  base_url: "http://127.0.0.1:${port}"`,
    '  api_key: "sk-test"',
    'steps:',
    '  - id: write',
    '    role: "design/p"',
    '    task: "把这个创意写成提示词：橘猫看日落"',
    '    output: prompt_text',
    '  - id: clip',
    '    type: video',
    '    task: "{{prompt_text}}"',
    '    llm:',
    '      provider: "metaso"',
    `      base_url: "http://127.0.0.1:${port}"`,
    '      api_key: "mk-test"',
    '    video:',
    '      model: "MiniMax-H3"',
    '      resolution: "768P"',
    '    output: clip_mp4',
    '    depends_on: [write]',
  ].join('\n'), 'utf-8');

  try {
    const result = await run(wf, {}, { quiet: true, outputDir: join(dir, 'out') });
    assert(result.success === true, `两步都该完成（${result.steps.map((st) => `${st.id}:${st.status}`).join(', ')}）`);
    assert(String(seen.create?.content?.[0]?.text ?? '').includes('核心主题'),
      `上游文字产出应作为视频提示词发给厂商（实际收到：${JSON.stringify(seen.create?.content)}）`);
    const { readdirSync } = await import('node:fs');
    const rd = join(dir, 'out', readdirSync(join(dir, 'out'))[0]);
    assert(existsSync(join(rd, 'assets', 'clip.mp4')), 'mp4 应落盘');
    assert(readFileSync(join(rd, 'steps', '2-clip.md'), 'utf-8').includes('](../assets/clip.mp4)'), '步骤 md 里的链接应补 ../');
  } catch (e) {
    assert(false, `端到端跑挂了：${e instanceof Error ? e.message : e}`);
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
