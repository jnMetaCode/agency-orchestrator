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

console.log('\n─── 赞助位数据 ───');

test('每家都有名字和 https 链接', () => {
  for (const s of [...SPONSOR_ROTATION, PREMIUM_SPONSOR]) {
    assert(!!s.name, '缺 name');
    assert(/^https:\/\//.test(s.url), `${s.name} 的链接不是 https: ${s.url}`);
  }
});

test('带 providerId 的赞助商必须是 AO 真实支持的 provider', () => {
  const known = new Set(API_PROVIDERS.map((p) => p.id));
  for (const s of [...SPONSOR_ROTATION, PREMIUM_SPONSOR]) {
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

test('持有默认 provider 位的进阶档不进轮换（避免双份曝光）', () => {
  assert(!SPONSOR_ROTATION.some((s) => s.name === PREMIUM_SPONSOR.name), 'PREMIUM_SPONSOR 不该出现在轮换池');
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
