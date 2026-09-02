/**
 * ao install 核心逻辑测试：collectRoleFiles（识别真角色、跳过非角色/示例）+ installRoles（写入目标）。
 */
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectRoleFiles, installRoles, INSTALL_TARGETS } from '../src/cli/install.js';

let passed = 0, failed = 0;
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (err) { console.log(`  ❌ ${name}: ${err instanceof Error ? err.message : err}`); failed++; }
}
function assert(c: boolean, m: string): void { if (!c) throw new Error(m); }

console.log('\n─── ao install 核心 ───');

// 造一个临时角色库：engineering/ 2 个真角色 + 1 个无 frontmatter 的 + README + examples/
const src = mkdtempSync(join(tmpdir(), 'ao-install-src-'));
mkdirSync(join(src, 'engineering'), { recursive: true });
mkdirSync(join(src, 'design'), { recursive: true });
mkdirSync(join(src, 'examples'), { recursive: true });
const role = (name: string) => `---\nname: ${name}\ndescription: 测试角色 ${name}\n---\n\n你是 ${name}。`;
writeFileSync(join(src, 'engineering', 'coder.md'), role('Coder'));
writeFileSync(join(src, 'engineering', 'reviewer.md'), role('Reviewer'));
writeFileSync(join(src, 'engineering', 'notes.md'), '# 没有 frontmatter 的普通文档');
writeFileSync(join(src, 'design', 'ux.md'), role('UX'));
writeFileSync(join(src, 'README.md'), '# 角色库');
writeFileSync(join(src, 'examples', 'demo.md'), role('Demo')); // examples 应被跳过

test('collectRoleFiles 只收真角色，跳过 README/无 frontmatter/examples', () => {
  const roles = collectRoleFiles(src);
  const paths = roles.map((r) => r.rolePath).sort();
  assert(paths.length === 3, `应 3 个角色, 实际 ${paths.length}: ${paths.join(',')}`);
  assert(paths.includes('engineering/coder') && paths.includes('engineering/reviewer') && paths.includes('design/ux'), `路径不对: ${paths.join(',')}`);
  assert(!paths.some((p) => p.includes('notes') || p.includes('demo') || p.includes('README')), '不应含非角色');
});

test('installRoles 写入目标目录(claude-code .md, 文件名 category-id)', () => {
  const dest = mkdtempSync(join(tmpdir(), 'ao-install-dest-'));
  const res = installRoles(src, INSTALL_TARGETS['claude-code'], { home: dest, cwd: dest });
  assert(res.installed === 3, `应装 3 个, 实际 ${res.installed}`);
  const agentsDir = join(dest, '.claude', 'agents');
  const files = readdirSync(agentsDir).sort();
  assert(files.includes('engineering-coder.md') && files.includes('design-ux.md'), `文件名不对: ${files.join(',')}`);
  rmSync(dest, { recursive: true, force: true });
});

test('cursor 目标用 .mdc 扩展名 + 项目级目录', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ao-install-proj-'));
  const res = installRoles(src, INSTALL_TARGETS['cursor'], { home: '/nonexistent', cwd });
  const dir = join(cwd, '.cursor', 'rules');
  assert(existsSync(join(dir, 'engineering-coder.mdc')), 'cursor 应写 .mdc');
  assert(res.destDir === dir, `destDir 应是项目级 .cursor/rules, 实际 ${res.destDir}`);
  rmSync(cwd, { recursive: true, force: true });
});

test('workbuddy / codebuddy 目标：用户级 agents 目录，与 claude-code 同格式', () => {
  const dest = mkdtempSync(join(tmpdir(), 'ao-install-wb-'));
  const wb = installRoles(src, INSTALL_TARGETS['workbuddy'], { home: dest, cwd: dest });
  assert(wb.destDir === join(dest, '.workbuddy', 'agents'), `workbuddy 应写 ~/.workbuddy/agents, 实际 ${wb.destDir}`);
  assert(existsSync(join(wb.destDir, 'engineering-coder.md')), 'workbuddy 应写 .md');
  const saved = process.env.CODEBUDDY_CONFIG_DIR;
  delete process.env.CODEBUDDY_CONFIG_DIR;
  try {
    const cb = installRoles(src, INSTALL_TARGETS['codebuddy'], { home: dest, cwd: dest, dryRun: true });
    assert(cb.destDir === join(dest, '.codebuddy', 'agents'), `codebuddy 应写 ~/.codebuddy/agents, 实际 ${cb.destDir}`);
    process.env.CODEBUDDY_CONFIG_DIR = join(dest, 'custom-cb');
    const cb2 = installRoles(src, INSTALL_TARGETS['codebuddy'], { home: dest, cwd: dest, dryRun: true });
    assert(cb2.destDir === join(dest, 'custom-cb', 'agents'), `codebuddy 应尊重 CODEBUDDY_CONFIG_DIR, 实际 ${cb2.destDir}`);
  } finally {
    if (saved === undefined) delete process.env.CODEBUDDY_CONFIG_DIR; else process.env.CODEBUDDY_CONFIG_DIR = saved;
  }
  rmSync(dest, { recursive: true, force: true });
});

test('--category 过滤 + dry-run 不写文件', () => {
  const dest = mkdtempSync(join(tmpdir(), 'ao-install-dry-'));
  const res = installRoles(src, INSTALL_TARGETS['claude-code'], { home: dest, cwd: dest, category: 'design', dryRun: true });
  assert(res.installed === 1, `design 分类应 1 个, 实际 ${res.installed}`);
  assert(!existsSync(join(dest, '.claude')), 'dry-run 不应写入');
  rmSync(dest, { recursive: true, force: true });
});

test('嵌套分类同名角色不互相覆盖(用完整路径拍平)', () => {
  const s = mkdtempSync(join(tmpdir(), 'ao-install-nest-'));
  mkdirSync(join(s, 'game', 'unity'), { recursive: true });
  mkdirSync(join(s, 'game', 'godot'), { recursive: true });
  const role = (n: string) => `---\nname: ${n}\ndescription: d\n---\n\n${n}`;
  writeFileSync(join(s, 'game', 'unity', 'dev.md'), role('UnityDev'));
  writeFileSync(join(s, 'game', 'godot', 'dev.md'), role('GodotDev'));
  const dest = mkdtempSync(join(tmpdir(), 'ao-install-nest-dest-'));
  const res = installRoles(s, INSTALL_TARGETS['claude-code'], { home: dest, cwd: dest });
  assert(res.installed === 2, `两个嵌套同名 dev 应都装上, 实际 ${res.installed}`);
  const files = readdirSync(join(dest, '.claude', 'agents')).sort();
  assert(files.length === 2, `应 2 个不重名文件, 实际 ${files.join(',')}`);
  rmSync(s, { recursive: true, force: true });
  rmSync(dest, { recursive: true, force: true });
});

rmSync(src, { recursive: true, force: true });

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
