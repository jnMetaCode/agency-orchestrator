/**
 * 评测回归门禁 —— 纯逻辑，便于单测；run-eval.ts 跑完后据此判 pass/fail。
 *
 * 设计要点（吸取教训：judge 太弱会给出无判别力的"平局"，绝不能被当成通过）：
 *  1. judge 可信度不足（双向盲评一致率低）→ 判 inconclusive（不可信），既不算通过也不算失败；
 *  2. 多专家胜率低于阈值 → 失败；
 *  3. 相对基线快照胜率明显下滑 → 失败（回归）。
 */

export interface EvalSummary {
  /** 有效评测的工作流数（排除报错/judge 全失败的） */
  evaluated: number;
  multiWins: number;
  baseWins: number;
  ties: number;
  /** 末次双向盲评一致（有判别力）的工作流数 */
  reliable: number;
}

export interface BaselineSnapshot {
  winRate: number;
  reliability?: number;
  date?: string;
}

export interface GateThresholds {
  /** 多专家胜率下限 = multiWins / evaluated */
  minWinRate: number;
  /** judge 可信度下限 = reliable / evaluated；低于此判 inconclusive */
  minReliability: number;
  /** 相对基线胜率允许的最大下滑 */
  maxRegression: number;
}

export const DEFAULT_THRESHOLDS: GateThresholds = {
  minWinRate: 0.6,
  minReliability: 0.6,
  maxRegression: 0.1,
};

export interface GateResult {
  pass: boolean;
  /** judge 太弱/无样本 → 结论不可信（不等于失败，但也不放行） */
  inconclusive: boolean;
  winRate: number;
  reliability: number;
  reasons: string[];
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function decideGate(
  s: EvalSummary,
  baseline: BaselineSnapshot | null = null,
  th: GateThresholds = DEFAULT_THRESHOLDS,
): GateResult {
  const reasons: string[] = [];

  if (s.evaluated <= 0) {
    return { pass: false, inconclusive: true, winRate: 0, reliability: 0, reasons: ["没有有效评测样本（可能全部报错或 judge 解析失败）"] };
  }

  const winRate = s.multiWins / s.evaluated;
  const reliability = s.reliable / s.evaluated;

  // 1) judge 可信度
  const inconclusive = reliability < th.minReliability;
  if (inconclusive) {
    reasons.push(
      `judge 判别力不足：双向盲评一致率 ${pct(reliability)} < ${pct(th.minReliability)}，结果不可信。请改用更强的 judge（设 AO_JUDGE_PROVIDER / AO_JUDGE_MODEL 指向有能力的模型）。`,
    );
  }

  // 2) 胜率阈值
  if (winRate < th.minWinRate) {
    reasons.push(`多专家胜率 ${pct(winRate)} < 阈值 ${pct(th.minWinRate)}（胜 ${s.multiWins}/${s.evaluated}）。`);
  }

  // 3) 相对基线回归
  let regressed = false;
  if (baseline && typeof baseline.winRate === "number") {
    if (winRate < baseline.winRate - th.maxRegression) {
      regressed = true;
      reasons.push(`相对基线胜率回归：${pct(winRate)} < 基线 ${pct(baseline.winRate)} − 容忍 ${pct(th.maxRegression)}。`);
    }
  }

  const pass = !inconclusive && winRate >= th.minWinRate && !regressed;
  if (pass) reasons.push(`通过：多专家胜率 ${pct(winRate)}（≥ ${pct(th.minWinRate)}），judge 可信度 ${pct(reliability)}。`);

  return { pass, inconclusive, winRate, reliability, reasons };
}

export function formatGate(r: GateResult): string {
  const head = r.inconclusive ? "⚠️ 不可信（INCONCLUSIVE）" : r.pass ? "✅ 通过（PASS）" : "❌ 失败（FAIL）";
  return [`评测门禁：${head}`, ...r.reasons.map((x) => `  - ${x}`)].join("\n");
}
