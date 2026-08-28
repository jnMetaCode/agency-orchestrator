/**
 * 测试 skills（流程剧本）加载 + 注入。内容来自依赖 superpowers-zh。
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveSkillsDir, resolveSkillsDirs, listSkills, loadSkill, collectSkillNames, injectSkills, _resetSkillsDirCache,
} from '../src/skills/loader.js';

let passed = 0, failed = 0;
function assert(c: boolean, m: string): void { if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; } }

console.log('\n─── skills（流程剧本）───');

// 用一个临时 skill 目录(不依赖 superpowers-zh 是否在位)，通过 AO_SKILLS_DIR 指过去
const dir = mkdtempSync(join(tmpdir(), 'ao-skills-'));
mkdirSync(join(dir, 'tdd'));
writeFileSync(join(dir, 'tdd', 'SKILL.md'), `---
name: tdd
description: 测试驱动开发方法论
---
# TDD
先写测试，再写实现，红-绿-重构。
`, 'utf-8');
mkdirSync(join(dir, 'bad-name!'), { recursive: true }); // 非法名，应被忽略

process.env.AO_SKILLS_DIR = dir;
_resetSkillsDirCache();

assert(resolveSkillsDir() === dir, 'AO_SKILLS_DIR 解析生效');
assert(listSkills().some(s => s.name === 'tdd'), 'listSkills 列出 tdd');

const sk = loadSkill('tdd');
assert(sk !== null && sk!.description === '测试驱动开发方法论', 'loadSkill 解析 frontmatter');
assert(sk !== null && sk!.body.includes('红-绿-重构'), 'loadSkill 取到正文');
assert(loadSkill('不存在') === null, '缺失 skill 返回 null（不抛错）');
assert(loadSkill('../etc/passwd') === null, '非法名拒绝（防穿越）');

assert(JSON.stringify(collectSkillNames({ skill: 'a', skills: ['b', 'a'] })) === JSON.stringify(['a', 'b']), 'collectSkillNames 合并去重');

const inj = injectSkills('你是角色X。', ['tdd', '不存在']);
assert(inj.prompt.includes('你是角色X。') && inj.prompt.includes('红-绿-重构'), 'injectSkills 把方法论追加到 system prompt');
assert(inj.applied.includes('tdd') && inj.missing.includes('不存在'), 'injectSkills 报告 applied / missing');

const none = injectSkills('原样', []);
assert(none.prompt === '原样', '空 skills 不改 prompt');

// AO_SKILLS_DIR 是"覆盖"而不是"清空"：自带的 ao-skills 仍要在合并结果里
assert(listSkills().some(s => s.name === 'shortfilm-prompt'), 'AO_SKILLS_DIR 生效时，自带 ao-skills 仍被合并进来');

// 同名以靠前目录为准（AO_SKILLS_DIR 赢），否则列表显示的和实际注入的会是两份不同内容
mkdirSync(join(dir, 'shortfilm-prompt'));
writeFileSync(join(dir, 'shortfilm-prompt', 'SKILL.md'), `---
name: shortfilm-prompt
description: 用户自己的覆盖版
---
我的版本。
`, 'utf-8');
_resetSkillsDirCache();
assert(loadSkill('shortfilm-prompt')!.body === '我的版本。', '同名时 AO_SKILLS_DIR 覆盖自带版本');
assert(listSkills().filter(s => s.name === 'shortfilm-prompt').length === 1, '同名只出现一次，且是覆盖版');
assert(listSkills().find(s => s.name === 'shortfilm-prompt')!.description === '用户自己的覆盖版', 'listSkills 与 loadSkill 命中同一份');

// 还原
delete process.env.AO_SKILLS_DIR;
_resetSkillsDirCache();
// superpowers-zh 作为依赖应能解析到（CI 装了依赖）
const real = resolveSkillsDir();
assert(real === null || listSkills(real).length >= 0, '默认解析不抛错（有依赖则能列出）');

// ── 多目录合并。这条是回归钉子：loader 曾经是"第一个命中的目录赢"，
// 那时候只要在仓库根放一个 ./skills/ 或加一个自带目录，superpowers-zh 的 20 个 skill 就整个消失。
const dirs = resolveSkillsDirs();
assert(dirs.length >= 1, `至少解析出一个 skills 目录，实得 ${dirs.length}`);
assert(new Set(dirs).size === dirs.length, '目录列表已去重');
assert(dirs.some(d => d.endsWith('ao-skills')), '自带的 ao-skills 目录在解析结果里');

const bundled = loadSkill('shortfilm-prompt');
assert(bundled !== null, '自带 skill shortfilm-prompt 能加载到');
assert(bundled!.body.includes('5 段'), 'shortfilm-prompt 正文含 5 段式结构');
assert(!/AskUserQuestion|使用 `Read`/.test(bundled!.body), 'AO 版不得残留交互式指令（步骤里没有工具，会让模型去提问而不是出提示词）');

const merged = listSkills();
assert(merged.some(s => s.name === 'shortfilm-prompt'), '合并列表含自带 skill');
if (dirs.length > 1) {
  assert(merged.length > 1, `多目录时列表应含多来源的 skill，实得 ${merged.length}`);
  assert(merged.some(s => s.name !== 'shortfilm-prompt'), '自带目录没有把 superpowers-zh 顶掉');
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
