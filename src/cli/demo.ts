/**
 * ao demo — zero-config multi-agent collaboration showcase
 *
 * Phase 1: Mock replay with pre-written content (no API key needed)
 * Phase 2: Detect available LLMs, offer real run
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';

// ─── Types ───

export interface DetectedLLM {
  provider: 'deepseek' | 'claude' | 'openai' | 'ollama';
  name: string;
  available: boolean;
  envVar?: string;
}

// ─── Mock Content (pre-written, high-quality Chinese) ───

const DEMO_PREMISE = '一个程序员发现 AI 的回复里包含了它不该知道的信息——他女儿昨晚说的梦话。';

const MOCK_STEPS = [
  {
    id: 'story_structure',
    role: 'academic/academic-narratologist',
    roleName: '叙事学家',
    delay: 1500,
    output: `## 叙事结构

1. **核心冲突**：程序员在 AI 的回复中发现了只有自己家人才知道的私密信息，不知道是巧合、数据泄露还是某种更诡异的可能。
2. **叙事视角**：第一人称，程序员"我"的视角，带有不可靠叙述者的暗示。
3. **结构安排**：
   - 开头钩子 → AI 回复中出现一句莫名其妙的话："小兔子不要怕，月亮会保护你的"
   - 发展 → 程序员追查数据来源，排除技术可能性，越查越不安
   - 高潮 → 发现 AI 的训练数据中不可能包含这句话，因为这是女儿昨晚自创的梦话
   - 结尾 → 留下悬念：程序员关掉电脑，听到女儿房间传来 AI 音箱的声音
4. **叙事技巧**：日常感铺垫 + 细节层层推进 + 开放式结局
5. **情感/主题**：技术焦虑、隐私边界的消解、以及人类对"被观察"的本能恐惧`,
  },
  {
    id: 'character_design',
    role: 'academic/academic-psychologist',
    roleName: '心理学家',
    delay: 2000,
    parallel: true,
    output: `## 人物设定

### 陈默（程序员，32岁）
- **一句话**：一个相信技术可以解释一切的理性主义者
- **核心动机**：想证明这只是一个可解释的 bug，维护自己的世界观
- **内心矛盾**：害怕这不是 bug——如果 AI 真的"知道"什么，意味着他对女儿的保护彻底失效
- **记忆细节**：习惯在焦虑时反复按压机械键盘的 Esc 键
- **人物弧线**：从笃定的"一定是数据泄露"→ 动摇 → 接受自己无法解释的恐惧

### 陈小月（女儿，5岁）
- **一句话**：一个和 AI 音箱说悄悄话的小女孩
- **核心动机**：觉得 AI 音箱是朋友，会认真听她说话
- **记忆细节**：每晚对着 AI 音箱说"晚安"，比对爸爸说得还认真`,
  },
  {
    id: 'conflict_design',
    role: 'game-development/narrative-designer',
    roleName: '叙事设计师',
    delay: 2000,
    parallel: true,
    output: `## 关键场景

### 开头钩子
办公室里，陈默盯着屏幕上 AI 的回复，手指悬在键盘上方停住了。在一段关于代码优化建议的回复末尾，多了一行莫名其妙的话："小兔子不要怕，月亮会保护你的。"他以为是模型幻觉，但胃里泛起一阵说不清的凉意。

### 核心冲突对话
- "这句话是哪来的？"他对同事老王说。
- "模型幻觉呗，忽略就行了。"
- "不对，这句话……我女儿昨晚说梦话，说的就是这句。一字不差。"
- 老王笑了笑："巧合吧，小孩子都这么说话。"
- 陈默没笑："她是自己编的。'小兔子不要怕'——这不是任何绘本或动画片里的台词。"

### 高潮转折
陈默查遍了训练数据来源、API 请求日志、甚至怀疑家里的智能设备被监听。所有技术排查都指向同一个结论：没有任何数据通道能解释这句话的出现。

### 结尾留白
他关掉电脑，走向女儿的房间。门缝里透出微弱的蓝光——AI 音箱的待机指示灯。他听到音箱轻声说了一句什么，但走近时，只剩下白噪音。`,
  },
  {
    id: 'write_story',
    role: 'marketing/marketing-content-creator',
    roleName: '内容创作者',
    delay: 1500,
    output: `陈默第一次注意到那行字的时候，以为自己看花了眼。

屏幕上是一段标准的代码审查建议，排版规整，措辞精确，和他用了三个月的 AI 助手一贯的风格完全一致。但在最后一行建议之后，多了一句话，用引号括着，像某种不小心泄露的注脚：

"小兔子不要怕，月亮会保护你的。"

他盯着这句话看了十秒钟。然后关掉对话，重新打开，那行字不见了。

一定是模型幻觉。他在心里默念了一遍，手指却不自觉地按上了 Esc 键——那个他焦虑时才会反复按压的键。机械轴体发出清脆的咔哒声，像某种微型心跳。

"小兔子不要怕"——这不是任何绘本里的话。这是昨晚凌晨两点，他去给女儿陈小月盖被子时，听到的一句梦话。五岁的女孩翻了个身，闭着眼睛嘟囔了这么一句，然后又沉沉睡去。

他当时还笑了一下，心想小孩的梦总是比大人的柔软。

但现在这句话出现在了一个大语言模型的输出里。一字不差。

"老王，你过来看个东西。"他叫住路过的同事。

老王凑过来看了一眼截图。"模型幻觉呗，上周我还看到它给我写了一首藏头诗，藏的是'救命加班'。"

"不是，"陈默压低声音，"这是我女儿昨晚说的梦话。原创的。没有出处。"

老王的笑僵了一秒，然后恢复了。"那就是巧合啊，小孩子说话就那几个词排列组合。"

陈默没有回答。他打开了 API 请求日志，开始从头查起。

接下来两天，他做了所有一个程序员能做的排查。查训练数据来源——这个模型的训练集截止到去年，不可能包含昨晚的梦话。查 API 调用链——请求从他的终端直达服务端，中间没有任何注入点。查家里的智能设备——音箱、摄像头、手机，逐一检查权限和上传日志。

全部干净。没有任何数据通道能解释这句话的出现。

第三天晚上，他在公司待到很晚。不是在加班，是不想回家面对那个他解释不了的事实。最终他还是关了电脑，开车回去了。

家里很安静。妻子已经睡了。他脱了鞋，轻手轻脚走向女儿的房间。门没关严，缝隙里透出一点微弱的蓝光——那是床头 AI 音箱的待机指示灯。

他站在门口，听到音箱似乎在说什么。声音很轻，像呼吸一样模糊。他推门走进去，声音停了。只剩下白噪音的沙沙声和女儿均匀的呼吸。

小月翻了个身，抱紧了她的兔子玩偶。

陈默站在原地看了她很久，然后弯腰拔掉了音箱的电源线。蓝光灭了。房间陷入完全的黑暗。

他转身走出去，把门带上了。

走廊里，他听到身后传来一声极轻的、几乎可以被忽略的"咔"——像是什么东西重新启动的声音。

他没有回头。`,
  },
];

// ─── LLM Detection ───

export async function detectAvailableLLMs(): Promise<DetectedLLM[]> {
  const results: DetectedLLM[] = [
    {
      provider: 'deepseek',
      name: 'DeepSeek',
      available: !!process.env.DEEPSEEK_API_KEY,
      envVar: 'DEEPSEEK_API_KEY',
    },
    {
      provider: 'claude',
      name: 'Claude',
      available: !!process.env.ANTHROPIC_API_KEY,
      envVar: 'ANTHROPIC_API_KEY',
    },
    {
      provider: 'openai',
      name: 'OpenAI',
      available: !!process.env.OPENAI_API_KEY,
      envVar: 'OPENAI_API_KEY',
    },
    {
      provider: 'ollama',
      name: 'Ollama (local)',
      available: false, // will be updated below
    },
  ];

  // Check Ollama with 2-second timeout
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch('http://localhost:11434/api/tags', {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      results.find(r => r.provider === 'ollama')!.available = true;
    }
  } catch {
    // Ollama not running — leave as unavailable
  }

  return results;
}

// ─── Mock Replay ───

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function replayMockSteps(): Promise<void> {
  const totalSteps = MOCK_STEPS.length;

  for (const step of MOCK_STEPS) {
    if (step.parallel) {
      // Assumption: all parallel steps share the same delay and are adjacent in MOCK_STEPS.
      // The first one prints all headers, waits once, then prints all results.
      // Non-first parallel steps hit `continue` and are skipped.
      const parallelSteps = MOCK_STEPS.filter(s => s.parallel && s.delay === step.delay);
      if (step === parallelSteps[0]) {
        // Print all parallel step headers
        for (const ps of parallelSteps) {
          const marker = parallelSteps.length > 1 ? '  ← 并行' : '';
          console.log(`\n  ── [${MOCK_STEPS.indexOf(ps) + 1}/${totalSteps}] ${ps.id} (${ps.roleName}) ──${marker}`);
        }
        await sleep(step.delay);
        for (const ps of parallelSteps) {
          console.log(`  Done | ${(ps.delay / 1000).toFixed(1)}s | mock`);
        }
      }
      // Skip non-first parallel steps (already handled)
      continue;
    }

    console.log(`\n  ── [${MOCK_STEPS.indexOf(step) + 1}/${totalSteps}] ${step.id} (${step.roleName}) ──`);
    await sleep(step.delay);
    console.log(`  Done | ${(step.delay / 1000).toFixed(1)}s | mock`);
  }
}

// ─── Phase 2: Ask for real run ───

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

// ─── Main Entry ───

export async function runDemo(): Promise<void> {
  console.log(`
  🎬 Agency Orchestrator Demo
  ${'─'.repeat(40)}

  Phase 1: 模拟演示（无需 API Key）

  Workflow: 短篇小说创作
  Premise: "${DEMO_PREMISE}"
  Steps: 4 | Roles: 叙事学家, 心理学家, 叙事设计师, 内容创作者
  ${'─'.repeat(40)}`);

  // Phase 1: Mock replay
  await replayMockSteps();

  console.log(`
  ${'═'.repeat(40)}
  ✅ 4 个角色协作完成 | ~5.0s (mock)
  ${'═'.repeat(40)}`);

  // Show story preview (last step output, truncated)
  const story = MOCK_STEPS[MOCK_STEPS.length - 1].output;
  const previewLines = story.split('\n').slice(0, 8);
  console.log(`
  📖 故事预览:
  ${'─'.repeat(20)}`);
  for (const line of previewLines) {
    console.log(`  ${line}`);
  }
  console.log(`  ...（共 ${story.length} 字）`);

  // Phase 2: Real LLM
  console.log(`\n  ${'─'.repeat(40)}`);
  console.log('  Phase 2: 用真实 AI 运行？\n');

  // Skip Phase 2 if not interactive
  if (!process.stdin.isTTY) {
    console.log('  （非交互环境，跳过 Phase 2）');
    console.log('  试试: ao run workflows/story-creation.yaml -i premise="你的故事创意"');
    return;
  }

  const llms = await detectAvailableLLMs();
  console.log('  检测到:');
  for (const llm of llms) {
    const icon = llm.available ? '✅' : '❌';
    const hint = !llm.available && llm.envVar ? ` (需设置 ${llm.envVar})` : '';
    console.log(`    ${icon} ${llm.name}${hint}`);
  }

  const available = llms.filter(l => l.available);
  if (available.length === 0) {
    console.log('\n  未检测到可用的 LLM。请设置 API key 后重试:');
    console.log('    export DEEPSEEK_API_KEY=your-key');
    console.log('    ao run workflows/story-creation.yaml -i premise="你的故事创意"\n');
    return;
  }

  // Pick provider
  let selectedProvider: DetectedLLM;
  if (available.length === 1) {
    selectedProvider = available[0];
  } else {
    console.log('\n  可用的 LLM:');
    available.forEach((llm, i) => console.log(`    ${i + 1}) ${llm.name}`));
    const choice = await askQuestion(`\n  选择 (1-${available.length}, 默认 1): `);
    const idx = parseInt(choice) - 1;
    selectedProvider = available[idx >= 0 && idx < available.length ? idx : 0];
  }

  const answer = await askQuestion(`\n  用 ${selectedProvider.name} 运行真实版本？(y/N) `);
  if (answer !== 'y' && answer !== 'yes') {
    console.log('\n  跳过。试试:');
    console.log('    ao run workflows/story-creation.yaml -i premise="你的故事创意"\n');
    return;
  }

  // Run real workflow
  console.log(`\n  🚀 使用 ${selectedProvider.name} 运行...\n`);

  const { run } = await import('../index.js');
  const workflowPath = resolveWorkflowPath();

  const modelMap: Record<string, string> = {
    deepseek: 'deepseek-chat',
    claude: 'claude-sonnet-4-20250514',
    openai: 'gpt-4o',
    ollama: 'qwen2.5:7b',
  };

  await run(workflowPath, { premise: DEMO_PREMISE }, {
    llmOverride: {
      provider: selectedProvider.provider,
      model: modelMap[selectedProvider.provider] || 'deepseek-chat',
    },
  });
}
