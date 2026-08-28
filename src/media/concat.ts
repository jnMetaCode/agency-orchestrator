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
  /**
   * 逐段配音：与 inputs 一一对应（可用空串占位表示"这段不配音"）。
   * **画面时长是花钱买来的，不因配音而改变**——配音比画面长就在末尾截断并明确告警，
   * 短就补静音。反过来（拉长画面去迁就配音）等于偷偷改掉用户买的秒数。
   */
  voiceover?: Array<{ name: string; buffer: Buffer } | null>;
  /** 旁白人声音量倍数，默认 1.0 */
  voice_volume?: number;
  /**
   * 片段**自带音轨**的音量倍数。默认：有旁白时 0.3（压下去给旁白让路），没旁白时 1.0（原样）。
   *
   * 为什么要能调：现在的视频模型（Veo3 / Sora2 / MiniMax-H3…）**本来就出声音**，而且往往不是
   * 环境底噪而是**成句的对白**。一律压到 0.3 会把模型辛苦生成的台词压成听不清的嘟囔；
   * 一律不压又会和旁白抢。这件事只有作者知道该怎么办，所以给出来，并给一个保守默认值。
   * 想完全换掉原声就写 0，想让原声当主角、旁白只做点缀就把这个调回 1、把 voice_volume 调低。
   */
  clip_volume?: number;
  /** 背景音乐（整片一条，自动循环到片长、末尾 2 秒淡出） */
  bgm?: { name: string; buffer: Buffer };
  /** BGM 音量倍数，默认 0.25——有人声时压得住，别盖过台词 */
  bgm_volume?: number;
  /** 逐段字幕文案：与 inputs 一一对应，按各段**实际时长**排时间轴后烧进画面 */
  subtitles?: string[];
  /** 字幕样式（走 ffmpeg subtitles 滤镜的 force_style） */
  subtitle_style?: { font?: string; size?: number; color?: string; outline?: number; margin?: number };
}

export class FfmpegMissingError extends Error {}

async function ff(bin: string, args: string[], cwd?: string): Promise<{ stdout: string; stderr: string }> {
  try {
    return await run(bin, args, { maxBuffer: 64 * 1024 * 1024, ...(cwd ? { cwd } : {}) });
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

async function probe(file: string): Promise<{ width: number; height: number; hasAudio: boolean; duration: number }> {
  const v = await ff(FFPROBE(), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]);
  const [w, h] = v.stdout.trim().split(',').map(Number);
  if (!w || !h) throw new Error(`读不出视频尺寸：${file}`);
  const a = await ff(FFPROBE(), ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file]);
  return { width: w, height: h, hasAudio: /audio/.test(a.stdout), duration: await mediaDuration(file) };
}

/** 读时长（秒）。读不出返回 0——字幕排时间轴要用它，读不出就退化成不加字幕，不能瞎猜一个数。 */
async function mediaDuration(file: string): Promise<number> {
  try {
    const r = await ff(FFPROBE(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
    const n = Number(r.stdout.trim().split(/[\r\n,]/)[0]);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch { return 0; }
}

/**
 * 这台机器的 ffmpeg 有没有某个滤镜。
 *
 * 血泪来源：**烧字幕的 `subtitles` 滤镜要 libass**，而不是每个 ffmpeg 构建都带它——
 * 本机 Homebrew 的 ffmpeg 8.1.1 就既没有 `subtitles` 也没有 `drawtext`。不先探一下，
 * 字幕这一步会在**三镜都已经花钱出完片之后**才崩，用户拿不到成片。
 */
let _filterCache: Set<string> | null = null;
export async function hasFilter(name: string): Promise<boolean> {
  if (!_filterCache) {
    try {
      const r = await ff(FFMPEG(), ['-hide_banner', '-filters']);
      _filterCache = new Set(
        r.stdout.split('\n')
          .map((l) => l.trim().split(/\s+/)[1])
          .filter((x): x is string => !!x),
      );
    } catch { _filterCache = new Set(); }
  }
  return _filterCache.has(name);
}

/**
 * 某个滤镜支不支持某个选项。
 *
 * 具体防的是 `amix` 的 `normalize`：**ffmpeg 4.4（2021）才加的**，而 Ubuntu 20.04 至今还是 4.2。
 * 老版本上这个选项会让整条滤镜链报错——偏偏是在三镜都已经出完、钱都付过之后的合成阶段才崩。
 * 探不到就不带这个选项：代价只是混音整体轻一点（amix 会把各路除以路数），远好过成片出不来。
 */
const _optCache = new Map<string, boolean>();
export async function filterHasOption(filter: string, option: string): Promise<boolean> {
  const key = `${filter}.${option}`;
  const hit = _optCache.get(key);
  if (hit !== undefined) return hit;
  let ok = false;
  try {
    const r = await ff(FFMPEG(), ['-hide_banner', '-h', `filter=${filter}`]);
    ok = new RegExp(`^\\s*${option}\\b`, 'm').test(r.stdout);
  } catch { ok = false; }
  _optCache.set(key, ok);
  return ok;
}

/** 仅供测试：重置滤镜探测缓存。 */
export function _resetFilterCache(): void { _filterCache = null; _optCache.clear(); }

/** 秒 → SRT 时间戳 `HH:MM:SS,mmm`。 */
function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}

/**
 * 把一段文案切成字幕条并按**字数占比**分配时长。
 *
 * 为什么不上 whisper 之类的转写：这条流水线里文案是我们自己写的、每段画面时长是我们自己买的，
 * 两头都已知，再花 1.6GB 模型去"听"一遍属于绕远。按字数分配在朗读语速大致均匀时足够贴，
 * 短剧这种一段一两句话的场景尤其准。
 *
 * 切分优先在句末标点断开；单条过长（>maxLen）再按逗号/顿号继续切，仍过长就硬切。
 */
export function buildSrtCues(text: string, duration: number, maxLen = 18): Array<{ start: number; end: number; text: string }> {
  const clean = text.replace(/\r/g, '').trim();
  if (!clean || !(duration > 0)) return [];
  const sentences = clean.split(/(?<=[。！？!?；;…\n])/).map((x) => x.trim()).filter(Boolean);
  const pieces: string[] = [];
  for (const sent of sentences) {
    if (sent.length <= maxLen) { pieces.push(sent); continue; }
    for (const part of sent.split(/(?<=[，,、])/)) {
      const t = part.trim();
      if (!t) continue;
      if (t.length <= maxLen) { pieces.push(t); continue; }
      for (let i = 0; i < t.length; i += maxLen) pieces.push(t.slice(i, i + maxLen));
    }
  }
  if (pieces.length === 0) return [];
  const total = pieces.reduce((n, p) => n + p.length, 0) || 1;
  const cues: Array<{ start: number; end: number; text: string }> = [];
  let at = 0;
  for (let i = 0; i < pieces.length; i++) {
    // 最后一条直接收在 duration 上：逐条累加的浮点误差不该让字幕比画面早收 0.03 秒
    const end = i === pieces.length - 1 ? duration : at + (duration * pieces[i].length) / total;
    cues.push({ start: at, end, text: pieces[i] });
    at = end;
  }
  return cues;
}

/** 拼一份 SRT 文本。没有可用字幕条时返回空串。 */
export function buildSrt(text: string, duration: number): string {
  const cues = buildSrtCues(text, duration);
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n');
}

/**
 * force_style 的值要塞进 filtergraph，而 filtergraph 用逗号分隔滤镜、冒号分隔参数——
 * 不转义的话一个字体名里的逗号就能把整条滤镜链拆坏。
 */
function styleArg(st: NonNullable<ConcatOptions['subtitle_style']>): string {
  const parts = [
    `FontSize=${st.size && st.size > 0 ? Math.round(st.size) : 22}`,
    `PrimaryColour=${st.color || '&H00FFFFFF&'}`,
    `Outline=${st.outline !== undefined && st.outline >= 0 ? st.outline : 2}`,
    `MarginV=${st.margin !== undefined && st.margin >= 0 ? Math.round(st.margin) : 28}`,
    'BorderStyle=1', 'Alignment=2',
  ];
  if (st.font) parts.push(`FontName=${st.font}`);
  return parts.join(',').replace(/[\\:,]/g, (c) => `\\${c}`);
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
    // 配音落盘。数量对不上是配置错，不是"少配一段"——静默补齐会让第 2 段的旁白盖到第 3 段画面上。
    const vo = opts.voiceover;
    if (vo && vo.length !== inputs.length) {
      throw new Error(`concat.voiceover 有 ${vo.length} 条，但 inputs 有 ${inputs.length} 段——必须一一对应（这段不配音就留空串）`);
    }
    const voFiles: (string | null)[] = (vo ?? []).map((v, i) => {
      if (!v) return null;
      const f = join(dir, `vo_${i}.audio`);
      writeFileSync(f, v.buffer);
      return f;
    });
    const subs = opts.subtitles;
    if (subs && subs.length !== inputs.length) {
      throw new Error(`concat.subtitles 有 ${subs.length} 条，但 inputs 有 ${inputs.length} 段——必须一一对应（这段不要字幕就留空串）`);
    }
    const voiceVol = opts.voice_volume !== undefined && opts.voice_volume >= 0 ? opts.voice_volume : 1;
    const clipVol = opts.clip_volume !== undefined && opts.clip_volume >= 0 ? opts.clip_volume : 0.3;

    // 各段信息先探齐：字幕要按**这一段的实际时长**排轴，而且能不能烧字幕要在动手前就知道。
    const infos = [first];
    for (let i = 1; i < files.length; i++) infos.push(await probe(files[i]));
    // 混音选项探一次（老 ffmpeg 没有 normalize，带上去整条滤镜链就报错）
    const amix = (await filterHasOption('amix', 'normalize'))
      ? 'amix=inputs=2:duration=first:dropout_transition=0:normalize=0'
      : 'amix=inputs=2:duration=first:dropout_transition=0';
    const wantSubs = !!subs?.some((x) => x?.trim());
    const canBurn = wantSubs ? await hasFilter('subtitles') : false;
    if (wantSubs && !canBurn) {
      // 不能烧就**不假装烧了**，但也绝不因此让已经花钱出好的三镜白费：
      // 照常合成，把字幕挂成软字幕轨（mov_text，任何 ffmpeg 都能封），并把话说透。
      onNotice?.(
        '⚠️ 本机 ffmpeg 没有 subtitles 滤镜（缺 libass），**字幕无法烧进画面**。' +
        '成片照出，字幕改挂成软字幕轨（剪映/播放器能读，但抖音这类平台上传后不显示）。' +
        '要烧进画面请换一个带 libass 的构建：macOS `brew install ffmpeg`（完整版）、' +
        'Ubuntu `apt install ffmpeg`，或用 AO_FFMPEG 指到那个可执行文件。'
      );
    }

    const normalized: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const info = infos[i];
      const out = join(dir, `n_${i}.mp4`);
      const voFile = voFiles[i] ?? null;

      // 写成只有文件名的 srt 并让 ffmpeg 在临时目录里跑，免掉字幕滤镜路径转义
      // 那一整类坑（冒号、反斜杠、方括号）。
      let subName = '';
      if (canBurn && subs?.[i]?.trim()) {
        const srt = buildSrt(subs[i], info.duration);
        if (!srt) {
          onNotice?.(`⚠️ 第 ${i + 1} 段读不出时长，这段字幕跳过（画面照常合成）`);
        } else {
          subName = `sub_${i}.srt`;
          writeFileSync(join(dir, subName), srt, 'utf-8');
        }
      }

      const args = ['-y', '-i', files[i]];
      let silenceIdx = -1;
      let voIdx = -1;
      if (!info.hasAudio) { args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000'); silenceIdx = args.filter((a) => a === '-i').length - 1; }
      if (voFile) { args.push('-i', voFile); voIdx = args.filter((a) => a === '-i').length - 1; }

      const vChain = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}`
        + (subName ? `,subtitles=${subName}:force_style=${styleArg(opts.subtitle_style ?? {})}` : '');
      const filters = [`[0:v]${vChain}[v]`];
      const baseAudio = info.hasAudio ? '0:a:0' : `${silenceIdx}:a`;
      let aMap: string;
      if (voFile) {
        if (clipVol >= 0.9 && i === 0) {
          onNotice?.('ℹ️ clip_volume 接近 1：片段自带的声音（很多视频模型会生成对白）会和旁白同强度叠在一起——确认这是你要的');
        }
        if (info.duration > 0) {
          const voDur = await mediaDuration(voFile);
          // 画面时长是按秒买来的，绝不为了迁就配音去拉长/截短画面。配音超了就在这里说破，
          // 让人回去改文案或加长这一镜——闷头截掉半句话，成片上线才发现更贵。
          if (voDur > info.duration + 0.35) {
            onNotice?.(`⚠️ 第 ${i + 1} 段配音 ${voDur.toFixed(1)}s 比画面 ${info.duration.toFixed(1)}s 长，末尾会被截断——请压缩文案或加长这一镜`);
          }
        }
        // 片段自带音轨垫在下面、旁白在上。**不直接替换**：视频模型本来就出声音，
        // 而且常常是成句对白而不只是环境音，整轨丢掉等于把模型生成的表演扔了。
        // 压多少由 clip_volume 决定（默认 0.3），因为"该压还是该留"只有作者知道。
        filters.push(`[${baseAudio}]volume=${clipVol}[amb]`, `[${voIdx}:a]volume=${voiceVol}[vo]`,
          `[amb][vo]${amix}[a]`);
        aMap = '[a]';
      } else {
        aMap = baseAudio;
      }
      args.push('-filter_complex', filters.join(';'), '-map', '[v]', '-map', aMap,
        '-shortest', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', out);
      await ff(FFMPEG(), args, dir);
      normalized.push(out);
    }
    const list = join(dir, 'list.txt');
    writeFileSync(list, normalized.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
    const outFile = join(dir, 'out.mp4');
    await ff(FFMPEG(), ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', outFile]);

    // 全片软字幕（只在烧不了的时候走这条）：各段 cue 按前面所有段的时长累加偏移，拼成一份整片 srt
    const softSrt = (!canBurn && wantSubs) ? (() => {
      const lines: string[] = [];
      let offset = 0, n = 0;
      for (let i = 0; i < infos.length; i++) {
        for (const c of buildSrtCues(subs?.[i] ?? '', infos[i].duration)) {
          lines.push(`${++n}\n${srtTime(c.start + offset)} --> ${srtTime(c.end + offset)}\n${c.text}\n`);
        }
        offset += infos[i].duration;
      }
      return lines.join('\n');
    })() : '';

    let current = outFile;

    // BGM 单独一趟：画面 -c:v copy（不重编、不掉画质），只重做音轨。
    // 循环铺满全片、末尾 2 秒淡出——短片配 BGM 最常见的翻车就是音乐比片长短、后半段突然静音。
    if (opts.bgm) {
    const bgmFile = join(dir, 'bgm.audio');
    writeFileSync(bgmFile, opts.bgm.buffer);
    const total = await mediaDuration(outFile);
    const bgmVol = opts.bgm_volume !== undefined && opts.bgm_volume >= 0 ? opts.bgm_volume : 0.25;
    const fadeStart = Math.max(0, total - 2);
    const withBgm = join(dir, 'out_bgm.mp4');
    onNotice?.(`🎵 混入背景音乐 ${opts.bgm.name}（音量 ${bgmVol}${total > 0 ? `，末尾 2s 淡出` : ''}）`);
    await ff(FFMPEG(), [
      '-y', '-i', outFile, '-stream_loop', '-1', '-i', bgmFile,
      '-filter_complex',
      `[1:a]volume=${bgmVol}${total > 0 ? `,afade=t=out:st=${fadeStart.toFixed(2)}:d=2` : ''}[bg];`
      + `[0:a][bg]${amix}[a]`,
      '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-ar', '48000', '-ac', '2',
      '-movflags', '+faststart', withBgm,
    ], dir);
    current = withBgm;
    }

    if (softSrt) {
      const srtName = 'soft.srt';
      writeFileSync(join(dir, srtName), softSrt, 'utf-8');
      const withSub = join(dir, 'out_sub.mp4');
      await ff(FFMPEG(), [
        '-y', '-i', current, '-i', srtName,
        '-map', '0', '-map', '1', '-c', 'copy', '-c:s', 'mov_text',
        '-movflags', '+faststart', withSub,
      ], dir);
      current = withSub;
    }

    return readFileSync(current);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
