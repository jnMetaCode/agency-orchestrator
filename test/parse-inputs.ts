/**
 * parseInputPairs 测试 —— 尤其是 @file 安全开关（AO_NO_AT_FILE）。
 * 回归：网页 Studio 设置 AO_NO_AT_FILE=1 后，-i k=@/path 不得读取本机文件。
 */
import { resolve } from 'node:path';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { parseInputPairs } from '../src/cli/parse-inputs.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}: ${err instanceof Error ? err.message : err}`);
    failed++;
  }
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg);
}

const fail = (msg: string): never => { throw new Error(msg); };
const argv = (...pairs: string[]) => ['run', 'wf.yaml', ...pairs.flatMap(p => ['-i', p])];

console.log('\n─── parseInputPairs ───');

const dir = mkdtempSync(resolve(tmpdir(), 'ao-parse-inputs-'));
const secretPath = resolve(dir, 'web-keys.json');
const SECRET = '{"deepseek":"sk-SECRET-KEY"}';
writeFileSync(secretPath, SECRET);

delete process.env.AO_NO_AT_FILE;

test('普通 key=value 正常解析', () => {
  const out = parseInputPairs(argv('topic=hello', 'lang=zh'), fail);
  assert(out.topic === 'hello' && out.lang === 'zh', `解析错误: ${JSON.stringify(out)}`);
});

test('value 里含 = 只在第一个 = 处分割', () => {
  const out = parseInputPairs(argv('q=a=b=c'), fail);
  assert(out.q === 'a=b=c', `应保留后续 =，实际: ${out.q}`);
});

test('默认放行 @file：读取文件内容（CLI 行为不变）', () => {
  const out = parseInputPairs(argv(`k=@${secretPath}`), fail);
  assert(out.k === SECRET, `@file 应读取文件内容，实际: ${out.k}`);
});

test('@目录 → 知识源：按相对路径拼成分节文本，跳过二进制 / 隐藏 / 需转换的 pdf，并说明原因', () => {
  const d = resolve(dir, 'docs');
  mkdirSync(resolve(d, 'sub'), { recursive: true });
  mkdirSync(resolve(d, '.hidden'), { recursive: true });
  writeFileSync(resolve(d, 'b.md'), '# B\n第二份');
  writeFileSync(resolve(d, 'a.txt'), '第一份');
  writeFileSync(resolve(d, 'sub', 'c.csv'), 'x,y\n1,2');
  writeFileSync(resolve(d, 'bin.dat'), Buffer.from([0, 1, 2, 3]));
  writeFileSync(resolve(d, 'report.pdf'), 'fake');
  writeFileSync(resolve(d, '.hidden', 'z.md'), 'should not appear');
  const errs: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  (process.stderr as unknown as { write: (s: string) => boolean }).write = (x: string) => { errs.push(String(x)); return true; };
  let out: Record<string, string>;
  try { out = parseInputPairs(argv(`docs=@${d}`), fail); } finally { (process.stderr as unknown as { write: typeof orig }).write = orig; }
  const v = out.docs;
  assert(v.indexOf('## 文件: a.txt') < v.indexOf('## 文件: b.md') && v.includes('## 文件: sub/c.csv'), `按路径排序分节，实际：${v.slice(0, 120)}`);
  assert(v.includes('第一份') && v.includes('第二份') && v.includes('1,2'), '内容进来了');
  assert(!v.includes('should not appear') && !v.includes('bin.dat'), '隐藏目录与二进制不进正文');
  const log = errs.join('');
  assert(/装入 3 个文件/.test(log) && /report\.pdf（\.pdf 需先转成/.test(log) && /bin\.dat（非文本）/.test(log), `stderr 说明装入/跳过与原因，实际：${log.slice(0, 200)}`);
});

test('@目录 超过总量上限 → 截断并告警，模型只看得到装进去的', () => {
  const d = resolve(dir, 'big');
  mkdirSync(d, { recursive: true });
  for (let i = 0; i < 6; i++) writeFileSync(resolve(d, `f${i}.txt`), 'x'.repeat(90 * 1024));
  const errs: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  (process.stderr as unknown as { write: (s: string) => boolean }).write = (x: string) => { errs.push(String(x)); return true; };
  let out: Record<string, string>;
  try { out = parseInputPairs(argv(`docs=@${d}`), fail); } finally { (process.stderr as unknown as { write: typeof orig }).write = orig; }
  const n = (out.docs.match(/## 文件: /g) || []).length;
  assert(n === 4 && /超过总量上限/.test(errs.join('')), `400KB 上限应装 4 个 90KB 文件并告警，实际装 ${n}`);
});

test('@目录 里没有文本文件 → 明确报错', () => {
  const d = resolve(dir, 'empty');
  mkdirSync(d, { recursive: true });
  writeFileSync(resolve(d, 'x.pdf'), 'fake');
  let msg = '';
  try { parseInputPairs(argv(`docs=@${d}`), fail); } catch (e) { msg = (e as Error).message; }
  assert(/没有可读的文本文件/.test(msg) && /x\.pdf/.test(msg), `实际：${msg}`);
});

test('AO_NO_AT_FILE=1 时 @ 按字面处理，不读文件（网页安全开关）', () => {
  process.env.AO_NO_AT_FILE = '1';
  try {
    const out = parseInputPairs(argv(`k=@${secretPath}`), fail);
    assert(out.k === `@${secretPath}`, `应原样保留 @path，实际: ${out.k}`);
    assert(!out.k.includes('SECRET'), `绝不能泄露文件内容！实际: ${out.k}`);
  } finally {
    delete process.env.AO_NO_AT_FILE;
  }
});

test('AO_NO_AT_FILE=1 时不存在的 @path 也不报错（按字面）', () => {
  process.env.AO_NO_AT_FILE = '1';
  try {
    const out = parseInputPairs(argv('k=@/nonexistent/path/x'), fail);
    assert(out.k === '@/nonexistent/path/x', `应原样保留，实际: ${out.k}`);
  } finally {
    delete process.env.AO_NO_AT_FILE;
  }
});

rmSync(dir, { recursive: true, force: true });

console.log('\n' + '='.repeat(50));
console.log(`  parseInputPairs 测试: ${passed} 通过, ${failed} 失败 (共 ${passed + failed} 项)`);
if (failed === 0) {
  console.log('  全部通过!');
} else {
  process.exit(1);
}
console.log('='.repeat(50) + '\n');
