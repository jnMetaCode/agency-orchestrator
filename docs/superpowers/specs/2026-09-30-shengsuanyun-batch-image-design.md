# 创意库 × 胜算云批量出图：产品需求与开发设计

> 日期：2026-09-30
> 状态：Draft / 待双方接口评审
> 负责人：Agency Orchestrator
> 合作方：胜算云（LoomLoom Batch API）
> 首期页面：`/creative` 图片提示词库

### 当前实施状态（更新于 2026-10-08）

- 已完成需求与接口反向评审；
- 已完成默认开启的胜算云批量服务端适配器；默认接入官方 `text-image-v1` 模板和当前 `/loom/v1` 接口，显式旧地址保留兼容；
- 已完成 capability、校验/估价、幂等提交、整批状态、逐条任务和产物接口；
- 已完成本地 runId 包装与任务映射持久化；
- 已完成创意库批量选择、费用确认、提交、进度和结果预览的首版 UI；
- 已有假上游契约测试覆盖金额、原样提示词、余额、quote、幂等基础和任务归属；
- 已完成刷新后恢复最近任务，以及“重新估价 → 仅重试失败项 → 建立子任务”的链路；
- 已完成最近 20 条任务历史、手动刷新和终态任务 30 天清理；
- 尚未完成真实专属模板联调和 ZIP 下载；
- `AO_SSY_BATCH_ENABLED` 缺省开启，设置 `0` 可关闭；真实接口仍待有凭据的联调验证。

## 1. 摘要

在 Agency Orchestrator 创意库中增加“批量出图”能力。用户仍在本站浏览、搜索、筛选和选择提示词；本站负责选择、配置、费用确认、任务进度与结果展示；胜算云通过 LoomLoom Batch API 承担批量任务校验、费用预估、异步执行和产物交付。

首期不是“把现有单张生成循环 N 次”，而是接入胜算云正式批处理能力，必须满足：提交前预估费用、幂等提交、逐条状态、失败项重试、刷新后恢复、产物下载。

推荐入口位于图片分类和扩充池入口下方、卡片列表上方。用户进入“批量选择模式”后再在卡片上显示复选框，避免普通浏览状态被批量控件干扰。

## 2. 背景与现状

### 2.1 当前能力

创意库当前已有：

- 229 条精选图片提示词及按需加载的扩充池；
- 搜索、分类筛选和分页；
- 单卡复制提示词；
- 单卡选择供应商、模型、尺寸并生成一张图片；
- 已配置供应商的本地 `ao web` 后端代理；
- 胜算云供应商、Logo、注册链接和赞助商资料。

现有单张生成的调用模型是同步的：前端调用 `/api/image/generate`，等待一张图片以 data URL 返回。该模型不适合十几至几十个任务，因为会造成长连接、内存占用、刷新丢失、重复提交和部分失败难以恢复。

### 2.2 胜算云已确认的批处理能力

根据 2026-09-30 可访问的胜算云 LoomLoom 开发者文档，已确认：

- Bearer Token 鉴权；
- 查询模板及模板 schema；
- JSON 逐行校验；
- 提交前费用预估与余额检查；
- JSON 逐行提交；
- `idempotencyKey`；
- 使用 `runId` 查询批任务状态；
- 查询逐条任务及失败原因；
- 查询产物及短期签名下载 URL；
- 官方图片模板 `text-image-v1` 当前流程为“提示词优化 → 出图”。

参考：

- https://lean.shengsuanyun.com/loomloom-guide
- https://lean.shengsuanyun.com/apidocs/loomloom/guide/loomloom-manual

### 2.3 核心冲突

本合作的价值主张是“用户使用 Agency Orchestrator 的提示词批量出图”。若直接使用会二次优化提示词的模板，最终输入不再等于用户选中的提示词，会带来：

- 生成效果不可解释；
- 用户无法复现；
- 平台提示词价值被稀释；
- 客诉时无法确定是原提示词、优化步骤还是图片模型造成；
- 费用中混入额外文本模型调用。

因此上线阻断条件之一是：胜算云提供提示词原样透传模板，或现有模板支持明确的 `passthrough` 模式。

## 3. 目标与非目标

### 3.1 产品目标

1. 用户能从当前页选择多条提示词，一次创建批量出图任务。
2. 用户提交前能看到条目数、预计费用、可用余额和关键生成配置。
3. 用户能看到整批和逐条进度，并定位失败原因。
4. 页面刷新或关闭后重新打开，仍能恢复最近任务。
5. 用户能下载单个产物或整批产物，并仅重试失败项。
6. 胜算云获得自然、可归因的品牌曝光，但不破坏提示词浏览体验。
7. 集成层保持可替换性，未来可接入第二家批量生成服务。

### 3.2 首期非目标

- 不支持用户在本站设计任意 LoomLoom 工作流；
- 不支持 Excel 上传和回填；
- 不支持图片到视频流水线；
- 不支持上传参考图；
- 不支持跨设备同步任务历史；
- 不支持团队协作、审批和额度分配；
- 不承诺在公开静态演示站保存长期凭据；
- 不把所有胜算云图片模型一次性暴露给用户。

## 4. 用户与核心场景

### 4.1 目标用户

- 内容运营：一次生成多种视觉方向，再挑选可用素材；
- 电商和营销人员：批量生成多张主图、海报或社媒图片；
- 设计探索者：将一个筛选结果中的多条提示词批量试跑；
- 开发者：验证多个提示词在同一模型下的表现。

### 4.2 首期主路径

1. 用户进入创意库图片页。
2. 搜索或选择分类。
3. 点击“批量出图”。
4. 勾选若干提示词，或选择“全选本页”。
5. 点击吸底栏“下一步”。
6. 在配置抽屉中确认模板、模型归属、尺寸、每条生成数量和提示词处理方式。
7. 系统调用校验与费用预估。
8. 用户确认费用并提交。
9. 系统展示整批与逐条进度。
10. 完成后用户预览、下载，或仅重试失败项。

## 5. 产品决策

### 5.1 批量对象

首期定义为“多条提示词 × 每条 1 张”。

- 默认最多选择 24 条，即当前页大小；
- 真实上限由胜算云书面确认后写入 capability；
- “每条生成多张”作为服务端确认支持后的可选项，首期默认隐藏；
- 不允许在尚未加载的扩充池中后台隐式选择提示词。

### 5.2 提示词处理

- 专属模板默认且推荐 `passthrough`，原样使用本站提示词；
- 通用 `text-image-v1` 模板会先整理提示词，必须在界面标明“由模板整理”，不得声称原样透传；
- 若要让用户在 `passthrough` 与 `optimize` 之间切换，胜算云模板 schema 必须显式提供对应字段；
- 配置页需展示说明：“AI 优化会修改原提示词，并可能产生额外费用”；
- 提交记录同时保存原提示词和发送提示词的摘要信息；
- 若 API 无法回传优化后的最终提示词，首期不开放 `optimize`。

### 5.3 模型策略

首期只开放 1 个双方共同验收过的模型，或由已验收的胜算云模板内部决定模型，而不是直接展示完整目录。

原因：胜算云不同图片模型的参数结构、尺寸枚举和计费口径不同。先固定模型可显著降低错误率，并验证真实转化。后续由 capability 返回模型与合法配置，不在前端硬编码未经验证的组合。

当模板 schema 没有模型字段时，前端显示“由胜算云模板决定”，不渲染虚假的模型选择器。需要用户选模型时，合作方应在专属模板 schema 中提供稳定的 model enum 字段。

### 5.4 品牌展示

使用以下三处轻量露出：

1. 页面级按钮下方：“批量能力由胜算云提供”；
2. 配置抽屉标题区：胜算云 Logo、名称和“了解服务”链接；
3. 任务详情页：“由胜算云 LoomLoom 执行”。

不在所有普通卡片常驻 Logo；只有进入批量选择模式后才显示批量相关控件。

## 6. 信息架构与交互

### 6.1 页面入口

桌面端：

```text
分类标签……

[再加载全部 1349 条扩充池]     [☑ 批量出图]
                                  由胜算云提供

┌────────────卡片────────────┐  ┌────────────卡片────────────┐
```

移动端：两个按钮纵向排列或横向自适应；赞助说明不能挤压主要按钮文字。

按钮事件：

- 普通状态：点击进入选择模式；
- 选择状态：按钮变为“退出批量”；
- 若批量服务不可用：按钮可见但禁用，旁边给出可操作原因。

### 6.2 选择模式

进入后：

- 每张图片卡左上角显示复选框；
- 整张卡的非交互空白区域可切换选择；
- 原有“复制提示词”“生成”按钮继续可用，不能因卡片点击误触选择；
- 已选择卡片使用主色描边和轻背景；
- 顶部出现“全选本页 / 清空选择”；
- 切换搜索条件、分类或分页时，已选项保留；
- 用户选择未加载的扩充池分类时，等数据加载完成再允许选择；
- 选择数达到上限后，其余复选框禁用并解释上限。

### 6.3 吸底操作栏

```text
已选择 8 条提示词       [清空] [取消] [下一步：批量出图]
```

- 选择数为 0 时“下一步”禁用；
- 不覆盖移动端浏览器安全区；
- 保持在站点导航和弹窗遮罩的正确层级；
- 退出选择模式时，如已有选择，要求二次确认或提供撤销 toast。

### 6.4 配置抽屉

字段：

| 字段 | 首期规则 |
|---|---|
| 提示词 | 显示数量，可展开预览；不允许在此逐条编辑 |
| 提示词处理 | 显示 capability 的真实行为；通用 `text-image-v1` 显示“由模板整理” |
| 模型 | 固定模型显示具体 ID；无模型字段时显示“由胜算云模板决定”；有枚举字段时才显示单选 |
| 图片比例/尺寸 | 由 capability/schema 返回，不能自行猜值 |
| 每条数量 | 首期固定 1 |
| 总任务数 | 提示词数 × 每条数量 |
| 预计费用 | 必须预估成功后显示 |
| 可用余额 | API 返回时显示；不足时阻止提交 |

按钮状态：

- 初始：“预估费用”；
- 预估中：“正在校验和估价…”；
- 预估成功：“确认并提交 · 预计 ¥X.XX”；
- 配置变更后，旧预估立即失效，必须重新预估；
- 预估超过 60 秒未提交，提交前重新预估一次；
- 不允许把 `estimatedTotalCost` 当最终实际费用。

### 6.5 任务面板

整批信息：

- 状态：等待中、生成中、部分成功、全部成功、失败、已取消；
- 完成数 / 总数；
- 失败数；
- 预计费用和实际费用；
- 提交时间；
- `runId` 的短预览，用于客服排查；
- 胜算云执行标记。

逐条信息：

- 原卡片标题和缩略图；
- 原提示词；
- 状态；
- 失败原因；
- 生成产物；
- 单张下载；
- 单项重试。

轮询建议：

- 前 1 分钟每 5 秒；
- 之后每 10 秒；
- 页面不可见时降至每 30 秒；
- 终态立即停止；
- 连续 3 次网络失败后进入“暂时无法更新”，但不把远端任务误标成失败；
- 用户手动点击“刷新状态”可立即重试。

### 6.6 结果下载

- 浏览器只访问 AO 同源产物代理，不直接跳转上游 OSS 签名 URL；
- AO 每次下载前重新获取最新 `accessUrl`，校验 HTTPS 和存储域名白名单后流式转发；
- 结果画廊仅展示 `image/*` 产物；模板产生的 `text/plain` 中间提示词不得渲染成空白图片卡；
- 不将短期签名 URL 长期存入 localStorage；
- 用户点击下载而 URL 已过期时，重新获取 artifacts；
- “下载全部”首期可以逐个触发，但浏览器可能拦截多个下载，因此推荐后端流式打包 ZIP；
- ZIP 命名：`agency-orchestrator-batch-{yyyyMMdd-HHmm}-{runIdShort}.zip`；
- 文件命名：`{index}-{promptId}-{artifactIndex}.{ext}`；
- 附带 `manifest.json`，记录 promptId、标题、原提示词、模型、尺寸、任务状态和文件名。

### 6.7 跨生成功能的执行摘要

批量出图、单张出图、提示词生成、视频和其他会发生计费的生成操作，在提交前都应展示同一结构的“执行摘要”：

- 服务商；
- 实际模型 ID，或明确标注“由模板决定”；
- 模板 ID（适用时）；
- 提示词是原样使用还是会被整理；
- 尺寸、数量、时长等核心参数；
- 费用预估与数据去向。

只有上游 schema/capability 明确允许修改的字段才渲染选择器；其余内容作为只读信息展示，不得让用户误以为已选择某个模型。

胜算云的文本与多媒体模型必须分流：提示词生成、对话和普通 LLM 步骤调用 `/chat/completions`，不能使用 Seedream/Seedance 等模型；单张出图使用独立图片模型配置，批量出图则遵循 LoomLoom 模板 schema。若检测到胜算云文本配置误填了多媒体模型，引擎改用已验证文本模型，并在执行摘要中明示。

## 7. 状态模型

### 7.1 前端页面状态

```text
browse
  └─ enter batch → selecting
       ├─ cancel → browse
       └─ next → configuring
            ├─ close → selecting
            ├─ precheck error → configuring
            └─ submit → submitted
                 └─ open run → tracking
                      ├─ completed → results
                      ├─ partial → results
                      └─ failed → results
```

### 7.2 统一任务状态

前端只识别以下内部状态，不直接依赖合作方字符串：

```ts
type BatchRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled"
  | "unknown";

type BatchItemStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown";
```

任何新增或无法识别的上游状态映射为 `unknown`，继续允许刷新，不能擅自判失败。

## 8. 总体架构

```text
CreativeLibrary 页面
  ├─ 选择提示词与配置
  ├─ 展示预估、进度和产物
  └─ 只保存 runId / promptId / 非敏感快照
             │
             ▼
AO Web Backend / BFF
  ├─ 身份与访问控制
  ├─ 胜算云 Token 读取（绝不返回浏览器）
  ├─ 参数白名单与数量限制
  ├─ 上游错误归一化
  ├─ 幂等键生成/透传
  └─ 日志脱敏与可选 ZIP 打包
             │
             ▼
胜算云 LoomLoom Batch API
  ├─ template/schema
  ├─ validate/precheck
  ├─ submit
  ├─ workflow run/tasks
  └─ artifacts
```

### 8.1 为什么不能只在浏览器调用

- 长期 Token 会暴露给页面脚本、扩展和错误日志；
- 公开站无法阻止任意第三方滥用代理额度；
- 上游字段变化会直接破坏 UI；
- 无法集中限制条数、频率和费用；
- 无法可靠生成、复用幂等键；
- 下载打包和回调签名验证需要服务端。

### 8.2 运行环境策略

首期推荐支持本地 `ao web`：复用用户已经配置的 `SHENGSUANYUN_API_KEY`。

公开站要上线真实批量生成，必须满足以下方案之一：

1. 胜算云提供 OAuth / 短期委托令牌；推荐。
2. 用户 BYOK，Token 仅发送到受信任 BFF，服务端不持久化；可接受。
3. 项目方提供共享赞助额度，同时增加登录、配额、风控和费用上限；成本最高。

纯静态页面把 Token 存 localStorage 并直连上游不作为推荐上线方案。

### 8.3 功能开关与部署配置

后端默认开启（2026-10-08 调整）；仍需配置模板和字段，仅有普通 API Key 不足以使用批量接口。可设置 `AO_SSY_BATCH_ENABLED=0` 关闭：

| 环境变量 | 必填 | 说明 |
|---|---:|---|
| `VITE_SSY_BATCH_ENABLED=1` | 官网构建时是 | 前端入口构建开关；localhost 开发环境自动显示 |
| `AO_SSY_BATCH_ENABLED` | 否 | 总开关；缺省开启，`0` 关闭 |
| `AO_SSY_BATCH_TEMPLATE_ID` | 否 | 默认 `text-image-v1`；可覆盖为已验收模板 |
| `AO_SSY_BATCH_PROMPT_FIELD` | 否 | 官方图片模板默认 `图片提示词`；自定义模板需指定 |
| `AO_SSY_BATCH_BASE_URL` | 否 | 缺省 `https://loomloom.shengsuanyun.com/loom/v1`；显式旧地址保留兼容 |
| `AO_SSY_BATCH_MODEL_FIELD` | 否 | 模板允许外部选模型时才设置 |
| `AO_SSY_BATCH_SIZE_FIELD` | 否 | 模板允许外部选尺寸时才设置 |
| `AO_SSY_BATCH_PROMPT_MODE_FIELD` | 否 | 模板支持 passthrough/optimize 切换时才设置 |
| `AO_SSY_BATCH_FIXED_PROMPT_MODE` | 否 | 模板固定行为；`passthrough`（默认）或 `optimize`。通用 `text-image-v1` 必须设为 `optimize` |
| `AO_SSY_BATCH_FIXED_MODEL` | 否 | 专属模板锁定模型时，在摘要中显示的已验收模型 ID |
| `AO_SSY_BATCH_FIXED_SIZE` | 否 | 模板固定的尺寸/比例；通用 `text-image-v1` 可设为 `1:1` |
| `AO_SSY_BATCH_ARTIFACT_HOSTS` | 否 | 产物代理允许的上游存储域名后缀，逗号分隔 |
| `AO_SSY_BATCH_MAX_ITEMS` | 否 | 本地保护上限，缺省 24，且不能超过合作方书面上限 |

若专属模板固定模型或尺寸，capability 把它们作为只读摘要返回，前端不渲染选择器；只有环境变量声明了相应字段、且 schema 验证字段存在时才允许用户修改。

服务启动时不因批量配置缺失而失败；capability 返回不可用原因。这样普通 Studio 与现有单张出图完全不受实验功能影响。

官网只有同时满足“前端构建开关已开”和“后端 capability 可用”才应对外提供完整流程。前端构建开关未开时不展示入口，也不在创意库首屏主动请求 capability，避免给普通 SEO 访客增加一次注定失败的 `/api` 请求。

## 9. AO 内部接口设计

所有响应使用 AO 自己的稳定结构，上游原始响应仅在脱敏调试日志保留。

### 9.1 获取能力

`GET /api/batch/providers/shengsuanyun/capabilities`

```json
{
  "ok": true,
  "available": true,
  "provider": {
    "id": "shengsuanyun",
    "name": "胜算云",
    "logo": "/sponsors/logo-shengsuanyun-icon.png",
    "learnMoreUrl": "https://www.shengsuanyun.com/?from=CH_QKH696UI"
  },
  "template": {
    "id": "text-image-v1",
    "name": "通用文生图",
    "promptModes": ["optimize"],
    "modelPolicy": "template_managed"
  },
  "limits": {
    "maxPrompts": 24,
    "maxOutputsPerPrompt": 1
  },
  "fixed": { "size": "1:1" },
  "configurable": { "model": false, "size": true }
}
```

不可用时必须返回可操作原因：

```json
{
  "ok": true,
  "available": false,
  "reasonCode": "missing_credentials",
  "message": "请先在工作台 → 供应商中配置胜算云 API Key"
}
```

### 9.2 费用预估

`POST /api/batch/providers/shengsuanyun/precheck`

请求：

```json
{
  "items": [
    { "promptId": "ym-7", "prompt": "...", "title": "..." }
  ],
  "config": {
    "promptMode": "optimize",
    "size": "1:1",
    "outputsPerPrompt": 1
  }
}
```

响应：

```json
{
  "ok": true,
  "quoteId": "quote_local_or_remote_id",
  "validUntil": "2026-09-30T14:00:00.000Z",
  "currency": "CNY",
  "estimatedCost": 0.82,
  "availableBalance": 12.30,
  "sufficient": true,
  "itemCount": 8,
  "warnings": []
}
```

服务端负责把上游“千万分之元”转换为十进制人民币。转换应使用整数或 decimal 逻辑，不能先转 JS 浮点后做财务判断。

`quoteId` 是 AO 服务端生成的短期、不透明引用，对应内存中的请求摘要和上游预估结果：

- 有效期 60 秒；
- 服务重启后全部失效，用户重新预估；
- 不把完整请求或金额编码进可由客户端修改的 quoteId；
- 提交时重新计算请求摘要并与 quote 对比；
- quote 只可成功消费一次；同一次提交的网络重试依赖 idempotencyKey 恢复，不再次消费新 quote。

### 9.3 提交任务

`POST /api/batch/providers/shengsuanyun/runs`

请求在 precheck 基础上增加：

```json
{
  "quoteId": "quote_local_or_remote_id",
  "idempotencyKey": "ao-creative-UUID",
  "items": [],
  "config": {}
}
```

响应：

```json
{
  "ok": true,
  "run": {
    "id": "AO_WRAPPED_RUN_ID",
    "providerRunId": "REMOTE_RUN_ID",
    "status": "pending",
    "acceptedAt": "2026-09-30T14:00:00.000Z",
    "itemCount": 8
  }
}
```

约束：

- `idempotencyKey` 由前端首次点击提交时生成并持久化到该草稿，重试请求复用；
- 服务端校验 quote 未过期且请求摘要一致；
- 相同幂等键但请求体不同必须返回 409；
- 上游响应超时不能自动换新幂等键再次提交；先用原键查询/重试；
- 成功返回后立即在本地记录 run 快照。

### 9.4 查询任务

`GET /api/batch/providers/shengsuanyun/runs/:runId`

```json
{
  "ok": true,
  "run": {
    "id": "...",
    "status": "running",
    "total": 8,
    "completed": 5,
    "failed": 1,
    "estimatedCost": 0.82,
    "actualCost": 0.57,
    "currency": "CNY",
    "updatedAt": "..."
  }
}
```

### 9.5 查询逐条任务

`GET /api/batch/providers/shengsuanyun/runs/:runId/items`

每条必须能通过 `sourceRowIndex` 映射回提交时的 `promptId`。映射关系由 AO 保存，不能依赖提示词文本匹配。

### 9.6 查询产物

`GET /api/batch/providers/shengsuanyun/runs/:runId/artifacts`

AO 只返回当前有效的短期 URL；响应头禁止公共缓存。前端不持久化 URL。

### 9.7 重试失败项

`POST /api/batch/providers/shengsuanyun/runs/:runId/retry-failed`

实现原则：创建一个新的子 run，只包含失败项；保留 `parentRunId`。不能篡改原 run，也不能把旧任务重新标记为等待中。

### 9.8 任务归属

当前 `ao web` 是本地单用户服务，任务归属沿用现有 `AO_WEB_TOKEN` 访问边界。若未来部署为多用户公开服务，必须先增加真实用户 ID，并让 quote、run、artifact 与 userId 绑定；不能仅依靠不可枚举的 runId 作为授权。

所有 `:runId` 在访问上游前都必须先在本地索引中命中。浏览器不能借 AO 后端查询任意胜算云 runId。

## 10. 上游接口映射

首期预计映射如下，最终以双方提供的 OpenAPI 和专属模板 schema 为准：

| AO 动作 | LoomLoom 动作 |
|---|---|
| health/capabilities | `GET /batch/v1/health`、`GET /batch/v1/templates`、`GET /templates/{id}/schema` |
| precheck | `POST /batch/v1/templates:validate-rows` + `POST /batch/v1/templates:precheck-rows` |
| create run | `POST /batch/v1/templates:submit-rows` |
| get run | `GET /batch/v1/batch/workflow-runs/{runId}` |
| get items | `GET /batch/v1/batch/workflow-runs/{runId}/tasks` |
| get artifacts | `GET /batch/v1/batch/workflow-runs/{runId}/artifacts` |

`rows[].values` 的 key 不能在代码中猜测，必须从模板 schema 获取并做服务端映射。胜算云文档指出 values 使用模板的字段标签；专属模板应提供稳定的机器字段或保证标签版本兼容。

建议双方专属模板最小字段：

| 字段 | 必填 | 说明 |
|---|---:|---|
| `prompt` | 是 | 原始图片提示词 |
| `prompt_mode` | 是 | `passthrough` / `optimize` |
| `model` | 是 | 双方验收过的模型 ID |
| `size` | 是 | 该模型合法尺寸或比例 |
| `client_item_id` | 是 | AO promptId，用于稳定回传映射 |
| `outputs` | 否 | 每条生成数量，首期固定 1 |

## 11. 本地数据与恢复

首期本地持久化：

```ts
interface LocalBatchRun {
  id: string;
  provider: "shengsuanyun";
  providerRunId?: string;
  parentRunId?: string;
  idempotencyKey: string;
  status: BatchRunStatus;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  items: Array<{
    promptId: string;
    title: string;
    promptHash: string;
    sourceRowIndex: number;
  }>;
  config: {
    promptMode: "passthrough" | "optimize";
    model: string;
    size: string;
    outputsPerPrompt: number;
  };
}
```

规则：

- Token、完整上游响应、签名 URL 不进 localStorage；
- 可保存最近 20 个任务，超出后删除最旧的终态任务；
- 运行中任务不能被自动淘汰；
- promptHash 用于诊断提交后提示词是否变化，不用于恢复正文；
- 若页面数据中已找不到 promptId，任务详情仍显示保存的标题，但提示词正文标记为不可恢复；
- 后端若已有统一数据目录，正式实现优先写入 AO 数据目录，localStorage 仅保存索引。

后端持久化位于 `DATA_DIR/.local/batch-runs/`，使用原子写入并限制为当前用户可读。为了刷新恢复和失败重试，本地后端可保存用户主动提交的完整提示词；界面首次提交前必须告知会发送并在本机保存。默认保留 30 天，启动和新增任务时清理超期终态记录；运行中任务不自动清理。公开多用户部署需要改为带 userId、加密和服务端保留策略的数据存储，不能直接复用本地 JSON 文件。

## 12. 安全、费用与隐私

### 12.1 凭据

- 使用现有供应商配置读取胜算云 Key；
- Key 不返回前端，不写日志，不进入错误消息；
- 上游错误正文进入日志前做 Bearer、URL query 和常见 key 格式脱敏；
- 公网站 BYOK 若实现，只保存在服务端内存或加密短会话中，并提供立即清除能力。

### 12.2 访问与滥用控制

- 服务端限制单批条数、提示词长度、请求体大小；
- 按 AO Web Token / 用户会话限流；
- 共享额度模式必须增加单用户日额度和全局熔断；
- callback URL 不能由普通前端请求任意指定，防止 SSRF；
- 下载代理只允许已知 run 的已知 artifact URL；
- 不跟随产物下载到私网地址。

### 12.3 费用保护

- 没有成功 precheck 不允许提交；
- 余额不足禁止提交；
- 配置或条目变化使 quote 失效；
- 页面明确区分“预计费用”和“实际费用”；
- 超过可配置阈值时增加二次确认；
- 所有提交必须有幂等键；
- 网络超时展示“提交结果待确认”，不能让用户直接再次付费提交。

### 12.4 内容与隐私提示

提交前说明：选中的提示词及必要元数据会发送给胜算云和实际模型服务商处理。不得把作者 URL、站内用户标识、搜索历史等无关信息发送给上游。

## 13. 错误处理

| 场景 | 用户提示 | 系统行为 |
|---|---|---|
| 未配置 Key | 请先配置胜算云 | 跳转/打开供应商配置 |
| 服务不可用 | 批量服务暂时不可用 | 保留选择，允许稍后重试 |
| schema 不兼容 | 批量模板已更新，正在等待适配 | 禁止提交，记录版本 |
| 条目校验失败 | 显示具体第几条、哪个字段 | 其余选择不丢失 |
| 余额不足 | 显示预计费用和余额差额 | 禁止提交，提供充值链接 |
| 提交超时 | 提交结果待确认 | 使用原幂等键查询/重试 |
| 部分失败 | X 条成功，Y 条失败 | 展示原因并允许仅重试失败项 |
| 轮询断网 | 暂时无法更新进度 | 不改变远端状态，自动退避 |
| 签名 URL 过期 | 正在刷新下载地址 | 重新请求 artifacts |
| 未知上游状态 | 状态更新中 | 归一化为 unknown，继续查询 |

上游原始错误不能直接整段展示。UI 显示可操作信息，详情中可提供脱敏错误码和 runId 供客服定位。

## 14. 埋点与合作归因

建议事件：

| 事件 | 关键参数 |
|---|---|
| `creative_batch_enter` | category, query_present, source |
| `creative_batch_select` | prompt_id, category, selected_count |
| `creative_batch_config_open` | selected_count |
| `creative_batch_precheck` | selected_count, model, prompt_mode, result |
| `creative_batch_submit` | selected_count, model, estimated_cost, result |
| `creative_batch_progress_open` | run_status |
| `creative_batch_complete` | total, completed, failed, actual_cost |
| `creative_batch_retry_failed` | failed_count |
| `creative_batch_download` | scope: single/all |
| `sponsor_click` | id: shengsuanyun, from: creative-batch |

禁止上报：完整提示词、API Key、runId 全文、产物签名 URL、错误响应全文。

合作归因优先由胜算云提供服务端渠道字段；如果只能依赖注册链接参数，只能衡量注册转化，无法可靠衡量批量任务用量。

## 15. 无障碍与响应式要求

- 所有复选框可通过键盘操作；
- 卡片选中状态不能只靠颜色，必须有勾选图标和 `aria-checked`；
- 抽屉打开后焦点移入，关闭后回到触发按钮；
- 进度更新使用非打断式 `aria-live="polite"`；
- 错误与费用不能仅靠红色/绿色区分；
- 移动端吸底栏考虑 `env(safe-area-inset-bottom)`；
- 320px 宽度下不能横向溢出；
- 中英文文案均需验证，不允许按钮因英文变长而截断关键动作。

## 16. 建议代码结构

```text
website/src/
  components/creative-batch/
    BatchEntryButton.tsx
    BatchSelectionBar.tsx
    BatchConfigDrawer.tsx
    BatchRunPanel.tsx
    BatchResultGrid.tsx
    BatchProviderCredit.tsx
    useBatchSelection.ts
    useBatchRun.ts
  lib/
    batch.ts                 # 类型、状态归一化、API client
  pages/
    CreativeLibrary.tsx     # 只负责组合，不堆积全部状态机

web/
  batch/
    shengsuanyun.js         # 上游适配器
    store.js                 # run 快照/映射
  server.js                 # 路由注册

test/
  batch-shengsuanyun.ts
  creative-batch.ts
```

不要继续把整套批量逻辑直接写进已经较大的 `CreativeLibrary.tsx`。供应商适配器必须隔离上游字段和状态；UI 只消费 AO 内部契约。

## 17. 实施阶段

### Phase 0：接口确认与真机探测

本地 UI 演示使用 `AO_SSY_BATCH_DEMO=1` 显式标记。演示产物必须醒目标注为占位图，并说明选择对象是提示词文本、卡片案例图不会作为参考图发送，避免用户把演示结果或重新生成结果误认为案例图复刻。

仓库提供不创建生成任务的联调探针。它只调用 `health`、模板 `schema`、`validate-rows` 和 `precheck-rows`，报告不会输出 API Key、完整上游响应或签名 URL：

```bash
SHENGSUANYUN_API_KEY='...' \
AO_SSY_BATCH_TEMPLATE_ID='双方确认的模板 ID' \
AO_SSY_BATCH_PROMPT_FIELD='schema 中的稳定 key 或 label' \
npm run probe:ssy-batch
```

机器可读输出使用 `npm run probe:ssy-batch -- --json`。探针通过仅代表鉴权、模板字段和费用预估链路成立，不代表 `submit` 幂等性、异步状态和产物接口已经验收；这些仍需使用合作方测试额度完成最小付费样本。

- 获得测试 Token 和专属模板 ID；
- 拉取模板 schema 并保存脱敏样本；
- 验证 passthrough；
- 验证 2 条提示词完整流程；
- 核对费用单位、失败收费、产物有效期；
- 核对相同幂等键的真实行为；
- 明确最大批量和限流。

退出条件：第 20 节 P0 问题全部关闭。

### Phase 1：后端适配与测试

- capability、precheck、submit、run、items、artifacts；
- Token 读取与错误脱敏；
- 状态归一化；
- run 映射持久化；
- 假上游契约测试；
- 真机 smoke test。

在 P0 契约尚未齐备时，Phase 1 可以完成适配器、内部接口、持久化和假上游测试，但总开关保持关闭；不得使用猜测的模板 ID、字段标签或模型参数开启生产入口。

### Phase 2：前端选择与配置

- 页面级入口；
- 卡片选择模式；
- 吸底栏；
- 配置抽屉；
- 校验和费用预估；
- 埋点。

### Phase 3：进度与结果

- 轮询和刷新恢复；
- 逐条错误；
- 产物预览与下载；
- 失败项重试；
- 任务历史最小入口。

### Phase 4：灰度上线

- feature flag 默认关闭；
- 仅维护者测试账号开启；
- 限制最多 3 条；
- 观察成功率、重复提交、预估与实际费用差；
- 扩至 10 条、24 条；
- 最后开放给全部符合认证条件的用户。

## 18. 测试计划

### 18.1 单元测试

- 金额单位转换不丢精度；
- 上游状态到内部状态映射；
- 未知状态处理；
- sourceRowIndex 到 promptId 映射；
- quote 失效规则；
- 幂等键复用规则；
- 错误信息脱敏；
- 选择上限和跨分页选择。

### 18.2 后端契约测试

使用本地假上游覆盖：

- health 正常/异常；
- schema 字段变化；
- validate 行错误；
- 余额不足；
- submit 成功、超时、同键重复；
- pending → running → completed；
- 部分任务失败；
- artifacts 空、多个、URL 过期；
- 上游 401、429、500、非 JSON 响应；
- Token 不出现在响应和日志。

### 18.3 前端测试

- 选择、取消、全选本页；
- 搜索/分类/翻页后选择保留；
- 原按钮不误触选择；
- 修改配置后 quote 失效；
- 提交按钮防双击；
- 刷新后恢复 run；
- 页面隐藏时轮询降频；
- 部分成功页面；
- 中英文和移动端；
- 键盘与焦点管理。

### 18.4 真机验收

至少完成以下付费小样本：

1. 1 条成功；
2. 2 条全部成功；
3. 1 条故意触发内容拒绝；
4. 提交响应超时后的幂等恢复；
5. 刷新页面恢复进度；
6. 签名 URL 过期后重新获取；
7. 失败项重试只生成新子 run；
8. 预估费用与实际费用差异在可解释范围内。

## 19. 上线验收标准

必须全部满足：

- [ ] 普通浏览模式不增加常驻卡片视觉噪音；
- [ ] 用户能选择 1～上限条提示词；
- [ ] 默认使用原提示词，不静默改写；
- [ ] 提交前成功校验并显示预计费用；
- [ ] 余额不足时无法提交；
- [ ] 快速重复点击不会创建两个远端任务；
- [ ] 提交超时不会引导用户换新幂等键重交；
- [ ] 任务刷新后可恢复；
- [ ] 逐条成功、失败和原因可见；
- [ ] 失败项可单独重试；
- [ ] 产物可下载，过期 URL 可刷新；
- [ ] API Key、完整提示词和签名 URL不进入埋点；
- [ ] 中英文、桌面和移动端通过验收；
- [ ] 胜算云品牌标注和渠道归因符合双方约定；
- [ ] 现有单张生成、复制、筛选和懒加载不回归。

## 20. 需要胜算云确认的问题

### P0：未确认不能上线

1. 是否提供提示词原样透传的专属模板？模板 ID 和版本策略是什么？
2. 专属模板的 schema、稳定字段和合法枚举是什么？
3. 同一 `idempotencyKey` 重复提交的精确响应和保留时间是什么？
4. 单批最大行数、并发数、QPS 和 429 重试策略是什么？
5. 失败任务是否收费？内容审核拒绝、模型失败、平台失败分别如何计费？
6. `precheck` 金额是否包含全部步骤，预计和实际可能产生多大偏差？
7. Token 是否可同时用于 router API 与 LoomLoom Batch API？
8. 产物和任务记录保留多久？签名 URL 有效期多久？
9. 是否有测试环境或专门测试额度？
10. 用户认证采用 BYOK、授权登录还是项目共享额度？

### P1：可以首期后补

1. 是否支持 callback，签名算法和重放保护是什么？
2. 是否支持服务端渠道归因字段和用量报表？
3. 是否支持取消运行中的整批或单项任务？
4. 是否支持每条生成多张及固定 seed？
5. 是否能回传优化后的最终提示词？
6. 是否能直接生成整批 ZIP？

## 21. 成功指标

首月关注：

- 批量入口点击率；
- 进入选择后完成提交的转化率；
- precheck 成功率；
- submit 成功率；
- 批任务全部成功率和逐条成功率；
- 重复提交率，目标为 0；
- 预估与实际费用偏差；
- 结果下载率；
- 胜算云注册点击与可归因注册数；
- 单张生成与提示词复制率是否受到负面影响。

不以单纯曝光量作为合作成功指标；优先看真实提交、成功产物和用户复用。

## 22. 后续扩展

首期稳定后再评估：

- Excel / CSV 导入；
- 在批量配置中逐条编辑提示词；
- 参考图上传和图生图；
- 多模型 A/B 对比；
- 每条多变体；
- 图片 → 视频批量流水线；
- 工作台统一任务中心；
- 团队任务和额度控制；
- 自定义 LoomLoom 工作流市场。

## 23. 推荐的第一步

在写业务代码前，先由双方完成一份最小契约样例：

1. 专属模板的真实 `GET schema` 响应；
2. 2 行 `validate-rows` 请求与响应；
3. 同一数据的 `precheck-rows` 响应；
4. `submit-rows` 响应；
5. 完成、部分失败各一份 run/tasks/artifacts 响应；
6. 相同幂等键重复提交的两次响应；
7. 费用和失败计费的书面说明。

拿到这些样本后先实现后端适配器和假上游测试，再开始前端。这样 UI 不会围绕猜测的字段返工，也能在花真实额度前验证重复扣费风险。
