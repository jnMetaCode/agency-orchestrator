/**
 * ao init 首跑向导文案单测（纯函数 buildFirstRunGuidance）。
 */
import { buildFirstRunGuidance } from '../src/cli/demo.js';
import type { DetectedLLM } from '../src/cli/demo.js';

let passed = 0, failed = 0;
function assert(c: boolean, msg: string): void { if (!c) throw new Error(msg); }
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.log(`  ❌ ${name}: ${e instanceof Error ? e.message : e}`); failed++; }
}

const ready: DetectedLLM[] = [
  { provider: 'claude-code', name: 'Claude Code (Max/Pro 会员)', available: true },
  { provider: 'ollama', name: 'Ollama (本地)', available: false },
  { provider: 'deepseek', name: 'DeepSeek', available: false, envVar: 'DEEPSEEK_API_KEY' },
];
const none: DetectedLLM[] = [
  { provider: 'claude-code', name: 'Claude Code (Max/Pro 会员)', available: false },
  { provider: 'ollama', name: 'Ollama (本地)', available: false },
];

console.log('\n=== ao init 首跑向导 ===');

test('有可用 provider → 引导直接 demo/compose，并列出已检测项', () => {
  const g = buildFirstRunGuidance(ready, 'zh');
  assert(g.includes('已就绪'), '应提示已就绪');
  assert(g.includes('Claude Code'), '应列出检测到的 provider');
  assert(g.includes('ao demo'), '应引导 ao demo');
  assert(g.includes('ao compose'), '应引导 ao compose');
  assert(!g.includes('还没检测到'), '就绪时不应出现未就绪文案');
});

test('无可用 provider → 给出免 key / API key 两条获取路径', () => {
  const g = buildFirstRunGuidance(none, 'zh');
  assert(g.includes('还没检测到'), '应提示未就绪');
  assert(g.includes('claude-code') || g.includes('Ollama'), '应给免 key 路径');
  assert(g.includes('--provider'), '应给 ao init 配置 API key 的路径');
});

test('英文 lang 输出英文文案', () => {
  const g = buildFirstRunGuidance(ready, 'en');
  assert(g.includes('Ready to go'), '英文就绪文案');
  assert(g.includes('ao demo'), '应引导 ao demo');
});

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
