/**
 * --provider 换成 CLI 类时的超时合并：600s 是下限，不能把 YAML 里显式写的长超时压回去。
 * 真机（2026-09-15）：模板写 timeout: 2700000，`--provider claude-code` 跑时仍在 600s、900s 连续超时重试。
 */
import { mergeLlmOverride, isCliProvider, CLI_TIMEOUT_FLOOR_MS } from '../src/core/llm-override.js';
import type { LLMConfig } from '../src/types.js';

let passed = 0, failed = 0;
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (err) { console.log(`  ❌ ${name}: ${err instanceof Error ? err.message : err}`); failed++; }
}
function assert(c: boolean, m: string): void { if (!c) throw new Error(m); }

const yaml = (timeout?: number): LLMConfig => ({ provider: 'deepseek', model: 'deepseek-chat', ...(timeout !== undefined ? { timeout } : {}) } as LLMConfig);
const toClaudeCode: Partial<LLMConfig> = { provider: 'claude-code', model: '' };

console.log('\n─── llm 覆盖：CLI provider 超时下限 ───');

test('YAML 写了 45 分钟，--provider claude-code：保留 YAML 的 45 分钟', () => {
  const r = mergeLlmOverride(yaml(2_700_000), toClaudeCode);
  assert(r.timeout === 2_700_000, `实际 ${r.timeout}`);
  assert(r.provider === 'claude-code' && r.model === '', 'provider / model 应被覆盖');
});

test('YAML 写了 API 用的 5 分钟，--provider claude-code：抬到 600s 下限', () => {
  assert(mergeLlmOverride(yaml(300_000), toClaudeCode).timeout === CLI_TIMEOUT_FLOOR_MS, '应为 600s');
});

test('YAML 没写 timeout，--provider claude-code：600s（与旧行为一致）', () => {
  assert(mergeLlmOverride(yaml(), toClaudeCode).timeout === CLI_TIMEOUT_FLOOR_MS, '应为 600s');
});

test('YAML 写 0（不限时），--provider claude-code：保持不限时', () => {
  assert(mergeLlmOverride(yaml(0), toClaudeCode).timeout === 0, '应为 0');
});

test('显式 --timeout：命令行优先，哪怕比 YAML 短', () => {
  assert(mergeLlmOverride(yaml(2_700_000), { ...toClaudeCode, timeout: 120_000 }).timeout === 120_000, '应为 120s');
});

test('换成 API provider：不套 CLI 下限，YAML 超时原样保留', () => {
  assert(mergeLlmOverride(yaml(300_000), { provider: 'openai', model: 'gpt-5.5' } as Partial<LLMConfig>).timeout === 300_000, '应为 300s');
  assert(mergeLlmOverride(yaml(), { provider: 'openai' } as Partial<LLMConfig>).timeout === undefined, '没写就不补');
});

test('isCliProvider：claude-code 与 *-cli 是，API provider 不是', () => {
  assert(isCliProvider('claude-code') && isCliProvider('codex-cli') && !isCliProvider('deepseek') && !isCliProvider(undefined), '判定错误');
});

console.log(`\n  ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
