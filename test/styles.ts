/**
 * 风格库：id/中文名/英文名 都能找到；展开成「名：后缀」；不认识的原样透传；run() 在运行前展开 source: styles 的输入。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { STYLE_PRESETS, findStyle, expandStyle } from '../src/media/styles.js';
import { run } from '../src/index.js';

let passed = 0, failed = 0;
function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve(fn()).then(() => { console.log(`  ✅ ${name}`); passed++; }, (e) => { console.log(`  ❌ ${name}: ${e instanceof Error ? e.message : e}`); failed++; });
}
const assert = (c: boolean, m: string) => { if (!c) throw new Error(m); };

await test('风格库非空、id 唯一、每条都有英文后缀且不含 IP/真人名', () => {
  assert(STYLE_PRESETS.length >= 10, '至少 10 个风格');
  assert(new Set(STYLE_PRESETS.map((s) => s.id)).size === STYLE_PRESETS.length, 'id 唯一');
  for (const s of STYLE_PRESETS) {
    assert(s.prompt.length > 60 && /[a-z]/.test(s.prompt), `${s.id} 的 prompt 要是一段像样的英文`);
    assert(!/(marvel|disney|star wars|harry potter)/i.test(s.prompt), `${s.id} 不该点名 IP`);
  }
});
await test('id / 中文名 / 英文名 都能找到；不认识的返回 undefined', () => {
  assert(findStyle('neon-cyberpunk')?.name === '霓虹赛博电影', 'id');
  assert(findStyle(' 霓虹赛博电影 ')?.id === 'neon-cyberpunk', '中文名（忽略空白）');
  assert(findStyle('NEON CYBERPUNK CINEMA')?.id === 'neon-cyberpunk', '英文名（忽略大小写）');
  assert(findStyle('我自己写的一段风格') === undefined, '不认识的');
});
await test('展开成「名（EN）: 后缀」；自定义描述原样透传；空串还是空串', () => {
  const x = expandStyle('日式青春胶片');
  assert(x.startsWith('日式青春胶片（Japanese youth film）: ') && /Fujifilm/.test(x), `实际 ${x.slice(0, 60)}`);
  assert(expandStyle('赛博朋克但要暖色') === '赛博朋克但要暖色', '透传');
  assert(expandStyle('') === '', '空串');
});
await test('run() 运行前把 source: styles 的输入展开，提示词里拿到的是英文后缀', async () => {
  const seen: string[] = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen.push(body);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const port = (srv.address() as { port: number }).port;
  const dir = mkdtempSync(join(tmpdir(), 'ao-styles-'));
  const roles = join(dir, 'roles', 'design');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(roles, { recursive: true });
  writeFileSync(join(roles, 'p.md'), '---\nname: 提示词工程师\n---\n\n你写提示词。\n', 'utf-8');
  const wf = join(dir, 'w.yaml');
  writeFileSync(wf, [
    'name: "x"', `agents_dir: "${join(dir, 'roles')}"`, 'llm:', '  provider: "openai"', '  model: "m"', `  base_url: "http://127.0.0.1:${port}"`, '  api_key: "k"',
    'inputs:', '  - name: style', '    required: true', '    source: styles',
    'steps:', '  - id: a', '    role: "design/p"', '    task: "风格：{{style}}"', '    output: o',
  ].join('\n'), 'utf-8');
  try {
    const r = await run(wf, { style: 'wuxia-realism' }, { quiet: true, outputDir: join(dir, 'out') });
    assert(r.success, '应成功');
    assert(seen.some((p) => /武侠江湖写实摄影（Wuxia realism）: realistic wuxia cinematography/.test(p)), `提示词里应是展开后的文本，实际 ${seen[0]?.slice(0, 200)}`);
    assert(r.inputs?.style?.startsWith('武侠江湖写实摄影（') === true, 'metadata 里记录展开后的值（resume 可复现）');
  } finally { srv.close(); rmSync(dir, { recursive: true, force: true }); }
});

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
