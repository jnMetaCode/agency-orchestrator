#!/usr/bin/env node
// 「创意库 · 扩充池」导入器，两个源：
//   源 A: jau123/nanobanana-trending-prompts（**CC BY 4.0**）—— 1446 条，
//         **逐条带作者、原推链接、点赞数、预览图**，出处最干净，全量收
//   源 B: YouMind-OpenLab/ai-image-prompts-skill（**MIT**）—— 2.2 万条策展库，
//         但逐条没有作者（整库策展），按分类取样收
// → website/src/content/creative-prompts-extra.json
//
// 与已有的 229 条（creative-prompts.json，CC BY 4.0，两个源）分开放，理由有三个：
//   1. 许可不同（MIT vs CC BY 4.0），署名文案不一样，混在一起就会给错署名
//   2. 那 229 条是有 SEO 静态页的；这批**不进 sitemap**（同一批提示词在 youmind.com
//      也公开，两个域名各挂一份会互相稀释权重——canonical 归属没定之前不生成页面）
//   3. 这批体量大，前端按需 import，不能拖累首屏
//
// 上游 2.2 万条不可能整包塞进前端（≈33MB）。这里按分类取样：每类最多 PER_CAT 条，
// 优先取提示词长度适中的（太短没信息量、太长在卡片里读不完），并按提示词指纹去重。
//
// 用法：
//   git clone --depth 1 https://github.com/YouMind-OpenLab/ai-image-prompts-skill /tmp/ymskill
//   node scripts/import-creative-extra.mjs /tmp/ymskill
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
// 内容体检规则与 prune 脚本共用一份，避免"两处规则改一处"（见 prune-extra-prompts.mjs 文件头）
import { violation } from './prune-extra-prompts.mjs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const OUT = join(repoRoot, 'website', 'src', 'content', 'creative-prompts-extra.json');
const EXISTING = join(repoRoot, 'website', 'src', 'content', 'creative-prompts.json');

const src = process.argv[2];          // ai-image-prompts-skill 仓库根（源 B）
const trendSrc = process.argv[3];     // nanobanana-trending-prompts 仓库根（源 A，可选）
if (!src || !existsSync(join(src, 'references', 'manifest.json'))) {
  console.error('用法: node scripts/import-creative-extra.mjs <ai-image-prompts-skill 根> [nanobanana-trending-prompts 根]\n' +
    '  git clone --depth 1 https://github.com/YouMind-OpenLab/ai-image-prompts-skill\n' +
    '  git clone --depth 1 https://github.com/jau123/nanobanana-trending-prompts');
  process.exit(1);
}

// 每个分类最多收多少条。上游分布极不均（social-media-post 9559 条、youtube-thumbnail 218 条），
// 不设上限就会被一个分类淹没；设了上限，各分类才都有得挑。
const PER_CAT = Number(process.env.PER_CAT || 50);
// 提示词太短没信息量，太长在卡片里根本读不完（上游最长 11548 字）
const MIN_LEN = 200;
const MAX_LEN = 3500;

// 上游分类 → 本站分类。本站原有 12 类是中文、按用途分；对不上的补两类（UI/网页、游戏 / 资产），
// 不硬塞进「其他」——那等于让用户翻不到。
const CAT_MAP = {
  'profile-avatar': '人像 / 写真',
  'social-media-post': '海报 / 广告',
  'poster-flyer': '海报 / 广告',
  'youtube-thumbnail': '海报 / 广告',
  'product-marketing': '电商 / 产品',
  'ecommerce-main-image': '电商 / 产品',
  'infographic-edu-visual': '信息图 / 排版',
  'comic-storyboard': '动漫 / 漫画',
  'game-asset': '游戏 / 资产',
  'app-web-design': 'UI / 网页',
  others: '其他',
};

/**
 * trending 源没有 title 字段，只能从提示词里取。直接拿首行会把推文口水话当标题
 * （实测出现过「Nano Banana 2 on @Hailuo_AI」这种），所以先剥掉：
 * "Prompt:" 之前的引子、@提及、链接、行首的表情与序号，再在词边界截断。
 */
function titleFrom(text) {
  let t = String(text || '');
  const m = t.match(/(?:^|\n)\s*(?:prompt|提示词)\s*[:：]\s*([\s\S]+)/i);
  if (m) t = m[1];
  t = t.split('\n').find((l) => l.trim().length > 12) || t;
  t = t.replace(/https?:\/\/\S+/g, ' ')          // 链接
       .replace(/@[A-Za-z0-9_]+/g, ' ')            // @提及
       .replace(/^[\s\-–—*#>0-9.、)）]+/, '')      // 行首序号/符号
       .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')  // 表情
       .replace(/\s+/g, ' ')
       .trim();
  if (t.length <= 56) return t;
  const cut = t.slice(0, 56);
  const brk = Math.max(cut.lastIndexOf(', '), cut.lastIndexOf('. '), cut.lastIndexOf(' '));
  return (brk > 24 ? cut.slice(0, brk) : cut).trim() + '…';
}

const fingerprint = (s) => createHash('sha1').update(s.replace(/\s+/g, ' ').trim().slice(0, 400)).digest('hex');

// 与已有 229 条去重：同一条提示词在两个源里都出现过时，保留原有那条（它有中文标题与作者署名）
const seen = new Set();
if (existsSync(EXISTING)) {
  for (const p of JSON.parse(readFileSync(EXISTING, 'utf-8')).prompts ?? []) seen.add(fingerprint(p.prompt || ''));
}
const before = seen.size;

const out = [];
let skippedLen = 0, skippedDup = 0, skippedJson = 0, skippedRisky = 0;

// ── 源 A：trending（CC BY 4.0，逐条署名）——全量收，并且**先收**：
// 后面源 B 里若有同一条提示词，会因指纹去重被跳过，从而保住这边的作者署名。
const TREND_CAT = {
  'Photography': '摄影 / 影视',
  'Illustration & 3D': '插画 / 绘画',
  'Product & Brand': '电商 / 产品',
  'Poster Design': '海报 / 广告',
  'Food & Drink': '美食 / 饮品',
  'UI & Graphic': 'UI / 网页',
};
if (trendSrc && existsSync(join(trendSrc, 'prompts', 'prompts.json'))) {
  const items = JSON.parse(readFileSync(join(trendSrc, 'prompts', 'prompts.json'), 'utf-8'));
  for (const it of items) {
    const text = String(it.prompt || '').trim();
    if (text.length < MIN_LEN || text.length > MAX_LEN) { skippedLen++; continue; }
    // 有一批条目整条是 JSON 参数块（{"generation_request": …}）——卡片里既读不懂、
    // 标题也只能截出一段花括号，复制走对多数模型也不通用。跳过。
    if (/^[[{]/.test(text) || /"generation_request"|"prompt"\s*:/.test(text.slice(0, 200))) { skippedJson++; continue; }
    // 指名真人 / IP 角色 / 露骨描述：不适合挂在公开产品页上（规则见 prune-extra-prompts.mjs）
    if (violation({ title: it.title, prompt: text })) { skippedRisky++; continue; }
    const fp = fingerprint(text);
    if (seen.has(fp)) { skippedDup++; continue; }
    seen.add(fp);
    out.push({
      id: `tr-${it.id}`,
      title: it.title ? String(it.title).trim().slice(0, 60) : titleFrom(text),
      description: '',
      prompt: text,
      category: TREND_CAT[(it.categories || [])[0]] || '其他',
      image: it.image || (it.images || [])[0] || '',
      author: it.author_name || it.author || '',
      authorUrl: it.author ? `https://x.com/${String(it.author).replace(/^@/, '')}` : '',
      source: 'nanobanana-trending',
      sourceUrl: it.source_url || '',
    });
  }
}

const manifest = JSON.parse(readFileSync(join(src, 'references', 'manifest.json'), 'utf-8'));

for (const cat of manifest.categories ?? []) {
  const file = join(src, 'references', cat.file);
  if (!existsSync(file)) continue;
  const items = JSON.parse(readFileSync(file, 'utf-8'));
  // 取样偏好：长度落在舒适区间、带预览图、标题与描述齐全的优先
  const ranked = items
    .filter((it) => {
      const len = (it.content || '').length;
      if (len < MIN_LEN || len > MAX_LEN) { skippedLen++; return false; }
      if (/^[[{]/.test(String(it.content || '').trim())) { skippedJson++; return false; }   // 同源 A：整条 JSON 参数块不收
      if (violation({ title: it.title, prompt: it.content })) { skippedRisky++; return false; }
      return it.title && Array.isArray(it.sourceMedia) && it.sourceMedia[0];
    })
    .sort((a, b) => (b.description ? 1 : 0) - (a.description ? 1 : 0));

  let taken = 0;
  for (const it of ranked) {
    if (taken >= PER_CAT) break;
    const fp = fingerprint(it.content);
    if (seen.has(fp)) { skippedDup++; continue; }
    seen.add(fp);
    out.push({
      id: `ymx-${cat.slug}-${it.id}`,
      title: String(it.title).trim(),
      description: String(it.description || '').trim(),
      prompt: String(it.content).trim(),
      category: CAT_MAP[cat.slug] || '其他',
      image: it.sourceMedia[0],
      // 上游逐条没有作者字段（是整库策展），署名落到源仓库层面
      author: '', authorUrl: '',
      source: 'ai-image-prompts-skill',
      needRef: !!it.needReferenceImages,
    });
    taken++;
  }
}

writeFileSync(OUT, JSON.stringify({
  note: '创意库扩充池：来自 YouMind-OpenLab/ai-image-prompts-skill（MIT）。'
      + '由 scripts/import-creative-extra.mjs 生成，**别手改**。与 creative-prompts.json（CC BY 4.0）'
      + '分开存：许可不同、署名文案不同，且这批不生成 SEO 静态页。',
  sources: [
    { key: 'nanobanana-trending', name: 'jau123/nanobanana-trending-prompts', url: 'https://github.com/jau123/nanobanana-trending-prompts', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' },
    { key: 'ai-image-prompts-skill', name: 'YouMind-OpenLab/ai-image-prompts-skill', url: 'https://github.com/YouMind-OpenLab/ai-image-prompts-skill', license: 'MIT', gallery: 'https://youmind.com/nano-banana-pro-prompts' },
  ],
  perCategoryCap: PER_CAT,
  count: out.length,
  prompts: out,
}, null, 2) + '\n', 'utf-8');

const byCat = out.reduce((m, p) => (m[p.category] = (m[p.category] || 0) + 1, m), {});
const bySrc = out.reduce((m, p) => (m[p.source] = (m[p.source] || 0) + 1, m), {});
console.log(`   按源：${Object.entries(bySrc).map(([k, v]) => `${k} ${v}`).join('、')}`);
console.log(`✅ ${OUT}`);
console.log(`   收 ${out.length} 条（每类上限 ${PER_CAT}）；与已有 ${before} 条去重后新增`);
console.log(`   分类分布：${Object.entries(byCat).map(([k, v]) => `${k} ${v}`).join('、')}`);
console.log(`   跳过：长度不合适 ${skippedLen}、与已有重复 ${skippedDup}、整条是 JSON 参数块 ${skippedJson}、指名真人/IP/露骨 ${skippedRisky}`);
