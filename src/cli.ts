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
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawn } from 'node:child_process';
import { parseWorkflow, validateWorkflow } from './core/parser.js';
import type { LLMConfig } from './types.js';
import { buildDAG, formatDAG } from './core/dag.js';
import { listAgents, filterAgentsByKeyword } from './agents/loader.js';
import { run, findAgentsDir, compareWorkflowVsBaseline } from './index.js';
import { detectInstalledCliProviders, detectUsableCliProviders, DEPRECATED_CLI_PROVIDERS } from './providers/detect.js';
import { API_PROVIDERS, API_PROVIDER_MAP } from './connectors/api-providers.js';
import { postChatCompletions, postApiEndpoint, endpointHint, normalizeBaseUrl, envProxyHint } from './connectors/openai-compatible.js';
import { installEnvProxy, envProxyStatus } from './utils/env-proxy.js';
// claude 走原生 SDK，端点体检要按 Anthropic 协议单独来（见 doctor 的 3.6 段）
import { normalizeAnthropicBaseUrl } from './connectors/claude.js';
import { diagnoseClaudeConfig, repairClaudeConfig } from './utils/claude-repair.js';
import { formatValidationReport, buildValidationReport } from './cli/validate-report.js';
import { parseInputPairs } from './cli/parse-inputs.js';
import { formatCompareReport } from './cli/compare-report.js';
import { INSTALL_TARGETS, installRoles } from './cli/install.js';
import { materializeFromResult } from './cli/materialize.js';
import { homedir } from 'node:os';
import { scheduleUpdateCheck, fetchLatestVersion, isNewer, detectUpgradeCommand, PKG } from './utils/version-check.js';
import { t, detectLang } from './i18n.js';
import { loadEnvFile, writeEnvFile, ensureEnvGitignored } from './utils/env-loader.js';
import { parseDuration } from './utils/duration.js';
import { defaultOutputDir, defaultWorkflowsDir } from './utils/paths.js';
import { rotatingSponsors, guideProviderId } from './utils/sponsor-guide.js';

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
  // 环境里配了代理就先接管全局 dispatcher —— Node 的 fetch 默认不读 HTTP(S)_PROXY，
  // 不接管的话"curl 能通、AO 连不上"。没配代理时这一步什么都不做。
  await installEnvProxy();
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
    case 'install':
      handleInstall();
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
    case 'doctor':
      await handleDoctor();
      break;
    case 'report':
      await handleReport();
      break;
    case 'team':
      await handleTeam();
      break;
    case 'prompt':
      await handlePrompt();
      break;
    case 'skills':
      await handleSkills();
      break;
    case 'demo':
      await handleDemo();
      break;
    case 'serve':
      await handleServe();
      break;
    case 'web':
      await handleWeb();
      break;
    case 'upgrade':
    case 'self-update':
      await handleUpgrade();
      break;
    case '--version':
    case '-v':
      console.log(getVersion());
      break;
    default: {
      // 容错：用户可能漏了空格，如 "planworkflows/x.yaml"
      const knownCmds = ['run', 'validate', 'plan', 'explain', 'compose', 'doctor', 'report', 'team', 'prompt', 'skills', 'demo', 'roles', 'install', 'init', 'serve', 'web', 'upgrade'];
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
  // ao run --team <名字> "<任务>"：把固定团队套到新任务上（compose 锁定阵容后直接运行）
  const teamRef = getArgValue('--team');
  if (teamRef) {
    await runWithTeam(teamRef);
    return;
  }

  const filePath = args[1];
  if (!filePath) {
    console.error('用法: ao run <workflow.yaml> [--input key=value ...]');
    console.error('  或: ao run --team <名字> "你的任务"   # 用已保存的团队跑新任务');
    console.error('  --materialize <目录>     把开发步产出的「### 路径 + 代码围栏」文件块落盘成真实项目脚手架');
    console.error('  --export <格式>          把本次产出导出:docx/pdf/xlsx/pptx(给人)或 skill/plan(给编码 agent 执行)');
    console.error('  --no-verify              关闭 acceptance 自动核验（默认：写了 acceptance 的步骤产出后自动核验，未过自动返工一轮）');
    console.error('  --compare                跑完后再跑单次基线 + 盲评，并排对比多智能体 vs 单次');
    console.error('  --judge-provider/--judge-model   --compare 时指定评审模型(默认用生成模型)');
    process.exit(1);
  }

  const inputs = parseInputArgs();
  const outputDir = getArgValue('--output') || defaultOutputDir();
  const quiet = args.includes('--quiet') || args.includes('-q');
  const watch = args.includes('--watch');
  let resumeDir = getArgValue('--resume');
  const fromStep = getArgValue('--from');
  const feedback = getArgValue('--feedback');
  // --feedback 默认对"上一次运行"返工：未显式 --resume 时自动取 last，少敲一个参数
  if (feedback && !resumeDir) resumeDir = 'last';
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
    const cliProviders = ['claude-code', 'antigravity-cli', 'gemini-cli', 'copilot-cli', 'codex-cli', 'openclaw-cli', 'hermes-cli'];
    const runTemperature = parseTemperatureArg();
    let llmOverride: Partial<LLMConfig> | undefined;
    if (provider || model || baseUrl || apiKey || timeoutMs !== undefined || runTemperature !== undefined) {
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
      if (runTemperature !== undefined) llmOverride.temperature = runTemperature;
      // --timeout 最后赋值，优先级高于 CLI provider 自动 600s
      if (timeoutMs !== undefined) llmOverride.timeout = timeoutMs;
    }

    // --compare：跑完工作流后再跑单次基线 + 双向盲评，并排对比（产品化 eval 的核心卖点）
    if (args.includes('--compare')) {
      const judgeProvider = getArgValue('--judge-provider') as LLMConfig['provider'] | undefined;
      const judgeModel = getArgValue('--judge-model');
      const cmp = await compareWorkflowVsBaseline(resolve(filePath), inputs, {
        outputDir,
        quiet,
        verify: parseVerifyFlag(),
        signalFlush: true,
        genOverride: llmOverride,
        judgeLlm: judgeProvider
          ? { provider: judgeProvider, model: judgeModel, timeout: 600_000 } as LLMConfig
          : undefined,
      });
      console.log(formatCompareReport(cmp));
      // --compare 也是一次完整运行——带 --notify 时同样要推送（此前这里先 exit，通知被静默吞掉）
      await maybeNotifyRun(cmp.result);
      process.exit(cmp.result.success ? 0 : 1);
    }

    const result = await run(resolve(filePath), inputs, {
      outputDir,
      quiet,
      watch,
      resumeDir: resumeDir ? resolve(resumeDir) : undefined,
      fromStep,
      feedback,
      verify: parseVerifyFlag(),
      llmOverride,
      signalFlush: true,
    });

    // --materialize <dir>：把开发步产出的"文件块"落盘成真实项目脚手架
    const matDir = getArgValue('--materialize');
    if (matDir) {
      const dest = resolve(matDir);
      const mat = materializeFromResult(result, dest);
      if (mat.files.length) {
        console.log(`\n  📁 已落盘 ${mat.files.length} 个文件 → ${dest}（来自步骤「${mat.stepId}」）`);
        for (const f of mat.files.slice(0, 20)) console.log(`     - ${f}`);
        if (mat.files.length > 20) console.log(`     … 等 ${mat.files.length} 个`);
        console.log(`\n  脚手架已生成。要可运行/补全，可把它交给 Claude Code / Cursor 继续。`);
      } else {
        console.log(`\n  ⚠️ --materialize：未在产出里找到"文件块"（约定格式：### 路径 + 代码围栏）。`);
      }
      if (mat.skipped.length) console.log(`  ⛔ 跳过 ${mat.skipped.length} 个不安全路径: ${mat.skipped.slice(0, 5).join(', ')}`);
    }

    // --export <fmt>：把本次产出导出成 Word/PDF/Excel,或 Skill/可执行计划(给编码 agent 跑)
    const exportFmt = getArgValue('--export');
    if (exportFmt) {
      const allowed = ['docx', 'pdf', 'xlsx', 'pptx', 'skill', 'plan'];
      if (!allowed.includes(exportFmt)) {
        console.error(`\n  ⚠️ --export 仅支持: ${allowed.join(' / ')}`);
      } else {
        const md = result.steps
          .filter(s => s.status === 'completed' && s.output)
          .map(s => `## ${s.agentName || s.role || s.id}\n\n${s.output}`)
          .join('\n\n---\n\n');
        if (!md) {
          console.log(`\n  ⚠️ --export：本次运行没有可导出的产出。`);
        } else {
          // 懒加载转换器(xlsx/marked/html-to-docx 较重,仅用到时才载)
          const { exportMarkdown } = await import('./export/convert.js');
          const r = await exportMarkdown(md, exportFmt as 'docx' | 'pdf' | 'xlsx' | 'skill' | 'plan', { name: result.name });
          const safe = (result.name || 'report').replace(/[^一-鿿a-zA-Z0-9_-]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'report';
          const out = resolve(`${safe}.${r.ext}`);
          writeFileSync(out, r.buffer);
          console.log(`\n  📤 已导出 → ${out}（${r.engine}）`);
          if (r.ext === 'html' && exportFmt === 'pdf') {
            console.log(`     (未检测到 pandoc+LaTeX,已输出打印就绪 HTML;浏览器打开 Ctrl-P 存 PDF,或装 pandoc 获更佳排版)`);
          }
        }
      }
    }

    await maybeNotifyRun(result);
    process.exit(result.success ? 0 : 1);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n错误: ${msg}`);
    // cron 场景里「跑挂了」恰恰最需要通知——部分失败会推送、硬失败反而沉默是说不通的
    await maybeNotifyRun({
      name: basename(filePath),
      success: false,
      steps: [],
      totalDuration: 0,
    }, `运行失败：${msg}`);
    process.exit(1);
  }
}

/**
 * --notify <url>（或 AO_NOTIFY_URL）：结果推送到钉钉/飞书/企微/通用 webhook。
 * cron + ao run --notify = "每天 8 点 AI 团队把简报推到群里"。失败只打一行，不影响退出码。
 * 三个出口（正常 / --compare / run 抛错）都要经过这里——漏一个出口就是 cron 用户的静默丢通知。
 */
async function maybeNotifyRun(
  result: Pick<import('./types.js').WorkflowResult, 'name' | 'success' | 'steps' | 'totalDuration'>,
  excerptOverride?: string,
): Promise<void> {
  const notifyUrl = getArgValue('--notify') || process.env.AO_NOTIFY_URL;
  if (!notifyUrl) return;
  const { sendNotify } = await import('./notify.js');
  const finalStep = [...result.steps].reverse().find((s) => s.status === 'completed' && s.output);
  const r = await sendNotify(notifyUrl, {
    name: result.name,
    success: result.success,
    duration: `${(result.totalDuration / 1000).toFixed(1)}s`,
    completedSteps: result.steps.filter((s) => s.status === 'completed').length,
    totalSteps: result.steps.length,
    excerpt: excerptOverride ?? finalStep?.output,
  });
  console.log(`  ${r.ok ? '📨' : '⚠️'} ${r.hint}`);
}

function handleValidate(): void {
  const filePath = args[1];
  const asJson = args.includes('--json');
  if (!filePath) {
    if (asJson) console.log(JSON.stringify({ valid: false, error: 'missing workflow path' }));
    else console.error(t('validate.usage'));
    process.exit(1);
  }

  try {
    const workflow = parseWorkflow(resolve(filePath));
    const agentsDir = findAgentsDir(workflow.agents_dir, resolve(filePath)) ?? undefined;
    const errors = validateWorkflow(workflow, agentsDir);

    // --json：结构化输出，供 CI / 编辑器集成消费（stdout 纯 JSON，退出码标识结果）
    if (asJson) {
      const report = buildValidationReport(
        workflow.name, workflow.steps.length, (workflow.inputs || []).length, errors);
      // CI / 编辑器集成据此知道"role 这一维根本没验"，别把 valid:true 当成全绿
      console.log(JSON.stringify({ ...report, rolesChecked: !!agentsDir }, null, 2));
      if (!report.valid) process.exit(1);
      return;
    }

    if (errors.length === 0) {
      console.log(`  ${t('validate.ok', { name: workflow.name })}`);
      console.log(`  ${t('validate.stats', { steps: workflow.steps.length, inputs: (workflow.inputs || []).length })}`);
      // **"校验通过"不能包含没校验的东西**。找不到角色库时 parser 会静默跳过 role 检查，
      // 于是一个角色名写错的工作流也会得到一句干净的"校验通过"，等到 run 才炸——
      // 真机上就这么被误导过一次。这里把没验的部分说出来。
      if (!agentsDir && workflow.steps.some((st) => !!st.role)) {
        console.log(`  ⚠️  未校验 role：找不到角色库「${workflow.agents_dir}」`);
        console.log(`     跑 ao init 下载，或设 AO_AGENTS_DIR=/你的角色目录 后重新校验`);
      }
    } else {
      console.error('\n' + formatValidationReport(workflow.name, errors, workflow.steps.map(s => s.id)));
      process.exit(1);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 解析失败（YAML 语法、缺 role/task 等 throw）也走 JSON，保证 --json 永远输出合法 JSON
    if (asJson) console.log(JSON.stringify({ valid: false, error: msg }, null, 2));
    else console.error(`${t('error.prefix')}: ${msg}`);
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
    const agentsDir = findAgentsDir(workflow.agents_dir, resolve(filePath)) ?? undefined;
    const errors = validateWorkflow(workflow, agentsDir);
    if (errors.length > 0) {
      console.error('\n' + formatValidationReport(workflow.name, errors, workflow.steps.map(s => s.id)));
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
    const agentsDir = findAgentsDir(workflow.agents_dir, resolve(filePath)) ?? undefined;
    const errors = validateWorkflow(workflow, agentsDir);
    if (errors.length > 0) {
      console.error('\n' + formatValidationReport(workflow.name, errors, workflow.steps.map(s => s.id)));
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
  const budget = args.includes('--budget');
  // 描述是第一个非 flag 的参数（跳过 compose 本身和 --xxx 的值）
  const flagsWithValue = new Set(['--name', '--provider', '--model', '--agents-dir', '--lang', '--base-url', '--baseurl', '--api-key', '--apikey', '--timeout', '--temperature']);
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
    console.error('  --budget             省钱模式：轻活步骤自动降到便宜档，重活保持强档（默认关）');
    console.error('  --temperature <值>   采样温度 0~2（0=近确定性、可复现；不设=用模型默认）');
    console.error('  --name <filename>   自定义输出文件名 (不含 .yaml 后缀)');
    console.error('  --provider <name>   LLM 提供商 (默认 deepseek)');
    console.error('  --model <name>      模型名 (默认 deepseek-chat)');
    console.error('  --lang <zh|en>      语言 (默认自动检测 / auto-detect)');
    console.error('  --timeout <值>       单步超时，支持 300000/300s/5m (默认 API 300s, 本地/CLI 600s)');
    process.exit(1);
  }

  const provider = autoProvider(getArgValue('--provider') || process.env.AO_PROVIDER, 'deepseek') as LLMConfig['provider'];
  const cliProviders = ['claude-code', 'antigravity-cli', 'gemini-cli', 'copilot-cli', 'codex-cli', 'openclaw-cli', 'hermes-cli'];
  const knownApiProviders = ['claude', 'ollama', ...API_PROVIDERS.map((p) => p.id)];
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
    provider === 'claude' ? 'claude-sonnet-4-20250514' :
    API_PROVIDER_MAP[provider]?.defaultModel || 'gpt-4o'
  );
  const baseUrl = getArgValue('--base-url') || getArgValue('--baseurl');
  const apiKey = getArgValue('--api-key') || getArgValue('--apikey');
  const composeTemperature = parseTemperatureArg();
  // R2.1 首跑引导：确定无凭证时，给「三选一」路径而不是让底层 connector 抛晦涩错误
  // （新用户没装 CLI、没配 key 时会兜底成 deepseek 但无 DEEPSEEK_API_KEY → 直接撞墙）。
  if (!composeProviderHasCredentials(provider, apiKey, baseUrl)) {
    printFirstRunGuide(provider);
    process.exit(1);
  }
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
        ...(composeTemperature !== undefined ? { temperature: composeTemperature } : {}),
      },
      outputName,
      autoRun,
      budget,
      lang: composeLang,
      timeoutMs: composeTimeoutMs,
      saveDir: defaultWorkflowsDir('workflows'),
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
        signalFlush: true,
        verify: parseVerifyFlag(),
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

/** run/team-run 的第一个位置参数（任务文本）：跳过命令名、所有 --flag 及其取值。 */
function firstPositional(): string | undefined {
  const valueFlags = new Set([
    '--team', '--provider', '--model', '--agents-dir', '--lang', '--name', '--desc',
    '--base-url', '--baseurl', '--api-key', '--apikey', '--timeout', '--output',
    '--resume', '--from', '--feedback', '--input', '-i', '--port',
  ]);
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('-')) {
      if (valueFlags.has(a)) i++;   // 跳过该 flag 的取值
      continue;
    }
    return a;
  }
  return undefined;
}

/**
 * 零配置首跑：没显式指定 provider、也没配 deepseek key 时，优先用本机已装的订阅制 CLI
 * （claude/gemini/codex…，复用其登录态，无需另配 key）。显式指定的 provider 永远优先。
 * 用于 compose / prompt / team 等「需要一个能直接跑的 provider」的路径；`ao run` 不走这里（尊重 YAML）。
 */
function autoProvider(explicit: string | undefined, fallback: string): string {
  if (explicit) return explicit;
  // 1) 本机已装的订阅制 CLI 优先（零配置、复用登录态）——已停服的（如 gemini-cli）绝不自动选
  const detected = detectUsableCliProviders();
  if (detected.length > 0) {
    console.log(`  🔌 检测到本机已安装 ${detected[0]}，零配置直接用（要换 provider 用 --provider 指定）\n`);
    return detected[0];
  }
  // 2) 没装 CLI：尊重用户已配 key 的 provider（与 Web /api/config 的 recommended 一致），
  //    避免用户配了 OPENAI/Anthropic key 却被兜底成 deepseek 而报错。
  const keyed: Array<[string, string]> = [
    ['deepseek', 'DEEPSEEK_API_KEY'],
    ['openai', 'OPENAI_API_KEY'],
    ['claude', 'ANTHROPIC_API_KEY'],
  ];
  for (const [provider, envKey] of keyed) {
    if (process.env[envKey]) return provider;
  }
  // 3) 都没有 → 兜底默认
  return fallback;
}

/**
 * 读 Studio（网页/桌面版）存的 key —— 它写在 <DATA_DIR>/.local/web-keys.json，
 * 只会注入 Studio 服务进程的 env，命令行看不到。doctor 必须认得它，否则「界面里明明
 * 配好了，doctor 却说没有 key」，排查时第一步就被带偏。
 * DATA_DIR 与 web/server.js 保持同一套优先级：AO_DATA_DIR > 安装目录（包根）。
 */
function readStudioKeys(): Record<string, { apiKey?: string; baseUrl?: string; model?: string }> {
  const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const dirs = [process.env.AO_DATA_DIR ? resolve(process.env.AO_DATA_DIR) : '', pkgRoot, process.cwd()].filter(Boolean);
  for (const d of dirs) {
    const f = join(d, '.local', 'web-keys.json');
    if (!existsSync(f)) continue;
    try {
      const parsed = JSON.parse(readFileSync(f, 'utf-8'));
      if (parsed && typeof parsed === 'object') return parsed;
    } catch { /* 坏 JSON：当作没有 */ }
  }
  return {};
}

/**
 * ao doctor —— 环境自检：一条命令看清 provider/凭证/CLI/系统 Claude Code 哪里不对。
 * `--fix`：若检测到系统 ~/.claude 被劫持（假 token / 中转地址顶掉官方登录），一键清除恢复（写前自动备份）。
 */
async function handleDoctor(): Promise<void> {
  const fix = args.includes('--fix');
  console.log('\n  🩺 ao doctor —— 环境自检\n');
  let problems = 0;

  // 1) 本机已装的订阅制 CLI（零配置可用）——已停服的单独标注，不与活跃 CLI 混列
  const installed = detectInstalledCliProviders();
  const usable = installed.filter((p) => !(p in DEPRECATED_CLI_PROVIDERS));
  const dead = installed.filter((p) => p in DEPRECATED_CLI_PROVIDERS);
  console.log(usable.length
    ? `  ✅ 已装 CLI（零配置可用）：${usable.join(', ')}`
    : `  ·  未检测到订阅制 CLI（claude-code / antigravity-cli 等）`);
  for (const p of dead) {
    console.log(`  ⚠️ ${p} 已安装但不再推荐：${DEPRECATED_CLI_PROVIDERS[p]}`);
  }

  // 1.5) Ollama 本地端点 —— compose/run 对 ollama 一律放行不探测，doctor 是唯一说真话的地方：
  //      不探的话「配了 ollama 却没启动服务」要到工作流第一步失败才暴露。
  {
    const ollamaUrl = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '');
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(`${ollamaUrl}/api/tags`, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) console.log(`  ✅ Ollama 本地服务可达（${ollamaUrl}）`);
      else console.log(`  ⚠️ Ollama 端点响应异常（${ollamaUrl} → HTTP ${res.status}）`);
    } catch {
      console.log(`  ·  Ollama 未运行（${ollamaUrl} 不可达；要用本地模型先 \`ollama serve\`）`);
    }
  }

  // 2) 环境变量里已配 key 的 API provider
  const envKeys: Record<string, string> = { claude: 'ANTHROPIC_API_KEY', ...Object.fromEntries(API_PROVIDERS.map((p) => [p.id, p.envKey])) };
  const keyed = Object.entries(envKeys).filter(([, k]) => process.env[k]).map(([id]) => id);
  console.log(keyed.length
    ? `  ✅ 环境变量已配 key：${keyed.join(', ')}`
    : `  ·  没有 API provider 的 key（env）`);

  // 2.5) Studio（网页/桌面版）里配的 key 只注入 Studio 自己的进程，命令行看不到 ——
  //      不说清楚的话，用户会遇到「界面能跑、命令行说没配 key」而无从理解。
  const studioKeys = readStudioKeys();
  const studioKeyed = Object.entries(studioKeys).filter(([, v]) => v?.apiKey).map(([id]) => id);
  const studioOnly = studioKeyed.filter((id) => !keyed.includes(id));
  if (studioKeyed.length) {
    console.log(`  ✅ Studio 里已配 key：${studioKeyed.join(', ')}`);
    if (studioOnly.length) {
      console.log(`     ⚠️ 这些只存在 Studio 里（网页/桌面版能跑），命令行不会读 —— 直接敲 ao 命令仍会报没凭证`);
      const sample = studioOnly[0];
      const envName = envKeys[sample] || `${sample.toUpperCase()}_API_KEY`;
      console.log(`     ↳ 命令行要用就 export ${envName}=... ，或跑的时候带 --api-key / --provider`);
    }
  }

  // 3) 默认将使用的 provider 是否就绪（跑任务前最关键）
  const def = autoProvider(process.env.AO_PROVIDER, 'deepseek');
  const ready = composeProviderHasCredentials(def);
  if (ready) {
    console.log(`  ✅ 默认 provider：${def}（就绪，可直接跑）`);
  } else {
    problems++;
    console.log(`  ❌ 默认 provider "${def}" 无凭证 —— 直接跑任务会失败`);
  }

  // 3.5) 端点连通性：地址配错（少写/多写 /v1、被 301 跳转降级、填成网页地址）光看配置看不出来，
  //      只有真发一次请求才知道。只对 OpenAI 兼容 API 做（CLI/ollama/claude 各走自己的通道），
  //      且必须已有 key；发一个 max_tokens=1 的最小请求，成本可忽略。--no-probe 可跳过。
  const apiSpec = API_PROVIDER_MAP[def];
  // 环境变量没有就退回 Studio 存的 key：探测的目的是验证「这个地址+这把 key 通不通」，
  // 而地址配错恰恰多发生在 Studio 里配的那批用户身上，正是最需要体检的人。
  const savedForDef = studioKeys[def] || {};
  const probeKey = apiSpec ? (process.env[apiSpec.envKey] || savedForDef.apiKey || '') : '';
  const probeFromStudio = !!(apiSpec && !process.env[apiSpec.envKey] && savedForDef.apiKey);
  if (apiSpec && probeKey && !args.includes('--no-probe')) {
    const base = normalizeBaseUrl(process.env[apiSpec.envBase] || savedForDef.baseUrl || apiSpec.defaultBaseUrl);
    const model = savedForDef.model || apiSpec.defaultModel || 'gpt-4o-mini';
    if (probeFromStudio) console.log(`  ·  用 Studio 里保存的 ${def} 配置做端点探测（命令行 env 里没有这把 key）`);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    const t0 = Date.now();
    try {
      const post = await postChatCompletions({
        baseUrl: base, signal: ctrl.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${probeKey}` },
        body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
      });
      if (post.response.ok) {
        console.log(`  ✅ 端点可达：${post.url}（${Date.now() - t0}ms）`);
        if (post.drift) {
          problems++;
          console.log(`     ⚠️ 地址与配置不一致：${post.drift}`);
          console.log(`     ↳ 本次靠自动兜底跑通了，但别的工具没有这层兜底 —— 建议把 base_url 改成上面的最终地址`);
        }
      } else {
        problems++;
        const body = await post.response.text().catch(() => '');
        console.log(`  ❌ 端点不通：HTTP ${post.response.status} ${body.slice(0, 160)}`);
        console.log(endpointHint(post.response.status, post.url, base, post.drift).replace(/^\n {2}/, '     ').replace(/\n {2}/g, '\n     '));
      }
    } catch (err) {
      problems++;
      const msg = ctrl.signal.aborted ? '超时（12s）' : (err instanceof Error ? err.message : String(err));
      console.log(`  ❌ 端点不通：${msg}`);
      console.log(`     ↳ 检查 ${apiSpec.envBase}（当前 ${base}）是否正确、网络是否可达`);
      // 配了代理但 Node 的 fetch 不走它 —— "curl 能通、AO 连不上"的头号原因，必须点破
      const proxyNote = envProxyHint();
      if (proxyNote) console.log(`     ↳ ${proxyNote.replace(/\n {2}/g, '\n     ')}`);
    } finally {
      clearTimeout(timer);
    }
  }

  // 3.6) claude 走原生 SDK、不在 API_PROVIDERS 表里，上面那段探不到它。以前这没问题
  //      （它只能连官方端点），但现在 claude 支持自定义 base_url 直连 Anthropic 协议
  //      的中转商 —— 而"地址配错"恰恰是中转用户最容易踩的坑，反倒成了体检盲区。
  //      这里按 Anthropic 原生协议单独探一次，与 Studio「测试连接」同一套路径兜底。
  if (def === 'claude' && !args.includes('--no-probe')) {
    const savedClaude = studioKeys['claude'] || {};
    const claudeKey = process.env.ANTHROPIC_API_KEY || savedClaude.apiKey || '';
    const rawBase = process.env.ANTHROPIC_BASE_URL || savedClaude.baseUrl || '';
    if (claudeKey) {
      const base = normalizeAnthropicBaseUrl(rawBase) || 'https://api.anthropic.com';
      const baseHadSuffix = /\/(v\d+|messages)\/?$/i.test(rawBase.trim());
      const isRelay = !/(^|\.)anthropic\.com$/i.test(new URL(base).hostname);
      const model = savedClaude.model || 'claude-sonnet-5';
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12_000);
      const t0 = Date.now();
      try {
        // 路径首选与真实客户端一致（SDK/claude CLI 都发 POST {base}/v1/messages）——
        // 否则正确配置的中转会先 404 再靠兜底命中，并报出"建议把 base_url 改成
        // .../v1/messages"这种照做就连不上的错误建议
        const post = await postApiEndpoint({
          baseUrl: base, path: 'v1/messages', signal: ctrl.signal,
          // 中转商认 x-api-key 或 Bearer 的都有，两个都带（与 Studio 的测试连接一致）
          headers: {
            'content-type': 'application/json', 'anthropic-version': '2023-06-01',
            'x-api-key': claudeKey, authorization: `Bearer ${claudeKey}`,
          },
          body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
        });
        if (post.response.ok) {
          console.log(`  ✅ 端点可达：${post.url}（${Date.now() - t0}ms）${isRelay ? ' —— Anthropic 协议中转' : ''}`);
          if (post.drift) {
            problems++;
            console.log(`     ⚠️ 地址与配置不一致：${post.drift}`);
            console.log(`     ↳ 建议把 base_url 直接改成上面的最终地址`);
          } else if (baseHadSuffix) {
            // 这里能跑通是因为我们先削了后缀；但 claude CLI 直接读 ANTHROPIC_BASE_URL，
            // 它会再接一次 /v1/messages —— 同一个地址在别处就是坏的，得说出来
            problems++;
            console.log(`     ⚠️ 地址里多写了 /v1 或 /messages：${rawBase.trim()}`);
            console.log(`     ↳ 客户端会自己接 /v1/messages，建议改成 ${base}`);
          }
        } else {
          problems++;
          const body = await post.response.text().catch(() => '');
          console.log(`  ❌ 端点不通：HTTP ${post.response.status} ${body.slice(0, 160)}`);
          console.log(endpointHint(post.response.status, post.url, base, post.drift).replace(/^\n {2}/, '     ').replace(/\n {2}/g, '\n     '));
          if (isRelay) console.log(`     ↳ 中转商的 Anthropic 端点常带子路径（如 /api/claudecode），别只填域名`);
        }
      } catch (err) {
        problems++;
        const msg = ctrl.signal.aborted ? '超时（12s）' : (err instanceof Error ? err.message : String(err));
        console.log(`  ❌ 端点不通：${msg}`);
        console.log(`     ↳ 检查 ANTHROPIC_BASE_URL（当前 ${base}）是否正确、网络/代理是否可达`);
      } finally {
        clearTimeout(timer);
      }
    }
  }

  // 4) 系统 Claude Code 健康（复用 claude-repair 的诊断）
  const diag = diagnoseClaudeConfig();
  if (diag.healthy) {
    console.log(`  ✅ 系统 Claude Code：正常（~/.claude 未被劫持）`);
  } else {
    problems++;
    const where = diag.baseUrl ? `（请求被改道到 ${diag.baseUrl}）` : '';
    console.log(`  ❌ 系统 Claude Code：被劫持 ${where} —— 官方登录失效`);
    if (fix) {
      const r = repairClaudeConfig();
      if (r.changed) {
        console.log(`     ↳ 已清除劫持配置（原文件已备份）。请重启 Claude Code 并 /login 重新登录。`);
        for (const f of r.files) if (f.backup) console.log(`       备份：${f.backup}`);
        problems--;
      }
      if (r.shellOverridesRemaining.length) console.log(`     ⚠️ shell 里仍有残留（需手动删）：${r.shellOverridesRemaining.join(', ')}`);
    } else {
      console.log(`     ↳ 跑 \`ao doctor --fix\` 一键恢复（写前自动备份）`);
    }
  }

  console.log('');
  if (problems === 0) {
    console.log(`  🎉 一切就绪，直接 \`ao compose "一句话" --run\` 开跑。\n`);
  } else {
    console.log(`  发现 ${problems} 个问题。`);
    if (!ready) printFirstRunGuide(def);
  }
}

/** 解析 --temperature（0~2），非法即退出；未设置返回 undefined（用模型默认）。 */
function parseTemperatureArg(): number | undefined {
  const raw = getArgValue('--temperature');
  if (raw === undefined) return undefined;
  const temp = Number(raw);
  if (Number.isNaN(temp) || temp < 0 || temp > 2) {
    console.error(`--temperature 值无效: "${raw}"（应为 0~2 的数字，如 0 / 0.7 / 1）`);
    process.exit(1);
  }
  return temp;
}

/** 解析 --verify/--no-verify 三态：true 强制开 / false 强制关 / undefined 按 YAML 顶层 verify（默认开）。 */
function parseVerifyFlag(): boolean | undefined {
  if (args.includes('--no-verify')) return false;
  if (args.includes('--verify')) return true;
  return undefined;
}

const COMPOSE_CLI_PROVIDERS = ['claude-code', 'antigravity-cli', 'gemini-cli', 'copilot-cli', 'codex-cli', 'openclaw-cli', 'hermes-cli'];

/** R2.1：判断 compose 要用的 provider 是否已有可用凭证。保守——不确定时返回 true（不拦已能跑的配置）。 */
/**
 * ao report [dir|last] —— 把一次运行渲染成可分享的自包含 HTML（写到 <run>/report.html）。
 * 增长闭环的一环：用户满意的成果 → 一条命令 → 一张可直接发到群里的页面（带产品署名）。
 */
async function handleReport(): Promise<void> {
  const { renderRunDirReport } = await import('./cli/share-report.js');
  const target = args[1] && !args[1].startsWith('--') ? args[1] : 'last';

  let runDir = target;
  if (target === 'last') {
    const { findLatestOutput } = await import('./output/reporter.js');
    // 与 run/resume 同一套目录解析（AO_OUTPUT_DIR > $AO_HOME/ao-output > cwd 相对）——
    // 硬编码 'ao-output' 会让设了 AO_HOME 的用户永远"找不到运行输出"
    const outputDir = getArgValue('--output') || defaultOutputDir();
    const latest = findLatestOutput(outputDir);
    if (!latest) {
      console.error(`找不到运行输出（${outputDir}/ 为空）。先跑一次工作流，或指定目录：ao report <dir>`);
      process.exit(1);
    }
    runDir = latest;
  }

  let html: string;
  try {
    html = renderRunDirReport(runDir, new Date().toLocaleString());
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
  const out = join(runDir, 'report.html');
  writeFileSync(out, html, 'utf-8');
  console.log(`\n  📄 报告已生成：${out}`);
  console.log(`     自包含单文件（图片已内联）——直接发给任何人，双击即开，无需装 AO。\n`);
}

function composeProviderHasCredentials(provider: string, apiKey?: string, baseUrl?: string): boolean {
  if (apiKey || baseUrl) return true;                 // 显式 --api-key / --base-url
  if (COMPOSE_CLI_PROVIDERS.includes(provider)) return detectInstalledCliProviders().includes(provider);
  if (provider === 'ollama') return true;             // 本地，无需 key（连不上由运行时兜底提示）
  const envKey = provider === 'claude' ? 'ANTHROPIC_API_KEY' : API_PROVIDER_MAP[provider]?.envKey;
  if (!envKey) return true;                            // 自定义/未知 provider 无已知 envKey → 不拦
  return !!process.env[envKey];
}

/** R2.1：无凭证时打印「三选一」首跑引导，把「撞墙」变「选路」。 */
function printFirstRunGuide(provider: string): void {
  // 首跑引导不能把新用户指向已停服的 CLI（装了 gemini 二进制 ≠ 还能用）
  const installed = detectUsableCliProviders();
  const L = (s = '') => console.error(s);
  L('');
  L('  ⚠️  还没有可用的模型凭证 —— 先选一条路（大多 30 秒搞定）：');
  L('');
  if (installed.length > 0) {
    L(`  ① 用本机已装的 CLI（零配置、复用登录态、不额外花钱）：`);
    L(`       ao compose "…" --run --provider ${installed[0]}`);
  } else {
    L(`  ① 装个订阅制 CLI（零配置）：如 claude-code / antigravity-cli，装好并登录后：`);
    L(`       ao compose "…" --run --provider claude-code`);
  }
  L('');
  L(`  ② 用「送额度」的聚合/中转（几十秒拿 key，一个 key 通 Claude/GPT/Gemini 全家桶）：`);
  // 赞助商位规则（src/utils/sponsor-guide.ts）：进阶档持有默认 provider 位、不占此处，
  // 但该档位自 2026-08-17 起无人持有（多元探索下架），所以此处就是全部 7 家
  // （旗舰+标准）按天轮换 2 家
  const rots = rotatingSponsors();
  for (const s of rots) {
    // 纯编码 CLI 中转商（relayOnly）拿到 key 后不是配 --provider，而是在 Studio 里给
    // claude/codex/gemini 配中转，这里直说，免得用户照着下面那行示例去 --provider 它
    const how = s.relayOnly ? '（编码 CLI 中转，在 Studio「供应商 → CLI 中转商」一键配）' : '';
    L(`       · ${s.name}${s.bonus ? ` ${s.bonus}` : ''} → ${s.url}${how}`);
  }
  L(`       拿到 key：ao compose "…" --run --provider ${guideProviderId(rots)} --api-key <你的key>`);
  L('');
  L(`  ③ 本地免费跑（需先装 Ollama 并拉好模型，建议 70B+）：`);
  L(`       ao compose "…" --run --provider ollama --model llama3`);
  L('');
  L(`  （当前默认 provider 是 "${provider}"，未检测到它的凭证；配好后重跑即可）`);
  L('');
}

/** 解析 provider/model（CLI flag > env > 自动探测 > 兜底默认），team 可提供默认 provider/model。 */
function resolveProviderModel(teamProvider?: string, teamModel?: string): { provider: LLMConfig['provider']; model: string } {
  const explicit = getArgValue('--provider') || process.env.AO_PROVIDER || teamProvider;
  const provider = autoProvider(explicit, 'deepseek') as LLMConfig['provider'];
  const cliProviders = ['claude-code', 'antigravity-cli', 'gemini-cli', 'copilot-cli', 'codex-cli', 'openclaw-cli', 'hermes-cli'];
  const model = getArgValue('--model') || process.env.AO_MODEL || teamModel || (
    cliProviders.includes(provider) ? '' :
    provider === 'claude' ? 'claude-sonnet-4-20250514' :
    API_PROVIDER_MAP[provider]?.defaultModel || ''
  );
  return { provider, model };
}

/** ao run --team <名字> "<任务>"：加载团队 → compose 锁定阵容 → 直接运行。 */
async function runWithTeam(teamRef: string): Promise<void> {
  const task = firstPositional();
  if (!task) {
    console.error('用法: ao run --team <名字> "你想让这个团队做的任务"');
    console.error('  例: ao run --team 自媒体副业实战组 "帮我规划一个读书博主账号"');
    console.error('  查看已有团队: ao team list');
    process.exit(1);
  }

  let team;
  try {
    const { loadTeamByRef } = await import('./cli/team.js');
    team = loadTeamByRef(teamRef);
  } catch (err) {
    console.error(`\n错误: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  const lang = (getArgValue('--lang') as 'zh' | 'en' | undefined) ?? team.lang ?? 'zh';
  const agentsDir = getArgValue('--agents-dir') || resolveAgentsDir(lang);
  const { provider, model } = resolveProviderModel(team.provider, team.model);
  const baseUrl = getArgValue('--base-url') || getArgValue('--baseurl');
  const apiKey = getArgValue('--api-key') || getArgValue('--apikey');
  const timeoutRaw = getArgValue('--timeout');
  let timeoutMs: number | undefined;
  if (timeoutRaw !== undefined) {
    const parsed = parseDuration(timeoutRaw);
    if (parsed === null) { console.error(`--timeout 值无效: "${timeoutRaw}"`); process.exit(1); }
    timeoutMs = parsed;
  }
  const cliProviders = ['claude-code', 'antigravity-cli', 'gemini-cli', 'copilot-cli', 'codex-cli', 'openclaw-cli', 'hermes-cli'];

  console.log(`\n  🎭 团队「${team.name}」(${team.roles.length} 位专家) 接到新任务\n`);
  for (const r of team.roles) console.log(`    ${r.emoji || '•'} ${r.name || r.role}`);
  console.log('');

  try {
    const { composeWorkflow } = await import('./cli/compose.js');
    const { savedPath, relativePath, warnings } = await composeWorkflow({
      description: task,
      agentsDir: resolve(agentsDir),
      llmConfig: {
        provider, model,
        ...(baseUrl ? { base_url: baseUrl } : {}),
        ...(apiKey ? { api_key: apiKey } : {}),
      },
      pinnedRoles: team.roles.map(r => r.role),
      autoRun: true,
      lang,
      timeoutMs,
      saveDir: defaultWorkflowsDir('ao-workflows'),
    });
    console.log(`  ${t('compose.generated', { path: relativePath })}\n`);

    // compose 出现致命问题（解析失败/未定义变量/幻觉角色）→ 不进入运行
    const fatal = warnings.some(w =>
      w.includes('解析失败') || w.includes('未定义的变量') || w.includes('不存在于角色库') ||
      w.toLowerCase().includes('parse failed') || w.toLowerCase().includes('undefined variable')
    );
    if (fatal) {
      console.error(`  ${t('compose.retry_yaml_bad')}`);
      for (const w of warnings) console.error(`    - ${w}`);
      console.error(`\n  可手动修改后运行: ao run ${relativePath}`);
      process.exit(1);
    }
    if (warnings.length > 0) {
      console.log(`  ${t('compose.warnings_header')}`);
      for (const w of warnings) console.log(`    - ${w}`);
      console.log('');
    }

    console.log('─'.repeat(50));
    console.log(`  ${t('compose.auto_running')}\n`);
    const result = await run(resolve(savedPath), {}, {
      quiet: args.includes('--quiet') || args.includes('-q'),
      signalFlush: true,
      watch: args.includes('--watch'),
      verify: parseVerifyFlag(),
      outputDir: getArgValue('--output') || defaultOutputDir(),
      llmOverride: {
        provider,
        model: model || undefined,
        timeout: timeoutMs !== undefined ? timeoutMs : (cliProviders.includes(provider) ? 600_000 : 300_000),
        ...(baseUrl ? { base_url: baseUrl } : {}),
        ...(apiKey ? { api_key: apiKey } : {}),
      },
    });
    process.exit(result.success ? 0 : 1);
  } catch (err) {
    console.error(`\n${t('error.prefix')}: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

/** ao team — 管理可复用角色阵容（save / list / show / rm）。 */
async function handleTeam(): Promise<void> {
  const sub = args[1];
  const team = await import('./cli/team.js');

  if (!sub || sub === '--help' || sub === '-h') {
    console.log(`
  ao team — 团队 / Loadout：把跑得好的角色阵容存下来，套到任意新任务上

  ao team save <workflow.yaml> [--name 名字] [--desc 说明]
                                  从一个 workflow 抽出角色阵容，存成可复用团队
  ao team list                    列出已保存的团队
  ao team show <名字>             查看某个团队的角色构成
  ao team rm <名字>               删除团队

  存好后，一句话让整队人接新活：
  ao run --team <名字> "你的新任务"

  团队文件存在 ${team.teamsDir()}（纯 YAML，可直接拷贝分享）
`);
    return;
  }

  try {
    switch (sub) {
      case 'save': {
        const wfPath = args[2];
        if (!wfPath || wfPath.startsWith('-')) {
          console.error('用法: ao team save <workflow.yaml> [--name 名字] [--desc 说明]');
          process.exit(1);
        }
        const def = team.extractTeamFromWorkflow(resolve(wfPath), {
          name: getArgValue('--name'),
          description: getArgValue('--desc'),
        });
        const saved = team.saveTeam(def);
        console.log(`\n  ✅ 已保存团队「${def.name}」(${def.roles.length} 位专家)`);
        for (const r of def.roles) console.log(`    ${r.emoji || '•'} ${r.name || r.role}  ${r.role}`);
        console.log(`\n  位置: ${saved}`);
        console.log(`  套新任务: ao run --team ${team.slugify(def.name)} "你的任务"\n`);
        break;
      }
      case 'list': {
        const all = team.listTeams();
        if (all.length === 0) {
          console.log(`\n  还没有保存的团队。先跑一次 compose，再 \`ao team save <workflow.yaml>\`。\n`);
          return;
        }
        console.log(`\n  共 ${all.length} 个团队 (${team.teamsDir()}):\n`);
        for (const { team: tm } of all) {
          const emojis = tm.roles.map(r => r.emoji || '•').slice(0, 8).join('');
          console.log(`  🎭 ${tm.name}  (${tm.roles.length} 位) ${emojis}`);
          if (tm.description) console.log(`     ${tm.description}`);
          console.log(`     ao run --team ${team.slugify(tm.name)} "..."`);
        }
        console.log('');
        break;
      }
      case 'show': {
        const ref = args[2];
        if (!ref) { console.error('用法: ao team show <名字>'); process.exit(1); }
        const tm = team.loadTeamByRef(ref);
        console.log(`\n  🎭 ${tm.name}${tm.description ? ` — ${tm.description}` : ''}`);
        console.log(`  语言: ${tm.lang || 'zh'}${tm.provider ? ` · 默认 provider: ${tm.provider}` : ''}${tm.source ? ` · 来源: ${tm.source}` : ''}\n`);
        for (const r of tm.roles) {
          console.log(`  ${r.emoji || '•'} ${r.name || r.role}  ${r.role}`);
          if (r.note) console.log(`     ${r.note}`);
        }
        console.log(`\n  套新任务: ao run --team ${team.slugify(tm.name)} "你的任务"\n`);
        break;
      }
      case 'rm':
      case 'remove':
      case 'delete': {
        const ref = args[2];
        if (!ref) { console.error('用法: ao team rm <名字>'); process.exit(1); }
        const removed = team.removeTeam(ref);
        if (removed) console.log(`  🗑️  已删除团队 "${ref}"`);
        else { console.error(`  找不到团队 "${ref}"`); process.exit(1); }
        break;
      }
      default:
        console.error(`未知子命令: team ${sub}\n用 \`ao team\` 查看用法`);
        process.exit(1);
    }
  } catch (err) {
    console.error(`\n错误: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

/** ao prompt — 提示词优化 / 测试 / 沉淀（Prompt Lab 的 CLI 入口）。 */
async function handlePrompt(): Promise<void> {
  const sub = args[1];
  const P = await import('./cli/prompt.js');

  if (!sub || sub === '--help' || sub === '-h') {
    console.log(`
  ao prompt — 提示词优化 / 测试 / 沉淀

  ao prompt optimize "<原始提示词>" [--mode system|user] [--save 名字]
                                  LLM 一键优化提示词（默认 user 模式）
  ao prompt test "<提示词>" --input "<样例输入>" [--mode system|user]
                                  用样例输入实跑这段提示词，看真实输出
  ao prompt list                  列出已保存的提示词
  ao prompt show <名字>           查看某条提示词（含版本历史）
  ao prompt rm <名字>             删除
  ao prompt garden                查看内置起手模板（Prompt Garden）

  存储在 ${P.promptsDir()}（与网页 Studio 共用）
`);
    return;
  }

  const mode = (getArgValue('--mode') === 'system' ? 'system' : 'user') as 'system' | 'user';

  // 本地位置参数解析（跳过命令名、子命令、所有带值 flag），避免依赖其它分支的辅助函数
  const positional = (): string | undefined => {
    const valueFlags = new Set(['--mode', '--save', '--input', '--provider', '--model', '--lang', '--base-url', '--baseurl', '--api-key', '--apikey']);
    for (let i = 2; i < args.length; i++) {
      const a = args[i];
      if (a.startsWith('-')) { if (valueFlags.has(a)) i++; continue; }
      return a;
    }
    return undefined;
  };
  const cliProviders = ['claude-code', 'antigravity-cli', 'gemini-cli', 'copilot-cli', 'codex-cli', 'openclaw-cli', 'hermes-cli'];
  const provider = autoProvider(getArgValue('--provider') || process.env.AO_PROVIDER, 'deepseek') as LLMConfig['provider'];
  const model = getArgValue('--model') || process.env.AO_MODEL || (
    cliProviders.includes(provider) ? '' :
    provider === 'claude' ? 'claude-sonnet-4-20250514' :
    API_PROVIDER_MAP[provider]?.defaultModel || ''
  );

  try {
    switch (sub) {
      case 'optimize': {
        const raw = positional();
        if (!raw) { console.error('用法: ao prompt optimize "<原始提示词>" [--mode system|user] [--save 名字]'); process.exit(1); }
        const lang = (getArgValue('--lang') as 'zh' | 'en' | undefined) ?? (/[一-鿿]/.test(raw) ? 'zh' : 'en');
        const baseUrl = getArgValue('--base-url') || getArgValue('--baseurl');
        const apiKey = getArgValue('--api-key') || getArgValue('--apikey');
        console.log(`\n  ✨ 正在优化提示词（${mode} 模式 · ${provider}）...\n`);
        const optimized = await P.optimizePrompt({
          rawPrompt: raw, mode, lang,
          llmConfig: { provider, model, ...(baseUrl ? { base_url: baseUrl } : {}), ...(apiKey ? { api_key: apiKey } : {}) },
        });
        console.log('─'.repeat(50));
        console.log(optimized);
        console.log('─'.repeat(50));
        const saveName = getArgValue('--save');
        if (saveName) {
          const now = new Date().toISOString();
          const rec = {
            kind: 'prompt' as const, name: saveName, mode, created: now,
            versions: [
              { content: raw, source: 'original' as const, created: now },
              { content: optimized, source: 'optimize' as const, created: now, note: '一键优化' },
            ],
          };
          const path = P.savePrompt(rec);
          console.log(`\n  💾 已保存为「${saveName}」(2 个版本) → ${path}`);
        } else {
          console.log(`\n  想存下来? 加 --save <名字>`);
        }
        break;
      }
      case 'test': {
        const prompt = positional();
        const input = getArgValue('--input') || '';
        if (!prompt) { console.error('用法: ao prompt test "<提示词>" --input "<样例输入>" [--mode system|user]'); process.exit(1); }
        const baseUrl = getArgValue('--base-url') || getArgValue('--baseurl');
        const apiKey = getArgValue('--api-key') || getArgValue('--apikey');
        console.log(`\n  🧪 实跑测试（${mode} 模式 · ${provider}）...\n`);
        const out = await P.testPrompt({
          prompt, mode, testInput: input,
          llmConfig: { provider, model, ...(baseUrl ? { base_url: baseUrl } : {}), ...(apiKey ? { api_key: apiKey } : {}) },
        });
        console.log('─'.repeat(50));
        console.log(out);
        console.log('─'.repeat(50));
        break;
      }
      case 'list': {
        const all = P.listPrompts();
        if (all.length === 0) { console.log(`\n  还没有保存的提示词。试试 ao prompt optimize "..." --save 名字\n`); return; }
        console.log(`\n  共 ${all.length} 条提示词 (${P.promptsDir()}):\n`);
        for (const { record: r } of all) {
          console.log(`  ${r.favorite ? '⭐' : '📝'} ${r.name}  [${r.mode}] · ${r.versions.length} 版`);
        }
        console.log('');
        break;
      }
      case 'show': {
        const ref = args[2];
        if (!ref) { console.error('用法: ao prompt show <名字>'); process.exit(1); }
        const r = P.loadPrompt(ref);
        console.log(`\n  ${r.favorite ? '⭐' : '📝'} ${r.name}  [${r.mode}]  ${r.versions.length} 个版本\n`);
        r.versions.forEach((v, i) => {
          console.log(`  ── v${i + 1}${v.source ? ` (${v.source})` : ''}${v.note ? ` · ${v.note}` : ''} ──`);
          console.log(v.content.split('\n').map(l => `    ${l}`).join('\n'));
          console.log('');
        });
        break;
      }
      case 'rm':
      case 'remove':
      case 'delete': {
        const ref = args[2];
        if (!ref) { console.error('用法: ao prompt rm <名字>'); process.exit(1); }
        const removed = P.removePrompt(ref);
        if (removed) console.log(`  🗑️  已删除提示词 "${ref}"`);
        else { console.error(`  找不到提示词 "${ref}"`); process.exit(1); }
        break;
      }
      case 'garden': {
        console.log(`\n  🌱 Prompt Garden — 内置起手模板:\n`);
        for (const s of P.PROMPT_GARDEN) {
          console.log(`  [${s.mode}] ${s.name}  (${s.tags.join(', ')})`);
          console.log(`    ${s.content.split('\n')[0].slice(0, 60)}...`);
        }
        console.log('');
        break;
      }
      default:
        console.error(`未知子命令: prompt ${sub}\n用 \`ao prompt\` 查看用法`);
        process.exit(1);
    }
  } catch (err) {
    console.error(`\n${t('error.prefix')}: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

/** ao skills — 列出 / 查看可挂到工作流步骤的方法论 skill（来自 superpowers-zh）。 */
async function handleSkills(): Promise<void> {
  const S = await import('./skills/loader.js');
  const dir = S.resolveSkillsDir();
  const ref = args[1] && !args[1].startsWith('-') ? args[1] : '';

  if (ref) {
    const sk = S.loadSkill(ref);
    if (!sk) { console.error(`找不到 skill "${ref}"。用 \`ao skills\` 查看全部。`); process.exit(1); }
    console.log(`\n  🧠 ${sk.name}\n  ${sk.description}\n`);
    console.log('─'.repeat(50));
    console.log(sk.body);
    console.log('─'.repeat(50));
    console.log(`\n  在工作流步骤里挂上它：  skill: "${sk.name}"\n`);
    return;
  }

  const all = S.listSkills();
  if (!dir || all.length === 0) {
    console.log(`\n  没找到 skill 库。skill 用开源的 superpowers-zh（已作为依赖）。`);
    console.log(`  也可设 AO_SKILLS_DIR=/你的skill目录 用自己的。\n`);
    return;
  }
  console.log(`\n  共 ${all.length} 个 skill (${dir}):\n`);
  for (const sk of all) {
    console.log(`  🧠 ${sk.name}`);
    if (sk.description) console.log(`     ${sk.description.slice(0, 90)}`);
  }
  console.log(`\n  用法：在工作流步骤里加 skill: "<名字>"（或 skills: [..]），方法论会注入该步。`);
  console.log(`  查看某个：ao skills <名字>\n`);
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

function openBrowser(url: string): void {
  try {
    const cmd =
      process.platform === 'darwin' ? `open "${url}"` :
      process.platform === 'win32' ? `start "" "${url}"` :
      `xdg-open "${url}"`;
    execSync(cmd, { stdio: 'ignore' });
  } catch {
    /* 打不开浏览器不致命，用户可手动访问 */
  }
}

async function handleWeb(): Promise<void> {
  const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const serverPath = join(pkgRoot, 'web', 'server.js');
  if (!existsSync(serverPath)) {
    console.error('错误: 找不到 Web Studio 服务文件 (web/server.js)。\n请在项目仓库根目录运行 `ao web`。');
    process.exit(1);
  }
  const port = getArgValue('--port') || process.env.PORT || '8088';
  const host = process.env.HOST || '127.0.0.1';
  const url = `http://${host}:${port}`;
  const noOpen = args.includes('--no-open');

  console.log(`\n🌐 启动 AO Web Studio … ${url}`);
  console.log('   按 Ctrl+C 停止\n');

  const child = spawn(process.execPath, [serverPath], {
    stdio: 'inherit',
    env: { ...process.env, PORT: String(port), HOST: host },
  });

  // 让 Studio 默认跟随 CLI 的界面语言（用户在界面里切换后由 localStorage 记住）
  if (!noOpen) setTimeout(() => openBrowser(`${url}/?lang=${detectLang()}`), 1500);

  const stop = () => { try { child.kill('SIGINT'); } catch { /* noop */ } };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  child.on('exit', (code) => process.exit(code ?? 0));
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
      // Route to the env var the matching connector already reads.
      // 每个 provider 写到自己专属的 BASE_URL env，避免 issue #16 的跨污染
      const p = (cfgProvider || '').toLowerCase();
      const urlVar =
        p === 'ollama' ? 'OLLAMA_BASE_URL' :
        API_PROVIDER_MAP[p]?.envBase || 'OPENAI_BASE_URL';
      updates[urlVar] = cfgBaseUrl;
    }
    if (cfgApiKey) {
      // 路由到 factory 里 connector 实际会读的 env 变量。
      // factory.ts 只对 deepseek / claude / openai 有专属分支；其他 provider
      // （zhipu/glm/qwen/moonshot 等）都走 default → openai-compatible，读 OPENAI_API_KEY。
      // 所以未知 provider 的 key 也写到 OPENAI_API_KEY，不再写死代码的 AO_API_KEY / ZHIPU_API_KEY。
      const p = (cfgProvider || process.env.AO_PROVIDER || '').toLowerCase();
      const keyVar =
        p === 'anthropic' || p === 'claude' ? 'ANTHROPIC_API_KEY' :
        API_PROVIDER_MAP[p]?.envKey || 'OPENAI_API_KEY';
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

  // 首跑向导：按检测到的 provider 给个性化的下一步（就绪→直接 demo/compose；没有→最省事的获取路径）
  const { detectAvailableLLMs, buildFirstRunGuidance } = await import('./cli/demo.js');
  const llms = await detectAvailableLLMs();
  for (const line of buildFirstRunGuidance(llms, lang).split('\n')) console.log(`  ${line}`);
  console.log('');
  console.log(lang === 'en' ? '  More:' : '  更多：');
  console.log(lang === 'en'
    ? '    ao roles                               list all roles'
    : '    ao roles                               查看所有角色');
}

function handleRoles(): void {
  const agentsDir = getArgValue('--agents-dir') || resolveAgentsDir();
  // 关键词：--search <kw> 或第一个非 flag 位置参数（ao roles seo）
  const keyword = getArgValue('--search')
    || (args[1] && !args[1].startsWith('-') ? args[1] : '');

  try {
    const all = listAgents(resolve(agentsDir), true);
    const agents = keyword ? filterAgentsByKeyword(all, keyword) : all;

    if (keyword) {
      console.log(`\n  搜索 "${keyword}"：匹配 ${agents.length} / ${all.length} 个角色 (${agentsDir})\n`);
      if (agents.length === 0) {
        console.log('  没有匹配的角色。换个关键词，或用 `ao roles` 查看全部。\n');
        return;
      }
    } else {
      console.log(`\n  共 ${agents.length} 个角色 (${agentsDir}):\n`);
    }

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

/**
 * 严格按语言解析角色库源（install 专用）：不跨语言兜底，避免本仓库根目录的 ./agency-agents(英文)
 * 抢占了 --lang zh 想要的中文库。zh → 只找 agency-agents-zh；en → 只找 agency-agents。
 */
function resolveRoleSource(lang: 'zh' | 'en'): string | null {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const name = lang === 'zh' ? 'agency-agents-zh' : 'agency-agents';
  const cands = [
    `./${name}`,
    `../${name}`,
    `./node_modules/${name}`,
    join(scriptDir, '..', 'node_modules', name),
    join(scriptDir, '..', '..', 'node_modules', name),
    join(scriptDir, '..', name), // 包内置
  ];
  for (const c of cands) {
    const r = resolve(c);
    if (existsSync(r)) return r;
  }
  return null;
}

/** ao install --tool <工具>：把内置角色装进 Claude Code / Cursor 等编码工具。 */
function handleInstall(): void {
  const tool = getArgValue('--tool');
  const target = tool ? INSTALL_TARGETS[tool] : undefined;
  if (!target) {
    console.error('用法: ao install --tool <工具> [--lang zh|en] [--category <分类>] [--dry-run]');
    console.error('  把内置 AI 角色装进编码工具，装完在该工具里直接可用。');
    console.error('  支持的工具: ' + Object.keys(INSTALL_TARGETS).join(', '));
    process.exit(1);
  }
  const lang = (getArgValue('--lang') as 'zh' | 'en') || 'zh';
  const category = getArgValue('--category') || undefined;
  const dryRun = args.includes('--dry-run');
  const agentsDir = getArgValue('--agents-dir') || resolveRoleSource(lang) || resolveAgentsDir(lang);
  try {
    const res = installRoles(agentsDir, target, { home: homedir(), cwd: process.cwd(), category, dryRun });
    if (res.installed === 0) {
      console.log(`\n  没有可安装的角色（来源: ${agentsDir}${category ? `, 分类: ${category}` : ''}）\n`);
      return;
    }
    console.log(`\n  ${dryRun ? '将安装' : '✅ 已安装'} ${res.installed} 个角色 → ${target.label}`);
    console.log(`     目标目录: ${res.destDir}（${target.scope === 'project' ? '项目级' : '用户级'}）`);
    console.log(`     来源: ${agentsDir}`);
    if (dryRun) console.log('     （--dry-run，未实际写入）\n');
    else console.log(`\n  现在在 ${target.label} 里就能用这些角色了。\n`);
  } catch (err) {
    console.error(`错误: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

/** 解析 --input key=value 和 --input key=@file 参数。逻辑在 cli/parse-inputs.ts，便于单测。 */
function parseInputArgs(): Record<string, string> {
  return parseInputPairs(args, (msg) => { console.error(msg); process.exit(1); });
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
  // 自定义角色目录（自带私有专家）：AO_AGENTS_DIR 优先于内置查找，存在才采用。
  // loader 已支持任意 agentsDir，这里只是把它暴露成无需每次 --agents-dir 的全局配置。
  if (process.env.AO_AGENTS_DIR) {
    const custom = resolve(process.env.AO_AGENTS_DIR);
    if (existsSync(custom)) return custom;
  }
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

/**
 * ao upgrade — 自我升级：拉取 npm 最新版，比对后自动用对应包管理器升级。
 *   ao upgrade            检测并升级到最新版
 *   ao upgrade --check    只检查不升级（干跑，CI 友好）
 * 包管理器自动从安装路径推断，可用 AO_UPGRADE_CMD 覆盖整条命令。
 */
async function handleUpgrade(): Promise<void> {
  const current = getVersion();
  const checkOnly = args.includes('--check') || args.includes('--dry-run');

  console.log(t('upgrade.checking', { pkg: PKG }));
  const latest = await fetchLatestVersion();
  if (!latest) {
    console.error(t('upgrade.fetch_failed'));
    process.exit(1);
  }

  if (!isNewer(latest, current)) {
    console.log(t('upgrade.up_to_date', { v: current }));
    return;
  }

  console.log(t('upgrade.available', { current, latest }));
  const cmd = detectUpgradeCommand(`${PKG}@${latest}`, fileURLToPath(import.meta.url));

  if (checkOnly) {
    console.log(t('upgrade.check_hint', { cmd }));
    return;
  }

  console.log(t('upgrade.running', { cmd }) + '\n');
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch {
    // 全局安装常因权限失败；给出可操作提示而非堆栈
    console.error('\n' + t('upgrade.run_failed', { cmd }));
    process.exit(1);
  }
  console.log('\n' + t('upgrade.done', { latest }));
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
