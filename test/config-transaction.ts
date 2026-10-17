import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync, statSync, utimesSync, symlinkSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { withConfigTransaction } from '../src/utils/config-transaction.js';

let passed = 0, failed = 0;
function assert(ok: boolean, message: string): void {
  if (ok) { passed++; console.log(`  ✅ ${message}`); }
  else { failed++; console.log(`  ❌ ${message}`); }
}
const root = mkdtempSync(join(tmpdir(), 'ao-config-transaction-'));
const moduleUrl = pathToFileURL(resolve('src/utils/config-transaction.ts')).href;
const worker = (directory: string, script: string) => spawnSync(process.execPath,
  ['--import', 'tsx', '--input-type=module', '-e', `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    import { join } from 'node:path';
    import { withConfigTransaction } from ${JSON.stringify(moduleUrl)};
    const dir = ${JSON.stringify(directory)};
    ${script}
  `], { encoding: 'utf-8', timeout: 15000 });

console.log('\n─── 配置事务：真实进程中断与并发 ───');
try {
  for (const stage of ['first', 'staged', 'last', 'committed']) {
    const directory = join(root, stage);
    withConfigTransaction(directory, ['a.json', 'b.json'], commit => commit([
      { name: 'a.json', text: 'before-a' }, { name: 'b.json', text: 'before-b' },
    ]));
    const result = worker(directory, `
      const rename = fs.renameSync;
      fs.renameSync = (from, to) => {
        const target = String(to);
        if (${JSON.stringify(stage)} === 'staged' && target === join(dir, 'b.json')) {
          fs.writeFileSync(join(dir, 'crash-marker'), 'reached');
          process.kill(process.pid, 'SIGKILL');
        }
        rename(from, to);
        if (${JSON.stringify(stage)} === 'first' && target === join(dir, 'a.json')
          || ${JSON.stringify(stage)} === 'last' && target === join(dir, 'b.json')
          || ${JSON.stringify(stage)} === 'committed' && target === join(dir, '.ao-config-transaction.json')
            && JSON.parse(fs.readFileSync(target, 'utf8')).phase === 'committed') {
          fs.writeFileSync(join(dir, 'crash-marker'), 'reached');
          process.kill(process.pid, 'SIGKILL');
        }
      };
      syncBuiltinESMExports();
      withConfigTransaction(dir, ['a.json', 'b.json'], commit => commit([
        { name: 'a.json', text: 'after-a' }, { name: 'b.json', text: 'after-b' },
      ]));
    `);
    assert(!result.error && result.status !== 0 && existsSync(join(directory, 'crash-marker')), `${stage}：子进程在指定阶段强制结束`);
    assert(existsSync(join(directory, '.ao-config-transaction.json')), `${stage}：中断后有恢复日志`);
    if (process.platform !== 'win32') {
      assert((statSync(join(directory, '.ao-config-transaction.json')).mode & 0o777) === 0o600, '事务日志权限 0600');
    }
    withConfigTransaction(directory, ['a.json', 'b.json'], () => {});
    const prefix = stage === 'committed' ? 'after' : 'before';
    assert(readFileSync(join(directory, 'a.json'), 'utf-8') === `${prefix}-a`
      && readFileSync(join(directory, 'b.json'), 'utf-8') === `${prefix}-b`, `${stage}：恢复到完整一致状态`);
    assert(!existsSync(join(directory, '.ao-config.lock')) && !existsSync(join(directory, '.ao-config-transaction.json')), '恢复完成后释放锁并清理日志');
    assert(!readdirSync(directory).some(f => f.endsWith('.ao-tmp')), `${stage}：中断遗留的临时凭据文件已清理`);
  }

  const directory = join(root, 'conflict');
  withConfigTransaction(directory, ['a.json', 'b.json'], commit => commit([
    { name: 'a.json', text: 'before-a' }, { name: 'b.json', text: 'before-b' },
  ]));
  const crash = worker(directory, `
    const rename = fs.renameSync;
    fs.renameSync = (from, to) => {
      rename(from, to);
      if (String(to) === join(dir, 'a.json')) process.kill(process.pid, 'SIGKILL');
    };
    syncBuiltinESMExports();
    withConfigTransaction(dir, ['a.json', 'b.json'], commit => commit([
      { name: 'a.json', text: 'after-a' }, { name: 'b.json', text: 'after-b' },
    ]));
  `);
  assert(!crash.error && crash.status !== 0 && existsSync(join(directory, '.ao-config-transaction.json')), '冲突测试已建立真实中断事务');
  writeFileSync(join(directory, 'b.json'), 'external-edit');
  let conflict = '';
  try { withConfigTransaction(directory, ['a.json', 'b.json'], () => {}); } catch (e) { conflict = String(e); }
  assert(/外部修改/.test(conflict) && readFileSync(join(directory, 'a.json'), 'utf-8') === 'after-a'
    && readFileSync(join(directory, 'b.json'), 'utf-8') === 'external-edit', '恢复前先检查所有文件：遇外部修改不部分回滚或覆盖');
  assert(existsSync(join(directory, '.ao-config-transaction.json')) && !existsSync(join(directory, '.ao-config.lock')), '冲突保留恢复日志且释放锁');
  writeFileSync(join(directory, 'b.json'), 'before-b');
  withConfigTransaction(directory, ['a.json', 'b.json'], () => {});
  assert(readFileSync(join(directory, 'a.json'), 'utf-8') === 'before-a', '冲突解决后可以继续恢复');

  withConfigTransaction(directory, ['a.json', 'b.json'], () => {
    const contender = worker(directory, `
      try { withConfigTransaction(dir, ['a.json', 'b.json'], () => {}); }
      catch (e) { console.log(e.message); process.exit(2); }
    `);
    assert(contender.status === 2 && /另一个 AO/.test(contender.stdout), '活跃进程持锁时，另一真实进程无法修改');
  });
  let drift = '';
  try {
    withConfigTransaction(directory, ['a.json', 'b.json'], commit => {
      writeFileSync(join(directory, 'b.json'), 'new-external');
      commit([{ name: 'a.json', text: 'must-not-write' }]);
    });
  } catch (e) { drift = String(e); }
  assert(/外部修改/.test(drift) && readFileSync(join(directory, 'a.json'), 'utf-8') === 'before-a', '初读至提交间的外部修改被拒绝');

  writeFileSync(join(directory, '.ao-config-transaction.json'), JSON.stringify({ version: 1, phase: 'prepared', entries: [
    { name: '../outside', before: null, after: 'invalid' },
  ] }));
  let invalid = '';
  try { withConfigTransaction(directory, ['a.json', 'b.json'], () => {}); } catch (e) { invalid = String(e); }
  assert(/无效/.test(invalid) && !existsSync(join(root, 'outside')), '损坏或越界日志拒绝执行');
  assert(!readdirSync(directory).some(f => f.endsWith('.ao-tmp')), '已处理事务无临时凭据残留');

  console.log('\n─── 锁初始化窗口与长期损坏锁 ───');
  {
    const d = join(root, 'lock-window');
    withConfigTransaction(d, ['a.json'], commit => commit([{ name: 'a.json', text: 'x' }]));
    writeFileSync(join(d, '.ao-config.lock'), ''); // 另一进程刚 open('wx') 还没写入记录
    let busy = '';
    try { withConfigTransaction(d, ['a.json'], () => {}); } catch (e) { busy = String(e); }
    assert(/另一个 AO/.test(busy) && existsSync(join(d, '.ao-config.lock')), '刚创建的空锁：报暂时占用，不删锁');
    const old = new Date(Date.now() - 60_000);
    utimesSync(join(d, '.ao-config.lock'), old, old);
    let stuck = '';
    try { withConfigTransaction(d, ['a.json'], () => {}); } catch (e) { stuck = String(e); }
    assert(/无法读取/.test(stuck) && existsSync(join(d, '.ao-config.lock')), '长期遗留的空锁：仍阻止写入并要求检查');
  }
  {
    // 真实进程停在 open('wx') 与写入锁记录之间，另一进程此刻来抢锁
    const d = join(root, 'lock-race');
    withConfigTransaction(d, ['a.json'], commit => commit([{ name: 'a.json', text: 'before' }]));
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      import { join } from 'node:path';
      import { withConfigTransaction } from ${JSON.stringify(moduleUrl)};
      const dir = ${JSON.stringify(d)};
      const write = fs.writeFileSync;
      let paused = false;
      fs.writeFileSync = (target, data, ...rest) => {
        if (!paused && typeof target === 'number' && String(data).includes('"token"')) {
          paused = true;
          fs.writeFileSync(join(dir, 'paused-marker'), 'x');
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2500);
        }
        return write(target, data, ...rest);
      };
      syncBuiltinESMExports();
      withConfigTransaction(dir, ['a.json'], commit => commit([{ name: 'a.json', text: 'child-wrote' }]));
    `], { stdio: 'ignore' });
    const exited = new Promise<number | null>(done => child.on('exit', code => done(code)));
    const start = Date.now();
    while (!existsSync(join(d, 'paused-marker')) && Date.now() - start < 10000) await new Promise(r => setTimeout(r, 20));
    const lockText = existsSync(join(d, '.ao-config.lock')) ? readFileSync(join(d, '.ao-config.lock'), 'utf-8') : null;
    let contender = '';
    try { withConfigTransaction(d, ['a.json'], commit => commit([{ name: 'a.json', text: 'parent-wrote' }])); }
    catch (e) { contender = String(e); }
    assert(lockText === '' && /另一个 AO/.test(contender) && !/无法读取/.test(contender), '对方锁记录还没写完：报暂时占用，不报需人工检查');
    const code = await exited;
    assert(code === 0 && readFileSync(join(d, 'a.json'), 'utf-8') === 'child-wrote' && !existsSync(join(d, '.ao-config.lock')),
      '持锁进程不受干扰地完成写入并释放锁');
  }
  if (process.platform !== 'win32') {
    const d = join(root, 'symlink');
    withConfigTransaction(d, ['a.json'], () => {});
    writeFileSync(join(d, 'real.json'), 'real');
    symlinkSync(join(d, 'real.json'), join(d, 'a.json'));
    let link = '';
    try { withConfigTransaction(d, ['a.json'], commit => commit([{ name: 'a.json', text: 'new' }])); } catch (e) { link = String(e); }
    assert(/符号链接/.test(link) && lstatSync(join(d, 'a.json')).isSymbolicLink() && readFileSync(join(d, 'real.json'), 'utf-8') === 'real',
      '目标是符号链接：拒绝，链接与目标都不变');
  }
} finally { rmSync(root, { recursive: true, force: true }); }
console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed) process.exit(1);
