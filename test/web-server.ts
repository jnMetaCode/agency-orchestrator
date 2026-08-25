/**
 * web/server.js 冒烟测试：启真实服务，验证关键端点路由 + 安全守卫(路径穿越/越权)。
 * 不需要 LLM——只打不依赖模型的端点。server.js 不在 tsc/其余测试覆盖内，这是它唯一的自动化网。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import http from 'node:http';

let passed = 0, failed = 0;
function assert(c: boolean, m: string): void { if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; } }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); });
  });
}

async function post(base: string, path: string, body: unknown): Promise<number> {
  const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.status;
}

console.log('\n─── web/server.js 冒烟 ───');

const port = await freePort();
const dataDir = mkdtempSync(join(tmpdir(), 'ao-web-test-'));
const base = `http://127.0.0.1:${port}`;
let server: ChildProcess | null = null;

try {
  server = spawn(process.execPath, [resolve('web/server.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', AO_NODE: process.execPath, AO_DATA_DIR: dataDir, AO_USER_ROLES_DIR: join(dataDir, 'my-roles') },
    stdio: 'ignore',
  });

  // 等健康
  let up = false;
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(base + '/api/health'); if (r.ok) { up = true; break; } } catch { /* not up yet */ }
    await sleep(250);
  }
  assert(up, '服务启动且 /api/health 返回 200');

  if (up) {
    // ── 基本端点 ──
    const health = await (await fetch(base + '/api/health')).json();
    assert(!!health.version, '/api/health 含 version');
    assert(health.stale === false, `刚启动的引擎不该被判定为待重启(stale=${health.stale})`);

    // ── 「引擎待重启」只该在**内容真的变了**时响 ──
    // 判据曾经是 mtime，于是 git 的每一次改写（切分支 / merge / rebase / stash）都会
    // 误报——实际撞到过一次：ff 合并把 web/server.js 回退再写回，内容一字未变，界面
    // 却开始喊重启。一个"切个分支就喊重启"的警报，喊几次之后就没人信了。
    {
      const probe = resolve('web/server.js');
      const st = statSync(probe);
      // 只把 mtime 推到未来（内容一个字节不动）= 模拟 git 改写
      utimesSync(probe, st.atime, new Date(Date.now() + 60_000));
      const h2 = await (await fetch(base + '/api/health')).json();
      assert(h2.stale === false, 'mtime 变了但内容没变，不该判定为待重启（git 切分支/合并会这样）');
      // 真改内容才该响：往构建产物尾部加一行注释，断言完立刻还原
      const cliProbe = resolve('dist/cli.js');
      const orig = readFileSync(cliProbe);
      try {
        writeFileSync(cliProbe, Buffer.concat([orig, Buffer.from('\n// stale-probe\n')]));
        const h3 = await (await fetch(base + '/api/health')).json();
        assert(h3.stale === true, '构建产物内容变了，必须提示重启引擎（这是它存在的意义）');
      } finally {
        writeFileSync(cliProbe, orig);   // 万一断言抛了也还原，别把 dist 留脏
      }
      const h4 = await (await fetch(base + '/api/health')).json();
      assert(h4.stale === false, '内容还原后应恢复正常（跑的代码与盘上一致了）');
    }

    const roles = await (await fetch(base + '/api/roles')).json();
    assert(Array.isArray(roles) && roles.length > 0, `/api/roles 返回非空数组(${roles.length})`);

    const cfg = await (await fetch(base + '/api/config')).json();
    assert(cfg && typeof cfg.providers === 'object', '/api/config 含 providers');

    const wfs = await (await fetch(base + '/api/workflows')).json();
    assert(Array.isArray(wfs), '/api/workflows 返回数组');

    // ── 安全守卫(最关键) ──
    assert(await post(base, '/api/run', { file: '../../../../etc/passwd' }) === 403, '/api/run 路径穿越 → 403');
    assert(await post(base, '/api/run', { file: 'workflows/__nonexistent__.yaml' }) === 404, '/api/run 不存在文件 → 404');
    assert(await post(base, '/api/run', {}) === 400, '/api/run 缺 file → 400');
    assert(await post(base, '/api/compare', { file: '../../../../etc/passwd' }) === 403, '/api/compare 路径穿越 → 403');
    const yamlTraversal = (await fetch(base + '/api/workflows/yaml?file=' + encodeURIComponent('../../../../etc/passwd'))).status;
    assert(yamlTraversal === 403, '/api/workflows/yaml 路径穿越 → 403');

    // ── SPA 兜底(#81)：非 /api 的深层路由必须返回前端 HTML，不能白屏 / 报栈 ──
    const spa = await fetch(base + '/studio/some/deep/route');
    const spaCt = spa.headers.get('content-type') || '';
    assert(spa.ok && spaCt.includes('text/html'), `SPA 深层路由返回 HTML(${spa.status})`);

    // ── 可编辑画布 graph 端点 ──
    assert((await fetch(base + '/api/workflows/graph?file=' + encodeURIComponent('../../../../etc/passwd'))).status === 403, '/api/workflows/graph 路径穿越 → 403');
    assert(await post(base, '/api/workflows/graph', { nodes: [] }) === 400, '/api/workflows/graph 空 nodes → 400');

    const baseYaml = 'name: t\nagents_dir: agency-agents-zh\nllm:\n  provider: deepseek\n  model: deepseek-chat\nsteps:\n  - id: a\n    role: x/y\n    task: t1\n';
    // 合法图：a → b，应保存成功
    const okBody = {
      name: 'canvas-test', baseYaml,
      nodes: [
        { id: 'a', position: { x: 0, y: 0 }, data: { id: 'a', role: 'x/y', task: 't1' } },
        { id: 'b', position: { x: 200, y: 0 }, data: { id: 'b', role: 'x/y', task: 't2' } },
      ],
      edges: [{ id: 'a->b', source: 'a', target: 'b' }],
    };
    const graphSave = await fetch(base + '/api/workflows/graph', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(okBody) });
    assert(graphSave.status === 200, '/api/workflows/graph 合法图 → 200 保存');
    const savedFile: string = graphSave.status === 200 ? (await graphSave.json()).file : '';
    // QA #6：缺 edges 数组 → 400（不静默清空依赖）
    assert(await post(base, '/api/workflows/graph', { name: 't', baseYaml, nodes: okBody.nodes }) === 400, '/api/workflows/graph 缺 edges → 400');
    // QA #14：节点缺 role → 400
    const rolelessBody = { name: 't', baseYaml, edges: [], nodes: [{ id: 'a', position: { x: 0, y: 0 }, data: { id: 'a', task: 't1' } }] };
    assert(await post(base, '/api/workflows/graph', rolelessBody) === 400, '/api/workflows/graph 节点缺 role → 400');
    // 但 approval / human_input 节点无 role 是合法形态，不能被 QA #14 守卫误杀
    const approvalBody = {
      name: 'canvas-approval-ok', baseYaml, edges: [{ id: 'a->gate', source: 'a', target: 'gate' }],
      nodes: [
        { id: 'a', position: { x: 0, y: 0 }, data: { id: 'a', role: 'x/y', task: 't1', output: 'out_a' } },
        { id: 'gate', position: { x: 200, y: 0 }, data: { id: 'gate', type: 'approval', prompt: '确认继续？' } },
      ],
    };
    const approvalSave = await fetch(base + '/api/workflows/graph', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(approvalBody) });
    assert(approvalSave.status === 200, '/api/workflows/graph approval 节点无 role → 200 可保存');
    if (approvalSave.status === 200) {
      const f = (await approvalSave.json()).file;
      await fetch(base + '/api/workflows?file=' + encodeURIComponent(f), { method: 'DELETE' });
    }
    // 成环：a → b → a，validateWorkflow 应拒
    const cycleBody = { ...okBody, edges: [{ id: 'a->b', source: 'a', target: 'b' }, { id: 'b->a', source: 'b', target: 'a' }] };
    assert(await post(base, '/api/workflows/graph', cycleBody) === 400, '/api/workflows/graph 成环 → 400 被校验拦截');
    // #91：变量名对但缺依赖边（b 用 {{out_a}} 却没连 a→b）→ 保存时确定性补边，200 + autoFixes
    const missingEdgeBody = {
      name: 'canvas-autofix-test', baseYaml,
      nodes: [
        { id: 'a', position: { x: 0, y: 0 }, data: { id: 'a', role: 'x/y', task: 't1', output: 'out_a' } },
        { id: 'b', position: { x: 200, y: 0 }, data: { id: 'b', role: 'x/y', task: 'use {{out_a}}', output: 'out_b' } },
      ],
      edges: [],
    };
    const fixSave = await fetch(base + '/api/workflows/graph', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(missingEdgeBody) });
    const fixBody = fixSave.status === 200 ? await fixSave.json() : { autoFixes: [] };
    assert(fixSave.status === 200, '/api/workflows/graph 缺依赖边 → 200 自动补边保存(#91)');
    assert(Array.isArray(fixBody.autoFixes) && fixBody.autoFixes.length === 1 && fixBody.autoFixes[0].step === 'b' && fixBody.autoFixes[0].addedDep === 'a', 'autoFixes 返回补边明细 b←a');
    if (fixBody.file) await fetch(base + '/api/workflows?file=' + encodeURIComponent(fixBody.file), { method: 'DELETE' });

    // ── 用户工作流删除 DELETE /api/workflows（#92）──
    const del = (file: string) => fetch(base + '/api/workflows?file=' + encodeURIComponent(file), { method: 'DELETE' });
    assert((await del('../../../../etc/passwd')).status === 403, 'DELETE /api/workflows 路径穿越 → 403');
    const builtin = (wfs as Array<{ file: string; private?: boolean }>).find((w) => !w.private)?.file;
    if (builtin) assert((await del(builtin)).status === 403, 'DELETE /api/workflows 内置模板 → 403 不可删');
    if (savedFile) {
      const listed = (await (await fetch(base + '/api/workflows')).json()) as Array<{ file: string; private?: boolean; deletable?: boolean; mtime?: number }>;
      const mine = listed.find((w) => w.file === savedFile);
      assert(!!mine && mine.private === true && mine.deletable === true && typeof mine.mtime === 'number', '用户工作流带 private/deletable/mtime 标记');
      assert((await del(savedFile)).status === 200, 'DELETE /api/workflows 用户工作流 → 200 删除');
      assert((await del(savedFile)).status === 404, 'DELETE /api/workflows 已删文件再删 → 404');
    }

    // #103：粘 YAML 保存时 depends_on 写成上游的「输出变量名」而非 step id → 存之前确定性改写
    // （画布那条链不需要这个修复：graphToWorkflow 的 depends_on 是从连线重算的，假 id 落不进 YAML）
    const badDepYaml = [
      'name: "depid-save-test"',
      'agents_dir: "agency-agents-zh"',
      'llm:',
      '  provider: deepseek',
      '  model: deepseek-chat',
      'steps:',
      '  - id: analyze',
      '    role: "x/y"',
      '    task: "分析"',
      '    output: analysis_result',
      '  - id: compile',
      '    role: "x/y"',
      '    task: "汇总 {{analysis_result}}"',
      '    output: final',
      '    depends_on: [analysis_result]',
      '',
    ].join('\n');
    const saveRes = await fetch(base + '/api/workflows/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'depid-save-test', yaml: badDepYaml }) });
    const saveJson = saveRes.status === 200 ? await saveRes.json() : {};
    assert(saveRes.status === 200, `POST /api/workflows/save → 200(实际 ${saveRes.status})`);
    assert(
      Array.isArray(saveJson.autoFixes) && saveJson.autoFixes.some((f) => f.fixedDep === 'analysis_result' && f.toStep === 'analyze'),
      `#103 保存时应改写 depends_on 并报出明细，实际 ${JSON.stringify(saveJson.autoFixes)}`,
    );
    // 改写后必须把正文回传：调用方要用它同步编辑框，否则用户眼前的文本与磁盘不一致
    assert(typeof saveJson.yaml === 'string' && /depends_on: \[analyze\]/.test(saveJson.yaml), '改写后应回传修正过的 YAML 正文');
    if (saveJson.file) {
      const savedText = readFileSync(saveJson.file, 'utf-8');
      assert(/depends_on: \[analyze\]/.test(savedText), `落盘内容应已改写，实际:\n${savedText}`);
      assert(savedText.includes('{{analysis_result}}'), 'task 正文里的变量引用不该被误伤');
      await fetch(base + '/api/workflows?file=' + encodeURIComponent(saveJson.file), { method: 'DELETE' });
    }

    // ── 运行历史：时区还原 + 删除（#101）──
    // 产物目录名里的时间戳是 UTC，以前前端直接当本地时间显示 → 北京用户永远差 8 小时。
    // 后端现在给绝对时刻 startedAt，由前端按系统时区渲染。
    const outDir = join(dataDir, 'ao-output');
    const legacyRun = '历史运行-2026-07-15T02-30-26';   // 老产物：只能从目录名还原（UTC）
    const newRun = '新运行-2026-07-16T00-00-00';        // 新产物：metadata 带 finishedAt
    const notARun = '不是运行记录';                      // 没有 metadata.json，不该被删
    mkdirSync(join(outDir, legacyRun), { recursive: true });
    writeFileSync(join(outDir, legacyRun, 'metadata.json'), JSON.stringify({ name: '历史运行', success: true, steps: [] }), 'utf-8');
    mkdirSync(join(outDir, newRun), { recursive: true });
    writeFileSync(join(outDir, newRun, 'metadata.json'), JSON.stringify({ name: '新运行', success: false, finishedAt: '2026-07-16T08:00:00.000+08:00', steps: [] }), 'utf-8');
    mkdirSync(join(outDir, notARun), { recursive: true });

    // ── type: image 产物：详情里路径改写 + 只读产物接口 + 穿越守卫 ──
    const imgRun = '图片运行-2026-07-17T00-00-00';
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    mkdirSync(join(outDir, imgRun, 'steps'), { recursive: true });
    mkdirSync(join(outDir, imgRun, 'assets'), { recursive: true });
    writeFileSync(join(outDir, imgRun, 'metadata.json'), JSON.stringify({ name: '图片运行', success: true, steps: [{ id: 'poster', role: '', status: 'completed', duration: '1.0s', tokens: { input: 0, output: 0 }, imageAsset: { filename: 'poster.png' } }] }), 'utf-8');
    writeFileSync(join(outDir, imgRun, 'steps', '1-poster.md'), '> 🎨 **文生图** | 步骤 1/1\n\n---\n\n![poster](../assets/poster.png)', 'utf-8');
    writeFileSync(join(outDir, imgRun, 'assets', 'poster.png'), PNG);
    const imgDetail = (await (await fetch(base + '/api/runs/' + encodeURIComponent(imgRun))).json()) as { steps: Array<{ id: string; content?: string }> };
    const posterStep = imgDetail.steps.find((x) => x.id === 'poster');
    assert(!!posterStep?.content?.includes(`/api/runs/${encodeURIComponent(imgRun)}/assets/poster.png`),
      `详情里的 ../assets/ 引用应被改写成产物接口(实际 ${posterStep?.content})`);
    const assetRes = await fetch(base + '/api/runs/' + encodeURIComponent(imgRun) + '/assets/poster.png');
    assert(assetRes.status === 200 && assetRes.headers.get('content-type') === 'image/png', `产物接口应 200 image/png(实际 ${assetRes.status} ${assetRes.headers.get('content-type')})`);
    assert(Buffer.from(await assetRes.arrayBuffer()).equals(PNG), '产物字节应与落盘一致');
    const traverse = await fetch(base + '/api/runs/' + encodeURIComponent(imgRun) + '/assets/..%2Fmetadata.json');
    assert(traverse.status === 404, `路径穿越应被挡(实际 ${traverse.status})`);
    const noRun = await fetch(base + '/api/runs/' + encodeURIComponent(notARun) + '/assets/x.png');
    assert(noRun.status === 404, '没有 metadata.json 的目录不提供产物');

    const runsList = (await (await fetch(base + '/api/runs')).json()) as Array<{ id: string; startedAt?: string; file?: string; roles?: string[] }>;
    {
      // 「最近运行 / 最近用过」的数据基础：列表项带工作流文件与用过的角色
      const withRoles = runsList.find((r) => Array.isArray(r.roles) && r.roles.length > 0);
      assert(!!withRoles, '/api/runs 列表项应带 roles（步骤 role 去重）');
      assert(runsList.every((r) => Array.isArray(r.roles)), '/api/runs 每项 roles 都是数组');
      // 输入下拉的数据基础：/api/config 给视频供应商档位表；/api/workflows 透传 source/source_from
      const cfgNow = (await (await fetch(base + '/api/config')).json()) as { videoProviders?: Array<{ id: string; resolutions: string[]; models: string[] }> };
      const metaso = cfgNow.videoProviders?.find((v) => v.id === 'metaso');
      assert(!!metaso && metaso.resolutions.includes('768P') && metaso.models.includes('MiniMax-H3'), '/api/config.videoProviders 应带秘塔的档位表');
      const wfsNow = (await (await fetch(base + '/api/workflows')).json()) as Array<{ filename: string; inputs?: Array<{ name: string; source?: string; source_from?: string }> }>;
      const film = wfsNow.find((w) => w.filename === '一句话出短片.yaml');
      const vm = film?.inputs?.find((i) => i.name === 'video_model');
      assert(vm?.source === 'models' && vm?.source_from === 'video_provider', '/api/workflows 应透传输入的 source / source_from');
      // 运行卡片缩略图：有 assets/ 图片的运行带 thumb，走既有资产路由
      const imgEntry = (runsList as Array<{ id: string; thumb?: string }>).find((r) => r.id === imgRun);
      assert(imgEntry?.thumb === `/api/runs/${encodeURIComponent(imgRun)}/assets/poster.png`, '/api/runs 图片运行应带 thumb 指向首图: ' + imgEntry?.thumb);
    }
    const legacy = runsList.find((r) => r.id === legacyRun);
    const fresh = runsList.find((r) => r.id === newRun);
    assert(legacy?.startedAt === '2026-07-15T02:30:26.000Z', `老产物目录名按 UTC 还原成绝对时刻(实际 ${legacy?.startedAt})`);
    assert(fresh?.startedAt === '2026-07-16T00:00:00.000Z', `新产物按 metadata.finishedAt 的时区偏移换算(实际 ${fresh?.startedAt})`);
    assert(!runsList.some((r) => r.id === notARun), '没有 metadata.json 的目录不算运行记录');

    const delRun = (id: string) => fetch(base + '/api/runs/' + encodeURIComponent(id), { method: 'DELETE' });
    assert((await delRun('..%2F..%2Fetc')).status === 403 || (await delRun('../../etc')).status === 403, 'DELETE /api/runs 路径穿越 → 403');
    assert((await delRun(notARun)).status === 404, 'DELETE /api/runs 非运行目录 → 404 不误删');
    assert(existsSync(join(outDir, notARun)), '非运行目录仍在磁盘上');
    assert((await delRun('查无此运行-2026-01-01T00-00-00')).status === 404, 'DELETE /api/runs 不存在 → 404');
    assert((await delRun(legacyRun)).status === 200, 'DELETE /api/runs 真实记录 → 200');
    assert(!existsSync(join(outDir, legacyRun)), '记录目录已从磁盘删除');
    const afterDel = (await (await fetch(base + '/api/runs')).json()) as Array<{ id: string }>;
    assert(!afterDel.some((r) => r.id === legacyRun), '删除后不再出现在历史列表');
    assert((await delRun(legacyRun)).status === 404, '已删记录再删 → 404');

    // 目录名不带时间戳（用户手动改过名等）→ 退回 mtime，不能让整条记录消失或报错
    const oddName = 'manually-renamed-run';
    mkdirSync(join(outDir, oddName), { recursive: true });
    writeFileSync(join(outDir, oddName, 'metadata.json'), JSON.stringify({ name: 'odd', success: true, steps: [] }), 'utf-8');
    // metadata 里 finishedAt 是坏值 → 不能因此 NaN，应退回目录名/mtime
    const badTs = '坏时间-2026-07-17T03-00-00';
    mkdirSync(join(outDir, badTs), { recursive: true });
    writeFileSync(join(outDir, badTs, 'metadata.json'), JSON.stringify({ name: '坏时间', success: true, finishedAt: 'not-a-date', steps: [] }), 'utf-8');
    const runsList2 = (await (await fetch(base + '/api/runs')).json()) as Array<{ id: string; startedAt?: string }>;
    const odd = runsList2.find((r) => r.id === oddName);
    const bad = runsList2.find((r) => r.id === badTs);
    assert(!!odd && !Number.isNaN(Date.parse(odd.startedAt || '')), `无时间戳目录退回 mtime(实际 ${odd?.startedAt})`);
    assert(bad?.startedAt === '2026-07-17T03:00:00.000Z', `坏 finishedAt 退回目录名解析(实际 ${bad?.startedAt})`);

    // 目录名含中文/括号（run-role 的默认命名就长这样）→ 编码后仍能精确删掉
    const cjkRun = '专家咨询-人类学家（示范）-2026-07-18T05-00-00';
    mkdirSync(join(outDir, cjkRun), { recursive: true });
    writeFileSync(join(outDir, cjkRun, 'metadata.json'), JSON.stringify({ name: '专家咨询', success: true, steps: [] }), 'utf-8');
    assert((await delRun(cjkRun)).status === 200, 'DELETE /api/runs 中文+括号目录名 → 200');
    assert(!existsSync(join(outDir, cjkRun)), '中文目录名记录已删除');

    // 符号链接逃逸：ao-output 里挂一个指向外部目录的软链（外部目录里也有 metadata.json，
    // 看起来完全像一条运行记录）。删它只能删掉链接本身，绝不能顺着链接把外部目录清空。
    const precious = join(dataDir, 'precious-not-a-run');
    mkdirSync(precious, { recursive: true });
    writeFileSync(join(precious, 'metadata.json'), JSON.stringify({ name: 'trap', steps: [] }), 'utf-8');
    writeFileSync(join(precious, 'important.txt'), 'must survive', 'utf-8');
    symlinkSync(precious, join(outDir, 'looks-like-a-run'));
    await delRun('looks-like-a-run');
    assert(existsSync(join(precious, 'important.txt')), '软链指向的外部目录内容必须完好无损');
    assert(!existsSync(join(outDir, 'looks-like-a-run')) || existsSync(precious), '删除只作用于链接本身');

    // claude（直连 API）与 claude-code（订阅 CLI）共用 ANTHROPIC_BASE_URL 这一个变量名，
    // 但凭证完全不同。给 claude 配中转地址时若把它注入进程 env，会被所有 spawn 出的
    // 子进程继承 —— 用户只是配了直连 API，却把订阅制的 claude-code 一起改道到该端点，
    // 拿本机登录态去打必然 401。引擎侧不需要这个 env（base_url 走 --base-url 传参）。
    await fetch(base + '/api/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'claude', apiKey: 'sk-ant-x', baseUrl: 'https://relay.example.com/api/claudecode' }),
    });
    const afterClaude = (await (await fetch(base + '/api/config')).json()) as { providers: Record<string, { baseUrl?: string; supportsBaseUrl?: boolean }> };
    assert(afterClaude.providers.claude.baseUrl === 'https://relay.example.com/api/claudecode', 'claude 的中转地址已保存（供引擎用）');
    assert(!afterClaude.providers['claude-code'].baseUrl, `配 claude 不该污染 claude-code 的地址，实际 ${afterClaude.providers['claude-code'].baseUrl}`);
    assert(afterClaude.providers.claude.supportsBaseUrl === true, 'claude 仍开放自定义接入点（Anthropic 协议中转直连）');
    // 反过来：claude-code 自己配中转仍要照常注入（CLI 子进程靠 env 才能改道）
    await fetch(base + '/api/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'claude-code', apiKey: 'sk-cc-token', baseUrl: 'https://cc-relay.example.com' }),
    });
    const afterCC = (await (await fetch(base + '/api/config')).json()) as { providers: Record<string, { baseUrl?: string }> };
    assert(afterCC.providers['claude-code'].baseUrl === 'https://cc-relay.example.com', 'claude-code 自己配中转不受影响');
    assert(afterCC.providers.claude.baseUrl === 'https://relay.example.com/api/claudecode', '两者互不串台');
    // 清理，免得影响后面的用例
    for (const p2 of ['claude', 'claude-code']) {
      await fetch(base + '/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: p2, apiKey: '', baseUrl: '' }) });
    }

    // ── 我的角色（用户自建）POST/DELETE /api/roles/my ──
    assert(await post(base, '/api/roles/my', { name: '测试专家' }) === 400, 'POST /api/roles/my 缺 systemPrompt → 400');
    const createRes = await fetch(base + '/api/roles/my', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '测试专家', description: '一句话描述', systemPrompt: '你是一位测试专家。' }) });
    const created = await createRes.json();
    assert(createRes.status === 200 && created.role === `my/${created.id}`, `POST /api/roles/my → 200 创建(${created.role})`);
    const rolesWithMy = (await (await fetch(base + '/api/roles')).json()) as Array<{ id: string; category: string; custom?: boolean; name: string }>;
    const myRole = rolesWithMy.find((r) => r.category === 'my' && r.id === created.id);
    assert(!!myRole && myRole.custom === true && myRole.name === '测试专家', '/api/roles 列表含「我的」分类且带 custom 标记');
    const detail = await (await fetch(base + `/api/roles/my/${created.id}`)).json();
    assert(detail.content === '你是一位测试专家。', 'GET /api/roles/my/:id 返回 system prompt 正文');
    const upd = await fetch(base + `/api/roles/my/${created.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '测试专家改', systemPrompt: '你是改过的测试专家。' }) });
    assert(upd.status === 200 && (await upd.json()).name === '测试专家改', 'PUT /api/roles/my/:id → 200 编辑');
    const updDetail = await (await fetch(base + `/api/roles/my/${created.id}`)).json();
    assert(updDetail.name === '测试专家改' && updDetail.content === '你是改过的测试专家。' && updDetail.description === '一句话描述', 'PUT 字段级合并:改了名字与正文,没传的描述保留');
    assert((await fetch(base + '/api/roles/my/nope-xyz', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status === 404, 'PUT 不存在的角色 → 404');
    assert((await fetch(base + '/api/roles/my/..%2F..%2Fetc%2Fpasswd', { method: 'DELETE' })).status === 403, 'DELETE /api/roles/my 路径穿越 → 403');
    assert((await fetch(base + `/api/roles/my/${created.id}`, { method: 'DELETE' })).status === 200, 'DELETE /api/roles/my/:id → 200 删除');
    assert((await fetch(base + `/api/roles/my/${created.id}`, { method: 'DELETE' })).status === 404, 'DELETE 已删角色再删 → 404');

    // ── 多语言角色库(roleLibs / ?lang=<libId>) ──
    const cfgLibs = (await (await fetch(base + '/api/config')).json()).roleLibs as Array<{ id: string; label: string }>;
    assert(Array.isArray(cfgLibs) && cfgLibs.some((l) => l.id === 'zh') && cfgLibs.some((l) => l.id === 'en'), '/api/config roleLibs 至少含 zh/en');
    if (cfgLibs.some((l) => l.id === 'ko')) {
      const koRoles = (await (await fetch(base + '/api/roles?lang=ko')).json()) as Array<{ id: string; name: string }>;
      assert(koRoles.length > 100, `?lang=ko 返回语言包角色(${koRoles.length})`);
      assert(koRoles.some((r) => r.id === 'marketing-coupang-seller'), 'ko 库含韩国市场原创角色');
    }
    const fallback = (await (await fetch(base + '/api/roles?lang=hax')).json()) as unknown[];
    assert(Array.isArray(fallback) && fallback.length > 0, '未知 lang 回落 zh 而不是报错');

    // ── 嵌套子目录角色(递归枚举 + 带斜杠 id 的详情) ──
    const zhRoles = (await (await fetch(base + '/api/roles')).json()) as Array<{ id: string; category: string }>;
    const nested = zhRoles.find((r) => r.id.includes('/'));
    assert(!!nested, `角色列表含嵌套子目录角色(${zhRoles.length} 总数)`);
    if (nested) {
      const nd = await (await fetch(base + `/api/roles/${encodeURIComponent(nested.category)}/${encodeURIComponent(nested.id)}`)).json();
      assert(!!nd.content, '嵌套角色详情(带 %2F 的 id) → 200 + 正文');
    }

    // ── 报告导出 /api/export ──
    assert(await post(base, '/api/export', { format: 'docx' }) === 400, '/api/export 缺 markdown → 400');
    assert(await post(base, '/api/export', { markdown: '# x', format: 'rtf' }) === 400, '/api/export 非法格式 → 400');
    const expDocx = await fetch(base + '/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ markdown: '# 标题\n\n| a | b |\n|---|---|\n| 1 | 2 |\n', format: 'docx', name: '测试报告' }) });
    assert(expDocx.status === 200 && (expDocx.headers.get('content-type') || '').includes('wordprocessingml'), `/api/export docx → 200 + docx mime(${expDocx.status})`);
    const expSkill = await fetch(base + '/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ markdown: '# plan', format: 'skill', name: 's' }) });
    const skillText = await expSkill.text();
    assert(expSkill.status === 200 && skillText.startsWith('---\nname:'), '/api/export skill → 200 + frontmatter');
  }
} finally {
  if (server) server.kill('SIGTERM');
  rmSync(dataDir, { recursive: true, force: true });
}

// ── 体检卡不误报「被劫持」（回归）──────────────────────────────────────────────
// 只是在 AO 里存了个 claude-code 中转 key，applyKeys 就会把 ANTHROPIC_* 注入本进程 env。
// 曾经体检直接读 process.env → 系统 ~/.claude 明明干净也报 healthy:false（前端红灯 +
// "去 ~/.zshrc 删"），且点急救永远消不掉。现在体检用「applyKeys 之前」的 shell 快照。
// 独立起一个 server（预置 web-keys + 沙箱 AO_CLAUDE_DIR），不污染上面的主用例。
console.log('\n─── 体检卡：AO 自己的中转配置不应被当成劫持 ───');
const port2 = await freePort();
const dataDir2 = mkdtempSync(join(tmpdir(), 'ao-web-hijack-'));
const claudeDir2 = mkdtempSync(join(tmpdir(), 'ao-claude-hijack-'));
const base2 = `http://127.0.0.1:${port2}`;
let server2: ChildProcess | null = null;

try {
  mkdirSync(join(dataDir2, '.local'), { recursive: true });
  writeFileSync(
    join(dataDir2, '.local', 'web-keys.json'),
    JSON.stringify({ 'claude-code': { apiKey: 'sk-relay-test-123456', baseUrl: 'https://relay.example.com' } }),
    'utf-8',
  );
  // 干净的系统 ~/.claude：只有用户自己的设置，没有任何劫持键
  writeFileSync(join(claudeDir2, 'settings.json'), JSON.stringify({ theme: 'dark' }), 'utf-8');

  server2 = spawn(process.execPath, [resolve('web/server.js')], {
    env: { ...process.env, PORT: String(port2), HOST: '127.0.0.1', AO_NODE: process.execPath, AO_DATA_DIR: dataDir2, AO_CLAUDE_DIR: claudeDir2 },
    stdio: 'ignore',
  });
  let up2 = false;
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(base2 + '/api/health'); if (r.ok) { up2 = true; break; } } catch { /* not up yet */ }
    await sleep(250);
  }
  assert(up2, '第二实例启动');

  if (up2) {
    const h = await (await fetch(base2 + '/api/claude/health')).json();
    assert(h.healthy === true, '配了 AO 中转但系统 settings 干净 → healthy=true（不误报劫持）');
    assert(Object.keys(h.shellOverrides || {}).length === 0, '不把 AO 自注入的 ANTHROPIC_* 当成 shell 残留');
    assert(h.baseUrl === undefined, '不把 AO 自己的中转地址报成"被改道到"');

    // 真劫持仍要报出来：往沙箱 settings.json 里塞劫持键
    writeFileSync(join(claudeDir2, 'settings.json'), JSON.stringify({ theme: 'dark', env: { ANTHROPIC_BASE_URL: 'https://evil.example.com', ANTHROPIC_AUTH_TOKEN: 'sk-hijacked-abc' } }), 'utf-8');
    const h2 = await (await fetch(base2 + '/api/claude/health')).json();
    assert(h2.healthy === false, '真劫持（写进 settings.json）仍报 healthy=false');
    assert(h2.baseUrl === 'https://evil.example.com', '真劫持：报出被改道的端点');

    // 急救后必须回到绿灯，不能因 AO 自注入的 env 卡在红灯
    const rep = await (await fetch(base2 + '/api/claude/repair', { method: 'POST' })).json();
    assert(rep.changed === true, '急救：有改动');
    assert((rep.shellOverridesRemaining || []).length === 0, '急救后不再谎报 shell 层残留');
    assert(rep.health?.healthy === true, '急救后体检转绿（不会卡在红灯）');
    assert(JSON.parse(readFileSync(join(claudeDir2, 'settings.json'), 'utf-8')).theme === 'dark', '急救保留用户 theme');
  }
} finally {
  if (server2) server2.kill('SIGTERM');
  rmSync(dataDir2, { recursive: true, force: true });
  rmSync(claudeDir2, { recursive: true, force: true });
}

// ── 供应商地址容错：跳转保持 POST / 少写 /v1 / 保存时规整 / 半配置守卫 ─────────
// 真实故障：用户填的 base_url 与中转商最终地址差一跳，上游 301/302 后 fetch 把 POST
// 降级成 GET，中转回 405 Method Not Allowed。这里用假中转把整条链路钉死在 CI 里。
console.log('\n─── 供应商地址容错（405 / 跳转 / 规整）───');

const upstream = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => (b += d));
  req.on('end', () => {
    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }));
    }
    // FastAPI/Starlette 的标准回法，即用户截图里那条报文
    const known = req.url === '/v1/chat/completions';
    res.writeHead(known ? 405 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ detail: known ? 'Method Not Allowed' : 'Not Found' }));
  });
});
await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', () => r()));
const upPort = (upstream.address() as { port: number }).port;
// 只做跳转的前置地址：模拟 http→https / 带不带 www 这类"差一跳"的配置
const redirector = http.createServer((req, res) => {
  res.writeHead(302, { location: `http://127.0.0.1:${upPort}${req.url}` });
  res.end();
});
await new Promise<void>((r) => redirector.listen(0, '127.0.0.1', () => r()));
const redirPort = (redirector.address() as { port: number }).port;

// Anthropic 协议的假中转：只认 POST {base}/v1/messages + x-api-key（Claude Code 那条链路）
const anthropic = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => (b += d));
  req.on('end', () => {
    if (req.url === '/v1/messages' && req.method === 'POST' && req.headers['x-api-key']) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ content: [{ type: 'text', text: 'hi' }] }));
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'not found' } }));
  });
});
await new Promise<void>((r) => anthropic.listen(0, '127.0.0.1', () => r()));
const anthPort = (anthropic.address() as { port: number }).port;
const anthRedirector = http.createServer((req, res) => {
  res.writeHead(302, { location: `http://127.0.0.1:${anthPort}${req.url}` });
  res.end();
});
await new Promise<void>((r) => anthRedirector.listen(0, '127.0.0.1', () => r()));
const anthRedirPort = (anthRedirector.address() as { port: number }).port;

// 模型列表的假上游：/models 只挂在**站点根**，兼容层在 /api/claudecode 子路径下（cc-switch
// 的 KNOWN_COMPAT_SUFFIXES 覆盖的就是这种布局）。顺带回一份带 owned_by 的条目，用来验证
// 厂商分组走响应里的真值，以及占位值（api-transfer-server）被过滤掉。
const modelsSrv = http.createServer((req, res) => {
  if (req.url === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ object: 'list', data: [
      { id: 'gpt-5.6-sol', object: 'model', owned_by: 'OpenAI' },
      { id: 'claude-sonnet-5', object: 'model', owned_by: 'Anthropic' },
      { id: 'mystery-1', object: 'model', owned_by: 'api-transfer-server' },
    ] }));
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});
await new Promise<void>((r) => modelsSrv.listen(0, '127.0.0.1', () => r()));
const modelsPort = (modelsSrv.address() as { port: number }).port;

const port3 = await freePort();
const dataDir3 = mkdtempSync(join(tmpdir(), 'ao-web-endpoint-'));
const base3 = `http://127.0.0.1:${port3}`;
let server3: ChildProcess | null = null;
const postJson = async (path: string, body: unknown) => {
  const r = await fetch(base3 + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) as Record<string, unknown> };
};

try {
  server3 = spawn(process.execPath, [resolve('web/server.js')], {
    // 清单拉取指向死地址：离线/CI 下不等 3s 超时，也不受远程清单内容影响
    env: { ...process.env, PORT: String(port3), HOST: '127.0.0.1', AO_NODE: process.execPath, AO_DATA_DIR: dataDir3, AO_MANIFEST_URL: 'http://127.0.0.1:1/none.json' },
    stdio: 'ignore',
  });
  let up3 = false;
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(base3 + '/api/health'); if (r.ok) { up3 = true; break; } } catch { /* not up yet */ }
    await sleep(250);
  }
  assert(up3, '第三实例启动');

  if (up3) {
    // 1) 保存时规整：整条 curl 地址 + 引号 + 尾斜杠 + 空白，都该收成干净的 base
    await postJson('/api/custom-providers', {
      id: 'relaytest', name: 'Relay Test',
      baseUrl: `  http://127.0.0.1:${redirPort}/v1/chat/completions/  `,
      apiKey: 'sk-test', model: 'm',
    });
    const cfg3 = await (await fetch(base3 + '/api/config')).json();
    assert(cfg3.providers?.relaytest?.baseUrl === `http://127.0.0.1:${redirPort}/v1`,
      '新增供应商时地址被规整（去引号/尾斜杠/误贴的 chat/completions）');

    // 2) 编辑保存也规整，并把规整后的地址回给前端回填输入框
    const saved = await postJson('/api/config', { provider: 'relaytest', baseUrl: `http://127.0.0.1:${redirPort}/v1/chat/completions` });
    assert(saved.body.baseUrl === `http://127.0.0.1:${redirPort}/v1`, '保存接口回传规整后的地址（供前端回填）');

    // 3) 测试连接：地址被 302 跳转时不再 405，且提示用户把 base_url 改成最终地址
    const t1 = await postJson('/api/test-provider', { provider: 'relaytest' });
    assert(t1.body.ok === true, '被 302 跳转的地址：测试连接自愈成功（不再 405 Method Not Allowed）');
    assert(typeof t1.body.note === 'string' && (t1.body.note as string).includes(`127.0.0.1:${upPort}`),
      '测通但地址有漂移时，提示改成最终地址');

    // 4) 少写 /v1：自动补上重试
    const t2 = await postJson('/api/test-provider', { provider: 'relaytest', baseUrl: `http://127.0.0.1:${upPort}` });
    assert(t2.body.ok === true, 'base_url 少写 /v1：测试连接自动补上并连通');

    // 5) 两种拼法都不通：报错要说清打的哪个地址
    const t3 = await postJson('/api/test-provider', { provider: 'relaytest', baseUrl: `http://127.0.0.1:${upPort}/nope` });
    assert(t3.body.ok === false && String(t3.body.error).includes('请求地址: POST'), '彻底不通时报错带上实际请求地址');

    // 6) Claude Code 中转按 Anthropic 原生协议测（以前这条链路完全没有「测试连接」）
    const t4 = await postJson('/api/test-provider', { provider: 'claude-code', apiKey: 'sk-relay', baseUrl: `http://127.0.0.1:${anthPort}` });
    assert(t4.body.ok === true, 'Claude Code 中转：填根地址（不带 /v1）也能测通');
    const t5 = await postJson('/api/test-provider', { provider: 'claude-code', apiKey: 'sk-relay', baseUrl: `http://127.0.0.1:${anthRedirPort}/v1` });
    assert(t5.body.ok === true && String(t5.body.note || '').includes(`127.0.0.1:${anthPort}`),
      'Claude Code 中转：被 302 跳转时自愈并提示最终地址');
    const t6 = await postJson('/api/test-provider', { provider: 'claude-code', apiKey: 'sk-relay', baseUrl: `http://127.0.0.1:${anthPort}/wrong` });
    assert(t6.body.ok === false && String(t6.body.error).includes('请求地址: POST'), 'Claude Code 中转：地址不对时报出实际请求地址');

    // 7) 半配置守卫：只有 key、没有地址 → 走引导卡，不掉进连接器报晦涩错
    await postJson('/api/config', { provider: 'relaytest', baseUrl: '' });
    const comp = await postJson('/api/compose', { description: '测试', roles: [], provider: 'relaytest' });
    assert(comp.status === 400 && comp.body.code === 'no_credentials', '自定义供应商缺 base_url 时返回首跑引导而不是硬跑');
    // 该实例的清单地址是死链 → 引导横幅回退到引擎内置轮换池（不能因为拉不到清单就空掉）
    const fallbackSponsors = (comp.body.sponsors ?? []) as { name: string }[];
    assert(fallbackSponsors.length > 0, '清单拉不到时，引导横幅回退内置轮换池');
    assert(!fallbackSponsors.some((s) => /rootflow|ccsub/i.test(s.name)), '回退池里不含已下架赞助商');

    // 8) 获取模型列表：base 是 Anthropic 兼容子路径、而 /models 只在站点根 → 剥掉后缀再试
    const m1 = await postJson('/api/provider-models', { baseUrl: `http://127.0.0.1:${modelsPort}/api/claudecode`, apiKey: 'sk-test' });
    assert(m1.body.ok === true && Array.isArray(m1.body.models) && (m1.body.models as string[]).includes('gpt-5.6-sol'),
      '模型列表：兼容层挂子路径、/models 在站点根时也能拉到（对齐 cc-switch 的后缀剥离）');

    // 8.5) 坏 JSON / 超大 body：API 面永远只回 JSON，不能回 Express 的 HTML 错误页
    //      （前端拿到 HTML 再 res.json() 会抛一句毫不相干的解析错，用户根本不知道发生了什么）
    const badJson = await fetch(base3 + '/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{坏的' });
    const badTxt = await badJson.text();
    assert(badJson.status === 400 && badTxt.trim().startsWith('{') && JSON.parse(badTxt).error,
      `请求体不是合法 JSON 时回 JSON 错误而不是 HTML 错误页（实际 ${badJson.status}: ${badTxt.slice(0, 60)}）`);

    // 9) 厂商分组用响应里的 owned_by，占位值不算数（拿它当分组标题还不如按模型名猜）
    const m2 = await postJson('/api/provider-models', { baseUrl: `http://127.0.0.1:${modelsPort}/v1`, apiKey: 'sk-test' });
    const vendors = (m2.body.vendors ?? {}) as Record<string, string>;
    assert(vendors['gpt-5.6-sol'] === 'OpenAI' && vendors['claude-sonnet-5'] === 'Anthropic', '模型列表：透传 owned_by 作为厂商归属');
    assert(!('mystery-1' in vendors) && (m2.body.models as string[]).includes('mystery-1'),
      '占位厂商(api-transfer-server)被过滤，但模型本身照常列出');

    // 9.5) 文生图接口：baseUrl 覆盖打到假图片上游 → data URL；缺模型 → 400 且说人话
    let lastImgBody = '';
    const imgUp = http.createServer((req2, res2) => {
      let bb = ''; req2.on('data', (d) => (bb += d));
      req2.on('end', () => {
        lastImgBody = bb;
        if (/images\/generations/.test(String(req2.url))) {
          res2.writeHead(200, { 'Content-Type': 'application/json' });
          return res2.end(JSON.stringify({ data: [{ b64_json: 'aGVsbG8=' }] }));
        }
        res2.writeHead(404, { 'Content-Type': 'application/json' });
        res2.end('{"error":"nope"}');
      });
    });
    await new Promise<void>((r) => imgUp.listen(0, '127.0.0.1', () => r()));
    const imgPort = (imgUp.address() as { port: number }).port;
    const g1 = await postJson('/api/image/generate', { provider: 'relaytest', model: 'img-m', prompt: '画一只猫', baseUrl: `http://127.0.0.1:${imgPort}/v1`, apiKey: 'sk-x' });
    assert(g1.status === 200 && String(g1.body.dataUrl).startsWith('data:image/png;base64,'), `出图应回 data URL(实际 ${g1.status} ${JSON.stringify(g1.body).slice(0, 80)})`);
    const g2 = await postJson('/api/image/generate', { provider: 'relaytest', prompt: '画一只猫' });
    assert(g2.status === 400 && /图片模型/.test(String(g2.body.error)), `缺模型应 400 并说清(实际 ${g2.status} ${g2.body.error})`);
    const g3 = await postJson('/api/image/generate', { provider: 'relaytest', model: 'm' });
    assert(g3.status === 400 && /提示词/.test(String(g3.body.error)), '缺提示词应 400');
    // 尺寸原样透传（界面上选了 1536x1024 却按默认出图 = 静默不生效，最难自证的一类）
    const g4 = await postJson('/api/image/generate', { provider: 'relaytest', model: 'img-m', prompt: '画一只猫', size: '1536x1024', baseUrl: `http://127.0.0.1:${imgPort}/v1`, apiKey: 'sk-x' });
    assert(g4.status === 200 && /"size":"1536x1024"/.test(lastImgBody), `size 应原样到达上游(实际 body: ${lastImgBody.slice(0, 80)})`);
    // Anthropic 原生协议压根没有图片端点 —— 必须当场说清，而不是让它去打 api.anthropic.com
    // 两次 404 后甩一句 404 正文（claude 有 base_url，不会掉进"没有端点"那条分支）
    const g5 = await postJson('/api/image/generate', { provider: 'claude', model: 'img-m', prompt: '画一只猫', apiKey: 'sk-x' });
    assert(g5.status === 400 && /没有图片生成端点/.test(String(g5.body.error)), `claude 出图应当场说清(实际 ${g5.status} ${String(g5.body.error).slice(0, 80)})`);
    // 前端下拉的候选来自后端（引擎口径）：CLI 与 Anthropic 协议不在列，OpenAI 兼容的在
    const cfgImg = (await (await fetch(base3 + '/api/config')).json()) as { imageProviders?: string[] };
    const imgList = cfgImg.imageProviders ?? [];
    assert(imgList.includes('openai') && imgList.includes('relaytest'), `能出图的供应商应在列(实际 ${imgList.slice(0, 6).join(',')})`);
    assert(!imgList.some((id) => id === 'claude' || id === 'aicodemirror' || id.endsWith('-cli')),
      `CLI 与 Anthropic 协议不该进文生图下拉(实际 ${imgList.join(',')})`);
    imgUp.close();

    // 10) 工作流写得不对（这里：一个 steps 为空的 YAML）→ compare 该回 4xx 并说清楚，
    //     而不是 500 让人以为引擎坏了。真实触发点：自动组队产物偶尔缺 llm/steps。
    const badWf = join(dataDir3, 'ao-workflows', 'bad.yaml');
    mkdirSync(join(dataDir3, 'ao-workflows'), { recursive: true });
    writeFileSync(badWf, 'name: "坏工作流"\nsteps: []\n', 'utf-8');
    const cmpBad = await postJson('/api/compare', { file: badWf, inputs: {}, provider: 'relaytest' });
    assert(cmpBad.status >= 400 && cmpBad.status < 500, `工作流本身不合法时 compare 回 4xx（实际 ${cmpBad.status}）`);
    assert(typeof cmpBad.body.error === 'string' && (cmpBad.body.error as string).length > 0, 'compare 的报错要说清哪里不对');
  }
} finally {
  if (server3) server3.kill('SIGTERM');
  upstream.close(); redirector.close(); anthropic.close(); anthRedirector.close(); modelsSrv.close();
  rmSync(dataDir3, { recursive: true, force: true });
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
