/**
 * 测试 compose --name 参数 (Issue #7)
 */
import { generateFileName } from '../src/cli/compose.js';

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

console.log('\n─── compose --name (Issue #7) ───');

test('generateFileName 正常工作', () => {
  const name = generateFileName('代码审查工作流');
  assert(name.endsWith('.yaml'), `should end with .yaml, got ${name}`);
  assert(name.includes('代码审查工作流'), `should contain description, got ${name}`);
});

test('outputName 传入时直接加 .yaml', () => {
  // 模拟 composeWorkflow 中的逻辑
  const outputName = 'my-review';
  const fileName = outputName.endsWith('.yaml') ? outputName : `${outputName}.yaml`;
  assert(fileName === 'my-review.yaml', `got ${fileName}`);
});

test('outputName 已有 .yaml 后缀不重复加', () => {
  const outputName = 'my-review.yaml';
  const fileName = outputName.endsWith('.yaml') ? outputName : `${outputName}.yaml`;
  assert(fileName === 'my-review.yaml', `got ${fileName}`);
});

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
