# Changelog

本项目采用 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Security
- **写进 `~/.claude/settings.json` 的中转 token 现在是 0600、原子写，备份也不再无限堆积**（与本轮 Codex 那条同类，
  只是这边装的是 API key）。此前：权限是默认的 0644（同机其他用户可读）；`writeFileSync` 先截断——中途崩了就剩个
  半截的 settings.json，而那正是「救 Claude Code」的那个文件，坏了之后 `ao doctor --fix` 自己也修不动；每次
  apply / repair / restore / 同步代理都留一份**凭证明文**备份，而没有任何地方清理（在 Studio 里来回切几次供应商，
  `~/.claude` 下就躺着十几份），且同一毫秒内的两次备份会互相覆盖。现在：备份撞名往后排、只留最近 5 份、同样 0600。
  顺带修掉一个本来就有的：机器上从没跑过 Claude Code（`~/.claude` 不存在）时，写入会直接 ENOENT。
- **`clearCodexRelay` 可能把用户的 Codex 登录态清空且无从恢复**：它整份重写 `~/.codex/config.toml` 与
  `auth.json`，却**一个备份都不留**（apply 那条是备份了的），而解析失败时又按「空文件」处理——手改坏过
  config.toml 的人点一下 Studio 的「切回官方」，配置连同 `auth.json` 里的 OAuth tokens 一起没了。
  现在：写回前先备份；读不懂就**当场停手**并说清楚（宁可不动，也不能覆盖成空的）；两个文件改成原子写 + 0600，
  备份副本（凭证明文）同样 0600。
- **Studio 可以上锁了：`AO_WEB_TOKEN`（默认不设，行为一个字节不变）**。Docker 镜像监听 `0.0.0.0`，同一内网里
  任何人打开就能用你保存的 API key 跑活、删运行、改配置——#109 的来源守卫挡的是「别的网页借用户的浏览器发请求」，
  挡不住直接访问的人。设了之后 `/api/*` 必须带 `Authorization: Bearer <令牌>` 或 `?token=<令牌>`；首次用带 `?token=`
  的链接打开一次，前端存进 **sessionStorage**（标签页关了就没了）并把它从地址栏抹掉（免得进截图和历史记录），
  之后自动带上。令牌比较用 `crypto.timingSafeEqual`。**监听在非回环地址却没设令牌时，启动会明确警告一次**。
  401 的提示直接告诉用户怎么带令牌，不泄露任何配置。
- **分享报告页加 CSP**（`report.html` 页内 `<meta>` + `/api/runs/:id/report` 响应头）：正文是模型产出经 marked 渲染的 HTML，
  没有净化——角色读过的资料、社区模板、抓来的网页都可能夹带 `<script>` / `onerror=`。这页此前被 Studio 以 **blob: URL**
  打开（继承 Studio 的源），脚本一跑就能以 Studio 的身份调 `/api/*`（开跑、删运行、改配置），绕过 #109 的来源守卫。
  现在 `default-src 'none'`（本页自己没有脚本，样式内联、媒体全是 data:），Studio 改为打开带该头的接口地址。
- **自动组队的 `name` 只取文件名**：Studio 表单传 `../../x` 会把生成的 YAML 写到工作流目录外。
- **Studio 服务端加请求来源守卫：别的网页再也碰不到 `/api`**。服务端默认只听 `127.0.0.1`，但「只听回环」挡不住浏览器——
  用户开着 Studio 时访问的任何网页都能往回环端口发请求。两条真实攻击面：① **DNS 重绑定**——恶意页把自己的域名改指到
  127.0.0.1，就和 Studio「同源」、能读响应；`/api/test-provider` 会把**已保存的 key** 发到请求里给的 baseUrl（合法用法：
  改了地址不用重填 key 就能测），于是等于把 key 寄给对方，`/api/claude/apply` 还能改写 `~/.claude/settings.json`。
  ② **跨站表单 POST**——`/api/claude/repair` / `restore` / `proxy/clear` 这类不需要请求体的端点，一个自动提交的 `<form>`
  就能触发，连预检都不需要。现在 `/api` 前挂一层守卫（`web/request-guard.js`，纯函数）：回环绑定下 Host 必须是回环名或在
  `AO_ALLOWED_HOSTS` 里；`Origin` 头存在时必须与 Host 同主机、或本身是回环（vite dev 代理）、或在白名单里；`Origin: null`
  拒绝。**非回环绑定（Docker / NAS）不强制 Host**——那里的用户常用 `nas.local`、反代域名访问，升级后全员 403 是更糟的结果；
  配了 `AO_ALLOWED_HOSTS` 才按白名单收紧。403 文案直接告诉合法用户该设哪个变量。
- **API key 不再出现在命令行参数里**。Studio 起 `ao run` 时把已保存的 key 作为 `--api-key sk-…` 传过去，于是它被
  `[run]` 日志原样打出（桌面版追加进 `engine.log`——用户贴日志报 bug 就把 key 贴出去了）、随 SSE `start` 事件显示在界面
  上、`ps` 也看得见。现在经子进程环境变量 `AO_API_KEY` 传（`ao run` 认它，与 `--api-key` 同义），只放进那个子进程的
  env。测试同时钉两头：整条 SSE 流里没有 key，而上游**照样收到**了 `Bearer <key>`。
- `GET /api/runs/:id` 补上与 assets / report 兄弟端点同一条路径守卫（`..%2F` 逃不出输出目录）；`web-keys.json`
  写成 0600，老的 0644 文件在下次保存时一并收紧。`test/request-guard.ts` 36 条。
- **生产依赖的已知漏洞 15 → 2**（`npm audit fix`，全部是 semver 兼容的小版本升级，只动 `package-lock.json`）：
  hono / @hono/node-server / path-to-regexp / qs / body-parser / fast-uri / ip-address / nanoid / smol-toml，以及
  **js-yaml 4.1.1 → 4.3.2**——`/api/workflows/save` 与社区模板导入会对不可信文本 `yaml.load`，这条最要紧。
  剩下两条没动：`image-size`（html-to-docx / pptxgenjs 的传递依赖，修复要跨大版本）与 `xlsx`（上游无修复版；
  AO 只在 `src/export/convert.ts` 里**写** xlsx、从不解析，暴露面小）。

### Added
- **验收返工成功后，第一轮是哪条没过会留在档案里，并显示出来**（`StepVerification.firstFailed`，仅返工过时有）：
  随 metadata 存档，步骤文件头/`summary.md` 那行徽章顺带点名（「验收 ✓（返工 1 轮后通过：不超过 200 字（超长））」，只带第一条），
  Studio 的徽标本身不变长、把未过项塞进 title。
  返工成功后 `failed` 被清空，事后翻档案只剩 `reworked: true`——而「是哪一条逼着它重写的」恰恰是模板作者唯一想知道的：
  一条**总是**触发返工的验收，等于每个用户的每次运行都多付一次调用。（本轮给模板补 `acceptance` 时，缺的就是它。）
- **`--compare` 的基线产出与评审结论会存档了**（`<运行目录>/compare.md`，并在 `ao report` 里单独成节）。对比是三段、
  每段都真花钱：跑工作流 → 跑单次基线 → 双向盲评。可它们此前只出现在终端里，窗口一滚就没，运行目录里一个字都没有——
  而终端还写着「完整产出见 ao-output」，那里根本没有。现在存的是：结论 + **基线用的完整提示词**（不然复现不了这次对比）
  + 两份完整产出；盲评前被取消（Studio 关掉浮层）时同样存，只写明「无结论」，不假装有。顺带：工作流没写 `description`
  时先警告一句——基线只能拿工作流名当任务目标（「短剧流水线」这种名字会让基线答偏），对比就不公平了，真机上评审给的
  理由正是「任务意图不明确」。
- **机械断言（`assert`）的结果进档案**：`metadata.json` 里多一个 `assertion`（与 acceptance 的 `verification` 同形状）、
  步骤文件头多一行 `📏 机械断言 ✓（返工 1 轮后达标）`、Studio 运行记录多一枚徽标。三处**都只在真返工过时才显示**——
  一次就过是常态，每步都挂一条只会刷屏。来由：`min_chars: "{{length}} * 0.7"` 把一步逼着重写了一轮，终端说得清清楚楚，
  跑完回头翻档案却一点痕迹都没有，而按字数返工在小说线是常态。
- **凭证也认 `~/.ao/.env`（用户级）**。优先级：**shell 环境变量 > `./.env`（项目级） > `~/.ao/.env`（用户级）**。
  `~/.ao` 本来就住着 teams / prompts / roles，唯独凭证只读当前目录——换个目录敲 `ao` 就「没凭证」，而 `ao doctor`
  里明明显示 Studio 已经配好（那份只注入 Studio 自己的进程）。`loadEnvFile` 本来就不覆盖已有值，所以老行为一个字节不变。
- **`ao validate --fix`**：就地改掉「`depends_on` 写成上游的**输出变量名**而不是 step id」这类错（#103 那一类）。
  Studio 存盘时早就自动修了，CLI 用户却只能照着报错手改——而这类产物往往十来步、报错好几条。复用 compose 那套
  同一个零歧义改写：对不上、有歧义、会成环的一律不动，宁可报错也不连错边；只动 `depends_on` 那一处，`task` 正文里
  同名的 `{{变量}}` 引用一个不碰；幂等。拿 #103 用户上传的真实文件实测：改 2 处、当场校验通过、只动了 1 行。
- **工作流 YAML 的 JSON Schema**（`schemas/workflow.schema.json`，随 npm 包发布，并经官网构建发布到
  `https://ao.aiolaola.com/schemas/workflow.schema.json`）：文件首行写
  `# yaml-language-server: $schema=…`，VS Code / JetBrains / Neovim 里就有字段补全、悬停说明和即时校验。来由：
  `depend_on`、`type: vidoe` 这类手误此前要么运行期才报、要么被**静默忽略**（多出来的键引擎根本不看）；同类项目里
  Kestra 靠这个把「写 YAML」的门槛降下来，而它是借鉴清单里成本最低的一项。按步骤类型分支校验（image / video / tts
  必填 model、tts 必填 voice、concat 必填 inputs、普通步骤必填 role + task），可模板化的数值字段（`video.duration`、
  `tts.speed`、`assert.min_chars`）同时接受 `"{{变量}}"`；`provider` 是开放字符串 + 候选（自定义中转不被标红）。
  `test/workflow-schema.ts` 钉三件事：43 个内置模板全部通过（schema 不比引擎更严）、引擎会拒的 13 种写法 schema
  也拒、provider 候选与注册表一致（新接供应商后跑 `node scripts/sync-schema-providers.mjs`）。
- **Studio「网络代理」设置**（#105）：供应商页新增一张卡，填一个 http/https 代理地址，保存即生效、重启仍在
  （`<数据目录>/.local/web-network.json`）。来由：AO 早就会走 `HTTP(S)_PROXY`，但那只对从终端启动的人有用——桌面版从
  Dock / 开始菜单点开，进程拿不到 shell 里 export 的变量，对那批用户「支持代理」等于不支持。保存的地址写进服务端进程的
  代理变量，三层一起生效：Studio 自己的请求（运行中重装 dispatcher，`reinstallEnvProxy`）、spawn 出的 `ao run`、再往下的
  编码 CLI。探到系统代理（macOS scutil / Windows 注册表，复用体检卡那套探测）时给「用这个」一键采用；配了但端口连不上
  （Clash 没开）时卡片自动展开报红，免得用户去挨个怀疑 key。只收 http / https：undici 的 ProxyAgent 不说 SOCKS，
  拒绝时指路「Clash / V2RayN 的混合端口就是 HTTP 代理」。地址里的账号密码只存本机文件（0600），任何回显都脱敏。
  启动环境里原本的代理变量：Studio 没配时照用、配了让位、清除后还原（不是变直连）。`test/proxy-setting.ts` 26 条
  （含变异验证过的「清掉代理后请求照常能发」——只清记忆化不换 dispatcher 会让 Studio 全线断网）、
  `test/web-network-proxy.ts` 14 条（起真服务端：重启仍在、脱敏、环境变量让位与还原）。
- **新模板「一人公司·方案到代码」**（`workflows/一人公司-方案到代码.yaml`）：老板简报 → PRD（带「不做清单」）→ 技术方案
  （受 `constraints` 输入约束）→ 按 PRD 和技术方案写代码（配 `--materialize`）→ 范围审查（逐项对照不做清单、功能、
  技术栈、数据模型，结论行「【范围一致】/【有偏差：N 项】」）。来由：真机演练把「一人公司·做产品」和「需求转项目脚手架」
  串着跑，后者只收一句话 idea、读不到前者的方案，结果形态、存储、状态都不同，还实现了 PRD 砍掉的功能。
- **`ao ledger`（人工介入账本）**：回答「这件事 AI 自己做了多少、人插手了多少」。`ao ledger add "做了什么"
  --reason unsupported|quality|judgment|external [--minutes N] [--step id] [--run 目录|last]` 手记工作流之外的
  人工操作（JSONL，默认 `<ao-output>/ledger.jsonl`，`AO_LEDGER_FILE` / `--file` 可改）；工作流里的
  `approval` / `human_input` 节点自动计为人工，不用手记。`ao ledger report [--since] [--until] [--out]` 按天汇总
  运行数、AI 完成步骤、人工节点、手记、人工分钟与 token，给出 AI 自主率 =
  AI 完成步骤 ÷（AI 完成步骤 + 人工节点 + 手记）——**按次数、不按工作量，不折算金额**，口径随报告输出。
  metadata 不记步骤 type：工作流文件还在时按文件认人工节点，不在时按「无角色且无产物」回退。`--resume` / `--feedback` 复用的步骤不计入（引擎给复用步骤写
  `reused: true`；旧档案按「0.0s + 0 token」识别），否则同一份工作会被算两遍、自主率虚高。`test/ledger.ts` 10 条。
- **工作流顶层 `deliverables: [step_id, …]`（交付物步骤）**。多步工作流里前几步往往是施工图（大纲 / 人设 /
  审读意见），只有最后一两步是用户要拿走的；此前 `--export docx`、Studio「导出 / 复制 / 下载 .md」把全部
  步骤按顺序拼进去，小说的 Word 前大半是创作笔记、正文排在最后。现在声明了就只取交付物：CLI `--export`、
  Studio 实时运行页（导出菜单里可切「含全部步骤」）、历史页「复制 / 下载结果」、`summary.md` 的 ⭐、
  `--compare` 盲评取的成品、MCP `run_workflow` 的返回、`--notify` 推送节选，同一份口径（`deliverableSteps`）。没写 = 旧口径（最后一个完成步），写错 id 校验期报错。
- **Claude API 连接器 max_tokens 自动续写**。`stop_reason=max_tokens` 时带着已写内容再请求（最多 3 次），
  与 OpenAI 兼容连接器同一口径；此前 Claude 直连 / Anthropic 协议中转下 3000 字以上的成稿会被**静默截断**
  还当作完成传给下游。`test/claude-continuation.ts` 10 条。
- **`assert.min_chars / max_chars`：按字数（非空白字符）的机械断言，可引用输入变量**。写作类模板说的"字数"
  是字不是字节（中文 1 字 = 3 字节，按字节配总会配错），而且目标字数是用户在输入框里选的——此前 `min_bytes`
  只能按最小档写死，选 5000 字也只兜 500 字的截断。现在可写 `min_chars: "{{length}} * 0.7"`，运行期按本次
  输入算；变量为空 → 该条跳过并告警（可选输入没填是合法状态，不让整步红）；写错变量名 / 乱写字符串在
  validate 期报错。Studio 画布原样往返（不白名单字段）。`test/assert.ts` +8 条。
- **新模板「中篇小说·分章创作」**（`workflows/novel-chapters.yaml`，12 步）：全书大纲与伏笔清单 → 人物圣经 →
  五章逐章执笔，每章读大纲、人物、**上一章全文**与「事实账本」（已确立事实 / 人物当前状态 / 伏笔账 /
  章末定格 / 下一章必须承接的），每章之后叙事学家更新账本 → 全书连贯性审校按章给意见与返工建议。
  `deliverables` = 五章正文，每章第一行自带 `## 第N章 章名`，导出即按序拼成书稿（导出时产出自带标题
  就不再套步骤名标题）；字数用 `min_chars/max_chars: "{{chapter_length}} * 0.7 / 1.5"`。引擎 `loop`
  每轮覆盖同一输出变量、上限 10 轮，攒不起章节，所以章数写死为五。
- **英文站小说模板**：`workflows/en/story-creation.yaml`（Short Story）与 `workflows/en/novel-chapters.yaml`（Novella in
  Chapters），英文 Studio 此前看不到任何小说模板。不是逐句翻译：字数按 **words** 给，`min_chars / max_chars` 数的是
  非空白字符，英文约 4.5 字符 / 词，所以写成 `"{{length}} * 3"`（≈ 目标 70%）/ `* 8`（≈ 170%）并在 YAML 里注明；
  章标题用 `## Chapter N: Title`；审校多一条"大纲自身的矛盾要指出并给出正文该怎么处理"（中文版真跑时审校自己挑出过这类问题）。

### Changed
- **旗舰模板补上 `deliverables` + 交付步的 `acceptance`，并附前后实测**。`compose` 的提示词一直教用户「至少给
  最终交付步骤写 `acceptance`」，可 `tech-blog` / `ai-opinion-article` / `product-review` 这三个最早的模板自己没写。
  同一模板、同一档位（claude-code 两侧）、同一主题，`--compare` 量的前后：**8.5 : 8.5 打平（低可信）→ 9.0 : 7.0
  多智能体胜（高可信，双向一致）**；两位盲评员的分歧点一致——基线的「延伸阅读」列了 4 条，不满足「列出 3 条」。
  另把首页/Studio 主推的四个 `featured`（一人公司-做产品 / 做内容 / 做投研 / 全员大会）与产出形态最固定的三个
  （小红书爆款笔记 / 抖音脚本 / 会议纪要——它们的 task 里本来就写死了输出结构，验收条目照着结构写即可）补齐：**「每个声明的交付物都写了 acceptance」的模板从 4 个涨到 14 个**（全库 70 个）。**每份 `acceptance`
  都真跑一次确认「第一次就过、不触发返工」**——会多花一次调用的验收是负资产；`ai-opinion` 第一版写的
  「每段不超过 5 行」既不客观（取决于渲染宽度）又真的多跑了一轮，删掉后才达标。剩下 57 个模板的交付步没有批量套，
  那需要一个个真跑才敢下判断。
- **`EVAL_FINDINGS.md`（官网 `/evals` 原样发布）补两条 09-25 的真机数据，并写清它自带的偏置**：
  `story-creation`（有 `deliverables` + `acceptance`）多智能体 **8.0 : 4.5** 双向一致；对照组 `tech-blog`
  （当时还没有 `acceptance`）**8.5 : 8.5** 打平且低可信。两条合起来读才是干净的结论——**强模型档上多智能体本身
  ≈ 打平（与本文件早先判断一致），差距来自「把验收写成数据」**；而基线从没看过那份验收标准，所以这个数字量的是
  「AO 这套用法值不值」，不是「多智能体天生更强」。英文版 `evals.en.md` 同步，免得线上两页说法不一致。
- **发版流水线的 npm 钉在 11 线**（`npm@^11.5.1`），不再 `npm@latest`。npm 12 已经发布，而它明确声明
  **不支持 Node 22.14**（要求 `^22.22.2 || ^24.15.0 || >=26`）——流水线只写了 `node-version: 22`，具体小版本
  由 runner 决定，发布路径不该同时押在两个都没钉的版本上。本地预演过：npm 11.20.0 对本包
  `publish --dry-run` 正常打包（2137 个文件），只在「该版本已发布」处停下，符合预期。
- README：模板数三处不一致（60+ / 32 / 12；英文 11 / 10 / 6）按磁盘实数改为 57 中文 + 13 英文；补「环境变量」一表
  （代码里约 40 个 `AO_*`，此前只文档了 7 个）；英文角色数 184 → 191。CONTRIBUTING 的「新增供应商」写的是
  `src/index.ts` 的 `run()`（并不在那儿）——改成按 API / CLI / 视频三类列出全部登记点，并补跑测试的说明。
- npm 包不再带官网预渲染的 SEO 页（`website/dist/creative/`、`experts/` 685 个 HTML、sitemap、百度验证文件）：
  本地 Studio 的这些路由由 SPA 回退渲染，同样的内容。解包体积 45.7MB → 40.9MB。
- **测试文件纳入类型检查**（`npm run typecheck:test`，`npm test` 与 CI 都先跑它）。`test/` 一直被 tsconfig 排除（避免进 dist），
  于是积了 43 个类型错误，其中两条测试因此是摆设：`verify-image` 给 `run()` 传了不存在的 `resume: 'last'`（被静默忽略，
  断言能过只因 feedback 路径容忍没有上一版产出），`providers-manifest` 拿**引擎**的供应商表按 `flagship / sponsor` 排序——
  引擎表根本没这两个字段，所有条目同 rank，「非赞助不排在赞助商前面」永远为真；改成从前端表抠字段后才真的在测。
  给测试 import 的三个纯 JS 模块补了最小 `.d.ts`。
- **「一人公司·做产品」加 `team`（团队规模）与 `timeline`（交付周期）输入**。默认「创始人 1 人 + AI 团队」「4 周」，
  老用法产出不变。真机演练里模板不知道只有一个人，启动包凭空写出工程师、PM，还要「暂停其他产品线」；现在简报、
  排期、启动包都受团队与周期约束，启动包验收加一条「负责人不超出团队范围」。周期 14 天以内按天排。
- **对外数字按源码统一**：README（中 / 英）与 `package.json` 描述改为「20+ 家 API · 10 种免 key 方式」，并写明口径——
  免 key = 9 个复用登录订阅的编码 CLI + 本地 Ollama，不含已停服的 Gemini CLI，DeepSeek Harness 需要 `DEEPSEEK_API_KEY`
  不计入。此前 README 写 15 / 11、`package.json` 与官网写 11 / 7，示例注释还把 gemini-cli、dsh-cli 列为免 key。
  `package.json` 角色数更正为 276 中文 + 191 英文（按角色库实数）。官网 `translations.ts` 的数字与卡片列表未改，待同步。
- **AICodeMirror 赞助下架（2026-09-14）**：摘掉官网赞助商卡片、Studio 赞助标识与置顶位、推广链接（返利参数
  `invitecode`）、编码 CLI 中转预设，以及 CLI 引导横幅轮换位（池子 7 → 6 家，每家份额回到 2/6）；远程清单同步
  `removedProviders`，老版本免升级生效。**保留为可用供应商**（Anthropic 协议，退到末位的已下架组）——已配过它
  key 的用户照常看得到、改得动、跑得通。同日上架 PackyCode。
- **「短篇小说创作」模板重写**（4 步 → 5 步）：结构步只出节拍表、明令不写成品句子（旧版"冲突场景"步已把
  对白和高潮段落写成了，执笔步只是照抄拼接）；人物步改为串行读结构（旧版与场景步并行、互相看不见，
  名字性格靠运气对上）；新增责任编辑审读（位置 → 问题 → 具体改法，最多 6 条 + 保留清单）与按意见定稿两步；
  两个成稿步挂 `acceptance` + `assert.min_bytes`；`max_tokens` 2048 → 8192；输入加 `label` / `options`
  （Studio 里风格、字数变下拉）；每步明令不输出"需要的话我可以…"（旧版把 Claude Code 的后续提议当素材传给了下游）；
  声明 `deliverables: [final_story]`。真跑 5 分钟 / 15k token，责编 6 条意见定稿全部落实。
- **短剧流水线：氛围锁定块 + 按类型的运镜节拍**（五段式方法论进短剧线）。新增 `atmosphere_lock` 步骤，
  全片只写一次「机身+镜头 / 色彩与影调 / 光源 / 颗粒风格核心」，三镜提示词与定妆图提示词**逐字粘贴**它——
  以前三镜并行各写各的氛围段，只能靠验收员事后挑"不一致"，一返工就是三条重来（上游
  ai-shortfilm-prompts 的 project-planner 把这叫"剪辑型作品崩色调的头号原因"）。`shortfilm-prompt` 技能
  新增「氛围锁定」规则与「按类型的默认运镜与节拍」表（剧情短剧 / 产品广告片 / 治愈日常 / 悬疑惊悚 /
  搞笑段子 / 科幻 / 古风武侠 / 纪实 Vlog），来源是上游的 genre-camera-sop 与各题材范例。
### Fixed
- **画布里删掉交付物那一步之后，保存被堵死**：模板顶层写了 `deliverables: [polish]`，用户在画布里把 polish 删掉再存，
  校验器报「顶层 deliverables 引用不存在的 step」→ 400 拒绝；而画布**根本没有编辑 `deliverables` 的入口**，
  于是在画布里怎么改都救不回来，只能去手改 YAML——而画布正是给不想碰 YAML 的人用的。现在服务端在校验前把指向
  已不存在步骤的交付物摘掉（全摘光就连键一起删，回到默认口径「最后一个完成的步骤」），并在保存提示里说清摘了哪个
  （中英都有），不闷着改用户的文件；交付物还在时一个字不动。
- **`--resume` 会拿旧产物充数**：两步工作流跑完后在中间插一步、把下游的 task 改成引用新变量，再 `--resume last` ——
  新步骤跑了，下游却因为「上次已完成」被整个跳过，交付物还是那份**没见过新步骤产出**的旧货，一个字都不提示。
  而「改完工作流再 resume」正是本项目主推的迭代方式。现在复用集合按依赖做闭包收缩：上游这轮会跑（新插的步骤、
  上次没跑成的、`--from` 点名的），下游的旧产物就作废、传递地收，并多打一行说清哪些因此要重跑。例外是上一轮按
  `condition` 跳过的上游不算「会重跑」——否则短剧流水线里常年为假的 `vo1/vo2/vo3` 会让 `film` 每次 resume 都重合成。
- **`--resume last` 会恢复到别条工作流的档案**：「last」取的是整个 `ao-output` 里最新的那个目录，不看是哪条工作流。
  设了 `AO_HOME` 或用桌面端（所有运行都落同一个数据目录）时这就是常态：轻则步骤 id 对不上整条白重跑，重则
  `--feedback` 把风马牛不相及的「上一版产出」递给专家让他「在此基础上改」。现在按工作流名前缀筛（与存档目录名同源，
  免得两份算法走偏）；这条工作流从没跑过时退回旧口径，但明确说一声。
- **`--resume` 的「跳过已完成步骤: N 个」会虚报**：改过 step id 之后，档案里那些已经不存在的名字照样被算进跳过数。
  留着不会出错（执行器按 id 查，查不到就是没跳过），但这个数字正是用户判断「那几条按秒计费的视频步骤到底复用了没有」
  的依据。现在只数当前工作流里真实存在的，并单独点名「上次运行里有 N 个步骤在当前工作流里已不存在」。
- **存档目录建不了要在开跑前就报**。它本来在跑完之后才建——于是「目录建不了」这件事要等整条工作流跑完（token 花了、
  按秒计费的视频也出了）才暴露，产物当场全丢。真机：MCP 宿主常以 `cwd=/` 启动服务，21.9 秒跑完后报
  `ENOENT: mkdir 'ao-output/…/steps'`，一个字都没留下。现在 0.0 秒报错，并给出换目录的办法。
- **MCP 的产物不再按 cwd 落盘**：宿主的 cwd 不由用户决定（Claude Desktop 一类常是 `/`）。没配
  `AO_OUTPUT_DIR` / `AO_WORKFLOWS_DIR` / `AO_HOME` 时，`run_workflow` 写 `~/.ao/ao-output`、`compose_workflow`
  写 `~/.ao/ao-workflows`（teams / prompts / roles 本来就住那儿）；显式配了照旧听用户的。
- **MCP 的 `run_workflow` 跑不成时按成功回**：它从不看 `result.success`。一条含 `approval` 的工作流经 MCP 跑
  （stdin 是 JSON-RPC 通道，只能当场拒），调用方拿到的是 `(no output)` + `Tokens: 0 in / 0 out`，没有 `isError`、
  没有哪一步失败、没有原因——另一个 agent 只会拿着这份空产出接着往下做。现在点名失败步骤与原因、列出跳过了哪些、
  标 `isError`，已完成部分的产出照给，两条路径都附上存档目录。
- **MCP 的 `compose_workflow` 在装了 CLI 的机器上反而跑不起来**：它硬编码兜底 `deepseek`，`provider` 枚举还是
  手抄的四个，CLI 类一个都选不了——于是同一台装了 claude-code 的机器上，`ao compose` 零配置能跑，经 MCP 调却报
  「缺少 API Key」。而 MCP 宿主（Claude Code / Claude Desktop）基本都是这种机器。现在与 CLI 共用同一套零配置选择。
- **运行目录名没有长度上限**：Linux（Docker 镜像、NAS 部署）`NAME_MAX = 255 字节`，86 个汉字的工作流名就超了，
  `mkdir` 抛 `ENAMETOOLONG`——而那时整条工作流已经跑完、钱已经花了。macOS 的 APFS 按**字符**算 255，本机试不出来
  （实测 200 个汉字照建）。现在按 UTF-8 字节截到 120 且不把汉字/emoji 切成半个。同一处还有两个入口：
  `~/.ao/teams/<名>.team.yaml`（实测 370 字节）、`~/.ao/prompts/<名>.prompt.json`（492 字节），一并截断。
- **输入名被某步的 `output` 遮蔽时，`{{变量}}` 的含义随 `concurrency` 变**：同一份 YAML、同样的输入，
  `concurrency: 3` 时某步拿到的是输入值，`concurrency: 1` 时拿到的是上一步的产出——而 `ao validate` 说「校验通过」。
  校验器里 `if (inputDef) continue` 排在最前，一个名字只要在 `inputs` 里出现过就不再查它是不是又被某个 step 当 output。
  现在只有在产出者下游（或本步就是产出者）时才算含义确定，否则报错并给两条改法。`condition` 字段同样覆盖——
  那是最恶心的变体：分支走不走取决于时序。
- **可分享报告里漏出步骤头**：`stripStepHeader` 只认单行头，而写了 `acceptance` 的步骤头部至少两行（验收标准、核验结果、
  断言返工）。于是这些步骤的整块头原样漏进报告正文——一段引用块里重复着报告页已经渲染过的角色名和耗时，后面还跟着一条
  `---`。`acceptance` 是主推功能，真实运行里一抓一大把。
- **`--export skill` 导出的技能装不上**：`name` 是中文（Claude Code 按 `~/.claude/skills/<id>/SKILL.md` 装，id 是 slug），
  `description` 是「由 Agency Orchestrator 多智能体协作生成的方法论 / 计划」这句所有导出都一样的套话——而
  description 正是模型**决定要不要加载这个技能**时唯一看得见的东西，等于白导。现在 name 转 ASCII slug（纯中文名退回
  `ao-skill`），description 取「工作流名 —— 正文第一句」，并在导出后直接打出两条安装命令。
- **盲评的尺子取错了步**：`--compare` 的第三段用工作流声明的 `acceptance` 当首要评分锚点，可它取的是「最后一个完成的
  步骤」，而产出取的是 `deliverables`——末尾挂着 review / 归档步时这两个不是同一步，等于拿甲的标准量乙的产出。
- **`deliverables` 写成输出变量名时不点破**：只报一句「引用不存在的 step」，而 `depends_on` 遇到同一种手误早就会
  告诉你该写哪个 id。现在也点破。
- **给用户照抄的路径不能照抄**：工作流不在当前目录下时，失败后的「从失败处继续」打出的是
  `ao run ../../../../../private/tmp/…/fail.yaml` 这种五层回退链，难读、易抄错，一 `cd` 就失效；路径含空格时粘过去
  直接裂成两个参数。现在 cwd 之外一律给绝对路径，含空白的整体加引号（只按空白判断，Windows 路径里的反斜杠不动）。
- **`--watch` 的框会被连接器插话糊掉**：框在 TTY 上靠「光标上移 N 行」原地重绘，而 CLI 连接器每 10 秒往 stderr 打一行
  「📡 已接收 xKB」——一步跑过 10 秒就会撞上。现在开框时让它闭嘴（非 TTY 不重绘，照打不误，那是唯一的活着信号）。
- **CLI 打错命令时的三种情况混成一种**：`ao "validate x.yaml"`（包装脚本或多包了层引号）被当成「少了空格」，按 slice
  拼出 `ao validate  x.yaml`（双空格，照抄还是错的）；`ao valdiate` 只甩一整页帮助，不指路。现在分开处理，拼写建议
  复用校验器里既有的编辑距离，八竿子打不着的照旧不瞎猜。
- **`ao prompt list` / `garden` 顶着一句 provider 探测结果**：它们只读 `~/.ao/prompts`，根本不调模型，却和
  `optimize`/`test` 共用同一段自动选 provider 的代码，于是管道里也多一行。
- **桌面安装包里带着纯构建期依赖**：`typescript`（23MB）+ `@types`（2.5MB）跟着每个平台的安装包发给每一个用户，
  而运行时一行都不 require。现在摘掉，并连同 `.bin/tsc`、`.bin/tsserver` 一起摘——只删目录不删软链会留下悬空链接、
  mac 打包当场失败（吃过一次）。新增 `scripts/verify-desktop-payload.mjs` 当发版闸：产物里不许有构建期依赖、
  `.bin` 不许有悬空软链。多语言角色库（约 17MB）**留着**——它是运行时功能（装了才出现在 Studio 角色库下拉里）。
- **`--notify` 的推送指不到确切那条运行**：末尾写「完整产出：ao report last」，而 cron 里同时跑好几条时 `last`
  指的是哪条说不清，收件人照抄反而打开了别人那份。现在有存档目录就报确切路径（含空格加引号）。
- **`--watch` 的框在中文标题下是歪的**：排版按 `String.length` 算，而中文每字占 2 列——实测同一次渲染里
  顶边 59 列、步骤行 36 列、底边 52 列。现在一律按显示宽度（CJK / 全角 / emoji 记 2 列）排版，标题过长也按显示
  宽度截断（以前 padLen 被 clamp 到 0，顶边直接撑出框外）。
- **桌面发版可能把「缺安装包」的版本标成 latest**：`fail-fast: false` + `fail_on_unmatched_files: false`
  + `make_latest: "true"` 凑在一起，某个平台挂了或 electron-builder 产物命名一变，官网对应平台的下载就静默 404。
  现在每个平台上传前先断言自己真的产出了安装包；并补上 tag ↔ `desktop/package.json` 的版本闸（npm 那条流水线
  早就有，这里一直没有——`desktop-v0.3.0` 可以发出一包在「关于」里自称 0.2.0 的安装包）。
- **存档时先把所有产物写完，再统一摘掉内存里的 base64**。以前是写一个摘一个：第 3 个写失败（盘满 / 目录只读 /
  文件名被文件系统拒绝）时，前两个的字节已经从内存里没了——而这些正是花过钱的产物，重试或兜底都救不回来。
- **Docker 镜像装上 ffmpeg**，并且 Dockerfile 现在**每个 PR 都构建一遍**（以前只在 `v*` tag 时构建，坏了要到
  发版当天、npm 已经发出去之后才知道）。`node:22-slim` 不带 ffmpeg，而 `type: concat` 硬依赖它——NAS 用户跑
  短片流水线时每条片子、每段配音都**先花完钱**，最后一步合成才失败，CLAUDE.md 里「付过钱的片子不能白费」
  那套规矩在容器里一直是落空的。CI 里加了一步 `docker run --entrypoint ffmpeg` 直接验它在不在。
- **同一秒跑完的两次同名工作流会互相覆盖**：运行目录时间戳只到秒，后一次把前一次的 `steps/*.md`、
  `summary.md`、`metadata.json` 盖掉，还留下前一次多出来的步骤文件成为混合体（Studio 允许并行跑，不是假想）。
  撞上就加后缀，绝不覆盖已有的运行。
- **版本比较把预发布排在同号正式版之前**：`isNewer('0.19.0-beta.1', '0.19.0')` 返回 true——跑 `@next` 的用户
  永远收不到「有正式版了」的提示，而一旦有预发布被推到 `latest` 标签，所有正式版用户都会被劝去「升级」到
  一个更旧的东西。
- **`--watch` 在非 TTY 下把光标转义码写进日志**：`ao run --watch 2> run.log` 会被 `\x1b[…A` 糊成一片。
  现在非 TTY 自动换成一行一条的纯文本进度（实测转义码 0 条）。
- **`{{x}} not contains y` 被当成 `contains` 求值，结果正好相反，而且一声不吭**。条件的左操作数是懒匹配，
  `not` 被吞进左边。真机后果：`condition: "{{qa}} not contains 失败"` 在 QA 报失败时**照样跑**那一步——
  如果它是 `type: video`，那就是按秒计费的钱。没有取反语法就当场报错，并告诉作者把分支反过来写。
- **条件的右操作数渲染后为空时恒真**：`"".includes("")` 是 true，于是引用了一个没填的可选输入的「有条件分支」
  每次都跑——可选配音的短片流水线里，那就是每条片子都出、都计费。空关键词按「没匹配上」算。
- **中文变量名静默不替换，而 `ao validate` 说「校验通过」**。渲染器只认 `{{\w+}}`（ASCII），写成 `{{主题}}` 时
  renderTemplate 原样留着、引用检查也看不见它——模型收到的是字面量 `{{主题}}`。对一个中文优先的产品，这是手写
  YAML 最容易踩、又最难自己发现的一种。现在输入名、`output` 名、以及 task 里任何非 `{{\w+}}` 的占位符都在校验期报错。
- **设了 `AO_WEB_TOKEN` 的 Docker 容器会被判 unhealthy**（本轮自己引入的回归）：镜像的 HEALTHCHECK 打
  `/api/health`，而令牌守卫连它一起挡。`/api/health` **有意**仍需令牌——前端正是靠这个 401 才显示
  「需要访问令牌」而不是误导成「没装引擎」；所以修的是健康检查：它现在带上容器里的 `AO_WEB_TOKEN`。
  没设令牌的部署（绝大多数）行为不变。`docker-compose.yml` 也把这个变量写进注释。
- **MCP 那一侧看不到媒体花费**：`plan_workflow` 以前只回 DAG，调用方（另一个 agent）看到一张干净的图就直接
  `run_workflow`，几条按秒计费的视频钱就这么花出去了，全程没人提过一句——而 CLI 的 `ao plan` 一直是报的。
  现在 `plan_workflow` 带上花费预览，`run_workflow` 跑完也回报产出了几个媒体、视频合计多少秒。
- **花费预览的「上限」不再只写在给人看的括号里**：`maxVideoSeconds` / `maxImageCount` 进结构字段，行文也从
  「合计 8 秒」改成「合计 8–16 秒（上限含验收重出）」。读结构字段的消费方（Studio、测试、将来的预算闸）
  以前拿到的一直是下限，而这个模块的规矩是宁可高估。
- **视频轮询「一直找不到自己这条」时会说出来**：查询回了一串任务但没有本次的 task_id，与「还在排队」在日志里
  长得一模一样，可前者是真故障（厂商改字段、id 精度丢失…），表现是干等到超时、报一句「最后状态：未知」，
  而那条片子其实已经出完、已经计费。连续 3 轮对不上就把列表里看到的 id 亮出来。
- **两个改写词库的脚本改成先写临时文件再原子改名**：直接原地重写一个 2MB 的 JSON，Ctrl-C 落在写入中间就把
  整个池子截断了。`translate-extra-titles.mjs` 另加每批超时（`AO_TRANSLATE_TIMEOUT_MS`，默认 180s）——
  一个没登录 / 卡住的 `claude` 会让脚本无声地挂住，而翻译上千条本来就要跑很久，没人会盯着看。
- **花费预览会少报循环里的媒体步骤**——而「先说清楚再花钱、宁可高估绝不低估」正是这个模块存在的意义。
  `summarizeMediaSpend` 只走一遍 steps，执行器却把循环体重跑到 `max_iterations` 轮：三条 8 秒镜头套一个 3 轮的
  循环，预览 24 秒、实际可能出 72 秒，而 `ao plan`、`ao run` 头部、Studio 的 SSE 全照抄这个数。现在按「back_to 的
  后代 ∩ 循环节点的祖先」（与执行器同一口径）识别循环体，条数与秒数按最多轮数算，行文写明「含循环最多 N 轮」。
- **退出时不再留下还在烧钱的引擎进程**。桌面版退出只 SIGTERM 了 `web/server.js`，而 POSIX 不会因为父进程退出就杀
  子进程——用户关掉 App，`ao run` 还在轮询按秒计费的视频任务、把片子下载到一个没人看的运行目录里，直到十分钟
  超时；下次开 App 又来一批。现在服务端收到 SIGTERM / SIGINT 先把 `activeRuns` 里的子进程一起带走（留 1.5 秒给
  引擎自己优雅存档，再补 SIGKILL），桌面壳也在 SIGTERM 之后补一记 SIGKILL 兜底。真进程测试钉住。
- **`openai-videos` 形状把公网 URL 首帧静默丢掉**：五个适配器里只有它没接 `imageUrl` 参数，于是
  `video: { image: "https://…" }` 出的是**纯文生视频**——按秒照付，片子跟要的首帧毫无关系。这家只吃图片字节，
  现在当场报错并指路（用本地路径或上游 `type: image` 步骤），且一个建任务请求都不发。
- **字幕样式里的滤镜元字符没转义全**：`force_style` 的值直接进 `-filter_complex`，此前只转义了 `\ : ,`，漏了
  滤镜图的 `; [ ] '`——`subtitle_style: { font: "My;Font" }` 就能让整条 filtergraph 解析失败，而那时**所有片子
  都已经出完、都付过钱了**。
- **社区视频提示词导入器用了 `\Z`**——JS 正则里没有这个锚点，它被当成字面量字母 Z：正文在第一个大写 Z 处截断
  （"Zoom in" 这种再常见不过），拿不到 `**Prompt:**` 就被 `continue` 悄悄丢掉，而且**每个文件的最后一节永远不匹配**。
  导入的池子一直是短的，没有任何日志说过。改成 `$(?![\s\S])`。
- **「vs 单次基线」对比：调用方断开后不再继续烧钱**。对比是三段、每段都真花钱（跑多智能体工作流 → 跑单次基线 →
  双向盲评）。它跑在**引擎进程内**（不像 `/api/run` 是 spawn 出来的子进程，可以直接 SIGTERM），用户刷新页面 /
  关标签之后照样跑完全程。现在 `compareWorkflowVsBaseline` 收一个 `shouldContinue()`，在段与段之间问一句，
  服务端用 `req.on('close')` 给答案：断开了就把还没开始的两段省掉，已经跑完的那段照常返回、照常存档
  （钱已经花了，产物别丢），`verdict` 给 null 而不是假装有结论。**关掉浮层不算断开**——请求由前端的结果缓存
  持有着，回头再打开仍能看到结论。第一段中途停不下来（要停得把 AbortSignal 穿透执行器与全部连接器，是另一个改动）。
  `test/compare-cancel.ts` 9 条，其中最要紧的一条是反向的：**没断开时后两段必须照跑**——`req.on('close')` 在 Node 里
  要是请求体读完就触发，对比会永远只跑第一段、永远没有结论，而且没人会立刻发现。
- **Studio 的弹层现在真的是「对话框」**。此前它们只是几个 `fixed inset-0` 的 div：读屏软件不知道这是对话框、也不知道
  它盖住了下面的内容；打开后焦点还留在背后的页面上，**Tab 会一路跑到被遮住的按钮上**；Esc 有的关有的不关。
  新增 `useDialog`（初始焦点 / Tab 陷阱 / Esc / 焦点归还，捕获阶段处理以免和组件自己的 window 监听打架），接进
  运行弹窗、运行查看器、画布、两个对比浮层、确认框、组队预览、供应商配置页，并统一加上
  `role="dialog" + aria-modal + aria-label`。无头浏览器实测：焦点落进弹层、Tab 不出圈、Esc 关闭。
  焦点归还有个诚实的边界——从工作流卡片打开运行弹窗时外层列表整块重渲染、原按钮节点已被替换，这种情况不假装还原。
- **英文站的工作流类目标题不再是中文**：类目名来自服务端映射表与 YAML 的 `category:`（都是中文），英文站上就露出
  「内容创作 / 其他」这样的标题。分组键仍用原始字符串（与服务端、YAML 同口径），只在显示时翻译；英文模板里写的
  `Content` 先归一到同一个键，免得同一类目在英文站裂成两组（`en/novel-chapters.yaml` 的 `category` 也随之改成 `Content`）。
- **Studio 又五处**：① 流式输出时的自动滚到底改成「用户本来就在底部附近」才滚——往回翻看前几步产出时，每来一个
  chunk 就被拽回底部，等于没法读；② 运行弹窗把必填**文本**输入也算进缺失（以前只拦媒体输入，Run 亮着、服务端把空值
  丢掉、引擎 spawn 之后才报「缺少必填输入」）；③ 换模型保存失败时只有 `finally`：下拉关掉、模型没变、一句话没有，
  下次运行还是旧模型；④ 导出下拉点外面 / 按 Esc 可关（捕获阶段处理，先于「Esc 关整个查看器」）；⑤ SSE 流正常结束却
  没收到 done / error（代理提前收口、服务端异常退出）时收口成失败，不再永远停在「运行中」转圈。
- **画布编辑器整块英文化**：33 处写死的中文（工具栏、节点编辑侧栏、机械检查说明、保存 / 报错文案）进 i18n，
  英文站不再半英半中。无头浏览器实开画布 + 节点侧栏核对过。
- **验收裁判把布尔写成字符串（`"pass": "true"`）时不再当成「核验不可用」**——两次都这样就静默跳过验收，
  而验收恰恰是给能力弱一点的模型兜底的。只认这两个确定写法，别的照旧判不可用。
- **文本验收的 token 预算按「推理模型先烧思考 token」给**（起步 500 → 1500，上限 2000 → 4000，与看图验收同一口径）。
  `verify_llm` 指到 deepseek-reasoner / o 系列时，500 的预算常常全花在思考上、可见内容 0 字符，连接器报
  「只返回了思考内容」→ verdict=null → **每一步的验收都被静默跳过**，只在 stderr 留一行。
- **`assert.contains` 里的 `{{变量}}` 现在会渲染**。不渲染就是拿字面量 `"{{title}}"` 去产出里找、必然找不到，
  而 assert 不过是硬失败（定向返工一轮后步骤红），用户完全看不出是断言自己写错了。渲染后为空则该条跳过并告警
  （留空串等于白写——空串永远「包含」）；`ao validate` 同时开始检查这些变量名。
- **导出 xlsx 不再因表名而整份失败**：SheetJS 拒绝含 `/ \ ? * [ ] :` 的表名和重名，而表名取自模型产出的小标题，
  「Q1/Q2 对比」这种再常见不过。现在净化 + 重名消歧。
- **`ao run --team` / Studio 锁定阵容对不上当前角色库时报错**，而不是**静默退回整库**——团队存的是中文角色却用
  `--lang en` 跑（或角色库改过名）时，「锁定阵容」的承诺当场作废还没人知道。部分缺失则进 warnings。
- **`-i docs=@dir` 跳过不是 UTF-8 的文件**（Windows 机器上的 GBK `.txt`/`.csv`）：以前原样解码成一片 U+FFFD
  塞给模型，占着 400KB 预算还可能被当成内容。现在点名跳过并给转码命令。
- **几处首跑体验**：缺输入现在在缺 key **之前**报（以前先建连接器，用户配好 key 再撞一次缺输入）；传了工作流没声明的
  `-i` 键（多半是拼错）会提示「未声明的输入: topci（该工作流的输入: topic, audience）」；变量拼错的报错带
  「你是不是想写 {{topic}}」（角色早有，变量一直没有）；`content-pipeline` / `product-review` 两个模板默认改成 DeepSeek
  （其余 55 个都是，英文版也是——只有这两个写死 `claude` + 一个 2025 年的模型号）；`provider: claude` 的默认模型收成
  `CLAUDE_DEFAULT_MODEL` 一处（此前四处各写一个过时号）；`ao demo` 文案还说「4 个角色 · 第二层并行」，实际是 5 步串行。
- **Studio「vs 单次」对比结果不再因关掉 overlay 而丢**：对比要跑完整工作流 + 基线 + 盲评（真金白银），服务端进程内跑、
  没法中途取消；以前关掉再打开会从头再跑一遍、上一次的结论也没了。现在同参数复用同一个请求，结论保留到页面刷新。
- **自动组队的幻觉角色替换只在有把握时做**。以前按任意子串命中 + 宽松编辑距离，对着真实角色库：`product/pm` 被替成
  `game-development/game-designer`（因为 develo**pm**ent），`engineering/ai` 替成 gis 的 geoai，`data/data-scientist`
  替成 gis 的 spatial-data-scientist——而且是在用户看不见的地方（Studio 直接开跑）。现在拆掉库里 leaf 重复带的
  category 前缀后比较，同 category 优先、只认整词命中；自动替换另有更高门槛（`confidentRoleMatch`：拼错一两个字母 /
  漏了前缀 / 目录写错），没把握的交给 LLM 修并附候选。`test/role-suggest.ts` 对着真角色库钉 11 个例子。
- **Studio 主包瘦身 395KB → 211KB**：画布连带 `@xyflow/react` + dagre 此前静态打进主包，改为打开画布时再加载。
  SSE 每个事件都触发整个 Studio 重渲染（一行输出两个事件 × 276 张角色卡）——合并到一帧里渲染一次。
- **Studio 七处交互缺陷**（前端体检，逐条对着代码核实）：① 有运行在跑时刷新 / 关页 / 点站外链接会无声杀掉它
  （服务端一见响应流断开就 SIGTERM，按秒计费的视频也一样）——现在浏览器先问「确定离开？」；② 一次 `/api/health`
  抖动就切到离线视图，把已填的任务、勾的角色整个卸载丢掉——改为连续 3 次失败才算离线；来源守卫的 403（用域名
  访问没设 `AO_ALLOWED_HOSTS`）此前显示成「没装引擎、去安装」，现在原样给服务端的指引（`getJSON` 也像 `postJSON`
  一样读 `{ error }`，不再只留 "403 Forbidden"）；③ 画布的执行态灯从来不亮：`useMemo` 只依赖被原地修改的同一个
  运行对象（与 RunViewer 同一个坑）；④ 点「停止」后绿色「已完成」徽章下面步骤还在转圈——改为标「已手动停止」、
  跑着的步骤标失败；请求本身挂了 / 引擎发 error 事件时同样收口；⑤ 运行弹窗在输入框里拖选文字、松手滑到遮罩外
  就关掉，填好的任务全丢——只有按下并松开都在遮罩上才算点遮罩；⑥ 人工输入提交失败后弹框消失、引擎却还在等
  stdin，这条运行只能挂着——失败时把弹框还回来；⑦ 快速切换运行历史时慢请求后到，把当前运行的详情覆盖成别的。
- **`ao <命令> --help` 只打印用法，不再执行命令**。此前 `--help` 被当成参数原样送进命令：`ao init --help` 真的下载 4MB
  角色库到当前目录，`ao demo --help` 在非 TTY 下自动选 provider **真跑**一条工作流，`ao run --help` 报 `ENOENT '--help'`。
  总帮助补齐了 `--feedback / --compare / --export / --materialize / --no-verify / --base-url / --api-key / --temperature`
  与 `install` 命令。
- **`ao run workflows/<名字>.yaml` 在任何目录都能找到随包的内置模板**——README 所有示例都这么写，但全局安装后它相对
  cwd 不存在，第一步就 ENOENT。找不到 / 传了目录现在说人话，不再抛 Node 的 ENOENT / EISDIR。
- README 里四个跑不通的示例改正（pr-review 的输入名、全员大会的步骤 id、不存在的「每日简报」模板、英文站
  `--materialize` 指向一个不产文件块的模板）。
- **自动组队：task 里嵌套的 ```json 示例不再把工作流截成一半**。围栏用懒匹配，在第一个内层围栏就收口——截出来的是一份
  **合法但少了后半截**的工作流，不报错、不告警，交付物那一步直接没了（真机复现）。现在只认顶格的围栏（块标量里的内容
  一定带缩进）。同一机制也吃掉 max_tokens 自动续写后的内容。
- **验收返工稿必须重新过机械断言**。`assert` 是硬闸，此前只查第一稿；验收不过触发的返工重写一遍，「必须包含 §结论」
  / `emits_files: 6` 完全可能丢掉，而返工稿不经断言直接成为产出、验收还标通过——正是 assert 要拦的「缺件绿灯」。
  返工稿断言不过 → 保留过了断言的第一稿、验收按未通过记录，也不再花一次复核。
- **`ao validate` 现在报拼错的字段**：`depend_on` / `outputs` / `acceptence` 此前被**静默忽略**——依赖没连上、验收没做，
  用户以为都生效了。键表取自随包的 JSON Schema（同一份给编辑器补全用），带「你是不是想写 …」。`depends_on` 写成单个
  字符串时规整成数组（以前按字符迭代，报 8 条「依赖不存在的 step: "r" / "e" / "s"…」）。
- **`ao validate` 还补了三条以前只有 `ao run` 才炸的检查**：`loop.back_to` 必须是依赖链上的祖先（自动组队的校验链此前放行，
  一跑才炸）；不认识的 provider 且没给 `base_url`（`plan` / `validate` 一路绿灯，`run` 报「暂不支持」），带拼写建议；
  循环依赖点名环上的步骤（此前只说「存在循环依赖」）。
- **自动组队把角色自动替换成了谁，现在进 warnings**：Studio 只拿得到 warnings（然后直接开跑），`console.log` 它看不见，
  替错了专家用户毫不知情。LLM 重试与二次修复的写盘同样补 `llm:` / `agents_dir:`（此前只有第一次写补，重试漏了就
  parse 抛「缺少 llm 配置」，后面每个 autoFix 都 fixed: 0）。
- **`-i docs=@dir` 不再跟符号链接绕圈**：一个 `sub/up -> ..` 就让两个文件被读成 66 份，400KB 上限全被重复填满、
  真正的资料反而报「总量已满」。改 `lstat` 跳过链接。
- **付费媒体产物不再只活在内存里，并发运行也不再互相清空**。图片 / 视频 / 配音此前要等整条运行结束才落盘——
  中途进程被杀（OOM / SIGKILL / 断电 / 合盖）就全没了，而按秒计费的视频要不回来。现在一生成就写进
  `<输出目录>/.inflight-media/<运行>-<pid>-<时间>/`，正常存档或中断存档后并入 `assets/` 并清掉暂存；下次跑带媒体
  步骤的工作流时，若发现上次没来得及存档的产物会点名提示（进程还活着的那份不算遗留；只提示、不替用户删）。
  同时登记表从模块级全局改成**每次运行一份**：同一进程里两条运行并发（MCP 的并行工具调用）时，后开始的那条在
  `run()` 开头一清空，先开始的那条引用上游图片就报「找不到图片」（`test/media-spool.ts` 用旧代码复现过原样报错）。
- **停止运行时，底层 CLI 子进程一起停**。Studio 点「停止」/ 关页面 / 终端 Ctrl-C 后，`ao run` 存档即退出，但它拉起的
  `claude -p` 不会跟着死（真机 `kill -TERM` 复现），会把这一步跑完、最长十分钟，白烧订阅额度。`spawn-cli.ts` 登记
  活着的子进程，中断处理与进程 `exit` 时统一终止。`test/cli-orphan.ts` 用真进程钉住。
- **重试分类先看报错里明说的状态码**。claude-code 的鉴权失败是「… API 错误: API Error: 401 …」，因含「API 错误」被一律
  当成服务端故障，按 CLI 退避 5/10/20/40/80s 重试五次——两分半钟后才告诉用户 key 不对；任何 400 只要正文带
  generate / moderate / separate（都含 "rate"）就被当成限速重试。现在 4xx 不重试、429 / 5xx / 408 照常；没有状态码时
  才用关键词，且 "rate" 收紧为 rate limit / too many requests / 限流等。`test/classify-error.ts` 26 条，两个方向都钉。
- **流式响应的两个边角不再丢内容**：`data:` 后没有空格（SSE 规范里空格可选，有的网关就这么发）时整条响应被丢、报
  「模型返回了空正文」；最后一行没有换行结尾时**悄悄少掉最后一个 chunk**。旧代码上两条都复现。
- **循环的两个边界**：`loop.back_to` 必须是依赖链上的祖先，不只是「更早的层级」——指向不相干旁支时回跳什么都不重置，
  循环空转到上限再报「循环达上限」，现在构建 DAG 时就拒绝；循环结束时 `_loop_iteration` 复位成 1 而不是删掉
  （validate 处处放行它，删掉后第二个循环的首轮会在运行期报「模板变量未定义」）。
- **Studio 取运行产物支持 Range、Content-Type 查表、流式发送**。没有 Range 时 Safari 的 `<video>` 不播、Chrome 拖不动
  进度条；配音 mp3 与 jpg / webp 此前都是 `octet-stream`；每次请求还会把几十 MB 的 mp4 同步读进内存。用
  `sendFile` 的 `root` 形式——直接给绝对路径的话，路径里任何一段以点开头都会 404，而默认数据目录正是 `~/.ao`
  （测试的数据目录故意放在 `.ao` 下，变异验证过）。
- **经 MCP 调用时 provider 不再只认三家 API**，且只换 provider 不给 model 时不再把 YAML 里别家的模型名原样带过去
  （与 `ao run --provider` 同一规则）。CLI provider 名单此前在 9 处各抄一份，收成 `providers/detect.ts` 的
  `CLI_PROVIDER_IDS` 一份，`test/detect-providers.ts` 钉住「别处不再有手抄副本」；「暂不支持 provider」报错里的内置
  列表也改成从注册表现取（手写版停在 claude / deepseek / openai）。
- **桌面端**：外链只放行 http(s) / mailto（模型产出与社区模板里的 `file://`、自定义协议链接不再能调起本机处理程序）；
  应用窗口自身的站外跳转被拦下改用系统浏览器打开（此前点到没带 `target=_blank` 的外链，Studio 就回不来了）；
  `engine.log` 超过 5MB 在启动时轮转成 `engine.log.1`。**未在真桌面包里启动验证过**，发 `desktop-v*` 前需预演。
- **非交互环境下跑到 `approval` / `human_input` 节点，运行不再永远挂死**。readline 的 `question` 回调在 stdin EOF 时
  永远不触发，进度计时器又让进程永不退出——cron / Docker / CI / `< /dev/null` 下，运行就挂在人工节点上一直打
  「gate ... 90s」，上游已经花钱跑完的步骤一个字不落盘，也没有任何报错（真机复现）。现在 stdin 在拿到回答前关闭 →
  这一步立刻失败、结果照常保存、提示 `--resume` 与 `-i` 预填。经 MCP 调用时（stdin 是 JSON-RPC 通道）人工节点
  连 readline 都不开（`AO_NON_INTERACTIVE=1`，`ao serve` 自动设）——否则会把下一条协议消息当成「用户的回答」吃掉。
- **`--resume last --from <循环步骤>` 回跳后循环体真的重跑**。调度时「resume 复用」判定排在「pending」之前：回跳把
  循环体重置成 pending 后，复用名单里的步骤又被标成复用、根本不执行——审稿步对着同一份旧稿审满 `max_iterations` 轮，
  白烧 token，最后报「循环达上限」。回跳时把循环体从复用名单里摘掉。
- **`timeout: 0`（不限时）在三个连接器里都不是不限时**。`config.timeout || 默认值` 把 0 吃成 600s（claude-code / 通用 CLI）
  和 300s（OpenAI 兼容 API）；而 executor 的注释与超时失败提示都在教用户「或 `--timeout 0` 不限时」。且因为
  `attemptTimeout` 为 0，重试不放宽，五次都死在同一个 600s 上。API 连接器不限时时仍保留停顿检测（对面彻底不吐数据
  仍要能失败）。`test/timeout-zero.ts` 9 条。
- **`--resume` 恢复产出时，带连字符的步骤 id 不再串文件**。按 `endsWith("-<id>.md")` 找文件，`review` 会先撞上
  `1-final-review.md`，把另一步的正文当成自己的产出回灌给下游，毫无报错。改成与落盘同一写法的精确文件名。
- **「视频 + 配音」的纯媒体工作流不再被「暂不支持 provider」挡死**。parser 早把 `tts` 算作媒体步，`run()` 判断要不要
  建文本连接器时漏了它：`llm.provider` 写视频供应商（秘塔）的短片工作流只要带一个配音步就跑不起来。
- **`ao validate` 现在查 `tts.*`、`concat.voiceover / subtitles / bgm` 里的变量名**。这些步骤排在付费的出图、出视频
  **之后**，变量名写错等到运行期才报「模板变量未定义」时钱已经花了（此前只查 image / video / concat.inputs）。
- **`concurrency` 必须是 ≥ 1 的整数**：负数会让分批循环永不结束、把事件循环饿死，Ctrl-C 都按不动。
- **Bedrock / Vertex 用户不再被体检误判成「被劫持」，`ao doctor --fix` 也不会删掉他们的模型配置**。走 AWS Bedrock /
  Google Vertex 的 Claude Code 用户没有 API key，模型 ID 就填在 `ANTHROPIC_MODEL` / `ANTHROPIC_SMALL_FAST_MODEL`
  这几个键里；而这几个键此前被一律当成「中转劫持」，导致体检报红、`--fix` 把用户配置删了（有备份，但要手动恢复）。
  现在只要检测到 `CLAUDE_CODE_USE_BEDROCK` / `CLAUDE_CODE_USE_VERTEX`（shell 或任一 settings 文件里），模型名键就按
  正当配置放行；凭据类键（`ANTHROPIC_AUTH_TOKEN` / `API_KEY` / `BASE_URL`）在任何模式下仍照查照删。豁免有边界：一旦
  存在 `ANTHROPIC_BASE_URL`（说明当前指着中转，Bedrock/Vertex 不用这个键），模型名键照旧清除，免得中转写进来的模型名
  在切回官方后继续生效。来由：用户留言问 Bedrock 模式怎么用 AO —— 答案是"直接用 `provider: claude-code`，环境变量原样
  透传"，但顺手发现体检会误伤他们
- **`--provider` 换成 CLI 类时不再把 YAML 的长超时压回 600s**。此前 `ao run --provider claude-code` 一律把超时写死成
  600s，YAML 里显式写的 `timeout` 被悄悄覆盖。真机：「一人公司·方案到代码」写代码一步要生成约 40 分钟，模板写了
  `timeout: 2700000`，仍在 600s、900s、1350s 连续超时重试，每次都从头生成。现在 600s 是下限：YAML 写得更长就用 YAML 的，
  写 0（不限时）保持 0，显式 `--timeout` 仍然优先，换成 API provider 行为不变。`run` 与 `--compare` 共用
  `src/core/llm-override.ts`。`test/llm-override.ts` 7 条。
- **claude-code 长输出不再只剩最后一段**（静默丢数据）。单段输出超过 Claude Code 的输出上限时，CLI 会自动续写成多轮，
  而 `--output-format json` 的 `result` 只装最后一段、`subtype` 仍是 `success`。真机：在「一人公司·方案到代码」里，
  写代码一步 89,221 个输出 token 只存下 58KB（正常步骤约 2 字节 / token，这一步 0.65），`package.json`、核心模块、
  服务端全部丢失，运行照样报成功。对照实验：把上限压到 300 token 让它从 1 写到 400——json 的 result 是 301–400，
  `stream-json --verbose` 三条 assistant 消息拼起来是完整的 1–400。现在 claude-code 走 `stream-json --verbose`，
  按顺序拼接全部 assistant 分段，usage / is_error 取 result 事件；CodeBuddy 的整段对话数组有多条 assistant 文本时
  同样拼接（CodeBuddy 仍用 json，未实测）。修复后用真实 claude 重跑同一实验：拿到连续的 1–400；在真实工作流里
  重跑写代码一步：100,632 个输出 token 一次跑完，落盘 50 个文件，生成项目 `npm test` 96/96、`npm run build` 通过。
  `test/claude-code-stream.ts` 6 条（含假 CLI 端到端）。
- **循环轮数用完、退出条件仍未满足时不再静默**。此前 `loop.max_iterations` 耗尽后运行照样报「成功」，产出是最后一轮的
  结果却看不出没过条件——「写 → 审 → 改」流水线里，没过审的稿子会被当成过审的。现在结束时 stderr 打出
  `⚠️ <step> 循环已达上限 N 轮，退出条件仍未满足（…）——产出是最后一轮的结果，没有通过该条件`；条件满足而退出时不打。
  运行状态不变（上限退出仍不算失败）。终端警告会被刷走、Studio 看不到，所以同时在该步结果上标 `loopExhausted: true`，
  写入 `metadata.json`，summary 里加「⚠️ 循环达上限，退出条件未满足」。`test/e2e-loop.ts` 补正反断言。
- **循环重跑的 token 与执行次数不再被最后一轮覆盖**。步骤结果按 id upsert，循环回跳重跑 `back_to` 到循环节点之间的
  步骤时，前几轮的 token 被覆盖丢掉——`totalTokens`、summary、MCP 返回、Studio 用量统计全部**少报**；`iterations`
  也只记在带 `loop` 的那一步，被拉回重跑的步骤显示为 1 次。现在执行器按步骤累计真实执行次数与 token：
  `StepResult.tokens` 为各轮合计，`iterations` 为真实次数（>1 才写），并写进 `metadata.json`；`ao ledger` 按次数计 AI 步骤
  （旧档案无该字段按 1 次）。`test/e2e-loop.ts` 断言回跳步骤次数与 token 累计。
- **claude-code / codebuddy 不再把用户本机的项目记忆带进角色产出**。`claude -p` 按启动目录自动加载
  `~/.claude/projects/<cwd>/memory` 和 CLAUDE.md，`--tools ""` 关不掉它。真机：在 AO 仓库里跑「一人公司·做产品」，
  用户私有记忆里的项目名写进了启动包——别人复现不了，`ao report` 分享页还会带出私有信息。金丝雀验证：
  临时项目的 CLAUDE.md 放一个随机暗号，在该目录启动（旧行为）原样说出暗号，在空临时目录启动回答 NONE。现在每次调用在空临时目录里启动、跑完删除；需要旧行为设
  `AO_CLI_INHERIT_CWD=1`。没用 `--bare`：它不读钥匙串 / OAuth，订阅登录用户会不可用。`test/claude-code-cwd.ts`
  用假 CLI 钉住。其他 CLI provider（codex / gemini 等，会读 AGENTS.md / GEMINI.md）未改，待验证。
- **中转网关「分组下无可用渠道」被当成上游故障白白重试**。new-api 系网关（PackyCode 等）对令牌分组里没开的模型回
  `503 + model_not_found`「分组 default 下模型 X 无可用渠道」——状态码像临时故障，其实是账号配置问题。此前按 5xx
  重试 5 次（真 key 实测白等 43 秒），提示还叫人"稍后重试或换一家"。现在不重试、立即失败（2 秒），提示直接说清：
  去中转商控制台给令牌换一个包含该模型的分组，或换成该分组下能用的模型。普通 5xx / 429 / 断连照旧重试。
- **Studio 运行视图：看着运行跑完，底栏「复制 / 下载 .md / 导出」整组按钮不出现**（要关掉再打开才有）。
  `RunViewer` 用 `useMemo(…, [run])` 缓存导出文本，而 `RunManager` 原地改同一个运行对象再强制重渲染，
  引用从头到尾不变——缓存停在"刚开跑、内容全空"那一刻。此前就有，新加的交付物计算照抄了同一写法也跟着失效；
  改为每次渲染直接算。无头 Chrome 真跑验证：默认只含定稿、切「含全部步骤」含步骤标题、切回一致、Word 有效（14/14）。
- **Claude Code / CodeBuddy 输出首尾混进 `</thinking_mode>` 这类控制标签**：真跑时定稿第一行就是它，原样进了交付物
  和导出的 Word。现在剥掉**首尾独占一行**的无属性 snake_case 标签或 `<thinking>`；行内、中间行、代码块、普通 HTML 不动。
  `test/codebuddy-cli.ts` +2 条。
- **Studio 把失败的运行显示成「已完成」**：服务端解析 `ao run` 输出时没有「失败: …」「跳过 (…)」「部分失败: n/m 步」
  三种行的规则，全被当成上一步的正文——失败步骤打绿勾、下面挂一段报错"正文"，整次运行因为"有内容"判成已完成、
  通知报成功、导出的 md 带着报错（撞 Claude Code 会话额度时真机看到）；单角色咨询同病。解析规则抽成纯函数
  `web/run-output-parser.js`（按缩进区分状态行 2 格 / 正文 4 格，正文里写着"失败:"不误判），新增 step-failed /
  step-skipped 事件；步骤显示红叉 +「这一步失败了：原因」/「已跳过」，有步骤失败整次标「出错」并列出原因，画布节点变红。
  另两处真机才看得到的形态也接住了：失败原因常是多行（"请求失败: <url>" 后面跟 "fetch failed / 可能原因 / 走了代理"，
  有用的在后几行），续行并进同一步的原因；**因上游失败被跳过的步骤不打印步骤结果**，只在汇总尾部
  "⏭️ 跳过 N 步: b, c" 出现一次，以前它们在 Studio 里永远停在"待运行"。
  `test/run-output-parser.ts` 9 条，**用真 reporter 的 printStepResult / printSummary 打出来的文本喂解析器**，
  打印格式一漂移当场红。
- **英文运行的验收结果在 Studio 里认不出**：reporter 对英文步骤打的是 `Acceptance ✓` / `Acceptance ⚠️ 2 unmet`，
  解析器和步骤徽章只认中文「验收」——未满足条目整段掉进步骤正文、彩色徽章不出现。加英文模板时真跑撞见。
  两处都认两种写法；`test/run-output-parser.ts` +2 条（中 / 英各一），拿修复前的解析器跑同一套测试英文那条确实红。
- **系统睡眠打断的调用不再按"超时"放宽空等**：英文中篇的连贯性审校跑到一半 Mac 进了睡眠（pmset 日志证实整夜
  Sleep / DarkWake），Claude Code 的请求被冻住，引擎按普通超时 600→900→1350s 放宽重试，两次运行各白等约 95 分钟，
  失败提示还建议"增大超时"。醒着重跑同一步 121s 就过。现在每次调用期间比较墙钟与单调时钟（睡眠时前者照走、后者停），
  睡过 ≥60s 立即放弃这次等待并重试——**不占 retry 名额、不放宽 timeout**，封顶 3 次（整夜"睡—暗唤醒—再睡"不空转，
  直接失败留给醒着时 `--resume`）；失败说明换成"睡眠了约 N 分钟，增大超时没有用"，macOS 附 `caffeinate -i` 用法。
  只作用于文本模型调用，按秒计费的视频任务不动。`test/sleep-retry.ts` 16 条（假 watcher 触发"睡了一觉"）。

## [0.19.2] - 2026-09-02

### Added
- **DeepSeek Harness 接入 `dsh-cli`**（开发者预览，官方明说会有破坏性变更，Studio 卡片带此标注）：`dsh --profile headless "<任务>"`，stdout 就是答案、推理在 stderr。真机（@deepseek-ai/dsh 0.1.1-rc.2）：**不读 stdin**，整段提示词走位置参数（23KB 可）；需要 **Node ≥ 22.15**，22.14 会在加载插件时崩、报错埋在堆栈里，AO 从 stderr 识别后翻译成人话；`model` 写 `provider/model` 时用 `--patch` 临时覆盖默认模型；每次在空临时目录里跑（它把当前目录当工作区且没有关工具开关）。基类新增 `spawnCwd` / `stderrHint` 两个通用口子。新增 `integrations/deepseek-harness/`。
- **OpenCode CLI 接入 `opencode-cli`**：用 OpenCode 里配好的供应商（`opencode auth login` / opencode.json）跑工作流。真机（opencode 1.18.27）：`opencode run --format json` 是 NDJSON、答案是 text 事件拼接；**stdin 写完必须关**——管道不关它会一直等（4 分钟都不退），写入并 end() 后它把内容并进消息，长角色提示词走 stdin 可行；`-m` 要写 `provider/model`；没有关工具开关，AO 用 `--dir` 指空临时目录兜底。OpenCode 至此三个维度齐全（供应商 / 角色安装目标 / 指南）。
- **Cline CLI 接入 `cline-cli`**：用 Cline 里 `cline auth` 配好的供应商/账号跑工作流，AO 不另配 key。真机（cline 3.0.61）钉住三件事：`--json` 是 NDJSON、只有 `run_result.text` 是答案；它**不读 AO 送进 stdin 的内容**（只认真 FIFO，Node 的管道是 socket），所以角色走 `-s`、任务走位置参数，超命令行上限明确报错；纯中文无空格的提示词会被它当"未知命令"拒绝，AO 自动补空格。它是 agentic 工具且没有关工具的开关，AO 每次把它的工作目录指到空临时目录、跑完即删，模型想写文件也落不到用户项目；`-t` 与 AO 单步超时对齐。角色**不**装进 Cline（`.clinerules` 是全局注入不是可选角色）。新增 `integrations/cline/`。
- **Cherry Studio 接入指南** `integrations/cherry-studio/`：它没有 CLI，不做连接器；其 API 网关把 Cherry 里配好的模型服务转成本机 OpenAI 兼容接口，AO 按自定义 OpenAI 兼容供应商接入即可。事实来自官方文档，本机没装、未真机跑，指南里写明。
- **腾讯 WorkBuddy / CodeBuddy 接入（两条线）**。① 免 key 供应商 `codebuddy-cli`：直接用 WorkBuddy / CodeBuddy 会员额度跑工作流；macOS 装了 WorkBuddy 桌面版就自带（CLI 埋在 app 内不进 PATH，AO 自动到那里找，`ao doctor` 与真跑用同一份路径表），否则 `npm i -g @tencent-ai/codebuddy-code`。命令行形态与 Claude Code 逐项对齐，复用同一连接器；唯一差异是 JSON 输出是整段对话的数组、末元素才是 result——按单对象读会误报"返回空内容"，已兼容并钉了测试。② `ao install --tool workbuddy`（`~/.workbuddy/agents`）/ `--tool codebuddy`（`~/.codebuddy/agents`，尊重 `CODEBUDDY_CONFIG_DIR`）把 276 个角色装成子智能体，frontmatter 同格式零转换，按 `name` 点名即用（实测装完不用重启）。真机验证：WorkBuddy 5.1.7 / codebuddy 2.103.3，两步工作流跑通。新增 `integrations/workbuddy/`。Windows / Linux 桌面版打包位置没实证，不猜，走 npm 安装。
- **本地视频供应商 `local-sdcpp`**：用本机 stable-diffusion.cpp 的 `sd-cli` 跑 MiniMax-H3 GGUF 出片（`minimax-h3-q2 / q3 / q4`，按统一内存 24 / 32 / 64 GB 分档），不联网、不要 key、不花钱——花费预览标「本机 sd.cpp，不花钱」且不计入按秒合计。定位是**草稿档**（M2 Max 32 GB 实测 640×384 / 39 帧 / 4 步 216 s，2-bit 画质），成片仍走云端。引擎不自动下 27 GB 权重：缺文件时报确切的 `curl -C -` 命令和许可证提醒；`ao doctor` 报就绪状态；Studio 的视频供应商列表把它当"已配置"的条件是 sd-cli 在 + 一档模型齐全。帧数就近对齐 H3 的 `17k+5` 网格、宽高对齐 32、`--cfg-scale 1.0` 固定；有首帧图走 `--init-img`。`test/local-sdcpp.ts` 12 条（假 sd-cli 走通 webm→mp4 主流程）。来由：OpenShorts · 开片的"本地草稿 / 云端成片"两档，见其 docs/v2 ADR-004。

- **`-i docs=@目录`：目录当知识源**。此前 `@` 只能指向单个文件，要给专家喂一叠资料得自己先拼。现在指向目录即可：文本类文件（md / txt / csv / json / yaml / html / 常见源码）按相对路径排序、每个文件一节 `## 文件: <路径>`，模型能按文件引用；跳过 .git / node_modules / 隐藏目录 / 二进制；pdf / docx 这类需要转换的**明确列出并告警**（先 `pandoc -t markdown` 转成 md），不是静默漏掉；总量 400KB / 单文件 200KB 上限，超了按顺序截断并告警列出没装下的——把 5MB 塞进 prompt 只会换来一次超长失败，而且用户会以为模型"读过了"。Studio 一如既往不展开 `@`（安全开关不变）。

- **新增工作流模板「高管会：重大决策」**（`workflows/strategy/exec-committee.yaml`）：CEO 先把议题压成可裁决的命题（含可逆性与可观测判据）并**点名谁上会**，未被点名的高管由 `condition` 跳过、一个 token 都不花；出席者第一行强制表态并写明红线；幕僚长只做收敛（真分歧 / 假分歧 / 待补事实 / 互斥选项，**不给推荐**，否则 CEO 那步退化成复读）；CEO 拍板必须写出「我否掉了谁、为什么」。来由是同议题同模型的对照实验：把同一道题原样发给 7 个角色再汇总要 72,614 token，7 人里只有 2 人明确表态、最终纪要 0 人被否，且 CMO 在自陈「这不是增长账」之后仍写了 2400 字成本分析（成本类词频排第二）——角色提示词约束语气不约束信息源；点名版 47,922 token（少 34%），出席者全部表态、CEO 明确否掉 COO 并给出理由。出席标签用纯 ASCII `ATTEND-<角色>` 且匹配不带括号：最初的 `[上会:CFO]` 在全角冒号 / 全角方括号 / 多一个空格三种写法下都会让全员跳过（framing 上的 `assert` 会让它响亮失败而非开一场没人的会）。收敛步用 `depends_on_mode: any_completed`——默认「任一依赖跳过则自己跳过」会让缺席一人就散会。

### Changed
- **创意库扩充池按分类懒加载**：此前「再加载」一次拉整池 1282 条（2MB，gzip 后 ~640KB），只想看「海报」的访客也得全下。现在构建前按分类切成 11 片（`scripts/split-creative-extra.mjs`，派生文件不进仓库），点分类 chip 只拉那一类（几十 KB 到 0.5MB），chip 上标 `+N` 提示可加载数量；只存在于扩充池的分类（美食 / UI / 游戏…）也提前露出；「全部加载」仍在。默认视图置顶三张精选卡。

### Fixed
- **视觉验收一炮失败不再直接跳过**。验收员是 agnes-2.0-flash 这类模型时（限速 6 次/分 +
  推理先烧思考 token），一次 429 就被"核验出错"静默跳过——同一次短剧运行里 shot2 验收 ✓、
  shot1/shot3 被跳过（step tokens 记 0），而视觉验收看守的正是按秒计费的产出。现在：
  限速类异常退避 12s 重试一次、其余立即重试一次，两次都败才跳过且**告警带真实原因**；
  max_tokens 预算从 min(2000, 500+len) 提到 min(4000, 1500+len)，推理模型不再"只想不写"。
  只动视觉核验，文本核验"失败不重试"的取舍不变。（OpenShorts 短剧线真跑撞出）
  发版前审查再收两针：瞬时重试与"逼纯 JSON"升级解耦（一次 429 不再吃掉升级重试、
  模型不再无辜挨训话提示词）；cline-cli 的命令行长度报错与判定统一用同一段同一把尺
  （中英混排时以前报出来的 KB 可能是没超限那段的，照着裁数字不动）。
- **`--resume --from <步骤>` 只重跑该步及其下游，同层兄弟一律复用**。此前按 DAG 层级跳过，`--from shot3` 会把同层的 shot1/shot2 一起重新出片——云端白花两条片的钱，本地白等 8 分钟（真机撞到）。现在按依赖图算重跑集合。
- **`local-sdcpp` 同一时间只跑一个 sd-cli**：AO 默认并发 2 会把两条本地出片一起拉起来，每条要 ~27 GB 统一内存——真机交换区用到 39 GB / 剩 0.9 GB 整机卡死。现在模块级队列串行，排队时通知说明原因。
- 短剧流水线定妆图：`{{style}}` 是「霓虹赛博电影」时提示词把街道/霓虹/雨搬进了定妆图，看图验收两次判"背景不是干净单色"——任务现在明说风格只取色调与镜头语言，背景必须棚拍单色。
- `ao plan` 忽略 `-i` 输入，永远按模板默认的供应商/档位估花费——换成本地或别家也看不出来。现在默认值打底、`-i` 覆盖。

- Studio「创意出片」页把用户从画布保存的副本和内置原版平铺在一起，出现两张同名卡（一张带删除键），看起来像重复。现在筛选视图也分「我的工作流 / 内置模板」两区。

## [0.19.1] - 2026-08-28

### Changed
- **角色库升到 `agency-agents-zh` 1.4.0：267 → 276 位专家**。新增「公司经营」分类七位高管（CEO / CFO / CMO / COO / CPO / CTO / 幕僚长）与视频提示词工程师。两处过渡角色换回正主：「一句话出短片」三步的图像提示词工程师 → `design/design-video-prompt-engineer`；一人公司系列（做内容 / 做产品 / 全员大会）5 处 `specialized/business-strategist` → `company/chief-executive-officer`。全站计数与专家静态页同步到 276。

## [0.19.0] - 2026-08-28

### Added
- **Agnes 图生视频真机接通**：短剧流水线三镜此前一条没出——先是 inlineImage 形状拿着解析好的本地首帧被当"没解析成本地图片"拒掉（已修），再是 Agnes 拒收 multipart（"only supports application/json"）。零成本探测（无效请求体只回 400）摸出契约：`mode` 合法值只有 text / reference / **keyframe**，图放 JSON 的 `first_frame`（data URI 或裸 base64；64×64 探针图会被"valid base64 data"拒——它校验的是图不是编码）。供应商表新增 `imageJsonField` + `createExtraWithImage`，mime 按字节魔数判。
- **顶层 `verify_llm` / CLI `--verify-provider --verify-model`：指定验收员模型**。真机跑短剧流水线时暴露：验收员固定等于文本供应商，文本走 DeepSeek（看不了图）时媒体步的看图验收只能整段跳过，唯一出路是给每个媒体步手改 `llm:`。现在一处指定（优先级：步骤级 `llm` > `--verify-provider` > YAML `verify_llm` > 文本供应商），文本步的验收也一并换成它；换供应商时文本供应商的 base_url / api_key 不带过去（同 image/video.provider 规则）。写错形状解析期报。
- 短剧流水线三个镜头提示词的 `max_bytes` 900 → 1100：任务自己要求的五段标记 + 固定呼吸感句 + 【声音】行就占 ~150 字节，真机两次都卡在 938 字节上白返工一轮。
- **媒体步骤吃 `--feedback`，Studio 一键「按未满足项重做这一步」**。此前 `--feedback` 只在文本分支拼进提示词，对出图/出片步骤"提意见重做"会把意见**静默丢掉、原样再出一张**。现在意见变成提示词末尾的硬约束（与验收重出同一套拼法）重出，日志明说带了哪条意见。Studio 实时视图在验收未满足条目下方新增按钮，把条目直接当意见交回去：文本步在原稿上改，出图/出片步追加约束重出——视频按秒计费，这个按钮就是用户的明示。
- **视频步骤支持 `acceptance`——出片后抽帧审一遍，默认只审不重出**。本机 ffmpeg 抽开头/中段/结尾 3 帧（`src/media/frames.ts`，与 concat 同一条依赖，缺 ffmpeg 跳过并告警），交给支持 vision 的文本供应商逐条核对；核验员被明确告知只能看静帧——运动、节奏、声音判不了，一律按满足处理不猜。与图片验收唯一的差别：**视频按秒真钱，默认不重出**，未过只标 ⚠️ 并指路 `video.rework: true` 或看完片后 `--resume --from`；开了 `rework` 才带着未满足项重出一条（日志明说再付一整条）。`ao plan` 分别标「只审不重出」与「最多 +N」。短剧流水线三个镜头挂了默认口径的验收（主角与定妆图同一人物、无文字水印）。`test/verify-video.ts` 18 条（真 ffmpeg 造 2 秒测试片，钉住 3 帧 JPEG 进核验消息、默认出片一次、rework 才重出）。
- **图片步骤支持 `acceptance`——出图后让能看图的模型审一遍，不合格自动重出**。此前 `type: image` 上写 acceptance 在解析期直接报"暂不支持"，而"出图后让视觉模型审一遍、不合格重跑"恰恰是 AO 相对单次出图最能打的差异化。现在：成品 PNG 以 data URI 走既有的 vision 协议交给**文本供应商**逐条核对（口径与文本验收同源：只按标准字面判、判未满足必须描述画面里实际看到了什么），未过 → 把未满足项作为硬约束追加到原提示词末尾重出一张（图片模型没有"上一版可改"，只能重采样；**再花一张图的钱**，`ao plan` / 运行表头的花费预览会标"挂了验收，最多 +N"）→ 复核；交付重出后的那张，`verification` 与文本步骤同一套字段进 metadata / Studio。三级开关（`--verify` / 顶层 `verify` / `step.verify`）照用。CLI 订阅类与 ollama 连接器会把图剥掉，对着占位文字判等于瞎判——这些一律跳过并告警，不冒充通过；API 模型不支持 vision 时服务端报错 → 核验不可用 → 跳过并告警。纯媒体工作流没有文本 connector，验收员按文本供应商配置现建。`assert` 仍不给 image 步骤（它数的是文本结构），报错指路 acceptance。短剧流水线的「主角定妆图」挂上了第一条看图验收（只写画面里看得见的硬条件：单人全身、干净单色背景、与提示词一致）。`test/verify-image.ts` 18 条：钉住图片确实以多模态 `image_url` 进了核验消息、重出提示词带未满足项、落盘的是第二张、看不了图的供应商跳过并告警。
- **输入支持 `show_when`（条件可见）**：与 `step.condition` 同语法，只能引用其他输入。为假时 Studio 不渲染、CLI 不把它当必填缺失；引擎照常把默认值放进上下文，步骤引用它不会炸。来由：短剧流水线 15 个输入里，语音供应商/模型/音色在选了「不配音」时仍然摆在那里，用户不知道要不要填——而若它们是必填，CLI 还会拦着说"缺输入"，自相矛盾。写错（不支持的运算符、引用了非输入、引用自己）在解析期就报，否则那个输入会"永远不显示"而没人知道为什么。弹窗三处生效（内容输入、媒体输入、必填缺失判断），守卫测试钉住。
- **开跑前的媒体花费预览**（`ao run` 表头、`ao plan`、Studio 实时视图三处共用一份纯函数 `media/preflight.ts`）：会出几条片 × 各多少秒 × 什么档位 × 哪家、几张图、几段配音、几条合成（本机 ffmpeg，标明不花钱），并合计视频秒数——"成本可见"写在产品定位里，可此前没有任何地方在按下运行**之前**说"这次是 3 条 × 8s"。只说数量不报价（各家价目表不在我们手里，编一个"约 ¥x"比不报更糟）。条件只引用输入的步骤当场判定（关掉配音时 tts 不计数并列出「本次不跑」），引用上游产出的标「视条件」且按会跑算——宁可高估。输入没填时不抛、原样显示 `{{…}}` 让人看出没填。Studio 走 `__AO_PREFLIGHT__` 机器标记 → SSE `preflight` 事件，在步骤列表上方以琥珀色卡片展示。7 条测试含内置短剧流水线的真实数字（3 × 8s = 24 秒 + 1 张定妆图）。
- **`ao doctor --media-probe`（旧名 `--video-probe` 保留）现在连语音端点一起探**：同一次零成本探测覆盖视频 / 图片 / **语音**（`POST /audio/speech`，model 与 voice 都写成 `__ao_probe__`，最多拿回 400「模型不存在」，绝不会真合成）。不探的话，用户要等工作流跑到配音那一步才知道这家不行——**而那时前面的图片/视频步骤已经花过钱了**。顺手从 `/models` 捞语音模型名（tts / speech / voice / cosyvoice…，且不把视频模型混进来）。真机实测：DeepSeek 明确没有；Agnes 与多元探索都有（`speech=503✓`，对照路径回 404 所以判定可信）。
- **`concat.clip_volume`——片段自带音轨的音量**。视频模型本来就出声音（Veo3 / Sora2 / MiniMax-H3），而且常常是**成句对白**而不只是环境音。此前旁白混音把原声一律压到 0.3 当"底噪"，会把模型生成的台词压成听不清的嘟囔。现在压多少可调（有旁白时默认 0.3，没旁白原样；0 = 完全换成旁白，1 = 同强度并存并给出提醒），因为"该压还是该留"只有作者知道。短剧流水线把这个旋钮显式写进模板，旁白开关的说明也改成先提示「先听一遍原片，够用就别叠旁白」。
- **后期三件套：配音 / 字幕 / BGM，全部本机 ffmpeg 完成，不花厂商的钱**。此前短剧流水线跑完，产物是一条**无人声、无字幕、无音乐的静默拼接**——发不了抖音和视频号，最后一公里是断的。现在 `type: concat` 一步做完：`voiceover`（逐段配音，混在该段现场音之上，现场音压到 0.3 而不是替换掉——方法论要的就是"仅现场音"的底噪）、`subtitles`（按各段**实际时长**排轴，按标点切条、按字数占比分配时间）、`bgm`（循环铺满全片、末尾 2 秒淡出、默认 0.25 压在人声下）。画面时长是按秒买来的，**绝不为迁就配音而拉长或截短**；配音超长会明确告警让人回去改文案。
- **`type: tts` 配音步骤**：task 就是要念的文案，走 OpenAI 兼容的 `POST {base}/audio/speech`——与 `type: image` 同一套供应商/key/端点漂移机制，**不引入任何新依赖、不新开供应商表**。`model` 与 `voice` 都必填（音色 id 各家互不通用，猜错就是拿回一条不是你要的嗓子的成品，钱照花）。没有这条端点的供应商拿到 404 时，说的是"这家没有语音端点"而不是让人回去反复查参数；200 却回 JSON / 回 0 字节都会被识破，绝不把一段 JSON 当 mp3 写进 assets。
- **烧字幕要 libass，而这台机器的 ffmpeg 没有**——`subtitles` 滤镜不是每个构建都带（本机 Homebrew 8.1.1 既没有 `subtitles` 也没有 `drawtext`）。不先探一下，这件事会在**三镜都已经花钱出完之后**才崩。现在：合成前探滤镜，缺了就照常出片、把字幕挂成**软字幕轨**（mov_text，任何 ffmpeg 都能封）并说清缺什么、怎么装；`ao doctor` 也提前报「字幕能不能烧进画面」。
- 短剧流水线接上后期：新增「旁白配音」开关与语音供应商/模型/音色、背景音乐输入；旁白逐镜写（每条限死在 `每镜秒数 × 4` 字内，中文口播念得完才不会被截断），字幕即旁白文案。关掉配音时 tts 步被 `condition` 跳过，合成步靠 `depends_on_mode: any_completed` 照常出片——默认的 `all` 会把合成一起跳掉，那就是三镜都花了钱却拼不出成片。
- **出片前把关：两条视频模板补上验收与机械断言**。此前「一句话出短片」「短剧流水线」全程 0 条 `acceptance`——提示词写飞了没人拦，直到按秒计费的出片步骤才把钱烧掉。现在：写提示词的步骤挂 `skill: "shortfilm-prompt"`（下条），并按姊妹仓 `cases.zh.md` 的 14 条翻车规则补验收；能数出来的走 `assert`（不花 token、不过网络）——五段标记齐全、呼吸感那句在、末尾有【声音】、字节数落在区间内。剧本步骤断言 `## 主角` 与三个 `## 镜头` 标题：少写一镜是这条流水线最贵的翻车，下游三个提示词步骤会照跑不误，直到出片才发现镜 3 是编的。
- **`assert.max_bytes`**（与 `min_bytes` 对称）：产出超长在解析期之后、花钱之前拦下。来由是真实翻车——视频提示词写太长，厂商在提交这一步直接拒收。`min_bytes > max_bytes` 这种自相矛盾的区间在**解析期**就报错，不然每步都要返工一轮再失败。Studio 画布的 assert 面板同步加了输入框。
- **自带 skill：`shortfilm-prompt`**（5 段式电影感视频提示词方法论 + 7 条硬规则 + 抽卡心态），改编自姊妹仓 [ai-shortfilm-prompts](https://github.com/jnMetaCode/ai-shortfilm-prompts)（MIT，同作者）的 `methodology.zh.md` / `cases.zh.md`。上游那份是**交互式** Claude Code Skill（会 `AskUserQuestion` 提问、用 `Read` 读模板文件），直接注入 AO 步骤会让模型去提问而不是出提示词，所以是单轮非交互改编，测试钉住了"不得残留交互式指令"。
- **skills 改为多目录按名合并**（此前是"第一个命中的目录赢"）：`AO_SKILLS_DIR` > `./skills` > superpowers-zh > 本包自带的 `ao-skills/`，同名前者赢。单目录时只要多一个自带目录，superpowers-zh 的 20 个 skill 就会整个消失——`AO_SKILLS_DIR` 仍是"覆盖"语义，只是不再连带清空其余目录。`ao skills` 现在列全部来源目录而不只报第一个。
- 风格库 15 张示例图（Agnes image-2.0-flash，同一主体只换风格后缀，640 宽 jpg），运行弹窗选了风格就显示示例图；示例成片脚本加 `--pool community`（47 条社区提示词换自托管成片，原外链保留为 `previewOrigin`）与 429 退避。
- 角色组队：分类条与「全部」网格按热度排序（公司经营 → 营销 → 工程 → 设计 → 产品 → 销售 → 财务 → 人力…），常用仍置顶；创意库自托管示例成片进入视口即静音自动循环播放，并标注出片方（🎬 秘塔科技 · MiniMax-H3 ↗）。角色库 1.4.0 的高管角色名带通用缩写（CEO/CFO/CMO/COO/CPO/CTO、Chief of Staff）、产品经理（PM）。
- **火山方舟 Agent Plan 独立供应商 `volcengine-plan`**（`ARK_PLAN_API_KEY` + base `/api/plan/v3`）：文本/图片走套餐额度、视频走按量 key 可在同一台机器并存。出图/出片面板在 `/models` 拉不到时用注册表里真机核实的 `imageModels` 候选。
- **火山方舟接入视频供应商表**（第四种形状 `ark`：`POST /contents/generations/tasks` → `GET …/tasks/{id}` → `content.video_url` 直链），Seedance 1.0 pro / pro-fast 真机全链路 21s 出片；图片 Seedream 5.0 经 Images API（`size: "2k"`）按量与 Agent Plan 两条路都通。两个 base：按量 `/api/v3`、Agent Plan `/api/plan/v3`（`VOLCENGINE_BASE_URL`；Medium 无视频配额）。视频供应商现为 metaso / apimart / agnes / volcengine 四家。
- 创意库 21 条视频题材模板示例成片（秘塔 MiniMax-H3，768P×4s 压至 480 宽）。
- **Agnes AI 接入视频供应商表**（openai-videos 变体：必填 `mode:"text"`，size 用档位名 720P/960P/2K）——**openai-videos 链路真机验证通过**：agnes-video-2.5-flash 4s 出片 1280×704 带音轨，全程走 AO 适配器；图片 agnes-image-2.0-flash 走 Images API 也真机成功。供应商级 `createExtra` 机制让 OpenAI 形状的变体声明固定字段而不改主流程。
- 媒体探测也覆盖图片端点 `/images/generations`：Studio 图片供应商列表按探测结果排序（有端点 ✓ 排前、确认没有的沉底标注），不再把 DeepSeek / Kimi 这类没有图片端点的当成图片供应商列出。
- **`ao doctor --video-probe`**：零成本探测每个已配 key 的 OpenAI 兼容中转站有没有视频端点、是哪种形状（请求体故意不合法不会建任务；路径存在回 4xx、不存在 404，再打乱写路径做对照，全站兜底判"探不出"；顺手从 /models 捞视频模型名）。实测多元探索、Agnes 都有 OpenAI 形状的 `/v1/videos`。
- **第三种视频形状 `openai-videos`**（OpenAI 官方 Videos API，字段来自 openai-node）：不在视频表但 OpenAI 兼容的供应商自动按它试，真没端点的 404 说清并指向 doctor；首帧图 multipart 内联 `input_reference`。Studio 出图/出片面板加「🔎 探测更多供应商」，探到的记进本机并进视频下拉。
- **APIMart 视频模型 6 → 15**（Seedance 2.5、可灵 v3、海螺 2.3 / Fast、Wan 2.7、Vidu Q3 pro/turbo、PixVerse v6、Grok Imagine 1.5、sora-2-pro…），每个的分辨率 / 秒数 / 宽高比与**字段名**逐页核对 docs.apimart.ai：可灵档位叫 `mode`、Wan / PixVerse / Grok 宽高比叫 `size`、MiniMax 系首帧叫 `first_frame_image`，适配器按模型映射。出图/出片面板的模型改为下拉、档位随模型变，新增宽高比。
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

### Changed
- 创意库视频卡：出片方角标从按钮行挪到**成片正下方单独一行**，并换成「厂商 logo + 名字 + 模型档位 + 外链」的药丸。此前它和「看提示词 / 复制 / 原文与拆解」抢同一行，一行放不下就把按钮顶到第二行、卡片高度参差；署名本来就该贴着它署的那条片子，但也不该压在画面上——画面是内容。没成片时（外链示例还没点开）仍退回按钮行。

### Fixed
- **官网 ao.aiolaola.com 整站白屏（2026-08-28）**：CF Pages 的 SPA 回退（`_redirects` 的 `/* /index.html 200`）在部署传播窗口里把 index.html 当成 `/assets/index-<hash>.js` 的内容回给了边缘，而 `_headers` 给 `/assets/*` 的是 `immutable, max-age=31536000` —— 这份 HTML 于是被**缓存一年**，浏览器按 MIME 拒绝执行模块脚本，`#root` 永远是空的。更阴的是 CF 按 `Origin` 请求头分缓存变体：浏览器加载 module 必带 `Origin`，`curl` 默认不带，于是**终端探测一切正常、每个真实访客全白屏**（这也是它没被早点发现的原因）。现在 index.html 顶部加了兜底：`/assets/*` 的 script / link 加载失败（含 MIME 拒绝）就带 cache-buster 参数重挂一次——不同 URL = 不同缓存键，实测能直接绕开被毒化的那份；只重试一次，不会循环。排障口径也一并记下：判断线上死活要**带 `Origin` 探 content-type**，或直接用无头 Chrome 看控制台，别只看 curl。
- **验收员的判定口径校准——影响所有带 `acceptance` 的工作流**。原先写的是"宁严勿松：条目只做到一部分也算未满足"。对**可数**条目（必须有 6 个文件）这是对的，但对**质性**条目（"写明了色调和光源"）等于放任评判者无限细分：产出已经写了"暖阳侧逆光"，它仍判"未明确光源类型（自然光/人工光）"。真机 11 次采样实测 **11/11 全部触发返工、返工后多数仍判未过**——每跑一次白付一轮返工，而且验收长期显示未过，**用户会学会无视验收，那比没有验收更糟**。现在把严格口径限定在标准**明确枚举**的东西上，并要求判"未满足"时**必须引用产出中的原话**（举不出原话就说明它其实满足了）——从根上掐掉"发明标准里没有的要求"。同一批样本改口径后 **0/4 返工、4/4 通过**；同时用故意写坏的产出验证它仍然咬得动（空泛器材、形容词分镜、混进"钢铁侠"三种全部判不过，且每条 `why` 都引用了原话）。
- **验收标准里混进了脚本已经数过的结构条目**（自己违反了 `core/assert.ts` 写着的"模型审内容，脚本审结构"）。「一句话出短片」「短剧流水线」的验收原本同时写着"五段齐全""呼吸感那句在""【声音】独立成行""220 字以内"——这些 `assert` 已经用 `contains` / `max_bytes` 数过了，重复写只会引导验收员去挑结构毛病。现在两条模板的验收只留脚本判不了的内容项（器材是否具体、分镜是否写动作、有没有 IP 名、有没有空泛词），结构一律交给 `assert`。
- **配音供应商在 Studio 的运行弹窗里凭空消失，短剧流水线的配音路径根本没法配**：带 `source` 的媒体输入在弹窗里是**不画控件的**——它们由右侧「出图 / 出片」面板驱动，而那个面板只覆盖图片与视频。新加的 `tts_provider` 因此无处可填，而 `ao validate` 一切正常，没有任何环节会报。改成**反向排除**（面板覆盖不到的就地渲染），并加契约测试：模板用到的每个 `input.source` 前端都必须认识，且不能把没有面板控件的 source 列进"面板已覆盖"。两条都验证过会真红。
- **配音供应商和图片供应商共用一个存储槽**：`tts_provider` 起初复用了 `source: image_providers`，于是选配音供应商会把用户存的图片供应商默认值覆盖掉（同一处放了两个不同设置）。新增独立的 `tts_providers` 源与 `MediaDefaults.tts`；`/api/config` 给出独立的 `ttsProviders`（今天与 `imageProviders` 同口径，但将来若真去探 `/audio/speech`，改一处即可）。`tts_model` 也接上模型下拉（`source_from: tts_provider`），不再手打。
- **配音产物在 Studio 和分享报告里听不了**：`[🔊 id.mp3](assets/id.mp3)` 只渲染成一条要另开标签页的链接。现在 Studio 内联 `<audio controls>`（与视频同一处理），单文件分享报告把音频一并内联成 data URI（配音一般几十 KB，不内联就是死链）。
- **老 ffmpeg 上混音会整条滤镜链报错**：`amix` 的 `normalize` 选项是 ffmpeg 4.4（2021）才加的，而 Ubuntu 20.04 至今是 4.2——偏偏是在三镜都出完、钱都付过之后的合成阶段才崩。现在探一次再决定带不带，探不到就不带（代价只是混音整体轻一点，远好过成片出不来）。
- **演示模式「创意出片」整页空白**：演示快照生成器按 `s.role` 过滤步骤，而图片/视频/合成/配音步骤**没有 role**，于是被整条丢掉——「一句话出短片」在演示站只剩 3 步（出片那步不见了，而那是这条模板的全部意义）；快照里也就没有 `type`，而前端恰恰按 `step.type` 筛"创意"模板，一条都匹配不到。现在生成器保留媒体步骤并带上 `type`，没写 name 的给默认显示名（🎨文生图/🎬文生视频/🎞合成/🎙配音），`demo.ts` 也把 `type` 透传。演示站「创意出片」恢复 3 个模板，模板总数 27 → 28。顺带修掉 `WorkflowStepMeta.role: string` 这个一直没兑现的类型声明（媒体步骤从来就没有 role）。3 条回归测试。
- **非赞助条目占掉了赞助位**：「火山引擎 · Agent Plan 套餐」按约定不重复标赞助商（同一家不能在列表里出现两次），但供应商列表**完全没有排序**、纯按 `API_PROVIDERS` 的声明顺序渲染，而它紧挨着火山引擎声明——于是排在了 LanoX、APIMart 等赞助商**前面**。供应商页与顶栏下拉都改为按赞助层级排序（旗舰 → 赞助商 → 其余），组内保持声明顺序（赞助商之间的次序是谈好的）。排序而不是挪声明位置：挪一次只治一次，排序能保证以后任何插在中间的非赞助条目都排在赞助商之后。契约测试三条钉住。
- **concat 悄悄少拼一段**：某一镜失败/被跳过时，它的输入变量渲染成空串，而 concat 对空输入是 `.filter(Boolean)` 静默丢弃——结果是交付一条"看起来正常"的两镜成片，而三镜的钱已经花了。现在当场报错并点名是哪一段空的。
- **全局安装后在 Studio 里存 API key 报 500（`EACCES: permission denied, mkdir '.../.local'`，#99）**：Studio 的数据目录原本直接等于包的安装目录 —— 开发仓库直跑可写、桌面端由 Electron 传 `AO_DATA_DIR`，唯独 `npm i -g` 装出来的 ROOT 在 `node_modules` 里且通常 root 所有，于是**第一次配 key 就撞墙**。现在装出来的包一律把 key / 生成的工作流 / 运行产物写到 `~/.ao`（与团队、提示词、角色同体系），优先级 `AO_DATA_DIR > AO_HOME > 可写的源码 ROOT > ~/.ao`。附带两点：npm 前缀可写（nvm）时旧版其实写进了 `node_modules`，下次 `npm i -g` 会连 key 一起换掉 —— 现在同样改走 `~/.ao`，并**一次性把旧的 `.local` / `ao-workflows` 迁过来**（`ao-output` 不搬，可能几个 G）；启动日志固定打印数据目录，目录不可写时启动就报并给出 `AO_DATA_DIR=` 的走法，不再等到用户点保存才炸。回归测试 `test/web-data-dir.ts` 17 条。
- 视频供应商 id 统一从解析结果带进 adapter：调用方只给 `config.provider` 时（脚本的调法）Agnes 少了必填 `mode` 报 400。
- 实时运行视图里出片的播放器 0:00 放不了：产物链接是 `assets/x.mp4` 相对路径被解析到 `/studio/assets/…`；运行目录到达后改写成 `/api/runs/<id>/assets`，跑完当场能播。
- Studio 打磨：可选下拉占位不再误写「跟随文本供应商」；输入 `format: url`（首帧参考图）单行且不带扩写/读文件；出图出片模板不显示「对比单次」（文本基线比不了片）；运行历史里纯视频运行用 ffmpeg 抽首帧做封面（一次缓存 `_poster.jpg`）。
- **模型返回空正文不再算「完成」**：OpenAI 兼容连接器与执行器都拦住，报错点明是"只返回了思考内容（N 字符 reasoning）没有正文"还是"空正文（finish_reason=…）"，下游步骤跳过、不重试；图片/视频步骤提示词为空时在建任务前拦住（此前把空 prompt 发给厂商才报 400）。真机：推理模型在某些网关上只回 reasoning 不回 content。
- 媒体模板跑到角色步骤报「缺少 API Key」却不说是哪家（其实是右上角文本供应商没 key，用户以为是 Agnes 那把没生效）：引擎报错点名供应商与环境变量、说明出图/出片 key 是另一把；运行弹窗在文本供应商无 key 时直接禁用运行并指路。
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
