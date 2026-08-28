/**
 * acceptance 自动核验 —— 把验收标准从"注入 prompt 的嘱咐"变成"跑完真的有人对着查"。
 *
 * 判定口径的由来（2026-08-28，用真实模型跑了 11 次采样测出来的）：
 * 原先写的是"宁严勿松：条目只做到一部分也算未满足"。对**可数**条目（必须有 6 个文件）这是对的，
 * 但对**质性**条目（"写明了色调和光源"）它等于放任评判者无限细分——产出已经写了"暖阳侧逆光"，
 * 它仍判"未明确光源类型（自然光/人工光）"。结果是 **11/11 全部触发返工、返工后仍多数判未过**：
 * 每跑一次白付一轮返工，而且验收长期显示未过——**用户会学会无视验收**，比没有验收更糟。
 * 所以现在把"宁严勿松"限定在标准**明确枚举**的东西上，并要求判未满足时**引用产出原话**
 * （举不出原话 = 它其实满足了），从根上掐掉"发明标准里没有的要求"。
 *
 * 步骤产出后，用同一个 connector 做一次轻量核验（逐条核对验收标准），未通过则把
 * "上一版产出 + 未满足条目"拼成返工块交回同一专家改一轮（复用 --feedback 的对话式
 * 返工范式，见 executor.buildFeedbackBlock）。核验器自身故障时返回 null，调用方跳过
 * 核验并告警——检查员宕机不能拖垮生产线（与 skill 缺失"警告不致命"同一哲学）。
 */
import type { LLMConfig, LLMConnector } from '../types.js';

// 与 compare.ts 的 JUDGE_TRUNC 一致：截太短会把长产出的尾部（常含结论）切掉，
// 系统性误判"未满足"，而完整性正是常见的验收条目。
const VERIFY_TRUNC = 20000;
const trunc = (s: string, n = VERIFY_TRUNC) => (s.length > n ? s.slice(0, n) + '\n…[截断]' : s);

// 核验调用的外层超时兜底（同 executor.withTimeout 的哲学：connector 内部超时失灵时
// 不能让一次"轻量核验"挂死整条产线）。核验不值得等太久，超时按核验不可用处理。
const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
  ms <= 0 ? promise : Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`核验超时 (${ms}ms)`)), ms).unref?.()),
  ]);

export interface VerifyVerdict {
  pass: boolean;
  /** 未满足的条目（criterion=哪条标准，why=一句话原因） */
  failed: { criterion: string; why: string }[];
}

/** 从核验回复里抽出 JSON 结论（同 compare.parseJudge：宽松匹配第一个 {...}）。 */
export function parseVerify(raw: string): VerifyVerdict | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    if (typeof j.pass !== 'boolean') return null;
    const failed = Array.isArray(j.failed)
      ? j.failed
          .map((f: unknown) => {
            const o = (f ?? {}) as Record<string, unknown>;
            // 压平内嵌换行：criterion/why 的每个下游消费方（CLI ⚠️ 行、步骤文件头引用块、
            // SSE 逐行解析）都按单行处理，换行会逃出引用块/被误判为正文
            const flat = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
            return { criterion: flat(o.criterion), why: flat(o.why) };
          })
          .filter((f: { criterion: string; why: string }) => f.criterion || f.why)
      : [];
    // pass=false 却给不出任何未满足条目 → 无法指导返工，也没法向用户解释"哪里没过"，
    // 视为本次核验不可用（触发第二次尝试/跳过），别带着空清单去返工
    if (j.pass !== true && failed.length === 0) return null;
    // 保守裁决：模型说 pass 但又列了未满足条目 → 以条目为准，算未通过
    return { pass: j.pass === true && failed.length === 0, failed };
  } catch {
    return null;
  }
}

/**
 * 核验一份产出是否满足验收标准。返回 verdict=null 表示核验不可用
 * （网络错误 / 两次都解析失败），调用方应跳过核验而非判失败。
 * tokens 为核验本身消耗的用量（无论成败都如实上报，计入该步成本）。
 */
export async function verifyAcceptance(
  connector: LLMConnector,
  llm: LLMConfig,
  taskDesc: string,
  output: string,
  acceptance: string,
): Promise<{ verdict: VerifyVerdict | null; tokens: { input: number; output: number } }> {
  const zh = /[一-鿿]/.test(acceptance);
  const prompt = zh
    ? [
        '你是严格的交付验收员。逐条核对下面的产出是否满足验收标准。',
        '判定口径（很重要）：',
        '- **只按标准写了的字面要求判**。标准没写的细节不算缺失——不要发明标准里没有的更严要求。',
        '- 产出用不同措辞满足了同一条标准的意图，就算满足；不要求字句对上。',
        '- 标准里**明确枚举**的东西（数量、必须出现的段落/字段）只做到一部分算未满足。',
        '- 判"未满足"时，why 里必须**引用产出中的原话**说明它为什么不满足；举不出原话就说明它其实满足了。',
        `任务：${trunc(taskDesc, 2000)}`,
        '', '验收标准：', acceptance,
        '', '待验收产出：', trunc(output), '',
        '只输出一行 JSON，不要任何额外文字：{"pass": true/false, "failed": [{"criterion": "未满足的条目原文", "why": "一句话原因"}]}',
        '全部满足时 failed 必须是空数组 []。',
      ].join('\n')
    : [
        'You are a strict acceptance reviewer. Check the deliverable against EACH criterion.',
        'How to judge (important):',
        '- Judge ONLY what a criterion literally asks for. Details it never mentions are not gaps — do not invent stricter requirements.',
        '- Different wording that meets the criterion\'s intent counts as met; exact phrasing is not required.',
        '- For things a criterion explicitly ENUMERATES (counts, required sections/fields), partially met counts as NOT met.',
        '- When marking something unmet, `why` MUST quote the deliverable\'s own words showing why. If you cannot quote, it is met.',
        `Task: ${trunc(taskDesc, 2000)}`,
        '', 'Acceptance criteria:', acceptance,
        '', 'Deliverable under review:', trunc(output), '',
        'Output exactly one line of JSON, nothing else: {"pass": true/false, "failed": [{"criterion": "the unmet criterion", "why": "one-sentence reason"}]}',
        'If all criteria are met, failed MUST be an empty array [].',
      ].join('\n');

  const tokens = { input: 0, output: 0 };
  // 结论 JSON 要逐字回抄未满足条目原文——上限必须随验收标准长度伸缩，
  // 否则条目越多/越长（恰恰是最差的产出）越容易截断 JSON、核验静默失效
  const maxTokens = Math.min(2000, 500 + Math.ceil(acceptance.length * 1.2));
  // 两次尝试：第二次换更严厉的 system 逼纯 JSON（同 compare.judgeOnce 的成熟套路）
  for (let attempt = 0; attempt < 2; attempt++) {
    const sys = attempt === 0
      ? (zh ? '你是严格客观的验收员，只输出 JSON。' : 'You are a strict, objective reviewer. Output JSON only.')
      : (zh ? '你必须只输出一行纯 JSON，绝对不要代码块标记、前言或任何解释文字。'
            : 'You MUST output exactly one line of raw JSON. No code fences, no preamble, no explanation.');
    try {
      const res = await withTimeout(
        connector.chat(sys, prompt, { ...llm, max_tokens: maxTokens, temperature: 0 }),
        llm.timeout || 600_000,
      );
      tokens.input += res.usage.input_tokens;
      tokens.output += res.usage.output_tokens;
      const verdict = parseVerify(res.content);
      if (verdict) return { verdict, tokens };
    } catch {
      // 网络/超时等：核验不可用 → null，不再重试（生成主链路自有完整 retry，核验不值得等）
      return { verdict: null, tokens };
    }
  }
  return { verdict: null, tokens };
}

/** 把未满足条目格式化成人读字符串列表（StepVerification.failed / CLI·summary 展示共用一份）。 */
export function formatFailedItems(failed: { criterion: string; why: string }[]): string[] {
  return failed.map(f => {
    if (f.criterion && f.why) {
      const zh = /[一-鿿]/.test(f.criterion + f.why);
      return zh ? `${f.criterion}（${f.why}）` : `${f.criterion} (${f.why})`;
    }
    return f.criterion || f.why;
  });
}

/**
 * 构造"验收返工"追加块：结构同 buildFeedbackBlock（上一版产出 + 意见 → 原稿基础上改），
 * 措辞换成验收口吻——只补齐/修正未满足项，保留已达标部分。
 */
export function buildReworkBlock(
  failed: { criterion: string; why: string }[],
  previousOutput: string,
): string {
  const zh = /[一-鿿]/.test(failed.map(f => `${f.criterion}${f.why}`).join('') + previousOutput.slice(0, 200));
  const items = failed
    .map((f, i) => `${i + 1}. ${f.criterion || f.why}${f.criterion && f.why ? (zh ? `（${f.why}）` : ` (${f.why})`) : ''}`)
    .join('\n');
  if (zh) {
    return [
      '\n\n---\n',
      '以下是你上一版的产出，请在此基础上修改，不要从零重写：\n\n',
      previousOutput.trim(),
      '\n\n---\n',
      '验收核对发现以下条目未满足：\n\n',
      items,
      '\n\n请严格针对上述未满足项修改：保留已达标的部分，只补齐/修正未满足的地方，直接输出修改后的完整结果。',
    ].join('');
  }
  return [
    '\n\n---\n',
    'Below is your previous deliverable. Revise it in place — do NOT rewrite from scratch:\n\n',
    previousOutput.trim(),
    '\n\n---\n',
    'Acceptance review found the following criteria NOT met:\n\n',
    items,
    '\n\nRevise strictly against the unmet items above: keep what already passes, fix only what falls short, and output the complete revised result.',
  ].join('');
}
