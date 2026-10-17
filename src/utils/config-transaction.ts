/** Cooperative local config transactions. Recovery refuses to overwrite external edits. */
import { existsSync, readFileSync, writeFileSync, openSync, closeSync, fsyncSync, renameSync,
  unlinkSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, basename } from 'node:path';
import { assertNotSymlink } from './config-safety.js';

/** Successful transactions keep this many backups per file; each one is a plaintext credential copy. */
const KEEP_BACKUPS = 5;
/** createLock opens the file before writing its owner record; a reader can land in between. */
const LOCK_INIT_GRACE_MS = 5000;

interface Owner { pid: number; token: string }
interface Entry { name: string; before: string | null; after: string | null }
interface Journal { version: 1; phase: 'prepared' | 'committed'; entries: Entry[] }
export interface ConfigUpdate { name: string; text: string | null }

function read(path: string): string | null {
  try { return readFileSync(path, 'utf-8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

function atomicWrite(path: string, text: string): void {
  const tmp = `${path}.${randomUUID()}.ao-tmp`;
  try {
    const fd = openSync(tmp, 'wx', 0o600);
    try { writeFileSync(fd, text, 'utf-8'); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, path);
  } finally {
    try { unlinkSync(tmp); } catch { /* Already renamed, or preserve the original error. */ }
  }
}

function owner(path: string): Owner {
  try {
    const value = JSON.parse(readFileSync(path, 'utf-8'));
    if (Number.isSafeInteger(value.pid) && value.pid > 0 && typeof value.token === 'string' && value.token) return value;
  } catch { /* Fail closed: an incomplete lock must not be guessed stale. */ }
  // A freshly created lock may simply not have its record yet: report "busy", never delete it.
  let recent = false;
  try { recent = Date.now() - statSync(path).mtimeMs < LOCK_INIT_GRACE_MS; } catch { /* Vanished: still busy/unknown. */ }
  if (recent) throw new Error('配置正在由另一个 AO 操作修改，请稍后重试');
  throw new Error(`配置锁记录无法读取，请检查后恢复：${path}`);
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}

function createLock(path: string, value: Owner): void {
  const fd = openSync(path, 'wx', 0o600);
  try {
    try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); } finally { closeSync(fd); }
  } catch (error) {
    try { unlinkSync(path); } catch { /* Preserve the failure, leave an unreadable lock fail-closed. */ }
    throw error;
  }
}

function release(path: string, token: string): void {
  try { if (owner(path).token === token) unlinkSync(path); } catch { /* Never remove another owner's lock. */ }
}

function lock(path: string): () => void {
  const value: Owner = { pid: process.pid, token: randomUUID() };
  try { createLock(path, value); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const old = owner(path);
    if (alive(old.pid)) throw new Error('配置正在由另一个 AO 操作修改，请稍后重试');
    // Serialize stale-lock reclamation; a corrupt/orphaned reclaim guard requires manual review.
    const guard = `${path}.reclaim`;
    try { createLock(guard, value); }
    catch (guardError) {
      if ((guardError as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`配置锁正在恢复或需要检查：${guard}`);
      throw guardError;
    }
    try {
      // Re-read under the guard: never delete a new live owner's lock.
      if (existsSync(path)) {
        if (alive(owner(path).pid)) throw new Error('配置正在由另一个 AO 操作修改，请稍后重试');
        unlinkSync(path);
      }
      createLock(path, value);
    } finally { release(guard, value.token); }
  }
  return () => release(path, value.token);
}

function pruneBackups(directory: string, name: string): void {
  try {
    const prefix = `${name}.ao-backup-`;
    const olds = readdirSync(directory).filter(file => file.startsWith(prefix)).sort(); // ms timestamp first
    for (const file of olds.slice(0, Math.max(0, olds.length - KEEP_BACKUPS))) {
      try { unlinkSync(join(directory, file)); } catch { /* Cleanup must not turn a commit into a failure. */ }
    }
  } catch { /* Unreadable directory: keep everything. */ }
}

/** Holds the lock from initial read through recovery and commit. No network or async work inside. */
export function withConfigTransaction<T>(directory: string, names: readonly string[],
  action: (commit: (updates: ConfigUpdate[]) => string[]) => T): T {
  if (!names.length || new Set(names).size !== names.length || names.some(name => !name || name === '.' || name === '..'
    || name.startsWith('.ao-config') || basename(name) !== name)) {
    throw new Error('配置事务文件名无效');
  }
  mkdirSync(directory, { recursive: true });
  // Before the lock and before recovery: recovery also renames over the targets.
  for (const name of names) assertNotSymlink(join(directory, name));
  const unlock = lock(join(directory, '.ao-config.lock'));
  const journalPath = join(directory, '.ao-config-transaction.json');
  const allowed = new Set(names);
  const writeEntry = (entry: Entry, text: string | null) => {
    const path = join(directory, entry.name);
    if (text === null) { if (existsSync(path)) unlinkSync(path); }
    else atomicWrite(path, text);
  };
  const rollback = (journal: Journal) => {
    // Validate all targets before restoring any: external edits require explicit resolution.
    for (const entry of journal.entries) {
      const current = read(join(directory, entry.name));
      if (current !== entry.before && current !== entry.after) throw new Error(`配置被外部修改，保留事务记录，请检查：${entry.name}`);
    }
    for (const entry of [...journal.entries].reverse()) {
      const current = read(join(directory, entry.name));
      if (current === entry.before) continue;
      if (current !== entry.after) throw new Error(`配置恢复期间发生冲突：${entry.name}`);
      writeEntry(entry, entry.before);
    }
  };
  try {
    if (existsSync(journalPath)) {
      let journal: Journal;
      try {
        journal = JSON.parse(readFileSync(journalPath, 'utf-8'));
        if (journal.version !== 1 || !['prepared', 'committed'].includes(journal.phase) || !Array.isArray(journal.entries)
          || !journal.entries.length || new Set(journal.entries.map(e => e.name)).size !== journal.entries.length
          || journal.entries.some(e => !allowed.has(e.name) || !(e.before === null || typeof e.before === 'string')
            || !(e.after === null || typeof e.after === 'string'))) throw new Error('invalid journal');
      } catch { throw new Error(`配置事务记录无效，为安全起见不写配置：${journalPath}`); }
      if (journal.phase === 'prepared') rollback(journal);
      unlinkSync(journalPath);
    }
    // A killed writer may leave a staged secret. Remove only our UUID temp files under the lock.
    for (const file of readdirSync(directory)) {
      for (const name of [...names, '.ao-config-transaction.json']) {
        const prefix = `${name}.`;
        if (file.startsWith(prefix) && /^[0-9a-f-]{36}\.ao-tmp$/.test(file.slice(prefix.length))) {
          unlinkSync(join(directory, file));
          break;
        }
      }
    }
    const baseline = new Map(names.map(name => [name, read(join(directory, name))]));
    const commit = (updates: ConfigUpdate[]): string[] => {
      if (!updates.length || new Set(updates.map(u => u.name)).size !== updates.length
        || updates.some(u => !allowed.has(u.name) || !(u.text === null || typeof u.text === 'string'))) {
        throw new Error('配置事务更新无效');
      }
      for (const [name, text] of baseline) {
        if (read(join(directory, name)) !== text) throw new Error(`配置被外部修改，请重新读取后重试：${name}`);
      }
      const entries = updates.map(u => ({ name: u.name, before: baseline.get(u.name)!, after: u.text }));
      const backups: string[] = [];
      for (const entry of entries) {
        if (entry.before === null) continue;
        const backup = join(directory, `${entry.name}.ao-backup-${Date.now()}-${randomUUID()}`);
        const fd = openSync(backup, 'wx', 0o600);
        try { writeFileSync(fd, entry.before, 'utf-8'); fsyncSync(fd); } finally { closeSync(fd); }
        backups.push(backup);
      }
      const journal: Journal = { version: 1, phase: 'prepared', entries };
      atomicWrite(journalPath, JSON.stringify(journal));
      try {
        for (const entry of entries) {
          if (read(join(directory, entry.name)) !== entry.before) throw new Error(`配置提交期间发生冲突：${entry.name}`);
          writeEntry(entry, entry.after);
        }
        atomicWrite(journalPath, JSON.stringify({ ...journal, phase: 'committed' }));
      } catch (error) {
        try { rollback(journal); unlinkSync(journalPath); }
        catch (recoveryError) {
          throw new Error(`配置回滚未完成，请保留事务记录并从备份恢复：${backups.join(', ')}`, { cause: recoveryError });
        }
        throw error;
      }
      // Commit is complete. A leftover committed journal is safe to clean on the next operation.
      try { unlinkSync(journalPath); } catch { /* Do not misreport committed data as a failed operation. */ }
      for (const entry of entries) baseline.set(entry.name, entry.after);
      // Only after commit: recovery uses the journal, never these files, so trimming cannot break it.
      for (const entry of entries) pruneBackups(directory, entry.name);
      return backups;
    };
    return action(commit);
  } finally { unlock(); }
}
