# v0.3 — AI 编程助手多智能体编排引擎 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 agency-orchestrator 从 31★ 小工具打造为 AI 编程工具的标配多智能体编排层

**Architecture:** 三阶段交付——v0.3.0 扩入口（工具集成 + 模板）、v0.3.1 提体验（explain + watch）、v0.3.2 开国际（MCP + 英文角色）

**Tech Stack:** TypeScript, Node.js readline (init), ANSI escape codes (watch), MCP stdio protocol (v0.3.2)

---

## 阶段一：v0.3.0 — 扩入口

### Task 1: Kiro 集成

**Files:**
- Create: `integrations/kiro/README.md`
- Create: `integrations/kiro/ao-workflow-runner.md`

**Context:** Kiro 使用 `.kiro/steering/*.md` 文件作为 AI 指导。格式参考已有的 `integrations/cursor/workflow-runner.mdc`，但去掉 Cursor 特有的 frontmatter，改为 Kiro 的纯 Markdown 格式。Kiro 支持三种模式：always（始终加载）、globs（按文件匹配）、手动。workflow-runner 应设为手动模式（用户主动调用）。

- [ ] **Step 1: 创建 Kiro steering 文件**

```markdown
# Agency Orchestrator — Workflow Runner

当用户要求运行 YAML 工作流或多角色协作任务时，按以下步骤执行：

## 1. 解析工作流
读取指定的 YAML 文件，提取 name、inputs、steps、depends_on、conditions、loops。

## 2. 收集输入
- `required: true` 的输入必须由用户提供
- 有 `default` 的可选输入使用默认值
- 无默认值的可选输入设为空字符串

## 3. 构建执行顺序
按 `depends_on` 拓扑排序。无依赖的步骤属于同一层级，可并行执行。

## 4. 执行步骤
对每个步骤：
1. 读取 `agency-agents-zh/{role}.md`（搜索顺序：YAML 的 agents_dir → ./agency-agents-zh/ → ../agency-agents-zh/ → node_modules/agency-agents-zh/）
2. 提取 frontmatter 后的全部 markdown 内容作为角色人格
3. 将 task 中的 `{{variables}}` 替换为上下文值
4. 如设了 `condition`，评估条件，不满足则跳过
5. 完全化身该角色——使用角色的专业知识、框架和沟通风格
6. 将输出存入上下文变量
7. 如设了 `loop` 且未满足退出条件，跳回 `loop.back_to`

标注每步：`### Step N/Total: step_id (角色名)`

## 5. 保存结果
保存所有输出到 `ao-output/{workflow-name}-{date}/`

## 6. 建议迭代
完成后告知用户可以重跑某一步。CLI: `ao run <workflow> --resume last --from <step-id>`

## 重要规则
- 每步必须真正化身角色——不能泛泛而谈
- 严格按拓扑顺序执行，不跳步不合并
- 角色文件缺失时提示安装 agency-agents-zh
- 条件不满足时标记为 "skipped" 并继续
```

Save to `integrations/kiro/ao-workflow-runner.md`

- [ ] **Step 2: 创建 Kiro 集成说明**

创建 `integrations/kiro/README.md`，说明安装和使用方式：
1. 复制 `ao-workflow-runner.md` 到项目的 `.kiro/steering/` 目录
2. 安装 agency-agents-zh（`ao init` 或 git clone）
3. 在 Kiro 中使用自然语言或指定 YAML 文件触发

- [ ] **Step 3: 验证文件结构**

```bash
ls integrations/kiro/
# 预期: README.md  ao-workflow-runner.md
```

- [ ] **Step 4: Commit**

```bash
git add integrations/kiro/
git commit -m "feat: add Kiro integration (steering file + docs)"
```

---

### Task 2: Trae 集成

**Files:**
- Create: `integrations/trae/README.md`
- Create: `integrations/trae/ao-workflow-runner.md`

**Context:** Trae（字节跳动 AI IDE）使用 `.trae/rules/*.md` 作为项目级规则。格式与 Kiro 类似，但需要适配 Trae 的规则系统。Trae 是国内最大的 AI IDE，必须优先支持。

- [ ] **Step 1: 创建 Trae rules 文件**

内容与 Task 1 Step 1 相同（workflow-runner 的核心逻辑是通用的），但文件头注释改为 Trae 格式。

Save to `integrations/trae/ao-workflow-runner.md`

- [ ] **Step 2: 创建 Trae 集成说明**

创建 `integrations/trae/README.md`：
1. 复制 `ao-workflow-runner.md` 到 `.trae/rules/`
2. 安装 agency-agents-zh
3. 使用方式

- [ ] **Step 3: Commit**

```bash
git add integrations/trae/
git commit -m "feat: add Trae integration (rules file + docs)"
```

---

### Task 3: Gemini CLI 集成

**Files:**
- Create: `integrations/gemini-cli/README.md`
- Create: `integrations/gemini-cli/GEMINI.md`

**Context:** Gemini CLI 使用项目根目录的 `GEMINI.md` 或 `AGENTS.md` 文件。格式是标准 Markdown。需要提供一段可以追加到用户现有 `GEMINI.md` 的内容。

- [ ] **Step 1: 创建 GEMINI.md 片段**

内容包含 workflow-runner 核心逻辑，但开头加说明：

```markdown
<!-- 将以下内容追加到项目根目录的 GEMINI.md -->

## Agency Orchestrator — 多角色工作流执行

[workflow-runner 核心逻辑同 Task 1]
```

- [ ] **Step 2: 创建集成说明 README.md**

- [ ] **Step 3: Commit**

```bash
git add integrations/gemini-cli/
git commit -m "feat: add Gemini CLI integration"
```

---

### Task 4: Codex CLI + DeerFlow + Antigravity 集成

**Files:**
- Create: `integrations/codex/README.md`
- Create: `integrations/codex/instructions.md`
- Create: `integrations/deerflow/README.md`
- Create: `integrations/deerflow/SKILL.md`
- Create: `integrations/antigravity/README.md`
- Create: `integrations/antigravity/AGENTS.md`

**Context:** 三个工具的集成模式相似，合并为一个 Task。
- Codex CLI (OpenAI): `.codex/instructions.md`
- DeerFlow 2.0 (字节): `skills/custom/ao-runner/SKILL.md`，DeerFlow 自动发现 SKILL.md
- Antigravity: `GEMINI.md` 或 `AGENTS.md`

- [ ] **Step 1: 创建 Codex 集成文件**

`integrations/codex/instructions.md` — workflow-runner 核心逻辑

- [ ] **Step 2: 创建 DeerFlow 集成文件**

`integrations/deerflow/SKILL.md` — 需要 DeerFlow 的 SKILL.md frontmatter 格式：
```yaml
---
name: ao-workflow-runner
description: 多角色 YAML 工作流执行引擎
---
```

- [ ] **Step 3: 创建 Antigravity 集成文件**

`integrations/antigravity/AGENTS.md` — workflow-runner 核心逻辑

- [ ] **Step 4: 为每个工具创建 README.md**

- [ ] **Step 5: Commit**

```bash
git add integrations/codex/ integrations/deerflow/ integrations/antigravity/
git commit -m "feat: add Codex, DeerFlow, Antigravity integrations"
```

---

### Task 5: `ao init --workflow` 交互式创建 workflow

**Files:**
- Create: `src/cli/init-workflow.ts`
- Modify: `src/cli.ts` — 扩展 `handleInit()` 支持 `--workflow` flag

**Context:** 当前 `ao init` 只下载 agents-zh。新增 `ao init --workflow` 让用户通过问答式交互创建 workflow YAML。使用 Node.js 内置 `readline`，不引入第三方 TUI 库。

- [ ] **Step 1: 写 init-workflow 的测试**

```typescript
// test/cli/init-workflow.test.ts
import { generateWorkflowYaml } from '../../src/cli/init-workflow.js';

describe('generateWorkflowYaml', () => {
  it('should generate valid YAML with given options', () => {
    const yaml = generateWorkflowYaml({
      name: '代码审查',
      description: '多角色代码审查流水线',
      roles: [
        { id: 'review', role: 'engineering/engineering-code-reviewer', task: '审查代码', output: 'review_result' },
        { id: 'security', role: 'engineering/engineering-security-engineer', task: '安全检查', output: 'security_result' },
      ],
      concurrency: 2,
      hasInputs: true,
      inputs: [{ name: 'code', description: '待审查代码', required: true }],
    });

    expect(yaml).toContain('name: "代码审查"');
    expect(yaml).toContain('role: "engineering/engineering-code-reviewer"');
    expect(yaml).toContain('concurrency: 2');
    expect(yaml).toContain('required: true');
  });

  it('should handle single role without depends_on', () => {
    const yaml = generateWorkflowYaml({
      name: 'Simple',
      description: 'test',
      roles: [{ id: 'step1', role: 'engineering/engineering-code-reviewer', task: 'review', output: 'result' }],
      concurrency: 1,
      hasInputs: false,
      inputs: [],
    });

    expect(yaml).not.toContain('depends_on');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run test/cli/init-workflow.test.ts
# 预期: FAIL — 模块不存在
```

- [ ] **Step 3: 实现 generateWorkflowYaml 函数**

```typescript
// src/cli/init-workflow.ts
import { createInterface } from 'readline';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { listAgents } from '../agents/loader.js';

export interface WorkflowStep {
  id: string;
  role: string;
  task: string;
  output: string;
}

export interface WorkflowOptions {
  name: string;
  description: string;
  roles: WorkflowStep[];
  concurrency: number;
  hasInputs: boolean;
  inputs: { name: string; description: string; required: boolean }[];
}

export function generateWorkflowYaml(opts: WorkflowOptions): string {
  const lines: string[] = [
    `name: "${opts.name}"`,
    `description: "${opts.description}"`,
    '',
    'agents_dir: "agency-agents-zh"',
    '',
    'llm:',
    '  provider: deepseek',
    '  model: deepseek-chat',
    '',
    `concurrency: ${opts.concurrency}`,
  ];

  if (opts.hasInputs && opts.inputs.length > 0) {
    lines.push('', 'inputs:');
    for (const input of opts.inputs) {
      lines.push(`  - name: ${input.name}`);
      lines.push(`    description: "${input.description}"`);
      lines.push(`    required: ${input.required}`);
    }
  }

  lines.push('', 'steps:');
  for (let i = 0; i < opts.roles.length; i++) {
    const step = opts.roles[i];
    lines.push(`  - id: ${step.id}`);
    lines.push(`    role: "${step.role}"`);
    lines.push(`    task: "${step.task}"`);
    lines.push(`    output: ${step.output}`);
    if (i > 0) {
      lines.push(`    depends_on: [${opts.roles[i - 1].id}]`);
    }
  }

  return lines.join('\n') + '\n';
}

export async function interactiveInitWorkflow(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise(resolve => rl.question(q, resolve));

  console.log('\n  📝 创建新的工作流\n');

  const name = await ask('  工作流名称: ');
  const description = await ask('  简短描述: ');
  const concurrencyStr = await ask('  并行度 (默认 2): ');
  const concurrency = parseInt(concurrencyStr) || 2;

  // 收集角色
  const roles: WorkflowStep[] = [];
  console.log('\n  添加步骤（输入空角色名结束）:');
  console.log('  提示: 用 `ao roles` 查看所有可用角色\n');

  let stepNum = 1;
  while (true) {
    const role = await ask(`  步骤 ${stepNum} 角色 (如 engineering/engineering-code-reviewer): `);
    if (!role.trim()) break;
    const task = await ask(`  步骤 ${stepNum} 任务描述: `);
    const id = await ask(`  步骤 ${stepNum} ID (如 review): `);
    const output = await ask(`  步骤 ${stepNum} 输出变量名 (如 review_result): `);
    roles.push({ id: id.trim(), role: role.trim(), task: task.trim(), output: output.trim() });
    stepNum++;
  }

  if (roles.length === 0) {
    console.log('  未添加任何步骤，已取消');
    rl.close();
    return;
  }

  // 收集输入
  const hasInputsAnswer = await ask('\n  需要输入变量吗？(y/N): ');
  const hasInputs = hasInputsAnswer.toLowerCase() === 'y';
  const inputs: { name: string; description: string; required: boolean }[] = [];

  if (hasInputs) {
    console.log('  添加输入变量（输入空名称结束）:\n');
    while (true) {
      const inputName = await ask('  变量名: ');
      if (!inputName.trim()) break;
      const inputDesc = await ask('  描述: ');
      const requiredAnswer = await ask('  必填？(Y/n): ');
      inputs.push({
        name: inputName.trim(),
        description: inputDesc.trim(),
        required: requiredAnswer.toLowerCase() !== 'n',
      });
    }
  }

  rl.close();

  // 生成并保存
  const yaml = generateWorkflowYaml({ name, description, roles, concurrency, hasInputs, inputs });
  const fileName = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/-+$/, '') + '.yaml';
  const outputPath = resolve('workflows', fileName);

  if (!existsSync(resolve('workflows'))) {
    mkdirSync(resolve('workflows'), { recursive: true });
  }

  writeFileSync(outputPath, yaml, 'utf-8');
  console.log(`\n  ✅ 已生成: ${outputPath}`);
  console.log(`  接下来可以:`);
  console.log(`    ao plan ${outputPath}      查看执行计划`);
  console.log(`    ao run ${outputPath}       运行工作流\n`);
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run test/cli/init-workflow.test.ts
# 预期: PASS
```

- [ ] **Step 5: 修改 cli.ts 接入 init --workflow**

在 `handleInit()` 中加：
```typescript
if (args.includes('--workflow')) {
  const { interactiveInitWorkflow } = await import('./cli/init-workflow.js');
  await interactiveInitWorkflow();
  return;
}
```

在 `printHelp()` 中加：
```
    init --workflow                    交互式创建新工作流
```

- [ ] **Step 6: 手动测试**

```bash
npx tsx src/cli.ts init --workflow
# 交互式创建一个测试工作流，检查生成的 YAML 是否合法
ao validate workflows/<生成的文件>
```

- [ ] **Step 7: Commit**

```bash
git add src/cli/init-workflow.ts src/cli.ts test/cli/
git commit -m "feat: ao init --workflow — interactive workflow creator"
```

---

### Task 6: Dev 类 workflow 模板（6 个）

**Files:**
- Create: `workflows/dev/pr-review.yaml`
- Create: `workflows/dev/tech-debt-audit.yaml`
- Create: `workflows/dev/api-doc-gen.yaml`
- Create: `workflows/dev/readme-i18n.yaml`
- Create: `workflows/dev/security-audit.yaml`
- Create: `workflows/dev/release-checklist.yaml`

**Context:** 这是面向开发者的核心模板集。每个模板应该是开箱即用的，task prompt 写完整。参考 `workflows/department-collab/code-review.yaml` 的风格。

- [ ] **Step 1: 创建 pr-review.yaml**

PR 代码审查流水线：代码审查员 + 安全工程师 + 性能基准师并行 → 高级审查员汇总

```yaml
name: "PR 代码审查"
description: "三维度并行审查：代码质量、安全性、性能 → 汇总结论"

agents_dir: "agency-agents-zh"

llm:
  provider: deepseek
  model: deepseek-chat
  max_tokens: 4096

concurrency: 3

inputs:
  - name: pr_diff
    description: "PR 的 diff 内容或代码变更"
    required: true
  - name: pr_description
    description: "PR 描述和变更目的"
    required: true

steps:
  - id: code_quality
    role: "engineering/engineering-code-reviewer"
    task: |
      请审查以下 PR 的代码质量：

      PR 描述：{{pr_description}}

      代码变更：
      {{pr_diff}}

      评估维度：
      1. 代码可读性和命名规范
      2. 逻辑正确性
      3. 错误处理完整性
      4. DRY/YAGNI 原则
      5. 测试覆盖建议
    output: quality_report

  - id: security_check
    role: "engineering/engineering-security-engineer"
    task: |
      请从安全角度审查以下 PR：

      PR 描述：{{pr_description}}

      代码变更：
      {{pr_diff}}

      检查清单：
      1. OWASP Top 10 风险
      2. 输入验证和转义
      3. 认证授权检查
      4. 敏感数据处理
      5. 依赖安全性
    output: security_report

  - id: perf_check
    role: "testing/testing-performance-benchmarker"
    task: |
      请从性能角度审查以下 PR：

      PR 描述：{{pr_description}}

      代码变更：
      {{pr_diff}}

      评估维度：
      1. 算法复杂度
      2. 数据库查询效率
      3. 内存分配模式
      4. 并发安全性
      5. 缓存策略
    output: perf_report

  - id: summary
    role: "engineering/engineering-code-reviewer"
    task: |
      请综合以下三份审查报告，输出最终 PR 审查结论：

      ## 代码质量审查
      {{quality_report}}

      ## 安全审查
      {{security_report}}

      ## 性能审查
      {{perf_report}}

      输出格式：
      1. **总体结论**：✅ 可合并 / ⚠️ 需修改 / ❌ 需重写
      2. **必须修改**：列出必须解决的问题
      3. **建议改进**：列出建议但非必须的改进
      4. **亮点**：值得肯定的设计或实现
    depends_on: [code_quality, security_check, perf_check]
    output: final_review
```

- [ ] **Step 2: 创建 tech-debt-audit.yaml**

技术债务审计：架构师评估 + 代码审查员扫描 + 测试分析师检查覆盖率 → 产品经理排优先级

角色：`engineering/engineering-software-architect`, `engineering/engineering-code-reviewer`, `testing/testing-test-results-analyst`, `product/product-sprint-prioritizer`

- [ ] **Step 3: 创建 api-doc-gen.yaml**

API 文档生成：技术文档工程师分析代码 → API 测试员验证完整性 → 技术文档工程师输出最终文档

角色：`engineering/engineering-tech-doc-writer`, `testing/testing-api-tester`

- [ ] **Step 4: 创建 readme-i18n.yaml**

README 国际化：内容创作者翻译 → 技术文档工程师审查术语 → 内容创作者润色

角色：`marketing/marketing-content-creator`, `engineering/engineering-tech-doc-writer`

- [ ] **Step 5: 创建 security-audit.yaml**

安全审计流水线：安全工程师 + 威胁检测工程师并行 → 安全工程师汇总报告

角色：`engineering/engineering-security-engineer`, `engineering/engineering-threat-detection-engineer`

- [ ] **Step 6: 创建 release-checklist.yaml**

发布检查清单：SRE 检查基础设施 + 性能基准师检查性能 + 安全工程师最终安全检查 → 高级项目经理输出 Go/No-Go 决策

角色：`engineering/engineering-sre`, `testing/testing-performance-benchmarker`, `engineering/engineering-security-engineer`, `project-management/pm-senior-project-manager`

- [ ] **Step 7: 验证所有 YAML**

```bash
for f in workflows/dev/*.yaml; do ao validate "$f"; done
# 预期: 全部校验通过
```

- [ ] **Step 8: Commit**

```bash
git add workflows/dev/
git commit -m "feat: add 6 dev workflow templates (pr-review, tech-debt, api-doc, i18n, security, release)"
```

---

### Task 7: Data + Design + Ops workflow 模板（6 个）

**Files:**
- Create: `workflows/data/data-pipeline-review.yaml`
- Create: `workflows/data/dashboard-design.yaml`
- Create: `workflows/design/requirement-to-plan.yaml`
- Create: `workflows/design/ux-review.yaml`
- Create: `workflows/ops/incident-postmortem.yaml`
- Create: `workflows/ops/sre-health-check.yaml`

**Context:** 覆盖非纯开发场景的高频需求。角色均已存在于 agency-agents-zh 186 个角色中。

- [ ] **Step 1: 创建 data-pipeline-review.yaml**

数据管道审查：数据工程师分析 → 数据库优化师检查 → 数据分析师验证输出质量

角色：`engineering/engineering-data-engineer`, `engineering/engineering-database-optimizer`, `strategy/strategy-data-analyst`

- [ ] **Step 2: 创建 dashboard-design.yaml**

仪表盘设计：数据分析师定义指标 → UX 研究员设计布局 → UI 设计师出视觉方案

角色：`strategy/strategy-data-analyst`, `design/design-ux-researcher`, `design/design-ui-designer`

- [ ] **Step 3: 创建 requirement-to-plan.yaml**

需求到计划：产品经理分析需求 → 软件架构师设计方案 → 高级项目经理拆任务

角色：`product/product-product-manager`, `engineering/engineering-software-architect`, `project-management/pm-senior-project-manager`

- [ ] **Step 4: 创建 ux-review.yaml**

UX 审查：UX 研究员评估 + 无障碍审核员检查 → UX 架构师汇总

角色：`design/design-ux-researcher`, `design/design-accessibility-auditor`, `design/design-ux-architect`

- [ ] **Step 5: 创建 incident-postmortem.yaml**

事故复盘：故障指挥官梳理时间线 → SRE 分析根因 → 高级项目经理输出改进计划

角色：`engineering/engineering-incident-commander`, `engineering/engineering-sre`, `project-management/pm-senior-project-manager`

- [ ] **Step 6: 创建 sre-health-check.yaml**

SRE 健康检查：SRE 检查可靠性 + 性能基准师检查性能 + 基础设施运维师检查基础设施 → SRE 汇总

角色：`engineering/engineering-sre`, `testing/testing-performance-benchmarker`, `engineering/engineering-infra-ops`

- [ ] **Step 7: 验证所有 YAML**

```bash
for f in workflows/data/*.yaml workflows/design/*.yaml workflows/ops/*.yaml; do ao validate "$f"; done
```

- [ ] **Step 8: Commit**

```bash
git add workflows/data/ workflows/design/ workflows/ops/
git commit -m "feat: add 6 workflow templates (data, design, ops categories)"
```

---

### Task 8: 更新 README 和文档

**Files:**
- Modify: `README.md` — 更新集成工具列表、workflow 模板列表
- Modify: `integrations/claude-code/README.md` — 加新 workflow 示例

**Context:** 所有新增功能需要反映在主 README 上。特别是支持的工具列表需要从 3 个扩充到 9 个。

- [ ] **Step 1: 更新 README.md 的工具支持表**

在 README 中找到集成/工具相关段落，更新为：

| 工具 | 集成方式 | 状态 |
|------|---------|------|
| Claude Code | Skill 模式 / CLI | ✅ |
| Cursor | .cursor/rules | ✅ |
| OpenClaw | Skill 模式 / CLI | ✅ |
| Kiro | .kiro/steering | ✅ |
| Trae | .trae/rules | ✅ |
| Gemini CLI | GEMINI.md | ✅ |
| Codex CLI | .codex/instructions | ✅ |
| DeerFlow 2.0 | skills/custom | ✅ |
| Antigravity | AGENTS.md | ✅ |

- [ ] **Step 2: 更新 workflow 模板列表**

在 README 中更新 workflow 模板，按类别分组展示。

- [ ] **Step 3: Commit**

```bash
git add README.md README.zh-CN.md integrations/
git commit -m "docs: update README with 9 tool integrations and 20 workflow templates"
```

---

### Task 9: 版本号升级 + 发布 v0.3.0

**Files:**
- Modify: `package.json` — version 0.2.0 → 0.3.0

- [ ] **Step 1: 更新 package.json 版本**

- [ ] **Step 2: 构建验证**

```bash
npm run build
npm test
```

- [ ] **Step 3: Commit + Tag**

```bash
git add package.json
git commit -m "chore: bump version to 0.3.0"
git tag v0.3.0
```

- [ ] **Step 4: 发布 npm**

```bash
npm publish
```

---

## 阶段二：v0.3.1 — 提体验

### Task 10: `ao explain` — 自然语言解释 DAG

**Files:**
- Create: `src/cli/explain.ts`
- Modify: `src/cli.ts` — 新增 explain 命令
- Create: `test/cli/explain.test.ts`

**Context:** `ao plan` 已经输出 DAG 图，但对新用户不够直观。`ao explain` 用自然语言解释 workflow 执行流程，包括并行关系、条件分支、循环逻辑。

- [ ] **Step 1: 写测试**

测试 `explainWorkflow()` 函数，输入 parsed workflow，输出自然语言字符串。

```typescript
// test/cli/explain.test.ts
import { explainWorkflow } from '../../src/cli/explain.js';

describe('explainWorkflow', () => {
  it('should describe parallel steps', () => {
    const explanation = explainWorkflow({
      name: '代码审查',
      steps: [
        { id: 'a', role: 'reviewer', task: '审查', output: 'r1' },
        { id: 'b', role: 'security', task: '安全', output: 'r2' },
        { id: 'c', role: 'summary', task: '汇总', depends_on: ['a', 'b'], output: 'r3' },
      ],
      inputs: [],
    });

    expect(explanation).toContain('并行');
    expect(explanation).toContain('汇总');
  });

  it('should describe loops', () => {
    const explanation = explainWorkflow({
      name: '迭代审查',
      steps: [
        { id: 'review', role: 'reviewer', task: '审查', output: 'result',
          loop: { back_to: 'review', max_iterations: 3, exit_condition: '{{result}} contains 通过' } },
      ],
      inputs: [],
    });

    expect(explanation).toContain('循环');
    expect(explanation).toContain('最多 3');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现 explainWorkflow**

分析 DAG 层级，生成如下格式的自然语言：

```
这个工作流「代码审查」执行以下操作：

第 1 层（并行）：
  • reviewer 审查代码
  • security 检查安全性

第 2 层（等待上层完成）：
  • summary 汇总以上结果

总计 3 个步骤，最大并行度 2，预计 2 层执行。
```

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: 接入 cli.ts**

```typescript
case 'explain':
  handleExplain();
  break;
```

- [ ] **Step 6: 手动验证**

```bash
ao explain workflows/department-collab/code-review.yaml
```

- [ ] **Step 7: Commit**

```bash
git add src/cli/explain.ts src/cli.ts test/cli/explain.test.ts
git commit -m "feat: ao explain — natural language DAG explanation"
```

---

### Task 11: `ao watch` — 终端实时进度

**Files:**
- Create: `src/cli/watch.ts`
- Modify: `src/core/executor.ts` — 添加进度事件回调
- Modify: `src/cli.ts` — 新增 watch 命令（或 `ao run --watch`）

**Context:** 当前 `ao run` 执行时只有文字输出，长 workflow 不知道进度。`ao watch` 用 ANSI escape codes 绘制实时进度面板。实现为 `ao run --watch` flag 而非独立命令更自然。

- [ ] **Step 1: 在 executor 中添加进度事件**

给 executor 的 `run()` 函数增加可选回调：

```typescript
interface ProgressEvent {
  type: 'step_start' | 'step_done' | 'step_skip' | 'step_error';
  stepId: string;
  role: string;
  elapsed?: number;
  total: number;
  completed: number;
}

type ProgressCallback = (event: ProgressEvent) => void;
```

- [ ] **Step 2: 实现终端渲染**

```typescript
// src/cli/watch.ts
export function createWatchRenderer(): ProgressCallback {
  // 用 ANSI escape codes 实现：
  // - \x1b[?25l 隐藏光标
  // - \x1b[{n}A 上移 n 行
  // - \x1b[2K 清除当前行
  // 绘制类似：
  // ┌─ 代码审查 ──────────────────┐
  // │ ✅ code_review   12s          │
  // │ 🔄 security     running       │
  // │ ⏳ summary      waiting       │
  // │ Progress: ██████░░ 1/3  15s   │
  // └──────────────────────────────┘
}
```

- [ ] **Step 3: 接入 cli.ts**

在 `handleRun()` 中检查 `--watch` flag，传入 watch renderer 回调。

- [ ] **Step 4: 手动测试**

```bash
ao run workflows/dev/pr-review.yaml --watch -i pr_diff="test" -i pr_description="test"
```

- [ ] **Step 5: Commit**

```bash
git add src/cli/watch.ts src/core/executor.ts src/cli.ts
git commit -m "feat: ao run --watch — real-time terminal progress display"
```

---

### Task 12: 发布 v0.3.1

- [ ] **Step 1: 更新版本号到 0.3.1**
- [ ] **Step 2: 更新 README 中 `ao explain` 和 `--watch` 的说明**
- [ ] **Step 3: 构建 + 测试**
- [ ] **Step 4: Commit + Tag + npm publish**

---

## 阶段三：v0.3.2 — 开国际

### Task 13: MCP Server 模式

**Files:**
- Create: `src/mcp/server.ts`
- Create: `src/mcp/tools.ts`
- Modify: `src/cli.ts` — 新增 `mcp-serve` 命令
- Modify: `package.json` — 新增 bin entry `ao-mcp`

**Context:** 让 ao 作为 MCP Tool 暴露给 Claude Desktop / Cursor 等 MCP 客户端。使用 newline-delimited JSON stdio 协议（MCP 标准，与 shellward 修复后的协议一致）。暴露三个 tool：
- `run_workflow` — 运行指定 workflow
- `list_roles` — 列出所有可用角色
- `explain_workflow` — 解释 workflow 执行计划

- [ ] **Step 1: 写 MCP tool 定义**

```typescript
// src/mcp/tools.ts
export const MCP_TOOLS = [
  {
    name: 'run_workflow',
    description: '运行一个 YAML 定义的多角色工作流',
    inputSchema: {
      type: 'object',
      properties: {
        workflow_file: { type: 'string', description: 'YAML 工作流文件路径' },
        inputs: { type: 'object', description: '工作流输入变量' },
      },
      required: ['workflow_file'],
    },
  },
  {
    name: 'list_roles',
    description: '列出所有可用的 AI 角色',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: '角色分类（可选）' },
      },
    },
  },
  {
    name: 'explain_workflow',
    description: '用自然语言解释 workflow 的执行计划',
    inputSchema: {
      type: 'object',
      properties: {
        workflow_file: { type: 'string', description: 'YAML 工作流文件路径' },
      },
      required: ['workflow_file'],
    },
  },
];
```

- [ ] **Step 2: 实现 MCP stdio server**

使用 `readline` + newline-delimited JSON（同 shellward v0.5.15 的修复方案）。处理 `initialize`, `tools/list`, `tools/call`, `ping` 四种 method。

- [ ] **Step 3: 接入 cli.ts**

```typescript
case 'mcp-serve':
  await handleMcpServe();
  break;
```

- [ ] **Step 4: 验证 MCP 通信**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"capabilities":{}}}' | ao mcp-serve
# 预期: 正确的 initialize 响应

echo '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | ao mcp-serve
# 预期: 返回 3 个 tool 定义
```

- [ ] **Step 5: 创建 MCP 配置示例**

```json
{
  "mcpServers": {
    "agency-orchestrator": {
      "command": "ao",
      "args": ["mcp-serve"]
    }
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add src/mcp/ src/cli.ts
git commit -m "feat: MCP Server mode — expose ao as MCP tools"
```

---

### Task 14: 英文角色支持

**Files:**
- Modify: `src/agents/loader.ts` — 支持多语言角色目录
- Modify: `src/core/parser.ts` — 新增 `agents_lang` 字段

**Context:** 允许 workflow YAML 中指定 `agents_lang: en`，自动从 `agency-agents-en/` 加载英文角色。初期可以先支持机制，英文角色库（agency-agents-en）独立翻译和发布。

- [ ] **Step 1: 扩展 parser 支持 agents_lang**

在 workflow YAML 中新增可选字段：
```yaml
agents_dir: "agency-agents-zh"   # 默认
agents_lang: "zh"                # zh | en，默认 zh
```

- [ ] **Step 2: 扩展 loader 的目录搜索逻辑**

当 `agents_lang: en` 时，搜索顺序改为：
1. YAML 的 `agents_dir` 替换 `-zh` 为 `-en`
2. `./agency-agents-en/`
3. `node_modules/agency-agents-en/`

- [ ] **Step 3: 写测试**

- [ ] **Step 4: Commit**

```bash
git add src/agents/loader.ts src/core/parser.ts test/
git commit -m "feat: multi-language agent support (agents_lang field)"
```

---

### Task 15: 发布 v0.3.2

- [ ] **Step 1: 更新版本号到 0.3.2**
- [ ] **Step 2: 更新 README 中 MCP 模式和英文角色的说明**
- [ ] **Step 3: 构建 + 测试**
- [ ] **Step 4: Commit + Tag + npm publish**
- [ ] **Step 5: 提交到 awesome-mcp-servers（MCP 模式完成后）**

---

## 增长行动项（非代码）

### Task 16: agents-zh 导流

- [ ] 在 agency-agents-zh README 的"快速开始"之后，加显眼的导流段落：

```markdown
## 🚀 让多个角色协作

单个角色很强，多个角色协作更强。用 [agency-orchestrator](https://github.com/jnMetaCode/agency-orchestrator) 编排多角色工作流：

\`\`\`bash
npm install -g agency-orchestrator
ao init
ao run workflows/dev/pr-review.yaml -i pr_diff=@diff.txt -i pr_description="优化数据库查询"
\`\`\`
```

### Task 17: superpowers-zh 联动

- [ ] 在 superpowers-zh 中增加或更新提及 ao 的 skill/引导

### Task 18: 内容营销

- [ ] 每个 dev workflow 模板写一篇推广文（掘金/V2EX）
- [ ] 标题模式：「用 N 个 AI 角色帮你 [场景]」
- [ ] 每篇附带 `ao init` + `ao run` 命令

---

## 里程碑检查点

| 检查点 | 判定标准 |
|--------|---------|
| v0.3.0 完成 | 9 个工具集成 + `ao init --workflow` + 20 个 workflow 模板 + 所有 validate 通过 |
| v0.3.1 完成 | `ao explain` + `ao run --watch` 通过手动测试 + README 更新 |
| v0.3.2 完成 | MCP ping/tools/list/call 通过 + agents_lang 测试通过 |
| 增长验证 | agents-zh README 更新 + 3 篇推广文发布 + Star 增长趋势 |
