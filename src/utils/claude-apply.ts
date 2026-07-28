/**
 * Claude Code 全局「安全切换」写入器 —— claude-repair 的反向镜像。
 *
 * 与 claude-repair 成对：
 *   - repair 删掉 env 里的中转键（切回官方登录，减法）
 *   - apply  写入 env 里的中转键（切到第三方中转，加法）
 *
 * 安全第一（对齐 claude-repair 的纪律）：
 *   1. 写之前总是先备份（`.ao-backup-<timestamp>` 后缀，不覆盖旧备份）
 *   2. merge 写：只覆盖/新增中转相关的几个键，保留用户 settings.json 里的其它内容
 *   3. settings.json 解析失败时绝不覆写（宁可报错，也不销毁可能有救的内容）
 *   4. 绝不触碰 ~/.claude/.credentials.json（官方 OAuth 令牌所在）
 *   5. 打「AO 管理」顶层标记 `_aoManagedProvider`，用来区分：
 *        「AO 主动切的」（healthy，可一键切回） vs 「别的工具搞坏的」（需急救）
 *      —— 标记在顶层、不在 env 里，不影响 Claude Code 运行。
 */
import { execFileSync } from 'node:child_process';
import { connect as netConnect } from 'node:net';
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { repairClaudeConfig, type RepairResult } from './claude-repair.js';

/** 顶层标记键：记录当前是 AO 切到了哪个 provider。不在 env 里，不影响 CLI 运行。 */
export const AO_MANAGED_KEY = '_aoManagedProvider';

function claudeDir(): string {
  // 与 claude-repair 一致，允许测试 / 自定义 profile 覆盖。
  return process.env.AO_CLAUDE_DIR || join(homedir(), '.claude');
}

function settingsPath(): string {
  return join(claudeDir(), 'settings.json');
}

function backupIfExists(path: string): string | null {
  if (!existsSync(path)) return null;
  const backupPath = `${path}.ao-backup-${Date.now()}`;
  copyFileSync(path, backupPath);
  return backupPath;
}

/** 读 JSON；不存在返回空对象；解析失败抛错（调用方据此中止写入，绝不覆写坏文件）。 */
function readJsonOrThrow(path: string): Record<string, any> {
  if (!existsSync(path)) return {};
  try {
    const o = JSON.parse(readFileSync(path, 'utf-8'));
    return o && typeof o === 'object' ? o : {};
  } catch (err: any) {
    throw new Error(`settings.json 解析失败，为安全起见不写入：${path}（${err?.message || err}）`);
  }
}

export interface ClaudeApplyConfig {
  /** provider id，用于标记 + 状态读回 */
  providerId: string;
  baseUrl: string;
  apiKey: string;
  /** 默认 ANTHROPIC_AUTH_TOKEN；部分中转要求 ANTHROPIC_API_KEY */
  apiKeyField?: 'ANTHROPIC_AUTH_TOKEN' | 'ANTHROPIC_API_KEY';
  model?: string;
  sonnetModel?: string;
  opusModel?: string;
  haikuModel?: string;
}

export interface ClaudeApplyResult {
  path: string;
  /** 改动前的备份路径；原文件不存在则为 null */
  backup: string | null;
  /** 实际写入 env 的键名 */
  writtenKeys: string[];
}

/**
 * 把中转 provider 安全写入 ~/.claude/settings.json（全局，任意终端的 claude 都会读到）。
 */
export function applyClaudeProvider(cfg: ClaudeApplyConfig): ClaudeApplyResult {
  if (!cfg.providerId) throw new Error('providerId 不能为空');
  if (!cfg.baseUrl || !cfg.apiKey) throw new Error('baseUrl 和 apiKey 不能为空');

  const path = settingsPath();
  const obj = readJsonOrThrow(path);        // 先读（解析失败即抛，不会往下走）
  const backup = backupIfExists(path);      // 再备份（原文件存在才备）

  const env = obj.env && typeof obj.env === 'object' ? obj.env : (obj.env = {});
  const keyField = cfg.apiKeyField ?? 'ANTHROPIC_AUTH_TOKEN';
  const written: string[] = [];
  const setEnv = (k: string, v?: string) => { if (v) { env[k] = v; written.push(k); } };

  setEnv('ANTHROPIC_BASE_URL', cfg.baseUrl);
  env[keyField] = cfg.apiKey; written.push(keyField);
  setEnv('ANTHROPIC_MODEL', cfg.model);
  setEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', cfg.sonnetModel);
  setEnv('ANTHROPIC_DEFAULT_OPUS_MODEL', cfg.opusModel);
  setEnv('ANTHROPIC_DEFAULT_HAIKU_MODEL', cfg.haikuModel);

  obj[AO_MANAGED_KEY] = cfg.providerId;     // 打 AO 管理标记

  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
  return { path, backup, writtenKeys: written };
}

export interface ClaudeSwitchStatus {
  /** 是否由 AO 主动切换（顶层有标记）→ 体检时应识别为"AO 切的"，可一键切回，而非"被搞坏" */
  managed: boolean;
  managedProviderId?: string;
  /** 当前 env 里的中转端点（若有） */
  baseUrl?: string;
  /** 是否处于"已切到中转"状态（env 里存在 ANTHROPIC_BASE_URL） */
  active: boolean;
}

/** 只读：当前 settings.json 指向哪个 provider、是否 AO 管理。不改任何文件。 */
export function readClaudeSwitchStatus(): ClaudeSwitchStatus {
  const path = settingsPath();
  if (!existsSync(path)) return { managed: false, active: false };
  let obj: any;
  try { obj = JSON.parse(readFileSync(path, 'utf-8')); }
  catch { return { managed: false, active: false }; }
  const env = obj && typeof obj === 'object' ? obj.env ?? {} : {};
  const baseUrl = env.ANTHROPIC_BASE_URL;
  const managedId = obj?.[AO_MANAGED_KEY];
  return {
    managed: managedId != null,
    ...(managedId != null ? { managedProviderId: managedId } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    active: !!baseUrl,
  };
}

export interface RestoreResult extends RepairResult {
  /** 是否移除了 AO 管理标记 */
  removedAoMarker: boolean;
  /** 是否把 macOS 当前系统代理同步给 Claude Code */
  proxySync: ClaudeProxySyncResult;
}

export interface ClaudeProxySyncResult {
  configured: boolean;
  changed: boolean;
  proxyUrl?: string;
  backup: string | null;
  reason?: string;
}

export interface RestoreOptions {
  /** 测试/显式调用可直接传代理；生产默认从 macOS 系统代理自动检测。 */
  proxyUrl?: string;
  detectSystemProxy?: boolean;
}

/**
 * 读取 macOS「系统设置 → 网络 → 代理」里的 HTTPS/HTTP 代理。
 * scutil 的 HTTPSProxy 表示“用于 HTTPS 请求的 HTTP CONNECT 代理”，因此 URL scheme
 * 仍然是 http://；这也符合 Claude Code 对 HTTPS_PROXY 的官方用法。
 */
export function detectMacOSSystemProxy(): string | undefined {
  if (process.platform !== 'darwin') return undefined;
  let out = '';
  try {
    out = execFileSync('/usr/sbin/scutil', ['--proxy'], { encoding: 'utf-8', timeout: 3000 });
  } catch {
    return undefined;
  }
  const field = (name: string): string | undefined => {
    const m = out.match(new RegExp(`\\b${name}\\s*:\\s*([^\\n]+)`));
    return m?.[1]?.trim();
  };
  const enabled = field('HTTPSEnable') === '1' || field('HTTPEnable') === '1';
  const host = field('HTTPSProxy') || field('HTTPProxy');
  const portRaw = field('HTTPSPort') || field('HTTPPort');
  const port = Number(portRaw);
  if (!enabled || !host || !Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  const safeHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `http://${safeHost}:${port}`;
}

/** 把已检测到的 HTTP CONNECT 代理 merge 到 Claude 全局 settings，保留其它设置。 */
export function syncClaudeProxy(proxyUrl?: string): ClaudeProxySyncResult {
  if (!proxyUrl) return { configured: false, changed: false, backup: null, reason: 'system-proxy-not-found' };
  let parsed: URL;
  try { parsed = new URL(proxyUrl); }
  catch { return { configured: false, changed: false, backup: null, reason: 'invalid-proxy-url' }; }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || !parsed.port || parsed.username || parsed.password) {
    return { configured: false, changed: false, backup: null, reason: 'unsupported-proxy-url' };
  }

  const path = settingsPath();
  let obj: Record<string, any>;
  try { obj = readJsonOrThrow(path); }
  catch (err: any) {
    return { configured: false, changed: false, backup: null, reason: err?.message || String(err) };
  }
  const env = obj.env && typeof obj.env === 'object' ? obj.env : (obj.env = {});
  if (env.HTTP_PROXY === proxyUrl && env.HTTPS_PROXY === proxyUrl) {
    return { configured: true, changed: false, proxyUrl, backup: null };
  }

  mkdirSync(claudeDir(), { recursive: true });
  const backup = backupIfExists(path);
  env.HTTP_PROXY = proxyUrl;
  env.HTTPS_PROXY = proxyUrl;
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
  return { configured: true, changed: true, proxyUrl, backup };
}

/**
 * 一键切回官方登录：复用 claude-repair 删除所有中转 env 键（settings.json + settings.local.json），
 * 并额外清掉 AO 管理标记，回到干净的官方登录状态。
 */
export function restoreClaudeToOfficial(options: RestoreOptions = {}): RestoreResult {
  const result = repairClaudeConfig();      // 复用现成、已测试的减法逻辑（含备份）
  // 清掉顶层 AO 标记（repair 只管 env 键，不认识这个标记）
  let removedAoMarker = false;
  const path = settingsPath();
  if (existsSync(path)) {
    try {
      const obj = JSON.parse(readFileSync(path, 'utf-8'));
      if (obj && typeof obj === 'object' && obj[AO_MANAGED_KEY] != null) {
        delete obj[AO_MANAGED_KEY];
        writeFileSync(path, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
        removedAoMarker = true;
      }
    } catch { /* 解析失败：repair 已跳过并报告，这里不重复处理 */ }
  }
  const shouldDetect = options.detectSystemProxy !== false;
  const proxyUrl = options.proxyUrl || (shouldDetect ? detectMacOSSystemProxy() : undefined);
  const proxySync = syncClaudeProxy(proxyUrl);
  return {
    ...result,
    changed: result.changed || removedAoMarker || proxySync.changed,
    removedAoMarker,
    proxySync,
  };
}

// ── 代理「可见 + 可管理」：把写进 settings 的 HTTP(S)_PROXY 变成看得见、能探测、能拆的状态 ──
// 背景：还原时会把系统代理写进 settings.json，让系统 claude 能走 Clash。但这也成了一个静态
// 依赖 —— 哪天 Clash 没开 / 换了端口，claude 就连不上，而劫持体检（只查 ANTHROPIC_*）看不到。
// 这里补上：读出已配代理、探测是否可达、检测与当前系统代理的漂移、一键移除。

export interface ClaudeProxyStatus {
  /** settings.json 里配置的代理（优先 HTTPS_PROXY，回退 HTTP_PROXY）；未配置则无 */
  configured?: string;
  /** 当前 macOS 系统代理（scutil）；无则无 */
  systemProxy?: string;
  /** 已配代理 ≠ 当前系统代理（漂移，建议更新） */
  drift: boolean;
}

/** 只读：settings.json 里配的代理 + 当前系统代理 + 是否漂移。不改任何文件。 */
export function readClaudeProxyStatus(): ClaudeProxyStatus {
  const path = settingsPath();
  let configured: string | undefined;
  if (existsSync(path)) {
    try {
      const obj = JSON.parse(readFileSync(path, 'utf-8'));
      const env = obj && typeof obj === 'object' ? obj.env ?? {} : {};
      configured = env.HTTPS_PROXY || env.HTTP_PROXY || undefined;
    } catch { /* 坏 JSON：当作未配置，不报错 */ }
  }
  const systemProxy = detectMacOSSystemProxy();
  const drift = !!configured && !!systemProxy && configured !== systemProxy;
  return {
    ...(configured ? { configured } : {}),
    ...(systemProxy ? { systemProxy } : {}),
    drift,
  };
}

/** 探测代理是否可连（TCP 连 host:port）。用来判断「配了代理但 Clash 没开」→ claude 会连不上。 */
export function probeProxyReachable(proxyUrl: string, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    let url: URL;
    try { url = new URL(proxyUrl); } catch { return resolve(false); }
    const port = Number(url.port);
    const host = url.hostname.replace(/^\[|\]$/g, ''); // 去 IPv6 方括号
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return resolve(false);
    const sock = netConnect({ host, port });
    let done = false;
    const finish = (ok: boolean) => { if (done) return; done = true; sock.destroy(); resolve(ok); };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
  });
}

/** 移除 Claude 全局代理（HTTP_PROXY/HTTPS_PROXY），改回直连。写前备份；env 空则连 env 一起删。 */
export function clearClaudeProxy(): { changed: boolean; backup: string | null } {
  const path = settingsPath();
  if (!existsSync(path)) return { changed: false, backup: null };
  let obj: Record<string, any>;
  try { obj = JSON.parse(readFileSync(path, 'utf-8')); }
  catch { return { changed: false, backup: null }; } // 坏 JSON 绝不覆写
  const env = obj && typeof obj === 'object' ? obj.env : undefined;
  if (!env || typeof env !== 'object' || (env.HTTP_PROXY == null && env.HTTPS_PROXY == null)) {
    return { changed: false, backup: null };
  }
  const backup = backupIfExists(path);
  delete env.HTTP_PROXY;
  delete env.HTTPS_PROXY;
  if (Object.keys(env).length === 0) delete obj.env;
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
  return { changed: true, backup };
}
