/**
 * 两个"不出错、只是悄悄给错结果"的地方：
 *  - isNewer 把预发布排在同号正式版**之前**：跑 @next 的用户永远收不到「有正式版了」，
 *    而一旦预发布被推到 latest 标签，所有正式版用户都会被劝去"升级"到更旧的东西；
 *  - 运行目录时间戳只到秒：同一秒跑完的两次同名工作流写进同一个目录，后一次把前一次盖掉
 *    （Studio 允许并行跑，所以不是假想）。
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isNewer } from '../src/utils/version-check.js';
import { saveResults, clipBytes } from '../src/output/reporter.js';
import type { WorkflowResult } from '../src/types.js';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; }
}

console.log('\n─── 版本比较：预发布排在正式版之前 ───');
for (const [a, b, want] of [
  ['0.19.0-beta.1', '0.19.0', false],   // 预发布不比正式版新
  ['0.20.0', '0.20.0-rc.1', true],      // 正式版比同号预发布新
  ['0.20.0', '0.19.9', true],
  ['0.19.2', '0.19.2', false],
  ['1.0.0-rc.1', '0.9.9', true],        // 跨主版本：预发布仍然更新
] as [string, string, boolean][]) {
  assert(isNewer(a, b) === want, `${a} > ${b} = ${want}`);
}

console.log('\n─── 同一秒的两次运行不互相覆盖 ───');
{
  const out = mkdtempSync(join(tmpdir(), 'ao-rundir-'));
  const mk = (n: number) => ({
    name: '同名工作流',
    steps: [{ id: 'a', role: 'r', status: 'completed', output: `第${n}次`, duration: 1, tokens: { input: 0, output: 0 } }],
    totalDuration: 1, totalTokens: { input: 0, output: 0 }, completedSteps: 1, totalSteps: 1, success: true,
  } as unknown as WorkflowResult);
  const d1 = saveResults(mk(1), out);
  const d2 = saveResults(mk(2), out);
  assert(d1 !== d2, `两次落到不同目录（${d1.split('/').pop()} / ${d2.split('/').pop()}）`);
  assert(readFileSync(join(d1, 'steps', '1-a.md'), 'utf-8').includes('第1次'), '第一次的产出没被盖掉');
  assert(readFileSync(join(d2, 'steps', '1-a.md'), 'utf-8').includes('第2次'), '第二次的产出也在');
  rmSync(out, { recursive: true, force: true });
}

console.log('\n─── 运行目录名按字节截断（Linux 上 255 字节是硬限） ───');
{
  // Linux（Docker 镜像、NAS 部署）NAME_MAX=255 **字节**：86 个汉字的工作流名就会让 mkdir
  // 抛 ENAMETOOLONG——而那时整条工作流已经跑完、钱已经花了，产物却存不下来。
  // macOS 的 APFS 按**字符**算 255，本机试不出来，所以这里直接盯字节数。
  const out = mkdtempSync(join(tmpdir(), 'ao-longname-'));
  const longName = '很'.repeat(200);
  const r = { name: longName, success: true, steps: [{ id: 'a', role: 'r', status: 'completed', output: 'x', duration: 1, tokens: { input: 1, output: 1 } }], totalDuration: 1, totalTokens: { input: 1, output: 1 } } as unknown as WorkflowResult;
  const dir = saveResults(r, out);
  const base = dir.split('/').pop() as string;
  assert(Buffer.byteLength(base) <= 255, `目录名不超过 255 字节（实际 ${Buffer.byteLength(base)}）`);
  assert(base.startsWith('很很很'), '保留可辨认的前缀');
  assert(!/\uFFFD/.test(base) && base.replace(/-[\d:T-]+$/, '').split('').every((c) => c === '很'), '不把汉字从中间切开');
  assert(existsSync(join(dir, 'metadata.json')), '内容照常写进去');
  assert(clipBytes('abc', 10) === 'abc' && clipBytes('很很很', 4) === '很', `clipBytes 按字节切且不切碎（实际 ${clipBytes('很很很', 4)}）`);
  rmSync(out, { recursive: true, force: true });
}

console.log('\n─── 凭证：~/.ao/.env 是用户级的，换个目录也认 ───');
{
  // teams / prompts / roles 都住 ~/.ao，凭证却只读当前目录的 .env——换个目录敲 ao 就"没凭证"。
  // 优先级：shell env > ./.env（项目级） > ~/.ao/.env（用户级）。
  const home = mkdtempSync(join(tmpdir(), 'ao-home-'));
  const work = mkdtempSync(join(tmpdir(), 'ao-work-'));
  mkdirSync(join(home, '.ao'), { recursive: true });
  writeFileSync(join(home, '.ao', '.env'), 'DEEPSEEK_API_KEY=sk-user-level\n', 'utf-8');
  const CLI = resolve('dist/cli.js');
  const ao = (extra: NodeJS.ProcessEnv) => {
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, AO_NO_UPDATE_CHECK: '1', AO_DATA_DIR: home };
    for (const k of ['DEEPSEEK_API_KEY', 'OLLAMA_BASE_URL']) delete env[k];
    Object.assign(env, extra);
    const r = spawnSync(process.execPath, [CLI, 'doctor', '--no-probe'], { cwd: work, encoding: 'utf-8', timeout: 90_000, env, input: '' });
    return (r.stdout || '') + (r.stderr || '');
  };
  const out = ao({});
  assert(/环境变量已配 key：[^\n]*deepseek/.test(out), `在别的目录下跑，也读到了 ~/.ao/.env（实际：${out.split('\n').find((l) => l.includes('key（env）') || l.includes('已配 key'))?.trim().slice(0, 60)}）`);

  // 三层的先后要能看出来：doctor 会把它实际用的 Ollama 地址原样打出来，拿它当探针
  writeFileSync(join(home, '.ao', '.env'), 'DEEPSEEK_API_KEY=sk-user-level\nOLLAMA_BASE_URL=http://127.0.0.1:9/from-user\n', 'utf-8');
  const userOnly = ao({});
  assert(/from-user/.test(userOnly), `只有用户级时用它（实际：${userOnly.split('\n').find((l) => l.includes('Ollama'))?.trim().slice(0, 70)}）`);

  writeFileSync(join(work, '.env'), 'OLLAMA_BASE_URL=http://127.0.0.1:9/from-project\n', 'utf-8');
  const projectWins = ao({});
  assert(/from-project/.test(projectWins) && !/from-user/.test(projectWins), '项目级 ./.env 压过用户级 ~/.ao/.env');

  const shellWins = ao({ OLLAMA_BASE_URL: 'http://127.0.0.1:9/from-shell' });
  assert(/from-shell/.test(shellWins), 'shell 里的值压过两个文件（否则 export 改了不生效，排查毫无头绪）');

  rmSync(home, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed > 0 ? 1 : 0);
