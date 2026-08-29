#!/usr/bin/env node
/**
 * 把 2MB 的扩充池 creative-prompts-extra.json 按分类切成小片（website/src/content/creative-extra/*.json + index.json）。
 * 为什么：/creative 是公开 SEO 页，访客大多只是来复制一条提示词——此前"再加载"一次拉全部 1282 条（gzip 后 ~640KB）；
 * 切片后点哪个分类只拉那一类（最大的「摄影 / 影视」317 条约 0.5MB，多数分类几十 KB）。
 * 产物是派生文件（gitignore），website 的 dev/build 前自动跑；源仍是那一个大 json（导入/去重/翻译脚本只动它）。
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = JSON.parse(readFileSync(join(root, 'website/src/content/creative-prompts-extra.json'), 'utf-8'));
const outDir = join(root, 'website/src/content/creative-extra');
rmSync(outDir, { recursive: true, force: true }); mkdirSync(outDir, { recursive: true });
const byCat = new Map();
for (const p of src.prompts) { const c = p.category || '其他'; if (!byCat.has(c)) byCat.set(c, []); byCat.get(c).push(p); }
const index = [];
let i = 0;
for (const [category, prompts] of [...byCat.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const file = `cat-${String(i++).padStart(2, '0')}.json`;   // 文件名不用分类中文，免得 URL 编码和大小写问题
  writeFileSync(join(outDir, file), JSON.stringify({ category, prompts }));
  index.push({ category, file, count: prompts.length });
}
writeFileSync(join(outDir, 'index.json'), JSON.stringify({ total: src.prompts.length, chunks: index }, null, 2) + '\n');
console.log(`扩充池 ${src.prompts.length} 条 → ${index.length} 片：${index.map((x) => `${x.category} ${x.count}`).join(' | ')}`);
