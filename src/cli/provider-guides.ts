/**
 * 各 provider 首次使用指南 —— 在 `ao init --provider X` 完成 .env 写入后打印，
 * 告诉用户 provider 自身还需要做什么（OAuth 登录 / 拿 API key / 启本地服务 等）。
 */

export interface GuideContext {
  /** 本次 init 是否提供了 --api-key */
  hasApiKey: boolean;
  /** 本次 init 是否提供了 --base-url，或环境已存在 OPENAI_BASE_URL */
  hasBaseUrl: boolean;
  /** 本次 init 指定的 model（用于 ollama pull 提示） */
  model?: string;
}

export function getProviderGuide(provider: string, ctx: GuideContext): string {
  const p = provider.toLowerCase();

  switch (p) {
    case 'gemini-cli':
      return [
        `📋 首次使用 gemini-cli，二选一:`,
        `   A. Google 账号登录（免费 1000 次/天，推荐）`,
        `      → 终端跑一次: gemini -p "hi"，首次会弹出浏览器登录`,
        `   B. API Key`,
        `      → 从 https://aistudio.google.com/app/apikey 申请（不是 Cloud Console）`,
        `      → export GEMINI_API_KEY=xxx  或加到 .env`,
      ].join('\n');

    case 'claude-code':
      return [
        `📋 首次使用 Claude Code:`,
        `   → 终端跑一次: claude，首次会弹出浏览器完成 Anthropic 账号登录`,
        `   → 或设 API Key: export ANTHROPIC_API_KEY=sk-ant-xxx`,
      ].join('\n');

    case 'copilot-cli':
      return [
        `📋 首次使用 GitHub Copilot CLI:`,
        `   → 需要 GitHub Copilot 付费订阅`,
        `   → 终端跑 copilot 命令，按提示完成 GitHub 账号登录`,
      ].join('\n');

    case 'codex-cli':
      return [
        `📋 首次使用 OpenAI Codex CLI:`,
        `   → 需要 ChatGPT Plus/Pro 订阅`,
        `   → 终端跑 codex 命令，按提示完成 OpenAI 账号登录`,
      ].join('\n');

    case 'openclaw-cli':
      return [
        `📋 首次使用 OpenClaw CLI:`,
        `   → 终端跑 openclaw 命令，按提示完成登录或配置 token`,
        `   → 也可用 OPENCLAW_AGENT 环境变量指定 agent`,
      ].join('\n');

    case 'hermes-cli':
      return [
        `📋 首次使用 Hermes CLI:`,
        `   → 参考 Hermes 官方文档完成 token 配置`,
        `   → 支持多模型，在 YAML 里用 model 字段指定 (如 anthropic/claude-sonnet-4、openai/gpt-4o)`,
      ].join('\n');

    case 'ollama': {
      const model = ctx.model || '<model>';
      return [
        `📋 Ollama 本地推理:`,
        `   → 启动服务: ollama serve`,
        `   → 拉取模型: ollama pull ${model}`,
        `   → 默认地址 http://localhost:11434，可用 OLLAMA_BASE_URL 覆盖`,
      ].join('\n');
    }

    case 'deepseek':
      return ctx.hasApiKey
        ? `✅ DeepSeek 已配置，可以跑: ao run workflows/story-creation.yaml -i premise="测试"`
        : [
            `📋 DeepSeek 还缺 API key:`,
            `   → 从 https://platform.deepseek.com/ 申请`,
            `   → 再跑: ao init --provider deepseek --api-key sk-xxx`,
          ].join('\n');

    case 'openai':
      return ctx.hasApiKey
        ? `✅ OpenAI 已配置。`
        : [
            `📋 OpenAI 还缺 API key:`,
            `   → 从 https://platform.openai.com/api-keys 申请`,
            `   → 再跑: ao init --provider openai --api-key sk-xxx`,
          ].join('\n');

    case 'anthropic':
    case 'claude':
      return ctx.hasApiKey
        ? `✅ Anthropic Claude 已配置。`
        : [
            `📋 Anthropic Claude 还缺 API key:`,
            `   → 从 https://console.anthropic.com/settings/keys 申请`,
            `   → 再跑: ao init --provider claude --api-key sk-ant-xxx`,
          ].join('\n');

    default: {
      const lines: string[] = [];
      lines.push(`📋 "${provider}" 按自定义 OpenAI 兼容端点处理:`);
      if (!ctx.hasBaseUrl) lines.push(`   ⚠️  还缺 --base-url（/v1 兼容接口地址）`);
      if (!ctx.hasApiKey) lines.push(`   ⚠️  还缺 --api-key`);
      lines.push(``);
      lines.push(`   常见国内端点可参考:`);
      lines.push(`     智谱 GLM:   https://open.bigmodel.cn/api/paas/v4`);
      lines.push(`     Moonshot:   https://api.moonshot.cn/v1`);
      lines.push(`     通义:       https://dashscope.aliyuncs.com/compatible-mode/v1`);
      lines.push(`     硅基流动:   https://api.siliconflow.cn/v1`);
      return lines.join('\n');
    }
  }
}
