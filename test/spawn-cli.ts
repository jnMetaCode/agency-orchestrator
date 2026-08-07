/**
 * spawn-cli / 提示词传输通道 测试（issue #102）
 *
 * 钉死两件事：
 * 1. 参数必须原样送达子进程 —— 不允许再被任何 shell 解析（Windows 上 shell:true
 *    会把 `<system>`、换行、空格拼成一行喂给 cmd.exe，报"命令语法不正确"）；
 * 2. 只有真的会读 stdin 的 CLI 才允许把长 prompt 切到 stdin，否则模型会收到字面量 "-"。
 */
import {
  findExecutable, parseNpmShim, quoteWinArg, buildCmdLine, planLaunch,
} from '../src/connectors/spawn-cli.js';
import {
  chooseTransport, ARG_SAFE_LIMIT, ARG_HARD_LIMIT_WIN, ARG_HARD_LIMIT_POSIX,
  CLIBaseConnector,
} from '../src/connectors/cli-base.js';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LLMConfig } from '../src/types.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => { console.log(`  ✅ ${name}`); passed++; })
    .catch(err => { console.log(`  ❌ ${name}: ${err instanceof Error ? err.message : err}`); failed++; });
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg);
}

const dummyConfig: LLMConfig = { provider: 'hermes-cli' as any, model: 'test', timeout: 20000 };

/** 真实工作流里的提示词形状：带尖括号标签、换行、引号、cmd 元字符 */
const NASTY_PROMPT = '<system>\n你是"产品经理" & 首席架构师\n</system>\n\n请输出 100% 可执行的方案 | 谢谢';

console.log('\n─── spawn-cli：参数原样送达 (Issue #102) ───');

await test('CLI connector 传入的 prompt 一字不差地到达子进程 argv', async () => {
  // 用 node 打印它收到的 argv，模拟一个把 prompt 当参数收的 CLI
  const c = new CLIBaseConnector({
    command: process.execPath,
    displayName: 'Argv Echo CLI',
    buildArgs: (prompt: string) => ['-e', 'process.stdout.write(process.argv[1])', prompt],
  });
  const result = await c.chat('你是"产品经理" & 首席架构师', '请输出 100% 可执行的方案 | 谢谢', dummyConfig);
  assert(
    result.content.includes('<system>') && result.content.includes('&') && result.content.includes('|'),
    `参数被 shell 吃掉了: ${JSON.stringify(result.content.slice(0, 120))}`
  );
  assert(result.content.includes('\n'), '换行丢失');
});

await test('空串参数不会被吞掉（Windows 裸拼会把 --tools "" 拼没）', async () => {
  const c = new CLIBaseConnector({
    command: process.execPath,
    displayName: 'Argv Count CLI',
    buildArgs: () => ['-e', 'process.stdout.write(String(process.argv.length))', '--', '--tools', '', '--effort', 'low'],
  });
  const result = await c.chat('', 'x', dummyConfig);
  // argv = [node, --tools, '', --effort, low] → 5（shell 裸拼会把空串吃掉，变成 4）
  assert(result.content.trim() === '5', `期望 5 个 argv，实际 ${result.content.trim()}`);
});

await test('planLaunch 在非 Windows 上原样透传，不套 shell', () => {
  const plan = planLaunch('hermes', ['-z', NASTY_PROMPT], 'Hermes', {}, 'darwin');
  assert(plan.file === 'hermes', `file 应为 hermes，实际 ${plan.file}`);
  assert(plan.args[1] === NASTY_PROMPT, 'prompt 参数被改写了');
  assert(plan.viaCmd === false, '非 Windows 不应走 cmd.exe');
});

await test('Windows 上命令找不到时交回 Node（保留 ENOENT 的"没装"提示）', () => {
  const plan = planLaunch('definitely-not-installed-xyz', ['-z', 'hi'], 'X', { PATH: '' }, 'win32');
  assert(plan.file === 'definitely-not-installed-xyz', '找不到时应原样交给 spawn 抛 ENOENT');
  assert(plan.viaCmd === false, '找不到时不应构造 cmd.exe 调用');
});

await test('findExecutable 能在 PATH 上找到当前 node', () => {
  const found = findExecutable('node');
  assert(process.platform === 'win32' || found !== null, 'PATH 上应能找到 node');
});

console.log('\n─── npm .cmd shim 解析（Windows 全局包的真实形状） ───');

const NPM_SHIM = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0

IF EXIST "%dp0%\\node.exe" (
  SET "_prog=%dp0%\\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@google\\gemini-cli\\dist\\index.js" %*
`;

await test('从 npm shim 里抠出真实 JS 入口', () => {
  const entry = parseNpmShim(NPM_SHIM, '/usr/local/bin');
  assert(entry !== null, '应解析出入口');
  assert(entry!.includes('gemini-cli'), `入口不对: ${entry}`);
  assert(entry!.includes('index.js'), `入口不对: ${entry}`);
  assert(entry!.startsWith('/usr/local/bin'), `应相对 shim 目录解析: ${entry}`);
});

await test('%~dp0 写法同样能解析', () => {
  const entry = parseNpmShim('"%_prog%" "%~dp0\\..\\lib\\cli.mjs" %*', '/opt/bin');
  assert(entry !== null && entry.includes('cli.mjs'), `应解析出 cli.mjs，实际 ${entry}`);
});

await test('非 node shim 返回 null（交给 cmd.exe 兜底）', () => {
  assert(parseNpmShim('@echo off\r\nsome-native-tool.exe %*\r\n', 'C:\\bin') === null, '不该硬认');
});

console.log('\n─── Windows 启动方式选择（CI 是 ubuntu，这段用临时目录模拟真实布局） ───');

// 造一个 Windows PATH 目录的真实形状：npm 全局包的 .cmd shim + 它指向的 JS 入口、
// 一个原生 .exe、一个不是 node shim 的 .cmd。planLaunch 传 platform='win32' 即可在
// 任何平台上验证判定逻辑（它只依赖路径与文件存在性）。
const winBin = mkdtempSync(join(tmpdir(), 'ao-winpath-'));
const entryDir = join(winBin, 'node_modules', 'gemini-cli', 'dist');
mkdirSync(entryDir, { recursive: true });
writeFileSync(join(entryDir, 'index.js'), '// entry', 'utf-8');
writeFileSync(join(winBin, 'gemini.cmd'), NPM_SHIM.replace('@google\\gemini-cli', 'gemini-cli'), 'utf-8');
writeFileSync(join(winBin, 'hermes.exe'), 'MZ', 'utf-8');
writeFileSync(join(winBin, 'legacy.cmd'), '@echo off\r\nnative-tool.exe %*\r\n', 'utf-8');
const winEnv = { PATH: winBin, PATHEXT: '.COM;.EXE;.BAT;.CMD' };

await test('.cmd shim → 用当前 Node 直接跑它的 JS 入口（参数原样传）', () => {
  const plan = planLaunch('gemini', ['-p', NASTY_PROMPT], 'Gemini CLI', winEnv, 'win32');
  assert(plan.file === process.execPath, `应当用 node 执行，实际 ${plan.file}`);
  assert(plan.args[0].endsWith('index.js'), `第一个参数应是 JS 入口，实际 ${plan.args[0]}`);
  assert(plan.args[1] === '-p' && plan.args[2] === NASTY_PROMPT, 'CLI 参数应原样跟在入口之后');
  assert(plan.viaCmd === false, '不应经过 cmd.exe');
  assert(plan.nodeRuntime === true, '应标记为 node 运行时（桌面端据此补 ELECTRON_RUN_AS_NODE）');
});

await test('.exe → 直接启动真实可执行文件，含换行的参数照样能传', () => {
  const plan = planLaunch('hermes', ['-z', NASTY_PROMPT], 'Hermes Agent CLI', winEnv, 'win32');
  // 扩展名大小写跟 PATHEXT 走（Windows 文件系统不区分大小写），断言时统一小写比
  assert(plan.file.toLowerCase() === join(winBin, 'hermes.exe').toLowerCase(), `应解析到 .exe，实际 ${plan.file}`);
  assert(plan.args[1] === NASTY_PROMPT, '提示词应一字不改');
  assert(plan.viaCmd === false, '.exe 不该绕 cmd.exe');
});

await test('PATHEXT 顺序生效：同名 .exe 优先于 .cmd', () => {
  writeFileSync(join(winBin, 'gemini.exe'), 'MZ', 'utf-8');
  const plan = planLaunch('gemini', ['-p', 'x'], 'Gemini CLI', winEnv, 'win32');
  assert(plan.file.toLowerCase() === join(winBin, 'gemini.exe').toLowerCase(), `应优先取 .exe，实际 ${plan.file}`);
  rmSync(join(winBin, 'gemini.exe'));
});

await test('非 node 的 .cmd → 退回 cmd.exe，且参数带引号（& 不会被当成命令分隔）', () => {
  const plan = planLaunch('legacy', ['--msg', 'a & b'], 'Legacy CLI', winEnv, 'win32');
  assert(plan.viaCmd === true, '应走 cmd.exe 兜底');
  assert(plan.file.toLowerCase().includes('cmd'), `应启动 cmd.exe，实际 ${plan.file}`);
  assert(plan.args[0] === '/d' && plan.args[2] === '/c', '应是 /d /s /c');
  assert(plan.args[3].includes('"a & b"'), `参数应带引号，实际 ${plan.args[3]}`);
});

await test('非 node 的 .cmd + 含换行的提示词 → 抛可读错误（不再吐"命令语法不正确"）', () => {
  let caught: Error | null = null;
  try {
    planLaunch('legacy', ['-z', NASTY_PROMPT], 'Legacy CLI', winEnv, 'win32');
  } catch (err) { caught = err as Error; }
  assert(caught !== null, '应当抛错');
  assert(caught!.message.includes('Legacy CLI'), `报错应点名 CLI：${caught?.message}`);
});

rmSync(winBin, { recursive: true, force: true });

console.log('\n─── cmd.exe 兜底路径的转义 ───');

await test('quoteWinArg 处理引号与结尾反斜杠', () => {
  assert(quoteWinArg('a b') === '"a b"', quoteWinArg('a b'));
  assert(quoteWinArg('say "hi"') === '"say \\"hi\\""', quoteWinArg('say "hi"'));
  assert(quoteWinArg('C:\\dir\\') === '"C:\\dir\\\\"', quoteWinArg('C:\\dir\\'));
});

await test('buildCmdLine 整体加引号且元字符留在引号内', () => {
  const line = buildCmdLine('C:\\bin\\x.cmd', ['-z', 'a & b']);
  assert(line.startsWith('""C:\\bin\\x.cmd"'), `最外层应再包一层引号: ${line}`);
  assert(line.includes('"a & b"'), `& 应留在引号里: ${line}`);
});

await test('含换行的参数过不了 cmd.exe → 抛可读错误而不是"命令语法不正确"', () => {
  let caught: Error | null = null;
  try {
    buildCmdLine('C:\\bin\\x.cmd', ['-z', NASTY_PROMPT], 'Hermes Agent CLI');
  } catch (err) { caught = err as Error; }
  assert(caught !== null, '应当抛错');
  assert(caught!.message.includes('Hermes Agent CLI'), `报错应点名 CLI: ${caught!.message}`);
  assert(caught!.message.includes('解决办法'), '报错应给出路怎么走');
});

console.log('\n─── 提示词传输通道选择（长 prompt 不再变成字面量 "-"） ───');

const LONG = '角'.repeat(6000);  // 18KB UTF-8 / 6000 wchar，典型角色系统提示词量级

await test('短 prompt 一律走命令行参数', () => {
  assert(chooseTransport('你好', false, 'darwin') === 'arg', 'posix');
  assert(chooseTransport('你好', true, 'win32') === 'arg', 'win32');
});

await test('支持 stdin 的 CLI：超过 4KB 切 stdin（保持既有行为）', () => {
  assert(chooseTransport(LONG, true, 'darwin') === 'stdin', 'posix');
  assert(chooseTransport('A'.repeat(ARG_SAFE_LIMIT + 1), true, 'linux') === 'stdin', '刚过阈值');
  assert(chooseTransport('A'.repeat(ARG_SAFE_LIMIT), true, 'linux') === 'arg', '恰好等于阈值不切');
});

await test('不支持 stdin 的 CLI：长 prompt 继续走参数，不退化成 "-"', () => {
  assert(chooseTransport(LONG, false, 'darwin') === 'arg', 'posix 18KB 应仍走参数');
  assert(chooseTransport(LONG, false, 'win32') === 'arg', 'win32 6000 wchar 应仍走参数');
});

await test('真的超过系统上限 → overflow（由上层报明确错误）', () => {
  assert(chooseTransport('A'.repeat(ARG_HARD_LIMIT_POSIX + 1), false, 'linux') === 'overflow', 'posix');
  assert(chooseTransport('A'.repeat(ARG_HARD_LIMIT_WIN + 1), false, 'win32') === 'overflow', 'win32');
  // Windows 按 wchar 算：中文 3 字节但只占 1 个 wchar，不能按字节误判
  assert(chooseTransport('中'.repeat(20_000), false, 'win32') === 'arg', '中文不应被字节数误判为超限');
});

await test('overflow 时报错说清是哪个 CLI 以及怎么绕', async () => {
  const c = new CLIBaseConnector({
    command: process.execPath,
    displayName: 'No-Stdin CLI',
    buildArgs: (p: string) => ['-e', 'process.stdout.write("ok")', p],
  });
  let caught: Error | null = null;
  try {
    await c.chat('', 'A'.repeat(ARG_HARD_LIMIT_POSIX + ARG_HARD_LIMIT_WIN + 10), dummyConfig);
  } catch (err) { caught = err as Error; }
  assert(caught !== null, '应当 reject');
  assert(caught!.message.includes('No-Stdin CLI'), `应点名 CLI: ${caught!.message}`);
  assert(caught!.message.includes('stdin'), `应说明原因: ${caught!.message}`);
});

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
