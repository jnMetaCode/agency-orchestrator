// 每周增长指标一屏看（T15 北极星代理组合）。
//
// 约束：AO 卖「数据在本机」，引擎/本地界面零遥测——所以「周活跃运行数」这个真北极星
// 拿不到，也不该拿。用全公开数据源的代理组合逼近它：
//   npm 周下载（新增安装的代理）· GitHub star/fork（口碑的代理）·
//   桌面端各版本下载数（小白用户增长的代理）· open issue 数（健康度）
// 全部只读公开 API，无需任何 token（GitHub 匿名限流 60 次/时，本脚本用 2 次）。
//   用法：npm run metrics   （建议每周固定一天跑，数字记进战略文档看趋势）
const REPO = 'jnMetaCode/agency-orchestrator';
const PKG = 'agency-orchestrator';

const get = async (url, headers = {}) => {
  const r = await fetch(url, { headers: { 'User-Agent': 'ao-metrics', ...headers } });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
};

const fmt = (n) => Number(n).toLocaleString('en-US');

try {
  const [dl, repo, releases] = await Promise.all([
    get(`https://api.npmjs.org/downloads/point/last-week/${PKG}`),
    get(`https://api.github.com/repos/${REPO}`),
    get(`https://api.github.com/repos/${REPO}/releases?per_page=10`),
  ]);

  const desktop = releases.filter((r) => r.tag_name.startsWith('desktop-v'));
  const latestDesktop = desktop[0];
  const desktopDl = (rel) => (rel?.assets ?? [])
    .filter((a) => /\.(dmg|exe|AppImage)$/i.test(a.name))
    .reduce((s, a) => s + a.download_count, 0);
  const desktopTotal = desktop.reduce((s, r) => s + desktopDl(r), 0);

  const today = new Date().toISOString().slice(0, 10);
  console.log(`\n  📈 AO 增长指标 · ${today}（全公开数据源，零遥测）\n`);
  console.log(`  npm 周下载        ${fmt(dl.downloads)}   （${dl.start} ~ ${dl.end}）`);
  console.log(`  GitHub stars      ${fmt(repo.stargazers_count)}`);
  console.log(`  GitHub forks      ${fmt(repo.forks_count)}`);
  console.log(`  open issues       ${fmt(repo.open_issues_count)}`);
  if (latestDesktop) {
    console.log(`  桌面端下载        最新版 ${latestDesktop.tag_name}: ${fmt(desktopDl(latestDesktop))} · 近 10 版累计: ${fmt(desktopTotal)}`);
  }
  console.log(`\n  北极星（周活跃运行数）无遥测拿不到——以上是代理组合，盯趋势不盯绝对值。`);
  console.log(`  记录位置：/Users/yx/work/战略/AO指标周记.md（脚本不自动写，人工确认后记入）\n`);
} catch (err) {
  console.error(`  ⚠️ 拉取失败：${err.message}（GitHub 匿名限流 60 次/时，稍后再试）`);
  process.exit(1);
}
