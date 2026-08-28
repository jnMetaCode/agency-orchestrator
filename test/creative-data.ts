/**
 * 创意库**随包数据**的契约。
 *
 * 这些文件是脚本生成的，链路是「导入 → 体检 → 翻译」三步手工串起来的——漏跑一步不会有人
 * 报错，只会在用户那边表现成：卡片一个永远转圈的黑框、中文搜索搜不到、或者一条本该剔掉的
 * 提示词挂在公开页上。所以把三件事钉死在测试里：
 *   1. 上线的数据**已经过体检**（violation() 一条都不该命中）——等于强制 prune 跑过
 *   2. 示例视频链接必须是 https 且指向 .mp4（曾经混进过指向文章页的链接）
 *   3. 扩充池必须有中文标题（否则中文用户搜不到，等于白收）
 */
import { readFileSync , existsSync } from 'node:fs';
import { join } from 'node:path';
import { violation } from '../scripts/prune-extra-prompts.mjs';

let passed = 0, failed = 0;
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.log(`  ❌ ${name}: ${e instanceof Error ? e.message : e}`); failed++; }
}
function assert(c: boolean, m: string): void { if (!c) throw new Error(m); }
const read = (p: string) => JSON.parse(readFileSync(p, 'utf-8'));

const extra = read('website/src/content/creative-prompts-extra.json');
const vcomm = read('website/src/content/video-prompts-community.json');
const vmain = read('website/src/content/video-prompts.json');

console.log('\n─── 随包数据必须已经过内容体检 ───');

test('图片扩充池里没有漏网的（指名真人 / IP 角色 / 露骨）', () => {
  const bad = extra.prompts.filter((p: { title: string; prompt: string }) => violation(p));
  assert(bad.length === 0,
    `${bad.length} 条没过体检，说明 prune 没跑：${bad.slice(0, 3).map((b: { title: string }) => b.title).join('、')}`);
});

test('视频社区池同样过了体检', () => {
  const bad = vcomm.templates.filter((t: { title: string; prompt: string }) => violation(t));
  assert(bad.length === 0, `${bad.length} 条没过体检：${bad.slice(0, 3).map((b: { title: string }) => b.title).join('、')}`);
});

console.log('\n─── 示例视频链接 ───');

test('preview 必须可播放：https 外链 .mp4，或自托管 /video-previews/*.mp4 且文件真在（别再塞进一个转圈的黑框）', () => {
  const bad = vcomm.templates
    .filter((t: { preview?: string }) => t.preview)
    .filter((t: { preview: string }) => {
      if (/^https:\/\/.+\.mp4($|\?)/i.test(t.preview)) return false;
      if (/^\/video-previews\/[\w.-]+\.mp4$/.test(t.preview)) return !existsSync(join(process.cwd(), 'website', 'public', t.preview));
      return true;
    });
  assert(bad.length === 0, `${bad.length} 条 preview 不是可播放的 mp4（或自托管文件缺失）：${bad.slice(0, 2).map((b: { preview: string }) => b.preview).join(' | ')}`);
});

test('有示例的条目数量合理（外链会失效，掉光了要有人知道）', () => {
  const n = vcomm.templates.filter((t: { preview?: string }) => t.preview).length;
  assert(n >= 10, `只剩 ${n} 条有示例成片——外链多半批量失效了，重跑 import + 探活`);
});

console.log('\n─── 中文可搜索性 ───');

test('图片扩充池每条都有中文标题', () => {
  const miss = extra.prompts.filter((p: { titleZh?: string }) => !p.titleZh);
  assert(miss.length === 0, `${miss.length} 条缺 titleZh —— 中文用户搜不到它们（跑 translate-extra-titles.mjs）`);
});

test('视频社区池每条都有中文标题', () => {
  const miss = vcomm.templates.filter((t: { titleZh?: string }) => !t.titleZh);
  assert(miss.length === 0, `${miss.length} 条缺 titleZh`);
});

console.log('\n─── 视频题材模板（来自姊妹项目，同步而来）───');

test('中文题材模板都有可复制的正文与变量表', () => {
  const zh = vmain.templates.filter((t: { lang: string; kind: string }) => t.lang === 'zh' && t.kind === 'genre');
  assert(zh.length >= 20, `题材模板只剩 ${zh.length} 个，同步多半出问题了`);
  const noPrompt = zh.filter((t: { prompt: string }) => !t.prompt || t.prompt.length < 200);
  assert(noPrompt.length === 0, `${noPrompt.length} 个模板没有正文：${noPrompt.slice(0, 3).map((t: { id: string }) => t.id).join('、')}`);
});

test('构件与题材分开标（kind 混了，用户就会在题材列表里看到"运镜技法库"）', () => {
  const kinds = new Set(vmain.templates.map((t: { kind: string }) => t.kind));
  assert(kinds.has('genre') && kinds.has('module'), `kind 取值异常：${[...kinds].join('、')}`);
});

// ── 示例成片的赞助角标：谈成才金，且**到期会自己叫** ─────────────────────────
// 展示位是有期限的商务约定，而代码里的开关没有任何东西会提醒你它过期了——
// 不钉一条，metaso 的金色角标 + 返利链接会在合作结束后继续白送下去。
{
  const src = readFileSync('website/src/pages/CreativeLibrary.tsx', 'utf-8');
  const table = src.slice(src.indexOf('const PREVIEW_VENDORS'), src.indexOf('function readGenPref'));
  const entries = [...table.matchAll(/^\s{2}(\w+):\s*\{(.+)\},$/gm)].map((m) => ({ id: m[1], body: m[2] }));

  test('PREVIEW_VENDORS 能解析出条目（正则跟着代码走，别默默变成空检查）', () => {
    assert(entries.length >= 4, `应解析出至少 4 家出片方，实得 ${entries.length}`);
    assert(entries.some((e) => e.id === 'metaso'), '秘塔科技应在出片方表里');
  });

  test('打开 promoted 的必须写 until（没有到期日 = 无限期白送曝光）', () => {
    for (const e of entries.filter((x) => /promoted:\s*true/.test(x.body))) {
      assert(/until:\s*"\d{4}-\d{2}-\d{2}"/.test(e.body), `${e.id} 开了 promoted 却没写 until 到期日`);
      assert(/url:\s*"https:\/\//.test(e.body), `${e.id} 开了 promoted 却没有可跳转的链接`);
    }
  });

  test('展示位没有过期（过期就回落成中性标注，或续约改日期）', () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const e of entries.filter((x) => /promoted:\s*true/.test(x.body))) {
      const until = e.body.match(/until:\s*"(\d{4}-\d{2}-\d{2})"/)![1];
      assert(until >= today,
        `${e.id} 的展示位已于 ${until} 到期（今天 ${today}）——续约就改 until，不续就删掉 promoted 让角标回落成灰色中性标注`);
    }
  });

  test('没谈成的出片方不带 promoted（中性事实标注即可，不白送曝光）', () => {
    const promoted = entries.filter((x) => /promoted:\s*true/.test(x.body)).map((x) => x.id);
    assert(promoted.length <= 2, `同时推广 ${promoted.join('、')} 共 ${promoted.length} 家——角标是稀缺位，别摊薄`);
  });
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed > 0) process.exit(1);
