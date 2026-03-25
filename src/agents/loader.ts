/**
 * 加载 agency-agents 的 .md 文件，提取角色定义
 *
 * 文件格式:
 * ---
 * name: 角色名
 * description: 描述
 * emoji: 🔧
 * ---
 * # 角色标题
 * ...system prompt 内容...
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AgentDefinition } from '../types.js';

/**
 * 加载指定角色的定义
 * @param agentsDir agency-agents 的 agents 目录路径
 * @param rolePath 角色路径，如 "engineering/engineering-sre"
 */
export function loadAgent(agentsDir: string, rolePath: string): AgentDefinition {
  const fullPath = resolve(agentsDir, `${rolePath}.md`);

  if (!existsSync(fullPath)) {
    throw new Error(`角色文件不存在: ${fullPath}\n请确认 agents_dir 和 role 路径正确`);
  }

  const content = readFileSync(fullPath, 'utf-8');
  return parseAgentFile(content, rolePath);
}

/**
 * 解析 agent .md 文件内容
 */
function parseAgentFile(content: string, rolePath: string): AgentDefinition {
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    // 没有 frontmatter，整个文件当 system prompt
    return {
      name: rolePath,
      description: '',
      systemPrompt: content.trim(),
    };
  }

  const frontmatterRaw = frontmatterMatch[1];
  const body = frontmatterMatch[2];

  // 简单解析 frontmatter（不用 js-yaml 避免循环依赖，frontmatter 结构简单）
  const meta: Record<string, string> = {};
  for (const line of frontmatterRaw.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
      meta[key] = value;
    }
  }

  return {
    name: meta.name || rolePath,
    description: meta.description || '',
    emoji: meta.emoji,
    tools: meta.tools,
    systemPrompt: body.trim(),
  };
}

/**
 * 列出所有可用角色
 */
export function listAgents(agentsDir: string): AgentDefinition[] {
  const dir = resolve(agentsDir);
  if (!existsSync(dir)) {
    throw new Error(`agents 目录不存在: ${dir}`);
  }

  const agents: AgentDefinition[] = [];

  // 遍历子目录
  for (const dept of readdirSync(dir, { withFileTypes: true })) {
    if (!dept.isDirectory()) continue;
    // 跳过非 agent 目录
    if (dept.name.startsWith('.') || dept.name === 'node_modules' || dept.name === 'scripts' ||
        dept.name === 'integrations' || dept.name === 'examples') continue;
    const deptDir = join(dir, dept.name);

    for (const file of readdirSync(deptDir, { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith('.md')) continue;
      const rolePath = `${dept.name}/${file.name.replace('.md', '')}`;
      try {
        const agent = loadAgent(agentsDir, rolePath);
        agent.rolePath = rolePath;
        agents.push(agent);
      } catch {
        // 跳过无法解析的文件
      }
    }
  }

  return agents;
}
