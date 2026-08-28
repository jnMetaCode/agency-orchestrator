/**
 * 开跑前的媒体花费预览（media/preflight.ts）。
 * "成本可见"写在产品定位里，但此前没有任何地方在按下运行之前说"这次是 3 条 × 8s"。
 * 钉住：数量与秒数算得对；输入没填时不抛（保留 {{…}}）；条件只引用输入时能当场判定，
 * 引用上游产出时标"视条件"；合成不算钱；纯文本工作流一行都不打。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseWorkflow } from '../src/core/parser.js';
import { summarizeMediaSpend } from '../src/media/preflight.js';

let passed = 0, failed = 0;
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.log(`  ❌ ${name}: ${e instanceof Error ? e.message : e}`); failed++; }
}
const assert = (c: boolean, m: string) => { if (!c) throw new Error(m); };
const wf = (yaml: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'ao-preflight-'));
  const f = join(dir, 'w.yaml');
  writeFileSync(f, yaml, 'utf-8');
  const w = parseWorkflow(f);
  rmSync(dir, { recursive: true, force: true });
  return w;
};
const ctx = (o: Record<string, string>) => new Map(Object.entries(o));

console.log('\n─── 媒体花费预览 ───');

test('3 条同规格视频合并成一行，合计秒数算对，合成不算钱', () => {
  const w = wf(`name: x\nllm:\n  provider: apimart\nsteps:\n${[1, 2, 3].map((n) => `  - id: s${n}\n    type: video\n    task: t\n    video:\n      provider: "{{vp}}"\n      model: "{{vm}}"\n      resolution: "{{res}}"\n      duration: "{{dur}}"\n      ratio: "16:9"\n    output: s${n}_mp4\n`).join('')}  - id: film\n    type: concat\n    concat:\n      inputs: ["{{s1_mp4}}", "{{s2_mp4}}", "{{s3_mp4}}"]\n    output: film\n    depends_on: [s1, s2, s3]\n`);
  const r = summarizeMediaSpend(w, ctx({ vp: 'apimart', vm: 'veo3.1-fast', res: '720p', dur: '8' }));
  assert(r.videoCount === 3 && r.videoSeconds === 24, `应 3 条 24 秒，实得 ${r.videoCount} 条 ${r.videoSeconds} 秒`);
  assert(r.concatCount === 1, '合成应计 1 条');
  const v = r.lines.find((l) => /出片 3 条/.test(l))!;
  assert(!!v && /8s/.test(v) && /720p/.test(v) && /apimart \/ veo3\.1-fast/.test(v), `视频行应带规格与供应商：${r.lines.join(' | ')}`);
  assert(r.lines.some((l) => /合计 24 秒/.test(l) && /按秒计费/.test(l)), '要点明合计秒数与按秒计费');
  assert(r.lines.some((l) => /合成 1 条/.test(l) && /不花厂商的钱/.test(l)), '合成要说明不花钱');
});

test('输入没填时不抛，模板原样保留，秒数标 "+"（宁可提示不确定，别把预览搞没）', () => {
  const w = wf(`name: x\nllm:\n  provider: metaso\nsteps:\n  - id: s\n    type: video\n    task: t\n    video:\n      model: "{{vm}}"\n      duration: "{{dur}}"\n    output: s_mp4\n`);
  const r = summarizeMediaSpend(w, ctx({}));
  assert(r.videoCount === 1 && r.videoSeconds === 0, '秒数解析不出应记 0 而不是 NaN');
  assert(r.lines.some((l) => /合计 0\+ 秒/.test(l)), `秒数未知要标 +：${r.lines.join(' | ')}`);
  assert(r.lines.some((l) => /\{\{vm\}\}/.test(l)), '未填的模型名应原样显示 {{vm}}，让人看出没填');
});

test('provider 缺省跟随文本供应商（与引擎 resolve 口径一致）', () => {
  const w = wf(`name: x\nllm:\n  provider: lanox\n  model: m\nsteps:\n  - id: i\n    type: image\n    task: t\n    image:\n      model: gpt-image-2\n      size: 1024x1024\n    output: img\n`);
  const r = summarizeMediaSpend(w, ctx({}));
  assert(r.imageCount === 1 && r.items[0].provider === 'lanox', `图片应跟随 lanox，实得 ${r.items[0].provider}`);
  assert(r.lines.some((l) => /出图 1 张 · 1024x1024  lanox \/ gpt-image-2/.test(l)), r.lines.join(' | '));
});

test('条件只引用输入 → 当场判定：关掉配音时 tts 不计数、并列出"本次不跑"', () => {
  const w = wf(`name: x\nllm:\n  provider: openai\n  model: m\ninputs:\n  - name: narration\n    default: "不配音"\nsteps:\n  - id: vo\n    type: tts\n    condition: "{{narration}} contains 配旁白"\n    task: t\n    tts:\n      model: tts-1\n      voice: nova\n    output: vo_audio\n`);
  const off = summarizeMediaSpend(w, ctx({ narration: '不配音' }));
  assert(off.ttsCount === 0, '关掉配音时不该计入');
  assert(off.lines.some((l) => /本次不跑/.test(l) && /vo/.test(l)), `要列出不跑的步骤：${off.lines.join(' | ')}`);
  const on = summarizeMediaSpend(w, ctx({ narration: '配旁白' }));
  assert(on.ttsCount === 1 && on.lines.some((l) => /配音 1 段/.test(l) && /nova/.test(l)), `开了配音要计入：${on.lines.join(' | ')}`);
});

test('条件引用上游产出 → 判不了，标"视条件"且按会跑算（宁可高估）', () => {
  const w = wf(`name: x\nllm:\n  provider: apimart\n  model: m\nsteps:\n  - id: judge\n    role: r/r\n    task: t\n    output: verdict\n  - id: s\n    type: video\n    condition: "{{verdict}} contains 通过"\n    task: t\n    video:\n      model: sora-2\n      duration: 4\n    output: s_mp4\n    depends_on: [judge]\n`);
  const r = summarizeMediaSpend(w, ctx({}));
  assert(r.items.find((i) => i.id === 's')!.conditional === 'unknown', '引用上游产出的条件应为 unknown');
  assert(r.videoCount === 1 && r.videoSeconds === 4, 'unknown 按会跑算');
  assert(r.lines.some((l) => /视条件/.test(l)), `应标视条件：${r.lines.join(' | ')}`);
});

test('纯文本工作流：一行都不打（别在不花钱的地方吓人）', () => {
  const w = wf(`name: x\nllm:\n  provider: deepseek\n  model: m\nsteps:\n  - id: a\n    role: r/r\n    task: t\n`);
  const r = summarizeMediaSpend(w, ctx({}));
  assert(r.lines.length === 0 && r.videoCount === 0, '不该有任何预览行');
});

test('内置「短剧流水线」：默认输入下 3 条 × 8s = 24 秒 + 1 张定妆图，关掉配音时 3 段 tts 不计', () => {
  const w = parseWorkflow('workflows/短剧流水线.yaml');
  const inputs = new Map<string, string>();
  for (const d of w.inputs ?? []) inputs.set(d.name, d.default ?? '');
  const r = summarizeMediaSpend(w, inputs);
  assert(r.videoCount === 3 && r.videoSeconds === 24, `应 3 条 24 秒，实得 ${r.videoCount}/${r.videoSeconds}`);
  assert(r.imageCount === 1, '定妆图 1 张');
  assert(r.ttsCount === 0, '默认不配音，tts 不计');
  assert(r.concatCount === 1, '合成 1 条');
});

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
