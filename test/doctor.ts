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

// Anthropic 原生协议的假上游：只认 POST <base>/v1/messages（SDK 与探测都往这拼），
// 模拟中转商"端点在子路径下"的真实形状（如 AICodeMirror 的 /api/claudecode）
const anthropic = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => (b += d));
  req.on('end', () => {
    if (req.url === '/api/claudecode/v1/messages' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5',
        content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 },
      }));
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
});
await new Promise<void>((r) => anthropic.listen(0, '127.0.0.1', () => r()));
const anthPort = (anthropic.address() as { port: number }).port;

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

  // 6) claude 走原生 SDK、不在 API_PROVIDERS 表里，以前 doctor 探不到它。现在 claude
  //    支持自定义 base_url 直连 Anthropic 协议中转商，"地址配错"正是这批用户最常踩的坑，
  //    必须能体检到 —— 否则等于给了新能力却没给诊断。
  const anthropicOk = await doctor({
    AO_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'k',
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${anthPort}/api/claudecode`,
  });
  assert(/端点可达/.test(anthropicOk), 'claude 配了中转地址：能探测并报可达');
  assert(/Anthropic 协议中转/.test(anthropicOk), '认出这是中转而非官方端点');

  // 中转商的 Anthropic 端点常带子路径，只填域名是最典型的配错
  const anthropicBad = await doctor({
    AO_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'k',
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${anthPort}`,
  });
  assert(/端点不通/.test(anthropicBad), 'claude 中转地址写错：报不通');
  assert(/子路径/.test(anthropicBad), '给出「端点常带子路径，别只填域名」的具体指引');

  // 地址正确时不能报"不一致"：Anthropic 客户端自己接 /v1/messages，探测首选路径必须
  // 与之一致，否则正确配置反而先 404 再兜底命中，还会建议用户把 base 改成
  // .../v1/messages —— 照做后客户端再接一次，直接连不上
  assert(!/地址与配置不一致/.test(anthropicOk), '地址正确：不误报地址漂移（探测路径与真实客户端一致）');

  // 反过来，地址里多写了 /v1 要提醒：AO 这边削掉后能跑，但 claude CLI 直读该地址会拼错
  const anthropicExtraV1 = await doctor({
    AO_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'k',
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${anthPort}/api/claudecode/v1`,
  });
  assert(/端点可达/.test(anthropicExtraV1), '多写 /v1：AO 侧仍能连通（自动削掉）');
  assert(/多写了 \/v1/.test(anthropicExtraV1), '多写 /v1：明确提醒（claude CLI 直读会拼成 /v1/v1/messages）');
  assert(/建议改成/.test(anthropicExtraV1), '给出改成什么的具体地址');

  // 没配 key 时不该乱发请求
  const anthropicNoKey = await doctor({ AO_PROVIDER: 'claude' });
  assert(!/端点可达|端点不通/.test(anthropicNoKey), 'claude 没 key：不做探测');
} finally {
  anthropic.close();
  upstream.close(); redirector.close();
  rmSync(dataDir, { recursive: true, force: true });
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
