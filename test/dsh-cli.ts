/**
 * dsh-cli（DeepSeek Harness）——不依赖本机装没装 dsh。
 * 钉住真机事实（0.1.1-rc.2）：model 走 --patch 覆盖、Node < 22.15 的报错要翻译成人话、不读 stdin。
 */
import { modelPatchYaml, dshStderrHint, DshCLIConnector } from '../src/connectors/dsh-cli.js';
import { createConnector } from '../src/connectors/factory.js';
import { CLI_PROVIDER_BINS } from '../src/providers/detect.js';

let passed = 0, failed = 0;
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (err) { console.log(`  ❌ ${name}: ${err instanceof Error ? err.message : err}`); failed++; }
}
function assert(c: boolean, m: string): void { if (!c) throw new Error(m); }

console.log('\n─── dsh-cli ───');

test('model=provider/model → --patch 覆盖 agent-default-model', () => {
  const y = modelPatchYaml('agnes/agnes-2.0-flash');
  assert(!!y && y.includes("provider: 'agnes'") && y.includes("model: 'agnes-2.0-flash'"), `实际 ${y}`);
  assert(modelPatchYaml('deepseek-v4-flash') === null, '没有斜杠不该生成 patch');
  assert(modelPatchYaml('dsh-cli') === null && modelPatchYaml(undefined) === null, '占位/空不该生成 patch');
  assert(modelPatchYaml("a'b/c")!.includes("'a''b'"), 'YAML 单引号要转义');
});

test('Node 太旧的堆栈 → 人话提示', () => {
  const stderr = "SyntaxError: The requested module 'node:zlib' does not provide an export named 'createZstdDecompress'";
  assert(/Node ≥ 22\.15/.test(dshStderrHint(stderr) ?? ''), '应指出 Node 版本');
  assert(dshStderrHint('random failure') === undefined, '无关 stderr 不该乱提示');
  assert(/key/.test(dshStderrHint('LlmError: MISSING_CREDENTIAL') ?? ''), 'MISSING_CREDENTIAL 应指出缺 key');
});

test('工厂 + 探测表', () => {
  assert(createConnector({ provider: 'dsh-cli' } as any) instanceof DshCLIConnector, '工厂应返回 DshCLIConnector');
  assert(CLI_PROVIDER_BINS['dsh-cli'] === 'dsh', `二进制名实际 ${CLI_PROVIDER_BINS['dsh-cli']}`);
});

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
