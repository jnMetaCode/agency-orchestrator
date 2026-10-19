/**
 * 视频任务续跑：建好的任务记进存档，续跑时请求一致就接着查、不重新下单。
 * 以前中断或超时后续跑，一律重新建任务——按秒计费，等于同一条片子付两次钱。
 * 假服务商走 OpenAI Videos 形状（POST /videos → GET /videos/{id} → /content），统计建了几次任务。
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateVideo } from '../src/connectors/video.js';
import { run } from '../src/index.js';
import type { LLMConfig } from '../src/types.js';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.log(`  ❌ ${name}: ${e instanceof Error ? e.message : e}`); failed++; }
}
function assert(c: boolean, m: string): void { if (!c) throw new Error(m); }
const MP4 = Buffer.from('0000001c667479706d70343200000000', 'hex');

/** status: running 一直在跑；done 查一次就完成；failed 厂商报失败。不在表里的 id → 404 */
function fakeVendor() {
  const tasks = new Map<string, { status: 'running' | 'done' | 'failed'; prompt: string }>();
  const state = { creates: 0, prompts: [] as string[], next: 'done' as 'running' | 'done' | 'failed', tasks };
  const srv = http.createServer((req, res) => {
    const url = req.url || '';
    if (req.method === 'POST' && url === '/v1/videos') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        state.creates++;
        const prompt = JSON.parse(body).prompt as string;
        state.prompts.push(prompt);
        const id = `vid_${state.creates}`;
        tasks.set(id, { status: state.next, prompt });
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id, status: 'queued' }));
      });
      return;
    }
    const m = /^\/v1\/videos\/([\w-]+)(\/content)?$/.exec(url);
    const task = m && tasks.get(m[1]);
    if (!task) { res.writeHead(404).end('{"error":{"message":"not found"}}'); return; }
    if (m![2]) { res.writeHead(200, { 'Content-Type': 'video/mp4' }).end(MP4); return; }
    const status = task.status === 'done' ? 'completed' : task.status === 'failed' ? 'failed' : 'in_progress';
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
      id: m![1], status, ...(task.status === 'failed' ? { error: { message: 'content policy' } } : {}),
    }));
  });
  return { srv, state };
}
async function listen(srv: http.Server): Promise<number> {
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  return (srv.address() as { port: number }).port;
}
const silent = () => {};

console.log('\n=== 视频任务续跑：不重新下单 ===');
const { srv, state } = fakeVendor();
const port = await listen(srv);
const cfg = { provider: 'deepseek', api_key: 'sk-test', base_url: `http://127.0.0.1:${port}/v1` } as unknown as LLMConfig;
const opts = { model: 'sora-2', poll_interval: 10 };

try {
  await test('接续还活着的任务：不建新任务，直接查到成品', async () => {
    state.tasks.set('vid_old', { status: 'done', prompt: '猫' });
    const before = state.creates;
    let tracked = '';
    const v = await generateVideo(cfg, '猫', opts, silent, { resumeTaskId: 'vid_old', onTask: (id) => { tracked = id; } });
    assert(state.creates === before, `不应再建任务，实际多建了 ${state.creates - before} 条`);
    assert(v.taskId === 'vid_old' && tracked === 'vid_old' && v.buffer.equals(MP4), '应拿到旧任务的成品并回报任务 id');
  });

  await test('旧任务已查不到（404）：说明后按新任务下单', async () => {
    const before = state.creates;
    const notes: string[] = [];
    const v = await generateVideo(cfg, '猫', opts, (m) => notes.push(m), { resumeTaskId: 'vid_gone' });
    assert(state.creates === before + 1 && v.taskId !== 'vid_gone', '应建一条新任务');
    assert(notes.some((n) => /vid_gone.*已不可用.*HTTP 404/.test(n)), `应说明旧任务不可用，实际：${notes.join(' | ')}`);
  });

  await test('旧任务厂商已报失败：按新任务下单', async () => {
    state.tasks.set('vid_bad', { status: 'failed', prompt: '猫' });
    const before = state.creates;
    await generateVideo(cfg, '猫', opts, silent, { resumeTaskId: 'vid_bad' });
    assert(state.creates === before + 1, '应建一条新任务');
  });

  await test('超时：错误标记为「任务可能还活着」；厂商明确失败则不标', async () => {
    state.next = 'running';
    let tracked = '';
    let timeoutErr: unknown;
    try { await generateVideo(cfg, '狗', { ...opts, timeout: 150 }, silent, { onTask: (id) => { tracked = id; } }); }
    catch (e) { timeoutErr = e; }
    assert(!!tracked, '建任务时应立即回报任务 id（中断存档靠它）');
    assert((timeoutErr as { videoTaskAlive?: boolean })?.videoTaskAlive === true && /--resume/.test(String(timeoutErr)), '超时错误应标记仍活着并提示可续跑');
    state.next = 'failed';
    let failErr: unknown;
    try { await generateVideo(cfg, '狗', opts, silent); } catch (e) { failErr = e; }
    assert(/视频生成失败/.test(String(failErr)) && !(failErr as { videoTaskAlive?: boolean }).videoTaskAlive, '厂商报失败不应标记为可接续');
    state.next = 'done';
  });

  await test('端到端：超时的运行存档记下任务，续跑接着查、全程只付一次钱', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ao-video-resume-'));
    const out = join(dir, 'out');
    const wf = (prompt: string) => {
      const f = join(dir, `wf-${prompt}.yaml`);
      writeFileSync(f, `name: video resume
llm:
  provider: deepseek
  base_url: http://127.0.0.1:${port}/v1
steps:
  - id: clip
    type: video
    task: "${prompt}"
    video:
      model: sora-2
      poll_interval: 10
      timeout: 200
    output: clip_mp4
`);
      return f;
    };
    const prevKey = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    try {
      state.next = 'running';
      const before = state.creates;
      const first = await run(wf('海边日落'), {}, { outputDir: out, quiet: true });
      const runDir = join(out, readdirSync(out)[0]);
      const meta = JSON.parse(readFileSync(join(runDir, 'metadata.json'), 'utf-8'));
      const step = meta.steps.find((s: { id: string }) => s.id === 'clip');
      assert(!first.success && step.status === 'failed' && step.pendingVideoTask?.taskId === `vid_${before + 1}`,
        `超时后存档应记下任务，实际：${JSON.stringify(step)}`);

      state.tasks.get(`vid_${before + 1}`)!.status = 'done';   // 服务商那边后来出完了
      const second = await run(wf('海边日落'), {}, { outputDir: out, quiet: true, resumeDir: runDir });
      assert(second.success && state.creates === before + 1, `续跑应接着查旧任务、不再建新任务（共建 ${state.creates - before} 条）`);

      // 改了提示词：旧任务出的不是这条片子，必须按新任务下单
      state.next = 'running';
      const third = await run(wf('雪山日出'), {}, { outputDir: join(dir, 'out2'), quiet: true });
      const runDir3 = join(dir, 'out2', readdirSync(join(dir, 'out2'))[0]);
      assert(!third.success, '第三次应超时');
      state.next = 'done';
      const createsBefore = state.creates;
      const fourth = await run(wf('雪山日出，换个机位'), {}, { outputDir: join(dir, 'out2'), quiet: true, resumeDir: runDir3 });
      assert(fourth.success && state.creates === createsBefore + 1 && state.prompts.at(-1) === '雪山日出，换个机位',
        '提示词改了：应建一条新任务，用新提示词');
    } finally {
      if (prevKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = prevKey;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('端到端：进程被中断（SIGTERM）时存档记下任务，续跑接着查', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ao-video-sigterm-'));
    const out = join(dir, 'out');
    const f = join(dir, 'wf.yaml');
    writeFileSync(f, `name: video sigterm
llm:
  provider: deepseek
  base_url: http://127.0.0.1:${port}/v1
steps:
  - id: clip
    type: video
    task: "城市夜景"
    video:
      model: sora-2
      poll_interval: 50
      timeout: 60000
    output: clip_mp4
`);
    state.next = 'running';
    const before = state.creates;
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'run', f, '--output', out], {
      env: { ...process.env, DEEPSEEK_API_KEY: 'sk-test', FORCE_COLOR: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    child.stdout.on('data', (c) => { log += c; });
    child.stderr.on('data', (c) => { log += c; });
    const exited = new Promise<number | null>((r) => child.on('exit', (code) => r(code)));
    const start = Date.now();
    while (state.creates === before && Date.now() - start < 20000) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 200));
    child.kill('SIGTERM');
    await exited;
    try {
      const runDir = join(out, readdirSync(out)[0]);
      const step = JSON.parse(readFileSync(join(runDir, 'metadata.json'), 'utf-8')).steps.find((s: { id: string }) => s.id === 'clip');
      assert(step.pendingVideoTask?.taskId === `vid_${before + 1}`, `中断存档应记下任务，实际：${JSON.stringify(step)}\n${log.slice(-400)}`);
      assert(/续跑（--resume）时会接着查/.test(log), '中断提示应告诉用户续跑会接着查');
      state.tasks.get(`vid_${before + 1}`)!.status = 'done';
      state.next = 'done';
      const prevKey = process.env.DEEPSEEK_API_KEY;
      process.env.DEEPSEEK_API_KEY = 'sk-test';
      try {
        const resumed = await run(f, {}, { outputDir: out, quiet: true, resumeDir: runDir });
        assert(resumed.success && state.creates === before + 1, `续跑应接着查、不再建任务（共建 ${state.creates - before} 条）`);
      } finally {
        if (prevKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = prevKey;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
} finally {
  srv.close();
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed) process.exit(1);
