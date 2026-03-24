# Codex CLI 集成

在 OpenAI Codex CLI 中直接运行多角色工作流，无需额外 API key。

## 安装

```bash
# 1. 下载 186 个 AI 角色
cd your-project
git clone --depth 1 https://github.com/jnMetaCode/agency-agents-zh.git

# 2. 下载工作流模板和技能文件
git clone --depth 1 https://github.com/jnMetaCode/agency-orchestrator.git .ao-tmp
cp -r .ao-tmp/workflows ./workflows
mkdir -p .codex
cp .ao-tmp/integrations/codex/instructions.md .codex/instructions.md
rm -rf .ao-tmp

# 3. 开始使用
# 在 Codex CLI 中直接说：运行 workflows/story-creation.yaml
```

如果 `.codex/instructions.md` 已存在，可将内容追加而非覆盖：

```bash
# 替换上面第 2 步中的 cp 命令为：
cat .ao-tmp/integrations/codex/instructions.md >> .codex/instructions.md
```

## 使用方式

### 方式一：Skill 模式（推荐）

在 Codex CLI 会话中直接说：

```
运行 workflows/story-creation.yaml
创意：一个程序员在凌晨发现AI回复不该知道的事
```

Codex CLI 会根据 `.codex/instructions.md` 中的 workflow-runner 指令：
- 解析 YAML 工作流
- 加载每个角色的 .md 定义
- 按 DAG 顺序逐步执行
- 保存结果到 `.ao-output/`

### 方式二：自然语言模式

不需要 YAML 文件，直接描述协作需求：

```
用叙事学家设计结构，心理学家塑造人物，内容创作者执笔，帮我写一个关于时间旅行的故事
```

### 方式三：CLI 模式

```bash
npm install -g agency-orchestrator
export DEEPSEEK_API_KEY=sk-xxx
ao run workflows/story-creation.yaml -i 'premise=时间旅行的故事'
```

## 可用工作流

| 工作流 | 文件 | 说明 |
|--------|------|------|
| 短篇小说创作 | `story-creation.yaml` | 叙事学家 → 心理学家 + 叙事设计师 → 内容创作者 |
| 产品需求评审 | `product-review.yaml` | 产品经理 → 架构师 + UX → 产品经理 |
| 内容流水线 | `content-pipeline.yaml` | 策略师 → 创作者 + SEO → 编辑 |

## 自定义工作流

参见 [工作流格式文档](../../README.zh-CN.md)。
