/**
 * 桌面壳（desktop/main.cjs）里的两个纯函数。main.cjs 顶部就 require('electron')，测试里加载不了，
 * 而打包配置只带 main.cjs 一个文件（拆文件要动 CI 才跑得到的打包链路），所以按标记把函数源码抠出来测。
 */
import { readFileSync, mkdtempSync, writeFileSync, existsSync, statSync, rmSync } from 'node:fs';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; }
}

const src = readFileSync(resolve('desktop/main.cjs'), 'utf-8');
const m = src.match(/\/\/ >>> pure-helpers\n([\s\S]*?)\/\/ <<< pure-helpers/);
assert(!!m, 'main.cjs 里找得到 pure-helpers 标记段');
const { isSafeExternalUrl, rotateLogIfLarge } = new Function(`${m![1]}; return { isSafeExternalUrl, rotateLogIfLarge };`)() as {
  isSafeExternalUrl: (u: unknown) => boolean;
  rotateLogIfLarge: (fsMod: typeof fs, file: string, max: number) => boolean;
};

console.log('\n─── 外链只放行 http(s) / mailto ───');
for (const ok of ['https://github.com/jnMetaCode/agency-orchestrator', 'http://example.com/a?b=1', 'mailto:someone@example.com']) {
  assert(isSafeExternalUrl(ok), `放行 ${ok}`);
}
for (const bad of ['file:///etc/passwd', 'smb://evil/share', 'vscode://file/etc/passwd', 'ms-msdt:/id PCWDiagnostic', 'javascript:alert(1)', 'data:text/html,<script>1</script>', '', 'not a url', undefined]) {
  assert(!isSafeExternalUrl(bad), `拦下 ${JSON.stringify(bad)}`);
}

console.log('\n─── 两个调用点都过了这道闸 ───');
{
  const calls = src.match(/shell\.openExternal\(/g) || [];
  const guarded = src.match(/isSafeExternalUrl\([^)]*\)\)? shell\.openExternal\(|isSafeExternalUrl\([^)]*\)\) shell\.openExternal\(/g) || [];
  assert(calls.length > 0 && calls.length === guarded.length, `每一处 shell.openExternal 前面都有 isSafeExternalUrl（${guarded.length}/${calls.length}）`);
  assert(/on\("will-navigate"/.test(src), '应用窗口自身的站外跳转被拦（will-navigate）');
}

console.log('\n─── engine.log 轮转 ───');
{
  const dir = mkdtempSync(join(tmpdir(), 'ao-desktop-log-'));
  const log = join(dir, 'engine.log');
  assert(rotateLogIfLarge(fs, log, 100) === false, '文件还不存在：不报错、不轮转');
  writeFileSync(log, 'x'.repeat(50));
  assert(rotateLogIfLarge(fs, log, 100) === false && existsSync(log), '没超上限：原样不动');
  writeFileSync(log, 'y'.repeat(500));
  assert(rotateLogIfLarge(fs, log, 100) === true, '超上限：轮转');
  assert(!existsSync(log) && statSync(log + '.1').size === 500, '旧日志改名成 engine.log.1，内容还在');
  writeFileSync(log, 'z'.repeat(300));
  assert(rotateLogIfLarge(fs, log, 100) === true && statSync(log + '.1').size === 300, '再次轮转覆盖上一份 .1（只留一份，不无限堆）');
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed > 0 ? 1 : 0);
