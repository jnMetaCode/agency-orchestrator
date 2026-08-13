/**
 * 演示站（没有引擎后端）不该发注定失败的请求。
 *
 * 真实故障：用户在公开演示站 ao.aiolaola.com/studio 的供应商页点「测试连接 / 获取模型列表」，
 * 控制台里蹦出 `POST /api/test-provider 405 (Method Not Allowed)` —— 官网是纯静态托管，
 * `/api/*` 根本不存在，静态站对 POST 就回 405。用户看到的是一个像"我们坏了"的报错，
 * 而真相是"这一步需要本地引擎"。
 *
 * 供应商页是有意在演示站也放开的（可浏览、可填、能看到端点与权益），所以不能整页禁掉；
 * 该做的是：这三个必须打后端的动作在离线时不发请求，直接说清要本地引擎。
 *
 * 这里按源码钉住这个约定 —— 前端逻辑没有单测环境，但"离线时先拦一道"是行为约定，
 * 后来人删掉那行 if 不会有任何构建报错，只会在演示站重新冒出 405。
 */
import { readFileSync } from 'node:fs';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}: ${err instanceof Error ? err.message : err}`);
    failed++;
  }
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg);
}

const CONFIG_VIEW = 'website/src/components/studio/ProviderConfigView.tsx';
const PANEL = 'website/src/components/studio/ProvidersPanel.tsx';
const STUDIO = 'website/src/pages/Studio.tsx';

console.log('\n─── 演示站（无后端）不发注定 405 的请求 ───');

const view = (() => { try { return readFileSync(CONFIG_VIEW, 'utf-8'); } catch { return ''; } })();
const panel = (() => { try { return readFileSync(PANEL, 'utf-8'); } catch { return ''; } })();
const studio = (() => { try { return readFileSync(STUDIO, 'utf-8'); } catch { return ''; } })();

// 引擎可以单独发包（不带 website/），前端文件不在时整组跳过而不是判失败
const hasFrontend = !!view && !!panel && !!studio;

test('offline 从 Studio 一路传到供应商配置页（后端在不在只有 Studio 知道）', () => {
  if (!hasFrontend) return;
  // 别用 [^>]* 去圈 JSX 标签：属性里的箭头函数 `(p) => …` 自带 `>`，会把匹配提前截断
  assert(/<ProvidersPanel[\s\S]{0,300}?offline=\{offline\}/.test(studio), 'Studio 没把 offline 传给 ProvidersPanel');
  assert(/offline\s*=\s*false/.test(panel) && /offline=\{offline\}/.test(panel), 'ProvidersPanel 没接收/下传 offline');
  assert(/offline\?\s*:\s*boolean/.test(view), 'ProviderConfigView 没有 offline 入参');
});

test('三个必须打后端的动作都先拦一道（测试连接 / 获取模型列表 / 保存）', () => {
  if (!hasFrontend) return;
  // 取每个函数体的前几行，确认 if (offline) 出现在真正发请求之前
  for (const [fn, apiCall] of [
    ['fetchModels', 'api.providerModels'],
    ['runTest', 'api.testProvider'],
    ['save', 'api.saveConfig'],
  ] as const) {
    const start = view.indexOf(`const ${fn} = async`);
    assert(start >= 0, `找不到 ${fn}`);
    const body = view.slice(start, start + 1200);
    const guard = body.indexOf('if (offline)');
    const call = body.indexOf(apiCall);
    assert(guard >= 0, `${fn} 没有 offline 拦截 —— 演示站点下去会拿到 405`);
    assert(call < 0 || guard < call, `${fn} 的 offline 拦截必须在 ${apiCall} 之前`);
  }
});

test('拦下来之后要说人话（指向本地引擎，而不是一句 405）', () => {
  if (!hasFrontend) return;
  assert(/demoNeedsEngineShort/.test(view), '拦截后应给 demoNeedsEngineShort 文案');
  assert(/demoNeedsEngine\b/.test(panel), '供应商页顶部应有一条说明横幅');
  const i18n = readFileSync('website/src/i18n/translations.ts', 'utf-8');
  for (const key of ['demoNeedsEngine:', 'demoNeedsEngineShort:']) {
    // 中英各一份：英文站看到中文提示等于没提示
    assert((i18n.match(new RegExp(key, 'g')) || []).length >= 2, `${key} 缺中文或英文文案`);
  }
  assert(/agency-orchestrator web/.test(i18n), '提示里应给出可照做的命令');
});

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
