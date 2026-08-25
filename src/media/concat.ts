/**
 * type: concat —— 用本机 ffmpeg 把多段 mp4 合成一条（短剧流水线的"三镜合一"）。
 *
 * 为什么不直接 concat demuxer -c copy：各镜可能来自不同模型（分辨率/帧率/有无音轨都不同），
 * 直接拼要么报错要么花屏。所以先把每段**规整**到同一尺寸、帧率、音轨（缺音轨补静音），再无损拼接。
 * ffmpeg 不随包分发（各平台装法不同），找不到就说清怎么装；可用 AO_FFMPEG / AO_FFPROBE 指定路径。
 */
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const FFMPEG = () => process.env.AO_FFMPEG || 'ffmpeg';
const FFPROBE = () => process.env.AO_FFPROBE || (process.env.AO_FFMPEG ? process.env.AO_FFMPEG.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1') : 'ffprobe');

export interface ConcatOptions {
  /** 目标尺寸 "1280x720"；缺省取第一段的尺寸 */
  size?: string;
  /** 目标帧率，缺省 24 */
  fps?: number;
}

export class FfmpegMissingError extends Error {}

async function ff(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await run(bin, args, { maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: string };
    if (err.code === 'ENOENT') {
      throw new FfmpegMissingError(
        `找不到 ${bin}：type: concat 需要本机 ffmpeg。macOS: brew install ffmpeg；Ubuntu: sudo apt install ffmpeg；Windows: winget install ffmpeg。` +
        `装在别处可设 AO_FFMPEG=/path/to/ffmpeg（ffprobe 同目录）。`
      );
    }
    throw new Error(`${bin} 失败：${(err.stderr || err.message || '').toString().split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 400)}`);
  }
}

async function probe(file: string): Promise<{ width: number; height: number; hasAudio: boolean }> {
  const v = await ff(FFPROBE(), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]);
  const [w, h] = v.stdout.trim().split(',').map(Number);
  if (!w || !h) throw new Error(`读不出视频尺寸：${file}`);
  const a = await ff(FFPROBE(), ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file]);
  return { width: w, height: h, hasAudio: /audio/.test(a.stdout) };
}

/** 合成；输入按顺序拼接。返回 mp4 字节。 */
export async function concatVideos(
  inputs: Array<{ name: string; buffer: Buffer }>,
  opts: ConcatOptions = {},
  onNotice?: (msg: string) => void,
): Promise<Buffer> {
  if (inputs.length === 0) throw new Error('concat 没有输入：concat.inputs 至少要有一段视频');
  const dir = mkdtempSync(join(tmpdir(), 'ao-concat-'));
  try {
    const files = inputs.map((inp, i) => {
      const p = join(dir, `in_${i}.mp4`);
      writeFileSync(p, inp.buffer);
      return p;
    });
    const first = await probe(files[0]);
    let [W, H] = [first.width, first.height];
    if (opts.size) {
      const m = opts.size.match(/^(\d+)x(\d+)$/);
      if (!m) throw new Error(`concat.size 要写成 "宽x高"，如 1280x720，实际 "${opts.size}"`);
      [W, H] = [Number(m[1]), Number(m[2])];
    }
    // 偶数尺寸（yuv420p 要求）
    W -= W % 2; H -= H % 2;
    const fps = opts.fps && opts.fps > 0 ? opts.fps : 24;
    onNotice?.(`🎞 合成 ${inputs.length} 段 → ${W}x${H}@${fps}fps（先规整再拼接）`);
    const normalized: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const info = i === 0 ? first : await probe(files[i]);
      const out = join(dir, `n_${i}.mp4`);
      const args = ['-y', '-i', files[i]];
      if (!info.hasAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
      args.push(
        '-filter_complex', `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}[v]`,
        '-map', '[v]', '-map', info.hasAudio ? '0:a:0' : '1:a',
        '-shortest', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', out,
      );
      await ff(FFMPEG(), args);
      normalized.push(out);
    }
    const list = join(dir, 'list.txt');
    writeFileSync(list, normalized.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
    const outFile = join(dir, 'out.mp4');
    await ff(FFMPEG(), ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', outFile]);
    return readFileSync(outFile);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
