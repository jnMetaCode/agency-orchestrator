# Changelog

本项目采用 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added
- **APIMart 视频模型 6 → 16**（Seedance 2.5、可灵 v3、海螺 2.3 / Fast、Wan 2.7、Vidu Q3 pro/turbo、PixVerse v6、Grok Imagine 1.5、sora-2-pro…），每个的分辨率 / 秒数 / 宽高比与**字段名**逐页核对 docs.apimart.ai：可灵档位叫 `mode`、Wan / PixVerse / Grok 宽高比叫 `size`、MiniMax 系首帧叫 `first_frame_image`，适配器按模型映射。出图/出片面板的模型改为下拉、档位随模型变，新增宽高比。
- 出片模板新增「类型」（剧情 / 广告 / 悬疑 / 搞笑 / 古风 / Vlog…，喂给编剧与提示词工程师）与「宽高比」输入；运行弹窗里故事输入框放大，旁有「✨ 帮我扩写」（Prompt Lab 优化接口，一次调用把几句话扩成具体描述）。
- `scripts/gen-style-samples.mjs`：给风格库 15 个预设批量出示例图（同一中性主体，只换风格后缀），压到 640 宽并把 `sample` 写回 `styles.ts`。**默认空跑**，`--provider` / `--model` 必须显式给（图片模型编码各家不通用，不猜），`--yes` 才花钱。官网文档新增「图生视频、三镜合成与风格库」小节。
- **风格库**：15 个预设（真人 13 / 3D / 2D），风格 = 中文名 + 英文提示词后缀（摄影机/镜头/胶片/色调/光源，与 5 段式方法论同口径）。工作流输入 `source: styles` 在 Studio 渲染成分组下拉；**引擎运行前把 id / 中文名展开成「名（EN）: 后缀」**，CLI 与 Studio 一致，自写描述原样透传。短剧流水线、一句话出短片、图文内容套装三条模板接入。示例图字段留空，待有 key 批量生成。
- **`type: concat`**：用本机 ffmpeg 把上游多段 mp4 按顺序合成一条（`concat: { inputs: ["{{shot1_mp4}}", …], size?, fps? }`）。各段先规整到同一尺寸/帧率/音轨（缺音轨补静音）再无损拼接，不花厂商的钱；ffmpeg 找不到时报各平台装法与 `AO_FFMPEG`，`ao doctor` 报出是否可用。「短剧流水线」新增「三镜合成」步，交付页成片放最前。
- **运行弹窗两栏布局**：有出图/出片设置的模板放宽为两栏——左=内容输入，右=「出图 / 出片」紧凑面板（中文标签+控件同行，说明进悬停）；正文可滚动、按钮固定底部（此前 8 个输入竖排一根长条，底部按钮看不见）。运行时自动把媒体选择记为默认，下次预填；出图出片模板不再显示「开发项目」勾选；下拉项不再带「从文件读入」。
- **工作流输入支持 `label`（Studio 显示名）**：三条媒体模板全部给了中文名，不再显示 `video_resolution` 这类变量名。「短剧流水线」的视觉风格给 10 个候选（美式复古好莱坞 / 霓虹赛博 / 日式青春胶片 / 国产都市写实 / 武侠江湖…），仍可自定义。
- **图生视频**：`video.image` 首帧参考图——公网 URL / 上游图片步骤的输出变量 / 本地文件。秘塔按 MiniMax 官方 H3 协议在 `content[]` 加 `{type:image_url, role:first_frame}`（只收公网 URL，本地图明确报错并给出路）；APIMart sora/veo 用 `image_urls[]`、MiniMax-H3 用 `first_frame_image`，本地图先走 `POST /v1/uploads/images` 自动换 URL（72 小时有效）。执行器登记本次运行图片步骤的产物，视频步骤在产物落盘前就能引用。
- **内置模板「短剧流水线（3 镜）」**：剧本 → 主角定妆图（文生图）→ 三镜提示词并行 → 三镜以定妆图为首帧并行出片 → 交付页。角色一致靠图生视频；模型可换、成本可见。
- 视频模型档位改为**按模型**（docs.apimart.ai 抓取）：sora-2 720p/4·8·12·16·20s、sora-2-pro 720p·1024p·1080p、veo3.1-fast/quality/lite 720p·1080p·4k/固定 8s、MiniMax-H3 2K·768P/4–15s；秘塔 MiniMax-H3 480p/512p/768P/2K/4–10s。Studio 换模型档位跟着换。
- **顶栏「出图 / 出片」胶囊**（创意出片 tab 显示）：图片/视频供应商、模型、档位在这里统一切换（与文本的供应商/模型胶囊并列，存 localStorage）；模板运行弹窗里媒体输入折叠成一行摘要只展示，「本次单独指定」才展开。创意出片视图平铺 + 🎨/🎬 产物角标。
- **出片 / 出图可换供应商、换模型（Studio 下拉）**：工作流输入新增 `options`（静态候选）与 `source`（动态源：`image_providers` / `video_providers` 列已配 key 的供应商，`models` 按所选供应商实拉或取内置表，`video_resolutions` / `video_durations` 取各家档位表），`source_from` 指向存供应商 id 的输入。「一句话出短片」四个输入全部下拉，换供应商时档位候选跟着换（秘塔 768P 与 APIMart 1080p 不通用，从根上消灭填错被拒）；「图文内容套装」新增 `image_provider`（留空跟随文本供应商）。候选仍可「自定义…」手填；视频模型只列已核实编码。`/api/config` 新带 `videoProviders`（含 hasKey + 档位表）。
- **图片步骤支持 `image.provider`**（与 `video.provider` 对称）：文本走 DeepSeek、图片走 LanoX 这类搭配终于可行；此前图片步骤只能跟整条工作流的文本供应商走，顶栏选了 Claude / CLI 类就报没有图片端点。
- **Studio 顶栏按「用户来干嘛」重组为四组**：开始做事（角色组队 / 工作流模板 两个子视图，一句话组队输入框在顶，提示词工坊入口在旁）· 我的运行 · **创意出片**（只列含 `type: image/video` 步骤的模板 + 创意库入口——此前引擎的出图出片能力藏在 27 个模板里，桌面用户看不到）· 设置（供应商 / 用量 子视图）。旧 `?tab=roles|workflows|providers|usage` 深链与代码里所有旧 id 调用点自动映射，创意库「用这条出片」深链不受影响。
- **按使用频率排序**：工作流列表新增「最近运行」区（近 30 天跑得最多的前 6）、角色页新增「最近用过」芯片行（点即加入组队）、运行历史可「按工作流分组」。数据来自本机 `ao-output` 的 metadata（`/api/runs` 新带 `file` / `roles`），不埋点不上传。首屏顺序原则：☆常用（显式）→ 最近用过（隐式）→ 编辑推荐 → 其余。
- **运行卡片缩略图**：有产物图片的运行在历史列表显示首图（`/api/runs` 新带 `thumb`）。
- **供应商下拉里已配 key 的排组内最前**；「用量」tab 文案不再承诺多数供应商给不了的"成本"。
- **Studio 模型「钉到常用」**：顶栏快切与配置页模型芯片都有 ★，按供应商各存各的（`localStorage` `ao-fav-models`，与角色/工作流的 ☆常用同一套）。快切列表顺序 = 当前 → 常用 → 推荐集；全量目录里常用单独成组置顶。推荐集是我们替用户挑的，常用是用户替自己挑的，两者并存。对所有 API 供应商与自定义供应商通用，只有 CLI 类（用各自工具登录态选模型）不显示。

### Fixed
- 创意库「用这条出片」深链直达「创意出片」tab（此前落在工作流模板页）；运行历史卡片有 mp4 产物但无首图时标 🎬。
- Studio 运行弹窗打开即白屏（`Cannot access 'P' before initialization`）：模型列表依赖块在 `vals` 声明前执行触发 TDZ，已挪到声明之后。
- 出图 / 出片设置只有一份：运行弹窗右栏改为内嵌右上角同一个「出图 / 出片」面板（此前两处可改、不知以哪个为准）；必选项没选时运行按钮禁用并点名。图片供应商列表治理：已配 key 在前、已下架的只对配过 key 的露出、显示中文名（此前把 DeepSeek / Kimi / 已下架多元探索 / rootflowai 全列出且显示裸 id）。
- 顶栏供应商下拉新增「出图 / 出片供应商」一组：秘塔这类没有对话端点的供应商不能当文本供应商选，但作为赞助商必须看得见——带赞助商标、已配 key 打勾、点击去配置页。
- **`--resume --from <视频步>` 时上游图片/视频产物找不到、且新目录里 markdown 断链**：上一轮 `assets/` 预载进产物登记表，复用步骤的产物文件名随档案带回，落盘后复制进新目录；每次运行先清登记表，同进程连跑不串产物。validate 现在也扫 `image.*` / `video.*` / `concat.inputs` 里的变量名。
- 供应商下拉按层级排序（旗舰 → 进阶 → 赞助商 → 普通 → 已下架，层内已配 key 的在前）；已下架的（内置 delisted / 清单 removedProviders）只对配过 key 或正选中的用户露出并标「已下架」。此前顶栏下拉不处理下架，且"有 key 排前"把多元探索、Agnes 顶到了赞助商前面。
- 模型下拉没配 key 时不再露「拉取全部模型」（拉了必 401），改为一句提示；拉取报错只留短句不吐厂商 JSON。
- **步骤指定另一家供应商时，文本供应商的 base_url / api_key 不再被带过去**（image、video 同一条规则）。此前 `--base-url` 给文本模型配的地址会被视频步骤拿去打视频供应商；video 那条老测试恰恰依赖这个漏，已改为给视频供应商自己的 env key。
- Studio 顶栏窄屏不再挤：tab 窄屏只留图标（文字进 title）、引擎状态只留圆点、供应商/模型胶囊收窄。「常用」用词全站统一为「设为常用 / 取消常用」（此前角色「收藏为常用」、工作流「置顶到最前」、模型「钉到常用」三套说法）。
- **顶栏模型下拉不再只剩「当前这一个」**（赞助商反馈：胜算云下拉只有一个模型、换不了别家）。根因：顶栏只展示「推荐集 + 当前模型」，前端不认识的供应商（自定义 / 旧版 dist 尚未收录的赞助商）推荐集为空，就只剩已保存的那一个。现在：推荐集为空 → 自动实拉该供应商 `GET /models`；有推荐集时底部常驻「拉取全部模型（按厂商分组）」。没配推荐集的 Gemini / xAI / Moonshot / 智谱 / 通义 / APIMart 由此全部可选（它们故意不写推荐集：模型 id 没实拉核实过就不猜）。
- **远程清单 `providerOverrides` 给胜算云下发 5 条推荐集**——v0.9.0 起的所有引擎读到清单即生效，旧版用户不升级也能看到多条。
- `workflows/codex-cc-loop.yaml` / `codex-cc-simple.yaml` 补上 `agents_dir`：此前是全部模板里仅有的两个漏写者，默认落到 `./agents`，`validate` 只警告「未校验 role」而 `run` 直接报找不到角色库。

## [0.18.0] - 2026-08-21

> 对照 WorkBuddy / 千问办公做了一轮功能级差距盘点（两家官网当日实抓），清单上仅有的两项「值得追」当天全部补齐——就是本版的两个主角。

### Added
- **PPTX 导出**：`ao run <wf> --export pptx` / Studio 导出菜单「PPT 演示 (.pptx)」。沿用导出管线既定设计：**pandoc 优先**（`-t pptx` 原生支持、排版最佳）、**pptxgenjs 纯 JS 兜底**（多数用户的真实路径，已强制隐藏 pandoc 实测）。转换逻辑：封面页（工作流名+产品署名）→ 按 `#`/`##` 切页 → 列表/段落进 bullets → **markdown 表格保结构渲染** → 代码块留占位 → 单页超 9 条自动分「续」页。两家大厂都拿"自动做 PPT"当主卖点——现在这句对 AO 也成立，且是"多专家评审过的内容一键成片"。
- **图片输入（vision）**：`-i photo=@图.png`（png/jpg/gif/webp，上限 4MB）自动转为视觉输入，工作流步骤在 task 里照常写 `{{photo}}`。架构上零波及：图片以 data URI 字符串走既有变量系统——`LLMConnector` 接口一字未改（15 个连接器无涉），**图片跨步骤传递免费获得**。发送前按连接器分工：openai 兼容拆 OpenAI vision content 数组、claude 拆 Anthropic 原生 image 块；**CLI 订阅类 / ollama 剥离图片并警告指路**（几 MB base64 原样进提示词是 token 炸弹，绝不静默透传）。metadata 纪律不破：inputs 里的 base64 存档前剥掉（resume 需重新 `-i` 提供）。真机验证：GPT-4o 正确识别产品截图并给出针对性 UI 建议。

### Fixed
- vision 的 token 估算兜底先剥图片——流式响应不带 usage 时走字符估算，data URI 整串被当文本估进去（真机 662KB 截图虚报 226,115 tokens）；现每张图按 vision 常见口径记 ~800，复测 5,880 合理。

## [0.17.0] - 2026-08-21

### Added
- **内置模板「图文内容套装」**：小红书运营写种草笔记 → 图像提示词工程师把卖点转成画面描述 → `type: image` 出封面 → 整理成可直接发布的格式——一次运行交付「文案 + 封面图」成套内容。引擎的文生图能力此前没有任何内置模板展示。已同时收录进远程清单的「社区模板」（老版本不升级也能导入用——该机制的首次实弹）。
- **`image.model` 支持 `{{变量}}` 渲染**（与 task 同款）：内置模板由此能把「选哪个图片模型」通过必填输入明示交给用户——各家图片模型编码互不通用，绝不猜默认值的纪律不破。e2e 断言钉死（服务端捕获渲染后的 model）。
- **Studio「新版可用」角标**：桌面端没有自动更新（macOS 无签名装不了 electron-updater），装机用户会永远停在装机那天的版本。`/api/health` 现带 `latest`（npm registry，6h 缓存 + 3s 超时 + 失败静默——离线/内网环境看不到任何报错），有新版时状态栏出现「↑ 新版」角标，点击开下载页。semver 解析不了一律当无更新，绝不误报。
- **README「从方案到执行」组合拳小节**：对大厂「替你操作电脑」的正面回答——AO 负责想清楚（多专家评审的方案 + `--materialize` 落盘脚手架），编程 Agent 负责干出来（`ao install` 把角色装进 Claude Code/Cursor 后接着执行）。
- **CONTRIBUTING 社区模板投稿指南**：https 固定链接 + sha256 + Issue 投稿流程与收录标准——收录制的入口终于有门了。

### Fixed
- **Studio「分享页」改为下载单文件 + 预览**：此前点击只打开 `127.0.0.1` 本地地址——发到微信对方根本打不开。可分享的载体是那个自包含 HTML 文件本身：现在直接下载（`工作流名-分享报告.html`，双击即开），同时保留新标签预览。顺手修掉 `safeFilename` 默认 `.md` 导致的 `.md.html` 双后缀。

## [0.16.1] - 2026-08-20

> 0.16.0 发布当天做了两轮独立代码复审（一轮自审 + 一轮多视角机器审查），本版集中修复复审发现。

### Fixed
- **`--notify` 不再可能挂死 `ao run`**：坏 webhook「返回 200 响应头但 body 永不结束」会卡住原实现（超时只罩到响应头）——现用 `AbortSignal.timeout` 覆盖整个请求生命周期；拒绝路径上的悬空计时器一并消除。这条直接关系 cron 场景的「推送永不搞坏运行」契约。
- **`--notify` 补上两个静默缺口**：`--compare` 分支此前先 exit、通知被吞；run 硬失败（key 过期/解析错误）此前反而不通知（部分失败却会通知，不一致）。现三个出口（正常 / compare / 抛错）统一推送，失败通知带原因。
- **`ao report last` 尊重 `AO_OUTPUT_DIR` / `AO_HOME`**（此前硬编码 `ao-output`，设了 AO_HOME 的用户永远"找不到运行输出"）；支持 `--output` 覆盖。
- **社区模板导入加固**：下载超时覆盖到响应体 + `Content-Length` 预检 + 字节口径 200KB 上限（原按 UTF-16 code unit 计数）；`redirect: 'error'` 拒绝收录后 302 改道；清单条目支持可选 `sha256` 内容校验（收录制钉的是 URL 不是内容，建议配合 commit-SHA 链接使用）；文件名修剪与写盘目录守卫对齐既有保存链路。
- **Studio 社区模板导入确认改用应用内对话框**（替换 `window.confirm`，桌面端不再出现 "127.0.0.1 显示" 抬头）。
- CI：桌面瘦身步骤补 `shell: bash`（windows-latest 默认 PowerShell，`rm -rf` 必炸）；Apple 签名证书环境变量只喂给 macOS job（electron-builder 的 Windows 签名会兜底读 `CSC_LINK`，证书一填 Windows job 会拿 .p12 去 signtool）；Docker 自动构建先轮询等版本出现在 npm（同 tag 触发的构建与发布存在竞态）。
- 清理泄进公开仓库的维护者本地绝对路径（metrics 输出与 HANDOFF）。

## [0.16.0] - 2026-08-20

### Added
- **社区工作流模板源（清单收录制 + Studio 一键导入）**：远程清单新增 `communityTemplates`，收录/下架 push 官网即对所有已安装用户生效、不发版。`GET /api/community/templates` 列出，`POST /api/community/import` 导入——**只认清单里收录的 https URL**（收录制天然防 SSRF 与任意 YAML 注入），拉取限 5s/200KB，保存前过引擎 `validateWorkflow`，同名自动加序号不覆盖，落到「我的工作流」。Studio 工作流页新增「社区模板」分区（虚线卡片，空清单整节隐藏）。教训一并记下：清单里与内置同名的 relayPresets **对旧版用户不是冗余**（旧版内置表里没有这几家，正是靠清单不发版用上），清单契约测试守着这条——别再清。
- **`ao run --notify <url>`（或 `AO_NOTIFY_URL`）——跑完把结果推到群里**：按 webhook 域名自动适配钉钉 / 飞书 / 企业微信自定义机器人的消息格式，其他地址发通用 `{text}`（Slack 也认）。配合 cron 就是"AI 团队每天定点交活"：`0 8 * * * ao run 每日简报.yaml --notify <机器人地址>`。纪律：推送永远不搞坏运行——发送失败只打一行提示，不抛错不改退出码；钉钉/企微对格式错误也回 HTTP 200、真实错误码在响应体里，已按此读体判错（提示会点破"检查关键词/签名安全设置"）。文案固定含 "AO"，钉钉"自定义关键词"安全设置写 AO 即可。
- **`modelCapabilityHint` 扩展 antigravity-cli 额度提示**（免费档约 20 次/天）：质量不弱、受限的是额度——不提前说清，用户会在第 N 步撞额度并以为是 AO 的问题。Studio CLI 卡片、中英 README 同口径。没有评测证据的 CLI（copilot/hermes/openclaw/codex）一律不猜不提示，测试钉死。
- **官网 `/evals/` 公开评测基准页**：EVAL_FINDINGS.md 全文上网（构建期渲染成静态页，含一键复现命令），全站静态页导航加「评测」入口。

### Fixed
- **隐私：本地 Studio 不再加载任何统计脚本**。GTM/GA4 此前在 `website/index.html` 里无条件加载——同一份 `website/dist` 被 `ao web` / 桌面端在 localhost 起时，会把埋点事件（**含用户工作流文件名**）发给 Google Analytics，直接违背「数据在本机」的产品承诺。现按域名门控：统计只在公网官网加载，本地界面零统计脚本（`track.ts` 在 gtag 缺失时本就静默跳过，功能不受影响）。这条对桌面端同样生效——桌面包打的是同一份 dist，请随桌面版更新。

### Changed
- 远程清单给 deepseek 下发 V4 模型建议（`deepseek-v4-flash` / `deepseek-v4-pro`）。官方已把 `deepseek-chat` 别名映射到 `deepseek-v4-flash`（两名实测皆通），默认值不必动，Studio「获取模型列表」与建议下拉保持最新。

## [0.15.0] - 2026-08-19

### Added（本次新增）
- **`ao report [dir|last]`——把一次运行渲染成可分享的单文件 HTML 报告**：专家分工时间线 + 每步产出 + 末步 ⭐ 最终成品标记，页脚带产品署名与安装命令。自包含零外链（相对图片内联为 data URI）、亮暗色自适应、可打印，双击即开无需装 AO——用户满意的成果直接发到群里就是一张带回流入口的海报。默认取最近一次运行；渲染器是纯函数（`src/cli/share-report.ts`），15 条单测覆盖转义/表格/图片内联/署名。
- **Studio 运行详情新增「分享页」按钮**（`GET /api/runs/:id/report`）：与 CLI 同一渲染器（`renderRunDirReport`），新标签打开即成品页、可直接保存转发；同时落一份 `report.html` 到运行目录与 CLI 行为一致。端点走与 assets 相同的目录守卫（resolve + 包含关系 + 必须带 metadata.json）。
- **gemini-cli 软下线机制**（收尾 #86）：Google 已于 2026-06-18 停服（仅企业版 Code Assist 许可可用），但此前停服信息只活在代码注释里——新用户在 Studio 里看到它与 claude-code 平级，README 还写着「免费 1000 次/天」。新增 `DEPRECATED_CLI_PROVIDERS` 注册表与 `detectUsableCliProviders()`：**零配置自动选择（autoProvider / 首跑引导 / Studio recommended）永不选中已停服 CLI**；存量用户显式指定仍可用但 factory 给一行警告；`ao doctor` 对已装的停服 CLI 单独标注原因；Studio 卡片带琥珀色停服说明（中英双语）。CLI provider 一族此前没有任何「下线」机制（`delisted` 只覆盖 API 供应商）——把新用户自动导向一条死路径，比让他去配 key 更糟。
- **`ao doctor` 新增 Ollama 端点真探测**：compose/run 对 ollama 一律放行不探测，doctor 是唯一说真话的地方——不探的话「配了 ollama 却没启动服务」要到工作流第一步失败才暴露。1.5s 超时，不可达时给出 `ollama serve` 指引。
- **官网程序化 SEO（不随 npm 包，Vercel 自动部署）**：构建后为 267 个专家角色与 25 个工作流模板各生成一张纯静态详情页（零 JS、内联 CSS——百度爬虫不执行 JS，SPA 内容对国内搜索不存在），sitemap 扩展到 301 条 URL。Vercel rewrites 文件系统优先：静态详情页直接命中，SPA 的 `/experts` 列表页照常回落，互不干扰。

### Fixed
- **`removedProviders` 不再无条件隐藏已配 key 的老用户**：远程清单的下架列表此前排在 `delisted` 例外之前直接过滤——把「配过 key 的照常显示」这条既定原则（配置还在、还能跑，入口没了用户只会以为 key 丢了）整个绕过，配过 rootflowai/ccsub 的用户已经被搞坏。现在两条下架来源（内置 `delisted` / 远程 `removedProviders`）走同一个例外。
- **`ao demo` 的 CLI 探测在 Windows 上全判「未安装」**：它用的是独立的 `execSync('which …')`（POSIX-only），与 `detect.ts` 各说各话。统一走 `isOnPath()`（跨平台、不起 shell）。
- **报告页图片内联的路径解析**：步骤 md 里图片引用是相对 `steps/` 目录写的（image 步骤产物为 `../assets/xx.png`），按运行目录直接拼接会指到错误位置。现按 `steps/` 优先、运行目录兜底两级解析。

### Docs
- **免 key 口径三套合一，统一为「7 种」**：中文 README 说 8、其小节标题说 7、英文 README 说 7 且表格漏了 Antigravity、官网 docs 列的 8 项是另一组（含无任何代码实现的 LM Studio）。现全部对齐代码注册表：6 个活跃订阅制 CLI + Ollama = 7 种；gemini-cli 明标停服；LM Studio 改为注明「可作为 OpenAI 兼容端点接入」。

## [0.14.0] - 2026-08-17

### Added（本次新增）
- **创意库（`/creative`，229 条图片提示词）能一键出图**：卡片上的提示词此前只能复制走、再去别处贴——现在选个供应商、填上图片模型就直接出图，图片内联显示并可下载 PNG。后端是一层薄接口 `POST /api/image/generate`，**复用引擎同一个 `generateImage()`**：两种协议自动切换、报错口径与 `type: image` 步骤完全一致（一处修复两边都好）。三条约束值得记住：① **下拉里只列真能出图的供应商**——`/api/config` 新增 `imageProviders`，由后端按引擎 `resolveImageAccess` 的口径算好（前端别自己按 `family: "api"` 筛，那一族里混着 `claude-code` / `gemini-cli` / `codex-cli`），并且只留**已配 key** 的（没 key 生成必失败，不如直接引导去配）；② **公开演示站没有引擎后端**，`/api/*` 会落到 SPA 兜底回 HTML，所以面板降级成"怎么在本机跑"的说明，而不是给一个点了必失败的按钮；③ 供应商 / 图片模型 / 尺寸**记在 localStorage 并跨卡片共享**——229 张卡片每开一张都重填一遍模型编码不合理，而模型编码恰恰是最难记的那一项。探测**只在第一次展开生成面板时**才发（这是一张公开 SEO 页，绝大多数访客只是来复制提示词的）。
- **文生图步骤 `type: image`**（工作流第一次能产出图片）：**`task` 就是图片提示词**——`{{变量}}` 照常渲染，上游文字步骤的产出直接流进来，不需要 role，不另设提示词字段。`image.model` **必填**（各家图片模型编码互不通用，与文本侧"不猜默认模型"同一条纪律，解析期就拦住、不烧一次调用才报错）。引擎先打 OpenAI 经典 Images API（`/images/generations`，`b64_json` 与 `url` 两种返回形态都认），端点不存在（404/405/LanoX 那种 200 壳）时自动降级到 **Responses + `image_generation` 工具**（LanoX 文档明说 chat 端点不支持图片工具、必须走这条）。PNG 落在 `ao-output/<run>/assets/`，输出变量是 markdown 图片引用；步骤 md、summary、metadata 全接上（**base64 绝不进 metadata**，只留 filename——一张 2MB 的图会把它撑成巨型 JSON）。Studio 侧新增只读产物接口 `GET /api/runs/:id/assets/:file`（路径先 resolve 再校验包含关系 + 必须落在带 metadata.json 的真实运行目录，与删除接口同一套守卫），运行详情把相对引用改写到该接口，Markdown 渲染器内联显示（限宽限高防撑破面板）。工作流主体用 CLI provider 跑也没关系——给图片步骤单独配 `llm: { provider: <API provider> }` 即可，CLI 不是图片端点这件事在报错里说清并给出路。SIGTERM 中断兜底也带图片（settle 即写入 sink）。
- **Studio 画布能零代码配机械检查**:`assert` 加进画布后,桌面端用户不写 YAML 也能设
  「必须产出几个文件 / 最少多少字节 / 必须包含什么」。此前它只对写 YAML 的 CLI 用户可用——
  而按产品自己的定位(桌面端双击即用、CLI 只在要进终端或 CI 时才装),那等于把新能力发给了少数派。
  界面**故意不暴露 `matches`(正则→次数)**:零代码用户不该在这里碰正则;它随 YAML 原样带进带出,
  界面上的修改是**合并**不是替换,所以手写的 `matches` 不会被静默洗掉(已加往返测试钉死这条)。
- **接入 Antigravity CLI**（#86，provider `antigravity-cli`）：Google 已于 2026-06-18 停掉 Gemini CLI、转向 Antigravity CLI，我们的 `gemini-cli` 对新用户其实已经是死入口。新 provider 走"订阅制、免 key"那一类（登录态存在系统钥匙串，没有 API key 环境变量），二进制是 `agy`。参数按官方 headless 文档拼：`-p` 非交互 + 显式 `--output-format text`（json 的字段形状官方没写全，猜结构等于埋"跑完了什么都没解析出来"）+ `--model` + `--effort`（只认 low/medium/high）+ **`--print-timeout` 与 AO 的单步超时对齐**（agy 自己默认 5 分钟、AO 默认等 10 分钟，不对齐的话长步骤会被它先掐断，AO 这边只看到"没输出"）。**不传 `--dangerously-skip-permissions`**：那是自动批准所有工具调用，而 AO 常常就在用户的项目目录里跑。对着 cc-switch 比对过：**它并没有接 Antigravity CLI**（只在 opencode 的 `@ai-sdk/anthropic` 预设里列了两个 Antigravity 品牌的 Claude 模型 slug），所以这条没有现成做法可抄，全部按官方文档实现。查官方 settings 文档另确认两件事并写进代码注释与报错：**它不支持第三方中转**（settings 里没有任何 base_url / API key 项，鉴权只走系统钥匙串），所以**不给它加 CLI 中转商预设**；**工具调用默认要人工审批**（`toolPermission`），而 `-p` 是非交互的——真需要动工具时会一直等到超时、AO 这边只看到"空输出"，所以这个 provider 的空输出报错会专门点破这条，并给出 `params: { skipPermissions: true }` 这个显式开关（外加 `params: { sandbox: true }`）。安装探测认得官方安装路径 `~/.local/bin` 与 Windows 的 `%LOCALAPPDATA%\agy\bin`——`install.sh` 装那儿，**默认不在 PATH 上**，只查 PATH 会得出"没装"的错误结论。本机没有 `agy`（且需 Google 账号交互登录一次），所以真机跑通要由有账号的人做；这里用一个假的 `agy` 把整条链路真跑了一遍，验证参数一字不差地到达子进程。
- **步骤级机械断言 `assert`:不过模型、不过网络的结构校验**。`acceptance` 是让模型判产出满不满足标准,
  它擅长判内容,却系统性抓不到**「本该有几个」**——真实事故:让模型产出 6 个文件它给了 5 个,剩下 5 个格式完好,
  模型验收员照样说"满足标准",编译也过,整个文件就这么带着绿灯没了(同一故障在两个项目上各撞一次,两次都亮绿灯)。
  根因不神秘:验收员看不见"应该有 6 个"这个事实,它只看得见眼前这 5 个。
  所以分工是**模型审内容、脚本审结构**,新增的这半边是纯函数:同样输入永远同样结论,不花 token,
  不会因为网络抖动"核验不可用"。四种断言:`emits_files`(文件块数量,解析规则与 `--materialize` 完全一致,
  保证"断言数的"和"落盘落的"是同一个计数)、`min_bytes`(防截断)、`contains`、`matches`(正则→命中次数)。
  **未过的语义比 `acceptance` 更硬**:定向返工一轮,仍不过则该步失败——缺件的产物不该带着 ⚠️ 流向下游,
  静默损坏比失败贵得多(失败当场就知道,缺件要等上线后才发现)。执行顺序排在 `acceptance` 之前:
  结构都不合格,没必要再花 token 让模型评内容。配置在解析期校验(未知字段、非法正则、空断言全部当场报错——
  一个写错的正则会变成永远命中不了、或永远命中的哑弹检查,比没有检查更糟)。
- **AICodeMirror 上架（赞助商）**：三个编码 CLI 的中转预设（`claude-code` → `/api/claudecode`、`gemini-cli` → `/api/gemini`、`codex-cli` → `/api/codex/backend-api/codex`，注意 API 主机是 `aicodemirror.com` 而非官网的 `.ai`），以及**直连 API**——它走 Anthropic Messages 协议而非 OpenAI 兼容（根 `/v1/chat/completions` 实测 404），所以配在 `provider: claude` 上，Studio 的「Claude (Anthropic)」页新增「Anthropic 协议中转商」一键填充。端点做过无 key 探测核实（三个前缀均 401=存在，同级不存在的前缀 404）。
- **`provider: claude` 支持自定义接入点**：任意 Anthropic 协议中转商都能直连。此前 `factory` 建连接器时只传 `api_key`、连接器也从没给 SDK 设过 `baseURL`、后端 `KEY_ENV` 写死 `base: null` 让前端隐藏地址框——三处叠加导致在 YAML/Studio 里配的中转地址被**静默忽略**，请求照旧打官方端点（拿中转 key 去打必然 401，且看不出是配置没生效）。新增 `normalizeAnthropicBaseUrl`：SDK 自己会接 `/v1/messages`，所以 base 里多写的 `/v1`、`/messages` 会被削掉，中转商的子路径基址（如 `/api/claudecode`）保持不动。
- **`ao doctor` 覆盖 Anthropic 协议端点**：claude 配了中转却没有体检等于给了能力不给诊断，而"地址配错"正是中转用户最常踩的坑。现按原生协议单独探测，认出中转还是官方端点，并对"只填域名""多写 /v1"分别给出能照做的指引。
- **LanoX AI 上架（赞助商）**：全球模型聚合（GPT / Claude / Gemini / Qwen / Grok 等 500+ 款）。**直连 API** 走 OpenAI 兼容 `https://api.lanox.ai/v1`（引擎 `API_PROVIDERS` 新增 `lanox`，专属 env `LANOX_API_KEY` / `LANOX_BASE_URL`）；**编码 CLI 中转**预设 `claude-code` → `https://api.lanox.ai`（同一端点也兼容 Anthropic Messages，base 不带 `/v1`）、`codex-cli` → `https://api.lanox.ai/v1`。端点做过无 key 探测核实（`/v1/chat/completions`、`/v1/models`、`/v1/messages` 缺 key 均返回 `invalid_api_key`=存在；**它对不存在的路径也回 HTTP 200**，只能看响应体里的 `"code":"404"` 判断，别按状态码下结论）；没探到任何 Google 格式端点，故不给 `gemini-cli` 预设。位置按约定排**赞助商组最后一位**（Studio 供应商列表 / 官网赞助商页均是）。**不设默认模型**：无 key 拿不到它实际上架并已定价的模型名，猜一个就是多元探索踩过的坑，留空强制用户自选（配了 key 点「获取模型列表」拉全量——已按它文档的响应结构实测过能正确列出）。按官方文档核对无误：三个端点 `GET /v1/models`、`POST /v1/chat/completions`、`POST /v1/responses`（Codex 的 `wire_api=responses` 正好落在后者），OpenAI / Qwen / Gemini 共用 OpenAI 兼容端点、**Claude 走 Anthropic Messages 原生端点**（实测该端点 `x-api-key` 与 `Bearer` 两种头都认，所以 AO 直连与 claude CLI 中转两条路都通）。
- **胜算云上架（赞助商）**：面向 AI 原生团队的模型 API 聚合，合规直供（不做逆向）+ 企业级定制网关（团队成本与权限、智能路由、BYOK 托管、开票）。**直连 API** 走 OpenAI 兼容 `https://router.shengsuanyun.com/api/v1`（引擎 `API_PROVIDERS` 新增 `shengsuanyun`，专属 env `SHENGSUANYUN_API_KEY` / `SHENGSUANYUN_BASE_URL`）；**编码 CLI 中转**三个预设齐全：`claude-code` / `gemini-cli` → `https://router.shengsuanyun.com/api`（base 不带 `/v1`，CLI 自己接 `/v1/messages` 与 `/v1beta/models/*`）、`codex-cli` → `.../api/v1`。**注意主域 `api.shengsuanyun.com` 整站 404**，端点在 `router` 子域的 `/api` 前缀下，照主域猜必错。这家不用靠猜：`GET /api/v1/models` **无需 key** 就能拉，每个模型自带 `pricing` 与 `support_apis`（实拉可见 `/v1/chat/completions`、`/v1/messages`、`/v1/responses`、`/v1beta/models/*` 四种协议同网关），所以默认模型直接给了核实过的 `anthropic/claude-sonnet-5`（在列、已定价）——**模型名带厂商前缀**，少写前缀会 404。位置按约定排**赞助商组最后一位**（Studio 供应商列表 / 官网赞助商页均是），LanoX 顺位后移。
- **补齐五家第一方厂商官方 API**（非赞助商，排在赞助商组之后）：**Gemini**（Google 官方 OpenAI 兼容层 `/v1beta/openai`）、**xAI Grok**、**Moonshot Kimi**、**智谱 GLM**（端点自带版本段 `/paas/v4`，不是 `/v1`）、**通义千问**（DashScope **兼容模式**端点）。五个端点都无 key 实测过存在（401/400 = 鉴权失败而非 404）。其中 Gemini 最该补——`gemini-cli` 已于 2026-06-18 停服，而云端列表里一直没有任何 Gemini 直连入口。**一律不设默认模型**：各家原生编码互不通用，拿不到清单就不猜，配了 key 点「获取模型列表」拉真实全量（五家都有 OpenAI 兼容 `GET /models`）。
- **Gemini 直连的 env 名特意与 `gemini-cli` 分开**（`GOOGLE_GENAI_*` 而非 `GEMINI_API_KEY`）：后者被本地 CLI 中转占着，共用会把用户本机的 CLI 一起改道——与 `ANTHROPIC_BASE_URL` 那次同源。新增断言把「云端 provider 的 env 名不得与本地 CLI 中转撞」钉死，此前只防了 `ANTHROPIC_*` 一族。
- **赞助商上/下架彻底不用发版**：远程清单（`website/public/providers-manifest.json`，改官网仓 push 即对所有已安装用户生效）新增 `sponsorRotation`（引导横幅轮换池，配了就整池替换），并启用 `removedProviders` 与 `relayPresets`。轮换算法抽成 `rotateFrom(pool)` 由内置与清单共用，份额口径不会因来源不同而漂移。


### Changed
- **多元探索赞助下架（2026-08-17）**：摘掉进阶档的**置顶位与紫色高亮**、推广链接（含返利参数 `aff=LErO`）、"注册送 3 元 / 充 100 返 10%"的权益文案，以及官网赞助商页的整张卡片；**保留为可用供应商**并退到末位的已下架组——它此前是**默认 provider**，配过它 key 的用户基数很可能是所有供应商里最大的，把入口直接抽走等于让这批人以为"我的 key 丢了"，所以已配 key 的照常看得到、改得动、跑得通。**默认 provider 位**（一项赞助权益）暂交给旗舰赞助商 APINEBULA；该 id 此前在 `web/server.js` 里写死了 **5 处**，本次收成常量 `DEFAULT_PROVIDER_ID`——五处分散的写法迟早漂移成"界面默认选 A、后端兜底跑 B"。**进阶档现无人持有**（`PREMIUM_SPONSOR = null`）：没买家时就该空着，拿轮换池里的某家来充数等于白送双份曝光，对其余 7 家不公平；轮换池维持 7 家均分不变。新增 3 条守卫：默认位必须前后端同一个 id、必须是**在架**（非 delisted）且在官网赞助商名单里的一家；下架的多元探索不得出现在任何曝光位、但必须仍在注册表里。
- **RootFlowAI 与 CCSub 赞助下架**：从引导轮换池、官网赞助商列表、Studio 赞助标识/推广链接/置顶位一并摘除，曝光位由 AICodeMirror 顶上；随后 LanoX AI 与胜算云先后加入，轮换池现为 **7 家均分（每家 2/7 天）**，且这一池已同步写进远程清单（清单配了就整池替换内置的，所以两份必须逐条一致——有测试钉住）。两家**仍保留为可用供应商**并排在末位——已配好 key 的用户不该因商务关系变化就连不上。
- **Studio 的 Claude 默认端点改为不带 `/v1`**：原默认值 `https://api.anthropic.com/v1` 与 doctor 的"多写 /v1 要去掉"自相矛盾，而它正是用户配中转时照抄的形状样板。

### Fixed
- **「引擎待重启」在 git 改写文件时误报**（本轮 ff 合并 main 之后当场撞到）：版本漂移守卫此前只比 **mtime**——而 `git checkout` / `merge` / `rebase` / `stash` 都会重写工作区文件并刷新 mtime，**内容可能一字未变**。于是切个分支就开始喊重启。它要防的恰恰是"前端认识新供应商、引擎报 unknown provider"这类最难自证的故障，而一个喊过几次狼的警报，真出事时也没人信了。改为 **mtime 只当便宜的门、内容哈希才是判据**：时间没变直接过（稳态轮询一次哈希都不算），时间变了才读文件比 sha1。四条断言钉住：刚启动不报警、只碰 mtime 不报警、构建产物内容变了必须报警、改回去恢复正常。
- **一个角色都不用的工作流，被"找不到角色库"挡在门外**（真机验证第一条纯出图工作流就死在这儿）：`type: image` 步骤不需要 role，但 `run()` 无条件解析 `agents_dir`，于是"只出一张图"——这个新能力最自然的第一条工作流——先要用户去 `ao init` 准备一个一个角色都用不到的角色库。现在只有存在带 `role` 的步骤才强制解析（角色缺失仍当场报，不留到执行时）。**测试里撞不到**：仓库和安装包里 `agency-agents-zh` 永远解析得到，所以补的断言特意把 `agents_dir` 指向一个不存在的名字。
- **图片协议降级时，把唯一能解释原因的那句话吞掉了**：真机上最常见的失败形态不是"两条路都 404"，而是 **A 明确报错、B 回 HTTP 200 却没有图片**——网关把请求当普通文本跑了（实测胜算云：A 说 `model "X" does not support request path "/v1/images/generations"`，B 照常跑文本模型并计费）。此前这一支只甩 200 字原始 JSON，A 那句诊断根本没进报错。现在两条路径的状态与原文一并列出、点名当前 `image.model`，并提醒 ② 会真实计费。
- **`size` 配了却没生效、且没人吭声**（真机实测 LanoX 的 `gpt-image-2`：请求 `1024x1024`，它回执里自己写着 `size: "1254x1254"`，图也确实是 1254 见方；换个"海报"提示词又给竖图）。这类"配了等于空操作"与省钱模式那次同源。现在引擎从 PNG 头量出**真实尺寸**（只读 24 字节，不解码整图），与请求的 size 不一致就明确提示"该服务商把 size 当建议而非硬约束"；`GeneratedImage` 带上 `width/height`，Studio 出图接口一并回传，创意库在图下方照实显示实际尺寸并标注差异。没写 `size` 时不报警（各家默认档不同，那不叫"没生效"）。
- **拿 Anthropic 协议的供应商出图，报的是一句 404 正文而不是"这家没有图片端点"**：`claude` 与 AICodeMirror 这类中转**有** `base_url`，所以躲过了"没有可用端点"那条分支，请求会照打 `https://api.anthropic.com/images/generations`，两条协议各撞一次 404，用户只看到网关的原始报文。Anthropic 官方压根不提供文生图 API——这属于"能力不存在"，必须当场说清并给出路（给该步单独配一个 OpenAI 兼容 provider）。同一条口径同时用在 Studio 的文生图接口与 `type: image` 步骤上。
- **省钱模式对大多数 provider 是静默空操作**（用户截图点破：选着 Claude Code CLI 勾"省钱模式"，实际一分钱没省）。降档表此前只认 7 家——其中两家还是已下架赞助商，而**用户手上最常见的 Claude Code CLI、默认供应商多元探索、以及全部在架赞助商都不在表里**，勾了也不生效且没有任何提示。三处修法：① 降档表补上 `claude-code`（CLI 认 `--model`，轻活降 haiku——订阅额度同样是钱）与 `shengsuanyun`（便宜档 `anthropic/claude-haiku-4.5`，取自它**公开**的模型目录、实拉核实在架）；其余赞助商没有可核实的便宜档编码，**宁缺毋滥不猜**——猜错=轻活步骤全线报"模型不存在"，比不降档糟得多；② 引擎导出 `BUDGET_CAPABLE_PROVIDERS`，`/api/config` 带给前端；③ Studio 勾选框在当前 provider 不生效时**禁用并明说**（"没有已核实的便宜档，省钱模式不会生效——切到 …… 再开"），中英双语。补 5 条断言含"降档表的键必须是真 provider"（写错=永远静默 no-op，没人会报错）。
- **step id 带路径字符（`/` `\` `..` 等）要到落盘那一刻才炸**：id 会被拼进产物文件名（`steps/<n>-<id>.md`，图片步骤还有 `assets/<id>.png`），带 `/` 的 id 此前在保存时直接 ENOENT、带 `..` 的会把文件写出运行目录。现在解析期就拦（报错说清哪些字符不行），中文 / `-` / `_` id 不受影响；内置 114 个工作流步骤逐个核过，零违规。
- **image 步骤上写 `acceptance` / `assert` 此前被静默忽略**——用户写了核验、以为生效了，这比不支持更糟。现在解析期明确报"暂不支持"并说明原因（它们核验的是文本产出；图片核验需要时交给下游视觉模型步骤去审）。
- **"探测说已安装、一跑却报找不到命令"**（接 Antigravity 时自己引入、当场核实出来的）：官方 `install.sh` 把 `agy` 装到 `~/.local/bin`，而这个目录**默认不在 PATH 上**——当时只给「安装探测」补了这些已知目录，真正 spawn 时却仍只按 PATH 解析，于是 doctor / Studio 说"已安装"、点下去报"找不到 agy 命令，请先安装"。两边各说各话是最难自证的一类失败。现在把"这个 CLI 装在哪"抽成 `src/utils/bin-lookup.ts` 一份，探测与执行共用；POSIX 下只在"命令有已知安装目录、且不在 PATH 上"时才补成绝对路径（其余命令行为完全不变，没把 `~/.local/bin` 整个塞进 PATH）。补了一条端到端断言：探测说已安装，就必须真的跑得起来。
- **`--materialize` 认不出非 ASCII 文件名**:路径判定只认 `\w`,于是 `### 课程/w4.6-阶梯产出验收清单.mdx`
  这类中文文件名一个都识别不出来,**静默落盘 0 个文件**(不报错,就是什么都没有);
  围栏信息串里的 `path=课程/…` 同样在第一个中文字符处整条匹配失败。
  这恰恰是本项目的主力场景——文档/课程类产出几乎全是中文名。
  已放宽为 Unicode 字母数字,但**要求 ASCII 扩展名**:否则 `优点/缺点`、`第一章.总则` 这类中文标题
  会被当成文件路径写到盘上。有扩展名才当路径,是这里唯一可靠的判据。
- **CI 从 2026-08-07 起一直是红的，而且红在一处"只有大小写敏感文件系统才暴露"的测试模拟**：`test/spawn-cli.ts` 造 Windows 的 PATH 目录时按小写扩展名落盘（`gemini.cmd`），而 PATHEXT 按 Windows 惯例是大写（`.CMD`）——真实 Windows 的 NTFS 与 macOS 默认卷都不区分大小写，两边天然对得上，所以本地怎么跑都绿；CI 跑 ubuntu（大小写敏感）就一个都找不到。更糟的是 `npm test` 用 `&&` 串联、它排在链条第 5 位，**后面 50 多个测试文件在 CI 上从来没跑过**。修的是模拟本身（落盘时两种拼法都写一份），**没动 `findExecutable`**——那是 #102 刚修好、报告者确认过的 Windows 启动路径，没有 Windows 机器验证之前不该为了让测试变绿去碰它。验证用 `hdiutil` 造了个 Case-sensitive APFS 卷把 CI 的失败原样复现出来再修。修复后 CI（Node 20 / 22 两个矩阵）**双双转绿**。
- **AO 自己的请求现在会走 `HTTP(S)_PROXY`**（新增可选依赖 `undici`）：Node 的 `fetch` 默认**不读**这些变量，导致在需要代理才能访问 OpenAI / Gemini / xAI / Anthropic 官方端点的机器上，用户 curl 验得好好的地址、AO 一跑就是 `fetch failed`。现在检测到代理变量时接管全局 dispatcher（CLI、引擎、Studio 三个入口都装，幂等）。三条自我约束：**没配代理就什么都不做**（绝大多数走中转商的用户行为一个字节不变）、**本机地址永远直连**（否则 Ollama / Studio 自身 / 测试假端点全被绕进代理）、`AO_NO_PROXY=1` 可彻底关掉。没用 undici 现成的 `EnvHttpProxyAgent`——实测它自己读 `process.env` 且**忽略显式传入的代理地址**，会造成"看着接管了、实际走的是另一个代理"这种最难查的故障；改为自己按 origin 路由（命中 no_proxy 走直连 Agent，其余走 ProxyAgent）。真机验证：同一条 `ao doctor` 从 `fetch failed` 变成 OpenAI 的 401、xAI 的 400（请求真的到了对面）。
- **配了代理却「curl 能通、AO 连不上」时，报错完全没提代理**（本轮核实端点时自己撞上的）：Node 的 `fetch` 默认**不读** `HTTP(S)_PROXY`/`ALL_PROXY`，而 curl、浏览器都读。表现是 `fetch failed / UND_ERR_CONNECT_TIMEOUT`，用户前一秒刚用 curl 验过同一个地址是通的，于是会一路去怀疑 base_url、key、甚至我们的代码。现在连接器、`ao doctor`、Studio 的「获取模型列表」在连接类失败时统一点破这一点，并给三条可照做的出路。**代理地址里的账号密码不会被打进日志**（只回显 `scheme://host:port`，有断言钉着）。注意这只解决"说清楚"，AO 自身仍不走代理——真要走代理得另外引依赖，是个单独的决定。
- **全接口巡检发现的三处**（把 `web/server.js` 里注册的 50 条路由逐条真打了一遍，假 LLM 上游 + 临时 HOME 隔离）：
  - `/api/compare` 对「工作流本身写得不对」回 **500**（实测：产物缺 `llm:` 段 → `工作流缺少 llm 配置`）。500 会让人以为引擎坏了跑去重启，其实是 YAML 的问题。解析类错误现在带 `userError` 标记，web 层据此回 4xx；「找不到角色库目录」同理。
  - **YAML 没写 `llm:` 时，`--provider` / Studio 里选的供应商救不了它**：解析器在 override 生效之前就抛了。现在 `parseWorkflow` 接受调用方给的 llm 兜底——用户明明在命令行/界面上指定了 provider 却被挡住，说不通。
  - **自动组队产物可能缺 `llm:` / `agents_dir:`**：提示词模板里给了，但"模板给了"不等于"模型每次都写"，缺了就是个跑不起来的产物。改为确定性补齐（用本次 compose 实际用的配置与角色库名，**不写 api_key**——工作流是会被分享出去的）。
- **API 面偶尔回 HTML 错误页**：请求体不是合法 JSON（或超 5MB）时 `express.json` 把错误交给 Express 默认处理器，回一整页带栈的 HTML；前端 `res.json()` 解析它必然再抛一句毫不相干的错。现在统一回 JSON（400 / 413）。
- **`test/compose.ts` 的异步用例根本没被计数**：汇总行在 promise 结算之前就打印了，后面的用例即使失败也不影响退出码——等于白写。改为末尾统一 await。
- **拉模型列表对齐 cc-switch 的两处口径**：① Anthropic 协议中转常把兼容层挂在子路径上（`/api/claudecode` 等），这类中转两种布局都有——`/models` 在子路径下（AICodeMirror 实测如此）或只在站点根上。此前只试子路径的两种拼法，后一种直接拉不到；现补上「剥掉已知兼容后缀再打站点根」的候选（后缀清单直接沿用 cc-switch 的 `KNOWN_COMPAT_SUFFIXES`，同一批中转商不另起口径）。② 模型下拉的厂商分组改用响应里的 `owned_by`/`provider` 真值，而不是一路按模型名猜——聚合商自造的编码（LanoX 的 `gpt-5.6-sol` 这类）迟早猜不准；但会滤掉 `api-transfer-server` 这类占位归属（拿它当分组标题还不如猜的准），滤掉后回退推断。
- **公开演示站点「测试连接 / 获取模型列表 / 保存」直接吃 405**（用户实测控制台报 `POST /api/test-provider 405`）：官网是纯静态托管，`/api/*` 根本不存在，静态站对 POST 就回 405。供应商页是**有意**在演示站也放开的（能浏览端点、权益、模型建议），但这三个动作必须打后端——现在离线时不再发那条注定失败的请求，页面顶部一条说明横幅 + 点按钮时一句「这一步要本机跑 `npx agency-orchestrator web`」，中英各一份。新增 `test/studio-demo-guard.ts` 钉住这条约定（拦截必须在真正发请求之前，删掉那行 if 不会有任何构建报错，只会让 405 在演示站重新冒出来）。
- **网关用「HTTP 200 + 正文写着接口不存在」表示路径不存在时，端点兜底全线失效**（LanoX 实测即如此，`{"data":null,"code":"404","codeMsg":"接口不存在"}` 走的是 200）。按状态码判路径的逻辑对它一条都不触发：少写 `/v1` 不会自动补、解析又捞不到 content，最终表现成最难查的那种失败——「跑完了，什么都没生成」。而这家的官方文档写的 Base URL 恰恰是根地址，照抄必踩。现在识别这种网关壳并当作路径未命中处理（自动改试另一种拼法），两个候选都被挡回来时直接报错点破是地址问题、附上实际请求地址与排查指引。判据保守：只认带 404/405 业务码且**没有** `choices`/`content` 的正文，正常响应即便正文里出现 `"code":"404"` 字样也不会被误伤；且只在 JSON 正文上判——成功的流式响应是 `text/event-stream`，clone 去读它等于把整段流缓冲住。
- **自动组队产物 `depends_on` 写成输出变量名**（#103，同类 #94）：模型把上游的 **output 变量名**当成 step id 写进依赖（`depends_on: [income_paths_analysis]` 而那是 step `analyze_income_paths` 的 output）。这类错误此前是修复链的盲区——它进得了 `runVariableFixChain`，但阶段 0 只会「补」依赖、阶段 1 只改 `{{变量}}`、阶段 2 靠 `extractUndefinedVarNames` 提变量名（这类报错提不出东西），三个阶段都动不了它，于是原样抛给用户一个在工作流里根本搜不到的名字。新增 `autoFixDependsOnIds` 做零歧义改写（对不上、有歧义、会成环、会自依赖一律不动），接在 compose 链与 `/api/workflows/save`；报错文案也改为直接点破"这是 step X 的输出变量名，应写 X"。
- **配 claude 直连中转会连带把 claude-code 订阅 CLI 改道**：两者共用 `ANTHROPIC_BASE_URL` 这一个变量名但凭证完全不同，注入进程 env 后被所有子进程继承——用户只是配了直连 API，本机的 claude-code 却被改道到该端点，拿订阅登录态去打必然 401。claude 的 base 不再注入 env（引擎侧走 `--base-url` 传参，链路已通）。
- **Studio「测试连接」对 claude 硬编码打官方端点**：无视用户配的中转地址，导致配好中转后一测就 401、反过来怀疑自己配错。现与 claude-code 共用同一套地址解析。
- **Anthropic 探测给了"照做就坏"的建议**：探测首选 `{base}/messages`，而 SDK 与 claude CLI 一律发 `{base}/v1/messages`——配置**正确**的中转会先 404 再靠兜底命中，然后建议用户把 base 改成 `.../v1/messages`，照做后客户端再接一次直接连不上。首选路径已与真实客户端对齐；反过来"多写了 /v1"仍会提醒（AO 削得掉，claude CLI 直读会拼错）。
- **保存时的自动修正不再瞒着用户**：`/api/workflows/save` 的确定性修正会回传修正后的正文，内置网页编辑器同步回填并列出改了哪几处，避免"眼前的文本与磁盘上的文件不一致"。
- **`autoFixDependsOnIds` 改写留下重复依赖**：坏 id 与正确 id 并存时会改出 `[analyze, analyze]`（拓扑排序不受影响，但用户文件里不该留这种东西），现改为删掉多余那条。

### 测试
- 全量 **57 个测试文件 / 0 失败**（本轮新增 9 个测试文件）。LanoX 上架 + 接口巡检共补 24 条断言（赞助位 11→14、清单 13→15、端点兜底 41→46、服务端冒烟 95→101、compose 41→47、新增 `studio-demo-guard` 3 条）。
- 赞助位新增钉死：「排最后一位」的断言随胜算云上架从 LanoX 移到它身上（Studio 列表 + 官网卡片两处一起改）、清单里新增胜算云中转预设的端点断言、清单轮换池与代码那份逐条一致、logo 资源**逐个**核对存在（原先只查了 AICodeMirror 一家；`providerLogo()` 只按 id 拼路径，素材没传不会有任何报错，用户看到的是破图）。
- 返利码守卫扩到大小写与渠道码：`URLSearchParams.get` 大小写敏感，只写 `invitecode` 抓不到 LanoX 的 `inviteCode`，`?c=` 渠道码也一并纳入跨文件比对（清单 ↔ 引擎 ↔ Studio）。
- 新增覆盖：`spawn-cli`（Windows 三条启动路径，CI 是 ubuntu 探不到）、`sponsor-guide`（轮换份额与返利码一致性）、`providers-manifest`（唯一绕过发版流程的通道，按代码来测）、`claude-base-url`、`depends-on-ids`、`legacy-ui`（`web/index.html` 不过 tsc 也不进构建，此前零覆盖）。

## [0.13.0] - 2026-08-07

> ⚠️ **这一版从未发到 npm**：发布流水线最后一步卡在 npm 的 2FA（`EOTP`，仓库 Secret 里的
> token 不是 Automation 类型），测试/构建/产物校验全过、只死在 publish。所以从 npm 上看是
> `0.12.1` 直接跳到 `0.14.0`，本节内容随 0.14.0 一并送达。

### Added（本次新增）
- **Claude 全局安全切换 + 一键急救**：Studio 可把中转商的 key/base_url 写进全局 `~/.claude/settings.json`（`ao doctor --fix` 同款写入器 `claude-apply`），体检卡认得 AO 自己写的标记并支持一键切回官方。写入时同时记下 **base_url 指纹**：标记还在但 env 已被别的工具（cc-switch 等）或手改走时判定 `managed=false` 照常报红，外部工具无从冒名。代理也从"看不见"变成可管理——探测可达性、检测漂移、一键移除；还原时自动同步系统代理到 settings（修复"还原后仍连不上"），系统代理探测从 macOS（scutil）扩到 **Windows**（读 WinINET 注册表，无第三方依赖）。
- **`ao doctor` 端点连通性体检**：新增对配置端点的实活探测（1 token 请求，`--no-probe` 可跳过），地址写错/被 302 跳转/不可达分别给出可执行的下一步。
- **doctor 认得 Studio 存的 key**：Studio 的 key 存在 `<DATA_DIR>/.local/web-keys.json`、只注入 Studio 自己的进程，此前命令行 doctor 只看环境变量，于是"界面里明明配好了、doctor 却说没配 key"。现在会列出 Studio 里已配 key 的 provider，并明确说明命令行读不到、该怎么 `export`；env 无 key 时端点探测退回用 Studio 保存的地址+key（地址配错恰恰最常发生在这批用户身上）。
- **Anthropic 协议中转也能「测试连接」**（Studio）：并修掉该协议下路径兜底被掐的问题。
- **APINEBULA 编码 CLI 中转预设**：同一账号配三个编码 CLI 时端点按协议格式不同（Anthropic 兼容走根路径、Codex 走 `/v1`、Gemini 走根路径），填错就是 401/405；预设把映射锁死，点一下即可。
- **运行历史可管理**（#101）：Studio 历史面板新增按状态分类（全部 / 成功 / 未完成）、按本地日期分组（今天 / 昨天 / 具体日期），以及删除——平时每条 hover 出垃圾桶，点「管理」进多选做批量删除，删除走应用内确认框并支持批量删到一半失败时保留已删项 + 显示原因。后端 `DELETE /api/runs/:id` 只认 `ao-output` 下**带 metadata.json** 的运行目录（先 resolve 掉 `..` 再校验包含关系），不会误删挂载卷里的其他目录。

### Fixed
- **历史时间不是本地时区**（#101）：运行产物目录名里的时间戳是 UTC（引擎用 `toISOString` 生成），而历史列表把它当字符串直接显示，北京用户看到的时间永远差 8 小时。现在引擎在 metadata 里记录完成时刻 `finishedAt`，后端统一给绝对时刻（老产物按 UTC 从目录名还原），前端用 `toLocale*` 按浏览器所在时区渲染——跟随系统时区，无需任何配置。
- **Windows 上 CLI provider 全线调用失败**（#102）：hermes / gemini / codex / copilot / openclaw 在 Windows 一律报 `命令语法不正确。(exit 1)`。根因在我们这边不在这些 CLI ——`shell: true` 下 Node 会把命令和参数**用空格裸拼成一行**交给 cmd.exe 且不做任何转义，而提示词必然以 `<system>` 开头并带换行，cmd.exe 把 `<` 当重定向、换行当命令结束，于是每次调用都在解析阶段就死了（顺带还会把 `--tools ""` 这类空串参数直接吃掉，等于 Claude Code 的禁用工具开关在 Windows 上失效）。改为绕开 shell：解析 PATH×PATHEXT 拿到真实可执行文件，`.exe` 直接启动；npm 全局包的 `.cmd` shim 则解析出它真正执行的 JS 入口用 Node 直跑（桌面端 Electron 会显式补 `ELECTRON_RUN_AS_NODE=1`）；实在只能过 cmd.exe 时自己做引号转义，遇到无法安全传递的参数给出说得清的中文报错而不是继续吐"命令语法不正确"。
- **Azure / 推理模型产出为空**（#99）：推理模型（`o1`/`o3`/`o4`/`gpt-5` 系列，不止 Azure）按模型名判定改用 `max_completion_tokens`，默认上限放大到 32768（普通模型与非推理 Azure 部署仍 4096），端点不接受参数名时双向自动切参且只重试一次；compose 生成的 YAML 同步放大——否则组队产物会被内部推理吃光 token，表现为"跑完了但什么都没生成"。补回 13 条断言（此前有实现无测试）。
- **中转端点必踩的 405**：跳转后保持 POST（此前 301/302 会被降级成 GET，而 `/v1/chat/completions`、`/api/chat` 只收 POST），`base_url` 容错（少写/多写 `/v1`、只写 `localhost:11434` 都能用）；Ollama 走同一套发送逻辑，远程 Ollama 挂在反代/隧道后不再莫名 405。
- **跳转带 key 的同域判定收紧**（安全）：`sameCredentialScope` 原按"取最后两段域名"判同域，对 `example.co.uk` 这类多段 TLD 会把 `evil.co.uk` 也算成同域——上游跳一下就能把 key 骗走。改为按父子域关系判定，并挡掉 `x.com.evil.net` 这类后缀伪装。
- **体检把 AO 自己的中转配置误报成"被劫持"**：只要在 AO 里存了 claude-code 中转 key，`applyKeys` 就会把 `ANTHROPIC_*` 注入本进程 env，体检直接读 `process.env` → 系统 `~/.claude` 明明干净也报红且点急救永远消不掉。改用 applyKeys 之前的 shell 快照。
- **长提示词在部分 CLI 上退化成字面量 `-`**：以前只要提示词超过 4KB 就切 stdin，参数按 `buildArgs('-')` 生成；但只有 `codex exec -`、`claude -p -` 真的会去读 stdin，`hermes -z -` / `copilot -p -` / `openclaw --message -` 只会把 `-` 当成提示词本身。角色系统提示词普遍 10~25KB，等于这几个 provider 跑真实工作流时模型收到的提示词永远是一个减号。现在只有声明支持 stdin 的 CLI 才会切 stdin，其余走命令行参数（Windows 按 UTF-16 字符数、POSIX 按字节数判上限），真超上限时明确报错并给出替代路径。

## [0.12.1] - 2026-07-20

### Added（本次新增）
- **「我的」自建角色支持编辑**：Studio 角色组队里自建角色卡新增 ✏️，与「新建」共用同一表单弹窗（自动预填名称/描述/正文）；后端 `PUT /api/roles/my/:id` 字段级合并（没传的字段不动），路径守卫与删除同规。此前只能删掉重建。

### Fixed
- **Studio 角色列表遗漏嵌套角色**：列表此前只扫分类目录一层，`game-development/unity/*` 等嵌套子目录角色不显示——中文库显示 252/267、语言包 172/187，与 CLI（`ao roles`）和官网画廊的全量口径不一致。`loadRoles` 改为递归枚举（引擎同口径），带斜杠的嵌套角色 id 详情路由亦已打通。
- **英文工作流显示中文验收文案**：`formatVerification` 按该步内容语言输出——英文步骤显示 `Acceptance ✓ / ⚠️ N unmet`，CLI 结果行、summary.md、步骤文件头三处一致。

## [0.12.0] - 2026-07-19

### Added（本次新增）
- **我的角色（自建，叠加式）**：`~/.ao/roles/<id>.md`（`AO_USER_ROLES_DIR` 可覆盖）与内置角色库共存，工作流里用 `my/<id>` 引用，run / compose / validate / resume / `ao roles` / MCP 全链路可解析。Studio「角色组队」新增「我的」分类：内置「新建角色」表单，自建卡可删（应用内确认框，严格限用户目录）。
- **提示生成 → 角色沉淀闭环**：「提示词优化」更名「提示生成」（CLI 命令 `ao prompt optimize` 不变）；system 模式生成结果旁新增「存为我的角色」，一键把生成的 system prompt 沉淀为 `my/` 角色，直接出现在组队「我的」里。
- **角色 ☆ 常用**：角色卡点星收藏（localStorage，与工作流卡同一交互），类目栏出现「常用」并全局置顶。
- **多语言角色库**：5 个社区语言包发布至 npm（`agency-agents-{ko,ru,pt-br,id,ar}`，各 187 = 184 上游翻译 + 3 本地市场原创）。装了即在 Studio「角色组队」出现「角色库」下拉（界面语言与角色库语言解耦）；compose 生成的 YAML `agents_dir` 直接写包名，`ao run` 从 node_modules 解析。官网专家库同步支持 7 库在线浏览（`/experts?lib=ko` 可直链）。桌面端随包内置全部语言库。
- **Docker / NAS 部署**（#93）：官方镜像 `ghcr.io/jnmetacode/agency-orchestrator`（amd64/arm64），`docker run -d -p 8088:8088 -v ao-data:/data …:latest` 即起；密钥/产物/自组工作流全部落在挂载卷。仓库根附 `docker-compose.yml` 一键部署，发布走 GHCR（release-docker workflow）。
- **供应商专有参数透传**（#90）：`llm:`（全局或步骤级）新增 `params:` 字段，键值原样并入请求体——DeepSeek/OpenAI 的 reasoning 档位、Anthropic thinking 预算、ollama top_k 等都能配，不再等逐个开关；核心字段（model/messages/stream）受保护不可被覆盖。
- **Studio 输入支持从文件读入**（#96）：运行工作流的输入弹框里，每个输入旁新增「从文件读入」——把 .md/.txt/代码等文本文件内容一键填进输入变量（浏览器端读取，不经服务器路径，上限 200 KB），"识别技术文档"类场景不用再手动复制粘贴。CLI 侧对应能力为 `-i 变量=@文件`。

### Fixed
- **带 `my/` 自建角色人设聊天报 400**：`/api/chat` 的路径守卫只认内置库，自建角色无法单聊——现走用户角色目录解析。
- **Studio 角色列表因严格 YAML 悄悄丢角色**：翻译文本裸冒号等使 frontmatter 解析失败时，退回引擎同款逐行宽松解析，角色不再从列表消失；5 个语言包内 30 个文件的 frontmatter 已在 1.0.1 修复源头。
- **全站角色计数对齐**：`agency-agents-zh` 升 1.2.7（267 角色，check-counts 发布门禁曾卡住 267 未发）；README（中英）、官网文案、CLI 帮助里散落的 216 全部改为 267。

## [0.11.0] - 2026-07-17

### Added（本次新增）
- **全新 AO 品牌视觉**：渐变紫蓝 A+O 矢量标上线——官网 favicon（此前缺失）、顶栏/页脚/工作台图标、社交分享卡片（og-image）、桌面应用图标全套换新；矢量源文件在 `website/public/logo/`。
- **新手引导与默认供应商调整**：默认 provider 改为多元探索（进阶赞助商定制位）；无凭证引导里的赞助商位改为每日轮换 2 家（旗舰+标准共 6 家等份轮值），并新增赞助商入口点击统计（仅官网/演示站 GA4，本地 Studio 不上报）。
- **acceptance 自动核验 + 一轮自动返工（默认开）**：写了 `acceptance:` 的步骤产出后，用同一 provider 逐条核对验收标准——未过则把「上一版产出 + 未满足条目」交回同一专家针对性返工一轮再复核。验收从"注入 prompt 的嘱咐"升级为"跑完真的有人对着查"的机制。验收不过是质量信号而非执行错误：步骤不会因此失败，最坏得到带 ⚠️ 标记的返工版照常流向下游；核验器自身故障（网络/解析失败）自动跳过核验不拦产线。核验状态（通过/返工后通过/仍有 N 条未满足）进 CLI 结果行、summary.md、metadata.json 与步骤文件头。三级开关：CLI `--verify`/`--no-verify` > YAML 顶层 `verify:` > 步骤级 `verify: false`（默认开，仅影响写了 acceptance 的步骤）；核验/返工消耗如实计入该步 token 成本。
- **Studio 验收徽章**：实时运行与历史详情的步骤行显示核验状态徽章（绿 = 验收 ✓ / 琥珀 = ⚠️ N 条未满足，hover 提示是否返工过）；未满足条目在实时视图拦成独立卡片展示，不再混入步骤正文。文档站新增「验收与自动核验」页；自动组队提示词同步注明 acceptance 会被逐条真核验，要求每条仅凭产出文本即可客观判定。
- **引擎「待重启」自检**：引擎进程启动后代码被重新构建（更新 AO / `npm run build`）时，顶栏状态徽章变琥珀色「引擎待重启」并说明缘由——终结"前端认识新供应商、引擎报 unknown provider / 新端点 404"的版本漂移谜题；`unknown provider` 报错同步带上"请重启引擎"行动指引。

### Fixed
- **图标按钮即时悬停提示全覆盖**：Claude Code 体检刷新、API key 明文切换（原先连提示都没有）、运行弹窗终端/关闭、普通对话下载/清空/关闭、历史与实时步骤的复制/下载、供应商返回键——全部换成即时 Tip（原生 title 需悬停约 1 秒，用户以为没有提示）。
- **供应商配置页三连修**（多元探索实测反馈）：① 多元探索默认模型改为平台实际上架的 claude-sonnet-4-6（原 claude-sonnet-5 未定价，测试连接必报"价格尚未由管理员配置"）；② 测试连接的上游报错抽出人读 message 展示（原来整段 JSON 被 UI 截成半句），报错区最多两行折行 + hover 全文；③ API key 含中文/全角字符（复制时带上说明文字）时给出人话校验提示——原来会触发底层 ByteString 报错完全不知所云，且保存/测试/拉模型列表三处统一拦截。

## [0.10.0] - 2026-07-12

### Added（本次新增）
- **步骤级验收标准 `acceptance:`**：给关键步骤（尤其最终交付步）写 2-5 条可核对的交付条件——运行时注入该步 prompt 末尾作最后指令；渲染后进运行档案与步骤文件头；Studio 运行历史以独立面板展示；`--compare` 盲评把它当两份产出的同一把评分尺。质量机制走"验收写成数据"，而不是再叠一个会幻觉的 Reviewer Agent。
- **「一人公司」系列模板**：做产品（简报→PRD→技术→冲刺→启动包）/ 做内容（定位→洞察→选题→脚本→作战日历）/ 做投研（宏观→行业→估值→风控→**老板签字**→报告，含免责声明），连同「全员大会」组成系列并置顶模板货架；关键步骤全部带验收标准。
- **compose 学会两件事**：给关键步骤自动写 `acceptance`；识别金融/医疗/法律/花真金白银类任务时，在最终步前自动插 `type: approval` 签字闸门（重大决策必须用户放行）。
- **「我的工作流」资产化**（#92、agents-zh#98）：独立分区**置顶第一屏**、按最近修改倒序、点 ☆ 置顶常用；卡片新增**下载 YAML**（拿到 CLI / 其他机器直接用）与**删除**（服务端严格限用户目录，内置模板不可删）。
- **画布编辑器增强**：普通节点新增「验收标准」编辑框；approval / human_input 节点显示专属编辑器（暂停说明 + 提示语），不再显示无意义的角色下拉。
- **新增供应商：火山引擎（赞助商）**：字节火山方舟 Ark 直连（OpenAI 兼容 `/api/v3`，key 走官方 `ARK_API_KEY`，默认豆包 doubao-seed-2-1-pro）+ 给本地编码 CLI 配中转的预设（Anthropic 兼容 `/api/compatible`，三档模型自动映射，对齐 cc-switch）；注册领 2500 万 Tokens。
- **专家咨询自动保存**：专家库单聊生成的一步工作流不再是"跑完即删"的临时文件——自动落盘「我的工作流」（标题用角色显示名，如「专家咨询: 人类学家」），可重跑/下载/删除；`api_key` 绝不写入 yaml（改经 CLI 参数传递）；运行面板完成后明确提示保存去处。
- **运行中断也有账（SIGTERM/Ctrl-C 优雅存档）**：引擎收到终止信号时把已完成步骤落盘成 metadata 再退出——网页端"等输入时关掉页面"的运行不再无痕消失，终端 Ctrl-C 同样保留已跑完的步骤。
- **历史「继续运行」**：未完成的运行在历史详情顶部给出一键续跑入口（自动从第一个失败步继续，复用已完成产出；human_input 步会重新弹输入框）；失败/跳过步骤在历史里有状态徽标，失败原因随档案展示。
- **工作流卡片即时悬停提示**：置顶/选入对比/画布/对比基线/下载/删除/运行等图标按钮，hover 立即显示用途气泡（原生 title 延迟约 1 秒、极易漏看）。

### Changed
- **删除确认改应用内弹框**：替代带 "127.0.0.1 显示" 抬头的原生 `window.confirm`（新 ConfirmDialog 组件可复用；Button 新增 destructive 变体）；文件已被外部删除时幂等成功。
- **README / 官网 hero 副叙事**：主定位不变，新增「一人公司：你当老板，AI 当团队——自动组队、重大决策请你签字、按验收标准交付」。
- 官网新增赞助商火山引擎（英文站 BytePlus logo，logo 支持按语言取值）。

### Fixed
- **画布"怎么改都存不了"（#91）**：① 保存前先跑与 compose 同款的确定性补边修复（变量对但缺 `depends_on` 边自动补上，修不动才 400，响应带 `autoFixes` 明细）；② 前端错误处理原来读不到结构化错误体，用户只见 "invalid workflow"——现在逐条显示具体步骤与变量，成功补边时把新连线实时画回画布。
- **画布 approval / human_input 节点被"每步必须选角色"守卫误杀**：这两类节点本就无 role，含签字闸门的模板与带中途提问的组队产物此前在画布一保存就 400，已放行。
- **validate 加固**：`acceptance` 里的 `{{变量}}` 引用纳入校验（写错在保存时就报，而非运行到一半才崩）+ 字符串类型检查。
- **历史记录全员"缺少源文件路径，无法重跑"**：引擎 metadata 此前从不记录源工作流路径，历史面板的重跑/续跑按钮对所有记录都不显示——现在每次运行把 `file` 写进 metadata（存量旧记录无法回填，仅新运行受益）。
- **`--resume` 裸目录名解析**：网页历史面板传运行目录名续跑时，CLI 按 cwd 误解析找不到 metadata——服务端现补全为 `ao-output/` 下的绝对路径。

## [0.9.0] - 2026-07-08

### Added（本次新增）
- **`ao doctor [--fix]`**：一条命令自检 provider / 凭证 / 已装 CLI / 官方 CLI 登录配置；`--fix` 检测到本机 `~/.claude` 被第三方写坏（假 token / 中转地址顶掉官方登录）时一键清除恢复（写前自动备份）。
- **`ao compose --budget` 省钱模式**：轻活步骤（抽取/汇总/格式化）自动降便宜档、重活（分析/设计/创作）保强档；默认关、opt-in（评测表明是省钱换质量的取舍旋钮，非无损）。Studio 也有「省钱模式」勾选。
- **`ao compose` / `ao run --temperature 0~2`**：采样温度（0=近确定性、可复现）；连接器透传 + per-step 可覆写。
- **首跑引导（CLI + 网页/桌面）**：无可用凭证时给「三选一」路径（已装 CLI 零配置 / 送额度中转 / 本地 Ollama）而非晦涩连接器错。
- **系统官方 CLI 配置急救**：Studio 供应商页「配置体检卡」+ `ao doctor --fix`，被别的软件写坏时一键恢复官方登录。
- **供应商 UX**：赞助商 logo 接入、顶栏模型下拉精简（不再倒灌聚合商全量目录）、配置页大列表按厂商分组、「复制为供应商」、新增 CCSub 赞助商、自定义供应商预设精简为主流大厂。

### Changed
- **导航重组为 8 项**：资源 / 帮助分组下拉，新增「创意库」「影视提示词」入口，去掉价值低的「能力」锚点。
- **零配置首跑默认 provider**：未指定 provider 且未配 key 时，自动用本机已登录的订阅制 CLI（claude / gemini / codex…），复用登录态、免 API key；CLI 与 Studio 行为一致。
- **发布卫生**：`prepublishOnly` 接入 `verify:release`（校验 dist 命令完整 + 前端产物完整），残缺包发不出去。
- **赞助位收敛到赞助页**：APINEBULA 旗舰赞助 / 优惠码推广此前在首页(SponsorStrip)和 Studio(StudioSponsorSlot)也展示，现仅保留在 `/sponsors` 赞助页，不再出现在首页与工作区。

### Fixed
- **DeepSeek 长生成 0-token 卡死**：OpenAI 兼容连接器加首字节/停顿超时（`AO_STREAM_STALL_MS` 默认 90s，覆盖等响应头 + 读 body 全程），provider 久不响应时**快速失败**并给精准提示（优先换 provider / 拆分，说明增大超时无效），不再干等 20+ 分钟再重试。
- **桌面 AppImage 白屏 (#81)**：CI 加前端产物完整性闸（打包前校验 + 钻进产物校验 `website/dist`）；server 缺前端时给可读诊断页而非白屏 / 报栈。
- **`ao prompt` / `ao team` 等命令「不存在」(#80)**：根因是已发布 dist 落后于源码；加 `verify-cli` 闸确保发布的 `dist/cli.js` 实现源码全部命令，残缺不予发布。
- **Windows 下单角色对话不进运行历史 (#82)**：临时工作流名「专家咨询: \<role\>」含冒号导致 Windows 建目录失败，已清洗输出目录名。
- **角色数口径 (#67)**：`package.json` 描述的角色数 211 订正为 216（与 loader 实际枚举 216 中 / 184 英一致）。
- **演示页工作流太少 / 运行历史与用量「显示同一个」**：演示模式工作流改为读取**全部内置模板的静态快照**(19 个中文 / 10 个英文,由 `gen-workflows.mjs` 生成),不再只有手写几个;运行历史与用量两个 tab 给出**各自独立**的说明文案,不再雷同看着像没切换。
- **Studio 演示模式下切 tab 不响应**：引擎离线 / 公开演示站（无后端）时，各 tab 点了内容都不变（一律显示角色 demo），看起来像卡死。现在演示模式也**按 tab 显示真实内容、可浏览**——工作流展示内置模板快照、角色展示角色库、提示词展示 Prompt Lab，**只是运行类操作引导安装、不能真跑**（运行历史 / 用量本就无离线数据，给出简短说明）。另加防御：任一 tab 文案缺失也不再让整个 Studio 渲染崩溃。
- **Azure OpenAI 兼容**（#38）：Azure 的 gpt 模型只认 `max_completion_tokens`（不认 `max_tokens`），且用 `api-key` header 鉴权。OpenAI 兼容连接器现在检测到 `base_url` 含 `azure` 时自动切换；非 Azure 的 OpenAI o 系列推理模型可用 `AO_OPENAI_TOKENS_PARAM=max_completion_tokens` 显式覆盖（含回归测试 `test/azure-compat.ts`）。
- **`ao prompt` 文档补齐**：Prompt Lab 合入后 `ao prompt` 一直没进 `ao --help` / README / CLAUDE.md，用户无从发现；现已补上（中英）。

### Added
- **零配置首跑**：自动探测并默认使用本机已装的订阅制 CLI（claude/gemini/codex…），开发者无需配 key 即可一句话直接跑。
- **可视化工作流画布（可编辑）**：`@xyflow/react` + dagre，拖拽节点 / 连线（自动防环）/ 增删 / 侧栏改 task·角色·skill / 保存；运行时节点按状态**实时点亮**（运行中=蓝 / 成功=绿 / 失败=红）。借鉴 n8n 交互范式，绑定 AO 的 YAML+角色模型（转换在引擎侧保真往返）。
- **创意库（图像生成提示词）**：导航「提示词优化」左侧新增入口，整合 2 个 CC BY 4.0 开源库（YouMind + jimmylv）共 229 条 Nano Banana / Gemini 提示词，带预览图 / 12 分类 / 搜索 / 分页 / 收藏 / 一键复制 + 出处署名；导航「影视提示词」跳 prompts.aiolaola.com。
- **Studio「AI 自动组队」**：角色页顶部一句话、不选角色，直接让 LLM 从全部专家里自动组队并运行（`/api/compose` 放开空角色）。
- **标准软件开发流程工作流**：需求澄清 → 架构设计 → TDD 实现 → 代码审查 → 现实验收，5 步各挂方法论 skill，配 `--materialize` 落盘。
- **工作流列表分类分组 + ⭐ 收藏置顶**；Studio 供应商面板展示本机已装 CLI（绿标 + 推荐）。
- **SEO 基础**：`robots.txt` + `sitemap.xml` + 各公开页独立 title/description meta + 百度站长验证（meta + 验证文件）。
- **模型选择改成主题一致的「胶囊」**：供应商面板原生 datalist 下拉在深色主题下很丑,改为可点胶囊(点选 + 仍可手敲);Prompt Lab 演示站新增文本模型切换(agnes-2.0-flash / agnes-1.5-flash)。CF 函数接收前端选的模型并做**白名单校验**(只允许 Agnes 文本模型,非法/图像模型回落默认),防刷额度。
- **供应商面板模型可选可填**：原来模型名只能手敲、易写错;现在每个 provider 给常用模型下拉建议(datalist),既能**选**也能**填**自定义,留空用默认。
- **顶部导航新增「提示词优化」入口**(挨着「专家库」、在「文档」左边)→ 独立 `/prompt` 页,直接用提示词优化(公开站走 CF Function 免费额度)。撤销上一版把 Studio 内 tab 挪位的改动(那不是诉求)。
- **公开站提示词优化免费可用(Cloudflare)**：新增 CF Pages Functions(`/api/prompt/optimize|test`)把提示词优化/测试代理到 Agnes,**key 作 CF 机密、不进前端/git**;静态演示站的「提示词」页因此可真实使用(单次 LLM 调用),完整工作流仍需本地。「提示词」tab 移到「角色组队」旁边方便取用。配置见 `website/functions/README.md`。
- **新增 Agnes AI provider**：OpenAI 兼容(`apihub.agnes-ai.com/v1`,模型 `agnes-2.0-flash` 等)。`--provider agnes` 即可用,key 走 `AGNES_API_KEY` 环境变量 / Studio 配置(**不在仓库或前端写死**)。Studio 供应商面板、`ao init --provider agnes` 均已接入。
- **Skills(给步骤挂方法论)**：工作流步骤可加 `skill: "<名字>"`(或 `skills: [..]`)，把「怎么做」的方法论(流程剧本)注入该步的 system prompt——角色决定谁做、skill 决定怎么做。内容直接用开源 **superpowers-zh**(MIT,20 个,已作为依赖,零配置);`AO_SKILLS_DIR` 可换成自己的。`ao skills [名字]` 列出 / 查看;缺失的 skill 跳过不报错。
- **固定全局目录 `AO_HOME`**（#20）：设 `AO_HOME=~/.ao`（或任意目录）后，运行产物 `ao-output` 与 `compose`/`--team` 生成的工作流统一落到该目录，不再随执行目录散落；也可用 `AO_OUTPUT_DIR` / `AO_WORKFLOWS_DIR` 单独指定。**默认不设时维持原行为**（写到当前目录），向后兼容。团队 / 提示词 / 版本检查一直在 `~/.ao`。
- **团队 / Loadout（可复用角色阵容）**：把跑得好的角色阵容存下来，套到任意新任务上。
  - CLI：`ao team save <workflow.yaml>` 从工作流抽出阵容存为团队；`ao team list / show / rm` 管理；`ao run --team <名字> "新任务"` 用固定阵容跑新活（本质 = compose 时把可选角色锁定为团队那几个，不漏人也不幻觉）。团队存为 `~/.ao/teams/*.team.yaml`（纯 YAML 可分享，`AO_TEAMS_DIR` 可覆盖）。
  - Web Studio：「我的团队」一排可一键载入整队；选 ≥2 角色后「存为团队」，合成预览里也能「存为团队」。后端 `GET/POST/DELETE /api/teams`，**与 CLI 共用同一份存储**，两端互通。
- **Prompt Lab —— 提示词优化 / 测试 / 对比 / 沉淀**（参考 prompt-optimizer）：把「靠感觉」的提示词变成可迭代资产。
  - **优化**：输入原始 prompt → LLM 一键改写（system / user 两种模式；meta-prompt 明确「产出仍是提示词，不是去执行它」）；原版 vs 优化版并排对比。
  - **测试 / 对比**：用样例输入实跑两版，看真实输出；可调 LLM 裁判给多个输出**打分排序**（多结果评估）。
  - **沉淀**：保存 + 版本历史 + 收藏；内置起手模板 Prompt Garden。
  - 三端：`ao prompt optimize/test/list/show/rm/garden` + Web Studio「提示词」页 + 后端 `/api/prompt/*`；存 `~/.ao/prompts`（`AO_PROMPTS_DIR` 可改），CLI 与 Studio 共用。
- **自带私有角色**：环境变量 `AO_AGENTS_DIR=/你的角色目录` 让 `run / compose / roles / web` 全部改用自定义角色库。

### Fixed
- **桌面端连不上本地 CLI（claude/codex/gemini）**（#41）：从 Finder/Dock 启动的 GUI 应用只继承 launchd 的精简 PATH（`/usr/bin:/bin:...`），找不到装在 homebrew / `~/.local/bin` / npm-global 里的 CLI provider 二进制，表现为「找不到 claude / 连不上本地 cli」。桌面壳现在在拉起引擎前重建可用 PATH（登录 shell 的 PATH + 常见 bin 目录），子进程继承之；终端里 `ao run` 不受影响。
- **Studio 默认语言不跟随环境**：导航栏本来就有中/英切换，但**首启默认语言**走 `navigator.language`，桌面端 Electron 常判成英文 → 中文用户一进来看到英文。现在桌面端按操作系统语言（`app.getLocale()`）、`ao web` 按 CLI 界面语言（`--lang`/`AO_LANG`/`LANG`）带上 `?lang=` 决定首启语言；用户在导航栏切换后由 localStorage 记住。判定优先级：URL 路径 `/en` > 用户已切换的持久化选择 > launcher 的 `?lang=` > 浏览器语言。
- **Studio 默认 provider 缺 key 不提示**：默认 provider 改成 APINEBULA 后，它没被加进 Studio 的 `KEYED` 列表，导致新用户没填 key 时**不弹「需要配置 key」提示**、直接运行才报认证错。已补上。

## [0.7.5] - 2026-06-17

### Fixed
- **循环回跳误伤并行旁支**：loop 重跑现在只重置「循环体」（`back_to` 到循环节点的依赖闭包），不再清空同层但不在链上的并行步骤——避免它们被重复执行、重复弹 human_input / approval（含回归测试）。
- **条件运算符解析**：`contains` / `equals` 改为在 YAML 模板（替换变量之前）上解析；专家产出里恰好出现 "contains/equals" 不再会把分支 / 循环退出条件从错误位置切开（含回归测试）。

### Performance
- Studio 懒加载「用量」面板（recharts ~390kB）与 `experts.json`（~150kB）：不再随 Studio 首屏 / 演示模式一次性拉取，仅在用到时按需加载。

### Accessibility
- 专家详情 / 安装引导 / 专家库弹框加上 `role="dialog"` + `aria-modal` + Esc 关闭。

## [0.7.4] - 2026-06-16

### Changed
- 英文工作流模板统一到 `workflows/en/`（10 个），移除重复的 `workflows-en/` 目录（web/server.js、package.json、README.en 同步更新）。

### Fixed
- 补提交英文库 `agency-agents/marketing/` 的 30 个角色——此前随 npm 包分发但因历史 `.gitignore` 规则从未纳入 git，fresh clone / CI 会缺这些角色。

## [0.7.3] - 2026-06-16

### Fixed
- **`--resume` 上下文污染**：恢复上游产出时未剥离 step 文件头（`> 名字 | 步骤 i/n … ---`），下游专家会收到带 markdown 头的「上一版产出」；现与 `loadStepOutput` 一致只回灌正文（含回归测试）。
- **OpenAI 兼容流式静默截断**：命中 `max_tokens`（`finish_reason=length`）时直接返回截断内容、不续写——正是 DeepSeek 长文场景；现读取 `finish_reason`，达上限自动续写（与流断开同样处理）。
- **安全**：`claude-code` 临时系统提示词文件改为 `0600`，避免同机其他用户读取专有角色定义。

### Changed
- 英文站专家计数按英文库实际显示 **184**（原误标 216），并移除英文文案中英文库并不包含的「中国平台角色」描述。
- 删除演示模式改造后已无引用的死代码 `StudioGate.tsx`。

## [0.7.2] - 2026-06-16

### Changed
- **角色库升级到 agency-agents-zh 1.2.2**：中文角色 **211 → 216**（新增服装厂排产工程师等；并带来 Hermes Windows 目录修复、Qoder 集成、ai-citation-strategist 中文化）。全站计数统一为 **216 中文 / 184 英文**（README / 官网 / 文档 / 教程 / About）。

### Fixed
- 官网专家库清理一个失效角色的孤儿提示词（`support-supply-chain-strategist`，1.2.x 已移除）。

## [0.7.1] - 2026-06-16

### Fixed
- **嵌套角色现在可枚举 / 可用**：角色加载改为**递归**子目录，`game-development/unity/*`、`unreal-engine/*`、`roblox-studio/*`、`godot/*`、`blender/*` 等 15 个嵌套智能体此前无法被 `listAgents` / `ao roles` / compose 建议发现（loader 只扫一层）——现在补齐，中文库角色数与官方一致达到 **211**（英文库 184）。
- **枚举只认真角色**：仅纳入带 `name:` frontmatter 的 `.md`，排除 `QUICKSTART` / `EXECUTIVE-BRIEF` 等攻略 / 模板文档（此前会被当成"角色"混入列表）。
- **官网专家库补齐**：`gen-experts.mjs` 同步递归，专家浏览 / 复制提示词覆盖全部 211（zh）+ 184（en），不再漏掉游戏开发类嵌套专家。

## [0.7.0] - 2026-06-16

### Added
- **网页 Studio + 桌面客户端**：本地 `ao web` 启动可视化 Studio（角色组队 / 工作流 / 运行历史 / 用量 / 密钥）；同一套 UI 打包为 Electron 桌面客户端（macOS arm64+Intel · Windows · Linux），经 GitHub Actions 一键发布到 Releases，官网提供下载入口。key 只存本机。
- **Studio / 官网全面双语化 + 英文资源**：UI、角色库、工作流模板按语言切换（`/en` 读英文 `agency-agents` 库与 `workflows-en/` 模板，不再混中文）。
- **CompShare（优云智算）provider 内置**：OpenAI 兼容接入，填 key 即用（`COMPSHARE_API_KEY` / `COMPSHARE_BASE_URL`）。
- **一键复制完整提示词**：Studio 专家详情与公开站「专家库」页都能查看 / 复制每位专家的完整系统提示词（公开站读静态 `experts.json` + `/prompts/*.md`）。
- **公开站 `/studio` 演示模式**：无后端也能浏览全部专家、查看 / 复制提示词；填 key 与运行被引导到「安装客户端 / 本地运行」。
- **`ao roles <关键词>` 角色搜索**：按 角色路径 / 名称 / 描述 不区分大小写过滤（也支持 `--search`）；无匹配给友好提示。
- **`ao init` 首跑向导**：角色库装好后自动探测可用 provider（优先免 key 的 claude-code CLI / Ollama），按环境给出个性化下一步，缩短「安装→价值」。
- **评测回归门禁**：黄金任务集抽到 `eval/golden-tasks.ts`；新增 `eval/gate.ts` 与 `npm run eval:gate` / `eval:baseline`——胜率阈值 + judge 双向一致率阈值 + 基线快照回归判定，judge 太弱时判 INCONCLUSIVE（绝不当通过）。

### Changed
- **`ao compose` 幻觉角色确定性修复**：生成的工作流引用不存在的角色时，优先用最接近的**真实角色直接改写 YAML**（不再多花一次 LLM 调用、保证产物可运行），无可信匹配才回退 LLM；并在 LLM 重试后再做确定性兜底，堵住「重试后仍残留坏角色却被当成功」的缺口。
- **打包内容**：npm 包额外纳入 `web/`、`website/dist/`、`workflows-en/`，`prepublishOnly` 自动构建引擎 + Studio。

### Tests
- 新增 `test/roles.ts`、`test/init.ts`、`test/eval-gate.ts` 并并入 `npm test`；`test/compose.ts` 覆盖确定性角色修复。

## [0.6.17] - 2026-04-29

### Added
- 模板库扩充：5 个手写精调高质量 workflow，覆盖个人 / 中小团队高频场景
  - `tech-blog.yaml` — 技术博客创作（调研 → 大纲 → 正文 → 润色，4 步）
  - `meeting-notes.yaml` — 会议纪要整理（清理 → 决策/TODO/争议 三视角并行 → 整合，5 步）
  - `okr-decomposition.yaml` — OKR 拆解（现状分析 → 季度 KR → Q1 行动方案 → 完整文档，4 步）
  - `product-launch-comms.yaml` — 产品发布物料（统一定位 → 通稿 / 社交 / 邮件 三件套并行 → 物料包，5 步）
  - `pitch-deck-outline.yaml` — 创业 Pitch Deck 大纲（市场 / 方案 / 商业模式 / 财务 四角度并行 → 5 屏 deck，5 步）
- 内置 workflow 总数从 44 个增加到 **49 个**，全部 validate 通过

### Notes
- 5 个模板都是"输入一句话 / 一段简介 → 多角度并行展开 → 整合"的纯 LLM 任务，不依赖外部数据 / 联网，零歧义
- 每个模板的 task 描述都精确指定输出格式（markdown 模板）和约束（字数 / 结构 / 不许 AI 套话），避免 LLM 输出泛泛而谈
- 默认 provider deepseek-chat（最便宜稳），用户可用 `--provider` 覆盖

## [0.6.16] - 2026-04-29

### Changed
- **`ao demo` 重构：检测优先，去掉预录 mock**
  - 检测到可用 LLM（CLI / API key / Ollama）→ **直接真跑** story-creation 工作流，无需"先看 mock 再确认"
  - 没检测到 → 显示**真实 DAG 结构**（用 ao 自身的 `formatDAG`）+ 3 行行动指引（Claude Code / DeepSeek / Ollama 任选）
  - 删掉旧的 `MOCK_STEPS` 预录数据 + `replayMockSteps` 函数（共 ~150 行）。原 mock 内容是精修过的小说创作，让用户对真跑的输出期望被错误抬高，且占用 5 秒注意力后还要再问 y/n，链路过长
  - 体验路径从 "mock 5s → 选 provider → y/n → 真跑" 简化为 "检测 → 真跑" 或 "检测 → DAG + 配 key 指引"

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
