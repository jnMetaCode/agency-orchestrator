/**
 * 评测门禁纯逻辑单测 + 黄金任务集有效性校验。
 */
import { decideGate, DEFAULT_THRESHOLDS, type EvalSummary } from '../eval/gate.js';
import { GOLDEN_TASKS } from '../eval/golden-tasks.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

let passed = 0, failed = 0;
function assert(c: boolean, msg: string): void { if (!c) throw new Error(msg); }
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.log(`  ❌ ${name}: ${e instanceof Error ? e.message : e}`); failed++; }
}

const S = (o: Partial<EvalSummary>): EvalSummary =>
  ({ evaluated: 0, multiWins: 0, baseWins: 0, ties: 0, reliable: 0, ...o });

console.log('\n=== 评测门禁逻辑 ===');

test('高胜率 + 高可信 → PASS', () => {
  const r = decideGate(S({ evaluated: 9, multiWins: 7, reliable: 8 }));
  assert(r.pass && !r.inconclusive, `应 PASS，实际 ${JSON.stringify(r)}`);
});

test('低胜率 → FAIL（非 inconclusive）', () => {
  const r = decideGate(S({ evaluated: 9, multiWins: 3, reliable: 8 }));
  assert(!r.pass && !r.inconclusive, '应 FAIL 且非 inconclusive');
  assert(r.reasons.some(x => x.includes('胜率')), '原因应含胜率');
});

test('judge 可信度低 → INCONCLUSIVE（不放行）', () => {
  const r = decideGate(S({ evaluated: 9, multiWins: 9, reliable: 2 }));
  assert(!r.pass && r.inconclusive, '弱 judge 应判 inconclusive 且不 pass');
  assert(r.reasons.some(x => x.includes('judge')), '原因应提示换强 judge');
});

test('零样本 → INCONCLUSIVE', () => {
  const r = decideGate(S({ evaluated: 0 }));
  assert(!r.pass && r.inconclusive, '无样本应 inconclusive');
});

test('相对基线明显回归 → FAIL', () => {
  const r = decideGate(S({ evaluated: 10, multiWins: 7, reliable: 9 }), { winRate: 0.95 });
  assert(!r.pass, '0.70 < 0.95-0.10 应判回归失败');
  assert(r.reasons.some(x => x.includes('回归')), '原因应含回归');
});

test('基线内波动不算回归 → PASS', () => {
  const r = decideGate(S({ evaluated: 10, multiWins: 8, reliable: 9 }), { winRate: 0.85 });
  assert(r.pass, '0.80 在 0.85-0.10 容忍内应 PASS');
});

test('阈值常量合理', () => {
  assert(DEFAULT_THRESHOLDS.minWinRate > 0.5, '胜率阈值应高于随机');
  assert(DEFAULT_THRESHOLDS.minReliability >= 0.5, '可信度阈值应不低于 0.5');
});

console.log('\n=== 黄金任务集有效性 ===');

test('每个黄金任务都指向真实存在的工作流文件', () => {
  const root = resolve(import.meta.dirname!, '..');
  for (const t of GOLDEN_TASKS) {
    const p = resolve(root, 'workflows', t.file);
    assert(existsSync(p), `工作流不存在: ${t.file}`);
  }
});

test('黄金任务覆盖多个类别', () => {
  const cats = new Set(GOLDEN_TASKS.map(t => t.category));
  assert(cats.size >= 4, `类别应≥4，实际 ${cats.size}`);
});

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
