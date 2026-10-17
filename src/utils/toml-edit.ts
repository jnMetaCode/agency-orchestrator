/**
 * 尽量保留排版地改写 Codex config.toml。
 *
 * smol-toml 的 parse → stringify 会把注释、空行、键顺序全部抹掉。AO 只动三处：顶层 `model_provider`、
 * 顶层 `model`、`[model_providers.<id>]` 整张表——所以只按行改这几处，其余行原封不动。
 *
 * 按行识别 TOML 结构不可能完备（多行字符串、多行数组、点号键、内联表……），所以这里的安全性
 * 不靠识别得准：改完重新 parse，必须与预期的文档逐值相等，否则退回整份 stringify。
 * 识别错的代价只是这次丢排版，永远不会写出与预期不同的配置。
 */
import { isDeepStrictEqual } from 'node:util';
import { parse, stringify } from 'smol-toml';

type Doc = Record<string, any>;
const TOP_KEYS = ['model_provider', 'model'] as const;

/** `[a."b.c".d]` → ['a', 'b.c', 'd']；带转义或无法识别 → null（交给兜底） */
function headerPath(line: string): string[] | null {
  const m = /^\s*\[\s*([^\[\]]+?)\s*\]\s*(?:#.*)?$/.exec(line);
  if (!m) return null;
  const path: string[] = [];
  const re = /\s*(?:"([^"\\]*)"|'([^']*)'|([A-Za-z0-9_-]+))\s*(\.|$)/y;
  let rest = m[1];
  re.lastIndex = 0;
  while (re.lastIndex < rest.length) {
    const start = re.lastIndex;
    const seg = re.exec(rest);
    if (!seg || seg.index !== start) return null;
    path.push(seg[1] ?? seg[2] ?? seg[3]);
    if (seg[4] === '') break;
  }
  return path.length ? path : null;
}

interface Line { text: string; header: string[] | 'array' | null; inString: boolean }

function scan(text: string): Line[] {
  let open: '"""' | "'''" | null = null;
  return text.split('\n').map(raw => {
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const inString = open !== null;
    // 粗略跟踪多行字符串：一行里出现奇数个定界符就切换状态
    for (const delim of ['"""', "'''"] as const) {
      if (open && open !== delim) continue;
      if ((text.split(delim).length - 1) % 2 === 1) open = open ? null : delim;
    }
    const header = inString ? null : /^\s*\[\[/.test(text) ? 'array' : headerPath(text);
    return { text, header, inString };
  });
}

const isKeyLine = (line: Line, key: string) =>
  !line.inString && new RegExp(`^\\s*(?:${key}|"${key}"|'${key}')\\s*=`).test(line.text);
const isBlankOrComment = (line: Line) => !line.inString && /^\s*(#.*)?$/.test(line.text);

/** 按行编辑；做不了返回 null */
function editLines(text: string, before: Doc, after: Doc): string | null {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let lines = scan(text);
  const firstHeader = () => { const i = lines.findIndex(l => l.header); return i < 0 ? lines.length : i; };
  const render = (value: Doc) => scan(stringify(value).replace(/\n+$/, ''));

  for (const key of TOP_KEYS) {
    if (isDeepStrictEqual(before[key], after[key])) continue;
    const top = firstHeader();
    const at = lines.slice(0, top).findIndex(l => isKeyLine(l, key));
    if (after[key] === undefined) {
      if (at < 0) return null;
      lines.splice(at, 1);
    } else if (at >= 0) {
      // 行尾注释跟着这一行走（值里有 # 时认错了也没关系：下面的整体校验会兜底）
      const comment = /(\s+#[^"']*)$/.exec(lines[at].text)?.[1] ?? '';
      const [first, ...more] = render({ [key]: after[key] });
      lines.splice(at, 1, { ...first, text: first.text + comment }, ...more);
    } else {
      // 插在顶层最后一条非注释行之后：紧贴第一张表的注释通常是在说明那张表
      let insert = 0;
      for (let i = 0; i < top; i++) if (!isBlankOrComment(lines[i])) insert = i + 1;
      lines.splice(insert, 0, ...render({ [key]: after[key] }));
    }
  }

  const ids = new Set([...Object.keys(before.model_providers ?? {}), ...Object.keys(after.model_providers ?? {})]);
  for (const id of ids) {
    const oldValue = before.model_providers?.[id];
    const newValue = after.model_providers?.[id];
    if (isDeepStrictEqual(oldValue, newValue)) continue;
    const owns = (l: Line) => Array.isArray(l.header) && l.header[0] === 'model_providers' && l.header[1] === id;
    const start = lines.findIndex(owns);
    let end = start;
    if (start >= 0) {
      // 表体 + 它自己的子表，直到下一张不属于它的表；表尾的空行/注释留给下一张表
      end = start + 1;
      while (end < lines.length && (!lines[end].header || owns(lines[end]))) end++;
      while (end > start + 1 && isBlankOrComment(lines[end - 1])) end--;
      if (lines.slice(end).some(owns)) return null; // 同一张表的子表散在别处，不猜
    }
    const block = newValue === undefined ? [] : render({ model_providers: { [id]: newValue } });
    if (start >= 0) {
      let removeTo = end;
      if (!block.length) while (removeTo < lines.length && lines[removeTo].text.trim() === '' && !lines[removeTo].inString) removeTo++;
      lines.splice(start, removeTo - start, ...block);
    } else if (block.length) {
      while (lines.length && lines[lines.length - 1].text.trim() === '') lines.pop();
      lines.push(...(lines.length ? scan('') : []), ...block, ...scan(''));
    }
  }

  // 预期里整个 model_providers 都没了（AO 建的、清空了），但文件里可能还剩一个空的 [model_providers] 头
  if (before.model_providers !== undefined && after.model_providers === undefined) {
    const i = lines.findIndex(l => Array.isArray(l.header) && l.header.length === 1 && l.header[0] === 'model_providers');
    if (i >= 0) {
      let j = i + 1;
      while (j < lines.length && !lines[j].inString && lines[j].text.trim() === '') j++;
      if (j < lines.length && !lines[j].header) return null;
      lines.splice(i, j - i);
    }
  }

  // 删掉顶层键后文件开头可能剩空行；原文不以空行开头就别凭空多出来
  if (!/^\s*\r?\n/.test(text)) while (lines.length > 1 && lines[0].text.trim() === '') lines.shift();
  let out = lines.map(l => l.text).join(eol);
  if (text.endsWith('\n') && !out.endsWith('\n')) out += eol;
  return out;
}

/**
 * 只有 AO 管的那几处不同时才按行改；其它位置有差异（调用方改了别的字段）直接整份重写。
 * 返回值保证 parse 后与 `after` 相等。
 */
export function rewriteToml(text: string, after: Doc): string {
  const fallback = () => stringify(after);
  if (!text.trim()) return fallback();
  let before: Doc;
  try { before = parse(text) as Doc; } catch { return fallback(); }
  const others = (doc: Doc) => Object.fromEntries(Object.entries(doc).filter(([k]) => k !== 'model_providers' && !(TOP_KEYS as readonly string[]).includes(k)));
  if (!isDeepStrictEqual(others(before), others(after))) return fallback();
  let edited: string | null = null;
  try { edited = editLines(text, before, after); } catch { edited = null; }
  if (edited === null) return fallback();
  try { if (isDeepStrictEqual(parse(edited), parse(stringify(after)))) return edited; } catch { /* fall through */ }
  return fallback();
}
