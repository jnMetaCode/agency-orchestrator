# Agency Orchestrator

> **不用写代码的 AI 团队 — 186 个中文角色，一个 YAML 文件搞定**

[![CI](https://github.com/jnMetaCode/agency-orchestrator/actions/workflows/ci.yml/badge.svg)](https://github.com/jnMetaCode/agency-orchestrator/actions)
[![npm version](https://img.shields.io/npm/v/agency-orchestrator)](https://www.npmjs.com/package/agency-orchestrator)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

---

## 解决什么问题

[agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh) 提供了 **186 个专业 AI 角色**（产品经理、工程师、设计师、小红书运营……），但每个角色只能独立工作。真实任务需要**协作** — 谁先谁后、怎么交接、什么时候并行。

Agency Orchestrator 让你用一个 YAML 文件编排多 AI 协作。不用写 Python，不用学框架，写 YAML 就行。

### 对比 CrewAI

```python
# CrewAI: 要写 ~50 行 Python，每个角色从零定义
researcher = Agent(role="PM", goal="...", backstory="...(你自己写)...")
task = Task(description="...", agent=researcher)
crew = Crew(agents=[researcher], tasks=[task])
crew.kickoff()
```

```yaml
# Agency Orchestrator: 10 行 YAML，186 个角色开箱即用
steps:
  - id: analyze
    role: "product/product-manager"   # 现成角色，专业 prompt 已写好
    task: "分析这个 PRD：{{prd_content}}"
```

| | CrewAI | LangGraph | **Agency Orchestrator** |
|---|--------|-----------|---------------------|
| 语言 | Python | Python | **YAML（零代码）** |
| 角色 | 自己写 | 自己写 | **186 个现成角色** |
| 依赖 | pip + LiteLLM + 几十个包 | pip + LangChain | **npm + 2 个依赖** |
| 中文角色 | 没有 | 没有 | **186 个（44 个中国原创）** |
| 模型 | LiteLLM（常出 bug） | LangChain | **原生：DeepSeek、Ollama、Claude、OpenAI** |
| 并行 | Manager 模式（有缺陷） | 手动建图 | **DAG 自动检测** |
| 价格 | 开源 + $25-99/月云版 | 开源 | **完全免费** |

## 快速开始

### 方式一：在 Claude Code / OpenClaw / Cursor 中直接用（无需 API key）

如果你已经在 AI 编程工具中，**不需要配置任何 API key**，工具自带的 LLM 就是执行引擎：

```bash
# 安装角色定义
git clone --depth 1 https://github.com/jnMetaCode/agency-agents-zh.git

# 安装 superpowers-zh（包含 workflow-runner 技能）
npx superpowers-zh
```

然后在 AI 工具中直接说：

```
运行 workflows/story-creation.yaml，创意是"一个程序员在凌晨发现AI回复不该知道的事"
```

AI 会自动解析 YAML → 加载角色 → 按 DAG 顺序执行 → 保存结果。零配置。

各工具集成指南见 [integrations/](./integrations/)：
- [Claude Code](./integrations/claude-code/) — Skill 模式（推荐）
- [Cursor](./integrations/cursor/) — .cursorrules 模式
- [OpenClaw](./integrations/openclaw/) — Skill 模式

### 方式二：CLI 模式（需要 API key）

用于自动化、批量执行、CI/CD：

```bash
# 安装
npm install agency-orchestrator

# 下载 186 个 AI 角色
npx ao init

# 查看执行计划
npx ao plan workflows/product-review.yaml

# 运行（选择你的 LLM）
export DEEPSEEK_API_KEY=your-key          # 或 ANTHROPIC_API_KEY、OPENAI_API_KEY
npx ao run workflows/story-creation.yaml --input premise='一个时间旅行的故事'
```

## 真实演示：4 个 AI 角色 2 分钟写出完整小说

```
$ ao run workflows/story-creation.yaml -i "premise=一个程序员在凌晨三点发现AI开始回复不该知道的事情"

  工作流: 短篇小说创作
  步骤数: 4 | 并发: 2 | 模型: deepseek-chat
──────────────────────────────────────────────────

  ── [1/4] story_structure (叙事学家) ──
  完成 | 14.9s | 1,919 tokens
    核心冲突：程序员与一个似乎拥有超越其代码权限的自主意识之间的认知对抗...

  ── [2/4] character_design (心理学家) ──           ← 并行执行
  完成 | 65.5s | 4,016 tokens
    人物心理档案：林深——一个信奉逻辑与控制的资深AI工程师...

  ── [3/4] conflict_design (叙事设计师) ──          ← 并行执行
  完成 | 65.5s | 3,607 tokens
    凌晨三点，屏幕的冷光映着陈默疲惫的脸...

  ── [4/4] write_story (内容创作者) ──
  完成 | 33.9s | 5,330 tokens
    凌晨三点，调试日志的蓝色荧光是房间里唯一的光源。陈默灌下今晚第三杯黑咖啡...

==================================================
  完成: 4/4 步 | 114.3s | 14,872 tokens
==================================================
```

第 2、3 步**自动并行执行**（从 DAG 依赖关系检测）。4 个专业 AI 角色协作，产出一篇完整的悬疑短篇小说。

## 工作原理

```yaml
name: "产品需求评审"
agents_dir: "agency-agents-zh"

llm:
  provider: "deepseek"          # 或：claude、openai、ollama
  model: "deepseek-chat"

concurrency: 2

inputs:
  - name: prd_content
    required: true

steps:
  - id: analyze
    role: "product/product-manager"
    task: "分析以下 PRD，提取核心需求：\n\n{{prd_content}}"
    output: requirements

  - id: tech_review
    role: "engineering/engineering-software-architect"
    task: "评估技术可行性：\n\n{{requirements}}"
    output: tech_report
    depends_on: [analyze]

  - id: design_review
    role: "design/design-ux-researcher"
    task: "评估用户体验风险：\n\n{{requirements}}"
    output: design_report
    depends_on: [analyze]

  - id: summary
    role: "product/product-manager"
    task: "综合反馈输出结论：\n\n{{tech_report}}\n\n{{design_report}}"
    depends_on: [tech_review, design_review]
```

引擎自动：

1. 解析 YAML → 构建 **DAG**（有向无环图）
2. 检测并行 — `tech_review` 和 `design_review` 并发执行
3. 通过 `{{变量}}` 在步骤间传递输出
4. 从 [agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh) 加载角色定义作为 system prompt
5. 失败自动重试（指数退避）
6. 保存所有输出到 `.ao-output/`

```
analyze ──→ tech_review  ──→ summary
         └→ design_review ──┘
          (并行)
```

## 支持的 LLM

| 提供商 | 配置 | 环境变量 |
|--------|------|---------|
| **DeepSeek** | `provider: "deepseek"` | `DEEPSEEK_API_KEY` |
| **Claude** | `provider: "claude"` | `ANTHROPIC_API_KEY` |
| **OpenAI** | `provider: "openai"` | `OPENAI_API_KEY` |
| **Ollama**（本地） | `provider: "ollama"` | 不需要 |

所有提供商支持自定义 `base_url` 和 `api_key`，兼容智谱、月之暗面等 OpenAI 兼容 API。

## CLI 命令

```bash
ao init                              # 下载 186 个 AI 角色
ao run <workflow.yaml> [选项]          # 执行工作流
ao validate <workflow.yaml>           # 校验（不执行）
ao plan <workflow.yaml>               # 查看执行计划
ao roles                             # 列出所有角色
```

| 参数 | 说明 |
|------|------|
| `--input key=value` | 传入输入变量 |
| `--input key=@file` | 从文件读取变量值 |
| `--output dir` | 输出目录（默认 `.ao-output/`） |
| `--quiet` | 静默模式 |

## 编程 API

```typescript
import { run } from 'agency-orchestrator';

const result = await run('workflow.yaml', {
  prd_content: '你的 PRD 内容...',
});

console.log(result.success);     // true/false
console.log(result.totalTokens); // { input: 1234, output: 5678 }
```

## YAML Schema

### 工作流

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 工作流名称 |
| `agents_dir` | string | 是 | 角色目录路径 |
| `llm.provider` | string | 是 | `claude` / `deepseek` / `openai` / `ollama` |
| `llm.model` | string | 是 | 模型名称 |
| `llm.max_tokens` | number | 否 | 默认 4096 |
| `llm.timeout` | number | 否 | 步骤超时毫秒数（默认 120000） |
| `llm.retry` | number | 否 | 重试次数（默认 3） |
| `concurrency` | number | 否 | 最大并行步骤数（默认 2） |
| `inputs` | array | 否 | 输入变量定义 |
| `steps` | array | 是 | 工作流步骤 |

### 步骤

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 步骤唯一标识 |
| `role` | string | 是 | 角色路径（如 `"engineering/engineering-sre"`） |
| `task` | string | 是 | 任务描述，支持 `{{变量}}` |
| `output` | string | 否 | 输出变量名 |
| `depends_on` | string[] | 否 | 依赖的步骤 ID |

## 输出

每次运行保存到 `.ao-output/<名称>-<时间戳>/`：

```
.ao-output/产品需求评审-2026-03-22/
├── summary.md          # 最终步骤输出
├── steps/
│   ├── 1-analyze.md
│   ├── 2-tech_review.md
│   ├── 3-design_review.md
│   └── 4-summary.md
└── metadata.json       # 耗时、token 用量、步骤状态
```

## 内置工作流模板

| 模板 | 角色 | 说明 |
|------|------|------|
| `product-review.yaml` | 产品经理、架构师、UX 研究员 | 产品需求评审（并行技术+设计评估） |
| `content-pipeline.yaml` | 策略师、创作者、增长黑客 | 内容创作流水线 |
| `story-creation.yaml` | 叙事学家、心理学家、叙事设计师、内容创作者 | 协作小说创作（4 角色、3 层 DAG） |

## 项目生态

```
                    agency-agents-zh（186 个 AI 角色定义）
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
      Claude Code      Cursor       OpenClaw        ← Skill 模式（无需 API key）
      (workflow-runner 技能)
              │
              ▼
      agency-orchestrator（YAML 工作流引擎）          ← CLI 模式（需要 API key）
              │
              ▼
      DeepSeek / Claude / OpenAI / Ollama
```

## 姊妹项目

| 项目 | 说明 |
|------|------|
| [agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh) | 186 个 AI 角色定义 — 本编排引擎的角色库 |
| [superpowers-zh](https://github.com/jnMetaCode/superpowers-zh) | AI 编程超能力 · 中文版 — 20 个 skills，让你的 AI 编程助手真正会干活 |

## 路线图

- [x] **v0.1** — YAML 工作流、DAG 引擎、4 个 LLM 连接器、CLI、实时输出
- [ ] **v0.2** — 人工审批节点、迭代循环、工作流市场
- [ ] **v0.3** — Web UI、MCP Server 模式、可视化 DAG 编辑器

## 贡献

参见 [CONTRIBUTING.md](./CONTRIBUTING.md)，欢迎 PR！

## 许可证

[Apache-2.0](./LICENSE)

---

<details>
<summary><strong>English</strong></summary>

## Why This?

[agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh) provides **186 production-ready AI role prompts** (product managers, engineers, designers, marketers...), but each role works alone. Real tasks need **collaboration** — who goes first, how to hand off context, when to run in parallel.

Agency Orchestrator turns a YAML file into a multi-agent pipeline. No Python. No framework boilerplate. Just roles and tasks.

### Quick Start

**Option A: Inside Claude Code / OpenClaw / Cursor (No API key needed)**

```bash
git clone --depth 1 https://github.com/jnMetaCode/agency-agents-zh.git
npx superpowers-zh
```

Then say: `Run workflows/story-creation.yaml with premise="A time travel story"`

**Option B: CLI Mode (API key required)**

```bash
npm install agency-orchestrator
npx ao init
export DEEPSEEK_API_KEY=your-key
npx ao run workflows/story-creation.yaml --input premise='A time travel story'
```

### Supported LLMs

| Provider | Config | Env Variable |
|----------|--------|-------------|
| **DeepSeek** | `provider: "deepseek"` | `DEEPSEEK_API_KEY` |
| **Claude** | `provider: "claude"` | `ANTHROPIC_API_KEY` |
| **OpenAI** | `provider: "openai"` | `OPENAI_API_KEY` |
| **Ollama** (local) | `provider: "ollama"` | None needed |

### CLI Commands

```bash
ao init                              # Download 186 AI roles
ao run <workflow.yaml> [options]      # Execute workflow
ao validate <workflow.yaml>           # Validate without running
ao plan <workflow.yaml>               # Show execution plan (DAG)
ao roles                             # List all available roles
```

### Programmatic API

```typescript
import { run } from 'agency-orchestrator';

const result = await run('workflow.yaml', {
  prd_content: 'Your PRD here...',
});
```

</details>
