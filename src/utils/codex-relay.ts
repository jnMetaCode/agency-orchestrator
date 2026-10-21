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
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { parse } from 'smol-toml';
import { withConfigTransaction } from './config-transaction.js';
import { describeParseError } from './config-safety.js';
import { rewriteToml } from './toml-edit.js';

const CODEX_DIR = process.env.AO_CODEX_DIR || join(homedir(), '.codex');
const CONFIG_TOML = join(CODEX_DIR, 'config.toml');
const AUTH_JSON = join(CODEX_DIR, 'auth.json');
const STATE_NAME = '.ao-relay-state.json';
const STATE_JSON = join(CODEX_DIR, STATE_NAME);
const FILES = ['config.toml', 'auth.json', STATE_NAME] as const;
// Preview tokens are opaque and process-local: a backend restart requires a fresh preview.
const PREVIEW_KEY = randomBytes(32);

export class CodexConfigChangedError extends Error {
  readonly code = 'CONFIG_CHANGED';
  constructor() { super('Codex 配置在确认后发生了变化，请刷新后重新确认'); }
}

function configRevision(): string {
  const snapshot = FILES.map(name => {
    try { return [name, readFileSync(join(CODEX_DIR, name), 'utf-8')]; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [name, null]; throw error; }
  });
  return createHmac('sha256', PREVIEW_KEY).update(JSON.stringify(snapshot)).digest('hex');
}

const keyDigest = (value: string): string => createHash('sha256').update(value).digest('hex');

export interface CodexRelayConfig {
  /** provider 标识，写进 config.toml 的 [model_providers.<id>] 表名，如 "cubence" */
  providerId: string;
  /** 展示名 */
  name: string;
  baseUrl: string;
  apiKey: string;
  model?: string;
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
/** 事务基线校验保证这里读到的就是 readForWrite 解析的那份 */
const readText = (path: string): string => existsSync(path) ? readFileSync(path, 'utf-8') : '';

function readForWrite(path: string, kind: 'toml' | 'json'): Record<string, any> {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, 'utf-8');
  try {
    const doc = kind === 'toml' ? parse(text) : JSON.parse(text);
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('配置必须是对象');
    return doc as Record<string, any>;
  } catch (err) {
    throw new Error(
      // 不拼解析器原文：auth.json 写坏时，那段原文就是 key
      `${path} 解析失败，为避免把你的 Codex 配置覆盖成空的，这次不动它：${describeParseError(err)}\n`
      + `  请先手动修好这个文件（或把它挪走让 Codex 重新生成）再试。`,
    );
  }
}

interface SavedValue { present: boolean; value?: unknown }
interface ManagedField {
  file: 'config' | 'auth';
  path: string[];
  before: SavedValue;
  after: SavedValue & { sha256?: string };
}
interface RelayState {
  version: 1 | 2;
  providerId: string;
  providersCreated: boolean;
  fields: ManagedField[];
}
const reserved = new Set(['__proto__', 'prototype', 'constructor']);

function readState(): RelayState | null {
  if (!existsSync(STATE_JSON)) return null;
  const state = readForWrite(STATE_JSON, 'json') as unknown as RelayState;
  const saved = (v: SavedValue) => v && typeof v.present === 'boolean' && (!v.present || Object.hasOwn(v, 'value'));
  const expected = (f: ManagedField) => state.version === 2 && f.file === 'auth'
    ? f.after && f.after.present === true && typeof f.after.sha256 === 'string' && /^[a-f0-9]{64}$/.test(f.after.sha256) && !Object.hasOwn(f.after, 'value')
    : saved(f.after);
  if (![1, 2].includes(state.version) || typeof state.providerId !== 'string' || typeof state.providersCreated !== 'boolean'
    || !Array.isArray(state.fields) || !state.fields.length || state.fields.some(f => !f || !Array.isArray(f.path)
      || f.path.some(p => typeof p !== 'string' || reserved.has(p)) || !saved(f.before) || !expected(f)
      || !(f.file === 'auth' && f.path.length === 1 && f.path[0] === 'OPENAI_API_KEY'
        || f.file === 'config' && (f.path.length === 1 && ['model_provider', 'model'].includes(f.path[0])
          || f.path.length === 2 && f.path[0] === 'model_providers')))
    || new Set(state.fields.map(f => JSON.stringify([f.file, f.path]))).size !== state.fields.length) {
    throw new Error('AO Codex 受管字段记录无效，为安全起见不修改配置');
  }
  const provider = state.fields.find(f => f.file === 'config' && f.path.length === 1 && f.path[0] === 'model_provider');
  const key = state.fields.find(f => f.file === 'auth' && f.path[0] === 'OPENAI_API_KEY');
  if (!provider?.after.present || provider.after.value !== state.providerId || !key?.after.present
    || (state.version === 1 && typeof key.after.value !== 'string')) {
    throw new Error('AO Codex 受管字段记录不完整，为安全起见不修改配置');
  }
  return state;
}

/** Keep the recoverable baseline, but never duplicate the current key just to detect drift. */
function serializeState(state: RelayState): string {
  return JSON.stringify({ ...state, version: 2, fields: state.fields.map(field => field.file === 'auth'
    ? { ...field, after: { present: true, sha256: typeof field.after.value === 'string' ? keyDigest(field.after.value) : field.after.sha256 } }
    : field) }, null, 2);
}

function getField(doc: Record<string, any>, path: string[]): SavedValue {
  let object = doc;
  for (const key of path.slice(0, -1)) {
    if (!object || typeof object !== 'object' || !Object.hasOwn(object, key)) return { present: false };
    object = object[key];
  }
  const key = path[path.length - 1];
  return object && typeof object === 'object' && Object.hasOwn(object, key)
    ? { present: true, value: object[key] } : { present: false };
}

function setField(doc: Record<string, any>, path: string[], saved: SavedValue): void {
  let object = doc;
  for (const key of path.slice(0, -1)) {
    if (!object[key] || typeof object[key] !== 'object') {
      if (!saved.present) return;
      object[key] = {};
    }
    object = object[key];
  }
  if (saved.present) object[path[path.length - 1]] = saved.value;
  else delete object[path[path.length - 1]];
}

function checkOwnership(state: RelayState, doc: Record<string, any>, auth: Record<string, any>): void {
  for (const field of state.fields) {
    const actual = getField(field.file === 'config' ? doc : auth, field.path);
    const matches = state.version === 2 && field.file === 'auth'
      ? actual.present && typeof actual.value === 'string' && keyDigest(actual.value) === field.after.sha256
      : isDeepStrictEqual(actual, field.after);
    if (!matches) {
      throw new Error(`Codex 配置已由外部修改，请先处理冲突：${field.file === 'config' ? 'config.toml' : 'auth.json'} ${field.path.join('.')}`);
    }
  }
}

/**
 * 把中转配置合并写入 Codex 的 config.toml + auth.json。
 * 返回本次实际产生的备份文件路径（供上层提示用户"已备份到 xxx"）。
 */
export function applyCodexRelay(cfg: CodexRelayConfig, opts: { expectedRevision?: string } = {}): { backups: string[] } {
  if (!cfg.providerId || reserved.has(cfg.providerId) || !cfg.baseUrl || !cfg.apiKey) throw new Error('providerId、baseUrl 和 apiKey 无效或为空');
  return withConfigTransaction(CODEX_DIR, FILES, commit => {
    assertPreview(opts);
    const doc = readForWrite(CONFIG_TOML, 'toml');
    const auth = readForWrite(AUTH_JSON, 'json');
    if (Object.hasOwn(doc, 'model_providers') && (!doc.model_providers || typeof doc.model_providers !== 'object' || Array.isArray(doc.model_providers))) {
      throw new Error('Codex model_providers 必须是配置表，为安全起见不修改配置');
    }
    const state = readState() ?? {
      version: 1 as const, providerId: cfg.providerId,
      providersCreated: !Object.hasOwn(doc, 'model_providers'), fields: [],
    };
    checkOwnership(state, doc, auth);
    const update = (file: 'config' | 'auth', path: string[], after: SavedValue) => {
      const target = file === 'config' ? doc : auth;
      const previous = state.fields.find(f => f.file === file && isDeepStrictEqual(f.path, path));
      if (previous) previous.after = after;
      else state.fields.push({ file, path, before: getField(target, path), after });
      setField(target, path, after);
    };
    update('config', ['model_provider'], { present: true, value: cfg.providerId });
    if (cfg.model) update('config', ['model'], { present: true, value: cfg.model });
    else {
      const previousModel = state.fields.find(f => f.file === 'config' && f.path.length === 1 && f.path[0] === 'model');
      if (previousModel) update('config', ['model'], previousModel.before);
    }
    update('config', ['model_providers', cfg.providerId], { present: true, value: {
      name: cfg.name, base_url: cfg.baseUrl.replace(/\/+$/, ''), wire_api: 'responses', requires_openai_auth: true,
    } });
    update('auth', ['OPENAI_API_KEY'], { present: true, value: cfg.apiKey });
    state.providerId = cfg.providerId;
    return { backups: commit([
      { name: 'config.toml', text: rewriteToml(readText(CONFIG_TOML), doc) },
      { name: 'auth.json', text: JSON.stringify(auth, null, 2) },
      { name: STATE_NAME, text: serializeState(state) },
    ]) };
  });
}

/** Restore only fields written by AO; unknown legacy ownership requires explicit resolution. */
export function clearCodexRelay(providerId: string, opts: { expectedRevision?: string } = {}): void {
  if (!providerId) throw new Error('providerId 不能为空');
  withConfigTransaction(CODEX_DIR, FILES, commit => {
    assertPreview(opts);
    const doc = readForWrite(CONFIG_TOML, 'toml');
    if (doc.model_provider !== providerId) return;
    const auth = readForWrite(AUTH_JSON, 'json');
    const state = readState();
    if (!state || state.providerId !== providerId) throw new Error('历史 Codex 配置缺少 AO 字段所有权记录，请先检查备份，不自动删除凭据');
    checkOwnership(state, doc, auth);
    for (const field of [...state.fields].reverse()) setField(field.file === 'config' ? doc : auth, field.path, field.before);
    if (state.providersCreated && doc.model_providers && Object.keys(doc.model_providers).length === 0) delete doc.model_providers;
    commit([
      { name: 'config.toml', text: rewriteToml(readText(CONFIG_TOML), doc) },
      { name: 'auth.json', text: JSON.stringify(auth, null, 2) },
      { name: STATE_NAME, text: null },
    ]);
  });
}

export interface LegacyRemoveOptions {
  /** 同时删除 auth.json 的 OPENAI_API_KEY；默认保留，由用户决定 */
  deleteKey?: boolean;
  /** 用户确认时看到的 base_url；执行时不一致说明配置在确认后变了，拒绝 */
  expectedBaseUrl?: string;
  /** Optional for direct library calls; required by Studio's preview/confirm API. */
  expectedRevision?: string;
}

function assertPreview(opts: { expectedRevision?: string }): void {
  if (opts.expectedRevision !== undefined && configRevision() !== opts.expectedRevision) throw new CodexConfigChangedError();
}

/**
 * 旧版 AO 写入、没有所有权记录的中转：只移除 AO 约定 id 的路由选择和它那张 provider 表。
 * 和 clearCodexRelay 不是一回事——没有记录就找不回"切换前"，这里只是退出，不是恢复：
 *   - model 不动（不知道是谁设的），返回给调用方提示用户自己看；
 *   - key 默认保留；OAuth tokens 和其它字段从不碰；
 *   - 移除路由 ≠ 官方登录可用，那还取决于登录态，调用方不能据此显示"已恢复官方"。
 */
export function removeLegacyCodexRelay(providerId: string, opts: LegacyRemoveOptions = {}): {
  backups: string[]; keptModel?: string; keyDeleted: boolean;
} {
  if (!providerId || reserved.has(providerId)) throw new Error('providerId 无效');
  return withConfigTransaction(CODEX_DIR, FILES, commit => {
    assertPreview(opts);
    if (readState()) throw new Error('这份 Codex 配置有 AO 所有权记录，请用「恢复切换前配置」');
    const doc = readForWrite(CONFIG_TOML, 'toml');
    if (doc.model_provider !== providerId) throw new Error('当前 Codex 没有在使用 AO 中转，无需移除');
    const table = doc.model_providers?.[providerId];
    if (opts.expectedBaseUrl !== undefined && table?.base_url !== opts.expectedBaseUrl) {
      throw new CodexConfigChangedError();
    }
    delete doc.model_provider;
    if (doc.model_providers && typeof doc.model_providers === 'object' && !Array.isArray(doc.model_providers)) {
      delete doc.model_providers[providerId];
      if (Object.keys(doc.model_providers).length === 0) delete doc.model_providers;
    }
    const updates = [{ name: 'config.toml', text: rewriteToml(readText(CONFIG_TOML), doc) as string | null }];
    let keyDeleted = false;
    if (opts.deleteKey) {
      const auth = readForWrite(AUTH_JSON, 'json');
      if (Object.hasOwn(auth, 'OPENAI_API_KEY')) {
        delete auth.OPENAI_API_KEY;
        updates.push({ name: 'auth.json', text: JSON.stringify(auth, null, 2) });
        keyDeleted = true;
      }
    }
    const backups = commit(updates);
    return { backups, keptModel: typeof doc.model === 'string' ? doc.model : undefined, keyDeleted };
  });
}

/**
 * 旧版 AO 写入的中转「改由 AO 管理」：一个字节的配置都不改，只补一份所有权记录。
 * 能确定是 AO 加的只有路由选择和 AO 约定 id 那张表（before = 不存在）；model 和 key 当年是谁设的说不清，
 * 记成 before = 当前值——将来「恢复切换前配置」只移除中转，key/model 原样留着，与「移除历史中转」的默认一致。
 */
export function adoptLegacyCodexRelay(providerId: string, opts: { expectedBaseUrl?: string; expectedRevision?: string } = {}): void {
  if (!providerId || reserved.has(providerId)) throw new Error('providerId 无效');
  withConfigTransaction(CODEX_DIR, FILES, commit => {
    assertPreview(opts);
    if (readState()) throw new Error('这份 Codex 配置已经由 AO 管理');
    const doc = readForWrite(CONFIG_TOML, 'toml');
    const auth = readForWrite(AUTH_JSON, 'json');
    if (doc.model_provider !== providerId) throw new Error('当前 Codex 没有在使用 AO 中转');
    const table = doc.model_providers?.[providerId];
    if (!table || typeof table !== 'object' || Array.isArray(table)) throw new Error('找不到 AO 中转的 provider 表，请重新保存中转');
    if (opts.expectedBaseUrl !== undefined && table.base_url !== opts.expectedBaseUrl) {
      throw new CodexConfigChangedError();
    }
    if (typeof auth.OPENAI_API_KEY !== 'string' || !auth.OPENAI_API_KEY) throw new Error('auth.json 里没有中转 key，请重新保存中转');
    const absent: SavedValue = { present: false };
    const same = (value: unknown): SavedValue => ({ present: true, value });
    const fields: ManagedField[] = [
      { file: 'config', path: ['model_provider'], before: absent, after: same(providerId) },
      { file: 'config', path: ['model_providers', providerId], before: absent, after: same(table) },
      ...(Object.hasOwn(doc, 'model') ? [{ file: 'config' as const, path: ['model'], before: same(doc.model), after: same(doc.model) }] : []),
      { file: 'auth', path: ['OPENAI_API_KEY'], before: same(auth.OPENAI_API_KEY), after: same(auth.OPENAI_API_KEY) },
    ];
    const state: RelayState = {
      version: 1, providerId, fields,
      // 只剩 AO 这一张表时，多半是当年 AO 建的；恢复后表空了就一并去掉（空表删了也无害）
      providersCreated: Object.keys(doc.model_providers).length === 1,
    };
    commit([{ name: STATE_NAME, text: serializeState(state) }]);
  });
}

/** 当前是否已配置了给定 provider 的中转（供 UI 展示状态用）。 */
export function readCodexRelayStatus(providerId: string): {
  configured: boolean; baseUrl?: string; model?: string; managed: boolean; conflict: boolean; recoveryPending: boolean; revision?: string;
} {
  let initialRevision: string | undefined;
  try { initialRevision = configRevision(); } catch { /* No trustworthy preview token. */ }
  const doc = readTomlSafe(CONFIG_TOML);
  const active = doc.model_provider === providerId;
  const providerCfg = doc.model_providers?.[providerId];
  const recoveryPending = existsSync(join(CODEX_DIR, '.ao-config-transaction.json'));
  let managed = false, conflict = false;
  try {
    const state = readState();
    if (state) {
      checkOwnership(state, doc, readForWrite(AUTH_JSON, 'json'));
      managed = state.providerId === providerId;
    }
  } catch { conflict = true; }
  let revision: string | undefined;
  try {
    const finalRevision = configRevision();
    if (initialRevision === finalRevision) revision = finalRevision;
    else conflict = true;
  } catch { conflict = true; }
  return {
    configured: active && !!providerCfg,
    baseUrl: providerCfg?.base_url,
    model: typeof doc.model === 'string' ? doc.model : undefined,
    managed: managed && !recoveryPending && !conflict,
    conflict,
    recoveryPending,
    revision,
  };
}
