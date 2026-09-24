/**
 * `--watch` 的终端框。两件事以前都不成立：
 *  - 排版用 String.length：中文标题（每字 2 列）把顶边撑出去、步骤行又比边框短 16 列，整个框是歪的；
 *  - 非 TTY 下照样写光标转义码，`ao run --watch 2> run.log` 会被 \x1b[…A 糊成一片。
 */
import { createWatchRenderer, dispWidth } from '../src/cli/watch.js';
import { streamProgressEnabled } from '../src/connectors/cli-base.js';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; }
}

/** 抓一次渲染的输出（去掉转义码），返回非空行 */
function renderLines(name: string, ids: string[], tty: boolean): string[] {
  const out: string[] = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  const origTty = process.stderr.isTTY;
  Object.defineProperty(process.stderr, 'isTTY', { value: tty, configurable: true });
  (process.stderr as { write: unknown }).write = (s: string) => { out.push(String(s)); return true; };
  try {
    const cb = createWatchRenderer(name, ids, ids.map(() => 'role'));
    cb({ type: 'step-start', stepId: ids[0] } as never);
  } finally {
    (process.stderr as { write: unknown }).write = origWrite;
    Object.defineProperty(process.stderr, 'isTTY', { value: origTty, configurable: true });
  }
  return out.join('').split('\n').map((l) => l.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')).filter((l) => l.trim());
}

console.log('\n─── 显示宽度 ───');
assert(dispWidth('abc') === 3, 'ASCII 一字一列');
assert(dispWidth('中文') === 4, '中文一字两列');
assert(dispWidth('🤖') === 2, 'emoji 两列');
assert(dispWidth('a中🤖') === 5, '混排');

console.log('\n─── 中文标题下框也是齐的 ───');
{
  const lines = renderLines('短篇小说创作', ['write_story', 'review'], true);
  const widths = [...new Set(lines.map(dispWidth))];
  assert(widths.length === 1, `每一行显示宽度一致（实际 ${JSON.stringify(lines.map(dispWidth))}）`);
  assert(lines[0].startsWith('┌') && lines[lines.length - 1].startsWith('└'), '上下边框在');
}
{
  // 超长中文名不能把框撑破
  const lines = renderLines('这是一个非常非常非常长的中文工作流名称用来测试边框', ['a'], true);
  const widths = [...new Set(lines.map(dispWidth))];
  assert(widths.length === 1, `超长标题同样不破框（实际 ${JSON.stringify(widths)}）`);
}

console.log('\n─── 非 TTY：不写转义码 ───');
{
  const out: string[] = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  const origTty = process.stderr.isTTY;
  Object.defineProperty(process.stderr, 'isTTY', { value: false, configurable: true });
  (process.stderr as { write: unknown }).write = (s: string) => { out.push(String(s)); return true; };
  try {
    const cb = createWatchRenderer('x', ['a'], ['r']);
    cb({ type: 'step-start', stepId: 'a' } as never);
    cb({ type: 'step-done', stepId: 'a' } as never);
  } finally {
    (process.stderr as { write: unknown }).write = origWrite;
    Object.defineProperty(process.stderr, 'isTTY', { value: origTty, configurable: true });
  }
  const text = out.join('');
  assert(!text.includes('\x1b'), '一个转义码都没有');
  assert(/\[\d\/1\]/.test(text), '仍然给出进度（一行一条纯文本）');
}

console.log('\n─── 框在重绘时，别的地方别往 stderr 插话 ───');
{
  // 框靠"光标上移 N 行"原地重绘：连接器那行「📡 已接收 xKB」一插进来，行数就算错、框糊成一片
  // （一步跑过 10 秒就会打，很常见）。TTY 下开框＝告诉连接器闭嘴；非 TTY 不重绘，那行是唯一的活着信号。
  const orig = process.env.AO_WATCH_UI;
  delete process.env.AO_WATCH_UI;
  assert(streamProgressEnabled(), '平时照打');

  renderLines('框', ['a', 'b'], true);
  assert(process.env.AO_WATCH_UI === '1' && !streamProgressEnabled(), 'TTY 下开了框 → 连接器闭嘴');

  delete process.env.AO_WATCH_UI;
  renderLines('框', ['a', 'b'], false);
  assert(process.env.AO_WATCH_UI === undefined && streamProgressEnabled(), '非 TTY 不重绘 → 照打不误');

  if (orig === undefined) delete process.env.AO_WATCH_UI; else process.env.AO_WATCH_UI = orig;
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed > 0 ? 1 : 0);
