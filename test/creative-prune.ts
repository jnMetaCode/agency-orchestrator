/**
 * 创意库扩充池的「内容体检」规则（scripts/prune-extra-prompts.mjs）。
 *
 * 这批提示词来自社区（X 推文、第三方策展库），要挂在公开产品页上，所以剔掉指名真人、
 * 以 IP 角色为主体、露骨描述三类。规则很容易写着写着就变成一刀切的关键词黑名单——
 * 那会误伤一大片正常内容，而误伤是不会有人来报 bug 的（用户只会觉得"这库怎么这么少"）。
 * 所以这里钉的主要是**不该被剔的那些**：
 *   - 负面提示词里的词（"no blood, no gore" / "avoid NSFW"）是在让模型**别生成**
 *   - "nude lips" 是裸色唇妆，美妆术语，不是色情
 *   - "Pixar-style" 是画风描述，AI 绘画社区的通用词；删了会误伤大量正常插画提示词
 */
import { violation, isNegativeContext } from '../scripts/prune-extra-prompts.mjs';

let passed = 0, failed = 0;
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.log(`  ❌ ${name}: ${e instanceof Error ? e.message : e}`); failed++; }
}
function assert(c: boolean, m: string): void { if (!c) throw new Error(m); }
const hit = (prompt: string, title = 'x') => violation({ title, prompt } as { title: string; prompt: string });

console.log('\n─── 该剔除的 ───');

test('指名真人（肖像权 + 深度合成监管）', () => {
  assert(hit('A cinematic portrait of Tom Cruise in a leather jacket')?.name === '指名真人', '应剔除');
  assert(hit('3D figurine inspired by Cristiano Ronaldo')?.name === '指名真人', '应剔除');
  assert(hit('生成一张马斯克在火星上的照片')?.name === '指名真人', '中文人名也该认');
});

test('IP 角色作主体', () => {
  assert(hit('Pikachu and Pokeball paper cut-out diorama')?.name === 'IP 角色作主体', '应剔除');
  assert(hit('a can featuring Mario and Luigi in a mushroom kingdom')?.name === 'IP 角色作主体', '应剔除');
});

test('露骨描述', () => {
  assert(hit('nude body of a woman lying on silk')?.name === '性化描述', '应剔除');
  assert(hit('23 years old, innocent-sexy pure type')?.name === '性化描述', '应剔除');
});

console.log('\n─── 不该被误伤的（这才是这条测试存在的理由）───');

test('负面提示词里的词不算命中：no blood, no gore', () => {
  assert(hit('epic fantasy war, maximum detail, no blood, no gore, no text') === null,
    '「no gore」是在让模型别生成血腥，不是血腥内容');
});

test('负面提示词里的词不算命中：avoid NSFW', () => {
  assert(hit('clean studio look. Avoid NSFW, see-through fabrics, wardrobe malfunctions') === null,
    '「avoid NSFW」是排除项');
});

test('"nude lips" 是裸色唇妆，不是色情', () => {
  assert(hit('soft makeup, rosy cheeks, glossy nude lips, defined brows') === null, '美妆术语不该剔');
  assert(hit('ivory blazer dress with gold accessories and nude heels') === null, '裸色高跟鞋不该剔');
});

test('"Pixar-style / Disney-style" 是画风词，不是 IP 角色', () => {
  assert(hit('A 3D Pixar-style young man smiling in golden hour light') === null, '画风词不该剔');
  assert(hit('Disney-style watercolor illustration of a fox') === null, '画风词不该剔');
});

test('普通内容一律放行', () => {
  assert(hit('A steaming cup of coffee on a wooden table, morning light') === null, '正常内容不该剔');
  assert(hit('产品主图：白底、45 度俯拍、柔光箱布光的保温杯') === null, '中文正常内容不该剔');
});

console.log('\n─── 负面语境判定 ───');

test('isNegativeContext 认 no/avoid/without/不要', () => {
  const s = 'render this without gore';
  assert(isNegativeContext(s, s.indexOf('gore')), 'without 应算负面语境');
  const z = '画面里不要出现血腥';
  assert(isNegativeContext(z, z.indexOf('血腥')), '中文「不要」应算负面语境');
});

test('句号之后不再算负面语境（防止整段被一个 no 罩住）', () => {
  const s = 'no text or watermark. A nude body lying on silk';
  assert(!isNegativeContext(s, s.indexOf('nude')), '跨句不该继承前面的 no');
});

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
