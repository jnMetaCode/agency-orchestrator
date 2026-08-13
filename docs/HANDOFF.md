# 工作交接：v0.13.0 之后这一轮做了什么、卡在哪、怎么接着干

> 更新时间：2026-08-13 ｜ 对应 HEAD：`d76df55`
> 这份文档只记**从 git log 里看不出来的东西**：为什么这么做、哪些是有意的取舍、下一步该按什么顺序动。
> 具体改了哪些代码看 `CHANGELOG.md` 的 `[Unreleased]` 段和各条提交说明。

## 一、现在卡在哪（唯一阻塞）

**npm 上还是 `0.12.1`，本地已累积 16 个提交未发布。**

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
- **RootFlowAI、CCSub 下架**：摘掉赞助身份与曝光位，但**保留为可用供应商**——已配过 key 的用户照常显示、照常能跑。
- 轮换池现为 5 家均分（每家 2/5 天）。多元探索**按约定不进轮换**，它持有的是「默认 provider 位」。

### 一类反复出现的缺陷（值得记住）
新增能力之后，**围绕它的诊断/提示/隔离没跟上**，这一轮抓到 6 个，全部同源：
- `doctor` 探不到 claude 中转端点 → 已补
- Studio「测试连接」对 claude 硬编码打官方端点 → 已修
- 探测建议用户把 base 改成 `.../v1/messages`（照做就连不上）→ 已修
- 配 claude 直连中转会把 claude-code 订阅 CLI 一起改道 → 已修
- Studio 默认端点带 `/v1` 与 doctor 提示自相矛盾 → 已改
- 保存时静默改写用户 YAML 不告知 → 已改为回填 + 明示

**共同根因**：`ANTHROPIC_BASE_URL` 这一个变量名承载了两种语义完全不同的配置（直连 API 的中转 key vs 订阅 CLI 的登录态）。后续再加 Anthropic 协议供应商时，**必须各用各的 env 变量名**（已写成测试断言，见 `test/anthropic-providers.ts`）。

## 四、下一步建议顺序

1. **发版**（见第一节）→ 发完回 issue 补一句。
2. **push 官网** → 赞助位下架/上架立刻对所有用户生效。
3. **#86 antigravity CLI 接入** —— 唯一还没动的用户诉求，需要先摸清它的非交互参数和登录态复用。
4. **#93 / #96 / #90 可直接关闭** —— 0.12.0 已交付并回复过。
5. **#66 / #44 桌面端打包工程**（瘦身 / 签名公证）。

## 五、几个不要踩回去的坑

- **AICodeMirror 的域名**：官网/注册页是 `aicodemirror.ai`，**API 主机是 `aicodemirror.com`**；codex 端点走 `/api/codex/backend-api/codex`（官方订阅 backend 风格），不是 OpenAI 兼容的 `/v1`。
- **Anthropic 协议的 base 不要带 `/v1`**：SDK 和 claude CLI 自己会接 `/v1/messages`。
- **返利码只认自己的**（AICodeMirror 是 `XO5L7R`）。从 cc-switch 抄端点时别把它的邀请码一起抄进来——已有守卫，跨三份清单比对，不一致就 CI 报红。
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
