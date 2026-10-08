#!/usr/bin/env node
/**
 * 胜算云 LoomLoom 批量接口只读/预检探针。
 *
 * 会调用 health、schema、validate-rows、precheck-rows；不会调用 submit-rows，
 * 因而不会创建生成任务。输出只包含经过筛选的摘要，不打印 Token 或完整响应。
 */
import { pathToFileURL } from 'node:url';

const DEFAULT_BASE_URL = 'https://loomloom.shengsuanyun.com/loom/v1';
const DEFAULT_TIMEOUT_MS = 20_000;

export class ProbeError extends Error {
  constructor(code, message, report = null) {
    super(message);
    this.name = 'ProbeError';
    this.code = code;
    this.report = report;
  }
}

function requireValue(value, name) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new ProbeError('missing_config', `缺少环境变量 ${name}`);
  return normalized;
}

function normalizeBaseUrl(value) {
  const raw = String(value || DEFAULT_BASE_URL).replace(/\/+$/, '');
  let url;
  try { url = new URL(raw); } catch { throw new ProbeError('invalid_config', 'AO_SSY_BATCH_BASE_URL 不是合法 URL'); }
  if (url.protocol !== 'https:') throw new ProbeError('invalid_config', 'AO_SSY_BATCH_BASE_URL 必须使用 HTTPS');
  return { value: raw, display: `${url.origin}${url.pathname}` };
}

function fieldsFromSchema(value) {
  if (Array.isArray(value?.fields)) return value.fields;
  if (Array.isArray(value?.data?.fields)) return value.data.fields;
  return [];
}

function safeMessage(value, token) {
  return String(value || '')
    .replaceAll(token, '[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:token|key|signature|authorization)=)[^&\s]+/gi, '$1[REDACTED]')
    .slice(0, 240);
}

function safeCost(value) {
  if (value == null || value === '') return null;
  const amount = typeof value === 'number' ? value : Number(String(value));
  return Number.isSafeInteger(amount) && amount >= 0 ? amount / 10_000_000 : null;
}

function validationSummary(value) {
  const data = value?.data && typeof value.data === 'object' ? value.data : value;
  const rowErrors = Array.isArray(data?.rowErrors) ? data.rowErrors : [];
  const fileErrors = Array.isArray(data?.fileErrors) ? data.fileErrors : [];
  return {
    valid: data?.valid !== false && rowErrors.length === 0 && fileErrors.length === 0,
    rowErrorCount: rowErrors.length,
    fileErrorCount: fileErrors.length,
  };
}

/** Run the probe. Dependency injection keeps it testable without the network. */
export async function runProbe({ env = process.env, fetchImpl = fetch, now = () => new Date(), timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const token = requireValue(env.SHENGSUANYUN_API_KEY, 'SHENGSUANYUN_API_KEY');
  const templateId = requireValue(env.AO_SSY_BATCH_TEMPLATE_ID ?? 'text-image-v1', 'AO_SSY_BATCH_TEMPLATE_ID');
  const promptField = requireValue(env.AO_SSY_BATCH_PROMPT_FIELD ?? (templateId === 'text-image-v1' ? '图片提示词' : ''), 'AO_SSY_BATCH_PROMPT_FIELD');
  const base = normalizeBaseUrl(env.AO_SSY_BATCH_BASE_URL);
  const report = {
    ok: false,
    mode: 'precheck_only',
    createsGenerationTask: false,
    checkedAt: now().toISOString(),
    endpoint: base.display,
    templateId,
    promptField,
    stages: {},
  };

  async function request(stage, path, init = {}) {
    if (new URL(base.value).pathname.replace(/\/$/, '') === '/loom/v1') {
      const templatePath = `officialTemplates/${encodeURIComponent(templateId)}`;
      if (path === 'health') path = 'users/me/balance';
      else if (stage === 'schema') path = `${templatePath}/schema`;
      else if (stage === 'validate-rows' || stage === 'precheck-rows') {
        path = `${templatePath}:${stage === 'validate-rows' ? 'validateRows' : 'precheckRows'}`;
        const { templateId, ...body } = JSON.parse(init.body);
        init = { ...init, body: JSON.stringify({ ...body, rows: body.rows.map(row => row.values) }) };
      }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${base.value}/${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          ...(init.body ? { 'content-type': 'application/json' } : {}),
        },
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const upstream = body?.message || body?.error?.message || body?.error || '';
        const generic = response.status === 401 || response.status === 403 ? '凭据无效或没有模板权限'
          : response.status === 429 ? '请求过于频繁，请稍后重试'
            : `上游返回 HTTP ${response.status}`;
        throw new ProbeError('upstream_error', upstream ? `${generic}：${safeMessage(upstream, token)}` : generic, report);
      }
      if (!body || typeof body !== 'object') throw new ProbeError('invalid_response', `${stage} 返回的不是 JSON 对象`, report);
      return body;
    } catch (error) {
      if (error instanceof ProbeError) throw error;
      if (error?.name === 'AbortError') throw new ProbeError('timeout', `${stage} 在 ${timeoutMs}ms 内没有响应`, report);
      throw new ProbeError('network_error', `${stage} 请求失败：${safeMessage(error?.message || error, token)}`, report);
    } finally { clearTimeout(timer); }
  }

  const health = await request('health', 'health');
  report.stages.health = { ok: true, status: String(health?.status || health?.data?.status || 'reachable').slice(0, 80) };

  const schema = await request('schema', `templates/${encodeURIComponent(templateId)}/schema`);
  const fields = fieldsFromSchema(schema);
  const matched = fields.find((field) => field?.key === promptField || field?.label === promptField);
  report.stages.schema = {
    ok: Boolean(matched),
    fieldCount: fields.length,
    promptFieldMatchedBy: matched?.key === promptField ? 'key' : matched?.label === promptField ? 'label' : null,
  };
  if (!matched) throw new ProbeError('schema_mismatch', `模板 Schema 中找不到提示词字段「${promptField}」`, report);

  // 固定的无害样例仅用于字段校验和费用预估，不提交生成。
  const values = { [promptField]: 'A simple blue circle on a white background.' };
  if (templateId === 'text-image-v1') values[env.AO_SSY_BATCH_SIZE_FIELD || '图片比例'] = env.AO_SSY_BATCH_FIXED_SIZE || '1:1';
  const payload = { templateId, rows: [{ values }] };
  const validation = await request('validate-rows', 'templates:validate-rows', { method: 'POST', body: JSON.stringify(payload) });
  report.stages.validation = validationSummary(validation);
  if (!report.stages.validation.valid) throw new ProbeError('validation_failed', '探针样例未通过模板行校验', report);

  const estimate = await request('precheck-rows', 'templates:precheck-rows', { method: 'POST', body: JSON.stringify(payload) });
  const estimateData = estimate?.data && typeof estimate.data === 'object' ? estimate.data : estimate;
  const balance = estimateData?.balanceCheck || {};
  report.stages.precheck = {
    ok: true,
    currency: 'CNY',
    estimatedCost: safeCost(estimateData?.estimatedTotalCost),
    availableBalance: safeCost(balance?.availableBalance),
    sufficient: balance?.isSufficient !== false,
  };
  report.ok = true;
  return report;
}

export function formatProbeReport(report) {
  const precheck = report.stages?.precheck;
  const lines = [
    '胜算云批量接口探测报告',
    `结论：${report.ok ? '通过' : '未通过'}`,
    '模式：仅校验与预估，不创建生成任务',
    `服务：${report.endpoint}`,
    `模板：${report.templateId}`,
    `提示词字段：${report.promptField}`,
  ];
  if (report.stages?.health) lines.push(`健康检查：${report.stages.health.ok ? '通过' : '失败'} (${report.stages.health.status})`);
  if (report.stages?.schema) lines.push(`Schema：${report.stages.schema.ok ? '通过' : '失败'} (${report.stages.schema.fieldCount} 个字段，按 ${report.stages.schema.promptFieldMatchedBy || '无匹配'} 匹配)`);
  if (report.stages?.validation) lines.push(`行校验：${report.stages.validation.valid ? '通过' : '失败'} (${report.stages.validation.rowErrorCount} 个行错误)`);
  if (precheck) lines.push(`费用预估：${precheck.estimatedCost == null ? '上游未返回' : `¥${precheck.estimatedCost}`}`, `余额：${precheck.availableBalance == null ? '上游未返回' : `¥${precheck.availableBalance}`}，${precheck.sufficient ? '充足' : '不足'}`);
  return lines.join('\n');
}

async function main() {
  const json = process.argv.slice(2).includes('--json');
  if (process.argv.slice(2).includes('--help')) {
    console.log('用法：npm run probe:ssy-batch -- [--json]\n只执行 health/schema/validate/precheck，不会提交生成任务。');
    return;
  }
  try {
    const report = await runProbe();
    console.log(json ? JSON.stringify(report, null, 2) : formatProbeReport(report));
  } catch (error) {
    const report = error instanceof ProbeError ? error.report : null;
    if (report) report.error = { code: error.code, message: error.message };
    console.error(json && report ? JSON.stringify(report, null, 2) : `探测失败 [${error?.code || 'unknown'}]：${error?.message || error}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
