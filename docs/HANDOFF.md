# 工作交接（持续更新）

> 这份文档只记**从 git log 里看不出来的东西**：为什么这么做、哪些是有意的取舍、下一步按什么顺序动。
> 具体改动看 `CHANGELOG.md` 与各条提交说明。历史章节按时间保留在下方，**当前状态只看本节**。

## 〇、当前状态速览（2026-09-29）

**主干是绿的，没有阻塞。** 已发布：npm `v0.19.2` · 桌面 `v0.4.10` · Docker `0.19.2`；角色库 `agency-agents-zh` 1.4.0（276 中文 / 191 英文）。

- **主干领先已发布版 109 个提交**（#137–#185，`git log v0.19.2..main`），全部合过 CI。**发版是维护者的事，AI 不主动推 tag**；要发就三步：`npm version 0.20.0 --no-git-tag-version` → 提交 → `git tag v0.20.0 && git push --tags`，剩下全自动（npm Trusted Publishing + Docker + 桌面三平台）。CHANGELOG 的 `[Unreleased]` 已经是写好的发布说明，改个标题日期就能用。
- **这一轮的主线是"验收即数据"**，不是加功能。链条是：修好盲评锚点（#139）→ 真跑一次对照实验（#163）→ **自己证伪**（#164：加了对照组后 8.5:8.5 打平，结论从"多智能体更好"收窄成"把验收标准写成数据更好"）→ 按这个结论改模板（#165：同一工作流 8.5:8.5 → 9.0:7.0）→ 再顺着改动往下游走一步，发现它造出的新死角（#168 画布删掉交付物就存不回去）。**这个"往下游走一步"的动作是这一轮最值钱的方法**，见第五节。
- **模板补齐进度：70 个模板里 21 个**已经"声明的交付物条条有验收"（`deliverables` + `acceptance` 都齐）。剩下 49 个里有 8 个是结构化程度足够、照着 CONTRIBUTING 的配方就能补的：`academic-paper-outline`、`department-collab/code-review`、`dev/tech-debt-audit`、`dev/tech-design-review`、`legal-consultation`、`pitch-deck-outline`、`product-launch-comms`、`strategy/business-plan`。**补不补是产品判断**——验收写歪了是负资产（见第五节）。
- **待办 issue**：#184（包月 plan 类 API，未分诊）、#183（已修，PR #185）、#104（外部项目推荐，非缺陷）、#103/#94/#91（自动组队报依赖错误，代码已修但**没让报告者确认过**，要不要关是维护者的判断）、#66/#44（桌面端打包瘦身/签名）。
- **两处等维护者拍板的取舍**：① npm 包 39MB 里有 34MB 是官网前端（`/experts` 本地 Studio 也在用，删了会瘸）；② 桌面端 17MB 的多语言角色库。两处都不是 bug，是"要不要牺牲功能换体积"。
- **运营侧完整交接**在私有文档 `/Users/yx/work/战略/AO交接总表-2026-08-22.md`（本仓库不收）。

### 接手时先跑这三条

```bash
npm run build && npm test     # 应是 1650 断言 / 114 个测试文件，0 失败
gh pr list && gh issue list   # 有没有挂着的 PR / 新 issue
git log --oneline v0.19.2..main | wc -l   # 主干比线上多多少
```

### 历史速览（2026-08-25，已被上面的当前状态取代）

**代码侧没有阻塞**，两处等维护者动作。当前版本：npm `v0.19.1` · 桌面 `v0.4.10`（三平台）· Docker `0.19.1`；角色库 `agency-agents-zh` 1.4.0（276）。

- **发版**：推 `v*` tag → npm（Trusted Publishing/OIDC）+ Docker（内置等-npm-出现的防竞态轮询）；推 `desktop-v*` → 三平台桌面包。macOS 签名流水线已备好，填 5 个 Secrets 即自动真签名+公证（`docs/SIGNING.md`）。**给流水线加新步骤前必须本地原样预演**（悬空 .bin 符号链接曾炸掉一次 mac 构建）。
- **最新能力：文生视频**（`type: video`，`src/connectors/video.ts`）——建任务 → 轮询 → 下载 → Studio 内联播放，接了两家（秘塔 MiniMax-H3 / APIMart Sora2·VEO3·可灵）。加第二家只新增了一个 `SHAPES` adapter，主流程一行没动。三条硬纪律见下方「视频步骤」小节。
- **此前能力**（0.15–0.18）：`ao report` 分享报告页 / `--notify` 群推送（钉钉/飞书/企微自适配）/ `--export pptx` / 图片输入 vision（`src/utils/vision.ts`）/ 社区模板收录制（远程清单 `communityTemplates`）/ Studio「新版可用」角标 / gemini-cli 软下线。
- **官网**：sitemap **714** 条 URL（267 角色 + 27 工作流 + 394 提示词 + 15 分类 + 其余）；创意库图片 **1511** 条（229 策展有 SEO 页 + 1282 扩充池点击才加载）、视频 **75** 条（22 题材模板 + 6 构件 + 47 社区，17 条带示例成片）。本地 Studio **零统计脚本**（GA 只在公网域名加载——别回退这条）。
- **角色库**：`agency-agents-zh` GitHub main 已是 1.4.0（**276** 角色，新建 `company/` 公司经营部七位高管 + 视频提示词工程师），**线上仍 1.2.7、v1.4.0 tag 未打**——等 npm Trusted Publisher 配置。仓内英文库 `agency-agents/` 已同步到 191。
  发布后六步：打 tag → `npm i agency-agents-zh@^1.4.0` → 全站计数 267→276 → **换掉两处过渡角色**（`workflows/一句话出短片.yaml` 三步 `design/design-image-prompt-engineer`→`design-video-prompt-engineer`；一人公司 4 个中文模板 7 处 `specialized/business-strategist`→`company/chief-executive-officer`）→ `npm run gen:experts` → 发 v0.19.0 + 桌面 v0.4.9。
- **等维护者动作**：① agency-agents-zh 的 npm Trusted Publisher 配置 ② 给 APIMart / 秘塔 H3 充值（才能出 22 条示例成片、补 APIMart 建议模型）③ Apple 开发者账号 ④ 文章 / HN 投稿。
- **运营侧完整交接**（含待办排序与坐标）在私有文档 `/Users/yx/work/战略/AO交接总表-2026-08-22.md`。

## 一、视频步骤的三条硬纪律（仍然有效）

这是 AO 里唯一「本地进程没了、活还在服务商那边跑、钱照花」的步骤：

1. **轮询失败绝不能中断任务**——查询要包 try/catch，抖动只记一笔继续等到 deadline；所有出口用 `finally` 摘 `inFlight`；中断时把 task_id 打出来。下载也要重试。
2. **档位名各家不通用，绝不替用户猜**：秘塔 480p/512p/768P/2K、APIMart 720p/1080p/4k 且 VEO3 固定 8 秒。所以模板把 provider/model/resolution/duration 全做成必填输入；`video.*` 每个字符串字段都要过变量渲染，`duration` 还要 string→number 强转。
3. **端点靠探不靠抄**：零余额是好探针（存在回 402/400、不存在回 404），但**必须同时跑一条乱写路径作对照**，否则分不清真存在还是全站兜底。

回归测试：`test/video-step.ts`、`test/e2e-video.ts`（并发用例钉住了「秘塔查询端点忽略 task_id、必须客户端按 id 过滤」）。

## 二、两条互相独立的生效路径（重要）

| 路径 | 怎么生效 | 覆盖谁 |
|---|---|---|
| **官网部署**（改 `website/` push，Vercel 自动） | 远程清单 `website/public/providers-manifest.json` 被引擎启动时拉取（6h 缓存） | **所有已安装用户，包括还停在 0.12.1 的** |
| **npm / 桌面端发版** | 走 tag 触发的流水线 | 只有升级的用户 |

赞助商上/下架**三个面**现在都能走清单、不必发版：
- `removedProviders` → 从 Studio 供应商列表隐藏
- `relayPresets` → 增量上架 CLI 中转商
- `sponsorRotation` → 引导横幅轮换池（配了就整池替换，没配回退引擎内置）

**所以：赞助位的调整，push 官网就够了；代码修复才需要发 npm。**

## 三、各轮做完的事（按主题；越往下越旧）

### 2026-09 这一轮（#137–#185，49 个 PR）

逐条改动看 `CHANGELOG.md` 的 `[Unreleased]`，这里只记**为什么**：

- **这些活是"把产品当用户跑一遍"跑出来的，不是读代码读出来的。** 绝大多数缺陷在源码里看着都挺合理，是真跑一遍才现形的（存档目录建不了要等跑完才报、`--resume` 的"跳过 N 个"数不准、返工了却看不出被哪条逼的、画布删掉交付物就存不回去）。**接手后要找活干，先真跑几个工作流，别先通读 src/。**
- **`deliverables` 这一轮才真正贯通**：导出 / Studio 导出·复制·下载 / summary 的 ⭐ / `--compare` 的评判锚点，四处现在都只认交付物，草稿和评审笔记留在运行目录里不外溢。
- **`assert` 机械断言**（`core/assert.ts`）：模型审内容、脚本审结构。它的价值在**媒体工作流**——在按秒计费的视频步骤花钱**之前**拦住一个写坏的提示词。
- **验收/断言的返工过程现在留痕**：`verification.firstFailed`、步骤文件头部的徽章、Studio 的角标，都只在**真的返工过**时才出现（一次就过是常态，不是新闻）。
- **eval 那条线的结论被自己证伪过一次**，最终口径写在 `EVAL_FINDINGS.md` 和官网 `/evals`：强模型档位上多智能体与单次提问**打平**，赢的是"把验收标准写成数据"。**这个口径连同它的偏差说明（基线看不到验收标准）一起发布**——别在对外材料里把它简化成"多智能体更强"。
- **`CONTRIBUTING.md` 新增「交付物与验收怎么写」配方**，五条规则带正反例。以后有人提模板 PR，直接指这一节。

### 用户报的 issue
- **#102 Windows 下 CLI provider 全线调用不了** —— 已修、报告者确认"全部正常了"、issue 已关。根因是 `shell:true` 下 Node 把参数裸拼给 cmd.exe，提示词里的 `<system>` 被当重定向。修法见 `src/connectors/spawn-cli.ts`。
- **#103 / #94 自动组队产物报"依赖不存在的 step"** —— 已修（`autoFixDependsOnIds`）。模型把上游的 **output 变量名**当 step id 写进 `depends_on`，而旧修复链三个阶段谁都动不了它。
- **#101 历史管理 + 时区** —— 已修（分类/删除 + 按本地时区渲染，老记录一并修正）。
- **#99 Azure 推理模型** —— 已修并补了 13 条断言。
- 以上回复都已发到 issue 里；**#103/#101/#99 等发版后需要再补一句"npm 也已发布"**。

### 赞助商
- **AICodeMirror 上架**：CLI 中转预设（三个端点）+ **直连 API**（Anthropic 协议，引擎新增 `ANTHROPIC_PROVIDERS` 注册表）+ 赞助位（Studio 第 2 行首位 / 官网多元探索右边）。
- **LanoX AI 上架**（2026-08-13）：直连 API 走 OpenAI 兼容 `api.lanox.ai/v1`（内置 provider `lanox`，env `LANOX_API_KEY`）+ CLI 中转预设（claude-code 走根路径的 Anthropic 端点、codex 走 `/v1`；**没有 Gemini 端点，没探到就没填**）+ 赞助位**排最后**（两张列表都是）。**没给默认模型**——无 key 核实不了它实际上架的模型名，宁可让用户自选也不重演多元探索那次"默认模型平台没上架、一跑就报错"。
- **胜算云上架**（2026-08-14）：直连 API 走 OpenAI 兼容 `router.shengsuanyun.com/api/v1`（内置 provider `shengsuanyun`，env `SHENGSUANYUN_API_KEY`）+ CLI 中转预设**三个都有**（claude-code / gemini-cli 走 `/api`，codex 走 `/api/v1`）+ 赞助位**排最后**（LanoX 顺位后移，两张列表都改了）。两个坑：**主域 `api.shengsuanyun.com` 整站 404**，端点在 `router` 子域；**模型名带厂商前缀**（`anthropic/claude-sonnet-5`），少写前缀会 404。它跟 LanoX 相反——`GET /api/v1/models` 无需 key 就能拉，且每个模型自带 `support_apis` 与 `pricing`，所以协议支持和默认模型都是查出来的，不是猜的。
- **RootFlowAI、CCSub 下架**：摘掉赞助身份与曝光位，但**保留为可用供应商**——已配过 key 的用户照常显示、照常能跑。
- 轮换池现为 7 家均分（每家 2/7 天），且**已整池写进远程清单**——清单里配了就整池替换内置的，所以以后改轮换必须两处一起改（有测试逐条比对）。多元探索**按约定不进轮换**，它持有的是「默认 provider 位」。

### 一类反复出现的缺陷（值得记住）
新增能力之后，**围绕它的诊断/提示/隔离没跟上**，这一轮抓到 6 个，全部同源：
- `doctor` 探不到 claude 中转端点 → 已补
- Studio「测试连接」对 claude 硬编码打官方端点 → 已修
- 探测建议用户把 base 改成 `.../v1/messages`（照做就连不上）→ 已修
- 配 claude 直连中转会把 claude-code 订阅 CLI 一起改道 → 已修
- Studio 默认端点带 `/v1` 与 doctor 提示自相矛盾 → 已改
- 保存时静默改写用户 YAML 不告知 → 已改为回填 + 明示

**共同根因**：`ANTHROPIC_BASE_URL` 这一个变量名承载了两种语义完全不同的配置（直连 API 的中转 key vs 订阅 CLI 的登录态）。后续再加 Anthropic 协议供应商时，**必须各用各的 env 变量名**（已写成测试断言，见 `test/anthropic-providers.ts`）。

### 2026-08-14 追加：LanoX 上架 + 一次全接口巡检

- **LanoX AI 上架**（详见 CHANGELOG）。有三处是踩出来的、不看代码看不出来的：
  - 它的网关**对不存在的路径回 HTTP 200**，正文里才写 `"code":"404"`。引擎已能识别这种壳并自动改试 `/v1`（`endpoint.ts` 的 `isGatewayRouteMissShell`）——以后再遇到"某家配好了却什么都没生成"，先怀疑是不是又一家这么设计的网关。
  - 它的模型编码不跟通用命名（文档示例 `gpt-5.6-sol`），官方明说可用性以 `GET /v1/models` 为准 → **故意不给默认模型**，别照别家的名字补。
  - Claude 系走 Anthropic 原生端点（`/v1/messages`，实测 `x-api-key` 与 `Bearer` 都认），所以直连与编码 CLI 中转两条路都通；但它**没有 Gemini 端点**，中转预设里就不该有那一项。
- **一次全接口巡检**（脚本没进仓，逻辑已沉淀成 `test/web-server.ts` 的断言）：把 50 条路由逐条真打，5xx 清零。修掉的四处见 CHANGELOG「全接口巡检发现的三处」+ 坏 JSON 回 HTML。**巡检时务必隔离 `HOME`**——`claude/apply|repair|restore` 会写 `~/.claude`，不隔离就是拿自己的机器当靶子。
- **CI 曾经红了一个多月没人发现（8-07 → 8-14），现已转绿**。教训有两条，都值得记住：① `npm test` 用 `&&` 串联，**任何一个文件失败，后面的文件在 CI 上就等于不存在** —— 红着不修的代价是复利的；② 本地 macOS 默认卷**不区分大小写**，而 CI 是 ubuntu，凡是"造文件再按名字找"的测试都可能只在一边成立。要复现这类问题：`hdiutil create -size 20m -fs "Case-sensitive APFS" -volname CS /tmp/cs.dmg && hdiutil attach /tmp/cs.dmg`，然后 `TMPDIR=/Volumes/CS npm test`。
- **AO 现在会走代理了**（`src/utils/env-proxy.ts`）。三个坑写在这儿，省得下次重踩：① undici 的 `EnvHttpProxyAgent` **忽略显式传入的 httpProxy/httpsProxy、只认 process.env**，测试根本隔离不了，所以我们自己按 origin 路由；② `ProxyAgent` **对 http 目标也走 CONNECT 隧道**，写假代理必须处理 `connect` 事件，用 `http.createServer` 的 request 回调永远收不到，看着像"没接管"；③ 测试 URL 别用 9/19/25 这类端口，它们在 fetch 规范的 blocked ports 名单里，请求发都不发。**本机地址一律直连**是硬约束——Ollama、Studio 自身、整套测试的假端点都在 127.0.0.1。
- **第一方厂商只补五家，范围已定死**（Gemini / xAI Grok / Moonshot Kimi / 智谱 GLM / 通义千问）。对着 cc-switch 比对过，它还带 OpenRouter / 硅基流动 / MiniMax，Groq、Mistral 也都实测可用 —— **有意不加**：供应商列表同时是赞助商的货架，每多一条都在稀释曝光；长尾需求走「添加自定义供应商」。再有人提议加，先确认是商务决定而不是顺手补齐。
- **两条"写死的东西迟早说谎"已改为自己报警**：中转商卡片的"支持哪几个 CLI"改为按端点推导；文档站的 provider 数量与注册表比对（有断言，不一致就 CI 报红）。

### 2026-08-14 追加：文生图步骤（type: image）

- 落地形态见 CHANGELOG。三条决定值得记住：**task 即提示词**（不另设字段，用户中途确认过）；**image.model 必填不猜**；**协议 A（Images API）打不通自动降 B（Responses+工具）**——判定复用 isGatewayRouteMissShell，LanoX 那种 200 壳也认。
- ~~**创意库（/creative）加"一键生成"**~~ —— **已完成（2026-08-16）**。后端 `POST /api/image/generate` 是薄接口，直接调同一个 `generateImage()`（两种协议、报错口径全复用）。三处是踩出来的：① 下拉候选**必须由后端给**（`/api/config` 新增 `imageProviders`，按引擎 `resolveImageAccess` 口径算）——前端按 `family: "api"` 自己筛会把 `claude-code` / `gemini-cli` / `codex-cli` 也列进去，那一族在 `/api/config` 里就是 `api`；② `claude` 与 AICodeMirror 这类 **Anthropic 协议供应商有 base_url**，不显式拦就会去打 `api.anthropic.com/images/generations` 撞两次 404（已在引擎侧拦掉，见 CHANGELOG Fixed）；③ 演示站降级走的是"`/api/*` 落到 SPA 兜底回 HTML → `res.json()` 解析失败 → catch"，不是状态码——SPA 的 `_redirects` 是 `200`，按状态码判会得出"后端在线"的假结论。**运行中的 SSE 实时视图里图片仍显示不出来**（见下条）——那条边界没动。
- **执行器图片分支现在有自动化端到端了**（`test/e2e-image.ts`：in-process 真跑 run()，两种协议各一条）——upsert 那个 bug 当时就是从"单测全绿但链路断了"的缝里漏掉的，这类"数据从 node 传进 StepResult"的环节以后新增字段都该走这条。
- **运行中的实时视图（SSE）里图片显示不出来**是已知边界：相对引用的改写只发生在 GET /api/runs/:id（运行结束后的历史视图），直播流里拿到的还是 `assets/…` 相对路径，浏览器解析不了。跑完后在历史里看是好的。要修的话在 SSE done 事件带上 run dir 再改写，工作量不大但这轮没做。
- 已知边界（v1 故意不做）：`--resume` 跳过图片步骤时，新运行目录里没有旧图的字节，markdown 引用会指向旧目录（变量文本仍可用）；重跑该步则重新生成。metadata 只留 filename。

### 2026-08-17 追加：文生图真机验证（此前全是假上游）

**这条能力此前一张真图都没出过**——引擎单测、端到端、Studio 接口全部对着 `http.createServer` 的假上游测。这次拿真 key 跑通了，记下只有真机才知道的事：

- **LanoX 能出图，且两条路径都验过**：CLI（`ao run` 的 `type: image` 步骤，35s / 24s 两次）与 Studio 的 `/api/image/generate`（30s，创意库走的就是这条）。产物逐项核对无误：PNG 真文件（0.9–1.6MB）、`metadata.json` 零 base64 只留 filename、步骤 md 用 `../assets/`。它的图片模型是**实拉**出来的四个：`lanox-image-2`、`lanox-banana-2`、`gpt-image-2`、`gemini-3.1-flash-image`。
- **LanoX 的模型元数据说谎**：`GET /v1/models` 里这些图片模型的 `supported_endpoint_types` 只写了 `chat.completions / responses / messages`，**没有 images**；但实际 `POST /v1/images/generations` 是通的（无余额时回 402 而不是 404，有余额直接出图）。**端点靠探不靠读元数据**——与它当年那个"200 壳"同一类坑。
- **胜算云现阶段不能出图**：key 有效有余额（文本调通），`/v1/images/generations` 端点**存在**，但它 194 个模型**没有一个**支持该路径（错误原文 `model "X" does not support request path ...`）。所以创意库下拉里选它必然失败——报错已经能说清原因，但别指望它能出图。
- **`size` 是建议不是约束**（至少 LanoX/gpt-image-2 如此）：请求 `1024x1024`，回执自报 `1254x1254`；换成海报类提示词又给 1024x1536。引擎现在自己量 PNG 头并在不一致时说破（见 CHANGELOG）。
- 顺手核了写死的模型：胜算云的默认模型 `anthropic/claude-sonnet-5`、省钱模式降档的 `anthropic/claude-haiku-4.5`、以及 5 条 `modelSuggestions` **当前全部仍在架**。
- **装包冒烟做过了**：`npm pack` → 干净目录装 tgz → `ao roles`（267 个角色从捆绑依赖解析）/ `ao doctor --no-probe` / `ao web`（`/studio`、`/creative`、`/api/*` 全 200）。注意 **`npm pack` 打的是工作区**，未提交的改动也会进 tarball——拿它验"发布后的样子"时要意识到这点。

## 四、下一步建议顺序（2026-09-29）

按"先不花钱、再花钱"排。每条都写了**判断依据**，接手的人可以推翻，但别不看依据就推翻。

1. **合掉 PR #185（#183 验收误判）**，然后决定要不要发 0.20.0。#183 是用户报的真机 bug，踩中的是**默认 provider（deepseek-chat）+ 刚铺开的 acceptance** 这条默认路径——主干修好了，但用户机器上还是坏的，这是发版的直接理由。
2. **给 #183 的报告者回一句**（修法 + 会在哪个版本里），顺带问 #103/#94/#91 的报告者现在还复现吗。**别代维护者在第三方 issue 下发言**——拟好文字交给维护者发。
3. **#184 分诊**：包月 plan 类 API（tokenplan/codingplan）。先判断它是"某家中转商的端点没登记"还是"要新增一类计费模型"。前者是半天的活（照 `ao-sponsor-onboarding-checklist` 那套：端点靠探不靠抄），后者要先问清商务意图。
4. **继续补模板验收**（上面列的 8 个），照 `CONTRIBUTING.md` 的「交付物与验收怎么写」配方。**每补一个必须真跑一次确认第一次就过**；返工了就去 `metadata.json` 的 `verification.firstFailed` 看是被哪条逼的，把那条改掉而不是留着。
5. **两处体积取舍**（npm 34MB 官网前端 / 桌面 17MB 语言包）——需要的是产品决定，不是代码。
6. **Windows CI**：现在只有 ubuntu，而 #102 那次就是 Windows 独有的 bug。加一个 `windows-latest` 的 job 成本很低，但**必须先在本地原样预演**（见第五节 CI 那条）。
7. **`--compare` 第一阶段真正可中断**：现在中途取消只是不再等结果，单还在跑、钱照花。

### 历史建议（2026-08-25，均已完成或已过期）

1. **发版**（见第一节）→ 发完回 issue 补一句。**这是唯一还卡着的事**：官网侧全部已部署生效，引擎侧的修复要发版才到用户机器。
2. ~~push 官网~~ → 已完成（2026-08-14 前的所有改动均已 push，Vercel 自动部署，线上核对过）。
3. ~~#86 antigravity CLI 接入~~ —— **代码已完成**（provider `antigravity-cli`，见 CHANGELOG）。**唯一没做的是真机跑通**：本机没装 `agy`，而且它要 Google 账号交互登录一次。有账号的人请这样验：`curl -fsSL https://antigravity.google/cli/install.sh | bash` → 跑一次 `agy` 完成登录 → `ao run <工作流> --provider antigravity-cli`。若报错，先看 `agy -p "hi" --output-format text` 在终端裸跑是什么反应，再回来调参数拼装（`src/connectors/antigravity-cli.ts` 的 `buildAntigravityArgs`，有单测）。
4. ~~#93 / #96 / #90~~ —— 已于 2026-08-14 核实并关闭（镜像在 ghcr、文件读入在 Studio+CLI、`params:` 透传三处都实测在；三条都在已发布的 0.12.x 里）。
5. **#66 / #44 桌面端打包工程**（瘦身 / 签名公证）。

## 五、几个不要踩回去的坑

- **AICodeMirror 的域名**：官网/注册页是 `aicodemirror.ai`，**API 主机是 `aicodemirror.com`**；codex 端点走 `/api/codex/backend-api/codex`（官方订阅 backend 风格），不是 OpenAI 兼容的 `/v1`。
- **Anthropic 协议的 base 不要带 `/v1`**：SDK 和 claude CLI 自己会接 `/v1/messages`。
- **返利码只认自己的**（AICodeMirror 是 `XO5L7R`；LanoX 是 `?c=X3RD38F7&inviteCode=A3HRUB6M`，**两个参数都得带**）。从 cc-switch 抄端点时别把它的邀请码一起抄进来——已有守卫，跨三份清单比对，不一致就 CI 报红；注意守卫按参数名精确匹配且**大小写敏感**，新赞助商用了新参数名要往 `AFFILIATE_KEYS` 里加，否则等于没守。
- **LanoX 的网关对不存在的路径也回 HTTP 200**（响应体里才是 `"code":"404","codeMsg":"接口不存在"`）。探它的端点只看状态码会得出"哪儿都在"的假结论，必须看响应体。引擎已能识别这种壳并自动改试另一种 `/v1` 拼法（`endpoint.ts` 的 `isGatewayRouteMissShell`）——**以后再遇到"某家配好了却什么都没生成"，先想想是不是又一家这么设计的网关**。
- **LanoX 的模型名不跟通用命名**（文档示例是 `gpt-5.6-sol`），且官方明说可用性以 `GET /v1/models` 实时结果为准。所以它没有默认模型，也别照着别家的模型名给它配默认值。
- **下架赞助商 ≠ 删除供应商**：已配过 key 的用户必须还能看到、还能跑。
- **验证要确认打的是新进程**：改完 server 记得 `pkill` 干净，否则请求会打到旧进程，得到假结论（这一轮踩过一次）。

**2026-09 这一轮新增的（都是本地试不出来、或者只在"多想一步"时才看得见的）：**

- **改完一个字段，一定要顺着它往下游走一步**。这一轮最有价值的几个修复全是这么来的：给模板加了 `deliverables` → 才发现**画布里根本没有编辑这个字段的入口**，用户在画布上删掉那一步就再也存不回去（#168）；加了返工机制 → 才发现档案里看不出"是被哪条验收逼着返工的"（#170/#172/#176）。**只验证"我改的这条好使"是不够的**，要问"这条改动让谁的路走不通了"。
- **验收标准写歪了是负资产，不是中性的**。「每段不超过 5 行」看着很客观，其实取决于渲染宽度，真跑一次就触发了无谓返工；用户被假 ⚠️ 骗过两次之后就开始整体无视验收，那这个功能就等于没有。**宁可少写一条，不要写一条会误判的**。正反例已经写进 `CONTRIBUTING.md`。
- **裁判模型会自相矛盾，解析端必须兜住**（#183）：deepseek-chat 把四条**全部满足**的条目连同「满足此条」的说明一起塞进 `failed` 数组。提示词强化只能降低概率，**真正的闸在 `parseVerify`**。同理，以后凡是"让模型产出结构化字段给程序解析"的地方，都要按"它会写歪"来设计，别按"它会照做"设计。
- **测试 fixture 里指向死端口的 `llm` 必须显式写 `retry: 0` + 小 `timeout`**。本机 macOS 连不存在的端口立刻 ECONNREFUSED，GitHub 的 ubuntu runner 上是**静默丢包**，于是走默认超时阶梯 120s→180s→270s 再叠 retry，**一条测试能把 CI 挂 25 分钟且不报错**（#160 真撞到）。造"不可写目录"也别写死 `/proc/...`（只在 Linux 成立）——拿一个**普通文件**当父目录，`mkdir` 必 ENOTDIR，各平台一致。CI 卡住时用 `gh api repos/<owner>/<repo>/actions/jobs/<id>/logs` 拉日志看**最后一行**，那就是卡住的用例。
- **运行目录名要按字节截断，不是按字符**。Linux（Docker 镜像、NAS 部署）NAME_MAX 是 255 **字节**，86 个汉字的工作流名就会让 `mkdir` 抛 ENAMETOOLONG——而那时整条工作流已经跑完、钱已经花了，产物却存不下来。macOS 的 APFS 按字符算，本机永远试不出来。
- **`--resume` 是"按依赖重跑"，不是"从这一步往后重跑"**：`--from` 指定的步骤及其所有下游会重跑，与它无依赖关系的旁支沿用旧产出。想清楚再跟用户解释，别说成"从这里往后全重跑"。
- **`gh pr create --body "...里面有反引号..."` 会把反引号当命令执行**（踩过一次，在仓库里凭空生成了一堆文件）。一律用 `--body-file` + 引号包住的 heredoc。
- **别拿线上模板当测试夹具**：`test/run.ts` 曾用 `product-review.yaml` 断言"没有 deliverables 时返回 undefined"，后来给这个模板补了 deliverables，测试就红了。这类测试要自己生成临时 YAML。


## 六、验证手册（怎么快速自证没坏）

```bash
npm test                     # 全量 1650 断言 / 114 个测试文件（2026-09-29）
npx tsc --noEmit             # 引擎类型
cd website && npm run typecheck && npm run build   # 前端
npm run verify:release       # 发布门禁（CLI 命令齐全 + 前端产物完整）
node dist/cli.js doctor      # 本机环境自检（--no-probe 跳过实活探测）
```

起本地 Studio 看效果：

```bash
PORT=8088 AO_DATA_DIR=/tmp/ao-test node web/server.js   # 用临时数据目录，不碰你的真实配置
```

测中转类改动时，起一个假 Anthropic 端点比用真 key 更快也更安全：只需一个返回
`{id,type,role,content:[{type:'text',text:'ok'}],usage:{...}}` 的 HTTP server，
让 base 指向它，然后看它有没有收到 `POST <base>/v1/messages`。

## 七、测试口径说明

`npm test` 里各文件的汇总行有两种格式（`结果: X 通过` 与 `模板门禁: X 通过`），
统计脚本两种都要认——只认一种会把 `test/workflows.ts` 的 61 条算成 0，
误判成"零断言的空测试"（这一轮误判过一次）。
