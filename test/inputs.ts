/**
 * 必填输入解析测试：required 但带 default 的输入不应被判为"缺失"。
 * 回归用例——story-creation 等带 default 的旗舰模板要能 `ao run xxx.yaml` 开箱即跑。
 */
import { findMissingInputs, modelCapabilityHint } from '../src/index.js';
import type { InputDefinition } from '../src/types.js';

let passed = 0, failed = 0;
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (err) { console.log(`  ❌ ${name}: ${err instanceof Error ? err.message : err}`); failed++; }
}
function assert(c: boolean, msg: string): void { if (!c) throw new Error(msg); }

const names = (defs: InputDefinition[]) => defs.map(d => d.name);

console.log('\n=== findMissingInputs ===');

test('required + 无 default + 未提供 → 缺失', () => {
  const m = findMissingInputs([{ name: 'a', required: true }], new Map());
  assert(names(m).join() === 'a', `应缺 a，实际: ${names(m)}`);
});

test('required + 有 default + 未提供 → 不缺失（核心修复）', () => {
  const m = findMissingInputs([{ name: 'premise', required: true, default: '默认梗概' }], new Map());
  assert(m.length === 0, `带 default 的 required 不该判缺失，实际: ${names(m)}`);
});

test('required + 已提供 → 不缺失', () => {
  const m = findMissingInputs([{ name: 'a', required: true }], new Map([['a', 'v']]));
  assert(m.length === 0, `已提供不该缺失: ${names(m)}`);
});

test('可选输入未提供 → 不缺失', () => {
  const m = findMissingInputs([{ name: 'style', required: false }], new Map());
  assert(m.length === 0, `可选不该缺失: ${names(m)}`);
});

test('混合：只报真正缺的那个', () => {
  const defs: InputDefinition[] = [
    { name: 'premise', required: true, default: 'd' }, // 有 default → 不缺
    { name: 'topic', required: true },                  // 无 default 未提供 → 缺
    { name: 'style', required: false },                 // 可选 → 不缺
  ];
  const m = findMissingInputs(defs, new Map());
  assert(names(m).join() === 'topic', `只应缺 topic，实际: ${names(m)}`);
});

test('inputs 为 undefined → 空', () => {
  assert(findMissingInputs(undefined, new Map()).length === 0, 'undefined 应返回空');
});

test('provided 用 Set 也能工作', () => {
  const m = findMissingInputs([{ name: 'a', required: true }], new Set(['a']));
  assert(m.length === 0, 'Set 提供也算已提供');
});

console.log('\n=== modelCapabilityHint ===');

test('ollama → 给弱档提示', () => {
  const h = modelCapabilityHint('ollama');
  assert(!!h && h.includes('Ollama') && h.includes('不如单次'), `ollama 应提示: ${h}`);
});

test('deepseek（甜区）→ 不提示', () => {
  assert(modelCapabilityHint('deepseek') === null, 'deepseek 不该提示');
});

test('强档/CLI → 不提示', () => {
  assert(modelCapabilityHint('claude') === null && modelCapabilityHint('claude-code') === null, '强档不该提示');
});

test('antigravity-cli → 给额度提示（质量不弱，额度受限）', () => {
  const h = modelCapabilityHint('antigravity-cli');
  assert(!!h && h.includes('20 次/天'), `antigravity 应提示额度: ${h}`);
});

test('没证据的 CLI（copilot/hermes/openclaw）→ 不猜不提示', () => {
  for (const p of ['copilot-cli', 'hermes-cli', 'openclaw-cli', 'codex-cli']) {
    assert(modelCapabilityHint(p) === null, `${p} 不该提示`);
  }
});

console.log('\n' + '='.repeat(50));
console.log(`  Inputs 测试: ${passed} 通过, ${failed} 失败 (共 ${passed + failed} 项)`);
if (failed === 0) console.log('  全部通过!');
else process.exit(1);
console.log('='.repeat(50) + '\n');
