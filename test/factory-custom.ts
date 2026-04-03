/**
 * 测试自定义 provider 支持 (Issue #2)
 */
import { createConnector } from '../src/connectors/factory.js';
import type { LLMConfig } from '../src/types.js';

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

console.log('\n─── 自定义 Provider (Issue #2) ───');

test('未知 provider + base_url → 创建 OpenAICompatibleConnector', () => {
  const c = createConnector({
    provider: 'iflow',
    base_url: 'https://api.iflow.com/v1',
    api_key: 'test-key',
    model: 'test-model',
  } as LLMConfig);
  assert(c.constructor.name === 'OpenAICompatibleConnector', `got ${c.constructor.name}`);
});

test('未知 provider 无 base_url → 报错并提示配置 base_url', () => {
  try {
    createConnector({ provider: 'iflow', model: 'test' } as LLMConfig);
    assert(false, '应该抛错');
  } catch (e: any) {
    assert(e.message.includes('base_url'), '错误消息应包含 base_url 提示');
    assert(e.message.includes('iflow'), '错误消息应包含 provider 名');
  }
});

test('内置 provider ollama 不受影响', () => {
  const c = createConnector({ provider: 'ollama', model: 'llama3' } as LLMConfig);
  assert(c.constructor.name === 'OllamaConnector', `got ${c.constructor.name}`);
});

test('内置 provider deepseek 不受影响', () => {
  // deepseek 需要 api_key, 用环境变量或直接传
  const c = createConnector({
    provider: 'deepseek',
    model: 'deepseek-chat',
    api_key: 'test-key',
  } as LLMConfig);
  assert(c.constructor.name === 'OpenAICompatibleConnector', `got ${c.constructor.name}`);
});

test('自定义 provider 名含中文也能用', () => {
  const c = createConnector({
    provider: '智谱',
    base_url: 'https://open.bigmodel.cn/api/paas/v4',
    api_key: 'test-key',
    model: 'glm-4',
  } as LLMConfig);
  assert(c.constructor.name === 'OpenAICompatibleConnector', `got ${c.constructor.name}`);
});

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
