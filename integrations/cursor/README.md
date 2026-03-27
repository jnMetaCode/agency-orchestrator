# Cursor 集成

在 Cursor 中使用多角色工作流，无需 API key。

## 安装

```bash
# 1. 下载 186 个 AI 角色
cd your-project
git clone --depth 1 https://github.com/jnMetaCode/agency-agents-zh.git

# 2. 下载工作流模板和技能文件
git clone --depth 1 https://github.com/jnMetaCode/agency-orchestrator.git .ao-tmp
cp -r .ao-tmp/workflows ./workflows
mkdir -p .cursor/rules
cp .ao-tmp/integrations/cursor/workflow-runner.mdc .cursor/rules/
rm -rf .ao-tmp

# 3. 开始使用
# 在 Cursor 中直接说：运行 workflows/story-creation.yaml
```

## 使用方式

### 方式一：通过 Cursor Rule 自动执行（推荐）

将下面的内容保存到 `.cursor/rules/workflow-runner.mdc`：

```markdown
---
description: "当用户要求运行 YAML 工作流或多角色协作时触发"
alwaysApply: false
---

## 多角色工作流执行器

当用户要求运行工作流时，按以下步骤执行：

### 1. 解析工作流
读取用户指定的 YAML 文件，提取 name、inputs、steps、depends_on。

### 2. 收集输入
- required: true 的输入必须向用户索取
- 有 default 的可选输入使用默认值

### 3. 构建执行顺序
按 depends_on 拓扑排序。没有依赖关系的步骤属于同一层。

### 4. 逐步执行
对每个步骤：
1. 读取 agency-agents-zh/{role}.md 文件
2. 提取 frontmatter 之后的 markdown 内容作为角色人格
3. 将 task 中的 {{变量}} 替换为上下文值
4. **以该角色身份** 完成任务，输出要体现角色专业性
5. 将输出存入上下文变量（如果有 output 字段）

每步开始时标注：### Step N/Total: step_id（角色名）

### 5. 保存结果
保存到 ao-output/{名称}-{日期}/ 目录：
- steps/1-{id}.md — 每步输出
- summary.md — 最终成果
```

安装后在 Cursor 中直接说：

```
运行 workflows/story-creation.yaml，创意是"一个程序员在凌晨发现AI回复不该知道的事"
```

### 方式二：直接在 Chat 中使用

将工作流 YAML 粘贴给 Cursor，并说明输入：

```
请按照以下工作流执行，每一步读取 agency-agents-zh 对应角色文件并扮演该角色完成任务：

[粘贴 YAML 内容]

输入：premise = "一个程序员在凌晨发现AI回复不该知道的事"
```

### 方式三：CLI 模式（需要 API key）

```bash
npm install -g agency-orchestrator
export DEEPSEEK_API_KEY=sk-xxx
ao run workflows/story-creation.yaml -i 'premise=时间旅行'
```

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
# 或在 Cursor 中说：列出 agency-agents-zh 里的所有角色
```
