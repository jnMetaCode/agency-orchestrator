/**
 * provider: claude 的 base_url 支持（Anthropic 协议中转直连）。
 *
 * 此前 factory 建 ClaudeConnector 时只传 api_key，连接器也从不设 baseURL ——
 * 在 YAML 或 Studio 里给 claude 配中转地址会被**静默忽略**：请求照旧打 Anthropic
 * 官方，拿中转 key 去打必然 401，而用户完全看不出是配置没生效。
 *
 * 另一个坑是拼接口径：SDK 自己会接 `/v1/messages`，所以 base 不能自带 /v1，
 * 而 Studio 的 Claude 预设默认值恰恰是 https://api.anthropic.com/v1。
 */
import { ClaudeConnector, normalizeAnthropicBaseUrl } from '../src/connectors/claude.js';
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

const KEY = 'sk-ant-test-key-not-real';

console.log('\n─── Anthropic base_url 归一化（SDK 会自己接 /v1/messages） ───');

test('自带 /v1 要削掉，否则拼成 /v1/v1/messages 直接 404', () => {
  assert(normalizeAnthropicBaseUrl('https://api.anthropic.com/v1') === 'https://api.anthropic.com', normalizeAnthropicBaseUrl('https://api.anthropic.com/v1'));
});

test('照抄 curl 的完整端点地址也能用', () => {
  assert(normalizeAnthropicBaseUrl('https://api.anthropic.com/v1/messages') === 'https://api.anthropic.com', normalizeAnthropicBaseUrl('https://api.anthropic.com/v1/messages'));
});

test('中转商的子路径基址只削末尾 /v1，不能整段重写', () => {
  const b = normalizeAnthropicBaseUrl('https://api.aicodemirror.com/api/claudecode');
  assert(b === 'https://api.aicodemirror.com/api/claudecode', b);
  const withV1 = normalizeAnthropicBaseUrl('https://api.aicodemirror.com/api/claudecode/v1');
  assert(withV1 === 'https://api.aicodemirror.com/api/claudecode', withV1);
});

test('尾斜杠 / 引号 / 缺协议都能容错', () => {
  assert(normalizeAnthropicBaseUrl('https://relay.example.com/') === 'https://relay.example.com', '尾斜杠');
  assert(normalizeAnthropicBaseUrl('"https://relay.example.com"') === 'https://relay.example.com', '复制带引号');
  assert(normalizeAnthropicBaseUrl('relay.example.com') === 'https://relay.example.com', '缺协议补 https');
});

test('空值不产生垃圾 base（交回 SDK 默认）', () => {
  assert(normalizeAnthropicBaseUrl(undefined) === '', 'undefined');
  assert(normalizeAnthropicBaseUrl('   ') === '', '空白');
});

console.log('\n─── 连接器实际生效的接入点 ───');

test('配了中转地址就真的打中转（此前被静默忽略）', () => {
  const c = new ClaudeConnector(KEY, 'https://api.aicodemirror.com/api/claudecode');
  assert(c.baseUrl.startsWith('https://api.aicodemirror.com/api/claudecode'), `实际 ${c.baseUrl}`);
});

test('没配就走官方（不因本次改动改变默认行为）', () => {
  const saved = process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_BASE_URL;
  try {
    const c = new ClaudeConnector(KEY);
    assert(c.baseUrl.includes('api.anthropic.com'), `实际 ${c.baseUrl}`);
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_BASE_URL = saved;
  }
});

test('env ANTHROPIC_BASE_URL 同样生效，且同样过归一化', () => {
  const saved = process.env.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_BASE_URL = 'https://relay.example.com/v1';
  try {
    const c = new ClaudeConnector(KEY);
    assert(c.baseUrl === 'https://relay.example.com', `实际 ${c.baseUrl}`);
  } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = saved;
  }
});

test('显式 base_url 优先于 env', () => {
  const saved = process.env.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_BASE_URL = 'https://env-relay.example.com';
  try {
    const c = new ClaudeConnector(KEY, 'https://explicit.example.com');
    assert(c.baseUrl === 'https://explicit.example.com', `实际 ${c.baseUrl}`);
  } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = saved;
  }
});

console.log('\n─── factory 必须把 base_url 传下去 ───');

test('createConnector({provider:"claude", base_url}) 后接入点是中转（回归 #本次）', () => {
  const cfg = {
    provider: 'claude',
    model: 'claude-sonnet-5',
    api_key: KEY,
    base_url: 'https://api.aicodemirror.com/api/claudecode',
  } as unknown as LLMConfig;
  const c = createConnector(cfg) as ClaudeConnector;
  assert(c.baseUrl.startsWith('https://api.aicodemirror.com/api/claudecode'), `factory 丢了 base_url，实际 ${c.baseUrl}`);
});

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
