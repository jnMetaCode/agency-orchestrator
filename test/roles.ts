/**
 * filterAgentsByKeyword 单测（ao roles <keyword> 搜索）。
 */
import { filterAgentsByKeyword } from '../src/agents/loader.js';

let passed = 0, failed = 0;
function assert(c: boolean, msg: string): void { if (!c) throw new Error(msg); }
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.log(`  ❌ ${name}: ${e instanceof Error ? e.message : e}`); failed++; }
}

const agents = [
  { name: 'SEO Specialist', rolePath: 'marketing/marketing-seo-specialist', description: 'search engine optimization' },
  { name: 'Backend Architect', rolePath: 'engineering/engineering-backend-architect', description: 'APIs and databases' },
  { name: 'Financial Analyst', rolePath: 'finance/finance-financial-analyst', description: '财务建模与分析' },
];

console.log('\n=== ao roles 关键词搜索 ===');

test('按 rolePath 匹配', () => {
  assert(filterAgentsByKeyword(agents, 'seo').length === 1, '应命中 1 个 seo');
});
test('按 description 匹配', () => {
  assert(filterAgentsByKeyword(agents, 'database').length === 1, '应命中 backend');
});
test('按 name 匹配且不区分大小写', () => {
  assert(filterAgentsByKeyword(agents, 'BACKEND').length === 1, '大写也应命中');
});
test('中文描述可被中文关键词命中', () => {
  assert(filterAgentsByKeyword(agents, '财务').length === 1, '应命中财务');
});
test('空关键词返回全部', () => {
  assert(filterAgentsByKeyword(agents, '  ').length === 3, '空应返回全部');
});
test('无匹配返回空', () => {
  assert(filterAgentsByKeyword(agents, 'zzznope').length === 0, '应为空');
});

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
