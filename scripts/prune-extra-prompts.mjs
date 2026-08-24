#!/usr/bin/env node
// 扩充池内容体检：把不适合挂在公开产品页上的条目剔掉。
//
// 为什么单独一个脚本而不是只写在导入器里：导入器重跑会把中文标题（translate-extra-titles.mjs
// 补的 titleZh/descZh）冲掉，所以已经翻译过的池子用这个做**原地删除**；导入器里也有同一套
// 规则，保证下次重新导入时同样干净。两边规则改一处就要改两处——这里和 import-creative-extra.mjs
// 的 RISKY 段落必须保持一致。
//
// 三类剔除（顺序即优先级）：
//   1. **指名真人**：Tom Cruise / Ronaldo / 特朗普这类。风险最高——肖像权，且国内对
//      生成真人形象有明确监管（深度合成规定）。
//   2. **IP 角色作主体**：皮卡丘、马里奥这种。注意**只删角色**，不删 "Pixar-style"
//      这类风格描述词——后者是 AI 绘画社区的通用词汇，删了会误伤一大片正常的插画提示词。
//   3. **性化描述**：不是把 "nude lips"（裸色唇妆）这种当色情——那是美妆术语。只挡
//      露骨词与把未成年/年龄+性感绑一起的写法。
//
// **负面提示词里的词不算命中**：「no blood, no gore」「avoid NSFW」是在告诉模型**别生成**，
// 按关键词一刀切会把这类正常提示词误删（真机上就撞见两条）。
//
// 用法：node scripts/prune-extra-prompts.mjs [文件路径]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = process.argv[2]
  ? resolve(process.argv[2])
  : join(resolve(__dirname, '..'), 'website', 'src', 'content', 'creative-prompts-extra.json');

export const RULES = [
  ['指名真人', /\b(tom cruise|elon musk|donald trump|taylor swift|lionel messi|cristiano ronaldo|jackie chan|keanu reeves|brad pitt|scarlett johansson)\b|成龙|马云|马斯克|特朗普/i],
  ['IP 角色作主体', /\b(batman|spider-?man|iron man|naruto|one piece|pokemon|pok[eé]ball|pikachu|mario and luigi|super mario|harry potter|superman|elsa from frozen)\b/i],
  ['性化描述', /\b(nsfw|porn|erotic|topless)\b|\bnaked\s+(body|woman|man|girl|boy)\b|nude\s+(body|figure|woman|man|model|photo)|innocent-?sexy/i],
];

/** 命中处是否落在"负面提示词"的语境里（no / avoid / without / never / 不要 …）。 */
export function isNegativeContext(text, index) {
  const before = text.slice(Math.max(0, index - 40), index).toLowerCase();
  return /\b(no|not|avoid|without|never|exclude|negative|prohibit)\b[^.]{0,30}$|不要|禁止|避免/.test(before);
}

export function violation(item) {
  const hay = `${item.title || ''}\n${item.prompt || ''}`;
  for (const [name, rx] of RULES) {
    const m = rx.exec(hay);
    if (m && !isNegativeContext(hay, m.index)) return { name, word: m[0] };
  }
  return null;
}

if (process.argv[1] && process.argv[1].endsWith('prune-extra-prompts.mjs')) {
  const data = JSON.parse(readFileSync(FILE, 'utf-8'));
  const key = data.prompts ? 'prompts' : 'templates';
  const kept = [];
  const dropped = [];
  for (const it of data[key]) {
    const v = violation(it);
    if (v) dropped.push({ ...v, title: (it.titleZh || it.title || '').slice(0, 40) });
    else kept.push(it);
  }
  data[key] = kept;
  if (typeof data.count === 'number') data.count = kept.length;
  writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n', 'utf-8');

  const byRule = dropped.reduce((m, d) => (m[d.name] = (m[d.name] || 0) + 1, m), {});
  console.log(`✅ ${FILE.split('/').pop()}：保留 ${kept.length}，剔除 ${dropped.length}`);
  for (const [k, v] of Object.entries(byRule)) console.log(`   ${k}: ${v}`);
  for (const d of dropped.slice(0, 12)) console.log(`   · 「${d.word}」 ${d.title}`);
}
