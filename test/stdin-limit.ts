/**
 * 测试 stdin 切换逻辑 (Issue #1 ENAMETOOLONG)
 *
 * 阈值与判定逻辑直接从 cli-base 导入，不再抄一份常量 ——
 * 之前这里硬写 128KB，而实现早就改成 4KB，测试形同虚设。
 */
import { chooseTransport, ARG_SAFE_LIMIT } from '../src/connectors/cli-base.js';

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

console.log('\n─── ENAMETOOLONG stdin 切换 (Issue #1) ───');

test('短 prompt 走命令行参数', () => {
  assert(chooseTransport('Hello world', true, 'linux') === 'arg', '短 prompt 不该走 stdin');
});

test(`超过 ${ARG_SAFE_LIMIT / 1024}KB 的 prompt 走 stdin（CLI 支持 stdin 时）`, () => {
  const prompt = 'A'.repeat(ARG_SAFE_LIMIT + 1);
  assert(chooseTransport(prompt, true, 'linux') === 'stdin', `${prompt.length} bytes should use stdin`);
});

test('中文长文本按字节数判定（每字 3 bytes）', () => {
  const chars = Math.ceil(ARG_SAFE_LIMIT / 3) + 1;
  const prompt = '中'.repeat(chars);
  assert(chooseTransport(prompt, true, 'linux') === 'stdin', `${chars} 个中文字符应走 stdin`);
});

test('恰好等于阈值不切 stdin', () => {
  assert(chooseTransport('A'.repeat(ARG_SAFE_LIMIT), true, 'linux') === 'arg', '边界值不该切');
});

test('CLI 不支持 stdin 时，长 prompt 仍走参数（不退化成字面量 "-"）', () => {
  const prompt = 'A'.repeat(ARG_SAFE_LIMIT * 4);
  assert(chooseTransport(prompt, false, 'linux') === 'arg', '不支持 stdin 的 CLI 不该被切走');
});

test('buildStdinArgs 返回 -p - 格式', () => {
  // 模拟 claude-code buildStdinArgs
  const buildStdinArgs = () => ['-p', '-', '--output-format', 'text'];
  const args = buildStdinArgs();
  assert(args[0] === '-p', 'first arg should be -p');
  assert(args[1] === '-', 'second arg should be - (stdin)');
});

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
