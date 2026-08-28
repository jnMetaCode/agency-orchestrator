/**
 * 内置 workflow 模板回归门禁：workflows/ 下每个 .yaml 都必须解析 + 校验通过。
 * 模板是获客橱窗——一个坏模板就是一个坏的第一印象，绝不能合进 main。
 * 把 feedback_validate_fixtures（改 validate/parser 必须全量跑 workflows/）固化为测试，
 * 本地 npm test 与 CI 都会执行，不再依赖人工记得手动跑。
 *
 * 角色库存在时顺带校验 role 真实性；不存在则降级为只校验结构（仍有价值）。
 *
 * **每个模板用它自己声明的 agents_dir 解析**（走引擎同一个 findAgentsDir）。此前这里写死
 * 一个中文库拿去校验全部模板——英文模板（agents_dir: agency-agents）也被按中文库校验，
 * 之所以一直没红，只是因为两个库路径大量同名。等英文库有了中文库没有的角色（company/
 * 高管层、视频提示词工程师），门禁就会把**正确的模板**判成坏的。测试和引擎的解析口径
 * 必须是同一套，否则它守的是另一个世界。
 */
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { load } from 'js-yaml';
import { parseWorkflow, validateWorkflow } from '../src/core/parser.js';
import { findAgentsDir } from '../src/index.js';

let passed = 0, failed = 0;
function assert(c: boolean, msg: string): void { if (!c) throw new Error(msg); }

const wfDir = resolve(import.meta.dirname!, '../workflows');
const agentsDir = [
  resolve(import.meta.dirname!, '../node_modules/agency-agents-zh'),
  resolve(import.meta.dirname!, '../agency-agents-zh'),
  resolve(import.meta.dirname!, '../../agency-agents-zh'),
].find(d => existsSync(d));

console.log('\n=== 内置 workflow 模板校验门禁 ===');
console.log(`  角色库: ${agentsDir ? agentsDir.replace(resolve(import.meta.dirname!, '..'), '.') : '未找到（仅校验结构）'}`);

const files = readdirSync(wfDir, { recursive: true })
  .map(f => String(f))
  .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
  .map(f => join(wfDir, f))
  .sort();

assert(files.length > 0, `workflows/ 下应有模板，实际找到 ${files.length} 个`);

for (const file of files) {
  const rel = file.replace(wfDir + '/', '');
  try {
    const wf = parseWorkflow(file);
    // 模板自己写了 agents_dir 就按它解析（英文模板指 agency-agents，中文模板指 agency-agents-zh）；
    // 解析不到再退回下面那个探测到的中文库，保住"没装角色库也能只验结构"的降级行为。
    const own = wf.agents_dir ? findAgentsDir(wf.agents_dir, file) : null;
    const errors = validateWorkflow(wf, own ?? agentsDir);
    if (errors.length === 0) {
      passed++;
    } else {
      console.log(`  ❌ ${rel}`);
      for (const e of errors) console.log(`       - ${e.split('\n')[0]}`);
      failed++;
    }
  } catch (err) {
    console.log(`  ❌ ${rel}: ${err instanceof Error ? err.message.split('\n')[0] : err}`);
    failed++;
  }
}

// ── 输入的动态源必须在 Studio 里真能渲染出来 ────────────────────────────────
// 真实故障（2026-08-28）：短剧流水线的「语音供应商」写了 source: tts_providers，
// 而 Studio 的运行弹窗对带 source 的输入是**不画控件的**——它们由右侧「出图 / 出片」
// 面板驱动，而那个面板只覆盖图片与视频。结果这个必填输入在弹窗里**凭空消失**，
// 模板在 Studio 里根本没法跑，而 `ao validate` 一切正常，没有任何环节会报。
{
  // 这个文件的门禁是"每个模板一条"，没有 test() 助手——本节自带一个，计数并入同一对计数器
  const test = (name: string, fn: () => void): void => {
    try { fn(); console.log(`  ✅ ${name}`); passed++; }
    catch (e) { console.log(`  ❌ ${name}: ${e instanceof Error ? e.message : e}`); failed++; }
  };
  const panel = readFileSync('website/src/components/studio/WorkflowsPanel.tsx', 'utf-8');
  const known = new Set([...panel.matchAll(/inp\.source === "([a-z_]+)"/g)].map((m) => m[1]));
  // 档位类在 optionsFor 里也是逐个 if，一并收进来
  for (const m of panel.matchAll(/i\.source === "([a-z_]+)"/g)) known.add(m[1]);

  const used = new Map<string, string>();   // source → 第一个用到它的模板文件
  for (const dir of ['workflows', 'workflows/en']) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.yaml'))) {
      const doc = load(readFileSync(join(dir, f), 'utf-8')) as { inputs?: Array<{ source?: string }> };
      for (const i of doc?.inputs ?? []) if (i.source && !used.has(i.source)) used.set(i.source, `${dir}/${f}`);
    }
  }

  test('模板用到的每个 input.source，Studio 都认识（否则那个输入在弹窗里消失）', () => {
    for (const [src, file] of used) {
      assert(known.has(src), `${file} 用了 source: ${src}，但 WorkflowsPanel 的 optionsFor 不认识它——那个输入会渲染不出候选`);
    }
  });

  test('show_when 在弹窗的三处都生效：内容输入、媒体输入、必填缺失判断', () => {
    // 漏一处的后果：要么隐藏的输入照样显示（等于没做），要么隐藏了却还拦着说必填缺失（自相矛盾）
    const uses = (panel.match(/inputVisible\(/g) || []).length;
    assert(uses >= 3, `WorkflowsPanel 应在三处调用 inputVisible，实得 ${uses}`);
    assert(/missingMedia = mediaInputs\.filter\(\(i\) => inputVisible\(i, vals\)/.test(panel), '必填缺失判断必须先排除隐藏的输入');
  });

  test('「出图 / 出片」面板管不到的 source，必须在弹窗里就地渲染', () => {
    // coveredByMediaPanel 列的是面板已覆盖的；其余的走 !coveredByMediaPanel 分支就地画。
    // 这条防的是有人把新 source 加进 coveredByMediaPanel 却没在面板里实现对应控件。
    const covered = panel.slice(panel.indexOf('const coveredByMediaPanel'), panel.indexOf('const [vals, setVals]'));
    const listed = new Set([...covered.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
    const mediaSelect = readFileSync('website/src/components/studio/MediaSelect.tsx', 'utf-8');
    for (const src of listed) {
      if (src === 'models') continue;   // 模型下拉在面板里按 image/video 各有一处
      const kind = src.startsWith('image') ? 'image' : 'video';
      assert(new RegExp(kind, 'i').test(mediaSelect), `coveredByMediaPanel 声称面板覆盖了 ${src}，但 MediaSelect 里找不到 ${kind} 相关控件`);
    }
    assert(!listed.has('tts_providers'), '配音供应商没有面板控件，不能列进 coveredByMediaPanel，否则它会在弹窗里消失');
  });
}

console.log('\n' + '='.repeat(50));
console.log(`  模板门禁: ${passed} 通过, ${failed} 失败 (共 ${files.length} 个模板)`);
if (failed === 0) console.log('  全部通过!');
else process.exit(1);
console.log('='.repeat(50) + '\n');
