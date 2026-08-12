/**
 * 官网远程供应商清单（website/public/providers-manifest.json）的契约测试。
 *
 * 这份 JSON 是「赞助商上/下架不用发版」的唯一通道：改它 push 官网仓即对**所有已安装
 * 的用户**生效（引擎 6h 缓存）。正因为它绕过了发版流程，也就绕过了 CI 之外的所有把关 ——
 * 手改一个逗号、少个 https、id 写错，线上就少一个赞助商或多一个连不上的端点，
 * 而且没有任何构建会报错。这里把它当代码来测。
 *
 * 服务端的解析与安全约束在 web/server.js（只收 https、id 不能覆盖内置 provider），
 * 这里测的是「文件本身是否符合那份约束」，以及下架/上架的意图有没有真的写进去。
 */
import { readFileSync } from 'node:fs';
import { API_PROVIDERS } from '../src/connectors/api-providers.js';

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

const PATH = 'website/public/providers-manifest.json';
type Manifest = {
  version?: number;
  updatedAt?: string;
  providers?: { id: string; name: string; baseUrl: string; signupUrl?: string; sponsor?: boolean }[];
  relayPresets?: { name: string; sponsor?: boolean; signupUrl?: string; baseUrls: Record<string, string> }[];
  removedProviders?: string[];
  providerOverrides?: Record<string, { defaultModel?: string; modelSuggestions?: string[] }>;
  sponsorRotation?: { providerId?: string; name: string; bonus?: string; url: string; relayOnly?: boolean }[];
};

let m!: Manifest;

console.log('\n─── 远程供应商清单（上/下架不发版的通道） ───');

test('是合法 JSON 且结构完整', () => {
  m = JSON.parse(readFileSync(PATH, 'utf-8')) as Manifest;
  for (const k of ['providers', 'relayPresets', 'removedProviders'] as const) {
    assert(Array.isArray(m[k]), `${k} 必须是数组`);
  }
  assert(typeof m.providerOverrides === 'object' && m.providerOverrides !== null, 'providerOverrides 必须是对象');
});

test('所有地址都是 https（服务端会按此过滤，写成 http 等于静默失效）', () => {
  for (const p of m.providers ?? []) {
    assert(/^https:\/\//.test(p.baseUrl), `${p.id} 的 baseUrl 不是 https: ${p.baseUrl}`);
    if (p.signupUrl) assert(/^https:\/\//.test(p.signupUrl), `${p.id} 的 signupUrl 不是 https`);
  }
  for (const r of m.relayPresets ?? []) {
    if (r.signupUrl) assert(/^https:\/\//.test(r.signupUrl), `${r.name} 的 signupUrl 不是 https`);
    for (const [cli, url] of Object.entries(r.baseUrls)) {
      assert(/^https:\/\//.test(url), `${r.name} 的 ${cli} 端点不是 https: ${url}`);
    }
  }
});

test('增量上架的 id 不能覆盖内置 provider（服务端会拒，这里提前拦）', () => {
  const builtin = new Set(API_PROVIDERS.map((p) => p.id));
  for (const p of m.providers ?? []) {
    assert(!builtin.has(p.id), `${p.id} 与内置 provider 重名，会被服务端丢弃`);
  }
});

test('要下架的 id 必须真的是内置 provider（写错等于什么都没下架）', () => {
  const builtin = new Set(API_PROVIDERS.map((p) => p.id));
  for (const id of m.removedProviders ?? []) {
    assert(builtin.has(id), `removedProviders 里的 "${id}" 不是内置 provider id，下架不会生效`);
  }
});

test('CLI 中转预设的 provider id 必须是引擎支持的那三个', () => {
  const supported = new Set(['claude-code', 'gemini-cli', 'codex-cli']);
  for (const r of m.relayPresets ?? []) {
    assert(Object.keys(r.baseUrls).length > 0, `${r.name} 没有任何端点`);
    for (const cli of Object.keys(r.baseUrls)) {
      assert(supported.has(cli), `${r.name} 里的 "${cli}" 不是可配中转的 CLI provider`);
    }
  }
});

test('赞助商轮换池：名字齐全、链接 https、providerId 必须是真 provider', () => {
  const builtin = new Set(API_PROVIDERS.map((p) => p.id));
  for (const e of m.sponsorRotation ?? []) {
    assert(!!e.name && e.name.trim().length > 0, '轮换池条目缺 name');
    assert(/^https:\/\//.test(e.url), `${e.name} 的链接不是 https（服务端会整条丢弃）: ${e.url}`);
    // 写错的 providerId 在运行时会被静默剥掉（宁可少条命令示例也不能打印跑不通的命令），
    // 所以必须在这里报出来，否则线上只会"少了点什么"而没人知道
    if (e.providerId !== undefined) {
      assert(builtin.has(e.providerId), `${e.name} 的 providerId "${e.providerId}" 不是内置 provider，运行时会被丢弃`);
      assert(e.relayOnly !== true, `${e.name} 既标了 relayOnly 又给了 providerId，自相矛盾`);
    }
  }
});

console.log('\n─── 本轮的上/下架意图确实写进了清单 ───');

test('RootFlowAI / CCSub 已下架（2026-08）', () => {
  const removed = new Set(m.removedProviders ?? []);
  for (const id of ['rootflowai', 'ccsub']) {
    assert(removed.has(id), `${id} 应在 removedProviders 里（否则老版本用户那边仍会看到）`);
  }
});

test('下架只隐藏列表，不动引擎——两家仍是可用 provider', () => {
  const builtin = new Set(API_PROVIDERS.map((p) => p.id));
  for (const id of ['rootflowai', 'ccsub']) {
    assert(builtin.has(id), `${id} 不该从引擎里删掉：已配好 key 的用户还要能跑`);
  }
});

test('AICodeMirror 的中转预设已上架，且端点与内置预设一致', () => {
  const acm = (m.relayPresets ?? []).find((r) => /aicodemirror/i.test(r.name));
  assert(!!acm, '清单里应有 AICodeMirror 预设（这样老版本不用等发版也能用）');
  assert(acm!.baseUrls['claude-code'] === 'https://api.aicodemirror.com/api/claudecode', `claude-code 端点不对: ${acm!.baseUrls['claude-code']}`);
  assert(acm!.baseUrls['gemini-cli'] === 'https://api.aicodemirror.com/api/gemini', `gemini-cli 端点不对: ${acm!.baseUrls['gemini-cli']}`);
  assert(acm!.baseUrls['codex-cli'] === 'https://api.aicodemirror.com/api/codex/backend-api/codex', `codex-cli 端点不对: ${acm!.baseUrls['codex-cli']}`);
});

test('清单里的返利码与代码里的一致（改一处漏一处 = 返利流走）', () => {
  const raw = readFileSync(PATH, 'utf-8');
  const codeRaw = readFileSync('src/utils/sponsor-guide.ts', 'utf-8') + readFileSync('website/src/lib/studio.ts', 'utf-8');
  for (const [, host, code] of raw.matchAll(/https:\/\/([\w.-]+)\/[^"']*invitecode=([\w]+)/g)) {
    const inCode = [...codeRaw.matchAll(new RegExp(`https://${host.replace(/\./g, '\\.')}/[^"']*invitecode=(\\w+)`, 'g'))].map((x) => x[1]);
    for (const c of inCode) assert(c === code, `${host} 的返利码不一致：清单 ${code} vs 代码 ${c}`);
  }
});

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
