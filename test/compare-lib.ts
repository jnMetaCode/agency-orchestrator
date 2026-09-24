/**
 * 对比核心库 src/core/compare.ts 的纯函数测试。
 * LLM 相关(runBaseline/judgeOnce/compareOutputs)需真实模型，不在单测覆盖；
 * 这里测可纯函数验证的：基线 prompt 合成、judge JSON 解析、双向评审聚合。
 */
import { buildBaselineTask, parseJudge, aggregateVerdict, finalOutput } from '../src/core/compare.js';
import { formatCompareReport } from '../src/cli/compare-report.js';
import { formatCompareArchive } from '../src/core/compare.js';
import type { WorkflowResult } from '../src/types.js';

let passed = 0, failed = 0;
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (err) { console.log(`  ❌ ${name}: ${err instanceof Error ? err.message : err}`); failed++; }
}
function assert(c: boolean, m: string): void { if (!c) throw new Error(m); }

console.log('\n─── compare 核心库 ───');

// ── buildBaselineTask ──
test('基线 prompt 含目标/输入/直接产出指令', () => {
  const t = buildBaselineTask('写故事', '写一个科幻短篇', { theme: '时间旅行', length: '2000字' });
  assert(t.includes('科幻短篇'), '应含 description');
  assert(t.includes('- theme：时间旅行') && t.includes('- length：2000字'), '应逐条列输入');
  assert(t.includes('直接产出最终成品'), '应要求直接产出成品');
});
test('无 description 时回退到 name；无输入不加输入段', () => {
  const t = buildBaselineTask('我的工作流', undefined, {});
  assert(t.includes('任务目标：我的工作流'), '应回退到 name');
  assert(!t.includes('输入信息'), '无输入不应有输入段');
});

// ── parseJudge ──
test('解析纯 JSON 分数', () => {
  const r = parseJudge('{"scoreA": 8, "scoreB": 6, "reason": "A 更完整"}');
  assert(!!r && r.scoreA === 8 && r.scoreB === 6 && r.reason === 'A 更完整', `解析错误: ${JSON.stringify(r)}`);
});
test('从包裹文字/代码块里抠出 JSON', () => {
  const r = parseJudge('这是我的评分：\n```json\n{"scoreA": 5, "scoreB": 9}\n```\n谢谢');
  assert(!!r && r.scoreA === 5 && r.scoreB === 9, `应能抠出 JSON, 实际: ${JSON.stringify(r)}`);
});
test('无效/缺分数返回 null', () => {
  assert(parseJudge('没有 json') === null, '无 JSON 应 null');
  assert(parseJudge('{"scoreA": "x", "scoreB": 3}') === null, '非数字分数应 null');
});
test('reason 截断到 200 字', () => {
  const r = parseJudge(`{"scoreA":7,"scoreB":7,"reason":"${'长'.repeat(300)}"}`);
  assert(!!r && r.reason.length === 200, `reason 应截到 200, 实际 ${r?.reason.length}`);
});

// ── aggregateVerdict（双向盲评聚合，纯函数）──
test('双向都判多智能体更高 → 多智能体胜 + 高可信', () => {
  // j1: A=multi 9 > B=base 6；j2: A=base 5 < B=multi 8 → 两向都说 multi 更好
  const v = aggregateVerdict({ scoreA: 9, scoreB: 6, reason: 'r1' }, { scoreA: 5, scoreB: 8, reason: 'r2' });
  assert(v.winner === 'multi-agent', `应多智能体胜, 实际 ${v.winner}`);
  assert(v.multiScore === (9 + 8) / 2 && v.baseScore === (6 + 5) / 2, `分数平均错: ${v.multiScore}/${v.baseScore}`);
  assert(v.consistent === true, '双向同向应高可信');
  assert(v.reasons.length === 2, '应收集两条理由');
});
test('双向都判基线更高 → 基线胜', () => {
  const v = aggregateVerdict({ scoreA: 5, scoreB: 8, reason: '' }, { scoreA: 9, scoreB: 6, reason: '' });
  assert(v.winner === 'baseline', `应基线胜, 实际 ${v.winner}`);
});
test('双向都判平局 → 高可信(真平局也是一致,非位置偏置)', () => {
  const v = aggregateVerdict({ scoreA: 7, scoreB: 7, reason: '' }, { scoreA: 7, scoreB: 7, reason: '' });
  assert(v.winner === 'tie', `应平局, 实际 ${v.winner}`);
  assert(v.consistent === true, '双向都判平应算高可信(判官一致)');
});
test('两向矛盾(位置偏置) → 低可信', () => {
  // j1: A=multi 8 > B=base 6 (说 multi 好)；j2: A=base 8 > B=multi 6 (也说"A"好=base 好) → 矛盾
  const v = aggregateVerdict({ scoreA: 8, scoreB: 6, reason: '' }, { scoreA: 8, scoreB: 6, reason: '' });
  assert(v.consistent === false, '两向矛盾应低可信');
});

// ── finalOutput ──
test('取最后一个有产出的已完成步骤', () => {
  const r = {
    steps: [
      { id: 'a', status: 'completed', output: '草稿' },
      { id: 'b', status: 'completed', output: '终稿' },
      { id: 'c', status: 'skipped' },
    ],
  } as unknown as WorkflowResult;
  assert(finalOutput(r) === '终稿', `应取终稿, 实际 ${finalOutput(r)}`);
});

test('声明了 deliverables 就按声明取，而不是最后一步', () => {
  // 小说线：定稿之后还挂了一步"编辑复盘"——盲评该评定稿，不该评复盘
  const r = {
    deliverables: ['final'],
    steps: [
      { id: 'outline', status: 'completed', output: '大纲' },
      { id: 'final', status: 'completed', output: '定稿' },
      { id: 'retro', status: 'completed', output: '复盘' },
    ],
  } as unknown as WorkflowResult;
  assert(finalOutput(r) === '定稿', `应取声明的交付物, 实际 ${finalOutput(r)}`);
  const multi = { ...r, deliverables: ['outline', 'final'] } as unknown as WorkflowResult;
  assert(finalOutput(multi) === '大纲\n\n---\n\n定稿', '多个交付物按步骤顺序拼接');
  const missed = { ...r, deliverables: ['nope'] } as unknown as WorkflowResult;
  assert(finalOutput(missed) === '复盘', '声明的都没产出 → 退回最后一个完成步');
});

// ── formatCompareReport（CLI 报告，纯函数）──
test('报告含胜者/分数/理由', () => {
  const out = formatCompareReport({
    multiOutput: 'm'.repeat(3200), baselineOutput: 'b'.repeat(1100),
    verdict: { multiScore: 8.2, baseScore: 5.7, winner: 'multi-agent', consistent: true, reasons: ['多智能体更完整'] },
  });
  assert(out.includes('✅ 多智能体胜') && out.includes('8.2') && out.includes('5.7'), '应含胜者与分数');
  assert(out.includes('多智能体更完整'), '应含理由');
  assert(out.includes('3200') && out.includes('1100'), '应含长度');
});
test('verdict 为 null 时报告说明评审失败', () => {
  const out = formatCompareReport({ multiOutput: 'x', baselineOutput: 'y', verdict: null });
  assert(out.includes('评审解析失败'), '应说明评审失败');
});
test('基线产出超长时截断预览', () => {
  const out = formatCompareReport({ multiOutput: 'x', baselineOutput: 'y'.repeat(2000), verdict: null });
  assert(out.includes('…[省略'), '超长基线应截断');
});

test('报告里的"完整产出见…"指向真存得下的地方', () => {
  const withDir = formatCompareReport({ multiOutput: 'x', baselineOutput: 'y'.repeat(2000), verdict: null, outputDir: '/runs/r1' });
  assert(withDir.includes('/runs/r1/compare.md'), `截断处指向存档文件（实际：${withDir.split('\n').find((l) => l.includes('省略'))?.slice(0, 60)}）`);
  assert(withDir.includes('已存档'), '并单独说一句存档在哪');
  const noDir = formatCompareReport({ multiOutput: 'x', baselineOutput: 'y'.repeat(2000), verdict: null });
  assert(!noDir.includes('已存档'), '没有存档目录时不提（不许承诺不存在的文件）');
});

// ── formatCompareArchive（存档正文，纯函数）──
test('存档含结论、基线提示词与两份完整产出', () => {
  const md = formatCompareArchive({
    baselineTask: '任务目标：写一篇稿',
    baselineOutput: 'b'.repeat(5000),
    multiOutput: 'm'.repeat(4000),
    verdict: { multiScore: 8.2, baseScore: 5.7, winner: 'multi-agent', consistent: true, reasons: ['更完整'] },
  });
  assert(md.includes('8.2') && md.includes('5.7') && md.includes('多智能体胜') && md.includes('更完整'), '结论与理由都在');
  assert(md.includes('任务目标：写一篇稿'), '基线用的提示词也存下来（不然复现不了这次对比）');
  assert(md.includes('b'.repeat(5000)) && md.includes('m'.repeat(4000)), '两份产出存全文，不截断——终端才截断');
});
test('没有结论时存档说明无结论，不假装有', () => {
  const md = formatCompareArchive({ baselineTask: 't', baselineOutput: 'b', multiOutput: 'm', verdict: null });
  assert(md.includes('无结论'), '写明无结论');
  assert(md.includes('b') && md.includes('m'), '产出照存（钱已经花了）');
});

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
