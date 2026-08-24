#!/usr/bin/env node
// 视频提示词「社区池」导入器：zhangchenchen/awesome_sora2_prompt（**MIT**）
// → website/src/content/video-prompts-community.json
//
// 与 video-prompts.json（姊妹项目 ai-shortfilm-prompts 的 22 个 5 段式题材模板）分开存：
//   - 那批是**结构化模板**（变量表 + 5 段式），这批是**成品单条提示词**（英文、无变量）
//   - 那批出处唯一（同作者 MIT），这批是社区收集：官方样例 + 推特热门混在一起
//   - 混进同一份数据，卡片就要在"有没有变量"上到处分支，署名也会给错
//
// 两条过滤纪律：
//   1. **指名真人 / 影视 IP 的直接不收**（@某人、明星名、Marvel/Disney 之类）——
//      这与角色库里「视频提示词工程师」写的规则一致：避开 IP 词与真人姓名。
//   2. OpenAI 官方样例单独标源：那段文字是 OpenAI 发布的 showcase，MIT 覆盖的是
//      收录者的整理工作，不是原文著作权——署名要如实写清楚它从哪来。
//
// 用法：
//   git clone --depth 1 https://github.com/zhangchenchen/awesome_sora2_prompt /tmp/sora2
//   node scripts/import-video-community.mjs /tmp/sora2
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
// 内容体检规则与图片扩充池共用一份（见 prune-extra-prompts.mjs 文件头）
import { violation } from './prune-extra-prompts.mjs';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const OUT = join(repoRoot, 'website', 'src', 'content', 'video-prompts-community.json');

const src = process.argv[2];
if (!src || !existsSync(join(src, 'prompts'))) {
  console.error('用法: node scripts/import-video-community.mjs <awesome_sora2_prompt 仓库根>');
  process.exit(1);
}

// 文件 → 本站分类 + 出处口径
const FILES = {
  'hyperrealism-landscapes.md': { category: '写实 / 风光', origin: 'community' },
  'sora2-viral-prompts.md': { category: '社区热门', origin: 'community' },
  'official-prompts.md': { category: '官方样例', origin: 'openai-showcase' },
};

// 指名真人与影视 IP 的一律不收（见文件头纪律 1）。名单不可能穷尽，所以只挡最常见的，
// 并在 UI 上如实说明"社区来源可能含真人/IP"——**告知，而不是假装过滤干净了**。
const RISKY = /@\w+|sam\s*altman|\bsama\b|elon|musk|trump|taylor swift|marvel|avengers|disney|pixar|pokemon|star\s*wars|harry potter|mario\b|batman|spider-?man/i;

const items = [];
let skippedRisky = 0;

for (const [file, meta] of Object.entries(FILES)) {
  const path = join(src, 'prompts', file);
  if (!existsSync(path)) continue;
  const md = readFileSync(path, 'utf-8');
  // ### 标题 → 正文里找 **Prompt:** / **Full Prompt:** 后的代码块
  for (const m of md.matchAll(/^###\s+(.+?)\n([\s\S]*?)(?=^###\s|\Z)/gm)) {
    const title = m[1].trim();
    const pm = m[2].match(/\*\*(?:Full )?Prompt:\*\*\s*\n+```[^\n]*\n([\s\S]*?)\n```/);
    if (!pm) continue;
    const prompt = pm[1].trim();
    // 本地 RISKY 挡的是"拿真人编段子"这类推文（@某人、明星名）；violation() 是与图片池
    // 共用的那套（指名真人 / IP 角色作主体 / 露骨），两层都过才收
    if (RISKY.test(prompt) || RISKY.test(title) || violation({ title, prompt })) { skippedRisky++; continue; }
    const video = m[2].match(/\*\*Video Link:\*\*\s*\[[^\]]*\]\(([^)]+)\)/);
    items.push({
      id: `sora2-${basename(file, '.md')}-${items.length + 1}`,
      kind: 'community',
      // 英文原文，但中英两个界面都该看得到——不像 5 段式模板那样有中英两版
      lang: 'any',
      title,
      category: meta.category,
      description: '',
      variables: [],
      prompt,
      // 只收直接指向视频文件的链接：源里混着指向文章页的（openai.com/index/sora-2/），
      // 那种塞进 <video> 就是一个永远转圈的黑框。失效链接由 prune 时的探活清掉。
      preview: video && /\.mp4($|\?)/i.test(video[1]) ? video[1] : '',
      origin: meta.origin,
      source: 'https://github.com/zhangchenchen/awesome_sora2_prompt',
      license: 'MIT',
      author: meta.origin === 'openai-showcase' ? 'OpenAI Sora showcase' : 'awesome_sora2_prompt',
    });
  }
}

writeFileSync(OUT, JSON.stringify({
  note: '视频提示词社区池：来自 zhangchenchen/awesome_sora2_prompt（MIT）。'
      + '由 scripts/import-video-community.mjs 生成，**别手改**。'
      + '与 video-prompts.json（姊妹项目的 5 段式题材模板）分开存：那批有变量表与结构，这批是成品单条。',
  source: { name: 'zhangchenchen/awesome_sora2_prompt', url: 'https://github.com/zhangchenchen/awesome_sora2_prompt', license: 'MIT' },
  count: items.length,
  templates: items,
}, null, 2) + '\n', 'utf-8');

const byCat = items.reduce((m, i) => (m[i.category] = (m[i.category] || 0) + 1, m), {});
console.log(`✅ ${OUT}`);
console.log(`   收 ${items.length} 条：${Object.entries(byCat).map(([k, v]) => `${k} ${v}`).join('、')}`);
console.log(`   跳过（指名真人/IP）：${skippedRisky}`);
