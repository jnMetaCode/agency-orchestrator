# Agency Orchestrator

**中文** | [English](./README.en.md)

> **一句话，让多个 AI 角色自动协作，几分钟出完整方案。**

[![CI](https://github.com/jnMetaCode/agency-orchestrator/actions/workflows/ci.yml/badge.svg)](https://github.com/jnMetaCode/agency-orchestrator/actions)
[![npm version](https://img.shields.io/npm/v/agency-orchestrator)](https://www.npmjs.com/package/agency-orchestrator)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

**一句话出结果 · 211 个专业 AI 角色 · YAML 零代码 · 10 种大模型 · 7 种免 API key**

> 📖 [完整上手教程](https://mp.weixin.qq.com/s/XcGbkMb6TM6NLQiL7ICwbw) — 从安装到实战，10 分钟上手

> 觉得有用？请点个 **Star** — 帮助更多人发现这个项目。

<p align="center">
  <img src="./demo-zh.gif" alt="ao compose --run demo" width="700">
</p>

---

## 一句话出结果

```bash
ao compose "我是一个程序员，想用AI做自媒体副业，目标月入2万，帮我做完整规划" --run
```

5 个 AI 角色自动分工协作：

```
  工作流: 程序员AI自媒体副业规划
  步骤数: 5 | 模型: claude-code
  参与者: 🔭 趋势研究员 | 📱 平台分析师 | 💰 财务规划师 | ✍️ 内容策略师 | 📋 执行规划师
──────────────────────────────────────────────────

  ✅ 🔭 趋势研究员    31.3s  → 6个赛道竞争度/变现天花板/AI提效倍数对比
  ✅ 📱 平台分析师    32.0s  → 6大平台三维评分，推荐"小红书+公众号"组合
  ✅ 💰 财务规划师    31.8s  → 月入2万拆解：课程¥11,880 + 社群¥2,488 + 咨询¥4,000
  ✅ ✍️ 内容策略师    44.6s  → 20个选题 + 4套标题模板 + 内容SOP
  ✅ 📋 执行规划师    42.2s  → 90天行动计划，精确到每天做什么

==================================================
  完成: 5/5 步 | 182.1s | 6,493 tokens
==================================================
```

**不用写代码，不用写配置，不用选角色。** 一句话 → AI 自动拆解任务 → 从 211 个角色中匹配 → 按 DAG 并行执行 → 输出完整方案。

### 你能用它做什么

```bash
ao compose "帮我分析做一个AI记账工具的可行性" --run             # 创业可行性分析
ao compose "对比 Cursor、Windsurf 和 Copilot，给出选择建议" --run  # 技术选型报告
ao compose "写一篇关于 AI Agent 趋势的深度文章" --run             # 深度长文写作
ao compose "用 10 万块启动一个 AI 教育项目" --run                 # 商业计划书
ao compose "PR 代码审查，覆盖安全和性能" --run                    # 代码审查报告
ao compose "设计一个 SaaS 产品的定价策略" --run                   # 定价分析
```

每个场景自动匹配不同的 AI 角色组合。

---

## 为什么需要 Agency Orchestrator

跟一个 AI 聊天，它给你一个视角。但做任何决策，你需要产品的视角、技术的视角、财务的视角、营销的视角……

**Agency Orchestrator = 让多个 AI 专家各干各的，最后汇总。相当于一个人 vs 一个团队。**

| | ChatGPT / Claude | CrewAI / LangGraph | **Agency Orchestrator** |
|---|--------|-----------|---------------------|
| 角色数 | 1 个通用 | 自己写 | **211 个专业角色** |
| 使用方式 | 对话 | 写 Python | **一句话 / YAML** |
| API key | — | 必须 | **7 种免 API key** |
| 依赖 | — | pip + 几十个包 | **npm + 2 个依赖** |
| 并行 | — | 手动建图 | **DAG 自动检测** |
| 中文角色 | — | 无 | **211 个** |
| 价格 | 订阅制 | 开源 + API 费 | **完全免费** |

## 3 步开始

### 第 1 步：安装

```bash
npm install -g agency-orchestrator
```

### 第 2 步：一句话跑起来

```bash
# 用你已有的 Claude 会员（无需 API key）
ao compose "帮我分析做一个AI记账工具的可行性" --run --provider claude-code

# 或用 DeepSeek（充 10 块跑很久）
export DEEPSEEK_API_KEY="你的key"
ao compose "帮我分析做一个AI记账工具的可行性" --run
```

### 第 3 步：用内置模板或在 AI 编程工具中使用

```bash
# 用 32 个内置模板
ao run workflows/一人公司全员大会.yaml --input idea="帮打工人用AI写简历的求职神器"
ao run workflows/dev/pr-review.yaml --input code=@src/main.ts
ao run workflows/story-creation.yaml -i premise="一个程序员发现AI开始回复不该知道的事情"
```

也可以在 Cursor / Claude Code 中直接说"帮我跑一个工作流"——支持 **14 个 AI 编程工具**（[集成指南](./integrations/)）。

## 更多真实演示

```
$ ao compose "帮我分析抖音短视频赛道的创业机会" --run

  工作流: 抖音短视频赛道创业机会分析与商业方案制定
  步骤数: 6 | 并发: 2 | 模型: deepseek-chat
  参与者: 👔 老板 | 📊 市场调研员 | 🔍 用户研究员 | 🧭 产品经理 | 📣 营销主管 | 💰 财务总监
──────────────────────────────────────────────────

  ✅ 👔 老板          12.7s   → 战略方向与目标用户定位
  ✅ 📊 市场调研员    45.2s   → 7亿日活用户数据、竞争格局分析
  ✅ 🔍 用户研究员    38.1s   → 用户画像、痛点挖掘、付费意愿
  ✅ 🧭 产品经理      41.3s   → MVP功能清单、内容矩阵、变现路径
  ✅ 📣 营销主管      35.6s   → 冷启动方案、投放策略、用户漏斗
  ✅ 💰 财务总监      28.4s   → 150万启动、首年400万收入、盈亏平衡分析

==================================================
  完成: 6/6 步 | 233.0s | 65,191 tokens
==================================================
```

6 个角色中，市场调研员和用户研究员**自动并行执行**（从 DAG 依赖关系检测）。

## 工作原理

```yaml
name: "产品需求评审"
agents_dir: "agency-agents-zh"

llm:
  provider: "deepseek"          # 免 API key: claude-code / gemini-cli / copilot-cli / codex-cli / hermes-cli / ollama
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
6. 保存所有输出到 `ao-output/`

```
analyze ──→ tech_review  ──→ summary
         └→ design_review ──┘
          (并行)
```

## 10 种 LLM — 7 种不需要 API key

**你已经有这些会员了吧？直接就能跑：**

| 你有... | YAML 配置 | 安装 CLI | 额外费用 |
|---------|----------|---------|---------|
| Claude Max/Pro（$20/月） | `provider: "claude-code"` | `npm i -g @anthropic-ai/claude-code` | **不花钱** |
| Google 账号 | `provider: "gemini-cli"` | `npm i -g @google/gemini-cli` | **免费**（1000 次/天，Gemini 2.5 Pro） |
| GitHub Copilot（$10/月） | `provider: "copilot-cli"` | `npm i -g @github/copilot` | **不花钱** |
| ChatGPT Plus/Pro（$20/月） | `provider: "codex-cli"` | `npm i -g @openai/codex` | **不花钱** |
| OpenClaw 账号 | `provider: "openclaw-cli"` | `npm i -g openclaw` | **不花钱** |
| Hermes Agent（🔥 NousResearch 热门开源） | `provider: "hermes-cli"` | [安装指南](https://github.com/NousResearch/hermes-agent) | **免费** |
| 一台电脑 | `provider: "ollama"` | [ollama.ai](https://ollama.ai) | **免费**（本地模型） |

**也支持传统 API key：**

| 提供商 | 配置 | 环境变量 |
|--------|------|---------|
| DeepSeek | `provider: "deepseek"` | `DEEPSEEK_API_KEY` |
| Claude API | `provider: "claude"` | `ANTHROPIC_API_KEY` |
| OpenAI | `provider: "openai"` | `OPENAI_API_KEY` |

**自定义 API（火山引擎、智谱、月之暗面、硅基流动等 OpenAI 兼容 API）：**

```bash
ao init --provider openai --model 模型名 \
  --base-url https://你的API地址/v1 \
  --api-key 你的key
```

或手动编辑 `.env`：

```env
AO_PROVIDER=openai
AO_MODEL=模型名
OPENAI_BASE_URL=https://你的API地址/v1
OPENAI_API_KEY=你的key
```

常见示例：

| 平台 | base_url | model |
|------|----------|-------|
| 火山引擎 | `https://ark.cn-beijing.volces.com/api/coding/v3` | `ark-code-latest` |
| 智谱 AI | `https://open.bigmodel.cn/api/paas/v4` | `glm-4` |
| 硅基流动 | `https://api.siliconflow.cn/v1` | `deepseek-ai/DeepSeek-V3` |
| 月之暗面 | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |

> ⚠️ 注意：这些平台请使用 `provider: "openai"`，不要用 `provider: "ollama"`。Ollama 仅用于本地模型，不发送 API Key。

## CLI 命令

```bash
ao demo                              # 零配置体验多智能体协作
ao init                              # （可选）复制 211 个中文角色到本地以便编辑
ao init --lang en                    # （可选）复制 170+ 个英文角色到本地以便编辑
ao init --workflow                    # 交互式创建工作流
ao compose "一句话描述"                # AI 智能编排工作流
ao compose "一句话描述" --run          # 编排并立即执行
ao run <workflow.yaml> [选项]          # 执行工作流
ao validate <workflow.yaml>           # 校验（不执行）
ao plan <workflow.yaml>               # 查看执行计划（DAG）
ao explain <workflow.yaml>            # 用自然语言解释执行计划
ao roles                             # 列出所有角色
ao serve                             # 启动 MCP Server（供 Claude Code / Cursor 调用）
```

| 参数 | 说明 |
|------|------|
| `--input key=value` | 传入输入变量 |
| `--input key=@file` | 从文件读取变量值 |
| `--output dir` | 输出目录（默认 `ao-output/`） |
| `--resume <dir\|last>` | 从上次运行恢复（加载已完成步骤的输出） |
| `--from <step-id>` | 配合 `--resume`，从指定步骤重新执行 |
| `--watch` | 实时终端进度显示 |
| `--quiet` | 静默模式 |

### AI 智能编排（Compose）

一句话描述需求，AI 自动从 211 个角色中选角色、设计 DAG、生成完整 workflow YAML：

```bash
ao compose "PR 代码审查，要覆盖安全和性能"
```

AI 会自动：
1. 从 211 角色中匹配出 Code Reviewer、Security Engineer、Performance Benchmarker
2. 设计 DAG（三路并行 → 汇总）
3. 生成带 `depends_on`、变量串联的完整 YAML
4. 保存到 `workflows/` — 直接 `ao run` 就能跑

支持 `--provider` 和 `--model` 参数（默认使用 DeepSeek）。

### 迭代优化（Resume）

跑完一轮觉得某步不满意？不用从头来。`--resume` 加载上一轮输出，`--from` 指定从哪步重跑：

```bash
# 第一轮：正常运行
ao run workflows/一人公司全员大会.yaml -i idea="用AI帮小商家做短视频"

# 觉得营销方案不够好？只重跑营销和后续步骤
ao run workflows/一人公司全员大会.yaml --resume last --from marketing_plan

# 只改最终汇总
ao run workflows/一人公司全员大会.yaml --resume last --from launch_decision
```

每轮输出保存在 `ao-output/` 下独立目录，所有版本都保留，随时可以回溯。

| 场景 | 命令 |
|------|------|
| 第一次运行 | `ao run workflow.yaml -i key=value` |
| 从某步重跑 | `ao run workflow.yaml --resume last --from <步骤ID>` |
| 只重跑失败的步骤 | `ao run workflow.yaml --resume last` |
| 基于指定版本重跑 | `ao run workflow.yaml --resume ao-output/具体目录/ --from <步骤ID>` |

## 编程 API

```typescript
import { run } from 'agency-orchestrator';

const result = await run('workflow.yaml', {
  prd_content: '你的 PRD 内容...',
});

console.log(result.success);     // true/false
console.log(result.totalTokens); // { input: 1234, output: 5678 }
```

## MCP Server 模式

AI 编程工具（Claude Code、Cursor 等）可通过 MCP 协议直接调用工作流操作，无需手动集成：

```bash
ao serve              # 启动 MCP stdio 服务器
ao serve --verbose    # 带调试日志
```

配置 Claude Code（`settings.json`）：

```json
{
  "mcpServers": {
    "agency-orchestrator": {
      "command": "npx",
      "args": ["agency-orchestrator", "serve"]
    }
  }
}
```

配置 Cursor（`.cursor/mcp.json`）：

```json
{
  "mcpServers": {
    "agency-orchestrator": {
      "command": "npx",
      "args": ["agency-orchestrator", "serve"]
    }
  }
}
```

提供 6 个工具：`run_workflow`、`validate_workflow`、`list_workflows`、`plan_workflow`、`compose_workflow`、`list_roles`。

## YAML Schema

### 工作流

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 工作流名称 |
| `agents_dir` | string | 是 | 角色目录路径 |
| `llm.provider` | string | 是 | `claude-code` / `gemini-cli` / `copilot-cli` / `codex-cli` / `openclaw-cli` / `hermes-cli` / `ollama` / `claude` / `deepseek` / `openai` |
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
| `depends_on_mode` | string | 否 | `"all"`（默认）或 `"any_completed"`（任一完成即可） |
| `condition` | string | 否 | 条件表达式，不满足则跳过（如 `"{{var}} contains 技术"`） |
| `type` | string | 否 | `"approval"` 表示人工审批节点 |
| `prompt` | string | 否 | 审批节点的提示文本 |
| `loop` | object | 否 | 循环配置 |
| `loop.back_to` | string | 否 | 循环回到的步骤 ID |
| `loop.max_iterations` | number | 否 | 最大循环次数（1-10） |
| `loop.exit_condition` | string | 否 | 退出条件表达式 |

## 输出

每次运行保存到 `ao-output/<名称>-<时间戳>/`：

```
ao-output/产品需求评审-2026-03-22/
├── summary.md          # 最终步骤输出
├── steps/
│   ├── 1-analyze.md
│   ├── 2-tech_review.md
│   ├── 3-design_review.md
│   └── 4-summary.md
└── metadata.json       # 耗时、token 用量、步骤状态
```

## 内置工作流模板（32 个）

### 开发类（7 个）

| 模板 | 角色 | 说明 |
|------|------|------|
| `dev/tech-design-review.yaml` | 架构师、后端架构师、安全工程师、代码审查员 | **技术方案评审**（设计→并行评审→结论） |
| `dev/pr-review.yaml` | 代码审查员、安全工程师、性能基准师 | PR 评审（3 路并行→汇总） |
| `dev/tech-debt-audit.yaml` | 架构师、代码审查员、测试分析师、Sprint 排序师 | 技术债务审计（并行→优先级排序） |
| `dev/api-doc-gen.yaml` | 技术文档工程师、API 测试员 | API 文档生成（分析→验证→定稿） |
| `dev/readme-i18n.yaml` | 内容创作者、技术文档工程师 | README 国际化 |
| `dev/security-audit.yaml` | 安全工程师、威胁检测工程师 | 安全审计（并行→报告） |
| `dev/release-checklist.yaml` | SRE、性能基准师、安全工程师、产品经理 | 发布 Go/No-Go 决策 |

### 营销类（3 个）

| 模板 | 角色 | 说明 |
|------|------|------|
| `marketing/competitor-analysis.yaml` | 趋势研究员、数据分析师、SEO 专家、高管摘要师 | **竞品分析报告**（研究→并行分析→摘要） |
| `marketing/xiaohongshu-content.yaml` | 小红书专家、内容创作者、视觉叙事师、小红书运营 | **小红书种草笔记**（选题→并行创作→优化） |
| `marketing/seo-content-matrix.yaml` | SEO 专家、策略师、内容创作者 | **SEO 内容矩阵**（关键词→策略→批量生成→审核） |

### 数据 / 设计 / 运维类（7 个）

| 模板 | 角色 | 说明 |
|------|------|------|
| `data/data-pipeline-review.yaml` | 数据工程师、数据库优化师、数据分析师 | 数据管道评审 |
| `data/dashboard-design.yaml` | 数据分析师、UX 研究员、UI 设计师 | 仪表盘设计 |
| `design/requirement-to-plan.yaml` | 产品经理、架构师、项目经理 | 需求→技术设计→任务拆分 |
| `design/ux-review.yaml` | UX 研究员、无障碍审核员、UX 架构师 | UX 评审 |
| `ops/incident-postmortem.yaml` | 事故指挥官、SRE、产品经理 | 事故复盘 |
| `ops/sre-health-check.yaml` | SRE、性能基准师、基础设施运维师 | SRE 健康检查（3 路并行） |
| `ops/weekly-report.yaml` | 会议助手、内容创作者、高管摘要师 | **周报/月报生成**（整理→亮点→定稿） |

### 战略 / 法务 / HR 类（3 个）

| 模板 | 角色 | 说明 |
|------|------|------|
| `strategy/business-plan.yaml` | 趋势研究员、财务预测师、产品经理、高管摘要师 | **商业计划书**（市场→并行分析→整合） |
| `legal/contract-review.yaml` | 合同审查专家、法务合规员 | **合同审查**（逐条分析→合规检查→意见书） |
| `hr/interview-questions.yaml` | 招聘专家、心理学家、后端架构师 | **面试题设计**（维度→并行出题→评分表） |

### 通用类（12 个）

| 模板 | 角色 | 说明 |
|------|------|------|
| `product-review.yaml` | 产品经理、架构师、UX 研究员 | 产品需求评审 |
| `content-pipeline.yaml` | 策略师、创作者、增长黑客 | 内容创作流水线 |
| `story-creation.yaml` | 叙事学家、心理学家、叙事设计师、创作者 | 协作小说创作（4 角色） |
| `ai-opinion-article.yaml` | 趋势研究员、叙事设计师、心理学家、创作者 | AI 观点长文 |
| `department-collab/code-review.yaml` | 代码审查员、安全工程师 | 代码评审（循环） |
| `department-collab/hiring-pipeline.yaml` | HR、技术面试官、业务面试官 | 招聘流程 |
| `department-collab/content-publish.yaml` | 内容创作者、品牌守护者 | 内容发布（循环） |
| `department-collab/incident-response.yaml` | SRE、安全工程师、后端架构师 | 事故响应 |
| `department-collab/marketing-campaign.yaml` | 策略师、创作者、审批人 | 营销活动（人工审批） |
| `department-collab/ceo-org-delegation.yaml` | CEO、工程/市场/产品/HR 部门负责人 | **CEO 组织架构协作**（决策→部门并行→汇总） |
| `一人公司全员大会.yaml` | CEO、市场调研员、用户研究员、产品经理、市场负责人、CFO | **一人公司全员大会**（CEO→6 部门并行→决策） |
| `ai-startup-launch.yaml` | CEO、产品经理、架构师、市场负责人、财务顾问 | **SaaS 产品发布决策**（CEO→4 部门并行→发布计划） |

## 生态与社区

```
你的 AI 会员 ──→ agency-orchestrator ──→ 380+ 个 AI 角色协作 ──→ 高质量输出
                     │                  (211 中文 + 170+ 英文)
    ┌────────────────┼────────────────┐
    ▼                ▼                ▼
  14 个 AI 编程工具    CLI 模式         MCP Server
  (Cursor/Claude     (自动化/CI/CD)   (Claude Code/
   Code/Copilot...)                   Cursor 直接调用)
```

| 项目 | 说明 |
|------|------|
| [agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh) | 211 个中文 AI 角色定义 — 本引擎的中文角色库 |
| [agency-agents](https://github.com/msitarzewski/agency-agents) | 170+ 个英文 AI 角色定义 by [@msitarzewski](https://github.com/msitarzewski) — 本引擎的英文角色库 |
| [ai-coding-guide](https://github.com/jnMetaCode/ai-coding-guide) | AI 编程工具实战指南 — 66 个 Claude Code 技巧 + 9 款工具最佳实践 + 可复制配置模板 |
| [superpowers-zh](https://github.com/jnMetaCode/superpowers-zh) | AI 编程超能力 · 中文版 — 20 个 skills，让你的 AI 编程助手真正会干活 |
| [shellward](https://github.com/jnMetaCode/shellward) | AI 智能体安全中间件 — 注入检测、数据防泄露、命令安全、零依赖、MCP Server |

### 交流

微信公众号 **「AI不止语」**（微信搜索 `AI_BuZhiYu`）— 技术问答 · 项目更新 · 实战文章

| 渠道 | 加入方式 |
|------|---------|
| QQ 群 | [点击加入](https://qm.qq.com/q/EeNQA9xCxy)（群号 1071280067） |
| 微信群 | 关注公众号后回复「群」获取入群方式 |

## 路线图

- [x] **v0.1** — YAML 工作流、DAG 引擎、4 个 LLM 连接器、CLI、实时输出
- [x] **v0.2** — 条件分支、循环迭代、人工审批、Resume 断点续跑、5 个部门协作模板
- [x] **v0.3** — 9 个 AI 工具集成、20+ 工作流模板、`ao explain`、`ao init --workflow`、`--watch` 模式
- [x] **v0.4** — MCP Server 模式（`ao serve`）、14 个 AI 工具集成、一键安装脚本、32 个工作流模板、**10 种 LLM（7 种免 API key：Claude Code / Gemini / Copilot / Codex / OpenClaw / Hermes / Ollama）**
- [x] **v0.5** — `ao compose --run` 一句话出结果、实时流式输出、智能重试（指数退避）、步骤级模型覆盖、Agent 身份标识
- [ ] **v0.6** — Web UI、可视化 DAG 编辑器、英文工作流模板、工作流市场

## 贡献

参见 [CONTRIBUTING.md](./CONTRIBUTING.md)，欢迎 PR！

## 许可证

[Apache-2.0](./LICENSE)
