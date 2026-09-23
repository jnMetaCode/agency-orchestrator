/**
 * 两个"不出错、只是悄悄给错结果"的地方：
 *  - isNewer 把预发布排在同号正式版**之前**：跑 @next 的用户永远收不到「有正式版了」，
 *    而一旦预发布被推到 latest 标签，所有正式版用户都会被劝去"升级"到更旧的东西；
 *  - 运行目录时间戳只到秒：同一秒跑完的两次同名工作流写进同一个目录，后一次把前一次盖掉
 *    （Studio 允许并行跑，所以不是假想）。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isNewer } from '../src/utils/version-check.js';
import { saveResults } from '../src/output/reporter.js';
import type { WorkflowResult } from '../src/types.js';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; }
}

console.log('\n─── 版本比较：预发布排在正式版之前 ───');
for (const [a, b, want] of [
  ['0.19.0-beta.1', '0.19.0', false],   // 预发布不比正式版新
  ['0.20.0', '0.20.0-rc.1', true],      // 正式版比同号预发布新
  ['0.20.0', '0.19.9', true],
  ['0.19.2', '0.19.2', false],
  ['1.0.0-rc.1', '0.9.9', true],        // 跨主版本：预发布仍然更新
] as [string, string, boolean][]) {
  assert(isNewer(a, b) === want, `${a} > ${b} = ${want}`);
}

console.log('\n─── 同一秒的两次运行不互相覆盖 ───');
{
  const out = mkdtempSync(join(tmpdir(), 'ao-rundir-'));
  const mk = (n: number) => ({
    name: '同名工作流',
    steps: [{ id: 'a', role: 'r', status: 'completed', output: `第${n}次`, duration: 1, tokens: { input: 0, output: 0 } }],
    totalDuration: 1, totalTokens: { input: 0, output: 0 }, completedSteps: 1, totalSteps: 1, success: true,
  } as unknown as WorkflowResult);
  const d1 = saveResults(mk(1), out);
  const d2 = saveResults(mk(2), out);
  assert(d1 !== d2, `两次落到不同目录（${d1.split('/').pop()} / ${d2.split('/').pop()}）`);
  assert(readFileSync(join(d1, 'steps', '1-a.md'), 'utf-8').includes('第1次'), '第一次的产出没被盖掉');
  assert(readFileSync(join(d2, 'steps', '1-a.md'), 'utf-8').includes('第2次'), '第二次的产出也在');
  rmSync(out, { recursive: true, force: true });
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed > 0 ? 1 : 0);
