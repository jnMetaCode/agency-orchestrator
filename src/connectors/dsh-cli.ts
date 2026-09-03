/**
 * DeepSeek Harness (dsh) CLI Connector
 * 通过本地 `dsh` 调用（`npm install -g @deepseek-ai/dsh`），用它配好的供应商（DEEPSEEK_API_KEY，
 * 或 $DSH_HOME/settings.yaml 里 `llm-pi-ai.providers` 声明的任意 OpenAI 兼容端点）跑 AO 步骤。
 *
 * 真机事实（@deepseek-ai/dsh 0.1.1-rc.2, 2026-09-03）——**开发者预览，官方明说会有破坏性变更**：
 *   - `dsh --profile headless "<任务>"`：答案打到 stdout（就是最终文本，没有 JSON 包装），
 *     推理过程打到 stderr（每行 `dsh: reasoning:` 前缀），完成 exit 0、否则 1。
 *   - **不读 stdin**：管道写进去的内容模型看不见（mimic 复现），所以整段提示词走位置参数
 *     （23KB 角色实测可行）；基类超命令行上限会明确报错。无空格的纯中文提示词也接受。
 *   - 需要 **Node ≥ 22.15**（`node:zlib` 的 zstd）：22.14 直接在加载插件时崩，报错埋在堆栈里，
 *     这里从 stderr 识别后给一句人话。
 *   - 默认模型来自 `agent-default-model`（deepseek-official / deepseek-v4-flash）；AO 的 `model`
 *     写成 `provider/model` 时用 `--patch` 临时覆盖（provider 须在它的 settings.yaml 里存在）。
 *   - 它是 agentic 工具（bash / 文件工具），把"当前目录"当工作区，没有关工具的开关——每次调用
 *     在空临时目录里跑，跑完删掉。它还会把 `~/.agents/skills` 下的技能带进上下文，属它自己的行为。
 *   - 第一次启动会在 $DSH_HOME/profiles/headless 下初始化 profile（装依赖），要等一会儿。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLIBaseConnector } from './cli-base.js';
import type { LLMConfig, LLMResult } from '../types.js';

/** 把 AO 的 `provider/model` 变成 dsh 的 --patch 覆盖文件内容；不是这个形状就返回 null。 */
export function modelPatchYaml(model?: string): string | null {
  if (!model || model === 'dsh-cli') return null;
  const i = model.indexOf('/');
  if (i <= 0 || i === model.length - 1) return null;
  const provider = model.slice(0, i);
  const id = model.slice(i + 1);
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  return `- id: agent-default-model\n  config:\n    provider: ${q(provider)}\n    model: ${q(id)}\n`;
}

/** 从 stderr 识别 dsh 特有的失败原因。 */
export function dshStderrHint(stderr: string): string | undefined {
  if (/createZstdDecompress|zstd/i.test(stderr) && /node:zlib/.test(stderr)) {
    return 'DeepSeek Harness 需要 Node ≥ 22.15（当前 Node 缺 zlib 的 zstd 接口）。升级 Node（nvm install 22）后再跑。';
  }
  if (/MISSING_CREDENTIAL/.test(stderr)) {
    return 'dsh 找不到该供应商的 key：默认走 DEEPSEEK_API_KEY；自定义端点要在 $DSH_HOME/settings.yaml 的 llm-pi-ai.providers 里声明 apiKeyEnv 并设好对应环境变量。';
  }
  if (/UNKNOWN_MODEL/.test(stderr)) {
    return 'dsh 不认识这个模型 id：model 要写成 provider/model，且 provider 与 model 都得在它的 settings.yaml 里声明。';
  }
  return undefined;
}

export class DshCLIConnector extends CLIBaseConnector {
  constructor() {
    super({
      command: 'dsh',
      displayName: 'DeepSeek Harness (dsh)',
      installHint: 'npm install -g @deepseek-ai/dsh（需要 Node ≥ 22.15）；然后 export DEEPSEEK_API_KEY=… 或在 $DSH_HOME/settings.yaml 配供应商',
      // 不声明 supportsStdin：它不读 stdin（见文件头），整段提示词走位置参数。
      buildArgs: (prompt: string, config: LLMConfig) => {
        const c = config as LLMConfig & { __dsh_patch?: string };
        const args = ['--profile', 'headless'];
        if (c.__dsh_patch) args.push('--patch', c.__dsh_patch);
        args.push(prompt);
        return args;
      },
      spawnCwd: (config) => (config as any).__dsh_cwd,
      stderrHint: dshStderrHint,
      emptyOutputHint: '排查：终端跑 `dsh --profile headless "说 你好"`；首次启动要初始化 profile，可能较慢；需要 Node ≥ 22.15。',
    });
  }

  override async chat(systemPrompt: string, userMessage: string, config: LLMConfig): Promise<LLMResult> {
    const sandbox = mkdtempSync(join(tmpdir(), 'ao-dsh-'));
    try {
      const cfg = { ...config, __dsh_cwd: sandbox } as LLMConfig & { __dsh_patch?: string; __dsh_cwd?: string };
      const patch = modelPatchYaml(config.model);
      if (patch) {
        cfg.__dsh_patch = join(sandbox, 'ao-model.yml');
        writeFileSync(cfg.__dsh_patch, patch, { encoding: 'utf-8', mode: 0o600 });
      } else if (config.model && config.model !== 'dsh-cli') {
        process.stderr.write(`  ⚠️ dsh-cli 的 model 要写成 provider/model（如 deepseek-official/deepseek-v4-flash），「${config.model}」不是这个形状，已忽略、用 dsh 自己的默认模型\n`);
      }
      return await super.chat(systemPrompt, userMessage, cfg);
    } finally {
      try { rmSync(sandbox, { recursive: true, force: true }); } catch {}
    }
  }
}
