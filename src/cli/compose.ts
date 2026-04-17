/**
 * ao compose — AI 智能编排工作流
 *
 * 用户用一句话描述需求，AI 从角色库中选角色、设计 DAG、生成完整 workflow YAML。
 * 支持中文（agency-agents-zh）和英文（agency-agents）角色库。
 */
import { listAgents } from '../agents/loader.js';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createConnector } from '../connectors/factory.js';
import type { LLMConfig } from '../types.js';
import { t } from '../i18n.js';

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
  const agents = listAgents(agentsDir);
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
export function buildComposeSystemPrompt(catalog: string, options?: { autoRun?: boolean; provider?: string; model?: string; lang?: 'zh' | 'en' }): string {
  const lang = options?.lang ?? 'zh';
  return lang === 'en'
    ? buildComposeSystemPromptEn(catalog, options)
    : buildComposeSystemPromptZh(catalog, options);
}

function buildComposeSystemPromptEn(catalog: string, options?: { autoRun?: boolean; provider?: string; model?: string }): string {
  const autoRun = options?.autoRun ?? false;
  const provider = options?.provider || 'deepseek';
  const model = options?.model;

  const inputsSection = autoRun
    ? `
## Important: Direct Run Mode

This workflow will be executed immediately after generation, so:
- **Do NOT** generate an inputs section
- Embed all specific information from the user's description directly into each step's task
- Ensure the workflow can run without any external inputs`
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

agents_dir: "agency-agents"

llm:
  provider: ${provider}
  ${model ? `model: ${model}` : ''}
  max_tokens: 4096
  timeout: 120000
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
\`\`\`

## Design Principles

- **Parallel first**: Steps without data dependencies should run in parallel (no depends_on)
- **Variable chaining**: Upstream step output variable names must match downstream {{variable}} references
- **Role matching**: Select the most specialized role for each task — don't use one role for everything
- **Role naming**: Each step must have a name (approachable job title like "CEO", "Product Manager", "Tech Lead") and emoji, so anyone can instantly see who's speaking
- **Detailed tasks**: Task descriptions should be specific — tell the role what to do and what format to output
${inputsDesignPrinciple}
- **Final deliverable**: The last step must output the final deliverable the user wants (e.g., complete article, complete report), not review comments or suggestions. If there's a review step, it should output the revised final version, not a "list of suggestions"

## Available Role Catalog

${catalog}

## Rules

- The role value must strictly use paths from the role catalog (e.g., "engineering/engineering-code-reviewer") — do NOT make up role paths
- **Variable names must use underscores**, no spaces. Correct: "market_analysis", "tech_report". Wrong: "market analysis", "tech report". All id, output, and depends_on values must be snake_case
- Only output the YAML code block, nothing else
- Set concurrency to the maximum number of parallel steps
- **Important: Split large tasks**. When writing long articles, don't let one step generate more than 800 words. Split by sections into multiple parallel steps (e.g., write_ch1, write_ch2, write_ch3), then use a merge step to rewrite into a coherent complete article
- Limit word count in each writing step's task (e.g., "under 500 words") to avoid overly long single-step generation times`;
}

function buildComposeSystemPromptZh(catalog: string, options?: { autoRun?: boolean; provider?: string; model?: string }): string {
  const autoRun = options?.autoRun ?? false;
  const provider = options?.provider || 'deepseek';
  const model = options?.model;

  const inputsSection = autoRun
    ? `
## 重要：直接运行模式

这个工作流生成后会立即执行，所以：
- **不要**生成 inputs 段
- 把用户描述中的所有具体信息直接写进每个 step 的 task 里
- 确保工作流无需任何外部输入就能直接运行`
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

agents_dir: "agency-agents-zh"

llm:
  provider: ${provider}
  ${model ? `model: ${model}` : ''}
  max_tokens: 4096
  timeout: 120000
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
\`\`\`

## 设计原则

- **并行优先**：没有数据依赖的步骤应该并行执行（不加 depends_on）
- **变量串联**：上游步骤的 output 变量名要和下游步骤 task 中的 {{变量}} 对应
- **角色匹配**：选择最专业的角色，不要用一个角色做所有事
- **角色命名**：每个步骤必须设置 name（通俗的公司职位名如"老板""产品经理""技术总监"）和 emoji，让小白也能一眼看懂谁在说话
- **任务详细**：task 描述要具体，告诉角色要做什么、输出什么格式
${inputsDesignPrinciple}
- **最终成品**：最后一个步骤必须输出用户想要的最终成品（如完整文章、完整报告），而不是审查意见或修改建议。如果有审校步骤，审校步骤应该直接输出修改后的定稿，而不是"修改建议列表"

## 可用角色目录

${catalog}

## 注意

- role 的值必须严格使用角色目录中的 path（如 "engineering/engineering-code-reviewer"），不要自己编造
- **变量名必须用下划线**，不能有空格。正确："market_analysis"、"tech_report"。错误："market analysis"、"tech report"。id、output、depends_on 中的值都必须用 snake_case
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
}): Promise<{ yaml: string; savedPath: string; relativePath: string; warnings: string[] }> {
  const { description, agentsDir, llmConfig } = options;
  const lang = options.lang ?? detectLang(description);

  // 1. 构建角色目录
  const roles = buildRoleCatalog(agentsDir);
  if (roles.length === 0) {
    throw new Error(t('compose.empty_catalog', { dir: agentsDir }));
  }
  const catalog = formatCatalogForPrompt(roles);

  // 2. 构建 prompt
  const systemPrompt = buildComposeSystemPrompt(catalog, {
    autoRun: options.autoRun,
    provider: options.llmConfig.provider,
    model: options.llmConfig.model,
    lang,
  });
  const userPrompt = buildComposeUserPrompt(description, lang);

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
  const workflowsDir = resolve('workflows');
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

  const first = await validateGenerated(savedPath);

  // 发现幻觉角色 → 让 LLM 修一次
  if (first.invalidRoles.length > 0) {
    console.log(`  检测到 ${first.invalidRoles.length} 个不存在的角色，自动重新生成...`);
    const retryPrompt = lang === 'en'
      ? `The following role paths in your previous YAML do NOT exist in the catalog: ${first.invalidRoles.join(', ')}.\n\nRegenerate the FULL YAML. Use ONLY role paths from the catalog above. Do not invent new paths.`
      : `你上次生成的 YAML 里有不存在的 role 路径：${first.invalidRoles.join('、')}。\n\n请重新生成完整 YAML，role 必须严格使用上方角色目录中列出的路径，不要编造。`;
    try {
      const retryResult = await connector.chat(systemPrompt, `${userPrompt}\n\n${retryPrompt}`, {
        ...llmConfig,
        max_tokens: llmConfig.max_tokens || 4096,
      });
      const retryYaml = extractYamlFromResponse(retryResult.content);
      if (retryYaml && retryYaml.includes('steps:')) {
        writeFileSync(savedPath, retryYaml + '\n', 'utf-8');
        const second = await validateGenerated(savedPath);
        warnings.push(...second.errors);
        return { yaml: retryYaml, savedPath, relativePath, warnings };
      }
    } catch (err) {
      warnings.push(`自动修正失败（保留原始输出）: ${err instanceof Error ? err.message : err}`);
    }
  }

  warnings.push(...first.errors);
  return { yaml, savedPath, relativePath, warnings };
}
