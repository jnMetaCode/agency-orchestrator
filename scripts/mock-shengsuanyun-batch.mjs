#!/usr/bin/env node
/** 本地 UI 演示专用的 LoomLoom 假上游。仅监听 127.0.0.1，不请求真实服务。 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const port = Number.parseInt(process.env.PORT || '8091', 10);
const runs = new Map();

function sendJson(res, body, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { raw += chunk; if (raw.length > 1_000_000) reject(new Error('body too large')); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (error) { reject(error); } });
    req.on('error', reject);
  });
}

function artwork(index) {
  const palettes = [['#6d28d9', '#c4b5fd'], ['#0369a1', '#7dd3fc'], ['#be123c', '#fda4af'], ['#047857', '#6ee7b7']];
  const [deep, light] = palettes[index % palettes.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
    <defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${deep}"/><stop offset="1" stop-color="${light}"/></linearGradient></defs>
    <rect width="1024" height="1024" rx="64" fill="url(#g)"/><circle cx="790" cy="230" r="180" fill="white" opacity=".16"/>
    <path d="M0 800 Q260 560 520 800 T1040 760 V1024 H0Z" fill="white" opacity=".18"/>
    <text x="72" y="112" fill="white" font-family="system-ui,sans-serif" font-size="34" opacity=".8">SHENGSUANYUN · LOCAL DEMO</text>
    <text x="72" y="860" fill="white" font-family="system-ui,sans-serif" font-size="76" font-weight="700">批量作品 ${index + 1}</text>
    <text x="72" y="925" fill="white" font-family="system-ui,sans-serif" font-size="28" opacity=".85">仅用于界面预览 · 未调用真实生成服务</text>
  </svg>`;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  const path = url.pathname;
  try {
    if (req.method === 'GET' && path === '/batch/v1/health') return sendJson(res, { status: 'ok', mock: true });
    if (req.method === 'GET' && path === '/batch/v1/templates/ao-local-demo/schema') {
      return sendJson(res, { fields: [{ key: 'prompt', label: '提示词', type: 'string', required: true }] });
    }
    if (req.method === 'POST' && path === '/batch/v1/templates:validate-rows') return sendJson(res, { valid: true, rowErrors: [] });
    if (req.method === 'POST' && path === '/batch/v1/templates:precheck-rows') {
      const body = await readJson(req);
      return sendJson(res, { estimatedTotalCost: (body.rows?.length || 0) * 3_800_000, balanceCheck: { availableBalance: 1_000_000_000, isSufficient: true } });
    }
    if (req.method === 'POST' && path === '/batch/v1/templates:submit-rows') {
      const body = await readJson(req);
      const runId = `demo-${randomUUID()}`;
      runs.set(runId, { rows: body.rows || [], acceptedAt: new Date().toISOString() });
      return sendJson(res, { runId, status: 'pending', acceptedAt: runs.get(runId).acceptedAt });
    }
    const match = path.match(/^\/batch\/v1\/batch\/workflow-runs\/([^/]+)(?:\/(tasks|artifacts))?$/);
    if (req.method === 'GET' && match) {
      const run = runs.get(decodeURIComponent(match[1]));
      if (!run) return sendJson(res, { message: 'demo run not found' }, 404);
      if (match[2] === 'tasks') return sendJson(res, { tasks: run.rows.map((_row, index) => ({ taskId: `demo-task-${index}`, sourceRowIndex: index, status: 'completed', artifactCount: 1 })) });
      if (match[2] === 'artifacts') return sendJson(res, { artifacts: run.rows.map((_row, index) => ({ artifactId: `demo-artifact-${index}`, sourceRowIndex: index, accessUrl: `http://127.0.0.1:${port}/artifacts/${index}.svg`, mimeType: 'image/svg+xml' })) });
      return sendJson(res, { status: 'completed', totalTasks: run.rows.length, completedTasks: run.rows.length, failedTasks: 0, actualCost: run.rows.length * 3_800_000 });
    }
    const art = path.match(/^\/artifacts\/(\d+)\.svg$/);
    if (req.method === 'GET' && art) {
      res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(artwork(Number(art[1])));
    }
    return sendJson(res, { message: 'mock route not found' }, 404);
  } catch (error) {
    return sendJson(res, { message: error instanceof Error ? error.message : String(error) }, 400);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`胜算云本地演示上游：http://127.0.0.1:${port}/batch/v1`);
  console.log('仅用于 UI 预览，不会请求真实胜算云或产生费用。');
});
