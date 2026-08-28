/**
 * 从一段 mp4 抽几帧给视觉模型看——视频步骤 acceptance 的眼睛。
 *
 * 为什么是抽帧而不是整段上传：文本模型的 vision 协议收的是图片（utils/vision.ts 的 data URI），
 * 没有任何一家文本 API 能直接"看"mp4。开头 / 中段 / 结尾三帧能判构图、主体、场景、有没有文字水印；
 * 判不了运动与声音——文档里要说清，验收标准只写画面里静止可见的硬条件。
 * 走本机 ffmpeg（与 type: concat 同一条依赖），缺了抛 FfmpegMissingError 由调用方降级为"跳过验收"。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FfmpegMissingError } from './concat.js';

const run = promisify(execFile);
const FFMPEG = () => process.env.AO_FFMPEG || 'ffmpeg';
const FFPROBE = () => process.env.AO_FFPROBE || (process.env.AO_FFMPEG ? process.env.AO_FFMPEG.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1') : 'ffprobe');

async function ff(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await run(bin, args, { maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: string };
    if (err.code === 'ENOENT') {
      throw new FfmpegMissingError(`找不到 ${bin}：视频验收要抽帧，需要本机 ffmpeg（macOS: brew install ffmpeg；Ubuntu: sudo apt install ffmpeg；或设 AO_FFMPEG）`);
    }
    throw new Error(`${bin} 失败：${(err.stderr || err.message || '').toString().split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 300)}`);
  }
}

export interface ExtractedFrames {
  /** JPEG 字节，按时间顺序 */
  frames: Buffer[];
  /** 各帧的时间点（秒） */
  at: number[];
  duration: number;
}

/**
 * 抽 count 帧（默认 3：10% / 50% / 90%），缩到 width 宽的 JPEG。
 * 读不出时长时只抽第 0 帧——总比瞎猜一个时间点 seek 到片尾拿回空帧强。
 */
export async function extractFrames(mp4: Buffer, count = 3, width = 640): Promise<ExtractedFrames> {
  const dir = mkdtempSync(join(tmpdir(), 'ao-frames-'));
  try {
    const src = join(dir, 'in.mp4');
    writeFileSync(src, mp4);
    let duration = 0;
    try {
      const r = await ff(FFPROBE(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src]);
      const n = Number(r.stdout.trim().split(/[\r\n,]/)[0]);
      duration = Number.isFinite(n) && n > 0 ? n : 0;
    } catch (e) {
      if (e instanceof FfmpegMissingError) throw e;
    }
    const at = duration > 0
      ? Array.from({ length: Math.max(1, count) }, (_, i) => +(duration * ((i + 0.5) / Math.max(1, count))).toFixed(2))
      : [0];
    const frames: Buffer[] = [];
    const kept: number[] = [];
    for (let i = 0; i < at.length; i++) {
      const out = join(dir, `f${i}.jpg`);
      // -ss 放在 -i 前是快速 seek（关键帧起跳），抽验收帧够用；-update 1 单张输出不报序列警告
      await ff(FFMPEG(), ['-v', 'error', '-y', '-ss', String(at[i]), '-i', src, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '4', '-update', '1', out]);
      if (existsSync(out)) {
        const b = readFileSync(out);
        if (b.length > 0) { frames.push(b); kept.push(at[i]); }
      }
    }
    if (!frames.length) throw new Error('一帧都抽不出来（文件可能不是有效视频）');
    return { frames, at: kept, duration };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const jpegDataUri = (b: Buffer): string => `data:image/jpeg;base64,${b.toString('base64')}`;
