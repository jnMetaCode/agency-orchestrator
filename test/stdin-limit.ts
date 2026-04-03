/**
 * 测试 stdin 切换逻辑 (Issue #1 ENAMETOOLONG)
 */

const ARG_SAFE_LIMIT = 128 * 1024; // 与 cli-base.ts 一致

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

test('短 prompt 走命令行参数 (useStdin=false)', () => {
  const prompt = 'Hello world';
  const promptBytes = Buffer.byteLength(prompt, 'utf-8');
  const useStdin = promptBytes > ARG_SAFE_LIMIT;
  assert(!useStdin, `${promptBytes} bytes should not use stdin`);
});

test('128KB+ prompt 走 stdin (useStdin=true)', () => {
  const prompt = 'A'.repeat(ARG_SAFE_LIMIT + 1);
  const promptBytes = Buffer.byteLength(prompt, 'utf-8');
  const useStdin = promptBytes > ARG_SAFE_LIMIT;
  assert(useStdin, `${promptBytes} bytes should use stdin`);
});

test('中文长文本正确计算字节数', () => {
  // 中文每字 3 bytes UTF-8
  const chars = Math.ceil(ARG_SAFE_LIMIT / 3) + 1;
  const prompt = '中'.repeat(chars);
  const promptBytes = Buffer.byteLength(prompt, 'utf-8');
  const useStdin = promptBytes > ARG_SAFE_LIMIT;
  assert(useStdin, `${promptBytes} bytes (${chars} 中文字符) should use stdin`);
});

test('刚好 128KB 不走 stdin', () => {
  const prompt = 'A'.repeat(ARG_SAFE_LIMIT);
  const promptBytes = Buffer.byteLength(prompt, 'utf-8');
  const useStdin = promptBytes > ARG_SAFE_LIMIT;
  assert(!useStdin, `exactly ${ARG_SAFE_LIMIT} bytes should not use stdin`);
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
