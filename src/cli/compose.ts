/**
 * ao compose — AI 智能编排工作流
 *
 * 用户用一句话描述需求，AI 从角色库中选角色、设计 DAG、生成完整 workflow YAML。
 * 支持中文（agency-agents-zh）和英文（agency-agents）角色库。
 */
import { listAgents, suggestFromPaths } from '../agents/loader.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createConnector } from '../connectors/factory.js';
import type { LLMConfig } from '../types.js';
import { t } from '../i18n.js';
import yaml from 'js-yaml';

// ── R3.1/R3.2 预算档（--budget）：把「轻活」步骤降到便宜档，「重活」步骤保持默认贵档 ──
// 各 provider 的「便宜档」模型；没有更便宜档的（如 deepseek 默认就是便宜的 deepseek-chat）不列 → --budget 对其为 no-op。
const BUDGET_LIGHT_MODEL: Record<string, string> = {
  claude: 'claude-haiku-4-5-20251001',
  openai: 'gpt-5.4-mini',
  apinebula: 'gpt-5.4-mini',
  rootflowai: 'claude-haiku-4-5-20251001',
  cubence: 'claude-haiku-4-5-20251001',
  ccsub: 'claude-haiku-4-5-20251001',
  // deepseek：默认若走贵的 reasoner，轻活降到便宜的 chat；默认已是 chat 时则 no-op（light===topModel）
  deepseek: 'deepseek-chat',
};
// 「轻活」词（抽取/汇总/格式化/罗列/翻译/润色…）→ 可降档；「重活」词（分析/设计/评审/创作…）→ 保贵档。
// 保守策略：重活优先，命中难词或不确定一律保贵档，只对明确的轻活降档，护住关键质量。
// 明确的「把 X 重塑成 Y」动作（整理成/格式化/翻译成…）——这类步骤只是重组已有内容，
// 即便 task 里引用了上游的「洞察/分析」等名词，本身也是轻活。优先级高于 HARD，修掉误判。
const REFORMAT_RE = /整理成|整理为|归纳成|汇总成|格式化|排版成|排好版|输出成|润色|校对|翻译成|翻译为|改写成|精简成|reformat|format into|rewrite as|translate|proofread|polish/i;
const HARD_TASK_RE = /分析|设计|架构|评审|审查|判断|决策|创作|撰写|写作|方案|策略|规划|论证|洞察|architect|analy|design|review|judge|strateg|\bplan|reason|critique|creat|writ/i;
const LIGHT_TASK_RE = /抽取|提取|汇总|归纳|整理|罗列|列出|列表|格式化|排版|翻译|校对|润色|清洗|去重|标注|摘要|summar|extract|format|translat|proofread|\blist|organi[sz]e|categor|clean/i;

function classifyStepTier(step: { role?: string; task?: string }): 'light' | 'hard' {
  const text = `${step?.role ?? ''} ${step?.task ?? ''}`;
  if (REFORMAT_RE.test(text)) return 'light';   // 明确的重塑动作 → 轻活（优先，纠正"引用难词名词"的误判）
  if (HARD_TASK_RE.test(text)) return 'hard';   // 其次：命中难词一律保贵档
  if (LIGHT_TASK_RE.test(text)) return 'light';
  return 'hard';                                 // 不确定 → 保贵档（保守，护质量）
}

/** 对已生成的 workflow YAML 施加预算分档：给「轻活」步骤加 step.llm.model=便宜档。返回新 YAML + 一句说明。 */
export function applyBudgetTiering(yamlText: string, provider: string): { yaml: string; note?: string } {
  const light = BUDGET_LIGHT_MODEL[provider];
  if (!light) return { yaml: yamlText, note: `--budget：provider "${provider}" 无更便宜档位可降（可能默认已是便宜档），未改动` };
  let doc: any;
  try { doc = yaml.load(yamlText); } catch { return { yaml: yamlText }; }
  if (!doc || !Array.isArray(doc.steps)) return { yaml: yamlText };
  const topModel = doc.llm?.model;
  let downgraded = 0;
  for (const step of doc.steps) {
    if (!step || typeof step !== 'object') continue;
    if (step.llm?.model) continue;                // 步骤已显式指定模型 → 尊重，不覆盖
    if (classifyStepTier(step) === 'light' && light !== topModel) {
      step.llm = { ...(step.llm ?? {}), model: light };
      downgraded++;
    }
  }
  if (downgraded === 0) return { yaml: yamlText, note: '--budget：没有可降档的轻活步骤（都判为重活或已指定模型），未改动' };
  return {
    yaml: yaml.dump(doc, { lineWidth: -1 }),
    note: `--budget：${downgraded}/${doc.steps.length} 个轻活步骤降到便宜档 ${light}（重活步骤保持默认，省钱不掉关键质量）`,
  };
}

/** 精简的角色摘要，供 LLM 选角色用 */
export interface RoleSummary {
  path: string;       // e.g. "engineering/engineering-code-reviewer"
  name: string;       // e.g. "代码审查员"
  emoji?: string;     // e.g. "🔍"
  description: string; // one-liner
  category: string;   // e.g. "engineering"
}

/**
 * 从 agents 目录构建精简的角色目录
 */
export function buildRoleCatalog(agentsDir: string): RoleSummary[] {
  // 叠加用户自建角色（~/.ao/roles 的 my/*）：手动组队可锁定自建专家，自动组队也能挑到
  const agents = listAgents(agentsDir, true);
  return agents
    .filter(a => a.rolePath)
    .map(a => ({
      path: a.rolePath!,
      name: a.name,
      emoji: a.emoji,
      description: a.description || '',
      category: a.rolePath!.split('/')[0],
    }));
}

/**
 * 格式化角色目录为紧凑文本（给 LLM 看）
 */
export function formatCatalogForPrompt(roles: RoleSummary[]): string {
  const byCategory = new Map<string, RoleSummary[]>();
  for (const r of roles) {
    const list = byCategory.get(r.category) || [];
    list.push(r);
    byCategory.set(r.category, list);
  }

  const lines: string[] = [];
  for (const [cat, list] of byCategory) {
    lines.push(`## ${cat}`);
    for (const r of list) {
      lines.push(`- ${r.path} | ${r.emoji || ''} ${r.name} | ${r.description}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * 检测用户输入是否为英文（不包含中文字符）
 */
export function detectLang(text: string): 'zh' | 'en' {
  return /[\u4e00-\u9fff]/.test(text) ? 'zh' : 'en';
}

/**
 * 构建发给 LLM 的 system prompt
 * @param catalog 角色目录文本
 * @param options.autoRun 如果 true，生成的 YAML 不需要 inputs，用户描述直接嵌入 task
 * @param options.lang 语言：'zh' 中文提示词 + agency-agents-zh，'en' 英文提示词 + agency-agents
 */
export function buildComposeSystemPrompt(catalog: string, options?: { autoRun?: boolean; provider?: string; model?: string; lang?: 'zh' | 'en'; timeoutMs?: number; agentsDirName?: string }): string {
  const lang = options?.lang ?? 'zh';
  return lang === 'en'
    ? buildComposeSystemPromptEn(catalog, options)
    : buildComposeSystemPromptZh(catalog, options);
}

function buildComposeSystemPromptEn(catalog: string, options?: { autoRun?: boolean; provider?: string; model?: string; timeoutMs?: number; agentsDirName?: string }): string {
  const autoRun = options?.autoRun ?? false;
  const provider = options?.provider || 'deepseek';
  const model = options?.model;
  const isLocal = provider === 'ollama';
  // o系列/gpt-5 推理模型把 reasoning token 计入输出上限，4096 常被推理吃光 → 产出为空，故放大。issue #99
  const isReasoning = /(?:^|[^a-z])(?:o[1-9]|gpt-5)/i.test(model || '');
  const maxTokens = isLocal ? 8192 : (isReasoning ? 32768 : 4096);
  const timeoutMs = options?.timeoutMs ?? (isLocal ? 600000 : 300000);

  const inputsSection = autoRun
    ? `
## Important: Direct Run Mode

This workflow will be executed immediately after generation, so:
- **Do NOT** generate an inputs section (the upfront form filled before running)
- Embed all specific information from the user's description directly into each step's task
- Ensure the workflow can start without any "before-run" form inputs
- This does NOT affect using a human_input step mid-run to ask the user something (that's an in-flight pause, not an upfront form) — if the task genuinely needs the user to clarify something partway through, still use human_input rather than having the model guess`
    : `
inputs:
  - name: variable_name
    description: "Variable description"
    required: true`;

  const inputsYamlExample = autoRun ? '' : `
inputs:
  - name: variable_name
    description: "Variable description"
    required: true
`;

  const inputsDesignPrinciple = autoRun
    ? '- **Self-contained**: All information goes directly into tasks. Do NOT use inputs. The workflow must run directly'
    : '- **Reasonable inputs**: Extract key variables from the user\'s requirements as inputs';

  return `You are an AI workflow orchestration expert. The user will describe a workflow in one sentence. You need to:

1. Select the most suitable roles from the role catalog below (typically 2-6)
2. Design proper DAG dependencies (which steps can run in parallel, which must be serial)
3. Write detailed task descriptions for each step
${autoRun ? '4. Embed all specific information from the user\'s description directly into tasks, do NOT generate inputs' : '4. Design reasonable input variables'}
5. Generate a complete workflow YAML
${autoRun ? inputsSection : ''}
## Output Format

Output a complete YAML code block in this format:

\`\`\`yaml
name: "Workflow Name"
description: "One-line description"

agents_dir: "${options?.agentsDirName || 'agency-agents'}"

llm:
  provider: ${provider}
  ${model ? `model: ${model}` : ''}
  max_tokens: ${maxTokens}
  timeout: ${timeoutMs}
  retry: 2

concurrency: 2
${inputsYamlExample}
steps:
  - id: step_id
    role: "category/role-name"
    name: "Easy-to-understand role name (e.g., CEO, Product Manager, Tech Lead)"
    emoji: "👔"
    task: |
      Detailed task description...
${autoRun ? '      Include specific information from the user\'s description' : '      Use {{variable_name}} to reference input variables'}
      Use {{previous_output}} to reference upstream step outputs
    output: output_variable_name
    depends_on: [upstream_step_id]  # Only add when there's a dependency
    acceptance: |  # Optional: verifiable conditions the output must satisfy (strongly recommended on the final step)
      1. First checkable condition...
      2. Second checkable condition...

  # When you need to ask the user something mid-run, use a human_input step (no role, actually pauses for input):
  - id: ask_step_id
    type: human_input
    prompt: "The specific question to ask the user, can reference {{variable_name}} from earlier steps"
    output: user_answer_variable  # the user's answer is injected downstream as this variable

  # For high-stakes decisions (finance/medical/legal/spending real money), insert an approval gate (pauses until the user signs off):
  - id: approve_step_id
    type: approval
    prompt: "State clearly what the user is approving, can reference {{variables}}"
\`\`\`

## Design Principles

- **Parallel first**: Steps without data dependencies should run in parallel (no depends_on)
- **Variable chaining**: Upstream step output variable names must match downstream {{variable}} references
- **Role matching**: Select the most specialized role for each task — don't use one role for everything
- **Role naming**: Each step must have a name (approachable job title like "CEO", "Product Manager", "Tech Lead") and emoji, so anyone can instantly see who's speaking
- **Detailed tasks**: Task descriptions should be specific — tell the role what to do and what format to output
${inputsDesignPrinciple}
- **Use human_input when the user needs to clarify something — don't have a role "ask" in its task**: if the task genuinely can't proceed without more info from the user (personal preference, choosing between options, a specific detail not in inputs — classic case: registration/enrollment-type requests where you must ask the user's specifics partway through), insert a \`type: human_input\` step to ask them, and feed the answer downstream as its output variable. Writing "ask the user X" inside a regular role step's task does NOT work — the engine won't actually pause, the model will just make up an answer
- **Acceptance criteria**: give key steps — at minimum the FINAL deliverable step — an \`acceptance:\` field with 2-5 verifiable conditions the output must satisfy. Concrete and checkable ("contains X/Y/Z sections", "every recommendation states its risk"), never vague ("high quality"). It is injected into the step's prompt AND actually enforced: after the step runs, the engine checks the output against each item, and any unmet item triggers one automatic rework round — so every item must be objectively machine-checkable from the output text alone
- **High-risk tasks need an approval gate**: for finance/investment, medical, legal, or anything spending real money / hard to reverse — insert a \`type: approval\` step before the final recommendation/execution step, so the user signs off before proceeding
- **Final deliverable**: The last step must output the final deliverable the user wants (e.g., complete article, complete report), not review comments or suggestions. If there's a review step, it should output the revised final version, not a "list of suggestions"
- **Clean final output (IMPORTANT)**: The LAST step's \`task\` MUST end with an explicit instruction to output ONLY the deliverable itself — no preamble/greeting, no "what I changed"/change-log, no formatting notes, no questions to the user, no suggestions to run \`ao\`/other commands, no "shall I continue?" closers. Append a line like: "⚠️ Output only the final deliverable itself — no preamble, no change-log, no meta-commentary, no questions, no tool/command suggestions." (If you genuinely need to ask the user something, use the human_input step above instead — not in the final step)

## Available Role Catalog

${catalog}

## Rules

- The role value must strictly use paths from the role catalog (e.g., "engineering/engineering-code-reviewer") — do NOT make up role paths
- **Variable names must use underscores**, no spaces. Correct: "market_analysis", "tech_report". Wrong: "market analysis", "tech report". All id, output, and depends_on values must be snake_case
- **Variables must have a source**: every \`{{X}}\` referenced in a step's task MUST appear either as an \`inputs\` name OR as the \`output\` field of an earlier step. Do NOT invent variable names that no step produces
- **Merge / aggregation steps**: if a step references \`{{a}}\`, \`{{b}}\`, \`{{c}}\` from upstream, its \`depends_on\` MUST list every upstream step that produces those outputs. Cross-check before emitting
- **human_input steps don't need role/task/emoji/name** — only \`type: human_input\`, \`prompt\`, and \`output\`; its output variable can be depended on and \`{{referenced}}\` downstream just like a normal step
- Only output the YAML code block, nothing else
- Set concurrency to the maximum number of parallel steps
- **Important: Split large tasks**. When writing long articles, don't let one step generate more than 800 words. Split by sections into multiple parallel steps (e.g., write_ch1, write_ch2, write_ch3), then use a merge step to rewrite into a coherent complete article
- Limit word count in each writing step's task (e.g., "under 500 words") to avoid overly long single-step generation times`;
}

function buildComposeSystemPromptZh(catalog: string, options?: { autoRun?: boolean; provider?: string; model?: string; timeoutMs?: number; agentsDirName?: string }): string {
  const autoRun = options?.autoRun ?? false;
  const provider = options?.provider || 'deepseek';
  const model = options?.model;
  const isLocal = provider === 'ollama';
  // o系列/gpt-5 推理模型把 reasoning token 计入输出上限，4096 常被推理吃光 → 产出为空，故放大。issue #99
  const isReasoning = /(?:^|[^a-z])(?:o[1-9]|gpt-5)/i.test(model || '');
  const maxTokens = isLocal ? 8192 : (isReasoning ? 32768 : 4096);
  const timeoutMs = options?.timeoutMs ?? (isLocal ? 600000 : 300000);

  const inputsSection = autoRun
    ? `
## 重要：直接运行模式

这个工作流生成后会立即执行，所以：
- **不要**生成 inputs 段（运行前的表单输入）
- 把用户描述中的所有具体信息直接写进每个 step 的 task 里
- 确保工作流无需任何"运行前"输入就能直接启动
- 这不影响中途用 human_input 步骤向用户提问（那是运行过程中的暂停提问，不是运行前的表单）——如果任务本质上需要用户中途澄清信息，仍然要用 human_input，不要为了凑"自包含"而让模型瞎猜`
    : `
inputs:
  - name: variable_name
    description: "变量描述"
    required: true`;

  const inputsYamlExample = autoRun ? '' : `
inputs:
  - name: variable_name
    description: "变量描述"
    required: true
`;

  const inputsDesignPrinciple = autoRun
    ? '- **自包含**：所有信息直接写在 task 中，不要使用 inputs，工作流必须能直接运行'
    : '- **合理输入**：提取用户需求中的关键变量作为 inputs';

  return `你是一个 AI 工作流编排专家。用户会用一句话描述他想要的工作流，你需要：

1. 从下方角色目录中选择最合适的角色（通常 2-6 个）
2. 设计合理的 DAG 依赖关系（哪些步骤可以并行，哪些必须串行）
3. 为每个步骤编写详细的 task 描述
${autoRun ? '4. 把用户描述中的具体信息直接写进 task，不要生成 inputs' : '4. 设计合理的输入变量'}
5. 生成完整的 workflow YAML
${autoRun ? inputsSection : ''}
## 输出格式

直接输出一个完整的 YAML 代码块，格式如下：

\`\`\`yaml
name: "工作流名称"
description: "一句话描述"

agents_dir: "${options?.agentsDirName || 'agency-agents-zh'}"

llm:
  provider: ${provider}
  ${model ? `model: ${model}` : ''}
  max_tokens: ${maxTokens}
  timeout: ${timeoutMs}
  retry: 2

concurrency: 2
${inputsYamlExample}
steps:
  - id: step_id
    role: "category/role-name"
    name: "通俗易懂的角色名（如：老板、产品经理、技术总监）"
    emoji: "👔"
    task: |
      详细的任务描述...
${autoRun ? '      直接包含用户需求中的具体信息' : '      使用 {{variable_name}} 引用输入变量'}
      使用 {{previous_output}} 引用上游步骤的输出
    output: output_variable_name
    depends_on: [upstream_step_id]  # 仅在有依赖时添加
    acceptance: |  # 可选：产出必须满足的可核对验收条件（最终交付步强烈建议写）
      1. 第一条可核对的条件…
      2. 第二条可核对的条件…

  # 需要向用户询问/确认信息时，用 human_input 类型的步骤（无 role，运行到这一步会真的暂停等用户输入）：
  - id: ask_step_id
    type: human_input
    prompt: "向用户提的具体问题，可用 {{variable_name}} 引用之前的变量"
    output: user_answer_variable  # 用户的回答会作为这个变量注入下游 task

  # 高风险决策（金融/医疗/法律/花真金白银）前插入 approval 闸门（暂停等用户签字放行）：
  - id: approve_step_id
    type: approval
    prompt: "写清楚用户在批准什么，可引用 {{变量}}"
\`\`\`

## 设计原则

- **并行优先**：没有数据依赖的步骤应该并行执行（不加 depends_on）
- **变量串联**：上游步骤的 output 变量名要和下游步骤 task 中的 {{变量}} 对应
- **角色匹配**：选择最专业的角色，不要用一个角色做所有事
- **角色命名**：每个步骤必须设置 name（通俗的公司职位名如"老板""产品经理""技术总监"）和 emoji，让小白也能一眼看懂谁在说话
- **任务详细**：task 描述要具体，告诉角色要做什么、输出什么格式
${inputsDesignPrinciple}
- **需要用户澄清时用 human_input，不要指望角色在 task 里"提问"**：如果任务本质上需要用户提供额外信息才能继续（如个人偏好、多个方案里选一个、inputs 里没给的具体细节——典型例子是报名/选课/选方案类需求，中途必须问用户具体情况），插入一个 \`type: human_input\` 的步骤向用户提问，把回答作为 output 变量给下游用。普通 role 步骤的 task 里写"请问用户 XXX"是无效的——引擎不会暂停等回答，模型只会自己编一个答案
- **验收标准**：给关键步骤——至少是最终交付步——写 \`acceptance:\` 字段，列 2-5 条产出必须满足的可核对条件。要具体可查（"包含 X/Y/Z 三节""每条建议都标注风险"），不要空话（"高质量"）。它不只注入该步 prompt——步骤跑完后引擎会**逐条真核验**，未过自动返工一轮。所以每一条都必须是仅凭产出文本就能客观判定的
- **高风险任务要加签字闸门**：涉及金融/投资、医疗、法律，或花真金白银、难以撤销的操作——在最终建议/执行步骤之前插入 \`type: approval\` 节点，让用户签字放行后才继续（重大决策必须老板拍板）
- **最终成品**：最后一个步骤必须输出用户想要的最终成品（如完整文章、完整报告），而不是审查意见或修改建议。如果有审校步骤，审校步骤应该直接输出修改后的定稿，而不是"修改建议列表"
- **干净的最终产出（重要）**：最后一个步骤的 \`task\` 结尾必须显式要求"只输出成品本身"——不要开场白/寒暄、不要"我改了什么/复盘/修改说明"、不要排版备注小节、不要向用户提问或请其拍板、不要建议运行 \`ao\` 或其它命令、不要"要我继续吗"之类收尾。请在该 step 的 task 末尾追加一行类似：「⚠️ 只输出最终成品本身：不要开场白、不要复盘或说明、不要向用户提问、不要建议任何命令或后续动作。」（需要问用户时用上面的 human_input 步骤，不要在最终步骤里问）

## 可用角色目录

${catalog}

## 注意

- role 的值必须严格使用角色目录中的 path（如 "engineering/engineering-code-reviewer"），不要自己编造
- **变量名必须用下划线**，不能有空格。正确："market_analysis"、"tech_report"。错误："market analysis"、"tech report"。id、output、depends_on 中的值都必须用 snake_case
- **变量必须有来源**：每个 task 中的 \`{{X}}\` 引用，X 必须是 \`inputs\` 中的某个 name，或者是前面某个 step 的 \`output\` 字段。不要凭空写一个没有任何 step 产生的变量名
- **合并/汇总类步骤**：如果一个步骤的 task 里引用了 \`{{a}}\`、\`{{b}}\`、\`{{c}}\` 这些上游变量，它的 \`depends_on\` 必须列出所有产生这些 output 的上游 step。生成完后请逐一核对一遍
- **human_input 步骤不需要 role/task/emoji/name**，只需要 \`type: human_input\`、\`prompt\`、\`output\`；它产出的 output 变量可以像普通 step 一样被下游 depends_on + {{引用}}
- 只输出 YAML 代码块，不要输出其他内容
- concurrency 设为并行步骤的最大数量
- **重要：拆分大任务**。写长文章时，不要让一个步骤生成超过 800 字的内容。应该按章节拆分成多个并行步骤（如 write_ch1、write_ch2、write_ch3），最后用一个合并步骤重写为连贯的完整文章
- 每个写作步骤的 task 中要限定输出字数（如"500字以内"），避免单步骤生成时间过长`;
}

/**
 * 构建 user prompt
 */
export function buildComposeUserPrompt(description: string, lang?: 'zh' | 'en'): string {
  if (lang === 'en') {
    return `Design a multi-agent collaboration workflow for the following requirement:

${description}`;
  }
  return `请为以下需求设计一个多智能体协作工作流：

${description}`;
}

/**
 * 从 LLM 回复中提取 YAML 内容
 */
export function extractYamlFromResponse(response: string): string {
  // 尝试从 ```yaml ... ``` 代码块中提取
  const yamlBlock = response.match(/```ya?ml\s*\n([\s\S]*?)```/);
  if (yamlBlock) return yamlBlock[1].trim();

  // 尝试从 ``` ... ``` 代码块中提取
  const codeBlock = response.match(/```\s*\n([\s\S]*?)```/);
  if (codeBlock) return codeBlock[1].trim();

  // 小模型可能只有开头的 ``` 没有闭合，兜底去掉
  const unclosed = response.match(/```ya?ml?\s*\n([\s\S]+)/);
  if (unclosed) return unclosed[1].trim().replace(/```\s*$/, '').trim();

  // 没有代码块，整个回复当 YAML
  return response.trim();
}

/**
 * 根据描述生成文件名（避免覆盖已有文件）
 */
export function generateFileName(description: string, dir?: string): string {
  const cleaned = description
    .replace(/[^\u4e00-\u9fffa-zA-Z0-9\s-]/g, '')
    .trim()
    .slice(0, 40)
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/^-|-$/g, '');
  const base = cleaned || 'composed-workflow';

  if (!dir) return `${base}.yaml`;

  // 同名文件已存在时加序号
  let candidate = `${base}.yaml`;
  let i = 2;
  while (existsSync(resolve(dir, candidate))) {
    candidate = `${base}-${i}.yaml`;
    i++;
  }
  return candidate;
}

/**
 * 执行 compose 流程
 */
export async function composeWorkflow(options: {
  description: string;
  agentsDir: string;
  llmConfig: LLMConfig;
  outputName?: string;
  /** 直接运行模式：生成的 YAML 不需要 inputs */
  autoRun?: boolean;
  /** 语言：自动检测或指定 */
  lang?: 'zh' | 'en';
  /** 生成的 YAML 中写入的单步超时（ms）；未指定时 API=300s / ollama=600s */
  timeoutMs?: number;
  /** 锁定阵容：只用这些角色路径（如 "engineering/xxx"），LLM 仅在其间编排 DAG/task/变量 */
  pinnedRoles?: string[];
  /** 保存目录；默认 workflows/。用于把合成结果写到用户目录而非随包模板目录 */
  saveDir?: string;
  /** R3.2 预算模式：把「轻活」步骤自动降到便宜档，省钱不掉关键质量（默认关，零回归） */
  budget?: boolean;
  /** 生成 YAML 里 agents_dir 的名字（多语言角色库如 "agency-agents-ko"）；缺省按 lang 用 zh/en 内置库名 */
  agentsDirName?: string;
}): Promise<{ yaml: string; savedPath: string; relativePath: string; warnings: string[] }> {
  const { description, agentsDir, llmConfig } = options;
  const lang = options.lang ?? detectLang(description);

  // 1. 构建角色目录
  let roles = buildRoleCatalog(agentsDir);
  if (roles.length === 0) {
    throw new Error(t('compose.empty_catalog', { dir: agentsDir }));
  }
  // 锁定阵容：把目录收窄到勾选的角色，LLM 既无法幻觉别的角色，也被强制用上这些
  if (options.pinnedRoles?.length) {
    const pin = new Set(options.pinnedRoles);
    const filtered = roles.filter(r => pin.has(r.path));
    if (filtered.length > 0) roles = filtered;
  }
  const catalog = formatCatalogForPrompt(roles);

  // 2. 构建 prompt
  const systemPrompt = buildComposeSystemPrompt(catalog, {
    autoRun: options.autoRun,
    provider: options.llmConfig.provider,
    model: options.llmConfig.model,
    lang,
    timeoutMs: options.timeoutMs,
    agentsDirName: options.agentsDirName,
  });
  let userPrompt = buildComposeUserPrompt(description, lang);
  if (options.pinnedRoles?.length) {
    const names = roles.map(r => `${r.path}（${r.name}）`).join(lang === 'en' ? ', ' : '、');
    userPrompt += lang === 'en'
      ? `\n\nYou MUST build the workflow using EXACTLY these roles, every one of them and no others: ${names}. Design the DAG dependencies, task descriptions and variable chaining among them.`
      : `\n\n必须且只能使用以下全部角色（每个都要用上，不要引入其他角色）：${names}。在它们之间设计 DAG 依赖、task 描述和变量串联。`;
  }

  // 3. 调用 LLM
  console.log(`  ${t('compose.generating', { n: roles.length })}\n`);

  const connector = createConnector(llmConfig);
  const result = await connector.chat(systemPrompt, userPrompt, {
    ...llmConfig,
    max_tokens: llmConfig.max_tokens || 4096,
  });

  // 4. 提取 YAML
  const yaml = extractYamlFromResponse(result.content);
  if (!yaml || !yaml.includes('steps:')) {
    throw new Error(t('compose.invalid_yaml'));
  }

  // 5. 保存（避免覆盖）
  const workflowsDir = options.saveDir ? resolve(options.saveDir) : resolve('workflows');
  if (!existsSync(workflowsDir)) {
    mkdirSync(workflowsDir, { recursive: true });
  }
  const fileName = options.outputName
    ? (options.outputName.endsWith('.yaml') ? options.outputName : `${options.outputName}.yaml`)
    : generateFileName(description, workflowsDir);
  const savedPath = resolve(workflowsDir, fileName);
  writeFileSync(savedPath, yaml + '\n', 'utf-8');

  const relativePath = relative(process.cwd(), savedPath);

  if (process.env.AO_VERBOSE) {
    console.log(`  ${t('compose.tokens', { in: result.usage.input_tokens, out: result.usage.output_tokens })}`);
  }

  // 6. 校验生成的 YAML（含角色路径真实性校验，防 LLM 幻觉）
  const warnings: string[] = [];
  const validRolePaths = new Set(roles.map(r => r.path));

  async function validateGenerated(path: string): Promise<{ errors: string[]; invalidRoles: string[] }> {
    const { parseWorkflow, validateWorkflow } = await import('../core/parser.js');
    const errors: string[] = [];
    const invalidRoles: string[] = [];
    try {
      const workflow = parseWorkflow(path);
      errors.push(...validateWorkflow(workflow));
      for (const step of workflow.steps) {
        if (step.role && !validRolePaths.has(step.role)) {
          invalidRoles.push(step.role);
          errors.push(`step "${step.id}" 的 role "${step.role}" 不存在于角色库中`);
        }
      }
    } catch (err) {
      errors.push(`YAML 解析失败: ${err instanceof Error ? err.message : err}`);
    }
    return { errors, invalidRoles };
  }

  let first = await validateGenerated(savedPath);

  // 幻觉角色 → 先做确定性替换：有"够接近"的真实角色就直接改 YAML，不花一次 LLM 调用，
  // 且保证替换结果一定是库里真实存在、可运行的角色。
  if (first.invalidRoles.length > 0) {
    const det = repairInvalidRolesInYaml(savedPath, first.invalidRoles, [...validRolePaths]);
    if (det.replaced.length > 0) {
      console.log(`  自动替换 ${det.replaced.length} 个不存在的角色为最接近的真实角色：`);
      for (const r of det.replaced) console.log(`    ${r.from} → ${r.to}`);
      first = await validateGenerated(savedPath);
    }
  }

  // 仍有幻觉角色（无可信匹配）→ 让 LLM 修一次
  if (first.invalidRoles.length > 0) {
    console.log(`  仍有 ${first.invalidRoles.length} 个角色无法自动匹配，调 LLM 重新生成...`);
    // 把"你是不是想用 X"喂回 LLM：从实际提供的目录里找最接近的真实角色，
    // 让模型做定向替换而非盲目重生成，显著提高一次修复成功率
    const catalogPaths = [...validRolePaths];
    const corrections = first.invalidRoles.map(bad => {
      const hit = suggestFromPaths(bad, catalogPaths);
      return { bad, suggestion: hit[0] };
    });
    const mapLine = (sep: string) => corrections
      .map(c => c.suggestion ? `${c.bad} → ${c.suggestion}` : c.bad)
      .join(sep);
    const retryPrompt = lang === 'en'
      ? `The following role paths in your previous YAML do NOT exist in the catalog (→ shows the closest valid path):\n${corrections.map(c => `  - ${c.bad}${c.suggestion ? ` → use "${c.suggestion}" instead` : ''}`).join('\n')}\n\nRegenerate the FULL YAML, replacing each wrong path with the suggested one. Use ONLY role paths from the catalog above. Do not invent new paths.`
      : `你上次生成的 YAML 里有不存在的 role 路径（→ 后是目录中最接近的正确路径）：\n${corrections.map(c => `  - ${c.bad}${c.suggestion ? ` → 请改用 "${c.suggestion}"` : ''}`).join('\n')}\n\n请重新生成完整 YAML，把每个错误路径替换为建议的正确路径。role 必须严格使用上方角色目录中列出的路径，不要编造。`;
    if (corrections.some(c => c.suggestion)) {
      console.log(`  建议替换: ${mapLine('，')}`);
    }
    try {
      const retryResult = await connector.chat(systemPrompt, `${userPrompt}\n\n${retryPrompt}`, {
        ...llmConfig,
        max_tokens: llmConfig.max_tokens || 4096,
      });
      const retryYaml = extractYamlFromResponse(retryResult.content);
      if (retryYaml && retryYaml.includes('steps:')) {
        writeFileSync(savedPath, retryYaml + '\n', 'utf-8');
        let second = await validateGenerated(savedPath);
        // LLM 重试后若仍残留幻觉角色 → 再用确定性替换兜底，堵住"重试后仍坏、却被当成功"的缺口
        if (second.invalidRoles.length > 0) {
          const det2 = repairInvalidRolesInYaml(savedPath, second.invalidRoles, catalogPaths);
          if (det2.replaced.length > 0) {
            for (const r of det2.replaced) console.log(`    ${r.from} → ${r.to}`);
            second = await validateGenerated(savedPath);
          }
          if (second.invalidRoles.length > 0) {
            warnings.push(`仍有无法解析的角色: ${second.invalidRoles.join(', ')}`);
          }
        }
        // 重试后仍有变量引用错误 → 走 fix 链（autoFix → LLM 二次修复）
        const finalErrors = await runVariableFixChain(savedPath, second.errors, validateGenerated, llmConfig, lang);
        warnings.push(...finalErrors);
        const fixedYaml = finalizeBudget(readFileSync(savedPath, 'utf-8').trim(), options, llmConfig.provider, savedPath, warnings);
        return { yaml: fixedYaml, savedPath, relativePath, warnings };
      }
    } catch (err) {
      warnings.push(`自动修正失败（保留原始输出）: ${err instanceof Error ? err.message : err}`);
    }
  }

  // 首次生成无幻觉角色 → 直接走变量 fix 链
  const finalErrors = await runVariableFixChain(savedPath, first.errors, validateGenerated, llmConfig, lang);
  warnings.push(...finalErrors);
  const finalYaml = finalizeBudget(readFileSync(savedPath, 'utf-8').trim(), options, llmConfig.provider, savedPath, warnings);
  return { yaml: finalYaml, savedPath, relativePath, warnings };
}

/** budget 模式收尾：施加分档、写回盘、把说明加入 warnings（供 CLI 回显）。非 budget 原样返回。 */
function finalizeBudget(yamlText: string, options: { budget?: boolean }, provider: string, savedPath: string, warnings: string[]): string {
  if (!options.budget) return yamlText;
  const { yaml: out, note } = applyBudgetTiering(yamlText, provider);
  if (note) warnings.push(note);
  if (out !== yamlText) writeFileSync(savedPath, out + '\n', 'utf-8');
  return out;
}

/**
 * 确定性修复幻觉角色：对每个不存在的 role，从角色库找到"够接近"的真实路径，直接在 YAML 文本里替换。
 * 不依赖再调一次 LLM——只要有可信匹配，就保证替换为库里真实存在、可运行的角色。
 * 仅替换 role 值中的精确路径（双/单引号包裹），避免误伤任务描述等其它文本。
 * 返回已替换列表与仍无匹配（需 LLM 兜底）的角色。
 */
export function repairInvalidRolesInYaml(
  yamlPath: string,
  invalidRoles: string[],
  validRolePaths: string[],
): { replaced: { from: string; to: string }[]; unresolved: string[] } {
  let content = readFileSync(yamlPath, 'utf-8');
  const replaced: { from: string; to: string }[] = [];
  const unresolved: string[] = [];
  for (const bad of [...new Set(invalidRoles)]) {
    const to = suggestFromPaths(bad, validRolePaths)[0];
    if (!to) { unresolved.push(bad); continue; }
    const before = content;
    content = content.split(`"${bad}"`).join(`"${to}"`).split(`'${bad}'`).join(`'${to}'`);
    if (content !== before) replaced.push({ from: bad, to });
    else unresolved.push(bad);
  }
  if (replaced.length > 0) writeFileSync(yamlPath, content, 'utf-8');
  return { replaced, unresolved };
}

/**
 * 变量引用错误的修复链：autoFix（启发式）→ LLM 二次修复 → 重新校验。
 * 返回最终仍未解决的 errors。
 */
async function runVariableFixChain(
  savedPath: string,
  initialErrors: string[],
  validateGenerated: (p: string) => Promise<{ errors: string[]; invalidRoles: string[] }>,
  llmConfig: LLMConfig,
  lang: 'zh' | 'en'
): Promise<string[]> {
  // 除了"未定义的变量"，"depends_on 指向不存在的 step"（如 image 3 那类：LLM 编了个不存在
  // 的 step id 当依赖）也是同一类"DAG 没搭对"的错误，同样应该进这条修复链，而不是被
  // hasVarError 的窄判断漏掉、悄悄留在最终输出里。
  const hasVarError = (errs: string[]) =>
    errs.some(e => e.includes('未定义的变量') || e.includes('依赖不存在的 step') || e.toLowerCase().includes('undefined variable'));

  if (!hasVarError(initialErrors)) return initialErrors;

  // 阶段 0：确定性修复"变量名没错，只是引用它的 step 忘了把产出该变量的 step
  // 加进 depends_on"——这是 compose 最常见的一类错误（LLM 设计 DAG 时漏连边，
  // 变量名本身对得上），比改名更精确，优先做。
  const depFix = await autoFixMissingDependsOn(savedPath);
  if (depFix.fixed > 0) {
    console.log(`  自动补上了 ${depFix.fixed} 处缺失的 depends_on：`);
    for (const f of depFix.details) console.log(`    step "${f.step}" → depends_on 加入 "${f.addedDep}"`);
  }
  const afterDepFix = await validateGenerated(savedPath);
  if (!hasVarError(afterDepFix.errors)) return afterDepFix.errors;

  // 阶段 1: autoFix（启发式，只在 DAG 上游内替换）
  const fixResult = await autoFixVariableRefs(savedPath);
  if (fixResult.fixed > 0) {
    console.log(`  自动修复了 ${fixResult.fixed} 个变量引用：`);
    for (const f of fixResult.details) console.log(`    {{${f.from}}} → {{${f.to}}}`);
  }
  let current = await validateGenerated(savedPath);
  if (!hasVarError(current.errors)) return current.errors;

  // 阶段 2: LLM 二次修复（autoFix 修不动的让 LLM 决策）
  const remainingVars = extractUndefinedVarNames(current.errors);
  if (remainingVars.length === 0) return current.errors;

  console.log(`  ${remainingVars.length} 个变量启发式修不动，调 LLM 二次修复...`);
  const repair = await repairWithLLM(savedPath, remainingVars, llmConfig, lang);
  if (repair.replaced) {
    current = await validateGenerated(savedPath);
    if (!hasVarError(current.errors)) {
      console.log('  LLM 修复成功');
      return current.errors;
    }
    console.log(`  LLM 修复后仍有 ${remainingVars.length} 个变量未解决，需人工检查`);
  }
  return current.errors;
}

/** 从 "step \"X\" 引用了未定义的变量: {{Y}}" 这类消息里提取变量名 Y */
function extractUndefinedVarNames(errors: string[]): string[] {
  const names = new Set<string>();
  for (const e of errors) {
    const m = e.match(/\{\{(\w+)\}\}/);
    if (m) names.add(m[1]);
  }
  return [...names];
}

/**
 * 修复"变量名本身是对的，只是引用它的 step 忘了把产出该变量的 step 加进 depends_on"
 * 这类错误——parser.ts 的 validateWorkflow 会专门标出这种情况（"该变量由非上游 step
 * 产出，需要把对应 step 加进 depends_on"），说明变量确实由某个 step 产出，只是 DAG
 * 边没连上。直接在 YAML 里给该 step 补一条 depends_on，而不是像 autoFixVariableRefs
 * 那样改名字（名字本来就没错）。
 *
 * 只在能安全定位 step 的文本块、且不会成环时才动手；识别不了的 YAML 形状（既不是
 * `depends_on: [a, b]` 单行 flow 风格，也不是多行列表，也找不到 output 字段可插入）
 * 就跳过，留给后面的 autoFixVariableRefs / LLM 修复兜底。
 */
export async function autoFixMissingDependsOn(yamlPath: string): Promise<{ fixed: number; details: { step: string; addedDep: string }[] }> {
  const { parseWorkflow } = await import('../core/parser.js');
  let workflow;
  try {
    workflow = parseWorkflow(yamlPath);
  } catch {
    return { fixed: 0, details: [] };
  }

  const stepById = new Map<string, any>();
  for (const step of workflow.steps) stepById.set(step.id, step);

  function upstreamStepIds(stepId: string): Set<string> {
    const out = new Set<string>();
    const stack = [stepId];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      const s = stepById.get(cur);
      if (!s) continue;
      for (const dep of s.depends_on || []) {
        if (out.has(dep)) continue;
        out.add(dep);
        stack.push(dep);
      }
    }
    return out;
  }

  // 按 "- id: xxx" 行切出每个 step 的文本块（含缩进），后续按顺序在同一份文本上打补丁。
  //
  // 关键坑：task 的自然语言描述里偶尔会出现示例 YAML 片段（如"参考格式：- id: xxx"），
  // 这类假匹配不能只靠"id 是否真实存在"或"第一次出现"来过滤——假匹配完全可能引用一个
  // 真实存在的 id（比如举例时提到了另一个 step 的 id），而且可能出现在真实定义之前。
  // 唯一可靠的判据是 YAML 结构本身："- id:" 只有在缩进等于 steps 列表项的缩进时才是
  // 真正的 step 边界；task: | 块标量内部的内容缩进必然比这更深。所以先从 "steps:" 之后
  // 第一个列表项算出这份文件真正的 step 缩进，再只认这个缩进层级的匹配。
  const out0 = readFileSync(yamlPath, 'utf-8');
  const stepsKeyMatch = out0.match(/^steps:\s*$/m);
  const stepItemIndentMatch = stepsKeyMatch
    ? out0.slice(stepsKeyMatch.index! + stepsKeyMatch[0].length).match(/^([ \t]*)-\s*id:/m)
    : null;
  const canonicalIndent = stepItemIndentMatch ? stepItemIndentMatch[1] : null;
  // 找不到 "steps:" 或第一个 step 列表项（YAML 形状异常）——放弃这份确定性修复，交给后续兜底
  if (canonicalIndent === null) return { fixed: 0, details: [] };

  const idLineRe = /^([ \t]*)-\s*id:\s*["']?([\w-]+)["']?.*$/gm;
  const matches: { id: string; indent: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  let out = out0;
  while ((m = idLineRe.exec(out))) {
    if (m[1] !== canonicalIndent) continue; // 缩进不对：块标量内部的假匹配，跳过
    matches.push({ id: m[2], indent: m[1], index: m.index });
  }
  const blocks = matches.map((cur, i) => ({
    id: cur.id,
    indent: cur.indent,
    start: cur.index,
    end: i + 1 < matches.length ? matches[i + 1].index : out.length,
  }));

  const details: { step: string; addedDep: string }[] = [];
  let offsetShift = 0;

  for (const step of workflow.steps) {
    const refs = step.task?.match(/\{\{(\w+)\}\}/g) || [];
    if (refs.length === 0) continue;

    for (const ref of refs) {
      const varName = ref.slice(2, -2);
      const upOutputs = new Set<string>();
      for (const id of upstreamStepIds(step.id)) {
        const s = stepById.get(id);
        if (s?.output) upOutputs.add(s.output);
      }
      if (upOutputs.has(varName)) continue;

      const producer = workflow.steps.find((s: any) => s.output === varName);
      if (!producer || producer.id === step.id) continue;
      if ((step.depends_on || []).includes(producer.id)) continue;
      // 避免成环：producer 不能已经（间接）依赖当前 step
      if (upstreamStepIds(producer.id).has(step.id)) continue;

      const block = blocks.find(b => b.id === step.id);
      if (!block) continue;
      const blockText = out.slice(block.start + offsetShift, block.end + offsetShift);
      const patched = insertDependsOn(blockText, producer.id);
      if (patched && patched !== blockText) {
        out = out.slice(0, block.start + offsetShift) + patched + out.slice(block.end + offsetShift);
        offsetShift += patched.length - blockText.length;
        step.depends_on = [...(step.depends_on || []), producer.id];
        details.push({ step: step.id, addedDep: producer.id });
      }
    }
  }

  if (details.length > 0) writeFileSync(yamlPath, out, 'utf-8');
  return { fixed: details.length, details };
}

/** 在单个 step 的文本块里插入一条 depends_on（支持单行 flow 风格 / 多行列表 / 完全没有该字段三种形状）。 */
function insertDependsOn(blockText: string, newDep: string): string | null {
  // Case A: 单行 flow 风格 `depends_on: [a, b]`（compose 生成的 YAML 里最常见的形态）
  const flowRe = /^([ \t]*)depends_on:\s*\[([^\]]*)\](.*)$/m;
  const flowMatch = blockText.match(flowRe);
  if (flowMatch) {
    const items = flowMatch[2].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    if (items.includes(newDep)) return blockText;
    items.push(newDep);
    return blockText.replace(flowRe, `${flowMatch[1]}depends_on: [${items.join(', ')}]${flowMatch[3]}`);
  }
  // Case B: 多行列表风格 `depends_on:\n  - a\n  - b`
  const blockListRe = /^([ \t]*)depends_on:\s*\n((?:[ \t]*-\s*.+\n?)+)/m;
  const blockListMatch = blockText.match(blockListRe);
  if (blockListMatch) {
    const itemIndentMatch = blockListMatch[2].match(/^([ \t]*)-/);
    const itemIndent = itemIndentMatch ? itemIndentMatch[1] : blockListMatch[1] + '  ';
    return blockText.replace(blockListRe, `${blockListMatch[0]}${itemIndent}- ${newDep}\n`);
  }
  // Case C: 完全没有 depends_on 字段 —— 插在 output 字段后面（每个 step 通常都有 output）
  const outputRe = /^([ \t]*)output:\s*.+$/m;
  const outputMatch = blockText.match(outputRe);
  if (outputMatch) {
    return blockText.replace(outputRe, `${outputMatch[0]}\n${outputMatch[1]}depends_on: [${newDep}]`);
  }
  // 找不到能安全插入的位置 —— 放弃，交给后续修复兜底
  return null;
}

/**
 * 自动修复 compose 生成 YAML 中的变量引用错误。
 *
 * 核心约束：替换目标必须在当前 step 的 DAG 上游（递归 depends_on 闭包）内的 step.output 集合里。
 * 这避免了"早期 step 引用下游 step output"的拓扑错误（旧版策略 2 模糊匹配会把
 * personal_assessment 错误地指向 final_report 这种最终汇总 output）。
 *
 * 如果某 step 没有上游或上游 output 都对不上，bad var 留给 LLM 二次修复（repairWithLLM）。
 */
export async function autoFixVariableRefs(yamlPath: string): Promise<{ fixed: number; details: { from: string; to: string }[] }> {
  const { parseWorkflow } = await import('../core/parser.js');
  const content = readFileSync(yamlPath, 'utf-8');
  let workflow;
  try {
    workflow = parseWorkflow(yamlPath);
  } catch {
    return { fixed: 0, details: [] };
  }

  const inputNames = new Set((workflow.inputs || []).map((i: any) => i.name));
  const stepById = new Map<string, any>();
  const allOutputs = new Set<string>();
  for (const step of workflow.steps) {
    stepById.set(step.id, step);
    if (step.output) allOutputs.add(step.output);
  }
  const allDefined = new Set([...inputNames, ...allOutputs, '_loop_iteration']);

  // 计算 stepId 的 DAG 上游 step ids（递归 depends_on 闭包，不含自身）
  function upstreamStepIds(stepId: string): Set<string> {
    const out = new Set<string>();
    const stack = [stepId];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      const step = stepById.get(cur);
      if (!step) continue;
      for (const dep of step.depends_on || []) {
        if (out.has(dep)) continue;
        out.add(dep);
        stack.push(dep);
      }
    }
    return out;
  }

  const replacements: { from: string; to: string }[] = [];
  let fixedContent = content;
  // 同名 bad var 在多个 step 里只处理一次（避免重复全局 replace）
  const globallyHandled = new Set<string>();

  for (const step of workflow.steps) {
    const refs = step.task?.match(/\{\{(\w+)\}\}/g) || [];
    const badVarsInStep: string[] = [];
    for (const ref of refs) {
      const varName = ref.slice(2, -2);
      if (!allDefined.has(varName) && !globallyHandled.has(varName)) {
        badVarsInStep.push(varName);
      }
    }
    if (badVarsInStep.length === 0) continue;

    // 当前 step 的 DAG 上游 outputs（仅这些是合法替换目标）
    const upStepIds = upstreamStepIds(step.id);
    const upstreamOutputs: string[] = [];
    for (const id of upStepIds) {
      const s = stepById.get(id);
      if (s?.output) upstreamOutputs.push(s.output);
    }
    if (upstreamOutputs.length === 0) continue;  // 无上游可用 → 跳过，等 LLM 修

    const usedInThisStep = new Set<string>();

    for (const badVar of badVarsInStep) {
      let goodVar: string | undefined;

      // 策略 1：badVar 等于某个上游 step.id（含传递闭包），用该 step.output
      if (upStepIds.has(badVar)) {
        const depStep = stepById.get(badVar);
        if (depStep?.output) goodVar = depStep.output;
      }

      // 策略 2：在上游 outputs 中模糊匹配（已被本 step 用过的优先级降低）
      if (!goodVar) {
        const candidates = upstreamOutputs.filter(o => !usedInThisStep.has(o));
        const pool = candidates.length > 0 ? candidates : upstreamOutputs;
        const match = findBestMatch(badVar, pool);
        if (match) goodVar = match;
      }

      // 策略 3：上游里第一个还没被本 step 占用的 output
      if (!goodVar) {
        goodVar = upstreamOutputs.find(o => !usedInThisStep.has(o));
      }

      if (goodVar && goodVar !== badVar) {
        const re = new RegExp(`\\{\\{${escapeRegex(badVar)}\\}\\}`, 'g');
        if (re.test(fixedContent)) {
          fixedContent = fixedContent.replace(re, `{{${goodVar}}}`);
          replacements.push({ from: badVar, to: goodVar });
          usedInThisStep.add(goodVar);
          globallyHandled.add(badVar);
        }
      }
    }
  }

  if (replacements.length > 0) {
    writeFileSync(yamlPath, fixedContent, 'utf-8');
  }
  return { fixed: replacements.length, details: replacements };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 模糊匹配：找子串包含、前缀/后缀重叠最多的候选
 */
function findBestMatch(target: string, candidates: string[]): string | null {
  if (candidates.length === 0) return null;
  const t = target.toLowerCase();

  // 完全包含关系
  for (const c of candidates) {
    const cl = c.toLowerCase();
    if (t.includes(cl) || cl.includes(t)) return c;
  }

  // 按公共子串长度打分
  let best = '';
  let bestScore = 0;
  for (const c of candidates) {
    const cl = c.toLowerCase();
    const score = longestCommonSubstring(t, cl);
    if (score > bestScore && score >= 3) {
      bestScore = score;
      best = c;
    }
  }
  return best || null;
}

function longestCommonSubstring(a: string, b: string): number {
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let k = 0;
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++;
      if (k > max) max = k;
    }
  }
  return max;
}

/**
 * 当 autoFix 修不全时，调一次 LLM 让它修剩余的未定义变量。
 * Prompt 给完整 YAML + 错误清单 + 可用 inputs/outputs，让 LLM 决定:
 *  - 改 task 里的 {{X}} 引用
 *  - 给某 step 加 output 字段
 *  - 补 merge step 的 depends_on
 */
async function repairWithLLM(
  yamlPath: string,
  undefinedVars: string[],
  llmConfig: LLMConfig,
  lang: 'zh' | 'en'
): Promise<{ ok: boolean; replaced: boolean }> {
  const { parseWorkflow } = await import('../core/parser.js');
  const currentYaml = readFileSync(yamlPath, 'utf-8');
  let workflow;
  try {
    workflow = parseWorkflow(yamlPath);
  } catch {
    return { ok: false, replaced: false };
  }

  const inputNames = (workflow.inputs || []).map((i: any) => i.name);
  const outputNames: string[] = [];
  const stepIds: string[] = [];
  for (const step of workflow.steps) {
    stepIds.push(step.id);
    if (step.output) outputNames.push(step.output);
  }

  const prompt = lang === 'en'
    ? `Your previously generated workflow YAML has unresolved variable references. Fix and output the complete YAML.

# Current YAML

\`\`\`yaml
${currentYaml}
\`\`\`

# Undefined variables

These \`{{X}}\` references appear in some step's task but no step produces them as \`output\`:
${undefinedVars.map(v => `  - {{${v}}}`).join('\n')}

# Available names

inputs: ${inputNames.length > 0 ? inputNames.join(', ') : '(none)'}
existing step.output: ${outputNames.length > 0 ? outputNames.join(', ') : '(none)'}
existing step.id: ${stepIds.join(', ')}

# How to fix (pick whichever fits each case)

1. If the reference meant an existing upstream output → rename \`{{X}}\` to that output name in the task
2. If a step should be producing this output but lacks the field → add \`output: X\` to that step
3. If a merge/aggregation step's \`depends_on\` is incomplete → add the upstream step ids that produce the referenced outputs

# Output rules

- Output ONLY the corrected complete YAML code block, nothing else
- Preserve roles, descriptions, structure as much as possible
- DO NOT add commentary
`
    : `你之前生成的工作流 YAML 中有未解决的变量引用错误。请修正后输出完整的 YAML。

# 当前 YAML

\`\`\`yaml
${currentYaml}
\`\`\`

# 未定义的变量

以下 \`{{X}}\` 在某个 step 的 task 中被引用，但没有任何 step 用 \`output\` 字段产生它们：
${undefinedVars.map(v => `  - {{${v}}}`).join('\n')}

# 可用的名字

inputs: ${inputNames.length > 0 ? inputNames.join('、') : '（无）'}
已有的 step.output: ${outputNames.length > 0 ? outputNames.join('、') : '（无）'}
已有的 step.id: ${stepIds.join('、')}

# 修复方式（按场景任选）

1. 如果引用的本意是上游某个已存在的 output → 把 task 里的 \`{{X}}\` 改成该 output 的名字
2. 如果某个 step 本应产生这个 output 但少写了字段 → 给该 step 加 \`output: X\`
3. 如果合并/汇总类 step 的 \`depends_on\` 不全 → 补上产生这些 output 的上游 step.id

# 输出要求

- 只输出修正后的完整 YAML 代码块，不要输出其他文字
- 保持角色、描述、结构尽量不变
- 不要加解释
`;

  const systemPrompt = lang === 'en'
    ? 'You are a YAML workflow repair assistant. Output only the corrected YAML code block.'
    : '你是一个 YAML 工作流修复助手。只输出修正后的 YAML 代码块。';

  try {
    const connector = createConnector(llmConfig);
    const result = await connector.chat(systemPrompt, prompt, {
      ...llmConfig,
      max_tokens: llmConfig.max_tokens || 4096,
    });
    const fixedYaml = extractYamlFromResponse(result.content);
    if (!fixedYaml || !fixedYaml.includes('steps:')) {
      process.stderr.write('  ⚠️  LLM 二次修复返回的内容不是有效 YAML，保留原文件\n');
      return { ok: false, replaced: false };
    }
    writeFileSync(yamlPath, fixedYaml + '\n', 'utf-8');
    return { ok: true, replaced: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`  ⚠️  LLM 二次修复调用失败: ${msg.slice(0, 120)}\n`);
    return { ok: false, replaced: false };
  }
}
