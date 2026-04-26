/**
 * compose 功能单元测试 — 纯函数部分（不需要 LLM 调用）
 */
import {
  autoFixVariableRefs,
  buildComposeSystemPrompt,
  buildComposeUserPrompt,
  extractYamlFromResponse,
  formatCatalogForPrompt,
  generateFileName,
  detectLang,
  type RoleSummary,
} from '../src/cli/compose.js';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve(fn()).then(() => {
    console.log(`  ✅ ${name}`);
    passed++;
  }).catch(err => {
    console.log(`  ❌ ${name}: ${err instanceof Error ? err.message : err}`);
    failed++;
  });
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

// ─── 汇总 ───
console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
