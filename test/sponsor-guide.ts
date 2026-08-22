/**
 * 赞助位数据与轮换规则测试。
 *
 * 这份数据同时被 CLI 无凭证引导（src/cli.ts）和 Studio 的 no_credentials 响应
 * （web/server.js）消费，且直接对赞助商有商业承诺（每家 2/N 天数），此前零覆盖。
 * 重点钉两件事：
 *   1. 轮换是确定性、等份的 —— 份额能向赞助商解释；
 *   2. 引导里的示例命令永远指向一个真实存在的 provider —— 纯 CLI 中转商
 *      （relayOnly，如 AICodeMirror）不能被拿去拼 `--provider`。
 */
import { readFileSync } from 'node:fs';
import { SPONSOR_ROTATION, PREMIUM_SPONSOR, rotatingSponsors, guideProviderId } from '../src/utils/sponsor-guide.js';
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

const DAY = 86_400_000;

/** 当前真正占着曝光位的赞助商：轮换池 + 进阶档（进阶档可能空着，见 sponsor-guide.ts）。 */
const exposed = () => [...SPONSOR_ROTATION, ...(PREMIUM_SPONSOR ? [PREMIUM_SPONSOR] : [])];

console.log('\n─── 赞助位数据 ───');

test('每家都有名字和 https 链接', () => {
  for (const s of exposed()) {
    assert(!!s.name, '缺 name');
    assert(/^https:\/\//.test(s.url), `${s.name} 的链接不是 https: ${s.url}`);
  }
});

test('带 providerId 的赞助商必须是 AO 真实支持的 provider', () => {
  const known = new Set(API_PROVIDERS.map((p) => p.id));
  for (const s of exposed()) {
    if (!s.providerId) continue;
    assert(known.has(s.providerId), `${s.name} 的 providerId "${s.providerId}" 不在 API_PROVIDERS 里`);
  }
});

test('纯 CLI 中转商（relayOnly）不带 providerId', () => {
  for (const s of SPONSOR_ROTATION) {
    if (s.relayOnly) assert(!s.providerId, `${s.name} 标了 relayOnly 就不该有 providerId`);
    else assert(!!s.providerId, `${s.name} 不是 relayOnly 就必须有 providerId`);
  }
});

test('轮换池里没有重名', () => {
  const names = SPONSOR_ROTATION.map((s) => s.name);
  assert(new Set(names).size === names.length, `有重复：${names.join(', ')}`);
});

test('已下架的赞助商不得出现在曝光位（RootFlowAI / CCSub，2026-08 下架）', () => {
  const delisted = [/rootflow/i, /ccsub/i];
  for (const s of exposed()) {
    for (const re of delisted) {
      assert(!re.test(s.name) && !re.test(s.url), `${s.name} 已下架赞助，不该还在曝光位`);
    }
  }
});

test('下架赞助 ≠ 下架供应商：它们仍是可用 provider（不搞坏已配 key 的用户）', () => {
  const ids = new Set(API_PROVIDERS.map((p) => p.id));
  for (const id of ['rootflowai', 'ccsub']) {
    assert(ids.has(id), `${id} 应保留为可用供应商，只摘赞助曝光`);
  }
});

test('进阶档若有人持有，不得同时在轮换池里（避免双份曝光）', () => {
  // 现状是无人持有（多元探索 2026-08-17 下架）——那就没什么可冲突的；
  // 但下一家买进阶档时这条必须仍然拦得住"既拿进阶位又留在轮换池"。
  if (!PREMIUM_SPONSOR) return;
  assert(!SPONSOR_ROTATION.some((x) => x.name === PREMIUM_SPONSOR.name), 'PREMIUM_SPONSOR 不该出现在轮换池');
});

test('已下架的多元探索不得出现在任何曝光位，但仍是可用 provider', () => {
  for (const s of exposed()) {
    assert(!/多元探索|duoyuanx/i.test(s.name), `${s.name} 已下架赞助，不该还在曝光位`);
    assert(!/duoyuanx\.com/i.test(s.url), `${s.name} 的链接还指向已下架的多元探索：${s.url}`);
  }
  assert(API_PROVIDERS.some((p) => p.id === 'duoyuanx'), 'duoyuanx 应保留为可用供应商——已配过 key 的用户不该被搞坏');
});

console.log('\n─── 返利码一致性（同一赞助商的推广参数散落在三份清单里） ───');

/**
 * 赞助商的注册链接同时存在于三处：引导轮换池（本文件所在的 sponsor-guide.ts）、
 * 官网赞助商页（content/sponsors.ts）、Studio 供应商与中转预设（lib/studio.ts）。
 * utm/ytag 这类来源标记按位置不同是**故意**的，但**返利标识**（invitecode / aff /
 * ref / referral_code / code）必须处处一致 —— 改一处漏两处，返利就从那两处悄悄流走，
 * 而且没有任何报错，只能靠对账发现。这里跨文件按 host 比对返利标识。
 */
// 注意大小写：URLSearchParams.get 大小写敏感，'invitecode' 抓不到 LanoX 的 `inviteCode`，
// 所以两种写法都列。'c' 是 LanoX 的渠道码（?c=…&inviteCode=…，两个参数都得处处一致），
// 'from' 是胜算云的（?from=CH_…）、's' 是秘塔的（?s=gt…）—— 每家用的参数名都不一样，
// 漏一个等于这家根本没被守着。（按 host 分组比对，所以 's' 这种通用名不会串到别家。）
const AFFILIATE_KEYS = ['invitecode', 'inviteCode', 'invite', 'aff', 'ref', 'referral_code', 'code', 'c', 'from', 's'];
const SOURCES = [
  'src/utils/sponsor-guide.ts',
  'website/src/content/sponsors.ts',
  'website/src/lib/studio.ts',
];

test('同一赞助商的返利码在三份清单里完全一致', () => {
  // host → key → { value → 出处 }
  const seen = new Map<string, Map<string, Map<string, string[]>>>();
  for (const file of SOURCES) {
    let text = '';
    try { text = readFileSync(file, 'utf-8'); } catch { continue; }  // 前端文件不存在时跳过（引擎单独发包）
    for (const raw of text.match(/https:\/\/[^\s"'`]+/g) ?? []) {
      let u: URL;
      try { u = new URL(raw.replace(/[),;]+$/, '')); } catch { continue; }
      for (const k of AFFILIATE_KEYS) {
        const v = u.searchParams.get(k);
        if (!v) continue;
        const byKey = seen.get(u.host) ?? new Map();
        const byVal = byKey.get(k) ?? new Map();
        byVal.set(v, [...(byVal.get(v) ?? []), file]);
        byKey.set(k, byVal);
        seen.set(u.host, byKey);
      }
    }
  }
  const conflicts: string[] = [];
  for (const [host, byKey] of seen) {
    for (const [k, byVal] of byKey) {
      if (byVal.size > 1) {
        conflicts.push(`${host} 的 ${k} 有 ${byVal.size} 个值：` +
          [...byVal.entries()].map(([v, files]) => `${v}(${[...new Set(files)].join(', ')})`).join(' / '));
      }
    }
  }
  assert(conflicts.length === 0, `返利码不一致：\n    ${conflicts.join('\n    ')}`);
  assert(seen.size > 0, '一个返利链接都没扫到，说明扫描逻辑失效了');
});

console.log('\n─── 轮换规则 ───');

test('同一天永远返回同一批（确定性，不随调用时刻抖动）', () => {
  const t = Date.UTC(2026, 7, 11, 3, 0, 0);
  const a = rotatingSponsors(2, t).map((s) => s.name);
  const b = rotatingSponsors(2, t + 3600_000).map((s) => s.name);
  assert(JSON.stringify(a) === JSON.stringify(b), `同日不一致：${a} vs ${b}`);
});

test('相邻两天会换人（不会连着几天只推同一家）', () => {
  const t = Date.UTC(2026, 7, 11);
  const a = rotatingSponsors(2, t)[0].name;
  const b = rotatingSponsors(2, t + DAY)[0].name;
  assert(a !== b, `连续两天首位相同：${a}`);
});

test('一个完整周期内每家的曝光天数完全相等（份额可向赞助商解释）', () => {
  const n = SPONSOR_ROTATION.length;
  const count = new Map<string, number>();
  for (let d = 0; d < n; d++) {
    for (const s of rotatingSponsors(2, Date.UTC(2026, 0, 1) + d * DAY)) {
      count.set(s.name, (count.get(s.name) ?? 0) + 1);
    }
  }
  assert(count.size === n, `一个周期内应覆盖全部 ${n} 家，实际 ${count.size} 家`);
  const days = [...count.values()];
  assert(new Set(days).size === 1, `曝光天数不均：${[...count.entries()].map(([k, v]) => `${k}:${v}`).join(' ')}`);
  assert(days[0] === 2, `每家应为 2 天，实际 ${days[0]}`);
});

test('要几家给几家，且不越界', () => {
  assert(rotatingSponsors(1).length === 1, 'count=1');
  assert(rotatingSponsors(SPONSOR_ROTATION.length + 5).length === SPONSOR_ROTATION.length, '超过池子大小时封顶');
});

console.log('\n─── 引导示例命令的 provider ───');

test('任意一天的示例命令都指向真实 provider（不会打印 unknown provider）', () => {
  const known = new Set(API_PROVIDERS.map((p) => p.id));
  for (let d = 0; d < SPONSOR_ROTATION.length * 3; d++) {
    const rots = rotatingSponsors(2, Date.UTC(2026, 0, 1) + d * DAY);
    const pid = guideProviderId(rots);
    assert(known.has(pid), `第 ${d} 天拿到不存在的 provider: ${pid}`);
  }
});

test('当天轮值含 relayOnly 时，示例命令跳过它取有 API 的那家', () => {
  const relay = { name: 'RelayOnly测试', url: 'https://example.com', relayOnly: true };
  const api = SPONSOR_ROTATION.find((s) => s.providerId)!;
  assert(guideProviderId([relay, api]) === api.providerId, '应取第二家的 providerId');
  // 极端情形：当天两家都是纯中转商 → 退回轮换池里第一个有 provider 的，仍可执行
  const fallback = guideProviderId([relay, { ...relay, name: 'RelayOnly测试2' }]);
  assert(new Set(API_PROVIDERS.map((p) => p.id)).has(fallback), `兜底也必须是真 provider，实际 ${fallback}`);
});

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
