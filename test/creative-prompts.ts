/**
 * 创意库数据集完整性测试：锁住 website/src/content/creative-prompts.json 的契约。
 * 正面回应「前端零测试」债——至少保证内置数据集格式正确、不重 id、署名齐全（CC BY 4.0 合规）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let passed = 0, failed = 0;
function assert(c: boolean, m: string): void { if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; } }

console.log('\n─── 创意库数据集 ───');

const path = resolve('website/src/content/creative-prompts.json');
const data = JSON.parse(readFileSync(path, 'utf-8'));

assert(Array.isArray(data.prompts) && data.prompts.length > 0, `prompts 非空数组 (${data.prompts?.length})`);
assert(data.count === data.prompts.length, 'count 与实际条数一致');

// 每条必备字段
const missing = data.prompts.filter((p: any) => !p.id || !p.title || !p.prompt);
assert(missing.length === 0, `每条都有 id/title/prompt（缺失 ${missing.length}）`);

// id 唯一
const ids = data.prompts.map((p: any) => p.id);
assert(new Set(ids).size === ids.length, 'id 全局唯一');

// 署名合规：有源列表 + 均 CC BY 4.0；每条有 source 标记
assert(Array.isArray(data.sources) && data.sources.length > 0, `sources 列表非空 (${data.sources?.length})`);
assert(data.sources.every((s: any) => /CC BY 4\.0/i.test(s.license) && s.url), '每个源都标 CC BY 4.0 + 链接');
assert(data.prompts.every((p: any) => p.source), '每条提示词都带 source 出处标记');

// 预览图：大多数应有 image（外链）
const withImg = data.prompts.filter((p: any) => p.image).length;
assert(withImg / data.prompts.length > 0.8, `多数条目有预览图 URL (${withImg}/${data.prompts.length})`);

// 分类：不应全是「其他」
const cats = new Set(data.prompts.map((p: any) => p.category));
assert(cats.size >= 5, `分类数量合理 (${cats.size} 类)`);

// 作者是版权署名，不是站内社交账号：卡片只显示纯文本，不能加 @ 或做成外链。
const creativePage = readFileSync(resolve('website/src/pages/CreativeLibrary.tsx'), 'utf-8');
assert(!/\@\{p\.author\}/.test(creativePage), '作者名不带 @，避免误解为可提及账号');
assert(!/<a[^>]+href=\{p\.authorUrl/.test(creativePage), '作者署名只显示文本，不提供点击跳转');

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
