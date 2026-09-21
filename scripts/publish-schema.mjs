#!/usr/bin/env node
// 把 schemas/*.json 复制进 website/public/schemas/（gitignore），随官网构建发布到
// https://ao.aiolaola.com/schemas/ —— 编辑器里 `# yaml-language-server: $schema=…` 指的就是这个地址。
// 源文件只有 schemas/ 这一份；由 website 的 predev / prebuild 自动跑。
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'schemas');
const dst = join(root, 'website', 'public', 'schemas');
if (!existsSync(src)) process.exit(0);
mkdirSync(dst, { recursive: true });
const files = readdirSync(src).filter((f) => f.endsWith('.json'));
for (const f of files) cpSync(join(src, f), join(dst, f));
console.log(`✅ schema → website/public/schemas/（${files.length} 个）`);
