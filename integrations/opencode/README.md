# OpenCode 集成

在 OpenCode（开源终端 AI 编程工具）中直接运行多角色工作流，无需额外 API key。

> 🌐 **English users:** `npm install -g agency-orchestrator` — both 211 Chinese and 170+ English roles are bundled. Use `ao compose "your idea" --run` from CLI, or follow this guide for IDE-specific setup (translations coming in v0.6).

## 安装

```bash
# 1. 下载 211 个 AI 角色
cd your-project
git clone --depth 1 https://github.com/jnMetaCode/agency-agents-zh.git

# 2. 下载工作流模板和指令文件
git clone --depth 1 https://github.com/jnMetaCode/agency-orchestrator.git .ao-tmp
cp -r .ao-tmp/workflows ./workflows
mkdir -p .opencode
cp .ao-tmp/integrations/opencode/instructions.md .opencode/instructions.md
rm -rf .ao-tmp

# 3. 开始使用
# 在 OpenCode 中直接说：运行 workflows/story-creation.yaml
```

如果 `.opencode/instructions.md` 已存在，可将内容追加而非覆盖：

```bash
# 替换上面第 2 步中的 cp 命令为：
cat .ao-tmp/integrations/opencode/instructions.md >> .opencode/instructions.md
```

## 使用方式

### 方式一：Skill 模式（推荐）

在 OpenCode 会话中直接说：

```
运行 workflows/story-creation.yaml，创意是"一个程序员在凌晨发现AI回复不该知道的事"
```

OpenCode 会根据 `.opencode/instructions.md` 中的 workflow-runner 指令：
- 解析 YAML 工作流
- 加载每个角色的 .md 定义
- 按 DAG 顺序逐步执行
- 保存结果到 `ao-output/`

### 方式二：自然语言模式

不需要 YAML 文件，直接描述协作需求：

```
用叙事学家设计结构，心理学家塑造人物，内容创作者执笔，帮我写一个关于时间旅行的故事
```

### 方式三：CLI 模式（用 OpenCode 已配好的供应商跑 AO，免另配 key）

```bash
npm install -g agency-orchestrator
ao doctor                                                  # 应显示「已装 CLI：… opencode-cli」
ao run workflows/story-creation.yaml --provider opencode-cli -i premise="时间旅行的故事"
```

YAML：

```yaml
llm:
  provider: "opencode-cli"
  # model 留空 = 用 opencode 配置里的默认；指定要写成 provider/model（如 anthropic/claude-sonnet-5）
```

已验证（opencode 1.18.27，2026-09-03，macOS）：`opencode run --format json` 输出 NDJSON，答案取 `text` 事件；
stdin 写完必须关闭，否则它一直等（AO 已处理）；AO 每次把它的工作目录 `--dir` 指到空临时目录，模型想写文件也落不到你的项目。
供应商配置在 `~/.config/opencode/opencode.json`（`OPENCODE_CONFIG` 可换路径），`opencode auth login` 也行。

### 方式四：直连 API

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

参见 [工作流格式文档](../../README.md)。
