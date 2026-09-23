/**
 * 测试 ao team — 团队 / Loadout 模块
 */
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  slugify,
  extractTeamFromWorkflow,
  serializeTeam,
  parseTeamFile,
  saveTeam,
  listTeams,
  loadTeamByRef,
  removeTeam,
} from '../src/cli/team.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}: ${err instanceof Error ? err.message : err}`);
    failed++;
  }
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg);
}

console.log('\n─── ao team (Loadout) ───');

const dir = mkdtempSync(join(tmpdir(), 'ao-teams-'));

// 造一个最小 workflow（含重复角色，验证去重）
const wfPath = join(dir, 'wf.yaml');
writeFileSync(wfPath, `name: "测试组"
description: "一个测试团队"
agents_dir: "agency-agents-zh"
llm:
  provider: deepseek
  model: deepseek-chat
steps:
  - id: a
    role: "engineering/engineering-senior-developer"
    name: "资深开发"
    emoji: "💻"
    task: "做点啥 {{topic}}"
    output: out_a
  - id: b
    role: "engineering/engineering-technical-writer"
    name: "技术作家"
    emoji: "✍️"
    task: "写点啥 {{out_a}}"
    output: out_b
    depends_on: [a]
  - id: c
    role: "engineering/engineering-senior-developer"
    name: "复用同一角色"
    task: "再做点啥 {{out_b}}"
    depends_on: [b]
`, 'utf-8');

await test('slugify 处理中文/空格/路径字符', () => {
  assert(slugify('自媒体 副业/组') === '自媒体-副业-组', `got ${slugify('自媒体 副业/组')}`);
  assert(slugify('  ') === 'team', 'empty → team');
});

await test('extractTeamFromWorkflow 去重并保序', () => {
  const tm = extractTeamFromWorkflow(wfPath);
  assert(tm.kind === 'team', 'kind=team');
  assert(tm.name === '测试组', `name got ${tm.name}`);
  assert(tm.roles.length === 2, `unique roles should be 2, got ${tm.roles.length}`);
  assert(tm.roles[0].role === 'engineering/engineering-senior-developer', 'first role preserved');
  assert(tm.roles[0].emoji === '💻', 'emoji carried');
  assert(tm.lang === 'zh', 'zh detected from agents_dir');
  assert(tm.provider === 'deepseek', 'provider carried');
});

await test('extractTeamFromWorkflow 支持 name/desc 覆盖', () => {
  const tm = extractTeamFromWorkflow(wfPath, { name: '自定义名', description: '自定义说明' });
  assert(tm.name === '自定义名', `got ${tm.name}`);
  assert(tm.description === '自定义说明', `got ${tm.description}`);
});

await test('serialize → parse 往返', () => {
  const tm = extractTeamFromWorkflow(wfPath);
  const yaml = serializeTeam(tm);
  assert(yaml.includes('kind: team'), 'has kind');
  assert(yaml.startsWith('#'), 'has header comment');
  const roundTrip = join(dir, 'rt.team.yaml');
  writeFileSync(roundTrip, yaml, 'utf-8');
  const parsed = parseTeamFile(roundTrip);
  assert(parsed.name === tm.name, 'name roundtrip');
  assert(parsed.roles.length === tm.roles.length, 'roles roundtrip');
});

await test('parseTeamFile 拒绝非团队文件', () => {
  let threw = false;
  try { parseTeamFile(wfPath); } catch { threw = true; }
  assert(threw, 'should reject workflow yaml (no kind: team)');
});

await test('save / list / loadByRef / remove 全链路', () => {
  const tm = extractTeamFromWorkflow(wfPath, { name: '保存测试组' });
  const saved = saveTeam(tm, dir);
  assert(existsSync(saved), 'file written');
  assert(saved.endsWith('保存测试组.team.yaml'), `slug filename got ${saved}`);

  const all = listTeams(dir);
  assert(all.some(t => t.team.name === '保存测试组'), 'appears in list');

  const byName = loadTeamByRef('保存测试组', dir);
  assert(byName.roles.length === 2, 'load by name');
  const bySlug = loadTeamByRef(slugify('保存测试组'), dir);
  assert(bySlug.name === '保存测试组', 'load by slug');
  const byPath = loadTeamByRef(saved, dir);
  assert(byPath.name === '保存测试组', 'load by path');

  const removed = removeTeam('保存测试组', dir);
  assert(removed !== null, 'removed');
  assert(!existsSync(saved), 'file gone');
});

await test('loadTeamByRef 找不到时抛错', () => {
  let threw = false;
  try { loadTeamByRef('不存在的团队xyz', dir); } catch { threw = true; }
  assert(threw, 'should throw for missing team');
});

// ── 锁定阵容对不上当前角色库 ──
// 团队存的是中文角色、却用 --lang en 跑（或角色库改过名）时，以前 `filtered.length > 0` 不成立就
// **静默退回整库**——"锁定阵容"的承诺当场作废，用户还以为跑的是自己那套人。
await test('锁定阵容一个都不在当前角色库 → 报错，而不是悄悄退回整库', async () => {
  const { composeWorkflow } = await import('../src/cli/compose.js');
  const agentsDir = resolve('node_modules/agency-agents-zh');
  let msg = '';
  try {
    await composeWorkflow({
      description: '随便什么任务',
      agentsDir,
      llmConfig: { provider: 'deepseek', model: 'm', api_key: 'k' } as never,
      pinnedRoles: ['nope/not-a-role', 'also/missing'],
      saveDir: mkdtempSync(join(tmpdir(), 'ao-team-pin-')),
    });
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e);
  }
  assert(/一个都不在当前角色库/.test(msg), `一个都对不上要报错，而不是悄悄用整库（实际：${msg.slice(0, 120)}）`);
  assert(/nope\/not-a-role/.test(msg) && /ao roles/.test(msg), '报错点名缺的角色并给出路');
});

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);

