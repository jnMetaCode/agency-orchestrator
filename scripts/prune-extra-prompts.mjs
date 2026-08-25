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

// 名单永远不可能穷尽——这里收的是**全球或国内高辨识度**的那批，即"一眼就知道是谁"。
// 边界名（只有姓、或与普通词同形的）故意不收：误伤一条正常提示词没人会来报 bug，
// 用户只会觉得这库怎么这么少。宁可放过边缘，也不误杀大片。
const PEOPLE_EN = [
  'tom cruise', 'elon musk', 'donald trump', 'joe biden', 'barack obama', 'taylor swift',
  'lionel messi', 'cristiano ronaldo', 'lebron james', 'kim kardashian', 'kylie jenner',
  'jackie chan', 'keanu reeves', 'brad pitt', 'angelina jolie', 'scarlett johansson',
  'leonardo dicaprio', 'robert downey', 'dwayne johnson', 'the rock\\b', 'johnny depp',
  'emma watson', 'margot robbie', 'zendaya', 'billie eilish', 'ariana grande', 'beyonc[eé]',
  'rihanna', 'drake\\b', 'kanye west', 'justin bieber', 'selena gomez', 'mark zuckerberg',
  'jeff bezos', 'bill gates', 'steve jobs', 'sam altman', 'putin', 'zelensky', 'modi\\b',
  'ronaldinho', 'neymar', 'kobe bryant', 'michael jordan', 'jensen huang',
];
const PEOPLE_ZH = [
  '成龙', '周星驰', '刘德华', '周杰伦', '易烊千玺', '杨幂', '迪丽热巴', '赵丽颖', '范冰冰',
  '马云', '马化腾', '雷军', '马斯克', '特朗普', '拜登', '普京', '张艺谋', '李佳琦', '董宇辉',
];
// IP：只挡**角色/作品作为主体**，不挡 "Pixar-style / Ghibli-style" 这类画风词——
// 画风词是 AI 绘画社区的通用词汇（见 test/creative-prune.ts 钉的反例）。
const IP_CHARS = [
  'batman', 'spider-?man', 'iron man', 'captain america', 'thor\\b', 'hulk\\b', 'wonder woman',
  'superman', 'joker\\b', 'darth vader', 'yoda\\b', 'baby yoda', 'stormtrooper',
  'naruto', 'sasuke', 'goku\\b', 'luffy\\b', 'one piece', 'demon slayer', 'tanjiro',
  'pokemon', 'pok[eé]ball', 'pikachu', 'charizard', 'mario and luigi', 'super mario',
  'luigi\\b', 'sonic the hedgehog', 'kirby\\b', 'zelda\\b', 'harry potter', 'hogwarts',
  'hermione', 'dumbledore', 'elsa from frozen', 'mickey mouse', 'donald duck', 'winnie the pooh',
  'hello kitty', 'doraemon', 'totoro', 'minions?\\b', 'shrek\\b', 'barbie\\b',
  '孙悟空大闹天宫', '喜羊羊', '熊出没', '哪吒之', '王者荣耀', '原神',
];
// 品牌：把别家商标当主体做"产品大片"，商用风险不在我们这边也不该由我们分发
const BRANDS = [
  'the north face', 'louis vuitton', 'gucci\\b', 'chanel\\b', 'herm[eè]s', 'rolex\\b',
  'supreme\\b', 'balenciaga', 'prada\\b', 'dior\\b', 'starbucks', 'coca-?cola', 'pepsi\\b',
  'mcdonald', 'nike\\b', 'adidas', 'apple watch', 'iphone \\d', 'tesla\\b', 'lamborghini',
  'ferrari\\b', 'porsche', 'rolls-?royce',
];
const alt = (xs) => xs.join('|');

export const RULES = [
  ['指名真人', new RegExp(`\\b(${alt(PEOPLE_EN)})\\b|${alt(PEOPLE_ZH)}`, 'i')],
  ['IP 角色作主体', new RegExp(`\\b(${alt(IP_CHARS)})\\b|${alt(IP_CHARS.filter((x) => /[\u4e00-\u9fa5]/.test(x)))}`, 'i')],
  ['品牌商标作主体', new RegExp(`\\b(${alt(BRANDS)})\\b`, 'i')],
  ['性化描述', /\b(nsfw|porn|erotic|topless)\b|\bnaked\s+(body|woman|man|girl|boy)\b|nude\s+(body|figure|woman|man|model|photo)|innocent-?sexy/i],
];

/**
 * 命中处是否只是**风格描述或颜色名**，而不是把品牌/角色当主体。
 *
 * 与"Pixar-style 不算 IP、nude lips 不算色情"是同一条道理：抽查真被剔掉的条目时发现
 * 「Nike-style premium ad aesthetic」「Porsche yellow inner chamber」也被一刀切了——
 * 前者是风格词、后者是颜色名，都不是在拿别人的商标当产品主体。误删不会有人来报 bug，
 * 只会让库悄悄变少，所以这类必须放行。
 */
export function isStyleOrColorContext(text, index, word) {
  const after = text.slice(index + word.length, index + word.length + 24).toLowerCase();
  const before = text.slice(Math.max(0, index - 24), index).toLowerCase();
  // X-style / X style / X aesthetic / X vibe → 风格描述
  if (/^[\s-]*(style|styled|esque|aesthetic|vibe|inspired|like)\b/.test(after)) return true;
  // inspired by X / in the style of X / like X → 同上
  if (/(inspired by|in the style of|reminiscent of|similar to|like)\s*$/.test(before)) return true;
  // X yellow / X red … → 颜色名（Porsche yellow、Ferrari red、Tiffany blue 这类惯用法）
  if (/^\s*(yellow|red|blue|green|black|white|orange|silver|gold|grey|gray|pink|purple)\b/.test(after)) return true;
  return false;
}

/** 命中处是否落在"负面提示词"的语境里（no / avoid / without / never / 不要 …）。 */
export function isNegativeContext(text, index) {
  const before = text.slice(Math.max(0, index - 40), index).toLowerCase();
  return /\b(no|not|avoid|without|never|exclude|negative|prohibit)\b[^.]{0,30}$|不要|禁止|避免/.test(before);
}

export function violation(item) {
  const hay = `${item.title || ''}\n${item.prompt || ''}`;
  for (const [name, rx] of RULES) {
    // 一条提示词里同一类词可能出现多次：前面那处是风格词、后面那处才是主体，
    // 只看第一处会漏判。全局扫，任一处构成"拿它当主体"就算命中。
    const re = new RegExp(rx.source, rx.flags.includes('g') ? rx.flags : `${rx.flags}g`);
    // 风格/颜色豁免**只给品牌与 IP**，不给真人：Nike-style 是画风、Porsche yellow 是颜色，
    // 但"inspired by 某某明星"做出来的仍然是那个人的脸——致敬不改变用了肖像这件事。
    const styleExemptable = name === '品牌商标作主体' || name === 'IP 角色作主体';
    let m;
    while ((m = re.exec(hay)) !== null) {
      if (isNegativeContext(hay, m.index)) continue;
      if (styleExemptable && isStyleOrColorContext(hay, m.index, m[0])) continue;
      return { name, word: m[0] };
    }
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
