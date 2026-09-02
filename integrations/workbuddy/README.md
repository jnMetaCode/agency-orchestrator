# WorkBuddy / CodeBuddy 集成

腾讯 WorkBuddy 桌面版内置的就是 CodeBuddy CLI（`codebuddy`）。AO 和它有两种搭法，互不依赖：

| 搭法 | 一句话 | 命令 |
|------|--------|------|
| **A. 把 276 个专家角色装进 WorkBuddy** | 在 WorkBuddy 里直接 @ 角色用，不跑工作流 | `ao install --tool workbuddy --lang zh` |
| **B. 用 WorkBuddy 会员额度跑 AO 工作流** | 多角色 DAG 协作，不用配 API key，不花钱 | `ao run <workflow.yaml> --provider codebuddy-cli` |

## A. 角色装进 WorkBuddy（子智能体）

```bash
npm install -g agency-orchestrator
ao install --tool workbuddy --lang zh          # → ~/.workbuddy/agents/<分类>-<角色>.md
ao install --tool workbuddy --category engineering --dry-run   # 只看不写
```

- WorkBuddy 产品态下 CodeBuddy CLI 的配置目录是 `~/.workbuddy`，子智能体读 `~/.workbuddy/agents/*.md`；
  独立 npm 安装的 CodeBuddy CLI 读 `~/.codebuddy/agents/`（`ao install --tool codebuddy`），
  `CODEBUDDY_CONFIG_DIR` 可整体改位置。
- 角色文件 frontmatter（`name` / `description`）与 Claude Code 子智能体同格式，逐字复制，不做转换。
  WorkBuddy 自己的「experts」插件市场用的也是这个格式。
- 角色按 frontmatter 里的 **`name`** 被识别（不是文件名）：对话里点名「让 产品经理（PM） 评审这个方案」，
  命令行则是 `codebuddy --agent "产品经理（PM）"`。实测（codebuddy 2.103.3）：装进 `agents/` 后不用重启，
  下一次调用就以该角色身份作答。
  重装会覆盖同名文件；想删就删 `~/.workbuddy/agents/` 里对应的 `.md`。

## B. 用会员额度跑工作流（`codebuddy-cli`）

```bash
# WorkBuddy 桌面版（macOS）已登录：什么都不用装，AO 自动找到它内置的 codebuddy
ao doctor                                   # 应显示「已装 CLI：… codebuddy-cli」
ao run workflows/story-creation.yaml --provider codebuddy-cli -i premise="时间旅行的故事"

# 没装桌面版：npm 全局装 CLI，终端跑一次 codebuddy 完成登录
npm install -g @tencent-ai/codebuddy-code
codebuddy
```

YAML 写法：

```yaml
llm:
  provider: "codebuddy-cli"
  # model 留空 = auto；要指定就用 `codebuddy --help` 里列出的 id（glm-5.1 / kimi-k2.5 / minimax-m2.7 …）
```

### 已验证的事实（2026-09-02，WorkBuddy 5.1.7 / codebuddy 2.103.3，macOS）

- 内置 CLI 位置：`/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy`，不在 PATH 上，
  AO 的可执行文件解析（`src/utils/bin-lookup.ts`）会额外查这里；`ao doctor` 与真正运行用同一份路径表。
- 调用方式与 Claude Code 逐项对齐：`-p -` 读 stdin、`--output-format json`、`--system-prompt-file`、
  `--tools ""` 关掉全部工具（AO 步骤是纯文本推理，不需要工具）、`--effort low`。
- JSON 输出是整段对话的**数组**，最后一个元素 `type: "result"` 才是答案；AO 已兼容。
- 会话会记到 `~/.codebuddy/projects/`（CLI 没有 `--no-session-persistence`），无害。
- Windows / Linux 的桌面版打包位置没有实证，AO 不猜：那两端请 `npm install -g @tencent-ai/codebuddy-code`。

### 注意

- 额度归会员，AO 只是替你调用；额度用尽的报错来自腾讯侧，换 provider 或等额度恢复即可。
- 该 CLI 是 agentic 工具，AO 每步都以 `--tools ""` 关掉工具调用，不会替你改文件、跑命令。
- 与 [OpenClaw](../openclaw/) 一样，**不要在 WorkBuddy 内部再让 AO 用 `codebuddy-cli`**，会形成 WorkBuddy → ao → codebuddy 的环。

## 可用工作流

| 工作流 | 文件 | 说明 |
|--------|------|------|
| 短篇小说创作 | `story-creation.yaml` | 叙事学家 → 心理学家 + 叙事设计师 → 内容创作者 |
| 产品需求评审 | `product-review.yaml` | 产品经理 → 架构师 + UX → 产品经理 |
| 内容流水线 | `content-pipeline.yaml` | 策略师 → 创作者 + SEO → 编辑 |

## 自定义工作流

参见 [工作流格式文档](../../README.md)。
