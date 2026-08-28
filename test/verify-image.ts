/**
 * 图片验收（image 步骤的 acceptance）端到端：
 * 出图 → 能看图的文本模型对着成品图核对 → 未过带未满足项重出一张 → 复核 → verification 落进 metadata。
 * 钉住：图片确实以 data URI 进了核验消息（不是只把提示词发过去）；重出提示词带未满足项；
 * 交付的是重出后的那张；看不了图的供应商跳过并告警；validate 允许 acceptance、仍拦 assert。
 */
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/index.js';
import { parseWorkflow } from '../src/core/parser.js';
import { buildImageReworkPrompt, canSeeImages } from '../src/core/verify.js';
import { summarizeMediaSpend } from '../src/media/preflight.js';

let passed = 0, failed = 0;
function assert(c: boolean, m: string): void { if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; } }
const listen = async (srv: http.Server): Promise<number> => {
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  return (srv.address() as { port: number }).port;
};
// 两张不同的 1x1 PNG：第一张（红）判不过，第二张（另一像素）判过——靠字节区分交付的是哪张
const PNG_A = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_B = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhQGAWjR9awAAAABJRU5ErkJggg==';

console.log('\n─── 单元：canSeeImages / buildImageReworkPrompt ───');
assert(canSeeImages('deepseek') && canSeeImages('claude') && !canSeeImages('claude-code') && !canSeeImages('gemini-cli') && !canSeeImages('ollama'), 'CLI / ollama 连接器会剥图 → 不做图片验收；API 供应商可以');
const rp = buildImageReworkPrompt('一张海报', [{ criterion: '画面里有一只猫', why: '只有沙发，没有动物' }]);
assert(rp.startsWith('一张海报') && rp.includes('画面里有一只猫') && rp.includes('上一版：只有沙发'), '重出提示词 = 原提示词 + 未满足项作为硬约束（不改正文）');

console.log('\n─── 解析期：image 步骤允许 acceptance，仍拦 assert ───');
{
  const dir = mkdtempSync(join(tmpdir(), 'ao-vimg-parse-'));
  const ok = join(dir, 'ok.yaml');
  writeFileSync(ok, 'name: x\nllm:\n  provider: lanox\n  model: m\nsteps:\n  - id: a\n    type: image\n    task: 画猫\n    acceptance: "1. 有猫"\n    image:\n      model: gpt-image-2\n', 'utf-8');
  let threw = '';
  try { parseWorkflow(ok); } catch (e) { threw = e instanceof Error ? e.message : String(e); }
  assert(threw === '', `image 步骤写 acceptance 应通过解析（实际：${threw.split('\n')[0]}）`);
  const bad = join(dir, 'bad.yaml');
  writeFileSync(bad, 'name: x\nllm:\n  provider: lanox\n  model: m\nsteps:\n  - id: a\n    type: image\n    task: 画猫\n    assert:\n      contains: ["猫"]\n    image:\n      model: gpt-image-2\n', 'utf-8');
  threw = '';
  try { parseWorkflow(bad); } catch (e) { threw = e instanceof Error ? e.message : String(e); }
  assert(/assert/.test(threw) && /acceptance/.test(threw), `image 步骤写 assert 仍拦下并指路 acceptance（实际：${threw.split('\n')[0]}）`);
  const wf = parseWorkflow(ok);
  const pf = summarizeMediaSpend(wf, {});
  assert(pf.lines.some((l) => l.includes('挂了验收') && l.includes('+1')), `花费预览说明验收可能多出一张（实际：${pf.lines.join(' | ')}）`);
  rmSync(dir, { recursive: true, force: true });
}

console.log('\n─── 端到端：出图 → 看图验收未过 → 重出 → 复核通过 ───');
{
  const imagePrompts: string[] = [];
  const judgeCalls: Array<{ hasImage: boolean; imageIs: 'A' | 'B' | 'none'; text: string }> = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d));
    req.on('end', () => {
      if (/chat\/completions/.test(String(req.url))) {
        const body = JSON.parse(b) as { messages: Array<{ role: string; content: unknown }> };
        const user = body.messages.find((m) => m.role === 'user');
        const parts = Array.isArray(user?.content) ? (user!.content as Array<{ type: string; text?: string; image_url?: { url: string } }>) : [];
        const imgPart = parts.find((p) => p.type === 'image_url');
        const url = imgPart?.image_url?.url ?? '';
        const imageIs: 'A' | 'B' | 'none' = url.endsWith(PNG_A) ? 'A' : url.endsWith(PNG_B) ? 'B' : 'none';
        const text = parts.filter((p) => p.type === 'text').map((p) => p.text).join('') || String(user?.content ?? '');
        judgeCalls.push({ hasImage: !!imgPart, imageIs, text });
        const verdict = imageIs === 'A'
          ? { pass: false, failed: [{ criterion: '画面里有一只猫', why: '只看到空沙发' }] }
          : { pass: true, failed: [] };
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(verdict) }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
      }
      if (/images\/generations/.test(String(req.url))) {
        imagePrompts.push(String((JSON.parse(b) as { prompt?: string }).prompt));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ data: [{ b64_json: imagePrompts.length === 1 ? PNG_A : PNG_B }] }));
      }
      res.writeHead(404); res.end('{}');
    });
  });
  const port = await listen(srv);
  const dir = mkdtempSync(join(tmpdir(), 'ao-vimg-e2e-'));
  const wf = join(dir, 'w.yaml');
  writeFileSync(wf, [
    'name: "图验收"',
    'agents_dir: "agency-agents-zh"',
    'llm:', '  provider: "lanox"', '  model: "gpt-5.6-sol"', `  base_url: "http://127.0.0.1:${port}/v1"`,
    'steps:',
    '  - id: poster', '    type: image', '    task: "客厅沙发上的一只猫"',
    '    acceptance: "1. 画面里有一只猫\\n2. 场景是客厅"',
    '    image:', '      model: "gpt-image-2"',
  ].join('\n'), 'utf-8');
  const saved = process.env.LANOX_API_KEY; process.env.LANOX_API_KEY = 'sk-e2e';
  try {
    const result = await run(wf, {}, { quiet: true, outputDir: join(dir, 'out') });
    assert(result.success === true, `运行应成功（${result.steps.map((s) => `${s.id}:${s.status}`).join(', ')}）`);
    assert(judgeCalls.length === 2, `核验应调两次（首检 + 复核），实际 ${judgeCalls.length}`);
    assert(judgeCalls[0]?.hasImage && judgeCalls[0].imageIs === 'A', '首检消息里带的是第一张图（多模态 image_url，不是只发提示词）');
    assert(judgeCalls[0]?.text.includes('画面里有一只猫') && judgeCalls[0].text.includes('客厅沙发上的一只猫'), '核验消息含验收标准与生成提示词');
    assert(imagePrompts.length === 2 && imagePrompts[1].includes('画面里有一只猫') && imagePrompts[1].includes('只看到空沙发'), `重出提示词带未满足项（实际：${imagePrompts[1]}）`);
    assert(judgeCalls[1]?.imageIs === 'B', '复核看的是重出的第二张');
    const poster = result.steps.find((s) => s.id === 'poster');
    assert(poster?.verification?.pass === true && poster.verification.reworked === true, `verification 应为通过+已返工（实际 ${JSON.stringify(poster?.verification)}）`);
    assert((poster?.tokens?.input ?? 0) > 0, `核验的 token 计入本步（实际 ${JSON.stringify(poster?.tokens)}）`);
    const dirs = readFileSync ? (await import('node:fs')).readdirSync(join(dir, 'out')) : [];
    const rd = join(dir, 'out', dirs.find((d) => d.startsWith('图验收'))!);
    assert(readFileSync(join(rd, 'assets', 'poster.png')).equals(Buffer.from(PNG_B, 'base64')), '落盘的是重出后的第二张');
    const meta = JSON.parse(readFileSync(join(rd, 'metadata.json'), 'utf-8')) as { steps: Array<{ id: string; verification?: unknown; acceptance?: string }> };
    const mp = meta.steps.find((s) => s.id === 'poster');
    assert(!!mp?.verification && typeof mp.acceptance === 'string', 'metadata 带 verification 与渲染后的 acceptance');
  } finally {
    if (saved === undefined) delete process.env.LANOX_API_KEY; else process.env.LANOX_API_KEY = saved;
    srv.close(); rmSync(dir, { recursive: true, force: true });
  }
}

console.log('\n─── 端到端：看不了图的供应商 → 跳过验收并告警，照常出图 ───');
{
  let imgCalls = 0;
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d));
    req.on('end', () => {
      if (/images\/generations/.test(String(req.url))) {
        imgCalls++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ data: [{ b64_json: PNG_A }] }));
      }
      res.writeHead(404); res.end('{}');
    });
  });
  const port = await listen(srv);
  const dir = mkdtempSync(join(tmpdir(), 'ao-vimg-cli-'));
  const wf = join(dir, 'w.yaml');
  writeFileSync(wf, [
    'name: "图验收CLI"', 'agents_dir: "agency-agents-zh"',
    'llm:', '  provider: "claude-code"', '  model: "sonnet"',
    'steps:',
    '  - id: poster', '    type: image', '    task: "一只猫"', '    acceptance: "1. 有猫"',
    '    image:', '      provider: "lanox"', '      model: "gpt-image-2"',
  ].join('\n'), 'utf-8');
  // image.provider 指定另一家时文本侧 base_url 不带过去（既定规则）——出图端点只能靠供应商自己的 env 指向 mock
  const saved = process.env.LANOX_API_KEY; process.env.LANOX_API_KEY = 'sk-e2e';
  const savedBase = process.env.LANOX_BASE_URL; process.env.LANOX_BASE_URL = `http://127.0.0.1:${port}/v1`;
  const errs: string[] = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  (process.stderr as unknown as { write: (s: string) => boolean }).write = (s: string) => { errs.push(String(s)); return true; };
  try {
    const result = await run(wf, {}, { quiet: true, outputDir: join(dir, 'out') });
    (process.stderr as unknown as { write: typeof origWrite }).write = origWrite;
    assert(result.success === true && imgCalls === 1, `照常出图一次（success=${result.success}, imgCalls=${imgCalls}, err=${result.steps[0]?.error ?? ''}）`);
    const poster = result.steps.find((s) => s.id === 'poster');
    assert(poster?.verification === undefined, '不做验收（verification 为空）而不是假装通过');
    assert(errs.some((e) => e.includes('看不了图')), `告警说明供应商看不了图（实际：${errs.filter((e) => e.includes('⚠️')).join(' | ').slice(0, 200)}）`);
  } finally {
    (process.stderr as unknown as { write: typeof origWrite }).write = origWrite;
    if (saved === undefined) delete process.env.LANOX_API_KEY; else process.env.LANOX_API_KEY = saved;
    if (savedBase === undefined) delete process.env.LANOX_BASE_URL; else process.env.LANOX_BASE_URL = savedBase;
    srv.close(); rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed > 0 ? 1 : 0);
