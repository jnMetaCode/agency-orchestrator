#!/usr/bin/env node
/**
 * agency-orchestrator web UI backend
 * - Lists workflows/*.yaml
 * - Spawns `ao run` and streams output via SSE
 * - Browse ao-output/ history and resume from any step
 * Not for production — single-user local tool for testing + demo recording.
 */
import express from 'express';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, unlinkSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join, dirname, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { tmpdir, homedir } from 'node:os';
import yaml from 'js-yaml';
import { detectInstalledCliProviders, detectUsableCliProviders } from '../dist/providers/detect.js';
import { API_PROVIDERS, API_PROVIDER_MAP, ANTHROPIC_PROVIDERS, ANTHROPIC_PROVIDER_MAP, VIDEO_PROVIDERS, VIDEO_PROVIDER_MAP } from '../dist/connectors/api-providers.js';
import { STYLE_PRESETS } from '../dist/media/styles.js';
// base_url 规整 / 跳转保持 POST / 少写多写 /v1 兜底 —— 与运行时连接器同一份实现，
// 保证「测试连接」和真正跑起来的行为一致（不会出现测试过了但一跑就 405）。
import { normalizeBaseUrl, postChatCompletions, postApiEndpoint, endpointHint, joinEndpoint } from '../dist/connectors/openai-compatible.js';
// Anthropic 协议的 base 归一化（客户端会自己接 /v1/messages，base 不能自带 /v1）
import { normalizeAnthropicBaseUrl } from '../dist/connectors/claude.js';
import { applyCodexRelay, clearCodexRelay, readCodexRelayStatus } from '../dist/utils/codex-relay.js';
import { diagnoseClaudeConfig, HIJACK_ENV_KEYS } from '../dist/utils/claude-repair.js';
import { applyClaudeProvider, restoreClaudeToOfficial, readClaudeSwitchStatus, readClaudeProxyStatus, probeProxyReachable, clearClaudeProxy, syncClaudeProxy, detectSystemProxy } from '../dist/utils/claude-apply.js';
import { validateCustomProviderId, readCustomProviders, addCustomProvider, removeCustomProvider, updateCustomProvider } from '../dist/utils/custom-providers.js';
import { rotatingSponsors, rotateFrom } from '../dist/utils/sponsor-guide.js';
// 代理诊断与连接器共用同一份口径（curl 能通而 AO 连不上的头号原因）
import { envProxyHint } from '../dist/connectors/endpoint.js';
import { BUDGET_CAPABLE_PROVIDERS } from '../dist/cli/compose.js';
// 环境里配了代理就接管全局 dispatcher（Node 的 fetch 默认不读 HTTP(S)_PROXY）。
// 放在最前面:清单拉取、测试连接、获取模型列表都要用它;没配代理时什么都不做。
import { installEnvProxy } from '../dist/utils/env-proxy.js';
await installEnvProxy();

// Codex 没有环境变量覆盖机制，中转配置写在 ~/.codex/config.toml + auth.json 里，
// 用固定的内部 provider id（不管用户填的是哪家中转商），避免还要在 UI 里加个
// "供应商标识"输入框——跟 claude-code/gemini-cli 的两字段中转表单保持一致简单。
const CODEX_RELAY_ID = 'ao-relay';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const WORKFLOWS_DIR = join(ROOT, 'workflows');
// 英文内置模板库（curated）。英文站按语言 serve；没有英文版的模板不混中文进来。
const WORKFLOWS_DIR_EN = join(ROOT, 'workflows', 'en');
// Optional extra workflows dir for your own/team workflows, e.g. set
// AO_USER_WORKFLOWS_DIR=marketing/workflows (absolute or ROOT-relative). Off by default.
const USER_WORKFLOWS_DIR = process.env.AO_USER_WORKFLOWS_DIR
  ? resolve(ROOT, process.env.AO_USER_WORKFLOWS_DIR)
  : '';
// Writable data dir. In dev this is the repo root; in the packaged desktop app
// the bundle is read-only, so the Electron shell passes AO_DATA_DIR (userData)
// and we redirect all writes (outputs, composed workflows, keys) there.
const DATA_DIR = process.env.AO_DATA_DIR ? resolve(process.env.AO_DATA_DIR) : ROOT;
// User-composed / saved workflows (gitignored). Always writable & runnable.
const COMPOSED_DIR = join(DATA_DIR, 'ao-workflows');
const AGENTS_DIR = join(ROOT, 'node_modules', 'agency-agents-zh');
// 英文角色库（随包发布的 agency-agents）。英文站按语言加载它，避免 /en 显示中文角色。
const AGENTS_DIR_EN = join(ROOT, 'agency-agents');
// 自定义角色目录（自带私有专家）：AO_AGENTS_DIR 存在时覆盖内置库，CLI 与 Studio 共用同一开关。
const CUSTOM_AGENTS_DIR = process.env.AO_AGENTS_DIR ? resolve(process.env.AO_AGENTS_DIR) : '';
// 用户自建角色目录（「我的」分类）：与内置库叠加而非替换，CLI（my/<id>）与 Studio 共用。
// 与 ~/.ao/teams、~/.ao/prompts 同体系；引擎侧解析在 src/agents/loader.ts（userRolesDir）。
const USER_ROLES_DIR = process.env.AO_USER_ROLES_DIR
  ? resolve(process.env.AO_USER_ROLES_DIR)
  : join(homedir(), '.ao', 'roles');
// 官方多语言角色库（npm 包）。装了才出现在 Studio「角色库」下拉里；zh/en 内置必有。
// 只认 node_modules（生产与开发一致），不做同级仓兜底——避免本地副本掩盖已发布包的问题。
const LANG_LIBS = [
  { id: 'pt-br', pkg: 'agency-agents-pt-br', label: 'Português (BR)' },
  { id: 'ko', pkg: 'agency-agents-ko', label: '한국어' },
  { id: 'ar', pkg: 'agency-agents-ar', label: 'العربية' },
  { id: 'id', pkg: 'agency-agents-id', label: 'Bahasa Indonesia' },
  { id: 'ru', pkg: 'agency-agents-ru', label: 'Русский' },
];
function langLibDir(id) {
  const lib = LANG_LIBS.find(l => l.id === id);
  if (!lib) return '';
  const dir = join(ROOT, 'node_modules', lib.pkg);
  return existsSync(dir) ? dir : '';
}
/** 归一化角色库语言：zh/en 或已安装的语言包 id；其余一律回落 zh。 */
function normalizeRoleLang(lang) {
  if (lang === 'en') return 'en';
  if (typeof lang === 'string' && langLibDir(lang)) return lang;
  return 'zh';
}
/** Studio「角色库」下拉的可选项（zh/en + 已安装语言包）。 */
function installedRoleLibs() {
  return [
    { id: 'zh', label: '中文' },
    { id: 'en', label: 'English' },
    ...LANG_LIBS.filter(l => langLibDir(l.id)).map(l => ({ id: l.id, label: l.label })),
  ];
}
function agentsDirFor(lang) {
  if (CUSTOM_AGENTS_DIR && existsSync(CUSTOM_AGENTS_DIR)) return CUSTOM_AGENTS_DIR;
  const libDir = langLibDir(lang);
  if (libDir) return libDir;
  if (lang === 'en' && existsSync(AGENTS_DIR_EN)) return AGENTS_DIR_EN;
  return existsSync(AGENTS_DIR) ? AGENTS_DIR : AGENTS_DIR_EN;
}
const OUTPUT_DIR = join(DATA_DIR, 'ao-output');
const CLI = join(ROOT, 'dist', 'cli.js');
// Node binary used to spawn the engine. Plain `node` normally; in the packaged
// Electron app there is no `node` on PATH, so the desktop shell passes AO_NODE
// (Electron's own binary, run with ELECTRON_RUN_AS_NODE=1 inherited via env).
const NODE_BIN = process.env.AO_NODE || 'node';
const PORT = process.env.PORT || 8088;
// Local single-user tool — bind to loopback by default. Set HOST=0.0.0.0 to expose (not recommended).
const HOST = process.env.HOST || '127.0.0.1';

let PKG_VERSION = '0.0.0';
try { PKG_VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).version; } catch {}

// Path containment check that resolves `..` and avoids sibling-prefix matches.
function isInside(child, parent) {
  if (!parent) return false;
  const c = resolve(child);
  const p = resolve(parent);
  return c === p || c.startsWith(p + sep);
}
const ALLOWED_WORKFLOW_DIRS = [WORKFLOWS_DIR, WORKFLOWS_DIR_EN, USER_WORKFLOWS_DIR, COMPOSED_DIR].filter(Boolean);

// 默认 provider 位 = 一项赞助权益（前端同一口径在 website/src/lib/studio.ts 的
// DEFAULT_PROVIDER）。此前这个 id 在本文件里写死了 5 处，改一处漏四处就会出现
// "界面默认选 A、后端兜底跑 B"这种最难自证的错位 —— 收成一个常量。
// 沿革：deepseek → apinebula → duoyuanx（2026-07-17）→ apinebula（2026-08-17，
// 多元探索赞助到期下架）。AO_PROVIDER 环境变量永远优先于它。
const DEFAULT_PROVIDER_ID = 'apinebula';
const CLI_PROVIDERS = ['claude-code', 'antigravity-cli', 'gemini-cli', 'copilot-cli', 'codex-cli', 'openclaw-cli', 'hermes-cli'];
// LLM config: provider + (model/base_url where the runtime needs them). Reads any
// per-provider overrides the user saved in the Studio (model name, custom base_url).
// Already YAML-safe (no undefined fields) — used for compose, run args and run-role.
function buildLLMConfig(provider) {
  const p = provider || process.env.AO_PROVIDER || DEFAULT_PROVIDER_ID;
  const cfg = { provider: p, max_tokens: 4096 };
  if (CLI_PROVIDERS.includes(p)) return cfg; // local CLI: no model/key/base needed
  let saved = {};
  try { saved = readKeys()[p] || {}; } catch {}
  // deepseek/openai/apinebula/agnes/rootflowai 等聚合 API 的默认模型统一在 api-providers.ts
  // 注册,新增一家不用改这里;claude 走原生 SDK,不在那张表里,单独判断;
  // 远程清单上架的赞助商(remoteProviderSpec)默认模型/端点来自清单。
  // 模型换代时清单的 providerOverrides 优先于内置默认——改官网清单即可全网生效,不用发版。
  const remote = remoteProviderSpec(p);
  const override = providerOverrideSpec(p);
  const defModel = override?.defaultModel
    || (p === 'claude' ? 'claude-sonnet-5' : API_PROVIDER_MAP[p]?.defaultModel || ANTHROPIC_PROVIDER_MAP[p]?.defaultModel || remote?.defaultModel); // ollama / custom: model must come from saved config
  const model = saved.model || defModel;
  if (model) cfg.model = model;
  const defBase = p === 'ollama' ? (saved.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434')
    : (ANTHROPIC_PROVIDER_MAP[p]?.defaultBaseUrl || remote?.baseUrl);
  const base = saved.baseUrl || defBase;
  if (base) cfg.base_url = base;
  // 自定义供应商没有注册在 KEY_ENV 里,没有专属 env 变量名可用 —— 直接把 key 放进
  // LLMConfig 对象,factory.ts 的 config.api_key 优先于 env 变量,注册过的 provider
  // 也一样能走这条路(不冲突,等于多了一条更直接的传递方式)。
  if (saved.apiKey) cfg.api_key = saved.apiKey;
  return cfg;
}
const cleanLLMConfig = buildLLMConfig;
const isAllowedWorkflow = (file) => ALLOWED_WORKFLOW_DIRS.some(d => isInside(file, d));

// R2.2 首跑守卫：compose 要用的 provider 是否已有可用凭证（网页/桌面同后端）。保守——不确定不拦。
function composeProviderReady(provider) {
  const p = provider || process.env.AO_PROVIDER || DEFAULT_PROVIDER_ID;
  let saved = {}; try { saved = readKeys()[p] || {}; } catch {}
  // 自定义/远程清单供应商没有内置默认端点：只填了 key 没填地址 = 还没配完，
  // 该走「先去配供应商」的引导，而不是掉到连接器里报一句晦涩的连接错。
  const needsOwnBaseUrl = !API_PROVIDER_MAP[p] && !CLI_PROVIDERS.includes(p) && p !== 'ollama' && p !== 'claude';
  if (needsOwnBaseUrl && !(saved.baseUrl || remoteProviderSpec(p)?.baseUrl)) return false;
  if (saved.apiKey) return true;                                       // 已配 key（含 CLI 中转 / 自定义供应商）
  if (CLI_PROVIDERS.includes(p)) return detectInstalledCliProviders().includes(p); // 订阅制 CLI 零配置
  if (p === 'ollama') return true;                                     // 本地免 key
  const cfg = KEY_ENV[p];
  if (cfg?.key && process.env[cfg.key]) return true;                  // env 里有 key
  return false;
}

// ── API key management (local-only) ──────────────────────────────────────────
// Keys pasted in the Studio UI are stored in .local/ (gitignored) and injected
// into this server's process.env. That way BOTH spawned `ao` processes (they
// inherit env) and the in-process compose (factory reads process.env) pick them
// up — no per-call wiring needed. Keys never leave this machine.
const KEYS_FILE = join(DATA_DIR, '.local', 'web-keys.json');
// 自定义供应商的展示元数据（名称/备注/官网）；连接信息（key/base_url/model）复用
// web-keys.json，跟内置 provider 存法一样，用 provider id 当 key。
const CUSTOM_PROVIDERS_FILE = join(DATA_DIR, '.local', 'custom-providers.json');
// 校验自定义供应商 id 时要避开的保留字：内置 CLI + 已知云端 provider + ollama。
function reservedProviderIds() {
  return new Set([...CLI_PROVIDERS, ...Object.keys(KEY_ENV), 'ollama']);
}
// deepseek/openai/compshare/apinebula/agnes/rootflowai 等 OpenAI 兼容 provider 的 key/base
// env 变量名统一来自 api-providers.ts；claude 走原生 SDK,不在那张表里,单独补一条。
const KEY_ENV = {
  // claude 走原生 SDK,但同样认自定义接入点:Anthropic 协议的中转商(AICodeMirror 等)
  // 就是靠 base_url 直连的。以前这里写死 base:null,前端据此把地址输入框整个隐藏,
  // 用户根本填不了;引擎侧 factory 也没把 base_url 传给连接器 —— 两处一起补上了。
  claude: { key: 'ANTHROPIC_API_KEY', base: 'ANTHROPIC_BASE_URL' },
  ...Object.fromEntries(API_PROVIDERS.map((p) => [p.id, { key: p.envKey, base: p.envBase }])),
  // Anthropic 原生协议的中转商（AICodeMirror 等）：各用各的专属 env 变量名 ——
  // 绝不能复用 ANTHROPIC_BASE_URL，那个变量同时被 claude-code 订阅 CLI 读，
  // 注入后会把用户本机的 CLI 一起改道（见 applyKeys 里的说明）。
  ...Object.fromEntries(ANTHROPIC_PROVIDERS.map((p) => [p.id, { key: p.envKey, base: p.envBase }])),
  // 文生视频供应商（type: video）：只为了让用户能在 Studio 里存 key、桌面端也能跑视频步骤。
  // 它们**不是聊天/图片供应商**，下面 /api/config 会把 family 标成 'video'，
  // 免得混进模型下拉或图片端点推断里（选了它跑文本步骤必然失败）。
  ...Object.fromEntries(VIDEO_PROVIDERS.map((p) => [p.id, { key: p.envKey, base: p.envBase }])),
  // claude-code / gemini-cli 走本地 CLI 子进程,不经过 factory 的 connector,而是这两个
  // 官方 CLI 自己原生支持的"中转"环境变量 —— 未登录官方账号时,填第三方中转商(如
  // Cubence)的 base_url + token 也能用。子进程 spawn 时 env:{...process.env} 会
  // 原样带过去,不需要 factory/connector 认识这两个 key。
  'claude-code': { key: 'ANTHROPIC_AUTH_TOKEN', base: 'ANTHROPIC_BASE_URL' },
  'gemini-cli': { key: 'GEMINI_API_KEY', base: 'GOOGLE_GEMINI_BASE_URL' },
};
function readKeys() {
  try { return JSON.parse(readFileSync(KEYS_FILE, 'utf-8')) || {}; } catch { return {}; }
}

// ── 远程供应商清单（赞助商上/下架不发版）─────────────────────────────────────
// 清单托管在官网(website/public/providers-manifest.json → ao.aiolaola.com),改官网仓
// push 即生效。这里启动时拉取+6h 缓存;拉不到静默回退为空(内置供应商不受影响)。
// 远程 provider 走"自定义供应商"同一运行通道(base_url/key 直传),引擎零改动。
// 安全约束:只接受 https 的 baseUrl,id 不能覆盖内置 provider(防清单被篡改后劫持内置流量)。
const MANIFEST_URL = process.env.AO_MANIFEST_URL || 'https://ao.aiolaola.com/providers-manifest.json';
const MANIFEST_TTL = 6 * 60 * 60 * 1000;
const EMPTY_MANIFEST = { providers: [], relayPresets: [], removedProviders: [], providerOverrides: {}, sponsorRotation: [], communityTemplates: [] };
let manifestCache = { data: null, fetchedAt: 0 };
async function getRemoteManifest() {
  const now = Date.now();
  if (manifestCache.data && now - manifestCache.fetchedAt < MANIFEST_TTL) return manifestCache.data;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch(MANIFEST_URL, { signal: ctrl.signal });
    clearTimeout(timer);
    if (r.ok) {
      const j = await r.json();
      const idRe = /^[a-z][a-z0-9-]{1,30}$/;
      const httpsStr = (v) => (typeof v === 'string' && /^https:\/\//.test(v) ? v : undefined);
      const providers = (Array.isArray(j?.providers) ? j.providers : []).filter((p) =>
        p && typeof p.id === 'string' && idRe.test(p.id) && !KEY_ENV[p.id] && p.id !== 'ollama' &&
        typeof p.name === 'string' && p.name.trim() &&
        typeof p.baseUrl === 'string' && /^https:\/\//.test(p.baseUrl)
      ).map((p) => ({
        // 字段白名单:清单是远程内容,只透传认识的字段,链接类一律要求 https
        id: p.id, name: p.name.trim(), baseUrl: p.baseUrl,
        note: typeof p.note === 'string' ? p.note : undefined,
        homepageUrl: httpsStr(p.homepageUrl),
        signupUrl: httpsStr(p.signupUrl),
        defaultModel: typeof p.defaultModel === 'string' ? p.defaultModel : undefined,
        modelSuggestions: Array.isArray(p.modelSuggestions) ? p.modelSuggestions.filter((m) => typeof m === 'string') : undefined,
        sponsor: !!p.sponsor,
      }));
      const relayPresets = (Array.isArray(j?.relayPresets) ? j.relayPresets : []).filter((r2) =>
        r2 && typeof r2.name === 'string' && r2.baseUrls && typeof r2.baseUrls === 'object' &&
        Object.values(r2.baseUrls).every((u) => typeof u === 'string' && /^https:\/\//.test(u))
      ).map((r2) => ({ name: r2.name, sponsor: !!r2.sponsor, signupUrl: httpsStr(r2.signupUrl), baseUrls: r2.baseUrls }));
      const removedProviders = (Array.isArray(j?.removedProviders) ? j.removedProviders : []).filter((x) => typeof x === 'string');
      // sponsorRotation：无凭证引导横幅的赞助商轮换池。此前只在引擎代码里（改一次要发
      // npm + 桌面版，没升级的用户会一直看到已下架的赞助商）。放进清单后，上/下架 push
      // 官网即对所有已安装用户生效；轮换算法仍复用引擎里那一份，份额口径不会漂移。
      // providerId 只接受「引擎真的认识」的 provider —— 否则引导里会出现一条
      // `--provider <不存在>` 的命令，比不展示更糟（纯 CLI 中转商用 relayOnly 标记）。
      const knownProviderIds = new Set(API_PROVIDERS.map((p) => p.id));
      const sponsorRotation = (Array.isArray(j?.sponsorRotation) ? j.sponsorRotation : [])
        .filter((e) => e && typeof e.name === 'string' && e.name.trim() && /^https:\/\//.test(String(e.url || '')))
        .map((e) => {
          const providerId = typeof e.providerId === 'string' && knownProviderIds.has(e.providerId) ? e.providerId : undefined;
          return {
            ...(providerId ? { providerId } : {}),
            name: e.name.trim(),
            ...(typeof e.bonus === 'string' && e.bonus.trim() ? { bonus: e.bonus.trim() } : {}),
            url: String(e.url),
            // relayOnly（"只做编码 CLI 中转、没有可直连 API"）只认清单显式声明。
            // 不能因为 providerId 缺失/写错就替它认定是中转商 —— 那是在替赞助商编事实，
            // 而这个标记会决定引导里怎么措辞。providerId 写错要靠清单契约测试报出来。
            ...(e.relayOnly === true ? { relayOnly: true } : {}),
          };
        });
      // communityTemplates：社区工作流模板（收录制——只有清单里收录的 URL 才能被导入，
      // 天然防 SSRF 与任意 YAML 注入；投稿走 GitHub PR 审核入库，上/下架 push 官网即生效）
      const communityTemplates = (Array.isArray(j?.communityTemplates) ? j.communityTemplates : [])
        .filter((tpl) => tpl && typeof tpl.name === 'string' && tpl.name.trim() && /^https:\/\//.test(String(tpl.url || '')))
        .map((tpl) => ({
          name: tpl.name.trim(),
          url: String(tpl.url),
          description: typeof tpl.description === 'string' ? tpl.description : undefined,
          author: typeof tpl.author === 'string' ? tpl.author : undefined,
          category: typeof tpl.category === 'string' ? tpl.category : undefined,
          sha256: typeof tpl.sha256 === 'string' && /^[0-9a-fA-F]{64}$/.test(tpl.sha256) ? tpl.sha256 : undefined,
        }));
      // providerOverrides：给「内置」provider 换代模型用（defaultModel/modelSuggestions），
      // 改官网清单即可全网生效,不用发 npm/桌面版。只透传这两个字段,防清单塞进别的东西。
      const providerOverrides = {};
      if (j?.providerOverrides && typeof j.providerOverrides === 'object') {
        for (const [id, ov] of Object.entries(j.providerOverrides)) {
          if (!idRe.test(id) || !ov || typeof ov !== 'object') continue;
          const entry = {};
          if (typeof ov.defaultModel === 'string' && ov.defaultModel.trim()) entry.defaultModel = ov.defaultModel.trim();
          if (Array.isArray(ov.modelSuggestions)) {
            const ms = ov.modelSuggestions.filter((m) => typeof m === 'string' && m.trim());
            if (ms.length) entry.modelSuggestions = ms;
          }
          if (Object.keys(entry).length) providerOverrides[id] = entry;
        }
      }
      manifestCache = { data: { providers, relayPresets, removedProviders, providerOverrides, sponsorRotation, communityTemplates }, fetchedAt: now };
      return manifestCache.data;
    }
  } catch { /* 网络失败/超时 → 走下面的短缓存空回退 */ }
  // 失败时缓存空结果 10 分钟：避免离线环境下每个请求都白等 3s 超时
  manifestCache = { data: EMPTY_MANIFEST, fetchedAt: now - MANIFEST_TTL + 10 * 60 * 1000 };
  return manifestCache.data;
}
/** 引导横幅当天该展示哪几家：清单里配了轮换池就用清单的，否则用引擎内置的。 */
function guideSponsors(manifest, count = 2) {
  const pool = Array.isArray(manifest?.sponsorRotation) && manifest.sponsorRotation.length > 0
    ? manifest.sponsorRotation
    : null;
  return pool ? rotateFrom(pool, count) : rotatingSponsors(count);
}

// 同步读取(给 buildLLMConfig 等同步路径用):启动预热后 manifestCache 常驻内存
function remoteProviderSpec(id) {
  return (manifestCache.data?.providers ?? []).find((p) => p.id === id);
}
function providerOverrideSpec(id) {
  return manifestCache.data?.providerOverrides?.[id];
}

// ── models.dev 公开模型目录（cc-switch 同款数据源）──────────────────────────
// https://models.dev —— 开源社区维护的全网大模型目录（api.json，免 key，持续更新）。
// 用途：模型公司官方 API（claude/openai/deepseek）没配 key、或 /models 拉取失败时,
// 用它兜底返回当前在售模型列表，避免用户看到打包时的过期静态建议。
// 聚合商/中转商(apinebula/cubence 等)各家上架模型不同，models.dev 不知道，不适用。
const MODELS_DEV_URL = process.env.AO_MODELS_DEV_URL || 'https://models.dev/api.json';
const MODELS_DEV_TTL = 24 * 60 * 60 * 1000;
// claude-code：中转商拉不到列表时退回 anthropic 官方目录（中转主要就是代理 Claude 系模型）
const MODELS_DEV_VENDOR = { claude: 'anthropic', 'claude-code': 'anthropic', openai: 'openai', deepseek: 'deepseek' };
let modelsDevCache = { data: null, fetchedAt: 0 };
async function modelsDevList(provider) {
  const vendor = MODELS_DEV_VENDOR[provider];
  if (!vendor) return null;
  const now = Date.now();
  if (!modelsDevCache.data || now - modelsDevCache.fetchedAt > MODELS_DEV_TTL) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch(MODELS_DEV_URL, { signal: ctrl.signal });
      clearTimeout(timer);
      if (r.ok) modelsDevCache = { data: await r.json(), fetchedAt: now };
    } catch { /* 离线/被墙 → 用旧缓存或返回 null */ }
    // 失败时短缓存 10 分钟，避免离线环境每次请求都白等 5s 超时
    if (!modelsDevCache.data) { modelsDevCache.fetchedAt = now - MODELS_DEV_TTL + 10 * 60 * 1000; return null; }
  }
  const models = modelsDevCache.data?.[vendor]?.models;
  if (!models || typeof models !== 'object') return null;
  // 新模型在前（release_date 降序），上限 40 条防下拉过长
  const list = Object.entries(models)
    .map(([id, m]) => ({ id, date: typeof m?.release_date === 'string' ? m.release_date : '' }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
    .map((x) => x.id)
    .slice(0, 40);
  return list.length ? list : null;
}
getRemoteManifest(); // 启动预热,不阻塞
function writeKeys(obj) {
  mkdirSync(dirname(KEYS_FILE), { recursive: true });
  writeFileSync(KEYS_FILE, JSON.stringify(obj, null, 2), 'utf-8');
}
// Claude Code 的模型映射 env（对齐 cc-switch 的成熟做法）：把 CLI 的 Sonnet/Opus/
// Haiku 档位映射到中转商实际上架的模型名。只影响 AO spawn 出的 CLI 子进程。
const CC_MODEL_ENVS = {
  model: 'ANTHROPIC_MODEL',
  sonnetModel: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  opusModel: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  haikuModel: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
};
function applyKeys(obj) {
  for (const [provider, cfg] of Object.entries(KEY_ENV)) {
    const entry = obj[provider];
    if (!entry) continue;
    if (entry.apiKey) process.env[cfg.key] = entry.apiKey;
    // CLI 中转（claude-code/gemini-cli）：base 必须和 token 成对注入。只存了
    // baseUrl 没存 token 的半截配置若照样注入 base，CLI 会拿本机登录态去请求
    // 中转端点 → 全线 401，把原本能用的 CLI 打挂。API 类 provider 不受此限
    // （key 可能来自 shell 环境变量，base 单独覆盖是合法用法）。
    const relayCli = provider === 'claude-code' || provider === 'gemini-cli';
    const hasToken = !!(entry.apiKey || process.env[cfg.key]);
    // claude（直连 API）的 base 绝不能注入 env：它和 claude-code 共用
    // ANTHROPIC_BASE_URL 这一个变量名，但两者凭证完全不同（一个是中转商的 API key，
    // 一个是本机订阅登录态）。注进去会被所有 spawn 出的子进程继承 —— 用户只是给
    // 直连 API 配了个中转，结果把订阅制的 claude-code CLI 一起改道到该端点，
    // 拿登录态去打必然 401。引擎侧不需要这个 env：base_url 走 buildLLMConfig →
    // `ao run --base-url` / 连接器 config，链路已经通（见 factory.ts 的 claude 分支）。
    const envUnsafe = provider === 'claude';
    if (cfg.base && entry.baseUrl && !envUnsafe && (!relayCli || hasToken)) process.env[cfg.base] = entry.baseUrl;
  }
  for (const [field, envName] of Object.entries(CC_MODEL_ENVS)) {
    const v = obj['claude-code']?.[field];
    if (v) process.env[envName] = v;
    else delete process.env[envName];
  }
  if (obj.ollama?.baseUrl) process.env.OLLAMA_BASE_URL = obj.ollama.baseUrl;
}
// 「真·shell 环境」快照——必须在第一次 applyKeys 之前拍。applyKeys 会把 AO 自己保存的中转
// key 注入本进程 env，之后 process.env 就分不清「用户 ~/.zshrc 里的」和「AO 自己注入的」了。
// 体检（/api/claude/health、repair、restore）一律用这份快照判 shell 层残留，否则用户只是在
// AO 里存了个 claude-code 中转，体检卡就红灯喊"被劫持"、还叫他去 .zshrc 删（那儿根本没有）。
const SHELL_ENV_SNAPSHOT = Object.freeze(Object.fromEntries(
  HIJACK_ENV_KEYS.map((k) => [k, process.env[k]]).filter(([, v]) => v != null),
));

applyKeys(readKeys());

const WEBSITE_DIST = join(ROOT, 'website', 'dist');
const HAS_NEW_UI = existsSync(join(WEBSITE_DIST, 'index.html'));

const app = express();
app.use(express.json({ limit: '5mb' }));
// 请求体不是合法 JSON / 超过大小限制时，express.json 会把错误交给 Express 默认处理器，
// 回一整页 HTML 错误页（还带栈）。前端 `res.json()` 解析它必然再抛一次，用户看到的是
// 一句无关的解析错。API 面永远只回 JSON。
app.use((err, req, res, next) => {
  if (!err || !req.path.startsWith('/api/')) return next(err);
  const tooLarge = err.type === 'entity.too.large' || err.status === 413;
  res.status(tooLarge ? 413 : 400).json({
    error: tooLarge ? '请求体过大（上限 5MB）' : `请求体不是合法 JSON：${String(err.message || err).slice(0, 200)}`,
  });
});
// Prefer the new React Studio build when present; fall back to the legacy vanilla UI.
if (HAS_NEW_UI) app.use(express.static(WEBSITE_DIST));
app.use(express.static(__dirname));

// Cache: role file -> { name, description, color }
const roleMetaCache = new Map();
function getRoleMeta(role) {
  if (!role) return null;
  if (roleMetaCache.has(role)) return roleMetaCache.get(role);
  const agentsDir = join(ROOT, 'node_modules', 'agency-agents-zh');
  const filePath = join(agentsDir, role + '.md');
  try {
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, 'utf-8');
      const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch) {
        const fm = parseFrontmatter(fmMatch[1]);
        const meta = { name: fm.name || null, description: fm.description || '', color: fm.color || '#888' };
        roleMetaCache.set(role, meta);
        return meta;
      }
      // No frontmatter — try to extract name from first # heading
      const h1 = raw.match(/^#\s+(.+)/m);
      if (h1) {
        const name = h1[1].replace(/[—–\-].*/,'').trim();
        const meta = { name, description: '', color: '#888' };
        roleMetaCache.set(role, meta);
        return meta;
      }
    }
  } catch {}
  roleMetaCache.set(role, null);
  return null;
}

const catEmojiMap = {
  company:'🏢',
  marketing:'📣', 'paid-media':'📺', sales:'🤝', product:'📱',
  'project-management':'📋', testing:'🧪', support:'🛠', 'spatial-computing':'🌐',
  specialized:'⚙️', 'game-development':'🎮', engineering:'💻', design:'🎨',
  academic:'🎓', finance:'💰', hr:'👥', legal:'⚖️', strategy:'🧭', 'supply-chain':'📦',
  gis:'🗺', security:'🔐',
};

// 内置工作流分类 + 推荐（集中映射，避免改每个 YAML；用户工作流可在 YAML 自带 category/featured）。
// 解决「27 个平铺、不知道用哪个」：列表按类目分组，⭐ 推荐置顶。
const WF_CATEGORY = {
  '软件开发标准流程.yaml': '开发', 'codex-cc-loop.yaml': '开发', 'codex-cc-simple.yaml': '开发', '需求转项目脚手架.yaml': '开发',
  'content-pipeline.yaml': '内容创作', 'douyin-script.yaml': '内容创作', 'tech-blog.yaml': '内容创作',
  'xiaohongshu-viral-post.yaml': '内容创作', 'story-creation.yaml': '内容创作', 'ai-opinion-article.yaml': '内容创作',
  'investment-analysis.yaml': '商业 / 产品', 'pitch-deck-outline.yaml': '商业 / 产品', 'product-launch-comms.yaml': '商业 / 产品',
  'product-review.yaml': '商业 / 产品', 'okr-decomposition.yaml': '商业 / 产品', 'ai-startup-launch.yaml': '商业 / 产品',
  '一人公司全员大会.yaml': '商业 / 产品',
  'resume-and-interview-prep.yaml': '职场 / 学术', 'legal-consultation.yaml': '职场 / 学术',
  'meeting-notes.yaml': '职场 / 学术', 'academic-paper-outline.yaml': '职场 / 学术',
};
const WF_FEATURED = new Set([
  '软件开发标准流程.yaml', 'codex-cc-loop.yaml', 'content-pipeline.yaml', 'product-review.yaml', 'meeting-notes.yaml',
]);

function loadWorkflowMeta(dir, tagPrivate = false, deletable = false) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map(f => {
      try {
        const full = join(dir, f);
        const doc = yaml.load(readFileSync(full, 'utf-8'));
        return {
          file: full,
          filename: f,
          name: doc?.name || f,
          description: doc?.description || '',
          category: doc?.category || WF_CATEGORY[f] || (tagPrivate ? '我的工作流' : '其他'),
          featured: doc?.featured ?? WF_FEATURED.has(f),
          inputs: (doc?.inputs || []).map(i => ({
            name: i.name,
            description: i.description || '',
            required: !!i.required,
            default: i.default,
            // 下拉候选（静态 options / 动态 source）：Studio 输入弹窗据此渲染选择框，而不是让用户手打供应商 id
            ...(typeof i.label === 'string' ? { label: i.label } : {}),
            ...(Array.isArray(i.options) ? { options: i.options.filter((o) => typeof o === 'string') } : {}),
            ...(typeof i.source === 'string' ? { source: i.source } : {}),
            ...(typeof i.source_from === 'string' ? { source_from: i.source_from } : {}),
          })),
          steps: (doc?.steps || []).map(s => {
            let name = s.name;
            let emoji = s.emoji;
            if ((!name || !emoji) && s.role) {
              const rm = getRoleMeta(s.role);
              if (rm) {
                if (!name) name = rm.name;
                if (!emoji) {
                  const cat = s.role.split('/')[0];
                  emoji = catEmojiMap[cat] || '🤖';
                }
              } else if (!emoji) {
                const cat = s.role.split('/')[0];
                emoji = catEmojiMap[cat] || '🤖';
              }
            }
            // If still no Chinese name, try to extract from role filename
            if (!name && s.role) {
              const roleFile = s.role.split('/').pop() || '';
              const roleSuffix = roleFile.replace(/^[a-z]+-/, '');
              // Fallback: readable English from role filename
              name = roleSuffix.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            }
            // type: image/video 步骤没有 role——Studio「创意出片」按此挑出文生图/文生视频模板
            return { id: s.id, role: s.role, name: name || s.id, emoji: emoji || '🤖', ...(s.type ? { type: s.type } : {}) };
          }),
          provider: doc?.llm?.provider,
          private: tagPrivate,
          // 「我的工作流」按创建/修改时间倒序展示（#92：列表顺序不可预期）
          mtime: statSync(full).mtimeMs,
          // 仅 COMPOSED_DIR（自动组队/画布保存的）可删；内置模板与外部用户目录不可删
          deletable,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// ── Workflow list ──
// ── 社区工作流模板（远程清单收录制：上/下架 push 官网即生效，不发版）──
app.get('/api/community/templates', async (_req, res) => {
  const m = await getRemoteManifest();
  res.json(m.communityTemplates ?? []);
});

// 导入：只认清单里收录的 URL（收录制防 SSRF/任意 YAML）。拉取(5s/200KB) → 引擎校验 → 存入「我的工作流」。
app.post('/api/community/import', async (req, res) => {
  const { url } = req.body || {};
  const m = await getRemoteManifest();
  const entry = (m.communityTemplates ?? []).find((tpl) => tpl.url === url);
  if (!entry) return res.status(403).json({ error: 'URL 不在社区模板清单里（收录制：先提交收录再导入）' });
  try {
    // 超时必须覆盖到响应体读完——只罩到响应头的话，坏源「200 头 + 永不结束的 body」
    // 会把本地 Studio 服务挂死；redirect:'error' 防收录后 302 到任意/内网地址
    const signal = AbortSignal.timeout(8000);
    const r = await fetch(entry.url, { signal, redirect: 'error' });
    if (!r.ok) return res.status(502).json({ error: `模板源返回 HTTP ${r.status}` });
    const declared = Number(r.headers.get('content-length') || 0);
    if (declared > 200 * 1024) return res.status(413).json({ error: '模板超过 200KB 上限' });
    const text = await r.text();
    if (Buffer.byteLength(text, 'utf8') > 200 * 1024) return res.status(413).json({ error: '模板超过 200KB 上限' });
    // 收录制钉的是 URL 不是内容——可变 URL（分支 raw 链接）收录后可被改写。
    // 清单条目可带 sha256（推荐，配合 commit-SHA 链接双保险）：带了就校验，不符即拒。
    if (entry.sha256) {
      const got = createHash('sha256').update(text, 'utf8').digest('hex');
      if (got !== String(entry.sha256).toLowerCase()) {
        return res.status(409).json({ error: '模板内容与清单收录时的 sha256 不符——源已被改动，拒绝导入' });
      }
    }
    const def = yaml.load(text);
    if (!def || typeof def !== 'object' || !def.name || !Array.isArray(def.steps)) {
      return res.status(400).json({ error: '不是有效的 AO 工作流 YAML（缺 name/steps）' });
    }
    const { validateWorkflow } = await import('../dist/core/parser.js');
    const errors = validateWorkflow(def);
    if (errors.length) return res.status(400).json({ error: `模板未通过引擎校验：${errors.slice(0, 3).join('；')}` });
    mkdirSync(COMPOSED_DIR, { recursive: true });
    // 文件名规则与 /api/workflows 保存链路保持一致（含首尾破折号修剪）；写盘前再做一次
    // 目录包含守卫——与该链路同规的纵深防御，别让两处逻辑漂移
    const safe = String(def.name).replace(/[^一-鿿a-zA-Z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'community';
    let file = join(COMPOSED_DIR, `${safe}.yaml`);
    let n = 2;
    while (existsSync(file)) file = join(COMPOSED_DIR, `${safe}-${n++}.yaml`);
    if (!isInside(resolve(file), COMPOSED_DIR)) return res.status(400).json({ error: 'invalid template name' });
    writeFileSync(file, text, 'utf-8');
    res.json({ file, name: def.name, steps: def.steps.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/workflows', (req, res) => {
  // 英文站优先用英文模板库（workflows/en）；没有英文版的就不混中文进来，保持一致体验。
  const builtinDir = (req.query.lang === 'en' && existsSync(WORKFLOWS_DIR_EN)) ? WORKFLOWS_DIR_EN : WORKFLOWS_DIR;
  const all = [
    ...loadWorkflowMeta(builtinDir, false),
    ...(USER_WORKFLOWS_DIR ? loadWorkflowMeta(USER_WORKFLOWS_DIR, true) : []),
    ...(existsSync(COMPOSED_DIR) ? loadWorkflowMeta(COMPOSED_DIR, true, true) : []),
  ];
  res.json(all);
});

// ── Delete a user workflow (#92) ──
// 只允许删 COMPOSED_DIR 里的（自动组队/画布保存的）；内置模板和 AO_USER_WORKFLOWS_DIR
// （外部自管目录，可能是用户的 git 仓库）一律 403，不做例外。
app.delete('/api/workflows', (req, res) => {
  const file = req.query.file;
  if (!file || typeof file !== 'string') return res.status(400).json({ error: 'invalid file' });
  const resolved = resolve(file);
  if (!isInside(resolved, COMPOSED_DIR)) return res.status(403).json({ error: 'only user-composed workflows can be deleted' });
  if (!existsSync(resolved)) return res.status(404).json({ error: 'file not found' });
  unlinkSync(resolved);
  res.json({ ok: true });
});

// 运行产物目录名里的时间戳是 UTC（reporter 用 toISOString 生成），
// 直接当字符串显示会让非 UTC 用户看到偏移了的时间（#101：北京用户永远差 8 小时）。
// 这里统一还原成"绝对时刻"的 ISO 串交给前端，由浏览器按系统时区渲染。
function runTimestampISO(dirName, meta, mtimeMs) {
  // 新产物：引擎直接写了完成时刻（带时区信息的 ISO）
  if (meta && typeof meta.finishedAt === 'string' && !Number.isNaN(Date.parse(meta.finishedAt))) {
    return new Date(meta.finishedAt).toISOString();
  }
  // 旧产物：从目录名还原。`名字-2026-07-15T02-30-26` 里的时分秒是 UTC，补回 Z 再解析
  const m = dirName.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})$/);
  if (m) {
    const parsed = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return new Date(mtimeMs).toISOString();
}

// ── History: list past runs ──
app.get('/api/runs', (_req, res) => {
  if (!existsSync(OUTPUT_DIR)) return res.json([]);
  const runs = readdirSync(OUTPUT_DIR)
    .filter(d => {
      const metaPath = join(OUTPUT_DIR, d, 'metadata.json');
      return existsSync(metaPath);
    })
    .map(d => {
      try {
        const metaPath = join(OUTPUT_DIR, d, 'metadata.json');
        const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
        const stat = statSync(join(OUTPUT_DIR, d));
        const ts = d.match(/(\d{4}-\d{2}-\d{2}T[\d-]+)$/)?.[1]?.replace(/-/g, (m, i) => i > 9 ? ':' : m) || '';
        return {
          id: d,
          name: meta.name,
          success: meta.success,
          duration: meta.totalDuration,
          tokens: meta.totalTokens,
          stepCount: meta.steps?.length || 0,
          completedCount: meta.steps?.filter(s => s.status === 'completed').length || 0,
          timestamp: ts,
          // 工作流文件与用过的角色：前端「最近运行 / 最近用过」按此聚合——
          // 使用频率数据本地就有，不埋点不上传。
          file: typeof meta.file === 'string' ? meta.file : undefined,
          roles: [...new Set((meta.steps || []).map(s => s.role).filter(r => typeof r === 'string'))],
          // 首图：assets/ 里第一张图片（图片/视频工作流的产物）——运行卡片显示缩略图，
          // "我做过什么"靠画面比靠名字好认。URL 走既有的 /api/runs/:id/assets/:file。
          // 有 mp4 产物（视频/合成步骤）：卡片上标 🎬——没有首图也能一眼认出"这是出片的那次"
          hasVideo: (() => { const a = join(OUTPUT_DIR, d, 'assets'); return existsSync(a) && readdirSync(a).some(f => /\.(mp4|mov|webm)$/i.test(f)); })(),
          thumb: (() => {
            const assetsDir = join(OUTPUT_DIR, d, 'assets');
            if (!existsSync(assetsDir)) return undefined;
            const img = readdirSync(assetsDir).filter(f => /\.(png|jpe?g|webp|gif)$/i.test(f)).sort()[0];
            return img ? `/api/runs/${encodeURIComponent(d)}/assets/${encodeURIComponent(img)}` : undefined;
          })(),
          // 绝对时刻（UTC ISO）——前端用 toLocaleString 按系统时区显示（#101）
          startedAt: runTimestampISO(d, meta, stat.mtimeMs),
          mtime: stat.mtimeMs,
        };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
  res.json(runs);
});

// ── History: delete one past run (#101) ──
// 只允许删 OUTPUT_DIR 里的运行产物目录：先 resolve 掉 `..` 再做包含性校验，
// 且必须真的是一条运行记录（有 metadata.json），避免误删挂载卷里的其他目录。
app.delete('/api/runs/:id', (req, res) => {
  const runDir = resolve(OUTPUT_DIR, req.params.id);
  if (!isInside(runDir, OUTPUT_DIR) || runDir === resolve(OUTPUT_DIR)) {
    return res.status(403).json({ error: 'only run directories under ao-output can be deleted' });
  }
  if (!existsSync(join(runDir, 'metadata.json'))) return res.status(404).json({ error: 'run not found' });
  try {
    rmSync(runDir, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── History: get single run details ──
app.get('/api/runs/:id', (req, res) => {
  const runDir = join(OUTPUT_DIR, req.params.id);
  const metaPath = join(runDir, 'metadata.json');
  if (!existsSync(metaPath)) return res.status(404).json({ error: 'run not found' });

  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    const stepsDir = join(runDir, 'steps');
    const steps = (meta.steps || []).map((s, i) => {
      const filename = `${i + 1}-${s.id}.md`;
      const filePath = join(stepsDir, filename);
      let content = '';
      if (existsSync(filePath)) {
        content = readFileSync(filePath, 'utf-8');
        // Strip the header line (> emoji **name** | ...)
        const headerEnd = content.indexOf('\n---\n');
        if (headerEnd >= 0) content = content.slice(headerEnd + 5).trim();
      }
      // 图片步骤的引用在 md 里是 ../assets/xx.png（相对 steps/ 目录）——浏览器解析不了，
      // 改写成本服务的只读产物接口，Studio 直接 <img> 内联渲染
      content = content.replace(/\]\((?:\.\.\/)?assets\//g, `](/api/runs/${encodeURIComponent(req.params.id)}/assets/`);
      return { ...s, content };
    });
    res.json({ ...meta, dir: req.params.id, steps });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 运行产物里的图片（type: image 步骤生成）——只读，路径先 resolve 再校验包含关系，
// 且必须落在一个带 metadata.json 的真实运行目录里（与删除接口同一套守卫，防 ../ 穿越）。
app.get('/api/runs/:id/assets/:file', (req, res) => {
  const runDir = resolve(join(OUTPUT_DIR, req.params.id));
  if (!isInside(runDir, OUTPUT_DIR) || !existsSync(join(runDir, 'metadata.json'))) {
    return res.status(404).json({ error: 'run not found' });
  }
  const filePath = resolve(join(runDir, 'assets', req.params.file));
  if (!isInside(filePath, join(runDir, 'assets')) || !existsSync(filePath)) {
    return res.status(404).json({ error: 'asset not found' });
  }
  // 图片步骤产 png，视频步骤（type: video）产 mp4；其余扩展名兜底成通用二进制。
  // mp4 必须给对 Content-Type，否则 <video> 标签在部分浏览器里直接不播（当成下载）。
  const mime = /\.png$/i.test(filePath) ? 'image/png'
    : /\.mp4$/i.test(filePath) ? 'video/mp4'
    : 'application/octet-stream';
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'private, max-age=86400');   // 产物不可变，放心缓存
  res.send(readFileSync(filePath));
});

// 可分享运行报告：与 CLI 的 `ao report` 同一渲染器（dist/cli/share-report.js）。
// 直接以 HTML 响应——浏览器新标签打开即是成品页，用户 Cmd/Ctrl+S 或右键即可保存转发；
// 同时落一份 report.html 到运行目录，和 CLI 行为一致。
app.get('/api/runs/:id/report', async (req, res) => {
  const runDir = resolve(join(OUTPUT_DIR, req.params.id));
  if (!isInside(runDir, OUTPUT_DIR) || !existsSync(join(runDir, 'metadata.json'))) {
    return res.status(404).json({ error: 'run not found' });
  }
  try {
    const { renderRunDirReport } = await import('../dist/cli/share-report.js');
    const html = renderRunDirReport(runDir, new Date().toLocaleString());
    try { writeFileSync(join(runDir, 'report.html'), html, 'utf-8'); } catch { /* 只读盘也不挡预览 */ }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── YAML preview ──
app.get('/api/workflows/yaml', (req, res) => {
  const file = req.query.file;
  if (!file || typeof file !== 'string') return res.status(400).json({ error: 'invalid file' });
  const resolved = resolve(file);
  if (!isAllowedWorkflow(resolved)) return res.status(403).json({ error: 'file outside allowed dirs' });
  if (!existsSync(resolved)) return res.status(404).json({ error: 'file not found' });
  res.type('text/yaml').send(readFileSync(resolved, 'utf-8'));
});

// Active workflow child processes by runId, so POST /api/run-input can write to
// the right process's stdin when a human_input / approval node pauses for input.
let runSeq = 0;
const activeRuns = new Map();

// ── Run workflow (with optional resume) ──
app.post('/api/run', (req, res) => {
  const { file, inputs, provider, resume, fromStep, feedback, materialize } = req.body || {};
  if (!file || typeof file !== 'string') {
    return res.status(400).json({ error: 'invalid workflow file' });
  }
  const resolvedFile = resolve(file);
  if (!isAllowedWorkflow(resolvedFile)) {
    return res.status(403).json({ error: 'file outside allowed dirs' });
  }
  if (!existsSync(resolvedFile)) {
    return res.status(404).json({ error: 'workflow file not found' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (type, data) => {
    // 客户端断开后 SIGTERM 子进程不是瞬时的，期间到达的 stdout 仍会调到这里；
    // 向已结束的响应 write 会抛 ERR_STREAM_WRITE_AFTER_END，拖垮单进程服务。
    if (res.writableEnded) return;
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const args = [CLI, 'run', resolvedFile];
  if (provider) {
    args.push('--provider', provider);
    // A bare --provider override clears the YAML model/base → supply them so
    // keyed providers (deepseek/openai), ollama and custom endpoints all work.
    const llm = cleanLLMConfig(provider);
    if (llm.model) args.push('--model', llm.model);
    if (llm.base_url) args.push('--base-url', llm.base_url);
    // 自定义供应商没有注册的 env 变量名，key 只能这样带过去（本机单用户工具，
    // 跟 --base-url/--model 走的是同一条"CLI 参数"路径，一致的取舍）。
    if (llm.api_key) args.push('--api-key', llm.api_key);
  }
  if (resume) {
    let resumeArg = resume === true ? 'last' : String(resume);
    // 历史面板传的是 run 目录名（ao-output/ 下），而 CLI 的 --resume 按 cwd 解析相对
    // 路径——补全成绝对路径，否则会指到 DATA_DIR/<id> 找不到 metadata.json。
    if (resumeArg !== 'last') {
      const candidate = join(OUTPUT_DIR, resumeArg);
      if (existsSync(join(candidate, 'metadata.json'))) resumeArg = candidate;
    }
    args.push('--resume', resumeArg);
    if (fromStep) args.push('--from', fromStep);
  }
  // 对话式返工：把某一步的修改意见交回给该专家在原稿基础上重做。
  // --feedback 在 CLI 侧会自动隐含 --resume last（未显式 resume 时），并要求 --from。
  if (feedback && typeof feedback === 'string' && feedback.trim()) {
    if (fromStep && !resume) args.push('--from', fromStep);
    args.push('--feedback', feedback);
  }
  // 「开发项目」勾选：把开发步产出的文件块落盘到本地 scaffold 目录
  if (materialize) {
    const safe = basename(resolvedFile).replace(/\.ya?ml$/i, '').replace(/[^\w.一-龥-]+/g, '-');
    const dest = join(DATA_DIR, 'scaffold', safe);
    args.push('--materialize', dest);
  }
  for (const [k, v] of Object.entries(inputs || {})) {
    if (v !== '' && v !== undefined && v !== null) {
      args.push('-i', `${k}=${v}`);
    }
  }

  const runId = String(++runSeq);
  send('start', { cmd: `ao run ${args.slice(2).join(' ')}`, resume: !!resume, fromStep, runId });

  // Parse CLI output into structured events
  let lineBuffer = '';
  let currentStepId = null;
  // 验收未过时，"完成 | … | 验收 ⚠️" 行之后紧跟若干 "⚠️ 未满足条目" 行——
  // 它们是核验详情而非步骤产出，转成 step-verify-item 事件，别混进正文。
  let inVerifyItems = false;

  function parseLine(raw) {
    const clean = raw.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '').trim();
    // ⚠️ 条目紧贴"完成 | … | 验收 ⚠️"行连续打印，首个空行即正文分界——
    // 空行必须关闭 verify-item 窗口，否则正文里以 ⚠️ 开头的行会被误吞成核验条目
    if (!clean) { inVerifyItems = false; return; }

    // human_input / approval 节点暂停等待输入：引擎在 AO_WEB_INPUT 模式下发的机器标记。
    // 转成 await-input 事件，前端弹框，用户输入经 POST /api/run-input 写回子进程 stdin。
    const inputReq = clean.match(/^__AO_INPUT_REQUEST__(\{.*\})$/);
    if (inputReq) {
      try { send('await-input', { runId, ...JSON.parse(inputReq[1]) }); } catch { /* ignore malformed */ }
      return;
    }

    // Step start: "⏳ emoji name 执行中 ..."
    const startMatch = clean.match(/^⏳\s+(\S+)\s+(.+?)\s+执行中/);
    if (startMatch) {
      const [, emoji, name] = startMatch;
      send('step-start', { emoji, name });
      return;
    }

    // Step header: "── [N/M] emoji name (id) ──"
    const headerMatch = clean.match(/── \[(\d+)\/(\d+)\] (\S+)\s+(.+?)\s+\((\S+)\) ──/);
    if (headerMatch) {
      const [, cur, total, emoji, name, id] = headerMatch;
      currentStepId = id;
      send('step-header', { cur: +cur, total: +total, emoji, name, id });
      return;
    }

    // Step done: "完成 | 22.5s | 695 tokens".
    // NOTE: the step's CONTENT is printed AFTER this line, so we must keep
    // currentStepId set here — clearing it would drop the whole step body.
    const metaMatch = clean.match(/^完成\s*\|\s*(.+)/);
    if (metaMatch && currentStepId) {
      inVerifyItems = /验收\s*⚠️/.test(metaMatch[1]);
      send('step-done', { id: currentStepId, meta: metaMatch[1] });
      return;
    }

    // Verification detail lines right after a "完成 | … | 验收 ⚠️" line
    if (inVerifyItems && currentStepId && /^⚠️\s*/.test(clean)) {
      send('step-verify-item', { id: currentStepId, text: clean.replace(/^⚠️\s*/, '') });
      return;
    }
    inVerifyItems = false;

    // Workflow summary: "完成: 5/5 步 | ..." — end of all step output.
    if (/完成:\s*\d+\/\d+\s*步/.test(clean)) {
      send('workflow-summary', { text: clean });
      currentStepId = null;
      return;
    }

    // Trailing footer after the summary — never part of a step body.
    if (/^详细输出[:：]/.test(clean) || /^💡/.test(clean) || /^可选步骤/.test(clean) || /^steps[:：]/i.test(clean)) {
      // 把输出目录单独发给前端展示"保存位置"(用户反馈:不知道文件存在哪)
      const m = clean.match(/(?:详细输出|Detailed output)[:：]?\s*(.+)$/i);
      if (m) send('output-dir', { dir: resolve(DATA_DIR, m[1].trim()) });
      currentStepId = null;
      return;
    }

    // Pure separator lines (=====) — skip, but keep attributing to the step.
    if (/^={3,}$/.test(clean)) return;

    // Step content (printed after the "完成 | meta" line, until the next header)
    if (currentStepId) {
      const stripped = raw.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/^\s{0,4}/, '');
      if (!/^⏳.*\.\.\.\s*\d+s/.test(clean)) {
        send('step-content', { id: currentStepId, text: stripped });
      }
    }
  }

  console.log('[run]', NODE_BIN, args.join(' '));
  const child = spawn(NODE_BIN, args, {
    cwd: DATA_DIR,
    // AO_WEB_INPUT=1 → 引擎遇到 human_input/approval 会发机器标记而非在终端等输入
    // AO_NO_AT_FILE=1 → 关闭 -i k=@file 文件展开，防止网页请求读取本机任意文件（如 API key）
    env: { ...process.env, FORCE_COLOR: '0', AO_WEB_INPUT: '1', AO_NO_AT_FILE: '1' },
  });
  activeRuns.set(runId, child);

  child.stdout.on('data', chunk => {
    const text = chunk.toString();
    send('stdout', { text });
    // Also parse into structured events
    lineBuffer += text;
    let idx;
    while ((idx = lineBuffer.indexOf('\n')) >= 0) {
      parseLine(lineBuffer.slice(0, idx));
      lineBuffer = lineBuffer.slice(idx + 1);
    }
  });
  child.stderr.on('data', chunk => {
    send('stderr', { text: chunk.toString() });
  });

  child.on('exit', (code, signal) => {
    if (lineBuffer.trim()) parseLine(lineBuffer);
    console.log('[exit]', code, signal);
    send('done', { code, signal });
    res.end();
  });
  child.on('error', err => {
    console.log('[error]', err.message);
    send('error', { message: err.message });
    res.end();
  });

  let finished = false;
  child.on('exit', () => { finished = true; activeRuns.delete(runId); });
  res.on('close', () => {
    if (!finished && !child.killed) {
      console.log('[abort] client closed');
      child.kill('SIGTERM');
    }
  });
});

// ── Feed input to a paused run (human_input / approval node awaiting stdin) ──
app.post('/api/run-input', (req, res) => {
  const { runId, text } = req.body || {};
  const child = runId != null ? activeRuns.get(String(runId)) : null;
  if (!child || child.killed || !child.stdin || !child.stdin.writable) {
    return res.status(404).json({ error: 'run not found or not awaiting input' });
  }
  try {
    child.stdin.write(String(text ?? '') + '\n');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

// ── 多智能体 vs 单次基线对比（把 eval 的核心证明产品化）──
// 需本地引擎(in-process 调 dist/index.js)；公开站无此能力。一次跑完返回 JSON(非流式)。
app.post('/api/compare', async (req, res) => {
  const { file, inputs, provider } = req.body || {};
  if (!file || typeof file !== 'string') return res.status(400).json({ error: 'invalid workflow file' });
  const resolvedFile = resolve(file);
  if (!isAllowedWorkflow(resolvedFile)) return res.status(403).json({ error: 'file outside allowed dirs' });
  if (!existsSync(resolvedFile)) return res.status(404).json({ error: 'workflow file not found' });
  try {
    const { compareWorkflowVsBaseline } = await import('../dist/index.js');
    const llm = buildLLMConfig(provider); // 注册 provider 的 key 已在启动时注入 process.env；自定义供应商靠 llm.api_key 直传
    const cmp = await compareWorkflowVsBaseline(resolvedFile, inputs || {}, {
      quiet: true,
      outputDir: OUTPUT_DIR,
      genOverride: { provider: llm.provider, model: llm.model, base_url: llm.base_url, api_key: llm.api_key },
    });
    res.json({ multiOutput: cmp.multiOutput, baselineOutput: cmp.baselineOutput, verdict: cmp.verdict });
  } catch (err) {
    // 工作流写得不对（缺 llm/steps、role 不存在…）是用户侧问题，回 4xx；500 会让人以为引擎坏了、跑去重启
    res.status(err?.userError ? 400 : 500).json({ error: err?.message || String(err) });
  }
});

// ── Roles / Agents ──
// 没登记的分类会原样显示目录名（gis / security 就这么在官网上露了很久），
// 角色库加新分类时这里必须同步——website/scripts/gen-experts.mjs 里还有一份同口径的。
const CATEGORY_NAMES = {
  zh: {
    my: '我的',
    company: '公司经营',
    marketing: '市场营销', 'paid-media': '付费媒体', sales: '销售', product: '产品',
    'project-management': '项目管理', testing: '质量测试', support: '运营支持',
    'spatial-computing': '空间计算', specialized: '专业服务', 'game-development': '游戏开发',
    engineering: '工程开发', design: '设计', academic: '学术研究', finance: '财务金融',
    hr: '人力资源', legal: '法务', strategy: '战略', 'supply-chain': '供应链',
    gis: 'GIS 地理信息', security: '安全',
  },
  en: {
    my: 'My Roles',
    company: 'Company',
    marketing: 'Marketing', 'paid-media': 'Paid Media', sales: 'Sales', product: 'Product',
    'project-management': 'Project Management', testing: 'Testing', support: 'Support',
    'spatial-computing': 'Spatial Computing', specialized: 'Specialized', 'game-development': 'Game Dev',
    engineering: 'Engineering', design: 'Design', academic: 'Academic', finance: 'Finance',
    hr: 'HR', legal: 'Legal', strategy: 'Strategy', 'supply-chain': 'Supply Chain',
    gis: 'GIS', security: 'Security',
  },
};

// frontmatter 解析:先严格 YAML;失败(翻译文本裸冒号等)退回引擎同款的逐行宽松解析,
// 保证角色不因个别字段格式问题从 Studio 列表消失(引擎 src/agents/loader.ts 本就宽松)。
function parseFrontmatter(block) {
  try {
    const fm = yaml.load(block);
    if (fm && typeof fm === 'object') return fm;
  } catch { /* fall through */ }
  const fm = {};
  for (const line of String(block).split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return fm;
}

function loadRoles(lang) {
  const agentsDir = agentsDirFor(lang);
  // 分类显示名：zh 用中文，en 及各语言包用英文（语言包目录名就是英文部门名）
  const categoryNames = CATEGORY_NAMES[lang === 'zh' ? 'zh' : 'en'];

  const roles = [];
  // 用户自建角色（~/.ao/roles）排最前，归「我的」分类；custom 标记供前端渲染删除入口。
  // 中英文站都展示——用户自己的专家不分语言库。
  if (existsSync(USER_ROLES_DIR)) {
    for (const f of readdirSync(USER_ROLES_DIR).filter(n => n.endsWith('.md'))) {
      try {
        const raw = readFileSync(join(USER_ROLES_DIR, f), 'utf-8');
        const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
        if (!fmMatch) continue;
        const fm = parseFrontmatter(fmMatch[1]);
        if (!fm || !fm.name) continue;
        roles.push({
          id: f.replace('.md', ''),
          category: 'my',
          categoryName: categoryNames.my,
          name: fm.name,
          description: fm.description || '',
          color: fm.color || '#888',
          custom: true,
        });
      } catch {}
    }
  }

  if (!existsSync(agentsDir)) return roles;
  // 分类目录内递归（含 game-development/unity/* 等嵌套角色，id 带子路径）——
  // 与引擎 listAgents / 官网画廊同口径，此前只收一层导致 Studio 比 CLI 少一截角色。
  const SKIP_DIRS = new Set(['node_modules', 'scripts', 'integrations', 'examples']);
  for (const cat of readdirSync(agentsDir)) {
    if (cat.startsWith('.') || SKIP_DIRS.has(cat)) continue;
    const catDir = join(agentsDir, cat);
    try { if (!statSync(catDir).isDirectory()) continue; } catch { continue; }
    const walk = (dir, relDir) => {
      for (const f of readdirSync(dir)) {
        if (f.startsWith('.') || SKIP_DIRS.has(f)) continue;
        const full = join(dir, f);
        let isDir = false;
        try { isDir = statSync(full).isDirectory(); } catch { continue; }
        if (isDir) { walk(full, relDir ? `${relDir}/${f}` : f); continue; }
        if (!f.endsWith('.md')) continue;
        try {
          const raw = readFileSync(full, 'utf-8');
          const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
          if (!fmMatch) continue;
          const fm = parseFrontmatter(fmMatch[1]);
          if (!fm.name) continue;
          const base = f.replace('.md', '');
          roles.push({
            id: relDir ? `${relDir}/${base}` : base,
            category: cat,
            categoryName: categoryNames[cat] || cat,
            name: fm.name,
            description: fm.description || '',
            color: fm.color || '#888',
          });
        } catch {}
      }
    };
    walk(catDir, '');
  }
  return roles;
}

const rolesCache = {};
app.get('/api/roles', (req, res) => {
  const lang = normalizeRoleLang(req.query.lang);
  if (!rolesCache[lang]) rolesCache[lang] = loadRoles(lang);
  res.json(rolesCache[lang]);
});

app.get('/api/roles/:category/:id', (req, res) => {
  // 「我的」分类走用户角色目录（平铺，无子目录）
  const isMy = req.params.category === 'my';
  const baseDir = isMy ? USER_ROLES_DIR : agentsDirFor(normalizeRoleLang(req.query.lang));
  const filePath = isMy ? join(baseDir, req.params.id + '.md') : join(baseDir, req.params.category, req.params.id + '.md');
  if (!isInside(filePath, baseDir) || !existsSync(filePath)) return res.status(404).json({ error: 'not found' });
  const raw = readFileSync(filePath, 'utf-8');
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  const fm = fmMatch ? parseFrontmatter(fmMatch[1]) : {};
  const body = fmMatch ? raw.slice(fmMatch[0].length).trim() : raw;
  res.json({ id: req.params.id, category: req.params.category, name: fm.name || req.params.id, description: fm.description || '', color: fm.color || '#888', content: body });
});

// ── 我的角色（用户自建，~/.ao/roles）：创建 / 删除。列表走 /api/roles 的「我的」分类 ──
// id 只允许 [a-z0-9-]（引擎 loadAgent 的路径白名单是 ASCII）；中文名自动落到 custom-role-N。
function slugifyRoleId(name) {
  const base = String(name || '').toLowerCase().trim()
    .replace(/[^a-z0-9-\s_]/g, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  return base.slice(0, 48);
}
app.post('/api/roles/my', (req, res) => {
  const { name, description, systemPrompt, color, emoji } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
  if (!systemPrompt || !String(systemPrompt).trim()) return res.status(400).json({ error: 'systemPrompt required' });
  mkdirSync(USER_ROLES_DIR, { recursive: true });
  let id = slugifyRoleId(name);
  if (!id) {
    let n = 1;
    while (existsSync(join(USER_ROLES_DIR, `custom-role-${n}.md`))) n++;
    id = `custom-role-${n}`;
  } else if (existsSync(join(USER_ROLES_DIR, `${id}.md`))) {
    let n = 2;
    while (existsSync(join(USER_ROLES_DIR, `${id}-${n}.md`))) n++;
    id = `${id}-${n}`;
  }
  const filePath = join(USER_ROLES_DIR, `${id}.md`);
  if (!isInside(filePath, USER_ROLES_DIR)) return res.status(400).json({ error: 'bad name' });
  const fm = { name: String(name).trim() };
  if (description && String(description).trim()) fm.description = String(description).trim();
  if (emoji && String(emoji).trim()) fm.emoji = String(emoji).trim();
  fm.color = (color && /^#[0-9a-fA-F]{3,8}$/.test(String(color))) ? String(color) : '#7c6cf0';
  const content = `---\n${yaml.dump(fm).trimEnd()}\n---\n\n${String(systemPrompt).trim()}\n`;
  writeFileSync(filePath, content, 'utf-8');
  delete rolesCache.zh; delete rolesCache.en;
  res.json({ id, role: `my/${id}`, name: fm.name });
});
// 编辑自建角色:字段级合并(没传的不动),id 不变
app.put('/api/roles/my/:id', (req, res) => {
  const filePath = join(USER_ROLES_DIR, req.params.id + '.md');
  if (!isInside(filePath, USER_ROLES_DIR)) return res.status(403).json({ error: 'forbidden' });
  if (!existsSync(filePath)) return res.status(404).json({ error: 'not found' });
  const raw = readFileSync(filePath, 'utf-8');
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  const fm = fmMatch ? parseFrontmatter(fmMatch[1]) : {};
  const body = fmMatch ? raw.slice(fmMatch[0].length).trim() : raw.trim();
  const { name, description, systemPrompt, color, emoji } = req.body || {};
  const next = {
    name: (name && String(name).trim()) || fm.name || req.params.id,
    ...( (description !== undefined ? String(description).trim() : fm.description) ? { description: description !== undefined ? String(description).trim() : fm.description } : {} ),
    ...( (emoji !== undefined ? String(emoji).trim() : fm.emoji) ? { emoji: emoji !== undefined ? String(emoji).trim() : fm.emoji } : {} ),
    color: (color && /^#[0-9a-fA-F]{3,8}$/.test(String(color))) ? String(color) : (fm.color || '#7c6cf0'),
  };
  const nextBody = (systemPrompt !== undefined && String(systemPrompt).trim()) ? String(systemPrompt).trim() : body;
  writeFileSync(filePath, `---\n${yaml.dump(next).trimEnd()}\n---\n\n${nextBody}\n`, 'utf-8');
  delete rolesCache.zh; delete rolesCache.en;
  res.json({ id: req.params.id, role: `my/${req.params.id}`, name: next.name });
});
app.delete('/api/roles/my/:id', (req, res) => {
  const filePath = join(USER_ROLES_DIR, req.params.id + '.md');
  // 严格限定用户角色目录，内置库一律 403（与 /api/workflows 删除守卫同规）
  if (!isInside(filePath, USER_ROLES_DIR)) return res.status(403).json({ error: 'forbidden' });
  if (!existsSync(filePath)) return res.status(404).json({ error: 'not found' });
  unlinkSync(filePath);
  delete rolesCache.zh; delete rolesCache.en;
  res.json({ ok: true });
});

// ── Run single role ──
app.post('/api/run-role', (req, res) => {
  const { role, task, provider, lang, roleLang } = req.body || {};
  if (!role || !task) return res.status(400).json({ error: 'role and task required' });

  // Build a single-step workflow. Top-level llm is required; keyed providers
  // (deepseek/openai/claude) also require a model — buildLLMConfig fills it.
  // api_key 绝不写进 yaml（文件会持久化到用户目录、可被下载/分享）——注册 provider
  // 的 key 启动时已注入 process.env,自定义供应商的 key 走 --api-key CLI 参数。
  const { api_key: consultKey, ...llmSafe } = cleanLLMConfig(provider);
  const roleShort = String(role).split('/').pop();
  // 卡片/历史标题用角色显示名（中文站「人类学家」而非英文 slug），来自角色 frontmatter
  const langKey = lang === 'en' ? 'en' : 'zh';
  // 角色库语言(roleLang)决定从哪套库解析角色;界面语言(langKey)只影响命名措辞
  const roleLib = normalizeRoleLang(roleLang || langKey);
  if (!rolesCache[roleLib]) rolesCache[roleLib] = loadRoles(roleLib);
  const roleName = rolesCache[roleLib].find(r => `${r.category}/${r.id}` === String(role))?.name
    || rolesCache[roleLib].find(r => r.id === roleShort)?.name || roleShort;
  const wfDoc = {
    name: langKey === 'en' ? `Expert consult: ${roleName}` : `专家咨询: ${roleName}`,
    description: String(task).slice(0, 140),
    agents_dir: agentsDirFor(roleLib),
    llm: llmSafe,
    steps: [{ id: 'consult', role, task, output: 'result' }],
  };

  // 持久化到「我的工作流」(COMPOSED_DIR):历史记录可重跑,列表里可再运行/删除。
  // 文件名保留角色 slug（稳定、无歧义）。同角色**同问题**重复咨询直接复用已有文件
  // （重复运行不该堆出 -2/-3 卡片）;问题不同才按 compose 的 dedupe 规则另存。
  mkdirSync(COMPOSED_DIR, { recursive: true });
  const consultSafe = `${langKey === 'en' ? 'expert-consult' : '专家咨询'}-${roleShort}`.replace(/[^\w.一-龥-]+/g, '-');
  const consultYaml = yaml.dump(wfDoc, { lineWidth: -1 });
  let consultFile = join(COMPOSED_DIR, `${consultSafe}.yaml`);
  let consultSeq = 2;
  while (existsSync(consultFile)) {
    let same = false;
    try { same = readFileSync(consultFile, 'utf-8') === consultYaml; } catch {}
    if (same) break;
    consultFile = join(COMPOSED_DIR, `${consultSafe}-${consultSeq}.yaml`); consultSeq++;
  }
  writeFileSync(consultFile, consultYaml, 'utf-8');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (type, data) => { if (res.writableEnded) return; res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); };

  // Don't pass --provider here: the saved workflow already bakes a full llm block
  // (provider + model). A bare --provider override would drop the model and the
  // API call would 400 with "missing field model".
  // 自定义供应商的 key 不在 env 也不进 yaml,单独经 CLI 参数传给引擎。
  const args = [CLI, 'run', consultFile];
  if (consultKey) args.push('--api-key', consultKey);

  send('start', { cmd: `ao run (${role})`, task });
  // 告知前端本次咨询已落盘为可复用工作流（未知事件前端安全忽略）
  send('workflow-saved', { file: consultFile });

  let lineBuffer = '';
  let collecting = false;
  let content = '';

  function parseLine(raw) {
    const clean = raw.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '').trim();
    if (!clean) return;

    // Step header
    if (/── \[\d+\/\d+\]/.test(clean)) { collecting = true; return; }
    // Step done
    if (/^完成\s*\|/.test(clean)) { send('step-done', { meta: clean.replace(/^完成\s*\|\s*/, '') }); return; }
    // Workflow summary
    if (/完成:\s*\d+\/\d+\s*步/.test(clean)) return;
    // 终端装饰噪音不能混进内容：====== 分隔线尾随文本行会被 Markdown 解析成 setext H1
    // (用户导出的 md 里"详细输出"上一行变超大标题的根因)；详细输出路径行单独发事件给 UI 展示
    if (/^=+$/.test(clean)) return;
    if (/^详细输出[:：]|^Detailed output[:：]?/i.test(clean)) {
      const m = clean.match(/(?:详细输出|Detailed output)[:：]?\s*(.+)$/i);
      if (m) send('output-dir', { dir: resolve(DATA_DIR, m[1].trim()) });
      return;
    }
    // Collect content
    if (collecting) {
      if (/^⏳/.test(clean)) return;
      const stripped = raw.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/^\s{0,4}/, '');
      content += stripped + '\n';
      send('content', { text: stripped });
    }
  }

  console.log('[run-role]', role, task.slice(0, 60));
  // AO_NO_RESUME_HINT=1 → 单角色咨询是一次性问答,终端的 --resume 提示对网页用户是噪音
  const child = spawn(NODE_BIN, args, { cwd: DATA_DIR, env: { ...process.env, FORCE_COLOR: '0', AO_NO_AT_FILE: '1', AO_NO_RESUME_HINT: '1' } });

  child.stdout.on('data', chunk => {
    const text = chunk.toString();
    send('stdout', { text });
    lineBuffer += text;
    let idx;
    while ((idx = lineBuffer.indexOf('\n')) >= 0) { parseLine(lineBuffer.slice(0, idx)); lineBuffer = lineBuffer.slice(idx + 1); }
  });
  child.stderr.on('data', chunk => send('stderr', { text: chunk.toString() }));
  // 工作流文件已持久化在 COMPOSED_DIR（「我的工作流」），任何退出路径都不再删除。
  child.on('exit', (code, signal) => {
    if (lineBuffer.trim()) parseLine(lineBuffer);
    send('done', { code, signal, content });
    res.end();
  });
  child.on('error', err => { send('error', { message: err.message }); res.end(); });

  let finished = false;
  child.on('exit', () => { finished = true; });
  res.on('close', () => { if (!finished && !child.killed) child.kill('SIGTERM'); });
});

// ── 对话（不组队）────────────────────────────────────────────────────────
// 统一的聊天入口：不建团队、不写临时工作流、不产生 ao-output 运行记录——直接用
// 当前 provider 的 connector 调一轮。可选 role（如 "engineering/engineering-sre"）
// = 带该角色人设的多轮对话（取代原先一次性的「单独对话」运行）；不带 role = 素模型。
// connector 接口是单轮的 (system, user)，多轮上下文由前端带来的 messages 在这里
// 折叠进 userMessage。
app.post('/api/chat', async (req, res) => {
  const { messages, provider, lang, role, roleLang } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) return res.status(400).json({ error: 'messages required' });
  // 只带最近 20 条、每条截 8k 字符——闲聊场景防历史无限增长撑爆上下文
  const clean = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-20)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 8000) }));
  const last = clean[clean.length - 1];
  if (!last || last.role !== 'user') return res.status(400).json({ error: 'last message must be from user' });

  const en = lang === 'en';
  let system = en
    ? 'You are a friendly, knowledgeable AI assistant. Answer directly and concisely — no team building, no role-play. Reply in the language the user writes in.'
    : '你是一位友好、靠谱的 AI 助手。直接、简洁地回答用户，不需要组建团队或扮演特定角色。用用户使用的语言回复。';
  if (role && typeof role === 'string') {
    // my/ 自建角色走用户角色目录(平铺);其余按角色库语言(roleLang 优先于站点语言)解析
    const isMy = role.startsWith('my/');
    const agentsDir = isMy ? USER_ROLES_DIR : agentsDirFor(normalizeRoleLang(roleLang || (en ? 'en' : 'zh')));
    const filePath = isMy ? join(agentsDir, role.slice(3) + '.md') : join(agentsDir, role + '.md');
    if (!isInside(filePath, agentsDir) || !existsSync(filePath)) return res.status(400).json({ error: `unknown role: ${role}` });
    const raw = readFileSync(filePath, 'utf-8');
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
    const body = (fmMatch ? raw.slice(fmMatch[0].length) : raw).trim();
    // 角色提示词是按"产出一份完整交付物"写的，聊天场景补一句对话姿态，避免每轮都甩全套报告
    system = body + (en
      ? '\n\n---\nNote: this is a live multi-turn conversation. Reply in character, directly and concisely — no need to produce a full formatted report each turn.'
      : '\n\n---\n注意：当前是与用户的实时多轮对话。请以上述角色身份直接、简洁地回复，不必每轮都输出完整报告格式。');
  }
  const prior = clean.slice(0, -1);
  const userLabel = en ? 'User' : '用户';
  const aiLabel = en ? 'Assistant' : '助手';
  const userMessage = prior.length
    ? `${en ? 'Earlier conversation:' : '这是此前的对话记录：'}\n\n${prior.map((m) => `${m.role === 'user' ? userLabel : aiLabel}: ${m.content}`).join('\n\n')}\n\n${en ? 'New message:' : '用户的新消息：'}\n${last.content}`
    : last.content;

  try {
    const llm = buildLLMConfig(provider);
    const { createConnector } = await import('../dist/connectors/factory.js');
    const connector = createConnector(llm);
    console.log('[chat]', llm.provider, role || '(plain)', last.content.slice(0, 60));
    const result = await connector.chat(system, userMessage, llm);
    res.json({ content: result.content, usage: result.usage });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

// ── Compose a workflow from picked roles (LLM orchestrates the chosen cast) ──
app.post('/api/compose', async (req, res) => {
  const { description, roles, name, provider, lang, budget, roleLang } = req.body || {};
  if (!description || typeof description !== 'string') return res.status(400).json({ error: 'description required' });
  // R2.2 首跑引导：无可用凭证时，返回结构化引导（前端渲染三选一），而不是让底层连接器抛晦涩错。
  if (!composeProviderReady(provider)) {
    return res.status(400).json({
      code: 'no_credentials',
      error: 'no_credentials',
      provider: provider || process.env.AO_PROVIDER || DEFAULT_PROVIDER_ID,
      installedCli: detectUsableCliProviders(),
      // 赞助商位规则（src/utils/sponsor-guide.ts）：进阶档持有默认 provider 位
      // （上面 provider 字段的兜底），不占横幅——但该档位自 2026-08-17 起无人持有
      // （多元探索下架），默认位暂由旗舰 APINEBULA 顶上。横幅 = 池子里几家按天轮换
      // 2 家，等份轮值。池子优先取远程清单（上/下架不用发版，老用户也能立刻同步），
      // 清单没配就用引擎内置的那份。
      sponsors: guideSponsors(await getRemoteManifest()),
    });
  }
  // roles 可为空 = AI 自动组队：让 LLM 从全量角色目录里自己挑专家（对应 CLI `ao compose "一句话"`，
  // 不传 --roles）。传了 roles = 锁定阵容（手动组队 / 套用已存团队）。
  const pinnedRoles = Array.isArray(roles) ? roles.map(String) : [];
  try {
    mkdirSync(COMPOSED_DIR, { recursive: true });
    const { composeWorkflow } = await import('../dist/cli/compose.js');
    const trimmedName = name && String(name).trim() ? String(name).trim() : undefined;
    const composeLang = lang === 'en' ? 'en' : 'zh';
    // 角色库语言(roleLang)与提示词语言(composeLang)解耦:选了语言包则从该包组队,
    // 生成的 YAML agents_dir 写包名,findAgentsDir 会在 node_modules 里解析到它
    const roleLib = normalizeRoleLang(roleLang || composeLang);
    const roleLibPkg = LANG_LIBS.find(l => l.id === roleLib)?.pkg;
    const result = await composeWorkflow({
      description,
      agentsDir: agentsDirFor(roleLib),
      agentsDirName: roleLibPkg,
      llmConfig: buildLLMConfig(provider),
      pinnedRoles,
      outputName: trimmedName,
      saveDir: COMPOSED_DIR,
      lang: composeLang,
      // Studio「组队 → 直接跑」= compose --run 语义：不生成必填 inputs，把描述嵌进 task，
      // 否则生成的工作流带 required input、直接运行会报「请用 -i 传入」缺参数错。
      autoRun: true,
      // R3.2 省钱模式：前端传 budget:true 时，轻活步骤自动降便宜档（桌面/web 同一后端，一处生效两端受益）
      budget: budget === true,
    });
    res.json({ file: result.savedPath, yaml: result.yaml, warnings: result.warnings || [] });
  } catch (err) {
    console.log('[compose] error', err?.message);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// ── Save an edited / manually assembled workflow YAML into the user dir ──
app.post('/api/workflows/save', async (req, res) => {
  const { name, yaml: rawYaml } = req.body || {};
  let yamlText = rawYaml;
  if (!yamlText || typeof yamlText !== 'string') return res.status(400).json({ error: 'yaml required' });
  let doc;
  try { doc = yaml.load(yamlText); } catch (e) { return res.status(400).json({ error: 'invalid YAML: ' + e.message }); }
  if (!doc || !Array.isArray(doc.steps) || doc.steps.length === 0) {
    return res.status(400).json({ error: 'YAML must contain a non-empty steps array' });
  }
  // #103：粘进来的 YAML 里，depends_on 常被写成上游的**输出变量名**而非 step id
  // （LLM 生成的产物尤其常见）。这里做同一套零歧义的确定性改写——存下去之前修好，
  // 否则用户要等到点「运行」才看到"依赖不存在的 step"，还得自己回去对着改。
  let depIdFixes = [];
  {
    const tmpFix = join(tmpdir(), `ao-save-autofix-${process.pid}-${Date.now()}.yaml`);
    try {
      writeFileSync(tmpFix, yamlText, 'utf-8');
      const { autoFixDependsOnIds } = await import('../dist/cli/compose.js');
      const idFix = await autoFixDependsOnIds(tmpFix);
      if (idFix.fixed > 0) {
        yamlText = readFileSync(tmpFix, 'utf-8');
        doc = yaml.load(yamlText);
        depIdFixes = idFix.details.map((d) => ({ step: d.step, fixedDep: d.from, toStep: d.to }));
      }
    } catch { /* 修复自身出错不阻塞保存——原样存下，运行时仍会报出问题 */ }
    finally { try { unlinkSync(tmpFix); } catch { /* 临时文件可能没写成 */ } }
  }
  const safe = String(name || doc.name || 'workflow')
    .replace(/[^一-鿿a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'workflow';
  mkdirSync(COMPOSED_DIR, { recursive: true });
  let file = join(COMPOSED_DIR, `${safe}.yaml`);
  let i = 2;
  while (existsSync(file)) { file = join(COMPOSED_DIR, `${safe}-${i}.yaml`); i++; }
  if (!isInside(file, COMPOSED_DIR)) return res.status(400).json({ error: 'bad path' });
  writeFileSync(file, yamlText.endsWith('\n') ? yamlText : yamlText + '\n', 'utf-8');
  // 修了就告诉前端改了什么，并把改写后的正文一并回传 —— 调用方（网页编辑器）要用它
  // 同步编辑框，否则用户眼前的文本与磁盘上的文件不一致，还以为自己写的就是存下的。
  res.json({ file, ...(depIdFixes.length > 0 ? { autoFixes: depIdFixes, yaml: yamlText } : {}) });
});

// ── 可编辑画布：工作流 YAML ↔ graph（节点/连线）。转换在引擎侧（保真往返），前端只碰 graph JSON。 ──
app.get('/api/workflows/graph', async (req, res) => {
  const file = req.query.file;
  if (!file || typeof file !== 'string') return res.status(400).json({ error: 'invalid file' });
  const resolved = resolve(file);
  if (!isAllowedWorkflow(resolved)) return res.status(403).json({ error: 'file outside allowed dirs' });
  if (!existsSync(resolved)) return res.status(404).json({ error: 'file not found' });
  try {
    const { workflowToGraph } = await import('../dist/canvas/graph.js');
    const graph = workflowToGraph(readFileSync(resolved, 'utf-8'));
    // 内置模板只读：只有 COMPOSED_DIR 里的用户工作流可就地保存。
    res.json({ ...graph, file: resolved, editable: isInside(resolved, COMPOSED_DIR) });
  } catch (err) { res.status(500).json({ error: err?.message || String(err) }); }
});

app.post('/api/workflows/graph', async (req, res) => {
  const { file, name, nodes, edges, baseYaml } = req.body || {};
  if (!Array.isArray(nodes) || nodes.length === 0) return res.status(400).json({ error: 'nodes required' });
  // edges 必须显式传数组（可空=无依赖）。缺失则拒绝，避免把原工作流的依赖静默清空（QA #6）。
  if (!Array.isArray(edges)) return res.status(400).json({ error: 'edges must be an array (use [] for no dependencies)' });
  // 每个节点必须有非空 role，否则会存出跑不起来的工作流（QA #14）。
  // 例外：approval / human_input 节点本来就没有 role（签字闸门/中途提问），不能误杀。
  const roleless = nodes.filter((n) => {
    const t = n?.data?.type;
    if (t === 'approval' || t === 'human_input') return false;
    return !n?.data?.role || typeof n.data.role !== 'string' || !n.data.role.trim();
  });
  if (roleless.length > 0) return res.status(400).json({ error: `每个步骤都要选角色（${roleless.length} 个步骤缺 role）` });
  // 底稿：编辑既有工作流用其自身 YAML；否则用前端传来的 baseYaml（含 llm/agents_dir 等顶层）。
  let base = typeof baseYaml === 'string' ? baseYaml : '';
  let overwritePath = '';
  if (typeof file === 'string' && file) {
    const resolved = resolve(file);
    if (!isAllowedWorkflow(resolved)) return res.status(403).json({ error: 'file outside allowed dirs' });
    if (!existsSync(resolved)) return res.status(404).json({ error: 'file not found' });
    if (!base) base = readFileSync(resolved, 'utf-8');
    if (isInside(resolved, COMPOSED_DIR)) overwritePath = resolved; // 仅用户目录可就地覆盖
  }
  if (!base) return res.status(400).json({ error: 'need file or baseYaml as base' });

  try {
    const { graphToWorkflow } = await import('../dist/canvas/graph.js');
    const { validateWorkflow } = await import('../dist/core/parser.js');
    let yamlText = graphToWorkflow({ name: String(name || 'workflow'), nodes, edges }, base);
    // 保存前用引擎校验挡环 / 坏依赖 / 非法 loop（不校验角色文件存在，结构有效即可）。
    let def = yaml.load(yamlText);
    let errors = validateWorkflow(def);
    // #91：自动组队产物最常见的错是"变量名对、但缺 depends_on 边"——compose 链路已有
    // 确定性补边修复（#87），画布保存之前没接，导致弹窗能跑、进画布却怎么改都存不了。
    // 这里套用同一套修复（只补边，不改名——autoFixVariableRefs 的模糊改名对用户已有
    // 工作流太激进，不用），修完再校验，仍有错才拒。修复函数是文件级文本补丁，走临时文件。
    let autoFixes = [];
    if (errors.length > 0) {
      const tmpFix = join(tmpdir(), `ao-canvas-autofix-${process.pid}-${Date.now()}.yaml`);
      try {
        writeFileSync(tmpFix, yamlText, 'utf-8');
        // 注：这里不需要 autoFixDependsOnIds(#103)——画布的 depends_on 是从连线重算的
        // （graphToWorkflow），节点里写错的假 step id 根本落不到 YAML 里。那类修复挂在
        // compose 链和 /api/workflows/save（原始 YAML 入口）上。
        const { autoFixMissingDependsOn } = await import('../dist/cli/compose.js');
        const fix = await autoFixMissingDependsOn(tmpFix);
        if (fix.fixed > 0) {
          yamlText = readFileSync(tmpFix, 'utf-8');
          def = yaml.load(yamlText);
          errors = validateWorkflow(def);
          autoFixes = fix.details;
        }
      } catch { /* 修复自身出错不阻塞——按原始校验错误拒绝 */ }
      finally { try { unlinkSync(tmpFix); } catch { /* 临时文件可能没写成 */ } }
    }
    if (errors.length > 0) return res.status(400).json({ error: 'invalid workflow', errors });

    mkdirSync(COMPOSED_DIR, { recursive: true });
    let outPath = overwritePath;
    if (!outPath) {
      const safe = String(name || def?.name || 'workflow')
        .replace(/[^一-鿿a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'workflow';
      outPath = join(COMPOSED_DIR, `${safe}.yaml`);
      let i = 2;
      while (existsSync(outPath)) { outPath = join(COMPOSED_DIR, `${safe}-${i}.yaml`); i++; }
    }
    if (!isInside(outPath, COMPOSED_DIR)) return res.status(400).json({ error: 'bad path' });
    writeFileSync(outPath, yamlText.endsWith('\n') ? yamlText : yamlText + '\n', 'utf-8');
    res.json({ file: outPath, overwritten: !!overwritePath, autoFixes });
  } catch (err) { res.status(500).json({ error: err?.message || String(err) }); }
});

// ── 报告导出:Markdown → Word / PDF / Excel / Skill / 可执行计划(确定性转换,见 src/export/convert.ts) ──
app.post('/api/export', async (req, res) => {
  const { markdown, format, name } = req.body || {};
  if (!markdown || typeof markdown !== 'string') return res.status(400).json({ error: 'markdown required' });
  const allowed = ['docx', 'pdf', 'xlsx', 'pptx', 'skill', 'plan'];
  if (!allowed.includes(format)) return res.status(400).json({ error: `format must be one of ${allowed.join('/')}` });
  try {
    const { exportMarkdown } = await import('../dist/export/convert.js');
    const r = await exportMarkdown(markdown, format, { name: typeof name === 'string' ? name : undefined });
    const safe = (typeof name === 'string' && name.trim() ? name : 'report').replace(/[^一-鿿a-zA-Z0-9_-]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'report';
    res.setHeader('Content-Type', r.mime);
    // 中文文件名用 RFC 5987 编码,避免 header 非法字符
    res.setHeader('Content-Disposition', `attachment; filename="export.${r.ext}"; filename*=UTF-8''${encodeURIComponent(safe)}.${r.ext}`);
    res.setHeader('X-Export-Engine', r.engine);
    res.send(r.buffer);
  } catch (err) { res.status(500).json({ error: err?.message || String(err) }); }
});

// ── Teams / Loadouts: reusable role line-ups, shared with the `ao team` CLI ──
// Stored in ~/.ao/teams (or AO_TEAMS_DIR) so CLI-saved and Studio-saved teams interoperate.
app.get('/api/teams', async (_req, res) => {
  try {
    const { listTeams, slugify } = await import('../dist/cli/team.js');
    const teams = listTeams().map(({ team }) => ({
      slug: slugify(team.name),
      name: team.name,
      description: team.description || '',
      roles: team.roles,
      lang: team.lang || 'zh',
      provider: team.provider,
      source: team.source,
      created: team.created,
    }));
    res.json({ teams });
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.post('/api/teams', async (req, res) => {
  const { name, description, roles, lang, provider } = req.body || {};
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' });
  if (!Array.isArray(roles) || roles.length === 0) return res.status(400).json({ error: 'at least one role required' });
  try {
    const { saveTeam, slugify } = await import('../dist/cli/team.js');
    // Normalize: accept ["cat/role"] or [{role,name,emoji,note}]
    const seen = new Set();
    const normRoles = [];
    for (const r of roles) {
      const rolePath = typeof r === 'string' ? r : r?.role;
      if (!rolePath || seen.has(rolePath)) continue;
      seen.add(rolePath);
      const entry = { role: String(rolePath) };
      if (r && typeof r === 'object') {
        if (r.name) entry.name = String(r.name);
        if (r.emoji) entry.emoji = String(r.emoji);
        if (r.note) entry.note = String(r.note);
      }
      normRoles.push(entry);
    }
    const team = {
      kind: 'team',
      name: String(name).trim(),
      description: description ? String(description) : undefined,
      roles: normRoles,
      lang: lang === 'en' ? 'en' : 'zh',
      provider: provider ? String(provider) : undefined,
      created: new Date().toISOString().slice(0, 10),
      source: 'studio',
    };
    const file = saveTeam(team);
    res.json({ ok: true, slug: slugify(team.name), file });
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.delete('/api/teams/:slug', async (req, res) => {
  try {
    const { removeTeam } = await import('../dist/cli/team.js');
    const removed = removeTeam(req.params.slug);
    if (!removed) return res.status(404).json({ error: 'team not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// ── Prompt Lab: 优化 / 测试 / 多结果评估 / 沉淀（与 `ao prompt` CLI 共用 ~/.ao/prompts）──
app.post('/api/prompt/optimize', async (req, res) => {
  const { rawPrompt, mode, provider, lang } = req.body || {};
  if (!rawPrompt || typeof rawPrompt !== 'string') return res.status(400).json({ error: 'rawPrompt required' });
  try {
    const { optimizePrompt } = await import('../dist/cli/prompt.js');
    const optimized = await optimizePrompt({
      rawPrompt, mode: mode === 'system' ? 'system' : 'user',
      llmConfig: buildLLMConfig(provider), lang: lang === 'en' ? 'en' : lang === 'zh' ? 'zh' : undefined,
    });
    res.json({ optimized });
  } catch (err) { res.status(500).json({ error: err?.message || String(err) }); }
});

app.post('/api/prompt/test', async (req, res) => {
  const { prompt, mode, testInput, provider } = req.body || {};
  if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'prompt required' });
  try {
    const { testPrompt } = await import('../dist/cli/prompt.js');
    const output = await testPrompt({
      prompt, mode: mode === 'system' ? 'system' : 'user',
      testInput: String(testInput || ''), llmConfig: buildLLMConfig(provider),
    });
    res.json({ output });
  } catch (err) { res.status(500).json({ error: err?.message || String(err) }); }
});

app.post('/api/prompt/score', async (req, res) => {
  const { testInput, candidates, provider, lang } = req.body || {};
  if (!Array.isArray(candidates) || candidates.length < 2) return res.status(400).json({ error: 'need >=2 candidates' });
  try {
    const { scoreOutputs } = await import('../dist/cli/prompt.js');
    const result = await scoreOutputs({
      testInput: String(testInput || ''),
      candidates: candidates.map(c => ({ label: String(c.label), output: String(c.output) })),
      llmConfig: buildLLMConfig(provider), lang: lang === 'en' ? 'en' : 'zh',
    });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err?.message || String(err) }); }
});

app.get('/api/prompts', async (_req, res) => {
  try {
    const { listPrompts } = await import('../dist/cli/prompt.js');
    res.json({ prompts: listPrompts().map(p => p.record) });
  } catch (err) { res.status(500).json({ error: err?.message || String(err) }); }
});

app.post('/api/prompts', async (req, res) => {
  const { name, mode, versions, favorite } = req.body || {};
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' });
  if (!Array.isArray(versions) || versions.length === 0) return res.status(400).json({ error: 'versions required' });
  try {
    const { savePrompt, slugify } = await import('../dist/cli/prompt.js');
    const rec = {
      kind: 'prompt', name: String(name).trim(), mode: mode === 'system' ? 'system' : 'user',
      favorite: !!favorite,
      versions: versions.map(v => ({
        content: String(v.content || ''),
        ...(v.note ? { note: String(v.note) } : {}),
        ...(v.source ? { source: String(v.source) } : {}),
        created: v.created || new Date().toISOString(),
      })),
      created: new Date().toISOString(),
    };
    const file = savePrompt(rec);
    res.json({ ok: true, slug: slugify(rec.name), file });
  } catch (err) { res.status(500).json({ error: err?.message || String(err) }); }
});

app.delete('/api/prompts/:slug', async (req, res) => {
  try {
    const { removePrompt } = await import('../dist/cli/prompt.js');
    const removed = removePrompt(req.params.slug);
    if (!removed) return res.status(404).json({ error: 'prompt not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err?.message || String(err) }); }
});

app.get('/api/prompt/garden', async (_req, res) => {
  try {
    const { PROMPT_GARDEN } = await import('../dist/cli/prompt.js');
    res.json({ seeds: PROMPT_GARDEN });
  } catch (err) { res.status(500).json({ error: err?.message || String(err) }); }
});

// ── Usage / cost stats: aggregate token usage from ao-output metadata ──
app.get('/api/usage', (_req, res) => {
  const byDay = {};
  const byRole = {};
  let totalRuns = 0, totalInput = 0, totalOutput = 0, firstDate = null, lastDate = null;
  try {
    if (existsSync(OUTPUT_DIR)) {
      for (const d of readdirSync(OUTPUT_DIR, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const metaPath = join(OUTPUT_DIR, d.name, 'metadata.json');
        if (!existsSync(metaPath)) continue;
        let m;
        try { m = JSON.parse(readFileSync(metaPath, 'utf-8')); } catch { continue; }
        const inTok = m?.totalTokens?.input || 0;
        const outTok = m?.totalTokens?.output || 0;
        totalRuns++; totalInput += inTok; totalOutput += outTok;
        const dm = d.name.match(/(\d{4}-\d{2}-\d{2})T\d{2}-\d{2}-\d{2}$/);
        let day;
        try { day = dm ? dm[1] : new Date(statSync(metaPath).mtimeMs).toISOString().slice(0, 10); }
        catch { day = '未知'; }
        if (!byDay[day]) byDay[day] = { date: day, input: 0, output: 0, runs: 0 };
        byDay[day].input += inTok; byDay[day].output += outTok; byDay[day].runs++;
        if (day !== '未知') {
          if (!firstDate || day < firstDate) firstDate = day;
          if (!lastDate || day > lastDate) lastDate = day;
        }
        for (const s of (m.steps || [])) {
          const role = s.role || s.id;
          if (!byRole[role]) byRole[role] = { role, name: s.agentName || role, runs: 0, input: 0, output: 0 };
          byRole[role].runs++;
          byRole[role].input += s?.tokens?.input || 0;
          byRole[role].output += s?.tokens?.output || 0;
        }
      }
    }
  } catch (e) { return res.status(500).json({ error: e?.message || String(e) }); }
  res.json({
    totalRuns, totalInput, totalOutput, totalTokens: totalInput + totalOutput,
    byDay: Object.values(byDay).sort((a, b) => (a.date < b.date ? -1 : 1)),
    byRole: Object.values(byRole).sort((a, b) => (b.input + b.output) - (a.input + a.output)).slice(0, 12),
    firstDate, lastDate,
  });
});

// ── Key config: report which providers have a key (never returns the key) ──
app.get('/api/config', async (_req, res) => {
  const manifest = await getRemoteManifest();
  const saved = readKeys();
  const providers = {};
  for (const [provider, cfg] of Object.entries(KEY_ENV)) {
    providers[provider] = {
      family: 'api',
      hasKey: !!(saved[provider]?.apiKey || process.env[cfg.key]),
      fromEnv: !saved[provider]?.apiKey && !!process.env[cfg.key],
      baseUrl: saved[provider]?.baseUrl || (cfg.base ? process.env[cfg.base] : '') || '',
      model: saved[provider]?.model || '',
      supportsBaseUrl: !!cfg.base,
      // 清单 providerOverrides 里的换代模型建议——前端模型下拉在拉不到真实
      // /models 时优先用它兜底（比打包进前端的静态建议新）
      ...(manifest.providerOverrides?.[provider]?.modelSuggestions
        ? { modelSuggestions: manifest.providerOverrides[provider].modelSuggestions }
        : {}),
      // Claude Code 模型映射回显（配置页编辑用）
      ...(provider === 'claude-code'
        ? {
            sonnetModel: saved[provider]?.sonnetModel || '',
            opusModel: saved[provider]?.opusModel || '',
            haikuModel: saved[provider]?.haikuModel || '',
          }
        : {}),
    };
    // 视频供应商单独一族：imageProviders 与顶栏模型下拉都只认 family:'api'，
    // 标成 video 就天然不会被误选（它没有 chat / images 端点）。
    // **只标"纯视频"的**：APIMart 同时在两张表里（一把 key 通聊天/图片/视频），
    // 一刀切会把它从图片供应商列表里踢出去——创意库一键出图立刻少一家。
    if (VIDEO_PROVIDER_MAP[provider] && !API_PROVIDER_MAP[provider]) providers[provider].family = 'video';
  }
  providers.ollama = {
    family: 'local',
    baseUrl: saved.ollama?.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    model: saved.ollama?.model || '',
    configured: !!saved.ollama?.model,
  };
  // Codex 中转状态读的是 ~/.codex/config.toml，不是 web-keys.json/env，单独查。
  const codexRelay = readCodexRelayStatus(CODEX_RELAY_ID);
  providers['codex-cli'] = {
    family: 'api',
    hasKey: codexRelay.configured,
    baseUrl: codexRelay.baseUrl || '',
    supportsBaseUrl: true,
  };
  // 自定义供应商：连接信息（key/base_url/model）跟内置 provider 一样存在 saved[id] 里，
  // 只是没有 KEY_ENV 里的专属 env 变量名 —— hasKey 只看 saved,不查 process.env。
  const customProviders = readCustomProviders(CUSTOM_PROVIDERS_FILE);
  for (const meta of customProviders) {
    providers[meta.id] = {
      family: 'api',
      hasKey: !!saved[meta.id]?.apiKey,
      fromEnv: false,
      baseUrl: saved[meta.id]?.baseUrl || '',
      model: saved[meta.id]?.model || '',
      supportsBaseUrl: true,
    };
  }
  // 远程清单上架的赞助商：默认端点/模型来自清单,用户没自定义时直接回显清单值,
  // 保存 key 时会连同端点一起落盘 → 运行链路与自定义供应商完全一致。
  for (const meta of manifest.providers) {
    if (customProviders.some((c) => c.id === meta.id)) continue; // 用户自建同名的优先
    providers[meta.id] = {
      family: 'api',
      hasKey: !!saved[meta.id]?.apiKey,
      fromEnv: false,
      baseUrl: saved[meta.id]?.baseUrl || meta.baseUrl,
      model: saved[meta.id]?.model || meta.defaultModel || '',
      supportsBaseUrl: true,
    };
  }
  // 探测本机已安装的订阅制 CLI（可零配置直接用，无需在 AO 配 key）。
  const installedAll = detectInstalledCliProviders();
  const cli = CLI_PROVIDERS.map((name) => ({ name, installed: installedAll.includes(name) }));
  // 推荐/一键切换只用「可用」列表（排除已停服的 gemini-cli 等）；卡片展示仍保留全量。
  const installedCli = detectUsableCliProviders();
  // 推荐 provider：已装的 CLI 优先（零配置）> 已配 key 的 provider > 默认。前端据此默认选中并给提示。
  const keyedWithKey = Object.entries(providers).find(([, p]) => p.hasKey)?.[0];
  const recommended = installedCli[0] || keyedWithKey || (process.env.AO_PROVIDER || DEFAULT_PROVIDER_ID);
  res.json({
    providers,
    cli,
    installedCli,
    recommended,
    customProviders,
    remoteProviders: manifest.providers,
    relayPresets: manifest.relayPresets,
    removedProviders: manifest.removedProviders,
    defaultProvider: process.env.AO_PROVIDER || DEFAULT_PROVIDER_ID,
    // 省钱模式对哪些 provider 真的生效（引擎降档表的键）——前端据此在不生效时明说
    budgetProviders: BUDGET_CAPABLE_PROVIDERS,
    // 文生图只有 OpenAI 兼容的 API provider 能跑（引擎 resolveImageAccess 同一口径）：
    // 本地 CLI 是编码工具、Anthropic 原生协议压根没有图片端点。前端据此只列能跑的，
    // 而不是把 family:'api' 的全塞进下拉——claude-code / gemini-cli 也在那一族里。
    imageProviders: Object.entries(providers)
      .filter(([id, p]) => p.family === 'api'
        && !CLI_PROVIDERS.includes(id)
        && id !== 'claude'
        && !ANTHROPIC_PROVIDER_MAP[id])
      .map(([id]) => id),
    // 视频供应商（独立一张表）：id + 是否已配 key + 各家档位表，Studio 输入弹窗的下拉据此渲染——
    // 档位名各家不通用（768P vs 1080p），换供应商时候选跟着换，从根上消灭"填错被服务商拒"。
    videoProviders: VIDEO_PROVIDERS.map((v) => {
      const models = v.models || [];
      const uniq = (xs) => [...new Set(xs)];
      return {
        id: v.id,
        hasKey: !!providers[v.id]?.hasKey,
        models: models.map((m) => m.id),
        // 档位按模型（同一网关上 sora 只有 720p、veo 固定 8 秒）；provider 级是并集，给没选模型时兜底
        tiers: Object.fromEntries(models.map((m) => [m.id, { resolutions: m.resolutions || [], durations: m.durations || [], ratios: m.ratios || [] }])),
        resolutions: uniq(models.flatMap((m) => m.resolutions || [])),
        durations: uniq(models.flatMap((m) => m.durations || [])),
        ratios: uniq(models.flatMap((m) => m.ratios || [])),
      };
    }),
    // 风格库：输入 source: styles 的候选（引擎内置，运行前由引擎展开成提示词后缀）
    styles: STYLE_PRESETS.map(({ id, name, nameEn, category, prompt, sample }) => ({ id, name, nameEn, category, prompt, ...(sample ? { sample } : {}) })),
    // 角色库下拉的可选项:zh/en + 已安装的官方语言包(agency-agents-ko 等)
    roleLibs: installedRoleLibs(),
  });
});

app.post('/api/config', (req, res) => {
  const { provider, apiKey, baseUrl, model } = req.body || {};
  if (typeof apiKey === 'string' && apiKey.trim() && /[^\x20-\x7E]/.test(apiKey)) {
    return res.status(400).json({ error: 'API key 含中文/全角字符——通常是复制时把旁边的说明文字一起带上了，请只粘贴 key 本身（重新复制或删掉多余字符）' });
  }
  // Codex 中转走 ~/.codex/config.toml + auth.json，跟其它 provider 的存储方式完全不同，
  // 单独分支处理，不进下面 KEY_ENV/web-keys.json 那套逻辑。
  if (provider === 'codex-cli') {
    try {
      if (typeof apiKey === 'string' && apiKey.trim() === '' && baseUrl == null) {
        clearCodexRelay(CODEX_RELAY_ID);
        return res.json({ ok: true });
      }
      if (typeof apiKey !== 'string' || !apiKey.trim() || typeof baseUrl !== 'string' || !baseUrl.trim()) {
        return res.status(400).json({ error: 'apiKey and baseUrl required' });
      }
      const { backups } = applyCodexRelay({
        providerId: CODEX_RELAY_ID,
        name: 'AO Relay',
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        model: typeof model === 'string' && model.trim() ? model.trim() : undefined,
      });
      return res.json({ ok: true, backups });
    } catch (err) {
      return res.status(500).json({ error: err?.message || String(err) });
    }
  }
  // 自定义供应商/远程清单供应商没有 KEY_ENV 项（没有专属 env 变量名），但仍然走
  // saved[provider] 这套存法 —— 跟已注册 provider 唯一的区别是"清空时不用去删
  // process.env"（因为压根没写过）。
  const isCustom = readCustomProviders(CUSTOM_PROVIDERS_FILE).some((p) => p.id === provider) || !!remoteProviderSpec(provider);
  const isKeyed = !!KEY_ENV[provider] || isCustom;
  if (!provider || (!isKeyed && provider !== 'ollama')) return res.status(400).json({ error: `unknown provider: ${provider || '(空)'}（引擎不认识该供应商——若刚更新过 AO 或重新构建，请重启引擎后重试）` });
  const saved = readKeys();
  // explicit clear (empty apiKey for keyed / empty model for ollama, nothing else)
  const clearing = isKeyed
    ? (typeof apiKey === 'string' && apiKey.trim() === '' && baseUrl == null && model == null)
    : (typeof model === 'string' && model.trim() === '' && baseUrl == null);
  if (clearing) {
    delete saved[provider];
    if (KEY_ENV[provider]) { delete process.env[KEY_ENV[provider].key]; if (KEY_ENV[provider].base) delete process.env[KEY_ENV[provider].base]; }
    else if (!isCustom) delete process.env.OLLAMA_BASE_URL;
    if (provider === 'claude-code') for (const envName of Object.values(CC_MODEL_ENVS)) delete process.env[envName];
  } else {
    saved[provider] = saved[provider] || {};
    if (typeof apiKey === 'string' && apiKey.trim()) saved[provider].apiKey = apiKey.trim();
    // 存进来的地址先规整（引号/尾斜杠/整条 curl 地址/缺协议）——粘贴出错是「配了 key 却连不上」的头号来源。
    // claude-code / gemini-cli 的中转地址是原样交给各自 CLI 的（不走我们的连接器），
    // 只做去空白/去尾斜杠这种无争议的清理，不动路径和 query。
    if (typeof baseUrl === 'string') {
      const raw = baseUrl.trim();
      saved[provider].baseUrl = !raw ? ''
        : CLI_PROVIDERS.includes(provider) ? raw.replace(/\/+$/, '')
        : normalizeBaseUrl(raw);
    }
    if (typeof model === 'string') saved[provider].model = model.trim();
    // Claude Code 模型映射（Sonnet/Opus/Haiku 档位 → 中转商实际模型）；传空串 = 清掉该档位
    if (provider === 'claude-code') {
      for (const field of ['sonnetModel', 'opusModel', 'haikuModel']) {
        const v = req.body[field];
        if (typeof v !== 'string') continue;
        if (v.trim()) saved[provider][field] = v.trim();
        else delete saved[provider][field];
      }
      if (typeof model === 'string' && !model.trim()) delete saved[provider].model;
    }
  }
  writeKeys(saved);
  applyKeys(saved);
  // 把规整后的地址回给前端：用户填 `.../v1/chat/completions`、实际存的是 `.../v1`，
  // 不回填的话输入框还显示原文，看着像没生效。
  res.json({ ok: true, baseUrl: saved[provider]?.baseUrl ?? '' });
});

// 系统 Claude Code「急救」：诊断/修复被别的软件（cc-switch 等）或手动写坏的全局
// ~/.claude/settings.json —— 假 token + 中转地址会顶掉官方登录导致整机 CLI 不可用。
// 跟 AO 的中转配置完全隔离：这里只做减法（删劫持 env 键），从不写入任何 token。
app.get('/api/claude/health', (_req, res) => {
  try {
    res.json(diagnoseClaudeConfig({ shellEnv: SHELL_ENV_SNAPSHOT }));
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});
app.post('/api/claude/repair', (_req, res) => {
  try {
    // 恢复官方登录的同时，把 macOS 当前系统代理（如 Clash）同步给 Claude Code，
    // 避免 GUI 正常而 CLI 因本地 DNS/TUN 路径不同出现 ECONNRESET。
    res.json({
      ok: true,
      ...restoreClaudeToOfficial({ shellEnv: SHELL_ENV_SNAPSHOT }),
      health: diagnoseClaudeConfig({ shellEnv: SHELL_ENV_SNAPSHOT }),
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// 系统 Claude Code「安全切换」：把选中中转 provider 写入全局 ~/.claude/settings.json，
// 让**任意终端**的 claude 直接用该中转（区别于 /api/config —— 那个只注入 AO 自己子进程的 env）。
// 安全：claude-apply 写前必备份、merge 保留用户其它配置、打 _aoManagedProvider 标记、绝不碰 .credentials.json。
app.get('/api/claude/status', (_req, res) => {
  try {
    res.json(readClaudeSwitchStatus());
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});
app.post('/api/claude/apply', (req, res) => {
  try {
    const b = req.body || {};
    const pid = b.providerId || b.provider;
    if (!pid) return res.status(400).json({ error: 'providerId 必填' });
    // 前端只需传 provider id —— base_url / key / 模型映射未显式传时，从已保存配置 + 注册表默认值解析。
    // key 存在服务端 web-keys.json，不经前端往返，更安全。
    const saved = readKeys()[pid] || {};
    const spec = API_PROVIDER_MAP[pid] || remoteProviderSpec(pid);
    const pickStr = (k, fallback) => (typeof b[k] === 'string' && b[k].trim() ? b[k].trim() : fallback);
    const baseUrl = pickStr('baseUrl', saved.baseUrl || spec?.defaultBaseUrl || '');
    const apiKey = pickStr('apiKey', saved.apiKey || '');
    if (typeof apiKey === 'string' && /[^\x20-\x7E]/.test(apiKey)) {
      return res.status(400).json({ error: 'API key 含中文/全角字符——通常是复制时把说明文字一起带上了，请只粘贴 key 本身' });
    }
    if (!baseUrl || !apiKey) {
      return res.status(400).json({ error: `缺少 ${pid} 的 base_url 或 API key —— 请先在服务商配置里填好再写入全局` });
    }
    const result = applyClaudeProvider({
      providerId: String(pid),
      baseUrl,
      apiKey,
      apiKeyField: b.apiKeyField === 'ANTHROPIC_API_KEY' ? 'ANTHROPIC_API_KEY' : undefined,
      model: pickStr('model', saved.model),
      sonnetModel: pickStr('sonnetModel', saved.sonnetModel),
      opusModel: pickStr('opusModel', saved.opusModel),
      haikuModel: pickStr('haikuModel', saved.haikuModel),
    });
    res.json({ ok: true, ...result, status: readClaudeSwitchStatus() });
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});
app.post('/api/claude/restore', (_req, res) => {
  try {
    // restoreClaudeToOfficial 会保留 OAuth，并自动同步 macOS 当前系统代理。
    res.json({ ok: true, ...restoreClaudeToOfficial({ shellEnv: SHELL_ENV_SNAPSHOT }), status: readClaudeSwitchStatus() });
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// 代理「可见 + 可管理」：写进 settings 的 HTTP(S)_PROXY 是个静态依赖（Clash 没开/换端口就连不上，
// 而劫持体检看不到）。这几个端点让它变成看得见（已配代理 + 是否可达 + 是否漂移）、可管理（更新/移除）。
app.get('/api/claude/proxy', async (_req, res) => {
  try {
    const st = readClaudeProxyStatus();
    const reachable = st.configured ? await probeProxyReachable(st.configured) : undefined;
    res.json({ ...st, ...(reachable !== undefined ? { reachable } : {}) });
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});
app.post('/api/claude/proxy/sync', (_req, res) => {
  try {
    res.json({ ok: true, ...syncClaudeProxy(detectSystemProxy()) });
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});
app.post('/api/claude/proxy/clear', (_req, res) => {
  try {
    res.json({ ok: true, ...clearClaudeProxy() });
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// ── 自定义供应商：新增 / 删除。编辑已有的连接信息(key/base_url/model)复用上面的
// POST /api/config —— 那条路已经认识自定义 provider id 了(见 isCustom 判断)。
app.post('/api/custom-providers', (req, res) => {
  const { id, name, note, homepageUrl, baseUrl, apiKey, model } = req.body || {};
  if (typeof id !== 'string' || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'id and name required' });
  }
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
    return res.status(400).json({ error: 'baseUrl required' });
  }
  if (typeof apiKey === 'string' && apiKey.trim() && /[^\x20-\x7E]/.test(apiKey)) {
    return res.status(400).json({ error: 'API key 含中文/全角字符——通常是复制时把旁边的说明文字一起带上了，请只粘贴 key 本身（重新复制或删掉多余字符）' });
  }
  const err = validateCustomProviderId(id, reservedProviderIds());
  const existing = readCustomProviders(CUSTOM_PROVIDERS_FILE);
  if (existing.some((p) => p.id === id)) {
    return res.status(400).json({ error: '这个标识已存在' });
  }
  if (err) return res.status(400).json({ error: err });
  addCustomProvider(CUSTOM_PROVIDERS_FILE, {
    id,
    name: name.trim(),
    note: typeof note === 'string' && note.trim() ? note.trim() : undefined,
    homepageUrl: typeof homepageUrl === 'string' && homepageUrl.trim() ? homepageUrl.trim() : undefined,
  });
  const saved = readKeys();
  saved[id] = {};
  if (typeof apiKey === 'string' && apiKey.trim()) saved[id].apiKey = apiKey.trim();
  saved[id].baseUrl = normalizeBaseUrl(baseUrl);
  if (typeof model === 'string' && model.trim()) saved[id].model = model.trim();
  writeKeys(saved);
  res.json({ ok: true });
});

// 更新自定义供应商的展示元数据（名称/备注/官网）；连接信息走 POST /api/config,id 不可改
app.put('/api/custom-providers/:id', (req, res) => {
  const { id } = req.params;
  if (!readCustomProviders(CUSTOM_PROVIDERS_FILE).some((p) => p.id === id)) {
    return res.status(404).json({ error: 'not found' });
  }
  const { name, note, homepageUrl } = req.body || {};
  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    return res.status(400).json({ error: 'name required' });
  }
  updateCustomProvider(CUSTOM_PROVIDERS_FILE, id, {
    name: typeof name === 'string' ? name : undefined,
    note: typeof note === 'string' ? note : undefined,
    homepageUrl: typeof homepageUrl === 'string' ? homepageUrl : undefined,
  });
  res.json({ ok: true });
});

app.delete('/api/custom-providers/:id', (req, res) => {
  const { id } = req.params;
  removeCustomProvider(CUSTOM_PROVIDERS_FILE, id);
  const saved = readKeys();
  delete saved[id];
  writeKeys(saved);
  res.json({ ok: true });
});

// ── Test a provider's key with a minimal real API call ──
// API key 只可能是可打印 ASCII——含中文/全角字符（复制时把说明文字一起带上了）时，
// undici 往 authorization 头塞会抛底层 ByteString 错误，用户完全看不懂。前置校验给人话。
const keyCharsetError = (key) => (typeof key === 'string' && /[^\x20-\x7E]/.test(key))
  ? 'API key 含中文/全角字符——通常是复制时把旁边的说明文字一起带上了，请只粘贴 key 本身（重新复制或删掉多余字符）'
  : null;

app.post('/api/test-provider', async (req, res) => {
  // apiKey/baseUrl/model 可由请求带入覆盖:配置页"填了就能测",不用先保存
  const { provider, apiKey: overrideKey, baseUrl: overrideBase, model: overrideModel } = req.body || {};
  const keyErr = keyCharsetError(overrideKey);
  if (keyErr) return res.json({ ok: false, error: keyErr });
  await getRemoteManifest();
  const isCustomProvider = readCustomProviders(CUSTOM_PROVIDERS_FILE).some((p) => p.id === provider) || !!remoteProviderSpec(provider);
  if (!provider || (!KEY_ENV[provider] && provider !== 'ollama' && !isCustomProvider)) return res.status(400).json({ ok: false, error: `unknown provider: ${provider || '(空)'}（引擎不认识该供应商——若刚更新过 AO 或重新构建，请重启引擎后重试）` });
  // 自定义供应商没有专属 env 变量名，key 只存在 saved[provider].apiKey 里。
  const key = provider === 'ollama' ? 'n/a'
    : ((typeof overrideKey === 'string' && overrideKey.trim()) || (KEY_ENV[provider] ? process.env[KEY_ENV[provider].key] : readKeys()[provider]?.apiKey));
  if (!key) return res.json({ ok: false, error: '未设置 API key' });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  const t0 = Date.now();
  try {
    if (provider === 'ollama') {
      const base = (readKeys().ollama?.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, '');
      const r = await fetch(`${base}/api/tags`, { signal: ctrl.signal });
      if (!r.ok) return res.json({ ok: false, error: `HTTP ${r.status}` });
      const j = await r.json().catch(() => ({}));
      const n = Array.isArray(j.models) ? j.models.length : 0;
      return res.json({ ok: true, latencyMs: Date.now() - t0, note: `${n} 个本地模型` });
    }
    let r;
    let hitUrl = '';   // 实际打到的地址（可能被跳转 / 换过 /v1 拼法）
    let baseUsed = ''; // 本次测试用的 base_url（规整后）
    let drift;         // 与用户填的 base_url 不一致时的说明
    if (provider === 'claude' || provider === 'claude-code' || ANTHROPIC_PROVIDER_MAP[provider]) {
      // 两条链路都走 Anthropic 原生协议（POST {base}/v1/messages），用 OpenAI 格式测会误报失败。
      //
      // claude（直连 API）以前在这里硬编码打 api.anthropic.com、无视用户配的 base_url ——
      // 自从 claude 支持自定义接入点（直连 Anthropic 协议中转商）后，那等于：用户按预设配好
      // 中转、点「测试连接」，却拿中转 key 去打官方端点必然 401，反过来怀疑自己配错了。
      // 现在两条链路共用同一套解析：优先用本次输入/已保存的地址，并复用跳转与 /v1 路径兜底。
      const saved = readKeys()[provider] || {};
      const anthSpec = ANTHROPIC_PROVIDER_MAP[provider];
      const rawBase = (typeof overrideBase === 'string' && overrideBase.trim()) || saved.baseUrl
        || (anthSpec ? (process.env[anthSpec.envBase] || anthSpec.defaultBaseUrl) : (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'));
      // 客户端会自己接 /v1/messages，所以 base 里多写的 /v1、/messages 要先削掉再测，
      // 否则测的是 /v1/v1/messages
      const base = normalizeAnthropicBaseUrl(rawBase);
      const baseHadSuffix = /\/(v\d+|messages)\/?$/i.test(String(rawBase).trim());
      // 中转商上架的模型名各不相同，优先用用户自己配的（含 Sonnet 档映射）
      const defaultModel = anthSpec?.defaultModel || (provider === 'claude' ? 'claude-3-5-haiku-20241022' : 'claude-sonnet-4-5-20250929');
      const model = (typeof overrideModel === 'string' && overrideModel.trim()) || saved.model || saved.sonnetModel || defaultModel;
      // 路径首选必须与真实客户端一致：Anthropic SDK / claude CLI 一律发 POST {base}/v1/messages。
      // 以前首选 {base}/messages，正确配置的中转反而会 404 后靠兜底命中，于是报出一条
      // 「地址与配置不一致，建议把 base_url 改成 .../v1/messages」的**错误建议** ——
      // 用户照做后客户端再接一次 /v1/messages，直接连不上。
      const post = await postApiEndpoint({
        baseUrl: base, path: 'v1/messages', signal: ctrl.signal,
        // 中转商认 x-api-key 或 Bearer 的都有，两个都带（对齐 CLI 的实际行为）
        headers: {
          'content-type': 'application/json', 'anthropic-version': '2023-06-01',
          'x-api-key': key, authorization: `Bearer ${key}`,
          'user-agent': 'claude-cli/2.1.161 (external, cli)',
        },
        body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
      });
      r = post.response;
      hitUrl = post.url;
      baseUsed = base;
      // 真实客户端自己接 /v1/messages：用户地址里多写的 /v1 或 /messages 这里虽已兼容，
      // 但对直接读这个地址的 claude CLI 会拼错，照实说清楚
      drift = post.drift || (baseHadSuffix ? `${String(rawBase).trim()} → ${base}（客户端会自己接 /v1/messages，地址里不用写）` : undefined);
    } else {
      // 每个 OpenAI 兼容 provider 的默认 base_url/模型都查 api-providers.ts 这张表 ——
      // 之前这里只对 deepseek 特判，其余(含 compshare/apinebula/agnes 等赞助商)会误用
      // OPENAI_BASE_URL + gpt-4o-mini 去测,对聚合商大概率 404。
      const saved = readKeys()[provider] || {};
      const spec = API_PROVIDER_MAP[provider];
      const remote = remoteProviderSpec(provider);
      const base = normalizeBaseUrl((typeof overrideBase === 'string' && overrideBase.trim()) || saved.baseUrl || (spec && process.env[spec.envBase]) || spec?.defaultBaseUrl || remote?.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1');
      const model = (typeof overrideModel === 'string' && overrideModel.trim()) || saved.model || spec?.defaultModel || remote?.defaultModel || 'gpt-4o-mini';
      // Azure OpenAI 用 api-key 头鉴权（Bearer 仅 AAD token 时有效）；Azure 及 o系列/gpt-5 推理模型只认
      // max_completion_tokens，且最小有效值不能是 1（会被推理吃光返回空/400），用 16。issue #99
      const isAzureBase = /\.azure\.com|azure/i.test(base);
      const isReasoning = /(?:^|[^a-z])(?:o[1-9]|gpt-5)/i.test(model);
      const useCompletionParam = isAzureBase || isReasoning;
      // 与连接器(openai-compatible.ts)运行时保持一致:始终带 Bearer,Azure 额外带 api-key
      // (Azure 常用 api-key,但 AAD token 场景仍需 Bearer)——避免"测试通过但运行失败"或反之。
      const headers = { 'content-type': 'application/json', authorization: `Bearer ${key}`, ...(isAzureBase ? { 'api-key': key } : {}) };
      // 与连接器同一份发送逻辑：跳转保持 POST（否则 301/302 会被降级成 GET → 上游回
      // 405 Method Not Allowed）、base_url 少写/多写 /v1 时自动试另一种拼法。
      const doTest = (field, val) => postChatCompletions({
        baseUrl: base, headers, signal: ctrl.signal, azure: isAzureBase,
        body: JSON.stringify({ model, [field]: val, messages: [{ role: 'user', content: 'hi' }] }),
      });
      let field = useCompletionParam ? 'max_completion_tokens' : 'max_tokens';
      let post = await doTest(field, useCompletionParam ? 16 : 1);
      // 参数名猜错时同连接器一样自动切另一个名字重试一次(双向;排除数值过大类 400)。issue #99
      if (post.response.status === 400) {
        const t = await post.response.clone().text().catch(() => '');
        const paramNameRejected = /max_(?:completion_)?tokens/i.test(t) && !/too large|too many|maximum|exceed|less than|greater than|must be|at most/i.test(t);
        if (paramNameRejected) {
          field = field === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens';
          post = await doTest(field, field === 'max_completion_tokens' ? 16 : 1);
        }
      }
      r = post.response;
      // 地址跟用户填的不一致（被跳转 / 换了 /v1 拼法）→ 测试即使通过也要告诉用户改配置，
      // 否则同一个坑会在别处（CLI、其它工具）再踩一次。
      hitUrl = post.url;
      baseUsed = base;
      drift = post.drift;
    }
    const latencyMs = Date.now() - t0;
    if (!r.ok) {
      // 上游报错多为 {"error":{"message":"..."}} JSON——抽出人读 message，
      // 别把整段原始 JSON 甩给用户（会被 UI 截断，只见半句）
      const txt = await r.text().catch(() => '');
      let msg = txt;
      try {
        const j = JSON.parse(txt);
        msg = j?.error?.message || j?.message || (typeof j?.error === 'string' ? j.error : txt);
      } catch { /* 非 JSON 原样透传 */ }
      // 405/404 这类「地址配错」光报状态码用户查不动 —— 带上实际请求地址和排查指引
      const hint = hitUrl ? endpointHint(r.status, hitUrl, baseUsed, drift) : '';
      return res.json({ ok: false, error: `HTTP ${r.status} ${String(msg).slice(0, 300)}${hint}` });
    }
    // 通过了但地址有漂移：提醒用户把 base_url 改成最终地址（CLI/其它工具没有这层兜底）
    return res.json({ ok: true, latencyMs, ...(drift ? { note: `已连通，但实际请求地址是 ${hitUrl}（${drift}）——建议把 base_url 改成这个最终地址` } : {}) });
  } catch (e) {
    return res.json({ ok: false, error: e?.name === 'AbortError' ? '超时（12s）' : (e?.message || String(e)) });
  } finally {
    clearTimeout(timer);
  }
});

// ── 文生图（创意库「一键生成」与任意直连出图共用）────────────────────────────
// 复用引擎的 generateImage：两种协议自动切换、报错口径与 type: image 步骤一致。
// 演示站没有后端 —— 前端自己降级提示，这里不用管。apiKey/baseUrl 可覆盖（"填了就能测"）。
app.post('/api/image/generate', async (req, res) => {
  const { provider, model, prompt, size, quality, apiKey: overrideKey, baseUrl: overrideBase } = req.body || {};
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) return res.status(400).json({ ok: false, error: '缺少提示词' });
  if (!model || typeof model !== 'string' || !model.trim()) {
    return res.status(400).json({ ok: false, error: '缺少图片模型：各家编码互不通用（如 gpt-image-2），配好 key 后可在供应商页「获取模型列表」查看' });
  }
  const keyErr = keyCharsetError(overrideKey);
  if (keyErr) return res.json({ ok: false, error: keyErr });
  try {
    const llm = buildLLMConfig(provider);
    const cfg = {
      ...llm,
      ...(overrideBase ? { base_url: normalizeBaseUrl(overrideBase) } : {}),
      ...(typeof overrideKey === 'string' && overrideKey.trim() ? { api_key: overrideKey.trim() } : {}),
      timeout: 300_000,   // 出图普遍 30-120s，别用文本那套短超时
    };
    const { generateImage } = await import('../dist/connectors/image.js');
    const img = await generateImage(cfg, prompt.trim(), {
      model: model.trim(),
      ...(typeof size === 'string' && size.trim() ? { size: size.trim() } : {}),
      ...(typeof quality === 'string' && quality.trim() ? { quality: quality.trim() } : {}),
    });
    // data URL 直接给前端 <img> 用；一张图几百 KB~几 MB，一次性响应可接受。
    // width/height 是从 PNG 头量出来的真实尺寸——各家把 size 当建议的不少（实测 LanoX），
    // 界面照实显示，用户才不会以为是自己参数写错了。
    res.json({
      ok: true,
      dataUrl: `data:image/png;base64,${img.buffer.toString('base64')}`,
      via: img.via,
      ...(img.width && img.height ? { width: img.width, height: img.height } : {}),
    });
  } catch (err) {
    // 引擎的报错本来就是给人看的（缺模型/两种协议都试过/CLI 不是图片端点），原样透传
    res.status(400).json({ ok: false, error: err?.message || String(err) });
  }
});

// ── 拉取供应商的真实可用模型列表（OpenAI 兼容 GET /models；claude 走 Anthropic 原生端点）──
// body 可带 baseUrl/apiKey 覆盖：add-custom 场景用户刚填了还没保存也能先拉列表。
app.post('/api/provider-models', async (req, res) => {
  const { provider, baseUrl: overrideBase, apiKey: overrideKey, protocol } = req.body || {};
  const keyErr = keyCharsetError(overrideKey);
  if (keyErr) return res.json({ ok: false, error: keyErr });
  await getRemoteManifest();
  const saved = provider ? (readKeys()[provider] || {}) : {};
  const spec = provider ? API_PROVIDER_MAP[provider] : null;
  const remote = provider ? remoteProviderSpec(provider) : null;
  // protocol:'anthropic' = Anthropic 兼容端点（claude-code 中转商），认证头用 x-api-key
  const isClaude = provider === 'claude' || protocol === 'anthropic' || !!ANTHROPIC_PROVIDER_MAP[provider];
  const base = normalizeBaseUrl(
    overrideBase || saved.baseUrl || (spec && process.env[spec.envBase]) || spec?.defaultBaseUrl || remote?.baseUrl ||
    (isClaude ? 'https://api.anthropic.com/v1' : '')
  );
  const key = overrideKey || saved.apiKey || (spec ? process.env[spec.envKey] : '') || (isClaude ? process.env.ANTHROPIC_API_KEY : '');
  if (!base) return res.status(400).json({ ok: false, error: 'baseUrl required' });
  // 模型公司官方 API 拉不到真实列表时（没配 key / 请求失败），退回 models.dev
  // 公开目录——比打包进前端的静态建议新得多（cc-switch 同款做法）。
  const modelsDevFallback = async (error) => {
    const list = await modelsDevList(provider);
    if (list) return res.json({ ok: true, models: list, source: 'models.dev' });
    return res.json({ ok: false, error });
  };
  // 不因缺 key 短路：不少聚合商（如 ModelVerse）的 /models 是公开接口，无鉴权也
  // 能拉全量目录——cc-switch 的大列表就是这么来的。有 key 带上，没 key 裸请求。
  const headers = isClaude
    ? { ...(key ? { 'x-api-key': key } : {}), 'anthropic-version': '2023-06-01' }
    : key ? { authorization: `Bearer ${key}` } : {};
  // 对齐 cc-switch：显式带 User-Agent。undici 默认不发 UA，部分端点的 WAF/UA 白名单会拦
  // 裸请求（cc-switch 实测 Kimi 等站点白名单只认 claude-cli/* 前缀；Anthropic 协议目标
  // 用它最稳），OpenAI 兼容目标用产品 UA（诚实标识，非伪装浏览器）。
  headers['user-agent'] = isClaude ? 'claude-cli/2.1.161 (external, cli)' : `agency-orchestrator/${PKG_VERSION}`;
  // 端点候选（对齐 cc-switch build_models_url_candidates 的顺序，避免多打一次必 404 的请求）：
  //  · base 已以版本段 /v{N} 结尾（如 /v1、智谱 /paas/v4）→ 版本号已在路径里，正确端点是 {base}/models；
  //    版本非 /v1 时再把 {base}/v1/models 作为兜底次候选。
  //  · base 是不带版本的根地址（用户照抄 CLI 中转端点常见）→ 先试 OpenAI 惯例的 {base}/v1/models，
  //    再把 {base}/models 作为兜底。
  // 404/405 时自动尝试下一个候选；其它状态（401/403 等换路径也没用）直接停。
  // joinEndpoint：base 带 query 时（Azure 的 ?api-version=）路径要接在 query 之前
  const basePath = base.split('?')[0];
  const withV1 = base.includes('?') ? `${basePath}/v1?${base.split('?').slice(1).join('?')}` : `${basePath}/v1`;
  const endsWithVersion = /\/v\d+$/.test(basePath);
  // · base 是 Anthropic 协议中转常见的「兼容层挂子路径」形态（/api/claudecode 等）→ 再补两个
  //   剥掉后缀打站点根的候选。这类中转两种布局都有：AICodeMirror 的 /models 就在子路径下
  //   （实测 /api/claudecode/v1/models 401=存在、根 /v1/models 是 404 页），也有把它只放在根上的。
  //   后缀清单直接对齐 cc-switch 的 KNOWN_COMPAT_SUFFIXES（同一批中转商，不另起一套口径）。
  const COMPAT_SUFFIXES = ['/api/claudecode', '/api/anthropic', '/apps/anthropic', '/api/coding', '/claudecode', '/anthropic', '/step_plan', '/coding', '/claude'];
  const compatRoot = (() => {
    const lower = basePath.toLowerCase();
    const hit = COMPAT_SUFFIXES.find((s) => lower.endsWith(s));
    if (!hit) return '';
    const root = basePath.slice(0, basePath.length - hit.length).replace(/\/+$/, '');
    // 剥完只剩协议头（如 https:/）说明整条路径就是后缀本身，不是"根 + 兼容层"，别乱猜
    return /^https?:\/\/[^/]+/.test(root) ? root : '';
  })();
  const withQuery = (u) => (base.includes('?') ? `${u}?${base.split('?').slice(1).join('?')}` : u);
  const candidates = [...new Set([
    ...(endsWithVersion
      ? (basePath.endsWith('/v1') ? [joinEndpoint(base, 'models')] : [joinEndpoint(base, 'models'), joinEndpoint(withV1, 'models')])
      : [joinEndpoint(withV1, 'models'), joinEndpoint(base, 'models')]),
    ...(compatRoot ? [joinEndpoint(withQuery(`${compatRoot}/v1`), 'models'), joinEndpoint(withQuery(compatRoot), 'models')] : []),
  ])];
  let lastErr = '';
  try {
    for (const url of candidates) {
      // 网络层瞬断（TLS 握手失败/连接重置等，实测部分聚合站 CDN 时好时坏）自动重试一次，
      // 对齐 cc-switch「多线路候选 + 重试」的容错思路；HTTP 有响应（哪怕 4xx/5xx）不重试。
      let r;
      for (let attempt = 0; attempt < 2 && !r; attempt++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 20000);
        try {
          r = await fetch(url, { signal: ctrl.signal, headers });
        } catch (e) {
          // fetch() 抛错时 undici 只给一句 'fetch failed'，真正原因在 e.cause（ENOTFOUND/
          // ECONNREFUSED/ETIMEDOUT/证书错误/连接重置…）。把 cause 一并带出，用户/日志才看得懂到底卡在哪。
          const cause = e?.cause?.code || e?.cause?.message || e?.cause;
          lastErr = e?.name === 'AbortError'
            ? '超时（20s）：该端点响应过慢或网络不通'
            : `${e?.message || String(e)}${cause ? `（${cause}）` : ''} · 端点 ${url}`;
          if (attempt === 0) await new Promise((ok) => setTimeout(ok, 800));
        } finally {
          clearTimeout(timer);
        }
      }
      if (!r) break;
      if (r.ok) {
        const j = await r.json().catch(() => ({}));
        const entries = Array.isArray(j.data) ? j.data : Array.isArray(j.models) ? j.models : [];
        const models = entries
          .map((m) => (typeof m === 'string' ? m : m?.id))
          .filter((id) => typeof id === 'string' && id)
          .sort();
        // 厂商归属优先用响应里的 owned_by/provider（对齐 cc-switch 的分组口径）——前端原本靠
        // 模型名猜厂商，对聚合商自造的编码（LanoX 的 gpt-5.6-sol 这类）迟早猜不准。
        // 但 owned_by 常被填成中转站自己的占位值（LanoX 文档：未配 provider 时是
        // api-transfer-server），那种拿来当分组标题还不如猜的准 —— 过滤掉，让前端回退到推断。
        const PLACEHOLDER_OWNER = /^(api[-_]?transfer[-_]?server|organization[-_]|system|user|custom|unknown|default)/i;
        const vendors = {};
        for (const m of entries) {
          if (!m || typeof m.id !== 'string') continue;
          const owner = typeof m.owned_by === 'string' && m.owned_by.trim() ? m.owned_by.trim()
            : typeof m.provider === 'string' && m.provider.trim() ? m.provider.trim() : '';
          if (owner && !PLACEHOLDER_OWNER.test(owner)) vendors[m.id] = owner;
        }
        if (models.length) return res.json({ ok: true, models, ...(Object.keys(vendors).length ? { vendors } : {}) });
        lastErr = 'empty model list';
        break;
      }
      const txt = (await r.text().catch(() => '')).slice(0, 200);
      lastErr = `HTTP ${r.status} ${txt}`;
      // 404/405 = 该路径不对/不支持 GET，换下一个候选；401/403 等换路径也没用，直接停（对齐 cc-switch）
      if (r.status !== 404 && r.status !== 405) break;
    }
    // 代理变量设了但 Node 的 fetch 不走它 —— 拉不到模型列表时最常见的「其实不是我们的问题」
    const proxyNote = /fetch failed|CONNECT_TIMEOUT|ENOTFOUND|ECONNREFUSED|超时/i.test(lastErr) ? envProxyHint() : '';
    const withProxy = proxyNote ? `${lastErr}\n${proxyNote}` : lastErr;
    return await modelsDevFallback(!key && /HTTP 40[13]/.test(lastErr) ? `未设置 API key（${withProxy}）` : withProxy);
  } catch (e) {
    return await modelsDevFallback(e?.message || String(e));
  }
});

// ── 从本机 cc-switch 一键导入已配供应商的 key ──────────────────────────────
// cc-switch 桌面版把各家中转商的 key 存在 ~/.cc-switch/cc-switch.db（SQLite，v3.10+）。
// 很多用户在 cc-switch 里已配好 key —— 与其让他复制粘贴一遍，不如一键导入。这等价于
// cc-switch 自家的 ccswitch:// 深链接「URL 直接带 key 导入」思路，只是数据源换成本机已有
// 配置。只读访问（-readonly），绝不写 cc-switch 的库；key 原文不出服务端，前端只见脱敏预览。
// 读库用系统 sqlite3 CLI（macOS/多数 Linux 自带；缺失则整个功能静默隐藏，不影响其它）。
function readCcSwitchProviders() {
  const db = join(homedir(), '.cc-switch', 'cc-switch.db');
  if (!existsSync(db)) return null;
  let rows;
  try {
    const out = execFileSync('sqlite3', ['-json', '-readonly', db,
      'SELECT app_type, name, website_url, settings_config, is_current FROM providers'], { timeout: 5000 }).toString();
    rows = out.trim() ? JSON.parse(out) : [];
  } catch { return null; }
  const list = [];
  for (const row of rows) {
    let cfg; try { cfg = JSON.parse(row.settings_config || '{}'); } catch { continue; }
    const env = cfg?.env && typeof cfg.env === 'object' ? cfg.env : {};
    const key = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY || env.GEMINI_API_KEY || '';
    if (!key || typeof key !== 'string') continue; // 官方登录/无 key 的条目（如 Claude Official）跳过
    const baseUrl = env.ANTHROPIC_BASE_URL || env.OPENAI_BASE_URL || env.GEMINI_BASE_URL || '';
    list.push({
      id: `${row.app_type}:${row.name}`,
      name: row.name,
      appType: row.app_type,
      baseUrl,
      keyPreview: key.length > 10 ? `${key.slice(0, 6)}…${key.slice(-4)}` : `${key.slice(0, 2)}…`,
      isCurrent: !!row.is_current,
      _key: key, // 内部字段：仅服务端使用，响应前剥除
    });
  }
  return list;
}

// 列出 cc-switch 里可导入的条目（key 只回脱敏预览）
app.get('/api/ccswitch-providers', (_req, res) => {
  const list = readCcSwitchProviders();
  if (!list) return res.json({ ok: false });
  res.json({ ok: true, providers: list.map(({ _key, ...pub }) => pub) });
});

// 把选中条目的 key 写入 AO 的目标 provider（key 全程留在服务端，不经过浏览器）。
// includeBaseUrl 默认不带：cc-switch 存的是 Anthropic 协议根地址（如 api.modelverse.cn），
// 与 AO 云端 API 供应商的 OpenAI 兼容 /v1 端点语义不同，盲导会把聊天打挂；
// 只有 claude-code 中转这类同语义目标才由前端显式传 true。
app.post('/api/ccswitch-import', (req, res) => {
  const { source, provider, includeBaseUrl } = req.body || {};
  if (!source || !provider) return res.status(400).json({ error: 'source and provider required' });
  const list = readCcSwitchProviders();
  const entry = list?.find((x) => x.id === source);
  if (!entry) return res.status(404).json({ error: 'cc-switch entry not found' });
  const keys = readKeys();
  keys[provider] = { ...(keys[provider] || {}), apiKey: entry._key, ...(includeBaseUrl && entry.baseUrl ? { baseUrl: entry.baseUrl } : {}) };
  writeKeys(keys);
  applyKeys(keys);
  res.json({ ok: true, keyPreview: entry.keyPreview });
});

// 引擎代码热更新检测：进程启动后若 server.js / dist（注册表、CLI）被重新构建，
// 内存里跑的仍是旧代码——会出现"前端认识新供应商、引擎报 unknown provider"、
// 新端点 404 之类的版本漂移谜题。health 带上 stale 标记，前端据此提示重启引擎。
//
// **判据是内容变了，不是文件被碰过**：只看 mtime 会把 git 的每一次改写都当成漂移
// （切分支、merge、rebase、stash 都会重写文件并刷新 mtime，内容却可能一字未变——
// 本轮合并 main 后就误报了一次）。一个"切个分支就喊重启"的警报，喊几次之后就没人
// 信了，而它要防的恰恰是那种最难自证的故障。所以 mtime 只当**便宜的门**：先看时间，
// 时间变了才去算哈希，哈希不同才算真漂移。稳态下（绝大多数轮询）一次哈希都不算。
const BOOT_TIME = Date.now();
const STALE_PROBES = [
  join(__dirname, 'server.js'),
  join(ROOT, 'dist', 'connectors', 'api-providers.js'),
  CLI,
];
const fileFingerprint = (f) => {
  try { return createHash('sha1').update(readFileSync(f)).digest('hex'); } catch { return null; }
};
// 启动时的内容指纹（探针文件不存在就记 null——之后凭空出现同样算漂移）
const BOOT_FINGERPRINTS = new Map(STALE_PROBES.map((f) => [f, fileFingerprint(f)]));
const isEngineStale = () => STALE_PROBES.some((f) => {
  let touched;
  try { touched = statSync(f).mtimeMs > BOOT_TIME; } catch { return false; }
  if (!touched) return false;                       // 没被碰过：直接过，不读文件
  return fileFingerprint(f) !== BOOT_FINGERPRINTS.get(f);
});
// 新版本感知：桌面端没有自动更新（mac 无签名装不了 electron-updater），装机量会
// 永远停在装机那天的版本——至少要让界面知道"外面有新版"。6h 缓存 + 3s 超时 +
// 失败静默（离线/内网环境不该看到任何报错），health 每 5s 被轮询，绝不能阻塞。
let latestVersionCache = { v: null, at: 0 };
async function getLatestVersion() {
  const now = Date.now();
  if (now - latestVersionCache.at < 6 * 60 * 60 * 1000) return latestVersionCache.v;
  latestVersionCache.at = now; // 先占位：失败也 6h 内不再重试
  try {
    const r = await fetch('https://registry.npmjs.org/agency-orchestrator/latest', { signal: AbortSignal.timeout(3000) });
    if (r.ok) latestVersionCache.v = (await r.json()).version ?? null;
  } catch { /* 离线环境静默 */ }
  return latestVersionCache.v;
}
app.get('/api/health', async (_req, res) => res.json({ ok: true, version: PKG_VERSION, stale: isEngineStale(), latest: await getLatestVersion() }));

// SPA fallback: serve the React app for any non-API, non-asset route.
// 故意「无条件」注册：即便启动时前端缺失（HAS_NEW_UI=false），也要给一个可读的诊断页，
// 而不是白屏 / 抛 send 的晦涩 NotFoundError（见 #81：AppImage 里 website/dist 没打进去）。
app.get(/^(?!\/api\/).*/, (req, res, next) => {
  if (req.method !== 'GET') return next();
  const indexHtml = join(WEBSITE_DIST, 'index.html');
  // 请求期再查一次：打包遗漏 / 文件被删时不让 res.sendFile 抛栈，直接给排查指引。
  if (!existsSync(indexHtml)) {
    res.status(503).type('html').send(
      `<!doctype html><meta charset="utf-8">` +
      `<title>Agency Orchestrator — 前端未就绪</title>` +
      `<div style="font-family:system-ui;max-width:640px;margin:10vh auto;padding:0 24px;line-height:1.7">` +
      `<h2>⚠️ Studio 前端产物缺失</h2>` +
      `<p>服务已启动，但找不到前端文件 <code>${indexHtml}</code>。</p>` +
      `<p>若你是<strong>桌面端</strong>用户：这是打包产物不完整（已知问题 #81），请下载更新后的版本；` +
      `临时可改用网页版 <code>npm i -g agency-orchestrator &amp;&amp; ao web</code>。</p>` +
      `<p>若你是<strong>从源码运行</strong>：请先执行 <code>npm run build:studio</code> 生成前端再重启。</p>` +
      `</div>`
    );
    return;
  }
  res.sendFile(indexHtml);
});

app.listen(PORT, HOST, () => {
  const ui = HAS_NEW_UI ? 'Web Studio' : 'web UI (legacy)';
  console.log(`🌐 agency-orchestrator ${ui}: http://${HOST}:${PORT}`);
  // 把解析到的前端路径打出来，前端缺失类问题（#81）一眼可查。
  if (!HAS_NEW_UI) console.warn(`⚠️  未找到 React 前端产物：${join(WEBSITE_DIST, 'index.html')}（将回退 legacy UI / 诊断页）`);
});
