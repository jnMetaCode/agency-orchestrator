/**
 * 引擎的重试分类（executor.classifyError）。错分的代价是真金白银和真时间：
 *  - 把**不会变好**的错误当成可重试 → 鉴权失败要等两分半钟（CLI 退避 5/10/20/40/80s）才告诉用户；
 *  - 把**会变好**的错误当成不可重试 → 一次 429 / 502 就让整条已经跑了一半的工作流失败。
 * 所以两个方向都钉。消息样本取自各连接器真实的报错格式。
 */
import { classifyError, explicitHttpStatus } from '../src/core/executor.js';
import { endpointHint, isQuotaExhausted } from '../src/connectors/endpoint.js';

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

// #184：包月 plan 的额度用尽也回 429，但它跟限流是相反的两件事——重试一万次也一样。
// 真机报文（MiniMax 包月 key）：引擎按限流退避重试了一轮，最后还叫用户"稍后重试、降低并发"。
is('HTTP 429 已达到 Token Plan 用量上限：请升级 Token Plan 套餐或购买积分补充用量。 (2056)\n请求地址: POST https://api.minimax.cn/v1/chat/completions',
  'non_retryable', '#184: 429 但正文说「Token Plan 用量上限」→ 账单问题，不重试');
is('API error 429: {"error":{"type":"insufficient_quota","message":"You exceeded your current quota"}}',
  'non_retryable', '#184: OpenAI 的 insufficient_quota 也是 429，同样重试无用');
is('API error 429: {"error":{"message":"余额不足，请充值后重试"}}', 'non_retryable', '#184: 中文「余额不足」');
is('API error 429: {"error":{"message":"积分不足"}}', 'non_retryable', '#184: 中文「积分不足」');

console.log('\n─── 会变好的：照常重试 ───');
is('API error 429: {"error":{"message":"Rate limit reached"}}', 'rate_limit', '429');
is('Claude Code API 错误: API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}}', 'rate_limit', 'claude-code 的 429');
is('API stream error: rate limit exceeded, please slow down', 'rate_limit', '没有状态码、正文说 rate limit');
is('请求过于频繁，请稍后再试', 'rate_limit', '中文限流文案');
// 反向：真限流不许被当成额度问题吃掉——否则一次并发超限就让跑了一半的工作流直接失败
is('API error 429: {"error":{"message":"并发数超限，请降低并发后重试"}}', 'rate_limit', '#184 反向: 并发超限仍是限流，照常重试');
is('API error 429: {"error":{"message":"Rate limit reached for gpt-4o in organization org-x on requests per min (RPM): Limit 500"}}',
  'rate_limit', '#184 反向: OpenAI 的 RPM 限流文案里也有 limit，不能误判成额度耗尽');
is('API error 502: Bad Gateway', 'server_error', '502');
is('Claude Code API 错误: API Error: 529 {"type":"error","error":{"type":"overloaded_error"}}', 'server_error', 'Anthropic 529 过载');
is('Claude Code API 错误: API Error: Connection error.', 'server_error', 'CLI 的 API 错误但没给状态码 → 保持原来的可重试');
is('API error 408: request timeout', 'connection', '408');
is('streaming terminated (已收到 1200 字符): socket hang up', 'connection', '流中断');
is('超时 (600000ms)，可用 --timeout 或 YAML llm.timeout 延长', 'connection', 'withTimeout 的中文超时');
is('stream stalled: 90s 内没有新数据', 'connection', '停顿检测');

console.log('\n─── 429 的两种含义：提示文案要跟重试判定一致 ───');
{
  // 判定说"不重试"而文案还叫人"稍后重试"，用户就只会照文案办 —— 两者必须同源，所以钉在一起
  const quota = endpointHint(429, 'https://api.minimax.cn/v1/chat/completions', 'https://api.minimax.cn/v1',
    undefined, '已达到 Token Plan 用量上限：请升级 Token Plan 套餐或购买积分补充用量。');
  assert(/重试无用/.test(quota) && !/稍后重试/.test(quota), `额度耗尽的提示不许说"稍后重试"（实际：${quota.trim().slice(0, 70)}）`);
  assert(/充值|升级套餐/.test(quota), '告诉用户该干什么：充值/升级套餐/换一家');

  const throttled = endpointHint(429, 'https://x/v1/chat/completions', 'https://x/v1', undefined, 'Rate limit reached');
  assert(/稍后重试/.test(throttled) && !/重试无用/.test(throttled), '真限流照旧说"稍后重试、降低并发"');

  assert(isQuotaExhausted('已达到 Token Plan 用量上限') && !isQuotaExhausted('并发数超限'),
    'isQuotaExhausted 只认额度耗尽，不认并发超限');
}

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
