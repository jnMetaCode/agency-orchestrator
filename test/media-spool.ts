/**
 * 媒体产物登记表：每次运行一份 + 一生成就暂存到盘上。
 *
 * 两个真实的丢钱场景：
 *   1. 登记表曾是模块级全局、run() 开头清空。同一进程里两条运行并发（MCP 的并行工具调用）时，
 *      后开始的那条一清空，先开始的那条引用上游图片 / 视频就报「找不到」——而产物已经付过钱了。
 *   2. 产物只活在内存里，直到整条运行结束才落盘。中途进程被杀（OOM / SIGKILL / 断电 / 合盖）就全没了。
 */
import http from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/index.js';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const dir = mkdtempSync(join(tmpdir(), 'ao-media-spool-'));
const outA = join(dir, 'outA');
const outB = join(dir, 'outB');
const agentsDir = join(process.cwd(), 'node_modules', 'agency-agents-zh');

/** 文本步被调用的那一刻，磁盘上的暂存目录里有什么（= 上游图片是不是「一生成就落盘」了） */
let spoolAtSlowStep: string[] = [];
let videoCreates = 0;
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => (b += d));
  req.on('end', async () => {
    const url = String(req.url);
    if (/chat\/completions/.test(url)) {
      const root = join(outA, '.inflight-media');
      spoolAtSlowStep = existsSync(root) ? readdirSync(root).flatMap((d) => readdirSync(join(root, d))) : [];
      await sleep(1200);   // 给并发的另一条运行留出「开始」的时间窗
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '好' }, finish_reason: 'stop' }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    if (/images\/generations/.test(url)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }));
    }
    if (/video_generation/.test(url)) videoCreates++;
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"nope"}');
  });
});
await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
const port = (srv.address() as { port: number }).port;

const head = [
  `agents_dir: "${agentsDir}"`, 'verify: false',
  'llm:', '  provider: "lanox"', '  model: "m"', `  base_url: "http://127.0.0.1:${port}/v1"`, '  api_key: "k"',
];
const wfA = join(dir, 'a.yaml');
writeFileSync(wfA, [
  'name: "运行A"', ...head,
  'steps:',
  '  - id: cover', '    type: image', '    task: "一张封面"', '    image: { model: "gpt-image-2" }', '    output: cover_img',
  '  - id: slow', '    role: "marketing/marketing-content-creator"', '    task: "说一个字"', '    output: word', '    depends_on: [cover]',
  '  - id: clip', '    type: video', '    task: "镜头推近"', '    depends_on: [slow]',
  '    video: { provider: "metaso", model: "MiniMax-H3", duration: 5, image: "{{cover_img}}" }', '    output: clip_mp4', '',
].join('\n'), 'utf-8');
const wfB = join(dir, 'b.yaml');
writeFileSync(wfB, [
  'name: "运行B"', ...head,
  'steps:', '  - id: poster', '    type: image', '    task: "另一张图"', '    image: { model: "gpt-image-2" }', '    output: poster_img', '',
].join('\n'), 'utf-8');

const envBefore = { key: process.env.METASO_API_KEY, base: process.env.METASO_BASE_URL };
process.env.METASO_API_KEY = 'mk-test';
process.env.METASO_BASE_URL = `http://127.0.0.1:${port}`;
const realLog = console.log;
try {
  console.log('\n─── 两条运行并发：互不清空对方的产物 ───');
  const pA = run(wfA, {}, { quiet: true, outputDir: outA });
  await sleep(500);                                   // A 此刻卡在 slow 步，cover 已经产出
  const rB = await run(wfB, {}, { quiet: true, outputDir: outB });   // B 从开始到结束都落在 A 的运行期间
  const rA = await pA;
  assert(rB.steps[0]?.status === 'completed', 'B 正常跑完');
  const clipErr = rA.steps.find((s) => s.id === 'clip')?.error ?? '';
  assert(rA.steps.find((s) => s.id === 'cover')?.status === 'completed', 'A 的封面产出了');
  assert(!/找不到图片/.test(clipErr), `A 的视频步仍拿得到自己的封面——B 开始时没有把它清掉（实际报错：${clipErr.slice(0, 80) || '无'}）`);

  console.log('\n─── 产物一生成就在盘上，正常结束后暂存清掉 ───');
  assert(spoolAtSlowStep.includes('cover.png'), `下游步骤还在跑的时候，封面已经在暂存目录里了（当时看到：${JSON.stringify(spoolAtSlowStep)}）`);
  const savedA = readdirSync(outA).filter((d) => !d.startsWith('.'));
  assert(savedA.length === 1 && existsSync(join(outA, savedA[0], 'assets', 'cover.png')), '运行结束：封面在档案的 assets/ 里');
  assert(!existsSync(join(outA, '.inflight-media')), '运行结束：暂存目录清干净，不留垃圾');
  assert(!existsSync(join(outB, '.inflight-media')), 'B 同样');

  console.log('\n─── 上次没来得及存档的产物：下次跑媒体工作流时说出来 ───');
  const orphan = join(outB, '.inflight-media', '某次运行-2147483646-1');   // 这个 pid 不可能活着
  mkdirSync(orphan, { recursive: true });
  writeFileSync(join(orphan, 'paid-clip.mp4'), 'x');
  const mine = join(outB, '.inflight-media', `正在跑的-${process.pid}-2`);   // pid 活着 = 别的运行正在用，不算遗留
  mkdirSync(mine, { recursive: true });
  writeFileSync(join(mine, 'busy.mp4'), 'x');
  const lines: string[] = [];
  console.log = (...a: unknown[]) => { lines.push(a.join(' ')); };
  await run(wfB, {}, { outputDir: outB });
  console.log = realLog;
  const said = lines.join('\n');
  assert(/没来得及存档/.test(said) && said.includes('paid-clip.mp4'), '提示里点出遗留的文件');
  assert(!said.includes('busy.mp4'), '进程还活着的那份不当成遗留');
  assert(existsSync(join(orphan, 'paid-clip.mp4')), '只提示，不替用户删');
} catch (e) {
  console.log = realLog;
  assert(false, `异常: ${e instanceof Error ? e.stack?.slice(0, 300) : String(e)}`);
} finally {
  if (envBefore.key === undefined) delete process.env.METASO_API_KEY; else process.env.METASO_API_KEY = envBefore.key;
  if (envBefore.base === undefined) delete process.env.METASO_BASE_URL; else process.env.METASO_BASE_URL = envBefore.base;
  srv.close(); srv.closeAllConnections?.();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed > 0 ? 1 : 0);
