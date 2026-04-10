#!/usr/bin/env node
/**
 * agency-orchestrator CLI
 *
 * 用法:
 *   ao run workflow.yaml --input key=value --input file=@path.md
 *   ao validate workflow.yaml
 *   ao plan workflow.yaml
 *   ao roles --agents-dir ./agents
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';
import { parseWorkflow, validateWorkflow } from './core/parser.js';
import type { LLMConfig } from './types.js';
import { buildDAG, formatDAG } from './core/dag.js';
import { listAgents } from './agents/loader.js';
import { run } from './index.js';

const args = process.argv.slice(2);
const command = args[0];

async function main(): Promise<void> {
  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  switch (command) {
    case 'run':
      await handleRun();
      break;
    case 'validate':
      handleValidate();
      break;
    case 'plan':
      handlePlan();
      break;
    case 'roles':
      handleRoles();
      break;
    case 'init':
      await handleInit();
      break;
    case 'explain':
      await handleExplain();
      break;
    case 'compose':
      await handleCompose();
      break;
    case 'demo':
      await handleDemo();
      break;
    case 'serve':
      await handleServe();
      break;
    case '--version':
    case '-v':
      console.log(getVersion());
      break;
    default: {
      // 容错：用户可能漏了空格，如 "planworkflows/x.yaml"
      const knownCmds = ['run', 'validate', 'plan', 'explain', 'compose', 'demo', 'roles', 'init', 'serve'];
      const match = knownCmds.find(c => command.startsWith(c) && command.length > c.length);
      if (match) {
        console.error(`看起来少了个空格？试试:\n  ao ${match} ${command.slice(match.length)}\n`);
      } else {
        console.error(`未知命令: ${command}\n`);
        printHelp();
      }
      process.exit(1);
    }
  }
}

async function handleRun(): Promise<void> {
  const filePath = args[1];
  if (!filePath) {
    console.error('用法: ao run <workflow.yaml> [--input key=value ...]');
    process.exit(1);
  }

  const inputs = parseInputArgs();
  const outputDir = getArgValue('--output') || 'ao-output';
  const quiet = args.includes('--quiet') || args.includes('-q');
  const watch = args.includes('--watch');
  let resumeDir = getArgValue('--resume');
  const fromStep = getArgValue('--from');
  const provider = getArgValue('--provider') as LLMConfig['provider'] | undefined;
  const model = getArgValue('--model');

  // --resume last: 自动找最近一次的输出目录
  if (resumeDir === 'last') {
    const { findLatestOutput } = await import('./output/reporter.js');
    const latest = findLatestOutput(outputDir);
    if (!latest) {
      console.error('找不到上一次的运行输出，请指定具体目录: --resume <dir>');
      process.exit(1);
    }
    resumeDir = latest;
  }

  try {
    // --provider / --model: 命令行覆盖 YAML 中的 LLM 配置
    const cliProviders = ['claude-code', 'gemini-cli', 'copilot-cli', 'codex-cli', 'openclaw-cli'];
    const llmOverride = provider ? {
      provider,
      // CLI provider 不指定 model 时清空（避免 YAML 里的 deepseek-chat 传给 claude CLI）
      model: model || (cliProviders.includes(provider) ? '' : undefined),
      ...(cliProviders.includes(provider) ? { timeout: 600_000 } : {}),
    } as Partial<LLMConfig> : undefined;

    const result = await run(resolve(filePath), inputs, {
      outputDir,
      quiet,
      watch,
      resumeDir: resumeDir ? resolve(resumeDir) : undefined,
      fromStep,
      llmOverride,
    });
    process.exit(result.success ? 0 : 1);
  } catch (err) {
    console.error(`\n错误: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

function handleValidate(): void {
  const filePath = args[1];
  if (!filePath) {
    console.error('用法: ao validate <workflow.yaml>');
    process.exit(1);
  }

  try {
    const workflow = parseWorkflow(resolve(filePath));
    const errors = validateWorkflow(workflow);

    if (errors.length === 0) {
      console.log(`  ${workflow.name} — 校验通过`);
      console.log(`  ${workflow.steps.length} 个步骤, ${(workflow.inputs || []).length} 个输入`);
    } else {
      console.error(`  ${workflow.name} — 校验失败:\n`);
      for (const err of errors) {
        console.error(`  - ${err}`);
      }
      process.exit(1);
    }
  } catch (err) {
    console.error(`错误: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

function handlePlan(): void {
  const filePath = args[1];
  if (!filePath) {
    console.error('用法: ao plan <workflow.yaml>');
    process.exit(1);
  }

  try {
    const workflow = parseWorkflow(resolve(filePath));
    const errors = validateWorkflow(workflow);
    if (errors.length > 0) {
      console.error(`校验失败:\n${errors.map(e => `  - ${e}`).join('\n')}`);
      process.exit(1);
    }

    const dag = buildDAG(workflow);
    console.log(`\n  ${workflow.name}\n`);
    console.log(formatDAG(dag));
  } catch (err) {
    console.error(`错误: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

async function handleExplain(): Promise<void> {
  const filePath = args[1];
  if (!filePath) {
    console.error('用法: ao explain <workflow.yaml>');
    process.exit(1);
  }

  try {
    const workflow = parseWorkflow(resolve(filePath));
    const errors = validateWorkflow(workflow);
    if (errors.length > 0) {
      console.error(`校验失败:\n${errors.map(e => `  - ${e}`).join('\n')}`);
      process.exit(1);
    }

    const { explainWorkflow } = await import('./cli/explain.js');
    console.log('\n' + explainWorkflow(workflow) + '\n');
  } catch (err) {
    console.error(`错误: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

async function handleCompose(): Promise<void> {
  const autoRun = args.includes('--run');
  // 描述是第一个非 flag 的参数（跳过 compose 本身和 --xxx 的值）
  const flagsWithValue = new Set(['--name', '--provider', '--model', '--agents-dir']);
  let description: string | undefined;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--run') continue;
    if (args[i].startsWith('--')) {
      if (flagsWithValue.has(args[i])) i++; // 跳过 flag 的值
      continue;
    }
    description = args[i];
    break;
  }
  if (!description) {
    console.error('用法: ao compose "用一句话描述你想要的工作流"');
    console.error('');
    console.error('示例:');
    console.error('  ao compose "PR 代码审查，要覆盖安全和性能"');
    console.error('  ao compose "写一篇技术博客，需要调研、写稿、审校"');
    console.error('  ao compose "用户反馈分析，分类后分别给产品和技术团队"');
    console.error('');
    console.error('选项:');
    console.error('  --run                生成后立即运行（一句话出结果）');
    console.error('  --name <filename>   自定义输出文件名 (不含 .yaml 后缀)');
    console.error('  --provider <name>   LLM 提供商 (默认 deepseek)');
    console.error('  --model <name>      模型名 (默认 deepseek-chat)');
    process.exit(1);
  }

  const provider = (getArgValue('--provider') || 'deepseek') as LLMConfig['provider'];
  const cliProviders = ['claude-code', 'gemini-cli', 'copilot-cli', 'codex-cli', 'openclaw-cli'];
  const model = getArgValue('--model') || (
    cliProviders.includes(provider) ? '' :
    provider === 'deepseek' ? 'deepseek-chat' :
    provider === 'claude' ? 'claude-sonnet-4-20250514' :
    'gpt-4o'
  );
  const agentsDir = getArgValue('--agents-dir') || resolveAgentsDir();
  const outputName = getArgValue('--name');

  try {
    const { composeWorkflow } = await import('./cli/compose.js');
    const { yaml, savedPath, relativePath, warnings } = await composeWorkflow({
      description,
      agentsDir: resolve(agentsDir),
      llmConfig: { provider, model },
      outputName,
      autoRun,
    });

    console.log(`\n  ✅ 工作流已生成: ${relativePath}\n`);

    // 校验警告
    if (warnings.length > 0) {
      console.log('  ⚠️  校验发现问题（AI 生成的 YAML 可能需要手动调整）:');
      for (const w of warnings) {
        console.log(`    - ${w}`);
      }
      console.log('');
    }

    if (autoRun) {
      // --run 模式：校验有严重问题时不执行
      if (warnings.some(w => w.includes('解析失败'))) {
        console.error('  生成的 YAML 有解析错误，无法自动运行。请手动修复后执行:');
        console.error(`    ao run ${relativePath}`);
        process.exit(1);
      }

      console.log('─'.repeat(50));
      console.log('  开始执行工作流...\n');

      // 保底：如果 LLM 仍然生成了 required inputs，用用户描述填充
      const { parseWorkflow } = await import('./core/parser.js');
      const workflow = parseWorkflow(resolve(savedPath));
      const inputs: Record<string, string> = {};
      for (const def of workflow.inputs || []) {
        if (def.required && def.default === undefined) {
          inputs[def.name] = description;
        }
      }

      const result = await run(resolve(savedPath), inputs, {
        quiet: false,
        // 用 compose 时同样的 provider 执行，避免 YAML 里写的 provider 和用户实际可用的不一致
        // CLI provider 单步调用可能很慢（1-20 分钟），给足超时
        llmOverride: { provider, model: model || undefined, timeout: cliProviders.includes(provider) ? 600_000 : 300_000 },
      });
      process.exit(result.success ? 0 : 1);
    }

    // 非 --run 模式：显示预览和下一步提示
    console.log('  预览:');
    const previewLines = yaml.split('\n').slice(0, 30);
    for (const line of previewLines) {
      console.log(`    ${line}`);
    }
    if (yaml.split('\n').length > 30) {
      console.log('    ...');
    }
    console.log('');
    console.log('  接下来可以:');
    console.log(`    ao validate ${relativePath}   校验工作流`);
    console.log(`    ao plan ${relativePath}       查看执行计划`);
    console.log(`    ao run ${relativePath}        运行工作流`);
    console.log('');
  } catch (err) {
    console.error(`\n错误: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

async function handleServe(): Promise<void> {
  const verbose = args.includes('--verbose');
  try {
    const { startServer } = await import('./mcp/server.js');
    await startServer(verbose);
  } catch (err) {
    console.error(`MCP 服务器启动失败: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

async function handleDemo(): Promise<void> {
  try {
    const { runDemo } = await import('./cli/demo.js');
    await runDemo();
  } catch (err) {
    console.error(`\n错误: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

async function handleInit(): Promise<void> {
  // ao init --workflow: 交互式创建工作流
  if (args.includes('--workflow')) {
    const { interactiveInitWorkflow } = await import('./cli/init-workflow.js');
    await interactiveInitWorkflow();
    return;
  }

  const targetDir = resolve('agency-agents-zh');

  if (existsSync(targetDir)) {
    console.log(`  agency-agents-zh 已存在，跳过下载`);
    // 尝试更新
    try {
      execSync('git pull', { cwd: targetDir, stdio: 'pipe' });
      console.log('  已更新到最新版本');
    } catch {
      console.log('  (更新失败，使用现有版本)');
    }
  } else {
    console.log('  正在下载 agency-agents-zh (186 个 AI 角色定义)...\n');
    let downloaded = false;

    // 优先用 npm（国内镜像快）
    try {
      execSync('npm pack agency-agents-zh --pack-destination .', { stdio: 'pipe' });
      const { readdirSync } = await import('node:fs');
      const tgz = readdirSync('.').find(f => f.startsWith('agency-agents-zh-') && f.endsWith('.tgz'));
      if (tgz) {
        const { mkdirSync } = await import('node:fs');
        mkdirSync('agency-agents-zh', { recursive: true });
        execSync(`tar xzf ${tgz} --strip-components=1 -C agency-agents-zh`, { stdio: 'pipe' });
        const { unlinkSync } = await import('node:fs');
        unlinkSync(tgz);
        downloaded = true;
        console.log('  通过 npm 下载完成!');
      }
    } catch {
      // npm 失败，回退 git clone
    }

    // 回退: git clone
    if (!downloaded) {
      try {
        console.log('  npm 下载失败，尝试 git clone...\n');
        execSync(
          'git clone --depth 1 https://github.com/jnMetaCode/agency-agents-zh.git',
          { stdio: 'inherit' }
        );
        console.log('\n  下载完成!');
        downloaded = true;
      } catch {
        // ignore
      }
    }

    if (!downloaded) {
      console.error('\n  下载失败，请手动安装:');
      console.error('  npm pack agency-agents-zh && tar xzf agency-agents-zh-*.tgz && mv package agency-agents-zh');
      console.error('  或: git clone https://github.com/jnMetaCode/agency-agents-zh.git');
      process.exit(1);
    }
  }

  // 显示角色数量
  const agents = listAgents(targetDir);
  console.log(`  共 ${agents.length} 个角色可用\n`);
  console.log('  接下来你可以:');
  console.log('    ao roles                              查看所有角色');
  console.log('    ao plan workflows/product-review.yaml  查看执行计划');
  console.log('    ao run workflows/story-creation.yaml   运行工作流');
}

function handleRoles(): void {
  const agentsDir = getArgValue('--agents-dir') || resolveAgentsDir();

  try {
    const agents = listAgents(resolve(agentsDir));
    console.log(`\n  共 ${agents.length} 个角色 (${agentsDir}):\n`);

    // 按分类分组
    const byCategory = new Map<string, typeof agents>();
    for (const agent of agents) {
      const cat = agent.rolePath?.split('/')[0] || 'other';
      const list = byCategory.get(cat) || [];
      list.push(agent);
      byCategory.set(cat, list);
    }

    for (const [category, list] of byCategory) {
      console.log(`  ── ${category} (${list.length}) ──`);
      for (const agent of list) {
        const emoji = agent.emoji || ' ';
        const path = agent.rolePath || '';
        console.log(`  ${emoji} ${agent.name}  ${path}`);
        if (agent.description) {
          console.log(`     ${agent.description}`);
        }
      }
      console.log('');
    }
  } catch (err) {
    console.error(`错误: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

/** 解析 --input key=value 和 --input key=@file 参数 */
function parseInputArgs(): Record<string, string> {
  const inputs: Record<string, string> = {};

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--input' || args[i] === '-i') {
      const pair = args[++i];
      if (!pair) {
        console.error('--input 需要 key=value 参数');
        process.exit(1);
      }
      const eqIdx = pair.indexOf('=');
      if (eqIdx < 1) {
        console.error(`无效的 input 格式: ${pair} (应为 key=value)`);
        process.exit(1);
      }
      const key = pair.slice(0, eqIdx);
      let value = pair.slice(eqIdx + 1);

      // @file 语法：从文件读取值
      if (value.startsWith('@')) {
        const filePath = resolve(value.slice(1));
        try {
          value = readFileSync(filePath, 'utf-8');
        } catch {
          console.error(`无法读取文件: ${filePath}`);
          process.exit(1);
        }
      }

      inputs[key] = value;
    }
  }

  return inputs;
}

/**
 * 自动查找 agents 目录，按优先级：
 * 1. ./agency-agents-zh (ao init 下载的)
 * 2. ../agency-agents-zh (同级目录)
 * 3. ./agents (自定义)
 */
function resolveAgentsDir(): string {
  const candidates = [
    './agency-agents-zh',
    '../agency-agents-zh',
    './agents',
  ];
  for (const dir of candidates) {
    const full = resolve(dir);
    if (existsSync(full)) return dir;
  }
  return './agency-agents-zh';
}

function getArgValue(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
}

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
    return pkg.version;
  } catch {
    return '0.1.0';
  }
}

function printHelp(): void {
  console.log(`
  agency-orchestrator — Multi-Agent Workflow Engine
  基于 agency-agents-zh 的多智能体编排引擎

  Quick Start:
    ao demo                           零配置体验多智能体协作
    ao init                           下载 186 个 AI 角色定义
    ao roles                          查看所有可用角色
    ao plan <workflow.yaml>           查看执行计划 (DAG)
    ao run <workflow.yaml> [options]   执行工作流

  Commands:
    demo                              零配置体验多智能体协作（mock + 真实 AI）
    init                              下载/更新 agency-agents-zh
    init --workflow                    交互式创建新工作流
    compose "描述"                     AI 智能编排工作流（一句话生成 YAML）
    compose "描述" --run               生成并立即运行（一句话出结果）
    serve                             启动 MCP Server（供 Claude Code / Cursor 调用）
    run <workflow.yaml>               执行工作流
    validate <workflow.yaml>          校验工作流定义
    plan <workflow.yaml>              查看执行计划
    explain <workflow.yaml>           用自然语言解释执行计划
    roles [--agents-dir path]         列出可用角色

  Options:
    --input, -i key=value    传入输入变量
    --input, -i key=@file    从文件读取变量值
    --provider <name>        覆盖 YAML 中的 LLM provider (如 claude-code, deepseek)
    --model <name>           覆盖 YAML 中的模型名
    --output dir             输出目录 (默认 ao-output/)
    --resume <dir|last>      从上次运行恢复（加载已完成步骤的输出）
    --from <step-id>         配合 --resume，从指定步骤重新执行
    --watch                  实时进度显示（终端 UI）
    --quiet, -q              静默模式
    --version, -v            版本号

  Examples:
    ao init
    ao compose "PR 代码审查，覆盖安全和性能"
    ao run workflows/story-creation.yaml -i premise='一个时间旅行的故事' -i style='悬疑'
    ao run workflows/product-review.yaml -i prd_content=@prd.md
    ao plan workflows/content-pipeline.yaml

  Resume (基于上次结果迭代):
    ao run workflow.yaml --resume last                    # 跳过上次已完成的步骤
    ao run workflow.yaml --resume last --from summary     # 从 summary 步骤重新执行
    ao run workflow.yaml --resume ao-output/xxx/         # 指定具体输出目录

  Agents: https://github.com/jnMetaCode/agency-agents-zh
  `);
}

main();
