#!/usr/bin/env node
// 给创意库扩充池补中文标题/描述。
//
// 为什么要做：扩充池那 1349 条来自英文源（trending 的推文、YouMind 的英文策展），
// 标题与描述全是英文。中文用户在搜索框里打「咖啡」「手表」「证件照」一条都搜不到——
// 分类 chips 是中文的所以能翻，但**搜索等于废了**。提示词正文必须保持英文（模型吃的是它），
// 但标题与描述是给人看的，该translate。
//
// 怎么做：本机 claude CLI（订阅制，不烧 API 余额）批量翻，严格 JSON 进 JSON 出。
// **可断点续跑**：已经有 titleZh 的条目直接跳过，中途挂了重跑即可。
//
// 用法：
//   node scripts/translate-extra-titles.mjs            # 全量补图片扩充池
//   node scripts/translate-extra-titles.mjs website/src/content/video-prompts-community.json
//   BATCH=40 LIMIT=200 node scripts/translate-extra-titles.mjs   # 小批试跑
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// 默认补图片扩充池；传路径可复用到别的池（视频社区池的标题也是英文的）
const FILE = process.argv[2]
  ? resolve(process.argv[2])
  : join(resolve(__dirname, '..'), 'website', 'src', 'content', 'creative-prompts-extra.json');
const BATCH = Number(process.env.BATCH || 40);
const LIMIT = Number(process.env.LIMIT || 0);   // 0 = 不限

const data = JSON.parse(readFileSync(FILE, 'utf-8'));
// 两种池的数组字段名不同：图片池是 prompts，视频池是 templates
const list = data.prompts ?? data.templates ?? [];
const todo = list.filter((p) => !p.titleZh);
if (todo.length === 0) { console.log('✅ 全部已有中文标题，无需翻译'); process.exit(0); }
const work = LIMIT ? todo.slice(0, LIMIT) : todo;
console.log(`待翻译 ${work.length} 条（总 ${list.length}，已完成 ${list.length - todo.length}）· ${FILE.split('/').pop()}`);

/** 调本机 claude CLI（headless）。返回纯文本 stdout。 */
function claude(prompt) {
  return new Promise((ok, fail) => {
    const child = spawn('claude', ['-p', '-', '--output-format', 'text', '--tools', '', '--effort', 'low'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => fail(new Error(`起不来 claude CLI：${e.message}（本机没装或没登录？）`)));
    child.on('close', (code) => (code === 0 ? ok(out) : fail(new Error(`claude 退出码 ${code}：${err.slice(0, 300)}`))));
    child.stdin.end(prompt);
  });
}

/** 从模型输出里挖出 JSON 数组（它偶尔会加围栏或前言）。 */
function parseArray(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end < 0) throw new Error(`输出里没有 JSON 数组：${text.slice(0, 200)}`);
  return JSON.parse(raw.slice(start, end + 1));
}

let done = 0, failed = 0;
for (let i = 0; i < work.length; i += BATCH) {
  const chunk = work.slice(i, i + BATCH);
  const payload = chunk.map((p, n) => ({ n, title: p.title, desc: (p.description || '').slice(0, 160) }));
  const prompt = [
    '把下面这批 AI 图像提示词的**标题与描述**翻译成简体中文，供中文用户浏览与搜索。',
    '规则：',
    '1. 只翻标题(title)和描述(desc)，不要翻译或改写提示词正文（这里也没给你正文）',
    '2. 标题控制在 20 个汉字以内，去掉 "8K/Ultra-realistic/hyper-realistic" 这类堆砌的质量词，保留题材与主体',
    '3. 专有名词（Nano Banana、Midjourney、Sora 等）保留原文',
    '4. desc 为空就返回空字符串，不要自己编',
    '5. **只输出 JSON 数组**，元素形如 {"n":0,"titleZh":"...","descZh":"..."}，n 原样返回，不要任何解释',
    '',
    JSON.stringify(payload, null, 0),
  ].join('\n');

  try {
    const arr = parseArray(await claude(prompt));
    let hit = 0;
    for (const r of arr) {
      const target = chunk[Number(r.n)];
      if (!target || !r.titleZh) continue;
      target.titleZh = String(r.titleZh).trim().slice(0, 40);
      if (r.descZh) target.descZh = String(r.descZh).trim().slice(0, 120);
      hit++;
    }
    done += hit;
    // 每批落盘：中途挂了也不白跑
    writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    console.log(`  批 ${Math.floor(i / BATCH) + 1}：${hit}/${chunk.length} 条已译（累计 ${done}）`);
  } catch (e) {
    failed += chunk.length;
    console.log(`  批 ${Math.floor(i / BATCH) + 1} 失败：${e.message.slice(0, 160)}`);
  }
}

console.log(`\n✅ 完成 ${done} 条${failed ? `，失败 ${failed} 条（重跑本脚本会只补没译的）` : ''}`);
