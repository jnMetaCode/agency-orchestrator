/**
 * 命令行 / Studio 覆盖 YAML 里的 llm 配置（--provider / --model / --timeout …）。
 *
 * 超时的规则单独拎出来，因为以前是「只要 --provider 换成 CLI 类，就把超时写死成 600s」：
 * YAML 里显式写的长超时被悄悄压回 600s。真机（2026-09-15）：「一人公司·方案到代码」写代码一步要生成
 * 约 40 分钟，模板写了 timeout: 2700000，用 --provider claude-code 跑时仍在 600s、900s 连续超时重试，
 * 每次都从头生成、白花额度。
 *
 * 现在：
 * - 显式给了 timeout（--timeout）→ 用它（命令行优先）
 * - 换成 CLI 类 provider、没给 timeout → 600s 是**下限**：YAML 写得更长就用 YAML 的；YAML 写 0（不限时）保持 0
 *   （下限的来由不变：YAML 给 API 调的短超时，套到 CLI 上会过早杀掉）
 * - 其他情况 → 原样合并，与以前一致
 */
import type { LLMConfig } from '../types.js';

export const CLI_TIMEOUT_FLOOR_MS = 600_000;

export function isCliProvider(provider: string | undefined): boolean {
  return !!provider && (provider.endsWith('-cli') || provider === 'claude-code');
}

export function mergeLlmOverride(base: LLMConfig, override: Partial<LLMConfig>): LLMConfig {
  const yamlTimeout = base.timeout;
  const merged = Object.assign(base, override);
  if (override.timeout === undefined && override.provider && isCliProvider(override.provider)) {
    merged.timeout = yamlTimeout === 0
      ? 0
      : Math.max(yamlTimeout ?? 0, CLI_TIMEOUT_FLOOR_MS);
  }
  return merged;
}
