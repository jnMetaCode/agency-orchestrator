/**
 * web/server.js 冒烟测试：启真实服务，验证关键端点路由 + 安全守卫(路径穿越/越权)。
 * 不需要 LLM——只打不依赖模型的端点。server.js 不在 tsc/其余测试覆盖内，这是它唯一的自动化网。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

    // 6) 半配置守卫：只有 key、没有地址 → 走引导卡，不掉进连接器报晦涩错
    await postJson('/api/config', { provider: 'relaytest', baseUrl: '' });
    const comp = await postJson('/api/compose', { description: '测试', roles: [], provider: 'relaytest' });
    assert(comp.status === 400 && comp.body.code === 'no_credentials', '自定义供应商缺 base_url 时返回首跑引导而不是硬跑');
  }
} finally {
  if (server3) server3.kill('SIGTERM');
  upstream.close(); redirector.close();
  rmSync(dataDir3, { recursive: true, force: true });
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
