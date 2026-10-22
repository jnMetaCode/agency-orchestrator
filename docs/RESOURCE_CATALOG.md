# Studio 资源中心（只读发现）

新增入口 `/studio?tab=resources`，英文 `/en/studio?tab=resources`。当前功能在源码中，**尚未发布**。

本轮提供本机资源搜索、类型/宿主筛选、来源状态和详情；不提供安装、编辑、启停、收藏、自动推荐或执行。浏览和刷新不启动 MCP、不调用模型、不测试外部连接，也不新增使用埋点。

## 发现范围

- AO Skills：复用 `resolveSkillsDirs()` 的来源顺序和 `parseSkillFile()` 的既有解析规则。显式 `AO_SKILLS_DIR` 即使缺失也报告状态。展示引用名、元数据、扫描优先项与同名遮蔽项；默认隐藏遮蔽项，可勾选查看。
- Claude Code：只读取 `~/.claude.json` 的顶层 `mcpServers` 用户级声明；测试/独立实例可用 `AO_CLAUDE_MCP_FILE` 指定文件。
- Codex CLI：只读取 `~/.codex/config.toml` 的 `mcp_servers` 用户级声明；沿用 `AO_CODEX_DIR`。

不读取 Claude 的 `projects` 下配置、项目 `.mcp.json`、插件/组织配置、其它客户端配置或外部宿主 Skills。不枚举整个 home 或项目树，不读取系统钥匙串。AO 默认 Skills 目录解析有进程级缓存，新增搜索目录可能需要重启引擎；刷新可以读取已发现目录中的内容变化。

“已发现声明”不证明资源已加载、授权、连接或成功执行。Codex 的 `enabled` 仅显示文件声明，不能推出运行状态；Claude 未明确确认的启停状态标为未知。同名优先项只是本次受限扫描结果，不是对实际宿主生效的证明。

## 详情和敏感数据

Skill 详情按需读取当前 SKILL.md 正文，以纯文本呈现，不渲染 HTML、不执行脚本。复用 AO 的方法论解析，不代表完整 Agent Skills 包验证；附属脚本/依赖/许可/跨宿主行为尚未检查。常见 `sk-` / `Bearer` 前缀会遮盖，但任意私有内容的识别不可能靠该规则保证；本机查看不等于可公开分享。

MCP 列表和详情只返回脱敏主机及少量声明状态，不返回完整 URL、命令、参数、环境变量值、请求头、OAuth 内容或完整配置。不通过发现接口执行凭据辅助命令。资源源目录按搜索顺序编号，完整路径不经接口返回；用户可通过既有 `ao skills` CLI 查看 AO 目录。

扫描拒绝配置文件/SKILL.md 的符号链接，并跳过来源目录中的子目录链接；显式提供的搜索根可由现有解析器解析为链接位置。本轮是只读扫描，不改变现有写入器或 Skills 加载行为。

## API 与边界

- `GET /api/resources`：`checkedAt`、`sources`、`items`、`truncated`。来源状态区分 present/missing/invalid/unreadable/partial；条目区分 declared/unsupported/invalid/unreadable。
- `GET /api/resources/:id`：按列表中的不透明 ID 读取当前详情。ID 为进程级 HMAC，重启后重新获取；非法或不存在 ID 返回 404，不接收任意路径参数。
- 所有响应 `Cache-Control: no-store`，错误不返回解析原文、文件路径或异常内容。
- 配置文件最多 1 MiB，Skill 最多 256 KiB；最多 16 个 Skills 来源、每来源最多检查 600 个目录项、总计最多 300 个资源、Skill 正文读取预算 8 MiB。达到限制显示 partial/truncated；本地搜索仅覆盖已返回条目，不能声称搜索到全部本机资源。
- 非普通文件不读取，非阻塞打开防止 FIFO 挂起。MCP 声明不能识别时保留 unsupported 条目，不当作可运行。

刷新失败保留旧结果并注明当前未确认，停用详情按钮；关闭详情、换筛选或离开页面后忽略迟到响应。离线不请求资源接口、不展示虚构本机资源。资源页不请求完整供应商配置，隐藏任务模型选择器，避免误认为选择资源即切换模型。

## 验证

`npm run test:resources` 覆盖优先级、遮蔽、正文读取/脱敏、MCP 敏感字段、未知格式、错误/大小上限、链接、数量限制、HTTP/不透明 ID、失败脱敏和没有配置写入。已纳入完整 `npm test` 与 Windows CI。

浏览器验证使用临时 `AO_SKILLS_DIR`、`AO_CLAUDE_MCP_FILE`、`AO_CODEX_DIR`、`AO_CLAUDE_DIR`、`AO_DATA_DIR`：中英文、搜索/筛选、纯文本详情、迟到响应、外部修改、同名显示、历史导航、读取失败、移动布局、离线及仅 GET 请求。不得用本机真实凭据作测试夹具。

配置位置依据：[Claude MCP 作用范围](https://code.claude.com/docs/en/mcp)、[Codex MCP 配置](https://developers.openai.com/codex/mcp)。适配器仅解析上述有限结构，官方说明不替代具体客户端版本的实际兼容测试。
