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

// ── 单步骤不标最终成品 ──
const single = renderShareReport({ name: 'x', steps: [{ id: 'only', markdown: 'hi' }] });
assert(!single.includes('⭐ 最终成品'), '单步骤不标最终成品');

// ── 图片内联 ──
const withImg = renderShareReport({
  name: 'img',
  steps: [{ id: 'cover', markdown: '![封面](assets/cover.png) ![外链](https://x.com/a.png)' }],
  resolveAsset: (src) => (src === 'assets/cover.png' ? 'data:image/png;base64,AAA' : null),
});
assert(withImg.includes('src="data:image/png;base64,AAA"'), '相对图片内联为 data URI');
assert(withImg.includes('src="https://x.com/a.png"'), '外链图片保持原样');

console.log(`\n  结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);
