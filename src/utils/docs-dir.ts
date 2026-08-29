/**
 * `-i docs=@目录`：把一个目录里的文本资料拼成一份"知识源"输入。
 *
 * 用法与边界（写清楚，别让用户猜）：
 * - 只收文本类文件（md / txt / csv / tsv / json / yaml / html / rst / 常见源码），按相对路径排序、
 *   每个文件一节 `## 文件: <相对路径>`，模型能按文件引用；
 * - 跳过 .git / node_modules / 隐藏目录、二进制、超大文件；pdf / docx 这类需要转换的**明确跳过并告警**
 *   （先 `pandoc -t markdown` 转成 md 再放进目录），不是静默漏掉；
 * - 总量有上限（默认 400KB ≈ 10 万 token 量级）：超过就按顺序截断，告警列出没装下的文件——
 *   把 5MB 文档塞进 prompt 只会换来一次超长请求失败，而且用户会以为模型"读过了"。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const TEXT_EXT = new Set(['.md', '.markdown', '.txt', '.csv', '.tsv', '.json', '.yaml', '.yml', '.html', '.htm', '.rst', '.xml',
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.kt', '.rb', '.php', '.sh', '.sql', '.toml', '.ini', '.cfg', '.env.example']);
const NEEDS_CONVERT = new Set(['.pdf', '.docx', '.doc', '.pptx', '.xlsx', '.xls', '.epub']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', 'ao-output']);

export interface DocsDirResult {
  text: string;
  files: string[];          // 装进去的（相对路径）
  skipped: string[];        // 没装进去的：`路径（原因）`
  truncated: boolean;
}

export interface DocsDirOptions {
  /** 拼接后总上限（字节），默认 400KB */
  maxTotalBytes?: number;
  /** 单文件上限（字节），默认 200KB；超出的整个跳过（半个文件比没有更误导） */
  maxFileBytes?: number;
}

function walk(dir: string, root: string, out: string[]): void {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries.sort()) {
    if (name.startsWith('.') || SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, root, out);
    else if (st.isFile()) out.push(p);
  }
}

export function readDocsDir(dir: string, opts: DocsDirOptions = {}): DocsDirResult {
  const maxTotal = opts.maxTotalBytes ?? 400 * 1024;
  const maxFile = opts.maxFileBytes ?? 200 * 1024;
  const all: string[] = [];
  walk(dir, dir, all);
  const parts: string[] = [];
  const files: string[] = [];
  const skipped: string[] = [];
  let used = 0;
  let truncated = false;
  for (const p of all) {
    const rel = relative(dir, p);
    const ext = extname(p).toLowerCase();
    if (NEEDS_CONVERT.has(ext)) { skipped.push(`${rel}（${ext} 需先转成 md/txt，如 pandoc -t markdown）`); continue; }
    if (!TEXT_EXT.has(ext)) { skipped.push(`${rel}（非文本）`); continue; }
    const size = statSync(p).size;
    if (size > maxFile) { skipped.push(`${rel}（${(size / 1024).toFixed(0)}KB 超过单文件上限 ${(maxFile / 1024).toFixed(0)}KB）`); continue; }
    if (truncated) { skipped.push(`${rel}（总量已满）`); continue; }
    const buf = readFileSync(p);
    if (buf.includes(0)) { skipped.push(`${rel}（二进制）`); continue; }   // NUL 字节 = 不是文本
    const section = `## 文件: ${rel}\n\n${buf.toString('utf-8').trim()}\n\n`;
    if (used + Buffer.byteLength(section) > maxTotal) { truncated = true; skipped.push(`${rel}（总量已满）`); continue; }
    parts.push(section); files.push(rel); used += Buffer.byteLength(section);
  }
  return { text: parts.join('').trimEnd(), files, skipped, truncated };
}
