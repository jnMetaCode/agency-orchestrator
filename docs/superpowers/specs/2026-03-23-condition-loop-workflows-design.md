# 条件分支 + 循环迭代 + 部门协作模板

> 让 agency-orchestrator 从演示工具升级为真实可用的多部门协作引擎。

## 背景

当前引擎支持串行/并行 DAG 执行、变量传递、审批节点。但缺少条件分支和循环迭代，无法表达"按类型分流"和"审核不通过打回重做"这两类最常见的真实业务流程。

## 目标

1. 引擎支持条件分支（`condition`）
2. 引擎支持循环迭代（`loop`）
3. 用新能力编写 5 个部门协作工作流模板

## 非目标

- 子工作流嵌套（F10）
- Webhook 回调（F11）
- Web UI（F13）
- MCP Server（F14）

---

## 设计

### 1. 条件分支

#### 类型变更

`StepDefinition` 新增字段：

```typescript
condition?: string;  // 如 "{{category}} contains bug"
depends_on_mode?: 'all' | 'any_completed';  // 默认 'all'
```

#### 条件语法

支持两种运算符：

```
{{变量名}} contains 关键词     # 子串模糊匹配
{{变量名}} equals 关键词       # 精确匹配（用于 approval 等短输出）
```

- 大小写不敏感
- 关键词前后空格自动 trim
- 关键词如包含空格，用引号包裹：`{{var}} contains "bug fix"`
- LLM 输出天然不可控，模糊匹配是主要判断方式；`equals` 用于 approval 等可控输出

#### 跳过语义

当一个步骤被 `condition` 跳过时，其所有下游步骤也被跳过（`markDownstreamSkipped`）。

如果一个步骤有多个依赖（`depends_on: [A, B]`），只要任一依赖被跳过或失败，该步骤也跳过。这是"任一失败即跳过"语义，与当前引擎行为一致。

**例外：汇总节点**。故障响应等模板中，复盘汇总依赖多个条件分支步骤，但这些分支互斥（只有一个会执行）。对此类场景，使用 `depends_on_mode: any_completed`：

```yaml
  - id: postmortem
    depends_on: [branch_a, branch_b, branch_c]
    depends_on_mode: any_completed  # 只要有一个分支完成就执行
```

`depends_on_mode` 支持两种值：
- `all`（默认）：任一依赖被跳过或失败 → 该步骤也跳过
- `any_completed`：只有当所有依赖都被跳过/失败时才跳过；只要有一个完成就执行

互斥分支步骤应写入相同的 `output` 变量名，下游汇总节点通过变量读取结果。

#### 执行逻辑

在 `executeStep` 之前插入条件检查：

1. 渲染条件字符串中的 `{{变量}}`
2. 解析 `contains` 或 `equals` 运算符
3. 不满足 → 标记 `skipped`，触发 `markDownstreamSkipped`
4. 满足 → 正常执行

#### 新文件

`src/core/condition.ts`：

```typescript
export function evaluateCondition(
  condition: string,
  context: Map<string, string>
): boolean;
```

- 先用 `renderTemplate` 替换变量
- 解析 `<text> contains <keyword>` 格式
- 返回 boolean

### 2. 循环迭代

#### 类型变更

`StepDefinition` 新增字段：

```typescript
loop?: {
  back_to: string;          // 跳回的步骤 id
  max_iterations: number;   // 最大循环次数，必填
  exit_condition: string;   // 退出条件，同 condition 语法
};
```

#### 关键架构决策：`loop.back_to` 不是 DAG 边

`loop.back_to` 是**运行时元数据**，不作为 `depends_on` 依赖加入 DAG。DAG 仍然是无环的，`buildDAG` 和 `topologicalLevels` 不受影响。循环是执行器层面的控制流，不改变图结构。

#### 执行模型：内层循环

当前 `executeDAG` 按 `dag.levels`（拓扑层）逐层前进。循环在这个结构上用**内层循环**实现：

```
伪代码:
for each level in dag.levels:
  for each batch in level (按 concurrency 分批):
    执行 batch 中所有步骤
    for each completed step in batch:
      if step.loop exists:
        iteration = 0
        while not evaluateCondition(exit_condition) AND iteration < max_iterations:
          iteration++
          // 重置 back_to 到当前步骤之间的所有节点状态
          resetRange(dag, step.loop.back_to, step.id)
          // 重新执行这段子图（back_to 所在 level 到当前 level）
          re-execute levels[back_to_level .. current_level]
```

具体地，在 `executeDAG` 的主循环中，当一个步骤带有 `loop` 字段时：

1. 检查 `exit_condition`：满足 → 正常继续后续 level
2. 不满足且 iteration < `max_iterations` → 找到 `back_to` 步骤所在的 level index，重置该范围内所有节点为 `pending`，用 `goto` 风格跳回该 level 重新执行
3. 达到 `max_iterations` → 强制退出，用最后一版输出继续

实现上，将 `for (const level of dag.levels)` 改为 `while (levelIndex < dag.levels.length)` 索引循环，循环时将 `levelIndex` 回退到 `back_to` 所在层。

#### stepResults 累积策略

循环中同一步骤多次执行，`stepResults` 采用**覆盖策略**：每次执行覆盖之前同 ID 的记录。最终 `WorkflowResult.steps` 中每个 step ID 只有一条记录（最后一次执行的结果）。这确保 `success` 判断不被中间迭代的旧结果干扰。

额外添加 `iterations` 字段到 `StepResult`：

```typescript
iterations?: number;  // 该步骤实际执行次数（循环场景 > 1）
```

#### 内置变量

循环执行时注入 `{{_loop_iteration}}` 变量到 context，值为当前迭代次数（从 1 开始）。循环结束后移除。

#### 变量覆盖

循环步骤的 `output` 写回 context 时覆盖同名变量。这是设计意图——每轮迭代产出新版本。

#### 约束与验证

- `back_to` 必须引用一个存在的步骤 ID — 在 `parser.ts` 中验证
- `back_to` 必须指向当前步骤的上游（DAG 中的祖先节点）— 在 `dag.ts` 的 `buildDAG` 中验证（此时才有拓扑信息）
- `back_to` 和当前步骤必须在同一条执行链上
- `max_iterations` 必填且 >= 1，引擎强制上限 10 兜底
- 不合法则报错并拒绝执行

### 3. 部门协作工作流模板

5 个 YAML 文件放入 `workflows/department-collab/` 子目录，与现有演示模板区分：

#### 3.1 hiring-pipeline.yaml（招聘评估）

```
简历筛选(HR) → 岗位分类
  ├─ 技术岗 → 技术面评估(架构师)
  └─ 非技术岗 → 业务面评估(PM)
→ 薪酬方案(HR) → 最终审批(approval)
```

角色：HR专家、软件架构师、产品经理
新能力：条件分支（技术/非技术岗走不同路径）

#### 3.2 content-publish.yaml（内容发布）

```
选题策划(内容创作者) → 文案撰写(文案) → 品牌审核(品牌守护者)
  → [不通过则打回修改，最多 3 轮]
→ 法务合规审核(法务) → 发布清单
```

角色：内容创作者、文案、品牌守护者、法务合规员
新能力：循环迭代（品牌审核不通过打回）

#### 3.3 incident-response.yaml（故障响应）

```
故障分类(SRE) →
  ├─ 后端故障 → 后端架构师分析
  ├─ 前端故障 → 前端开发分析
  └─ 基础设施故障 → 运维分析
→ 复盘汇总(SRE)
```

角色：SRE、后端架构师、前端开发者、基础设施运维师
新能力：条件分支（按故障类型三路分流）

#### 3.4 marketing-campaign.yaml（营销活动）

```
市场调研(数据分析师) → 创意策划(内容创作者) → 预算审批(approval, output: approval_result)
  → 投放方案(社交媒体策略师, condition: "{{approval_result}} contains yes")
  → 效果分析(数据分析师, condition: "{{approval_result}} contains yes")
```

审批节点需设置 `output: approval_result` 将用户输入存入变量，下游步骤用 `condition` 判断是否继续。审批不通过则后续步骤全部跳过。

角色：数据分析师、内容创作者、社交媒体策略师
新能力：审批节点 + 条件分支（approval output → condition 联动）

#### 3.5 code-review.yaml（代码评审）

```
架构评审(架构师) ┐
安全评审(安全工程师) ├─ 并行
性能评审(性能专家) ┘
→ 汇总(代码审查员) → [不通过则打回重审，最多 2 轮]
```

角色：软件架构师、安全工程师、性能基准师、代码审查员
新能力：循环迭代（评审不通过打回）

---

## 改动范围

| 文件 | 变更 |
|------|------|
| `src/types.ts` | `StepDefinition` 加 `condition` 和 `loop` 字段 |
| `src/core/condition.ts` | 新文件：条件解析和求值 |
| `src/core/executor.ts` | 条件检查 + 循环执行逻辑 |
| `src/core/parser.ts` | 验证 `loop.back_to` 引用存在的步骤 ID、`max_iterations` 合法 |
| `src/core/dag.ts` | `formatDAG` 显示条件和循环信息 |
| `workflows/department-collab/*.yaml` | 5 个新模板 |
| `test/` | 条件分支和循环的单元测试 |

## 风险

1. **LLM 输出不可控** — `contains` 模糊匹配是缓解手段，但极端情况仍可能误判。模板文档需提示用户写清楚 task prompt 要求输出格式。
2. **循环死循环** — `max_iterations` 必填，引擎强制上限兜底。
3. **循环中变量污染** — 每轮循环覆盖同名变量是设计意图，但用户可能误解。文档需说明。
