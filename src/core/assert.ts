/**
 * 机械断言 —— 不过模型、不过网络的产出结构校验。
 *
 * 为什么要有它(acceptance 已经在做验收了,为什么还要一个):
 *   `acceptance` 是**让模型去判**产出满不满足标准(见 core/verify.ts)。它擅长判内容质量,
 *   但有一整类问题它系统性抓不到——**"本该有几个"**。
 *   真实事故:一次要模型产出 6 个课节文件,它只产出了 5 个。剩下 5 个格式完好、内容也好,
 *   于是模型验收员说"满足标准",编译也通过(少一个文件的产物语法完全合法),
 *   整节内容就这么带着绿灯上线了。**同一故障在两个项目上各撞一次,两次都亮绿灯。**
 *   根因不神秘:验收员看不见"应该有 6 个"这个事实,它只看得见眼前这 5 个。
 *
 *   所以分工是:**模型审内容,脚本审结构**。数数这种事不该交给概率性的东西。
 *   这个模块只做后一半:纯函数,同样输入永远同样结论,不花 token,不会因为网络抖动"核验不可用"。
 *
 * 用法(工作流 YAML 的步骤上):
 *   - id: write
 *     task: 把这 6 节草稿转成课节文件
 *     assert:
 *       emits_files: 6                 # 产出里必须恰好有 6 个文件块(与 --materialize 同一套解析)
 *       min_bytes: 2000                # 产出最小字节数,防截断
 *       max_bytes: 660                 # 产出最大字节数,防超长(视频提示词超字数会被厂商直接拒)
 *       contains: ["## 验收清单"]       # 必须出现的字面串
 *       matches: { "^## ": 6 }         # 正则(多行模式)必须命中 6 次
 *
 * 已实测的链路(2026-08-14,走画布真实接口 POST/GET /api/workflows/graph):
 *   带 assert 的图 → 落盘 YAML → 读回画布,四个字段原样往返(含 Studio 界面不暴露的 matches);
 *   配错的 assert(空对象/字段名写错/非法正则/数字写成字符串)在**保存这一步**就被 400 挡下,
 *   响应的 errors[] 点名字段与可用取值;不写 assert 的老工作流照常保存,无回归。
 */
import { parseFileBlocks } from '../cli/materialize.js';
import { renderTemplate } from './template.js';
import type { StepAssert } from '../types.js';

export interface AssertResult {
  pass: boolean;
  failures: string[];   // 人话的未通过项,直接可进报错信息与返工提示
}

/** 字数:非空白字符数,按码点计(中文一字一计,emoji 一个算一个)。这是写作类模板说的"字数"。 */
export function countChars(text: string): number {
  return Array.from(text.replace(/\s+/g, '')).length;
}

/** min_chars / max_chars 的字符串写法:`<数字>` 或 `<数字> * <系数>`,数字位可以是 {{变量}}。 */
const CHAR_SPEC_RE = /^\s*(\d+(?:\.\d+)?)\s*(?:\*\s*(\d+(?:\.\d+)?))?\s*$/;

/** 解析期校验:非负整数,或把 {{变量}} 占位成 1 后能过 CHAR_SPEC_RE 的字符串。 */
export function isValidCharSpec(v: unknown): boolean {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0;
  if (typeof v !== 'string') return false;
  return CHAR_SPEC_RE.test(v.replace(/\{\{\s*\w+\s*\}\}/g, '1'));
}

/**
 * 运行期把 min_chars / max_chars 的字符串写法算成数字(其余字段原样)。
 * 变量为空或渲染后算不成数字 → 该条**跳过并告警**,不算失败:可选输入没填是合法状态,
 * 不该让一整步红掉;但也绝不静默——告警里带原文和渲染结果,一眼能看出是哪个变量空了。
 */
export function resolveAssert(
  spec: StepAssert,
  context: Map<string, string>,
  warn: (msg: string) => void = () => {},
): StepAssert {
  const out: StepAssert = { ...spec };
  for (const k of ['min_chars', 'max_chars'] as const) {
    const v = spec[k];
    if (typeof v !== 'string') continue;
    const rendered = renderTemplate(v, context);
    const m = rendered.match(CHAR_SPEC_RE);
    if (!m) {
      warn(`assert.${k} 「${v}」渲染后是「${rendered.trim()}」，算不成数字（引用的变量为空？），本条跳过`);
      out[k] = undefined;
      continue;
    }
    out[k] = Math.round(parseFloat(m[1]) * (m[2] ? parseFloat(m[2]) : 1));
  }
  // contains 里的 {{变量}} 同样要渲染：不渲染就是拿字面量 "{{title}}" 去产出里找，**必然找不到**——
  // 而 assert 不过是硬失败（定向返工一轮后步骤红），用户完全看不出是断言自己写错了。
  // 渲染后为空（引用的变量没填）→ 该条跳过并告警，而不是留一个空串（空串永远"包含"，等于白写）。
  if (spec.contains?.length) {
    const kept: string[] = [];
    for (const item of spec.contains) {
      if (!item.includes('{{')) { kept.push(item); continue; }
      const rendered = renderTemplate(item, context).trim();
      if (!rendered) { warn(`assert.contains 「${item}」渲染后是空的（引用的变量为空？），本条跳过`); continue; }
      kept.push(rendered);
    }
    out.contains = kept;
  }
  return out;
}

/** 把 matches 的键编译成正则。默认多行(^ $ 按行),这样 "^## " 才是常识里的意思。 */
function toRegExp(pattern: string): RegExp {
  // 支持 /.../flags 写法;否则按裸模式处理,默认加 g+m
  const m = pattern.match(/^\/(.*)\/([gimsuy]*)$/);
  if (m) {
    const flags = m[2].includes('g') ? m[2] : m[2] + 'g';
    return new RegExp(m[1], flags);
  }
  return new RegExp(pattern, 'gm');
}

function countMatches(text: string, pattern: string): number {
  const re = toRegExp(pattern);
  let n = 0;
  // 用 matchAll 而不是 text.match(re).length:后者在 re 没有 g 时只返回第一个匹配,
  // 会把"命中 6 次"误报成 1 次——一个自己就会说谎的计数器,比没有检查更糟。
  for (const _ of text.matchAll(re)) n++;
  return n;
}

/**
 * 校验一段产出是否满足机械断言。纯函数:不读盘、不联网、不调模型。
 * 断言项之间是「与」的关系,全部满足才算通过;不通过时把每一条都列出来,
 * 不要只报第一条——修的人需要一次看全,而不是修一条跑一次。
 */
export function checkAssert(content: string, spec: StepAssert): AssertResult {
  const failures: string[] = [];

  if (spec.emits_files !== undefined) {
    const got = parseFileBlocks(content).length;
    if (got !== spec.emits_files) {
      failures.push(`产出的文件块数量不对:要求 ${spec.emits_files} 个,实际 ${got} 个`);
    }
  }

  if (spec.min_bytes !== undefined) {
    const got = Buffer.byteLength(content, 'utf8');
    if (got < spec.min_bytes) {
      failures.push(`产出太短:要求至少 ${spec.min_bytes} 字节,实际 ${got} 字节(疑似截断)`);
    }
  }

  // max_bytes 的来由:视频提示词写太长,厂商在提交这一步就直接拒(见姊妹仓 cases.zh.md
  // 「提示词超字数,提交不了」)。这种事在花钱之前就该拦下,而且是数出来的、不必过模型。
  if (spec.max_bytes !== undefined) {
    const got = Buffer.byteLength(content, 'utf8');
    if (got > spec.max_bytes) {
      failures.push(`产出太长:要求至多 ${spec.max_bytes} 字节,实际 ${got} 字节(需要压缩,删冗余形容词、合并短句)`);
    }
  }

  // 字数按非空白字符数,是写作类模板要的口径(bytes 对中文是 3 倍,用户按"字"想、按"字节"配总会配错)。
  // 字符串写法(带变量)必须先经 resolveAssert 算成数字;这里遇到字符串说明调用方漏了那一步,直接跳过不猜。
  if (typeof spec.min_chars === 'number') {
    const got = countChars(content);
    if (got < spec.min_chars) {
      failures.push(`产出太短:要求至少 ${spec.min_chars} 字(非空白字符),实际 ${got} 字(疑似截断或写短了)`);
    }
  }
  if (typeof spec.max_chars === 'number') {
    const got = countChars(content);
    if (got > spec.max_chars) {
      failures.push(`产出太长:要求至多 ${spec.max_chars} 字(非空白字符),实际 ${got} 字(需要压缩)`);
    }
  }

  for (const s of spec.contains ?? []) {
    if (!content.includes(s)) failures.push(`产出里找不到必须出现的内容:「${s}」`);
  }

  for (const [pattern, want] of Object.entries(spec.matches ?? {})) {
    const got = countMatches(content, pattern);
    if (got !== want) failures.push(`模式 /${pattern}/ 命中次数不对:要求 ${want} 次,实际 ${got} 次`);
  }

  return { pass: failures.length === 0, failures };
}

/** 断言未过时,拼一段定向返工提示。只说缺什么,不重述任务——原任务还在上文里。 */
export function buildAssertReworkBlock(failures: string[]): string {
  return [
    '',
    '',
    '---',
    '上一版产出**结构上不合格**,以下是逐条机械核对的结果(不是主观意见,是数出来的):',
    ...failures.map((f) => `- ${f}`),
    '',
    '请重新给出完整产出,补齐缺失的部分。注意:',
    '- 不要只补差的那部分,要给出**完整的一份**,否则下游拿不到完整产物;',
    '- 不要减少已经正确的内容;',
    '- 数量类要求请自己先数一遍再交。',
  ].join('\n');
}
