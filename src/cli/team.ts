/**
 * ao team — 团队 / Loadout（可复用、可分享的角色阵容）
 *
 * 一个「团队」= 一组固定的角色 + 元数据，与具体任务解耦。
 * 它和 workflow 的区别：workflow 绑定一组角色 *和* 一个具体任务；
 * team 只保存角色阵容，可以套到任意新需求上（`ao run --team <名字> "新任务"`）。
 *
 * 落地依赖现成机器：`composeWorkflow({ pinnedRoles })` 已支持把角色目录锁成
 * 指定阵容——所以 `ao run --team` 本质 = compose 时把 267 个角色收窄成团队那几个。
 *
 * 存储：默认 ~/.ao/teams/<slug>.team.yaml（全局、跨项目可复用、可直接拷贝分享）。
 * 也接受文件路径（`--team ./path.team.yaml`）。
 */
import { homedir } from 'node:os';
import { join, resolve, basename, isAbsolute } from 'node:path';
import { clipBytes } from '../utils/paths.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import yaml from 'js-yaml';
import { parseWorkflow } from '../core/parser.js';

export interface TeamRole {
  role: string;       // 角色路径，如 "marketing/growth-hacker"
  name?: string;      // 展示名（沿用 workflow step 的自定义 name）
  emoji?: string;
  note?: string;      // 可选备注：这个角色在团队里干嘛
}

export interface TeamDefinition {
  kind: 'team';
  name: string;
  description?: string;
  roles: TeamRole[];
  lang?: 'zh' | 'en';     // 角色库语言（决定 agentsDir）
  provider?: string;      // 可选默认 provider
  model?: string;
  created?: string;       // YYYY-MM-DD
  source?: string;        // 来源 workflow 文件名（溯源用）
}

/** 团队文件存放目录：默认 ~/.ao/teams，可用 AO_TEAMS_DIR 覆盖。 */
export function teamsDir(): string {
  return process.env.AO_TEAMS_DIR
    ? resolve(process.env.AO_TEAMS_DIR)
    : join(homedir(), '.ao', 'teams');
}

/** 把团队名转成安全的文件名 slug（保留中文，去掉路径敏感字符）。 */
export function slugify(name: string): string {
  const s = name
    .trim()
    .replace(/[\s/\\:*?"<>|]+/g, '-')   // 路径/空白 → 连字符
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  // 再按**字节**截断：这是要当文件名用的（<slug>.team.yaml），而 Linux 的 NAME_MAX 是
  // 255 字节——一个 86 字的中文团队名就会让保存抛 ENAMETOOLONG（macOS 按字符算，本机试不出来）
  return clipBytes(s, 120).replace(/-+$/, '') || 'team';
}

/** 从一个 workflow 中抽取团队（去重角色，保序，剥掉任务/inputs）。 */
export function extractTeamFromWorkflow(
  workflowPath: string,
  opts?: { name?: string; description?: string },
): TeamDefinition {
  const wf = parseWorkflow(workflowPath);
  const seen = new Set<string>();
  const roles: TeamRole[] = [];
  for (const s of wf.steps) {
    if (!s.role || seen.has(s.role)) continue;
    seen.add(s.role);
    const r: TeamRole = { role: s.role };
    if (s.name) r.name = s.name;
    if (s.emoji) r.emoji = s.emoji;
    roles.push(r);
  }
  if (roles.length === 0) {
    throw new Error(`workflow "${basename(workflowPath)}" 里没有可用角色，无法抽取团队`);
  }
  return {
    kind: 'team',
    name: opts?.name || wf.name,
    description: opts?.description ?? wf.description,
    roles,
    lang: /agency-agents-zh|-zh\b/.test(wf.agents_dir || '') ? 'zh' : 'en',
    provider: wf.llm?.provider,
    model: wf.llm?.model || undefined,
    created: new Date().toISOString().slice(0, 10),
    source: basename(workflowPath),
  };
}

/** 序列化为带头注释的 YAML 文本。 */
export function serializeTeam(team: TeamDefinition): string {
  const body = yaml.dump(team, { lineWidth: 120, noRefs: true });
  return `# ao team / Loadout — 可复用角色阵容\n# 用法: ao run --team ${slugify(team.name)} "你的新任务"\n${body}`;
}

/** 解析团队文件（校验 kind 与 roles）。 */
export function parseTeamFile(filePath: string): TeamDefinition {
  const doc = yaml.load(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  if (!doc || typeof doc !== 'object') {
    throw new Error(`团队文件解析失败: ${filePath}`);
  }
  if (doc.kind !== 'team') {
    throw new Error(`不是团队文件（缺 kind: team）: ${filePath}`);
  }
  const roles = doc.roles;
  if (!Array.isArray(roles) || roles.length === 0) {
    throw new Error(`团队文件缺少 roles: ${filePath}`);
  }
  return doc as unknown as TeamDefinition;
}

/** 保存团队到 teamsDir，返回写入路径（同名覆盖）。 */
export function saveTeam(team: TeamDefinition, dir = teamsDir()): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, `${slugify(team.name)}.team.yaml`);
  writeFileSync(path, serializeTeam(team), 'utf-8');
  return path;
}

/** 列出所有已保存团队。 */
export function listTeams(dir = teamsDir()): { file: string; team: TeamDefinition }[] {
  if (!existsSync(dir)) return [];
  const out: { file: string; team: TeamDefinition }[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.team.yaml')) continue;
    try {
      out.push({ file: join(dir, f), team: parseTeamFile(join(dir, f)) });
    } catch {
      // 跳过损坏文件
    }
  }
  return out;
}

/**
 * 按引用加载团队。ref 可以是：
 *   - 文件路径（含 / 或 \ 或 .yaml 后缀，且存在）
 *   - 团队名 / slug（在 teamsDir 里查找 <slug>.team.yaml，再按 name 兜底）
 */
export function loadTeamByRef(ref: string, dir = teamsDir()): TeamDefinition {
  // 1. 当作路径
  const looksLikePath = ref.includes('/') || ref.includes('\\') || ref.endsWith('.yaml');
  if (looksLikePath) {
    const p = isAbsolute(ref) ? ref : resolve(ref);
    if (existsSync(p)) return parseTeamFile(p);
  }
  // 2. teamsDir 里按 slug 文件名
  const bySlug = join(dir, `${slugify(ref)}.team.yaml`);
  if (existsSync(bySlug)) return parseTeamFile(bySlug);
  // 3. 按 name 精确匹配兜底
  const hit = listTeams(dir).find(t => t.team.name === ref || slugify(t.team.name) === slugify(ref));
  if (hit) return hit.team;
  throw new Error(`找不到团队 "${ref}"。用 \`ao team list\` 查看已保存的团队。`);
}

/** 删除团队，返回是否删除成功。 */
export function removeTeam(ref: string, dir = teamsDir()): string | null {
  const bySlug = join(dir, `${slugify(ref)}.team.yaml`);
  if (existsSync(bySlug)) { unlinkSync(bySlug); return bySlug; }
  const hit = listTeams(dir).find(t => t.team.name === ref || slugify(t.team.name) === slugify(ref));
  if (hit) { unlinkSync(hit.file); return hit.file; }
  return null;
}
