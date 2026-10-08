import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { BatchApiError, createShengsuanyunBatchService, registerShengsuanyunBatchRoutes } from '../web/shengsuanyun-batch.js';
import { ProbeError, runProbe } from '../scripts/probe-shengsuanyun-batch.mjs';

let passed = 0;
let failed = 0;
function assert(condition, message) { if (!condition) throw new Error(message); }
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (error) { console.log(`  ❌ ${name}: ${error instanceof Error ? error.message : String(error)}`); failed++; }
}

console.log('\n─── 胜算云 LoomLoom 批量适配器 ───');
const dataDir = mkdtempSync(join(tmpdir(), 'ao-ssy-batch-'));
let clock = Date.parse('2026-09-30T12:00:00.000Z');
const calls = [];
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fakeFetch = async (url, init) => {
  const path = new URL(String(url)).pathname;
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ path, body });
  if (path.endsWith('/templates/tpl-ao/schema')) return json({ fields: [{ key: 'prompt', label: '提示词' }] });
  if (path.endsWith('/templates:validate-rows')) return json({ valid: true, rowErrors: [] });
  if (path.endsWith('/templates:precheck-rows')) return json({ estimatedTotalCost: 8_200_000, balanceCheck: { availableBalance: 123_000_000, isSufficient: true } });
  if (path.endsWith('/templates:submit-rows')) return json({ runId: 'remote-run-1', status: 'pending', acceptedAt: '2026-09-30T12:00:01.000Z' });
  if (path.endsWith('/batch/workflow-runs/remote-run-1/tasks')) return json({ tasks: [
    { taskId: 't1', sourceRowIndex: 0, status: 'completed', artifactCount: 1 },
    { taskId: 't2', sourceRowIndex: 1, status: 'failed', errorMessage: '内容审核拒绝', artifactCount: 0 },
  ] });
  if (path.endsWith('/batch/workflow-runs/remote-run-1/artifacts')) return json({ artifacts: [
    { artifactId: 'a1', sourceRowIndex: 0, accessUrl: 'https://assets.example/a1.png', mimeType: 'image/png' },
  ] });
  if (path.endsWith('/batch/workflow-runs/remote-run-1')) return json({ status: 'completed', totalTasks: 2, completedTasks: 1, failedTasks: 1, actualCost: 4_100_000 });
  return json({ message: 'missing fake route' }, 404);
};

const env = {
  AO_SSY_BATCH_ENABLED: '1', AO_SSY_BATCH_TEMPLATE_ID: 'tpl-ao', AO_SSY_BATCH_PROMPT_FIELD: '提示词',
  AO_SSY_BATCH_BASE_URL: 'https://batch.example/v1',
  AO_SSY_BATCH_ARTIFACT_HOSTS: 'assets.example',
};
const service = createShengsuanyunBatchService({
  dataDir,
  env,
  getToken: () => 'secret-key',
  fetchImpl: fakeFetch,
  assetFetchImpl: async () => new Response(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), {
    status: 200,
    headers: { 'content-type': 'image/png', 'content-length': '8' },
  }),
  now: () => clock,
});
const items = [
  { promptId: 'p-1', title: '猫', prompt: '一只猫在窗边' },
  { promptId: 'p-2', title: '山', prompt: '日落时的雪山' },
];
const config = { promptMode: 'passthrough', outputsPerPrompt: 1 };

await test('官方模板默认配置齐全，缺少 Key 提示凭据缺失', async () => {
  const unconfigured = createShengsuanyunBatchService({ dataDir, env: {}, getToken: () => '', fetchImpl: fakeFetch });
  const capability = await unconfigured.capabilities();
  assert(capability.available === false && capability.reasonCode === 'missing_credentials', JSON.stringify(capability));
});

await test('无需开启变量，模板和凭据齐全即可使用', async () => {
  const { AO_SSY_BATCH_ENABLED, ...defaultEnv } = env;
  const enabled = createShengsuanyunBatchService({ dataDir, env: defaultEnv, getToken: () => 'secret', fetchImpl: fakeFetch });
  const capability = await enabled.capabilities();
  assert(capability.available === true, JSON.stringify(capability));
});

await test('显式设置 0 可以关闭批量出图', async () => {
  const off = createShengsuanyunBatchService({ dataDir, env: { ...env, AO_SSY_BATCH_ENABLED: '0' }, getToken: () => 'secret', fetchImpl: fakeFetch });
  const capability = await off.capabilities();
  assert(capability.available === false && capability.reasonCode === 'feature_disabled', JSON.stringify(capability));
});

await test('错误服务地址不阻断启动，只在 capability 报配置错误', async () => {
  const bad = createShengsuanyunBatchService({ dataDir, env: { ...env, AO_SSY_BATCH_BASE_URL: 'http://public.example' }, getToken: () => 'secret', fetchImpl: fakeFetch });
  const capability = await bad.capabilities();
  assert(capability.available === false && capability.reasonCode === 'invalid_config', JSON.stringify(capability));
});

await test('capability 真查 schema，专属提示词字段存在才开放', async () => {
  const capability = await service.capabilities();
  assert(capability.available === true, JSON.stringify(capability));
  assert(capability.limits.maxPrompts === 24, '默认单批上限应为 24');
});

let quoteId = '';
await test('precheck 先校验再估价，提示词原样进入专属字段，费用单位正确换算', async () => {
  calls.length = 0;
  const result = await service.precheck({ items, config });
  quoteId = result.quoteId;
  assert(result.estimatedCost === 0.82 && result.availableBalance === 12.3, `金额换算错误：${JSON.stringify(result)}`);
  assert(calls[0].path.endsWith('/templates:validate-rows') && calls[1].path.endsWith('/templates:precheck-rows'), '必须先 validate 再 precheck');
  assert(calls[0].body.rows[0].values['提示词'] === items[0].prompt, '提示词必须原样放进配置字段');
  assert(Object.keys(calls[0].body.rows[0].values).length === 1, '未配置的模型/尺寸/优化字段不能擅自发送');
});

await test('passthrough 不裁掉提示词首尾空白', async () => {
  calls.length = 0;
  const spaced = [{ promptId: 'space', title: '空白保真', prompt: '  保留两边空白  ' }];
  await service.precheck({ items: spaced, config });
  assert(calls[0].body.rows[0].values['提示词'] === spaced[0].prompt, JSON.stringify(calls[0].body));
});

await test('quote 与请求摘要绑定，改过提示词后禁止提交', async () => {
  let error;
  try { await service.submit({ quoteId, idempotencyKey: 'idem-bad', items: [{ ...items[0], prompt: '被修改' }, items[1]], config }); }
  catch (value) { error = value; }
  assert(error instanceof BatchApiError && error.code === 'quote_mismatch', `实际错误：${error?.code}`);
});

await test('余额不足的 quote 即使绕过前端也不能提交', async () => {
  const insufficientService = createShengsuanyunBatchService({
    dataDir: join(dataDir, 'insufficient'), env, getToken: () => 'secret-key', now: () => clock,
    fetchImpl: async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/templates:validate-rows')) return json({ valid: true });
      if (path.endsWith('/templates:precheck-rows')) return json({ estimatedTotalCost: 10_000_000, balanceCheck: { availableBalance: 0, isSufficient: false } });
      return fakeFetch(url, init);
    },
  });
  const value = await insufficientService.precheck({ items, config });
  let error;
  try { await insufficientService.submit({ quoteId: value.quoteId, idempotencyKey: 'idem-no-money', items, config }); } catch (caught) { error = caught; }
  assert(error instanceof BatchApiError && error.code === 'insufficient_balance', `实际错误：${error?.code}`);
});

let localRunId = '';
await test('提交透传幂等键，并以 AO 本地 runId 隐藏和约束远端任务', async () => {
  const result = await service.submit({ quoteId, idempotencyKey: 'ao-creative-fixed-id', items, config });
  localRunId = result.run.id;
  const submit = calls.find((call) => call.path.endsWith('/templates:submit-rows'));
  assert(submit?.body.idempotencyKey === 'ao-creative-fixed-id', '幂等键没有透传');
  assert(result.run.id && result.run.id !== 'remote-run-1', '浏览器使用 AO 包装后的 runId');
  const storeFile = join(dataDir, '.local', 'batch-runs', 'shengsuanyun.json');
  assert(existsSync(storeFile), '任务映射必须落盘，刷新/重启后可恢复');
  const stored = JSON.parse(readFileSync(storeFile, 'utf8'));
  assert(stored[localRunId].providerRunId === 'remote-run-1', '本地映射缺远端 runId');
});

await test('整批 completed + 有失败项归一化为 partial，实际费用正确换算', async () => {
  const result = await service.getRun(localRunId);
  assert(result.run.status === 'partial', `实际状态：${result.run.status}`);
  assert(result.run.actualCost === 0.41, `实际费用：${result.run.actualCost}`);
});

await test('逐条任务和产物通过 sourceRowIndex 稳定映射回 promptId', async () => {
  const taskResult = await service.getItems(localRunId);
  assert(taskResult.items[1].promptId === 'p-2' && taskResult.items[1].status === 'failed', JSON.stringify(taskResult));
  const artifactResult = await service.getArtifacts(localRunId);
  assert(artifactResult.artifacts[0].promptId === 'p-1', JSON.stringify(artifactResult));
});

await test('产物只返回 AO 本地代理地址，下载内容由后端安全转发', async () => {
  const artifactResult = await service.getArtifacts(localRunId);
  const artifact = artifactResult.artifacts[0];
  assert(artifact.accessUrl.startsWith('/api/batch/providers/shengsuanyun/'), artifact.accessUrl);
  assert(!artifact.accessUrl.includes('assets.example'), '不应向浏览器暴露上游签名 URL');
  const content = await service.getArtifactContent(localRunId, artifact.artifactId);
  assert(content.mimeType === 'image/png' && content.buffer.length === 8, JSON.stringify(content));
  assert(content.filename.endsWith('.png'), content.filename);
});

await test('最近任务列表不返回完整提示词和远端 runId', async () => {
  const result = service.listRuns();
  assert(result.runs[0].id === localRunId && result.runs[0].itemCount === 2, JSON.stringify(result));
  assert(!('items' in result.runs[0]) && !('providerRunId' in result.runs[0]), '列表不能泄露提示词或远端 ID');
});

await test('仅失败项先重新估价，再创建带 parentRunId 的子任务', async () => {
  calls.length = 0;
  const retryQuote = await service.precheckRetry(localRunId);
  const validate = calls.find((call) => call.path.endsWith('/templates:validate-rows'));
  assert(validate?.body.rows.length === 1 && validate.body.rows[0].values['提示词'] === items[1].prompt, JSON.stringify(validate?.body));
  const retried = await service.submitRetry(localRunId, { quoteId: retryQuote.quoteId, idempotencyKey: 'retry-fixed-key' });
  assert(retried.run.parentRunId === localRunId, JSON.stringify(retried));
  const stored = JSON.parse(readFileSync(join(dataDir, '.local', 'batch-runs', 'shengsuanyun.json'), 'utf8'));
  assert(stored[retried.run.id].parentRunId === localRunId && stored[retried.run.id].items.length === 1, '重试子任务映射不完整');
});

await test('不能借本地代理查询任意远端 runId', async () => {
  let error;
  try { await service.getRun('remote-run-1'); } catch (value) { error = value; }
  assert(error instanceof BatchApiError && error.code === 'run_not_found', `实际错误：${error?.code}`);
});

await test('quote 60 秒后失效', async () => {
  const result = await service.precheck({ items, config });
  clock += 61_000;
  let error;
  try { await service.submit({ quoteId: result.quoteId, idempotencyKey: 'idem-expired', items, config }); } catch (value) { error = value; }
  assert(error instanceof BatchApiError && error.code === 'quote_expired', `实际错误：${error?.code}`);
});

await test('Express 路由端到端：capability → precheck → submit → history，错误始终是 JSON', async () => {
  const routeDir = join(dataDir, 'route-e2e');
  mkdirSync(routeDir, { recursive: true });
  const app = express();
  app.use(express.json());
  registerShengsuanyunBatchRoutes(app, { dataDir: routeDir, env, getToken: () => 'secret-key', fetchImpl: fakeFetch, now: () => clock });
  const socketPath = join(routeDir, 'server.sock');
  const server = await new Promise((resolve) => {
    const value = app.listen(socketPath, () => resolve(value));
  });
  const call = (method, path, body) => new Promise((resolve, reject) => {
    const raw = body === undefined ? '' : JSON.stringify(body);
    const req = httpRequest({ socketPath, path, method, headers: raw ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(raw) } : {} }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(text) }); }
        catch { reject(new Error(`响应不是 JSON：${text.slice(0, 120)}`)); }
      });
    });
    req.on('error', reject);
    if (raw) req.write(raw);
    req.end();
  });
  try {
    const base = '/api/batch/providers/shengsuanyun';
    // Codex 的受限沙箱会让 listen 回调成功、却不真正创建 TCP/Unix socket。
    // 这种环境至少验证 Express 路由表；普通本机与 CI 有 socket 时继续做真实 HTTP 往返。
    if (!existsSync(socketPath)) {
      const paths = (app.router?.stack || []).map((layer) => layer.route?.path).filter(Boolean);
      for (const path of [`${base}/capabilities`, `${base}/precheck`, `${base}/runs`, `${base}/runs/:runId`, `${base}/runs/:runId/artifacts/:artifactId/content`, `${base}/runs/:runId/retry-failed`]) {
        assert(paths.includes(path), `缺少 Express 路由 ${path}`);
      }
      return;
    }
    const capability = await call('GET', `${base}/capabilities`);
    assert(capability.status === 200 && capability.body.available === true, JSON.stringify(capability));
    const routeQuote = await call('POST', `${base}/precheck`, { items, config });
    assert(routeQuote.status === 200 && routeQuote.body.quoteId, JSON.stringify(routeQuote));
    const submitted = await call('POST', `${base}/runs`, { quoteId: routeQuote.body.quoteId, idempotencyKey: 'route-e2e-key', items, config });
    assert(submitted.status === 200 && submitted.body.run.id, JSON.stringify(submitted));
    const history = await call('GET', `${base}/runs`);
    assert(history.body.runs.length === 1 && history.body.runs[0].id === submitted.body.run.id, JSON.stringify(history));
    const missing = await call('GET', `${base}/runs/not-owned`);
    assert(missing.status === 404 && missing.body.code === 'run_not_found' && typeof missing.body.error === 'string', JSON.stringify(missing));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

await test('上线探针只调用 health/schema/validate/precheck，报告不含 Token', async () => {
  const paths = [];
  const probe = await runProbe({
    env: {
      SHENGSUANYUN_API_KEY: 'probe-super-secret',
      AO_SSY_BATCH_TEMPLATE_ID: 'tpl-ao',
      AO_SSY_BATCH_PROMPT_FIELD: '提示词',
      AO_SSY_BATCH_BASE_URL: 'https://batch.example/v1',
    },
    now: () => new Date('2026-10-01T00:00:00.000Z'),
    fetchImpl: async (url, init) => {
      const path = new URL(String(url)).pathname;
      paths.push(path);
      assert(init.headers.authorization === 'Bearer probe-super-secret', '探针鉴权头错误');
      if (path.endsWith('/health')) return json({ status: 'ok' });
      if (path.endsWith('/templates/tpl-ao/schema')) return json({ fields: [{ key: 'prompt', label: '提示词' }] });
      if (path.endsWith('/templates:validate-rows')) return json({ valid: true });
      if (path.endsWith('/templates:precheck-rows')) return json({ estimatedTotalCost: 5_000_000, balanceCheck: { availableBalance: 100_000_000, isSufficient: true } });
      return json({}, 404);
    },
  });
  assert(probe.ok && probe.createsGenerationTask === false, JSON.stringify(probe));
  assert(probe.stages.precheck.estimatedCost === 0.5, JSON.stringify(probe));
  assert(!paths.some((path) => path.includes('submit')), `探针不应提交任务：${paths.join(', ')}`);
  assert(!JSON.stringify(probe).includes('probe-super-secret'), '报告泄露了 Token');
});

await test('上线探针发现字段不匹配时在 precheck 前停止', async () => {
  const paths = [];
  let error;
  try {
    await runProbe({
      env: { SHENGSUANYUN_API_KEY: 'secret', AO_SSY_BATCH_TEMPLATE_ID: 'tpl-ao', AO_SSY_BATCH_PROMPT_FIELD: '错误字段' },
      fetchImpl: async (url) => {
        const path = new URL(String(url)).pathname;
        paths.push(path);
        if (path.endsWith('/health')) return json({ status: 'ok' });
        return json({ fields: [{ key: 'prompt', label: '提示词' }] });
      },
    });
  } catch (caught) { error = caught; }
  assert(error instanceof ProbeError && error.code === 'schema_mismatch', `实际错误：${error?.code}`);
  assert(paths.length === 2, `字段不匹配后不应继续请求：${paths.join(', ')}`);
});

await test('默认官方模板使用当前接口、必填比例、计价版本和幂等契约', async () => {
  const requests = [];
  const official = createShengsuanyunBatchService({
    dataDir, env: {}, getToken: () => 'test-token',
    fetchImpl: async (url, init) => {
      const path = new URL(url).pathname;
      const body = init.body ? JSON.parse(init.body) : undefined;
      requests.push({ path, body });
      if (body) {
        assert(Array.isArray(body.rows), '官方接口 rows 必须是数组');
        for (const row of body.rows) {
          assert(row && typeof row === 'object' && !Array.isArray(row), '官方接口每行必须是字段对象');
          assert(Object.values(row).every(value => typeof value === 'string'), 'Go map[string]string 不接受嵌套对象或非字符串值');
          assert(!('values' in row), '官方接口不接受 values 包装');
        }
      }
      if (path.endsWith('/schema')) return json({ fields: [{ label: '图片提示词' }, { label: '图片比例', required: true }] });
      if (path.endsWith(':validateRows')) return json({ valid: true });
      if (path.endsWith(':precheckRows')) return json({ estimatedTotalCost: 1000000, pricingRevision: 'price-1', balanceCheck: { isSufficient: true } });
      if (path.endsWith(':runRows')) return json({ runId: 'official-run', status: 'pending' });
      if (path.endsWith('/resultRows')) return json({ items: [
        { rowIndex: 0, status: 'completed', artifacts: [{ artifactId: 'text-1' }, { artifactId: 'image-1' }] },
        { rowIndex: 1, status: 'completed', artifacts: [{ artifactId: 'text-2' }, { artifactId: 'image-2' }] },
      ], totalCount: 2 });
      if (path.endsWith('/artifacts')) return json({ items: [
        { artifactId: 'text-1', sourceRowIndex: 0, mimeType: 'text/plain' },
        { artifactId: 'image-1', sourceRowIndex: 0, mimeType: 'image/png' },
        { artifactId: 'text-2', sourceRowIndex: 1, mimeType: 'text/plain' },
        { artifactId: 'image-2', sourceRowIndex: 1, mimeType: 'image/png' },
      ], totalCount: 4 });
      if (path.endsWith('/users/me/runs/official-run')) return json({
        run: { status: 'completed', totalTasks: 2, completedTasks: 2, failedTasks: 0, actualCostT: 2000000, actualCost: { amount: '0.2', currency: 'CNY' } },
        tasks: [{ sourceRowIndex: 0, status: 'completed' }, { sourceRowIndex: 1, status: 'completed' }],
      });
      throw new Error(`Unexpected official endpoint: ${path}`);
    },
  });
  const capability = await official.capabilities();
  assert(capability.available && capability.template.id === 'text-image-v1', JSON.stringify(capability));
  assert(capability.template.promptModes[0] === 'optimize', '官方模板必须明示提示词整理');
  const quote = await official.precheck({ items, config: { promptMode: 'optimize' } });
  const validation = requests.find(r => r.path.endsWith(':validateRows'));
  assert(validation.path === '/loom/v1/officialTemplates/text-image-v1:validateRows', validation.path);
  const firstRow = validation.body.rows[0];
  assert(firstRow['图片提示词'] === items[0].prompt && firstRow['图片比例'] === '1:1', JSON.stringify(validation.body));
  const result = await official.submit({ quoteId: quote.quoteId, idempotencyKey: 'official-order', items, config: { promptMode: 'optimize' } });
  const submission = requests.find(r => r.path.endsWith(':runRows'));
  assert(submission.body.clientRequestId === 'official-order' && submission.body.pricingRevision === 'price-1', JSON.stringify(submission.body));
  assert(!('templateId' in submission.body) && !('idempotencyKey' in submission.body), '旧接口参数不应进入官方请求');
  const tasks = await official.getItems(result.run.id);
  const artifacts = await official.getArtifacts(result.run.id);
  const detail = await official.getRun(result.run.id);
  assert(detail.run.status === 'completed' && detail.run.completed === 2 && detail.run.total === 2 && detail.run.failed === 0, '真实 run 包装响应必须显示已完成 2/2');
  assert(detail.run.actualCost === 0.2, '实际费用优先使用整数 actualCostT');
  assert(official.listRuns().runs.find(run => run.id === result.run.id)?.status === 'completed', '详情查询后历史任务状态应持久化');
  assert(tasks.items.length === 2 && tasks.items.every((task, index) => task.promptId === items[index].promptId && task.artifactCount === 2), 'resultRows.items 使用零基索引恢复提示词及产物数量');
  assert(artifacts.artifacts.length === 4 && artifacts.artifacts.filter(a => a.mimeType.startsWith('image/')).length === 2, '产物 items 包装应恢复两张图片和两条中间文本');
  assert(artifacts.artifacts.every((artifact) => artifact.promptId === items[artifact.sourceRowIndex].promptId), '产物必须映射到正确提示词');
});

await test('官方模板 schema 缺少必填比例时不标为可用', async () => {
  const official = createShengsuanyunBatchService({ dataDir, env: {}, getToken: () => 'test-token', fetchImpl: async () => json({ fields: [{ label: '图片提示词' }] }) });
  const capability = await official.capabilities();
  assert(!capability.available && capability.reasonCode === 'schema_mismatch', JSON.stringify(capability));
});

await test('费用缺失或无法识别不阻断提交，也不伪造零元费用', async () => {
  for (const amount of [undefined, { amount: '0.1', currency: 'CNY' }, 'unknown', -1, 0.5]) {
    const unknownCost = createShengsuanyunBatchService({ dataDir, env, getToken: () => 'secret', fetchImpl: async (url, init) => {
      if (String(url).endsWith('templates:precheck-rows')) return json({ estimatedTotalCost: amount, balanceCheck: { availableBalance: amount, isSufficient: true } });
      return fakeFetch(url, init);
    } });
    const quote = await unknownCost.precheck({ items, config });
    assert(quote.estimatedCost === undefined && quote.availableBalance === undefined, '未知金额不能显示成零元或阻断');
    const result = await unknownCost.submit({ quoteId: quote.quoteId, idempotencyKey: 'unknown-cost-order', items, config });
    assert(result.ok, '没有费用金额也应允许提交');
  }
});

rmSync(dataDir, { recursive: true, force: true });
console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
