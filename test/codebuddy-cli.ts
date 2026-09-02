/**
 * codebuddy-cli（腾讯 CodeBuddy / WorkBuddy 内置 CLI）——不依赖本机装没装。
 *
 * 真机事实（WorkBuddy 5.1.7 / codebuddy 2.103.3, macOS, 2026-09-02）：命令行参数与 Claude Code
 * 逐项对齐，唯一会咬人的差异是 `--output-format json` 打印的是**整段对话的数组**，最后一个元素
 * 才是 `type:"result"`；按 Claude Code 的单对象去读会拿到 undefined → 误报"返回空内容"。
 * 这里把这条差异钉住，再钉住工厂/探测表/安装目标三处登记。
 */
import { parseResultJson } from '../src/connectors/claude-code.js';
import { CodeBuddyCLIConnector } from '../src/connectors/codebuddy-cli.js';
import { createConnector } from '../src/connectors/factory.js';
import { CLI_PROVIDER_BINS } from '../src/providers/detect.js';
import { extraBinDirs } from '../src/utils/bin-lookup.js';
import { INSTALL_TARGETS } from '../src/cli/install.js';

let passed = 0, failed = 0;
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (err) { console.log(`  ❌ ${name}: ${err instanceof Error ? err.message : err}`); failed++; }
}
function assert(c: boolean, m: string): void { if (!c) throw new Error(m); }

console.log('\n─── codebuddy-cli ───');

test('JSON 数组输出：取 type=result 元素（CodeBuddy 形态）', () => {
  const out = JSON.stringify([
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
    { type: 'file-history-snapshot', id: 'x' },
    { type: 'message', role: 'assistant', content: [{ type: 'text', text: '收到' }] },
    { type: 'result', subtype: 'success', is_error: false, result: '收到', usage: { input_tokens: 10, output_tokens: 2 } },
  ]);
  const r = parseResultJson(out);
  assert(r.result === '收到' && r.usage.input_tokens === 10, `应取到 result 元素，实际 ${JSON.stringify(r).slice(0, 100)}`);
});

test('JSON 数组但没有 result 元素：退而取最后一条 assistant 文本', () => {
  const out = JSON.stringify([
    { type: 'message', role: 'assistant', content: [{ type: 'text', text: '第一段' }, { type: 'text', text: '第二段' }] },
  ]);
  const r = parseResultJson(out);
  assert(r.result === '第一段\n第二段', `实际 ${r.result}`);
});

test('单对象输出（Claude Code 形态）原样返回', () => {
  const r = parseResultJson(JSON.stringify({ type: 'result', result: 'ok', usage: { input_tokens: 1 } }));
  assert(r.result === 'ok' && r.usage.input_tokens === 1, '单对象应原样返回');
});

test('工厂：codebuddy-cli → CodeBuddyCLIConnector', () => {
  const c = createConnector({ provider: 'codebuddy-cli' } as any);
  assert(c instanceof CodeBuddyCLIConnector, `实际 ${c.constructor.name}`);
});

test('探测表：codebuddy-cli → codebuddy 二进制，且登记了 WorkBuddy 内置位置', () => {
  assert(CLI_PROVIDER_BINS['codebuddy-cli'] === 'codebuddy', `实际 ${CLI_PROVIDER_BINS['codebuddy-cli']}`);
  const dirs = extraBinDirs('codebuddy', {});
  assert(dirs.some((d) => d.includes('WorkBuddy.app')), `应含 WorkBuddy.app 内置路径，实际 ${dirs.join(',')}`);
});

test('安装目标：workbuddy → ~/.workbuddy/agents，codebuddy → ~/.codebuddy/agents', () => {
  assert(INSTALL_TARGETS['workbuddy'].dest('/h', '/c').endsWith('/.workbuddy/agents'), 'workbuddy 目录不对');
  const saved = process.env.CODEBUDDY_CONFIG_DIR;
  delete process.env.CODEBUDDY_CONFIG_DIR;
  try {
    assert(INSTALL_TARGETS['codebuddy'].dest('/h', '/c').endsWith('/.codebuddy/agents'), 'codebuddy 目录不对');
  } finally {
    if (saved !== undefined) process.env.CODEBUDDY_CONFIG_DIR = saved;
  }
});

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
