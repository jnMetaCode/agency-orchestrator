#!/usr/bin/env node
// 把 schemas/workflow.schema.json 里 llm.provider 的补全候选同步成引擎注册表里的全部 provider。
// 新接一家供应商后跑一次：npm run build && node scripts/sync-schema-providers.mjs
// （test/workflow-schema.ts 会在候选与注册表对不上时失败并提示跑这个脚本。）
import { readFileSync, writeFileSync } from 'node:fs';
import { CLI_PROVIDER_IDS } from '../dist/providers/detect.js';
import { API_PROVIDERS, ANTHROPIC_PROVIDERS } from '../dist/connectors/api-providers.js';

const file = new URL('../schemas/workflow.schema.json', import.meta.url);
const schema = JSON.parse(readFileSync(file, 'utf-8'));
const ids = [...new Set([...CLI_PROVIDER_IDS, 'ollama', 'claude', ...API_PROVIDERS.map((p) => p.id), ...ANTHROPIC_PROVIDERS.map((p) => p.id)])];
for (const llm of [schema.properties.llm, schema.properties.verify_llm, schema.properties.steps.items.properties.llm]) {
  llm.properties.provider.examples = ids;
}
writeFileSync(file, JSON.stringify(schema, null, 2) + '\n', 'utf-8');
console.log(`llm.provider 候选已同步：${ids.length} 个`);
