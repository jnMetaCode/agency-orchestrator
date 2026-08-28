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
import type { StepAssert } from '../types.js';

export interface AssertResult {
  pass: boolean;
  failures: string[];   // 人话的未通过项,直接可进报错信息与返工提示
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
