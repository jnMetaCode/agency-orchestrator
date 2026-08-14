/**
 * canvas/graph.ts 单测：YAML ↔ 画布 graph 往返保真。
 * 核心断言：含全部字段类型（condition/loop/skill/depends_on_mode/type/output/多依赖）的工作流
 * 经 graph→YAML→graph 后，每步字段与依赖关系不丢、不变；坐标存进 meta.layout 且引擎可忽略。
 */
import yaml from 'js-yaml';
import { workflowToGraph, graphToWorkflow } from '../src/canvas/graph.js';
import { validateWorkflow } from '../src/core/parser.js';
import type { WorkflowDefinition } from '../src/types.js';

let passed = 0, failed = 0;
function assert(c: boolean, m: string): void { if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; } }

console.log('\n─── canvas/graph 往返 ───');

const FIXTURE = `name: 全字段工作流
agents_dir: agency-agents-zh
llm:
  provider: deepseek
  model: deepseek-chat
concurrency: 3
inputs:
  - name: topic
    required: true
steps:
  - id: research
    role: product/researcher
    task: 研究 {{topic}}
    output: findings
  - id: design
    role: design/designer
    task: 基于 {{findings}} 设计
    skill: brainstorming
    depends_on: [research]
    output: spec
  - id: review
    role: engineering/reviewer
    task: 审查 {{spec}}
    condition: "{{spec}} contains risk"
    depends_on: [research, design]
    depends_on_mode: any_completed
    type: approval
    prompt: 请确认
    loop:
      back_to: design
      max_iterations: 3
      exit_condition: "{{spec}} contains approved"
`;

// 1) YAML → graph
const g = workflowToGraph(FIXTURE);
assert(g.nodes.length === 3, '3 个节点');
assert(g.edges.length === 3, '3 条边 (research→design, research→review, design→review)');
assert(g.edges.some((e) => e.source === 'research' && e.target === 'design'), 'research→design 边存在');
assert(g.edges.some((e) => e.source === 'design' && e.target === 'review'), 'design→review 边存在');
assert(g.nodes.every((n) => n.position.x === 0 && n.position.y === 0), '无 meta.layout 时坐标为 0（待前端 dagre 布局）');

// 2) 模拟前端编辑：拖动坐标
g.nodes[0].position = { x: 100, y: 50 };
g.nodes[1].position = { x: 300, y: 50 };
g.nodes[2].position = { x: 500, y: 50 };

// 3) graph → YAML → graph 往返
const out = graphToWorkflow(g, FIXTURE);
const doc = yaml.load(out) as any;

// 顶层保留
assert(doc.name === '全字段工作流', '顶层 name 保留');
assert(doc.agents_dir === 'agency-agents-zh', 'agents_dir 保留');
assert(doc.llm?.provider === 'deepseek' && doc.llm?.model === 'deepseek-chat', 'llm 配置保留');
assert(doc.concurrency === 3, 'concurrency 保留');
assert(Array.isArray(doc.inputs) && doc.inputs[0]?.name === 'topic', 'inputs 保留');

// 每步全字段保真
const review = doc.steps.find((s: any) => s.id === 'review');
assert(review.condition === '{{spec}} contains risk', 'condition 保留');
assert(review.depends_on_mode === 'any_completed', 'depends_on_mode 保留');
assert(review.type === 'approval' && review.prompt === '请确认', 'type/prompt 保留');
assert(review.loop?.back_to === 'design' && review.loop?.max_iterations === 3, 'loop 配置保留');
assert(JSON.stringify(review.depends_on?.sort()) === JSON.stringify(['design', 'research']), 'review 的多依赖保留');
const design = doc.steps.find((s: any) => s.id === 'design');
assert(design.skill === 'brainstorming', 'skill 保留');
assert(design.output === 'spec', 'output 保留');

// 坐标进 meta.layout
assert(doc.meta?.layout?.research?.x === 100, 'meta.layout 记录坐标');

// 4) meta.layout 不破坏引擎校验
const errs = validateWorkflow(doc as WorkflowDefinition);
assert(errs.length === 0, `带 meta.layout 的工作流通过 validateWorkflow（错误数 ${errs.length}）`);

// 5) 二次往返幂等（节点/边数量稳定）
const g2 = workflowToGraph(out);
assert(g2.nodes.length === 3 && g2.edges.length === 3, '二次往返节点/边数量稳定');
assert(g2.nodes.find((n) => n.id === 'research')?.position.x === 100, '二次往返坐标读回正确');

// 6) assert（机械检查）往返保真 —— 尤其是 Studio 界面上**没有暴露**的 matches。
//    画布保存走的是 `{ ...node.data }` 全量透传，理论上不会掉字段；但"理论上"不算数：
//    只要哪天有人给 steps 加了字段白名单，界面上改一下字数就会把用户手写的 matches 静默洗掉。
//    这条测试就是钉死这件事。
{
  const src = [
    'name: t',
    'llm: { provider: claude-code, model: sonnet }',
    'steps:',
    '  - id: a',
    '    role: engineering/engineering-sre',
    '    task: 转成课节文件',
    '    assert:',
    '      emits_files: 6',
    '      min_bytes: 2000',
    '      contains: ["## 验收清单"]',
    '      matches: { "^## ": 6 }',
    '',
  ].join('\n');
  const g = workflowToGraph(src);
  // 模拟用户只在界面上改了「最少字节数」
  const node = g.nodes[0] as { data: Record<string, unknown> };
  node.data.assert = { ...(node.data.assert as Record<string, unknown>), min_bytes: 3000 };
  const back = (yaml.load(graphToWorkflow(g, src)) as { steps: { assert: Record<string, unknown> }[] }).steps[0].assert;
  assert(back.emits_files === 6, 'assert.emits_files 往返保真');
  assert(back.min_bytes === 3000, 'assert.min_bytes 采纳界面改动');
  assert(JSON.stringify(back.contains) === JSON.stringify(['## 验收清单']), 'assert.contains 往返保真');
  assert((back.matches as Record<string, number>)?.['^## '] === 6, '界面未暴露的 assert.matches 未被洗掉');
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
