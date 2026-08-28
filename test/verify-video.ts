/**
 * 视频验收（video 步骤的 acceptance）：抽帧 → 看图核对 → 默认只审不重出 → video.rework: true 才重出。
 * 钉住：抽帧确实进了核验消息（多帧 image_url）；默认不过只标 ⚠️、出片一次；rework 开了才重出并用重出提示词；
 * 解析期放行 acceptance、仍拦 assert；花费预览分别标注。ffmpeg 不在时跳过真实抽帧那几条（不装作跑了）。
 */
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/index.js';
import { parseWorkflow } from '../src/core/parser.js';
import { summarizeMediaSpend } from '../src/media/preflight.js';
import { extractFrames } from '../src/media/frames.js';

let passed = 0, failed = 0;
function assert(c: boolean, m: string): void { if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; } }
const listen = async (srv: http.Server): Promise<number> => {
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  return (srv.address() as { port: number }).port;
};
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

console.log('\n─── 解析期 + 花费预览 ───');
{
  const dir = mkdtempSync(join(tmpdir(), 'ao-vvid-parse-'));
  const mk = (extra: string) => { const f = join(dir, `${Math.random().toString(36).slice(2)}.yaml`); writeFileSync(f, `name: x\nllm:\n  provider: metaso\n  model: m\nsteps:\n  - id: a\n    type: video\n    task: 猫\n    acceptance: "1. 有猫"\n    video:\n      model: MiniMax-H3\n      duration: 5\n${extra}`, 'utf-8'); return f; };
  let threw = '';
  try { parseWorkflow(mk('')); } catch (e) { threw = e instanceof Error ? e.message : String(e); }
  assert(threw === '', `video 步骤写 acceptance 应通过解析（实际：${threw.split('\n')[0]}`);
  threw = '';
  try { parseWorkflow(mk('    assert:\n      contains: ["x"]\n')); } catch (e) { threw = e instanceof Error ? e.message : String(e); }
  assert(/assert/.test(threw) && /rework/.test(threw), `video 步骤写 assert 仍拦下并指路 acceptance/rework（实际：${threw.split('\n')[0]}）`);
  threw = '';
  try { parseWorkflow(mk('      rework: "yes"\n')); } catch (e) { threw = e instanceof Error ? e.message : String(e); }
  assert(/rework/.test(threw), 'video.rework 非布尔在解析期报错');
  const pf1 = summarizeMediaSpend(parseWorkflow(mk('')), {});
  assert(pf1.lines.some((l) => l.includes('只审不重出')), `默认预览标「只审不重出」（${pf1.lines[0]}）`);
  const pf2 = summarizeMediaSpend(parseWorkflow(mk('      rework: true\n')), {});
  assert(pf2.lines.some((l) => l.includes('最多 +1')), `rework 预览标「最多 +1」（${pf2.lines[0]}）`);
  rmSync(dir, { recursive: true, force: true });
}

if (!hasFfmpeg) {
  console.log('\n  ⚠️ 本机没有 ffmpeg，跳过抽帧与端到端（不装作跑了）');
} else {
  const dir0 = mkdtempSync(join(tmpdir(), 'ao-vvid-clip-'));
  const clip = join(dir0, 'c.mp4');
  spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x180:rate=24', '-pix_fmt', 'yuv420p', clip]);
  const MP4 = readFileSync(clip);

  console.log('\n─── extractFrames ───');
  {
    const fr = await extractFrames(MP4, 3);
    assert(fr.frames.length === 3 && fr.frames.every((b) => b[0] === 0xff && b[1] === 0xd8), `抽出 3 帧 JPEG（实际 ${fr.frames.length}）`);
    assert(fr.duration > 1.5 && fr.at[0] < fr.at[1] && fr.at[1] < fr.at[2], `时间点递增且时长可读（${fr.duration}s @ ${fr.at.join('/')}）`);
    const one = await extractFrames(Buffer.from('not a video'), 3).catch((e) => e as Error);
    assert(one instanceof Error, '非视频字节 → 抛错而不是空数组');
  }

  const makeServer = (seen: { prompts: string[]; judge: Array<{ nImages: number; text: string }> }, passWhen: (text: string, nth: number) => boolean) =>
    http.createServer((req, res) => {
      const url = String(req.url || ''); let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        if (/chat\/completions/.test(url)) {
          const user = (JSON.parse(body).messages as Array<{ role: string; content: unknown }>).find((m) => m.role === 'user');
          const parts = Array.isArray(user?.content) ? (user!.content as Array<{ type: string; text?: string; image_url?: { url: string } }>) : [];
          const nImages = parts.filter((p) => p.type === 'image_url' && p.image_url?.url.startsWith('data:image/jpeg;base64,')).length;
          const text = parts.filter((p) => p.type === 'text').map((p) => p.text).join('');
          seen.judge.push({ nImages, text });
          const verdict = passWhen(text, seen.judge.length) ? { pass: true, failed: [] } : { pass: false, failed: [{ criterion: '画面里有一只猫', why: '只看到彩条测试图' }] };
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(verdict) }, finish_reason: 'stop' }] })}\n\n`);
          res.write('data: [DONE]\n\n'); return res.end();
        }
        if (/v2\/video_generation/.test(url) && req.method === 'POST') {
          seen.prompts.push(String(JSON.parse(body || '{}').content?.[0]?.text ?? JSON.parse(body || '{}').prompt ?? body));
          res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ task_id: '1' }));
        }
        if (/v2\/query\/video_generation/.test(url)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ items: [{ id: '1', status: 'succeeded', content: { url: `http://127.0.0.1:${(res.socket as unknown as { localPort: number }).localPort}/clip.mp4` }, usage: { total_seconds: 2 } }], total: 1 }));
        }
        if (/clip\.mp4/.test(url)) { res.writeHead(200, { 'Content-Type': 'video/mp4' }); return res.end(MP4); }
        res.writeHead(404).end('{}');
      });
    });

  const wfYaml = (port: number, rework: boolean) => [
    'name: "片验收"', 'llm:', '  provider: "lanox"', '  model: "gpt-5.6-sol"', `  base_url: "http://127.0.0.1:${port}/v1"`,
    'steps:', '  - id: shot', '    type: video', '    task: "一只猫跳上窗台"', '    acceptance: "1. 画面里有一只猫"',
    '    video:', '      provider: "metaso"', '      model: "MiniMax-H3"', '      duration: 2', ...(rework ? ['      rework: true'] : []),
  ].join('\n');

  for (const rework of [false, true]) {
    console.log(`\n─── 端到端：验收未过，rework=${rework} ───`);
    const seen = { prompts: [] as string[], judge: [] as Array<{ nImages: number; text: string }> };
    // 首检必不过；第二次核验（重出后的复核）通过。核验员看的始终是原提示词——审的是成片不是重出指令
    const srv = makeServer(seen, (_t, nth) => nth >= 2);
    const port = await listen(srv);
    const dir = mkdtempSync(join(tmpdir(), 'ao-vvid-e2e-'));
    const wf = join(dir, 'w.yaml'); writeFileSync(wf, wfYaml(port, rework), 'utf-8');
    const saved = { L: process.env.LANOX_API_KEY, M: process.env.METASO_API_KEY, B: process.env.METASO_BASE_URL };
    process.env.LANOX_API_KEY = 'sk-e2e'; process.env.METASO_API_KEY = 'mk-e2e'; process.env.METASO_BASE_URL = `http://127.0.0.1:${port}`;
    const errs: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    (process.stderr as unknown as { write: (s: string) => boolean }).write = (s: string) => { errs.push(String(s)); return true; };
    try {
      const result = await run(wf, {}, { quiet: true, outputDir: join(dir, 'out') });
      (process.stderr as unknown as { write: typeof origWrite }).write = origWrite;
      const shot = result.steps.find((s) => s.id === 'shot');
      assert(result.success === true && shot?.status === 'completed', `步骤完成（验收是质量信号不是失败）：${shot?.status} ${shot?.error ?? ''}`);
      assert(seen.judge[0]?.nImages === 3 && seen.judge[0].text.includes('画面里有一只猫'), `首检消息带 3 帧 JPEG + 验收标准（实际 ${seen.judge[0]?.nImages} 帧）`);
      if (!rework) {
        assert(seen.prompts.length === 1 && seen.judge.length === 1, `默认不重出：出片 1 次、核验 1 次（实际 ${seen.prompts.length}/${seen.judge.length}）`);
        assert(shot?.verification?.pass === false && shot.verification.reworked === false, `verification 记未过且未重出（${JSON.stringify(shot?.verification)}）`);
        assert(errs.some((e) => e.includes('video.rework: true')), '告警指路 video.rework: true / --resume');
      } else {
        assert(seen.prompts.length === 2 && seen.prompts[1].includes('只看到彩条测试图'), `rework 开：重出一次且提示词带未满足项（实际 ${seen.prompts.length}：${seen.prompts[1]?.slice(0, 60)}）`);
        assert(seen.judge.length === 2 && shot?.verification?.pass === true && shot.verification.reworked === true, `复核通过、记已重出（${JSON.stringify(shot?.verification)}）`);
        assert(errs.some((e) => e.includes('再付一整条')), '重出前明说再付一整条的钱');
      }
    } finally {
      (process.stderr as unknown as { write: typeof origWrite }).write = origWrite;
      for (const [k, v] of [['LANOX_API_KEY', saved.L], ['METASO_API_KEY', saved.M], ['METASO_BASE_URL', saved.B]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      srv.close(); rmSync(dir, { recursive: true, force: true });
    }
  }
  rmSync(dir0, { recursive: true, force: true });
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed > 0 ? 1 : 0);
