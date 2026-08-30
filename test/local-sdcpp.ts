/**
 * 本地视频供应商 local-sdcpp：不联网、不要 key、缺东西时把下载命令打清楚；
 * 用一个假的 sd-cli（ffmpeg 造 webm）走完 generateVideo 主流程，钉住参数与 mp4 转换。
 */
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync, rmSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateVideo } from '../src/connectors/video.js';
import { dims, frames, localSdcppStatus, downloadHint } from '../src/connectors/local-sdcpp.js';
import { parseWorkflow } from '../src/core/parser.js';
import { summarizeMediaSpend } from '../src/media/preflight.js';
import type { LLMConfig } from '../src/types.js';

let passed = 0, failed = 0;
const assert = (c: boolean, m: string) => { if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; } };
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const cfg = { provider: 'local-sdcpp', model: 'minimax-h3-q2' } as unknown as LLMConfig;

console.log('\n─── 纯函数：分辨率对齐 32、帧数对齐 17k+5 ───');
assert(JSON.stringify(dims('640x384')) === '{"w":640,"h":384}' && JSON.stringify(dims('700x400')) === '{"w":704,"h":416}', '宽高向上取 32 的倍数');
assert(dims('384P', '9:16').w === 384 && dims(undefined, '9:16').h === 640, '短边档位 + 竖版比例');
assert(frames(1) === 22 && frames(1.6) === 39 && frames(4) === 90 && frames(0) === 5, '帧数取最近的 17k+5 网格（1s→22, 1.6s→39, 4s→90）');

console.log('\n─── 缺 sd-cli / 缺模型：报清楚怎么装，不猜 ───');
{
  const home = mkdtempSync(join(tmpdir(), 'ao-sdcpp-home-'));
  const saved = { c: process.env.AO_SD_CLI, m: process.env.AO_SD_MODELS, h: process.env.OPENSHORTS_HOME };
  process.env.AO_SD_CLI = join(home, 'nope', 'sd-cli'); process.env.AO_SD_MODELS = join(home, 'models'); process.env.OPENSHORTS_HOME = home;
  try {
    const st = localSdcppStatus();
    assert(st.ok === false && st.cliFound === false && st.models.every((m) => !m.present), 'status：没 sd-cli、没模型 → 不可用，列出缺哪些');
    let msg = ''; try { await generateVideo(cfg, '一只猫', { model: 'minimax-h3-q2', duration: 1 }); } catch (e) { msg = (e as Error).message; }
    assert(/sd-cli/.test(msg) && /curl -L -C -/.test(msg) && /Community License/.test(msg), `缺 sd-cli：报错含下载命令与许可证提醒（${msg.split('\n')[0]}）`);
    assert(/minimax_h3_fl2va_pruned-UD-Q2_K_XL\.gguf/.test(downloadHint('minimax-h3-q2')), 'downloadHint 列出确切文件名');
    let msg2 = ''; try { await generateVideo(cfg, '一只猫', { model: 'sora-2', duration: 1 }); } catch (e) { msg2 = (e as Error).message; }
    assert(/不认识模型/.test(msg2), '不认识的模型 id 直接拒');
  } finally { Object.assign(process.env, { AO_SD_CLI: saved.c, AO_SD_MODELS: saved.m, OPENSHORTS_HOME: saved.h }); for (const k of ['AO_SD_CLI', 'AO_SD_MODELS', 'OPENSHORTS_HOME']) if (process.env[k] === 'undefined') delete process.env[k]; rmSync(home, { recursive: true, force: true }); }
}

console.log('\n─── 假 sd-cli 走通主流程（参数、webm→mp4、seconds）───');
if (!hasFfmpeg) console.log('  ⚠️ 无 ffmpeg，跳过');
else {
  const home = mkdtempSync(join(tmpdir(), 'ao-sdcpp-fake-'));
  const models = join(home, 'models'); mkdirSync(models, { recursive: true }); mkdirSync(join(home, 'bin'));
  for (const f of ['minimax_h3_fl2va_pruned-UD-Q2_K_XL.gguf', 'qwen3vl_32b_minimax_h3-Q2_K_M.gguf', 'minimax_h3_video_vae_fp16.safetensors', 'minimax_h3_audio_vae_fp32.safetensors']) writeFileSync(join(models, f), 'stub');
  const cli = join(home, 'bin', 'sd-cli');
  // 假 sd-cli：记录参数，按 --width/--height/--video-frames 造一段 webm
  writeFileSync(cli, `#!/bin/sh
echo "$@" > "${join(home, 'args.txt')}"
w=640; h=384; n=22; out=""
while [ $# -gt 0 ]; do case "$1" in --width) w=$2; shift;; --height) h=$2; shift;; --video-frames) n=$2; shift;; -o) out=$2; shift;; esac; shift; done
ffmpeg -v error -y -f lavfi -i "color=c=red:size=\${w}x\${h}:rate=24:d=$(echo "$n/24" | bc -l)" -c:v libvpx -b:v 200k "$out"
`); chmodSync(cli, 0o755);
  const saved = { c: process.env.AO_SD_CLI, m: process.env.AO_SD_MODELS };
  process.env.AO_SD_CLI = cli; process.env.AO_SD_MODELS = models;
  try {
    const notices: string[] = [];
    const r = await generateVideo(cfg, '一只猫走过雪地', { model: 'minimax-h3-q2', duration: 1.6, resolution: '640x384' }, (m) => notices.push(m));
    const args = readFileSync(join(home, 'args.txt'), 'utf-8');
    assert(/-M vid_gen/.test(args) && /--cfg-scale 1.0/.test(args) && /--video-frames 39/.test(args) && /--width 640/.test(args) && /te=cpu/.test(args), `sd-cli 参数正确（${args.trim().slice(0, 80)}…）`);
    assert(r.mime === 'video/mp4' && r.buffer.length > 500 && r.buffer.slice(4, 8).toString() === 'ftyp', 'webm 转成了 mp4 Buffer');
    assert(Math.abs(r.seconds - 39 / 24) < 0.01 && r.taskId.startsWith('local-'), `seconds=${r.seconds} 由帧数算出，taskId 本地前缀`);
    assert(notices.some((n) => /不花钱/.test(n)), '通知里明说不花钱、草稿档');
  } finally { process.env.AO_SD_CLI = saved.c as string; process.env.AO_SD_MODELS = saved.m as string; for (const k of ['AO_SD_CLI', 'AO_SD_MODELS']) if (process.env[k] === 'undefined') delete process.env[k]; rmSync(home, { recursive: true, force: true }); }
}

console.log('\n─── 串行：两条同时请求，sd-cli 绝不重叠 ───');
if (hasFfmpeg) {
  const home = mkdtempSync(join(tmpdir(), 'ao-sdcpp-serial-'));
  const models = join(home, 'models'); mkdirSync(models, { recursive: true }); mkdirSync(join(home, 'bin'));
  for (const f of ['minimax_h3_fl2va_pruned-UD-Q2_K_XL.gguf', 'qwen3vl_32b_minimax_h3-Q2_K_M.gguf', 'minimax_h3_video_vae_fp16.safetensors', 'minimax_h3_audio_vae_fp32.safetensors']) writeFileSync(join(models, f), 'stub');
  const cli = join(home, 'bin', 'sd-cli'); const lock = join(home, 'running');
  writeFileSync(cli, `#!/bin/sh
if [ -e "${lock}" ]; then echo OVERLAP >> "${join(home, 'overlap.txt')}"; fi
touch "${lock}"; sleep 1
out=""; while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift;; esac; shift; done
ffmpeg -v error -y -f lavfi -i "color=c=blue:size=64x64:rate=24:d=0.3" -c:v libvpx "$out"
rm -f "${lock}"
`); chmodSync(cli, 0o755);
  const saved = { c: process.env.AO_SD_CLI, m: process.env.AO_SD_MODELS }; process.env.AO_SD_CLI = cli; process.env.AO_SD_MODELS = models;
  try {
    const notices: string[] = [];
    await Promise.all([generateVideo(cfg, 'a', { model: 'minimax-h3-q2', duration: 0.2 }), generateVideo(cfg, 'b', { model: 'minimax-h3-q2', duration: 0.2 }, (m) => notices.push(m))]);
    const { existsSync: ex } = await import('node:fs');
    assert(!ex(join(home, 'overlap.txt')), '两个请求串行执行，没有重叠');
  } finally { process.env.AO_SD_CLI = saved.c as string; process.env.AO_SD_MODELS = saved.m as string; for (const k of ['AO_SD_CLI', 'AO_SD_MODELS']) if (process.env[k] === 'undefined') delete process.env[k]; rmSync(home, { recursive: true, force: true }); }
}

console.log('\n─── 花费预览：本地出片不进"按秒计费"合计 ───');
{
  const d = mkdtempSync(join(tmpdir(), 'ao-sdcpp-wf-')); const f = join(d, 'w.yaml');
  writeFileSync(f, 'name: x\nllm:\n  provider: local-sdcpp\n  model: minimax-h3-q2\nsteps:\n  - id: a\n    type: video\n    task: 猫\n    video:\n      model: minimax-h3-q2\n      duration: 2\n  - id: b\n    type: video\n    task: 狗\n    video:\n      provider: metaso\n      model: MiniMax-H3\n      duration: 4\n');
  const pf = summarizeMediaSpend(parseWorkflow(f), new Map());
  assert(pf.videoSeconds === 4 && pf.lines.some((l) => /不花钱/.test(l)) && pf.lines.some((l) => /合计 4 秒/.test(l)), `本地 2s 不计费，云端 4s 计费（${pf.lines.join(' | ')}）`);
  rmSync(d, { recursive: true, force: true });
}
console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed > 0 ? 1 : 0);
