/**
 * opencode-cli 连接器——不依赖本机装没装 opencode。
 * 钉住真机事实（opencode 1.18.27）：`--format json` 是 NDJSON，答案是 text 事件的 part.text（可多段）；
 * 支持 stdin（写完必须关，否则它一直等）。
 */
import { parseOpenCodeJson, OpenCodeCLIConnector } from '../src/connectors/opencode-cli.js';
import { createConnector } from '../src/connectors/factory.js';
import { CLI_PROVIDER_BINS } from '../src/providers/detect.js';

let passed = 0, failed = 0;
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (err) { console.log(`  ❌ ${name}: ${err instanceof Error ? err.message : err}`); failed++; }
}
function assert(c: boolean, m: string): void { if (!c) throw new Error(m); }

console.log('\n─── opencode-cli ───');

test('NDJSON：拼接所有 text 事件，忽略 step 事件', () => {
  const out = [
    '{"type":"step_start","timestamp":1,"sessionID":"s","part":{"type":"step-start"}}',
    '{"type":"text","timestamp":2,"sessionID":"s","part":{"type":"text","text":"\\n\\n第一段"}}',
    '{"type":"text","timestamp":3,"sessionID":"s","part":{"type":"text","text":"，第二段"}}',
    '{"type":"step_finish","timestamp":4,"sessionID":"s","part":{"type":"step-finish","tokens":{"input":10}}}',
    'not json',
  ].join('\n');
  assert(parseOpenCodeJson(out) === '第一段，第二段', `实际 ${JSON.stringify(parseOpenCodeJson(out))}`);
});

test('工厂 + 探测表', () => {
  assert(createConnector({ provider: 'opencode-cli' } as any) instanceof OpenCodeCLIConnector, '工厂应返回 OpenCodeCLIConnector');
  assert(CLI_PROVIDER_BINS['opencode-cli'] === 'opencode', `二进制名实际 ${CLI_PROVIDER_BINS['opencode-cli']}`);
});

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
