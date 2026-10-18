/**
 * 写 ~/.codex 的两条路径（applyCodexRelay / clearCodexRelay）。
 *
 * 这两个文件里装着用户的 Codex 登录态：`auth.json` 除了 `OPENAI_API_KEY` 还有 OAuth tokens。
 * 以前 clear 那条**一个备份都不留**，而且解析失败时按空文件处理——手改坏过 config.toml 的人
 * 点一下「切回官方」，整份配置连同登录态就没了，且无从恢复。
 */
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { parse, stringify } from 'smol-toml';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; }
}

const sandbox = mkdtempSync(join(tmpdir(), 'ao-codex-'));
const previousDir = process.env.AO_CODEX_DIR;
process.env.AO_CODEX_DIR = sandbox;
const { applyCodexRelay, clearCodexRelay, readCodexRelayStatus } = await import(`../src/utils/codex-relay.js?t=${Date.now()}`);
const dir = sandbox;
const toml = join(dir, 'config.toml');
const auth = join(dir, 'auth.json');

try {
  console.log('\n─── 正常写入 / 清除 ───');
  applyCodexRelay({ providerId: 'ao-relay', name: 'AO', baseUrl: 'https://x/v1', apiKey: 'sk-1' });
  assert(readFileSync(toml, 'utf-8').includes('ao-relay'), '写进了 config.toml');
  assert(readCodexRelayStatus('ao-relay').managed && !readCodexRelayStatus('ao-relay').conflict, '新配置状态读回为受管且无冲突');
  assert(JSON.parse(readFileSync(auth, 'utf-8')).OPENAI_API_KEY === 'sk-1', '写进了 auth.json');
  if (process.platform !== 'win32') {
    assert((statSync(auth).mode & 0o777) === 0o600, `凭证文件权限 0600（实际 ${(statSync(auth).mode & 0o777).toString(8)}）`);
  }
  // 用户自己的其它内容必须留着
  writeFileSync(auth, JSON.stringify({ OPENAI_API_KEY: 'sk-1', tokens: { refresh: 'r1' } }, null, 2), 'utf-8');
  clearCodexRelay('ao-relay');
  const after = JSON.parse(readFileSync(auth, 'utf-8'));
  assert(after.OPENAI_API_KEY === undefined && after.tokens?.refresh === 'r1', '清除只删 key，OAuth tokens 原样留着');
  assert(readdirSync(dir).some((f) => f.includes('.ao-backup-')), '清除也留了备份（以前这条路径一个备份都不留）');

  console.log('\n─── config.toml 解析不了时：停手，别把配置覆盖成空的 ───');
  writeFileSync(toml, 'this is [not valid toml', 'utf-8');
  writeFileSync(auth, JSON.stringify({ tokens: { refresh: 'r2' } }, null, 2), 'utf-8');
  const before = readFileSync(toml, 'utf-8');
  let msg = '';
  try { clearCodexRelay('ao-relay'); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
  assert(/解析失败/.test(msg) && /不动它/.test(msg), `当场报错并说清（实际：${msg.slice(0, 60)}）`);
  assert(readFileSync(toml, 'utf-8') === before, '坏掉的 config.toml 原样没动');
  assert(JSON.parse(readFileSync(auth, 'utf-8')).tokens?.refresh === 'r2', 'auth.json 里的登录态也没被顺手清掉');

  let msg2 = '';
  try { applyCodexRelay({ providerId: 'ao-relay', name: 'AO', baseUrl: 'https://x/v1', apiKey: 'sk-2' }); }
  catch (e) { msg2 = e instanceof Error ? e.message : String(e); }
  assert(/解析失败/.test(msg2), 'apply 同样停手（它以前会把坏文件当空的、写出一份只剩中转的配置）');

  console.log('\n─── 双文件预检与所有权 ───');
  const originalToml = '# keep original bytes\nmodel_provider = "other"\n';
  writeFileSync(toml, originalToml);
  for (const broken of ['{broken', 'null', '[]', '"text"']) {
    writeFileSync(auth, broken);
    let threw = false;
    try { applyCodexRelay({ providerId: 'ao-relay', name: 'AO', baseUrl: 'https://x/v1', apiKey: 'sk-2' }); }
    catch { threw = true; }
    assert(threw && readFileSync(toml, 'utf-8') === originalToml && readFileSync(auth, 'utf-8') === broken,
      `auth 非法时两份配置保持原样（${broken}）`);
  }
  const otherAuth = JSON.stringify({ OPENAI_API_KEY: 'other-key', tokens: { refresh: 'r3' } });
  writeFileSync(auth, otherAuth);
  const backupCount = readdirSync(dir).filter(f => f.includes('.ao-backup-')).length;
  clearCodexRelay('ao-relay');
  assert(readFileSync(toml, 'utf-8') === originalToml && readFileSync(auth, 'utf-8') === otherAuth,
    '清理非当前 provider 不修改其配置或 key');
  assert(readdirSync(dir).filter(f => f.includes('.ao-backup-')).length === backupCount, '无改动不新增备份');
  writeFileSync(toml, 'model_provider = "ao-relay"\n');
  writeFileSync(auth, '{broken');
  let clearFailed = false;
  try { clearCodexRelay('ao-relay'); } catch { clearFailed = true; }
  assert(clearFailed && readFileSync(toml, 'utf-8') === 'model_provider = "ao-relay"\n',
    'clear 也先校验 auth，失败不能先改 TOML');

  console.log('\n─── 第二份文件提交失败时回滚 ───');
  const rename = fs.renameSync;
  for (const existed of [true, false]) {
    if (existed) writeFileSync(toml, originalToml); else rmSync(toml, { force: true });
    writeFileSync(auth, otherAuth);
    let injected = false;
    fs.renameSync = (from, to) => {
      if (String(to) === auth && !injected) { injected = true; throw new Error('injected auth rename failure'); }
      return rename(from, to);
    };
    syncBuiltinESMExports();
    let threw = false;
    try { applyCodexRelay({ providerId: 'ao-relay', name: 'AO', baseUrl: 'https://x/v1', apiKey: 'sk-2' }); }
    catch { threw = true; }
    finally { fs.renameSync = rename; syncBuiltinESMExports(); }
    assert(injected && threw, '第二次 rename 故障向调用者报告失败');
    assert(existed ? readFileSync(toml, 'utf-8') === originalToml : !existsSync(toml),
      existed ? '已有 TOML 精确恢复含注释原文' : '首次创建的 TOML 在失败后移除');
    assert(readFileSync(auth, 'utf-8') === otherAuth, '原 auth 保持原样');
    assert(!readdirSync(dir).some(f => f.endsWith('.ao-tmp')), '失败后无残留临时凭据文件');
  }
  writeFileSync(auth, otherAuth);
  applyCodexRelay({ providerId: 'ao-relay', name: 'AO', baseUrl: 'https://x/v1', apiKey: 'other-key' });
  const activeToml = readFileSync(toml, 'utf-8');
  const activeAuth = readFileSync(auth, 'utf-8');
  let injected = false;
  fs.renameSync = (from, to) => {
    if (String(to) === auth && !injected) { injected = true; throw new Error('injected clear failure'); }
    return rename(from, to);
  };
  syncBuiltinESMExports();
  let failedClear = false;
  try { clearCodexRelay('ao-relay'); } catch { failedClear = true; }
  finally { fs.renameSync = rename; syncBuiltinESMExports(); }
  assert(injected && failedClear && readFileSync(toml, 'utf-8') === activeToml && readFileSync(auth, 'utf-8') === activeAuth,
    'clear 第二份提交失败同样精确回滚');

  // 回滚也可能遇到磁盘/权限错误，必须明确暴露需人工恢复及备份位置。
  let authFailed = false;
  fs.renameSync = (from, to) => {
    if (String(to) === auth) { authFailed = true; throw new Error('injected auth failure'); }
    if (String(to) === toml && authFailed) throw new Error('injected rollback failure');
    return rename(from, to);
  };
  syncBuiltinESMExports();
  let recoveryMessage = '';
  try { applyCodexRelay({ providerId: 'ao-relay', name: 'AO', baseUrl: 'https://changed.invalid/v1', apiKey: 'sk-2' }); }
  catch (e) { recoveryMessage = e instanceof Error ? e.message : String(e); }
  finally { fs.renameSync = rename; syncBuiltinESMExports(); }
  assert(/回滚未完成/.test(recoveryMessage) && recoveryMessage.includes('.ao-backup-'), '回滚失败明确提示备份恢复路径');
  assert(!readdirSync(dir).some(f => f.endsWith('.ao-tmp')), '回滚失败仍清理临时文件');
  clearCodexRelay('unrelated'); // Next write operation recovers the interrupted rollback before doing anything else.
  assert(!existsSync(join(dir, '.ao-config-transaction.json')) && readFileSync(toml, 'utf-8') === activeToml,
    '下次操作自动恢复未完成的回滚');
  clearCodexRelay('ao-relay');

  console.log('\n─── 精确恢复受管字段与外部冲突 ───');
  const originalProvider = { name: 'preexisting', base_url: 'https://original.invalid/v1', wire_api: 'responses' };
  writeFileSync(toml, stringify({ model_provider: 'original', model: 'original-model', model_providers: { 'ao-relay': originalProvider }, features: { keep: true } }));
  writeFileSync(auth, JSON.stringify({ OPENAI_API_KEY: 'original-key', tokens: { refresh: 'old-token' } }));
  applyCodexRelay({ providerId: 'ao-relay', name: 'AO', baseUrl: 'https://x/v1', apiKey: 'managed-key', model: 'managed-model' });
  if (process.platform !== 'win32') assert((statSync(join(dir, '.ao-relay-state.json')).mode & 0o777) === 0o600, '字段恢复记录权限 0600');
  // Unrelated edits should survive the rollback to the pre-AO configuration.
  const edited = parse(readFileSync(toml, 'utf-8')) as Record<string, any>;
  edited.features.addedExternally = true;
  writeFileSync(toml, stringify(edited));
  writeFileSync(auth, JSON.stringify({ OPENAI_API_KEY: 'managed-key', tokens: { refresh: 'new-token' } }));
  applyCodexRelay({ providerId: 'second', name: 'Second', baseUrl: 'https://second.invalid/v1', apiKey: 'second-key' });
  assert(parse(readFileSync(toml, 'utf-8')).model === 'original-model', '跨供应商不指定模型时恢复原模型，不携带上家映射');
  clearCodexRelay('second');
  const restored = parse(readFileSync(toml, 'utf-8')) as Record<string, any>;
  const restoredAuth = JSON.parse(readFileSync(auth, 'utf-8'));
  assert(restored.model_provider === 'original' && restored.model === 'original-model', '恢复切换前的 provider 和模型');
  assert(JSON.stringify(restored.model_providers['ao-relay']) === JSON.stringify(originalProvider) && !restored.model_providers.second, '恢复原 provider 表，移除本次新增表');
  assert(restored.features.keep && restored.features.addedExternally && restoredAuth.tokens.refresh === 'new-token', '保留期间新增配置与更新过的 OAuth');
  assert(restoredAuth.OPENAI_API_KEY === 'original-key', '恢复原 API key，而非直接删除');
  assert(!existsSync(join(dir, '.ao-relay-state.json')), '完成恢复后移除受管记录');

  applyCodexRelay({ providerId: 'ao-relay', name: 'AO', baseUrl: 'https://x/v1', apiKey: 'managed-key' });
  const keyEdited = JSON.stringify({ OPENAI_API_KEY: 'external-key', tokens: { refresh: 'new-token' } });
  writeFileSync(auth, keyEdited);
  assert(readCodexRelayStatus('ao-relay').conflict && !readCodexRelayStatus('ao-relay').managed, '同端点下凭据漂移也能在状态查询中识别');
  const beforeConflict = readFileSync(toml, 'utf-8');
  for (const operation of [() => clearCodexRelay('ao-relay'), () => applyCodexRelay({ providerId: 'ao-relay', name: 'AO', baseUrl: 'https://new.invalid', apiKey: 'next-key' })]) {
    let message = '';
    try { operation(); } catch (e) { message = String(e); }
    assert(/外部修改/.test(message) && readFileSync(auth, 'utf-8') === keyEdited && readFileSync(toml, 'utf-8') === beforeConflict,
      '同 provider 下 key 被外部修改：切换/清理均拒绝覆盖');
    assert(!message.includes('external-key') && !message.includes('managed-key'), '冲突错误不泄露凭据');
  }
  writeFileSync(auth, JSON.stringify({ OPENAI_API_KEY: 'managed-key', tokens: { refresh: 'new-token' } }));
  clearCodexRelay('ao-relay');
  writeFileSync(toml, 'model_provider = "legacy"\n');
  const legacyAuth = readFileSync(auth, 'utf-8');
  let legacy = '';
  try { clearCodexRelay('legacy'); } catch (e) { legacy = String(e); }
  assert(/缺少.*所有权/.test(legacy) && readFileSync(auth, 'utf-8') === legacyAuth, '无所有权记录的历史配置拒绝猜测删除凭据');

  console.log('\n─── Codex 三文件真实中断恢复 ───');
  const originalConfig = '# before crash\nmodel_provider = "original"\n';
  writeFileSync(toml, originalConfig);
  const beforeCrashAuth = readFileSync(auth, 'utf-8');
  const url = pathToFileURL(resolve('src/utils/codex-relay.ts')).href;
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    import { join } from 'node:path';
    import { applyCodexRelay } from ${JSON.stringify(url)};
    const rename = fs.renameSync;
    fs.renameSync = (from, to) => {
      rename(from, to);
      if (String(to) === join(process.env.AO_CODEX_DIR, 'auth.json')) process.kill(process.pid, 'SIGKILL');
    };
    syncBuiltinESMExports();
    applyCodexRelay({ providerId: 'crash-relay', name: 'Crash', baseUrl: 'https://crash.invalid/v1', apiKey: 'dummy-key' });
  `], { env: { ...process.env, AO_CODEX_DIR: dir }, encoding: 'utf-8', timeout: 15000 });
  assert(!child.error && child.status !== 0 && existsSync(join(dir, '.ao-config-transaction.json')), '配置/auth 已写入、所有权未提交时真实杀进程');
  assert(readCodexRelayStatus('crash-relay').recoveryPending && !readCodexRelayStatus('crash-relay').managed,
    '只读状态明确显示待恢复，不把半提交配置显示为已受管');
  clearCodexRelay('unrelated');
  assert(readFileSync(toml, 'utf-8') === originalConfig && readFileSync(auth, 'utf-8') === beforeCrashAuth
    && !existsSync(join(dir, '.ao-relay-state.json')), '下次操作同时恢复配置、auth 和所有权记录');

  console.log('\n─── 解析错误不回显凭据 ───');
  {
    const d = mkdtempSync(join(tmpdir(), 'ao-codex-redact-'));
    process.env.AO_CODEX_DIR = d;
    const m = await import(`../src/utils/codex-relay.js?redact=${Date.now()}`);
    writeFileSync(join(d, 'auth.json'), '{"OPENAI_API_KEY": sk-secret}', 'utf-8');
    let e1 = '';
    try { m.applyCodexRelay({ providerId: 'ao-relay', name: 'AO', baseUrl: 'https://x.invalid/v1', apiKey: 'sk-new' }); }
    catch (e) { e1 = String(e); }
    assert(/解析失败/.test(e1) && !/secret/.test(e1), `auth.json 写坏：报错不含原文（${e1.slice(0, 80)}）`);
    writeFileSync(join(d, 'auth.json'), '{}', 'utf-8');
    writeFileSync(join(d, 'config.toml'), '[x]\nkey = sk-secret\n', 'utf-8');
    let e2 = '';
    try { m.applyCodexRelay({ providerId: 'ao-relay', name: 'AO', baseUrl: 'https://x.invalid/v1', apiKey: 'sk-new' }); }
    catch (e) { e2 = String(e); }
    assert(/第 2 行/.test(e2) && !/secret/.test(e2), 'config.toml 写坏：只给行列号，不给原文');
    rmSync(d, { recursive: true, force: true });
  }

  console.log('\n─── 符号链接：拒绝替换，链接和目标都不变 ───');
  if (process.platform !== 'win32') {
    const d = mkdtempSync(join(tmpdir(), 'ao-codex-link-'));
    const target = join(d, 'dotfiles-config.toml');
    writeFileSync(target, 'model = "gpt-5"\n', 'utf-8');
    fs.symlinkSync(target, join(d, 'config.toml'));
    process.env.AO_CODEX_DIR = d;
    const m = await import(`../src/utils/codex-relay.js?link=${Date.now()}`);
    let e = '';
    try { m.applyCodexRelay({ providerId: 'ao-relay', name: 'AO', baseUrl: 'https://x.invalid/v1', apiKey: 'sk-new' }); }
    catch (err) { e = String(err); }
    assert(/符号链接/.test(e) && fs.lstatSync(join(d, 'config.toml')).isSymbolicLink()
      && readFileSync(target, 'utf-8') === 'model = "gpt-5"\n' && !existsSync(join(d, 'auth.json')), '链接保留、目标未改、auth 也没写');
    rmSync(d, { recursive: true, force: true });
  }

  console.log('\n─── 备份数量有上限 ───');
  {
    const d = mkdtempSync(join(tmpdir(), 'ao-codex-prune-'));
    process.env.AO_CODEX_DIR = d;
    const m = await import(`../src/utils/codex-relay.js?prune=${Date.now()}`);
    for (let i = 0; i < 9; i++) m.applyCodexRelay({ providerId: 'ao-relay', name: 'AO', baseUrl: 'https://x.invalid/v1', apiKey: `sk-${i}` });
    const count = (n: string) => readdirSync(d).filter(f => f.startsWith(`${n}.ao-backup-`)).length;
    assert(count('config.toml') === 5 && count('auth.json') === 5 && count('.ao-relay-state.json') === 5,
      `每个文件最多留 5 份备份（实际 ${count('config.toml')}/${count('auth.json')}/${count('.ao-relay-state.json')}）`);
    m.clearCodexRelay('ao-relay');
    assert(!existsSync(join(d, 'config.toml')) || !readFileSync(join(d, 'config.toml'), 'utf-8').includes('ao-relay'),
      '清理旧备份不影响恢复（恢复靠所有权记录，不靠备份文件）');
    rmSync(d, { recursive: true, force: true });
  }

  console.log('\n─── config.toml 排版：切换再恢复后逐字还原 ───');
  {
    const d = mkdtempSync(join(tmpdir(), 'ao-codex-format-'));
    process.env.AO_CODEX_DIR = d;
    const m = await import(`../src/utils/codex-relay.js?format=${Date.now()}`);
    const original = '# 我的配置\nmodel = "gpt-5"  # 平时用的\n\n# 公司网关\n[model_providers.corp]\nname = "Corp"\nbase_url = "https://corp.invalid/v1"\n';
    writeFileSync(join(d, 'config.toml'), original);
    m.applyCodexRelay({ providerId: 'ao-relay', name: 'AO', baseUrl: 'https://x.invalid/v1', apiKey: 'sk-1', model: 'relay-model' });
    const mid = readFileSync(join(d, 'config.toml'), 'utf-8');
    assert(mid.includes('# 我的配置') && mid.includes('# 公司网关') && (parse(mid) as any).model_provider === 'ao-relay', '切换后注释还在');
    m.applyCodexRelay({ providerId: 'ao-relay', name: 'AO', baseUrl: 'https://y.invalid/v1', apiKey: 'sk-2' });
    m.clearCodexRelay('ao-relay');
    assert(readFileSync(join(d, 'config.toml'), 'utf-8') === original, '两次切换后恢复：config.toml 与原文逐字一致');
    rmSync(d, { recursive: true, force: true });
    process.env.AO_CODEX_DIR = sandbox;
  }

  console.log('\n─── 旧版 AO 配置（无所有权记录）：只能移除，不能恢复 ───');
  {
    const d = mkdtempSync(join(tmpdir(), 'ao-codex-legacy-'));
    process.env.AO_CODEX_DIR = d;
    const m = await import(`../src/utils/codex-relay.js?legacy=${Date.now()}`);
    const legacyToml = 'model = "relay-model"\nmodel_provider = "ao-relay"\n\n[model_providers.ao-relay]\nname = "AO"\nbase_url = "https://old.invalid/v1"\n\n[model_providers.mine]\nname = "Mine"\nbase_url = "https://mine.invalid/v1"\n';
    const legacyAuth = JSON.stringify({ OPENAI_API_KEY: 'sk-old', tokens: { refresh_token: 'r1' } });
    const reset = () => { writeFileSync(join(d, 'config.toml'), legacyToml); writeFileSync(join(d, 'auth.json'), legacyAuth); };
    reset();
    let e = '';
    try { m.clearCodexRelay('ao-relay'); } catch (err) { e = String(err); }
    assert(/所有权记录/.test(e) && readFileSync(join(d, 'config.toml'), 'utf-8') === legacyToml, '「恢复」仍拒绝，不猜所有权');

    let stale = '';
    try { m.removeLegacyCodexRelay('ao-relay', { expectedBaseUrl: 'https://other.invalid/v1' }); } catch (err) { stale = String(err); }
    assert(/确认后发生了变化/.test(stale) && readFileSync(join(d, 'config.toml'), 'utf-8') === legacyToml, '确认后配置变了：拒绝，不按旧确认改新配置');

    const r = m.removeLegacyCodexRelay('ao-relay', { expectedBaseUrl: 'https://old.invalid/v1' });
    const doc = parse(readFileSync(join(d, 'config.toml'), 'utf-8')) as any;
    const a = JSON.parse(readFileSync(join(d, 'auth.json'), 'utf-8'));
    assert(doc.model_provider === undefined && !doc.model_providers['ao-relay'] && doc.model_providers.mine?.base_url === 'https://mine.invalid/v1',
      '只移除 AO 路由和 AO 那张表，用户自己的 provider 留着');
    assert(doc.model === 'relay-model' && r.keptModel === 'relay-model', 'model 不动，回报给调用方提示用户');
    assert(a.OPENAI_API_KEY === 'sk-old' && a.tokens.refresh_token === 'r1' && r.keyDeleted === false, '默认保留 key，OAuth 不碰');
    assert(r.backups.length === 1 && !existsSync(join(d, '.ao-relay-state.json')), '有备份，且不凭空造所有权记录');

    reset();
    const r2 = m.removeLegacyCodexRelay('ao-relay', { deleteKey: true });
    const a2 = JSON.parse(readFileSync(join(d, 'auth.json'), 'utf-8'));
    assert(r2.keyDeleted && a2.OPENAI_API_KEY === undefined && a2.tokens.refresh_token === 'r1', '勾选删除 key：只删 key，OAuth 留着');

    writeFileSync(join(d, 'config.toml'), 'model_provider = "ao-relay-x"\n');
    let notOurs = '';
    try { m.removeLegacyCodexRelay('ao-relay'); } catch (err) { notOurs = String(err); }
    assert(/没有在使用 AO 中转/.test(notOurs), '相似但不是 AO 约定 id：不动');

    console.log('\n─── 旧版 AO 配置：改由 AO 管理（继续使用） ───');
    reset();
    let staleAdopt = '';
    try { m.adoptLegacyCodexRelay('ao-relay', { expectedBaseUrl: 'https://other.invalid/v1' }); } catch (err) { staleAdopt = String(err); }
    assert(/确认后发生了变化/.test(staleAdopt) && !existsSync(join(d, '.ao-relay-state.json')), '接管：确认后配置变了就拒绝');
    m.adoptLegacyCodexRelay('ao-relay', { expectedBaseUrl: 'https://old.invalid/v1' });
    const st = m.readCodexRelayStatus('ao-relay');
    assert(readFileSync(join(d, 'config.toml'), 'utf-8') === legacyToml && readFileSync(join(d, 'auth.json'), 'utf-8') === legacyAuth,
      '接管：config.toml / auth.json 一个字节都没改');
    assert(st.managed && !st.conflict && st.configured, '接管后状态读回为受管、无冲突、仍在用中转');
    let twice = '';
    try { m.adoptLegacyCodexRelay('ao-relay'); } catch (err) { twice = String(err); }
    assert(/已经由 AO 管理/.test(twice), '已受管的不重复接管');
    // 接管后照常切到另一家，再恢复：回到「不走中转」，而不是回到旧中转
    m.applyCodexRelay({ providerId: 'ao-relay', name: 'AO', baseUrl: 'https://next.invalid/v1', apiKey: 'sk-next' });
    m.clearCodexRelay('ao-relay');
    const back = parse(readFileSync(join(d, 'config.toml'), 'utf-8')) as any;
    const backAuth = JSON.parse(readFileSync(join(d, 'auth.json'), 'utf-8'));
    assert(back.model_provider === undefined && !back.model_providers?.['ao-relay'] && back.model_providers?.mine?.name === 'Mine',
      '接管→切换→恢复：中转路由和表都移除，用户自己的 provider 还在');
    assert(back.model === 'relay-model' && backAuth.OPENAI_API_KEY === 'sk-old' && backAuth.tokens.refresh_token === 'r1',
      '恢复后 model 与 key 回到接管时的值，OAuth 不动');
    assert(!existsSync(join(d, '.ao-relay-state.json')), '恢复完成后所有权记录清掉');

    reset();
    writeFileSync(join(d, 'auth.json'), JSON.stringify({ tokens: { refresh_token: 'r1' } }));
    let noKey = '';
    try { m.adoptLegacyCodexRelay('ao-relay'); } catch (err) { noKey = String(err); }
    assert(/没有中转 key/.test(noKey) && !existsSync(join(d, '.ao-relay-state.json')), '缺 key 的旧配置不接管，提示重新保存');

    reset();
    m.applyCodexRelay({ providerId: 'ao-relay', name: 'AO', baseUrl: 'https://new.invalid/v1', apiKey: 'sk-new' });
    let managed = '';
    try { m.removeLegacyCodexRelay('ao-relay'); } catch (err) { managed = String(err); }
    assert(/恢复切换前配置/.test(managed), '有所有权记录时引导去用恢复，不走历史移除');
    rmSync(d, { recursive: true, force: true });
    process.env.AO_CODEX_DIR = sandbox;
  }
  console.log('\n─── 凭据摘要与 v1 所有权记录升级 ───');
  {
    const d = mkdtempSync(join(tmpdir(), 'ao-codex-state-v2-'));
    process.env.AO_CODEX_DIR = d;
    const m = await import(`../src/utils/codex-relay.js?state-v2=${Date.now()}`);
    const statePath = join(d, '.ao-relay-state.json');
    const authPath = join(d, 'auth.json');
    const keyA = 'synthetic-current-key-a';
    m.applyCodexRelay({ providerId: 'ao-relay', name: 'AO', baseUrl: 'https://x.invalid', apiKey: keyA });
    const raw = readFileSync(statePath, 'utf-8');
    const state = JSON.parse(raw);
    const field = state.fields.find((f: any) => f.file === 'auth');
    assert(state.version === 2 && /^[a-f0-9]{64}$/.test(field.after.sha256) && !Object.hasOwn(field.after, 'value'), '新记录只用摘要检测当前 key 漂移');
    assert(!raw.includes(keyA) && m.readCodexRelayStatus('ao-relay').managed, '无原 key 时，state 不复制当前 key 明文且正常受管');
    const v1 = { ...state, version: 1, fields: state.fields.map((f: any) => f.file === 'auth' ? { ...f, after: { present: true, value: keyA } } : f) };
    writeFileSync(statePath, JSON.stringify(v1));
    assert(m.readCodexRelayStatus('ao-relay').managed && JSON.parse(readFileSync(statePath, 'utf-8')).version === 1, '只读查询兼容 v1，不静默改格式');
    const keyB = 'synthetic-current-key-b';
    m.applyCodexRelay({ providerId: 'ao-relay', name: 'AO', baseUrl: 'https://y.invalid', apiKey: keyB });
    const upgraded = readFileSync(statePath, 'utf-8');
    assert(JSON.parse(upgraded).version === 2 && !upgraded.includes(keyA) && !upgraded.includes(keyB), '保存时事务性升级 v1→v2，不再复制 after key');
    writeFileSync(authPath, JSON.stringify({ OPENAI_API_KEY: 'changed-externally' }));
    let conflict = '';
    try { m.clearCodexRelay('ao-relay'); } catch (e) { conflict = String(e); }
    assert(/外部修改/.test(conflict) && JSON.parse(readFileSync(authPath, 'utf-8')).OPENAI_API_KEY === 'changed-externally', '摘要仍可阻止覆盖外部换过的 key');
    writeFileSync(authPath, JSON.stringify({ OPENAI_API_KEY: keyB }));
    const bad = JSON.parse(upgraded);
    bad.fields.find((f: any) => f.file === 'auth').after.sha256 = 'invalid';
    writeFileSync(statePath, JSON.stringify(bad));
    let invalid = '';
    try { m.clearCodexRelay('ao-relay'); } catch (e) { invalid = String(e); }
    assert(/记录无效/.test(invalid) && JSON.parse(readFileSync(authPath, 'utf-8')).OPENAI_API_KEY === keyB, '损坏 v2 摘要拒绝恢复，凭据不变');
    writeFileSync(statePath, upgraded);
    m.clearCodexRelay('ao-relay');
    assert(JSON.parse(readFileSync(authPath, 'utf-8')).OPENAI_API_KEY === undefined, '升级后的记录仍能恢复原先不存在 key 的状态');
    writeFileSync(authPath, JSON.stringify({ OPENAI_API_KEY: 'recoverable-before-key', tokens: { refresh: 'keep-token' } }));
    m.applyCodexRelay({ providerId: 'ao-relay', name: 'AO', baseUrl: 'https://original.invalid', apiKey: keyA });
    const withBaseline = JSON.parse(readFileSync(statePath, 'utf-8'));
    withBaseline.version = 1;
    withBaseline.fields.find((f: any) => f.file === 'auth').after = { present: true, value: keyA };
    const oldState = JSON.stringify(withBaseline);
    writeFileSync(statePath, oldState);
    const beforeConfig = readFileSync(join(d, 'config.toml'), 'utf-8');
    const beforeAuth = readFileSync(authPath, 'utf-8');
    const originalRename = fs.renameSync;
    let stateFailed = false;
    fs.renameSync = (from, to) => {
      if (String(to) === statePath && !stateFailed) { stateFailed = true; throw new Error('injected state migration failure'); }
      return originalRename(from, to);
    };
    syncBuiltinESMExports();
    let migrationFailed = false;
    try { m.applyCodexRelay({ providerId: 'ao-relay', name: 'AO', baseUrl: 'https://changed.invalid', apiKey: keyB }); }
    catch { migrationFailed = true; }
    finally { fs.renameSync = originalRename; syncBuiltinESMExports(); }
    assert(stateFailed && migrationFailed && readFileSync(statePath, 'utf-8') === oldState
      && readFileSync(join(d, 'config.toml'), 'utf-8') === beforeConfig && readFileSync(authPath, 'utf-8') === beforeAuth,
      'v1→v2 第三份记录提交失败时，配置/凭据/旧记录同时恢复');
    m.applyCodexRelay({ providerId: 'ao-relay', name: 'AO', baseUrl: 'https://changed.invalid', apiKey: keyB });
    const migrated = JSON.parse(readFileSync(statePath, 'utf-8'));
    assert(migrated.fields.find((f: any) => f.file === 'auth').before.value === 'recoverable-before-key', '迁移保留真正恢复所需的 before key');
    m.clearCodexRelay('ao-relay');
    const recovered = JSON.parse(readFileSync(authPath, 'utf-8'));
    assert(recovered.OPENAI_API_KEY === 'recoverable-before-key' && recovered.tokens.refresh === 'keep-token', '摘要升级后仍能恢复旧 key 并保留 OAuth');
    rmSync(d, { recursive: true, force: true });
    process.env.AO_CODEX_DIR = sandbox;
  }

  console.log('\n─── 历史操作确认覆盖配置、key 和 OAuth ───');
  {
    const d = mkdtempSync(join(tmpdir(), 'ao-codex-preview-'));
    process.env.AO_CODEX_DIR = d;
    const m = await import(`../src/utils/codex-relay.js?preview=${Date.now()}`);
    const configPath = join(d, 'config.toml'), authPath = join(d, 'auth.json');
    const config = 'model_provider = "ao-relay"\n[model_providers.ao-relay]\nname = "AO"\nbase_url = "https://same.invalid/v1"\n';
    const originalAuth = JSON.stringify({ OPENAI_API_KEY: 'old-key', tokens: { refresh: 'old-token' } });
    writeFileSync(configPath, config); writeFileSync(authPath, originalAuth);
    const preview = m.readCodexRelayStatus('ao-relay');
    assert(!!preview.revision && /^[a-f0-9]{64}$/.test(preview.revision) && !JSON.stringify(preview).includes('old-key'), '预览返回不泄露 key 的不透明版本令牌');
    for (const changed of [JSON.stringify({ OPENAI_API_KEY: 'rotated-key', tokens: { refresh: 'old-token' } }), JSON.stringify({ OPENAI_API_KEY: 'old-key', tokens: { refresh: 'new-token' } })]) {
      writeFileSync(authPath, changed);
      for (const operation of [() => m.removeLegacyCodexRelay('ao-relay', { deleteKey: true, expectedBaseUrl: preview.baseUrl, expectedRevision: preview.revision }),
        () => m.adoptLegacyCodexRelay('ao-relay', { expectedBaseUrl: preview.baseUrl, expectedRevision: preview.revision })]) {
        let code = '';
        try { operation(); } catch (e) { code = (e as { code?: string }).code || ''; }
        assert(code === 'CONFIG_CHANGED' && readFileSync(configPath, 'utf-8') === config && readFileSync(authPath, 'utf-8') === changed,
          'URL 未变但 key/OAuth 已变：旧确认不能删除或接管新状态');
      }
    }
    const fresh = m.readCodexRelayStatus('ao-relay');
    const restarted = await import(`../src/utils/codex-relay.js?restart-preview=${Date.now()}`);
    let expired = '';
    try { restarted.removeLegacyCodexRelay('ao-relay', { expectedRevision: fresh.revision }); } catch (e) { expired = (e as { code?: string }).code || ''; }
    assert(expired === 'CONFIG_CHANGED', '引擎实例更换后旧预览失效，必须重新确认');
    const result = m.removeLegacyCodexRelay('ao-relay', { deleteKey: true, expectedRevision: fresh.revision });
    assert(result.keyDeleted && JSON.parse(readFileSync(authPath, 'utf-8')).tokens.refresh === 'new-token', '新预览确认后只删除所选 key，保留 OAuth');
    rmSync(d, { recursive: true, force: true });
    process.env.AO_CODEX_DIR = sandbox;
  }
} catch (e) {
  assert(false, `异常: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  if (previousDir === undefined) delete process.env.AO_CODEX_DIR; else process.env.AO_CODEX_DIR = previousDir;
  rmSync(sandbox, { recursive: true, force: true });
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed > 0 ? 1 : 0);
