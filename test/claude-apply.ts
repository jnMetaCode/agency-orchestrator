/**
 * 测试 Claude Code 全局安全切换写入器（claude-apply）。
 * 全程走 AO_CLAUDE_DIR 沙箱临时目录，绝不触碰真实 ~/.claude。
 */
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyClaudeProvider,
  readClaudeSwitchStatus,
  restoreClaudeToOfficial,
  AO_MANAGED_KEY,
} from '../src/utils/claude-apply.js';
import { diagnoseClaudeConfig } from '../src/utils/claude-repair.js';

let passed = 0, failed = 0;
function assert(c: boolean, m: string): void { if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; } }

console.log('\n─── Claude 全局安全切换 (claude-apply) ───');

const sandbox = mkdtempSync(join(tmpdir(), 'ao-claude-test-'));
const savedDir = process.env.AO_CLAUDE_DIR;
process.env.AO_CLAUDE_DIR = sandbox;
const settings = join(sandbox, 'settings.json');
const readSettings = (): any => JSON.parse(readFileSync(settings, 'utf-8'));
const backupCount = () => readdirSync(sandbox).filter((f) => f.includes('.ao-backup-')).length;

const cfg = {
  providerId: 'apinebula',
  baseUrl: 'https://relay.example.com',
  apiKey: 'sk-test-123456789',
  sonnetModel: 'claude-sonnet-5',
  opusModel: 'claude-opus-4-8',
};

try {
  // 1) 空目录首次 apply：新建 settings.json，写入 env 键 + 标记，无备份（原文件不存在）
  const r1 = applyClaudeProvider(cfg);
  assert(existsSync(settings), '首次 apply：settings.json 已创建');
  assert(r1.backup === null, '首次 apply：无备份（原文件不存在）');
  {
    const s = readSettings();
    assert(s.env.ANTHROPIC_BASE_URL === cfg.baseUrl, 'env.ANTHROPIC_BASE_URL 写入正确');
    assert(s.env.ANTHROPIC_AUTH_TOKEN === cfg.apiKey, '默认写入 ANTHROPIC_AUTH_TOKEN');
    assert(s.env.ANTHROPIC_DEFAULT_SONNET_MODEL === cfg.sonnetModel, 'sonnet 模型映射写入');
    assert(s.env.ANTHROPIC_DEFAULT_OPUS_MODEL === cfg.opusModel, 'opus 模型映射写入');
    assert(s[AO_MANAGED_KEY] === 'apinebula', 'AO 管理标记已写入顶层');
  }

  // 2) 已有用户配置时 apply：merge 保留其它内容，且生成备份
  writeFileSync(settings, JSON.stringify({
    permissions: { allow: ['Bash'] },
    model: 'sonnet',
    env: { FOO: 'bar' },
  }, null, 2), 'utf-8');
  const before = backupCount();
  const r2 = applyClaudeProvider({ ...cfg, providerId: 'ccsub', apiKeyField: 'ANTHROPIC_API_KEY' });
  assert(r2.backup !== null, '已有文件 apply：生成了备份');
  assert(backupCount() === before + 1, '备份文件数 +1');
  {
    const s = readSettings();
    assert(s.permissions?.allow?.[0] === 'Bash', 'merge：保留用户 permissions');
    assert(s.model === 'sonnet', 'merge：保留用户顶层 model');
    assert(s.env.FOO === 'bar', 'merge：保留用户 env.FOO');
    assert(s.env.ANTHROPIC_API_KEY === cfg.apiKey, 'apiKeyField=ANTHROPIC_API_KEY 生效');
    assert(s.env.ANTHROPIC_AUTH_TOKEN === undefined, '未误写 ANTHROPIC_AUTH_TOKEN');
    assert(s[AO_MANAGED_KEY] === 'ccsub', '标记更新为 ccsub');
  }

  // 3) 状态读回
  {
    const st = readClaudeSwitchStatus();
    assert(st.managed === true, '状态：managed=true');
    assert(st.managedProviderId === 'ccsub', '状态：managedProviderId=ccsub');
    assert(st.baseUrl === cfg.baseUrl, '状态：baseUrl 正确');
    assert(st.active === true, '状态：active=true');
  }

  // 4) 一键切回官方：删中转 env 键 + 标记，保留用户其它配置
  const rr = restoreClaudeToOfficial({ detectSystemProxy: false });
  assert(rr.changed === true, '切回官方：有改动');
  assert(rr.removedAoMarker === true, '切回官方：移除了 AO 标记');
  {
    const s = readSettings();
    assert(s.env?.ANTHROPIC_BASE_URL === undefined, '切回官方：ANTHROPIC_BASE_URL 已删');
    assert(s.env?.ANTHROPIC_API_KEY === undefined, '切回官方：中转 key 已删');
    assert(s.env?.FOO === 'bar', '切回官方：保留用户 env.FOO');
    assert(s.permissions?.allow?.[0] === 'Bash', '切回官方：保留用户 permissions');
    assert(s[AO_MANAGED_KEY] === undefined, '切回官方：AO 标记已清除');
  }

  // 4b) 一键切回可同步当前系统 HTTP 代理，避免浏览器正常而 Claude CLI 走坏 DNS/TUN。
  applyClaudeProvider(cfg);
  const proxyUrl = 'http://127.0.0.1:7890';
  const withProxy = restoreClaudeToOfficial({ proxyUrl });
  {
    const s = readSettings();
    assert(withProxy.proxySync.configured === true, '切回官方：检测并同步系统代理');
    assert(s.env.HTTP_PROXY === proxyUrl, '切回官方：HTTP_PROXY 写入正确');
    assert(s.env.HTTPS_PROXY === proxyUrl, '切回官方：HTTPS_PROXY 写入正确');
    assert(s.env.ANTHROPIC_BASE_URL === undefined, '切回官方 + 代理：中转地址仍已清除');
  }
  {
    const st = readClaudeSwitchStatus();
    assert(st.managed === false && st.active === false, '切回后状态：未管理、未激活');
  }

  // 5) OAuth 安全：绝不触碰 .credentials.json
  const cred = join(sandbox, '.credentials.json');
  writeFileSync(cred, '{"oauthAccount":"real-login"}', 'utf-8');
  const credBefore = readFileSync(cred, 'utf-8');
  applyClaudeProvider(cfg);
  restoreClaudeToOfficial({ detectSystemProxy: false });
  assert(readFileSync(cred, 'utf-8') === credBefore, 'OAuth 安全：.credentials.json 全程未被触碰');

  // 6) 解析失败保护：坏 JSON 时 apply 抛错且不覆写
  writeFileSync(settings, '{ this is not valid json', 'utf-8');
  const broken = readFileSync(settings, 'utf-8');
  let threw = false;
  try { applyClaudeProvider(cfg); } catch { threw = true; }
  assert(threw === true, '坏 JSON：apply 抛错');
  assert(readFileSync(settings, 'utf-8') === broken, '坏 JSON：原文件未被覆写');

  // 7) shellEnv 可注入：Studio 服务端传「applyKeys 之前」的快照，避免把 AO 自己注入到
  //    本进程的 ANTHROPIC_* 误判成用户 ~/.zshrc 里的劫持残留。
  writeFileSync(settings, JSON.stringify({ theme: 'dark' }, null, 2), 'utf-8');
  const savedToken = process.env.ANTHROPIC_AUTH_TOKEN;
  process.env.ANTHROPIC_AUTH_TOKEN = 'sk-injected-by-ao';   // 模拟 applyKeys 的自注入
  try {
    const dirty = diagnoseClaudeConfig();                    // 默认读 process.env（CLI 语义）
    assert(dirty.healthy === false, '默认（process.env）：自注入的键会被算作 shell 残留');

    const clean = diagnoseClaudeConfig({ shellEnv: {} });    // 服务端传空快照 = 用户 shell 干净
    assert(clean.healthy === true, 'shellEnv 快照：settings 干净时体检为绿');
    assert(Object.keys(clean.shellOverrides).length === 0, 'shellEnv 快照：不报 shell 残留');
    assert(clean.baseUrl === undefined, 'shellEnv 快照：不把自注入的 base_url 报成被改道');

    // 用户 shell 里真有残留时（快照里有），照样要报出来
    const real = diagnoseClaudeConfig({ shellEnv: { ANTHROPIC_BASE_URL: 'https://evil.example.com' } });
    assert(real.healthy === false && real.baseUrl === 'https://evil.example.com', 'shellEnv 快照：真 shell 残留仍报红');

    // repair 的 shellOverridesRemaining 同样跟着快照走（含 restore 的透传）
    applyClaudeProvider(cfg);
    const rr7 = restoreClaudeToOfficial({ detectSystemProxy: false, shellEnv: {} });
    assert(rr7.shellOverridesRemaining.length === 0, 'restore 透传 shellEnv：不谎报需手动删 .zshrc');
    const rr8 = restoreClaudeToOfficial({ detectSystemProxy: false });
    assert(rr8.shellOverridesRemaining.includes('ANTHROPIC_AUTH_TOKEN'), 'restore 不传时仍按 process.env 报（CLI 语义不变）');
  } finally {
    if (savedToken === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
    else process.env.ANTHROPIC_AUTH_TOKEN = savedToken;
  }

} finally {
  rmSync(sandbox, { recursive: true, force: true });
  if (savedDir === undefined) delete process.env.AO_CLAUDE_DIR;
  else process.env.AO_CLAUDE_DIR = savedDir;
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
