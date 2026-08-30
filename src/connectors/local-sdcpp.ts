/**
 * 本地视频供应商 `local-sdcpp`：用本机 stable-diffusion.cpp 的 `sd-cli` 出片（MiniMax-H3 GGUF），不联网、不花钱。
 *
 * 定位是"草稿档"（OpenShorts ADR-004，M2 Max 32G 实测：UD-Q2_K_XL 640×384 / 39 帧 / 4 步 = 216 s，画质 2-bit 草稿级）。
 * 纪律：
 * - 引擎**不自动下载 27 GB 模型**：缺什么就把确切的文件名与下载命令打出来，由用户/OpenShorts 界面去下。
 * - 档位按统一内存算：< 24 GB 不提供；24–48 GB Q2/Q3；≥ 64 GB Q4。超出机器能力的档位直接拒，不让人等半小时再 OOM。
 * - 输出与云端供应商同构（mp4 Buffer + seconds），下游 concat / 验收 / 花费预览一行不用改。
 */
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir, totalmem, homedir } from 'node:os';
import { join } from 'node:path';

const run = promisify(execFile);
export const LOCAL_SDCPP_ID = 'local-sdcpp';

/** 模型档位：id 是工作流里写的 video.model；文件来自 unsloth/MiniMax-H3-GGUF + Comfy-Org VAE */
export const LOCAL_MODELS: Array<{ id: string; label: string; minMemGB: number; diffusion: string; llm: string; sizeGB: number }> = [
  { id: 'minimax-h3-q2', label: 'MiniMax-H3 裁剪版 Q2（草稿档，24 GB+ 内存）', minMemGB: 24, diffusion: 'minimax_h3_fl2va_pruned-UD-Q2_K_XL.gguf', llm: 'qwen3vl_32b_minimax_h3-Q2_K_M.gguf', sizeGB: 27 },
  { id: 'minimax-h3-q3', label: 'MiniMax-H3 裁剪版 Q3（32 GB+ 内存）', minMemGB: 32, diffusion: 'minimax_h3_fl2va_pruned-Q3_K.gguf', llm: 'qwen3vl_32b_minimax_h3-Q2_K_M.gguf', sizeGB: 28 },
  { id: 'minimax-h3-q4', label: 'MiniMax-H3 裁剪版 Q4（64 GB+ 内存）', minMemGB: 64, diffusion: 'minimax_h3_fl2va_pruned-Q4_K.gguf', llm: 'qwen3vl_32b_minimax_h3-Q4_K_M.gguf', sizeGB: 36 },
];
const VAE = 'minimax_h3_video_vae_fp16.safetensors';
const AUDIO_VAE = 'minimax_h3_audio_vae_fp32.safetensors';
const HF = 'https://huggingface.co/unsloth/MiniMax-H3-GGUF/resolve/main';

export function sdcppPaths(): { cli: string; modelsDir: string } {
  const home = process.env.OPENSHORTS_HOME || join(homedir(), '.openshorts');
  return { cli: process.env.AO_SD_CLI || process.env.OPENSHORTS_SD_CLI || join(home, 'bin', 'sd-cli'), modelsDir: process.env.AO_SD_MODELS || process.env.OPENSHORTS_SD_MODELS || join(home, 'models') };
}

export interface LocalStatus { ok: boolean; cli: string; cliFound: boolean; modelsDir: string; memGB: number; models: Array<{ id: string; label: string; usable: boolean; present: boolean; missing: string[]; reason?: string }> }
export function localSdcppStatus(): LocalStatus {
  const { cli, modelsDir } = sdcppPaths();
  const cliFound = existsSync(cli) || onPath('sd-cli');
  const memGB = Math.round(totalmem() / 1024 ** 3);
  const models = LOCAL_MODELS.map((m) => {
    const files = [m.diffusion, m.llm, VAE, AUDIO_VAE];
    const missing = files.filter((f) => !existsSync(join(modelsDir, f)));
    const usable = memGB >= m.minMemGB;
    return { id: m.id, label: m.label, usable, present: missing.length === 0, missing, reason: !usable ? `需要 ≥ ${m.minMemGB} GB 内存（本机 ${memGB} GB）` : missing.length ? `缺 ${missing.length} 个模型文件` : undefined };
  });
  return { ok: cliFound && models.some((m) => m.usable && m.present), cli, cliFound, modelsDir, memGB, models };
}
function onPath(cmd: string): boolean { try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } }

export function downloadHint(modelId: string): string {
  const m = LOCAL_MODELS.find((x) => x.id === modelId) ?? LOCAL_MODELS[0];
  const { modelsDir } = sdcppPaths();
  return [`模型文件放到 ${modelsDir}/（约 ${m.sizeGB} GB，可断点续传）：`,
    `  curl -L -C - -o "${modelsDir}/${m.diffusion}" "${HF}/${m.diffusion}"`,
    `  curl -L -C - -o "${modelsDir}/${m.llm}" "${HF}/${m.llm}"`,
    `  curl -L -C - -o "${modelsDir}/${VAE}" "${HF}/vae/${VAE}"`,
    `  curl -L -C - -o "${modelsDir}/${AUDIO_VAE}" "${HF}/vae/${AUDIO_VAE}"`,
    `sd-cli：从 https://github.com/leejet/stable-diffusion.cpp/releases 下载对应平台包，放到 ${sdcppPaths().cli}（或设 AO_SD_CLI）。`,
    `许可证：MiniMax-H3 Community License（有适用地域/用途条款），下载前请阅读。`].join('\n');
}

/** 分辨率：接受 "640x384" / "384P"（短边）/ 空（默认 640×384）；宽高向上取 32 的倍数 */
export function dims(resolution?: string, ratio?: string): { w: number; h: number } {
  const align = (n: number) => Math.max(64, Math.ceil(n / 32) * 32);
  let w = 640, h = 384;
  if (resolution && /^\d+x\d+$/i.test(resolution)) { const [a, b] = resolution.toLowerCase().split('x').map(Number); w = a; h = b; }
  else if (resolution && /^\d+p$/i.test(resolution)) { const short = Number(resolution.slice(0, -1)); const r = ratio === '9:16' ? 9 / 16 : ratio === '1:1' ? 1 : 16 / 9; if (ratio === '9:16') { w = short; h = Math.round(short / r); } else { h = short; w = Math.round(short * r); } }
  else if (ratio === '9:16') { w = 384; h = 640; }
  return { w: align(w), h: align(h) };
}
/** 帧数对齐到 17k+5（H3 网格），24 fps */
/** 帧数取最近的 17k+5 网格（本地不按秒计费，就近比向上取更省时间）；最少 5 帧 */
export function frames(durationSec?: number): number { const want = Math.max(1, Math.round((durationSec ?? 2) * 24)); const k = Math.max(0, Math.round((want - 5) / 17)); return 17 * k + 5; }

// 同一时间只跑一个 sd-cli：每个进程要 ~27 GB 统一内存，AO 默认并发 2 会把两个一起拉起来——
// 真机（2026-08-30）：两路并行时交换区用到 39 GB/剩 0.9 GB，整机卡死。串行是唯一正确答案，不看并发设置。
let localChain: Promise<unknown> = Promise.resolve();
export function generateLocalVideo(prompt: string, opts: Parameters<typeof generateLocalVideoUnlocked>[1], onNotice?: (m: string) => void): ReturnType<typeof generateLocalVideoUnlocked> {
  const queued = Date.now();
  const next = localChain.then(async () => {
    const waited = Date.now() - queued;
    if (waited > 2000) onNotice?.(`🖥 本地出片排队等待 ${Math.round(waited / 1000)} s（本机同一时间只跑一条，内存放不下两条）`);
    return generateLocalVideoUnlocked(prompt, opts, onNotice);
  });
  localChain = next.catch(() => undefined);
  return next;
}

async function generateLocalVideoUnlocked(prompt: string, opts: { model?: string; resolution?: string; ratio?: string; duration?: number; image_bytes?: Buffer; steps?: number; timeout?: number }, onNotice?: (m: string) => void): Promise<{ buffer: Buffer; mime: 'video/mp4'; taskId: string; seconds: number; url?: string }> {
  const st = localSdcppStatus();
  const m = LOCAL_MODELS.find((x) => x.id === (opts.model || 'minimax-h3-q2'));
  if (!m) throw new Error(`local-sdcpp 不认识模型 "${opts.model}"，可选：${LOCAL_MODELS.map((x) => x.id).join(' / ')}`);
  if (!st.cliFound) throw new Error(`本地出片需要 sd-cli（stable-diffusion.cpp）。\n${downloadHint(m.id)}`);
  const ms = st.models.find((x) => x.id === m.id)!;
  if (!ms.usable) throw new Error(`本机内存 ${st.memGB} GB 跑不了 ${m.id}（${ms.reason}）——换更小的档位或用云端供应商`);
  if (!ms.present) throw new Error(`${m.id} 缺模型文件：${ms.missing.join(', ')}\n${downloadHint(m.id)}`);
  const { w, h } = dims(opts.resolution, opts.ratio);
  const nf = frames(opts.duration);
  const steps = opts.steps ?? Number(process.env.AO_SD_STEPS || 4);
  const tmp = mkdtempSync(join(tmpdir(), 'ao-sdcpp-'));
  try {
    const out = join(tmp, 'out.webm');
    const args = ['-M', 'vid_gen', '--diffusion-model', join(st.modelsDir, m.diffusion), '--llm', join(st.modelsDir, m.llm), '--vae', join(st.modelsDir, VAE), '--audio-vae', join(st.modelsDir, AUDIO_VAE),
      '-p', prompt, '--width', String(w), '--height', String(h), '--video-frames', String(nf), '--steps', String(steps), '--cfg-scale', '1.0', '--backend', 'te=cpu', '--diffusion-fa', '-o', out];
    if (opts.image_bytes) { const img = join(tmp, 'init.png'); writeFileSync(img, opts.image_bytes); args.push('--init-img', img); }
    onNotice?.(`🖥 本地出片 ${m.id} ${w}×${h} · ${nf} 帧（${(nf / 24).toFixed(1)}s）· ${steps} 步——草稿档，M2 Max 32G 约 ${Math.round(90 + nf * 3.3)} s，不花钱`);
    const t0 = Date.now();
    const cliBin = existsSync(st.cli) ? st.cli : 'sd-cli';
    await run(cliBin, args, { maxBuffer: 64 << 20, timeout: opts.timeout && opts.timeout > 0 ? opts.timeout : 45 * 60_000 });
    if (!existsSync(out) || statSync(out).size === 0) throw new Error('sd-cli 没有产出文件');
    const mp4 = join(tmp, 'out.mp4');
    await run(process.env.AO_FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', out, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', mp4]);
    onNotice?.(`🖥 本地出片完成，用时 ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    return { buffer: readFileSync(mp4), mime: 'video/mp4', taskId: `local-${Date.now().toString(36)}`, seconds: +(nf / 24).toFixed(2) };
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: string; killed?: boolean };
    if (err.killed) throw new Error(`本地出片超时（${Math.round((opts.timeout || 45 * 60_000) / 60000)} 分钟）：这台机器跑这个档位太慢，换更小分辨率/帧数或云端供应商`);
    throw new Error(`本地出片失败：${String(err.stderr || err.message).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 400)}`);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
