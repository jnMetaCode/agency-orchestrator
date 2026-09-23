/**
 * 条件表达式求值
 *
 * 支持的语法:
 *   {{变量}} contains 关键词
 *   {{变量}} equals 关键词
 *   关键词可用引号包裹: {{var}} contains "bug fix"
 *
 * 大小写不敏感，自动 trim
 */
import { renderTemplate } from './template.js';

// Matches known operators (contains/equals) anchored to whole words
const KNOWN_OP_REGEX = /^(.+?)\s+(contains|equals)\s+(.+)$/is;
// Matches any word as operator to detect unsupported operators
const ANY_OP_REGEX = /^.+\s+(\w+)\s+.+$/is;

export function evaluateCondition(
  condition: string,
  context: Map<string, string>
): boolean {
  // 在「模板」(替换变量之前)上解析运算符：运算符位置由作者在 YAML 里写定，
  // 不能用替换后的字符串来切分——否则变量值(LLM 产出)里恰好出现 contains/equals
  // 会把条件从错误的位置切开，导致分支/循环退出被翻转。
  const match = condition.match(KNOWN_OP_REGEX);
  if (!match) {
    // Check if the format looks valid but with an unsupported operator
    const opMatch = condition.match(ANY_OP_REGEX);
    if (opMatch) {
      throw new Error(`不支持的条件运算符: "${opMatch[1]}"。支持 contains 和 equals`);
    }
    throw new Error(`条件格式错误: "${condition}"。支持的格式: <text> contains <keyword> 或 <text> equals <keyword>`);
  }

  // 左操作数以取反词结尾 = 作者写了 `{{x}} not contains y` 这类否定式。左侧是懒匹配，`not` 会被
  // 吞进左操作数里，于是整条**当成 contains 求值、结果正好相反**，而且一声不吭。
  // 真机后果：`condition: "{{qa}} not contains 失败"` 在 QA 报失败时**照样跑**那一步——
  // 如果它是 type: video，就是按秒计费的钱。没有取反语法就当场说清楚，别猜。
  if (/(^|\s)(not|!|非|不)\s*$/i.test(match[1])) {
    throw new Error(
      `条件不支持取反写法（"${condition.trim().slice(0, 60)}"）：只有 contains / equals。`
      + `请把分支反过来写——例如把 "{{x}} not contains A" 改成给另一条分支加 "{{x}} contains A"。`,
    );
  }

  // 仅对两侧操作数分别替换变量；换行替空格避免多行 LLM 输出干扰
  const left = renderTemplate(match[1], context).trim().replace(/\n/g, ' ').toLowerCase();
  const operator = match[2].toLowerCase();
  // 去掉引号包裹
  const right = renderTemplate(match[3], context).trim().replace(/^["']|["']$/g, '').toLowerCase();

  // 右操作数渲染后为空（引用了一个没填的可选输入）：`"".includes("")` 恒真，于是"有条件的分支"
  // 每次都跑——短片流水线里那就是每条片子都出、都计费。空关键词按"没匹配上"算。
  if (!right) {
    return operator === 'equals' ? !left : false;
  }

  switch (operator) {
    case 'contains':
      return left.includes(right);
    case 'equals':
      return left === right;
    default:
      throw new Error(`不支持的条件运算符: "${operator}"。支持 contains 和 equals`);
  }
}
