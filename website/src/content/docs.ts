import type { Language } from "@/i18n/translations";

export type LocalizedText = Record<Language, string>;

export interface DocSection {
  heading: LocalizedText;
  /** markdown 正文 */
  body: LocalizedText;
  /** 可选代码块 */
  code?: string;
}

export interface DocPage {
  slug: string;
  title: LocalizedText;
  sections: DocSection[];
}

export interface DocGroup {
  /** 图标 emoji */
  icon: string;
  label: LocalizedText;
  pages: DocPage[];
}

export const docGroups: DocGroup[] = [
  {
    icon: "🚀",
    label: { zh: "快速入门", en: "Getting started" },
    pages: [
      {
        slug: "intro",
        title: { zh: "软件介绍", en: "Introduction" },
        sections: [
          {
            heading: { zh: "什么是 Agency Orchestrator", en: "What is Agency Orchestrator" },
            body: {
              zh: "Agency Orchestrator（`ao`）是 **agency-agents 专家角色库的编排器**。\n\nagency-agents 里有 211 位打磨好的 AI 专家——营销、工程、设计、产品、财务、法律、销售、学术……每一位都是一段精调过的系统提示词，让模型稳定地以该领域专家的身份输出。但单独一位专家只能解决一个环节；真实任务往往要**多位专家分工协作**：研究员先调研、分析师再拆解、撰稿人成文、收口角色把关。\n\nAO 就是把这些专家组队起来的那一层：你用一句话或一份 YAML 描述需求，AO 自动选出合适的专家、按依赖关系排成 DAG、并行执行、在专家之间传递产出，几分钟交付一份完整方案。**你来用 agency-agents 的专家，AO 让「用专家」这件事零门槛。**",
              en: "Agency Orchestrator (`ao`) is **the orchestrator for the agency-agents expert library**.\n\nagency-agents ships 211 finely-tuned AI experts — marketing, engineering, design, product, finance, legal, sales, academic… each a carefully crafted system prompt that makes a model reliably act as that domain expert. But one expert only handles one step; real tasks need **several experts working together**: a researcher scopes it, an analyst breaks it down, a writer drafts it, a finalizer reviews.\n\nAO is the layer that teams them up: describe your need in one sentence or a YAML file, and AO picks the right experts, arranges them into a DAG by dependency, runs them in parallel, passes outputs between them, and delivers a full plan in minutes. **You come to use agency-agents' experts; AO makes using them effortless.**",
            },
          },
          {
            heading: { zh: "解决什么问题", en: "What problems it solves" },
            body: {
              zh: "- **让 agency-agents 的专家真正协作起来**：单个专家只解决一个环节，AO 让多位专家按 DAG 分工、并行、交接\n- 单次 prompt 难以覆盖复杂任务，多专家分工 + 收口质量更高\n- 不想写编排代码：用 YAML 声明依赖，引擎自动并行；或一句话 `compose` 自动选专家、生成并运行\n- 211 位专家覆盖营销、工程、设计、产品、财务、法律、销售、学术等领域\n- 10 个 provider，7 个免 API key",
              en: "- **Make agency-agents' experts actually collaborate**: one expert handles one step; AO has many experts divide work, run in parallel, and hand off via a DAG\n- A single prompt struggles with complex tasks; multi-expert division + a finalizer yields higher quality\n- No orchestration code: declare dependencies in YAML, or `compose` from one sentence to auto-pick experts, generate and run\n- 211 experts across marketing, engineering, design, product, finance, legal, sales, academic, and more\n- 10 providers, 7 of them need no API key",
            },
          },
          {
            heading: { zh: "两种用法", en: "Two ways to use it" },
            body: {
              zh: "1. **一句话 compose（推荐新手）**：描述需求，AO 自动选专家、生成并运行工作流。\n2. **手写 YAML（推荐进阶）**：自己定义角色、任务、依赖、循环，完全可控、可版本管理。\n\n两种都用同一个引擎执行，产物都落盘到 `ao-output/`，都能断点续跑与返工。",
              en: "1. **One-sentence compose (great for beginners)**: describe the need, AO picks experts, generates and runs the workflow.\n2. **Hand-written YAML (for power users)**: define roles, tasks, dependencies, and loops yourself — fully controllable and versionable.\n\nBoth run on the same engine, save outputs to `ao-output/`, and support resume and rework.",
            },
          },
        ],
      },
      {
        slug: "install",
        title: { zh: "安装", en: "Install" },
        sections: [
          {
            heading: { zh: "全局安装", en: "Global install" },
            body: {
              zh: "需要 Node.js 18+。全局安装后即可在任意目录使用 `ao` 命令：",
              en: "Requires Node.js 18+. Install globally to use the `ao` command anywhere:",
            },
            code: "npm i -g agency-orchestrator\nao --version",
          },
          {
            heading: { zh: "验证与升级", en: "Verify & upgrade" },
            body: {
              zh: "`ao roles` 能列出 211 位专家，说明专家库已正确加载。需要升级时重新全局安装即可：",
              en: "`ao roles` lists all 211 experts — if it works, the library loaded correctly. To upgrade, reinstall globally:",
            },
            code: "ao roles            # 验证专家库\nnpm i -g agency-orchestrator@latest   # 升级",
          },
          {
            heading: { zh: "无需 API Key 起步", en: "Start without an API key" },
            body: {
              zh: "不想配 key 也能跑：AO 支持 claude-code CLI、gemini-cli、Ollama 本地模型等 7 种免 key 方式。装好对应 CLI 或本地模型后，用 `--provider` 指定即可。",
              en: "No key needed to start: AO supports 7 key-free paths such as the claude-code CLI, gemini-cli, and local Ollama. Install the CLI or local model, then point to it with `--provider`.",
            },
          },
        ],
      },
      {
        slug: "compose",
        title: { zh: "一句话编排（推荐）", en: "Compose (recommended)" },
        sections: [
          {
            heading: { zh: "compose --run", en: "compose --run" },
            body: {
              zh: "最快上手方式：一句话描述需求，AO 自动选角、设计 DAG、生成并**直接运行**工作流。",
              en: "The fastest start: describe your need; AO picks experts, designs the DAG, generates and **runs** the workflow.",
            },
            code: 'ao compose "我是程序员，想用 AI 做自媒体副业，目标月入 2 万，帮我做完整规划" --run',
          },
          {
            heading: { zh: "先生成、后运行", en: "Generate first, run later" },
            body: {
              zh: "去掉 `--run` 时，AO 只**生成 YAML 工作流并保存**，不立即执行。你可以先打开生成的 YAML 检查 / 微调专家与任务，确认无误后再 `ao run` 跑：",
              en: "Without `--run`, AO only **generates and saves the YAML workflow** without executing. Open it to review / tweak the experts and tasks, then run it with `ao run`:",
            },
            code: 'ao compose "为新品做一套发布物料"\n# 检查生成的 yaml 后\nao run <生成的工作流.yaml>',
          },
          {
            heading: { zh: "为什么 compose 有效", en: "Why compose works" },
            body: {
              zh: "compose 底层也是一次 LLM 调用——它读取 211 位专家的能力清单，按你的需求挑人、排依赖。生成质量取决于底层模型能力，建议用有能力的模型跑 compose。生成的 DAG 是**确定性**执行的：谁先谁后、谁并行由依赖图决定，不靠模型即兴。",
              en: "compose is itself an LLM call — it reads the 211 experts' capabilities and picks/sequences them for your need. Generation quality depends on the underlying model, so use a capable one for compose. The generated DAG executes **deterministically**: order and parallelism come from the dependency graph, not improvisation.",
            },
          },
        ],
      },
      {
        slug: "run",
        title: { zh: "运行工作流", en: "Run a workflow" },
        sections: [
          {
            heading: { zh: "run / validate / plan", en: "run / validate / plan" },
            body: {
              zh: "把工作流写成 YAML，或用内置模板直接跑。`validate` 只校验不运行，`plan` 看引擎排出的 DAG 执行计划。",
              en: "Write a workflow as YAML, or run a built-in template. `validate` checks without running; `plan` shows the engine's DAG execution plan.",
            },
            code: "ao run workflows/story-creation.yaml\nao validate workflow.yaml   # 只校验不运行\nao plan workflow.yaml        # 看 DAG 执行计划",
          },
          {
            heading: { zh: "常用选项", en: "Common options" },
            body: {
              zh: "- `--provider <name>`：临时覆盖 provider，不改 YAML\n- `--timeout <值>`：单步超时，支持 `300s` / `5m`（API 默认 300s，本地/CLI 600s）\n- `--resume last --from <step>`：从某步重跑（见「迭代优化」）\n- `--feedback \"意见\"`：带意见返工某一步",
              en: "- `--provider <name>`: override the provider without editing YAML\n- `--timeout <value>`: per-step timeout, accepts `300s` / `5m` (API default 300s, local/CLI 600s)\n- `--resume last --from <step>`: rerun from a step (see Iterate)\n- `--feedback \"note\"`: revise a step with a note",
            },
            code: "ao run workflow.yaml --provider deepseek --timeout 5m",
          },
          {
            heading: { zh: "产物去哪了", en: "Where outputs go" },
            body: {
              zh: "每次运行的所有步骤产物保存在 `ao-output/<name>-<timestamp>/`：`metadata.json` 记录步骤 id 与状态，`steps/` 下是每一步的具体产出。这套产物是断点续跑和返工的基础。",
              en: "Every run saves all step outputs to `ao-output/<name>-<timestamp>/`: `metadata.json` holds step ids and states, and `steps/` has each step's output. These artifacts power resume and rework.",
            },
          },
        ],
      },
    ],
  },
  {
    icon: "🧩",
    label: { zh: "工作流 YAML", en: "Workflow YAML" },
    pages: [
      {
        slug: "yaml-structure",
        title: { zh: "YAML 结构", en: "YAML structure" },
        sections: [
          {
            heading: { zh: "最小骨架", en: "Minimal skeleton" },
            body: {
              zh: "一个工作流 = 顶层配置（`llm` 必填）+ `steps`。每个 step 指定角色、任务、输出变量。任务里用 `{{变量}}` 引用上游产出或输入。",
              en: "A workflow = top-level config (`llm` required) + `steps`. Each step has a role, a task, and an output variable. Reference upstream outputs or inputs with `{{var}}` in the task.",
            },
            code: `name: "我的工作流"
agents_dir: "agency-agents-zh"
llm:
  provider: "deepseek"
  model: "deepseek-chat"
concurrency: 2
inputs:
  - name: topic
    required: true
steps:
  - id: research
    role: "product/product-trend-researcher"
    task: "调研 {{topic}} 的市场"
    output: research`,
          },
          {
            heading: { zh: "字段说明", en: "Field reference" },
            body: {
              zh: "- `id`：步骤唯一标识，被 `depends_on` 引用\n- `role`：专家，格式 `category/role-name`\n- `task`：任务描述，可用 `{{变量}}` 插值\n- `output`：把本步产出存成变量，供下游引用\n- `depends_on`：依赖的步骤数组，决定 DAG\n- `condition`：条件执行（见「循环与条件」）\n- `loop`：循环块（见「循环与条件」）",
              en: "- `id`: unique step id, referenced by `depends_on`\n- `role`: an expert, as `category/role-name`\n- `task`: the task, with `{{var}}` interpolation\n- `output`: save this step's output as a variable for downstream\n- `depends_on`: array of step deps, defines the DAG\n- `condition`: conditional execution (see Loops & conditions)\n- `loop`: loop block (see Loops & conditions)",
            },
          },
          {
            heading: { zh: "inputs 与变量", en: "Inputs & variables" },
            body: {
              zh: "顶层 `inputs` 声明运行时需要的输入，运行时通过 CLI 提供。任务里用 `{{name}}` 引用 inputs 或任意上游步骤的 `output`。",
              en: "Top-level `inputs` declares runtime inputs, provided via the CLI. Reference inputs or any upstream step's `output` with `{{name}}` in a task.",
            },
          },
        ],
      },
      {
        slug: "dag",
        title: { zh: "DAG 与依赖", en: "DAG & dependencies" },
        sections: [
          {
            heading: { zh: "depends_on 自动并行", en: "depends_on auto-parallelism" },
            body: {
              zh: "用 `depends_on` 声明依赖，引擎据此排出 DAG，把互不依赖的步骤自动并行跑。下面 `outline` 完成后，`draft_a` 和 `draft_b` 会并行：",
              en: "Declare dependencies with `depends_on`; the engine derives the DAG and runs independent steps in parallel. Below, after `outline`, `draft_a` and `draft_b` run concurrently:",
            },
            code: `  - id: draft_a
    role: "marketing/marketing-content-creator"
    task: "按大纲写第一章：{{outline}}"
    depends_on: [outline]
  - id: draft_b
    role: "marketing/marketing-content-creator"
    task: "按大纲写第二章：{{outline}}"
    depends_on: [outline]`,
          },
          {
            heading: { zh: "concurrency 控制并发", en: "concurrency caps parallelism" },
            body: {
              zh: "顶层 `concurrency` 决定最大同时运行的步骤数。并发越高越快，但对 API 速率/成本压力更大；本地模型受显存限制建议调低。先用 `ao plan` 看清并行结构再调。",
              en: "Top-level `concurrency` caps how many steps run at once. Higher is faster but pressures API rate limits/cost; lower it for local models bound by VRAM. Use `ao plan` to see the parallel structure first.",
            },
            code: "concurrency: 2",
          },
          {
            heading: { zh: "确定性调度", en: "Deterministic scheduling" },
            body: {
              zh: "DAG 调度是**确定性**的——谁先谁后、谁并行完全由依赖图决定，不靠模型即兴发挥。所以「调度不准」通常是 YAML 的 `depends_on` 没配对，而不是引擎随机。",
              en: "DAG scheduling is **deterministic** — order and parallelism come entirely from the dependency graph, not model improvisation. So 'wrong scheduling' is usually a `depends_on` mistake in YAML, not engine randomness.",
            },
          },
        ],
      },
      {
        slug: "loop-condition",
        title: { zh: "循环与条件", en: "Loops & conditions" },
        sections: [
          {
            heading: { zh: "loop 块", en: "loop block" },
            body: {
              zh: "`loop` 块放在循环的**最后一步**，`back_to` 指回起点，`exit_condition` 命中就退出，`max_iterations` 兜底。注意：`exit_condition` 不能引用循环自身这一步的输出。",
              en: "Put the `loop` block on the **last step** of the loop; `back_to` points to the start, `exit_condition` ends it, `max_iterations` is the safety cap. Note: `exit_condition` cannot reference this step's own output.",
            },
            code: `  - id: review
    role: "product/product-feedback-synthesizer"
    task: "评审草稿，给出意见或写「通过」：{{draft}}"
    output: review
    loop:
      back_to: write
      max_iterations: 3
      exit_condition: "{{review}} contains 通过"`,
          },
          {
            heading: { zh: "condition 条件分支", en: "condition branching" },
            body: {
              zh: "用 `condition` 让某步按上游产出有条件地执行；不满足时跳过该步及其下游。",
              en: "Use `condition` to run a step only when an upstream output matches; otherwise the step (and its downstream) is skipped.",
            },
            code: 'condition: "{{review}} contains 需要修改"',
          },
        ],
      },
    ],
  },
  {
    icon: "🔁",
    label: { zh: "迭代优化", en: "Iterate" },
    pages: [
      {
        slug: "resume",
        title: { zh: "断点续跑", en: "Resume" },
        sections: [
          {
            heading: { zh: "--resume --from", en: "--resume --from" },
            body: {
              zh: "只想改某一步时，复用上一次运行的所有上游产物，从该步往后重跑，下游自动跟着重算——不浪费已经跑好的 token。",
              en: "To revise one step, reuse all upstream outputs from the last run and rerun from that step onward; downstream recomputes automatically — no wasted tokens.",
            },
            code: "ao run workflow.yaml --resume last --from character_design",
          },
          {
            heading: { zh: "先读产物再决定", en: "Read outputs first" },
            body: {
              zh: "改之前先看最新一次运行目录：`metadata.json` 看步骤 id 与状态，`steps/` 看具体产出，确认从哪一步动手最划算。`--resume last` 指向最近一次运行。",
              en: "Before revising, inspect the latest run dir: `metadata.json` for step ids/states, `steps/` for outputs — to pick the most efficient restart point. `--resume last` points to the most recent run.",
            },
          },
        ],
      },
      {
        slug: "feedback",
        title: { zh: "对话式返工", en: "Feedback rework" },
        sections: [
          {
            heading: { zh: "--feedback", en: "--feedback" },
            body: {
              zh: "`--resume --from` 是**从头重跑**那一步。如果你只是有一条具体意见（「结尾太平」「预算太高」），用 `--feedback`：它把**上一版产出 + 你的意见**交给专家，让它在草稿上改，而不是推倒重写。",
              en: "`--resume --from` reruns a step **from scratch**. When you have a specific note ('ending too flat', 'budget too high'), use `--feedback`: it hands the expert its **previous output + your note** to revise the draft instead of rewriting.",
            },
            code: 'ao run workflow.yaml --from write_story --feedback "结尾太仓促，再铺垫一段"',
          },
          {
            heading: { zh: "用法要点", en: "Notes" },
            body: {
              zh: "- `--feedback` 省略 `--resume` 时默认 `--resume last`\n- 必须配 `--from` 指定要改哪一步\n- 改完后下游步骤自动用新产出重跑",
              en: "- `--feedback` implies `--resume last` when `--resume` is omitted\n- Requires `--from` to pick the step\n- Downstream steps automatically rerun with the revised output",
            },
          },
        ],
      },
    ],
  },
  {
    icon: "🎭",
    label: { zh: "专家与 Provider", en: "Experts & providers" },
    pages: [
      {
        slug: "roles",
        title: { zh: "专家角色库 agency-agents", en: "Expert library: agency-agents" },
        sections: [
          {
            heading: { zh: "agency-agents 是什么", en: "What is agency-agents" },
            body: {
              zh: "agency-agents 是一套开源的 **AI 专家角色库**，收录了 211 位打磨好的专家。每一位专家是一个带 frontmatter 的 `.md` 文件，核心是一段精心调过的系统提示词——它约束模型的身份、视角、输出格式与专业边界，让模型稳定地以「市场研究员」「资深编辑」「财务分析师」「风控专家」等真实身份产出，而不是泛泛而谈的通用助手。\n\n角色按领域分门别类，覆盖营销、工程、设计、产品、财务、法律、销售、学术、项目管理、客服、测试等领域。AO 默认从 `node_modules/agency-agents-zh`（或仓库同级目录）加载这套库。",
              en: "agency-agents is an open-source **library of AI expert roles** — 211 finely-tuned experts. Each expert is a `.md` file with frontmatter, centered on a carefully tuned system prompt that fixes the model's identity, perspective, output format, and domain boundaries — so the model reliably acts as a 'trend researcher', 'technical writer', 'financial analyst', 'narratologist', etc., instead of a generic assistant.\n\nRoles are organized by domain across marketing, engineering, design, product, finance, legal, sales, academic, project management, support, testing, and more. AO loads this library from `node_modules/agency-agents-zh` (or a sibling repo) by default.",
            },
            code: "ao roles   # 列出全部 211 位专家",
          },
          {
            heading: { zh: "AO 与 agency-agents 的关系", en: "How AO and agency-agents relate" },
            body: {
              zh: "agency-agents 提供「专家」，AO 提供「让专家组队干活」的编排能力。绝大多数用户是冲着 agency-agents 的专家来的——AO 的价值，就是让你把这些专家一句话拉起来协作：`compose` 自动选专家、排 DAG、生成并运行工作流，几分钟拿到多专家协作的完整产出。",
              en: "agency-agents provides the experts; AO provides the orchestration that puts them to work as a team. Most users come for agency-agents' experts — AO's value is letting you spin them up to collaborate from a single sentence: `compose` auto-picks experts, arranges the DAG, generates and runs the workflow, delivering multi-expert output in minutes.",
            },
          },
          {
            heading: { zh: "在工作流里引用专家", en: "Reference an expert in a workflow" },
            body: {
              zh: "在 step 里用 `category/role-name` 指定专家；或者干脆用 `ao compose` 让 AO 替你选。",
              en: "In a step, name the expert as `category/role-name`; or just let `ao compose` pick for you.",
            },
            code: `steps:
  - id: research
    role: "product/product-trend-researcher"   # agency-agents 里的专家
    task: "调研 {{topic}} 的市场"
    output: research`,
          },
        ],
      },
      {
        slug: "providers",
        title: { zh: "Provider 配置", en: "Provider config" },
        sections: [
          {
            heading: { zh: "10 个 provider", en: "10 providers" },
            body: {
              zh: "顶层 `llm` 指定 provider 与 model，或用 `--provider` 临时覆盖。支持 DeepSeek / Claude / OpenAI / Gemini / Ollama 等 10 个 provider，按需求选择。",
              en: "Set provider/model at top-level `llm`, or override with `--provider`. 10 providers supported (DeepSeek / Claude / OpenAI / Gemini / Ollama…) — pick what fits.",
            },
            code: `llm:
  provider: "deepseek"
  model: "deepseek-chat"`,
          },
          {
            heading: { zh: "7 种免 key 方式", en: "7 key-free options" },
            body: {
              zh: "想零成本起步，不必配 API key：claude-code CLI、gemini-cli、openclaw-cli、Ollama 本地、LM Studio、免费聚合、演示模式都可用。装好对应 CLI / 本地模型后用 `--provider` 指定即可。",
              en: "To start at zero cost without an API key: the claude-code CLI, gemini-cli, openclaw-cli, local Ollama, LM Studio, free aggregators, and demo mode all work. Install the CLI / local model, then point to it with `--provider`.",
            },
            code: "ao run workflow.yaml --provider claude-code",
          },
          {
            heading: { zh: "模型能力很关键", en: "Model capability matters" },
            body: {
              zh: "盲评显示：在有能力的模型上，多专家协作明显优于单次 prompt；但本地小模型（如 llama3 8B 级）能力不足时，多角色交接反而会放大漂移。追求质量请用有能力的模型。",
              en: "Blind evals show: on a capable model, multi-expert collaboration clearly beats a one-shot prompt; but with weak local models (llama3 8B class), hand-offs amplify drift. For quality, use a capable model.",
            },
          },
        ],
      },
    ],
  },
];

export const docPages: DocPage[] = docGroups.flatMap((g) => g.pages);

export function docBySlug(slug: string): DocPage | undefined {
  return docPages.find((p) => p.slug === slug);
}

export const firstDocSlug = docPages[0]?.slug ?? "intro";
