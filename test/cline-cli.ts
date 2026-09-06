/**
 * cline-cli 连接器——不依赖本机装没装 cline。
 * 钉住真机事实（cline 3.0.61）：NDJSON 里 run_result.text 才是答案；纯中文无空格的提示词会被拒；
 * 它不读 AO 送进 stdin 的内容（只认真 FIFO），角色走 -s、任务走位置参数，超过命令行上限要明确报错。
 */
import { parseClineJson, ensureWhitespace, checkArgBudget, ClineCLIConnector } from '../src/connectors/cline-cli.js';
import { createConnector } from '../src/connectors/factory.js';
import { CLI_PROVIDER_BINS } from '../src/providers/detect.js';

let passed = 0, failed = 0;
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (err) { console.log(`  ❌ ${name}: ${err instanceof Error ? err.message : err}`); failed++; }
}
function assert(c: boolean, m: string): void { if (!c) throw new Error(m); }

console.log('\n─── cline-cli ───');

test('NDJSON：取 run_result.text，忽略 reasoning 事件', () => {
  const out = [
    '{"ts":"t","type":"hook_event","hookEventName":"agent_start"}',
    '{"ts":"t","type":"agent_event","event":{"type":"content_start","contentType":"reasoning","reasoning":"想"}}',
    '{"ts":"t","type":"agent_event","event":{"type":"done","reason":"completed","text":"\\n\\n收到"}}',
    '{"ts":"t","type":"run_result","finishReason":"completed","text":"\\n\\n收到","usage":{"inputTokens":1}}',
    '',
  ].join('\n');
  assert(parseClineJson(out) === '收到', `实际 ${JSON.stringify(parseClineJson(out))}`);
});

test('没有 run_result 时退到 done 事件的 text', () => {
  const out = '{"type":"agent_event","event":{"type":"done","text":"备胎"}}\nWarning: 非 JSON 行\n';
  assert(parseClineJson(out) === '备胎', `实际 ${parseClineJson(out)}`);
});

test('纯中文无空格的提示词补空格（否则 cline 当成未知命令）', () => {
  assert(ensureWhitespace('只回复收到') === '只回复收到 ', '应补空格');
  assert(ensureWhitespace('a b') === 'a b' && ensureWhitespace('a\nb') === 'a\nb', '已有空白不动');
});

test('两段提示词都走命令行参数：超过系统上限明确报错，而不是悄悄截断', () => {
  checkArgBudget('x'.repeat(50_000), 'y'.repeat(50_000), 'darwin'); // 各 50KB，POSIX 单参数上限 100KB 内
  let threw = false;
  try { checkArgBudget('x'.repeat(150_000), 'y', 'darwin'); } catch (e) { threw = /stdin/.test(String(e)); }
  assert(threw, 'POSIX 超 100KB 应报错且指出它不读 stdin');
  threw = false;
  try { checkArgBudget('中'.repeat(40_000), 'y', 'win32'); } catch { threw = true; }
  assert(threw, 'Windows 按 UTF-16 字符数算，4 万字应报错');
});

test('判定与报错用同一把尺：中英混排时报的是真正超限那段的体积', () => {
  // 中文段 5 万字 = 150KB 字节（超限）；ASCII 段 9 万字符 = 90KB（没超但字符数更多）。
  // 修之前按 .length 挑段去报：报出 ASCII 段的 87.9KB——一个没超限的数字，用户照着裁不动
  let msg = '';
  try { checkArgBudget('中'.repeat(50_000), 'a'.repeat(90_000), 'darwin'); } catch (e) { msg = String(e); }
  assert(/146\.5KB/.test(msg), `报错应给中文段的 146.5KB（实际：${msg.match(/[\d.]+KB/)?.[0] ?? '无'}）`);
});

test('工厂 + 探测表', () => {
  assert(createConnector({ provider: 'cline-cli' } as any) instanceof ClineCLIConnector, '工厂应返回 ClineCLIConnector');
  assert(CLI_PROVIDER_BINS['cline-cli'] === 'cline', `二进制名实际 ${CLI_PROVIDER_BINS['cline-cli']}`);
});

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
