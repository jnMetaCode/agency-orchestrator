/**
 * `ao install --tool <tool>` —— 把内置 AI 角色装进各编码工具（Claude Code / Cursor 等）。
 *
 * 借鉴 agency-agents-app 的核心能力，但聚焦 AO 生态：中文角色库(agency-agents-zh)是空位，
 * 让"只在编码工具里用角色、不跑工作流"的用户也能一键装入。角色 .md 的 frontmatter
 * (name/description) 本就是 Claude Code agent 格式，多数工具可直接复制。
 */
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface ToolTarget {
  id: string;
  label: string;
  /** 安装目标目录：user 级用 home，project 级用 cwd */
  dest: (home: string, cwd: string) => string;
  ext: string;
  scope: 'user' | 'project';
}

/** 各编码工具的安装目标（参考 agency-agents-app 的 destination 表）。 */
export const INSTALL_TARGETS: Record<string, ToolTarget> = {
  'claude-code': { id: 'claude-code', label: 'Claude Code', dest: (h) => join(h, '.claude', 'agents'), ext: '.md', scope: 'user' },
  'copilot':     { id: 'copilot',     label: 'GitHub Copilot', dest: (h) => join(h, '.github', 'agents'), ext: '.md', scope: 'user' },
  'gemini-cli':  { id: 'gemini-cli',  label: 'Gemini CLI', dest: (h) => join(h, '.gemini', 'agents'), ext: '.md', scope: 'user' },
  'qwen':        { id: 'qwen',        label: 'Qwen Code', dest: (h) => join(h, '.qwen', 'agents'), ext: '.md', scope: 'user' },
  'cursor':      { id: 'cursor',      label: 'Cursor', dest: (_h, cwd) => join(cwd, '.cursor', 'rules'), ext: '.mdc', scope: 'project' },
  'opencode':    { id: 'opencode',    label: 'opencode', dest: (_h, cwd) => join(cwd, '.opencode', 'agents'), ext: '.md', scope: 'project' },
  // 腾讯 WorkBuddy 桌面版：内置的 CodeBuddy CLI 在产品态下把配置目录切成 ~/.workbuddy，子智能体读
  // <配置目录>/agents/*.md（frontmatter 只要 name/description，与 Claude Code 同格式，逐字复制即可）。
  'workbuddy':   { id: 'workbuddy',   label: 'WorkBuddy', dest: (h) => join(h, '.workbuddy', 'agents'), ext: '.md', scope: 'user' },
  // 独立安装的 CodeBuddy CLI（npm -g）：~/.codebuddy/agents，CODEBUDDY_CONFIG_DIR 可整体改位置
  'codebuddy':   { id: 'codebuddy',   label: 'CodeBuddy CLI', dest: (h) => join(process.env.CODEBUDDY_CONFIG_DIR || join(h, '.codebuddy'), 'agents'), ext: '.md', scope: 'user' },
};

const SKIP_DIRS = new Set(['node_modules', 'scripts', 'integrations', 'examples', '.git']);

export interface RoleFile {
  rolePath: string; // category/id
  category: string;
  id: string;
  absPath: string;
}

/** 递归收集角色 .md（只取带 `name:` frontmatter 的真角色，跳过 README/示例等）。 */
export function collectRoleFiles(agentsDir: string): RoleFile[] {
  const root = resolve(agentsDir);
  const out: RoleFile[] = [];
  const walk = (dir: string, category: string) => {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full, category ? `${category}/${entry}` : entry); // 用完整相对目录作 category，避免嵌套分类重名
      } else if (entry.endsWith('.md') && !/^(README|CONTRIBUTING|LICENSE|SECURITY)/i.test(entry)) {
        const head = readFileSync(full, 'utf-8').slice(0, 400);
        if (!/^---[\s\S]*?\bname\s*:/.test(head)) continue; // 必须有 name frontmatter
        const id = entry.replace(/\.md$/, '');
        out.push({ rolePath: `${category}/${id}`, category: category || 'other', id, absPath: full });
      }
    }
  };
  walk(root, '');
  return out;
}

export interface InstallResult {
  installed: number;
  destDir: string;
  files: string[];
}

/**
 * 把角色装进目标工具目录。文件名用 `<category>-<id><ext>` 防跨分类重名。
 * 内容逐字复制（角色 .md 的 frontmatter 即各工具通用格式）。
 */
export function installRoles(
  agentsDir: string,
  target: ToolTarget,
  opts: { home: string; cwd: string; category?: string; dryRun?: boolean } = { home: '', cwd: '' },
): InstallResult {
  const roles = collectRoleFiles(agentsDir).filter((r) => !opts.category || r.category === opts.category);
  const destDir = target.dest(opts.home, opts.cwd);
  const files: string[] = [];
  if (!opts.dryRun && roles.length) mkdirSync(destDir, { recursive: true });
  for (const r of roles) {
    // 文件名用完整分类路径拍平(a/b → a-b)，避免嵌套分类下同名角色互相覆盖
    const outName = `${r.category.replace(/\//g, '-')}-${r.id}${target.ext}`;
    const outPath = join(destDir, outName);
    if (!opts.dryRun) writeFileSync(outPath, readFileSync(r.absPath, 'utf-8'), 'utf-8');
    files.push(outName);
  }
  return { installed: files.length, destDir, files };
}
