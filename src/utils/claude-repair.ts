/**
 * 系统 Claude Code 配置「急救」工具 —— 与 AO 的中转逻辑完全隔离。
 *
 * 背景：任何软件（cc-switch、别的切换器）或用户手动，只要往全局
 * `~/.claude/settings.json` 的 `env` 块里塞了 `ANTHROPIC_AUTH_TOKEN` /
 * `ANTHROPIC_BASE_URL`（例如假 token + 第三方中转地址），就会顶掉真实的
 * OAuth 登录、把所有请求改道到中转端点 → 全机器 Claude Code 直接不可用，
 * 而且重新 `/login` 也救不回来（env 覆盖优先级更高）。唯一解是把这些
 * 劫持键从 settings 里删掉。
 *
 * 这个模块就干这一件事，安全第一：
 *   1. 写之前总是先备份（`.ao-backup-<timestamp>` 后缀，不覆盖旧备份）
 *   2. 只删「劫持相关」的那几个 env 键，保留用户在 settings.json 里的其它内容
 *   3. env 块删空后连 `env` 键一起移除，回到干净状态
 *   4. shell 环境变量（~/.zshrc 里的 export）无法安全地替用户改，只诊断+提示
 *
 * 注意：这里绝不写入任何中转/token —— 它是「恢复官方登录」的减法工具，
 * 跟 AO 给子进程注入 env 的正向逻辑（web/server.js 的 applyKeys）互不相干。
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** 凭据 / 端点类劫持键：任何模式下出现在 settings 里都是劫持，修复 = 删掉。 */
export const CREDENTIAL_HIJACK_KEYS = [
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
] as const;

/**
 * 模型名键：中转用它们指定中转侧的模型名，所以默认算劫持。
 * 但 Bedrock / Vertex 用户**正是**靠这几个键填云上的模型 ID
 * （如 `us.anthropic.claude-sonnet-4-5-20250929-v1:0`）—— 那时删了等于毁配置。
 * 见 {@link usesCloudProvider}。
 */
export const MODEL_OVERRIDE_KEYS = [
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
] as const;

/** 走云厂商网关（AWS Bedrock / Google Vertex）的开关键——它们一开，模型名键就是正当配置。 */
export const CLOUD_PROVIDER_KEYS = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
] as const;

/**
 * 所有「可能」是劫持的 env 键（凭据 + 模型名）。
 * Studio 拍 shell 快照用它决定要记哪些键；判定是否劫持请用 {@link activeHijackKeys}。
 */
export const HIJACK_ENV_KEYS = [...CREDENTIAL_HIJACK_KEYS, ...MODEL_OVERRIDE_KEYS] as const;

/** Studio 拍 shell 快照时要一并记下的键：判定 Bedrock/Vertex 模式也得看 shell。 */
export const SNAPSHOT_ENV_KEYS = [...HIJACK_ENV_KEYS, ...CLOUD_PROVIDER_KEYS] as const;

/** `CLAUDE_CODE_USE_BEDROCK=1` 式开关：非空且不是 0/false 就算开。 */
function isSwitchOn(value: unknown): boolean {
  const s = String(value ?? '').trim().toLowerCase();
  return s !== '' && s !== '0' && s !== 'false';
}

/**
 * 是否在用 Bedrock / Vertex。开关可能写在 shell（`export CLAUDE_CODE_USE_BEDROCK=1`），
 * 也可能写在任一 settings 文件的 env 块里 —— claude CLI 会把两个文件的 env 合并读，
 * 所以这里也按「并集」判，避免开关在 settings.json、模型名在 settings.local.json 时误杀。
 *
 * 附加条件：没有任何 `ANTHROPIC_BASE_URL`。Bedrock/Vertex 不用这个键（它们的端点键是
 * `ANTHROPIC_BEDROCK_BASE_URL` / `ANTHROPIC_VERTEX_BASE_URL`），所以它一旦出现就说明当前指着中转
 * —— 那批模型名键是中转的、该删。这条也让「Bedrock 用户在 Studio 里切了中转再切回官方」能删干净。
 */
function usesCloudProvider(fileEnvs: any[], shellEnv: Record<string, string | undefined>): boolean {
  const relayActive = !!shellEnv.ANTHROPIC_BASE_URL || fileEnvs.some((env) => env && env.ANTHROPIC_BASE_URL);
  if (relayActive) return false;
  return CLOUD_PROVIDER_KEYS.some(
    (k) => isSwitchOn(shellEnv[k]) || fileEnvs.some((env) => env && isSwitchOn(env[k])),
  );
}

/** 当前模式下真正算劫持的键：Bedrock/Vertex 模式下豁免模型名键。 */
function activeHijackKeys(cloudProvider: boolean): readonly string[] {
  return cloudProvider ? CREDENTIAL_HIJACK_KEYS : HIJACK_ENV_KEYS;
}

function claudeDir(): string {
  // 允许测试 / 自定义 profile 覆盖，与 cc-switch 的 override 思路一致。
  return process.env.AO_CLAUDE_DIR || join(homedir(), '.claude');
}

/** AO 管理的两个全局 settings 文件（settings.local.json 优先级更高，也要一起查/修）。 */
function settingsFiles(): string[] {
  const dir = claudeDir();
  return [join(dir, 'settings.json'), join(dir, 'settings.local.json')];
}

/** token 类值只回显前后几位，避免把密钥整段吐到日志 / 前端。 */
function maskValue(key: string, value: unknown): string {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  if (!/TOKEN|API_KEY/i.test(key)) return s; // base_url / model 名不敏感，原样显示
  if (s.length <= 8) return '***';
  return `${s.slice(0, 4)}…${s.slice(-2)}`;
}

export interface FileFinding {
  /** 文件绝对路径 */
  path: string;
  exists: boolean;
  /** JSON 解析失败时非空（此时不动它，只报警） */
  parseError?: string;
  /** 该文件 env 块里命中的劫持键 → 掩码后的值 */
  hijackKeys: Record<string, string>;
}

export interface ShellEnvOptions {
  /**
   * 判定「shell 层残留」时依据的环境变量表，默认 `process.env`。
   *
   * CLI（`ao doctor`）里 process.env 就是用户 shell，用默认即可。但 Studio 服务端不行：
   * web/server.js 的 applyKeys 会把 AO 自己保存的中转 key 注入**本进程** env，若照 process.env
   * 判定，用户只是在 AO 里存了个 claude-code 中转，体检卡就会红灯说"系统 Claude 被劫持"、
   * 并叫他去 ~/.zshrc 删（那里根本没有）。所以服务端要传「注入前」的快照。
   */
  shellEnv?: Record<string, string | undefined>;
}

export interface ClaudeDiagnosis {
  healthy: boolean;
  files: FileFinding[];
  /** shell（process.env）层面存在的劫持键 —— 工具改不了，只能提示用户去 ~/.zshrc 删 */
  shellOverrides: Record<string, string>;
  /** 是否检测到 Bedrock / Vertex 模式（此时模型名键是正当配置，不查也不删） */
  cloudProvider: boolean;
  /** 命中的中转端点（若有），给用户一眼看清被改道到哪 */
  baseUrl?: string;
}

/** 读一个 settings 文件：解析结果 + env 块（解析失败时只带 parseError）。 */
function readSettings(path: string): { path: string; exists: boolean; parseError?: string; env?: any } {
  if (!existsSync(path)) return { path, exists: false };
  try {
    const obj = JSON.parse(readFileSync(path, 'utf-8'));
    const env = obj && typeof obj === 'object' && obj.env && typeof obj.env === 'object' ? obj.env : undefined;
    return { path, exists: true, ...(env ? { env } : {}) };
  } catch (err: any) {
    return { path, exists: true, parseError: err?.message || String(err) };
  }
}

function toFinding(s: ReturnType<typeof readSettings>, keys: readonly string[]): FileFinding {
  if (!s.exists) return { path: s.path, exists: false, hijackKeys: {} };
  if (s.parseError) return { path: s.path, exists: true, parseError: s.parseError, hijackKeys: {} };
  const hijackKeys: Record<string, string> = {};
  for (const key of keys) {
    if (s.env && s.env[key] != null && s.env[key] !== '') hijackKeys[key] = maskValue(key, s.env[key]);
  }
  return { path: s.path, exists: true, hijackKeys };
}

/** 只读诊断：全局 settings 有没有被劫持、shell 里有没有残留。不改任何文件。 */
export function diagnoseClaudeConfig(opts: ShellEnvOptions = {}): ClaudeDiagnosis {
  const shellEnv = opts.shellEnv ?? process.env;
  const settings = settingsFiles().map(readSettings);
  const cloudProvider = usesCloudProvider(settings.map((s) => s.env), shellEnv);
  const keys = activeHijackKeys(cloudProvider);
  const files = settings.map((s) => toFinding(s, keys));

  const shellOverrides: Record<string, string> = {};
  for (const key of keys) {
    const v = shellEnv[key];
    if (v) shellOverrides[key] = maskValue(key, v);
  }

  // 找出被改道到的中转端点（文件里的优先，其次 shell），纯展示用。
  let baseUrl: string | undefined;
  for (const f of files) {
    if (f.hijackKeys.ANTHROPIC_BASE_URL) {
      const raw = JSON.parse(readFileSync(f.path, 'utf-8'))?.env?.ANTHROPIC_BASE_URL;
      if (raw) { baseUrl = raw; break; }
    }
  }
  if (!baseUrl && shellEnv.ANTHROPIC_BASE_URL) baseUrl = shellEnv.ANTHROPIC_BASE_URL;

  const fileHijacked = files.some((f) => Object.keys(f.hijackKeys).length > 0);
  const shellHijacked = Object.keys(shellOverrides).length > 0;
  const parseError = files.some((f) => f.parseError);

  return {
    healthy: !fileHijacked && !shellHijacked && !parseError,
    files,
    shellOverrides,
    cloudProvider,
    ...(baseUrl ? { baseUrl } : {}),
  };
}

export interface RepairedFile {
  path: string;
  /** 从该文件 env 里删掉的键名 */
  removedKeys: string[];
  /** 备份路径（改动前的原文件），没改动则为 null */
  backup: string | null;
  /** env 删空后是否连 env 键一起移除了 */
  removedEmptyEnv: boolean;
}

export interface RepairResult {
  changed: boolean;
  files: RepairedFile[];
  /** 无法自动修复、需用户手动处理的 shell 层残留（键名列表） */
  shellOverridesRemaining: string[];
  /** 解析失败被跳过、需用户手动查看的文件 */
  skipped: { path: string; reason: string }[];
}

function backupIfExists(path: string): string | null {
  if (!existsSync(path)) return null;
  const backupPath = `${path}.ao-backup-${Date.now()}`;
  copyFileSync(path, backupPath);
  return backupPath;
}

/**
 * 一键修复：把每个 settings 文件里劫持相关的 env 键删掉（先备份），env 空了就
 * 移除 env 键；不动其它配置，不动 shell。返回改了什么 + 需用户手动处理的残留。
 */
export function repairClaudeConfig(opts: ShellEnvOptions = {}): RepairResult {
  const repaired: RepairedFile[] = [];
  const skipped: { path: string; reason: string }[] = [];
  const shellEnv = opts.shellEnv ?? process.env;

  // 先整体判一次模式：Bedrock/Vertex 下模型名键装的是云上的模型 ID，删了等于毁用户配置。
  const keys = activeHijackKeys(usesCloudProvider(settingsFiles().map((p) => readSettings(p).env), shellEnv));

  for (const path of settingsFiles()) {
    if (!existsSync(path)) continue;
    let obj: any;
    try {
      obj = JSON.parse(readFileSync(path, 'utf-8'));
    } catch (err: any) {
      // 解析不了绝不覆写 —— 宁可让用户手动看，也不销毁可能有救的内容。
      skipped.push({ path, reason: err?.message || String(err) });
      continue;
    }
    const env = obj && typeof obj === 'object' ? obj.env : undefined;
    if (!env || typeof env !== 'object') continue;

    const removedKeys: string[] = [];
    for (const key of keys) {
      if (env[key] != null) { delete env[key]; removedKeys.push(key); }
    }
    if (removedKeys.length === 0) continue;

    const backup = backupIfExists(path);
    let removedEmptyEnv = false;
    if (Object.keys(env).length === 0) { delete obj.env; removedEmptyEnv = true; }
    writeFileSync(path, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
    repaired.push({ path, removedKeys, backup, removedEmptyEnv });
  }

  // shell 层的 export 我们不碰用户的 ~/.zshrc，只把还在的键名报出来让用户自己删。
  const shellOverridesRemaining = keys.filter((k) => shellEnv[k]);

  return {
    changed: repaired.length > 0,
    files: repaired,
    shellOverridesRemaining,
    skipped,
  };
}
