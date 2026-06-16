import type { Language } from "@/i18n/translations";

export type LocalizedText = Record<Language, string>;

export type TutorialCategory = "start" | "practice" | "integration" | "troubleshoot" | "video";
export type TutorialSource = "official" | "community";

export interface TutorialSection {
  heading: LocalizedText;
  /** markdown 正文 */
  body: LocalizedText;
  /** 可选代码块（命令 / YAML），语言无关，不本地化 */
  code?: string;
}

export interface Tutorial {
  slug: string;
  category: TutorialCategory;
  source: TutorialSource;
  author: string;
  /** 阅读时长（纯数字，单位在展示层拼） */
  min: string;
  /** 卡头渐变配色（tailwind 类） */
  accent: string;
  /** 卡头展示的图标 emoji */
  icons: string[];
  /** 是否外站文章 */
  external?: boolean;
  title: LocalizedText;
  summary: LocalizedText;
  sections: TutorialSection[];
}

export const tutorials: Tutorial[] = [
  {
    slug: "agency-agents",
    category: "start",
    source: "official",
    author: "AO Team",
    min: "6",
    accent: "from-violet-200 to-purple-200 dark:from-violet-500/20 dark:to-purple-500/20",
    icons: ["🎭", "🤝"],
    title: { zh: "玩转 agency-agents 专家库", en: "Master the agency-agents library" },
    summary: {
      zh: "agency-agents 是 AO 的主角——216 位 AI 专家。这篇讲清：库随 AO 自带、怎么搜专家、怎么让专家协作、怎么加自己的专家。",
      en: "agency-agents is the star of AO — 216 AI experts. Learn how the library ships with AO, how to search experts, put them to work, and add your own.",
    },
    sections: [
      {
        heading: { zh: "1. 装 AO 就自带，无需单独安装", en: "1. Bundled with AO — no separate install" },
        body: {
          zh: "agency-agents 是 AO 的依赖（`agency-agents-zh`），全局安装 AO 时会一并装好——你不用再单独安装或克隆。`ao roles` 能列出 216 位专家，就说明库已就绪。",
          en: "agency-agents is a dependency of AO (`agency-agents-zh`), installed automatically when you install AO globally — no separate install or clone. If `ao roles` lists 216 experts, the library is ready.",
        },
        code: "npm i -g agency-orchestrator\nao roles            # 应列出 216 位专家",
      },
      {
        heading: { zh: "2. 搜专家", en: "2. Search experts" },
        body: {
          zh: "216 位不用一个个翻。`ao roles <关键词>` 在 agency-agents 全库按 路径/名称/描述 搜索（不区分大小写）：",
          en: "No need to scroll all 216. `ao roles <keyword>` searches the whole agency-agents library by path / name / description (case-insensitive):",
        },
        code: "ao roles seo        # 找 SEO 相关专家\nao roles 小红书     # 找小红书相关专家",
      },
      {
        heading: { zh: "3. 让专家协作", en: "3. Put experts to work together" },
        body: {
          zh: "最省事是一句话 `compose`——AO 自动从库里选专家、排 DAG、生成并运行；也可以在 YAML 的 step 里用 `category/role-name` 手动指定。",
          en: "The easiest is a one-sentence `compose` — AO auto-picks experts from the library, designs the DAG, generates and runs; or name `category/role-name` in a YAML step manually.",
        },
        code: 'ao compose "调研一个细分市场并写一份进入策略" --run',
      },
      {
        heading: { zh: "4. 加自己的专家", en: "4. Add your own experts" },
        body: {
          zh: "专家库可扩展。把你自己的专家写成同样格式的 `.md`（frontmatter + 系统提示词）放进一个目录，用 `--agents-dir`（或工作流顶层 `agents_dir`）指向它，AO 就会从那里加载——可补充 agency-agents，也可完全用私有专家库。",
          en: "The library is extensible. Write your own expert as a `.md` (frontmatter + system prompt), put it in a folder, and point `--agents-dir` (or the workflow's `agents_dir`) at it — alongside or instead of agency-agents.",
        },
        code: "ao roles --agents-dir ./my-agents\nao run workflow.yaml --agents-dir ./my-agents",
      },
    ],
  },
  {
    slug: "first-workflow",
    category: "start",
    source: "official",
    author: "AO Team",
    min: "5",
    accent: "from-sky-200 to-indigo-200 dark:from-sky-500/20 dark:to-indigo-500/20",
    icons: ["⚡", "🤖"],
    title: { zh: "5 分钟跑通第一个工作流", en: "Run your first workflow in 5 minutes" },
    summary: {
      zh: "从安装到一句话生成并运行一个多智能体工作流，看多个 AI 角色并行协作产出完整方案。",
      en: "From install to generating and running a multi-agent workflow with one sentence — watch AI roles collaborate into a full plan.",
    },
    sections: [
      {
        heading: { zh: "1. 安装", en: "1. Install" },
        body: {
          zh: "需要 Node.js 18+。全局安装后即可使用 `ao` 命令：",
          en: "Requires Node.js 18+. Install globally to get the `ao` command:",
        },
        code: "npm i -g agency-orchestrator\nao --version",
      },
      {
        heading: { zh: "2. 一句话生成并运行", en: "2. Compose and run in one sentence" },
        body: {
          zh: "`ao compose` 会根据你的一句话需求自动选角、设计 DAG、生成工作流；加 `--run` 直接执行。无需手写 YAML：",
          en: "`ao compose` picks roles, designs the DAG, and generates a workflow from your sentence; add `--run` to execute it right away. No YAML needed:",
        },
        code: 'ao compose "我想做一档讲城市冷知识的播客，帮我做完整的选题和脚本规划" --run',
      },
      {
        heading: { zh: "3. 看产出 & 继续迭代", en: "3. Read the output & iterate" },
        body: {
          zh: "运行结束后，所有步骤产物保存在 `ao-output/<name>-<timestamp>/`。觉得某一步不够好，不用从头重跑——用 `--resume` 只重跑那一步往后的部分（见下一篇攻略）。",
          en: "When it finishes, every step's output is saved to `ao-output/<name>-<timestamp>/`. If one step isn't good enough, you don't need to rerun everything — use `--resume` to rerun only from that step onward (see the next tutorial).",
        },
      },
    ],
  },
  {
    slug: "resume-and-feedback",
    category: "practice",
    source: "official",
    author: "AO Team",
    min: "10",
    accent: "from-amber-200 to-orange-200 dark:from-amber-500/20 dark:to-orange-500/20",
    icons: ["♻️"],
    title: { zh: "断点续跑 + 对话式返工", en: "Resume from a step + revise with feedback" },
    summary: {
      zh: "只重跑某一步往后的部分，或带着具体意见让专家在上一版基础上改，而不是从零重写。",
      en: "Rerun only from a chosen step, or hand the expert your note plus its previous draft so it revises instead of rewriting.",
    },
    sections: [
      {
        heading: { zh: "从某一步重跑", en: "Resume from a step" },
        body: {
          zh: "`--resume last` 复用上一次运行的所有上游产物，`--from <step-id>` 指定从哪一步开始重跑，下游步骤会自动跟着重算：",
          en: "`--resume last` reuses all upstream outputs from the last run; `--from <step-id>` picks where to restart. Downstream steps recompute automatically:",
        },
        code: "ao run workflow.yaml --resume last --from write_story",
      },
      {
        heading: { zh: "带意见返工（不是从零重写）", en: "Revise in place with a note" },
        body: {
          zh: "`--resume --from` 是**从头重跑**那一步。如果你只是有一条具体意见（「结尾太平」「预算太高」），用 `--feedback`：它把**上一版产出 + 你的意见**一起交给专家，让它在草稿上改。`--feedback` 省略 `--resume` 时默认 `--resume last`，但必须配 `--from`：",
          en: "`--resume --from` reruns the step **from scratch**. When you have a specific note ('ending too flat', 'budget too high'), use `--feedback`: it hands the expert its **previous output + your note** so it edits the draft. `--feedback` implies `--resume last` and requires `--from`:",
        },
        code: 'ao run workflow.yaml --from write_story --feedback "结尾太仓促，把高潮再铺垫一段"',
      },
      {
        heading: { zh: "先读产物再决定改哪步", en: "Read outputs before deciding" },
        body: {
          zh: "改之前先看 `ao-output/` 里最新一次运行的 `metadata.json`（步骤 id 与状态）和 `steps/` 下的具体产物，确认要从哪一步动手最划算。",
          en: "Before revising, check the latest run dir under `ao-output/`: `metadata.json` for step ids/states and the files under `steps/`, to decide which step to restart from.",
        },
      },
    ],
  },
  {
    slug: "dag-and-loop",
    category: "practice",
    source: "official",
    author: "AO Team",
    min: "15",
    accent: "from-emerald-200 to-teal-200 dark:from-emerald-500/20 dark:to-teal-500/20",
    icons: ["🔀", "🔁"],
    title: { zh: "手写 YAML：DAG 并行 + 循环评审", en: "Hand-write YAML: DAG parallelism + review loop" },
    summary: {
      zh: "用 depends_on 表达依赖让引擎自动并行，用 loop 块做「写作 → 评审 → 按意见重写」直到达标退出。",
      en: "Express dependencies with depends_on for automatic parallelism, and use a loop block for write → review → rewrite until it passes.",
    },
    sections: [
      {
        heading: { zh: "DAG：声明依赖，自动并行", en: "DAG: declare deps, run in parallel" },
        body: {
          zh: "每个步骤用 `depends_on` 声明它依赖哪些步骤，引擎据此自动排出 DAG 并把互不依赖的步骤并行跑。下面 `outline` 完成后，`draft_a` 和 `draft_b` 会并行：",
          en: "Each step declares its dependencies via `depends_on`; the engine derives the DAG and runs independent steps in parallel. Below, after `outline`, `draft_a` and `draft_b` run concurrently:",
        },
        code: `steps:
  - id: outline
    role: "engineering/engineering-technical-writer"
    task: "为主题《{{topic}}》写一个分章大纲"
    output: outline
  - id: draft_a
    role: "marketing/marketing-content-creator"
    task: "按大纲写第一部分：{{outline}}"
    depends_on: [outline]
  - id: draft_b
    role: "marketing/marketing-content-creator"
    task: "按大纲写第二部分：{{outline}}"
    depends_on: [outline]`,
      },
      {
        heading: { zh: "循环：写 → 评审 → 重写", en: "Loop: write → review → rewrite" },
        body: {
          zh: "`loop` 块放在循环的**最后一步**，`back_to` 指回起点，`exit_condition` 命中就退出（注意：exit_condition 不能引用循环自身这一步的输出）：",
          en: "Put the `loop` block on the **last step** of the loop; `back_to` points to the start, and `exit_condition` ends it once matched (note: exit_condition can't reference this same step's own output):",
        },
        code: `  - id: review
    role: "product/product-feedback-synthesizer"
    task: "评审这版草稿，给出修改意见或写「通过」：{{draft}}"
    output: review
    loop:
      back_to: write
      max_iterations: 3
      exit_condition: "{{review}} contains 通过"`,
      },
      {
        heading: { zh: "跑之前先校验", en: "Validate before running" },
        body: {
          zh: "用 `ao validate` 只校验不运行，用 `ao plan` 看引擎排出的 DAG 执行计划，确认并行/依赖符合预期再跑：",
          en: "Use `ao validate` to check without running, and `ao plan` to see the engine's DAG execution plan before you run:",
        },
        code: "ao validate workflow.yaml\nao plan workflow.yaml",
      },
    ],
  },
  {
    slug: "deepseek-cost",
    category: "practice",
    source: "official",
    author: "AO Team",
    min: "8",
    accent: "from-rose-200 to-fuchsia-200 dark:from-rose-500/20 dark:to-fuchsia-500/20",
    icons: ["💰"],
    title: { zh: "控制成本：选对 provider 与避坑", en: "Control cost: pick the right provider" },
    summary: {
      zh: "怎么配 provider 把成本压到最低、同时避开长输出被切断的超时坑。",
      en: "How to configure the provider for minimal cost while avoiding long-output timeout pitfalls.",
    },
    sections: [
      {
        heading: { zh: "顶层 llm 配置", en: "Top-level llm config" },
        body: {
          zh: "工作流顶层用 `llm` 指定 provider 与 model。选一个性价比合适的有能力模型即可——盲评显示，正是在中等价位的有能力模型这一档上，多智能体协作明显优于单次 prompt：",
          en: "Set the provider and model at the workflow's top-level `llm`. Pick a capable, cost-effective model — blind evals show that on a capable mid-tier model, multi-agent collaboration clearly beats a one-shot prompt:",
        },
        code: `llm:
  provider: "deepseek"
  model: "deepseek-chat"

concurrency: 2`,
      },
      {
        heading: { zh: "命令行临时覆盖", en: "Override from the CLI" },
        body: {
          zh: "不想改 YAML 时，用 `--provider` 临时切换 provider；零成本起步还可以用 CLI / 本地模型等免 key 方式（claude-code CLI、Ollama 本地等）。",
          en: "Without editing YAML, switch providers on the fly with `--provider`; to start at zero cost, use key-free paths such as the claude-code CLI or local Ollama.",
        },
        code: "ao run workflow.yaml --provider deepseek",
      },
      {
        heading: { zh: "避开超时坑", en: "Avoid the timeout pitfall" },
        body: {
          zh: "DeepSeek 服务端约 60s 会切断长流式输出。单步任务太大时，要么把任务拆成多步，要么用 `--timeout` 调整单步超时（支持 `300s` / `5m` 这类写法）。",
          en: "DeepSeek's server cuts long streaming responses at ~60s. When a single step is too large, split it into multiple steps or adjust the per-step timeout with `--timeout` (accepts forms like `300s` / `5m`).",
        },
        code: "ao run workflow.yaml --timeout 5m",
      },
    ],
  },
];

export function tutorialBySlug(slug: string): Tutorial | undefined {
  return tutorials.find((t) => t.slug === slug);
}

/** 数据里实际出现过的分类（用于渲染筛选按钮，避免空筛选） */
export function tutorialCategories(): TutorialCategory[] {
  const order: TutorialCategory[] = ["start", "practice", "integration", "troubleshoot", "video"];
  const present = new Set(tutorials.map((t) => t.category));
  return order.filter((c) => present.has(c));
}

export function tutorialSources(): TutorialSource[] {
  const order: TutorialSource[] = ["official", "community"];
  const present = new Set(tutorials.map((t) => t.source));
  return order.filter((s) => present.has(s));
}
