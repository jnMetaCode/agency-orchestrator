# AO Web 端设计需求文档

## 一、现有页面清单

现有 3 个 HTML 页面 + 1 个后端：

| 文件 | 定位 | 说明 |
|------|------|------|
| `web/index.html` | **主控台** | 团队中心 / 专家中心 / 运行历史，可运行工作流、与专家对话 |
| `web/demo.html` | **营销落地页** | 暗色终端风格，8 个场景的模拟动画演示（纯前端，无真实调用） |
| `.local/web/viewer.html` | **回放播放器** | 读取 `ao-output/` 已完成的运行结果，逐步打字机回放（录屏用） |
| `web/server.js` | **后端** | Express，端口 8088，提供 REST + SSE API |

---

## 二、后端 API 清单（server.js 已实现）

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/workflows` | 列出所有工作流（内置 + private），含 steps/inputs 元数据 |
| GET | `/api/workflows/yaml?file=` | 返回指定工作流的 YAML 原文 |
| POST | `/api/run` | 运行工作流（SSE 流式），支持 resume/fromStep |
| GET | `/api/roles` | 列出所有角色（211 个），含分类/名称/描述/颜色 |
| GET | `/api/roles/:category/:id` | 获取单个角色详情（含完整 system prompt） |
| POST | `/api/run-role` | 单角色对话（SSE 流式），后端自动生成临时单步 workflow |
| GET | `/api/runs` | 列出运行历史（从 ao-output/ 读取） |
| GET | `/api/runs/:id` | 获取单次运行详情（含每步输出内容） |
| GET | `/api/health` | 健康检查 |

### SSE 事件类型（工作流运行）

| event | data 字段 | 说明 |
|-------|-----------|------|
| `start` | cmd, resume, fromStep | 运行启动 |
| `step-start` | emoji, name | 步骤开始执行 |
| `step-header` | cur, total, emoji, name, id | 步骤头信息（含序号） |
| `step-content` | id, text | 步骤内容流式输出（逐行） |
| `step-done` | id, meta | 步骤完成（含耗时/token 统计） |
| `workflow-summary` | text | 工作流总结行 |
| `stdout` | text | 原始终端输出 |
| `stderr` | text | 错误输出 |
| `done` | code, signal | 进程退出 |
| `error` | message | 运行出错 |

### SSE 事件类型（单角色对话）

| event | data 字段 | 说明 |
|-------|-----------|------|
| `start` | cmd, task | 启动 |
| `content` | text | 内容流式输出（逐行） |
| `step-done` | meta | 完成（耗时/token） |
| `done` | code, signal, content | 进程退出 |
| `error` | message | 出错 |

---

## 三、现有功能模块（index.html 主控台）

### 3.1 团队中心（Workflows）

**数据源**：`/api/workflows`

**功能**：
- 卡片网格展示所有工作流，每张卡片显示：名称、描述、参与角色 chips（最多 5 个 + more）、步骤数、private 标签
- 分类 tab：全部 / 内置模板 / 我的团队（private）
- 搜索过滤（按名称+描述）
- 最近运行快速入口（横向滚动卡片，最多 8 条）
- 卡片顶部有渐变色条区分

**运行面板**（点击卡片弹出 overlay）：
- 顶部：步骤 chips 进度条（pending → running → done）
- 输入表单：根据 workflow 的 inputs 自动生成（input/textarea），支持 localStorage 记忆上次输入
- 操作栏：运行 / 清空 / 停止 / 查看 YAML
- 双视图 tab：
  - **结果视图**：步骤卡片（可展开/折叠），每步支持复制、下载、从此步重跑
  - **终端视图**：原始 CLI 输出（暗色终端样式）
- 完成后显示"最终交付"卡片（渐变背景），含步骤统计 + 导出全部按钮
- Resume 支持：从历史记录可直接 `resumeFrom(file, stepId)`

### 3.2 专家中心（Roles）

**数据源**：`/api/roles` + `/api/roles/:category/:id`

**功能**：
- 卡片网格，每张卡片：头像（人物 emoji，基于角色 ID 稳定 hash）、名称、分类标签（带颜色）、描述（最多 3 行）
- 分类 tab：全部 + 按行业分类（市场营销/工程开发/设计/财务金融…共 18 个分类）
- 搜索过滤

**角色详情 Modal**（点击卡片弹出）：
- 上半部：头像 + 名称 + 分类 + 描述 + 可展开的完整能力说明（Markdown 渲染）
- 下半部：多轮对话交互
  - 输入框 + 发送/停止按钮
  - 对话气泡：用户消息（紫色背景右侧）/ AI 回复（白色背景左侧，流式打字）
  - 多轮上下文：前端将历史 Q&A 拼入 prompt
  - 完成后显示复制按钮，按钮文字变为"继续追问"

### 3.3 运行历史（History）

**数据源**：`/api/runs` + `/api/runs/:id`

**功能**：
- 表格展示：状态、团队名、步骤完成数、耗时、Token 用量、时间、查看详情链接
- 搜索过滤
- 详情 Modal：
  - 状态/耗时/Token 统计
  - 时间分布条（彩色分段，按步骤耗时占比）
  - 步骤卡片列表（可展开/折叠，默认展开最后一步）
  - 每步支持"从此步重跑"

### 3.4 全局元素

- **导航栏**（sticky）：Logo + 三个页面 tab + 状态徽章（就绪/运行中/完成/错误，带脉冲动画）+ Provider 选择器
- **Provider 选择**：claude-code（默认）/ deepseek / openclaw-cli / gemini-cli
- **键盘快捷键**：Cmd+Enter 运行、Esc 停止/关闭
- **YAML 预览 Modal**：代码高亮显示工作流 YAML

---

## 四、回放播放器（viewer.html）

**用途**：读取 `ao-output/` 目录的已完成运行，逐步打字机回放，用于录屏/演示

**数据源**：直接 fetch `ao-output/` 目录（需静态服务），不走 server.js API

**功能**：
- **开场动画**：工作流名称 → 角色 chips 逐个浮现 → "老板任务"卡片 → "开始协作"按钮 → 加载序列
- **左侧 DAG 面板**（可折叠）：节点列表，显示状态（pending/active/completed）+ 连接线 + 计时器，点击可跳转
- **主区域**：步骤卡片逐张出现，内容打字机效果，实时 Markdown 渲染
- **底部控制栏**：运行记录选择器 + 暂停/继续 + 速度控制（1x/2x/4x/8x）
- **结束画面**：成果总览卡片，自动提取关键数据（产品名、Slogan、决策、盈亏平衡等）
- **竖屏模式**（`?mode=portrait`）：隐藏侧边栏，顶部显示当前发言人 banner + 水平 DAG 进度点
- **顶部进度条**：全局进度

---

## 五、营销演示页（demo.html）

**用途**：无需后端的纯前端模拟演示，用于官网/推广

**功能**：
- Hero 区：标题「一个人扛一家公司？10 个 AI 专家组队帮你干活」+ 安装命令 + 复制按钮
- 场景选择 chips（8 个）：小红书爆款 / 投资分析 / 简历面试 / 法律咨询 / 商业验证 / 产品冷启动 / 个人 IP / 抖音口播 / SaaS 定价
- 终端模拟（仿 macOS 终端窗口）：
  - 命令行打字动画
  - 步骤逐个执行（pending → running → done）
  - 每步显示 emoji + 角色名 + 耗时 + 产出摘要
  - 执行总结
  - 最终交付（Markdown 渲染的完整方案）
- 速度控制：快(0.5x) / 正常(1x) / 慢(2x)
- 底部特性展示：211+ 角色 / 10 种大模型 / DAG 自动并行 / Zero 代码

---

## 六、技术栈现状

- **前端**：纯 HTML + CSS + Vanilla JS（无框架），依赖 CDN 的 marked.js（Markdown 渲染）
- **后端**：Express + js-yaml，通过 `child_process.spawn` 调用 `ao` CLI
- **通信**：SSE（Server-Sent Events）流式传输
- **持久化**：localStorage（输入记忆）、文件系统（ao-output/）
- **样式**：CSS Variables 主题，index.html 白色主题，demo.html/viewer.html 暗色主题

---

## 七、数据模型

### Workflow 对象
```json
{
  "file": "/absolute/path/to/workflow.yaml",
  "filename": "workflow.yaml",
  "name": "工作流名称",
  "description": "描述",
  "inputs": [{ "name": "var", "description": "说明", "required": true, "default": "" }],
  "steps": [{ "id": "step_id", "role": "category/role-name", "name": "显示名", "emoji": "🤖" }],
  "provider": "deepseek",
  "private": false
}
```

### Role 对象
```json
{
  "id": "role-filename",
  "category": "marketing",
  "categoryName": "市场营销",
  "name": "角色中文名",
  "description": "一句话描述",
  "color": "#hex 或 named color",
  "content": "完整 Markdown system prompt（仅详情接口返回）"
}
```

### Run 历史对象
```json
{
  "id": "WorkflowName-2026-04-15T10-30-00",
  "name": "工作流名称",
  "success": true,
  "duration": "86.6s",
  "tokens": { "input": 8000, "output": 4000 },
  "stepCount": 4,
  "completedCount": 4,
  "steps": [{
    "id": "step_id",
    "status": "completed",
    "agentName": "角色名",
    "agentEmoji": "🤖",
    "duration": "22.1s",
    "tokens": { "input": 2000, "output": 1000 },
    "content": "Markdown 输出内容"
  }]
}
```

---

## 八、待设计/改进方向（供参考）

1. **统一技术栈**：现在三个 HTML 各自独立，考虑统一为 SPA（React/Vue/Svelte）
2. **暗色/亮色主题**：index.html 是亮色，demo/viewer 是暗色，需要统一的主题系统
3. **移动端适配**：现有 UI 主要面向桌面
4. **实时 DAG 可视化**：当前运行面板只有 chips，缺乏 DAG 图形化展示（viewer.html 有但主控台没有）
5. **角色对话增强**：当前多轮靠前端拼 prompt，可考虑后端维护会话状态
6. **通知/提醒**：长时间运行的工作流完成后缺乏通知
7. **输出管理**：ao-output 只能查看不能删除/归档/标注
8. **Compose 模式**：后端目前只支持 `ao run`，未暴露 `ao compose --run`（一句话自动编排）
