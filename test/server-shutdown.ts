/**
 * 引擎退出时要带走它 spawn 出去的 `ao run`。
 *
 * 真实故障：桌面版退出只 SIGTERM 了 web/server.js，而 POSIX 不会因为父进程死了就杀子进程——
 * 用户关掉 App，`ao run` 还在轮询**按秒计费**的视频任务、把片子下载到一个没人看的运行目录里，
 * 直到十分钟超时；下次开 App 又来一批。只能用真进程测：进程内造不出「父没了、孙还在」。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
const freePort = () => new Promise<number>((res) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); });
});

if (process.platform === 'win32') {
  console.log('  ⏭️  Windows 跳过（假 CLI 用 shebang 脚本）');
  process.exit(0);
}

console.log('\n─── 引擎被终止时，它 spawn 的 ao run 一起走 ───');
const dir = mkdtempSync(join(tmpdir(), 'ao-shutdown-'));
let server: ChildProcess | null = null;
let enginePid = 0;
try {
  // 假 claude：把自己的 pid 写下来，然后长时间不退（模拟正在跑的付费步骤）
  mkdirSync(join(dir, 'bin'));
  const pidFile = join(dir, 'fake.pid');
  writeFileSync(join(dir, 'bin', 'claude'), `#!/usr/bin/env node
require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
process.stdin.resume();
setTimeout(() => process.exit(0), 60000);
`);
  chmodSync(join(dir, 'bin', 'claude'), 0o755);
  mkdirSync(join(dir, 'ao-workflows'), { recursive: true });
  const wf = join(dir, 'ao-workflows', 'w.yaml');
  writeFileSync(wf, [
    'name: "shutdown"', `agents_dir: "${resolve('node_modules/agency-agents-zh')}"`, 'verify: false',
    'llm: { provider: "claude-code" }',
    'steps:', '  - id: only', '    role: "marketing/marketing-content-creator"', '    task: "说一句"', '    output: out', '',
  ].join('\n'), 'utf-8');

  const port = await freePort();
  server = spawn(process.execPath, [resolve('web/server.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', AO_NODE: process.execPath, AO_DATA_DIR: dir,
           PATH: `${join(dir, 'bin')}${delimiter}${process.env.PATH}`, AO_MANIFEST_URL: 'http://127.0.0.1:1/none.json' },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base + '/api/health')).ok) { up = true; break; } } catch { /* not up */ }
    await sleep(250);
  }
  assert(up, '服务启动');

  // 发起一次运行（SSE），不等它结束
  const ctrl = new AbortController();
  void fetch(base + '/api/run', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file: wf, provider: 'claude-code' }), signal: ctrl.signal,
  }).catch(() => undefined);

  for (let i = 0; i < 80 && !existsSync(pidFile); i++) await sleep(250);
  assert(existsSync(pidFile), '引擎起来了，假 claude 也被拉起来了');
  enginePid = Number(readFileSync(pidFile, 'utf-8'));
  assert(alive(enginePid), '此刻它在跑');

  server.kill('SIGTERM');                       // = 桌面版退出
  await new Promise((r) => server!.once('exit', r));
  let gone = false;
  for (let i = 0; i < 24 && !gone; i++) { await sleep(250); gone = !alive(enginePid); }
  assert(gone, '引擎进程退出后 6 秒内，它 spawn 的 CLI 也没了（修复前会一直跑到 60 秒）');
} catch (e) {
  assert(false, `异常: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  try { server?.kill('SIGKILL'); } catch { /* gone */ }
  if (enginePid && alive(enginePid)) { try { process.kill(enginePid, 'SIGKILL'); } catch { /* gone */ } }
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed > 0 ? 1 : 0);
