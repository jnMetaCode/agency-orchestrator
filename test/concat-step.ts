/**
 * type: concat —— 多段 mp4 用本机 ffmpeg 合成。
 * 钉住：解析期拦住缺 inputs；找不到 ffmpeg 报"怎么装"而不是 ENOENT；不同尺寸/有无音轨的段能规整后拼接；
 * 端到端：两个视频步骤 → concat → 成片落盘、metadata 不带 base64。ffmpeg 不在时跳过真实合成（不装作跑了）。
 * 后期三件套（配音 / 字幕 / BGM）：字幕按各段实际时长排轴；烧字幕要 libass，本机没有就退成软字幕轨并说清。
 */
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { concatVideos, FfmpegMissingError, buildSrt, buildSrtCues, hasFilter, filterHasOption } from '../src/media/concat.js';
import { parseWorkflow, validateWorkflow } from '../src/core/parser.js';
import { run } from '../src/index.js';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return new Promise<void>((r) => r(fn())).then(
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
  // 写错变量名：解析期就拦，别等到合成时报"找不到视频"
  writeFileSync(f, 'name: "x"\nllm:\n  provider: "metaso"\nsteps:\n  - id: a\n    type: video\n    task: "猫"\n    video:\n      model: "MiniMax-H3"\n    output: a_mp4\n  - id: film\n    type: concat\n    concat:\n      inputs: ["{{a_mp4_typo}}"]\n    output: film\n    depends_on: [a]\n', 'utf-8');
  // 变量引用检查在 validateWorkflow（ao validate / run 前都会跑）
  const errs = validateWorkflow(parseWorkflow(f));
  assert(errs.some((e) => /a_mp4_typo/.test(e)), `concat.inputs 里的未知变量应被 validate 报出，实际：${errs.join(' | ').slice(0, 120)}`);
  rmSync(dir, { recursive: true, force: true });
});

console.log('\n─── 字幕排轴（纯函数，不用 ffmpeg）───');

await test('按字数占比分配时长，最后一条正好收在片尾', () => {
  const cues = buildSrtCues('机器人捡到一只鸵鸟。它愣住了。', 6);
  assert(cues.length === 2, `应切成 2 条，实得 ${cues.length}`);
  assert(cues[0].start === 0, '第一条从 0 开始');
  assert(Math.abs(cues[cues.length - 1].end - 6) < 1e-9, `最后一条应正好收在 6s，实得 ${cues[cues.length - 1].end}`);
  // 逐条首尾相接，不留缝也不重叠
  for (let i = 1; i < cues.length; i++) assert(cues[i].start === cues[i - 1].end, '相邻两条应首尾相接');
  // 长句分到更多时间
  assert(cues[0].end - cues[0].start > cues[1].end - cues[1].start, '字多的那条应分到更长时间');
});

await test('长句按逗号继续切，仍过长则硬切，每条不超上限', () => {
  const long = '这是一段很长很长的旁白，它没有句号只有逗号，所以必须继续切开才不会一条字幕糊满整个屏幕';
  for (const c of buildSrtCues(long, 10)) assert(c.text.length <= 18, `每条不应超 18 字，实得「${c.text}」`);
});

await test('空文案 / 时长为 0 → 不产字幕（而不是产一条 0 秒的空轨）', () => {
  assert(buildSrtCues('', 5).length === 0, '空文案不产字幕');
  assert(buildSrtCues('有字', 0).length === 0, '时长 0 不产字幕');
  assert(buildSrt('有字', 0) === '', 'buildSrt 空返回空串');
});

await test('SRT 时间戳是 HH:MM:SS,mmm 且带序号', () => {
  const srt = buildSrt('第一句。第二句。', 4);
  assert(/^1\n00:00:00,000 --> 00:00:0\d,\d{3}\n第一句。/.test(srt), `格式不对：${JSON.stringify(srt.slice(0, 60))}`);
  assert(/\n2\n/.test(srt), '第二条应有序号 2');
});

console.log('\n─── 逐段字段必须一一对应 ───');

await test('voiceover / subtitles 条数与 inputs 不一致 → 解析期就报', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ao-concat-post-'));
  const f = join(dir, 'w.yaml');
  const head = 'name: "x"\nllm:\n  provider: "metaso"\nsteps:\n  - id: a\n    type: video\n    task: "猫"\n    video:\n      model: "MiniMax-H3"\n    output: a_mp4\n  - id: b\n    type: video\n    task: "狗"\n    video:\n      model: "MiniMax-H3"\n    output: b_mp4\n  - id: film\n    type: concat\n    concat:\n      inputs: ["{{a_mp4}}", "{{b_mp4}}"]\n';
  for (const [field, yaml] of [
    ['voiceover', head + '      voiceover: ["{{vo1}}"]\n    output: film\n    depends_on: [a, b]\n'],
    ['subtitles', head + '      subtitles: ["只有一条"]\n    output: film\n    depends_on: [a, b]\n'],
  ] as const) {
    writeFileSync(f, yaml, 'utf-8');
    let msg = '';
    try { parseWorkflow(f); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
    assert(new RegExp(`concat.${field}.*1 条.*2 段`).test(msg), `${field} 数量不符应在解析期点名，实际：${msg.slice(0, 160)}`);
  }
  // 音量必须是非负数字
  writeFileSync(f, head + '      bgm_volume: "响一点"\n    output: film\n    depends_on: [a, b]\n', 'utf-8');
  let msg = '';
  try { parseWorkflow(f); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
  assert(/bgm_volume.*非负数字/.test(msg), `bgm_volume 类型错应报出，实际：${msg.slice(0, 120)}`);
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

const audio = (dir: string, name: string, freq: number, secs: number): Buffer => {
  const p = join(dir, name);
  const r = spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${secs}`, '-c:a', 'libmp3lame', p]);
  if (r.status !== 0) throw new Error(`造测试音频失败：${r.stderr.toString().slice(-200)}`);
  return readFileSync(p);
};
const streams = (file: string): string[] => spawnSync(
  'ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file], { encoding: 'utf-8' },
).stdout.trim().split('\n').filter(Boolean);

if (hasFfmpeg) {
  console.log('\n─── 后期三件套（真 ffmpeg）───');

  await test('配音混进对应那一段：画面时长不变，无音轨的段也拿到音轨', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ao-concat-vo-'));
    try {
      const a = clip(dir, 'a.mp4', '320x240', 3, false);   // 无音轨
      const b = clip(dir, 'b.mp4', '320x240', 2, true);
      const out = await concatVideos(
        [{ name: 'a.mp4', buffer: a }, { name: 'b.mp4', buffer: b }],
        { voiceover: [{ name: 'vo.mp3', buffer: audio(dir, 'vo.mp3', 300, 2) }, null] },
      );
      const f = join(dir, 'film.mp4');
      writeFileSync(f, out);
      // 配音不该改变买来的画面时长
      assert(Math.abs(probe(f).dur - 5) < 0.6, `总时长应≈5s（3+2），实得 ${probe(f).dur}`);
      assert(streams(f).includes('audio'), '成片应有音轨');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  await test('片段自带的声音不被丢掉，压多少可调（视频模型本来就出声，常是对白）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ao-concat-clipvol-'));
    const notices: string[] = [];
    try {
      const a = clip(dir, 'a.mp4', '320x240', 2, true);   // 有音轨 = 模型生成的对白/音效
      const vo = audio(dir, 'vo.mp3', 300, 1);
      // clip_volume: 0 = 完全换掉原声；默认 0.3 = 压下去让路；1 = 同强度并存（要提醒）
      for (const [cv, expectNotice] of [[0, false], [1, true]] as const) {
        notices.length = 0;
        const out = await concatVideos(
          [{ name: 'a.mp4', buffer: a }],
          { voiceover: [{ name: 'vo.mp3', buffer: vo }], clip_volume: cv },
          (m) => notices.push(m),
        );
        const f = join(dir, `film_${cv}.mp4`);
        writeFileSync(f, out);
        assert(streams(f).includes('audio'), `clip_volume=${cv} 时成片应有音轨`);
        assert(Math.abs(probe(f).dur - 2) < 0.6, `clip_volume=${cv} 不该改变片长`);
        const warned = notices.some((n) => /clip_volume 接近 1/.test(n));
        assert(warned === expectNotice, `clip_volume=${cv} 的提醒应为 ${expectNotice}，实得 ${warned}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  await test('配音比画面长 → 明确告警（而不是闷头截掉半句话）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ao-concat-vo2-'));
    const notices: string[] = [];
    try {
      const a = clip(dir, 'a.mp4', '320x240', 2, false);
      await concatVideos(
        [{ name: 'a.mp4', buffer: a }],
        { voiceover: [{ name: 'vo.mp3', buffer: audio(dir, 'vo.mp3', 300, 5) }] },
        (m) => notices.push(m),
      );
      assert(notices.some((n) => /配音.*比画面.*长.*截断/.test(n)), `应告警配音超长，实得：${notices.join(' | ')}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  await test('混音选项按本机 ffmpeg 探测（老版本没有 amix 的 normalize，硬带上去整条链报错）', async () => {
    assert(await hasFilter('amix') === true, '本机应有 amix 滤镜');
    // 有没有 normalize 取决于版本（4.4+ 才有），两种结果都合法——关键是**探过**而不是硬写
    const has = await filterHasOption('amix', 'normalize');
    assert(typeof has === 'boolean', 'filterHasOption 应给出确定结论');
    assert(await filterHasOption('amix', '并不存在的选项') === false, '不存在的选项要报 false，不能一律说有');
  });

  await test('BGM 循环铺满全片并混音，画面不重编（-c:v copy）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ao-concat-bgm-'));
    const notices: string[] = [];
    try {
      const a = clip(dir, 'a.mp4', '320x240', 3, true);
      // BGM 只有 1 秒，比片长短——最常见的翻车是后半段突然静音
      const out = await concatVideos(
        [{ name: 'a.mp4', buffer: a }],
        { bgm: { name: 'bgm.mp3', buffer: audio(dir, 'bgm.mp3', 200, 1) }, bgm_volume: 0.2 },
        (m) => notices.push(m),
      );
      const f = join(dir, 'film.mp4');
      writeFileSync(f, out);
      assert(Math.abs(probe(f).dur - 3) < 0.6, `BGM 不该改变片长，实得 ${probe(f).dur}`);
      assert(streams(f).includes('audio'), '成片应有音轨');
      assert(notices.some((n) => /背景音乐/.test(n)), '应报出混了 BGM');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  await test('字幕：有 libass 就烧进画面；没有就退成软字幕轨并把话说透（绝不静默丢字幕）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ao-concat-sub-'));
    const notices: string[] = [];
    try {
      const a = clip(dir, 'a.mp4', '320x240', 3, true);
      const out = await concatVideos(
        [{ name: 'a.mp4', buffer: a }],
        { subtitles: ['机器人捡到一只会说话的鸵鸟。它愣住了。'], subtitle_style: { size: 28, margin: 20 } },
        (m) => notices.push(m),
      );
      const f = join(dir, 'film.mp4');
      writeFileSync(f, out);
      const canBurn = await hasFilter('subtitles');
      if (canBurn) {
        assert(!streams(f).includes('subtitle'), '能烧字幕时不该再挂软字幕轨');
      } else {
        // 关键：三镜已经花钱出完了，不能因为本机 ffmpeg 缺 libass 就让人拿不到成片
        assert(streams(f).includes('subtitle'), '烧不了时应退成软字幕轨，字幕不能凭空消失');
        assert(notices.some((n) => /libass/.test(n) && /AO_FFMPEG|brew install/.test(n)), `应说清缺什么、怎么修，实得：${notices.join(' | ')}`);
      }
      assert(Math.abs(probe(f).dur - 3) < 0.6, `字幕不该改变片长，实得 ${probe(f).dur}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

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

if (hasFfmpeg) {
  await test('关掉配音：tts 步骤被跳过，合成照常出片（不能被一起跳掉）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ao-concat-skip-'));
    const mp4 = clip(dir, 'src.mp4', '64x64', 1, false);
    const srv = http.createServer((req, res) => {
      const url = String(req.url || '');
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        const port = (res.socket as unknown as { localPort: number }).localPort;
        if (/v2\/video_generation/.test(url) && req.method === 'POST') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ task_id: /镜头1/.test(body) ? '1001' : '1002' }));
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
      'name: "跳过配音"', 'llm:', '  provider: "metaso"', `  base_url: "http://127.0.0.1:${port}"`, '  api_key: "mk"',
      'inputs:', '  - name: narration', '    required: false', '    default: "不配音"',
      'steps:',
      '  - id: s1', '    type: video', '    task: "镜头1"', '    video:', '      model: "MiniMax-H3"', '      poll_interval: 10', '    output: s1_mp4',
      '  - id: s2', '    type: video', '    task: "镜头2"', '    video:', '      model: "MiniMax-H3"', '      poll_interval: 10', '    output: s2_mp4',
      // 条件为假 → 这两步被跳过；它们的 output 会被补成空串
      '  - id: line1', '    type: tts', '    condition: "{{narration}} contains 配旁白"', '    task: "旁白一"',
      '    tts:', '      model: "m"', '      voice: "v"', '    output: line1', '    depends_on: [s1]',
      '  - id: line2', '    type: tts', '    condition: "{{narration}} contains 配旁白"', '    task: "旁白二"',
      '    tts:', '      model: "m"', '      voice: "v"', '    output: line2', '    depends_on: [s2]',
      '  - id: vo1', '    type: tts', '    condition: "{{narration}} contains 配旁白"', '    task: "旁白一"',
      '    tts:', '      model: "m"', '      voice: "v"', '    output: vo1_audio', '    depends_on: [s1]',
      '  - id: vo2', '    type: tts', '    condition: "{{narration}} contains 配旁白"', '    task: "旁白二"',
      '    tts:', '      model: "m"', '      voice: "v"', '    output: vo2_audio', '    depends_on: [s2]',
      '  - id: film', '    type: concat', '    depends_on_mode: any_completed', '    concat:',
      '      inputs: ["{{s1_mp4}}", "{{s2_mp4}}"]',
      '      voiceover: ["{{vo1_audio}}", "{{vo2_audio}}"]',
      // 字幕引用被跳过步骤的产出：不把它们列进 depends_on，
      // 渲染时会直接抛「模板变量未定义」——补空串只对直接依赖方生效
      '      subtitles: ["{{line1}}", "{{line2}}"]',
      '    output: film_mp4', '    depends_on: [s1, s2, vo1, vo2, line1, line2]',
    ].join('\n'), 'utf-8');
    try {
      const result = await run(wf, {}, { quiet: true, outputDir: join(dir, 'out') });
      const status = (id: string) => result.steps.find((x) => x.id === id)?.status;
      assert(status('vo1') === 'skipped' && status('vo2') === 'skipped', `配音步应被跳过，实得 ${status('vo1')}/${status('vo2')}`);
      // 这条是重点：默认的 all 模式会因为依赖被跳过而把合成也跳掉，
      // 于是两镜都出好了、钱也花了，却拼不出成片
      assert(status('film') === 'completed', `合成步不该被一起跳掉，实得 ${status('film')}`);
      assert(result.success === true, `运行应成功（${result.steps.map((x) => `${x.id}:${x.status} ${x.error ?? ''}`).join(', ')}）`);
      const { readdirSync } = await import('node:fs');
      const outDir = join(dir, 'out', readdirSync(join(dir, 'out'))[0]);
      assert(existsSync(join(outDir, 'assets', 'film.mp4')), '成片应落到 assets/film.mp4');
    } finally { srv.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  await test('某一镜没产出 → 合成当场报错，绝不悄悄交付一条少一镜的成片', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ao-concat-missing-'));
    try {
      const wfFile = join(dir, 'w.yaml');
      writeFileSync(wfFile, [
        'name: "缺镜"', 'llm:', '  provider: "metaso"',
        'inputs:', '  - name: a', '    required: false', '    default: ""',
        'steps:',
        '  - id: film', '    type: concat', '    concat:', '      inputs: ["{{a}}"]', '    output: film_mp4',
      ].join('\n'), 'utf-8');
      const result = await run(wfFile, { a: '' }, { quiet: true, outputDir: join(dir, 'out') });
      const film = result.steps.find((x) => x.id === 'film');
      assert(film?.status === 'failed', `应失败，实得 ${film?.status}`);
      assert(/渲染后为空|没有内容/.test(film?.error ?? ''), `报错应点明是哪一段空了，实得：${film?.error}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
