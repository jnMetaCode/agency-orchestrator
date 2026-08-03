/**
 * ao doctor 自检输出：端点连通性探测 + Studio 存的 key 的可见性。
 *
 * 覆盖两类真实困惑：
 *  1. 地址配错（少写 /v1、被 301 跳转降级）光看配置看不出来，只有真发一次请求才知道；
 *  2. Studio（网页/桌面版）里配的 key 只注入 Studio 进程，命令行读不到 ——
 *     不讲清楚就会出现「界面能跑、命令行说没配 key」的迷惑现场。
 */
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const pexec = promisify(execFile);
let passed = 0, failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; }
}

console.log('\n─── ao doctor（端点探测 / Studio key 可见性）───');

// 只认 POST /v1/chat/completions 的假上游；其余按 FastAPI 风格回 405/404
const upstream = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => (b += d));
  req.on('end', () => {
    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }));
    }
    const known = req.url === '/v1/chat/completions';
    res.writeHead(known ? 405 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ detail: known ? 'Method Not Allowed' : 'Not Found' }));
  });
});
await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', () => r()));
const upPort = (upstream.address() as { port: number }).port;
// 配置地址与真实地址差一跳：修复前 fetch 会把 POST 降级成 GET → 405
const redirector = http.createServer((req, res) => {
  res.writeHead(302, { location: `http://127.0.0.1:${upPort}${req.url}` });
  res.end();
});
await new Promise<void>((r) => redirector.listen(0, '127.0.0.1', () => r()));
const redirPort = (redirector.address() as { port: number }).port;

const dataDir = mkdtempSync(join(tmpdir(), 'ao-doctor-'));
const CLI = resolve('dist/cli.js');
// 干净环境：不继承本机可能存在的 key/中转配置，否则断言会被外部环境带偏
const baseEnv: NodeJS.ProcessEnv = {
  PATH: process.env.PATH, HOME: process.env.HOME, AO_PROVIDER: 'deepseek',
  AO_DATA_DIR: dataDir, AO_SKIP_UPDATE_CHECK: '1',
};
const doctor = async (env: NodeJS.ProcessEnv): Promise<string> => {
  try {
    const { stdout } = await pexec(process.execPath, [CLI, 'doctor'], { env: { ...baseEnv, ...env }, maxBuffer: 4 * 1024 * 1024 });
    return stdout;
  } catch (e) {
    return String((e as { stdout?: string }).stdout ?? (e as Error).message);
  }
};

try {
  // 1) env 里有 key + 地址正确 → 报可达
  const ok = await doctor({ DEEPSEEK_API_KEY: 'k', DEEPSEEK_BASE_URL: `http://127.0.0.1:${upPort}/v1` });
  assert(/端点可达/.test(ok), '地址正确：报「端点可达」');

  // 2) 地址差一跳（302）→ 自愈跑通，但要提示改配置（别的工具没有这层兜底）
  const drift = await doctor({ DEEPSEEK_API_KEY: 'k', DEEPSEEK_BASE_URL: `http://127.0.0.1:${redirPort}/v1` });
  assert(/端点可达/.test(drift), '被 302 跳转：仍然连通（不再 405 Method Not Allowed）');
  assert(/地址与配置不一致/.test(drift), '被 302 跳转：提示地址漂移，建议改成最终地址');

  // 3) 地址写错 → 报不通，并给出实际请求地址
  const bad = await doctor({ DEEPSEEK_API_KEY: 'k', DEEPSEEK_BASE_URL: `http://127.0.0.1:${upPort}/nope` });
  assert(/端点不通/.test(bad) && /请求地址: POST/.test(bad), '地址写错：报不通并带上实际请求地址');

  // 4) --no-probe：不发请求
  const skipped = await doctor({ DEEPSEEK_API_KEY: 'k', DEEPSEEK_BASE_URL: `http://127.0.0.1:${upPort}/nope`, AO_DOCTOR_ARGS: '' });
  assert(/端点不通/.test(skipped), '（对照）默认会探测');
  const noProbe = await (async () => {
    try {
      const { stdout } = await pexec(process.execPath, [CLI, 'doctor', '--no-probe'], {
        env: { ...baseEnv, DEEPSEEK_API_KEY: 'k', DEEPSEEK_BASE_URL: `http://127.0.0.1:${upPort}/nope` }, maxBuffer: 4 * 1024 * 1024,
      });
      return stdout;
    } catch (e) { return String((e as { stdout?: string }).stdout ?? ''); }
  })();
  assert(!/端点不通|端点可达/.test(noProbe), '--no-probe：完全不发请求');

  // 5) key 只存在 Studio 里：doctor 要看得见，并说清命令行读不到
  mkdirSync(join(dataDir, '.local'), { recursive: true });
  writeFileSync(
    join(dataDir, '.local', 'web-keys.json'),
    JSON.stringify({ deepseek: { apiKey: 'sk-studio', baseUrl: `http://127.0.0.1:${upPort}/v1`, model: 'deepseek-chat' } }),
    'utf-8',
  );
  const studio = await doctor({});
  assert(/Studio 里已配 key：deepseek/.test(studio), 'Studio 里配的 key 被 doctor 看见');
  assert(/命令行不会读/.test(studio), '说清 Studio 的 key 命令行读不到（界面能跑≠命令行能跑）');
  assert(/端点可达/.test(studio), '用 Studio 保存的配置也能完成端点探测');
} finally {
  upstream.close(); redirector.close();
  rmSync(dataDir, { recursive: true, force: true });
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
