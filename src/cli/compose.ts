/**
 * ao compose — AI 智能编排工作流
 *
 * 用户用一句话描述需求，AI 从 186 个角色中选角色、设计 DAG、生成完整 workflow YAML。
 */
import { listAgents } from '../agents/loader.js';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createConnector } from '../connectors/factory.js';
import type { LLMConfig } from '../types.js';

/** 精简的角色摘要，供 LLM 选角色用 */
export interface RoleSummary {
  path: string;       // e.g. "engineering/engineering-code-reviewer"
  name: string;       // e.g. "代码审查员"
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
      lines.push(`- ${r.path} | ${r.name} | ${r.description}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * 构建发给 LLM 的 system prompt
 */
export function buildComposeSystemPrompt(catalog: string): string {
  return `你是一个 AI 工作流编排专家。用户会用一句话描述他想要的工作流，你需要：

1. 从下方角色目录中选择最合适的角色（通常 2-6 个）
2. 设计合理的 DAG 依赖关系（哪些步骤可以并行，哪些必须串行）
3. 为每个步骤编写详细的 task 描述
4. 设计合理的输入变量
5. 生成完整的 workflow YAML

## 输出格式

直接输出一个完整的 YAML 代码块，格式如下：

\`\`\`yaml
name: "工作流名称"
description: "一句话描述"

agents_dir: "agency-agents-zh"

llm:
  provider: deepseek
  model: deepseek-chat
  max_tokens: 4096

concurrency: 2

inputs:
  - name: variable_name
    description: "变量描述"
    required: true

steps:
  - id: step_id
    role: "category/role-name"
    task: |
      详细的任务描述...
      使用 {{variable_name}} 引用输入变量
      使用 {{previous_output}} 引用上游步骤的输出
    output: output_variable_name
    depends_on: [upstream_step_id]  # 仅在有依赖时添加
\`\`\`

## 设计原则

- **并行优先**：没有数据依赖的步骤应该并行执行（不加 depends_on）
- **变量串联**：上游步骤的 output 变量名要和下游步骤 task 中的 {{变量}} 对应
- **角色匹配**：选择最专业的角色，不要用一个角色做所有事
- **任务详细**：task 描述要具体，告诉角色要做什么、输出什么格式
- **合理输入**：提取用户需求中的关键变量作为 inputs
- **最终汇总**：如果有多路并行，最后应该有一个汇总步骤

## 可用角色目录

${catalog}

## 注意

- role 的值必须严格使用角色目录中的 path（如 "engineering/engineering-code-reviewer"），不要自己编造
- 只输出 YAML 代码块，不要输出其他内容
- concurrency 设为并行步骤的最大数量`;
}

/**
 * 构建 user prompt
 */
export function buildComposeUserPrompt(description: string): string {
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
}): Promise<{ yaml: string; savedPath: string; relativePath: string; warnings: string[] }> {
  const { description, agentsDir, llmConfig } = options;

  // 1. 构建角色目录
  const roles = buildRoleCatalog(agentsDir);
  if (roles.length === 0) {
    throw new Error(`角色目录为空: ${agentsDir}\n请先运行 ao init 下载角色定义`);
  }
  const catalog = formatCatalogForPrompt(roles);

  // 2. 构建 prompt
  const systemPrompt = buildComposeSystemPrompt(catalog);
  const userPrompt = buildComposeUserPrompt(description);

  // 3. 调用 LLM
  console.log(`  正在用 AI 编排工作流...（${roles.length} 个角色可选）\n`);

  const connector = createConnector(llmConfig);
  const result = await connector.chat(systemPrompt, userPrompt, {
    ...llmConfig,
    max_tokens: llmConfig.max_tokens || 4096,
  });

  // 4. 提取 YAML
  const yaml = extractYamlFromResponse(result.content);
  if (!yaml || !yaml.includes('steps:')) {
    throw new Error('AI 生成的内容不是有效的 workflow YAML，请重试或调整描述');
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

  console.log(`  Token 用量: 输入 ${result.usage.input_tokens}, 输出 ${result.usage.output_tokens}`);

  // 6. 校验生成的 YAML
  const warnings: string[] = [];
  try {
    const { parseWorkflow, validateWorkflow } = await import('../core/parser.js');
    const workflow = parseWorkflow(savedPath);
    const errors = validateWorkflow(workflow);
    if (errors.length > 0) {
      for (const e of errors) {
        warnings.push(e);
      }
    }
  } catch (err) {
    warnings.push(`YAML 解析失败: ${err instanceof Error ? err.message : err}`);
  }

  return { yaml, savedPath, relativePath, warnings };
}
