/**
 * 端到端测试 — 用 Mock Connector 跑完整工作流
 * 验证: 解析 → DAG → 执行 → 变量传递 → 输出保存
 */
import { resolve } from 'node:path';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { parseWorkflow, validateWorkflow } from '../src/core/parser.js';
import { buildDAG } from '../src/core/dag.js';
import { executeDAG, type ExecutorOptions } from '../src/core/executor.js';
import { saveResults } from '../src/output/reporter.js';
import type { LLMConnector, LLMResult, LLMConfig } from '../src/types.js';

const agentsDir = [
  resolve(import.meta.dirname!, '../node_modules/agency-agents-zh'),
  resolve(import.meta.dirname!, '../agency-agents-zh'),
  resolve(import.meta.dirname!, '../../agency-agents-zh'),
].find(d => existsSync(d)) || resolve(import.meta.dirname!, '../../agency-agents-zh');

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

/**
 * Mock LLM — 根据 system prompt 中的角色信息返回模拟内容
 * 模拟真实 LLM 的行为：读 system prompt，根据 user message 生成回复
 */
class MockConnector implements LLMConnector {
  callLog: { system: string; user: string }[] = [];

  async chat(systemPrompt: string, userMessage: string, _config: LLMConfig): Promise<LLMResult> {
    this.callLog.push({ system: systemPrompt.slice(0, 100), user: userMessage.slice(0, 100) });

    // 模拟不同角色的输出
    let content: string;

    if (userMessage.includes('分析以下 PRD') || userMessage.includes('分析')) {
      content = '## 需求分析\n1. 核心需求：用户登录系统\n2. 目标用户：企业员工\n3. 风险：安全性要求高\n4. 指标：登录成功率 > 99%';
    } else if (userMessage.includes('技术可行性')) {
      content = '## 技术评估\n- 可行性：高\n- 推荐架构：OAuth 2.0 + JWT\n- 复杂度：中等\n- 风险：需要处理 token 刷新';
    } else if (userMessage.includes('用户体验')) {
      content = '## 设计评估\n- UX 风险：密码找回流程过长\n- 建议：增加生物识别登录\n- 需验证：用户对 SSO 的接受度';
    } else if (userMessage.includes('综合') || userMessage.includes('最终')) {
      content = '## 评审结论\n结论：通过\n\n### 必须解决\n1. 增加生物识别方案\n2. 优化 token 刷新机制\n\n### 下一步\n- 进入技术设计阶段';
    } else {
      content = `[Mock Response] Received ${userMessage.length} chars`;
    }

    // 模拟延迟
    await new Promise(r => setTimeout(r, 10));

    return {
      content,
      usage: { input_tokens: systemPrompt.length + userMessage.length, output_tokens: content.length },
    };
  }
}

// ─── E2E: product-review workflow ───
console.log('\n=== E2E: product-review 完整工作流 ===');

await test('解析 + 校验 + 构建 DAG', () => {
  const wf = parseWorkflow(resolve(import.meta.dirname!, '../workflows/product-review.yaml'));
  const errors = validateWorkflow(wf);
  assert(errors.length === 0, `校验失败: ${errors.join(', ')}`);
  const dag = buildDAG(wf);
  assert(dag.levels.length === 3, '应有 3 层');
});

await test('执行完整工作流（Mock LLM）', async () => {
  const wf = parseWorkflow(resolve(import.meta.dirname!, '../workflows/product-review.yaml'));
  const dag = buildDAG(wf);
  const mock = new MockConnector();

  const inputs = new Map([
    ['prd_content', '# 用户登录系统 PRD\n## 背景\n企业需要统一的身份认证系统...'],
  ]);

  const result = await executeDAG(dag, {
    connector: mock,
    agentsDir,
    llmConfig: wf.llm,
    concurrency: wf.concurrency || 2,
    inputs,
  });

  result.name = wf.name;

  // 验证所有步骤完成
  assert(result.steps.length === 4, `应有 4 步结果，实际: ${result.steps.length}`);
  assert(result.steps.every(s => s.status === 'completed'), '所有步骤应完成');
  assert(result.success === true, '工作流应成功');

  // 验证 LLM 被调用了 4 次
  assert(mock.callLog.length === 4, `LLM 应被调用 4 次，实际: ${mock.callLog.length}`);
});

await test('变量传递: analyze 输出被 tech_review 和 design_review 接收', async () => {
  const wf = parseWorkflow(resolve(import.meta.dirname!, '../workflows/product-review.yaml'));
  const dag = buildDAG(wf);
  const mock = new MockConnector();

  const inputs = new Map([['prd_content', 'Test PRD']]);

  await executeDAG(dag, {
    connector: mock,
    agentsDir,
    llmConfig: wf.llm,
    concurrency: 2,
    inputs,
  });

  // tech_review 的 user message 应包含 analyze 的输出
  const techCall = mock.callLog[1]; // 第 2 次调用
  assert(techCall.user.includes('需求分析') || techCall.user.includes('核心需求'),
    'tech_review 应收到 analyze 的输出');
});

await test('并行: tech_review 和 design_review 在同一批执行', async () => {
  const wf = parseWorkflow(resolve(import.meta.dirname!, '../workflows/product-review.yaml'));
  const dag = buildDAG(wf);
  const callTimes: { id: string; start: number; end: number }[] = [];

  const mock: LLMConnector = {
    async chat(sys, msg, cfg) {
      const start = Date.now();
      await new Promise(r => setTimeout(r, 50)); // 模拟 50ms 延迟
      const end = Date.now();
      // 通过 msg 长度区分步骤（hack but works for test）
      callTimes.push({ id: `call-${callTimes.length}`, start, end });
      return { content: 'mock output', usage: { input_tokens: 100, output_tokens: 50 } };
    }
  };

  await executeDAG(dag, {
    connector: mock,
    agentsDir,
    llmConfig: wf.llm,
    concurrency: 2,
    inputs: new Map([['prd_content', 'Test']]),
  });

  // 第 2 和第 3 次调用（tech + design）的开始时间应接近
  assert(callTimes.length === 4, `应有 4 次调用`);
  const diff = Math.abs(callTimes[1].start - callTimes[2].start);
  assert(diff < 30, `并行步骤开始时间差应 < 30ms，实际: ${diff}ms`);
});

await test('结果保存到文件', async () => {
  const wf = parseWorkflow(resolve(import.meta.dirname!, '../workflows/product-review.yaml'));
  const dag = buildDAG(wf);
  const mock = new MockConnector();

  const result = await executeDAG(dag, {
    connector: mock,
    agentsDir,
    llmConfig: wf.llm,
    concurrency: 2,
    inputs: new Map([['prd_content', 'Test PRD']]),
  });
  result.name = '测试输出';

  const outputDir = resolve(import.meta.dirname!, '../.test-output');
  const dir = saveResults(result, outputDir);

  // 验证文件存在
  assert(existsSync(dir), `输出目录应存在: ${dir}`);
  assert(existsSync(resolve(dir, 'summary.md')), 'summary.md 应存在');
  assert(existsSync(resolve(dir, 'metadata.json')), 'metadata.json 应存在');
  assert(existsSync(resolve(dir, 'steps/1-analyze.md')), '步骤输出应存在');

  // 验证 metadata
  const meta = JSON.parse(readFileSync(resolve(dir, 'metadata.json'), 'utf-8'));
  assert(meta.name === '测试输出', 'metadata name 应正确');
  assert(meta.steps.length === 4, 'metadata 应有 4 步');
  assert(meta.success === true, 'metadata 应标记成功');

  // 清理
  rmSync(outputDir, { recursive: true });
});

// ─── E2E: 错误处理 ───
console.log('\n=== E2E: 错误处理 ===');

await test('某步失败时下游被跳过', async () => {
  const wf = parseWorkflow(resolve(import.meta.dirname!, '../workflows/product-review.yaml'));
  const dag = buildDAG(wf);

  let callCount = 0;
  const failingMock: LLMConnector = {
    async chat(_sys, _msg, _cfg) {
      callCount++;
      if (callCount === 1) {
        throw new Error('API error 500');
      }
      return { content: 'ok', usage: { input_tokens: 10, output_tokens: 5 } };
    }
  };

  const result = await executeDAG(dag, {
    connector: failingMock,
    agentsDir,
    llmConfig: { ...wf.llm, retry: 0 }, // 禁用重试
    concurrency: 2,
    inputs: new Map([['prd_content', 'Test']]),
  });

  assert(result.success === false, '工作流应失败');
  assert(result.steps[0].status === 'failed', '第 1 步应失败');
  // 后续步骤应被跳过
  const skipped = result.steps.filter(s => s.status === 'skipped');
  assert(skipped.length === 3, `应有 3 步被跳过，实际: ${skipped.length}`);
});

await test('重试机制：第 1 次失败第 2 次成功', async () => {
  const wf = parseWorkflow(resolve(import.meta.dirname!, '../workflows/product-review.yaml'));
  // 只用 1 个步骤测试
  wf.steps = [wf.steps[0]];
  const dag = buildDAG(wf);

  let callCount = 0;
  const flakyMock: LLMConnector = {
    async chat(_sys, _msg, _cfg) {
      callCount++;
      if (callCount === 1) throw new Error('429 rate limited');
      return { content: 'success after retry', usage: { input_tokens: 10, output_tokens: 20 } };
    }
  };

  const result = await executeDAG(dag, {
    connector: flakyMock,
    agentsDir,
    llmConfig: { ...wf.llm, retry: 2 },
    concurrency: 1,
    inputs: new Map([['prd_content', 'Test']]),
  });

  assert(result.success === true, '重试后应成功');
  assert(callCount === 2, `应调用 2 次（1 次失败 + 1 次成功），实际: ${callCount}`);
});

await test('缺少必填输入时模板引擎报错', async () => {
  const wf = parseWorkflow(resolve(import.meta.dirname!, '../workflows/product-review.yaml'));
  wf.steps = [wf.steps[0]]; // 只要第一步
  const dag = buildDAG(wf);
  const mock = new MockConnector();

  const result = await executeDAG(dag, {
    connector: mock,
    agentsDir,
    llmConfig: wf.llm,
    concurrency: 1,
    inputs: new Map(), // 空输入！
  });

  assert(result.success === false, '缺少输入应失败');
  assert(result.steps[0].status === 'failed', '第 1 步应失败');
  assert(result.steps[0].error!.includes('prd_content'), '错误应提到缺少的变量');
});

// ─── E2E: content-pipeline workflow ───
console.log('\n=== E2E: content-pipeline 工作流 ===');

await test('content-pipeline 完整执行', async () => {
  const wf = parseWorkflow(resolve(import.meta.dirname!, '../workflows/content-pipeline.yaml'));
  const errors = validateWorkflow(wf);
  assert(errors.length === 0, `校验失败: ${errors.join(', ')}`);

  const dag = buildDAG(wf);
  const mock = new MockConnector();

  const inputs = new Map([
    ['topic', 'AI 编程工具对比'],
    ['target_audience', '前端开发者'],
    ['platform', '公众号'],
  ]);

  const result = await executeDAG(dag, {
    connector: mock,
    agentsDir,
    llmConfig: wf.llm,
    concurrency: wf.concurrency || 2,
    inputs,
  });

  assert(result.success === true, '工作流应成功');
  assert(result.steps.length === 4, '应有 4 步');
  assert(result.steps.every(s => s.status === 'completed'), '所有步骤应完成');
  assert(mock.callLog.length === 4, `应调用 LLM 4 次`);
});

// ─── 回调测试 ───
console.log('\n=== E2E: 回调和事件 ===');

await test('onStepStart 和 onStepComplete 被正确调用', async () => {
  const wf = parseWorkflow(resolve(import.meta.dirname!, '../workflows/product-review.yaml'));
  const dag = buildDAG(wf);
  const mock = new MockConnector();

  const startEvents: string[] = [];
  const completeEvents: string[] = [];

  await executeDAG(dag, {
    connector: mock,
    agentsDir,
    llmConfig: wf.llm,
    concurrency: 2,
    inputs: new Map([['prd_content', 'Test']]),
    onStepStart: (node) => startEvents.push(node.step.id),
    onStepComplete: (node) => completeEvents.push(node.step.id),
  });

  assert(startEvents.length === 4, `应有 4 个 start 事件`);
  assert(completeEvents.length === 4, `应有 4 个 complete 事件`);
  assert(startEvents[0] === 'analyze', '第一个启动应是 analyze');
  assert(completeEvents[completeEvents.length - 1] === 'final_summary', '最后完成应是 final_summary');
});

// ─── API 错误检测与重试 ───
console.log('\n=== E2E: API 错误检测与重试 ===');

await test('ECONNRESET 等网络错误触发重试并最终成功', async () => {
  const wf = parseWorkflow(resolve(import.meta.dirname!, '../workflows/product-review.yaml'));
  wf.steps = [wf.steps[0]];
  const dag = buildDAG(wf);

  let callCount = 0;
  const flakyMock: LLMConnector = {
    async chat(_sys, _msg, _cfg) {
      callCount++;
      if (callCount === 1) throw new Error('API 错误: ECONNRESET');
      return { content: 'recovered after reset', usage: { input_tokens: 10, output_tokens: 20 } };
    }
  };

  const result = await executeDAG(dag, {
    connector: flakyMock,
    agentsDir,
    llmConfig: { ...wf.llm, retry: 2 },
    concurrency: 1,
    inputs: new Map([['prd_content', 'Test']]),
  });

  assert(result.success === true, 'ECONNRESET 重试后应成功');
  assert(callCount === 2, `应调用 2 次，实际: ${callCount}`);
});

await test('非重试错误直接失败不重试', async () => {
  const wf = parseWorkflow(resolve(import.meta.dirname!, '../workflows/product-review.yaml'));
  wf.steps = [wf.steps[0]];
  const dag = buildDAG(wf);

  let callCount = 0;
  const fatalMock: LLMConnector = {
    async chat(_sys, _msg, _cfg) {
      callCount++;
      throw new Error('Invalid API key');
    }
  };

  const result = await executeDAG(dag, {
    connector: fatalMock,
    agentsDir,
    llmConfig: { ...wf.llm, retry: 3 },
    concurrency: 1,
    inputs: new Map([['prd_content', 'Test']]),
  });

  assert(result.success === false, '非重试错误应直接失败');
  assert(callCount === 1, `不可重试错误应只调用 1 次，实际: ${callCount}`);
});

await test('失败摘要包含失败步骤和跳过步骤', async () => {
  const wf = parseWorkflow(resolve(import.meta.dirname!, '../workflows/product-review.yaml'));
  const dag = buildDAG(wf);

  const failingMock: LLMConnector = {
    async chat(_sys, _msg, _cfg) {
      throw new Error('test failure');
    }
  };

  const result = await executeDAG(dag, {
    connector: failingMock,
    agentsDir,
    llmConfig: { ...wf.llm, retry: 0 },
    concurrency: 2,
    inputs: new Map([['prd_content', 'Test']]),
  });

  const failedSteps = result.steps.filter(s => s.status === 'failed');
  const skippedSteps = result.steps.filter(s => s.status === 'skipped');
  assert(failedSteps.length >= 1, '应至少有 1 步失败');
  assert(skippedSteps.length >= 1, '应至少有 1 步被跳过');
  assert(failedSteps[0].error!.includes('test failure'), '错误信息应包含原始错误');
});

// ─── 结果 ───
console.log('\n' + '='.repeat(50));
console.log(`  E2E 测试: ${passed} 通过, ${failed} 失败 (共 ${passed + failed} 项)`);
if (failed === 0) {
  console.log('  全部通过!');
} else {
  process.exit(1);
}
console.log('='.repeat(50) + '\n');
