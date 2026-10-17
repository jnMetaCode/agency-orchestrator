/**
 * 凭证配置文件（~/.codex、~/.claude）的两条共用护栏：
 *   1. 解析错误不回显原文——JSON.parse / smol-toml 的报错会把出错位置附近的文本原样带出来，
 *      而这些文件里装的就是 key（`{"OPENAI_API_KEY": sk-xxx}` 少个引号，报错里就是 sk-xxx）。
 *      只报文件、错误类别和行列号，够用户定位，不够泄露。
 *   2. 不替换符号链接——原子写是 rename 临时文件到目标路径，目标若是 stow/chezmoi 管的链接，
 *      链接会被换成普通文件，dotfiles 仓库里那份从此不再同步。先拒绝，正式支持需要连锁、备份一起设计。
 */
import { lstatSync } from 'node:fs';

export function describeParseError(err: unknown): string {
  const e = err as { line?: unknown; column?: unknown; message?: unknown } | null;
  // smol-toml 的 TomlError 自带 line/column（还有 codeblock——那就是原文，不能用）
  if (e && typeof e.line === 'number' && typeof e.column === 'number') return `语法错误（第 ${e.line} 行第 ${e.column} 列附近）`;
  const message = typeof e?.message === 'string' ? e.message : '';
  const lc = /\(line (\d+) column (\d+)\)/.exec(message);
  if (lc) return `语法错误（第 ${lc[1]} 行第 ${lc[2]} 列附近）`;
  const pos = /at position (\d+)/.exec(message);
  if (pos) return `语法错误（第 ${Number(pos[1]) + 1} 个字符附近）`;
  if (/end of JSON input/.test(message)) return '内容不完整（文件提前结束）';
  return '语法错误';
}

export function assertNotSymlink(path: string): void {
  let link = false;
  try { link = lstatSync(path).isSymbolicLink(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (link) {
    throw new Error(`${path} 是符号链接（可能由 dotfiles 工具管理）。AO 的原子写入会把链接替换成普通文件，`
      + '为保护你的链接，这次不修改。请改为直接编辑链接指向的文件，或暂时把它换成普通文件后再试。');
  }
}
