import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = process.env.AO_DATA_DIR || root;
const records = JSON.parse(readFileSync(resolve(dataDir, '.local/batch-runs/shengsuanyun.json'), 'utf8'));
const keys = JSON.parse(readFileSync(resolve(dataDir, '.local/web-keys.json'), 'utf8'));
const token = keys.shengsuanyun?.apiKey || process.env.SHENGSUANYUN_API_KEY;
const record = Object.values(records).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
if (!record || !token) throw new Error('没有已保存的批量任务或胜算云 Key');

// 仅输出字段结构以及状态/计数，不输出 Key、提示词、任务 ID 或下载地址。
function summary(value, depth = 0, key = '') {
  if (depth > 5) return '…';
  if (Array.isArray(value)) return { length: value.length, sample: value.length ? summary(value[0], depth + 1) : null };
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, child]) => [name, summary(child, depth + 1, name)]));
  if (/^(status|state|phase|totalTasks|completedTasks|failedTasks|total|completed|failed|rowIndex|sourceRowIndex|taskCount|successCount|failedCount)$/i.test(key)) return value;
  return value === null ? 'null' : typeof value;
}
for (const suffix of ['', '/resultRows', '/artifacts']) {
  try {
    const response = await fetch(`https://loomloom.shengsuanyun.com/loom/v1/users/me/runs/${encodeURIComponent(record.providerRunId)}${suffix}`, {
      headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
    });
    console.log(JSON.stringify({ query: suffix || '/detail', httpStatus: response.status, structure: response.ok ? summary(await response.json()) : undefined }, null, 2));
  } catch (error) { console.log(JSON.stringify({ query: suffix || '/detail', networkError: error.cause?.code || error.name })); }
}
