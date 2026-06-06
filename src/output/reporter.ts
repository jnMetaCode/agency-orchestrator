/**
 * 执行结果输出和保存
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { WorkflowResult } from '../types.js';
import type { DAGNode } from '../types.js';

/**
 * 保存工作流执行结果到文件
 */
export function saveResults(result: WorkflowResult, outputDir: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dirName = `${result.name}-${timestamp}`;
  const dir = join(outputDir, dirName);
  const stepsDir = join(dir, 'steps');

  mkdirSync(stepsDir, { recursive: true });

  // 保存每步的输出（带角色头部）
  for (let i = 0; i < result.steps.length; i++) {
    const step = result.steps[i];
    const filename = `${i + 1}-${step.id}.md`;
    const emoji = step.agentEmoji || '🤖';
    const name = step.agentName || step.role || step.id;
    const duration = step.duration ? `${(step.duration / 1000).toFixed(1)}s` : '';
    const header = `> ${emoji} **${name}** | 步骤 ${i + 1}/${result.steps.length}${duration ? ` | ${duration}` : ''}\n\n---\n\n`;
    const body = step.output || step.error || '(无输出)';
    writeFileSync(join(stepsDir, filename), header + body, 'utf-8');
  }

  // 生成 summary.md — 清晰的目录索引，标注每步产出和最终成品
  // 收集参与的角色列表（去重）
  const participants = result.steps
    .filter(s => s.status === 'completed' && s.agentName)
    .reduce((acc, s) => {
      const key = s.agentName!;
      if (!acc.has(key)) acc.set(key, s.agentEmoji || '🤖');
      return acc;
    }, new Map<string, string>());

  const participantLine = participants.size > 0
    ? Array.from(participants.entries()).map(([n, e]) => `${e} ${n}`).join('  ')
    : '';

  const summaryLines: string[] = [
    `# ${result.name}`,
    '',
    `> 执行时间: ${(result.totalDuration / 1000).toFixed(1)}s | Token: ${result.totalTokens.input + result.totalTokens.output} | 状态: ${result.success ? '全部完成' : '部分失败'}`,
    '',
  ];
  if (participantLine) {
    summaryLines.push(`**参与者:** ${participantLine}`, '');
  }
  summaryLines.push('## 产出文件', '');

  // 找到最终成品（最后一个成功步骤）
  const lastCompleted = [...result.steps].reverse().find(s => s.status === 'completed');

  for (let i = 0; i < result.steps.length; i++) {
    const step = result.steps[i];
    const filename = `${i + 1}-${step.id}.md`;
    const status = step.status === 'completed' ? '✅' :
                   step.status === 'failed' ? '❌' :
                   step.status === 'skipped' ? '⏭️' : '⏳';
    const isFinal = step === lastCompleted;
    const emoji = step.agentEmoji || '🤖';
    const name = step.agentName || step.role || step.id;
    const duration = step.duration ? ` | ${(step.duration / 1000).toFixed(1)}s` : '';

    summaryLines.push(`${status} **[${filename}](steps/${filename})**${isFinal ? ' ⭐ 最终成品' : ''}  `);
    summaryLines.push(`  ${emoji} ${name}${duration}  `);
    if (step.status === 'failed' && step.error) {
      summaryLines.push(`  失败原因: ${step.error}  `);
    }
    summaryLines.push('');
  }

  // 如果有最终成品，在顶部加快速入口
  if (lastCompleted) {
    const lastIdx = result.steps.indexOf(lastCompleted);
    const lastFile = `${lastIdx + 1}-${lastCompleted.id}.md`;
    summaryLines.splice(4, 0,
      `**👉 最终成品: [steps/${lastFile}](steps/${lastFile})**`,
      '',
    );
  }

  writeFileSync(join(dir, 'summary.md'), summaryLines.join('\n'), 'utf-8');

  // 保存元数据（含 output 变量名，用于 resume）
  const metadata: Record<string, unknown> = {
    name: result.name,
    success: result.success,
    totalDuration: `${(result.totalDuration / 1000).toFixed(1)}s`,
    totalTokens: result.totalTokens,
    inputs: result.inputs,
    steps: result.steps.map(s => ({
      id: s.id,
      role: s.role,
      agentName: s.agentName,
      agentEmoji: s.agentEmoji,
      status: s.status,
      output_var: s.output_var,
      duration: `${(s.duration / 1000).toFixed(1)}s`,
      tokens: s.tokens,
    })),
  };
  writeFileSync(join(dir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8');

  return dir;
}

/**
 * 打印一个步骤的完整结果（标题 + 内容），模拟公司讨论
 */
export function printStepResult(node: DAGNode, stepIndex: number, totalSteps: number): void {
  const emoji = node.agentEmoji || '🤖';
  const name = node.agentName || node.step.role || '?';
  const duration = ((node.endTime || 0) - (node.startTime || 0)) / 1000;
  const tokens = node.tokenUsage
    ? `${node.tokenUsage.input + node.tokenUsage.output} tokens`
    : '';

  console.log(`\n  ── [${stepIndex}/${totalSteps}] ${emoji} ${name} (${node.step.id}) ──`);

  if (node.status === 'completed') {
    console.log(`  完成 | ${duration.toFixed(1)}s | ${tokens}`);
    if (node.result) {
      console.log('');
      for (const line of node.result.split('\n')) {
        console.log(`    ${line}`);
      }
    }
  } else if (node.status === 'failed') {
    console.log(`  失败: ${node.error}`);
  } else if (node.status === 'skipped') {
    const reason = node.step.condition ? '条件不满足' : '上游失败/跳过';
    console.log(`  跳过 (${reason})`);
  }
}

/** 活跃的计时器（用于清理） */
let runningTimer: ReturnType<typeof setInterval> | null = null;
let runningStartTime = 0;

/**
 * 打印正在运行的步骤提示，并启动计时器每 10 秒更新耗时
 */
export function printStepRunning(nodes: DAGNode[]): void {
  runningStartTime = Date.now();

  console.log('');
  if (nodes.length === 1) {
    // 单角色：一行搞定，计时器覆盖这一行
    const emoji = nodes[0].agentEmoji || '🤖';
    const name = nodes[0].agentName || nodes[0].step.id;
    process.stdout.write(`  ⏳ ${emoji} ${name} 执行中 ...`);
  } else {
    // 多角色：每个单独一行，最后一行用于计时
    for (const n of nodes) {
      const emoji = n.agentEmoji || '🤖';
      const name = n.agentName || n.step.id;
      console.log(`  ⏳ ${emoji} ${name}`);
    }
    process.stdout.write(`  ⏳ ${nodes.length} 个部门并行中 ...`);
  }

  // 每 10 秒在同一行更新耗时
  const timerLabel = nodes.length === 1
    ? `${nodes[0].agentEmoji || '🤖'} ${nodes[0].agentName || nodes[0].step.id}`
    : `${nodes.length} 个部门并行中`;
  runningTimer = setInterval(() => {
    const elapsed = Math.round((Date.now() - runningStartTime) / 1000);
    process.stdout.write(`\r  ⏳ ${timerLabel} ... ${elapsed}s`);
  }, 10_000);
}

/**
 * 清除"执行中"提示行和计时器
 */
export function clearRunningLine(): void {
  if (runningTimer) {
    clearInterval(runningTimer);
    runningTimer = null;
  }
  process.stdout.write('\r\x1b[K');
}

/**
 * 从上一次运行的输出目录中加载步骤结果，重建 context
 * 用于 --resume 场景：加载已完成步骤的输出变量到 context
 */
export function loadPreviousContext(outputDir: string): Map<string, string> {
  const context = new Map<string, string>();
  const metadataPath = join(outputDir, 'metadata.json');

  if (!existsSync(metadataPath)) {
    throw new Error(`resume 目录无效: 找不到 ${metadataPath}`);
  }

  const metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));
  const stepsDir = join(outputDir, 'steps');

  // 先恢复原始用户输入（如 topic、audience 等）
  if (metadata.inputs && typeof metadata.inputs === 'object') {
    for (const [k, v] of Object.entries(metadata.inputs as Record<string, unknown>)) {
      if (typeof v === 'string') context.set(k, v);
    }
  }

  for (const step of metadata.steps) {
    if (step.status === 'completed' && step.output_var) {
      // 从 steps/ 目录读取输出内容
      const stepFiles = existsSync(stepsDir) ? readdirSync(stepsDir) : [];
      const stepFile = stepFiles.find(f => f.endsWith(`-${step.id}.md`));
      if (stepFile) {
        const content = readFileSync(join(stepsDir, stepFile), 'utf-8');
        if (content && content !== '(无输出)') {
          context.set(step.output_var, content);
        }
      }
    }
  }

  return context;
}

/**
 * 读取上一次运行中某个步骤的产出正文（用于 --feedback 对话式返工：把"上一版产出"
 * 交回给同一专家，让它带着用户意见在原稿基础上修改，而不是从零重写）。
 * 找不到 / 无内容时返回 null（调用方退化为纯反馈，不附旧稿）。
 */
export function loadStepOutput(outputDir: string, stepId: string): string | null {
  const metadataPath = join(outputDir, 'metadata.json');
  if (!existsSync(metadataPath)) return null;
  let metadata: { steps?: { id: string }[] };
  try {
    metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));
  } catch {
    return null;
  }
  const idx = (metadata.steps || []).findIndex(s => s.id === stepId);
  if (idx < 0) return null;
  const stepFile = join(outputDir, 'steps', `${idx + 1}-${stepId}.md`);
  if (!existsSync(stepFile)) return null;
  let content = readFileSync(stepFile, 'utf-8');
  // 去掉文件头部（> emoji **name** | ... 后跟 \n---\n），只留正文
  const headerEnd = content.indexOf('\n---\n');
  if (headerEnd >= 0) content = content.slice(headerEnd + 5);
  content = content.trim();
  return content && content !== '(无输出)' ? content : null;
}

/**
 * 获取上一次运行的步骤 ID 列表（已完成的）
 */
export function getCompletedStepIds(outputDir: string): string[] {
  const metadataPath = join(outputDir, 'metadata.json');
  if (!existsSync(metadataPath)) return [];
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));
  return metadata.steps
    .filter((s: { status: string }) => s.status === 'completed')
    .map((s: { id: string }) => s.id);
}

/**
 * 计算 resume 时应跳过的 step id 集合（纯函数，便于测试）。
 * - 无 fromStep：跳过上次所有已完成的步骤（继续没跑完的部分）。
 * - 有 fromStep：只跳过 fromStep 所在 DAG 层级**之前**且已完成的步骤，
 *   fromStep 本层及其下游全部重跑（用上游已恢复的输出）。
 * @param dag 仅需 levels（拓扑分层），用结构化类型避免耦合完整 DAG
 * @throws fromStep 不在任何层级时抛错
 */
export function computeResumeSkipIds(
  dag: { levels: string[][] },
  completedIds: string[],
  fromStep?: string,
): Set<string> {
  if (!fromStep) return new Set(completedIds);

  const fromLevel = dag.levels.findIndex(l => l.includes(fromStep));
  if (fromLevel < 0) {
    throw new Error(`--from 指定的步骤 "${fromStep}" 不存在`);
  }
  const completed = new Set(completedIds);
  const skip = new Set<string>();
  for (let li = 0; li < fromLevel; li++) {
    for (const id of dag.levels[li]) {
      if (completed.has(id)) skip.add(id);
    }
  }
  return skip;
}

/**
 * 查找最近一次运行的输出目录
 */
export function findLatestOutput(baseDir: string, workflowName?: string): string | null {
  if (!existsSync(baseDir)) return null;
  const dirs = readdirSync(baseDir)
    .filter(d => {
      if (workflowName && !d.startsWith(workflowName)) return false;
      return existsSync(join(baseDir, d, 'metadata.json'));
    })
    .sort((a, b) => {
      // 按修改时间排序（最新的在前），而非字母序
      const aStat = statSync(join(baseDir, a));
      const bStat = statSync(join(baseDir, b));
      return bStat.mtimeMs - aStat.mtimeMs;
    });
  return dirs.length > 0 ? join(baseDir, dirs[0]) : null;
}

export function printSummary(result: WorkflowResult, outputPath: string, workflowPath?: string): void {
  const totalTokens = result.totalTokens.input + result.totalTokens.output;
  const duration = (result.totalDuration / 1000).toFixed(1);
  const completedSteps = result.steps.filter(s => s.status === 'completed').length;

  console.log('\n\n' + '='.repeat(50));
  console.log(`  ${result.success ? '完成' : '部分失败'}: ${completedSteps}/${result.steps.length} 步 | ${duration}s | ${totalTokens} tokens`);
  console.log(`  详细输出: ${outputPath}`);

  // 成功时也提示可迭代：用户往往不知道能"只重跑某一步"。把命令和可选步骤直接列出来。
  if (result.success && workflowPath) {
    const displayPath = relative(process.cwd(), workflowPath) || workflowPath;
    const stepIds = result.steps.filter(s => s.status === 'completed').map(s => s.id);
    console.log('');
    console.log(`  💡 想优化某一步？只重跑它即可（自动复用上游输出）/ Re-run one step:`);
    console.log(`     ao run ${displayPath} --resume last --from <step-id>`);
    if (stepIds.length > 0) {
      console.log(`     可选步骤 / steps: ${stepIds.join(', ')}`);
    }
  }

  // 失败时显示失败详情和 resume 命令
  if (!result.success && workflowPath) {
    const failedSteps = result.steps.filter(s => s.status === 'failed');
    const skippedSteps = result.steps.filter(s => s.status === 'skipped');

    if (failedSteps.length > 0) {
      console.log('');
      for (const s of failedSteps) {
        console.log(`  ❌ ${s.id}: ${s.error || '未知错误'}`);
      }
      if (skippedSteps.length > 0) {
        console.log(`  ⏭️  跳过 ${skippedSteps.length} 步: ${skippedSteps.map(s => s.id).join(', ')}`);
      }

      // 提示用户如何恢复（显示相对路径更友好）
      const firstFailed = failedSteps[0].id;
      const displayPath = relative(process.cwd(), workflowPath!) || workflowPath;
      console.log('');
      console.log(`  💡 从失败处继续:`);
      console.log(`     ao run ${displayPath} --resume last --from ${firstFailed}`);
    }
  }

  console.log('='.repeat(50));
}
