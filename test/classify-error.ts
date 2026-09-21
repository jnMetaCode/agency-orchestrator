/**
 * 引擎的重试分类（executor.classifyError）。错分的代价是真金白银和真时间：
 *  - 把**不会变好**的错误当成可重试 → 鉴权失败要等两分半钟（CLI 退避 5/10/20/40/80s）才告诉用户；
 *  - 把**会变好**的错误当成不可重试 → 一次 429 / 502 就让整条已经跑了一半的工作流失败。
 * 所以两个方向都钉。消息样本取自各连接器真实的报错格式。
 */
import { classifyError, explicitHttpStatus } from '../src/core/executor.js';

let passed = 0;
let failed = 0;
function is(msg: string, want: ReturnType<typeof classifyError>, why: string): void {
  const got = classifyError(new Error(msg));
  if (got === want) { console.log(`  ✅ ${why}`); passed++; }
  else { console.log(`  ❌ ${why}（期望 ${want}，实际 ${got}）← ${msg.slice(0, 90)}`); failed++; }
}
function assert(c: boolean, m: string): void {
  if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; }
}

console.log('\n─── 不会变好的：不重试 ───');
is('Claude Code API 错误: API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}', 'non_retryable',
  'claude-code 鉴权失败（此前因含「API 错误」被当成服务端故障重试五次）');
is('API error 400: {"error":{"message":"failed to generate: invalid parameter max_tokens"}}', 'non_retryable',
  '400 正文里带 generate（含 "rate"）不是限速');
is('API error 400: content moderation rejected the request', 'non_retryable', '400 内容审核拒绝（moderation 含 "rate"）');
is('API error 403: access_denied 该分组不放行', 'non_retryable', '403');
is('API error 402: insufficient balance', 'non_retryable', '402 余额不足');
is('API error 404: model not found', 'non_retryable', '404');
is('API error 503: {"error":{"code":"model_not_found","message":"分组 default 下无可用渠道"}}', 'non_retryable', '503 但其实是「无可用渠道」——账号配置问题，排在状态码判定之前');
is('模板变量未定义: {{x}}', 'non_retryable', '普通逻辑错误');

console.log('\n─── 会变好的：照常重试 ───');
is('API error 429: {"error":{"message":"Rate limit reached"}}', 'rate_limit', '429');
is('Claude Code API 错误: API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}}', 'rate_limit', 'claude-code 的 429');
is('API stream error: rate limit exceeded, please slow down', 'rate_limit', '没有状态码、正文说 rate limit');
is('请求过于频繁，请稍后再试', 'rate_limit', '中文限流文案');
is('API error 502: Bad Gateway', 'server_error', '502');
is('Claude Code API 错误: API Error: 529 {"type":"error","error":{"type":"overloaded_error"}}', 'server_error', 'Anthropic 529 过载');
is('Claude Code API 错误: API Error: Connection error.', 'server_error', 'CLI 的 API 错误但没给状态码 → 保持原来的可重试');
is('API error 408: request timeout', 'connection', '408');
is('streaming terminated (已收到 1200 字符): socket hang up', 'connection', '流中断');
is('超时 (600000ms)，可用 --timeout 或 YAML llm.timeout 延长', 'connection', 'withTimeout 的中文超时');
is('stream stalled: 90s 内没有新数据', 'connection', '停顿检测');

console.log('\n─── 状态码提取不被正文数字带偏 ───');
assert(explicitHttpStatus('API error 401: x') === 401, '「API error 401」');
assert(explicitHttpStatus('API Error: 503 upstream') === 503, '「API Error: 503」');
assert(explicitHttpStatus('请求失败 HTTP 502') === 502, '「HTTP 502」');
assert(explicitHttpStatus('超时 (450000ms)') === undefined, '「450000ms」不是状态码');
assert(explicitHttpStatus('error: 500ms budget exceeded') === undefined, '「error: 500ms」不是状态码');
assert(explicitHttpStatus('error: max 512 tokens allowed') === undefined, '「512 tokens」不是状态码');
assert(explicitHttpStatus('一切正常') === undefined, '没有就是 undefined');

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed > 0 ? 1 : 0);
