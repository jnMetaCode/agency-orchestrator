/**
 * 花费预览必须**高估、绝不低估**（CLAUDE.md 写着，这个文件存在的意义就是这个）。
 * 以前 summarizeMediaSpend 只走一遍 steps，而执行器会把循环体重跑到 max_iterations 轮——
 * 「三条 8 秒镜头套一个 3 轮的循环」预览成 24 秒、实际可能出 72 秒，且 ao plan / run 头部 / Studio 都照抄这个数。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseWorkflow } from '../src/core/parser.js';
import { summarizeMediaSpend } from '../src/media/preflight.js';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; }
}
const dir = mkdtempSync(join(tmpdir(), 'ao-spend-loop-'));
const wf = (body: string) => {
  const f = join(dir, `${Math.random().toString(36).slice(2)}.yaml`);
  writeFileSync(f, `name: "x"\nagents_dir: "agency-agents-zh"\nllm: { provider: "metaso", model: "MiniMax-H3" }\n${body}`, 'utf-8');
  return parseWorkflow(f);
};

console.log('\n─── 循环体里的媒体步骤按最多轮数算 ───');
{
  const w = wf([
    'steps:',
    '  - id: shot', '    type: video', '    task: "一只猫"',
    '    video: { model: "MiniMax-H3", duration: 8 }', '    output: shot_mp4',
    '  - id: review', '    role: "marketing/marketing-content-creator"', '    task: "审 {{shot_mp4}}"',
    '    output: verdict', '    depends_on: [shot]',
    '    loop: { back_to: shot, max_iterations: 3, exit_condition: "{{verdict}} contains OK" }', '',
  ].join('\n'));
  const s = summarizeMediaSpend(w, new Map());
  assert(s.videoSeconds === 24, `8s × 最多 3 轮 = 24 秒，不是 8（实际 ${s.videoSeconds}）`);
  assert(s.videoCount === 3, `条数也按最多轮数（实际 ${s.videoCount}）`);
  assert(s.lines.some((l) => /循环最多 3 轮/.test(l)), `行文说清这是循环上限（实际：${s.lines[0]}）`);
}

console.log('\n─── 不在循环体里的不受影响 ───');
{
  const w = wf([
    'steps:',
    '  - id: intro', '    type: video', '    task: "片头"',
    '    video: { model: "MiniMax-H3", duration: 5 }', '    output: intro_mp4',
    '  - id: shot', '    type: video', '    task: "一只猫"',
    '    video: { model: "MiniMax-H3", duration: 8 }', '    output: shot_mp4', '    depends_on: [intro]',
    '  - id: review', '    role: "marketing/marketing-content-creator"', '    task: "审 {{shot_mp4}}"',
    '    output: verdict', '    depends_on: [shot]',
    '    loop: { back_to: shot, max_iterations: 2, exit_condition: "{{verdict}} contains OK" }', '',
  ].join('\n'));
  const s = summarizeMediaSpend(w, new Map());
  // 循环体只有 shot（back_to 的后代 ∩ review 的祖先）；intro 在 back_to 之前，不重跑
  assert(s.videoSeconds === 5 + 8 * 2, `只有循环体内的那条翻倍：5 + 8×2 = 21（实际 ${s.videoSeconds}）`);
}

console.log('\n─── 没有循环时与从前一致 ───');
{
  const w = wf([
    'steps:',
    '  - id: shot', '    type: video', '    task: "一只猫"',
    '    video: { model: "MiniMax-H3", duration: 8 }', '    output: shot_mp4', '',
  ].join('\n'));
  const s = summarizeMediaSpend(w, new Map());
  assert(s.videoSeconds === 8 && s.videoCount === 1, `8 秒 1 条（实际 ${s.videoSeconds}s / ${s.videoCount} 条）`);
  assert(!s.lines.some((l) => /循环/.test(l)), '不提循环');
}

rmSync(dir, { recursive: true, force: true });
console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed > 0 ? 1 : 0);
