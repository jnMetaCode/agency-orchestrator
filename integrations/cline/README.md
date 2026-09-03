# Cline CLI 集成

用 Cline 里已经配好的供应商 / 账号跑 AO 工作流，AO 这边不用再配 key。

```bash
npm install -g cline
cline auth -p <provider> -k <key> [-b <base_url>] [-m <model>]   # 或直接 cline auth 交互选
ao doctor                                                          # 应显示「已装 CLI：… cline-cli」
ao run workflows/story-creation.yaml --provider cline-cli -i premise="时间旅行的故事"
```

YAML 写法：

```yaml
llm:
  provider: "cline-cli"
  # model 留空 = 用 cline auth 里配的默认模型；指定则传给 cline -m
```

## 已验证的事实（2026-09-02，cline 3.0.61，macOS）

- 一次性任务：提示词作为位置参数，跑完退出；`--json` 输出 NDJSON，最后一行 `type: "run_result"` 的 `text` 才是答案，AO 只取这一行。
- **AO 不走 stdin**。shell 管道（真 FIFO）它读，但 Node spawn 的管道是 socket、普通文件也不行——它只在 stdin 是 FIFO 时才读，AO 送进去的内容它看不见（三种都复现过）。所以角色提示词走 `-s`（整个替换它自带的 agentic 系统提示词，23KB 实测没问题），任务走位置参数；超过系统命令行上限时明确报错，不悄悄截断。
- **提示词必须含空白字符**（空格或换行都行）。纯中文无空格的一串会被它当成"未知命令"拒绝
  （`Unknown command or unquoted prompt`）。AO 会自动补一个空格。
- `-t <秒>` 是它自己的超时，AO 传的是本步超时（默认 600 秒），两边对齐。
- `-p` 是 **plan 模式**，不是 print，别按 Claude Code 的习惯理解。
- 认证与默认模型在 `~/.cline/data`（`CLINE_DATA_DIR` 可改）；`-P openai` 配合 `-b` 能接任何 OpenAI 兼容端点，真机用一家中转跑通。
- 装的是 Node 22.14 时 stderr 会多一行 trust store 警告，无害。
- 它会在后台留一个 `cline --cline-hub-daemon` 常驻进程（本机 127.0.0.1 随机端口），这是 Cline 自己的 hub，AO 不管它；不想要就 `cline hub stop`。

## 注意

- Cline 是 agentic 工具，工具调用默认自动批准，且**没有关掉工具的开关**。AO 每次调用都把它的工作目录（`-c`）指到一个空的临时目录，跑完即删：模型就算想写文件也落不到你的项目里。
- 角色**不**装进 Cline：`.clinerules/` 是全局注入的规则，不是可选的子智能体，把 276 个角色塞进去只会污染每次对话。要在编码工具里用角色，装 [WorkBuddy](../workbuddy/) / Claude Code / opencode 这类有 agents 目录的。
- 额度/费用归 Cline 里配的那个供应商。

## 可用工作流

| 工作流 | 文件 | 说明 |
|--------|------|------|
| 短篇小说创作 | `story-creation.yaml` | 叙事学家 → 心理学家 + 叙事设计师 → 内容创作者 |
| 产品需求评审 | `product-review.yaml` | 产品经理 → 架构师 + UX → 产品经理 |
| 内容流水线 | `content-pipeline.yaml` | 策略师 → 创作者 + SEO → 编辑 |
