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
import { readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
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

console.log('\n' + '='.repeat(50));
console.log(`  模板门禁: ${passed} 通过, ${failed} 失败 (共 ${files.length} 个模板)`);
if (failed === 0) console.log('  全部通过!');
else process.exit(1);
console.log('='.repeat(50) + '\n');
