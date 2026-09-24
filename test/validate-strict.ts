/**
 * validate 新加的几条「以前静默放过、运行期才炸（或永远不炸）」的规则。每条都来自 DX 体检里用真 YAML 复现的场景。
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseWorkflow, validateWorkflow } from '../src/core/parser.js';
import { readDocsDir } from '../src/utils/docs-dir.js';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; }
}
const dir = mkdtempSync(join(tmpdir(), 'ao-validate-strict-'));
const wf = (body: string): string => { const f = join(dir, `${Math.random().toString(36).slice(2)}.yaml`); writeFileSync(f, body, 'utf-8'); return f; };
const parseErr = (body: string): string => { try { parseWorkflow(wf(body)); return ''; } catch (e) { return e instanceof Error ? e.message : String(e); } };
const head = 'name: "x"\nagents_dir: "agency-agents-zh"\nllm: { provider: "deepseek", model: "m" }\n';
const step = (id: string, extra = '') => `  - id: ${id}\n    role: "r/x"\n    task: "t"\n    output: ${id}_out\n${extra}`;

console.log('\n─── 拼错的字段不再被静默忽略 ───');
{
  const e = parseErr(`${head}steps:\n${step('a')}${step('b', '    depend_on: [a]\n')}`);
  assert(/不认识的字段 "depend_on"/.test(e) && /"depends_on"/.test(e), `depend_on → 报错并猜 depends_on（实际：${e.slice(0, 100)}）`);
  const e2 = parseErr(`${head}steps:\n${step('a', '    acceptence: "1. ok"\n')}`);
  assert(/"acceptence"/.test(e2) && /"acceptance"/.test(e2), 'acceptence → 猜 acceptance');
  const e3 = parseErr(`${head}concurency: 3\nsteps:\n${step('a')}`);
  assert(/顶层有不认识的字段 "concurency"/.test(e3) && /"concurrency"/.test(e3), '顶层拼错同样报');
  assert(parseErr(`${head}category: "x"\nfeatured: true\nsteps:\n${step('a', '    depends_on_mode: any_completed\n')}`) === '', 'schema 里有的字段一律放行');
}

console.log('\n─── depends_on 写成单个字符串 ───');
{
  const w = parseWorkflow(wf(`${head}steps:\n${step('research')}${step('write', '    depends_on: research\n')}`));
  assert(Array.isArray(w.steps[1].depends_on) && w.steps[1].depends_on[0] === 'research', '规整成数组（以前按字符迭代，报 8 条「依赖不存在的 step: "r"」）');
  assert(validateWorkflow(w).length === 0, '校验通过');
}

console.log('\n─── deliverables 写成输出变量名时点破（与 depends_on 同一种手误）───');
{
  const w = parseWorkflow(wf(`${head}deliverables: [a_out]\nsteps:\n${step('a')}`));
  const errs = validateWorkflow(w).join('\n');
  assert(/"a_out" 是 step "a" 的输出变量名/.test(errs) && /应写 "a"/.test(errs), `点破并给出该写什么（实际：${errs.slice(0, 120)}）`);
  const ok = parseWorkflow(wf(`${head}deliverables: [a]\nsteps:\n${step('a')}`));
  assert(validateWorkflow(ok).length === 0, '写对 step id 时不报');
}

console.log('\n─── 循环依赖点名 ───');
{
  const w = parseWorkflow(wf(`${head}steps:\n${step('a', '    depends_on: [c]\n')}${step('b', '    depends_on: [a]\n')}${step('c', '    depends_on: [b]\n')}`));
  const errs = validateWorkflow(w).join('\n');
  assert(/循环依赖: (a → c → b → a|c → b → a → c|b → a → c → b)/.test(errs), `报出环上的步骤（实际：${errs.slice(0, 80)}）`);
}

console.log('\n─── loop.back_to 必须是依赖链上的祖先（以前只有 ao run 才查） ───');
{
  const w = parseWorkflow(wf(`${head}steps:\n${step('unrelated')}${step('draft')}${step('review', '    depends_on: [draft]\n    loop: { back_to: unrelated, max_iterations: 2, exit_condition: "{{review_out}} contains OK" }\n')}`));
  const errs = validateWorkflow(w).join('\n');
  assert(/back_to "unrelated" 不在它的依赖链上/.test(errs), `validate 就报（实际：${errs.slice(0, 100)}）`);
  const ok = parseWorkflow(wf(`${head}steps:\n${step('draft')}${step('review', '    depends_on: [draft]\n    loop: { back_to: draft, max_iterations: 2, exit_condition: "{{review_out}} contains OK" }\n')}`));
  assert(!validateWorkflow(ok).some((x) => /依赖链/.test(x)), '正常的回跳不误报');
}

console.log('\n─── 不认识的 provider 且没有 base_url ───');
{
  const e = parseErr(`name: "x"\nagents_dir: "a"\nllm: { provider: "deepseeek", model: "m" }\nsteps:\n${step('a')}`);
  assert(/不认识的 provider "deepseeek"/.test(e) && /"deepseek"/.test(e), `拼错的 provider 在 validate 就报、并猜对（实际：${e.slice(0, 90)}）`);
  assert(parseErr(`name: "x"\nagents_dir: "a"\nllm: { provider: "my-relay", model: "m", base_url: "https://x/v1" }\nsteps:\n${step('a')}`) === '', '自定义中转配了 base_url 放行');
  assert(parseErr(`name: "x"\nllm: { provider: "metaso" }\nsteps:\n  - id: v\n    type: video\n    task: "t"\n    video: { model: "MiniMax-H3" }\n    output: v_mp4\n`) === '', '纯媒体工作流的视频供应商放行');
}

console.log('\n─── 变量拼错给「你是不是想写」 ───');
{
  const w = parseWorkflow(wf(`${head}inputs:\n  - name: topic\nsteps:\n${step('a').replace('task: "t"', 'task: "写 {{topci}}"')}`));
  const errs = validateWorkflow(w).join('\n');
  assert(/未定义的变量: \{\{topci\}\}.*想写 \{\{topic\}\}/.test(errs), `猜到 topic（实际：${errs.slice(0, 120)}）`);
}

console.log('\n─── @dir 知识源不跟符号链接绕圈 ───');
{
  const docs = join(dir, 'docs');
  mkdirSync(join(docs, 'sub'), { recursive: true });
  writeFileSync(join(docs, 'a.md'), '# A', 'utf-8');
  writeFileSync(join(docs, 'sub', 'b.md'), '# B', 'utf-8');
  let linked = true;
  try { symlinkSync('..', join(docs, 'sub', 'up')); } catch { linked = false; }
  if (linked) {
    const r = readDocsDir(docs);
    assert(r.files.length === 2, `两个文件就是两个（以前 sub/up -> .. 让它读成 66 份；实际 ${r.files.length}）`);
  } else {
    console.log('  ⏭️  建不了符号链接，跳过');
  }
}

console.log('\n─── @dir 知识源：不是 UTF-8 的文件点名跳过，别把乱码塞给模型 ───');
{
  const docs2 = join(dir, 'docs2');
  mkdirSync(docs2, { recursive: true });
  writeFileSync(join(docs2, 'ok.md'), '# 正常内容', 'utf-8');
  // GBK 编码的中文（Windows 机器上的 .txt/.csv 很常见）：按 UTF-8 解出来是一片 U+FFFD
  writeFileSync(join(docs2, 'gbk.txt'), Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0xb2, 0xe2, 0xca, 0xd4, 0xd6, 0xd0, 0xce, 0xc4]));
  const r = readDocsDir(docs2);
  assert(r.files.length === 1 && r.files[0] === 'ok.md', `只装进正常的那个（实际 ${JSON.stringify(r.files)}）`);
  assert(r.skipped.some((x) => /gbk\.txt/.test(x) && /UTF-8/.test(x)), `乱码文件点名跳过并说清原因（实际 ${JSON.stringify(r.skipped)}）`);
  assert(!r.text.includes('\uFFFD'), '正文里不带替换字符');
}

rmSync(dir, { recursive: true, force: true });
console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed > 0 ? 1 : 0);
