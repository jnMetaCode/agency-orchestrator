/**
 * 必填输入解析测试：required 但带 default 的输入不应被判为"缺失"。
 * 回归用例——story-creation 等带 default 的旗舰模板要能 `ao run xxx.yaml` 开箱即跑。
 */
import { findMissingInputs, modelCapabilityHint } from '../src/index.js';
import { parseWorkflow, validateWorkflow } from '../src/core/parser.js';
import { splitVisionMessage, stripImageDataUris, hasImageInput } from '../src/utils/vision.js';
import { parseInputPairs } from '../src/cli/parse-inputs.js';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { InputDefinition } from '../src/types.js';

let passed = 0, failed = 0;
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (err) { console.log(`  ❌ ${name}: ${err instanceof Error ? err.message : err}`); failed++; }
}
function assert(c: boolean, msg: string): void { if (!c) throw new Error(msg); }

const names = (defs: InputDefinition[]) => defs.map(d => d.name);

console.log('\n=== findMissingInputs ===');

test('required + 无 default + 未提供 → 缺失', () => {
  const m = findMissingInputs([{ name: 'a', required: true }], new Map());
  assert(names(m).join() === 'a', `应缺 a，实际: ${names(m)}`);
});

test('required + 有 default + 未提供 → 不缺失（核心修复）', () => {
  const m = findMissingInputs([{ name: 'premise', required: true, default: '默认梗概' }], new Map());
  assert(m.length === 0, `带 default 的 required 不该判缺失，实际: ${names(m)}`);
});

test('required + 已提供 → 不缺失', () => {
  const m = findMissingInputs([{ name: 'a', required: true }], new Map([['a', 'v']]));
  assert(m.length === 0, `已提供不该缺失: ${names(m)}`);
});

test('可选输入未提供 → 不缺失', () => {
  const m = findMissingInputs([{ name: 'style', required: false }], new Map());
  assert(m.length === 0, `可选不该缺失: ${names(m)}`);
});

test('混合：只报真正缺的那个', () => {
  const defs: InputDefinition[] = [
    { name: 'premise', required: true, default: 'd' }, // 有 default → 不缺
    { name: 'topic', required: true },                  // 无 default 未提供 → 缺
    { name: 'style', required: false },                 // 可选 → 不缺
  ];
  const m = findMissingInputs(defs, new Map());
  assert(names(m).join() === 'topic', `只应缺 topic，实际: ${names(m)}`);
});

test('inputs 为 undefined → 空', () => {
  assert(findMissingInputs(undefined, new Map()).length === 0, 'undefined 应返回空');
});

test('provided 用 Set 也能工作', () => {
  const m = findMissingInputs([{ name: 'a', required: true }], new Set(['a']));
  assert(m.length === 0, 'Set 提供也算已提供');
});

console.log('\n=== vision 图片输入 ===');

test('splitVisionMessage 拆图并留占位', () => {
  const uri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
  const msg = `看这张图 ${uri} 说说问题`;
  const { text, images } = splitVisionMessage(msg);
  assert(images.length === 1 && images[0].mime === 'image/png' && images[0].uri === uri, '拆出 1 张 png');
  assert(text.includes('[图片1]') && !text.includes('base64,'), '文本留占位、不含 base64');
  assert(hasImageInput(msg) && !hasImageInput(text), 'hasImageInput 判定');
  assert(!stripImageDataUris(msg).includes('base64,'), 'strip 后无 base64');
  const plain = splitVisionMessage('没有图片的普通文本');
  assert(plain.images.length === 0 && plain.text === '没有图片的普通文本', '无图时原样返回');
});

test('parseInputPairs：@图片文件 → data URI', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ao-vision-'));
  const png = join(dir, 'a.png');
  // 1x1 真实 PNG
  writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
  const inputs = parseInputPairs(['run', 'w.yaml', '-i', `photo=@${png}`], (m) => { throw new Error(m); });
  assert(inputs.photo.startsWith('data:image/png;base64,'), '图片展开成 data URI');
  const txt = join(dir, 'b.txt');
  writeFileSync(txt, 'hello');
  const inputs2 = parseInputPairs(['run', 'w.yaml', '-i', `doc=@${txt}`], (m) => { throw new Error(m); });
  assert(inputs2.doc === 'hello', '文本文件行为不变');
});

console.log('\n=== modelCapabilityHint ===');

test('ollama → 给弱档提示', () => {
  const h = modelCapabilityHint('ollama');
  assert(!!h && h.includes('Ollama') && h.includes('不如单次'), `ollama 应提示: ${h}`);
});

test('deepseek（甜区）→ 不提示', () => {
  assert(modelCapabilityHint('deepseek') === null, 'deepseek 不该提示');
});

test('强档/CLI → 不提示', () => {
  assert(modelCapabilityHint('claude') === null && modelCapabilityHint('claude-code') === null, '强档不该提示');
});

test('antigravity-cli → 给额度提示（质量不弱，额度受限）', () => {
  const h = modelCapabilityHint('antigravity-cli');
  assert(!!h && h.includes('20 次/天'), `antigravity 应提示额度: ${h}`);
});

test('没证据的 CLI（copilot/hermes/openclaw）→ 不猜不提示', () => {
  for (const p of ['copilot-cli', 'hermes-cli', 'openclaw-cli', 'codex-cli']) {
    assert(modelCapabilityHint(p) === null, `${p} 不该提示`);
  }
});

// ── show_when：条件可见的输入 ─────────────────────────────────────────────
// 来由：短剧流水线 15 个输入里，语音供应商/模型/音色在选了"不配音"时仍摆在那儿，
// 用户不知道要不要填；而如果它们是必填，CLI 还会拦着说"缺输入"——自相矛盾。
test('show_when 为假的必填输入不算缺失（"不配音"就别逼人填音色）', () => {
  const defs: InputDefinition[] = [
    { name: 'narration', required: true, default: '不配音' },
    { name: 'tts_voice', required: true, show_when: '{{narration}} contains 配旁白' },
  ];
  const off = findMissingInputs(defs, new Map([['narration', '不配音']]));
  assert(off.length === 0, `关掉配音时 tts_voice 不该算缺失，实得 ${off.map((d) => d.name).join(',')}`);
  const on = findMissingInputs(defs, new Map([['narration', '配旁白']]));
  assert(on.length === 1 && on[0].name === 'tts_voice', '开了配音时 tts_voice 必须算缺失');
  // 没提供 narration 时按它的默认值判（默认"不配音"→ 隐藏）
  const dflt = findMissingInputs(defs, new Map());
  assert(dflt.length === 0, '按默认值判：默认不配音，音色不算缺失');
});

test('show_when 写错在解析期就报：不支持的运算符 / 引用了非输入 / 引用自己', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ao-showwhen-'));
  const f = join(dir, 'w.yaml');
  const base = (cond: string) => `name: x\nllm:\n  provider: deepseek\n  model: m\ninputs:\n  - name: a\n    default: ""\n  - name: b\n    show_when: "${cond}"\nsteps:\n  - id: s\n    role: r/r\n    task: "{{a}}{{b}}"\n`;
  const errs = (cond: string) => { writeFileSync(f, base(cond), 'utf-8'); return validateWorkflow(parseWorkflow(f)); };
  assert(errs('{{a}} contains x').length === 0, '合法写法不该报错');
  assert(errs('{{a}} startswith x').some((e) => /show_when 写法不对/.test(e)), '不支持的运算符要报');
  assert(errs('{{nope}} contains x').some((e) => /不是输入/.test(e)), '引用非输入变量要报');
  assert(errs('{{b}} contains x').some((e) => /引用了自己|不是输入/.test(e)), '引用自己要报');
  assert(errs('always').some((e) => /show_when/.test(e)), '没有运算符也要报');
});

console.log('\n' + '='.repeat(50));
console.log(`  Inputs 测试: ${passed} 通过, ${failed} 失败 (共 ${passed + failed} 项)`);
if (failed === 0) console.log('  全部通过!');
else process.exit(1);
console.log('='.repeat(50) + '\n');
