/**
 * Skills（流程剧本）—— 给工作流步骤挂一套「怎么做」的方法论，注入该步的 system prompt。
 *
 * 内容主要用开源的 superpowers-zh（MIT，20 个 skill），不自己写。
 * 每个 skill = <skillsDir>/<name>/SKILL.md（frontmatter: name/description + 正文方法论）。
 *
 * **多目录、按名合并**（不是"第一个目录赢"）：
 *   1. AO_SKILLS_DIR（用户覆盖，同名优先级最高）
 *   2. ./skills > ./superpowers-zh/skills > ../superpowers-zh/skills > node_modules/superpowers-zh/skills
 *   3. 本包自带的 ao-skills/（AO 自己写的方法论，如 shortfilm-prompt）
 *
 * 为什么必须是合并而不是单目录：单目录时只要在仓库根放一个 ./skills/，就会把 superpowers-zh
 * 的 20 个 skill 整个顶掉——AO 想自带一个 skill，代价是弄丢全部现成的。同名时前面的目录赢，
 * 所以 AO_SKILLS_DIR 依然是"覆盖"语义，只是不再连带把别的目录一起清空。
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SkillDefinition {
  name: string;
  description: string;
  body: string;       // SKILL.md frontmatter 之后的方法论正文
}

let _cachedDirs: string[] | undefined;

/** AO 自带的 skill 目录（随包分发，dist/skills → 包根 ao-skills/；源码跑 tsx 时同一表达式也成立）。 */
function bundledSkillsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'ao-skills');
}

/** 解析全部 skills 目录，按优先级排序（缓存）。都找不到返回空数组（skills 是可选增强，不报错）。 */
export function resolveSkillsDirs(): string[] {
  if (_cachedDirs !== undefined) return _cachedDirs;
  const scriptDir = dirname(fileURLToPath(import.meta.url)); // dist/skills
  const candidates = [
    process.env.AO_SKILLS_DIR,
    './skills',
    './superpowers-zh/skills',
    '../superpowers-zh/skills',
    './node_modules/superpowers-zh/skills',
    join(scriptDir, '..', '..', 'node_modules', 'superpowers-zh', 'skills'),   // 包自身 node_modules
    join(scriptDir, '..', '..', '..', 'node_modules', 'superpowers-zh', 'skills'), // hoisted
    join(scriptDir, '..', '..', '..', 'superpowers-zh', 'skills'),             // sibling clone
    bundledSkillsDir(),
  ].filter(Boolean) as string[];
  const out: string[] = [];
  for (const c of candidates) {
    const full = resolve(c);
    if (existsSync(full) && !out.includes(full)) out.push(full);
  }
  _cachedDirs = out;
  return out;
}

/**
 * 解析首个 skills 目录。保留给 `ao skills` 的"目录在哪"提示与既有调用方；
 * 查找 skill 请用 resolveSkillsDirs()——只看第一个目录会漏掉自带的 ao-skills。
 */
export function resolveSkillsDir(): string | null {
  return resolveSkillsDirs()[0] ?? null;
}

/** 仅供测试：重置目录缓存。 */
export function _resetSkillsDirCache(): void { _cachedDirs = undefined; }

function parseSkillFile(content: string, name: string): SkillDefinition {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!m) return { name, description: '', body: content.trim() };
  const fm: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0 && /^[a-zA-Z_]+$/.test(line.slice(0, i).trim())) {
      fm[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  return { name: fm.name || name, description: fm.description || '', body: m[2].trim() };
}

/**
 * 加载一个 skill；找不到返回 null（不抛错）。
 * 不传 dir = 按优先级扫全部目录，先命中先返回；传了 dir 就只看那一个（测试与显式指定用）。
 */
export function loadSkill(name: string, dir?: string | null): SkillDefinition | null {
  // 防路径穿越
  if (/[^a-zA-Z0-9_-]/.test(name)) return null;
  const dirs = dir === undefined ? resolveSkillsDirs() : (dir ? [dir] : []);
  for (const d of dirs) {
    const file = join(d, name, 'SKILL.md');
    if (!existsSync(file)) continue;
    try { return parseSkillFile(readFileSync(file, 'utf-8'), name); } catch { /* 下一个目录 */ }
  }
  return null;
}

/** 列出一个目录里的 skill。 */
function listSkillsIn(dir: string): SkillDefinition[] {
  if (!existsSync(dir)) return [];
  const out: SkillDefinition[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const skillFile = join(dir, entry, 'SKILL.md');
    try {
      if (statSync(join(dir, entry)).isDirectory() && existsSync(skillFile)) {
        out.push(parseSkillFile(readFileSync(skillFile, 'utf-8'), entry));
      }
    } catch { /* skip */ }
  }
  return out;
}

/**
 * 列出所有可用 skill。不传 dir = 跨全部目录合并，**同名以靠前的目录为准**
 * （与 loadSkill 的命中顺序一致，否则列表里显示的和实际注入的会是两份不同内容）。
 */
export function listSkills(dir?: string | null): SkillDefinition[] {
  const dirs = dir === undefined ? resolveSkillsDirs() : (dir ? [dir] : []);
  const seen = new Map<string, SkillDefinition>();
  for (const d of dirs) {
    for (const sk of listSkillsIn(d)) if (!seen.has(sk.name)) seen.set(sk.name, sk);
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** 把 step 的 skill / skills 字段归一成名字数组。 */
export function collectSkillNames(step: { skill?: string; skills?: string[] }): string[] {
  const out: string[] = [];
  if (step.skill) out.push(step.skill);
  if (Array.isArray(step.skills)) out.push(...step.skills);
  return [...new Set(out.filter(Boolean))];
}

/**
 * 把指定 skill 的方法论追加到 system prompt 末尾。找不到的 skill 跳过（返回 missing 名单）。
 * 不抛错——skills 是可选增强。
 */
export function injectSkills(systemPrompt: string, names: string[], dir?: string | null): { prompt: string; applied: string[]; missing: string[] } {
  const applied: string[] = [];
  const missing: string[] = [];
  const blocks: string[] = [];
  for (const n of names) {
    const sk = loadSkill(n, dir);
    if (!sk) { missing.push(n); continue; }
    applied.push(sk.name);
    blocks.push(`## 工作方法 / Skill：${sk.name}\n（完成本步骤时请严格遵循以下方法论）\n\n${sk.body}`);
  }
  if (!blocks.length) return { prompt: systemPrompt, applied, missing };
  const prompt = `${systemPrompt}\n\n---\n\n${blocks.join('\n\n---\n\n')}`;
  return { prompt, applied, missing };
}
