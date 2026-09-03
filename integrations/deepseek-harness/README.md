# DeepSeek Harness（dsh）集成

> ⚠️ DeepSeek Harness 是**开发者预览**，官方 README 原话："THERE WILL BE COMPATIBILITY-BREAKING CHANGES"。
> 本页事实以 `@deepseek-ai/dsh` 0.1.1-rc.2（2026-09-03）真机为准，它下个版本就可能变。

用 dsh 配好的供应商跑 AO 工作流，AO 这边不另配 key。

```bash
node --version                      # 必须 ≥ 22.15（用到 zlib 的 zstd；22.14 会在加载插件时崩）
npm install -g @deepseek-ai/dsh
export DEEPSEEK_API_KEY=sk-...      # 默认走 deepseek-official / deepseek-v4-flash
ao doctor                           # 应显示「已装 CLI：… dsh-cli」
ao run workflows/story-creation.yaml --provider dsh-cli -i premise="时间旅行的故事"
```

YAML：

```yaml
llm:
  provider: "dsh-cli"
  # model 留空 = dsh 自己的默认；要换就写 provider/model（provider 必须在它的 settings.yaml 里存在）
  # model: "deepseek-official/deepseek-v4-pro"
```

## 接别家 OpenAI 兼容端点

`$DSH_HOME/settings.yaml`（默认 `~/.dsh/settings.yaml`）：

```yaml
llm-pi-ai:
  providers:
    my-gateway:
      displayName: My Gateway
      apiKeyEnv: GATEWAY_API_KEY        # 只是环境变量名，密钥不进文件
      api: openai-completions
      baseURL: https://gateway.example/v1
      models:
        - id: my-model
          contextWindow: 128000
          maxTokens: 8192
```

然后 YAML 里 `model: "my-gateway/my-model"`，并设好 `GATEWAY_API_KEY`。真机用一家中转按这个写法跑通。

## 已验证的事实

- `dsh --profile headless "<任务>"`：答案打到 stdout（纯文本，没有 JSON 包装），推理过程打到 stderr（`dsh: reasoning:` 前缀），完成 exit 0。
- **不读 stdin**：管道写进去的内容模型看不见。整段提示词走位置参数，23KB 角色实测可行；超过系统命令行上限 AO 明确报错。
- 无空格的纯中文提示词也接受（和 Cline 不同）。
- 首次启动会在 `$DSH_HOME/profiles/headless` 初始化 profile，要等一会儿。
- 它会把 `~/.agents/skills` 下的技能带进上下文，这是它自己的行为，AO 不干预。

## 注意

- 它是 agentic 工具（bash / 文件工具），把当前目录当工作区，没有关工具的开关。AO 每次在空临时目录里跑，跑完即删。
- 没有子智能体目录，`ao install` 不支持它；它认的是 Anthropic 风格的 SKILL.md（`~/.agents/skills`），那是技能不是角色。
- AO 默认供应商本来就是 DeepSeek 直连；走 dsh 不省钱，只多了它的工具能力（AO 步骤用不上）。适合"机器上只配了 dsh"的场景。

## 可用工作流

| 工作流 | 文件 | 说明 |
|--------|------|------|
| 短篇小说创作 | `story-creation.yaml` | 叙事学家 → 心理学家 + 叙事设计师 → 内容创作者 |
| 产品需求评审 | `product-review.yaml` | 产品经理 → 架构师 + UX → 产品经理 |
| 内容流水线 | `content-pipeline.yaml` | 策略师 → 创作者 + SEO → 编辑 |
