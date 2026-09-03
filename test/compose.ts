/**
 * compose 功能单元测试 — 纯函数部分（不需要 LLM 调用）
 */
import {
  autoFixVariableRefs,
  autoFixMissingDependsOn,
  repairInvalidRolesInYaml,
  buildComposeSystemPrompt,
  buildComposeUserPrompt,
  applyBudgetTiering,
  BUDGET_CAPABLE_PROVIDERS,
  ensureLlmBlock,
  extractYamlFromResponse,
  formatCatalogForPrompt,
  generateFileName,
  detectLang,
  type RoleSummary,
} from '../src/cli/compose.js';
import { writeFileSync, readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let passed = 0;
let failed = 0;

// 所有用例的 promise 都收集起来，末尾统一 await —— 否则汇总行会在异步用例结算**之前**打印，
// 后面那些用例即使失败也不会影响退出码，等于白写（本文件此前就是这样）。
const pending: Promise<void>[] = [];
function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  const p = Promise.resolve(fn()).then(() => {
    console.log(`  ✅ ${name}`);
    passed++;
  }).catch(err => {
    console.log(`  ❌ ${name}: ${err instanceof Error ? err.message : err}`);
    failed++;
  });
  pending.push(p);
  return p;
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg);
}

// ─── extractYamlFromResponse ───

console.log('\n─── extractYamlFromResponse ───');

test('提取 ```yaml 代码块', () => {
  const response = '这是一个工作流：\n\n```yaml\nname: "test"\nsteps:\n  - id: s1\n```\n\n请查看。';
  const yaml = extractYamlFromResponse(response);
  assert(yaml.includes('name: "test"'), '应包含 name');
  assert(yaml.includes('steps:'), '应包含 steps');
  assert(!yaml.includes('```'), '不应包含代码块标记');
  assert(!yaml.includes('这是'), '不应包含代码块外的文字');
});

test('提取 ```yml 代码块', () => {
  const response = '```yml\nname: "test"\nsteps:\n  - id: s1\n```';
  const yaml = extractYamlFromResponse(response);
  assert(yaml.includes('name: "test"'), '应提取 yml 代码块');
});

test('提取无语言标记的代码块', () => {
  const response = '```\nname: "test"\nsteps:\n  - id: s1\n```';
  const yaml = extractYamlFromResponse(response);
  assert(yaml.includes('name: "test"'), '应提取无标记代码块');
});

test('无代码块时返回整个内容', () => {
  const response = 'name: "test"\nsteps:\n  - id: s1';
  const yaml = extractYamlFromResponse(response);
  assert(yaml === response.trim(), '应返回整个内容');
});

test('多个代码块时取第一个 yaml 块', () => {
  const response = '说明：\n\n```yaml\nname: "first"\nsteps: []\n```\n\n```yaml\nname: "second"\n```';
  const yaml = extractYamlFromResponse(response);
  assert(yaml.includes('first'), '应取第一个 yaml 代码块');
  assert(!yaml.includes('second'), '不应包含第二个代码块');
});

test('未闭合的 ```yaml 代码块（小模型兜底）', () => {
  const response = '```yaml\nname: "test"\nsteps:\n  - id: s1\n    role: "engineering/engineering-senior-developer"';
  const yaml = extractYamlFromResponse(response);
  assert(yaml.includes('name: "test"'), '应提取内容');
  assert(!yaml.includes('```'), '不应包含代码块标记');
});

// ─── formatCatalogForPrompt ───

console.log('\n─── formatCatalogForPrompt ───');

test('按分类分组', () => {
  const roles: RoleSummary[] = [
    { path: 'eng/eng-sre', name: 'SRE', description: '站点可靠性', category: 'eng' },
    { path: 'eng/eng-dev', name: '开发', description: '开发者', category: 'eng' },
    { path: 'design/ux', name: 'UX', description: '体验设计', category: 'design' },
  ];
  const text = formatCatalogForPrompt(roles);
  assert(text.includes('## eng'), '应有 eng 分类标题');
  assert(text.includes('## design'), '应有 design 分类标题');
  assert(text.includes('eng/eng-sre |') && text.includes('SRE') && text.includes('站点可靠性'), '应包含角色详情');
});

test('空角色列表不崩溃', () => {
  const text = formatCatalogForPrompt([]);
  assert(text.trim() === '', '空列表应返回空字符串');
});

// ─── buildComposeSystemPrompt ───

console.log('\n─── buildComposeSystemPrompt ───');

test('system prompt 包含关键指引', () => {
  const prompt = buildComposeSystemPrompt('## test\n- role/path | name | desc');
  assert(prompt.includes('并行优先'), '应包含并行优先原则');
  assert(prompt.includes('变量串联'), '应包含变量串联原则');
  assert(prompt.includes('role/path'), '应包含角色目录');
  assert(prompt.includes('agents_dir'), '应包含 YAML 模板');
});

test('autoRun 模式 prompt 不含 inputs', () => {
  const prompt = buildComposeSystemPrompt('## test\n- role/path | name | desc', { autoRun: true });
  assert(prompt.includes('直接运行模式'), '应包含直接运行模式说明');
  assert(prompt.includes('自包含'), '应包含自包含原则');
  assert(!prompt.includes('合理输入'), '不应包含合理输入原则');
});

test('非 autoRun 模式 prompt 包含 inputs', () => {
  const prompt = buildComposeSystemPrompt('## test\n- role/path | name | desc', { autoRun: false });
  assert(prompt.includes('合理输入'), '应包含合理输入原则');
  assert(!prompt.includes('直接运行模式'), '不应包含直接运行模式说明');
});

// ─── detectLang ───

console.log('\n─── detectLang ───');

test('纯中文识别为 zh', () => {
  assert(detectLang('帮我做一个代码审查') === 'zh', '应识别为中文');
});

test('纯英文识别为 en', () => {
  assert(detectLang('Help me build a code review pipeline') === 'en', '应识别为英文');
});

test('中英混合识别为 zh', () => {
  assert(detectLang('帮我做一个 AI tool') === 'zh', '混合输入应优先中文');
});

// ─── English system prompt ───

console.log('\n─── English system prompt ───');

test('English prompt uses agency-agents', () => {
  const prompt = buildComposeSystemPrompt('## test\n- role/path | name | desc', { lang: 'en' });
  assert(prompt.includes('agents_dir: "agency-agents"'), '应使用 agency-agents');
  assert(!prompt.includes('agents_dir: "agency-agents-zh"'), '不应使用 agency-agents-zh');
  assert(prompt.includes('Parallel first'), '应包含英文设计原则');
});

test('English autoRun prompt has no inputs', () => {
  const prompt = buildComposeSystemPrompt('## test\n- role/path | name | desc', { autoRun: true, lang: 'en' });
  assert(prompt.includes('Direct Run Mode'), '应包含英文直接运行说明');
  assert(prompt.includes('Self-contained'), '应包含英文自包含原则');
});

test('Chinese prompt still works (default)', () => {
  const prompt = buildComposeSystemPrompt('## test\n- role/path | name | desc', { lang: 'zh' });
  assert(prompt.includes('agents_dir: "agency-agents-zh"'), '应使用 agency-agents-zh');
  assert(prompt.includes('并行优先'), '应包含中文设计原则');
});

// ─── buildComposeUserPrompt ───

console.log('\n─── buildComposeUserPrompt ───');

test('user prompt 包含描述', () => {
  const prompt = buildComposeUserPrompt('做一个代码审查流程');
  assert(prompt.includes('做一个代码审查流程'), '应包含用户描述');
});

test('English user prompt', () => {
  const prompt = buildComposeUserPrompt('Build a code review pipeline', 'en');
  assert(prompt.includes('Design a multi-agent collaboration workflow'), '应包含英文提示');
  assert(prompt.includes('Build a code review pipeline'), '应包含用户描述');
});

// ─── generateFileName ───

console.log('\n─── generateFileName ───');

test('中文描述生成文件名', () => {
  const name = generateFileName('PR代码审查流程');
  assert(name.endsWith('.yaml'), '应以 .yaml 结尾');
  assert(name.includes('pr代码审查流程'), '应包含中文');
});

test('英文描述生成文件名', () => {
  const name = generateFileName('Code review pipeline');
  assert(name === 'code-review-pipeline.yaml', '应转小写并用连字符');
});

test('特殊字符被清理', () => {
  const name = generateFileName('测试!@#$%流程');
  assert(!name.includes('!'), '不应包含特殊字符');
  assert(name.endsWith('.yaml'), '应以 .yaml 结尾');
});

test('空描述使用默认名', () => {
  const name = generateFileName('');
  assert(name === 'composed-workflow.yaml', '空描述应使用默认名');
});

test('超长描述被截断', () => {
  const name = generateFileName('a'.repeat(100));
  assert(name.length < 60, '文件名应被截断');
});

test('同名文件已存在时加序号', () => {
  // 用 workflows/ 目录测试（里面已有文件）
  const name1 = generateFileName('story-creation', './workflows');
  assert(name1 === 'story-creation-2.yaml', '应加序号避免覆盖');
});

// ─── prompt 含变量来源约束（D） ───

console.log('\n─── prompt 变量来源约束 ───');

test('zh prompt 包含变量来源规则', () => {
  const p = buildComposeSystemPrompt('## cat\n- foo/bar | 🔍 n | d', { lang: 'zh' });
  assert(p.includes('变量必须有来源'), 'prompt 应说明变量必须有来源');
  assert(p.includes('合并/汇总类步骤'), 'prompt 应专门提示 merge step 的 depends_on');
});

test('en prompt 包含变量来源规则', () => {
  const p = buildComposeSystemPrompt('## cat\n- foo/bar | 🔍 n | d', { lang: 'en' });
  assert(p.includes('Variables must have a source'), 'prompt should mention variable source rule');
  assert(p.includes('Merge / aggregation steps'), 'prompt should mention merge step rule');
});

// ─── autoFixVariableRefs（A：DAG 上游约束） ───

console.log('\n─── autoFixVariableRefs DAG 上游约束 ───');

function makeYamlFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'aotest-'));
  const p = join(dir, 'wf.yaml');
  writeFileSync(p, content);
  return p;
}

const validYamlBase = `name: t
agents_dir: agency-agents
llm:
  provider: deepseek
  model: deepseek-chat
`;

await test('autoFix: 用上游 step.id 替换 → 走策略 1', async () => {
  const p = makeYamlFile(validYamlBase + `
steps:
  - id: analyze
    role: engineering/engineering-sre
    task: "分析"
    output: analysis_data

  - id: report
    role: engineering/engineering-sre
    task: "汇总 {{analyze}}"
    output: final
    depends_on: [analyze]
`);
  const r = await autoFixVariableRefs(p);
  assert(r.fixed === 1, `应修复 1 个，实际 ${r.fixed}`);
  assert(r.details[0].from === 'analyze' && r.details[0].to === 'analysis_data',
    `期望 analyze → analysis_data，实际 ${r.details[0].from} → ${r.details[0].to}`);
});

await test('autoFix: 不允许指向下游 output（拓扑约束）', async () => {
  // personal_assessment 在前，final_report 在后；旧版会错误地把 personal_assessment → final_report
  const p = makeYamlFile(validYamlBase + `
steps:
  - id: personal_assessment_step
    role: engineering/engineering-sre
    task: "评估 {{platform_analysis}}"
    output: assessment

  - id: final_report
    role: engineering/engineering-sre
    task: "总结 {{assessment}}"
    output: final_report
    depends_on: [personal_assessment_step]
`);
  const r = await autoFixVariableRefs(p);
  // personal_assessment_step 没有 depends_on，所以 {{platform_analysis}} 没法在上游找到
  // 应该 0 个 fixed，不能错改成 final_report
  assert(r.fixed === 0, `不应做任何替换，实际 fixed=${r.fixed} details=${JSON.stringify(r.details)}`);
});

await test('autoFix: 上游 outputs 内模糊匹配 → 走策略 2', async () => {
  const p = makeYamlFile(validYamlBase + `
steps:
  - id: market
    role: engineering/engineering-sre
    task: "调研"
    output: market_research

  - id: tech
    role: engineering/engineering-sre
    task: "技术 {{market_data}}"
    output: tech_doc
    depends_on: [market]
`);
  const r = await autoFixVariableRefs(p);
  assert(r.fixed === 1, `应修复 1 个，实际 ${r.fixed}`);
  assert(r.details[0].to === 'market_research', `期望 → market_research，实际 ${r.details[0].to}`);
});

await test('autoFix: 多个 bad var 在 merge step 内分别匹配上游', async () => {
  const p = makeYamlFile(validYamlBase + `
steps:
  - id: market_step
    role: engineering/engineering-sre
    task: "市场"
    output: market_data

  - id: tech_step
    role: engineering/engineering-sre
    task: "技术"
    output: tech_data

  - id: merge
    role: engineering/engineering-sre
    task: "合并 {{market}} 和 {{tech}}"
    output: report
    depends_on: [market_step, tech_step]
`);
  const r = await autoFixVariableRefs(p);
  // {{market}} 和 {{tech}} 都不是 step.id，但模糊匹配 outputs 时
  // market 应匹配 market_data, tech 应匹配 tech_data
  assert(r.fixed === 2, `应修复 2 个，实际 ${r.fixed}`);
  const tos = r.details.map(d => d.to).sort();
  assert(JSON.stringify(tos) === JSON.stringify(['market_data', 'tech_data']),
    `期望 [market_data, tech_data]，实际 ${JSON.stringify(tos)}`);
});

await test('autoFix: 没有上游的 step 内的 bad var 跳过不修', async () => {
  const p = makeYamlFile(validYamlBase + `
steps:
  - id: lonely
    role: engineering/engineering-sre
    task: "单飞 {{nonsense}}"
    output: out
`);
  const r = await autoFixVariableRefs(p);
  assert(r.fixed === 0, `没有上游应不修，实际 ${r.fixed}`);
});

await test('autoFix: 跨 step 同名 bad var 只全局处理一次（已知 limitation）', async () => {
  // 边角 case：两个 step 都引用 {{review}}，但上游不同。
  // 当前实现用全局 replace + globallyHandled，所以两个 step 的 {{review}} 都
  // 被改成同一个 output（第一个匹配到的）。这在罕见的"同名变量不同语义"场景
  // 下会让第二个 step 出现新的未定义变量，留给 LLM repair 兜底。
  const p = makeYamlFile(validYamlBase + `
steps:
  - id: a_step
    role: engineering/engineering-sre
    task: "A"
    output: data_a

  - id: b_step
    role: engineering/engineering-sre
    task: "B"
    output: data_b

  - id: review_a
    role: engineering/engineering-sre
    task: "review {{review}}"
    output: review_a_out
    depends_on: [a_step]

  - id: review_b
    role: engineering/engineering-sre
    task: "review {{review}}"
    output: review_b_out
    depends_on: [b_step]
`);
  const r = await autoFixVariableRefs(p);
  // 期望：第一个 step (review_a) 把 {{review}} → {{data_a}}（上游唯一 output）
  // 第二个 step (review_b) 的 {{review}} 也被全局 replace 改成 data_a
  // 但 review_b 的上游是 b_step，data_a 不在它的 depends_on 闭包里
  // 这是已知 limitation，由 LLM repair 兜底。autoFix 自身只确保不指向"下游"
  assert(r.fixed === 1, `应仅记录 1 次替换（全局），实际 ${r.fixed}`);
  assert(r.details[0].from === 'review', `期望 from=review，实际 ${r.details[0].from}`);
});

// ─── autoFixMissingDependsOn（issue #87：变量名对，只是漏了 depends_on 边） ───

console.log('\n─── autoFixMissingDependsOn ───');

await test('复现 issue #87：连续 4 个 step 漏 depends_on，全部补齐后可通过校验', async () => {
  const p = makeYamlFile(validYamlBase + `
steps:
  - id: collect_requirements
    role: engineering/engineering-sre
    task: "整理需求"
    output: task_list

  - id: edit_images
    role: engineering/engineering-sre
    task: "根据 {{task_list}} 优化图片"
    output: edited_images_description

  - id: quality_check
    role: engineering/engineering-sre
    task: "核对 {{task_list}} 和 {{edited_images_description}}"
    output: quality_report

  - id: determine_need_rework
    role: engineering/engineering-sre
    task: "根据 {{quality_report}} 判断是否返工"
    output: rework_decision
`);
  const r = await autoFixMissingDependsOn(p);
  assert(r.fixed === 4, `应修复 4 处，实际 ${r.fixed}: ${JSON.stringify(r.details)}`);
  const { parseWorkflow, validateWorkflow } = await import('../src/core/parser.js');
  const wf = parseWorkflow(p);
  const errors = validateWorkflow(wf);
  assert(errors.length === 0, `修复后应无校验错误，实际: ${JSON.stringify(errors)}`);
});

await test('depends_on 已是 flow 风格 [a] 时能正确追加而非覆盖', async () => {
  const p = makeYamlFile(validYamlBase + `
steps:
  - id: a
    role: engineering/engineering-sre
    task: "A"
    output: out_a

  - id: b
    role: engineering/engineering-sre
    task: "B"
    output: out_b

  - id: merge
    role: engineering/engineering-sre
    task: "合并 {{out_a}} 和 {{out_b}}"
    output: out_merge
    depends_on: [a]
`);
  const r = await autoFixMissingDependsOn(p);
  assert(r.fixed === 1, `应修复 1 处，实际 ${r.fixed}`);
  assert(r.details[0].step === 'merge' && r.details[0].addedDep === 'b', `期望 merge → b，实际 ${JSON.stringify(r.details)}`);
  const content = readFileSync(p, 'utf-8');
  assert(/depends_on:\s*\[a,\s*b\]/.test(content), `应追加成 [a, b]，实际内容:\n${content}`);
});

await test('depends_on 已是多行列表风格时能正确追加', async () => {
  const p = makeYamlFile(validYamlBase + `
steps:
  - id: a
    role: engineering/engineering-sre
    task: "A"
    output: out_a

  - id: b
    role: engineering/engineering-sre
    task: "B"
    output: out_b

  - id: merge
    role: engineering/engineering-sre
    task: "合并 {{out_a}} 和 {{out_b}}"
    output: out_merge
    depends_on:
      - a
`);
  const r = await autoFixMissingDependsOn(p);
  assert(r.fixed === 1, `应修复 1 处，实际 ${r.fixed}`);
  const content = readFileSync(p, 'utf-8');
  assert(/depends_on:\s*\n\s*- a\s*\n\s*- b/.test(content), `应追加一行 "- b"，实际内容:\n${content}`);
});

await test('会成环的修复应被拒绝（不引入循环依赖）', async () => {
  const p = makeYamlFile(validYamlBase + `
steps:
  - id: step_a
    role: engineering/engineering-sre
    task: "用到 {{b_output}}"
    output: a_output
    depends_on: [step_b]

  - id: step_b
    role: engineering/engineering-sre
    task: "用到 {{a_output}}"
    output: b_output
`);
  const r = await autoFixMissingDependsOn(p);
  assert(r.fixed === 0, `应拒绝成环修复，实际 fixed=${r.fixed}: ${JSON.stringify(r.details)}`);
});

await test('变量确实不存在时不误修（留给 autoFixVariableRefs / LLM 兜底）', async () => {
  const p = makeYamlFile(validYamlBase + `
steps:
  - id: solo
    role: engineering/engineering-sre
    task: "凭空引用 {{ghost_var}}"
    output: solo_out
`);
  const r = await autoFixMissingDependsOn(p);
  assert(r.fixed === 0, `没有任何 step 产出该变量，不应修复，实际 ${r.fixed}`);
});

await test('task 文本里的假 "- id:" 示例片段不应被当成真实 step 边界（关键回归）', async () => {
  // research 的 task 里举了个例子，恰好写了 "- id: quality_check"（和真实存在的
  // 下游 step 同名）。早期实现按"文档里第一次出现的位置"当边界，会把 depends_on
  // 错误地打进 research 自己（甚至造成自我依赖），而不是真正引用了 {{research_notes}}
  // 却没连边的 quality_check。正确实现必须靠 YAML 结构（缩进）识别真实 step 边界，
  // 忽略 task: | 块标量内部缩进更深的假匹配。
  const p = makeYamlFile(validYamlBase + `
steps:
  - id: research
    role: engineering/engineering-sre
    task: |
      做调研，并按下面格式给出示例配置：
      steps:
        - id: quality_check
          role: engineering/engineering-sre
          task: "参考示例"
    output: research_notes

  - id: quality_check
    role: engineering/engineering-sre
    task: "核对 {{research_notes}}"
    output: quality_report
`);
  const r = await autoFixMissingDependsOn(p);
  assert(r.fixed === 1, `应只修复 1 处，实际 ${r.fixed}: ${JSON.stringify(r.details)}`);
  assert(r.details[0].step === 'quality_check' && r.details[0].addedDep === 'research',
    `应该是 quality_check 依赖 research，实际: ${JSON.stringify(r.details)}`);
  const content = readFileSync(p, 'utf-8');
  // research 自己的 block（到真实 "- id: quality_check" 之前）不应含 depends_on
  const researchBlock = content.split('  - id: quality_check\n')[0];
  assert(!researchBlock.includes('depends_on'), `不应把 depends_on 插进 research 自己的 task 块里，research 块内容:\n${researchBlock}`);
  const { parseWorkflow, validateWorkflow } = await import('../src/core/parser.js');
  const wf = parseWorkflow(p);
  const errors = validateWorkflow(wf);
  assert(errors.length === 0, `修复后应校验通过，实际: ${JSON.stringify(errors)}`);
  const researchStep = wf.steps.find((s: any) => s.id === 'research')!;
  assert(!(researchStep.depends_on || []).includes('research'), `research 不应自我依赖，实际 depends_on: ${JSON.stringify(researchStep.depends_on)}`);
});

// ─── repairInvalidRolesInYaml（确定性角色修复）───

console.log('\n─── repairInvalidRolesInYaml ───');

const validPaths = [
  'engineering/engineering-code-reviewer',
  'product/product-trend-researcher',
  'marketing/marketing-content-creator',
];

await test('有可信匹配 → 直接替换为真实角色路径', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ao-rolefix-'));
  const p = join(dir, 'wf.yaml');
  writeFileSync(p, `name: "t"
steps:
  - id: a
    role: "engineering/engineering-reviewer"
    task: "review"
`);
  const r = repairInvalidRolesInYaml(p, ['engineering/engineering-reviewer'], validPaths);
  assert(r.replaced.length === 1, `应替换 1 个，实际 ${r.replaced.length}`);
  assert(r.replaced[0].to === 'engineering/engineering-code-reviewer', `应替换为最接近路径，实际 ${r.replaced[0].to}`);
  assert(r.unresolved.length === 0, '不应有无法解析的角色');
  const out = readFileSync(p, 'utf-8');
  assert(out.includes('"engineering/engineering-code-reviewer"'), 'YAML 应写入真实角色');
  assert(!out.includes('engineering-reviewer"'), '不应残留假角色');
});

await test('无可信匹配 → 留给 unresolved（不乱替换）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ao-rolefix-'));
  const p = join(dir, 'wf.yaml');
  writeFileSync(p, `name: "t"
steps:
  - id: a
    role: "zzz/qqq-nonexistent-xyz"
    task: "x"
`);
  const r = repairInvalidRolesInYaml(p, ['zzz/qqq-nonexistent-xyz'], validPaths);
  assert(r.replaced.length === 0, '无匹配不应替换');
  assert(r.unresolved.length === 1, '应记入 unresolved');
});

// ─── 汇总 ───

// ─── ensureLlmBlock：产物必须自带 llm，否则 `ao run 产物.yaml` 直接被挡 ───

console.log('\n─── ensureLlmBlock（补齐模型漏写的 llm 段）───');

test('缺 llm 时按本次 compose 实际用的配置补上，插在 name 之后', () => {
  const out = ensureLlmBlock('name: "x"\nsteps:\n  - id: a\n', { provider: 'deepseek', model: 'deepseek-chat' });
  assert(/^llm:$/m.test(out), '应补出 llm 段');
  assert(out.indexOf('llm:') > out.indexOf('name:'), 'llm 应排在 name 之后');
  assert(out.indexOf('llm:') < out.indexOf('steps:'), 'llm 应排在 steps 之前');
  assert(out.includes('provider: "deepseek"') && out.includes('model: "deepseek-chat"'), '带上 provider/model');
});

test('已经有 llm 就一个字都不动（尊重模型/用户写的）', () => {
  const src = 'name: "x"\nllm:\n  provider: "claude"\nsteps:\n  - id: a\n';
  assert(ensureLlmBlock(src, { provider: 'deepseek', model: 'deepseek-chat' }) === src, '不应改写');
});

test('绝不把 api_key 写进产物（工作流会被分享出去）', () => {
  const out = ensureLlmBlock('name: "x"\nsteps: []\n', { provider: 'p', model: 'm', base_url: 'https://x/v1', api_key: 'sk-secret' } as never);
  assert(!out.includes('sk-secret') && !out.includes('api_key'), '产物里不许出现 key');
  assert(out.includes('base_url: "https://x/v1"'), 'base_url 该带上（换机器也能跑）');
});

test('agents_dir 漏写也一并补上（默认会去找 ./agents，多数机器上没有）', () => {
  const out = ensureLlmBlock('name: "x"\nsteps: []\n', { provider: 'p', model: 'm' }, 'agency-agents-zh');
  assert(/^agents_dir: "agency-agents-zh"$/m.test(out), '应补出 agents_dir');
  assert(out.indexOf('agents_dir:') > out.indexOf('name:'), 'agents_dir 排在 name 之后');
});

test('llm 与 agents_dir 都已写好时原样返回', () => {
  const src = 'name: "x"\nagents_dir: "d"\nllm:\n  provider: "claude"\nsteps: []\n';
  assert(ensureLlmBlock(src, { provider: 'p', model: 'm' }, 'agency-agents-zh') === src, '不应改写');
});

test('没 provider 可填时不硬造（宁可保持原样，让上层报清楚）', () => {
  const src = 'name: "x"\nsteps: []\n';
  assert(ensureLlmBlock(src, {}) === src, '没 provider 就不动');
});

await Promise.all(pending);

// ─── 省钱模式的诚实性（勾了不生效=静默空操作，比不支持更糟） ───

console.log('\n─── 省钱模式（budget）───');

await test('降档表的键都是引擎真认识的 provider（写错=永远静默 no-op）', async () => {
  const { API_PROVIDERS } = await import('../src/connectors/api-providers.js');
  const known = new Set([...API_PROVIDERS.map((x) => x.id), 'claude', 'claude-code', 'antigravity-cli', 'gemini-cli', 'copilot-cli', 'codex-cli', 'openclaw-cli', 'hermes-cli', 'codebuddy-cli', 'cline-cli', 'opencode-cli', 'dsh-cli', 'ollama']);
  for (const k of BUDGET_CAPABLE_PROVIDERS) {
    assert(known.has(k), `降档表里的 "${k}" 不是已注册 provider`);
  }
});

await test('claude-code 在能力清单里（订阅额度同样是钱，轻活降 haiku）', () => {
  assert(BUDGET_CAPABLE_PROVIDERS.includes('claude-code'), 'claude-code 应支持省钱模式');
  assert(BUDGET_CAPABLE_PROVIDERS.includes('shengsuanyun'), '胜算云的便宜档已实拉核实，应在列');
});

await test('claude-code 下轻活步骤真的被降档（不是只进了清单）', () => {
  const yaml = ['name: "x"', 'llm:', '  provider: "claude-code"', 'steps:', '  - id: a', '    role: "r/r"', '    task: "把要点整理成表格"'].join('\n');
  const out = applyBudgetTiering(yaml, 'claude-code');
  assert(/claude-haiku/.test(out.yaml), `轻活应降到 haiku,实际:\n${out.yaml}`);
});

await test('不在降档表的 provider（如 lanox）budget 是显式 no-op，不乱写模型', () => {
  const yaml = ['name: "x"', 'llm:', '  provider: "lanox"', '  model: "gpt-5.6-sol"', 'steps:', '  - id: a', '    role: "r/r"', '    task: "把要点整理成表格"'].join('\n');
  const out = applyBudgetTiering(yaml, 'lanox');
  assert(out.yaml === yaml, '没有已核实便宜档就不动 YAML（猜错=轻活全线报模型不存在）');
});

await test('前端把"不生效"明说出来（能力清单接进了勾选框）', () => {
  if (!existsSync('website/src/components/studio/RolesPicker.tsx')) return;  // 引擎单独发包时跳过
  const picker = readFileSync('website/src/components/studio/RolesPicker.tsx', 'utf-8');
  assert(/budgetProviders/.test(picker) && /budgetSupported/.test(picker), 'RolesPicker 应消费能力清单');
  assert(/disabled=\{!budgetSupported\}/.test(picker), '不支持时勾选框应禁用而不是静默无效');
  const i18n = readFileSync('website/src/i18n/translations.ts', 'utf-8');
  assert((i18n.match(/budgetNoTier/g) || []).length >= 2, '中英都要有"不生效"文案');
});

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
