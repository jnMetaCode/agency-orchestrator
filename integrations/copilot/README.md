# GitHub Copilot 集成

在 GitHub Copilot（VS Code / JetBrains）中直接运行多角色工作流，无需额外 API key。

## 安装

```bash
# 1. 下载 179 个 AI 角色
cd your-project
git clone --depth 1 https://github.com/jnMetaCode/agency-agents-zh.git

# 2. 下载工作流模板和指令文件
git clone --depth 1 https://github.com/jnMetaCode/agency-orchestrator.git .ao-tmp
cp -r .ao-tmp/workflows ./workflows
mkdir -p .github
cp .ao-tmp/integrations/copilot/copilot-instructions.md .github/copilot-instructions.md
rm -rf .ao-tmp

# 3. 开始使用
# 在 Copilot Chat 中直接说：运行 workflows/story-creation.yaml
```

如果项目已有 `.github/copilot-instructions.md`，可将内容追加而非覆盖：

```bash
# 替换上面第 2 步中的 cp 命令为：
cat .ao-tmp/integrations/copilot/copilot-instructions.md >> .github/copilot-instructions.md
```

## 使用方式

### 方式一：Copilot Chat 模式（推荐）

将 `copilot-instructions.md` 放入 `.github/` 后，Copilot Chat 会自动加载项目级指令。在 Copilot Chat 中直接说：

```
运行 workflows/story-creation.yaml，创意是"一个程序员在凌晨发现AI回复不该知道的事"
```

或者不用 YAML 文件，直接描述协作需求：

```
用叙事学家设计结构，心理学家塑造人物，内容创作者执笔，帮我写一个关于时间旅行的故事
```

Copilot 会自动：
- 解析工作流 / 生成工作流
- 按 DAG 顺序加载每个角色
- 扮演角色执行每一步
- 将结果保存到 `ao-output/`

### 方式二：CLI 模式（需要 API key）

如果你需要批量执行、CI/CD 集成或脚本调用：

```bash
npm install -g agency-orchestrator
export DEEPSEEK_API_KEY=sk-xxx   # 或 ANTHROPIC_API_KEY / OPENAI_API_KEY
ao run workflows/story-creation.yaml -i 'premise=时间旅行的故事'
```

## 对比

| 特性 | Copilot Chat 模式 | CLI 模式 |
|------|:----------:|:--------:|
| 需要 API key | 不需要 | 需要 |
| 需要安装 | copilot-instructions.md → .github/ | agency-orchestrator |
| 执行环境 | Copilot Chat 会话内 | 终端 |
| 并行执行 | 代理按 DAG 层级依次执行 | Promise.allSettled |
| 适合场景 | 交互式、一次性任务 | 批量、自动化、CI/CD |
| 输出 | 会话内 + 文件 | 文件 |

## 可用工作流

| 工作流 | 文件 | 说明 |
|--------|------|------|
| 短篇小说创作 | `story-creation.yaml` | 叙事学家 → 心理学家 + 叙事设计师 → 内容创作者 |
| 产品需求评审 | `product-review.yaml` | 产品经理 → 架构师 + UX 研究员 → 产品经理 |
| 内容流水线 | `content-pipeline.yaml` | 策略师 → 创作者 + SEO → 编辑 |

## 自定义工作流

创建你自己的 YAML 工作流文件：

```yaml
name: "我的工作流"
agents_dir: "agency-agents-zh"

inputs:
  - name: topic
    description: "主题"
    required: true

steps:
  - id: research
    role: "marketing/marketing-content-strategist"
    task: "研究以下主题的内容策略：{{topic}}"
    output: strategy

  - id: write
    role: "marketing/marketing-content-creator"
    task: "根据以下策略撰写文章：{{strategy}}"
    depends_on: [research]
```

查看所有可用角色：

```bash
ao roles
# 或在 Copilot Chat 中说：列出 agency-agents-zh 里的所有角色
```
