/**
 * 胜算云 LoomLoom 批处理适配器。
 *
 * 这层只暴露 AO 自己的稳定契约；模板字段全部来自显式环境配置，绝不猜中文 label。
 * 功能默认关闭，只有专属模板完成双方验收后才通过 AO_SSY_BATCH_ENABLED=1 打开。
 */
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DEFAULT_BASE_URL = 'https://loomloom.shengsuanyun.com/batch/v1';
const DEFAULT_MAX_ITEMS = 24;
const MAX_PROMPT_CHARS = 20_000;
const QUOTE_TTL_MS = 60_000;
const SCHEMA_TTL_MS = 5 * 60_000;
const RUN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;
const TERMINAL_RUN_STATUSES = new Set(['completed', 'partial', 'failed', 'cancelled']);

export class BatchApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'BatchApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function cleanBaseUrl(value) {
  const base = String(value || DEFAULT_BASE_URL).replace(/\/+$/, '');
  let url;
  try { url = new URL(base); } catch { throw new BatchApiError(500, 'invalid_config', '胜算云批量服务地址无效'); }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1';
  if (url.protocol !== 'https:' && !(loopback && process.env.NODE_ENV === 'test')) {
    throw new BatchApiError(500, 'invalid_config', '胜算云批量服务地址必须使用 HTTPS');
  }
  return base;
}

function positiveInt(value, fallback, max = 1000) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
}

export function readShengsuanyunBatchConfig(env = process.env) {
  const enabled = env.AO_SSY_BATCH_ENABLED === '1';
  const templateId = String(env.AO_SSY_BATCH_TEMPLATE_ID || '').trim();
  const promptField = String(env.AO_SSY_BATCH_PROMPT_FIELD || '').trim();
  let baseUrl = DEFAULT_BASE_URL;
  let configError = '';
  try { baseUrl = cleanBaseUrl(env.AO_SSY_BATCH_BASE_URL); }
  catch (error) { configError = error instanceof Error ? error.message : String(error); }
  return {
    enabled,
    // 仅供本机 UI 演示显式标记；不改变请求逻辑，生产环境缺省永远是 false。
    demo: env.AO_SSY_BATCH_DEMO === '1',
    templateId,
    promptField,
    baseUrl,
    configError,
    modelField: String(env.AO_SSY_BATCH_MODEL_FIELD || '').trim(),
    sizeField: String(env.AO_SSY_BATCH_SIZE_FIELD || '').trim(),
    promptModeField: String(env.AO_SSY_BATCH_PROMPT_MODE_FIELD || '').trim(),
    fixedPromptMode: env.AO_SSY_BATCH_FIXED_PROMPT_MODE === 'optimize' ? 'optimize' : 'passthrough',
    fixedModel: String(env.AO_SSY_BATCH_FIXED_MODEL || '').trim(),
    fixedSize: String(env.AO_SSY_BATCH_FIXED_SIZE || '').trim(),
    maxItems: positiveInt(env.AO_SSY_BATCH_MAX_ITEMS, DEFAULT_MAX_ITEMS, 100),
    artifactHosts: String(env.AO_SSY_BATCH_ARTIFACT_HOSTS || 'aliyuncs.com,shengsuanyun.com')
      .split(',').map((value) => value.trim().toLowerCase()).filter(Boolean),
  };
}

function normalizeDate(value, fallbackMs) {
  if (typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value || ''))) {
    const number = Number(value);
    const millis = number < 1_000_000_000_000 ? number * 1000 : number;
    if (Number.isFinite(millis)) return new Date(millis).toISOString();
  }
  const millis = Date.parse(String(value || ''));
  return new Date(Number.isFinite(millis) ? millis : fallbackMs).toISOString();
}

function stableDigest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeItems(items, maxItems) {
  if (!Array.isArray(items) || items.length < 1) {
    throw new BatchApiError(400, 'invalid_items', '至少选择 1 条提示词');
  }
  if (items.length > maxItems) {
    throw new BatchApiError(400, 'too_many_items', `单批最多 ${maxItems} 条提示词`);
  }
  const ids = new Set();
  return items.map((item, index) => {
    const promptId = typeof item?.promptId === 'string' ? item.promptId.trim() : '';
    // 空白只用于判空；真正提交保持原始字符串逐字符不变。“passthrough”不能在 AO 这一层先 trim。
    const prompt = typeof item?.prompt === 'string' ? item.prompt : '';
    const title = typeof item?.title === 'string' ? item.title.trim().slice(0, 300) : '';
    if (!promptId || promptId.length > 200) throw new BatchApiError(400, 'invalid_item', `第 ${index + 1} 条缺少合法 promptId`);
    if (ids.has(promptId)) throw new BatchApiError(400, 'duplicate_item', `重复选择了提示词 ${promptId}`);
    if (!prompt.trim()) throw new BatchApiError(400, 'invalid_item', `第 ${index + 1} 条提示词为空`);
    if (prompt.length > MAX_PROMPT_CHARS) throw new BatchApiError(400, 'prompt_too_long', `第 ${index + 1} 条提示词超过 ${MAX_PROMPT_CHARS} 字符`);
    ids.add(promptId);
    return { promptId, prompt, title };
  });
}

function normalizeGenerationConfig(input, config) {
  const value = input && typeof input === 'object' ? input : {};
  const promptMode = config.promptModeField
    ? (value.promptMode === 'optimize' ? 'optimize' : 'passthrough')
    : config.fixedPromptMode;
  if (promptMode === 'optimize' && !config.promptModeField) {
    // 模板本身固定执行提示词整理，不需要也没有可填写的 mode 字段。只有客户端试图
    // 把它伪装成 passthrough 时才拒绝，不能让 UI 声称“原样”而上游实际做了改写。
    if (value.promptMode && value.promptMode !== 'optimize') {
      throw new BatchApiError(400, 'unsupported_prompt_mode', '当前胜算云模板会整理提示词，不支持原样透传');
    }
  }
  const model = typeof value.model === 'string' ? value.model.trim() : '';
  const size = typeof value.size === 'string' ? value.size.trim() : '';
  if (model && !config.modelField) throw new BatchApiError(400, 'unsupported_model', '当前批量模板不允许切换模型');
  if (size && !config.sizeField) throw new BatchApiError(400, 'unsupported_size', '当前批量模板不允许切换尺寸');
  const outputsPerPrompt = positiveInt(value.outputsPerPrompt, 1, 10);
  if (outputsPerPrompt !== 1) throw new BatchApiError(400, 'unsupported_outputs', '首期每条提示词固定生成 1 张');
  return { promptMode, model, size, outputsPerPrompt };
}

function makeRows(items, generation, config) {
  return items.map((item) => {
    const values = { [config.promptField]: item.prompt };
    if (config.promptModeField) values[config.promptModeField] = generation.promptMode;
    if (config.modelField && generation.model) values[config.modelField] = generation.model;
    if (config.sizeField && generation.size) values[config.sizeField] = generation.size;
    return { values };
  });
}

function costUnitsToCny(value) {
  if (value == null || value === '') return undefined;
  const raw = typeof value === 'number' ? value : Number(String(value));
  if (!Number.isFinite(raw) || raw < 0 || !Number.isSafeInteger(raw)) {
    throw new BatchApiError(502, 'invalid_upstream_cost', '胜算云返回了无法识别的费用金额');
  }
  return raw / 10_000_000;
}

function normalizeStatus(value, counts = {}) {
  const status = String(value || '').toLowerCase();
  if (['pending', 'queued', 'submitted'].includes(status)) return 'pending';
  if (['running', 'in_progress', 'processing'].includes(status)) return 'running';
  if (['cancelled', 'canceled'].includes(status)) return 'cancelled';
  if (['failed', 'error'].includes(status)) return Number(counts.completed || 0) > 0 ? 'partial' : 'failed';
  if (status === 'partial') return 'partial';
  if (['completed', 'succeeded', 'success'].includes(status)) return Number(counts.failed || 0) > 0 ? 'partial' : 'completed';
  return 'unknown';
}

function publicUpstreamError(status, body) {
  const message = typeof body?.message === 'string' ? body.message
    : typeof body?.error === 'string' ? body.error
      : typeof body?.error?.message === 'string' ? body.error.message : '';
  if (status === 401 || status === 403) return new BatchApiError(401, 'upstream_auth', '胜算云凭据无效或无权使用批量服务');
  if (status === 429) return new BatchApiError(429, 'upstream_rate_limit', '胜算云批量服务请求过多，请稍后重试');
  return new BatchApiError(502, 'upstream_error', message ? `胜算云批量服务：${message.slice(0, 240)}` : `胜算云批量服务返回 HTTP ${status}`);
}

function createStore(file) {
  const read = () => {
    try {
      const value = JSON.parse(readFileSync(file, 'utf8'));
      return value && typeof value === 'object' ? value : {};
    } catch { return {}; }
  };
  const write = (value) => {
    mkdirSync(dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    try { chmodSync(temp, 0o600); } catch {}
    renameSync(temp, file);
  };
  return { read, write };
}

export function createShengsuanyunBatchService(options) {
  const env = options.env || process.env;
  const config = readShengsuanyunBatchConfig(env);
  const fetchImpl = options.fetchImpl || fetch;
  const assetFetchImpl = options.assetFetchImpl || fetch;
  const getToken = options.getToken || (() => env.SHENGSUANYUN_API_KEY || '');
  const now = options.now || (() => Date.now());
  // 演示上游的 runId 在正式 LoomLoom 中不存在，两个环境绝不能共用历史文件；
  // 否则从演示切正式后，用户点旧任务会拿假 runId 请求真实服务并得到 404。
  const runFile = options.runFile || join(options.dataDir, '.local', 'batch-runs', config.demo ? 'shengsuanyun-demo.json' : 'shengsuanyun.json');
  const store = createStore(runFile);
  const quotes = new Map();
  let schemaCache = { at: 0, value: null };

  function pruneRecords(records) {
    let changed = false;
    for (const [id, record] of Object.entries(records)) {
      if (!TERMINAL_RUN_STATUSES.has(record?.status)) continue;
      const timestamp = Date.parse(record.updatedAt || record.createdAt || '');
      if (Number.isFinite(timestamp) && now() - timestamp > RUN_RETENTION_MS) { delete records[id]; changed = true; }
    }
    if (changed) store.write(records);
    return records;
  }

  function availability() {
    if (!config.enabled) return { available: false, reasonCode: 'feature_disabled', message: '胜算云批量出图尚未启用' };
    if (config.configError) return { available: false, reasonCode: 'invalid_config', message: config.configError };
    if (!config.templateId || !config.promptField) return { available: false, reasonCode: 'incomplete_config', message: '批量模板尚未完成配置' };
    if (!getToken()) return { available: false, reasonCode: 'missing_credentials', message: '请先在工作台 → 供应商中配置胜算云 API Key' };
    return { available: true };
  }

  function requireAvailable() {
    const a = availability();
    if (!a.available) throw new BatchApiError(a.reasonCode === 'missing_credentials' ? 401 : 503, a.reasonCode, a.message);
  }

  async function request(path, init = {}, timeoutMs = 20_000) {
    requireAvailable();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${config.baseUrl}/${String(path).replace(/^\/+/, '')}`, {
        ...init,
        signal: ctrl.signal,
        headers: {
          authorization: `Bearer ${getToken()}`,
          accept: 'application/json',
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...(init.headers || {}),
        },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw publicUpstreamError(response.status, body);
      return body;
    } catch (error) {
      if (error instanceof BatchApiError) throw error;
      if (error?.name === 'AbortError') throw new BatchApiError(504, 'upstream_timeout', '胜算云批量服务响应超时');
      throw new BatchApiError(502, 'upstream_unreachable', `无法连接胜算云批量服务：${String(error?.message || error).slice(0, 160)}`);
    } finally { clearTimeout(timer); }
  }

  async function schema() {
    if (schemaCache.value && now() - schemaCache.at < SCHEMA_TTL_MS) return schemaCache.value;
    const value = await request(`templates/${encodeURIComponent(config.templateId)}/schema`);
    schemaCache = { at: now(), value };
    return value;
  }

  async function capabilities({ verifySchema = true } = {}) {
    const a = availability();
    if (!a.available) return { ok: true, ...a };
    let schemaValue = null;
    if (verifySchema) {
      const value = await schema();
      schemaValue = value;
      const fields = Array.isArray(value?.fields) ? value.fields : Array.isArray(value?.data?.fields) ? value.data.fields : [];
      const names = new Set(fields.flatMap((field) => [field?.key, field?.label]).filter(Boolean));
      if (fields.length && !names.has(config.promptField)) {
        return { ok: true, available: false, reasonCode: 'schema_mismatch', message: `批量模板缺少提示词字段「${config.promptField}」` };
      }
    }
    return {
      ok: true,
      available: true,
      demo: config.demo,
      provider: { id: 'shengsuanyun', name: '胜算云', logo: '/sponsors/logo-shengsuanyun-icon.png', learnMoreUrl: 'https://www.shengsuanyun.com/?from=CH_QKH696UI' },
      template: {
        id: config.templateId,
        name: String(schemaValue?.name || schemaValue?.data?.name || '').trim() || undefined,
        promptModes: config.promptModeField ? ['passthrough', 'optimize'] : [config.fixedPromptMode],
        modelPolicy: config.modelField ? 'configurable' : config.fixedModel ? 'fixed' : 'template_managed',
      },
      limits: { maxPrompts: config.maxItems, maxOutputsPerPrompt: 1 },
      fixed: { ...(config.fixedModel ? { model: config.fixedModel } : {}), ...(config.fixedSize ? { size: config.fixedSize } : {}) },
      configurable: { model: !!config.modelField, size: !!config.sizeField },
    };
  }

  async function precheck(body) {
    requireAvailable();
    const items = normalizeItems(body?.items, config.maxItems);
    const generation = normalizeGenerationConfig(body?.config, config);
    const rows = makeRows(items, generation, config);
    const payload = { templateId: config.templateId, rows };
    const validation = await request('templates:validate-rows', { method: 'POST', body: JSON.stringify(payload) });
    if (validation?.valid === false || (Array.isArray(validation?.rowErrors) && validation.rowErrors.length)) {
      throw new BatchApiError(400, 'validation_failed', '部分提示词不符合批量模板要求', { rowErrors: validation.rowErrors || [], fileErrors: validation.fileErrors || [] });
    }
    const estimate = await request('templates:precheck-rows', { method: 'POST', body: JSON.stringify(payload) });
    const quoteId = randomUUID();
    const digest = stableDigest({ items, generation });
    const estimatedCost = costUnitsToCny(estimate?.estimatedTotalCost ?? estimate?.data?.estimatedTotalCost);
    const balance = estimate?.balanceCheck || estimate?.data?.balanceCheck || {};
    const availableBalance = costUnitsToCny(balance.availableBalance);
    const sufficient = balance.isSufficient !== false;
    quotes.set(quoteId, { digest, expiresAt: now() + QUOTE_TTL_MS, payload, items, generation, sufficient, idempotencyKey: '' });
    return { ok: true, quoteId, validUntil: new Date(now() + QUOTE_TTL_MS).toISOString(), currency: 'CNY', estimatedCost, availableBalance, sufficient, itemCount: items.length, warnings: [] };
  }

  async function submit(body) {
    requireAvailable();
    const quoteId = typeof body?.quoteId === 'string' ? body.quoteId : '';
    const idempotencyKey = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
    if (!idempotencyKey || idempotencyKey.length > 200) throw new BatchApiError(400, 'invalid_idempotency_key', '缺少合法的幂等键');
    const quote = quotes.get(quoteId);
    if (!quote || quote.expiresAt < now()) throw new BatchApiError(409, 'quote_expired', '费用预估已过期，请重新预估');
    if (!quote.sufficient) throw new BatchApiError(409, 'insufficient_balance', '胜算云余额不足，请充值后重新预估');
    const items = normalizeItems(body?.items, config.maxItems);
    const generation = normalizeGenerationConfig(body?.config, config);
    if (stableDigest({ items, generation }) !== quote.digest) throw new BatchApiError(409, 'quote_mismatch', '提示词或生成配置已经变化，请重新预估');
    // 同一个 quote 从第一次提交起就钉死幂等键。即使上游响应超时，客户端也只能拿原键重试，
    // 不能换一个新键让“结果未知”的请求再扣一次费。Node 的两个并发请求也会在首个 await 前完成这次占位。
    if (quote.idempotencyKey && quote.idempotencyKey !== idempotencyKey) {
      throw new BatchApiError(409, 'idempotency_mismatch', '这个费用预估已经使用另一幂等键提交，请用原请求恢复');
    }
    quote.idempotencyKey = idempotencyKey;
    const upstream = await request('templates:submit-rows', {
      method: 'POST',
      body: JSON.stringify({ ...quote.payload, idempotencyKey }),
    }, 30_000);
    const providerRunId = String(upstream?.runId || upstream?.data?.runId || '').trim();
    if (!providerRunId) throw new BatchApiError(502, 'invalid_upstream_response', '胜算云未返回批量任务 ID');
    const id = randomUUID();
    const createdAt = normalizeDate(upstream?.acceptedAt ?? upstream?.data?.acceptedAt, now());
    const records = pruneRecords(store.read());
    records[id] = {
      id, providerRunId, idempotencyKey, status: normalizeStatus(upstream?.status || upstream?.data?.status), createdAt, updatedAt: createdAt,
      items: items.map((item, sourceRowIndex) => ({ ...item, sourceRowIndex, promptHash: stableDigest(item.prompt) })),
      config: generation,
    };
    store.write(records);
    quotes.delete(quoteId);
    return { ok: true, run: { id, status: records[id].status, acceptedAt: createdAt, itemCount: items.length } };
  }

  function ownedRun(id) {
    const record = store.read()[id];
    if (!record) throw new BatchApiError(404, 'run_not_found', '没有找到这个批量任务');
    return record;
  }

  async function getRun(id) {
    const record = ownedRun(id);
    const value = await request(`batch/workflow-runs/${encodeURIComponent(record.providerRunId)}`);
    const data = value?.data || value;
    const counts = { completed: Number(data.completedTasks || 0), failed: Number(data.failedTasks || 0) };
    const status = normalizeStatus(data.status, counts);
    const records = store.read();
    if (records[id]) { records[id].status = status; records[id].updatedAt = new Date(now()).toISOString(); store.write(records); }
    return { ok: true, run: { id, status, total: Number(data.totalTasks || record.items.length), completed: counts.completed, failed: counts.failed, actualCost: costUnitsToCny(data.actualCost), currency: 'CNY', createdAt: record.createdAt, updatedAt: records[id]?.updatedAt } };
  }

  async function getItems(id) {
    const record = ownedRun(id);
    const value = await request(`batch/workflow-runs/${encodeURIComponent(record.providerRunId)}/tasks`);
    const tasks = Array.isArray(value) ? value : Array.isArray(value?.tasks) ? value.tasks : Array.isArray(value?.data?.tasks) ? value.data.tasks : [];
    return { ok: true, items: tasks.map((task) => {
      const sourceRowIndex = Number(task.sourceRowIndex);
      const source = record.items[sourceRowIndex];
      return { taskId: String(task.taskId || ''), sourceRowIndex, promptId: source?.promptId, title: source?.title, status: normalizeStatus(task.status), error: typeof task.errorMessage === 'string' ? task.errorMessage.slice(0, 500) : undefined, artifactCount: Number(task.artifactCount || 0) };
    }) };
  }

  async function providerArtifacts(record) {
    const value = await request(`batch/workflow-runs/${encodeURIComponent(record.providerRunId)}/artifacts`);
    return Array.isArray(value?.artifacts) ? value.artifacts : Array.isArray(value?.data?.artifacts) ? value.data.artifacts : [];
  }

  async function getArtifacts(id) {
    const record = ownedRun(id);
    const artifacts = await providerArtifacts(record);
    return { ok: true, artifacts: artifacts.map((artifact) => {
      const sourceRowIndex = Number(artifact.sourceRowIndex);
      const artifactId = String(artifact.artifactId || '');
      return {
        artifactId, sourceRowIndex, promptId: record.items[sourceRowIndex]?.promptId,
        // 签名 OSS URL 不下发浏览器：避免跳离 AO、泄露签名 query，也便于过期时重新向上游取。
        accessUrl: artifactId ? `/api/batch/providers/shengsuanyun/runs/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(artifactId)}/content` : undefined,
        inlineText: typeof artifact.inlineText === 'string' ? artifact.inlineText : undefined,
        mimeType: typeof artifact.mimeType === 'string' ? artifact.mimeType : undefined,
      };
    }) };
  }

  async function getArtifactContent(id, artifactId) {
    const record = ownedRun(id);
    const artifacts = await providerArtifacts(record);
    const artifact = artifacts.find((value) => String(value?.artifactId || '') === artifactId);
    if (!artifact) throw new BatchApiError(404, 'artifact_not_found', '没有找到这个任务产物');
    const rawUrl = typeof artifact.accessUrl === 'string' ? artifact.accessUrl : '';
    let url;
    try { url = new URL(rawUrl); } catch { throw new BatchApiError(502, 'invalid_artifact_url', '胜算云返回了无效的产物地址'); }
    const host = url.hostname.toLowerCase();
    const allowed = url.protocol === 'https:' && !url.username && !url.password
      && config.artifactHosts.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
    if (!allowed) throw new BatchApiError(502, 'untrusted_artifact_url', '胜算云产物地址不在允许的存储域名中');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await assetFetchImpl(url.href, { signal: controller.signal, redirect: 'follow' });
      if (!response.ok) throw new BatchApiError(502, 'artifact_download_failed', `胜算云产物下载失败：HTTP ${response.status}`);
      const declared = Number(response.headers.get('content-length') || 0);
      if (declared > MAX_ARTIFACT_BYTES) throw new BatchApiError(413, 'artifact_too_large', '产物超过本地代理下载上限');
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_ARTIFACT_BYTES) throw new BatchApiError(413, 'artifact_too_large', '产物超过本地代理下载上限');
      const mimeType = String(artifact.mimeType || response.headers.get('content-type') || 'application/octet-stream').split(';')[0];
      const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : mimeType.startsWith('text/') ? 'txt' : 'bin';
      const source = record.items[Number(artifact.sourceRowIndex)];
      const baseName = String(source?.title || source?.promptId || artifactId).replace(/[^一-龥a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'artifact';
      return { buffer, mimeType, filename: `${baseName}.${extension}` };
    } catch (error) {
      if (error instanceof BatchApiError) throw error;
      if (error?.name === 'AbortError') throw new BatchApiError(504, 'artifact_timeout', '胜算云产物下载超时');
      throw new BatchApiError(502, 'artifact_download_failed', '无法下载胜算云任务产物');
    } finally { clearTimeout(timer); }
  }

  function listRuns() {
    const records = Object.values(pruneRecords(store.read()))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, 20)
      .map((record) => ({
        id: record.id,
        parentRunId: record.parentRunId,
        status: record.status,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        itemCount: Array.isArray(record.items) ? record.items.length : 0,
      }));
    return { ok: true, runs: records };
  }

  async function precheckRetry(id) {
    const record = ownedRun(id);
    const taskResult = await getItems(id);
    const failedIndexes = new Set(taskResult.items.filter((item) => item.status === 'failed').map((item) => item.sourceRowIndex));
    const items = record.items.filter((item) => failedIndexes.has(item.sourceRowIndex)).map(({ promptId, title, prompt }) => ({ promptId, title, prompt }));
    if (!items.length) throw new BatchApiError(409, 'nothing_to_retry', '这个任务没有可重试的失败项');
    const result = await precheck({ items, config: record.config });
    const quote = quotes.get(result.quoteId);
    if (quote) quote.retryOf = id;
    return { ...result, retryOf: id };
  }

  async function submitRetry(id, body) {
    ownedRun(id);
    const quote = quotes.get(typeof body?.quoteId === 'string' ? body.quoteId : '');
    if (!quote || quote.retryOf !== id) throw new BatchApiError(409, 'retry_quote_mismatch', '重试费用预估与原任务不匹配，请重新预估');
    const result = await submit({
      quoteId: body.quoteId,
      idempotencyKey: body.idempotencyKey,
      items: quote.items,
      config: quote.generation,
    });
    const records = store.read();
    if (records[result.run.id]) {
      records[result.run.id].parentRunId = id;
      store.write(records);
    }
    return { ...result, run: { ...result.run, parentRunId: id } };
  }

  return { config, capabilities, precheck, submit, listRuns, getRun, getItems, getArtifacts, getArtifactContent, precheckRetry, submitRetry };
}

function sendError(res, error) {
  const known = error instanceof BatchApiError;
  res.status(known ? error.status : 500).json({ ok: false, code: known ? error.code : 'internal_error', error: known ? error.message : '批量服务发生内部错误', ...(known && error.details ? { details: error.details } : {}) });
}

export function registerShengsuanyunBatchRoutes(app, options) {
  const service = createShengsuanyunBatchService(options);
  const route = (handler) => async (req, res) => { try { await handler(req, res); } catch (error) { sendError(res, error); } };
  app.get('/api/batch/providers/shengsuanyun/capabilities', route(async (_req, res) => res.json(await service.capabilities())));
  app.post('/api/batch/providers/shengsuanyun/precheck', route(async (req, res) => res.json(await service.precheck(req.body))));
  app.post('/api/batch/providers/shengsuanyun/runs', route(async (req, res) => res.json(await service.submit(req.body))));
  app.get('/api/batch/providers/shengsuanyun/runs', route(async (_req, res) => res.json(service.listRuns())));
  app.get('/api/batch/providers/shengsuanyun/runs/:runId', route(async (req, res) => res.json(await service.getRun(req.params.runId))));
  app.get('/api/batch/providers/shengsuanyun/runs/:runId/items', route(async (req, res) => res.json(await service.getItems(req.params.runId))));
  app.get('/api/batch/providers/shengsuanyun/runs/:runId/artifacts', route(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await service.getArtifacts(req.params.runId));
  }));
  app.get('/api/batch/providers/shengsuanyun/runs/:runId/artifacts/:artifactId/content', route(async (req, res) => {
    const value = await service.getArtifactContent(req.params.runId, req.params.artifactId);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', value.mimeType);
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Disposition', `${disposition}; filename="artifact"; filename*=UTF-8''${encodeURIComponent(value.filename)}`);
    res.send(value.buffer);
  }));
  app.post('/api/batch/providers/shengsuanyun/runs/:runId/retry-precheck', route(async (req, res) => res.json(await service.precheckRetry(req.params.runId))));
  app.post('/api/batch/providers/shengsuanyun/runs/:runId/retry-failed', route(async (req, res) => res.json(await service.submitRetry(req.params.runId, req.body))));
  return service;
}
