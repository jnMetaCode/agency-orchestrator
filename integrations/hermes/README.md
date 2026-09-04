# Hermes Agent 集成

用 [Hermes Agent](https://github.com/NousResearch/hermes-agent)（NousResearch 开源）里配好的模型跑 AO 工作流，AO 这边不另配 key。

```bash
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
hermes                                   # 首次按它的引导配好供应商 / token
ao doctor                                # 应显示「已装 CLI：… hermes-cli」
ao run workflows/story-creation.yaml --provider hermes-cli -i premise="时间旅行的故事"
```

YAML：

```yaml
llm:
  provider: "hermes-cli"
  # model 留空 = 用 hermes 配置里的默认；指定则传给 hermes --model（如 anthropic/claude-sonnet-4、openai/gpt-4o）
```

## AO 怎么调它（见 `src/connectors/hermes-cli.ts`）

- 一次性模式：`hermes -z "<提示词>" [--model <id>]`。旧版的 `hermes chat -q` 已废弃（issue #14），装了旧版会报"命令格式已变"。
- **不读 stdin**：`-z -` 只会把减号当成字面量提示词，所以角色 + 任务整段走命令行参数；超过系统命令行上限时 AO 明确报错并建议换支持 stdin 的 provider（claude-code / codex-cli / codebuddy-cli）。
- Windows 下不走 cmd.exe（issue #102：提示词里的 `<system>` 和换行会被当成重定向），参数原样进子进程。

## 注意

- 本页没有在 2026-09 这轮重新真机验证（本机没装 hermes）；连接器本身的事实来自 issue #14 / #102 的用户实测。接口若再变，先在终端跑一次 `hermes -z "说 你好"` 看真实输出再调 AO 配置。
- Hermes 没有子智能体目录（只有 skills），`ao install` 不支持它。
- 额度/费用归 hermes 里配的那个供应商。

## 可用工作流

| 工作流 | 文件 | 说明 |
|--------|------|------|
| 短篇小说创作 | `story-creation.yaml` | 叙事学家 → 心理学家 + 叙事设计师 → 内容创作者 |
| 产品需求评审 | `product-review.yaml` | 产品经理 → 架构师 + UX → 产品经理 |
| 内容流水线 | `content-pipeline.yaml` | 策略师 → 创作者 + SEO → 编辑 |
