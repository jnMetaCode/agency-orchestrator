/**
 * providers/detect.ts 单测：PATH 探测 + 订阅制 CLI provider 识别。
 * 用临时目录造假可执行文件，注入伪 PATH，不依赖真机环境。
 */
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { isOnPath, detectInstalledCliProviders, pickAutoProvider, CLI_PROVIDER_BINS, CLI_PROVIDER_IDS, isCliProvider } from '../src/providers/detect.js';
import { readFileSync } from 'node:fs';
import { hasExtraBinDirs } from '../src/utils/bin-lookup.js';

let passed = 0, failed = 0;
function assert(c: boolean, m: string): void { if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; } }

console.log('\n─── providers/detect ───');

const dir = mkdtempSync(join(tmpdir(), 'ao-detect-'));
try {
  // 在伪 bin 目录里放一个 claude 可执行文件
  const bin = join(dir, 'claude');
  writeFileSync(bin, '#!/bin/sh\necho hi\n');
  chmodSync(bin, 0o755);

  const envWith = { PATH: dir } as NodeJS.ProcessEnv;
  const envEmpty = { PATH: join(dir, '__none__') } as NodeJS.ProcessEnv;

  assert(isOnPath('claude', envWith) === true, 'isOnPath 找到 PATH 上的 claude');
  assert(isOnPath('claude', envEmpty) === false, 'isOnPath 在空 PATH 找不到');
  assert(isOnPath('definitely-not-a-real-bin-xyz', envWith) === false, 'isOnPath 不误报不存在的命令');
  assert(isOnPath('claude', { PATH: '' } as NodeJS.ProcessEnv) === false, 'PATH 为空串时返回 false');

  const detected = detectInstalledCliProviders(envWith);
  assert(detected.includes('claude-code'), '探测到 claude → claude-code provider');
  // 有「固定安装位置」的 CLI（bin-lookup.ts 登记过的，如 WorkBuddy 内置的 codebuddy）不看 PATH，
  // 装了就会被探到——这是刻意的（否则 doctor 说没装、其实能跑），所以这里只断言 PATH 类的为空
  const offPath = detectInstalledCliProviders(envEmpty).filter((p) => !hasExtraBinDirs(CLI_PROVIDER_BINS[p]));
  assert(offPath.length === 0, `无任何 CLI 时返回空（固定安装位置的除外），实际 ${offPath.join(',')}`);

  // 偏好顺序：claude-code 在映射里排第一
  assert(Object.keys(CLI_PROVIDER_BINS)[0] === 'claude-code', 'claude-code 为首选');
  assert(CLI_PROVIDER_BINS['gemini-cli'] === 'gemini', 'gemini-cli → gemini 二进制名正确');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('\n─── 零配置选 provider：CLI 与 MCP 必须同一套 ───');
{
  // MCP 服务端此前把 compose 的 provider 硬编码兜底成 deepseek：同一台装了 claude-code 的机器上，
  // `ao compose` 零配置就能跑，经 MCP 调 compose_workflow 却报「缺少 API Key」。
  // 而 MCP 宿主（Claude Code / Claude Desktop）基本都是装了 CLI 的机器。
  const binDir = mkdtempSync(join(tmpdir(), 'ao-auto-'));
  const fake = join(binDir, 'claude');
  writeFileSync(fake, '#!/bin/sh\nexit 0\n', 'utf-8');
  chmodSync(fake, 0o755);
  const withCli: NodeJS.ProcessEnv = { PATH: binDir };
  assert(pickAutoProvider(undefined, 'deepseek', withCli).provider === 'claude-code', '装了 CLI 就用它');
  assert(pickAutoProvider(undefined, 'deepseek', withCli).reason === 'installed-cli', 'reason 说清为什么（调用方据此决定要不要打提示）');
  assert(pickAutoProvider('openai', 'deepseek', withCli).provider === 'openai', '显式指定永远优先');
  // 没有任何 CLI 时的两条分支（兜底 / 用已配 key 的那家）要在"本机真没装"的前提下测。
  // 注意：codebuddy 这类 CLI 即使 PATH 为空也能从已知安装目录探到（bin-lookup.ts），
  // 所以不能假设清空 PATH 就等于"没装"——按实际探测结果分流，别写一条只在某些机器上成立的断言。
  const bare: NodeJS.ProcessEnv = { PATH: join(binDir, 'nothing-here') };
  const stillDetected = detectInstalledCliProviders(bare);
  if (stillDetected.length === 0) {
    assert(pickAutoProvider(undefined, 'deepseek', bare).provider === 'deepseek', '什么都没有 → 兜底');
    assert(pickAutoProvider(undefined, 'deepseek', { ...bare, OPENAI_API_KEY: 'k' }).provider === 'openai', '没装 CLI 但配了 key → 用那家，别兜底成没 key 的 deepseek');
  } else {
    // 本机装着能被已知目录探到的 CLI（如 WorkBuddy 自带的 codebuddy）：改测"CLI 优先于已配的 key"
    assert(pickAutoProvider(undefined, 'deepseek', { ...bare, OPENAI_API_KEY: 'k' }).provider === stillDetected[0],
      `本机探到 ${stillDetected[0]}：CLI 优先于已配 key（兜底那两条在这台机器上测不了，CI 上会测）`);
  }
  rmSync(binDir, { recursive: true, force: true });
}

console.log('\n─── CLI provider 名单只有一份 ───');
{
  // 这份名单曾在 9 个地方各抄一份。钉两件事：它和二进制表对得上；别处没有再长出手抄的副本。
  const ids = [...CLI_PROVIDER_IDS].sort().join();
  const bins = Object.keys(CLI_PROVIDER_BINS).sort().join();
  assert(ids === bins, `CLI_PROVIDER_IDS 与 CLI_PROVIDER_BINS 的键一致（ids=${ids} bins=${bins}）`);
  assert(isCliProvider('claude-code') && !isCliProvider('deepseek') && !isCliProvider(undefined), 'isCliProvider');
  for (const f of ['src/cli.ts', 'src/core/parser.ts', 'src/mcp/server.ts', 'web/server.js']) {
    const copies = (readFileSync(f, 'utf-8').match(/'claude-code',\s*'antigravity-cli'/g) || []).length;
    assert(copies === 0, `${f} 里没有手抄的 CLI 名单（发现 ${copies} 处）——请 import CLI_PROVIDER_IDS`);
  }
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
