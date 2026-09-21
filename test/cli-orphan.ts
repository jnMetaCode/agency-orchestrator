/**
 * 引擎退出时带走还在跑的 CLI 子进程。
 *
 * 真实故障（真机复现过）：Studio 里点「停止」/ 关掉页面 / 终端 Ctrl-C → `ao run` 存档后 process.exit，
 * 但它拉起的 `claude -p` **不会跟着死**，会把这一步跑完（最长十分钟），白烧订阅额度，而用户以为已经停了。
 * 只能用真进程测：进程内造不出「父进程没了、孙进程还在」这件事。
 */
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };

if (process.platform === 'win32') {
  console.log('  ⏭️  Windows 跳过（假 CLI 用 shebang 脚本）');
  process.exit(0);
}

console.log('\n─── 引擎被终止时，CLI 子进程一起停 ───');
const dir = mkdtempSync(join(tmpdir(), 'ao-cli-orphan-'));
let fakePid = 0;
try {
  mkdirSync(join(dir, 'bin'));
  const pidFile = join(dir, 'fake.pid');
  writeFileSync(join(dir, 'bin', 'claude'), `#!/usr/bin/env node
require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
process.stdin.resume();
setTimeout(() => process.exit(0), 60000);   // 模拟一个要跑很久的步骤
`);
  chmodSync(join(dir, 'bin', 'claude'), 0o755);
  const wf = join(dir, 'wf.yaml');
  writeFileSync(wf, [
    'name: "orphan"', 'agents_dir: "agency-agents-zh"', 'verify: false', 'llm: { provider: "claude-code" }',
    'steps:', '  - id: only', '    role: "marketing/marketing-content-creator"', '    task: "说一句话"', '    output: out', '',
  ].join('\n'), 'utf-8');

  const ao = spawn(process.execPath, [resolve('dist/cli.js'), 'run', wf, '--output', join(dir, 'out')], {
    stdio: 'ignore',
    env: { ...process.env, PATH: `${join(dir, 'bin')}${delimiter}${process.env.PATH}`, AO_NO_UPDATE_CHECK: '1' },
  });
  for (let i = 0; i < 80 && !existsSync(pidFile); i++) await sleep(250);
  assert(existsSync(pidFile), '假 claude 被拉起来了');
  fakePid = Number(readFileSync(pidFile, 'utf-8'));
  assert(alive(fakePid), '此刻它在跑');

  ao.kill('SIGTERM');                                  // = Studio 点「停止」
  await new Promise((r) => ao.once('exit', r));
  let gone = false;
  for (let i = 0; i < 20 && !gone; i++) { await sleep(250); gone = !alive(fakePid); }
  assert(gone, '引擎退出后 5 秒内，CLI 子进程也没了（修复前它会继续跑满 60 秒）');
  const saved = existsSync(join(dir, 'out'));
  assert(saved, '中断存档照常（先杀子进程不该妨碍落盘）');
} catch (e) {
  assert(false, `异常: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  if (fakePid && alive(fakePid)) { try { process.kill(fakePid, 'SIGKILL'); } catch { /* gone */ } }
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed > 0 ? 1 : 0);
