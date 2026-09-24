/**
 * DAG 执行引擎 — 核心调度器
 */
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  WorkflowDefinition,
  DAGNode,
  LLMConnector,
  LLMConfig,
  WorkflowResult,
  StepResult,
} from '../types.js';
import type { DAG } from './dag.js';
import { renderTemplate } from './template.js';
import { evaluateCondition } from './condition.js';
import { loadAgent } from '../agents/loader.js';
import { collectSkillNames, injectSkills } from '../skills/loader.js';
import { createConnector } from '../connectors/factory.js';
import { generateImage } from '../connectors/image.js';
import { generateVideo , type VideoStepOptions } from '../connectors/video.js';
import { concatVideos } from '../media/concat.js';
import { generateSpeech, type TtsStepOptions } from '../connectors/tts.js';
import { verifyAcceptance, buildReworkBlock, formatFailedItems, verifyImageAcceptance, verifyVisualAcceptance, buildImageReworkPrompt, canSeeImages } from './verify.js';
import { extractFrames, jpegDataUri } from '../media/frames.js';
import { FfmpegMissingError } from '../media/concat.js';
import { checkAssert, resolveAssert, buildAssertReworkBlock } from './assert.js';
import { startSleepWatch, type SleepWatch } from '../utils/sleep-watch.js';
import { createInterface } from 'node:readline';

export interface ExecutorOptions {
  connector: LLMConnector;
  agentsDir: string;
  llmConfig: LLMConfig;
  concurrency: number;
  inputs: Map<string, string>;
  /** 每步完成的回调 */
  onStepComplete?: (node: DAGNode) => void;
  onStepStart?: (node: DAGNode) => void;
  /** 一批并行步骤开始前的回调 */
  onBatchStart?: (nodes: DAGNode[]) => void;
  /** 一批并行步骤全部完成后的回调（按顺序） */
  onBatchComplete?: (nodes: DAGNode[]) => void;
  /** resume 模式: 跳过这些步骤（使用 context 中已有的输出） */
  skipStepIds?: Set<string>;
  /**
   * 对话式返工：对指定步骤注入"用户修改意见 + 上一版产出"，让该专家在原稿基础上
   * 按意见修改重做（而非从零重写）。配合 --resume --from <stepId> 使用。
   */
  feedback?: { stepId: string; text: string; previousOutput?: string };
  /**
   * acceptance 自动核验：写了 acceptance 的步骤产出后自动逐条核对，未过则带着
   * 未满足条目自动返工一轮（复用对话式返工范式）。验收不过是质量信号而非执行错误，
   * 步骤不会因此 failed。产品入口（run()）按 CLI flag > YAML 顶层 verify > 默认开
   * 计算后传入；库级直调 executeDAG 不传 = 不核验（向后兼容）。step.verify: false 单步关闭。
   */
  verify?: boolean;
  /** 验收员模型覆盖（YAML 顶层 verify_llm / CLI --verify-provider）。缺省 = 文本供应商；步骤级 llm 优先级更高 */
  verifyLlm?: Partial<LLMConfig>;
  /**
   * 调用方提供的步骤结果收集数组：executor 增量写入（每步完成即可见），
   * 供 SIGTERM/SIGINT 中断时把已完成步骤落盘成 metadata（否则中断的 run 无痕）。
   */
  stepResultsSink?: StepResult[];
  /**
   * resume 复用步骤在上一次运行档案里的展示字段（agentName/acceptance/verification 等），
   * 由 run() 从旧 metadata 读出传入——续跑产生的新档案才不丢被复用步骤的验收记录。
   */
  restoredStepMeta?: Map<string, Partial<StepResult>>;
  /** 本次运行的媒体登记表（run() 建好传入，带暂存目录）；不传则用一份不落盘的，仍然是每次运行独立 */
  media?: MediaRegistry;
}

/**
 * 一次运行的媒体产物登记表（文件名 → 字节）：图生视频引用上游图片、concat 引用上游视频 / 配音时从这里取——
 * 产物要到运行结束才进 `<run>/assets/`，运行中磁盘上还没有。
 *
 * **每次运行一份**，不是模块级全局。以前是全局 Map + run() 开头清空：同一进程里两条运行并发
 * （MCP 的并行工具调用）时，后开始的那条一清空，先开始的那条的 concat 就报「找不到视频」——片子已经付过钱了。
 *
 * `spoolDir`：设了就**产物一生成立刻写盘**。付费产物此前只活在内存里，直到整条运行结束才落盘；
 * 中途进程被杀（OOM / SIGKILL / 断电 / 合盖）就全没了，而按秒计费的视频是要不回来的。
 */
export interface MediaRegistry {
  images: Map<string, Buffer>;
  videos: Map<string, Buffer>;
  audios: Map<string, Buffer>;
  spoolDir?: string;
}

export function createMediaRegistry(spoolDir?: string): MediaRegistry {
  return { images: new Map(), videos: new Map(), audios: new Map(), spoolDir };
}

function registerMedia(reg: MediaRegistry, kind: 'images' | 'videos' | 'audios', filename: string, bytes: Buffer): void {
  reg[kind].set(filename, bytes);
  if (!reg.spoolDir) return;
  try {
    mkdirSync(reg.spoolDir, { recursive: true });
    writeFileSync(join(reg.spoolDir, filename), bytes);
  } catch (err) {
    // 暂存失败不能反过来搞挂已经成功（且已付费）的步骤；但要说出来——此时这份产物只在内存里
    process.stderr.write(`  ⚠️  ${filename} 暂存到 ${reg.spoolDir} 失败（${err instanceof Error ? err.message.slice(0, 80) : err}），产物暂时只在内存里\n`);
  }
}

/** --resume：上一轮的产物已经在磁盘上（assets/），被跳过的图片/视频步骤不会再产出，先把它们读进登记表 */
export function preloadProducedMedia(assetsDir: string, reg: MediaRegistry): number {
  if (!existsSync(assetsDir)) return 0;
  let n = 0;
  for (const f of readdirSync(assetsDir)) {
    const p = join(assetsDir, f);
    if (/\.(png|jpe?g|webp|gif)$/i.test(f)) { reg.images.set(f, readFileSync(p)); n++; }
    else if (/\.(mp4|mov|webm)$/i.test(f)) { reg.videos.set(f, readFileSync(p)); n++; }
    else if (/\.(mp3|wav|aac|opus|flac|m4a)$/i.test(f)) { reg.audios.set(f, readFileSync(p)); n++; }
  }
  return n;
}

export async function executeDAG(dag: DAG, options: ExecutorOptions): Promise<WorkflowResult> {
  const {
    connector,
    agentsDir,
    llmConfig,
    concurrency,
    inputs,
    onStepComplete,
    onStepStart,
  } = options;
  const media = options.media ?? createMediaRegistry();

  // 变量上下文：inputs + 每步的 output
  const context = new Map(inputs);
  const startTime = Date.now();
  const stepResults: StepResult[] = options.stepResultsSink ?? [];

  const isCLI = llmConfig.provider.endsWith('-cli') || llmConfig.provider === 'claude-code';
  const isLocal = llmConfig.provider === 'ollama';
  const timeout = llmConfig.timeout || (isCLI ? 600_000 : isLocal ? 600_000 : 120_000);
  const maxRetry = llmConfig.retry ?? 5;

  // CLI provider 强制串行：共享同一账户额度，并发会触发限速反而更慢
  // parser 已校验；这里再兜一层给直接调 executeDAG 的库用户——步长 < 1 是死循环
  const effectiveConcurrency = isCLI ? 1 : Math.max(1, Math.floor(Number(concurrency)) || 1);

  const loopIterations = new Map<string, number>();
  // 每步真实执行次数与累计 token：循环回跳会重跑 back_to 到循环节点之间的所有步骤，
  // 结果按 id 覆盖——只记最后一轮会把前几轮的次数和 token 丢掉（成本少报、账本少计）
  const execCounts = new Map<string, number>();
  const tokenTotals = new Map<string, { input: number; output: number }>();
  const withPriorTokens = (id: string, current?: { input: number; output: number }) => {
    const prev = tokenTotals.get(id) || { input: 0, output: 0 };
    return { input: prev.input + (current?.input || 0), output: prev.output + (current?.output || 0) };
  };
  const hasLoops = Array.from(dag.nodes.values()).some(n => n.step.loop);
  if (hasLoops) {
    context.set('_loop_iteration', '1');
  }

  let levelIndex = 0;
  while (levelIndex < dag.levels.length) {
    // 同层节点可并行，但受 concurrency 限制
    const { onBatchStart, onBatchComplete } = options;
    const allTasks = dag.levels[levelIndex].map(id => dag.nodes.get(id)!);

    // 过滤掉已被标记为 skipped 的节点 和 resume 跳过的节点
    const tasks = allTasks.filter(node => {
      if (node.status === 'skipped') {
        node.endTime = Date.now();
        node.startTime = node.endTime;
        const runs = execCounts.get(node.step.id) || 0;
        upsertStepResult(stepResults, {
          id: node.step.id,
          role: node.step.role,
          status: 'skipped',
          duration: 0,
          // 本轮跳过，但前几轮真实花掉的 token 仍要算
          tokens: tokenTotals.get(node.step.id) || { input: 0, output: 0 },
          iterations: runs > 1 ? runs : undefined,
        });
        onStepComplete?.(node);
        return false;
      }
      // resume 模式：跳过已有输出的步骤
      if (options.skipStepIds?.has(node.step.id)) {
        node.status = 'completed';
        node.result = node.step.output ? context.get(node.step.output) : undefined;
        node.startTime = Date.now();
        node.endTime = node.startTime;
        // 上一次运行档案里的展示字段（角色名/验收标准/核验结果）随复用一起带回，
        // 否则续跑的新档案里这些步骤全变成裸 id、验收记录凭空消失
        const prev = options.restoredStepMeta?.get(node.step.id);
        upsertStepResult(stepResults, {
          id: node.step.id,
          role: node.step.role,
          agentName: prev?.agentName,
          agentEmoji: prev?.agentEmoji,
          acceptance: prev?.acceptance,
          verification: prev?.verification,
          assertion: prev?.assertion,
          // 媒体产物只带文件名：run() 落盘后据此把上一轮的 png/mp4 复制进新目录，markdown 链接才不断
          imageAsset: prev?.imageAsset,
          videoAsset: prev?.videoAsset,
          audioAsset: prev?.audioAsset,
          status: 'completed',
          output: node.result,
          output_var: node.step.output,
          duration: 0,
          tokens: { input: 0, output: 0 },
          reused: true,
        });
        onStepComplete?.(node);
        return false;
      }
      // 循环回跳重跑时：已完成且不属于循环体的节点保持原样，不重复执行
      // （首次正向执行时该层节点都是 pending，故此分支不影响正常流程）
      if (node.status === 'completed') return false;
      return true;
    });

    // 按 effectiveConcurrency 分批执行
    for (let i = 0; i < tasks.length; i += effectiveConcurrency) {
      const batch = tasks.slice(i, i + effectiveConcurrency);

      // 预加载角色名和 emoji，让 onBatchStart 能显示（步骤级配置优先）
      for (const node of batch) {
        // any_completed 合并步可能在部分依赖失败/跳过时仍然执行（设计意图）。
        // 那些依赖的 output 变量从未写入 context，若 task 模板引用它们会抛"模板变量未定义"
        // 而让合并步反而失败。这里为失败/跳过的依赖补空串，使合并步基于已完成分支正常渲染。
        fillSkippedDepOutputs(dag, node, context);
        if (!node.agentName && node.step.role) {
          try {
            const agentInfo = loadAgent(agentsDir, node.step.role);
            node.agentName = node.step.name || agentInfo.name;
            node.agentEmoji = node.step.emoji || agentInfo.emoji;
          } catch { /* executeStep 里会再加载并报错 */ }
        }
      }

      onBatchStart?.(batch);

      const results = await Promise.allSettled(
        batch.map(node => executeStep(node, {
          connector,
          agentsDir,
          llmConfig,
          context,
          timeout,
          maxRetry,
          onStepStart,
          feedback: options.feedback,
          verify: options.verify,
          verifyLlm: options.verifyLlm,
          media,
        }).then(value => {
          // 中断兜底：settle 即写入 sink 一份最小记录，不等整批屏障——否则并行批次里
          // 先完成的步骤在 SIGTERM 时会被当作"未完成"丢弃（产出和 token 白花）。
          // 批次收尾的完整 upsert 会按 id 覆盖这份记录。
          if (options.stepResultsSink && node.status !== 'skipped') {
            upsertStepResult(stepResults, {
              id: node.step.id,
              role: node.step.role,
              agentName: node.agentName,
              agentEmoji: node.agentEmoji,
              status: 'completed',
              output: value,
              output_var: node.step.output,
              acceptance: node.acceptance ?? node.step.acceptance,
              verification: node.verification,
              assertion: node.assertion,
              duration: Date.now() - (node.startTime || Date.now()),
              tokens: withPriorTokens(node.step.id, node.tokenUsage),
              imageAsset: node.imageAsset,
              videoAsset: node.videoAsset,
              audioAsset: node.audioAsset,
            });
          }
          return value;
        }))
      );

      // 处理结果
      for (let j = 0; j < batch.length; j++) {
        const node = batch[j];
        const result = results[j];

        if (result.status === 'fulfilled') {
          if (node.status === 'skipped') {
            // 条件不满足跳过
            markDownstreamSkipped(dag, node.step.id);
          } else {
            node.status = 'completed';
            node.result = result.value;
            if (node.step.output) {
              context.set(node.step.output, result.value);
            }
          }
        } else {
          node.status = 'failed';
          node.error = result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);
          // 标记所有下游为 skipped
          markDownstreamSkipped(dag, node.step.id);
        }

        node.endTime = Date.now();

        if (node.status === 'completed' || node.status === 'failed') {
          execCounts.set(node.step.id, (execCounts.get(node.step.id) || 0) + 1);
          tokenTotals.set(node.step.id, withPriorTokens(node.step.id, node.tokenUsage));
        }
        const runs = execCounts.get(node.step.id) || 0;
        upsertStepResult(stepResults, {
          id: node.step.id,
          role: node.step.role,
          agentName: node.agentName,
          agentEmoji: node.agentEmoji,
          status: node.status as StepResult['status'],
          output: node.result,
          output_var: node.step.output,
          acceptance: node.acceptance ?? node.step.acceptance,
          verification: node.verification,
          assertion: node.assertion,
          error: node.error,
          duration: (node.endTime || 0) - (node.startTime || 0),
          tokens: tokenTotals.get(node.step.id) || { input: 0, output: 0 },
          iterations: runs > 1 ? runs : undefined,
          imageAsset: node.imageAsset,
          videoAsset: node.videoAsset,
          audioAsset: node.audioAsset,
        });

        onStepComplete?.(node);
      }

      onBatchComplete?.(batch);
    }

    // 检查本层是否有需要循环的步骤
    let loopTriggered = false;
    for (const id of dag.levels[levelIndex]) {
      const node = dag.nodes.get(id)!;
      if (node.step.loop && node.status === 'completed') {
        const loop = node.step.loop;
        const currentIter = (loopIterations.get(id) || 0) + 1;

        // 检查退出条件（变量未定义等异常视为应退出，避免空耗 LLM 调用并崩溃）
        let shouldExit = true;
        try {
          shouldExit = evaluateCondition(loop.exit_condition, context);
        } catch {
          process.stderr.write(`\n  ⚠️  ${id} 循环退出条件评估失败: ${loop.exit_condition}，结束循环\n`);
        }
        const maxIter = Math.min(loop.max_iterations, 50); // 安全上限 50（防止无限循环）

        if (!shouldExit && currentIter < maxIter) {
          loopIterations.set(id, currentIter);
          context.set('_loop_iteration', String(currentIter + 1));

          // 找到 back_to 所在的 level index
          const backToLevel = dag.levels.findIndex(l => l.includes(loop.back_to));
          if (backToLevel < 0) {
            throw new Error(`loop.back_to "${loop.back_to}" 不在 DAG 层级中`);
          }

          // 只重置「循环体」：从 back_to 到当前循环节点之间、确实在依赖链上的节点
          // （= 循环节点的祖先 ∩ back_to 的后代，含两端）。
          // 不再重置同层但不在链上的并行旁支，避免它们被重复执行（含重复弹 human_input/approval）。
          const ancestorsOfLoop = new Set<string>([id]);
          const aStack = [id];
          while (aStack.length) {
            for (const dep of dag.nodes.get(aStack.pop()!)!.dependencies) {
              if (!ancestorsOfLoop.has(dep)) { ancestorsOfLoop.add(dep); aStack.push(dep); }
            }
          }
          const descendantsOfBackTo = new Set<string>([loop.back_to]);
          const dStack = [loop.back_to];
          while (dStack.length) {
            for (const dn of dag.nodes.get(dStack.pop()!)!.dependents) {
              if (!descendantsOfBackTo.has(dn)) { descendantsOfBackTo.add(dn); dStack.push(dn); }
            }
          }
          for (const nodeId of ancestorsOfLoop) {
            if (!descendantsOfBackTo.has(nodeId)) continue;
            const n = dag.nodes.get(nodeId)!;
            // resume 复用名单里的循环体步骤必须摘掉：调度时「复用」判定排在「pending」之前，
            // 不摘的话 `--resume last --from <循环步骤>` 回跳后循环体又被标成复用、根本不重跑——
            // 审稿步对着同一份旧稿审满 max_iterations 轮，白烧 token，最后报「循环达上限」。
            options.skipStepIds?.delete(nodeId);
            n.status = 'pending';
            n.result = undefined;
            n.error = undefined;
            n.startTime = undefined;
            n.endTime = undefined;
            n.tokenUsage = undefined;
            n.verification = undefined;
          }

          levelIndex = backToLevel;
          loopTriggered = true;
          break; // 只处理第一个循环触发
        } else {
          // 轮数用完而退出条件仍不满足：产出是最后一轮的，不代表「通过」——必须说出来，
          // 否则运行照样报成功，用户会把没过审的稿子当成过审的
          if (!shouldExit) {
            process.stderr.write(`\n  ⚠️  ${id} 循环已达上限 ${maxIter} 轮，退出条件仍未满足（${loop.exit_condition}）——产出是最后一轮的结果，没有通过该条件\n`);
            // 终端警告会被刷走、Studio 看不到：同时记进结果，随 metadata / summary 存档
            const loopResult = stepResults.find(s => s.id === id);
            if (loopResult) loopResult.loopExhausted = true;
          }
          // 循环结束：复位成 '1' 而不是删掉。validate 处处放行 {{_loop_iteration}}，删掉之后
          // 第二个循环的首轮、或循环之后任何引用它的步骤，都会在运行期报「模板变量未定义」
          context.set('_loop_iteration', '1');
        }
      }
    }

    if (!loopTriggered) {
      levelIndex++;
    }
  }

  const totalDuration = Date.now() - startTime;
  const totalTokens = stepResults.reduce(
    (acc, s) => ({
      input: acc.input + s.tokens.input,
      output: acc.output + s.tokens.output,
    }),
    { input: 0, output: 0 }
  );

  return {
    name: '',  // 由调用方填充
    success: stepResults.every(s => s.status !== 'failed'),
    steps: stepResults,
    totalDuration,
    totalTokens,
  };
}

/**
 * 按输入规模动态抬高"首次尝试"的超时：大输入（系统提示 + 渲染后的任务，含上游注入的
 * 长文本）往往意味着更长的处理/生成时间。与其让它第一次必超时、再靠 retry 把 timeout
 * x1.5 慢慢爬上来，不如一开始就给足，减少首跑失败——这对粘贴大段 PRD/文档的激活场景尤其重要。
 *
 * - 仅在用户未显式设置 timeout 时生效（显式值，含 0=不限时，原样尊重）。
 * - 在 provider 默认值之上叠加，单独设上限；retry 仍可在此基础上继续 x1.5。
 * @param defaultTimeout provider 默认超时 ms（API 120s / CLI·ollama 600s），0=不限时
 * @param inputChars 系统提示 + 用户消息的字符数
 */
export function dynamicInitialTimeout(defaultTimeout: number, inputChars: number): number {
  if (defaultTimeout <= 0) return defaultTimeout; // 0 / 负数 = 不限时，不动
  const PER_1K_MS = 8_000;       // 每 1K 字符输入额外 +8s
  const MAX_EXTRA_MS = 600_000;  // 动态部分最多 +10min（避免误注入超大文本时放飞）
  const extra = Math.min(Math.floor(Math.max(inputChars, 0) / 1000) * PER_1K_MS, MAX_EXTRA_MS);
  return defaultTimeout + extra;
}

/**
 * 步骤因超时/连接中断耗尽重试后，给用户可操作的修复指引（按 provider 定制）。
 * 把"streaming terminated / timeout"这种死胡同变成"下一步该怎么做"，是激活漏斗里
 * 用户决定去留的关键一刻。
 */
export function timeoutFailureHint(provider: string, opts?: { noContent?: boolean }): string {
  // 0 token / 停顿中断：provider 根本没开始响应。增大超时无效（已等过了），首推换 provider / 拆分 / 收窄输入。
  if (opts?.noContent) {
    const lines = [
      '',
      '  💡 provider 全程未返回任何内容（0 token）——多半是输入过大或服务端卡住，不是 AO 在等。',
      '     ⚠️ 增大超时无效（已等满仍是 0 token）。建议按顺序：',
      '     1. 换更稳的 provider/model：如本机已登录的 claude-code（零配置、扛长生成）',
      '     2. 拆分任务：把这步拆成多个更小的 step，每步输出更短',
      '     3. 收窄输入：只用 depends_on 引用必要的上游 output，别把全部上游灌进 task',
    ];
    if (provider === 'deepseek') {
      lines.push('     · DeepSeek 对超大输入/超长输出尤其容易卡死；换 provider 或拆细最有效');
    }
    return lines.join('\n');
  }
  const lines = [
    '',
    '  💡 该步骤因超时/连接中断失败。可尝试 / On timeout, try:',
    '     1. 增大超时：YAML 顶层或该 step 设 timeout（如 600s），或 --timeout 0 不限时',
    '     2. 拆分任务：把这步拆成多个更小的 step（每步输出更短，单步更快返回）',
    '     3. 换更稳的 provider/model',
  ];
  if (provider === 'deepseek') {
    lines.push('     · DeepSeek 长生成易被服务端中断；已默认流式，仍建议拆细任务或换 provider');
  }
  return lines.join('\n');
}

/**
 * 验收员用哪个模型、哪个 connector。优先级：步骤级 llm > 顶层 verify_llm / --verify-provider > 文本供应商。
 * 换了供应商就必须重建 connector（api_key / base_url 存在构造时的私有字段），且文本供应商的
 * base_url / api_key 不带过去（与 image.provider / video.provider 同一条规则）。
 */
function resolveJudge(
  node: DAGNode,
  opts: { connector?: LLMConnector; llmConfig: LLMConfig; verifyLlm?: Partial<LLMConfig> },
): { cfg: LLMConfig; connector: LLMConnector } {
  const stepLlm = node.step.llm;
  if (stepLlm) {
    const cfg = { ...opts.llmConfig, ...stepLlm } as LLMConfig;
    const needsNew = !opts.connector || !!(stepLlm.provider && stepLlm.provider !== opts.llmConfig.provider) || stepLlm.base_url !== undefined || stepLlm.api_key !== undefined;
    return { cfg, connector: needsNew ? createConnector(cfg) : opts.connector! };
  }
  if (opts.verifyLlm?.provider) {
    const sameProvider = opts.verifyLlm.provider === opts.llmConfig.provider;
    const cfg = {
      ...opts.llmConfig,
      ...(sameProvider ? {} : { base_url: undefined, api_key: undefined }),
      ...opts.verifyLlm,
    } as LLMConfig;
    const reuse = sameProvider && !!opts.connector && opts.verifyLlm.base_url === undefined && opts.verifyLlm.api_key === undefined;
    return { cfg, connector: reuse ? opts.connector! : createConnector(cfg) };
  }
  // 纯媒体工作流没有文本 connector（opts.connector 为空）——验收员按文本供应商配置现建一个
  if (!opts.connector) return { cfg: opts.llmConfig, connector: createConnector(opts.llmConfig) };
  return { cfg: opts.llmConfig, connector: opts.connector };
}

async function executeStep(
  node: DAGNode,
  opts: {
    connector: LLMConnector;
    agentsDir: string;
    llmConfig: LLMConfig;
    context: Map<string, string>;
    timeout: number;
    maxRetry: number;
    onStepStart?: (node: DAGNode) => void;
    feedback?: { stepId: string; text: string; previousOutput?: string };
    verify?: boolean;
    verifyLlm?: Partial<LLMConfig>;
    media: MediaRegistry;
  }
): Promise<string> {
  node.status = 'running';
  node.startTime = Date.now();
  opts.onStepStart?.(node);

  // 条件检查（变量未定义等异常视为条件不满足，跳过而非崩溃）
  if (node.step.condition) {
    let conditionMet = false;
    try {
      conditionMet = evaluateCondition(node.step.condition, opts.context);
    } catch {
      process.stderr.write(`\n  ⚠️  ${node.step.id} 条件评估失败: ${node.step.condition}，跳过该步骤\n`);
    }
    if (!conditionMet) {
      node.status = 'skipped';
      return '';  // 返回空，调用方会处理 skipped 状态
    }
  }

  // 人工审批节点
  if (node.step.type === 'approval') {
    return await handleApproval(node, opts.context);
  }

  // 人工输入节点：跑到这步暂停、读取用户输入，作为该步产出注入下游
  if (node.step.type === 'human_input') {
    return await handleHumanInput(node, opts.context);
  }

  // 文生图节点：task 就是图片提示词（{{变量}} 照常渲染，上游文字产出可直接流进来）。
  // 产出 = markdown 图片引用（assets/<id>.png），变量值也是这串 —— 下游文本步骤引用它时
  // 模型能看懂"这里有张图"，报告与 Studio 则按路径把图渲染出来。
  if (node.step.type === 'image') {
    node.agentName = node.step.name || '文生图';
    node.agentEmoji = node.step.emoji || '🎨';
    let prompt = renderTemplate(node.step.task, opts.context);
    if (!prompt.trim()) {
      // 空提示词发出去只会拿回厂商的 400（"prompt is required"），或更糟：真出一条空片。上游变量为空就在这里说清。
      throw new Error(`${node.step.id}：提示词为空——上游步骤没有产出（检查 task 里引用的变量是否来自失败/空输出的步骤）`);
    }
    // --feedback 打在媒体步骤上：生成模型没有"上一版可改"，意见只能变成提示词末尾的硬约束
    //（与验收重出同一套拼法）。此前这里根本不看 opts.feedback——用户在 Studio 对出图步"提意见重做"，意见被静默丢掉、原样再出一张。
    if (opts.feedback && opts.feedback.stepId === node.step.id && opts.feedback.text.trim()) {
      prompt = buildImageReworkPrompt(prompt, [{ criterion: opts.feedback.text.trim(), why: '' }]);
      process.stderr.write(`  ✎ ${node.step.id} 带着你的意见重出：${opts.feedback.text.trim().slice(0, 60)}\n`);
    }
    const stepLlmImg = node.step.llm;
    const imgConfig = (stepLlmImg ? { ...opts.llmConfig, ...stepLlmImg } : opts.llmConfig) as LLMConfig;
    // image.model 也过变量渲染：内置模板不能替用户猜图片模型名（各家编码互不通用），
    // 写成 model: "{{image_model}}" + 必填 input，把选择权明示地交给用户
    // 所有字符串字段都过变量渲染，不只是 model：模板把 size 之类做成输入是合理的，
    // 漏渲染就会把 "{{image_size}}" 原样发给厂商（video 那边真踩过这个坑，见下）
    const imageOpts = { ...(node.step.image ?? {}) };
    for (const k of ['provider', 'model', 'size', 'quality', 'background'] as const) {
      const v = imageOpts[k];
      if (typeof v === 'string') imageOpts[k] = renderTemplate(v, opts.context);
    }
    const log = (m: string) => process.stderr.write(`  ${m}\n`);
    let img = await generateImage(imgConfig, prompt, imageOpts, log);

    // 图片验收：让能看图的文本模型对着**成品图**逐条核对 acceptance，未过 → 带着未满足项重出一张
    // （再花一张图的钱，日志里说清）→ 复核。与文本步骤同一套口径与三级开关（--verify / 顶层 verify / step.verify）。
    // 验收不过是质量信号：步骤不失败，产物带 ⚠️ 照常流向下游。
    if (node.step.acceptance) {
      node.acceptance = renderTemplate(node.step.acceptance, opts.context);
      const verifyEnabled = opts.verify === true && node.step.verify !== false;
      if (verifyEnabled) {
        const { cfg: judgeCfg, connector: judge } = resolveJudge(node, opts);
        if (!canSeeImages(judgeCfg.provider)) {
          process.stderr.write(`  ⚠️  ${node.step.id} 写了 acceptance，但文本供应商 ${judgeCfg.provider} 看不了图（CLI/本地连接器会剥掉图片），已跳过图片验收——要验收请换支持 vision 的 API 供应商与模型\n`);
        } else {
          const tokens = { input: 0, output: 0 };
          const add = (t: { input: number; output: number }) => { tokens.input += t.input; tokens.output += t.output; node.tokenUsage = { ...tokens }; };
          const dataUri = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`;
          const c1 = await verifyImageAcceptance(judge, judgeCfg, prompt, dataUri(img.buffer), node.acceptance);
          add(c1.tokens);
          if (!c1.verdict) {
            process.stderr.write(`  ⚠️  ${node.step.id} 图片验收不可用，已跳过验收${c1.reason ? `：${c1.reason}` : '（模型不支持看图或核验出错）'}\n`);
          } else if (c1.verdict.pass) {
            node.verification = { pass: true, failed: [], reworked: false };
          } else {
            const failed1 = formatFailedItems(c1.verdict.failed);
            process.stderr.write(`\n  ⟳ ${node.step.id} 图片验收未过（${failed1.length} 条未满足），带着未满足项重出一张（再花一张图的钱）...\n`);
            failed1.forEach((f) => process.stderr.write(`      · ${f}\n`));
            try {
              const img2 = await generateImage(imgConfig, buildImageReworkPrompt(prompt, c1.verdict.failed), imageOpts, log);
              const c2 = await verifyImageAcceptance(judge, judgeCfg, prompt, dataUri(img2.buffer), node.acceptance);
              add(c2.tokens);
              if (c2.verdict?.pass) {
                node.verification = { pass: true, failed: [], reworked: true };
                img = img2;
              } else if (c2.verdict) {
                // 两版都没过：交付第二版（它至少针对了未满足项），如实标未通过
                node.verification = { pass: false, failed: formatFailedItems(c2.verdict.failed), reworked: true };
                img = img2;
                process.stderr.write(`\n  ⚠️  ${node.step.id} 重出后仍有 ${c2.verdict.failed.length} 条未满足\n`);
              } else {
                node.verification = { pass: false, failed: failed1, reworked: true };
                img = img2;
                process.stderr.write(`\n  ⚠️  ${node.step.id} 重出后复核不可用，验收状态按未通过记录\n`);
              }
            } catch (err) {
              // 重出失败 → 保留第一版：质检加严绝不能反过来搞挂本已成功的步骤
              const msg = err instanceof Error ? err.message.slice(0, 80) : String(err);
              process.stderr.write(`\n  ⚠️  ${node.step.id} 重出失败（${msg}），保留第一版图片\n`);
              node.verification = { pass: false, failed: failed1, reworked: false };
            }
          }
        }
      }
    }

    const filename = `${node.step.id}.png`;
    node.imageAsset = { filename, base64: img.buffer.toString('base64') };
    // 登记本次运行产出的图片：图生视频步骤用 {{cover_img}}（markdown 引用 assets/<id>.png）时从这里拿字节——
    // 产物要到运行结束才落盘，运行中磁盘上还没有
    registerMedia(opts.media, 'images', filename, img.buffer);
    const kb = (img.buffer.length / 1024).toFixed(0);
    process.stderr.write(`  🎨 ${node.step.id} 生成图片 ${filename}（${kb}KB，${img.via === 'images-api' ? 'Images API' : 'Responses 工具'}）\n`);
    return `![${node.step.id}](assets/${filename})`;
  }

  // 文生视频节点：与文生图同构，区别是**异步任务**——建任务、轮询、下载，一次几十秒到几分钟。
  // 产出 = markdown 链接（assets/<id>.mp4）；Studio 与分享报告按扩展名渲染成播放器。
  if (node.step.type === 'video') {
    node.agentName = node.step.name || '文生视频';
    node.agentEmoji = node.step.emoji || '🎬';
    let prompt = renderTemplate(node.step.task, opts.context);
    if (!prompt.trim()) {
      // 空提示词发出去只会拿回厂商的 400（"prompt is required"），或更糟：真出一条空片。上游变量为空就在这里说清。
      throw new Error(`${node.step.id}：提示词为空——上游步骤没有产出（检查 task 里引用的变量是否来自失败/空输出的步骤）`);
    }
    if (opts.feedback && opts.feedback.stepId === node.step.id && opts.feedback.text.trim()) {
      // 同 image：意见 → 提示词末尾硬约束。视频按秒真钱，用户点了重出就是明示要再付一条
      prompt = buildImageReworkPrompt(prompt, [{ criterion: opts.feedback.text.trim(), why: '' }]);
      process.stderr.write(`  ✎ ${node.step.id} 带着你的意见重出：${opts.feedback.text.trim().slice(0, 60)}\n`);
    }
    const stepLlmVid = node.step.llm;
    const vidConfig = (stepLlmVid ? { ...opts.llmConfig, ...stepLlmVid } : opts.llmConfig) as LLMConfig;
    const videoOpts = { ...(node.step.video ?? {}) } as VideoStepOptions;
    // **provider 也必须渲染**，不只是 model：内置模板「一句话出短片」把供应商做成必填输入
    // （video: { provider: "{{video_provider}}" }），此前只渲染 model，于是引擎拿着字面量
    //  "{{video_provider}}" 去查视频供应商表，报"当前 provider {{video_provider}} 不是视频供应商"
    //  —— 真机跑模板时当场撞到。resolution / ratio 同理。
    for (const k of ['provider', 'model', 'resolution', 'ratio', 'image'] as const) {
      const v = videoOpts[k];
      if (typeof v === 'string') videoOpts[k] = renderTemplate(v, opts.context);
    }
    // 首帧图：上游图片步骤的输出（markdown `![id](assets/id.png)`）→ 本次运行的产物登记；本地路径 → 读文件；
    // 公网 URL 原样交给连接器；空串（可选输入没填）= 纯文生视频
    if (typeof videoOpts.image === 'string') {
      const ref = videoOpts.image.trim();
      if (!ref) delete videoOpts.image;
      else if (!/^https?:\/\//.test(ref)) {
        const m = ref.match(/!\[[^\]]*\]\(([^)]+)\)/);
        const target = (m ? m[1] : ref).trim();
        const name = target.split('/').pop() || target;
        const bytes = opts.media.images.get(name) ?? (existsSync(target) ? readFileSync(target) : undefined);
        if (!bytes) throw new Error(`video.image 找不到图片：${ref.slice(0, 120)}（上游图片步骤没产出？或本地路径不存在）`);
        videoOpts.image_bytes = bytes;
        videoOpts.image_name = name;
      }
    }
    // duration 是数字字段，但模板把它做成输入后 YAML 里就是字符串 "{{video_duration}}"。
    // 不在这儿渲染+转数，就会把那串花括号原样发给厂商——参数非法、一次调用白费。
    // 转不出正数就当场报错：视频按秒计费，"0 秒"或"NaN 秒"发出去只会拿回一个看不懂的厂商错误。
    if (typeof (videoOpts as { duration?: unknown }).duration === 'string') {
      const raw = renderTemplate(String(videoOpts.duration), opts.context);
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`video.duration 需要一个正数秒数，渲染后得到 "${raw}"（检查输入是否填了、或写成了非数字）`);
      }
      videoOpts.duration = n;
    }
    const vlog = (m: string) => process.stderr.write(`  ${m}\n`);
    let vid = await generateVideo(vidConfig, prompt, videoOpts, vlog);

    // 视频验收：抽 3 帧（开头/中段/结尾）交给能看图的文本模型逐条核对。与图片验收的差别只有一个：
    // **默认只审不重出**——视频按秒真钱，重出 = 再付一整条，得作者写 video.rework: true 明示。
    // 静帧判不了运动与声音，标准只该写画面里看得见的硬条件（文档里说了）。
    if (node.step.acceptance) {
      node.acceptance = renderTemplate(node.step.acceptance, opts.context);
      const verifyEnabled = opts.verify === true && node.step.verify !== false;
      if (verifyEnabled) {
        const { cfg: judgeCfg, connector: judge } = resolveJudge(node, opts);
        const tokens = { input: 0, output: 0 };
        const add = (t: { input: number; output: number }) => { tokens.input += t.input; tokens.output += t.output; node.tokenUsage = { ...tokens }; };
        const judgeClip = async (buf: Buffer) => {
          const fr = await extractFrames(buf, 3);
          return verifyVisualAcceptance(judge, judgeCfg, prompt, fr.frames.map(jpegDataUri), node.acceptance!, 'video');
        };
        if (!canSeeImages(judgeCfg.provider)) {
          process.stderr.write(`  ⚠️  ${node.step.id} 写了 acceptance，但文本供应商 ${judgeCfg.provider} 看不了图（CLI/本地连接器会剥掉图片），已跳过视频验收\n`);
        } else {
          let c1: Awaited<ReturnType<typeof judgeClip>> | null = null;
          try { c1 = await judgeClip(vid.buffer); } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            process.stderr.write(`  ⚠️  ${node.step.id} 抽帧失败，已跳过视频验收：${err instanceof FfmpegMissingError ? msg : msg.slice(0, 160)}\n`);
          }
          if (c1) {
            add(c1.tokens);
            if (!c1.verdict) {
              process.stderr.write(`  ⚠️  ${node.step.id} 视频验收不可用，已跳过验收${c1.reason ? `：${c1.reason}` : '（模型不支持看图或核验出错）'}\n`);
            } else if (c1.verdict.pass) {
              node.verification = { pass: true, failed: [], reworked: false };
            } else {
              const failed1 = formatFailedItems(c1.verdict.failed);
              if (!videoOpts.rework) {
                node.verification = { pass: false, failed: failed1, reworked: false };
                process.stderr.write(`\n  ⚠️  ${node.step.id} 视频验收未过（${failed1.length} 条未满足）。按秒计费，默认不重出——要自动重出请写 video.rework: true，或看完片后 --resume --from ${node.step.id}\n`);
                failed1.forEach((f) => process.stderr.write(`      · ${f}\n`));
              } else {
                process.stderr.write(`\n  ⟳ ${node.step.id} 视频验收未过（${failed1.length} 条未满足），video.rework 已开：带着未满足项重出一条（再付一整条的钱）...\n`);
                failed1.forEach((f) => process.stderr.write(`      · ${f}\n`));
                try {
                  const vid2 = await generateVideo(vidConfig, buildImageReworkPrompt(prompt, c1.verdict.failed), videoOpts, vlog);
                  let c2: Awaited<ReturnType<typeof judgeClip>> | null = null;
                  try { c2 = await judgeClip(vid2.buffer); } catch { /* 抽帧失败 → 复核不可用 */ }
                  if (c2) add(c2.tokens);
                  vid = vid2;
                  if (c2?.verdict?.pass) {
                    node.verification = { pass: true, failed: [], reworked: true };
                  } else if (c2?.verdict) {
                    node.verification = { pass: false, failed: formatFailedItems(c2.verdict.failed), reworked: true };
                    process.stderr.write(`\n  ⚠️  ${node.step.id} 重出后仍有 ${c2.verdict.failed.length} 条未满足\n`);
                  } else {
                    node.verification = { pass: false, failed: failed1, reworked: true };
                    process.stderr.write(`\n  ⚠️  ${node.step.id} 重出后复核不可用，验收状态按未通过记录\n`);
                  }
                } catch (err) {
                  const msg = err instanceof Error ? err.message.slice(0, 80) : String(err);
                  process.stderr.write(`\n  ⚠️  ${node.step.id} 重出失败（${msg}），保留第一条\n`);
                  node.verification = { pass: false, failed: failed1, reworked: false };
                }
              }
            }
          }
        }
      }
    }

    const filename = `${node.step.id}.mp4`;
    node.videoAsset = { filename, base64: vid.buffer.toString('base64'), ...(vid.seconds ? { seconds: vid.seconds } : {}) };
    registerMedia(opts.media, 'videos', filename, vid.buffer);
    const mb = (vid.buffer.length / 1024 / 1024).toFixed(1);
    process.stderr.write(`  🎬 ${node.step.id} 生成视频 ${filename}（${mb}MB${vid.seconds ? `，计费 ${vid.seconds}s` : ''}）\n`);
    return `[▶ ${node.step.id}.mp4](assets/${filename})`;
  }

  // 配音节点：task 就是要念的文案（{{变量}} 照常渲染，上游写好的旁白直接流进来）。
  // 产出 = markdown 音频链接（assets/<id>.mp3）；下游 concat 的 voiceover 引用它。
  if (node.step.type === 'tts') {
    node.agentName = node.step.name || '配音';
    node.agentEmoji = node.step.emoji || '🎙';
    const text = renderTemplate(node.step.task, opts.context);
    if (!text.trim()) {
      throw new Error(`${node.step.id}：配音文案为空——上游步骤没有产出（检查 task 里引用的变量是否来自失败/空输出的步骤）`);
    }
    const stepLlmTts = node.step.llm;
    const ttsConfig = (stepLlmTts ? { ...opts.llmConfig, ...stepLlmTts } : opts.llmConfig) as LLMConfig;
    const ttsOpts = { ...(node.step.tts ?? {}) } as TtsStepOptions;
    // 与图片/视频同理：模板把供应商/模型/音色做成必填输入，字符串字段全部要渲染，
    // 漏一个就会把 "{{tts_voice}}" 原样发给厂商，换回一句看不懂的 400
    for (const k of ['provider', 'model', 'voice', 'format', 'instructions'] as const) {
      const v = ttsOpts[k];
      if (typeof v === 'string') ttsOpts[k] = renderTemplate(v, opts.context);
    }
    if (typeof (ttsOpts as { speed?: unknown }).speed === 'string') {
      const raw = renderTemplate(String(ttsOpts.speed), opts.context).trim();
      if (!raw) delete ttsOpts.speed;
      else {
        const n = Number(raw);
        if (!Number.isFinite(n) || n <= 0) throw new Error(`tts.speed 需要一个正数，渲染后得到 "${raw}"`);
        ttsOpts.speed = n;
      }
    }
    const speech = await generateSpeech(ttsConfig, text, ttsOpts, (m: string) => process.stderr.write(`  ${m}\n`));
    const filename = `${node.step.id}.${speech.ext}`;
    node.audioAsset = { filename, base64: speech.buffer.toString('base64') };
    registerMedia(opts.media, 'audios', filename, speech.buffer);
    const kb = (speech.buffer.length / 1024).toFixed(0);
    process.stderr.write(`  🎙 ${node.step.id} 生成配音 ${filename}（${kb}KB，${ttsOpts.voice}）\n`);
    return `[🔊 ${filename}](assets/${filename})`;
  }

  // 合成节点：把上游多段 mp4 按顺序拼成一条（短剧流水线的三镜合一）。不花厂商的钱，只用本机 ffmpeg。
  if (node.step.type === 'concat') {
    node.agentName = node.step.name || '合成';
    node.agentEmoji = node.step.emoji || '🎞';
    // 渲染后为空 = 上游那一镜没产出（失败/跳过）。**不能静默丢掉**：
    // 悄悄少拼一镜会交付一条"看起来正常"的两镜成片，而三镜的钱已经花了。
    const rawRefs = (node.step.concat?.inputs ?? []);
    const refs = rawRefs.map((r) => renderTemplate(r, opts.context).trim());
    const missing = refs.map((v, i) => (v ? null : rawRefs[i])).filter(Boolean);
    if (missing.length) {
      throw new Error(
        `concat 的第 ${refs.findIndex((v) => !v) + 1} 段没有内容：${missing.join('、')} 渲染后为空——` +
        `上游那一步失败或被跳过了。少拼一段不会自动放行：三镜的钱已经花了，交付一条缺镜的成片比报错更贵。`
      );
    }
    const inputs = refs.map((ref) => {
      const m = ref.match(/\[[^\]]*\]\(([^)]+)\)/);
      const target = (m ? m[1] : ref).trim();
      const name = target.split('/').pop() || target;
      const buffer = opts.media.videos.get(name) ?? (existsSync(target) ? readFileSync(target) : undefined);
      if (!buffer) throw new Error(`concat 找不到视频：${ref.slice(0, 120)}（上游视频步骤没产出？或本地路径不存在）`);
      return { name, buffer };
    });
    // 配音：上游 tts 步骤的输出（markdown 链接）→ 本次运行的产物登记；本地路径 → 读文件；空串 = 这段不配音
    const resolveAudio = (ref: string, what: string): { name: string; buffer: Buffer } | null => {
      const t = ref.trim();
      if (!t) return null;
      const m = t.match(/\[[^\]]*\]\(([^)]+)\)/);
      const target = (m ? m[1] : t).trim();
      const name = target.split('/').pop() || target;
      const buffer = opts.media.audios.get(name) ?? (existsSync(target) ? readFileSync(target) : undefined);
      if (!buffer) throw new Error(`concat.${what} 找不到音频：${t.slice(0, 120)}（上游 tts 步骤没产出？或本地路径不存在）`);
      return { name, buffer };
    };
    const voRefs = node.step.concat?.voiceover;
    const voiceover = voRefs
      ? voRefs.map((r) => resolveAudio(renderTemplate(r, opts.context), 'voiceover'))
      : undefined;
    const bgmRef = node.step.concat?.bgm ? renderTemplate(node.step.concat.bgm, opts.context) : '';
    const bgm = bgmRef.trim() ? resolveAudio(bgmRef, 'bgm') ?? undefined : undefined;
    const subtitles = node.step.concat?.subtitles?.map((x) => renderTemplate(x, opts.context));
    const out = await concatVideos(inputs, {
      size: node.step.concat?.size,
      fps: node.step.concat?.fps,
      ...(voiceover ? { voiceover } : {}),
      ...(node.step.concat?.voice_volume !== undefined ? { voice_volume: node.step.concat.voice_volume } : {}),
      ...(node.step.concat?.clip_volume !== undefined ? { clip_volume: node.step.concat.clip_volume } : {}),
      ...(subtitles ? { subtitles } : {}),
      ...(node.step.concat?.subtitle_style ? { subtitle_style: node.step.concat.subtitle_style } : {}),
      ...(bgm ? { bgm } : {}),
      ...(node.step.concat?.bgm_volume !== undefined ? { bgm_volume: node.step.concat.bgm_volume } : {}),
    }, (m: string) => process.stderr.write(`  ${m}\n`));
    const filename = `${node.step.id}.mp4`;
    node.videoAsset = { filename, base64: out.toString('base64') };
    registerMedia(opts.media, 'videos', filename, out);
    process.stderr.write(`  🎞 ${node.step.id} 合成 ${inputs.length} 段 → ${filename}（${(out.length / 1024 / 1024).toFixed(1)}MB）\n`);
    return `[▶ ${node.step.id}.mp4](assets/${filename})`;
  }

  // 加载角色定义（步骤级 name/emoji 优先）
  const agent = loadAgent(opts.agentsDir, node.step.role);
  node.agentName = node.step.name || agent.name;
  node.agentEmoji = node.step.emoji || agent.emoji;
  let systemPrompt = agent.systemPrompt;

  // 给本步挂 skill（流程剧本）→ 把方法论注入 system prompt 末尾。可选增强，缺失则跳过、不报错。
  const skillNames = collectSkillNames(node.step);
  if (skillNames.length) {
    const inj = injectSkills(systemPrompt, skillNames);
    systemPrompt = inj.prompt;
    if (inj.applied.length) process.stderr.write(`  🧠 ${node.step.id} 挂载 skill: ${inj.applied.join(', ')}\n`);
    if (inj.missing.length) process.stderr.write(`  ⚠️ 找不到 skill（已跳过）: ${inj.missing.join(', ')}\n`);
  }

  // 渲染任务模板
  let userMessage = renderTemplate(node.step.task, opts.context);
  // 渲染后的纯任务描述（不含反馈块/验收尾巴），验收核验时给验收员当"任务"上下文
  const renderedTask = userMessage;

  // 对话式返工：若本步是反馈目标，把"上一版产出 + 用户意见"追加到任务后，
  // 引导专家在原稿基础上按意见修改，而不是从零重写。
  if (opts.feedback && opts.feedback.stepId === node.step.id && opts.feedback.text.trim()) {
    userMessage += buildFeedbackBlock(opts.feedback.text, opts.feedback.previousOutput);
  }

  // 验收标准：追加在任务最末（含反馈块之后），让"产出必须满足什么"是模型看到的最后指令。
  // 渲染后的文本存回 node，随 StepResult 进 metadata（查看器展示 / 盲评锚点用同一份文本）。
  if (node.step.acceptance) {
    const acc = renderTemplate(node.step.acceptance, opts.context);
    node.acceptance = acc;
    const zh = /[一-鿿]/.test(acc);
    userMessage += zh
      ? `\n\n⚠️ 交付验收标准——产出必须全部满足以下条件，交付前逐条自检：\n${acc}`
      : `\n\nAcceptance criteria — the deliverable MUST satisfy ALL of the following (self-check before delivering):\n${acc}`;
  }

  // 步骤级 LLM 配置覆盖
  const stepLlm = node.step.llm;
  const effectiveConfig: LLMConfig = stepLlm
    ? { ...opts.llmConfig, ...stepLlm } as LLMConfig
    : opts.llmConfig;
  // connector 把 api_key / base_url 存在构造时的私有字段，chat(config) 不会再读
  // 所以 step 级覆盖任一凭证字段时必须重建 connector
  const needsNewConnector = !!(stepLlm && (
    (stepLlm.provider && stepLlm.provider !== opts.llmConfig.provider) ||
    stepLlm.base_url !== undefined ||
    stepLlm.api_key !== undefined
  ));
  const effectiveConnector = needsNewConnector ? createConnector(effectiveConfig) : opts.connector;

  // timeout / retry / CLI 判定必须基于 effectiveConfig，否则 step 级覆盖这几个字段时会被全局值吃掉
  const effectiveIsCLI = effectiveConfig.provider.endsWith('-cli') || effectiveConfig.provider === 'claude-code';
  const effectiveIsLocal = effectiveConfig.provider === 'ollama';
  // timeout 策略：
  // - 用户显式设置（含 timeout: 0 表示不限时）→ 第一次按此值，不做动态调整
  // - 未设置 → provider 默认（API 120s / CLI/ollama 600s），再按输入规模动态抬高首次超时
  //   （dynamicInitialTimeout：大输入一开始就给足，少一次必然的首跑超时）
  // - 因超时触发 retry 时，下一轮 timeout x1.5（上限 3600s / 60min）
  //   非超时类错误（429/500/ECONNRESET 等）保持原 timeout，避免无谓放大
  // - 上限是防误配置放飞的保险丝（retry 10 次可能放大到几十小时），
  //   真要超过 1 小时单步请用 timeout: 0 / --timeout 0 完全不限时
  const defaultTimeout = effectiveIsCLI ? 600_000 : effectiveIsLocal ? 600_000 : 120_000;
  const effectiveMaxRetry = effectiveConfig.retry ?? opts.maxRetry;
  const TIMEOUT_CAP = 3_600_000;

  // token 跨调用累加（验收返工会二次生成，核验本身也计入本步成本）
  const tokenTotal = { input: 0, output: 0 };
  const addTokens = (t: { input: number; output: number }): void => {
    tokenTotal.input += t.input;
    tokenTotal.output += t.output;
    node.tokenUsage = { ...tokenTotal };
  };

  // 带重试的 LLM 调用（timeout 在网络超时类错误重试时自动延长）。
  // 抽成局部函数：验收返工的二次生成走同一套 retry/timeout/兜底策略。
  const callLLM = async (message: string): Promise<string> => {
    let lastError: Error | null = null;
    let attemptTimeout = effectiveConfig.timeout !== undefined
      ? effectiveConfig.timeout
      : dynamicInitialTimeout(defaultTimeout, systemPrompt.length + message.length);
    // 系统睡眠（合盖 / 自动睡眠）：本步期间一共睡了多久、因睡眠立即重试过几次。
    // 睡眠打断的尝试不占 retry 名额、不放宽 timeout；封顶是防整夜"睡—暗唤醒—再睡"反复空转。
    let sleptTotalMs = 0;
    let sleepRetries = 0;
    const MAX_SLEEP_RETRIES = 3;
    const sleepRetryDelay = Number(process.env.AO_SLEEP_RETRY_DELAY_MS) || 2_000;
    for (let attempt = 0; attempt <= effectiveMaxRetry; attempt++) {
      let sleepWatch: SleepWatch | null = null;
      try {
        // attemptTimeout 同时传给 connector（控制内层 fetch/CLI timeout）和 withTimeout（外层兜底），
        // 否则 connector 内部还按旧 timeout 硬断，递增就白加了
        const attemptConfig = { ...effectiveConfig, timeout: attemptTimeout };
        // 这次尝试期间一旦检测到系统睡过，立刻结束等待：连接大概率已被冻断，干等只会等满超时。
        // 注意被放弃的那次 chat 不会被取消（connector 接口没有 signal），CLI 子进程由它自己的超时收尾。
        let rejectOnSleep: (e: Error) => void = () => {};
        const sleepAbort = new Promise<never>((_, reject) => { rejectOnSleep = reject; });
        sleepAbort.catch(() => {});
        sleepWatch = startSleepWatch((sleptMs) => {
          sleptTotalMs += sleptMs;
          const e = new Error(`系统睡眠打断了这次调用（睡了约 ${Math.round(sleptMs / 1000)}s），连接大概率已断`);
          (e as { sleepInterrupted?: boolean }).sleepInterrupted = true;
          rejectOnSleep(e);
        });
        const result = await Promise.race([
          withTimeout(effectiveConnector.chat(systemPrompt, message, attemptConfig), attemptTimeout),
          sleepAbort,
        ]);
        addTokens({ input: result.usage.input_tokens, output: result.usage.output_tokens });
        if (!result.content.trim()) {
          // 空正文不是成功：下游拿空变量只会产出更离谱的东西（连接器层已拦 OpenAI 兼容，这里兜住 claude / CLI 等）
          const e = new Error(`${node.step.id}：模型返回空内容（provider ${effectiveConfig.provider}，model ${effectiveConfig.model || '默认'}）。换模型或关闭 thinking 后重试。`);
          (e as { noRetry?: boolean }).noRetry = true;
          throw e;
        }
        return result.content;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if ((lastError as { sleepInterrupted?: boolean }).sleepInterrupted) {
          if (sleepRetries < MAX_SLEEP_RETRIES) {
            sleepRetries++;
            process.stderr.write(`\n  💤 ${node.step.id} ${lastError.message}，醒来立即重试（不占重试次数、不放宽超时）(${sleepRetries}/${MAX_SLEEP_RETRIES})...\n`);
            attempt--;
            await sleep(sleepRetryDelay);
            continue;
          }
          // 反复睡醒（整夜合盖的形态）：别再按"超时"放宽重试白等几十分钟，直接失败，留给醒着时 --resume
          break;
        }
        if (attempt < effectiveMaxRetry && isRetryable(lastError) && !(lastError as { noRetry?: boolean }).noRetry) {
          const errorClass = classifyError(lastError);
          // connection 类错误（超时/ECONNRESET/aborted/socket hang up 等）→ 下一次 timeout x1.5
          // 上限 900s，0=不限时保持不变，rate_limit / server_error 保持原值避免无谓放大
          let nextTimeout = attemptTimeout;
          if (errorClass === 'connection' && attemptTimeout > 0 && attemptTimeout < TIMEOUT_CAP) {
            nextTimeout = Math.min(Math.round(attemptTimeout * 1.5), TIMEOUT_CAP);
          }
          // 分级退避：rate_limit 最长，connection 中等，server_error 最短
          const baseByClass = effectiveIsCLI
            ? { rate_limit: 15_000, connection: 10_000, server_error: 5_000 }
            : { rate_limit: 5_000,  connection: 2_000,  server_error: 1_000 };
          const base = baseByClass[errorClass as keyof typeof baseByClass] || 1_000;
          const jitter = Math.random() * 0.3;  // 0-30% 抖动，防止并发步骤同时重试
          const delay = Math.round(base * Math.pow(2, attempt) * (1 + jitter));
          const extendHint = nextTimeout !== attemptTimeout
            ? `（timeout 延长至 ${Math.round(nextTimeout / 1000)}s）`
            : '';
          process.stderr.write(`\n  ⚠️  ${node.step.id} 失败 (${lastError.message.slice(0, 80)})，${Math.round(delay / 1000)}s 后重试${extendHint} (${attempt + 1}/${effectiveMaxRetry})...\n`);
          attemptTimeout = nextTimeout;
          await sleep(delay);
          continue;
        }
        break;  // 不可重试的错误，立即停止
      } finally {
        sleepWatch?.stop();
      }
    }

    // 重试全部耗尽：检查是否有部分内容可兜底
    if (lastError && (lastError as any).partialContent) {
      const partial = (lastError as any).partialContent as string;
      process.stderr.write(`\n  ⚠️  ${node.step.id} 重试耗尽，使用部分结果 (${partial.length} 字符)\n`);
      return partial;
    }

    // 本步执行期间系统睡过：失败根因是睡眠冻住了连接，不是模型慢——此时"增大超时"是错误的建议，换成睡眠说明。
    // 否则：超时/连接类失败，在错误信息后附上可操作指引（基于 effectiveConfig.provider）
    if (lastError && sleptTotalMs > 0) {
      lastError.message += sleepFailureHint(sleptTotalMs);
    } else if (lastError && classifyError(lastError) === 'connection') {
      const noContent = !!(lastError as any).noContent || !!(lastError as any).stalled;
      lastError.message += timeoutFailureHint(effectiveConfig.provider, { noContent });
    }
    throw lastError || new Error(`step "${node.step.id}" 执行失败`);
  };

  let content = await callLLM(userMessage);

  // ── 机械断言（core/assert.ts）。**必须排在 acceptance 之前**：
  //    结构都不合格，没必要再花 token 让模型评内容好不好。
  //    与 acceptance 的关键差别：这里不过 = 步骤**失败**，不是质量信号。
  //    理由是这类问题的破坏方式不同——少一个文件不会让下游报错，它会让下游
  //    拿着缺件的产物一路绿灯跑完。带 ⚠️ 放行等于把静默损坏留给下一环。
  if (node.step.assert) {
    // min_chars / max_chars 可以是 "{{length}} * 0.7" 这种带变量的写法——先按本次输入算成数字
    const assertSpec = resolveAssert(node.step.assert, opts.context, (m) => process.stderr.write(`  ⚠️  ${node.step.id} ${m}\n`));
    const first = checkAssert(content, assertSpec);
    node.assertion = { pass: true, failed: [], reworked: false };
    if (!first.pass) {
      process.stderr.write(`\n  ⟳ ${node.step.id} 机械断言未过（${first.failures.length} 条），定向返工一轮...\n`);
      first.failures.forEach((f) => process.stderr.write(`      · ${f}\n`));
      let retried: string;
      try {
        retried = await callLLM(userMessage + buildAssertReworkBlock(first.failures));
      } catch (err) {
        const msg = err instanceof Error ? err.message.slice(0, 80) : String(err);
        throw new Error(`step "${node.step.id}" 机械断言未过且返工生成失败（${msg}）：\n  - ${first.failures.join('\n  - ')}`);
      }
      const second = checkAssert(retried, assertSpec);
      node.assertion = { pass: second.pass, failed: second.pass ? [] : second.failures, reworked: true };
      if (!second.pass) {
        // 到这里就停。宁可让这一步红着，也不能让缺件的产物流下去——
        // 静默损坏比失败贵得多：失败当场就知道，缺件要等上线后才发现。
        throw new Error(`step "${node.step.id}" 机械断言两次未过：\n  - ${second.failures.join('\n  - ')}`);
      }
      process.stderr.write(`  ✅ ${node.step.id} 返工后机械断言通过\n`);
      content = retried;
    }
  }

  // acceptance 自动核验 + 一轮自动返工。验收不过是质量信号而非执行错误：
  // 步骤不会因此 failed，最坏情况是返回"带 ⚠️ 标记的返工版"照常流向下游。
  const verifyEnabled = opts.verify === true && node.step.verify !== false;
  if (!verifyEnabled || !node.acceptance || !content.trim()) {
    return content;
  }

  // 顶层 verify_llm 指定了验收员就用它（步骤级 llm 仍优先）；否则同一 connector 审自己的产出
  const textJudge = opts.verifyLlm?.provider && !node.step.llm ? resolveJudge(node, opts) : { cfg: effectiveConfig, connector: effectiveConnector };
  const check1 = await verifyAcceptance(textJudge.connector, textJudge.cfg, renderedTask, content, node.acceptance);
  addTokens(check1.tokens);
  if (!check1.verdict) {
    // 核验不可用（网络错误 / 两次解析失败）→ 跳过核验，不拦产出（检查员宕机不停产线）
    process.stderr.write(`\n  ⚠️  ${node.step.id} 验收核验不可用，已跳过核验\n`);
    return content;
  }
  if (check1.verdict.pass) {
    node.verification = { pass: true, failed: [], reworked: false };
    return content;
  }

  const failed1 = formatFailedItems(check1.verdict.failed);
  process.stderr.write(`\n  ⟳ ${node.step.id} 验收未过（${failed1.length} 条未满足），自动返工一轮...\n`);
  let reworked: string;
  try {
    reworked = await callLLM(userMessage + buildReworkBlock(check1.verdict.failed, content));
  } catch (err) {
    // 返工生成失败（重试耗尽）→ 保留第一版：质检加严绝不能反过来搞挂本已成功的步骤
    const msg = err instanceof Error ? err.message.slice(0, 80) : String(err);
    process.stderr.write(`\n  ⚠️  ${node.step.id} 返工生成失败（${msg}），保留原产出\n`);
    node.verification = { pass: false, failed: failed1, reworked: false };
    return content;
  }

  // 返工稿必须**重新过一遍机械断言**：断言是硬闸（少一个文件 = 缺件），只在第一稿上查过；
  // 验收返工重写一遍，文件数完全可能从 6 掉到 5——不复查就是这个模块专门要拦的「缺件绿灯」。
  // 返工稿断言不过 → 保留过了断言的第一稿，验收按未通过记录（宁可 ⚠️，不冒充通过）。
  if (node.step.assert) {
    const assertSpec = resolveAssert(node.step.assert, opts.context, () => undefined);
    const again = checkAssert(reworked, assertSpec);
    if (!again.pass) {
      process.stderr.write(`\n  ⚠️  ${node.step.id} 验收返工稿未过机械断言（${again.failures[0]}），保留第一稿\n`);
      node.verification = { pass: false, failed: failed1, reworked: true };
      return content;
    }
  }

  const check2 = await verifyAcceptance(textJudge.connector, textJudge.cfg, renderedTask, reworked, node.acceptance);
  addTokens(check2.tokens);
  if (check2.verdict?.pass) {
    node.verification = { pass: true, failed: [], reworked: true };
  } else if (check2.verdict) {
    node.verification = { pass: false, failed: formatFailedItems(check2.verdict.failed), reworked: true };
    process.stderr.write(`\n  ⚠️  ${node.step.id} 返工后仍有 ${check2.verdict.failed.length} 条未满足\n`);
  } else {
    // 复核不可用 → 保守：沿用第一轮未满足条目、记未通过（宁可多标 ⚠️，不冒充通过）
    node.verification = { pass: false, failed: failed1, reworked: true };
    process.stderr.write(`\n  ⚠️  ${node.step.id} 返工后复核不可用，验收状态按未通过记录\n`);
  }
  return reworked;
}

/**
 * 构造"对话式返工"追加块：把用户意见（必有）和上一版产出（可选）拼到任务后面，
 * 指示专家在原稿基础上按意见修改、只动该动的地方、输出完整结果。
 */
export function buildFeedbackBlock(feedback: string, previousOutput?: string): string {
  const parts = ['\n\n---\n'];
  if (previousOutput && previousOutput.trim()) {
    parts.push(
      '以下是你上一版的产出，请在此基础上修改，不要从零重写：\n\n',
      previousOutput.trim(),
      '\n\n---\n',
    );
  }
  parts.push(
    '用户对上一版的修改意见：\n\n',
    feedback.trim(),
    '\n\n请严格针对上述意见修改：保留没问题的部分，只改需要改的地方，直接输出修改后的完整结果。',
  );
  return parts.join('');
}

/**
 * Web 模式（AO_WEB_INPUT=1，由 web/server.js spawn 时注入）下，向 stdout 发一行机器可读
 * 标记，server 解析后转成 SSE `await-input` 事件推给前端弹框；用户输入再经 server 写回
 * 子进程 stdin，被这里的 readline 读到。CLI（无该 env）下不发标记，行为不变。
 * 标记必须换行结尾，确保 server 的按行解析能立刻 flush。
 */
function emitWebInputRequest(stepId: string, prompt: string, kind: 'human_input' | 'approval'): void {
  if (process.env.AO_WEB_INPUT === '1') {
    process.stdout.write(`\n__AO_INPUT_REQUEST__${JSON.stringify({ type: kind, stepId, prompt })}\n`);
  }
}

async function handleApproval(
  node: DAGNode,
  context: Map<string, string>
): Promise<string> {
  const prompt = node.step.prompt
    ? renderTemplate(node.step.prompt, context)
    : '请确认是否继续 (yes/no):';

  // 如果有 input 引用，先显示内容
  if (node.step.task) {
    const content = renderTemplate(node.step.task, context);
    console.log('\n' + content);
  }

  emitWebInputRequest(node.step.id, prompt, 'approval');

  // Web 模式由前端弹框驱动，不在终端再打印人类提示
  return askOnStdin(node.step.id, process.env.AO_WEB_INPUT === '1' ? '' : `\n⏸️  ${prompt} `);
}

/**
 * 人工输入节点：跑到这步时暂停，读取用户自由输入，作为该步产出注入下游。
 * 与 approval 的区别——approval 是"放行/拦截"的闸门，human_input 是把人写的内容
 * 喂进工作流（如"往哪个方向写""补一段背景"）。
 *
 * 若该步的 output 变量已被预填（`-i 变量=值` 或 --resume 恢复），直接采用、不阻塞，
 * 这样自动化 / 测试 / 断点续跑都能跳过交互。Web 模式下 server 向子进程 stdin 写入即可复用同一路径。
 */
async function handleHumanInput(
  node: DAGNode,
  context: Map<string, string>
): Promise<string> {
  // 预填即采用：避免在非交互场景（CI/测试/resume）卡在 stdin
  const outVar = node.step.output;
  if (outVar) {
    const pre = context.get(outVar);
    if (pre && pre.trim()) return pre;
  }

  const prompt = node.step.prompt
    ? renderTemplate(node.step.prompt, context)
    : '请输入：';

  // 可选的 task 作为给用户看的上下文提示
  if (node.step.task) {
    const content = renderTemplate(node.step.task, context).trim();
    if (content) console.log('\n' + content);
  }

  emitWebInputRequest(node.step.id, prompt, 'human_input');

  return askOnStdin(node.step.id, process.env.AO_WEB_INPUT === '1' ? '' : `\n📝 ${prompt} `);
}

/**
 * 从 stdin 读一行回答。**stdin 在拿到回答之前就关了（EOF）必须报错**——readline 的 question 回调在
 * EOF 时永远不会被调用，于是 cron / Docker / CI / `< /dev/null` 下跑到人工节点，整个运行就挂在这里：
 * 进度计时器让进程永不退出，上游已经花钱跑完的步骤一个字都不落盘，也没有任何报错（真机复现过：
 * 只有一个 approval 步的工作流 `< /dev/null` 会一直打「gate ... 90s」）。报错之后走正常的失败路径：
 * 这一步标失败、结果照常保存，用户可以 `--resume last` 在能交互的终端里接着跑。
 */
function askOnStdin(stepId: string, display: string): Promise<string> {
  // MCP 服务端（stdin 是 JSON-RPC 通道）等明确不可交互的宿主：连 readline 都不能开
  if (process.env.AO_NON_INTERACTIVE === '1') {
    return Promise.reject(new Error(
      `步骤 "${stepId}" 需要人工输入，但当前宿主不可交互（如经 MCP 调用）。human_input 步骤可通过 inputs 预填其输出变量；含 approval 的工作流请在终端或 Studio 里运行`,
    ));
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve, reject) => {
    let answered = false;
    rl.question(display, (answer) => {
      answered = true;
      rl.close();
      resolve(answer.trim());
    });
    rl.once('close', () => {
      if (answered) return;
      reject(new Error(
        `步骤 "${stepId}" 需要人工输入，但标准输入已关闭（非交互环境：cron / Docker / CI / 管道）。`
        + `在能交互的终端里运行；human_input 步骤也可以用 -i <输出变量>=<内容> 预填后跳过`,
      ));
    });
  });
}

// 为「失败/跳过」的依赖补空串：仅当其 output 变量尚未写入 context 时。
// 正常 all 模式下某依赖失败会让本步被 markDownstreamSkipped 跳过、不会执行到这里；
// 因此实际只对 any_completed（或所有依赖都已完成）的步骤生效，不会掩盖正常的拼写错误。
function fillSkippedDepOutputs(dag: DAG, node: DAGNode, context: Map<string, string>): void {
  for (const depId of node.dependencies) {
    const dep = dag.nodes.get(depId);
    if (!dep || !dep.step.output) continue;
    if ((dep.status === 'failed' || dep.status === 'skipped') && !context.has(dep.step.output)) {
      context.set(dep.step.output, '');
    }
  }
}

function markDownstreamSkipped(dag: DAG, failedId: string): void {
  const node = dag.nodes.get(failedId);
  if (!node) return;
  for (const depId of node.dependents) {
    const depNode = dag.nodes.get(depId);
    if (!depNode || depNode.status !== 'pending') continue;

    if (depNode.step.depends_on_mode === 'any_completed') {
      // 只有当所有依赖都是 skipped 或 failed 时才跳过
      const allDepsSkippedOrFailed = depNode.dependencies.every(d => {
        const dNode = dag.nodes.get(d);
        return dNode && (dNode.status === 'skipped' || dNode.status === 'failed');
      });
      if (!allDepsSkippedOrFailed) continue; // 还有依赖未决或已完成，暂不跳过
    }

    depNode.status = 'skipped';
    markDownstreamSkipped(dag, depId);
  }
}

/** 步骤因系统睡眠失败时的说明（替代"增大超时"那套——那对睡眠无效） */
export function sleepFailureHint(sleptMs: number, platform: string = process.platform): string {
  const minutes = Math.max(1, Math.round(sleptMs / 60_000));
  const lines = [
    '',
    `  💤 这一步执行期间系统睡眠了约 ${minutes} 分钟：连接被冻住，不是模型慢，增大超时没有用。`,
    '     醒着的时候用下面的 --resume 命令从这一步继续即可（上游产出直接复用）。',
  ];
  if (platform === 'darwin') {
    lines.push('     长时间运行想合盖 / 离开：用 caffeinate -i 包住命令，例如 caffeinate -i ao run <workflow.yaml>');
  }
  return lines.join('\n');
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  if (!ms) return promise;  // 0 = 不限时（CLI provider 写完自动停）
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`超时 (${ms}ms)，可用 --timeout 或 YAML llm.timeout 延长`)),
      ms
    );
    promise
      .then(val => { clearTimeout(timer); resolve(val); })
      .catch(err => { clearTimeout(timer); reject(err); });
  });
}

/** 错误分级：不同错误类型使用不同退避策略（借鉴 Claude Code 架构） */
/**
 * 从报错里取**明说的** HTTP 状态码。只认紧跟在 error / HTTP / status / 错误 后面的三位数——
 * 「API error 401: …」「API Error: 401 {…}」「HTTP 503」这类；正文里散落的数字（"500ms"、
 * "max 512 tokens"）不算。取不到返回 undefined，交给下面的关键词启发式。
 */
export function explicitHttpStatus(message: string): number | undefined {
  const m = message.match(/(?:error|http|status(?:\s*code)?|错误)[\s:：(]*([1-5]\d\d)\b(?!\s*(?:ms|毫秒|s\b|秒|tokens?|字))/i);
  return m ? Number(m[1]) : undefined;
}

export function classifyError(error: Error): 'rate_limit' | 'server_error' | 'connection' | 'non_retryable' {
  const msg = error.message.toLowerCase();
  // 中转网关明说「该分组下没有这个模型的可用渠道」：状态码是 503，但属于账号配置问题，重试无用。
  // 必须排在 5xx 判定之前（与 connectors/endpoint.ts 的 isModelUnavailable 同一口径）
  if (/model_not_found|无可用渠道|no available channel/.test(msg))
    return 'non_retryable';
  // 报错里**明说了状态码**就按状态码判，不再猜关键词。此前两种误判都出在这：
  //  · claude-code 的鉴权失败是「… API 错误: API Error: 401 …」，被 `includes('api 错误')` 一律当成
  //    服务端故障，按 CLI 退避 5/10/20/40/80s 重试五次——两分半钟之后才告诉用户 key 不对；
  //  · 任何 400 只要正文里带 generate / moderate / separate（都含 "rate"）就被当成限速重试。
  const status = explicitHttpStatus(error.message);
  if (status !== undefined) {
    if (status === 429) return 'rate_limit';
    if (status === 408) return 'connection';
    if (status >= 500) return 'server_error';
    if (status >= 400) return 'non_retryable';   // 400 / 401 / 402 / 403 / 404 / 422：重试不会变好
  }
  // 限速：需要更长退避。用 \b 边界匹配，避免 "1429ms" / "429 ids" 等子串误判
  if (/\b429\b/.test(msg) || /rate.?limit|rate exceeded|too many requests|throttl|限流|限速|请求过于频繁/.test(msg))
    return 'rate_limit';
  // 服务端错误：短退避即可。5xx 状态码用 \b 边界匹配，避免 "500ms" / "450000ms" 等误判
  if (/\b5\d\d\b/.test(msg) || msg.includes('api 错误'))
    return 'server_error';
  // 连接断开/超时：中等退避（"超时"识别中文 withTimeout 抛出的消息）
  if (msg.includes('econnreset') || msg.includes('econnrefused') ||
      msg.includes('etimedout') || msg.includes('socket hang up') ||
      msg.includes('terminated') || msg.includes('aborted') ||
      msg.includes('stalled') ||
      msg.includes('timeout') || msg.includes('超时'))
    return 'connection';
  return 'non_retryable';
}

function isRetryable(error: Error): boolean {
  return classifyError(error) !== 'non_retryable';
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** 按 step id 覆盖或插入 stepResult（循环场景用覆盖策略） */
function upsertStepResult(results: StepResult[], entry: StepResult): void {
  const idx = results.findIndex(r => r.id === entry.id);
  if (idx >= 0) {
    results[idx] = entry;
  } else {
    results.push(entry);
  }
}
