import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync, mkdirSync, statSync, utimesSync, symlinkSync, lstatSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { withConfigTransaction, withConfigLock } from '../src/utils/config-transaction.js';

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
  {
    const d = join(root, 'locked-temp-cleanup');
    const name = 'settings.json.12345678-1234-4234-8234-123456789abc.ao-tmp';
    withConfigLock(d, () => {
      writeFileSync(join(d, name), 'active');
      withConfigLock(d, () => assert(existsSync(join(d, name)), '嵌套操作不清理外层正在使用的暂存'), { cleanupTemps: ['settings.json'] });
      const contender = worker(d, `
        const { withConfigLock } = await import(${JSON.stringify(moduleUrl)});
        try { withConfigLock(dir, () => {}, { cleanupTemps: ['settings.json'] }); }
        catch { process.exit(17); }
      `);
      assert(contender.status === 17 && existsSync(join(d, name)), '另一个进程抢锁失败时不得清理活动暂存');
    }, { create: true });
    withConfigLock(d, () => assert(!existsSync(join(d, name)), '获得外层锁后才清理已遗留暂存'), { cleanupTemps: ['settings.json'] });
    if (process.platform !== 'win32') {
      const target = join(d, 'user-file');
      writeFileSync(target, 'user-data');
      symlinkSync(target, join(d, name));
      withConfigLock(d, () => {}, { cleanupTemps: ['settings.json'] });
      assert(lstatSync(join(d, name)).isSymbolicLink() && readFileSync(target, 'utf-8') === 'user-data',
        '同格式符号链接不清理且不修改其目标');
    }
  }
  {
    const d = join(root, 'transaction-cleanup-scope');
    withConfigTransaction(d, ['a.json'], commit => commit([{ name: 'a.json', text: 'original' }]));
    const uuid = '12345678-1234-4234-8234-123456789abc';
    const temp = `a.json.${uuid}.ao-tmp`;
    const journalTemp = `.ao-config-transaction.json.${uuid}.ao-tmp`;
    const malformed = `a.json.${'-'.repeat(36)}.ao-tmp`;
    const unrelated = `other.json.${uuid}.ao-tmp`;
    const directory = `a.json.22345678-1234-4234-8234-123456789abc.ao-tmp`;
    for (const name of [temp, journalTemp, malformed, unrelated]) writeFileSync(join(d, name), 'preserve-unless-owned');
    mkdirSync(join(d, directory));
    const link = `a.json.32345678-1234-4234-8234-123456789abc.ao-tmp`;
    if (process.platform !== 'win32') symlinkSync(join(d, 'a.json'), join(d, link));
    withConfigTransaction(d, ['a.json'], () => {});
    assert(!existsSync(join(d, temp)) && !existsSync(join(d, journalTemp)), '事务清理识别目标与日志的准确 UUID 暂存文件');
    assert(existsSync(join(d, malformed)) && existsSync(join(d, unrelated)) && statSync(join(d, directory)).isDirectory(),
      '事务清理保留畸形 UUID、其他目标文件与同格式目录');
    if (process.platform !== 'win32') assert(lstatSync(join(d, link)).isSymbolicLink()
      && readFileSync(join(d, 'a.json'), 'utf-8') === 'original', '事务清理保留同格式符号链接及其目标');
  }
  {
    const d = join(root, 'backup-cleanup-scope');
    withConfigTransaction(d, ['a.json'], commit => commit([{ name: 'a.json', text: 'original' }]));
    const prefix = 'a.json.ao-backup-';
    const owned = Array.from({ length: 8 }, (_, i) => `${prefix}170000000000${i}-12345678-1234-4234-8234-123456789abc`);
    for (const name of owned) writeFileSync(join(d, name), 'old-key');
    const notes = `${prefix}user-notes`;
    const directory = `${prefix}1600000000000-22345678-1234-4234-8234-123456789abc`;
    const link = `${prefix}1600000000001-32345678-1234-4234-8234-123456789abc`;
    writeFileSync(join(d, notes), 'user-notes');
    mkdirSync(join(d, directory));
    if (process.platform !== 'win32') symlinkSync(join(d, notes), join(d, link));
    withConfigTransaction(d, ['a.json'], commit => commit([{ name: 'a.json', text: 'updated' }]));
    assert(owned.slice(0, 4).every(name => !existsSync(join(d, name)))
      && owned.slice(4).every(name => existsSync(join(d, name))), '备份保留最近五份有效普通文件，用户文件不占配额');
    assert(readFileSync(join(d, notes), 'utf-8') === 'user-notes' && statSync(join(d, directory)).isDirectory(),
      '备份清理保留相似前缀笔记与同格式目录');
    if (process.platform !== 'win32') assert(lstatSync(join(d, link)).isSymbolicLink(), '备份清理不删除符号链接');
  }
  for (const failure of ['backup-write', 'backup-sync', 'second-target']) {
    const d = join(root, failure);
    withConfigTransaction(d, ['a.json', 'b.json'], commit => commit([
      { name: 'a.json', text: 'before-a' }, { name: 'b.json', text: 'before-b' },
    ]));
    const result = worker(d, `
      const open = fs.openSync, write = fs.writeFileSync, sync = fs.fsyncSync;
      const paths = new Map();
      let failed = false;
      fs.openSync = (path, ...args) => {
        const fd = open(path, ...args); paths.set(fd, String(path)); return fd;
      };
      fs.writeFileSync = (fd, data, ...args) => {
        const path = paths.get(fd) ?? '';
        if (!failed && (${JSON.stringify(failure)} === 'backup-write' && path.includes('.ao-backup-')
          || ${JSON.stringify(failure)} === 'second-target' && data === 'after-b')) {
          failed = true; write(fd, String(data).slice(0, 3), ...args);
          throw Object.assign(new Error('simulated disk full'), { code: 'ENOSPC' });
        }
        return write(fd, data, ...args);
      };
      fs.fsyncSync = fd => {
        if (!failed && ${JSON.stringify(failure)} === 'backup-sync' && (paths.get(fd) ?? '').includes('.ao-backup-')) {
          failed = true; throw Object.assign(new Error('simulated sync failure'), { code: 'EIO' });
        }
        return sync(fd);
      };
      syncBuiltinESMExports();
      try {
        withConfigTransaction(dir, ['a.json', 'b.json'], commit => commit([
          { name: 'a.json', text: 'after-a' }, { name: 'b.json', text: 'after-b' },
        ]));
      } catch { if (failed) process.exit(17); throw new Error('unexpected failure'); }
    `);
    assert(result.status === 17 && readFileSync(join(d, 'a.json'), 'utf-8') === 'before-a'
      && readFileSync(join(d, 'b.json'), 'utf-8') === 'before-b', `${failure}：故障注入后两份原配置完整保留或回滚`);
    assert(!existsSync(join(d, '.ao-config.lock')) && !existsSync(join(d, '.ao-config-transaction.json'))
      && !readdirSync(d).some(name => name.endsWith('.ao-tmp')), `${failure}：无遗留锁、暂存凭证和未完成事务`);
    if (failure !== 'second-target') assert(!readdirSync(d).some(name => name.includes('.ao-backup-')),
      `${failure}：不保留失败或未同步完成的备份凭证`);
  }
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

  for (const fault of ['recovery-write', 'recovery-sync', 'journal-cleanup']) {
    const d = join(root, fault);
    withConfigTransaction(d, ['a.json', 'b.json'], commit => commit([
      { name: 'a.json', text: 'before-a' }, { name: 'b.json', text: 'before-b' },
    ]));
    const crash = worker(d, `
      const rename = fs.renameSync;
      fs.renameSync = (from, to) => {
        rename(from, to);
        if (String(to) === join(dir, 'b.json')) process.kill(process.pid, 'SIGKILL');
      };
      syncBuiltinESMExports();
      withConfigTransaction(dir, ['a.json', 'b.json'], commit => commit([
        { name: 'a.json', text: 'after-a' }, { name: 'b.json', text: 'after-b' },
      ]));
    `);
    const journalPath = join(d, '.ao-config-transaction.json');
    assert(!crash.error && crash.status !== 0 && existsSync(journalPath), `${fault}：真实中断建立待恢复事务`);
    const journal = readFileSync(journalPath, 'utf-8');
    const recovery = worker(d, `
      const open = fs.openSync, write = fs.writeFileSync, sync = fs.fsyncSync, unlink = fs.unlinkSync;
      const paths = new Map();
      let injected = false;
      fs.openSync = (path, ...args) => { const fd = open(path, ...args); paths.set(fd, String(path)); return fd; };
      fs.writeFileSync = (fd, data, ...args) => {
        if (${JSON.stringify(fault)} === 'recovery-write' && data === 'before-a') {
          injected = true; write(fd, 'partial', ...args); throw new Error('simulated recovery disk full');
        }
        return write(fd, data, ...args);
      };
      fs.fsyncSync = fd => {
        if (${JSON.stringify(fault)} === 'recovery-sync' && (paths.get(fd) ?? '').startsWith(join(dir, 'a.json.'))) {
          injected = true; throw new Error('simulated recovery sync failure');
        }
        return sync(fd);
      };
      fs.unlinkSync = path => {
        if (${JSON.stringify(fault)} === 'journal-cleanup' && String(path) === join(dir, '.ao-config-transaction.json')) {
          injected = true; throw new Error('simulated journal cleanup failure');
        }
        return unlink(path);
      };
      syncBuiltinESMExports();
      try { withConfigTransaction(dir, ['a.json', 'b.json'], () => fs.writeFileSync(join(dir, 'action-ran'), 'unsafe')); }
      catch { if (injected) process.exit(17); throw new Error('unexpected recovery failure'); }
    `);
    assert(recovery.status === 17 && readFileSync(journalPath, 'utf-8') === journal
      && !existsSync(join(d, 'action-ran')), `${fault}：恢复失败保留原日志且不执行新配置操作`);
    const expectedA = fault === 'journal-cleanup' ? 'before-a' : 'after-a';
    assert(readFileSync(join(d, 'a.json'), 'utf-8') === expectedA
      && readFileSync(join(d, 'b.json'), 'utf-8') === 'before-b', `${fault}：已恢复与未恢复目标均保持完整文件`);
    assert(!existsSync(join(d, '.ao-config.lock')) && !readdirSync(d).some(name => name.endsWith('.ao-tmp')),
      `${fault}：故障后释放锁并清理暂存凭证`);
    let ran = false;
    withConfigTransaction(d, ['a.json', 'b.json'], () => { ran = true; });
    assert(ran && readFileSync(join(d, 'a.json'), 'utf-8') === 'before-a'
      && readFileSync(join(d, 'b.json'), 'utf-8') === 'before-b'
      && !existsSync(journalPath), `${fault}：故障解除后幂等恢复完整基线再执行操作`);
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
    for (const next of ['new', null]) {
      const d = join(root, `late-link-${next ?? 'delete'}`);
      withConfigTransaction(d, ['a.json'], commit => commit([{ name: 'a.json', text: 'same' }]));
      writeFileSync(join(d, 'real.json'), 'same');
      let error = '';
      try {
        withConfigTransaction(d, ['a.json'], commit => {
          unlinkSync(join(d, 'a.json'));
          symlinkSync(join(d, 'real.json'), join(d, 'a.json'));
          commit([{ name: 'a.json', text: next }]);
        });
      } catch (e) { error = String(e); }
      assert(/符号链接/.test(error) && lstatSync(join(d, 'a.json')).isSymbolicLink()
        && readFileSync(join(d, 'real.json'), 'utf-8') === 'same'
        && !existsSync(join(d, '.ao-config-transaction.json')), '读取基线后同内容链接替换：写入/删除均拒绝且不产生事务');
    }
  }
  if (process.platform !== 'win32') {
    const d = join(root, 'staged-link');
    withConfigTransaction(d, ['a.json'], commit => commit([{ name: 'a.json', text: 'same' }]));
    const result = worker(d, `
      fs.writeFileSync(join(dir, 'real.json'), 'same');
      const write = fs.writeFileSync;
      fs.writeFileSync = (target, data, ...rest) => {
        const result = write(target, data, ...rest);
        if (data === 'new-content') {
          fs.unlinkSync(join(dir, 'a.json'));
          fs.symlinkSync(join(dir, 'real.json'), join(dir, 'a.json'));
        }
        return result;
      };
      syncBuiltinESMExports();
      try { withConfigTransaction(dir, ['a.json'], commit => commit([{ name: 'a.json', text: 'new-content' }])); }
      catch { process.exit(17); }
    `);
    assert(result.status === 17 && lstatSync(join(d, 'a.json')).isSymbolicLink()
      && readFileSync(join(d, 'real.json'), 'utf-8') === 'same'
      && existsSync(join(d, '.ao-config-transaction.json')),
      '暂存写入期间替换为链接：最终替换被拒绝，保留链接与恢复记录');
    assert(!readdirSync(d).some(name => name.endsWith('.ao-tmp')), '拒绝最终替换后清理暂存凭证');
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
