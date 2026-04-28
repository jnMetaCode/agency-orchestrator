/**
 * cli-base.ts 测试：覆盖 CLI connector 通用错误处理
 */
import { CLIBaseConnector } from '../src/connectors/cli-base.js';
import type { LLMConfig } from '../src/types.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void>): Promise<void> {
  return fn().then(() => {
    console.log(`  ✅ ${name}`);
    passed++;
  }).catch(err => {
    console.log(`  ❌ ${name}: ${err instanceof Error ? err.message : err}`);
    failed++;
  });
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg);
}

const dummyConfig: LLMConfig = { provider: 'claude-code' as any, model: 'test', timeout: 5000 };

console.log('\n─── CLIBaseConnector 错误处理 ───');

await test('exit 0 + 空 stdout + 空 stderr → reject 并给 hint', async () => {
  // 用 'true' 命令模拟一个 silent success 的 CLI（exit 0 + 不输出）
  const c = new CLIBaseConnector({
    command: 'true',
    displayName: 'Silent CLI',
    buildArgs: () => [],
  });
  let caught: Error | null = null;
  try {
    await c.chat('sys', 'user', dummyConfig);
  } catch (err) {
    caught = err as Error;
  }
  assert(caught !== null, '应当 reject');
  assert(caught!.message.includes('返回空内容'), `期望含"返回空内容"，实际: ${caught!.message}`);
  assert(
    caught!.message.includes('CLI 命令格式已变') || caught!.message.includes('agent') || caught!.message.includes('认证'),
    `应包含诊断 hint，实际: ${caught!.message}`
  );
});

await test('exit 0 + 有 stdout → 正常返回', async () => {
  // 用 'echo hello' 模拟正常 CLI 输出
  const c = new CLIBaseConnector({
    command: 'echo',
    displayName: 'Echo CLI',
    buildArgs: () => ['hello'],
  });
  const result = await c.chat('', '', dummyConfig);
  assert(result.content === 'hello', `期望 "hello"，实际: ${JSON.stringify(result.content)}`);
});

await test('exit 非 0 + 有 stderr → reject 含 stderr', async () => {
  // 用 'sh -c "echo error >&2; exit 1"' 模拟报错的 CLI
  const c = new CLIBaseConnector({
    command: 'sh',
    displayName: 'Failing CLI',
    buildArgs: () => ['-c', 'echo "boom" >&2; exit 1'],
  });
  let caught: Error | null = null;
  try {
    await c.chat('', '', dummyConfig);
  } catch (err) {
    caught = err as Error;
  }
  assert(caught !== null, '应当 reject');
  assert(caught!.message.includes('boom'), `错误消息应含 stderr 内容，实际: ${caught!.message}`);
});

await test('找不到命令 → ENOENT 提示安装', async () => {
  const c = new CLIBaseConnector({
    command: '__definitely_does_not_exist_4837__',
    displayName: 'Ghost CLI',
    installHint: 'npm i -g ghost',
    buildArgs: () => [],
  });
  let caught: Error | null = null;
  try {
    await c.chat('', '', dummyConfig);
  } catch (err) {
    caught = err as Error;
  }
  assert(caught !== null, '应当 reject');
  assert(
    caught!.message.includes('找不到') && caught!.message.includes('Ghost CLI'),
    `应提示找不到命令，实际: ${caught!.message}`
  );
});

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
