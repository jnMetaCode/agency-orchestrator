import assert from 'node:assert/strict';
import { createConnector } from '../src/connectors/factory.js';
import { API_PROVIDER_MAP } from '../src/connectors/api-providers.js';

const originalFetch = globalThis.fetch;
const spec = API_PROVIDER_MAP.beichenapi;
assert.equal(spec.defaultBaseUrl, 'https://api.beichenapi.com/v1');
assert.equal(spec.defaultModel, 'gpt-6.1-sol');
globalThis.fetch = (async (url, init) => {
  assert.equal(String(url), 'https://api.beichenapi.com/v1/chat/completions');
  assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-beichen-key');
  const body = JSON.parse(String(init?.body));
  assert.equal(body.model, spec.defaultModel);
  assert.equal(body.stream, true);
  assert(body.messages.some((message: any) => message.content === '你好'));
  return new Response('data: {"choices":[{"delta":{"content":"连接成功"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
}) as typeof fetch;
try {
  const config = { provider: 'beichenapi', api_key: 'test-beichen-key', model: spec.defaultModel };
  const response = await createConnector(config).chat('测试', '你好', config);
  assert.equal(response.content, '连接成功');
  console.log('北辰 API：默认端点、Bearer 鉴权、模型、请求格式及 SSE 响应检查通过');
} finally {
  globalThis.fetch = originalFetch;
}
