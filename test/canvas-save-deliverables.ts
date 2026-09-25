/**
 * 画布保存：删掉的步骤正好是声明的交付物时，别把用户堵死在画布里。
 *
 * 形态：模板顶层写了 `deliverables: [polish]`，用户在画布里把 polish 删掉再保存 ——
 * 校验器报「顶层 deliverables 引用不存在的 step」，保存被拒。而**画布里根本没有编辑
 * deliverables 的入口**（WorkflowCanvas.tsx 里一次都没出现这个字段），于是用户在画布里
 * 怎么改都救不回来，只能去手改 YAML；而画布正是给不想碰 YAML 的人用的。
 *
 * 处理：把指向已不存在步骤的交付物摘掉（全摘光就连键一起删，回到默认口径「最后一个完成的步骤」），
 * 并在响应里说清摘了哪些 —— 不闷着改用户的文件。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise<number>((res) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); });
});

const root = mkdtempSync(join(tmpdir(), 'ao-canvas-deliv-'));
const dataDir = join(root, 'data');
const wfDir = join(dataDir, 'ao-workflows');
mkdirSync(wfDir, { recursive: true });
const wfPath = join(wfDir, 'demo.yaml');
writeFileSync(wfPath, [
  'name: "画布交付物"',
  `agents_dir: "${resolve('node_modules/agency-agents-zh')}"`,
  'llm: { provider: "deepseek", model: "m" }',
  'deliverables: [polish]',
  'steps:',
  '  - id: draft',
  '    role: "marketing/marketing-content-creator"',
  '    task: "写初稿"',
  '    output: draft_out',
  '  - id: polish',
  '    role: "marketing/marketing-content-creator"',
  '    task: "润色 {{draft_out}}"',
  '    output: polished',
  '    depends_on: [draft]',
  '',
].join('\n'), 'utf-8');

let server: ChildProcess | null = null;
try {
  console.log('\n─── 画布删掉交付物那一步之后还能不能存 ───');
  const port = await freePort();
  server = spawn(process.execPath, [resolve('web/server.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', AO_DATA_DIR: dataDir, AO_NO_UPDATE_CHECK: '1', AO_MANIFEST_URL: 'http://127.0.0.1:1/none.json' },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base + '/api/health')).ok) { up = true; break; } } catch { /* not up yet */ }
    await sleep(250);
  }
  assert(up, '服务启动');

  if (up) {
    const graph = await (await fetch(`${base}/api/workflows/graph?file=${encodeURIComponent(wfPath)}`)).json() as {
      nodes: { id: string }[]; edges: { source: string; target: string }[];
    };
    assert(graph.nodes.length === 2, `画布拿到 2 个节点（实际 ${graph.nodes.length}）`);

    // 用户在画布里删掉 polish —— 它正是声明的交付物
    const nodes = graph.nodes.filter((n) => n.id !== 'polish');
    const edges = graph.edges.filter((e) => e.source !== 'polish' && e.target !== 'polish');
    const res = await fetch(`${base}/api/workflows/graph`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: wfPath, name: '画布交付物', nodes, edges }),
    });
    const body = await res.json() as { droppedDeliverables?: string[]; errors?: string[] };
    assert(res.status === 200, `能存下来，不是 400 把人堵死（实际 ${res.status}：${JSON.stringify(body).slice(0, 120)}）`);
    assert(body.droppedDeliverables?.includes('polish') === true, `告诉用户摘掉了哪个交付物（实际 ${JSON.stringify(body.droppedDeliverables)}）`);

    const saved = readFileSync(wfPath, 'utf-8');
    assert(!/deliverables/.test(saved), '落盘的 YAML 里不再有指向已删步骤的 deliverables');
    assert(/id: draft/.test(saved) && !/id: polish/.test(saved), '步骤本身按画布的结果保存');

    // 交付物还在时，一个字都不许动
    writeFileSync(wfPath, readFileSync(wfPath, 'utf-8').replace('steps:', 'deliverables: [draft]\nsteps:'), 'utf-8');
    const graph2 = await (await fetch(`${base}/api/workflows/graph?file=${encodeURIComponent(wfPath)}`)).json() as {
      nodes: { id: string }[]; edges: { source: string; target: string }[];
    };
    const res2 = await fetch(`${base}/api/workflows/graph`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: wfPath, name: '画布交付物', nodes: graph2.nodes, edges: graph2.edges }),
    });
    const body2 = await res2.json() as { droppedDeliverables?: string[] };
    assert(res2.status === 200 && body2.droppedDeliverables === undefined, '交付物没被删时不报摘除');
    assert(/deliverables:\s*\n?\s*-?\s*draft|deliverables: \[draft\]/.test(readFileSync(wfPath, 'utf-8')), '原样保留 deliverables');
  }
} catch (e) {
  assert(false, `异常: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  try { server?.kill(); } catch { /* 已经没了 */ }
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed > 0 ? 1 : 0);
