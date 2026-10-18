/**
 * cli-base.ts 测试：覆盖 CLI connector 通用错误处理
 */
import { CLIBaseConnector, decodeProcessOutput } from '../src/connectors/cli-base.js';
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

await test('非零退出即使输出了部分正文也必须失败，不能把残缺成果传给下游', async () => {
  const c = new CLIBaseConnector({
    command: process.execPath, displayName: 'Partial CLI',
    buildArgs: () => ['-e', 'process.stdout.write("partial-result"); process.exit(7)'],
  });
  let message = '';
  try { await c.chat('', '', dummyConfig); } catch (e) { message = (e as Error).message; }
  assert(/exit 7/.test(message), `应报告失败退出码，实际: ${message}`);
  assert(!message.includes('partial-result'), '不在错误里回显未完成的正文');
});

if (process.platform !== 'win32') await test('信号终止即使已有正文也必须失败并说明信号', async () => {
  const c = new CLIBaseConnector({
    command: process.execPath, displayName: 'Interrupted CLI',
    buildArgs: () => ['-e', 'process.stdout.write("partial-result"); process.kill(process.pid, "SIGTERM")'],
  });
  let message = '';
  try { await c.chat('', '', dummyConfig); } catch (e) { message = (e as Error).message; }
  assert(/SIGTERM/.test(message), `应报告终止信号，实际: ${message}`);
});

await test('静默空输出提示不回显参数里的完整提示词或凭证', async () => {
  const secret = 'private-task-sk-fake-secret';
  const c = new CLIBaseConnector({
    command: process.execPath, displayName: 'Silent argument CLI',
    buildArgs: prompt => ['-e', 'process.exit(0)', '--', prompt],
  });
  let message = '';
  try { await c.chat('', secret, dummyConfig); } catch (e) { message = (e as Error).message; }
  assert(/返回空内容/.test(message) && !message.includes(secret), `不应回显参数，实际: ${message}`);
});

await test('输出解析器异常通过 chat 拒绝返回，不成为未捕获异常', async () => {
  const c = new CLIBaseConnector({
    command: process.execPath, displayName: 'Invalid response CLI',
    buildArgs: () => ['-e', 'process.stdout.write("malformed")'],
    parseOutput: () => { throw new Error('invalid output format'); },
  });
  let message = '';
  try { await c.chat('', '', dummyConfig); } catch (e) { message = (e as Error).message; }
  assert(/输出解析失败/.test(message) && !/invalid output format/.test(message), `应拒绝 chat，实际: ${message}`);
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

// ─── decodeProcessOutput：Windows GBK 乱码修复（用户反馈：Gemini CLI 报错显示乱码）───
// 根因：shell:true 下命令找不到时,cmd.exe 自己吐 "'gemini' 不是内部或外部命令..."
// 这段错误用的是系统代码页(中文 Windows 是 GBK/CP936),不是 UTF-8。之前直接
// toString('utf8') 会把这段本该很清楚的报错解码成乱码。

console.log('\n─── decodeProcessOutput 编码修复 ───');

await test('合法 UTF-8 原样解码（不受影响）', async () => {
  const buf = Buffer.from('正常的中文输出 hello', 'utf-8');
  const out = decodeProcessOutput([buf]);
  assert(out === '正常的中文输出 hello', `期望原样返回，实际: ${out}`);
});

await test('多个 chunk 拼接后再解码（不能按 chunk 边界切断多字节字符）', async () => {
  // 把一个 UTF-8 中文字符的字节拆成两个 chunk,验证不会因为提前按 chunk toString() 而错乱
  const full = Buffer.from('你好', 'utf-8');
  const chunkA = full.subarray(0, 2); // "你" 的前两个字节(不完整)
  const chunkB = full.subarray(2);
  const out = decodeProcessOutput([chunkA, chunkB]);
  assert(out === '你好', `期望 "你好"，实际: ${JSON.stringify(out)}`);
});

await test('Windows GBK 乱码修复：命令未找到的中文提示能正确解码', async () => {
  // 真实 GBK 字节 —— python3: "'gemini' 不是内部或外部命令，也不是可运行的程序或批处理文件。".encode('gbk')
  const gbkBytes = Buffer.from([
    39, 103, 101, 109, 105, 110, 105, 39, 32, 178, 187, 202, 199, 196, 218, 178,
    191, 187, 242, 205, 226, 178, 191, 195, 252, 193, 238, 163, 172, 210, 178,
    178, 187, 202, 199, 191, 201, 212, 203, 208, 208, 181, 196, 179, 204, 208,
    242, 187, 242, 197, 250, 180, 166, 192, 237, 206, 196, 188, 254, 161, 163,
  ]);
  const originalPlatform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'win32' });
  try {
    const out = decodeProcessOutput([gbkBytes]);
    assert(out.includes('不是内部或外部命令'), `应正确解码为可读中文，实际: ${JSON.stringify(out)}`);
    assert(!out.includes('�'), `不应含 UTF-8 替换字符（说明还是乱码），实际: ${JSON.stringify(out)}`);
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  }
});

await test('非 Windows 平台不做 GBK 回退（避免误判真正的 UTF-8 错误内容）', async () => {
  const gbkBytes = Buffer.from([178, 187, 202, 199]); // 非法 UTF-8 字节序列
  const originalPlatform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  try {
    const out = decodeProcessOutput([gbkBytes]);
    // 非 Windows 下应该走最终兜底 toString('utf-8')，产出替换字符，而不是强行按 GBK 解出中文
    assert(out.includes('�'), `非 Windows 平台不应做 GBK 回退，实际: ${JSON.stringify(out)}`);
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  }
});

await test('命令未找到的 Windows 中文提示（GBK 乱码场景）能被识别并给安装提示', async () => {
  // 模拟一个"进程"：直接用 sh 在 stderr 打印这段 GBK 字节，退出码非 0
  const gbkBytes = Buffer.from([
    39, 103, 101, 109, 105, 110, 105, 39, 32, 178, 187, 202, 199, 196, 218, 178,
    191, 187, 242, 205, 226, 178, 191, 195, 252, 193, 238, 163, 172, 210, 178,
    178, 187, 202, 199, 191, 201, 212, 203, 208, 208, 181, 196, 179, 204, 208,
    242, 187, 242, 197, 250, 180, 166, 192, 237, 206, 196, 188, 254, 161, 163,
  ]);
  const originalPlatform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'win32' });
  try {
    // 用真实子进程把 GBK 字节写到 stderr，验证走完整的 chat() 流程（含 decodeProcessOutput）
    const c = new CLIBaseConnector({
      command: 'node',
      displayName: 'Gemini CLI',
      installHint: 'npm install -g @google/gemini-cli',
      buildArgs: () => ['-e', `process.stderr.write(Buffer.from([${[...gbkBytes].join(',')}])); process.exit(1)`],
    });
    let caught: Error | null = null;
    try {
      await c.chat('', '', dummyConfig);
    } catch (err) {
      caught = err as Error;
    }
    assert(caught !== null, '应当 reject');
    assert(caught!.message.includes('找不到'), `应识别为"命令未找到"，实际: ${caught!.message}`);
    assert(caught!.message.includes('npm install -g @google/gemini-cli'), `应包含安装提示，实际: ${caught!.message}`);
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  }
});

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
