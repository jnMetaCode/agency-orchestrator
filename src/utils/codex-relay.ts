/**
 * Codex CLI 的"第三方中转"配置写入器。
 *
 * Codex（跟 claude-code / gemini-cli 不一样）没有环境变量覆盖机制 —— 它的模型
 * provider 路由只能通过 ~/.codex/config.toml + ~/.codex/auth.json 这两个文件配置，
 * 没有等价于 ANTHROPIC_BASE_URL / GOOGLE_GEMINI_BASE_URL 的 env 变量可用。这意味着
 * 要让 Codex 走中转商（如 Cubence），必须写这两个文件 —— 它们在用户 home 目录，
 * 不在项目里，所以：
 *   1. 写之前总是先备份（.ao-backup-<timestamp> 后缀，不覆盖旧备份）
 *   2. 只合并/更新 AO 管理的这一段（model_provider 顶层键 + model_providers.<id> 表），
 *      保留用户自己在 config.toml 里已有的其它内容（其它 provider、其它配置项）
 *   3. auth.json 同理，只更新 OPENAI_API_KEY 字段，不动其它可能存在的字段
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, renameSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse, stringify } from 'smol-toml';

const CODEX_DIR = join(homedir(), '.codex');
const CONFIG_TOML = join(CODEX_DIR, 'config.toml');
const AUTH_JSON = join(CODEX_DIR, 'auth.json');

export interface CodexRelayConfig {
  /** provider 标识，写进 config.toml 的 [model_providers.<id>] 表名，如 "cubence" */
  providerId: string;
  /** 展示名 */
  name: string;
  baseUrl: string;
  apiKey: string;
  model?: string;
}

function backupIfExists(path: string): string | null {
  if (!existsSync(path)) return null;
  const backupPath = `${path}.ao-backup-${Date.now()}`;
  copyFileSync(path, backupPath);
  try { chmodSync(backupPath, 0o600); } catch { /* 不支持权限位的文件系统 */ }   // 备份是凭证的明文副本
  return backupPath;
}

function readTomlSafe(path: string): Record<string, any> {
  if (!existsSync(path)) return {};
  try {
    return parse(readFileSync(path, 'utf-8')) as Record<string, any>;
  } catch {
    return {}; // 只给**只读**的状态查询用（读不动就当没配）——要写回去的路径一律走 strict
  }
}

/**
 * 要**写回**这两个文件之前，必须能先把它们完整读懂。
 * 读不懂就当空文件处理 = 把用户手里那份配置整个换成空的：config.toml 里他自己的 provider 全没了，
 * auth.json 更要命——里面除了 OPENAI_API_KEY 还有 Codex 的 OAuth tokens，覆盖掉就是把登录态删了。
 * 宁可当场停手让用户自己看一眼。
 */
function readForWrite(path: string, kind: 'toml' | 'json'): Record<string, any> {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, 'utf-8');
  try {
    return (kind === 'toml' ? parse(text) : JSON.parse(text)) as Record<string, any>;
  } catch (err) {
    throw new Error(
      `${path} 解析失败，为避免把你的 Codex 配置覆盖成空的，这次不动它：${err instanceof Error ? err.message.slice(0, 120) : err}\n`
      + `  请先手动修好这个文件（或把它挪走让 Codex 重新生成）再试。`,
    );
  }
}

/** 凭证文件：原子写 + 0600。直接 writeFileSync 是先截断——中途崩了就剩个半截的 settings/auth。 */
function writeSecret(path: string, text: string): void {
  const tmp = `${path}.ao-tmp`;
  writeFileSync(tmp, text, { encoding: 'utf-8', mode: 0o600 });
  renameSync(tmp, path);
  try { chmodSync(path, 0o600); } catch { /* 不支持权限位的文件系统 */ }
}

/**
 * 把中转配置合并写入 Codex 的 config.toml + auth.json。
 * 返回本次实际产生的备份文件路径（供上层提示用户"已备份到 xxx"）。
 */
export function applyCodexRelay(cfg: CodexRelayConfig): { backups: string[] } {
  mkdirSync(CODEX_DIR, { recursive: true });
  const backups: string[] = [];

  const configBackup = backupIfExists(CONFIG_TOML);
  if (configBackup) backups.push(configBackup);
  const doc = readForWrite(CONFIG_TOML, 'toml');
  doc.model_provider = cfg.providerId;
  if (cfg.model) doc.model = cfg.model;
  doc.model_providers = doc.model_providers && typeof doc.model_providers === 'object' ? doc.model_providers : {};
  doc.model_providers[cfg.providerId] = {
    name: cfg.name,
    base_url: cfg.baseUrl.replace(/\/+$/, ''),
    wire_api: 'responses',
    requires_openai_auth: true,
  };
  writeSecret(CONFIG_TOML, stringify(doc));

  const authBackup = backupIfExists(AUTH_JSON);
  if (authBackup) backups.push(authBackup);
  const auth = readForWrite(AUTH_JSON, 'json');
  auth.OPENAI_API_KEY = cfg.apiKey;
  writeSecret(AUTH_JSON, JSON.stringify(auth, null, 2));

  return { backups };
}

/**
 * 清除 AO 写入的中转配置：把 config.toml 的 model_provider 顶层覆盖去掉（不删除
 * model_providers.<id> 这张表本身，避免用户下次想切回来还得重填 base_url），
 * auth.json 里的 key 置空。不影响用户自己其它的 provider 配置。
 */
export function clearCodexRelay(providerId: string): void {
  if (existsSync(CONFIG_TOML)) {
    // 和 apply 一样先备份：这条路径以前**一个备份都不留**，而它照样在整份重写用户的配置
    backupIfExists(CONFIG_TOML);
    const doc = readForWrite(CONFIG_TOML, 'toml');
    if (doc.model_provider === providerId) delete doc.model_provider;
    if (doc.model_providers && typeof doc.model_providers === 'object') {
      delete doc.model_providers[providerId];
    }
    writeSecret(CONFIG_TOML, stringify(doc));
  }
  if (existsSync(AUTH_JSON)) {
    backupIfExists(AUTH_JSON);
    const auth = readForWrite(AUTH_JSON, 'json');
    delete auth.OPENAI_API_KEY;
    writeSecret(AUTH_JSON, JSON.stringify(auth, null, 2));
  }
}

/** 当前是否已配置了给定 provider 的中转（供 UI 展示状态用）。 */
export function readCodexRelayStatus(providerId: string): { configured: boolean; baseUrl?: string } {
  const doc = readTomlSafe(CONFIG_TOML);
  const active = doc.model_provider === providerId;
  const providerCfg = doc.model_providers?.[providerId];
  return {
    configured: active && !!providerCfg,
    baseUrl: providerCfg?.base_url,
  };
}
