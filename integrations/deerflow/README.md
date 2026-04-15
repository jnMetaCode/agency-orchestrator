# DeerFlow 2.0 集成

在 DeerFlow（字节跳动开源 SuperAgent）中直接运行多角色工作流。

> 🌐 **English users:** `npm install -g agency-orchestrator` — both 211 Chinese and 170+ English roles are bundled. Use `ao compose "your idea" --run` from CLI, or follow this guide for IDE-specific setup (translations coming in v0.6).

## 安装

```bash
# 1. 下载 211 个 AI 角色
cd your-project
git clone --depth 1 https://github.com/jnMetaCode/agency-agents-zh.git

# 2. 下载工作流模板和技能文件
git clone --depth 1 https://github.com/jnMetaCode/agency-orchestrator.git .ao-tmp
cp -r .ao-tmp/workflows ./workflows
mkdir -p skills/custom/ao-workflow-runner
cp .ao-tmp/integrations/deerflow/SKILL.md skills/custom/ao-workflow-runner/SKILL.md
rm -rf .ao-tmp

# 3. 开始使用
# 在 DeerFlow 中直接说：运行 workflows/story-creation.yaml
```

## 使用方式

### 方式一：Skill 模式（推荐）

DeerFlow 会自动发现 `skills/custom/ao-workflow-runner/SKILL.md` 中的技能。在会话中直接说：

```
运行 workflows/story-creation.yaml
创意：一个程序员在凌晨发现AI回复不该知道的事
```

DeerFlow 会通过 ao-workflow-runner 技能：
- 解析 YAML 工作流
- 加载每个角色的 .md 定义
- 按 DAG 顺序逐步执行
- 保存结果到 `ao-output/`

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

参见 [工作流格式文档](../../README.md)。
