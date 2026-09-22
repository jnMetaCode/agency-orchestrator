/**
 * 幻觉角色的自动替换必须**有把握**才替：它在用户看不见的地方换掉专家（Studio 只看 warnings 然后直接开跑）。
 * 以前按任意子串命中 + 宽松编辑距离，对着真实角色库：`product/pm` → game-designer（因为 develo**pm**ent），
 * `engineering/ai` → gis 的 geoai，`data/data-scientist` → gis 的 spatial-data-scientist。这里用**真角色库**钉。
 */
import { confidentRoleMatch, listRolePaths, suggestFromPaths } from '../src/agents/loader.js';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; }
}
const all = listRolePaths('node_modules/agency-agents-zh');
assert(all.length > 200, `真角色库 ${all.length} 个角色`);

console.log('\n─── 有把握的：自动替换 ───');
for (const [bad, want] of [
  ['engineering/engineering-technical-writter', 'engineering/engineering-technical-writer'],   // 拼错一个字母
  ['product/product-manger', 'product/product-manager'],
  ['marketing/content-creator', 'marketing/marketing-content-creator'],                     // 漏了库的 category 前缀
  ['engineering/backend-architect', 'engineering/engineering-backend-architect'],
  ['design/ux-researcher', 'design/design-ux-researcher'],
  ['marketing/tiktok-strategist', 'marketing/marketing-tiktok-strategist'],
]) {
  assert(confidentRoleMatch(bad, all) === want, `${bad} → ${want}（实际 ${confidentRoleMatch(bad, all)}）`);
}

console.log('\n─── 没把握的：不自动替，交给 LLM ───');
for (const bad of ['product/pm', 'engineering/ai', 'data/data-scientist', 'engineering/blockchain-developer', 'legal/quantum-lawyer']) {
  assert(confidentRoleMatch(bad, all) === undefined, `${bad} 不自动替（实际 ${confidentRoleMatch(bad, all)}）`);
}

console.log('\n─── 给 LLM 的候选按整词命中排，不按任意子串 ───');
assert(suggestFromPaths('engineering/ai', all, 3)[0] === 'engineering/engineering-ai-engineer', `engineering/ai 的首选是 ai-engineer，不是 geoai（实际 ${suggestFromPaths('engineering/ai', all, 1)}）`);
assert(!suggestFromPaths('product/pm', all, 3).some((p) => /game-development/.test(p)), 'product/pm 不再建议 game-designer');
assert(suggestFromPaths('marketing/content-creator', all, 2)[0] === 'marketing/marketing-content-creator', '正确的排最前');

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed > 0 ? 1 : 0);
