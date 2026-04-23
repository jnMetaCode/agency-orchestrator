/**
 * Minimal i18n for CLI user-facing strings.
 *
 * Language detection priority:
 *   1. --lang=en CLI flag
 *   2. AO_LANG env var
 *   3. LANG env var (en_US.UTF-8 → en)
 *   4. Default: zh
 */

type Lang = 'zh' | 'en';

let currentLang: Lang | null = null;

export function detectLang(argv: string[] = process.argv): Lang {
  if (currentLang) return currentLang;

  const flag = argv.find(a => a === '--lang=en' || a === '--lang=zh');
  if (flag) {
    currentLang = flag.endsWith('en') ? 'en' : 'zh';
    return currentLang;
  }
  const idx = argv.indexOf('--lang');
  if (idx >= 0 && argv[idx + 1]) {
    currentLang = argv[idx + 1].toLowerCase().startsWith('en') ? 'en' : 'zh';
    return currentLang;
  }

  const envAo = process.env.AO_LANG;
  if (envAo) {
    currentLang = envAo.toLowerCase().startsWith('en') ? 'en' : 'zh';
    return currentLang;
  }

  const envLang = process.env.LANG || process.env.LC_ALL || '';
  if (/^en/i.test(envLang)) {
    currentLang = 'en';
    return currentLang;
  }

  currentLang = 'zh';
  return currentLang;
}

export function setLang(lang: Lang): void {
  currentLang = lang;
}

type Dict = Record<string, { zh: string; en: string }>;

const dict: Dict = {
  'compose.generating': {
    zh: '正在用 AI 编排工作流...（{n} 个角色可选）',
    en: 'Composing workflow with AI... ({n} roles available)',
  },
  'compose.tokens': {
    zh: 'Token 用量: 输入 {in}, 输出 {out}',
    en: 'Token usage: input {in}, output {out}',
  },
  'compose.generated': {
    zh: '✅ 工作流已生成: {path}',
    en: '✅ Workflow generated: {path}',
  },
  'compose.warnings_header': {
    zh: '⚠️  校验发现问题（AI 生成的 YAML 可能需要手动调整）:',
    en: '⚠️  Validation warnings (AI-generated YAML may need manual tweaks):',
  },
  'compose.invalid_yaml': {
    zh: 'AI 生成的内容不是有效的 workflow YAML，请重试或调整描述',
    en: 'AI output is not a valid workflow YAML — retry or refine your description',
  },
  'compose.empty_catalog': {
    zh: '角色目录为空: {dir}\n请先运行 ao init 下载角色定义',
    en: 'Role catalog is empty: {dir}\nRun `ao init` first to download role definitions',
  },
  'compose.retry_yaml_bad': {
    zh: '严重错误无法自动运行，请手动修复后执行:',
    en: 'Severe errors detected — auto-run disabled. Fix manually then:',
  },
  'compose.auto_running': {
    zh: '开始执行工作流...',
    en: 'Running workflow...',
  },
  'compose.preview': {
    zh: '预览:',
    en: 'Preview:',
  },
  'compose.next_steps': {
    zh: '接下来可以:',
    en: 'Next steps:',
  },
  'compose.next.validate': {
    zh: '校验工作流',
    en: 'validate the workflow',
  },
  'compose.next.plan': {
    zh: '查看执行计划',
    en: 'view execution plan',
  },
  'compose.next.run': {
    zh: '运行工作流',
    en: 'run the workflow',
  },
  'stream.received': {
    zh: '📡 已接收 {size}KB...',
    en: '📡 Received {size}KB...',
  },
  'error.prefix': {
    zh: '错误',
    en: 'Error',
  },
  'validate.usage': {
    zh: '用法: ao validate <workflow.yaml>',
    en: 'Usage: ao validate <workflow.yaml>',
  },
  'validate.ok': {
    zh: '{name} — 校验通过',
    en: '{name} — validation passed',
  },
  'validate.stats': {
    zh: '{steps} 个步骤, {inputs} 个输入',
    en: '{steps} step(s), {inputs} input(s)',
  },
  'validate.failed': {
    zh: '{name} — 校验失败:',
    en: '{name} — validation failed:',
  },
  'plan.usage': {
    zh: '用法: ao plan <workflow.yaml>',
    en: 'Usage: ao plan <workflow.yaml>',
  },
  'plan.validate_failed': {
    zh: '校验失败:',
    en: 'Validation failed:',
  },
  'parse.bad_yaml': { zh: '工作流文件格式错误: {path}', en: 'Invalid workflow YAML: {path}' },
  'parse.missing_name': { zh: '工作流缺少 name 字段', en: 'Workflow is missing the `name` field' },
  'parse.missing_steps': { zh: '工作流缺少 steps 或 steps 为空', en: 'Workflow is missing `steps` or `steps` is empty' },
  'parse.missing_llm': { zh: '工作流缺少 llm 配置', en: 'Workflow is missing the `llm` block' },
  'parse.missing_provider': { zh: 'llm 配置缺少 provider', en: '`llm.provider` is required' },
  'parse.missing_model': { zh: 'llm 配置缺少 model（CLI provider 可省略）', en: '`llm.model` is required (optional for CLI providers)' },
  'parse.missing_step_id': { zh: 'step 缺少 id', en: 'Each step needs an `id`' },
  'dag.title': { zh: '执行计划:', en: 'Execution plan:' },
  'dag.layer': { zh: '第{n}层', en: 'Layer {n}' },
  'dag.parallel': { zh: ' (并行)', en: ' (parallel)' },
  'dag.deps': { zh: '依赖', en: 'depends on' },
  'dag.condition': { zh: '条件', en: 'condition' },
  'dag.loop': { zh: '循环: → {to} (最多 {n} 次)', en: 'loop: → {to} (max {n} iter)' },
  'help.text': {
    zh: `
  agency-orchestrator — 多智能体工作流引擎
  基于 agency-agents-zh 的多智能体编排引擎

  快速开始:
    ao demo                           零配置体验多智能体协作
    ao init                           下载 AI 角色定义（中文）
    ao init --lang en                 下载英文角色定义
    ao roles                          查看所有可用角色
    ao plan <workflow.yaml>           查看执行计划 (DAG)
    ao run <workflow.yaml> [options]  执行工作流

  命令:
    demo                              零配置体验多智能体协作（mock + 真实 AI）
    init                              下载/更新角色库 (--lang en 下载英文版)
    init --workflow                   交互式创建新工作流
    init --provider <p> --model <m>   写入 .env 默认配置（支持 --base-url, --api-key）
    compose "描述"                    AI 智能编排工作流（一句话生成 YAML）
    compose "描述" --run              生成并立即运行（一句话出结果）
    serve                             启动 MCP Server（供 Claude Code / Cursor 调用）
    run <workflow.yaml>               执行工作流
    validate <workflow.yaml>          校验工作流定义
    plan <workflow.yaml>              查看执行计划
    explain <workflow.yaml>           用自然语言解释执行计划
    roles [--agents-dir path]         列出可用角色

  选项:
    --input, -i key=value    传入输入变量
    --input, -i key=@file    从文件读取变量值
    --provider <name>        覆盖 YAML 中的 LLM provider (如 claude-code, deepseek)
    --model <name>           覆盖 YAML 中的模型名
    --timeout <值>            单步超时，支持 300000/300s/5m/0 (0=不限时)
    --output dir             输出目录 (默认 ao-output/)
    --resume <dir|last>      从上次运行恢复（加载已完成步骤的输出）
    --from <step-id>         配合 --resume，从指定步骤重新执行
    --watch                  实时进度显示（终端 UI）
    --quiet, -q              静默模式
    --lang <zh|en>           界面语言（默认根据系统 LANG 检测，也可用 AO_LANG 环境变量）
    --version, -v            版本号

  示例:
    ao init
    ao compose "PR 代码审查，覆盖安全和性能"
    ao run workflows/story-creation.yaml -i premise='一个时间旅行的故事' -i style='悬疑'
    ao run workflows/product-review.yaml -i prd_content=@prd.md
    ao plan workflows/content-pipeline.yaml

  Resume (基于上次结果迭代):
    ao run workflow.yaml --resume last                    # 跳过上次已完成的步骤
    ao run workflow.yaml --resume last --from summary     # 从 summary 步骤重新执行
    ao run workflow.yaml --resume ao-output/xxx/          # 指定具体输出目录

  Agents (中文): https://github.com/jnMetaCode/agency-agents-zh
  Agents (英文): https://github.com/msitarzewski/agency-agents
  `,
    en: `
  agency-orchestrator — Multi-Agent Workflow Engine
  YAML-defined workflows · 170+ English roles · auto DAG parallelism

  Quick Start:
    ao demo                           Zero-config multi-agent demo
    ao init --lang en                 Download English AI roles
    ao roles                          List all available roles
    ao plan <workflow.yaml>           Show execution plan (DAG)
    ao run <workflow.yaml> [options]  Execute a workflow

  Commands:
    demo                              Zero-config demo (mock + real AI)
    init                              Download/update role library (--lang en for English)
    init --workflow                   Interactively create a new workflow
    init --provider <p> --model <m>   Write default config to .env (supports --base-url, --api-key)
    compose "desc"                    AI-compose a workflow from one sentence
    compose "desc" --run              Compose and run immediately
    serve                             Start MCP server (for Claude Code / Cursor)
    run <workflow.yaml>               Execute a workflow
    validate <workflow.yaml>          Validate a workflow definition
    plan <workflow.yaml>              Show execution plan
    explain <workflow.yaml>           Explain the plan in natural language
    roles [--agents-dir path]         List available roles

  Options:
    --input, -i key=value    Pass an input variable
    --input, -i key=@file    Read variable value from a file
    --provider <name>        Override LLM provider (e.g. claude-code, deepseek)
    --model <name>           Override model name from YAML
    --timeout <value>        Per-step timeout, accepts 300000/300s/5m/0 (0=no limit)
    --output dir             Output directory (default: ao-output/)
    --resume <dir|last>      Resume from previous run (reuse completed step outputs)
    --from <step-id>         With --resume, re-run starting from this step
    --watch                  Live progress display (terminal UI)
    --quiet, -q              Quiet mode
    --lang <zh|en>           Interface language (auto-detected from LANG; also AO_LANG env)
    --version, -v            Show version

  Examples:
    ao init --lang en
    ao compose "PR code review covering security and performance" --provider claude-code
    ao run workflows/story-creation.yaml -i premise='A time-travel story' -i style='mystery'
    ao run workflows/product-review.yaml -i prd_content=@prd.md
    ao plan workflows/content-pipeline.yaml

  Resume (iterate on previous results):
    ao run workflow.yaml --resume last                    # Skip completed steps
    ao run workflow.yaml --resume last --from summary     # Re-run from the summary step
    ao run workflow.yaml --resume ao-output/xxx/          # Point at a specific output dir

  Agents (Chinese): https://github.com/jnMetaCode/agency-agents-zh
  Agents (English): https://github.com/msitarzewski/agency-agents
  `,
  },
};

export function t(key: keyof typeof dict, params: Record<string, string | number> = {}): string {
  const lang = detectLang();
  const entry = dict[key];
  if (!entry) return String(key);
  let s = entry[lang];
  for (const [k, v] of Object.entries(params)) {
    s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  }
  return s;
}
