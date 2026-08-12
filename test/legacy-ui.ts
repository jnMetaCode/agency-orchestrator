/**
 * 内置网页 UI（web/index.html）的关键行为守卫。
 *
 * 为什么需要它：覆盖面分析显示，这是唯一一个**零测试引用**的产品文件 —— 它是纯浏览器
 * 脚本，既不过 tsc、也不进任何构建，改坏了没有任何环节会报错。而它承载着一条会改动
 * 用户内容的路径：保存工作流时服务端会确定性修正 depends_on（#103），前端必须把修正
 * 后的正文回填编辑框并明确告知，否则用户眼前的文本与磁盘上的文件不一致。
 *
 * 这里不引 jsdom（仓库没有该依赖，为一个文件引一套浏览器环境不划算），而是把
 * saveComposed 从源文件里抠出来、注入最小桩环境后真实执行 —— 断言的是行为，
 * 不是"文件里有没有某个字符串"。
 */
import { readFileSync } from 'node:fs';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}: ${err instanceof Error ? err.message : err}`);
    failed++;
  }
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg);
}

const html = readFileSync('web/index.html', 'utf-8');

/** 从 index.html 里抠出 window.saveComposed 的函数体，注入桩环境后执行。 */
function loadSaveComposed(opts: {
  response: Record<string, unknown>;
  ok?: boolean;
  yamlInEditor: string;
}): {
  run: () => Promise<string | null>;
  els: Record<string, { value: string; textContent: string; innerHTML: string }>;
  state: Record<string, unknown>;
  requests: { url: string; body: unknown }[];
} {
  const start = html.indexOf('window.saveComposed = async function');
  assert(start >= 0, 'index.html 里找不到 saveComposed —— 保存路径可能被改名/删除了');
  const marker = '\n};';
  const end = html.indexOf(marker, start);
  assert(end > start, 'saveComposed 函数体解析失败');
  const src = html.slice(start, end + marker.length);

  const mk = () => ({ value: '', textContent: '', innerHTML: '' });
  const els: Record<string, ReturnType<typeof mk>> = {
    'compose-yaml': mk(),
    'compose-name': mk(),
    'compose-warnings': mk(),
  };
  els['compose-yaml'].value = opts.yamlInEditor;
  const state: Record<string, unknown> = {};
  const requests: { url: string; body: unknown }[] = [];

  const sandbox = {
    window: {} as Record<string, unknown>,
    $: (id: string) => els[id] ?? mk(),
    S: state,
    loadWorkflows: async () => {},
    alert: (m: string) => { state.alerted = m; },
    fetch: async (url: string, init: { body: string }) => {
      requests.push({ url, body: JSON.parse(init.body) });
      return { ok: opts.ok !== false, json: async () => opts.response };
    },
  };

  // eslint 无关：这是把产品源码放进受控桩环境执行，参数即桩
  const factory = new Function('window', '$', 'S', 'loadWorkflows', 'alert', 'fetch', `${src}; return window.saveComposed;`);
  const run = factory(sandbox.window, sandbox.$, sandbox.S, sandbox.loadWorkflows, sandbox.alert, sandbox.fetch);
  return { run: () => run(true), els, state, requests };
}

const DIRTY = 'name: t\nsteps:\n  - id: compile\n    depends_on: [analysis_result]\n';
const FIXED = 'name: t\nsteps:\n  - id: compile\n    depends_on: [analyze]\n';

console.log('\n─── 内置网页 UI：保存路径（web/index.html 无 tsc/构建把关，只能靠这层） ───');

await test('服务端修正了 depends_on → 编辑框回填修正后的正文', async () => {
  const t = loadSaveComposed({
    yamlInEditor: DIRTY,
    response: { file: '/tmp/x.yaml', yaml: FIXED, autoFixes: [{ step: 'compile', fixedDep: 'analysis_result', toStep: 'analyze' }] },
  });
  await t.run();
  assert(t.els['compose-yaml'].value === FIXED, `编辑框没同步，仍是: ${t.els['compose-yaml'].value}`);
});

await test('明确告诉用户改了哪几处（不能偷偷改用户的东西）', async () => {
  const t = loadSaveComposed({
    yamlInEditor: DIRTY,
    response: { file: '/tmp/x.yaml', yaml: FIXED, autoFixes: [{ step: 'compile', fixedDep: 'analysis_result', toStep: 'analyze' }] },
  });
  await t.run();
  const notice = t.els['compose-warnings'].innerHTML;
  assert(notice.includes('compile'), `提示里应点名步骤: ${notice}`);
  assert(notice.includes('analysis_result') && notice.includes('analyze'), `提示里应说明改动: ${notice}`);
});

await test('回填后 composedOriginalYaml 记的是磁盘上的那份（否则"是否被编辑过"判断会错）', async () => {
  const t = loadSaveComposed({
    yamlInEditor: DIRTY,
    response: { file: '/tmp/x.yaml', yaml: FIXED, autoFixes: [{ step: 'compile', fixedDep: 'analysis_result', toStep: 'analyze' }] },
  });
  await t.run();
  assert(t.state.composedOriginalYaml === FIXED, `应记录修正后的正文，实际: ${String(t.state.composedOriginalYaml).slice(0, 40)}`);
});

await test('没有修正时保持原行为（正常保存提示，不误报"改过你的东西"）', async () => {
  const t = loadSaveComposed({ yamlInEditor: FIXED, response: { file: '/tmp/x.yaml' } });
  await t.run();
  assert(t.els['compose-yaml'].value === FIXED, '没修正时不该动编辑框');
  assert(t.state.composedOriginalYaml === FIXED, 'composedOriginalYaml 应为原文');
  assert(!t.els['compose-warnings'].innerHTML.includes('自动修正'), '不该出现修正提示');
  assert(t.els['compose-warnings'].innerHTML.includes('已保存'), '应有保存成功提示');
});

await test('保存失败 → 不动编辑框、不写状态、返回 null', async () => {
  const t = loadSaveComposed({ yamlInEditor: DIRTY, ok: false, response: { error: '磁盘满了' } });
  const r = await t.run();
  assert(r === null, '失败时应返回 null');
  assert(t.els['compose-yaml'].value === DIRTY, '失败时不该改编辑框');
  assert(t.state.composedFile === undefined, '失败时不该记录文件路径');
});

await test('确实打的是 /api/workflows/save，且带上编辑框内容', async () => {
  const t = loadSaveComposed({ yamlInEditor: DIRTY, response: { file: '/tmp/x.yaml' } });
  await t.run();
  assert(t.requests.length === 1 && t.requests[0].url.includes('/api/workflows/save'), `请求地址不对: ${JSON.stringify(t.requests)}`);
  assert((t.requests[0].body as { yaml: string }).yaml === DIRTY, '提交的正文应是编辑框里的内容');
});

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
