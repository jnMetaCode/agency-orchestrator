/**
 * providers/detect.ts 单测：PATH 探测 + 订阅制 CLI provider 识别。
 * 用临时目录造假可执行文件，注入伪 PATH，不依赖真机环境。
 */
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { isOnPath, detectInstalledCliProviders, CLI_PROVIDER_BINS, CLI_PROVIDER_IDS, isCliProvider } from '../src/providers/detect.js';
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
