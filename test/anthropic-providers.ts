/**
 * Anthropic 原生协议的云端 provider（AICodeMirror 等）。
 *
 * 这类 provider 与 OpenAI 兼容那批走的是**不同协议**，混进 API_PROVIDERS 会被用错
 * 连接器（POST /v1/chat/completions → 404），而且要等真跑起来才暴露。所以单独一张
 * 注册表，并在这里钉死三件事：
 *   1. 路由正确（走 ClaudeConnector，默认端点/env/显式配置的优先级对）；
 *   2. **env 变量名绝不能复用 ANTHROPIC_***（那个变量同时被 claude-code 订阅 CLI 读，
 *      共用会把用户本机的 CLI 一起改道 —— 这个坑本仓库已经踩过一次）；
 *   3. 赞助商在列表里的位置与 logo 资源真实存在（位置是商务承诺，改坏了没人报错）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { API_PROVIDERS, ANTHROPIC_PROVIDERS, ANTHROPIC_PROVIDER_MAP } from '../src/connectors/api-providers.js';
import { createConnector } from '../src/connectors/factory.js';
import { ClaudeConnector } from '../src/connectors/claude.js';
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

const cfg = (o: Record<string, unknown>): LLMConfig => o as unknown as LLMConfig;

console.log('\n─── 注册表约束（防协议混淆 / 防 env 串台） ───');

test('与 OpenAI 兼容注册表没有 id 冲突', () => {
  const openai = new Set(API_PROVIDERS.map((p) => p.id));
  for (const p of ANTHROPIC_PROVIDERS) {
    assert(!openai.has(p.id), `${p.id} 同时出现在两张表里，连接器路由会打架`);
  }
});

test('env 变量名不得复用 ANTHROPIC_*（会把 claude-code 订阅 CLI 一起改道）', () => {
  for (const p of ANTHROPIC_PROVIDERS) {
    assert(!/^ANTHROPIC_/.test(p.envKey), `${p.id} 的 envKey 复用了 ANTHROPIC_*: ${p.envKey}`);
    assert(!/^ANTHROPIC_/.test(p.envBase), `${p.id} 的 envBase 复用了 ANTHROPIC_*: ${p.envBase}`);
  }
});

test('env 变量名彼此不重复，且与 OpenAI 兼容那批也不撞', () => {
  const seen = new Map<string, string>();
  for (const p of [...API_PROVIDERS, ...ANTHROPIC_PROVIDERS]) {
    for (const v of [p.envKey, p.envBase]) {
      assert(!seen.has(v) || seen.get(v) === p.id, `${v} 被 ${seen.get(v)} 和 ${p.id} 同时使用`);
      seen.set(v, p.id);
    }
  }
});

test('默认端点是 https 且不带 /v1（客户端自己接 /v1/messages）', () => {
  for (const p of ANTHROPIC_PROVIDERS) {
    assert(/^https:\/\//.test(p.defaultBaseUrl), `${p.id} 默认端点不是 https`);
    assert(!/\/v\d+\/?$/.test(p.defaultBaseUrl), `${p.id} 默认端点不该带版本段: ${p.defaultBaseUrl}`);
  }
});

console.log('\n─── 连接器路由 ───');

test('走 ClaudeConnector（Anthropic 协议），不是 OpenAI 兼容连接器', () => {
  const c = createConnector(cfg({ provider: 'aicodemirror', model: 'claude-sonnet-5', api_key: 'sk-t' }));
  assert(c instanceof ClaudeConnector, `实际是 ${c.constructor.name}`);
});

test('没配地址时用注册表默认端点', () => {
  const c = createConnector(cfg({ provider: 'aicodemirror', model: 'm', api_key: 'sk-t' })) as ClaudeConnector;
  assert(c.baseUrl === ANTHROPIC_PROVIDER_MAP['aicodemirror'].defaultBaseUrl, `实际 ${c.baseUrl}`);
});

test('显式 base_url 优先，且多写的 /v1 会被削掉', () => {
  const c = createConnector(cfg({ provider: 'aicodemirror', model: 'm', api_key: 'sk-t', base_url: 'https://x.example.com/api/claudecode/v1' })) as ClaudeConnector;
  assert(c.baseUrl === 'https://x.example.com/api/claudecode', `实际 ${c.baseUrl}`);
});

test('env 兜底：专属变量名生效，且优先级低于显式配置', () => {
  const spec = ANTHROPIC_PROVIDER_MAP['aicodemirror'];
  const savedKey = process.env[spec.envKey];
  const savedBase = process.env[spec.envBase];
  process.env[spec.envKey] = 'sk-from-env';
  process.env[spec.envBase] = 'https://env.example.com';
  try {
    const c = createConnector(cfg({ provider: 'aicodemirror', model: 'm' })) as ClaudeConnector;
    assert(c.baseUrl === 'https://env.example.com', `env 未生效，实际 ${c.baseUrl}`);
    const c2 = createConnector(cfg({ provider: 'aicodemirror', model: 'm', api_key: 'k', base_url: 'https://explicit.example.com' })) as ClaudeConnector;
    assert(c2.baseUrl === 'https://explicit.example.com', `显式配置未压过 env，实际 ${c2.baseUrl}`);
  } finally {
    if (savedKey === undefined) delete process.env[spec.envKey]; else process.env[spec.envKey] = savedKey;
    if (savedBase === undefined) delete process.env[spec.envBase]; else process.env[spec.envBase] = savedBase;
  }
});

console.log('\n─── 赞助位（位置是商务承诺，改坏了没人会报错） ───');

const studioSrc = readFileSync('website/src/lib/studio.ts', 'utf-8');
const sponsorsSrc = readFileSync('website/src/content/sponsors.ts', 'utf-8');

function providerOrder(): string[] {
  const block = studioSrc.slice(studioSrc.indexOf('export const API_PROVIDERS: ApiProviderMeta[]'));
  return [...block.slice(0, block.indexOf('\n];')).matchAll(/\{ id: "([\w-]+)"/g)].map((m) => m[1]);
}

test('Studio 供应商列表：AICodeMirror 紧跟两个高亮位（= 第 2 行首位）', () => {
  const order = providerOrder();
  const i = order.indexOf('aicodemirror');
  assert(i === 2, `应排在第 3 位（索引 2，即两个高亮位之后），实际索引 ${i}：${order.slice(0, 4).join(' → ')}`);
});

test('官网赞助商页：AICodeMirror 紧跟多元探索之后', () => {
  const ids = [...sponsorsSrc.matchAll(/^    id: "([\w-]+)"/gm)].map((m) => m[1]);
  const d = ids.indexOf('duoyuanx');
  assert(d >= 0 && ids[d + 1] === 'aicodemirror', `顺序不对：${ids.join(' → ')}`);
});

test('logo 资源真实存在（扩展名写错就是个 404 破图）', () => {
  const m = studioSrc.match(/PROVIDER_LOGO_SVG_IDS = new Set\(\[([^\]]*)\]\)/);
  const svgIds = new Set((m?.[1] ?? '').match(/"([\w-]+)"/g)?.map((x) => x.replace(/"/g, '')) ?? []);
  const ext = svgIds.has('aicodemirror') ? 'svg' : 'png';
  const p = `website/public/sponsors/logo-aicodemirror-icon.${ext}`;
  assert(existsSync(p), `按代码推导出的 logo 路径不存在: ${p}`);
});

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
