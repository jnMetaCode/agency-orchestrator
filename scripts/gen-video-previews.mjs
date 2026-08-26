#!/usr/bin/env node
// 给创意库的视频题材模板生成**示例成片**。
//
// 为什么要自己出片：22 个 5 段式题材模板现在只有文字，卡片上一个画面都没有。
// 找过开源现成的——生态里所有"带示例视频"的库，视频要么是 OpenAI showcase 的外链、
// 要么是推特 CDN（会失效），没有一个是"自己托管 + 许可明确"。自己跑一遍最干净：
// 版权归我们、可自托管、想重拍就重拍。
//
// **这个脚本会花钱**：秘塔 768P 0.09 元/秒，默认每条 5 秒 ≈ 0.45 元，22 条 ≈ 10 元。
// 所以默认是**空跑**（只打印会花多少、跑哪些），加 --yes 才真的发请求。
//
// 用法：
//   node scripts/gen-video-previews.mjs                    # 空跑：看清单与预估费用
//   METASO_API_KEY=mk-... node scripts/gen-video-previews.mjs --yes
//   ... --yes --only animal-vlog,micro-drama               # 只跑指定几条
//   ... --yes --resolution 480p --duration 4               # 更省的档
//
// 产物落 website/public/video-previews/<id>.mp4，并把相对路径写回 video-prompts.json 的
// preview 字段。装了 ffmpeg 会再压一版（480 宽、无音轨）——原片 2K 几十 MB 直接进仓库
// 会把网站部署拖垮，卡片预览也用不着那个清晰度。
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateVideo } from '../dist/connectors/video.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
// --pool genre（默认，22 个题材模板）| community（47 条社区成品提示词：现在挂的是 OpenAI/推特外链，会失效，换成自托管）
const POOL = (process.argv.includes('--pool') ? process.argv[process.argv.indexOf('--pool') + 1] : 'genre') || 'genre';
const DATA = join(repoRoot, 'website', 'src', 'content', POOL === 'community' ? 'video-prompts-community.json' : 'video-prompts.json');
const OUTDIR = join(repoRoot, 'website', 'public', 'video-previews');

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const GO = argv.includes('--yes');
const ONLY = (arg('only', '') || '').split(',').filter(Boolean);
const RESOLUTION = arg('resolution', '768P');
const DURATION = Number(arg('duration', 5));
const PROVIDER = arg('provider', 'metaso');
const MODEL = arg('model', 'MiniMax-H3');
// 单价表只写**已经核实过的**：秘塔官网标价 768P 0.09 元/秒、2K 0.15 元/秒。
// 没核实过的档位不猜价——宁可显示"单价未知"，也不给用户一个编出来的数字。
const PRICE = { '768P': 0.09, '2K': 0.15 };

const data = JSON.parse(readFileSync(DATA, 'utf-8'));
const genres = POOL === 'community'
  ? data.templates.filter((t) => t.kind === 'community' && t.prompt)
  : data.templates.filter((t) => t.lang === 'zh' && t.kind === 'genre' && t.prompt);

/** 把模板正文里的 {{变量}} 用变量表给的示例取值填上——变量表存在就是为了这个。 */
function fill(t) {
  let text = t.prompt;
  for (const v of t.variables ?? []) {
    const val = String(v.example || '').replace(/[（(].*?[)）]\s*$/, '').trim();
    if (!val) continue;
    text = text.replaceAll(`{{${v.name}}}`, val);
  }
  // 没填上的占位符原样留着会被模型当字面量念出来，剔掉更安全
  return text.replace(/\{\{[^}]+\}\}/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

const todo = genres.filter((t) => {
  if (ONLY.length && !ONLY.includes(t.id)) return false;
  return !(t.preview && String(t.preview).startsWith('/video-previews/') && existsSync(join(OUTDIR, `${t.id}.mp4`)));      // 已经有的跳过，可断点续跑
});

const unit = PRICE[RESOLUTION];
const cost = unit ? (todo.length * DURATION * unit).toFixed(2) : null;
console.log(`题材模板 ${genres.length} 个，待生成 ${todo.length} 条（${RESOLUTION} × ${DURATION}s，${PROVIDER}/${MODEL}）`);
console.log(cost ? `预估费用：约 ${cost} 元（${unit} 元/秒 × ${DURATION}s × ${todo.length}）` : '预估费用：该分辨率单价未核实，不猜');
if (!GO) {
  console.log('\n这是空跑。确认要花这笔钱就加 --yes；先试一条可以：--yes --only ' + (todo[0]?.id ?? 'animal-vlog'));
  process.exit(0);
}
if (!process.env.METASO_API_KEY && !process.env[`${PROVIDER.toUpperCase()}_API_KEY`]) {
  console.error(`❌ 没有 ${PROVIDER} 的 key（环境变量 METASO_API_KEY）`);
  process.exit(1);
}

mkdirSync(OUTDIR, { recursive: true });
let ok = 0, fail = 0;
for (const t of todo) {
  const out = join(OUTDIR, `${t.id}.mp4`);
  process.stdout.write(`  ${t.id} … `);
  try {
    const vid = await generateVideo(
      { provider: PROVIDER },
      fill(t),
      { model: MODEL, resolution: RESOLUTION, duration: DURATION, ratio: '16:9' },
      () => {},
    );
    writeFileSync(out, vid.buffer);
    // 压一版：卡片预览不需要原始清晰度，而原片进仓库会把部署拖垮
    try {
      execFileSync('ffmpeg', ['-y', '-i', out, '-vf', 'scale=480:-2', '-an', '-c:v', 'libx264',
        '-crf', '30', '-preset', 'slow', '-movflags', '+faststart', `${out}.tmp.mp4`], { stdio: 'ignore' });
      const before = statSync(out).size, after = statSync(`${out}.tmp.mp4`).size;
      if (after > 0 && after < before) {
        execFileSync('mv', [`${out}.tmp.mp4`, out]);
        console.log(`✅ ${(after / 1024 / 1024).toFixed(1)}MB（原 ${(before / 1024 / 1024).toFixed(1)}MB）`);
      } else {
        console.log(`✅ ${(before / 1024 / 1024).toFixed(1)}MB（压缩没变小，保留原片）`);
      }
    } catch {
      console.log(`✅ ${(statSync(out).size / 1024 / 1024).toFixed(1)}MB（没装 ffmpeg，未压缩）`);
    }
    // 社区池原来的外链示例（OpenAI/推特 CDN）保留一份，别丢
    if (t.preview && /^https?:\/\//.test(String(t.preview)) && !t.previewOrigin) t.previewOrigin = t.preview;
    t.preview = `/video-previews/${t.id}.mp4`;
    // 来源标注：创意库卡片上显示"由 X 家 Y 模型出片"——这是给赞助商最实在的展示位
    t.previewBy = { provider: PROVIDER, model: MODEL, resolution: RESOLUTION, seconds: DURATION };
    writeFileSync(DATA, JSON.stringify(data, null, 2) + '\n', 'utf-8');   // 每条落盘，中断不白花钱
    ok++;
  } catch (e) {
    console.log(`❌ ${e instanceof Error ? e.message.split('\n')[0].slice(0, 120) : e}`);
    fail++;
  }
}
console.log(`\n完成 ${ok} 条${fail ? `，失败 ${fail} 条（重跑只补没生成的）` : ''}`);
console.log('别忘了：这批 mp4 要提交进仓库才会随官网部署；先看一眼质量，不满意的删掉重跑。');
