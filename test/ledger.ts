/**
 * 测试 ao ledger — 人工介入账本（自主率会公开发表，口径必须钉死）
 */
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ledgerFile,
  makeEntry,
  appendEntry,
  readEntries,
  readRuns,
  summarize,
  formatReport,
  formatAutonomy,
  assertDay,
  localDay,
} from '../src/cli/ledger.js';

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

function throws(fn: () => unknown, includes: string): void {
  try {
    fn();
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    assert(m.includes(includes), `错误信息应含 "${includes}"，实际: ${m}`);
    return;
  }
  throw new Error('应当抛错却没有');
}

console.log('\n─── ao ledger（人工介入账本）───');

const dir = mkdtempSync(join(tmpdir(), 'ao-ledger-'));
// 各时间取当天正午 UTC：任何 ±11 时区下都落在同一个本地日期
const D1 = new Date('2026-09-22T12:00:00Z');
const D2 = new Date('2026-09-23T12:00:00Z');
const D3 = new Date('2026-09-24T12:00:00Z');

test('ledgerFile：AO_LEDGER_FILE 覆盖，默认落在运行产物目录', () => {
  const old = { f: process.env.AO_LEDGER_FILE, o: process.env.AO_OUTPUT_DIR };
  process.env.AO_LEDGER_FILE = join(dir, 'x.jsonl');
  assert(ledgerFile() === join(dir, 'x.jsonl'), '应使用 AO_LEDGER_FILE');
  delete process.env.AO_LEDGER_FILE;
  process.env.AO_OUTPUT_DIR = join(dir, 'out');
  assert(ledgerFile() === join(dir, 'out', 'ledger.jsonl'), '默认应为 <output>/ledger.jsonl');
  if (old.f === undefined) delete process.env.AO_LEDGER_FILE; else process.env.AO_LEDGER_FILE = old.f;
  if (old.o === undefined) delete process.env.AO_OUTPUT_DIR; else process.env.AO_OUTPUT_DIR = old.o;
});

test('makeEntry：缺动作 / 缺或错原因 / 分钟非法都拒收', () => {
  throws(() => makeEntry({ reason: 'quality' }), '缺少');
  throws(() => makeEntry({ action: '   ', reason: 'quality' }), '缺少');
  throws(() => makeEntry({ action: '部署' }), '--reason 必填');
  throws(() => makeEntry({ action: '部署', reason: 'lazy' }), 'unsupported');
  throws(() => makeEntry({ action: '部署', reason: 'unsupported', minutes: '-3' }), '--minutes');
  throws(() => makeEntry({ action: '部署', reason: 'unsupported', minutes: 'abc' }), '--minutes');
});

test('makeEntry：分钟默认 0，可选字段不填就不出现', () => {
  const e = makeEntry({ action: ' 人工部署 ', reason: 'unsupported', at: D1 });
  assert(e.action === '人工部署', '动作应去首尾空白');
  assert(e.minutes === 0, '分钟默认 0');
  assert(!('step' in e) && !('run' in e), '未填的 step/run 不应写入');
  assert(e.at === D1.toISOString(), '时间应为传入值');
});

test('append + read：往返一致，坏行跳过并计数', () => {
  const file = join(dir, 'sub', 'ledger.jsonl');
  appendEntry(file, makeEntry({ action: 'A', reason: 'quality', minutes: 5, at: D1 }));
  appendEntry(file, makeEntry({ action: 'B', reason: 'external', minutes: '2.5', step: 's1', run: 'r1', at: D2 }));
  appendFileSync(file, 'not json\n{"at":"2026-09-22T00:00:00Z","action":"x","reason":"nope"}\n\n');
  const { entries, skipped } = readEntries(file);
  assert(entries.length === 2, `应读到 2 条，实际 ${entries.length}`);
  assert(skipped === 2, `应跳过 2 行坏数据，实际 ${skipped}`);
  assert(entries[1].minutes === 2.5 && entries[1].step === 's1', '字段应原样读回');
  assert(readEntries(join(dir, 'missing.jsonl')).entries.length === 0, '文件不存在应返回空');
});

// ── 运行目录 ──
const out = join(dir, 'ao-output');
mkdirSync(out, { recursive: true });

// 运行 1：工作流文件还在 → 按文件里的 type 认人工节点（即使该步写了 role 也按 type）
const wf = join(dir, 'wf.yaml');
writeFileSync(wf, `name: t
steps:
  - id: a
    role: product/product-manager
    task: x
  - id: gate
    type: approval
    role: company/chief-executive-officer
    prompt: ok?
  - id: b
    role: engineering/engineering-software-architect
    task: y
  - id: c
    role: engineering/engineering-software-architect
    task: z
`);
mkdirSync(join(out, 'run1'));
writeFileSync(join(out, 'run1', 'metadata.json'), JSON.stringify({
  name: 't', file: wf, finishedAt: D1.toISOString(), success: false,
  totalTokens: { input: 100, output: 900 },
  steps: [
    { id: 'a', role: 'product/product-manager', status: 'completed' },
    { id: 'gate', role: 'company/chief-executive-officer', status: 'completed' },
    { id: 'b', role: 'engineering/engineering-software-architect', status: 'failed' },
    { id: 'c', role: 'engineering/engineering-software-architect', status: 'skipped' },
  ],
}));

// 运行 2：工作流文件已不在 → 启发式：无角色且无产物 = 人工节点；图片步骤无角色但有产物 = AI
mkdirSync(join(out, 'run2'));
writeFileSync(join(out, 'run2', 'metadata.json'), JSON.stringify({
  name: 'u', file: join(dir, 'gone.yaml'), finishedAt: D2.toISOString(), success: true,
  totalTokens: { input: 0, output: 500 },
  steps: [
    { id: 'w', role: 'marketing/marketing-content-creator', status: 'completed', iterations: 2 },
    { id: 'img', status: 'completed', imageAsset: 'img.png' },
    { id: 'ask', status: 'completed' },
  ],
}));

// 干扰项：没有 metadata 的目录、坏 JSON、缺 finishedAt、账本文件本身
mkdirSync(join(out, 'empty'));
mkdirSync(join(out, 'broken'));
writeFileSync(join(out, 'broken', 'metadata.json'), '{oops');
mkdirSync(join(out, 'nofinish'));
writeFileSync(join(out, 'nofinish', 'metadata.json'), JSON.stringify({ name: 'n', steps: [] }));
writeFileSync(join(out, 'ledger.jsonl'), '');

// 运行 3：resume 续跑——复用的步骤不能再算一遍（新档案带 reused；旧档案是 0.0s + 0 token）
mkdirSync(join(out, 'run3'));
writeFileSync(join(out, 'run3', 'metadata.json'), JSON.stringify({
  name: 'u', file: join(dir, 'gone.yaml'), finishedAt: D2.toISOString(), success: true,
  totalTokens: { input: 5, output: 5 },
  steps: [
    { id: 'w', role: 'marketing/marketing-content-creator', status: 'completed', reused: true, duration: '0.0s', tokens: { input: 0, output: 0 } },
    { id: 'old', role: 'marketing/marketing-content-creator', status: 'completed', duration: '0.0s', tokens: { input: 0, output: 0 } },
    { id: 'redo', role: 'marketing/marketing-content-creator', status: 'completed', duration: '1.2s', tokens: { input: 5, output: 5 } },
  ],
}));

test('readRuns：只认有效运行目录，失败/跳过的步骤不计', () => {
  const runs = readRuns(out).sort((a, b) => a.dir.localeCompare(b.dir));
  assert(runs.length === 3, `应读到 3 次运行，实际 ${runs.length}`);
  const [r1, r2, r3] = runs;
  assert(r3.aiSteps === 1 && r3.humanSteps === 0, `run3 复用的 2 步不计，只计重跑的 1 步，实际 AI ${r3.aiSteps} / 人工 ${r3.humanSteps}`);
  assert(r1.aiSteps === 1 && r1.humanSteps === 1, `run1 应 AI 1 / 人工 1，实际 ${r1.aiSteps}/${r1.humanSteps}`);
  assert(r1.tokens === 1000 && r1.success === false, 'run1 token 与状态');
  // w 在循环里跑了 2 次（iterations: 2）按 2 计；img 1 次
  assert(r2.aiSteps === 3 && r2.humanSteps === 1, `run2 应 AI 3 / 人工 1，实际 ${r2.aiSteps}/${r2.humanSteps}`);
  assert(readRuns(join(dir, 'nope')).length === 0, '目录不存在应返回空');
});

const entries = [
  makeEntry({ action: '人工部署', reason: 'unsupported', minutes: 20, at: D1 }),
  makeEntry({ action: '发外联 | 20 封\n第二行', reason: 'external', minutes: 30, run: 'run2', at: D2 }),
  makeEntry({ action: '区间外', reason: 'quality', minutes: 99, at: D3 }),
];

test('summarize：按天汇总，自主率 = AI ÷ (AI + 人工节点 + 手记)', () => {
  const s = summarize(entries, readRuns(out));
  assert(s.rows.length === 3, `应有 3 天，实际 ${s.rows.length}`);
  // AI 5（run1 1 + run2 3 + run3 1）；人工节点 2；手记 3 → 5 / 10
  assert(s.total.aiSteps === 5 && s.total.humanSteps === 2 && s.total.manual === 3, '合计次数');
  assert(s.total.minutes === 149 && s.total.tokens === 1510 && s.total.failedRuns === 1, '合计耗时/token/失败');
  assert(Math.abs((s.autonomy ?? 0) - 5 / 10) < 1e-9, `自主率应为 5/10，实际 ${s.autonomy}`);
  assert(s.byReason.unsupported === 1 && s.byReason.external === 1 && s.byReason.quality === 1, '原因分布');
});

test('summarize：since/until 为闭区间，区间外的运行和手记都不计', () => {
  const s = summarize(entries, readRuns(out), { since: localDay(D1.toISOString()), until: localDay(D2.toISOString()) });
  assert(s.rows.length === 2, `应有 2 天，实际 ${s.rows.length}`);
  assert(s.total.manual === 2 && s.byReason.quality === 0, '区间外手记不应计入');
  assert(Math.abs((s.autonomy ?? 0) - 5 / 9) < 1e-9, `自主率应为 5/9，实际 ${s.autonomy}`);
  assert(s.entries.length === 2, '明细只含区间内');
});

test('summarize：什么都没有时自主率为 null，不假装 100%', () => {
  const s = summarize([], []);
  assert(s.autonomy === null, '应为 null');
  assert(formatAutonomy(null).includes('没有任何记录'), '应明说没有记录');
});

test('formatReport：含表头、合计、口径说明，明细转义竖线与换行', () => {
  const md = formatReport(summarize(entries, readRuns(out)));
  assert(md.includes('| 日期 | 运行（失败） |'), '应有表头');
  assert(md.includes('**合计**'), '应有合计行');
  assert(md.includes('AI 自主率：50.0%'), `应显示 50.0%`);
  assert(md.includes('按次数算，不按工作量'), '必须带口径说明');
  assert(md.includes('发外联 \\| 20 封 第二行'), '竖线应转义、换行应压成空格');
  assert(md.includes('| 对外操作 | 1 |'), '原因表');
});

test('assertDay：只收 YYYY-MM-DD', () => {
  assert(assertDay('2026-09-22', '--since') === '2026-09-22', '合法日期原样返回');
  assert(assertDay(undefined, '--since') === undefined, '未填返回 undefined');
  throws(() => assertDay('9/22', '--since'), 'YYYY-MM-DD');
});

console.log(`\n  ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
