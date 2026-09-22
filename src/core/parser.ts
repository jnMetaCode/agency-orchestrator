/**
 * YAML → WorkflowDefinition 解析器
 */
import { readFileSync, existsSync } from 'node:fs';
import { CLI_PROVIDER_IDS } from '../providers/detect.js';
import { API_PROVIDER_MAP, ANTHROPIC_PROVIDER_MAP, VIDEO_PROVIDERS } from '../connectors/api-providers.js';
import { extractVariables } from './template.js';
import { evaluateCondition } from './condition.js';
import { isValidCharSpec } from './assert.js';
import yaml from 'js-yaml';
import type { WorkflowDefinition, StepDefinition } from '../types.js';
import { t } from '../i18n.js';
import { loadAgent, suggestRoles } from '../agents/loader.js';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 合法字段表，取自随包的 schemas/workflow.schema.json——它同时是编辑器补全的来源，改一处两边都变。
 * 读不到（极端情况：包被裁剪）就退化成不查未知键，而不是把所有工作流都判坏。
 */
function loadSchemaKeys(): { top: Set<string>; step: Set<string> } {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const candidate of [resolvePath(here, '../../schemas/workflow.schema.json'), resolvePath(here, '../schemas/workflow.schema.json')]) {
      if (!existsSync(candidate)) continue;
      const schema = JSON.parse(readFileSync(candidate, 'utf-8')) as { properties?: Record<string, unknown> & { steps?: { items?: { properties?: Record<string, unknown> } } } };
      return {
        top: new Set(Object.keys(schema.properties ?? {})),
        step: new Set(Object.keys(schema.properties?.steps?.items?.properties ?? {})),
      };
    }
  } catch { /* 退化为不查 */ }
  return { top: new Set(), step: new Set() };
}
const { top: KNOWN_TOP_KEYS, step: KNOWN_STEP_KEYS } = loadSchemaKeys();

/** 拼错的键找最接近的合法键（编辑距离 ≤ 3 才给），给「你是不是想写」用 */
export function closestKey(key: string, known: string[]): string | undefined {
  const dist = (a: string, b: string): number => {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    return dp[a.length][b.length];
  };
  let best: { k: string; d: number } | undefined;
  for (const k of known) {
    const d = dist(key.toLowerCase(), k.toLowerCase());
    if (d <= 3 && (!best || d < best.d)) best = { k, d };
  }
  return best?.k;
}

/**
 * 解析失败几乎全是"用户的 YAML 写得不对"，不是服务端故障 —— 打上标记，让调用方
 * （尤其 web/server.js）能回 4xx 而不是 500。500 会让用户以为是我们坏了，跑去重启引擎。
 */
function fail(msg: string): never {
  throw Object.assign(new Error(msg), { userError: true });
}

export function parseWorkflow(
  filePath: string,
  opts?: {
    /**
     * 调用方已经准备好的 llm 配置（CLI 的 --provider/--model、Studio 里选中的供应商）。
     * YAML 里没写 `llm:` 时用它兜底 —— 用户明明在命令行/界面上指定了 provider，
     * 却还被一句"工作流缺少 llm 配置"挡住，是说不通的。仍然要求最终有 provider。
     */
    llmFrom?: Partial<import('../types.js').LLMConfig>;
  },
): WorkflowDefinition {
  const raw = readFileSync(filePath, 'utf-8');
  const doc = yaml.load(raw) as Record<string, unknown>;

  // 基本校验
  if (!doc || typeof doc !== 'object') {
    fail(t('parse.bad_yaml', { path: filePath }));
  }
  if (!doc.name || typeof doc.name !== 'string') {
    fail(t('parse.missing_name'));
  }
  if (!doc.steps || !Array.isArray(doc.steps) || doc.steps.length === 0) {
    fail(t('parse.missing_steps'));
  }
  // YAML 没写 llm 时，用调用方给的（--provider / Studio 选中的供应商）兜底
  if ((!doc.llm || typeof doc.llm !== 'object') && opts?.llmFrom?.provider) {
    doc.llm = { ...opts.llmFrom };
  }
  if (!doc.llm || typeof doc.llm !== 'object') {
    fail(t('parse.missing_llm'));
  }

  const llm = doc.llm as Record<string, unknown>;
  if (!llm.provider) {
    fail(t('parse.missing_provider'));
  }
  // CLI providers（claude-code / antigravity-cli / gemini-cli / copilot-cli / codex-cli / openclaw-cli / hermes-cli / codebuddy-cli / cline-cli / opencode-cli / dsh-cli）和 ollama 不需要 model
  const cliProviders = [...CLI_PROVIDER_IDS, 'ollama'];
  // 纯出图/出视频的工作流也不需要顶层 model：那一步的模型写在 image.model / video.model 里，
  // 顶层 llm.model 只是文本步骤要用的。逼用户随手填一个用不上的文本模型，等于教他写谎话
  // （与 agents_dir 那条同一个道理：一个角色都不用的工作流不该被"找不到角色库"挡在门外）。
  const mediaOnly = Array.isArray(doc.steps) && doc.steps.length > 0
    && (doc.steps as Array<Record<string, unknown>>).every((s) => s?.type === 'image' || s?.type === 'video' || s?.type === 'concat' || s?.type === 'tts');
  if (!llm.model && !cliProviders.includes(llm.provider as string) && !mediaOnly) {
    fail(t('parse.missing_model'));
  }
  // 不认识的 provider 又没给 base_url：run 会报「暂不支持 provider」，validate / plan 却一路放行——
  // 连接器工厂的规则是「不在注册表里但有 base_url = 按 OpenAI 兼容端点处理」，这里同一条口径。
  // 纯媒体工作流的 provider 可以是视频供应商（有自己的注册表），不在此列。
  {
    const known = new Set<string>([...CLI_PROVIDER_IDS, 'ollama', 'claude', ...Object.keys(API_PROVIDER_MAP), ...Object.keys(ANTHROPIC_PROVIDER_MAP), ...VIDEO_PROVIDERS.map((v) => v.id)]);
    const pid = String(llm.provider ?? '');
    // 命令行 / Studio 用 --provider --base-url 覆盖时（llmFrom），YAML 里的 provider 会被换掉，不按 YAML 判
    const overridden = !!opts?.llmFrom?.provider;
    if (pid && !known.has(pid) && !llm.base_url && !mediaOnly && !overridden && !/\{\{/.test(pid)) {
      const guess = closestKey(pid, [...known]);
      fail(`不认识的 provider "${pid}"${guess ? `——你是不是想写 "${guess}"？` : ''}。自定义中转请配上 base_url（按 OpenAI 兼容端点处理）；内置供应商见 ao doctor`);
    }
  }
  // concurrency 是分批循环的步长：写成 0 会被下面的 `|| 2` 兜住，但负数 / 小数不会——
  // `i += -1` 永不结束，循环里不停 await 空批次，把事件循环饿死，Ctrl-C 都按不动。
  if (doc.concurrency !== undefined && !(Number.isInteger(doc.concurrency) && (doc.concurrency as number) >= 1)) {
    fail(`concurrency 必须是 ≥ 1 的整数（当前：${JSON.stringify(doc.concurrency)}）`);
  }

  // 校验每个 step
  const stepIds = new Set<string>();
  const steps = doc.steps as StepDefinition[];

  for (const step of steps) {
    if (!step.id) fail(t('parse.missing_step_id'));
    // step id 会被拼进文件路径（steps/<n>-<id>.md、assets/<id>.png）——带路径分隔符或 ".."
    // 的 id 此前要到落盘那一刻才炸（ENOENT / 写出目录），在解析期就说清楚。中文 id 不受影响。
    if (/[\\/:*?"<>|\x00-\x1f]/.test(step.id) || step.id.includes('..') || step.id.startsWith('.')) {
      fail(`step id "${step.id}" 含路径字符（/ \\ : * ? " < > | 或 ..）——id 会用作产物文件名，请改用字母数字、中文、-、_`);
    }
    if (stepIds.has(step.id)) fail(`step id 重复: ${step.id}`);
    stepIds.add(step.id);
    // depends_on 写成单个字符串（模型常这么写）：以前按字符串迭代，报出 8 条「依赖不存在的 step: "r" / "e" / "s"…」，
    // 任何修复阶段都无从下手。deliverables 早就接受单字符串，这里同样规整成数组。
    if (typeof (step as { depends_on?: unknown }).depends_on === 'string') {
      step.depends_on = [(step as unknown as { depends_on: string }).depends_on];
    }
    // 拼错的键（depend_on / outputs / acceptence…）此前被**静默忽略**：依赖没连上、验收没做，用户以为都生效了。
    // 键表取自随包的 JSON Schema（同一份给编辑器补全用），别在这里再抄一遍。
    for (const key of Object.keys(step)) {
      if (KNOWN_STEP_KEYS.size && !KNOWN_STEP_KEYS.has(key)) {
        const guess = closestKey(key, [...KNOWN_STEP_KEYS]);
        fail(`step "${step.id}" 有不认识的字段 "${key}"${guess ? `——你是不是想写 "${guess}"？` : ''}（拼错的字段会被静默忽略，所以这里直接报错）`);
      }
    }

    // approval / human_input 是无角色的人工节点，不需要 role / task；
    // image 是文生图节点：task 就是图片提示词，不需要 role
    const isHumanNode = step.type === 'approval' || step.type === 'human_input';
    const isImageNode = step.type === 'image';
    const isVideoNode = step.type === 'video';
    const isConcatNode = step.type === 'concat';
    const isTtsNode = step.type === 'tts';
    if (!isHumanNode && !isImageNode && !isVideoNode && !isConcatNode && !isTtsNode && !step.role) {
      fail(`step "${step.id}" 缺少 role`);
    }
    if (isConcatNode) {
      const ins = step.concat?.inputs;
      if (!Array.isArray(ins) || ins.length === 0 || !ins.every((x) => typeof x === 'string' && x.trim())) {
        fail(`step "${step.id}" 是 concat 步骤，必须写 concat: { inputs: ["{{shot1_mp4}}", "{{shot2_mp4}}", …] }（上游视频步骤的输出变量，按顺序合成）`);
      }
      if (step.acceptance || step.assert) fail(`step "${step.id}" 是 concat 步骤，暂不支持 acceptance / assert`);
      // 逐段对应的字段，数量对不上是配置错而不是"少配一段"：
      // 静默补齐会让第 2 段的旁白盖到第 3 段画面上，而这种错在成片里才看得出来。
      for (const k of ['voiceover', 'subtitles'] as const) {
        const arr = step.concat?.[k];
        if (arr === undefined) continue;
        if (!Array.isArray(arr) || !arr.every((x) => typeof x === 'string')) {
          fail(`step "${step.id}" 的 concat.${k} 必须是字符串数组（与 inputs 一一对应，这段不要就留空串）`);
        } else if (Array.isArray(ins) && arr.length !== ins.length) {
          fail(`step "${step.id}" 的 concat.${k} 有 ${arr.length} 条，但 inputs 有 ${ins.length} 段——必须一一对应`);
        }
      }
      for (const k of ['voice_volume', 'bgm_volume', 'clip_volume'] as const) {
        const v = step.concat?.[k];
        if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) {
          fail(`step "${step.id}" 的 concat.${k} 必须是非负数字`);
        }
      }
      if (step.concat?.bgm !== undefined && typeof step.concat.bgm !== 'string') {
        fail(`step "${step.id}" 的 concat.bgm 必须是字符串（本地音频路径，或上游 tts 步骤的输出变量）`);
      }
    }
    if (isTtsNode) {
      if (step.acceptance || step.assert) {
        // 同 image/video：核验的是文本产出，音频核验是另一回事，别装作跑了
        fail(`step "${step.id}" 是 tts 步骤，暂不支持 acceptance / assert（它们核验的是文本产出——要审文案就审上游写旁白的那一步）`);
      }
      if (!step.tts?.model || !step.tts?.voice) {
        fail(
          `step "${step.id}" 是 tts 步骤，必须写 tts: { model: "<语音模型>", voice: "<音色>" }\n` +
          `        音色 id 各家互不通用（OpenAI 是 alloy / nova / shimmer…，别家完全不同），引擎不猜——\n` +
          `        猜错要么被拒，要么拿回一条不是你要的嗓子的成品，钱照花`
        );
      }
    }
    if (!step.task && !isHumanNode && !isConcatNode) {
      fail(`step "${step.id}" 缺少 task${isImageNode ? '（image 步骤的 task 就是图片提示词）' : isVideoNode ? '（video 步骤的 task 就是视频提示词）' : isTtsNode ? '（tts 步骤的 task 就是要念的文案）' : ''}`);
    }
    if (isVideoNode && step.assert) {
      // 同 image：assert 数的是文本结构。acceptance 可以：抽帧交给能看图的文本模型审（默认只审不重出）
      fail(`step "${step.id}" 是 video 步骤，不支持 assert（它核验的是文本结构）；要审成片请用 acceptance（抽帧给支持 vision 的文本模型看，video.rework: true 才会重出）`);
    }
    if (isVideoNode && step.video?.rework !== undefined && typeof step.video.rework !== 'boolean') {
      fail(`step "${step.id}" 的 video.rework 必须是 true/false`);
    }
    if (isVideoNode && !step.video?.model) {
      // 视频比图片更贵、更慢（异步任务、按秒计费），猜错模型 = 等几分钟收到"模型不存在"
      fail(
        `step "${step.id}" 是 video 步骤，必须写 video: { model: "<视频模型>" }\n` +
        `        当前内置视频供应商：metaso（秘塔科技）→ model 填 MiniMax-H3\n` +
        `        各家视频模型编码互不通用，引擎不猜——猜错就是等几分钟收到"模型不存在"\n` +
        `        不知道提示词怎么写？21 个题材模板与在线生成器：https://prompts.aiolaola.com/build.html`
      );
    }
    if (isImageNode && step.assert) {
      // assert 数的是文本结构，对一张 PNG 无从数起。acceptance 可以：图交给能看图的文本模型审（executor 图片分支）
      fail(`step "${step.id}" 是 image 步骤，不支持 assert（它核验的是文本结构）；要审图片请用 acceptance（由支持 vision 的文本模型看图核对，未过自动重出一张）`);
    }
    if (isImageNode && !step.image?.model) {
      // 与文本侧"不猜默认模型"同一条纪律；在解析期就拦下来，别烧一次调用再报"模型不存在"
      fail(`step "${step.id}" 是 image 步骤，必须写 image: { model: "<图片模型>" }（各家图片模型编码互不通用，如 gpt-image-2 / doubao-seedream 等，见服务商文档或 Studio 的「获取模型列表」）`);
    }

    // depends_on 的引用校验在 validateWorkflow() 中处理
  }

  for (const key of Object.keys(doc)) {
    if (KNOWN_TOP_KEYS.size && !KNOWN_TOP_KEYS.has(key)) {
      const guess = closestKey(key, [...KNOWN_TOP_KEYS]);
      fail(`工作流顶层有不认识的字段 "${key}"${guess ? `——你是不是想写 "${guess}"？` : ''}`);
    }
  }

  return {
    name: doc.name as string,
    description: doc.description as string | undefined,
    agents_dir: (doc.agents_dir as string) || './agents',
    llm: doc.llm as WorkflowDefinition['llm'],
    concurrency: (doc.concurrency as number) || 2,
    verify: doc.verify as boolean | undefined,
    verify_llm: doc.verify_llm as WorkflowDefinition['verify_llm'],
    // 单个 id 也允许写成字符串：`deliverables: final_story`
    deliverables: doc.deliverables === undefined ? undefined
      : Array.isArray(doc.deliverables) ? (doc.deliverables as unknown[]).map(String)
      : [String(doc.deliverables)],
    inputs: doc.inputs as WorkflowDefinition['inputs'],
    steps,
  };
}

/**
 * 验证工作流定义（不执行），返回错误列表
 */
export function validateWorkflow(workflow: WorkflowDefinition, agentsDir?: string): string[] {
  const errors: string[] = [];
  const stepIds = new Set(workflow.steps.map(s => s.id));
  const stepById = new Map(workflow.steps.map(s => [s.id, s]));

  // 输入的 show_when：语法错或引用了不是输入的变量，在解析期就报——
  // 否则 Studio 里那个输入会"永远不显示"，而用户只看到模板缺了一项、不知道为什么。
  {
    const inputNames = new Set((workflow.inputs ?? []).map((i) => i.name));
    for (const inp of workflow.inputs ?? []) {
      if (inp.show_when === undefined) continue;
      if (typeof inp.show_when !== 'string' || !inp.show_when.trim()) {
        errors.push(`input "${inp.name}" 的 show_when 必须是非空字符串（如 "{{narration}} contains 配旁白"）`);
        continue;
      }
      const refs = extractVariables(inp.show_when);
      const bad = refs.filter((v) => !inputNames.has(v) || v === inp.name);
      if (!refs.length) errors.push(`input "${inp.name}" 的 show_when 没有引用任何输入变量：${inp.show_when}`);
      if (bad.length) errors.push(`input "${inp.name}" 的 show_when 只能引用其他输入，"${bad.join('、')}" 不是输入（或引用了自己）`);
      try {
        // 用全空上下文试解析一次：语法错（不支持的运算符、缺运算符）在这里就会抛
        evaluateCondition(inp.show_when, new Map([...inputNames].map((n) => [n, ''])));
      } catch (e) {
        errors.push(`input "${inp.name}" 的 show_when 写法不对：${e instanceof Error ? e.message : e}`);
      }
    }
  }

  // verify 开关必须是布尔（YAML 里写成 "false" 字符串会被当 truthy，静默反转语义）
  if (workflow.verify !== undefined && typeof workflow.verify !== 'boolean') {
    errors.push(`顶层 verify 必须是布尔值（true/false，不要加引号）`);
  }
  if (workflow.verify_llm !== undefined) {
    const v = workflow.verify_llm as Record<string, unknown> | null;
    if (!v || typeof v !== 'object' || Array.isArray(v) || typeof v.provider !== 'string' || !v.provider.trim()) {
      errors.push(`顶层 verify_llm 必须是 { provider: "<供应商>", model: "<模型>" }（验收员模型；看图验收要选支持 vision 的 API 模型）`);
    }
  }

  // deliverables 必须指向真实步骤：写错 id 会静默退回"最后一步"，用户导出时才发现拿到的是过程稿
  if (workflow.deliverables !== undefined) {
    if (!workflow.deliverables.length) {
      errors.push('顶层 deliverables 不能为空列表（不写 = 默认最后一个完成的步骤）');
    }
    for (const id of workflow.deliverables) {
      if (!stepIds.has(id)) errors.push(`顶层 deliverables 引用不存在的 step: "${id}"`);
    }
  }

  // step.output 唯一性检查：两个 step 不能 output 到同一个变量名
  // 否则下游引用拿到的值取决于 context Map 的写入顺序，不可预期
  //
  // 两类合法例外不报错：
  // 1. any_completed 分支收敛：下游用 depends_on_mode: any_completed 引用这些
  //    重名 step（任一分支完成即走，重名 output 是有意设计）
  // 2. loop 迭代覆盖：重名 step 中有任一个带 loop 字段（种子 step + loop step
  //    反复覆盖同名 output，是常见的"原地修改"迭代模式，如 write/revise/brand_review 链）
  const outputToSteps = new Map<string, string[]>();
  for (const step of workflow.steps) {
    if (!step.output) continue;
    const owners = outputToSteps.get(step.output) || [];
    owners.push(step.id);
    outputToSteps.set(step.output, owners);
  }
  for (const [outName, owners] of outputToSteps) {
    if (owners.length <= 1) continue;
    const ownerSet = new Set(owners);
    const hasAnyCompletedConsumer = workflow.steps.some(s =>
      s.depends_on_mode === 'any_completed'
      && s.depends_on?.some(d => ownerSet.has(d))
    );
    if (hasAnyCompletedConsumer) continue;
    const hasLoopOwner = owners.some(id => stepById.get(id)?.loop);
    if (hasLoopOwner) continue;
    errors.push(`output 变量 "${outName}" 被多个 step 同时产出: ${owners.join(', ')}（重名会让下游引用结果不确定）`);
  }

  // 计算每个 step 的 DAG 上游 step ids（递归 depends_on 闭包，不含自身）。
  // 用于校验"变量必须来自 inputs 或当前 step 的上游"——和 autoFix 的拓扑约束保持一致
  function upstreamStepIds(stepId: string): Set<string> {
    const out = new Set<string>();
    const stack = [stepId];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      const step = stepById.get(cur);
      if (!step) continue;
      for (const dep of step.depends_on || []) {
        if (out.has(dep)) continue;
        out.add(dep);
        stack.push(dep);
      }
    }
    return out;
  }

  for (const step of workflow.steps) {
    // 检查 depends_on 引用
    if (step.depends_on) {
      for (const dep of step.depends_on) {
        if (!stepIds.has(dep)) {
          // 最常见的写法错误：把上游的**输出变量名**当成了 step id 写进 depends_on
          // （#103：depends_on: [income_paths_analysis] 而该名字是 step
          // analyze_income_paths 的 output）。光说"依赖不存在"用户会去找一个根本
          // 不存在的 step，这里直接点破是哪个 step 产出的这个变量、该填什么。
          const producer = workflow.steps.find((s) => s.output === dep);
          errors.push(
            producer
              ? `step "${step.id}" 依赖不存在的 step: "${dep}"（"${dep}" 是 step "${producer.id}" 的输出变量名，不是 step id —— depends_on 里应写 "${producer.id}"）`
              : `step "${step.id}" 依赖不存在的 step: "${dep}"`
          );
        }
        if (dep === step.id) {
          errors.push(`step "${step.id}" 不能依赖自己`);
        }
      }
    }

    // 检查 loop 配置
    if (step.loop) {
      if (!step.loop.back_to) {
        errors.push(`step "${step.id}" 的 loop 缺少 back_to`);
      } else if (!stepIds.has(step.loop.back_to)) {
        errors.push(`step "${step.id}" 的 loop.back_to 引用不存在的 step: "${step.loop.back_to}"`);
      } else if (step.loop.back_to === step.id) {
        errors.push(`step "${step.id}" 的 loop.back_to 不能指向自己`);
      } else {
        // 必须是依赖链上的祖先（与 dag.ts 同一条规则）。以前只有 buildDAG 查，于是 ao validate / ao plan / 自动组队的
        // 校验都放行，一跑 ao run 才炸。回跳只重跑「back_to 的后代 ∩ 本步的祖先」，不在链上等于什么都不重跑。
        const ancestors = new Set<string>();
        const stack = [...(step.depends_on ?? [])];
        while (stack.length) {
          const cur = stack.pop()!;
          if (ancestors.has(cur)) continue;
          ancestors.add(cur);
          stack.push(...(stepById.get(cur)?.depends_on ?? []));
        }
        if (!ancestors.has(step.loop.back_to)) {
          errors.push(`step "${step.id}" 的 loop.back_to "${step.loop.back_to}" 不在它的依赖链上——回跳只会重跑两者之间的步骤，back_to 必须是 "${step.id}" 直接或间接 depends_on 的步骤`);
        }
      }
      if (!step.loop.max_iterations || step.loop.max_iterations < 1) {
        errors.push(`step "${step.id}" 的 loop.max_iterations 必须 >= 1`);
      }
      if (step.loop.max_iterations > 10) {
        errors.push(`step "${step.id}" 的 loop.max_iterations 不能超过 10`);
      }
      if (!step.loop.exit_condition) {
        errors.push(`step "${step.id}" 的 loop 缺少 exit_condition`);
      }
    }

    // acceptance 必须是字符串（YAML 里写成列表/映射会让运行期模板渲染直接崩）
    if (step.acceptance !== undefined && typeof step.acceptance !== 'string') {
      errors.push(`step "${step.id}" 的 acceptance 必须是字符串（多条标准用多行文本或 "1. …\\n2. …" 列出）`);
    }
    if (step.verify !== undefined && typeof step.verify !== 'boolean') {
      errors.push(`step "${step.id}" 的 verify 必须是布尔值（true/false，不要加引号）`);
    }

    // assert 是机械断言：配错了必须在解析期就报，不能等跑到一半才崩。
    // 尤其是 matches 里的正则——写错的正则会静默匹配 0 次，
    // 那就成了"永远命中不了、于是永远报缺"或"永远命中、于是形同虚设"的哑弹检查。
    if (step.assert !== undefined) {
      const a = step.assert as Record<string, unknown>;
      if (typeof a !== 'object' || a === null || Array.isArray(a)) {
        errors.push(`step "${step.id}" 的 assert 必须是映射（emits_files / min_bytes / max_bytes / contains / matches）`);
      } else {
        const known = ['emits_files', 'min_bytes', 'max_bytes', 'min_chars', 'max_chars', 'contains', 'matches'];
        for (const k of Object.keys(a)) {
          if (!known.includes(k)) errors.push(`step "${step.id}" 的 assert 不认识字段 "${k}"（可用：${known.join(' / ')}）`);
        }
        for (const k of ['emits_files', 'min_bytes', 'max_bytes']) {
          const v = a[k];
          if (v !== undefined && (typeof v !== 'number' || !Number.isInteger(v) || v < 0)) {
            errors.push(`step "${step.id}" 的 assert.${k} 必须是非负整数`);
          }
        }
        // 字数（非空白字符）允许字符串：引用输入变量再乘系数，运行期按实际输入算
        for (const k of ['min_chars', 'max_chars']) {
          const v = a[k];
          if (v !== undefined && !isValidCharSpec(v)) {
            errors.push(`step "${step.id}" 的 assert.${k} 必须是非负整数，或形如 "{{length}} * 0.7" 的字符串（变量 × 系数）`);
          }
        }
        // 自相矛盾的区间是配错,不是"永远不过"——不在解析期拦下,就会每步都返工一轮再失败。
        if (typeof a.min_bytes === 'number' && typeof a.max_bytes === 'number' && a.min_bytes > a.max_bytes) {
          errors.push(`step "${step.id}" 的 assert.min_bytes(${a.min_bytes}) 大于 max_bytes(${a.max_bytes})，没有产出能同时满足`);
        }
        if (typeof a.min_chars === 'number' && typeof a.max_chars === 'number' && a.min_chars > a.max_chars) {
          errors.push(`step "${step.id}" 的 assert.min_chars(${a.min_chars}) 大于 max_chars(${a.max_chars})，没有产出能同时满足`);
        }
        if (a.contains !== undefined && (!Array.isArray(a.contains) || a.contains.some((x) => typeof x !== 'string'))) {
          errors.push(`step "${step.id}" 的 assert.contains 必须是字符串数组`);
        }
        if (a.matches !== undefined) {
          if (typeof a.matches !== 'object' || a.matches === null || Array.isArray(a.matches)) {
            errors.push(`step "${step.id}" 的 assert.matches 必须是「正则 → 次数」的映射`);
          } else {
            for (const [pat, cnt] of Object.entries(a.matches as Record<string, unknown>)) {
              if (typeof cnt !== 'number' || !Number.isInteger(cnt) || cnt < 0) {
                errors.push(`step "${step.id}" 的 assert.matches["${pat}"] 必须是非负整数`);
              }
              try { new RegExp(pat.replace(/^\/(.*)\/[gimsuy]*$/, '$1')); }
              catch { errors.push(`step "${step.id}" 的 assert.matches 里 "${pat}" 不是合法正则`); }
            }
          }
        }
        if (Object.keys(a).length === 0) {
          errors.push(`step "${step.id}" 的 assert 是空的——空断言永远通过，等于没写`);
        }
      }
    }

    // 检查 {{变量}} 引用：必须来自 inputs，或来自当前 step 的 DAG 上游 step.output
    // （之前只检查"任意 step 是否产出该变量"，让"早期 step 引用下游 output"这种
    // 拓扑反向错误漏过 validate，到 run 阶段才崩。和 autoFix 的拓扑约束对齐）
    // 范围: step.task / step.condition / step.loop.exit_condition / step.prompt / step.acceptance
    const refTexts: string[] = [];
    if (step.task) refTexts.push(step.task);
    if (step.condition) refTexts.push(step.condition);
    if (step.loop?.exit_condition) refTexts.push(step.loop.exit_condition);
    if (step.prompt) refTexts.push(step.prompt);
    if (typeof step.acceptance === 'string') refTexts.push(step.acceptance);
    // 字数断言的字符串写法引用输入变量：写错变量名要在 validate 就拦，别等到运行期"本条跳过"
    for (const v of [step.assert?.min_chars, step.assert?.max_chars]) if (typeof v === 'string') refTexts.push(v);
    // 媒体字段也会过变量渲染：写错变量名要在 validate 就拦住，别等到图生视频/合成时报"找不到图片"
    for (const v of Object.values(step.image ?? {})) if (typeof v === 'string') refTexts.push(v);
    for (const v of Object.values(step.video ?? {})) if (typeof v === 'string') refTexts.push(v);
    for (const v of step.concat?.inputs ?? []) if (typeof v === 'string') refTexts.push(v);
    // tts / 配音 / 字幕 / 配乐同样在运行期过变量渲染。它们排在付费的出图、出视频步骤**之后**，
    // 变量名写错如果等到运行期才报「模板变量未定义」，前面的钱已经花了
    for (const v of Object.values(step.tts ?? {})) if (typeof v === 'string') refTexts.push(v);
    for (const v of [...(step.concat?.voiceover ?? []), ...(step.concat?.subtitles ?? []), step.concat?.bgm]) if (typeof v === 'string') refTexts.push(v);

    const varRefs: string[] = [];
    for (const text of refTexts) {
      const matches = text.match(/\{\{(\w+)\}\}/g) || [];
      varRefs.push(...matches);
    }
    if (varRefs.length === 0) continue;

    const upStepIds = upstreamStepIds(step.id);
    const upstreamOutputs = new Set<string>();
    for (const id of upStepIds) {
      const s = stepById.get(id);
      if (s?.output) upstreamOutputs.add(s.output);
    }

    const reportedVars = new Set<string>();  // 同 step 内同名变量只报一次
    for (const ref of varRefs) {
      const varName = ref.slice(2, -2);
      if (varName === '_loop_iteration') continue;
      if (reportedVars.has(varName)) continue;
      const inputDef = workflow.inputs?.find(i => i.name === varName);
      if (inputDef) continue;
      if (upstreamOutputs.has(varName)) continue;
      // 不在 inputs 也不在上游 outputs：错误
      // 区分两种错误信息，方便 autoFix / repairWithLLM 处理
      const producedBySomeStep = workflow.steps.some(s => s.output === varName);
      if (producedBySomeStep) {
        errors.push(`step "${step.id}" 引用了未定义的变量: {{${varName}}} (该变量由非上游 step 产出，需要把对应 step 加进 depends_on)`);
      } else {
        errors.push(`step "${step.id}" 引用了未定义的变量: {{${varName}}}`);
      }
      reportedVars.add(varName);
    }
  }

  // 检查 role 是否真实存在（提前到 validate，而非等 run 到一半才崩）。
  // 仅在传入了已解析的 agentsDir 且目录存在时校验：未下载角色库时静默跳过，
  // 让 `ao validate` 在没有角色库的环境下仍可用（缺库由 run 路径单独报错）。
  if (agentsDir && existsSync(agentsDir)) {
    const roleErr = new Map<string, string | null>(); // rolePath → 错误信息（null=可加载）
    for (const step of workflow.steps) {
      if (!step.role) continue; // approval 等无 role 节点
      if (!roleErr.has(step.role)) {
        try {
          loadAgent(agentsDir, step.role);
          roleErr.set(step.role, null);
        } catch (err) {
          let msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
          // 拼错角色名时给"你是不是想用…"建议，把死胡同变成可操作的提示
          const suggestions = suggestRoles(step.role, agentsDir);
          if (suggestions.length > 0) {
            msg += `\n        你是不是想用 / Did you mean: ${suggestions.join('  |  ')}`;
          }
          roleErr.set(step.role, msg);
        }
      }
      const msg = roleErr.get(step.role);
      if (msg) errors.push(`step "${step.id}" 的 role 无法加载: ${msg}`);
    }
  }

  // 检查循环依赖
  const cycleError = detectCycle(workflow.steps);
  if (cycleError) errors.push(cycleError);

  return errors;
}

function detectCycle(steps: StepDefinition[]): string | null {
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const adj = new Map<string, string[]>();

  for (const step of steps) {
    adj.set(step.id, step.depends_on || []);
  }

  const path: string[] = [];
  let found: string[] | null = null;
  function dfs(id: string): boolean {
    visited.add(id);
    inStack.add(id);
    path.push(id);
    for (const dep of adj.get(id) || []) {
      if (inStack.has(dep)) { found = [...path.slice(path.indexOf(dep)), dep]; return true; }
      if (!visited.has(dep) && dfs(dep)) return true;
    }
    inStack.delete(id);
    path.pop();
    return false;
  }

  for (const step of steps) {
    if (!visited.has(step.id) && dfs(step.id)) {
      // 点名是哪几步绕成了环——光说「存在循环依赖」，十几步的工作流要一条条肉眼查
      return `工作流存在循环依赖: ${(found as string[] | null)?.join(' → ') ?? ''}`;
    }
  }
  return null;
}
