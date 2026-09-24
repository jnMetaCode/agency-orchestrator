/**
 * 多智能体 vs 单次基线 —— 对比 / 盲评核心库。
 *
 * 回答 AO 的核心假设："多角色 DAG 协作的产出，是否真的比用户自己写一句 prompt 更好。"
 * 由 eval CLI（eval/run-eval.ts）、编程 API（src/index.ts）、`ao run --compare`、网页 Studio 共用，
 * 避免逻辑分叉。方法学见 EVAL_FINDINGS.md：双向盲评取平均以抵消 LLM 评审的位置偏置。
 */
import { createConnector } from '../connectors/factory.js';
import { deliverableSteps, type LLMConfig, type WorkflowResult } from '../types.js';

// 截断上限要足够大：太小会把更长/更完整产出的尾部（常含结论）切掉，系统性惩罚长产出，
// 而"完整性"正是要评的维度。强 judge 可吃数万字。
const JUDGE_TRUNC = 20000;
const trunc = (s: string) => (s.length > JUDGE_TRUNC ? s.slice(0, JUDGE_TRUNC) + '\n…[截断]' : s);

/** 最终成品：工作流声明的 deliverables（多个则拼接），没声明就是最后一个"已完成且有产出"的步骤。 */
export function finalOutput(result: WorkflowResult): string {
  return deliverableSteps(result).map((s) => String(s.output)).join('\n\n---\n\n');
}

/** 把工作流目标+输入合成"单次直接要成品"的基线 prompt（模拟用户不用 ao 的写法）。 */
export function buildBaselineTask(
  name: string,
  description: string | undefined,
  inputs: Record<string, string>,
): string {
  const inputLines = Object.entries(inputs)
    .map(([k, v]) => `- ${k}：${v}`)
    .join('\n');
  return [
    `任务目标：${description || name}`,
    inputLines ? `\n输入信息：\n${inputLines}` : '',
    '\n请直接产出最终成品（完整、可直接交付），不要输出过程、大纲或说明文字。',
  ].join('');
}

/** 跑单次基线：一个"强助手"system + 合成任务，返回产出文本（模拟用户一句话直接要成品）。 */
export async function runBaseline(genLlm: LLMConfig, baselineTask: string): Promise<string> {
  const conn = createConnector(genLlm);
  const res = await conn.chat('你是能力很强的助手，直接产出高质量的最终成品。', baselineTask, genLlm);
  return res.content;
}

/**
 * 把对比的三段产物排成一份可存档的 markdown。
 *
 * 为什么必须存档：单次基线是**真跑一次**、盲评是再跑两次，钱都花了，但此前它们只出现在终端里
 * ——窗口一滚就没了，run 目录里连一个字都没有（`ao report` 也无从渲染）。更别扭的是终端还写着
 * "完整产出见 ao-output"，而那里根本没有。引擎别处（媒体暂存、取消后仍存档）遵守的都是同一条：
 * 付过钱的产物不能丢。
 */
export function formatCompareArchive(r: {
  baselineTask: string;
  baselineOutput: string;
  multiOutput: string;
  verdict: CompareVerdict | null;
}): string {
  const L: string[] = ['# 多智能体 vs 单次基线', ''];
  if (r.verdict) {
    const v = r.verdict;
    const mark = v.winner === 'multi-agent' ? '多智能体胜' : v.winner === 'baseline' ? '单次基线胜' : '打平';
    L.push(`- 评审：多智能体 **${v.multiScore.toFixed(1)}** / 单次基线 **${v.baseScore.toFixed(1)}** → **${mark}**（${v.consistent ? '双向一致，高可信' : '双向矛盾，低可信：疑位置偏置'}）`);
    for (const reason of v.reasons) if (reason) L.push(`  - ${reason}`);
  } else {
    L.push('- 评审：无结论（judge 未返回有效 JSON，或对比被取消）。两份产出仍可人工对比。');
  }
  L.push(`- 产出长度：多智能体 ${r.multiOutput.length} 字 / 单次基线 ${r.baselineOutput.length} 字`, '');
  L.push('## 单次基线用的提示词', '', '```text', r.baselineTask, '```', '');
  L.push('## 单次基线产出（完整）', '', r.baselineOutput || '（空）', '');
  L.push('## 多智能体产出（完整，另见 steps/ 与 summary.md）', '', r.multiOutput || '（空）', '');
  return L.join('\n');
}

export interface JudgeScore {
  scoreA: number;
  scoreB: number;
  reason: string;
}

/** 从 judge 回复里抽出 JSON 分数（judge 偶尔会包代码块/加解释，宽松匹配第一个 {...}）。 */
export function parseJudge(raw: string): JudgeScore | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const a = Number(j.scoreA);
    const b = Number(j.scoreB);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return { scoreA: a, scoreB: b, reason: String(j.reason || '').slice(0, 200) };
  } catch {
    return null;
  }
}

/** 单向评审一次：A、B 两份产出对同一任务打分。解析失败重试一次。
 *  acceptance 非空时作为首要评分锚点（工作流声明的验收标准，两份产出用同一把尺）。 */
export async function judgeOnce(
  judgeLlm: LLMConfig,
  taskDesc: string,
  outA: string,
  outB: string,
  acceptance?: string,
): Promise<JudgeScore | null> {
  const conn = createConnector(judgeLlm);
  const prompt = [
    '你是严格、客观的内容质量评审。下面是针对同一任务的两份产出，请对比。',
    `任务：${taskDesc}`,
    ...(acceptance ? ['', `交付验收标准（首要评判依据，逐条核对两份产出是否满足）：\n${acceptance}`] : []),
    '', '【产出 A】', trunc(outA), '', '【产出 B】', trunc(outB), '',
    acceptance
      ? '评判维度：验收标准满足度优先，其次完整性、具体性、可用性、是否直接可交付。'
      : '评判维度：完整性、具体性、可用性、是否直接可交付。',
    '只输出一行 JSON，不要任何额外文字：{"scoreA": 1-10, "scoreB": 1-10, "reason": "一句话理由"}',
  ].join('\n');
  for (let attempt = 0; attempt < 2; attempt++) {
    const sys = attempt === 0
      ? '你是严格客观的评审，只输出 JSON。'
      : '你必须只输出一行纯 JSON，绝对不要代码块标记、前言或任何解释文字。';
    const res = await conn.chat(sys, prompt, { ...judgeLlm, max_tokens: 400 });
    const parsed = parseJudge(res.content);
    if (parsed) return parsed;
  }
  return null;
}

export interface CompareVerdict {
  multiScore: number;
  baseScore: number;
  winner: 'multi-agent' | 'baseline' | 'tie';
  /** 双向盲评是否同向；false 多半是 judge 位置偏置 → 该结论可信度低。 */
  consistent: boolean;
  reasons: string[];
}

/**
 * 把双向两次评审聚合成结论（纯函数，便于单测）。
 * j1 = (A=多智能体, B=基线)，j2 = (A=基线, B=多智能体)。取平均抵消位置偏置。
 */
export function aggregateVerdict(j1: JudgeScore, j2: JudgeScore): CompareVerdict {
  const multiScore = (j1.scoreA + j2.scoreB) / 2;
  const baseScore = (j1.scoreB + j2.scoreA) / 2;
  const p1 = j1.scoreA - j1.scoreB;
  const p2 = j2.scoreB - j2.scoreA;
  // 双向同向即可信：都判多智能体更好 / 都判基线更好 / 双向都判平(p1==p2==0,真平局也是一致)。
  // 仅当两向矛盾(一向说多、一向说基线)才算低可信(位置偏置)。
  const consistent = Math.sign(p1) === Math.sign(p2);
  const winner = multiScore > baseScore ? 'multi-agent' : baseScore > multiScore ? 'baseline' : 'tie';
  return { multiScore, baseScore, winner, consistent, reasons: [j1.reason, j2.reason].filter(Boolean) };
}

/**
 * 双向盲评对比：对 (多智能体, 基线) 正反各评一次取平均。
 * judge 解析失败返回 null（调用方决定跳过/重试）。
 */
export async function compareOutputs(
  judgeLlm: LLMConfig,
  taskDesc: string,
  multiOutput: string,
  baselineOutput: string,
  acceptance?: string,
): Promise<CompareVerdict | null> {
  const j1 = await judgeOnce(judgeLlm, taskDesc, multiOutput, baselineOutput, acceptance); // A=multi, B=base
  const j2 = await judgeOnce(judgeLlm, taskDesc, baselineOutput, multiOutput, acceptance); // A=base,  B=multi
  if (!j1 || !j2) return null;
  return aggregateVerdict(j1, j2);
}
