/**
 * Antigravity CLI provider（issue #86）。
 *
 * 背景：Google 于 2026-06-18 停掉 Gemini CLI，继任者是 Antigravity CLI（二进制 `agy`），
 * 所以 AO 里的 `gemini-cli` 对新用户已经是死入口。
 *
 * 本机没有 `agy`、而且它要 Google 账号交互登录一次，所以**真机跑通只能由有账号的人做**。
 * 这里能钉死的是"不真跑也一定要对"的那几件：
 *   1. 参数拼装（拼错要等真跑才发现，且报错通常只是一句"没输出"）；
 *   2. `--print-timeout` 必须跟 AO 的单步超时对齐 —— agy 自己默认 5 分钟，AO 默认等 10 分钟，
 *      不同步的话长步骤会被 agy 先掐断，AO 这边看到的是"跑完了但什么都没生成"；
 *   3. 探测认得官方安装路径（install.sh 装到 ~/.local/bin，**默认不在 PATH 上**）；
 *   4. 各处 provider 清单没漏登记（漏一处就是"能选不能跑"或"能跑但选不了"）。
 * 另外用一个假的 `agy` 可执行文件把整条链路真跑一遍，验证参数确实原样到达进程。
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAntigravityArgs, printTimeoutArg, AntigravityCLIConnector } from '../src/connectors/antigravity-cli.js';
import { CLI_PROVIDER_BINS, isOnPath, detectInstalledCliProviders } from '../src/providers/detect.js';
import { createConnector } from '../src/connectors/factory.js';
import type { LLMConfig } from '../src/types.js';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve(fn()).then(
    () => { console.log(`  ✅ ${name}`); passed++; },
    (err) => { console.log(`  ❌ ${name}: ${err instanceof Error ? err.message : err}`); failed++; },
  );
}
function assert(c: boolean, m: string): void { if (!c) throw new Error(m); }
const cfg = (o: Record<string, unknown> = {}): LLMConfig => ({ provider: 'antigravity-cli', ...o } as unknown as LLMConfig);

console.log('\n─── 参数拼装（官方 headless 文档口径） ───');

await test('非交互模式用 -p，并显式声明 --output-format text', () => {
  const args = buildAntigravityArgs('你好', cfg());
  assert(args[0] === '-p' && args[1] === '你好', `提示词应紧跟 -p，实际 ${args.slice(0, 2).join(' ')}`);
  // 不显式写的话，上游哪天改了默认输出格式，我们的解析就跟着坏
  const i = args.indexOf('--output-format');
  assert(i > 0 && args[i + 1] === 'text', 'output-format 应显式设为 text');
});

await test('provider 名不会被当成模型 slug 传下去', () => {
  const args = buildAntigravityArgs('x', cfg({ model: 'antigravity-cli' }));
  assert(!args.includes('--model'), '用户只写 provider 时 model 会等于 provider 名，不该传给 CLI');
  const withModel = buildAntigravityArgs('x', cfg({ model: 'gemini-3.5-flash-medium' }));
  assert(withModel[withModel.indexOf('--model') + 1] === 'gemini-3.5-flash-medium', '真给了模型就要传');
});

await test('--effort 只认 low/medium/high，其余一律不传（传错 CLI 直接报参数错）', () => {
  for (const good of ['low', 'medium', 'high', 'HIGH']) {
    const a = buildAntigravityArgs('x', cfg({ params: { effort: good } }));
    assert(a[a.indexOf('--effort') + 1] === good.toLowerCase(), `${good} 应被接受并小写化`);
  }
  for (const bad of ['ultra', '', 'true', '3']) {
    assert(!buildAntigravityArgs('x', cfg({ params: { effort: bad } })).includes('--effort'), `${bad} 不该被传下去`);
  }
  assert(!buildAntigravityArgs('x', cfg()).includes('--effort'), '没配就不传');
});

await test('--print-timeout 跟 AO 的单步超时对齐（否则长步骤会被 CLI 自己掐断）', () => {
  assert(printTimeoutArg(600_000) === '10m', `10 分钟应转成 10m，实际 ${printTimeoutArg(600_000)}`);
  assert(printTimeoutArg(undefined) === '10m', '没给超时时用 AO 的默认 10 分钟，而不是让 agy 用它自己的 5 分钟');
  assert(printTimeoutArg(90_000) === '2m', `不足整分钟要向上取整，实际 ${printTimeoutArg(90_000)}`);
  assert(printTimeoutArg(1_000) === '1m', '再短也至少 1m');
  assert(printTimeoutArg(0) === '10m', '0/负数视为没配');
  const args = buildAntigravityArgs('x', cfg({ timeout: 1_800_000 }));
  assert(args[args.indexOf('--print-timeout') + 1] === '30m', 'buildArgs 要把超时带上');
});

await test('默认不自动放行工具调用（AO 常在用户项目目录里跑）', () => {
  const args = buildAntigravityArgs('x', cfg({ timeout: 60_000, model: 'm', params: { effort: 'high' } }));
  assert(!args.includes('--dangerously-skip-permissions'), '绝不能默认替用户自动批准所有工具调用');
  assert(!args.includes('--sandbox'), '沙箱也不默认开（会改变它能做什么，属于用户的决定）');
});

await test('确实需要动工具时，用 params 显式打开（是用户写下的决定）', () => {
  const on = buildAntigravityArgs('x', cfg({ params: { skipPermissions: true, sandbox: true } }));
  assert(on.includes('--dangerously-skip-permissions'), 'params.skipPermissions 应打开自动批准');
  assert(on.includes('--sandbox'), 'params.sandbox 应打开沙箱');
  // YAML 里写成字符串 "true" 也很常见
  assert(buildAntigravityArgs('x', cfg({ params: { skipPermissions: 'true' } })).includes('--dangerously-skip-permissions'), '字符串 true 同样认');
  assert(!buildAntigravityArgs('x', cfg({ params: { skipPermissions: 'false' } })).includes('--dangerously-skip-permissions'), 'false 不该打开');
});

await test('空输出的报错要点破 Antigravity 特有的卡法（等人工审批）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ao-agy-silent-'));
  const fake = join(dir, 'agy');
  writeFileSync(fake, '#!/bin/sh\nexit 0\n', 'utf-8');   // 装死：退出码 0、什么都不输出
  chmodSync(fake, 0o755);
  const savedPath = process.env.PATH;
  process.env.PATH = `${dir}:${savedPath}`;
  try {
    const msg = await new AntigravityCLIConnector().chat('s', 'u', cfg({ timeout: 20_000 })).then(() => '', (e: Error) => e.message);
    assert(/toolPermission/.test(msg), `报错应点名 toolPermission，实际：${msg.slice(0, 120)}`);
    assert(/skipPermissions/.test(msg), '应给出可照做的开关');
    assert(/settings\.json/.test(msg), '应指出配置文件在哪');
  } finally {
    process.env.PATH = savedPath;
  }
});

console.log('\n─── 注册与探测 ───');

await test('factory 认得 antigravity-cli', () => {
  const c = createConnector(cfg({ model: 'x' }));
  assert(c instanceof AntigravityCLIConnector, `实际拿到 ${c.constructor.name}`);
});

await test('探测表里二进制名是 agy', () => {
  assert(CLI_PROVIDER_BINS['antigravity-cli'] === 'agy', `实际 ${CLI_PROVIDER_BINS['antigravity-cli']}`);
});

await test('认得官方安装路径 ~/.local/bin（install.sh 装那儿，默认不在 PATH）', () => {
  const home = mkdtempSync(join(tmpdir(), 'ao-agy-home-'));
  const bin = join(home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'agy'), '#!/bin/sh\n', { mode: 0o755 });
  const savedHome = process.env.HOME;
  process.env.HOME = home;
  try {
    // PATH 里**没有**它，只有官方安装目录里有
    assert(isOnPath('agy', { PATH: '/nonexistent-dir' } as NodeJS.ProcessEnv), '装在 ~/.local/bin 也该算已安装');
    assert(detectInstalledCliProviders({ PATH: '/nonexistent-dir' } as NodeJS.ProcessEnv).includes('antigravity-cli'),
      '零配置引导要能把它列出来');
  } finally {
    if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome;
  }
});

await test('没装就是没装（不能反过来永远报已安装）', () => {
  const home = mkdtempSync(join(tmpdir(), 'ao-agy-empty-'));
  const savedHome = process.env.HOME;
  process.env.HOME = home;
  try {
    assert(!isOnPath('agy', { PATH: '/nonexistent-dir' } as NodeJS.ProcessEnv), '哪儿都没有时应为 false');
  } finally {
    if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome;
  }
});

await test('各处 provider 清单都登记了（漏一处 = 能选不能跑 / 能跑选不了）', () => {
  const files: [string, RegExp][] = [
    ['src/core/parser.ts', /antigravity-cli/],           // 不写 model 也能跑
    ['src/cli.ts', /antigravity-cli/],                    // CLI 的 provider 白名单与引导
    ['web/server.js', /antigravity-cli/],                 // Studio 后端把它当 CLI provider
    ['website/src/lib/studio.ts', /antigravity-cli/],     // 前端下拉与标签
    ['src/connectors/factory.ts', /antigravity-cli/],     // 连接器路由
    ['src/providers/detect.ts', /antigravity-cli/],       // 安装探测
  ];
  for (const [f, re] of files) {
    assert(re.test(readFileSync(f, 'utf-8')), `${f} 里没登记 antigravity-cli`);
  }
});

console.log('\n─── 用一个假的 agy 真跑一遍（验证参数原样到达进程） ───');

await test('假 agy：参数一字不差地到达子进程，stdout 原样回来', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ao-agy-fake-'));
  const argsDump = join(dir, 'argv.json');
  const fake = join(dir, 'agy');
  // 把收到的 argv 落盘，再把提示词原样吐回去（模拟 --output-format text 的行为）
  writeFileSync(fake, [
    '#!/usr/bin/env node',
    `require('fs').writeFileSync(${JSON.stringify(argsDump)}, JSON.stringify(process.argv.slice(2)));`,
    "const i = process.argv.indexOf('-p');",
    "process.stdout.write('回答：' + (i >= 0 ? process.argv[i + 1] : ''));",
  ].join('\n'), 'utf-8');
  chmodSync(fake, 0o755);

  const savedPath = process.env.PATH;
  process.env.PATH = `${dir}:${savedPath}`;
  try {
    const r = await new AntigravityCLIConnector().chat('你是助手', '写一句话', cfg({ model: 'gemini-3.5-flash-medium', timeout: 300_000 }));
    const argv = JSON.parse(readFileSync(argsDump, 'utf-8')) as string[];
    assert(argv[0] === '-p', `第一个参数应是 -p，实际 ${argv[0]}`);
    // 系统提示词按 CLIBaseConnector 的约定包在 <system> 里 —— 换行、尖括号都不能被 shell 吃掉（#102）
    assert(argv[1].includes('<system>') && argv[1].includes('你是助手') && argv[1].includes('写一句话'),
      `提示词没原样传进去：${argv[1].slice(0, 60)}`);
    assert(argv.includes('--output-format') && argv.includes('text'), 'output-format 没传到');
    assert(argv[argv.indexOf('--model') + 1] === 'gemini-3.5-flash-medium', 'model 没传到');
    assert(argv[argv.indexOf('--print-timeout') + 1] === '5m', `print-timeout 应随 AO 超时变成 5m，实际 ${argv[argv.indexOf('--print-timeout') + 1]}`);
    assert(r.content.startsWith('回答：'), `stdout 应原样作为回答，实际 ${r.content.slice(0, 40)}`);
  } finally {
    process.env.PATH = savedPath;
  }
});

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
