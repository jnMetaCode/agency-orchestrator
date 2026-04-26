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
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { parseWorkflow, validateWorkflow } from './core/parser.js';
import type { LLMConfig } from './types.js';
import { buildDAG, formatDAG } from './core/dag.js';
import { listAgents } from './agents/loader.js';
import { run } from './index.js';
import { scheduleUpdateCheck } from './utils/version-check.js';
import { t, detectLang } from './i18n.js';
import { loadEnvFile, writeEnvFile, ensureEnvGitignored } from './utils/env-loader.js';
import { parseDuration } from './utils/duration.js';

// Auto-load ./.env (shell env wins; no overwrite)
loadEnvFile();

// Suppress Node's DEP0190 warning from legitimate shell:true on Windows (.cmd shims).
const origEmit = process.emit.bind(process);
(process as any).emit = function (name: string, data: unknown, ...rest: unknown[]): boolean {
  if (name === 'warning' && data && (data as any).code === 'DEP0190') return false;
  return (origEmit as any)(name, data, ...rest);
};

const args = process.argv.slice(2);
const command = args[0];
detectLang(process.argv);

async function main(): Promise<void> {
  // 启动时提示新版本（仅 TTY，24h 缓存，失败静默）
  scheduleUpdateCheck(getVersion());

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
  // Precedence: CLI flag > .env (AO_PROVIDER/AO_MODEL) > YAML
  const provider = (getArgValue('--provider') || process.env.AO_PROVIDER) as LLMConfig['provider'] | undefined;
  const model = getArgValue('--model') || process.env.AO_MODEL;
  const baseUrl = getArgValue('--base-url') || getArgValue('--baseurl');
  const apiKey = getArgValue('--api-key') || getArgValue('--apikey');
  const timeoutRaw = getArgValue('--timeout');
  let timeoutMs: number | undefined;
  if (timeoutRaw !== undefined) {
    const parsed = parseDuration(timeoutRaw);
    if (parsed === null) {
      console.error(`--timeout 值无效: "${timeoutRaw}"（支持 300000 / 300s / 5m / 0）`);
      process.exit(1);
    }
    timeoutMs = parsed;
  }

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
    // --provider / --model / --base-url / --api-key / --timeout: 命令行覆盖 YAML 中的 LLM 配置
    const cliProviders = ['claude-code', 'gemini-cli', 'copilot-cli', 'codex-cli', 'openclaw-cli', 'hermes-cli'];
    let llmOverride: Partial<LLMConfig> | undefined;
    if (provider || model || baseUrl || apiKey || timeoutMs !== undefined) {
      llmOverride = {};
      if (provider) {
        llmOverride.provider = provider;
        // CLI provider 不指定 model 时清空（避免 YAML 里的 deepseek-chat 传给 claude CLI）
        llmOverride.model = model || (cliProviders.includes(provider) ? '' : undefined);
        if (cliProviders.includes(provider)) llmOverride.timeout = 600_000;
      } else if (model) {
        llmOverride.model = model;
      }
      if (baseUrl) llmOverride.base_url = baseUrl;
      if (apiKey) llmOverride.api_key = apiKey;
      // --timeout 最后赋值，优先级高于 CLI provider 自动 600s
      if (timeoutMs !== undefined) llmOverride.timeout = timeoutMs;
    }

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
    console.error(t('validate.usage'));
    process.exit(1);
  }

  try {
    const workflow = parseWorkflow(resolve(filePath));
    const errors = validateWorkflow(workflow);

    if (errors.length === 0) {
      console.log(`  ${t('validate.ok', { name: workflow.name })}`);
      console.log(`  ${t('validate.stats', { steps: workflow.steps.length, inputs: (workflow.inputs || []).length })}`);
    } else {
      console.error(`  ${t('validate.failed', { name: workflow.name })}\n`);
      for (const err of errors) {
        console.error(`  - ${err}`);
      }
      process.exit(1);
    }
  } catch (err) {
    console.error(`${t('error.prefix')}: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

function handlePlan(): void {
  const filePath = args[1];
  if (!filePath) {
    console.error(t('plan.usage'));
    process.exit(1);
  }

  try {
    const workflow = parseWorkflow(resolve(filePath));
    const errors = validateWorkflow(workflow);
    if (errors.length > 0) {
      console.error(`${t('plan.validate_failed')}\n${errors.map(e => `  - ${e}`).join('\n')}`);
      process.exit(1);
    }

    const dag = buildDAG(workflow);
    console.log(`\n  ${workflow.name}\n`);
    console.log(formatDAG(dag));
  } catch (err) {
    console.error(`${t('error.prefix')}: ${err instanceof Error ? err.message : err}`);
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
  const flagsWithValue = new Set(['--name', '--provider', '--model', '--agents-dir', '--lang', '--base-url', '--baseurl', '--api-key', '--apikey', '--timeout']);
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
    console.error('  --lang <zh|en>      语言 (默认自动检测 / auto-detect)');
    console.error('  --timeout <值>       单步超时，支持 300000/300s/5m (默认 API 300s, 本地/CLI 600s)');
    process.exit(1);
  }

  const provider = (getArgValue('--provider') || process.env.AO_PROVIDER || 'deepseek') as LLMConfig['provider'];
  const cliProviders = ['claude-code', 'gemini-cli', 'copilot-cli', 'codex-cli', 'openclaw-cli', 'hermes-cli'];
  const knownApiProviders = ['deepseek', 'claude', 'openai', 'ollama'];
  const isUnknownProvider = !cliProviders.includes(provider) && !knownApiProviders.includes(provider);
  const cliModel = getArgValue('--model') || process.env.AO_MODEL;
  // 未知 provider（如 zhipu/qwen/moonshot 走 openai-compatible）必须显式指定 model，
  // 否则会用下面的 'gpt-4o' 默认值去调自定义端点，必然 404。
  if (isUnknownProvider && !cliModel) {
    console.error(`\n错误: provider "${provider}" 是自定义 OpenAI 兼容端点，必须用 --model 显式指定模型名（例如 --model glm-4-plus）。`);
    process.exit(1);
  }
  const model = cliModel || (
    cliProviders.includes(provider) ? '' :
    provider === 'deepseek' ? 'deepseek-chat' :
    provider === 'claude' ? 'claude-sonnet-4-20250514' :
    'gpt-4o'
  );
  const baseUrl = getArgValue('--base-url') || getArgValue('--baseurl');
  const apiKey = getArgValue('--api-key') || getArgValue('--apikey');
  const composeTimeoutRaw = getArgValue('--timeout');
  let composeTimeoutMs: number | undefined;
  if (composeTimeoutRaw !== undefined) {
    const parsed = parseDuration(composeTimeoutRaw);
    if (parsed === null) {
      console.error(`--timeout 值无效: "${composeTimeoutRaw}"（支持 300000 / 300s / 5m / 0）`);
      process.exit(1);
    }
    composeTimeoutMs = parsed;
  }
  // 自动检测语言：英文输入 → 优先英文角色库
  const { detectLang } = await import('./cli/compose.js');
  const composeLang = getArgValue('--lang') as 'zh' | 'en' | undefined ?? detectLang(description);
  const agentsDir = getArgValue('--agents-dir') || resolveAgentsDir(composeLang);
  const outputName = getArgValue('--name');

  try {
    const { composeWorkflow } = await import('./cli/compose.js');
    const { yaml, savedPath, relativePath, warnings } = await composeWorkflow({
      description,
      agentsDir: resolve(agentsDir),
      llmConfig: {
        provider,
        model,
        ...(baseUrl ? { base_url: baseUrl } : {}),
        ...(apiKey ? { api_key: apiKey } : {}),
      },
      outputName,
      autoRun,
      lang: composeLang,
      timeoutMs: composeTimeoutMs,
    });

    console.log(`\n  ${t('compose.generated', { path: relativePath })}\n`);

    // 校验警告
    if (warnings.length > 0) {
      console.log(`  ${t('compose.warnings_header')}`);
      for (const w of warnings) {
        console.log(`    - ${w}`);
      }
      console.log('');
    }

    if (autoRun) {
      // --run 模式：校验有严重问题时不进入 run 阶段
      // run() 内部会重新 validate 并 hard-fail，提前拦下来给用户更清晰的提示
      const fatalParse = warnings.some(w => w.includes('解析失败') || w.toLowerCase().includes('parse failed'));
      const fatalUndefVar = warnings.some(w =>
        w.includes('未定义的变量') || w.toLowerCase().includes('undefined variable')
      );
      const fatalInvalidRole = warnings.some(w =>
        w.includes('不存在于角色库') || w.toLowerCase().includes('does not exist in catalog')
      );
      if (fatalParse || fatalUndefVar || fatalInvalidRole) {
        console.error(`  ${t('compose.retry_yaml_bad')}`);
        console.error('');
        console.error('  以下问题需要先解决 / The following issues need to be resolved:');
        for (const w of warnings) {
          if (w.includes('未定义的变量') || w.includes('解析失败') || w.includes('不存在于角色库')
              || w.toLowerCase().includes('undefined variable') || w.toLowerCase().includes('parse failed')
              || w.toLowerCase().includes('does not exist in catalog')) {
            console.error(`    - ${w}`);
          }
        }
        console.error('');
        console.error('  建议 / Suggestions:');
        console.error('    1. 重新生成 / Regenerate: ao compose "..." --run');
        console.error(`    2. 手动修改 / Manually edit: ${relativePath}`);
        console.error(`       然后用 / then run: ao run ${relativePath}`);
        process.exit(1);
      }

      console.log('─'.repeat(50));
      console.log(`  ${t('compose.auto_running')}\n`);

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
        // CLI provider 单步调用可能很慢（1-20 分钟），给足超时；用户显式 --timeout 优先
        llmOverride: {
          provider,
          model: model || undefined,
          timeout: composeTimeoutMs !== undefined
            ? composeTimeoutMs
            : (cliProviders.includes(provider) ? 600_000 : 300_000),
          ...(baseUrl ? { base_url: baseUrl } : {}),
          ...(apiKey ? { api_key: apiKey } : {}),
        },
      });
      process.exit(result.success ? 0 : 1);
    }

    // 非 --run 模式：显示预览和下一步提示
    console.log(`  ${t('compose.preview')}`);
    const previewLines = yaml.split('\n').slice(0, 30);
    for (const line of previewLines) {
      console.log(`    ${line}`);
    }
    if (yaml.split('\n').length > 30) {
      console.log('    ...');
    }
    console.log('');
    console.log(`  ${t('compose.next_steps')}`);
    console.log(`    ao validate ${relativePath}   ${t('compose.next.validate')}`);
    console.log(`    ao plan ${relativePath}       ${t('compose.next.plan')}`);
    console.log(`    ao run ${relativePath}        ${t('compose.next.run')}`);
    console.log('');
  } catch (err) {
    console.error(`\n${t('error.prefix')}: ${err instanceof Error ? err.message : err}`);
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

  // ao init --provider X --model Y --base-url Z --api-key K → write ./.env
  const cfgProvider = getArgValue('--provider');
  const cfgModel = getArgValue('--model');
  const cfgBaseUrl = getArgValue('--base-url') || getArgValue('--baseurl');
  const cfgApiKey = getArgValue('--api-key') || getArgValue('--apikey');

  if (cfgProvider || cfgModel || cfgBaseUrl || cfgApiKey) {
    const updates: Record<string, string> = {};
    if (cfgProvider) updates.AO_PROVIDER = cfgProvider;
    if (cfgModel) updates.AO_MODEL = cfgModel;
    if (cfgBaseUrl) {
      // Route to the env var the matching connector already reads
      const p = (cfgProvider || '').toLowerCase();
      const urlVar =
        p === 'ollama' ? 'OLLAMA_BASE_URL' :
        'OPENAI_BASE_URL';
      updates[urlVar] = cfgBaseUrl;
    }
    if (cfgApiKey) {
      // 路由到 factory 里 connector 实际会读的 env 变量。
      // factory.ts 只对 deepseek / claude / openai 有专属分支；其他 provider
      // （zhipu/glm/qwen/moonshot 等）都走 default → openai-compatible，读 OPENAI_API_KEY。
      // 所以未知 provider 的 key 也写到 OPENAI_API_KEY，不再写死代码的 AO_API_KEY / ZHIPU_API_KEY。
      const p = (cfgProvider || process.env.AO_PROVIDER || '').toLowerCase();
      const keyVar =
        p === 'deepseek' ? 'DEEPSEEK_API_KEY' :
        p === 'anthropic' || p === 'claude' ? 'ANTHROPIC_API_KEY' :
        'OPENAI_API_KEY';
      updates[keyVar] = cfgApiKey;
    }

    const hasBaseUrl = !!cfgBaseUrl || !!process.env.OPENAI_BASE_URL;

    const envPath = resolve(process.cwd(), '.env');
    writeEnvFile(updates);
    const gitignoreUpdated = ensureEnvGitignored();

    console.log(`  ✅ 已写入 ${envPath}`);
    for (const [k, v] of Object.entries(updates)) {
      const shown = /KEY|TOKEN|SECRET/i.test(k) ? v.slice(0, 6) + '…' : v;
      console.log(`     ${k}=${shown}`);
    }
    if (gitignoreUpdated) console.log(`  🔒 已将 .env 加入 .gitignore`);

    // 打印 provider 专属的首次使用指南
    if (cfgProvider) {
      const { getProviderGuide } = await import('./cli/provider-guides.js');
      const guide = getProviderGuide(cfgProvider, {
        hasApiKey: !!cfgApiKey,
        hasBaseUrl,
        model: cfgModel,
      });
      if (guide) {
        console.log('');
        for (const line of guide.split('\n')) console.log(`  ${line}`);
      }
    }

    console.log(`\n  下次运行 ao 时会自动加载这些配置。`);
    console.log(`  也可手动编辑 .env 或复制到其他项目复用。`);
    return;
  }

  const lang = getArgValue('--lang') === 'en' ? 'en' : 'zh';
  const pkgName = lang === 'en' ? 'agency-agents' : 'agency-agents-zh';
  const gitRepo = lang === 'en'
    ? 'https://github.com/msitarzewski/agency-agents.git'
    : 'https://github.com/jnMetaCode/agency-agents-zh.git';
  const targetDir = resolve(pkgName);

  if (existsSync(targetDir)) {
    console.log(`  ${pkgName} 已存在，跳过下载`);
    // 尝试更新
    try {
      execSync('git pull', { cwd: targetDir, stdio: 'pipe' });
      console.log('  已更新到最新版本');
    } catch {
      console.log('  (更新失败，使用现有版本)');
    }
  } else {
    console.log(`  正在下载 ${pkgName} ...`);
    let downloaded = false;

    // 英文包在 npm 上只是 264B 占位 stub，直接走 git clone
    // 中文包走 npm（国内镜像快）
    if (lang === 'zh') {
      try {
        execSync(`npm pack ${pkgName} --pack-destination .`, { stdio: 'pipe' });
        const { readdirSync } = await import('node:fs');
        const tgz = readdirSync('.').find(f => f.startsWith(`${pkgName}-`) && f.endsWith('.tgz'));
        if (tgz) {
          const { mkdirSync } = await import('node:fs');
          mkdirSync(pkgName, { recursive: true });
          execSync(`tar xzf ${tgz} --strip-components=1 -C ${pkgName}`, { stdio: 'pipe' });
          const { unlinkSync } = await import('node:fs');
          unlinkSync(tgz);
          downloaded = true;
          console.log('  通过 npm 下载完成!');
        }
      } catch {
        // npm 失败，回退 git clone
      }
    }

    // git clone（英文直接走这里；中文作为 npm 的回退）
    if (!downloaded) {
      try {
        if (lang === 'en') {
          console.log('  通过 git clone 下载（npm 包尚未包含角色文件）...\n');
        } else {
          console.log('  npm 下载失败，尝试 git clone...\n');
        }
        execSync(`git clone --depth 1 ${gitRepo}`, { stdio: 'inherit' });
        console.log('\n  下载完成!');
        downloaded = true;
      } catch {
        // ignore
      }
    }

    if (!downloaded) {
      console.error('\n  下载失败，请手动安装:');
      console.error(`  npm pack ${pkgName} && tar xzf ${pkgName}-*.tgz && mv package ${pkgName}`);
      console.error(`  或: git clone ${gitRepo}`);
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
 * 1. ./agency-agents-zh (中文角色，ao init 下载的)
 * 2. ./agency-agents (英文角色，ao init --lang en 下载的)
 * 3. ../agency-agents-zh 或 ../agency-agents (同级目录)
 * 4. ./agents (自定义)
 * 5. node_modules/agency-agents-zh (npm 依赖，全局安装时)
 * 6. 包内置 agency-agents/ (随 npm 包分发，与 dist/ 同级)
 *
 * @param preferLang 优先语言，影响搜索顺序
 */
function resolveAgentsDir(preferLang?: 'zh' | 'en'): string {
  // scriptDir = dist/ inside the installed package
  // Windows: 必须用 fileURLToPath，不能用 new URL(url).pathname，
  // 否则会得到 "/C:/Users/..." 非法路径，包内置 / node_modules 候选都失效
  const scriptDir = dirname(fileURLToPath(import.meta.url));

  const zhFirst = [
    './agency-agents-zh',
    './agency-agents',
    '../agency-agents-zh',
    '../agency-agents',
    './agents',
    // npm 依赖 (cwd/node_modules)
    './node_modules/agency-agents-zh',
    './node_modules/agency-agents',
    // npm 依赖 (包自身的 node_modules，全局安装时)
    join(scriptDir, '..', 'node_modules', 'agency-agents-zh'),
    join(scriptDir, '..', 'node_modules', 'agency-agents'),
    // hoisted node_modules (npm 有时会提升依赖)
    join(scriptDir, '..', '..', 'node_modules', 'agency-agents-zh'),
    join(scriptDir, '..', '..', 'node_modules', 'agency-agents'),
    // 包内置 agency-agents/ (与 dist/ 同级)
    join(scriptDir, '..', 'agency-agents-zh'),
    join(scriptDir, '..', 'agency-agents'),
  ];
  const enFirst = [
    './agency-agents',
    './agency-agents-zh',
    '../agency-agents',
    '../agency-agents-zh',
    './agents',
    // npm 依赖 (cwd/node_modules)
    './node_modules/agency-agents',
    './node_modules/agency-agents-zh',
    // npm 依赖 (包自身的 node_modules，全局安装时)
    join(scriptDir, '..', 'node_modules', 'agency-agents'),
    join(scriptDir, '..', 'node_modules', 'agency-agents-zh'),
    // hoisted node_modules
    join(scriptDir, '..', '..', 'node_modules', 'agency-agents'),
    join(scriptDir, '..', '..', 'node_modules', 'agency-agents-zh'),
    // 包内置
    join(scriptDir, '..', 'agency-agents'),
    join(scriptDir, '..', 'agency-agents-zh'),
  ];
  const candidates = preferLang === 'en' ? enFirst : zhFirst;
  for (const dir of candidates) {
    const full = resolve(dir);
    if (existsSync(full)) return full;
  }
  return preferLang === 'en' ? './agency-agents' : './agency-agents-zh';
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
  console.log(t('help.text'));
}

main();
