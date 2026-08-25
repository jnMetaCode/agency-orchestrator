#!/usr/bin/env node
// 给风格库（src/media/styles.ts）的每个风格出一张**示例图**。
//
// 风格库现在只有文字：中文名 + 一段摄影机/胶片/色调/光源的英文后缀。Studio 下拉里选风格时
// 有张图比读一段英文直观得多（小云雀风格库就是一格一图）。不放占位图冒充——要么真出，要么留空。
//
// **这个脚本会花钱**（图片按张计费，各家单价不同、这里不猜），所以默认**空跑**：只打印会出哪些、
// 用哪家哪个模型；加 --yes 才真的发请求。图片供应商与模型**必须显式给**（各家模型编码不通用，不猜）。
//
// 用法：
//   node scripts/gen-style-samples.mjs --provider lanox --model <图片模型>            # 空跑
//   LANOX_API_KEY=... node scripts/gen-style-samples.mjs --provider lanox --model <m> --yes
//   ... --yes --only neon-cyberpunk,wuxia-realism                                   # 只出几张
//
// 产物落 website/public/style-samples/<id>.png（装了 ffmpeg 会压到 640 宽），并把
// sample 字段写回 src/media/styles.ts（正则定位 `id: '<id>'` 那一行）。写回后记得 npm run build。
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateImage } from '../dist/connectors/image.js';
import { STYLE_PRESETS } from '../dist/media/styles.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const OUTDIR = join(repoRoot, 'website', 'public', 'style-samples');
const STYLES_TS = join(repoRoot, 'src', 'media', 'styles.ts');

const argv = process.argv.slice(2);
const arg = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; };
const GO = argv.includes('--yes');
const ONLY = (arg('only', '') || '').split(',').filter(Boolean);
const PROVIDER = arg('provider', '');
const MODEL = arg('model', '');
const SIZE = arg('size', '1024x1024');
if (!PROVIDER || !MODEL) {
  console.error('必须显式给 --provider 与 --model（图片模型编码各家不通用，不猜）。例：--provider lanox --model <该家的图片模型>');
  process.exit(2);
}

// 同一个中性主体，只让风格后缀变化——示例图才有可比性
const SUBJECT = 'a person in their thirties walking along a quiet street at dusk, medium shot, natural pose, no text, no watermark';
const targets = STYLE_PRESETS.filter((s) => !ONLY.length || ONLY.includes(s.id));

console.log(`风格示例图：${targets.length} 张 · 供应商 ${PROVIDER} · 模型 ${MODEL} · ${SIZE}`);
for (const s of targets) console.log(`  ${existsSync(join(OUTDIR, `${s.id}.png`)) ? '✓' : '·'} ${s.id}  ${s.name}`);
if (!GO) { console.log('\n空跑结束。确认后加 --yes 真的出图（按张计费，单价看服务商）。'); process.exit(0); }

mkdirSync(OUTDIR, { recursive: true });
let hasFfmpeg = false;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); hasFfmpeg = true; } catch { /* 没有就不压 */ }
let ts = readFileSync(STYLES_TS, 'utf-8');
let done = 0;
for (const s of targets) {
  const out = join(OUTDIR, `${s.id}.png`);
  if (existsSync(out) && !argv.includes('--force')) { console.log(`跳过（已有）${s.id}`); continue; }
  const prompt = `${SUBJECT}. ${s.prompt}`;
  process.stdout.write(`🎨 ${s.id} … `);
  try {
    const img = await generateImage({ provider: PROVIDER, model: MODEL }, prompt, { provider: PROVIDER, model: MODEL, size: SIZE }, (m) => process.stdout.write(`\n   ${m}\n`));
    writeFileSync(out, img.buffer);
    if (hasFfmpeg) {
      const tmp = `${out}.tmp.png`;
      execFileSync('ffmpeg', ['-y', '-i', out, '-vf', 'scale=640:-2', tmp], { stdio: 'ignore' });
      writeFileSync(out, readFileSync(tmp));
      execFileSync('rm', ['-f', tmp]);
    }
    const rel = `/style-samples/${s.id}.png`;
    // 写回 styles.ts：该风格对象里若已有 sample 就替换，否则在 prompt 字段后插入
    const re = new RegExp(`(\\{ id: '${s.id}',[\\s\\S]*?)(,\\s*sample: '[^']*')?(\\s*\\},?)`);
    ts = ts.replace(re, (m, head, _old, tail) => `${head}, sample: '${rel}'${tail}`);
    done++;
    console.log(`${(statSync(out).size / 1024).toFixed(0)}KB`);
  } catch (e) {
    console.log(`失败：${e instanceof Error ? e.message.split('\n')[0] : e}`);
  }
}
writeFileSync(STYLES_TS, ts);
console.log(`\n完成 ${done}/${targets.length}。已写回 ${STYLES_TS} 的 sample 字段——记得 npm run build，再提交 website/public/style-samples/。`);
