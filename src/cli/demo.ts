/**
 * ao demo — zero-config multi-agent collaboration showcase
 *
 * 设计原则（v0.6.16 起）：
 * - 检测到可用 LLM → 直接真跑 story-creation 工作流（最强体验，零废话）
 * - 没检测到 → 显示 DAG 结构 + 行动指引（不再放预录 mock，避免误导期望）
 *
 * 之前的 mock 回放在用户配置 LLM 之前展示精修过的内容，让用户对真跑的输出
 * 期望被错误抬高；同时占用注意力 5 秒后还要再问 y/n 真跑，链路太长。
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';

// ─── Types ───

export interface DetectedLLM {
  provider: 'deepseek' | 'claude' | 'openai' | 'ollama' | 'claude-code' | 'gemini-cli' | 'copilot-cli' | 'codex-cli' | 'openclaw-cli' | 'hermes-cli';
  name: string;
  available: boolean;
  envVar?: string;
}

const DEMO_PREMISE = '一个程序员发现 AI 的回复里包含了它不该知道的信息——他女儿昨晚说的梦话。';

// ─── LLM Detection ───

export async function detectAvailableLLMs(): Promise<DetectedLLM[]> {
  const results: DetectedLLM[] = [];

  // ── 免 API key（检测 CLI 是否安装）──
  const cliTools: Array<{ provider: DetectedLLM['provider']; name: string; cmd: string }> = [
    { provider: 'claude-code', name: 'Claude Code (Max/Pro 会员)', cmd: 'claude' },
    { provider: 'gemini-cli', name: 'Gemini CLI (Google 免费)', cmd: 'gemini' },
    { provider: 'copilot-cli', name: 'Copilot CLI (GitHub 会员)', cmd: 'copilot' },
    { provider: 'codex-cli', name: 'Codex CLI (ChatGPT Plus)', cmd: 'codex' },
    { provider: 'openclaw-cli', name: 'OpenClaw CLI', cmd: 'openclaw' },
    { provider: 'hermes-cli', name: 'Hermes Agent', cmd: 'hermes' },
  ];

  for (const tool of cliTools) {
    let available = false;
    try {
      const { execSync } = await import('node:child_process');
      execSync(`which ${tool.cmd}`, { stdio: 'ignore' });
      available = true;
    } catch { /* not installed */ }
    results.push({ provider: tool.provider, name: tool.name, available });
  }

  // ── Ollama（本地） ──
  let ollamaAvailable = false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const res = await fetch(`${ollamaUrl.replace(/\/+$/, '')}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) ollamaAvailable = true;
  } catch { /* not running */ }
  results.push({ provider: 'ollama', name: 'Ollama (本地)', available: ollamaAvailable });

  // ── 需 API key ──
  results.push(
    { provider: 'deepseek', name: 'DeepSeek', available: !!process.env.DEEPSEEK_API_KEY, envVar: 'DEEPSEEK_API_KEY' },
    { provider: 'claude', name: 'Claude API', available: !!process.env.ANTHROPIC_API_KEY, envVar: 'ANTHROPIC_API_KEY' },
    { provider: 'openai', name: 'OpenAI', available: !!process.env.OPENAI_API_KEY, envVar: 'OPENAI_API_KEY' },
  );

  return results;
}

// ─── Helpers ───

function askQuestion(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function resolveWorkflowPath(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  // From dist/cli/ (or src/cli/) → project root → workflows/
  const p = resolve(__dirname, '../../workflows/story-creation.yaml');
  if (!existsSync(p)) {
    throw new Error(`找不到 demo 工作流: ${p}`);
  }
  return p;
}

/** 没检测到 LLM 时：展示 DAG + 行动指引 */
async function showDagAndGuide(): Promise<void> {
  console.log('  ❌ 没检测到可用 LLM。先看一下 ao 工作流的 DAG 结构:\n');

  // 用 ao 自身的 plan 能力展示 DAG（确保展示逻辑和 ao plan 命令一致）
  try {
    const { parseWorkflow } = await import('../core/parser.js');
    const { buildDAG, formatDAG } = await import('../core/dag.js');
    const wf = parseWorkflow(resolveWorkflowPath());
    const dag = buildDAG(wf);
    const dagText = formatDAG(dag);
    // 缩进对齐 demo 输出风格
    for (const line of dagText.split('\n')) {
      console.log(`  ${line}`);
    }
    console.log('\n  4 个 AI 角色协作完成短篇小说创作（第二层并行）。\n');
  } catch (err) {
    // DAG 渲染失败兜底，给一个文字描述
    console.log('  Level 1: 叙事学家（搭故事结构）');
    console.log('  Level 2: 心理学家 + 叙事设计师（并行：人物 + 关键场景）');
    console.log('  Level 3: 内容创作者（基于以上整合，写完整短篇）\n');
  }

  console.log('  最快上手（任选一个）:');
  console.log('');
  console.log('    Claude Code 订阅:');
  console.log('      装 Claude Code CLI 后重跑  ao demo  即可（零配置）');
  console.log('');
  console.log('    DeepSeek API（最便宜稳）:');
  console.log('      在 https://platform.deepseek.com 申请 key（10 块够跑很久）');
  console.log('      export DEEPSEEK_API_KEY=sk-...');
  console.log('      ao demo');
  console.log('');
  console.log('    本地 Ollama:');
  console.log('      ollama serve  &&  ollama pull qwen2.5:7b');
  console.log('      ao demo');
  console.log('');
  console.log('  完整文档: https://github.com/jnMetaCode/agency-orchestrator');
}

// ─── Main Entry ───

export async function runDemo(): Promise<void> {
  console.log(`
  🎬 Agency Orchestrator Demo
  ${'─'.repeat(40)}
  Workflow: 短篇小说创作（4 个 AI 角色协作）
  Premise: "${DEMO_PREMISE}"
  ${'─'.repeat(40)}
`);

  const llms = await detectAvailableLLMs();
  const available = llms.filter(l => l.available);

  // 没 LLM → DAG + 行动指引
  if (available.length === 0) {
    await showDagAndGuide();
    return;
  }

  // 有 LLM → 选 provider + 真跑
  console.log('  ✅ 检测到可用 LLM:');
  for (const llm of available) {
    console.log(`     • ${llm.name}`);
  }
  console.log('');

  let selectedProvider: DetectedLLM;
  if (available.length === 1 || !process.stdin.isTTY) {
    selectedProvider = available[0];
  } else {
    console.log('  可用列表:');
    available.forEach((llm, i) => console.log(`    ${i + 1}) ${llm.name}`));
    const choice = await askQuestion(`\n  选择 (1-${available.length}, 默认 1): `);
    const idx = parseInt(choice) - 1;
    selectedProvider = available[idx >= 0 && idx < available.length ? idx : 0];
  }

  console.log(`\n  🚀 用 ${selectedProvider.name} 真跑 story-creation 工作流...\n`);

  const { run } = await import('../index.js');
  const workflowPath = resolveWorkflowPath();

  const modelMap: Record<string, string> = {
    deepseek: 'deepseek-chat',
    claude: 'claude-sonnet-4-20250514',
    openai: 'gpt-4o',
    ollama: 'qwen2.5:7b',
  };

  const result = await run(workflowPath, { premise: DEMO_PREMISE }, {
    llmOverride: {
      provider: selectedProvider.provider,
      model: modelMap[selectedProvider.provider] || selectedProvider.provider,
    },
  });

  console.log('\n  ' + '─'.repeat(40));
  if (result.success) {
    console.log('  ✅ Demo 跑通了 ao 的核心能力\n');
    console.log('  下一步:');
    console.log('    ao compose "你的需求一句话" --run     # AI 自动编排工作流');
    console.log('    ao roles                              # 看所有可用角色');
    console.log('    ao run workflows/<模板>.yaml          # 跑现成模板\n');
  } else {
    console.log('  ⚠️  Demo 没全部跑通，看上面错误信息排查\n');
  }
}
