# 工作交接：v0.13.0 之后这一轮做了什么、卡在哪、怎么接着干

> 更新时间：2026-08-14 ｜ 对应 HEAD：`bc902f0`
> 这份文档只记**从 git log 里看不出来的东西**：为什么这么做、哪些是有意的取舍、下一步该按什么顺序动。
> 具体改了哪些代码看 `CHANGELOG.md` 的 `[Unreleased]` 段和各条提交说明。

## 一、现在卡在哪（唯一阻塞）

**npm 上还是 `0.12.1`，本地已累积 23 个提交未发布。**

发布流水线（`.github/workflows/release.yml`，推 `v*` tag 触发）跑到最后一步失败：

```
npm error code EOTP
npm error This operation requires a one-time password from your authenticator.
```

仓库 Secret 里的 `NPM_TOKEN` 不是 Automation 类型，CI 里没人能输 2FA 验证码。**测试、构建、产物校验、打包全部通过，只死在这一步。**

两条解法（建议都做）：

1. **先把这版发出去**——本机已登录 npm（`jnmetacode`），在会话里输一行即可（`prepublishOnly` 会自动 build + build:studio + verify:release）：
   ```
   npm publish --otp=<你的6位码>
   ```
2. **一劳永逸**——npmjs → Access Tokens 新建 **Automation** token（专为 CI 设计，绕过 2FA），更新仓库 Secret `NPM_TOKEN`，然后重跑失败的 job：
   ```
   gh run rerun 31157163095 --failed --repo jnMetaCode/agency-orchestrator
   ```

> 注意：`v0.13.0` 和 `desktop-v0.4.2` 两个 tag 都指向 `fd3b7a7`，**在这一轮的大部分工作之前**。发布时要么把 tag 挪到当前 main，要么直接发 `v0.13.1` + `desktop-v0.4.3`。桌面端必须跟着发一版，Windows 用户才拿得到 #102 的修复。

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

## 三、这一轮做完的事（按主题）

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

## 四、下一步建议顺序

1. **发版**（见第一节）→ 发完回 issue 补一句。**这是唯一还卡着的事**：官网侧全部已部署生效，引擎侧的修复要发版才到用户机器。
2. ~~push 官网~~ → 已完成（2026-08-14 前的所有改动均已 push，Vercel 自动部署，线上核对过）。
3. **#86 antigravity CLI 接入** —— 唯一还没动的用户诉求，**且已变紧急**：Gemini CLI 于 2026-06-18 停服，Google 转 Antigravity CLI，我们的 `gemini-cli` provider 对新用户已是死入口。调研做完了，接入形态与现有 CLI provider 完全对得上（`spawn-cli` 那套）：
   - 二进制 `agy`（macOS/Linux `~/.local/bin/agy`，Windows `%LOCALAPPDATA%\agy\bin`）
   - 非交互 `agy -p "<提示词>"`（别名 `--print`/`--prompt`），`--output-format text|json|stream-json`
   - `--model <slug>`、`--effort low|medium|high`、`--print-timeout`（默认 5m）、`--dangerously-skip-permissions`、`--sandbox`
   - **鉴权走系统钥匙串里的缓存登录态，没有 API key 环境变量** → 属于"订阅制、免 key"那一类，与 claude-code 同款
   - 本机没装、且要 Google 账号交互登录一次，所以**实现可以照文档做 + 单测钉住参数拼装，但真跑一次必须由有账号的人来**
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

## 六、验证手册（怎么快速自证没坏）

```bash
npm test                     # 全量 860 断言 / 56 个测试文件
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
