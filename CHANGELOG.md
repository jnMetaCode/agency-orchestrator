# Changelog

本项目采用 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.6.15] - 2026-04-27

### Fixed
- CLI provider（claude-code / gemini-cli / copilot-cli / codex-cli / openclaw-cli / hermes-cli）在"进程退出码 0 但 stdout 完全空"时，cli-base.ts 之前会默默返回空字符串给上层，导致 `ao compose` 报出迷惑性的"AI 生成的内容不是有效的 workflow YAML"，真实根因被吞。现在直接 reject 并给出诊断 hint：可能是 CLI 命令格式过期（参考 issue #14 hermes 的 `chat -q` → `-z`）、agent / model 配置错、或需要先认证。错误消息附上"在终端直接跑一次该命令看真实输出"的具体调试建议

### Tests
- 新增 test/cli-base.ts：覆盖 4 类场景（exit 0 + 空输出 reject / 正常输出 / exit 非 0 + stderr / ENOENT 提示安装），全量从 135 项增加到 **139 项**

## [0.6.14] - 2026-04-27

### Fixed
- **#16** DeepSeek 原生 connector 在某些用户环境下报 `405 Method Not Allowed`。根因：commit `f96d7b0` 让 deepseek case fallback 到 `OPENAI_BASE_URL` env，但用户先用 `ao init --provider openai --base-url https://api.openai.com/v1` 写入过 `OPENAI_BASE_URL` 后切到 deepseek，会用 OpenAI endpoint + DeepSeek key 调用，得到 405。修复：每个 provider 用自己专属的 BASE_URL env（deepseek → `DEEPSEEK_BASE_URL`，openai → `OPENAI_BASE_URL`），不再跨污染。`ao init` 也对应路由到正确 env

### Tests
- 修补一个发版 process 漏洞：`factory-custom.ts` / `step-llm.ts` / `step-llm-yaml.ts` / `stdin-limit.ts` / `compose-name.ts` 这 5 个测试文件之前**根本没在 `npm test` 里跑**（21 项 +1 项新加的测试都不被 CI 守护）。补进 test 脚本，全量从 114 项增加到 **135 项**
- 新增 2 项 factory-custom 测试覆盖 #16：deepseek 不被 OPENAI_BASE_URL 污染 / DEEPSEEK_BASE_URL 自定义代理仍生效

## [0.6.13] - 2026-04-27

### Fixed
- **回归修复**：0.6.12 新加的"output 唯一性校验"对两类合法的 ao 设计模式误报，导致 6 个内置 workflow 在 validate 时失败。现在校验放过两类例外：
  - **`any_completed` 分支收敛**：多个并行 step 产出同名 output，下游用 `depends_on_mode: any_completed` 引用，是有意的"任一分支完成即走"设计（如 incident-response.yaml 的多团队并行分析、hiring-pipeline.yaml 的多维度评估）
  - **loop 迭代覆盖**：种子 step 产生初始值 + loop step 反复覆盖同名 output，是常见的"原地修改"迭代模式（如 content-publish.yaml 的 write/revise 循环）
- 修了 3 个内置 workflow 的拓扑反向引用：legal-consultation.yaml / investment-analysis.yaml / xiaohongshu-content.yaml 的相关 step 补 `depends_on`（不是新校验过严，是 yaml 本身设计就有缺陷，新校验把它们暴露出来）

### Tests
- 新增 2 项 parser 测试覆盖 any_completed / loop 迭代覆盖的合法重名例外
- E2E 验证：44 个内置 workflow 现在全部通过 validate

## [0.6.12] - 2026-04-27

### Fixed
- **#14** `hermes-cli` connector 用旧参数 `chat -q` 调用 hermes，新版 hermes 已废弃此用法、改为 `-z`（oneshot）。修正参数让 hermes provider 重新可用
- `validateWorkflow` 之前只检查"变量是否在某处定义"，不检查"是否在引用方的 DAG 上游"。一个 step 引用下游 step 的 output（拓扑反向）会通过校验，到 run 阶段才崩。现在校验阶段就拦下，错误提示明确指出"该变量由非上游 step 产出，需要把对应 step 加进 depends_on"。和 autoFix 的拓扑约束保持一致
- `validateWorkflow` 加 `step.output` 唯一性检查。两个 step 不能 output 到同一个变量名（重名会让下游引用拿到的值依赖 context Map 写入顺序，不可预期）
- `validateWorkflow` 的变量引用检查范围扩到 `step.condition` / `step.loop.exit_condition` / `step.prompt`。之前只看 `step.task`，让条件分支表达式里的未定义变量漏检

### Tests
- 新增 3 项 parser 测试覆盖：拓扑反向引用 / output 重名 / condition 字段里的未定义变量

## [0.6.11] - 2026-04-27

### Fixed
- `repairWithLLM` 失败时静默吞错。LLM 调用因网络/认证/超时失败时不再悄悄返回，会在 stderr 给出失败原因，避免用户看到 "LLM 修复后仍有 X 个变量未解决" 误以为 LLM 修了但不够，实际是根本没调通

### Tests
- 新增 1 项测试覆盖跨 step 同名 bad var 的已知边界行为（全局 replace 只处理一次，靠 LLM repair 兜底）

## [0.6.10] - 2026-04-27

### Fixed
- `ao compose --run` 生成的 YAML 中变量引用错误的修复链全面强化。原 `autoFixVariableRefs` 启发式有两个核心缺陷：
  - 模糊匹配在**全局 outputs** 范围内找替换目标，能把"早期 step 引用未来 step output"配上（DAG 拓扑反向），例如 `{{personal_assessment}}` 被错误地改成 `{{final_report}}`
  - 启发式覆盖不全时直接放弃，没有 LLM 兜底
- 现在的修复链：
  - autoFix 加 **DAG 上游约束**：替换目标必须在当前 step 的 `depends_on` 递归闭包内的 step.output 集合里。指向下游或跨支的错改不再可能
  - autoFix 修不全时自动调 **LLM 二次修复**：把当前 YAML、未解决的变量列表、可用 inputs/outputs 喂给 LLM，让它选择改 task 引用 / 加 step output / 补 depends_on
  - `--run` 模式在 compose 阶段就检查"未定义变量 / 角色不存在 / 解析失败"等致命错误，不再放进 run 阶段才崩溃；abort 时给出清晰的"重新生成 / 手动修改"建议

### Changed
- compose system prompt（中英）加两条规则：(1) 每个 `{{X}}` 引用的 X 必须在 inputs 或上游 step.output 中；(2) merge / 汇总类 step 的 `depends_on` 必须列出所有产生引用变量的上游 step

## [0.6.9] - 2026-04-24

### Fixed
- Windows 上 `ao run` / `ao compose` / `ao serve` 找不到包内置 / node_modules 下的 agents 目录，报 "agents 目录不存在"。根因：`new URL(import.meta.url).pathname` 在 Windows 上返回 `/C:/Users/...` 这种前导斜杠非法路径，`dirname` + `resolve` 后所有依赖 scriptDir 的候选路径全部失效。改用 `node:url` 的 `fileURLToPath` 跨平台 API 正确解析。Mac/Linux 行为不变

## [0.6.8] - 2026-04-24

### Changed
- 超时重试递增的上限从 900s 提到 3600s（60 分钟）。原上限对 CLI / ollama 长任务偏紧：CLI 默认 600s 起跳第一次递增就封顶，用户 `--timeout 20m` 起点已超上限完全不递增。抬到 60min 后覆盖绝大多数真实长任务；仍然保留上限作为"防误配置放飞"的保险丝。真要超过 1 小时单步用 `timeout: 0` / `--timeout 0` 完全不限时

## [0.6.7] - 2026-04-23

### Added
- `ao run` / `ao compose` 新增 `--timeout <value>` 参数。支持 `300000`（毫秒）、`300s`（秒）、`5m`（分钟）、`0`（不限时）。命令行优先级高于 YAML 里的 `llm.timeout`
- 因超时触发重试时，下一次 timeout 自动 x1.5 递增（上限 900s，本版本后续被提到 3600s）。递增同时作用于 connector 内层 fetch/CLI timeout，避免内层 hard timeout 提前 abort

### Changed
- `ao compose` 生成的 YAML 默认 `timeout` 从 120000 抬到 300000（API 类 provider）。ollama 和 CLI 类保持 600000
- `withTimeout` 错误消息加引导："超时 (Xms)，可用 --timeout 或 YAML llm.timeout 延长"

### Fixed
- `classifyError` 5xx / 429 状态码改用 `\b` 单词边界匹配。原 `msg.includes('500')` 等会把 "450000ms"、"1500ms"、"1429ms" 等字符串里的数字子串误判成 HTTP 错误，导致超时错误被错误归类为 server_error，递增逻辑失效
- `classifyError` 现在识别中文"超时"字样。之前 `withTimeout` 抛出的 `超时 (120000ms)` 被归为 non_retryable，retry 根本不触发
- `timeout: 0`（不限时）现在真正生效。原 `effectiveConfig.timeout || default` 把 0 当 falsy 用默认值覆盖了，改成 `!== undefined` 判断
