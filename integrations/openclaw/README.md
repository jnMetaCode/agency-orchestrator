# OpenClaw 集成

在 OpenClaw 中直接运行多角色工作流，无需 API key。

## 安装

```bash
# 1. 安装角色定义
cd your-project
git clone --depth 1 https://github.com/jnMetaCode/agency-agents-zh.git

# 2. 安装 superpowers-zh（包含 workflow-runner 技能）
npx superpowers-zh
```

## 使用方式

### 方式一：Skill 模式（推荐）

在 OpenClaw 会话中直接说：

```
运行 workflows/story-creation.yaml
创意：一个程序员在凌晨发现AI回复不该知道的事
```

OpenClaw 会通过 superpowers-zh 的 `workflow-runner` 技能：
- 解析 YAML 工作流
- 加载每个角色的 .md 定义
- 按 DAG 顺序逐步执行
- 保存结果到 `.ao-output/`

### 方式二：自然语言模式

不需要 YAML 文件，直接描述协作需求：

```
用产品经理分析需求，然后让架构师评估技术方案、设计师评估用户体验，最后产品经理汇总。
PRD 内容：[你的 PRD]
```

### 方式三：CLI 模式

```bash
npm install -g agency-orchestrator
export DEEPSEEK_API_KEY=sk-xxx
ao run workflows/product-review.yaml -i prd_content=@prd.md
```

## 可用工作流

| 工作流 | 文件 | 说明 |
|--------|------|------|
| 短篇小说创作 | `story-creation.yaml` | 叙事学家 → 心理学家 + 叙事设计师 → 内容创作者 |
| 产品需求评审 | `product-review.yaml` | 产品经理 → 架构师 + UX → 产品经理 |
| 内容流水线 | `content-pipeline.yaml` | 策略师 → 创作者 + SEO → 编辑 |

## 自定义工作流

参见 [工作流格式文档](../../README.zh-CN.md)。
