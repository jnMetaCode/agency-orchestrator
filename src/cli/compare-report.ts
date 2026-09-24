/** `ao run --compare` 的终端报告格式化（纯函数，便于单测）。 */
import type { CompareVerdict } from '../core/compare.js';

export interface CompareReportInput {
  multiOutput: string;
  baselineOutput: string;
  verdict: CompareVerdict | null;
  /** 本次运行的存档目录（基线产出与结论写在它的 compare.md 里）；没有就不提 */
  outputDir?: string;
}

const PREVIEW = 800;
// 截断处必须指到**真的存得下**的地方：以前写"完整产出见 ao-output"，而基线产出压根没存过盘。
const preview = (s: string, where: string) => (s.length > PREVIEW ? s.slice(0, PREVIEW) + `\n…[省略，完整产出见 ${where}]` : s);

/** 把对比结果格式化成终端可读的报告块。 */
export function formatCompareReport(r: CompareReportInput): string {
  const L: string[] = ['', '═'.repeat(50), '  多智能体 vs 单次基线'];

  if (!r.verdict) {
    L.push('  ⚠️ 评审解析失败，无法给出可信评分（judge 未返回有效 JSON）。');
    L.push('  两份产出仍可人工对比：多智能体见上方 / ao-output，单次基线见下。');
  } else {
    const v = r.verdict;
    const mark = v.winner === 'multi-agent' ? '✅ 多智能体胜' : v.winner === 'baseline' ? '❌ 单次基线胜' : '➖ 打平';
    const conf = v.consistent ? '高可信' : '低可信(疑位置偏置)';
    L.push(`  评审: 多智能体 ${v.multiScore.toFixed(1)} | 单次基线 ${v.baseScore.toFixed(1)} → ${mark}（${conf}）`);
    for (const reason of v.reasons) if (reason) L.push(`    · ${reason}`);
  }

  L.push(`  产出长度: 多智能体 ${r.multiOutput.length} 字 / 单次基线 ${r.baselineOutput.length} 字`);
  L.push('─'.repeat(50));
  const archive = r.outputDir ? `${r.outputDir}/compare.md` : 'ao-output';
  L.push('  单次基线产出（多智能体产出见上方 / ao-output）:');
  L.push(preview(r.baselineOutput, archive) || '  (空)');
  if (r.outputDir) L.push('─'.repeat(50), `  📄 基线产出与评审结论已存档：${archive}`);
  L.push('═'.repeat(50), '');
  return L.join('\n');
}
