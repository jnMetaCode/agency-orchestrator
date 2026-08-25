/**
 * type: concat —— 多段 mp4 用本机 ffmpeg 合成。
 * 钉住：解析期拦住缺 inputs；找不到 ffmpeg 报"怎么装"而不是 ENOENT；不同尺寸/有无音轨的段能规整后拼接；
 * 端到端：两个视频步骤 → concat → 成片落盘、metadata 不带 base64。ffmpeg 不在时跳过真实合成（不装作跑了）。
 */
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { concatVideos, FfmpegMissingError } from '../src/media/concat.js';
import { parseWorkflow } from '../src/core/parser.js';
import { run } from '../src/index.js';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve(fn()).then(
    () => { console.log(`  ✅ ${name}`); passed++; },
    (err) => { console.log(`  ❌ ${name}: ${err instanceof Error ? err.message : err}`); failed++; },
  );
}
function assert(c: boolean, m: string): void { if (!c) throw new Error(m); }
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const clip = (dir: string, name: string, size: string, secs: number, audio: boolean): Buffer => {
  const p = join(dir, name);
  const args = ['-y', '-f', 'lavfi', '-i', `testsrc=duration=${secs}:size=${size}:rate=24`];
  if (audio) args.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${secs}`, '-c:a', 'aac');
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', p);
  const r = spawnSync('ffmpeg', args);
  if (r.status !== 0) throw new Error(`造测试片失败：${r.stderr.toString().slice(-200)}`);
  return readFileSync(p);
};
const probe = (file: string): { w: number; h: number; dur: number } => {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'csv=p=0', file], { encoding: 'utf-8' });
  const lines = r.stdout.trim().split('\n');
  const [w, h] = lines[0].split(',').map(Number);
  const dur = Number(lines[1] ?? lines[0].split(',')[2]);
  return { w, h, dur };
};

console.log('\n─── 解析期 ───');
await test('concat 步骤不需要 role/task，但必须有 concat.inputs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ao-concat-wf-'));
  const f = join(dir, 'w.yaml');
  writeFileSync(f, 'name: "x"\nllm:\n  provider: "metaso"\nsteps:\n  - id: a\n    type: video\n    task: "猫"\n    video:\n      model: "MiniMax-H3"\n    output: a_mp4\n  - id: film\n    type: concat\n    concat:\n      inputs: ["{{a_mp4}}"]\n    output: film\n    depends_on: [a]\n', 'utf-8');
  const wf = parseWorkflow(f);
  assert(wf.steps[1].type === 'concat' && !wf.steps[1].role, '应通过且无需 role');
  writeFileSync(f, 'name: "x"\nllm:\n  provider: "metaso"\nsteps:\n  - id: film\n    type: concat\n    output: film\n', 'utf-8');
  let msg = '';
  try { parseWorkflow(f); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
  assert(/concat.*inputs/.test(msg), `缺 inputs 应在解析期报清楚，实际：${msg.slice(0, 100)}`);
  rmSync(dir, { recursive: true, force: true });
});

console.log('\n─── ffmpeg ───');
await test('找不到 ffmpeg 时报"怎么装"，不是裸 ENOENT', async () => {
  const prev = process.env.AO_FFMPEG;
  process.env.AO_FFMPEG = '/nonexistent/ffmpeg';
  try {
    let err: unknown;
    try { await concatVideos([{ name: 'a.mp4', buffer: Buffer.from('x') }]); } catch (e) { err = e; }
    assert(err instanceof FfmpegMissingError, `应抛 FfmpegMissingError，实际 ${String(err).slice(0, 80)}`);
    assert(/brew install ffmpeg/.test(String((err as Error).message)) && /AO_FFMPEG/.test(String((err as Error).message)), '报错应带安装方式与 AO_FFMPEG');
  } finally { if (prev === undefined) delete process.env.AO_FFMPEG; else process.env.AO_FFMPEG = prev; }
});

if (!hasFfmpeg) {
  console.log('  ⚠️  本机没有 ffmpeg，跳过真实合成与端到端（不装作跑了）');
} else {
  await test('不同尺寸、一段无音轨：规整到第一段尺寸后拼接，总时长 = 各段之和', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ao-concat-'));
    try {
      const a = clip(dir, 'a.mp4', '128x72', 1, true);
      const b = clip(dir, 'b.mp4', '64x64', 1, false);
      const out = await concatVideos([{ name: 'a.mp4', buffer: a }, { name: 'b.mp4', buffer: b }]);
      const p = join(dir, 'out.mp4');
      writeFileSync(p, out);
      const info = probe(p);
      assert(info.w === 128 && info.h === 72, `尺寸应取第一段 128x72，实际 ${info.w}x${info.h}`);
      assert(info.dur > 1.8 && info.dur < 2.3, `总时长应≈2s，实际 ${info.dur}`);
      const audio = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', p], { encoding: 'utf-8' }).stdout;
      assert(/audio/.test(audio), '成片应带音轨（无音轨的段补了静音）');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  await test('端到端：两个视频步骤 → concat → assets/film.mp4，metadata 不带 base64', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ao-concat-e2e-'));
    const mp4 = clip(dir, 'src.mp4', '64x64', 1, false);
    const srv = http.createServer((req, res) => {
      const url = String(req.url || '');
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        const port = (res.socket as any).localPort;
        if (/v2\/video_generation/.test(url) && req.method === 'POST') {
          const id = /镜头1/.test(body) ? '1001' : '1002';
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ task_id: id }));
        }
        if (/v2\/query\/video_generation/.test(url)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ items: ['1001', '1002'].map((id) => ({ id, status: 'succeeded', content: { url: `http://127.0.0.1:${port}/c.mp4` }, usage: { total_seconds: 1 } })) }));
        }
        if (/c\.mp4/.test(url)) { res.writeHead(200, { 'Content-Type': 'video/mp4' }); return res.end(mp4); }
        res.writeHead(404).end('{}');
      });
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const port = (srv.address() as { port: number }).port;
    const wf = join(dir, 'w.yaml');
    writeFileSync(wf, [
      'name: "两镜合一"', 'llm:', '  provider: "metaso"', `  base_url: "http://127.0.0.1:${port}"`, '  api_key: "mk"',
      'steps:',
      '  - id: s1', '    type: video', '    task: "镜头1"', '    video:', '      model: "MiniMax-H3"', '      poll_interval: 10', '    output: s1_mp4',
      '  - id: s2', '    type: video', '    task: "镜头2"', '    video:', '      model: "MiniMax-H3"', '      poll_interval: 10', '    output: s2_mp4',
      '  - id: film', '    type: concat', '    concat:', '      inputs: ["{{s1_mp4}}", "{{s2_mp4}}"]', '    output: film_mp4', '    depends_on: [s1, s2]',
    ].join('\n'), 'utf-8');
    try {
      const result = await run(wf, {}, { quiet: true, outputDir: join(dir, 'out') });
      assert(result.success === true, `运行应成功（${result.steps.map((s) => `${s.id}:${s.status} ${s.error ?? ''}`).join(', ')}）`);
      const { readdirSync } = await import('node:fs');
      const outDir = join(dir, 'out', readdirSync(join(dir, 'out'))[0]);
      assert(existsSync(join(outDir, 'assets', 'film.mp4')), '成片应落到 assets/film.mp4');
      assert(probe(join(outDir, 'assets', 'film.mp4')).dur > 1.8, '成片时长应≈两段之和');
      const film = result.steps.find((s) => s.id === 'film');
      assert(/\(assets\/film\.mp4\)/.test(film?.output ?? ''), `输出变量应是 markdown 链接，实际 ${film?.output}`);
      assert(!/base64/.test(readFileSync(join(outDir, 'metadata.json'), 'utf-8')), 'metadata 不带 base64');
    } finally { srv.close(); rmSync(dir, { recursive: true, force: true }); }
  });
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
