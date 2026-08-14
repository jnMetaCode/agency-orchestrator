/**
 * `ao run --materialize <dir>` 核心：把工作流（开发步）产出里的"文件块"落盘成真实项目脚手架。
 *
 * 约定格式（喂给开发角色，解析器主认这个 + 容错）：
 *   ### path/to/file.ext        ← 标题行给出文件路径（# / ** / `` 包裹均可）
 *   ```lang
 *   <文件内容>
 *   ```
 * 也兼容围栏信息串带路径：```ts path=src/x.ts
 *
 * 安全：拒绝绝对路径、`..` 逃逸、越出目标目录的路径（由 safeRelPath 把关）。
 */
import { resolve, sep, normalize, join, dirname } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { WorkflowResult } from '../types.js';

export interface FileBlock {
  path: string;
  content: string;
}

/** 一行去掉 markdown 标记后，是否本身就是一个"看起来像路径"的 token。 */
function pathFromHeadingLine(line: string): string | null {
  // 去掉标题 #、加粗 **、行内代码 `、列表符号、首尾空白与结尾冒号
  const stripped = line
    .replace(/^[\s>]*#{1,6}\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/^[-*]\s+/, '')
    .replace(/[:：]\s*$/, '')
    .trim();
  // 必须整行就是一个路径：含 . 扩展名或 /，且只由路径合法字符组成
  if (/^[\w.\-]+(\/[\w.\-]+)*$/.test(stripped) && (stripped.includes('.') || stripped.includes('/'))) {
    return stripped;
  }
  // 非 ASCII 文件名（中文课节名、日文素材名…）也是合法路径。以前只认 \w，
  // 于是 `### 课程/w4.6-阶梯产出验收清单.mdx` 一个都认不出来 —— --materialize 静默落盘 0 个文件，
  // 而这恰恰是本项目的主力场景（文档/课程类产出几乎全是中文名）。
  // ⚠️ 放宽的同时必须要求**ASCII 扩展名**：否则 `优点/缺点`、`第一章.总则` 这类中文标题
  //    会被当成文件路径写到盘上。有扩展名才当路径，是这里唯一可靠的判据。
  if (/^[\p{L}\p{N}._\-]+(\/[\p{L}\p{N}._\-]+)*$/u.test(stripped) && /\.[A-Za-z0-9]{1,8}$/.test(stripped)) {
    return stripped;
  }
  return null;
}

/** 从围栏信息串里取路径：```ts path=src/x.ts 或 ```ts file=src/x.ts 或 ```src/x.ts */
function pathFromFenceInfo(info: string): string | null {
  // ⚠️ 这里也要认非 ASCII：原本是 [\w.\-/]+，`path=课程/w1.1-开篇.mdx` 会在第一个中文字符处
  //    直接匹配失败（不是截断成半截，是整条不匹配），于是中文路径全都取不到。
  const m = info.match(/(?:path|file)\s*=\s*([\p{L}\p{N}._\-/]+)/iu);
  if (m) return m[1];
  const tok = info.trim().split(/\s+/)[0] || '';
  // 信息串第一个 token 本身是路径（含 . 或 /），而非单纯语言名
  if ((tok.includes('/') || /\.[a-zA-Z0-9]+$/.test(tok)) && /^[\w.\-/]+$/.test(tok)) return tok;
  // 同上：围栏信息串里的中文文件名也要认，同样以 ASCII 扩展名为准
  if (/^[\p{L}\p{N}._\-/]+$/u.test(tok) && /\.[A-Za-z0-9]{1,8}$/.test(tok)) return tok;
  return null;
}

/**
 * 解析文本里的"文件块"。返回 [{path, content}]，按出现顺序；同路径后者覆盖前者。
 */
export function parseFileBlocks(text: string): FileBlock[] {
  const lines = text.split(/\r?\n/); // 容忍 CRLF：否则尾随 \r 会让围栏正则匹配不上、整体失效
  const blocks: FileBlock[] = [];
  let lastNonBlank = ''; // 紧邻围栏的上一非空行（用于取标题路径）

  for (let i = 0; i < lines.length; i++) {
    const fence = lines[i].match(/^(\s*)(`{3,}|~{3,})(.*)$/);
    if (!fence) {
      if (lines[i].trim()) lastNonBlank = lines[i];
      continue;
    }
    // 进入围栏：闭合围栏的长度必须 ≥ 开围栏（这样 ```` 外层可包裹含 ``` 的文件，如 README）
    const marker = fence[2][0];
    const openLen = fence[2].length;
    const closeRe = new RegExp(`^\\s*[${marker}]{${openLen},}\\s*$`);
    const info = fence[3] || '';
    const body: string[] = [];
    let closed = false;
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (closeRe.test(lines[j])) { closed = true; break; }
      body.push(lines[j]);
    }
    const path = pathFromFenceInfo(info) || pathFromHeadingLine(lastNonBlank);
    if (path) blocks.push({ path, content: body.join('\n') });
    // 跳到闭合围栏之后；围栏块不更新 lastNonBlank
    i = closed ? j : lines.length;
    lastNonBlank = '';
  }

  // 同路径去重：保留最后一次
  const byPath = new Map<string, string>();
  for (const b of blocks) byPath.set(b.path, b.content);
  return Array.from(byPath, ([path, content]) => ({ path, content }));
}

/**
 * 把候选路径规整成相对目标目录的安全路径；非法（绝对路径 / .. 逃逸 / 越界）返回 null。
 */
export function safeRelPath(candidate: string, destDir: string): string | null {
  let p = candidate.trim().replace(/^\.\//, '');
  if (!p || p.startsWith('/') || p.startsWith('~') || p.startsWith('\\') || /^[a-zA-Z]:/.test(p)) return null;
  const rel = normalize(p);
  if (rel.startsWith('..' + sep) || rel === '..' || rel.includes(sep + '..' + sep)) return null;
  if (rel === '.' || rel === '') return null; // 规整后指向目标根本身（如 "foo/.."）→ 拒绝，避免写到目录上 EISDIR
  const full = resolve(destDir, rel);
  const base = resolve(destDir);
  if (full !== base && !full.startsWith(base + sep)) return null;
  return rel;
}

export interface MaterializeResult {
  destDir: string;
  stepId: string | null; // 取了哪个步的产出（null = 没找到任何文件块）
  files: string[];
  skipped: string[]; // 因不安全被跳过的路径
}

/**
 * 从工作流结果落盘：从后往前扫已完成步的产出，取第一个含文件块的步，把其文件写到 destDir。
 * 这样 verify 等收尾步在最后也没事——会自动回退到真正出代码的 build 步。
 */
export function materializeFromResult(result: WorkflowResult, destDir: string): MaterializeResult {
  const out: MaterializeResult = { destDir, stepId: null, files: [], skipped: [] };
  const steps = result.steps.filter((s) => s.status === 'completed' && s.output);
  // 取"文件块最多"的步：build 出整个项目(多文件)，verify 顶多顺带 1 个测试，不会盖过 build。
  // 并列时保留靠前的步（build 通常在 verify 之前）。
  let bestBlocks: FileBlock[] = [];
  for (const s of steps) {
    const blocks = parseFileBlocks(String(s.output));
    if (blocks.length > bestBlocks.length) { bestBlocks = blocks; out.stepId = s.id; }
  }
  for (const b of bestBlocks) {
    const rel = safeRelPath(b.path, destDir);
    if (!rel) { out.skipped.push(b.path); continue; }
    const full = join(destDir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, b.content.endsWith('\n') ? b.content : b.content + '\n', 'utf-8');
    out.files.push(rel);
  }
  return out;
}
