/**
 * compose 功能单元测试 — 纯函数部分（不需要 LLM 调用）
 */
import {
  buildComposeSystemPrompt,
  buildComposeUserPrompt,
  extractYamlFromResponse,
  formatCatalogForPrompt,
  generateFileName,
  type RoleSummary,
} from '../src/cli/compose.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}: ${err instanceof Error ? err.message : err}`);
    failed++;
  }
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
  assert(text.includes('eng/eng-sre | SRE | 站点可靠性'), '应包含角色详情');
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

// ─── buildComposeUserPrompt ───

console.log('\n─── buildComposeUserPrompt ───');

test('user prompt 包含描述', () => {
  const prompt = buildComposeUserPrompt('做一个代码审查流程');
  assert(prompt.includes('做一个代码审查流程'), '应包含用户描述');
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

// ─── 汇总 ───
console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
