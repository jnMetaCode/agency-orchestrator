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


console.log('\n─── 端到端：duration 走输入时必须转成数字 ───');
{
  // 模板把 resolution/duration 做成输入后，YAML 里它们就是字符串 "{{video_duration}}"。
  // 渲染白名单里漏了 duration 的话，发给厂商的就是那串花括号本身——参数非法、白花一次调用。
  const seen: { create?: any; prompts: string[] } = { prompts: [] };
  const srv = fakeServer(seen);
  const port = await listen(srv);
  const dir = mkdtempSync(join(tmpdir(), 'ao-e2e-video4-'));
  const wf = join(dir, 'v.yaml');
  writeFileSync(wf, [
    'name: "参数走输入"',
    'llm:',
    '  provider: "metaso"',
    `  base_url: "http://127.0.0.1:${port}"`,
    '  api_key: "mk-test"',
    'inputs:',
    '  - name: res',
    '    required: true',
    '  - name: secs',
    '    required: true',
    'steps:',
    '  - id: clip',
    '    type: video',
    '    task: "猫"',
    '    video:',
    '      model: "MiniMax-H3"',
    '      resolution: "{{res}}"',
    '      duration: "{{secs}}"',
    '    output: c',
  ].join('\n'), 'utf-8');

  try {
    const result = await run(wf, { res: '2K', secs: '7' }, { quiet: true, outputDir: join(dir, 'out') });
    assert(result.success === true, `应完成（${result.steps.map((s) => `${s.id}:${s.status}`).join(', ')} ${result.steps[0]?.error ?? ''}）`);
    assert(seen.create?.resolution === '2K', `resolution 应渲染成 2K，实际 ${seen.create?.resolution}`);
    assert(seen.create?.duration === 7, `duration 要是**数字** 7，实际 ${JSON.stringify(seen.create?.duration)}（字符串或花括号都算失败）`);
  } catch (e) {
    assert(false, `端到端跑挂了：${e instanceof Error ? e.message : e}`);
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  // 输入没填/填了非数字时，要在发请求前就报错——按秒计费的东西不该拿 NaN 去试
  const seen: { create?: any; prompts: string[] } = { prompts: [] };
  const srv = fakeServer(seen);
  const port = await listen(srv);
  const dir = mkdtempSync(join(tmpdir(), 'ao-e2e-video5-'));
  const wf = join(dir, 'v.yaml');
  writeFileSync(wf, [
    'name: "秒数填错"',
    'llm:',
    '  provider: "metaso"',
    `  base_url: "http://127.0.0.1:${port}"`,
    '  api_key: "mk-test"',
    'inputs:',
    '  - name: secs',
    '    required: true',
    'steps:',
    '  - id: clip',
    '    type: video',
    '    task: "猫"',
    '    video: { model: "MiniMax-H3", duration: "{{secs}}" }',
    '    output: c',
  ].join('\n'), 'utf-8');
  try {
    const result = await run(wf, { secs: '很快' }, { quiet: true, outputDir: join(dir, 'out') });
    const err = result.steps.find((s) => s.id === 'clip')?.error ?? '';
    assert(/正数秒数/.test(err), `应在发请求前报错，实际：${err}`);
    assert(seen.create === undefined, '不该发出任何建任务请求');
  } catch (e) {
    assert(false, `端到端跑挂了：${e instanceof Error ? e.message : e}`);
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log('\n─── 端到端：两个视频步骤并行，各拿各的片 ───');
{
  // 这条测的是整个视频实现里最容易出错的一环：秘塔的查询接口**不按 task_id 过滤**，
  // 一律返回账号下全部任务。默认 concurrency 就是 2，两个视频步骤同时在跑时，
  // 谁拿谁的片全靠连接器自己按 id 挑——挑错了不会报错，只会悄悄给你别人的视频。
  const MP4_A = Buffer.from('0000001c6674797041414141', 'hex');
  const MP4_B = Buffer.from('0000001c6674797042424242', 'hex');
  let created = 0;
  const srv = http.createServer((req, res) => {
    const url = String(req.url || '');
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      if (/v2\/video_generation/.test(url) && req.method === 'POST') {
        // 按提示词分派 task_id：A 步的提示词里有 "alpha"，B 步有 "beta"
        const id = /alpha/.test(body) ? '111' : '222';
        created++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ task_id: id }));
      }
      if (/v2\/query\/video_generation/.test(url)) {
        const port = (res.socket as any).localPort;
        // **两条任务都在列表里**，顺序还故意反着放
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          items: [
            { id: '222', status: 'succeeded', content: { url: `http://127.0.0.1:${port}/b.mp4` }, usage: { total_seconds: 5 } },
            { id: '111', status: 'succeeded', content: { url: `http://127.0.0.1:${port}/a.mp4` }, usage: { total_seconds: 5 } },
          ],
          total: 2,
        }));
      }
      if (/a\.mp4/.test(url)) { res.writeHead(200, { 'Content-Type': 'video/mp4' }); return res.end(MP4_A); }
      if (/b\.mp4/.test(url)) { res.writeHead(200, { 'Content-Type': 'video/mp4' }); return res.end(MP4_B); }
      res.writeHead(404).end('{}');
    });
  });
  const port = await listen(srv);
  const dir = mkdtempSync(join(tmpdir(), 'ao-e2e-video3-'));
  const wf = join(dir, 'v.yaml');
  writeFileSync(wf, [
    'name: "双片并行"',
    'concurrency: 2',
    'llm:',
    '  provider: "metaso"',
    `  base_url: "http://127.0.0.1:${port}"`,
    '  api_key: "mk-test"',
    'steps:',
    '  - id: clip_a',
    '    type: video',
    '    task: "alpha shot"',
    '    video: { model: "MiniMax-H3", resolution: "768P" }',
    '    output: a',
    '  - id: clip_b',
    '    type: video',
    '    task: "beta shot"',
    '    video: { model: "MiniMax-H3", resolution: "768P" }',
    '    output: b',
  ].join('\n'), 'utf-8');

  try {
    const result = await run(wf, {}, { quiet: true, outputDir: join(dir, 'out') });
    assert(result.success === true, `两步都该完成（${result.steps.map((s) => `${s.id}:${s.status}`).join(', ')}）`);
    assert(created === 2, `应建两个任务，实际 ${created}`);
    const { readdirSync } = await import('node:fs');
    const rd = join(dir, 'out', readdirSync(join(dir, 'out'))[0]);
    const a = readFileSync(join(rd, 'assets', 'clip_a.mp4'));
    const b = readFileSync(join(rd, 'assets', 'clip_b.mp4'));
    assert(a.equals(MP4_A), 'clip_a 拿到的不是自己那条（按 task_id 过滤失效）');
    assert(b.equals(MP4_B), 'clip_b 拿到的不是自己那条');
    assert(!a.equals(b), '两步拿到了同一个文件——正是"张冠李戴"那个 bug');
  } catch (e) {
    assert(false, `端到端跑挂了：${e instanceof Error ? e.message : e}`);
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log('\n─── 端到端：图生视频——上游图片步骤的产物直接当首帧（运行中还没落盘，走产物登记） ───');
{
  const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const seen: { create?: any; upload?: number } = {};
  const srv = http.createServer((req, res) => {
    const url = String(req.url || '');
    let n = 0; let body = '';
    req.on('data', (d) => { n += d.length; body += d; });
    req.on('end', () => {
      const port = (res.socket as any).localPort;
      if (/images\/generations/.test(url)) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: [{ b64_json: PNG_B64 }] })); }
      if (/uploads\/images/.test(url)) { seen.upload = n; res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ url: `http://127.0.0.1:${port}/f/image/x.png` })); }
      if (/videos\/generations/.test(url)) { seen.create = JSON.parse(body || '{}'); res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ code: 200, data: [{ status: 'submitted', task_id: 'task_01E2E' }] })); }
      if (/\/tasks\//.test(url)) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ code: 200, data: { status: 'completed', actual_time: 5, result: { videos: [{ url: `http://127.0.0.1:${port}/out.mp4` }] } } })); }
      if (/out\.mp4/.test(url)) { res.writeHead(200, { 'Content-Type': 'video/mp4' }); return res.end(MP4); }
      res.writeHead(404).end('{}');
    });
  });
  const port = await listen(srv);
  const dir = mkdtempSync(join(tmpdir(), 'ao-e2e-i2v-'));
  const wf = join(dir, 'v.yaml');
  writeFileSync(wf, [
    'name: "定妆图→出片"',
    'llm:',
    '  provider: "apimart"',
    '  model: "x"',
    `  base_url: "http://127.0.0.1:${port}"`,
    '  api_key: "sk-test"',
    'steps:',
    '  - id: cover',
    '    type: image',
    '    task: "机器人清道夫三视图"',
    '    image:',
    '      model: "img-test"',
    '    output: cover_img',
    '  - id: clip',
    '    type: video',
    '    task: "机器人走过废弃街道"',
    '    video:',
    '      provider: "apimart"',
    '      model: "veo3.1-fast"',
    '      duration: 8',
    '      image: "{{cover_img}}"',
    '      poll_interval: 10',
    '    output: clip_mp4',
    '    depends_on: [cover]',
  ].join('\n'), 'utf-8');
  try {
    const result = await run(wf, {}, { quiet: true, outputDir: join(dir, 'out') });
    assert(result.success === true, `运行应成功（${result.steps.map((s) => `${s.id}:${s.status} ${s.error ?? ''}`).join(', ')}）`);
    assert((seen.upload ?? 0) > 0, '上游图片的字节应在运行中被上传（此时磁盘上还没有 assets/cover.png）');
    assert(Array.isArray(seen.create?.image_urls) && /\/f\/image\/x\.png/.test(seen.create.image_urls[0]), `建任务应带上传得到的 URL（实际 ${JSON.stringify(seen.create)}）`);
    const { readdirSync } = await import('node:fs');
    const outDir = join(dir, 'out', readdirSync(join(dir, 'out'))[0]);
    assert(existsSync(join(outDir, 'assets', 'cover.png')) && existsSync(join(outDir, 'assets', 'clip.mp4')), '图与片都应落到 assets/');
  } catch (e) {
    assert(false, `端到端跑挂了：${e instanceof Error ? e.message : e}`);
  } finally { srv.close(); rmSync(dir, { recursive: true, force: true }); }
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
