# Agency Orchestrator — 产品需求文档

## 一句话定位

基于 agency-agents 角色定义的轻量多智能体编排引擎 —— 用 YAML 定义工作流，自动调度 AI 角色协作完成复杂任务。

## 解决什么问题

agency-agents 定义了 186 个 AI 角色的「能力边界」（能做什么、怎么做），但缺少「协作层」：

- 一个任务需要多个角色配合时，谁先谁后？
- 上一个角色的输出怎么传给下一个？
- 哪些角色可以并行工作？
- 什么时候汇总？不通过怎么办？

**现状：** 用户手动拆任务 → 手动复制粘贴上下文 → 手动汇总结果
**目标：** 写一个 YAML 文件 → 引擎自动编排执行 → 输出最终结果

## 目标用户

1. **已在使用 agency-agents 的开发者** —— 想让多角色自动协作
2. **技术团队负责人** —— 想把重复性的多步 AI 流程标准化
3. **AI 应用开发者** —— 需要一个轻量的多智能体编排方案

## 为什么不直接用 CrewAI / LangGraph？

| | CrewAI | LangGraph | 本项目 |
|---|--------|-----------|--------|
| 语言 | Python | Python | TypeScript（Node.js 生态） |
| 角色定义 | 自己写 | 自己写 | **186 个现成中文角色，一行引用** |
| 上手成本 | 写 Python 类 | 学图概念 | **写 YAML** |
| 中文适配 | 无 | 无 | **原生中文** |
| 安全层 | 无 | 无 | **可选集成 shellward** |

核心差异：别人是「给你一个框架，角色你自己写」，我们是「角色已经写好 186 个，你只需要编排」。

## 核心设计原则

1. **YAML 驱动** —— 编排逻辑写在配置文件里，不写代码
2. **角色复用** —— 直接引用 agency-agents 的角色定义，不重新发明
3. **LLM 无关** —— 支持 Claude / OpenAI / Ollama 等任意后端（但 MVP 先做 1 个）
4. **最少依赖** —— 不依赖 LangChain / CrewAI 等框架，但允许用成熟的小工具库（js-yaml、官方 SDK）
5. **渐进式** —— 最简单的串行流 5 分钟上手，复杂流程按需加

## 功能需求

### P0 — MVP（v0.1）

#### F1: Workflow YAML 定义

用户通过 YAML 文件定义完整工作流：

```yaml
name: "产品需求评审"
description: "多角色协作评审 PRD 文档"

# 角色来源（指向 agency-agents 目录）
agents_dir: "./agents"       # 或 node_modules/agency-agents-zh/agents

# LLM 配置
llm:
  provider: "claude"          # claude | openai | ollama
  model: "claude-sonnet-4-6"
  max_tokens: 4096

# 输入变量
inputs:
  - name: prd_content
    description: "PRD 文档内容"
    required: true

# 工作流步骤
steps:
  - id: analyze
    role: "product/product-manager"
    task: "分析以下 PRD，提取核心需求、目标用户和潜在风险：\n\n{{prd_content}}"
    output: requirements

  - id: tech_review
    role: "engineering/engineering-software-architect"
    task: "基于以下需求分析，评估技术可行性并给出架构建议：\n\n{{requirements}}"
    output: tech_report
    depends_on: [analyze]

  - id: design_review
    role: "design/design-ux-researcher"
    task: "基于以下需求分析，评估用户体验风险并给出设计建议：\n\n{{requirements}}"
    output: design_report
    depends_on: [analyze]

  - id: final_summary
    role: "product/product-manager"
    task: |
      综合以下反馈，输出最终评审结论和行动项：

      ## 技术评估
      {{tech_report}}

      ## 设计评估
      {{design_report}}
    depends_on: [tech_review, design_review]
```

**关键设计：**
- `role` 字段引用 agency-agents 的目录路径，自动读取 .md 文件作为 system prompt
- `depends_on` 定义依赖关系，引擎自动计算执行顺序和并行机会
- `output` 命名该步骤的输出，供后续步骤用 `{{变量名}}` 引用
- `{{input变量}}` 引用工作流输入

#### F2: DAG 执行引擎

解析 YAML 中的 `depends_on` 关系，构建有向无环图（DAG）：

- **自动推断并行：** 没有依赖关系的步骤自动并行执行
- **依赖等待：** 一个步骤的所有 `depends_on` 完成后才开始
- **变量传递：** 每步的 `output` 自动注入到下游步骤的 `{{}}` 模板中
- **错误处理：** 某步失败时，依赖它的后续步骤跳过，其他分支继续

执行流程示例：
```
analyze ──→ tech_review ──→ final_summary
         └→ design_review ──┘
          (tech 和 design 并行)
```

#### F3: LLM Connector 接口

抽象的 LLM 调用层。**MVP 只做 1 个 provider**（Claude 或 OpenAI，取决于用户基数），其他 v0.2 加。

```typescript
interface LLMConnector {
  chat(systemPrompt: string, userMessage: string): Promise<LLMResult>;
}

interface LLMResult {
  content: string;
  usage: { input_tokens: number; output_tokens: number };
}
```

**必须处理的现实问题（张权已经遇到了）：**
- **并发控制：** 工作流级别的 `concurrency` 配置（默认 2），防止打满 API rate limit
- **单步超时：** 默认 120s，可配置
- **失败重试：** 429/500 自动 retry，指数退避，最多 3 次

MVP provider：

| Provider | 认证方式 | 模型 |
|----------|---------|------|
| Claude | ANTHROPIC_API_KEY | claude-sonnet-4-6, claude-haiku-4-5 等 |

v0.2 增加：OpenAI、Ollama

#### F4: CLI 入口

```bash
# 执行工作流
npx agency-orchestrator run workflow.yaml --input prd_content=@prd.md

# 验证工作流定义（不执行）
npx agency-orchestrator validate workflow.yaml

# 查看执行计划（DAG 可视化）
npx agency-orchestrator plan workflow.yaml

# 列出可用角色
npx agency-orchestrator roles --agents-dir ./agents
```

**参数说明：**
- `--input key=value` 传入工作流输入变量
- `--input key=@file.md` 从文件读取变量值
- `--agents-dir path` 指定 agency-agents 角色目录
- `--dry-run` 显示将要执行的步骤但不实际调用 LLM
- `--output dir` 指定输出目录（默认 `./ao-output/`）
- `--verbose` 显示每步的完整输入输出

#### F5: 执行过程输出

执行时实时显示进度：

```
🔄 [1/4] analyze — product/product-manager
   ✅ 完成 (3.2s, 856 tokens)

🔄 [2/4] tech_review — engineering/engineering-software-architect
🔄 [2/4] design_review — design/design-ux-researcher  (并行)
   ✅ tech_review 完成 (5.1s, 1203 tokens)
   ✅ design_review 完成 (4.8s, 1067 tokens)

🔄 [4/4] final_summary — product/product-manager
   ✅ 完成 (4.5s, 1542 tokens)

📊 总计: 4 步 | 17.6s | 4668 tokens | $0.032
📁 输出: ao-output/产品需求评审-20260321-163000/
```

输出目录结构：
```
ao-output/产品需求评审-20260321-163000/
├── summary.md          # 最终步骤的输出
├── steps/
│   ├── 1-analyze.md
│   ├── 2-tech_review.md
│   ├── 3-design_review.md
│   └── 4-final_summary.md
└── metadata.json       # 执行耗时、token 用量等
```

### P1 — 增强（v0.2）

#### F6: 人工介入 / 审批节点

真实工作流经常需要人确认后再继续：

```yaml
steps:
  - id: draft_plan
    role: "engineering/engineering-software-architect"
    task: "设计技术方案"
    output: plan

  - id: human_review
    type: approval                    # 特殊节点类型：暂停等人确认
    prompt: "请审阅技术方案，输入 yes 继续，或输入修改意见："
    input: "{{plan}}"
    output: approval_result

  - id: implement
    role: "engineering/engineering-sre"
    task: "按照方案执行：\n{{plan}}\n\n审批意见：{{approval_result}}"
    depends_on: [human_review]
```

CLI 执行到 approval 节点时暂停，等待用户终端输入。

#### F7: 更多 LLM Provider

- OpenAI（gpt-4o, gpt-4o-mini）
- Ollama（本地模型）
- 兼容 OpenAI 格式的第三方（DeepSeek、智谱等）

#### F8: 循环 / 迭代评审

```yaml
steps:
  - id: draft
    role: "marketing/marketing-copywriter"
    task: "撰写产品文案"
    output: copy

  - id: review
    role: "marketing/marketing-brand-strategist"
    task: "评审文案质量，如不合格说明修改意见"
    input: "{{copy}}"
    output: feedback

  - id: revise
    role: "marketing/marketing-copywriter"
    task: "根据反馈修改文案：\n{{feedback}}"
    output: copy                              # 覆盖原 copy 变量
    depends_on: [review]
    loop:
      back_to: review                         # 修改后重新评审
      max_iterations: 3
      exit_condition: "feedback contains '通过'"
```

#### F9: 条件分支

```yaml
steps:
  - id: classify
    role: "product/product-manager"
    task: "判断此需求属于哪类，只回答一个词：bug_fix / new_feature / refactor"
    output: category
    # 注意：LLM 输出不可控，条件判断要做模糊匹配，不能精确 equals

  - id: bug_flow
    role: "engineering/engineering-sre"
    task: "分析 bug 根因并给出修复方案"
    depends_on: [classify]
    condition: "{{category}} contains 'bug'"

  - id: feature_flow
    role: "engineering/engineering-software-architect"
    task: "设计功能架构方案"
    depends_on: [classify]
    condition: "{{category}} contains 'feature'"
```

> ⚠️ 条件分支依赖 LLM 输出格式，天然不可靠。实现时需要：模糊匹配 + fallback 默认分支。

#### F10: 子工作流

```yaml
steps:
  - id: backend
    workflow: "./workflows/code-review.yaml"  # 引用另一个工作流
    input:
      code: "{{backend_code}}"

  - id: frontend
    workflow: "./workflows/code-review.yaml"
    input:
      code: "{{frontend_code}}"
```

#### F11: Webhook / 回调

```yaml
hooks:
  on_step_complete:
    url: "https://hooks.slack.com/xxx"
    template: "✅ {{step.id}} 完成 by {{step.role}}"
  on_workflow_complete:
    url: "https://your-api.com/callback"
```

### P2 — 生态（v0.3+）

#### F12: 预置工作流模板

```
workflows/
├── product-review.yaml        # 产品需求评审
├── content-pipeline.yaml      # 内容创作流水线
├── code-review.yaml           # 代码评审流程
├── incident-response.yaml     # 故障响应流程
├── hiring-pipeline.yaml       # 招聘评估流程
└── marketing-campaign.yaml    # 营销活动策划
```

#### F13: Web UI（可视化编排）

- 拖拽创建工作流
- 实时查看执行进度
- 历史执行记录

#### F14: MCP Server 模式

作为 MCP Server 运行，让 Claude Code / Cursor 等工具可以直接调用工作流：

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

## 技术架构

```
agency-orchestrator/
├── src/
│   ├── index.ts               # 入口，导出 API
│   ├── cli.ts                 # CLI 命令解析
│   ├── core/
│   │   ├── parser.ts          # YAML → WorkflowDefinition
│   │   ├── dag.ts             # 构建 DAG，拓扑排序
│   │   ├── executor.ts        # DAG 执行引擎
│   │   └── template.ts        # {{变量}} 模板引擎
│   ├── connectors/
│   │   ├── interface.ts       # LLMConnector 接口
│   │   ├── claude.ts          # Claude API
│   │   ├── openai.ts          # OpenAI API
│   │   └── ollama.ts          # Ollama 本地
│   ├── agents/
│   │   └── loader.ts          # 读取 agency-agents .md 文件，提取 system prompt
│   └── output/
│       └── reporter.ts        # 执行结果输出和保存
├── workflows/                 # 预置模板
├── docs/
│   ├── PRD.md                 # 本文档
│   └── ARCHITECTURE.md
├── package.json
├── tsconfig.json
└── README.md
```

**依赖策略：**
- 允许成熟的小依赖：js-yaml（YAML 解析）、@anthropic-ai/sdk（Claude API）
- 不依赖大框架：不用 LangChain / CrewAI / AutoGen
- TypeScript 编译仅 devDependency

## 与现有项目的关系

```
agency-agents-zh (186 个角色定义)
        │
        ▼ 引用
agency-orchestrator (编排引擎)  ← 本项目
        │
        ▼ 可选集成
shellward (安全中间件，拦截危险调用)
```

- **agency-agents-zh** 是「角色库」，提供角色的 system prompt
- **agency-orchestrator** 是「调度器」，决定谁做什么、什么顺序
- **shellward** 是「安全层」，可选接入，拦截危险的 LLM 调用

## 命名

| 候选 | 优点 | 缺点 |
|------|------|------|
| agency-orchestrator | 直观，跟 agency-agents 一脉相承 | 名字长 |
| agency-flow | 简短，flow 表达工作流 | 太通用 |
| agency-pipe | 管道概念 | 暗示纯串行 |
| agentflow | 更简短 | 可能已被占用 |

建议：**agency-orchestrator**（明确关联，不会歧义）

## 里程碑

| 版本 | 功能 | 核心验证 |
|------|------|----------|
| v0.1 | F1-F5：YAML 定义 + DAG 引擎 + 1 个 LLM Connector (Claude) + CLI + 输出 | 能跑通「产品评审」示例工作流 |
| v0.2 | F6-F11：人工介入 + 更多 Provider + 循环 + 条件分支 + 子工作流 + Webhook | 能处理需要人确认的真实业务流程 |
| v0.3 | F12-F14：模板库 + Web UI + MCP Server | 非开发者也能用 |

## 开放问题

1. **agent .md 文件的解析规则？** —— agency-agents 的 .md 文件有 frontmatter + 正文，格式不完全统一。MVP 策略：取全文作为 system prompt，后续再做精细解析。
2. **token 预算管理？** —— 是否需要在工作流级别设置 token 上限？MVP 先只做统计不做限制。
3. **执行中断和恢复？** —— 长工作流执行到一半断了，是否需要断点续跑？P2 考虑。
4. **npm 包名？** —— 需要确认 `agency-orchestrator` 在 npm 上可用。
5. **国内 API 兼容？** —— 很多国内用户用 DeepSeek / 智谱 / 通义，它们大多兼容 OpenAI 格式，v0.2 加 OpenAI provider 时要考虑 `base_url` 自定义。
