/**
 * 测试 AO 全局目录解析（issue #20）
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aoHome, defaultOutputDir, defaultWorkflowsDir } from '../src/utils/paths.js';
import { findAgentsDir } from '../src/index.js';

let passed = 0, failed = 0;
function assert(c: boolean, m: string): void { if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; } }

console.log('\n─── AO 全局目录 (#20) ───');

const save = { ...process.env };
function clear() { delete process.env.AO_HOME; delete process.env.AO_OUTPUT_DIR; delete process.env.AO_WORKFLOWS_DIR; }

clear();
assert(aoHome() === null, '无 env: aoHome=null（旧行为）');
assert(defaultOutputDir() === 'ao-output', '无 env: output 默认 ao-output（cwd 相对）');
assert(defaultWorkflowsDir('workflows') === 'workflows', '无 env: workflows 用 fallback');

process.env.AO_HOME = '/tmp/aohome';
assert(defaultOutputDir() === '/tmp/aohome/ao-output', 'AO_HOME: output 落到其下');
assert(defaultWorkflowsDir('workflows') === '/tmp/aohome/ao-workflows', 'AO_HOME: workflows 落到其下');

process.env.AO_OUTPUT_DIR = '/tmp/out';
process.env.AO_WORKFLOWS_DIR = '/tmp/wf';
assert(defaultOutputDir() === '/tmp/out', 'AO_OUTPUT_DIR 优先于 AO_HOME');
assert(defaultWorkflowsDir('workflows') === '/tmp/wf', 'AO_WORKFLOWS_DIR 优先于 AO_HOME');

// 还原环境
clear();
if (save.AO_HOME) process.env.AO_HOME = save.AO_HOME;

// ── AO_AGENTS_DIR 必须能顶掉工作流里写死的 agents_dir ──
// 帮助文案承诺"run/compose/roles/web 全局生效"，但内置模板与自动组队产物**都写了**
// `agents_dir:`；此前 run/validate/plan 走 findAgentsDir 不认这个变量，等于设了没用。
console.log('\n─── AO_AGENTS_DIR 优先级 ───');

const tmpRoles = mkdtempSync(join(tmpdir(), 'ao-agents-dir-'));
mkdirSync(join(tmpRoles, 'engineering'), { recursive: true });
writeFileSync(join(tmpRoles, 'engineering', 'dev.md'), '---\nname: Dev\n---\n\nYou are a dev.\n');
const savedAgentsDir = process.env.AO_AGENTS_DIR;

try {
  process.env.AO_AGENTS_DIR = tmpRoles;
  assert(findAgentsDir('agency-agents-zh', '/tmp/x.yaml') === tmpRoles,
    'AO_AGENTS_DIR 顶掉 YAML 里的 agents_dir（此前被无视）');

  process.env.AO_AGENTS_DIR = join(tmpRoles, '不存在的子目录');
  assert(findAgentsDir('agency-agents-zh', '/tmp/x.yaml') !== process.env.AO_AGENTS_DIR,
    '变量指向不存在的目录时不采用，继续常规查找');

  delete process.env.AO_AGENTS_DIR;
  const found = findAgentsDir(tmpRoles, '/tmp/x.yaml');
  assert(found === tmpRoles, '不设变量时按 YAML 的 agents_dir 解析（旧行为不变）');
} finally {
  if (savedAgentsDir === undefined) delete process.env.AO_AGENTS_DIR;
  else process.env.AO_AGENTS_DIR = savedAgentsDir;
  rmSync(tmpRoles, { recursive: true, force: true });
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
