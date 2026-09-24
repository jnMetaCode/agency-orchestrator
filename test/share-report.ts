/**
 * share-report.ts 测试：纯函数渲染可分享 HTML 报告。
 * 验：转义、步骤渲染、最终成品标记、步骤头剥离、图片内联、markdown 表格、署名页脚。
 */
import { renderShareReport, stripStepHeader } from '../src/cli/share-report.js';

let passed = 0, failed = 0;
function assert(c: boolean, m: string): void { if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; } }

console.log('\n─── share-report ───');

// ── stripStepHeader ──
const md = '> 🦴 **人类学家** | 步骤 1/1 | 10.1s\n\n---\n\n正文开始';
assert(stripStepHeader(md) === '正文开始', '剥掉步骤头引用块与分隔线');
assert(stripStepHeader('普通正文') === '普通正文', '无步骤头时原样返回');
// 头部不止一行：写了 acceptance 多一行、核验过多一行、断言返工过再多一行。
// 老写法只认单行，于是这些步骤的整块头原样漏进报告正文（acceptance 是主推功能，真实运行里一抓一大把）。
assert(stripStepHeader('> 🦴 **x** | 步骤 1/1\n> ✅ 验收标准: 必须提到长城\n\n---\n\n正文开始') === '正文开始', '两行头（带验收标准）也剥干净');
assert(stripStepHeader('> 🦴 **x**\n> ✅ 验收标准: a\n> 🔍 验收 ✓\n> 📏 机械断言 ✓（返工 1 轮后达标）\n\n---\n\n正文开始') === '正文开始', '四行头（标准+核验+断言）也剥干净');
assert(stripStepHeader('> 这是用户自己写的引用\n\n正文') === '> 这是用户自己写的引用\n\n正文', '正文开头的引用块不配 --- 分隔线时不动它');

// ── 基本渲染 ──
const html = renderShareReport({
  name: '副业规划 <script>alert(1)</script>',
  success: true,
  totalDuration: '182.1s',
  totalTokens: { input: 1000, output: 5493 },
  generatedAt: '2026-08-19 12:00',
  steps: [
    { id: 'research', agentName: '趋势研究员', agentEmoji: '🔭', role: 'research/trend', duration: '31.3s', tokens: { input: 10, output: 20 }, markdown: '# 赛道分析\n\n| 赛道 | 评分 |\n|---|---|\n| AI 教育 | 9 |' },
    { id: 'plan', agentName: '执行规划师', agentEmoji: '📋', duration: '42.2s', markdown: '90 天计划' },
  ],
});
assert(html.includes('副业规划'), '包含工作流名');
assert(!html.includes('<script>alert'), '标题中的 HTML 被转义');
assert(html.includes('&lt;script&gt;'), '转义为实体');
assert(html.includes('趋势研究员') && html.includes('执行规划师'), '包含全部专家名');
assert(html.includes('⭐ 最终成品'), '末步标记为最终成品');
assert(html.includes('<table>') && html.includes('AI 教育'), 'markdown 表格被渲染');
assert(html.includes('6,493 tokens') || html.includes('6,493'), '总 token 汇总展示');
assert(html.includes('github.com/jnMetaCode/agency-orchestrator'), '署名页脚带仓库链接');
assert(html.includes('npm i -g agency-orchestrator'), '署名页脚带安装命令');
assert(html.includes('prefers-color-scheme'), '带暗色适配');

// ── --compare 的存档单独一节，不混进步骤 ──
{
  const h = renderShareReport({
    name: 'w',
    steps: [
      { id: 'a', agentName: '甲', markdown: '甲的产出' },
      { id: 'b', agentName: '乙', markdown: '乙的产出' },
    ],
    compare: '# 多智能体 vs 单次基线\n\n- 评审：多智能体 **8.0** / 单次基线 **5.0**\n\n## 单次基线产出（完整）\n\n基线正文',
  });
  assert(h.includes('多智能体 vs 单次基线') && h.includes('基线正文'), '对比存档渲染进报告');
  assert(h.includes('2 个专家步骤'), '步骤计数不被对比那一节带偏');
  assert(h.split('⭐ 最终成品').length - 1 === 1 && h.indexOf('⭐ 最终成品') < h.indexOf('多智能体 vs 单次基线'), '⭐ 仍在最后一个专家步骤上，没被对比那节抢走');
  const none = renderShareReport({ name: 'w', steps: [{ id: 'a', agentName: '甲', markdown: 'x' }] });
  assert(!none.includes('多智能体 vs 单次基线'), '没跑对比时报告里不出现这一节');
}

// ── 单步骤不标最终成品 ──
const single = renderShareReport({ name: 'x', steps: [{ id: 'only', markdown: 'hi' }] });
assert(!single.includes('⭐ 最终成品'), '单步骤不标最终成品');

// ── 声明了 deliverables：⭐ 标声明的那步，不标末步 ──
const declared = renderShareReport({
  name: 'novel',
  deliverables: ['final'],
  steps: [
    { id: 'outline', agentName: '叙事学家', markdown: '大纲' },
    { id: 'final', agentName: '定稿', markdown: '正文' },
    { id: 'retro', agentName: '复盘', markdown: '复盘' },
  ],
});
const starOf = (html: string, name: string) => new RegExp(`${name}[^<]*<span class="star">`).test(html);
assert(starOf(declared, '定稿') && !starOf(declared, '复盘') && !starOf(declared, '叙事学家'), 'deliverables 声明的步骤带 ⭐，末步不带');
const declaredMiss = renderShareReport({ name: 'n', deliverables: ['nope'], steps: [{ id: 'a', markdown: 'a' }, { id: 'b', agentName: '末步', markdown: 'b' }] });
assert(starOf(declaredMiss, '末步'), 'deliverables 都对不上步骤时退回末步标 ⭐');

// ── 图片内联 ──
const withImg = renderShareReport({
  name: 'img',
  steps: [{ id: 'cover', markdown: '![封面](assets/cover.png) ![外链](https://x.com/a.png)' }],
  resolveAsset: (src) => (src === 'assets/cover.png' ? 'data:image/png;base64,AAA' : null),
});
assert(withImg.includes('src="data:image/png;base64,AAA"'), '相对图片内联为 data URI');
assert(withImg.includes('src="https://x.com/a.png"'), '外链图片保持原样');

// 模型产出经 marked 渲染，没有净化——这页会被 Studio 同源打开、也会被转发。CSP 是唯一的闸。
{
  const hostile = renderShareReport({ name: 'x', steps: [{ id: 'a', markdown: '正文 <img src=x onerror="fetch(\'/api/run\')"> <script>alert(1)</script>' }] });
  const csp = hostile.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '';
  assert(/default-src 'none'/.test(csp) && !/script-src/.test(csp) && /img-src data:/.test(csp) && /style-src 'unsafe-inline'/.test(csp),
    `页内 CSP 禁掉一切脚本、只放行内联样式与 data: 媒体（实际：${csp || '没有 CSP'}）`);
  assert(hostile.indexOf('<meta http-equiv="Content-Security-Policy"') < hostile.indexOf('\n<style>'), 'CSP 放在 <head> 最前，先于任何可被注入的内容');
  assert(!/<script[^>]*src=/.test(hostile), '报告页自己不引外部脚本（否则 CSP 会把它自己也拦掉）');
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);
