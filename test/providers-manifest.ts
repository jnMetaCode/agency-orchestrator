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
import { SPONSOR_ROTATION } from '../src/utils/sponsor-guide.js';

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

test('LanoX AI 的中转预设已上架，且端点与内置预设一致（2026-08 新增）', () => {
  const lx = (m.relayPresets ?? []).find((r) => /lanox/i.test(r.name));
  assert(!!lx, '清单里应有 LanoX AI 预设（这样还停在旧版的用户不等发版也能用）');
  assert(lx!.baseUrls['claude-code'] === 'https://api.lanox.ai', `claude-code 端点不对（Anthropic 协议，base 不带 /v1）: ${lx!.baseUrls['claude-code']}`);
  assert(lx!.baseUrls['codex-cli'] === 'https://api.lanox.ai/v1', `codex-cli 端点不对: ${lx!.baseUrls['codex-cli']}`);
  // 没探到任何 Google 格式端点，宁可不给也不猜——填错的中转配置比没有更糟
  assert(!lx!.baseUrls['gemini-cli'], 'LanoX 没有已核实的 Gemini 端点，不该凭空填一个');
});

test('胜算云的中转预设已上架，且端点与内置预设一致（2026-08 新增）', () => {
  const ssy = (m.relayPresets ?? []).find((r) => /胜算云|shengsuanyun/i.test(r.name));
  assert(!!ssy, '清单里应有胜算云预设（这样还停在旧版的用户不等发版也能用）');
  // 主域 api.shengsuanyun.com 整站 404，端点在 router 子域的 /api 前缀下——照主域猜必错
  assert(ssy!.baseUrls['claude-code'] === 'https://router.shengsuanyun.com/api', `claude-code 端点不对（Anthropic 协议，base 不带 /v1）: ${ssy!.baseUrls['claude-code']}`);
  assert(ssy!.baseUrls['gemini-cli'] === 'https://router.shengsuanyun.com/api', `gemini-cli 端点不对: ${ssy!.baseUrls['gemini-cli']}`);
  assert(ssy!.baseUrls['codex-cli'] === 'https://router.shengsuanyun.com/api/v1', `codex-cli 端点不对: ${ssy!.baseUrls['codex-cli']}`);
});

test('轮换池与代码里的那份逐条一致（清单配了就整池替换，漏一家=那家线上零曝光）', () => {
  const pool = m.sponsorRotation ?? [];
  assert(pool.length === SPONSOR_ROTATION.length,
    `清单 ${pool.length} 家 vs 代码 ${SPONSOR_ROTATION.length} 家：整池替换的语义下，少写一家就是把它从所有用户眼前拿掉了`);
  const key = (e: { name: string; url: string; relayOnly?: boolean; providerId?: string }) =>
    `${e.name}|${e.url}|${e.relayOnly === true}|${e.providerId ?? ''}`;
  const inCode = new Set(SPONSOR_ROTATION.map(key));
  for (const e of pool) assert(inCode.has(key(e)), `清单里的「${e.name}」与代码那份对不上：${key(e)}`);
});

test('清单里的返利/渠道参数与代码里的一致（改一处漏一处 = 返利悄悄流走）', () => {
  // 按 host + 参数名比对，而不是只认 invitecode 一种写法：LanoX 用的是 ?c=…&inviteCode=…，
  // 只匹配 invitecode 会静默漏过（大小写敏感），返利错了没有任何环节会报错。
  const AFFILIATE_KEYS = ['invitecode', 'inviteCode', 'invite', 'aff', 'ref', 'referral_code', 'code', 'c', 'from'];
  const collect = (text: string, into: Map<string, Map<string, Set<string>>>) => {
    for (const raw of text.match(/https:\/\/[^\s"'`,)]+/g) ?? []) {
      let u: URL;
      try { u = new URL(raw.replace(/[),;]+$/, '')); } catch { continue; }
      for (const k of AFFILIATE_KEYS) {
        const v = u.searchParams.get(k);
        if (!v) continue;
        const byKey = into.get(u.host) ?? new Map<string, Set<string>>();
        byKey.set(k, (byKey.get(k) ?? new Set()).add(v));
        into.set(u.host, byKey);
      }
    }
  };
  const all = new Map<string, Map<string, Set<string>>>();
  collect(readFileSync(PATH, 'utf-8'), all);
  collect(readFileSync('src/utils/sponsor-guide.ts', 'utf-8'), all);
  collect(readFileSync('website/src/lib/studio.ts', 'utf-8'), all);
  const conflicts: string[] = [];
  for (const [host, byKey] of all) {
    for (const [k, vals] of byKey) {
      if (vals.size > 1) conflicts.push(`${host} 的 ${k} 有多个值：${[...vals].join(' / ')}`);
    }
  }
  assert(conflicts.length === 0, `清单与代码的返利参数不一致：\n    ${conflicts.join('\n    ')}`);
  assert(all.size > 0, '一个返利链接都没扫到，说明扫描逻辑失效了');
});

console.log('\n─── 下架赞助商在 Studio 列表里的可见性 ───');

// 前端列表的过滤规则（website/src/components/studio/ProvidersPanel.tsx）：
//   1) 远程清单 removedProviders 里的 → 隐藏（部署即生效，覆盖所有老版本）
//   2) 代码里标了 delisted 的 → 隐藏，但**自己配过 key 的仍显示**
// 规则本身在 tsx 里，这里用同一份判定复算一遍，钉住"下架"与"不搞坏老用户"两个意图。
function visibleInList(m: { id: string; delisted?: boolean }, removed: string[], hasKey: boolean): boolean {
  if (removed.includes(m.id)) return false;
  return !m.delisted || hasKey;
}

test('已下架且没配过 key → 列表里不露出（不再向新用户推荐）', () => {
  const removed = m.removedProviders ?? [];
  for (const id of ['rootflowai', 'ccsub']) {
    assert(!visibleInList({ id, delisted: true }, removed, false), `${id} 对新用户应隐藏`);
  }
});

test('已下架但用户配过 key → 仍然显示（配置还在、还能跑，抽走入口只会让人以为 key 丢了）', () => {
  const removed: string[] = [];  // 清单拉不到时也要成立
  for (const id of ['rootflowai', 'ccsub']) {
    assert(visibleInList({ id, delisted: true }, removed, true), `${id} 对老用户应保留入口`);
  }
});

test('在架供应商不受影响', () => {
  const removed = m.removedProviders ?? [];
  for (const id of ['apinebula', 'cubence', 'deepseek', 'claude']) {
    assert(visibleInList({ id }, removed, false), `${id} 不该被误隐藏`);
  }
});

// ── 赞助位不能被非赞助条目占掉 ───────────────────────────────────────────────
// 2026-08-28：「火山引擎 · Agent Plan 套餐」按约定不重复标赞助商（同一家不能在列表出现两次），
// 但它紧挨着火山引擎声明，而供应商列表原先**完全没有排序**、纯按声明顺序渲染——
// 于是这个非赞助条目排在了 LanoX / APIMart 等赞助商前面，白占一个赞助位。
{
  const panel = readFileSync('website/src/components/studio/ProvidersPanel.tsx', 'utf-8');

  test('Studio 供应商列表按赞助层级排序（旗舰 → 赞助商 → 其余）', () => {
    assert(/\.sort\(\s*\(a, b\)\s*=>\s*\(a\.flagship \? 0 : a\.sponsor \? 1 : 2\)/.test(panel),
      'ProvidersPanel 必须在渲染前按赞助层级排序，否则任何插在赞助商中间的非赞助条目都会占掉赞助位');
  });

  test('纯数据推演：非赞助条目排序后一定落在所有赞助商之后', () => {
    const rank = (m: { flagship?: boolean; sponsor?: boolean }) => (m.flagship ? 0 : m.sponsor ? 1 : 2);
    const sorted = API_PROVIDERS.slice().sort((a, b) => rank(a) - rank(b));
    const lastSponsor = sorted.map(rank).lastIndexOf(1);
    const firstPlain = sorted.map(rank).indexOf(2);
    assert(firstPlain === -1 || lastSponsor === -1 || lastSponsor < firstPlain,
      '排序后不该还有非赞助条目排在赞助商前面');
    // 火山方舟套餐是这条规则的由来：它没有 sponsor 标，就必须排在赞助商之后
    const plan = sorted.findIndex((x) => x.id === 'volcengine-plan');
    if (plan >= 0) {
      assert(rank(sorted[plan]) === 2, '方舟套餐不标 sponsor（同一家不重复上榜），因此应归入"其余"组');
      assert(plan > lastSponsor, `方舟套餐应排在所有赞助商之后，实得位置 ${plan}，最后一个赞助商在 ${lastSponsor}`);
    }
  });

  test('组内保持声明顺序（赞助商之间的次序是谈好的，排序不能打乱）', () => {
    const rank = (m: { flagship?: boolean; sponsor?: boolean }) => (m.flagship ? 0 : m.sponsor ? 1 : 2);
    const sorted = API_PROVIDERS.slice().sort((a, b) => rank(a) - rank(b));
    const declared = API_PROVIDERS.filter((x) => rank(x) === 1).map((x) => x.id);
    const rendered = sorted.filter((x) => rank(x) === 1).map((x) => x.id);
    assert(JSON.stringify(declared) === JSON.stringify(rendered),
      `赞助商组内顺序被打乱了：声明 ${declared.join(',')} → 渲染 ${rendered.join(',')}`);
  });
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
