/** Live, billable smoke test. Run with BEICHENAPI_API_KEY set in your shell. */
import { createConnector } from '../src/connectors/factory.js';
const key = process.env.BEICHENAPI_API_KEY?.trim();
if (!key) throw new Error('请先设置 BEICHENAPI_API_KEY（不要将密钥写入文件）');
const base = (process.env.BEICHENAPI_BASE_URL || 'https://api.beichenapi.com/v1').replace(/\/+$/, '');
try {
  const response = await fetch(`${base}/models`, {
    headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000),
  });
  console.log(`模型列表 HTTP ${response.status}`);
  if (!response.ok) throw new Error(`模型列表请求失败 HTTP ${response.status}`);
  const json = await response.json() as { data?: Array<{ id: string }> };
  const models = (json.data || []).map(item => item.id).filter(id => typeof id === 'string');
  console.log('可用模型：', models);
  const requested = process.env.BEICHENAPI_MODEL;
  const model = requested || models.find(id => /claude.*haiku/i.test(id)) || models.find(id => /claude.*sonnet/i.test(id));
  if (!model) throw new Error('未自动选到 Claude 模型；请设置 BEICHENAPI_MODEL 为列表中的模型后重试');
  if (!models.includes(model)) throw new Error('指定模型不在该密钥返回的模型列表中');
  console.log(`通过项目 OpenAI 兼容连接器测试：${model}`);
  const config = { provider: 'beichenapi', api_key: key, base_url: base, model, max_tokens: 128, timeout: 60_000 };
  const result = await createConnector(config).chat('Reply briefly.', 'Reply with OK only.', config);
  if (!result.content.trim()) throw new Error('接口返回空内容');
  console.log('聊天成功：', result.content);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.split(key).join('[REDACTED]'));
  process.exitCode = 1;
}
