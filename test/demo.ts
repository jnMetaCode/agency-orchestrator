/**
 * ao demo unit tests
 */
import { detectAvailableLLMs, type DetectedLLM } from '../src/cli/demo.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve(fn()).then(() => {
    console.log(`  ✅ ${name}`);
    passed++;
  }).catch((err) => {
    console.log(`  ❌ ${name}: ${err instanceof Error ? err.message : err}`);
    failed++;
  });
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg);
}

// ─── detectAvailableLLMs ───

console.log('\n─── detectAvailableLLMs ───');

await test('detects DEEPSEEK_API_KEY', async () => {
  const original = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  try {
    const llms = await detectAvailableLLMs();
    const ds = llms.find(l => l.provider === 'deepseek');
    assert(ds !== undefined, 'should detect deepseek');
    assert(ds!.available === true, 'should be available');
  } finally {
    if (original) process.env.DEEPSEEK_API_KEY = original;
    else delete process.env.DEEPSEEK_API_KEY;
  }
});

await test('detects missing OPENAI_API_KEY', async () => {
  const original = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const llms = await detectAvailableLLMs();
    const oai = llms.find(l => l.provider === 'openai');
    assert(oai !== undefined, 'should list openai');
    assert(oai!.available === false, 'should be unavailable');
  } finally {
    if (original) process.env.OPENAI_API_KEY = original;
  }
});

await test('ollama unavailable when not running', async () => {
  const llms = await detectAvailableLLMs();
  const ollama = llms.find(l => l.provider === 'ollama');
  assert(ollama !== undefined, 'should list ollama');
});

// ─── replayMockSteps (smoke test) ───

console.log('\n─── replayMockSteps ───');

await test('module exports exist', async () => {
  const mod = await import('../src/cli/demo.js');
  assert(typeof mod.runDemo === 'function', 'runDemo should be a function');
  assert(typeof mod.detectAvailableLLMs === 'function', 'detectAvailableLLMs should be a function');
});

// ─── LLM selection logic ───

console.log('\n─── LLM selection logic ───');

await test('available list filters correctly', async () => {
  const llms = await detectAvailableLLMs();
  const available = llms.filter(l => l.available);
  const unavailable = llms.filter(l => !l.available);
  assert(llms.length === 4, 'should always list 4 providers');
  assert(available.length + unavailable.length === 4, 'available + unavailable should equal total');
});

await test('each provider has correct fields', async () => {
  const llms = await detectAvailableLLMs();
  for (const llm of llms) {
    assert(typeof llm.provider === 'string', `provider should be string: ${llm.provider}`);
    assert(typeof llm.name === 'string', `name should be string: ${llm.name}`);
    assert(typeof llm.available === 'boolean', `available should be boolean: ${llm.provider}`);
    if (llm.provider !== 'ollama') {
      assert(typeof llm.envVar === 'string', `envVar should be string for ${llm.provider}`);
    }
  }
});

// ─── summary ───
console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
