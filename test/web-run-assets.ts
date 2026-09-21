/**
 * Studio 的运行产物端点 GET /api/runs/:id/assets/:file。
 *
 * 钉三件事：
 *   1. Range 请求——没有它 Safari 的 <video> 直接不播，Chrome 里拖不动进度条；
 *   2. 配音的 mp3、jpg / webp 给对 Content-Type（此前只认 png / mp4，其余都是 octet-stream）；
 *   3. **数据目录在点目录下**（默认就是 ~/.ao）照样能取——sendFile 直接给绝对路径时，路径里任何一段
 *      以点开头都会被当成 dotfile 拒掉，这是换 sendFile 时最容易踩的坑，所以测试的数据目录故意放在 .ao 里。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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

const root = mkdtempSync(join(tmpdir(), 'ao-web-assets-'));
const dataDir = join(root, '.ao');                       // ← 点目录，模拟默认的 ~/.ao
const runDir = join(dataDir, 'ao-output', 'demo-2026-01-01T00-00-00');
mkdirSync(join(runDir, 'assets'), { recursive: true });
writeFileSync(join(runDir, 'metadata.json'), JSON.stringify({ name: 'demo', steps: [] }), 'utf-8');
const MP4 = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));
writeFileSync(join(runDir, 'assets', 'clip.mp4'), MP4);
writeFileSync(join(runDir, 'assets', 'vo.mp3'), Buffer.from('ID3fake'));
writeFileSync(join(runDir, 'assets', 'cover.png'), Buffer.from('png'));
writeFileSync(join(runDir, 'assets', 'frame.webp'), Buffer.from('webp'));
writeFileSync(join(dataDir, 'secret.txt'), 'nope', 'utf-8');

let server: ChildProcess | null = null;
try {
  const port = await freePort();
  server = spawn(process.execPath, [resolve('web/server.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', AO_NODE: process.execPath, AO_DATA_DIR: dataDir, AO_MANIFEST_URL: 'http://127.0.0.1:1/none.json' },
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
    const asset = (f: string) => `${base}/api/runs/demo-2026-01-01T00-00-00/assets/${f}`;
    console.log('\n─── 整个文件 ───');
    const full = await fetch(asset('clip.mp4'));
    const body = Buffer.from(await full.arrayBuffer());
    assert(full.status === 200 && body.equals(MP4), `数据目录在点目录（.ao）下照样取得到，内容一致（实际 ${full.status}，${body.length} 字节）`);
    assert(full.headers.get('content-type') === 'video/mp4', 'mp4 → video/mp4');
    assert(full.headers.get('accept-ranges') === 'bytes', '声明支持 Range');
    assert(/max-age=86400/.test(full.headers.get('cache-control') || ''), '缓存头还在');

    console.log('\n─── Range ───');
    const part = await fetch(asset('clip.mp4'), { headers: { Range: 'bytes=100-199' } });
    const pbody = Buffer.from(await part.arrayBuffer());
    assert(part.status === 206, `Range 请求回 206（实际 ${part.status}）`);
    assert(part.headers.get('content-range') === 'bytes 100-199/1000', `Content-Range 正确（实际 ${part.headers.get('content-range')}）`);
    assert(pbody.equals(MP4.subarray(100, 200)), '拿到的就是那 100 个字节');

    console.log('\n─── Content-Type ───');
    assert(/^audio\/mpeg/.test((await fetch(asset('vo.mp3'))).headers.get('content-type') || ''), '配音 mp3 → audio/mpeg（此前是 octet-stream）');
    assert((await fetch(asset('cover.png'))).headers.get('content-type') === 'image/png', 'png → image/png');
    assert((await fetch(asset('frame.webp'))).headers.get('content-type') === 'image/webp', 'webp → image/webp');

    console.log('\n─── 守卫没松 ───');
    assert((await fetch(asset('nope.mp4'))).status === 404, '不存在 → 404');
    assert((await fetch(asset('..%2F..%2F..%2Fsecret.txt'))).status === 404, '文件名路径穿越 → 404');
    assert((await fetch(`${base}/api/runs/..%2F..%2Fx/assets/clip.mp4`)).status === 404, 'run id 路径穿越 → 404');
  }
} catch (e) {
  assert(false, `异常: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  try { server?.kill(); } catch { /* already gone */ }
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed > 0 ? 1 : 0);
