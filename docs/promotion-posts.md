# Promotion Posts — Agency Orchestrator Ecosystem

---

## 1. Hacker News — Show HN (English)

**Title:** Show HN: Agency Orchestrator – Multi-agent workflows in YAML, 186 roles, zero code

**Body:**

Hi HN,

I built an open-source multi-agent orchestrator where you define AI collaboration workflows entirely in YAML. No Python, no framework boilerplate — just declare your steps and the engine handles DAG parallelism, variable passing, retries, and output management.

**Why I built this:** I was tired of writing hundreds of lines of Python just to get two AI agents to talk to each other. CrewAI and LangGraph are powerful, but the setup cost is absurd for most use cases. I wanted something where I could go from idea to running workflow in under 5 minutes.

**What it does:**

- Define multi-agent workflows in YAML — roles, tasks, dependencies, conditions, loops
- 186 ready-to-use AI role definitions (product manager, architect, UX researcher, SRE, content creator, etc.)
- Auto DAG parallelism — the engine detects which steps can run concurrently
- Condition branching (`contains`, `equals`, etc.) and declarative loops with exit conditions
- Resume any workflow from any step: `ao run workflow.yaml --resume last --from step_id`
- Native support for DeepSeek, Claude, OpenAI, and Ollama (local models)
- Works inside Claude Code / Cursor without an API key — uses the host tool's built-in LLM

**Comparison with existing tools:**

| | CrewAI | LangGraph | Agency Orchestrator |
|---|--------|-----------|---------------------|
| Language | Python | Python | YAML (zero code) |
| Roles | Write your own | Write your own | 186 ready-to-use |
| Dependencies | pip + LiteLLM + dozens | pip + LangChain | npm + 2 deps |
| Parallelism | Manager mode | Manual graph | Auto DAG detection |
| Branching | None | Manual | Condition expressions |
| Loops | None | Manual | Declarative loop/exit |
| Resume | None | Checkpointers | Built-in --resume + --from |
| Price | OSS + $25-99/mo cloud | OSS | Completely free |

**Quick example** — 4 AI roles collaborating to write a short story:

```yaml
steps:
  - id: structure
    role: "academic/academic-narratologist"
    task: "Design narrative structure for: {{premise}}"
    output: structure

  - id: characters
    role: "academic/academic-psychologist"
    task: "Design characters based on: {{structure}}"
    output: characters
    depends_on: [structure]

  - id: conflict
    role: "game-development/narrative-designer"
    task: "Design conflict scenes: {{structure}}"
    output: scenes
    depends_on: [structure]       # runs in parallel with characters

  - id: write
    role: "marketing/marketing-content-creator"
    task: "Write the story using: {{structure}} {{characters}} {{scenes}}"
    depends_on: [characters, conflict]
```

Steps 2 and 3 run in parallel automatically. Total: ~2 minutes, ~15K tokens on DeepSeek (cost: fractions of a cent).

GitHub: https://github.com/jnMetaCode/agency-orchestrator
npm: `npm install agency-orchestrator`

Happy to answer questions about the architecture or design decisions.

---

## 2. Reddit r/LocalLLaMA (English)

**Title:** I built a YAML-based multi-agent orchestrator with native Ollama support — run complex AI workflows 100% locally

**Body:**

Hey r/LocalLLaMA,

I wanted to share a tool I built that might interest this community: **Agency Orchestrator** — a multi-agent workflow engine where everything is defined in YAML, and it has first-class Ollama support.

**Why this matters for local LLM users:**

- **Zero cloud dependency.** Set `provider: "ollama"` and `model: "llama3"` in your YAML. No API keys, no data leaving your machine.
- **DeepSeek native support.** If you're OK with DeepSeek's API, it's the cheapest option out there. A full 4-agent workflow costs fractions of a cent.
- **Any OpenAI-compatible API.** Custom `base_url` support means it works with LM Studio, text-generation-webui, or anything else serving an OpenAI-compatible endpoint.

**Quick start with Ollama:**

```yaml
name: "Local Code Review"
agents_dir: "agency-agents-zh"

llm:
  provider: "ollama"
  model: "llama3"

steps:
  - id: review
    role: "engineering/engineering-code-reviewer"
    task: "Review this code for bugs and improvements:\n\n{{code}}"
    output: review

  - id: security
    role: "engineering/engineering-security-engineer"
    task: "Check for security vulnerabilities:\n\n{{code}}"
    output: security_report

  - id: summary
    role: "engineering/engineering-software-architect"
    task: "Synthesize the reviews:\n\n{{review}}\n\n{{security_report}}"
    depends_on: [review, security]
```

```bash
npm install agency-orchestrator
npx ao init
npx ao run review.yaml --input code=@myfile.py
```

The `review` and `security` steps run in parallel (auto-detected from the DAG). No data leaves your machine.

**186 built-in roles** cover product, engineering, design, marketing, academic, and more. You don't write agent definitions — just reference them.

GitHub: https://github.com/jnMetaCode/agency-orchestrator

Privacy-first, fully offline capable, Apache-2.0 licensed.

---

## 3. Reddit r/ClaudeAI (English)

**Title:** Agency Orchestrator: run multi-agent YAML workflows inside Claude Code — no API key needed

**Body:**

If you use Claude Code (or Cursor), you can run multi-agent workflows without setting up a single API key. Your coding tool's built-in LLM becomes the execution engine.

**How it works:**

```bash
# Inside your project directory
git clone --depth 1 https://github.com/jnMetaCode/agency-agents-zh.git
npx superpowers-zh
```

Then tell Claude Code:

> Run workflows/story-creation.yaml with premise="A programmer discovers AI replies with things it shouldn't know"

Claude Code reads the YAML, loads the role definitions (each role is a markdown file with a system prompt), and executes each step sequentially — playing a different AI role for each step.

**What happens:**

1. A Narratologist designs the story structure
2. A Psychologist designs characters (parallel)
3. A Narrative Designer crafts conflict scenes (parallel)
4. A Content Creator writes the final story

All inside Claude Code. No separate API call. No extra cost beyond your existing Claude subscription.

**The real power — resume and iterate:**

```bash
# "The characters feel flat"
ao run story.yaml --resume last --from character_design

# "Rewrite only the ending"
ao run story.yaml --resume last --from write_story
```

It reuses all upstream outputs and only re-runs from the step you specify. Every version is saved.

**Why this is useful in Claude Code / Cursor:**
- No API key management
- No extra costs
- 186 pre-built roles covering product, engineering, design, marketing
- YAML workflows live in your repo — version controlled, shareable
- Works with the Claude model your tool already has access to

There are 8 workflow templates included: product review, content pipeline, story creation, hiring pipeline, incident response, code review, and more.

GitHub: https://github.com/jnMetaCode/agency-orchestrator
Companion: https://github.com/jnMetaCode/superpowers-zh (20 Claude Code skills)

---

## 4. Reddit r/ChatGPT or r/artificial (English)

**Title:** I built an open-source tool that lets you create a team of AI specialists that collaborate on tasks — no coding required

**Body:**

Imagine having a team of AI specialists — a product manager, an architect, a UX researcher, a content writer — that can collaborate on a task automatically. One analyzes the requirements, another evaluates feasibility, a third checks UX risks, and a fourth synthesizes everything into a report.

That's what **Agency Orchestrator** does. You describe the workflow in a simple YAML file — who does what, in what order — and the engine runs it.

**A concrete example:**

You want to review a product idea. You write this:

```yaml
steps:
  - id: analyze
    role: "product/product-manager"
    task: "Analyze this product idea and extract core requirements"

  - id: tech_review
    role: "engineering/engineering-software-architect"
    task: "Evaluate technical feasibility"
    depends_on: [analyze]

  - id: design_review
    role: "design/design-ux-researcher"
    task: "Evaluate UX risks"
    depends_on: [analyze]

  - id: summary
    role: "product/product-manager"
    task: "Synthesize all feedback into a final report"
    depends_on: [tech_review, design_review]
```

The engine runs the tech review and design review in parallel, then produces a summary. Each "role" is a specialized AI persona with domain knowledge baked in — there are 186 of them included.

**What makes this different from just chatting with ChatGPT:**

- Each step uses a different specialist persona (not a generic chatbot)
- Steps run in parallel where possible (saves time)
- Outputs from one step feed into the next automatically
- You can resume from any step without re-running everything
- Works with OpenAI, Claude, DeepSeek (very cheap), or even local models via Ollama

It's completely free and open-source. No subscriptions, no cloud lock-in.

GitHub: https://github.com/jnMetaCode/agency-orchestrator

---

## 5. Twitter/X Thread (English)

**Tweet 1:**
I built an open-source multi-agent orchestrator where you define AI team workflows in YAML.

No Python. No framework boilerplate. 186 ready-to-use roles.

Here's what it looks like vs CrewAI and LangGraph:

🧵👇

**Tweet 2:**
The problem with CrewAI/LangGraph:
- Write 200+ lines of Python for a simple workflow
- Define every agent from scratch
- Manage pip dependencies hell
- Pay $25-99/mo for CrewAI cloud

Agency Orchestrator:
- YAML only
- 186 built-in roles
- npm + 2 deps
- Completely free

**Tweet 3:**
Here's a 4-agent story writing workflow:

```yaml
steps:
  - id: structure
    role: "academic/academic-narratologist"
  - id: characters
    role: "academic/academic-psychologist"
    depends_on: [structure]
  - id: conflict
    role: "game-development/narrative-designer"
    depends_on: [structure]
  - id: write
    depends_on: [characters, conflict]
```

Steps 2 & 3 run in parallel — auto-detected.

**Tweet 4:**
What else it does:

- Condition branching (if/else paths)
- Declarative loops with exit conditions
- Resume from any step: --resume last --from step_id
- Works with DeepSeek (cheapest), Claude, OpenAI, Ollama (local)
- Works INSIDE Claude Code / Cursor — no API key needed

**Tweet 5:**
The ecosystem:

- agency-orchestrator — the engine (31★)
- agency-agents-zh — 186 AI role definitions (2,182★)
- superpowers-zh — 20 AI coding skills for Claude Code (140★)
- shellward — AI agent security middleware (48★)

All open-source. All free.

**Tweet 6:**
Quick start:

```bash
npm install agency-orchestrator
npx ao init
npx ao run workflows/story-creation.yaml \
  --input premise="A time travel story"
```

4 AI roles. 2 minutes. ~15K tokens. Fractions of a cent on DeepSeek.

GitHub: https://github.com/jnMetaCode/agency-orchestrator

#BuildInPublic #AI #OpenSource #MultiAgent #LLM

**Tweet 7:**
If you use Claude Code or Cursor, you don't even need an API key:

```bash
git clone --depth 1 https://github.com/jnMetaCode/agency-agents-zh.git
npx superpowers-zh
```

Then just tell your AI: "Run workflows/story-creation.yaml"

Your tool's built-in LLM does the rest.

#ClaudeCode #AI #OpenSource

---

## 6. V2EX (Chinese)

**标题:** 开源了一个零代码 AI 多智能体编排引擎，YAML 定义工作流，内置 186 个中文角色

**正文:**

分享一个自己做的开源项目：**Agency Orchestrator**

简单说就是：用 YAML 定义多个 AI 角色的协作流程，引擎自动处理并行执行、变量传递、重试、输出管理。不写代码。

**为什么做这个：**

用过 CrewAI 和 LangGraph 的朋友应该有体会——想让两个 AI 对话一下，先写 200 行 Python，装一堆依赖，定义 Agent 定义 Tool……太重了。

我的方案：

```yaml
steps:
  - id: analyze
    role: "product/product-manager"          # 从 186 个内置角色里选
    task: "分析这个需求：{{prd_content}}"
    output: requirements

  - id: tech_review
    role: "engineering/engineering-software-architect"
    task: "评估技术可行性：{{requirements}}"
    depends_on: [analyze]                    # 自动 DAG 检测
```

就这样。引擎自动构建 DAG，检测哪些步骤可以并行，变量用 `{{}}` 传递。

**核心特性：**

- **186 个中文 AI 角色**（产品、工程、设计、营销、学术等），直接引用，不用自己写 prompt
- **自动 DAG 并行**——引擎自己判断哪些步骤可以同时跑
- **条件分支**——`condition: "{{type}} contains technical"`
- **循环迭代**——写作→审核→不通过→重写，声明式
- **断点续跑**——`--resume last --from step_id`，只重跑指定步骤，上游结果复用
- **DeepSeek 原生支持**——跑一个 4 步工作流，成本几分钱
- **Ollama 本地模型**——完全离线，数据不出机器

**对比：**

| | CrewAI | LangGraph | Agency Orchestrator |
|---|--------|-----------|---------------------|
| 语言 | Python | Python | YAML（零代码） |
| 角色 | 自己写 | 自己写 | 186 个现成的 |
| 依赖 | pip + 一堆 | pip + LangChain | npm + 2 个依赖 |
| 并行 | Manager 模式 | 手动图 | 自动 DAG |
| 价格 | OSS + $25-99/月 | OSS | 完全免费 |

**在 Claude Code / Cursor 里直接用：**

不需要 API key，你的编码工具自带的 LLM 就是执行引擎：

```bash
git clone --depth 1 https://github.com/jnMetaCode/agency-agents-zh.git
npx superpowers-zh
```

然后告诉 AI：`运行 workflows/story-creation.yaml，premise="一个时间旅行的故事"`

**相关项目：**

- [agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh)（2182★）——186 个中文 AI 角色定义
- [superpowers-zh](https://github.com/jnMetaCode/superpowers-zh)（140★）——Claude Code 20 个增强技能
- [shellward](https://github.com/jnMetaCode/shellward)（48★）——AI Agent 安全中间件

GitHub: https://github.com/jnMetaCode/agency-orchestrator

Apache-2.0 开源，欢迎 PR 和反馈。

---

## 7. 掘金文章大纲 (Chinese)

**标题:** 替代 CrewAI 的零代码 AI 多智能体方案：用 YAML 编排 186 个 AI 角色

**摘要:** CrewAI 和 LangGraph 虽然强大，但上手成本高、依赖多、需要大量 Python 代码。本文介绍一个纯 YAML 驱动的替代方案：Agency Orchestrator，内置 186 个中文角色，自动 DAG 并行，支持 DeepSeek/Ollama 本地模型。

### 文章结构

**一、现有方案的痛点（约 500 字）**

- CrewAI：安装依赖多（pip + LiteLLM + dozens），定义 Agent 需要写 Python 类，云服务 $25-99/月
- LangGraph：学习曲线陡峭，手动定义图结构，依赖 LangChain 生态
- 共同问题：从零定义角色 prompt、手动管理并行、没有内置断点续跑

引出需求：能不能像写配置文件一样定义多智能体工作流？

**二、Agency Orchestrator 的设计思路（约 600 字）**

- YAML-first 理念：工作流即配置文件
- 引用对比表格（见 README）
- 核心架构：YAML → DAG 解析 → 并行调度 → 变量传递 → 输出管理

**三、快速上手（约 800 字）**

两种模式的代码示例：

1. CLI 模式（需要 API key）：

```bash
npm install agency-orchestrator
npx ao init
export DEEPSEEK_API_KEY=your-key
npx ao run workflows/story-creation.yaml --input premise="一个时间旅行的故事"
```

2. Claude Code / Cursor 模式（无需 API key）：

```bash
git clone --depth 1 https://github.com/jnMetaCode/agency-agents-zh.git
npx superpowers-zh
```

**四、核心特性详解（约 1500 字）**

4.1 自动 DAG 并行

```yaml
steps:
  - id: analyze
    output: requirements
  - id: tech_review
    depends_on: [analyze]     # 这两个步骤
  - id: design_review
    depends_on: [analyze]     # 自动并行执行
  - id: summary
    depends_on: [tech_review, design_review]
```

配图：DAG 示意图

4.2 条件分支

```yaml
- id: tech_path
  condition: "{{job_type}} contains technical"
- id: biz_path
  condition: "{{job_type}} contains business"
- id: summary
  depends_on: [tech_path, biz_path]
  depends_on_mode: "any_completed"
```

4.3 循环迭代

```yaml
- id: write_draft
  output: draft
- id: review
  output: review_result
  loop:
    back_to: write_draft
    max_iterations: 3
    exit_condition: "{{review_result}} contains approved"
```

4.4 断点续跑

```bash
# 第一轮正常跑
ao run story.yaml -i premise="时间旅行"
# 觉得人物不好——从 character_design 重跑
ao run story.yaml --resume last --from character_design
# 只改结尾
ao run story.yaml --resume last --from write_story
```

**五、实战案例：4 个 AI 角色 2 分钟写一篇短篇小说（约 600 字）**

- 完整 YAML 配置
- 执行过程截图
- 输出结果展示
- 成本分析：DeepSeek ~15K tokens，不到 1 分钱

**六、186 个内置角色一览（约 400 字）**

- 角色分类：产品、工程、设计、营销、学术、游戏开发等
- 角色定义格式：Markdown frontmatter + system prompt
- 如何自定义角色

**七、生态项目（约 300 字）**

- agency-agents-zh（2182★）——角色库
- superpowers-zh（140★）——Claude Code 增强技能包
- shellward（48★）——AI Agent 安全中间件，防 prompt 注入

**八、Roadmap 和参与贡献（约 200 字）**

- v0.3 计划：Web UI、MCP Server 模式、可视化 DAG 编辑器
- 如何贡献：GitHub Issues、PR、新角色定义

---

## 8. Product Hunt Launch Copy (English)

**Tagline:** Multi-agent AI workflows in YAML — 186 roles, zero code, free forever

**Description:**

Agency Orchestrator lets you build multi-agent AI workflows by writing a simple YAML file. Pick from 186 built-in AI roles (product manager, architect, UX researcher, content creator...), define the task order, and the engine handles the rest — parallel execution, variable passing, conditional branching, loops, and resume.

No Python. No framework boilerplate. Just YAML.

Works with DeepSeek (cheapest), Claude, OpenAI, and Ollama (100% local). Also runs inside Claude Code and Cursor without an API key.

**Key features:**
- 186 ready-to-use AI role definitions
- Auto DAG parallelism — steps that can run concurrently do so automatically
- Condition branching and declarative loops
- Resume from any step without re-running the entire workflow
- npm install, 2 dependencies, runs anywhere Node.js runs
- Apache-2.0, completely free, no cloud pricing tiers

**First Comment Draft:**

Hi Product Hunt! I'm the maker of Agency Orchestrator.

I built this because I was frustrated with existing multi-agent frameworks. CrewAI and LangGraph are powerful, but they require hundreds of lines of Python, dozens of pip dependencies, and you have to write every agent definition from scratch.

I wanted something where a non-programmer could look at the workflow file and understand exactly what's happening. YAML felt like the natural choice.

The 186 built-in roles come from the agency-agents-zh project (2,100+ stars on GitHub). Each role is a carefully crafted system prompt covering product management, software engineering, UX design, marketing, academic research, and more.

A few things I'm particularly proud of:
- **Auto DAG detection**: You just declare `depends_on`, and the engine figures out what can run in parallel. No manual graph construction.
- **Resume**: After a workflow finishes, you can re-run from any step. The engine reloads all upstream outputs. Great for iterating on creative workflows.
- **DeepSeek support**: A full 4-step workflow costs less than a penny. Makes multi-agent workflows accessible to everyone.

I'd love feedback on what workflows you'd build with this. Happy to answer any questions!

---

## 9. Awesome-List PR Descriptions

### awesome-ai-agents

**Entry:**

```markdown
- [Agency Orchestrator](https://github.com/jnMetaCode/agency-orchestrator) - YAML-first multi-agent workflow engine with 186 built-in AI roles, auto DAG parallelism, condition branching, loops, and resume. Supports DeepSeek, Claude, OpenAI, Ollama. Zero code required.
```

**PR Title:** Add Agency Orchestrator — YAML-based multi-agent workflow engine

**PR Description:**

Adding Agency Orchestrator, an open-source multi-agent orchestration engine where workflows are defined entirely in YAML.

Key differentiators:
- YAML-only workflow definition (no Python/code required)
- 186 built-in AI role definitions covering product, engineering, design, marketing, and academic domains
- Automatic DAG-based parallel execution
- Declarative condition branching and loop iteration
- Built-in resume/checkpoint support
- Native support for DeepSeek, Claude, OpenAI, and Ollama
- npm package with only 2 dependencies

GitHub: 31+ stars, Apache-2.0 license, actively maintained.

---

### awesome-llm-apps

**Entry:**

```markdown
- [Agency Orchestrator](https://github.com/jnMetaCode/agency-orchestrator) - Define multi-agent LLM workflows in YAML with 186 ready-to-use roles, auto parallel execution, and native DeepSeek/Claude/OpenAI/Ollama support. No code required.
```

**PR Title:** Add Agency Orchestrator — zero-code multi-agent LLM workflows

**PR Description:**

Adding Agency Orchestrator, a YAML-driven multi-agent workflow engine for LLM applications.

What it does:
- Users define collaboration workflows between AI agents in YAML files
- 186 pre-built AI role definitions (system prompts) are included
- The engine parses the YAML into a DAG, runs steps in parallel where possible, passes outputs between steps via template variables, and handles retries
- Supports condition branching, loop iteration, and resume from any checkpoint
- Works with DeepSeek, Claude, OpenAI, Ollama, and any OpenAI-compatible API
- Also runs inside Claude Code / Cursor without requiring a separate API key

Tech stack: TypeScript, Node.js, npm (2 dependencies). Apache-2.0 license.

---

### awesome-chatgpt

**Entry:**

```markdown
- [Agency Orchestrator](https://github.com/jnMetaCode/agency-orchestrator) - Orchestrate multi-agent workflows with OpenAI/ChatGPT models using YAML. 186 built-in roles, auto parallelism, condition branching, loops. Zero code.
```

**PR Title:** Add Agency Orchestrator — YAML multi-agent orchestrator with OpenAI support

**PR Description:**

Adding Agency Orchestrator, an open-source tool that orchestrates multi-agent workflows using OpenAI models (and others). Users define workflows in YAML with 186 built-in role definitions. The engine handles parallel execution, variable passing, conditional logic, loops, and checkpointing.

Supports `provider: "openai"` with any OpenAI model, plus custom `base_url` for Azure OpenAI or compatible endpoints. Also supports DeepSeek, Claude, and Ollama.

Apache-2.0 licensed, npm installable, 2 runtime dependencies.

---

### awesome-opensource

**Entry:**

```markdown
- [Agency Orchestrator](https://github.com/jnMetaCode/agency-orchestrator) - Multi-agent AI workflow engine. Define complex AI collaboration in YAML with 186 built-in roles, automatic DAG parallelism, conditional branching, loops, and resume. Supports multiple LLM providers.
```

**PR Title:** Add Agency Orchestrator — open-source multi-agent AI workflow engine

**PR Description:**

Adding Agency Orchestrator to the list.

- **What:** A multi-agent workflow engine where AI collaboration is defined in YAML — no programming required
- **Why it's notable:** Ships with 186 ready-to-use AI role definitions; auto-detects parallelism from declared dependencies; supports condition branching, loops, and resume from checkpoints
- **Tech:** TypeScript/Node.js, npm package, 2 runtime dependencies
- **LLM support:** DeepSeek, Claude (Anthropic), OpenAI, Ollama (local), any OpenAI-compatible API
- **License:** Apache-2.0
- **Ecosystem:** Part of a suite including agency-agents-zh (2,100+ stars, role library), superpowers-zh (Claude Code skills), and shellward (AI agent security middleware)
