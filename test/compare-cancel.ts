/**
 * 「vs 单次基线」的协作式取消。
 *
 * 对比是三段、每段都真花钱：跑多智能体工作流 → 跑单次基线 → 盲评。用户刷新页面 / 关标签时
 * HTTP 连接断开，但这一段是**在引擎进程内**跑的（不像 /api/run 是 spawn 出来的子进程），杀不掉——
 * 能做的是在段与段之间问一句「调用方还在吗」，把还没开始的两段省掉。
 *
 * 这里钉两头，缺一不可：
 *   ① 断开了 → 后两段真的不跑（省钱），已跑完的那段照常返回、照常存档（钱已经花了，产物别丢）；
 *   ② **没断开 → 三段都要跑完**。这条更要紧：`req.on('close')` 在 Node 里的触发时机很讲究，
 *      要是请求体读完就触发，对比会永远只跑第一段、永远没有结论，而且没人会立刻发现。
 */
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { compareWorkflowVsBaseline } from '../src/index.js';

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

const root = mkdtempSync(join(tmpdir(), 'ao-cmp-cancel-'));
/** 假上游：只数调用次数——按正文猜"这是哪一段"很不可靠（盲评是双向的、提示词也会变），
 *  而这里真正要钉的是「取消后还发不发请求」。 */
const seen: string[] = [];
const upstream = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => { b += d; });
  req.on('end', () => {
    const body = b;
    seen.push(body.length > 0 ? 'call' : 'call');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      // 回包同时满足两种消费方：盲评要 scoreA/scoreB（core/compare.ts 的 parseJudge），
      // 普通步骤只要有正文就行——一份能被两边接受的内容，省得按提示词猜"这是哪一段"
      choices: [{ message: { role: 'assistant', content: '{"scoreA": 8, "scoreB": 6, "reason": "A 更完整"}\n正文' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
  });
});
await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', () => r()));
const upPort = (upstream.address() as { port: number }).port;

const wf = join(root, 'w.yaml');
writeFileSync(wf, [
  'name: "对比取消"', `agents_dir: "${resolve('node_modules/agency-agents-zh')}"`, 'verify: false',
  'llm:', '  provider: "deepseek"', '  model: "m"', `  base_url: "http://127.0.0.1:${upPort}/v1"`, '  api_key: "k"',
  'steps:', '  - id: only', '    role: "marketing/marketing-content-creator"', '    task: "写一句"', '    output: out', '',
].join('\n'), 'utf-8');

let server: ChildProcess | null = null;
try {
  console.log('\n─── 调用方断开：后两段不跑，第一段的产物照常返回 ───');
  {
    seen.length = 0;
    const r = await compareWorkflowVsBaseline(wf, {}, { quiet: true, outputDir: join(root, 'out1'), shouldContinue: () => false });
    assert(seen.length === 1, `只发了工作流那一段的 1 次调用，基线与盲评一次都没发（实际 ${seen.length} 次）`);
    assert(!!r.multiOutput && r.baselineOutput === '' && r.verdict === null, '返回已跑完的产物，verdict 为 null（不假装有结论）');
    assert(r.result.steps[0]?.status === 'completed', '这一轮照常存档');
  }

  console.log('\n─── 调用方还在：三段都要跑完（req.on("close") 不能提前触发） ───');
  {
    seen.length = 0;
    const r = await compareWorkflowVsBaseline(wf, {}, { quiet: true, outputDir: join(root, 'out2'), shouldContinue: () => true });
    assert(seen.length > 1, `后两段真的跑了（实际 ${seen.length} 次调用）`);
    assert(!!r.baselineOutput && !!r.verdict, '有基线产出、有结论');
  }

  console.log('\n─── 真服务端：客户端等着的时候，/api/compare 必须给出结论 ───');
  {
    const port = await freePort();
    const dataDir = join(root, 'data');
    mkdirSync(join(dataDir, 'ao-workflows'), { recursive: true });
    const wf2 = join(dataDir, 'ao-workflows', 'cmp.yaml');
    writeFileSync(wf2, [
      'name: "对比取消2"', `agents_dir: "${resolve('node_modules/agency-agents-zh')}"`, 'verify: false',
      'llm:', '  provider: "deepseek"', '  model: "m"', `  base_url: "http://127.0.0.1:${upPort}/v1"`, '  api_key: "k"',
      'steps:', '  - id: only', '    role: "marketing/marketing-content-creator"', '    task: "写一句"', '    output: out', '',
    ].join('\n'), 'utf-8');
    server = spawn(process.execPath, [resolve('web/server.js')], {
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', AO_NODE: process.execPath, AO_DATA_DIR: dataDir, DEEPSEEK_API_KEY: 'k', AO_MANIFEST_URL: 'http://127.0.0.1:1/none.json' },
      stdio: 'ignore',
    });
    const base = `http://127.0.0.1:${port}`;
    let up = false;
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(base + '/api/health')).ok) { up = true; break; } } catch { /* not up */ }
      await sleep(250);
    }
    assert(up, '服务启动');
    if (up) {
      seen.length = 0;
      // 注册一个指向假上游的自定义供应商，并显式用它——不传 provider 的话服务端会用默认供应商（没 key）
      await fetch(base + '/api/custom-providers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'cmptest', name: 'Compare Test', baseUrl: `http://127.0.0.1:${upPort}/v1`, apiKey: 'k', model: 'm' }),
      });
      seen.length = 0;
      const res = await fetch(base + '/api/compare', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: wf2, inputs: {}, provider: 'cmptest' }),
      });
      const body = await res.json() as { verdict?: unknown; baselineOutput?: string; error?: string };
      assert(res.status === 200, `200（实际 ${res.status}：${JSON.stringify(body).slice(0, 120)}）`);
      assert(seen.length > 1, `后两段跑了——req.on("close") 没有在请求体读完时就提前触发（实际 ${seen.length} 次调用）`);
      assert(!!body.verdict && !!body.baselineOutput, '返回了基线产出与结论');
    }
  }
} catch (e) {
  assert(false, `异常: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  try { server?.kill(); } catch { /* gone */ }
  upstream.close(); upstream.closeAllConnections?.();
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed > 0 ? 1 : 0);
