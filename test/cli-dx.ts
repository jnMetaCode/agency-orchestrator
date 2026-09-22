/**
 * CLI 的两条「第一次用就会撞上」的体验问题（真 CLI 子进程，在一个陌生目录里跑）：
 *  1. `ao <命令> --help` 以前会把 --help 当参数送进命令：`ao init --help` 真的下载 4MB 角色库、
 *     `ao demo --help` 在非 TTY 下自动选 provider 真跑一条工作流、`ao run --help` 报 ENOENT '--help'；
 *  2. README 里所有示例都写 `ao run workflows/xxx.yaml`，但全局安装后它相对 cwd 不存在——内置模板随包
 *     发布在安装目录，必须回退过去找；找不到 / 给了目录要说人话，不是 ENOENT / EISDIR。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; }
}
const cwd = mkdtempSync(join(tmpdir(), 'ao-cli-dx-'));
const CLI = resolve('dist/cli.js');
const ao = (...a: string[]) => {
  const r = spawnSync(process.execPath, [CLI, ...a], { cwd, encoding: 'utf-8', timeout: 60_000, env: { ...process.env, AO_NO_UPDATE_CHECK: '1' }, input: '' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};

console.log('\n─── <命令> --help 只打印用法，不执行 ───');
for (const cmd of ['init', 'demo', 'doctor', 'run', 'validate', 'plan', 'report']) {
  const r = ao(cmd, '--help');
  assert(r.code === 0 && /用法: ao /.test(r.out) && !/ENOENT|正在下载|检测到可用 LLM|执行中/.test(r.out), `ao ${cmd} --help（实际 code=${r.code}：${r.out.split('\n').find((l) => l.trim())?.slice(0, 70)}）`);
}
assert(!existsSync(join(cwd, 'agency-agents-zh')), 'init --help 没有往当前目录下载角色库');
assert(readdirSync(cwd).length === 0, '一圈 --help 下来当前目录没多出任何文件');

console.log('\n─── 内置模板在任何目录都能按 workflows/<名字>.yaml 找到 ───');
{
  const r = ao('validate', 'workflows/tech-blog.yaml');
  assert(r.code === 0 && /校验通过/.test(r.out), `cwd 里没有 workflows/ 也能验证内置模板（实际：${r.out.split('\n')[0]?.slice(0, 80)}）`);
  const r2 = ao('plan', './workflows/tech-blog.yaml');
  assert(r2.code === 0, '带 ./ 前缀同样可以');
}

console.log('\n─── 找不到 / 传了目录：人话 ───');
{
  const r = ao('validate', 'nope.yaml');
  assert(r.code === 1 && /找不到工作流文件: nope\.yaml/.test(r.out) && !/ENOENT/.test(r.out), `找不到：不再是 ENOENT（实际：${r.out.split('\n')[0]?.slice(0, 80)}）`);
  const r2 = ao('run', cwd);
  assert(r2.code === 1 && /是目录/.test(r2.out) && !/EISDIR/.test(r2.out), `目录：不再是 EISDIR（实际：${r2.out.split('\n')[0]?.slice(0, 80)}）`);
}

rmSync(cwd, { recursive: true, force: true });
console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed > 0 ? 1 : 0);
