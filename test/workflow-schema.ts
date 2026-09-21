/**
 * schemas/workflow.schema.json —— 给编辑器用的工作流 YAML 结构定义（补全 + 即时校验）。
 *
 * 一份和解析器对不上的 schema 比没有更糟：编辑器会在**能跑的**工作流上画满红线，或者对跑不了的放行。
 * 所以钉三件事：
 *   1. 全部内置模板（中英）都通过——schema 不比引擎更严；
 *   2. 引擎在解析期拒绝的典型写法，schema 也拒绝——红线要画在对的地方；
 *   3. provider 补全候选与注册表一致（新接一家忘了同步就红，提示跑同步脚本）。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import yaml from 'js-yaml';
import { CLI_PROVIDER_IDS } from '../src/providers/detect.js';
import { API_PROVIDERS, ANTHROPIC_PROVIDERS } from '../src/connectors/api-providers.js';

const require = createRequire(import.meta.url);
const Ajv = require('ajv');

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; }
}

const schema = JSON.parse(readFileSync('schemas/workflow.schema.json', 'utf-8'));
const ajv = new (Ajv.default ?? Ajv)({ allErrors: true, strict: false, allowUnionTypes: true });
const validate = ajv.compile(schema);
const errorsOf = (doc: unknown): string => (validate(doc) ? '' : (validate.errors || []).map((e: any) => `${e.instancePath || '/'} ${e.message}${e.params?.additionalProperty ? `: ${e.params.additionalProperty}` : ''}`).join('; '));

console.log('\n─── 内置模板全部通过（schema 不比引擎更严） ───');
{
  const files = [
    ...readdirSync('workflows').filter((f) => f.endsWith('.yaml')).map((f) => join('workflows', f)),
    ...readdirSync(join('workflows', 'en')).filter((f) => f.endsWith('.yaml')).map((f) => join('workflows', 'en', f)),
  ];
  const bad = files.map((f) => ({ f, e: errorsOf(yaml.load(readFileSync(f, 'utf-8'))) })).filter((x) => x.e);
  assert(files.length >= 40, `扫到 ${files.length} 个模板`);
  assert(bad.length === 0, bad.length ? `不通过：${bad.slice(0, 3).map((x) => `${x.f} → ${x.e.slice(0, 160)}`).join(' ‖ ')}` : '全部通过');
}

console.log('\n─── 引擎会拒绝的写法，schema 也拒绝 ───');
{
  const base = () => ({ name: 'x', agents_dir: 'agency-agents-zh', llm: { provider: 'deepseek', model: 'm' }, steps: [{ id: 'a', role: 'r/x', task: 't', output: 'o' }] as any[] });
  assert(errorsOf(base()) === '', '基准工作流通过');
  const cases: [string, (d: any) => void][] = [
    ['步骤缺 id', (d) => { delete d.steps[0].id; }],
    ['普通步骤缺 role', (d) => { delete d.steps[0].role; }],
    ['type 拼错（vidoe）', (d) => { d.steps[0].type = 'vidoe'; }],
    ['字段拼错（depend_on）——最常见的手误，此前引擎会静默忽略', (d) => { d.steps[0].depend_on = ['b']; }],
    ['depends_on 写成字符串', (d) => { d.steps[0].depends_on = 'b'; }],
    ['concurrency: -1', (d) => { d.concurrency = -1; }],
    ['loop 缺 exit_condition', (d) => { d.steps[0].loop = { back_to: 'a', max_iterations: 3 }; }],
    ['video 步骤缺 video.model', (d) => { d.steps[0] = { id: 'v', type: 'video', task: '猫', video: { duration: 5 } }; }],
    ['tts 步骤缺 voice', (d) => { d.steps[0] = { id: 'vo', type: 'tts', task: '念', tts: { model: 'm' } }; }],
    ['concat 缺 inputs', (d) => { d.steps[0] = { id: 'f', type: 'concat', concat: {} }; }],
    ['depends_on_mode 拼错', (d) => { d.steps[0].depends_on_mode = 'any'; }],
    ['step id 含路径字符', (d) => { d.steps[0].id = '../x'; }],
    ['steps 为空', (d) => { d.steps = []; }],
  ];
  for (const [why, mutate] of cases) {
    const d = base(); mutate(d);
    assert(errorsOf(d) !== '', `拒绝：${why}`);
  }
  const ok: [string, (d: any) => void][] = [
    ['媒体步骤不需要 role', (d) => { d.steps = [{ id: 'v', type: 'video', task: '猫', video: { model: 'MiniMax-H3', duration: '{{secs}}' }, output: 'v_mp4' }]; }],
    ['approval 节点不需要 role / task', (d) => { d.steps.push({ id: 'gate', type: 'approval', prompt: '继续吗', depends_on: ['a'] }); }],
    ['自定义 provider（不在候选里）配 base_url', (d) => { d.llm = { provider: 'my-relay', base_url: 'https://x/v1', model: 'm' }; }],
    ['deliverables 写成单个字符串', (d) => { d.deliverables = 'a'; }],
  ];
  for (const [why, mutate] of ok) {
    const d = base(); mutate(d);
    const e = errorsOf(d);
    assert(e === '', `放行：${why}${e ? `（却报了：${e.slice(0, 120)}）` : ''}`);
  }
}

console.log('\n─── provider 补全候选与注册表一致 ───');
{
  const want = [...new Set([...CLI_PROVIDER_IDS, 'ollama', 'claude', ...API_PROVIDERS.map((p) => p.id), ...ANTHROPIC_PROVIDERS.map((p) => p.id)])].sort().join();
  const got = [...(schema.properties.llm.properties.provider.examples as string[])].sort().join();
  assert(want === got, want === got ? `${want.split(',').length} 个` : '对不上——新接了供应商？跑：npm run build && node scripts/sync-schema-providers.mjs');
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed > 0 ? 1 : 0);
