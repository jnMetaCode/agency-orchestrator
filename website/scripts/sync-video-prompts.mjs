// 同步视频提示词模板：ai-shortfilm-prompts/templates/index.json → src/content/video-prompts.json
//
// 单一来源在姊妹项目（那边是提示词的产品，有站点、有生成器、有课程漏斗），AO 只是消费方。
// 手工拷贝迟早漂移——上游改了模板、这边不知道，用户复制到的是旧版本还不会报错。所以给一条命令：
//
//     node website/scripts/sync-video-prompts.mjs
//     AO_SHORTFILM_DIR=/path/to/ai-shortfilm-prompts node website/scripts/sync-video-prompts.mjs
//
// 上游那份索引由它自己的 scripts/gen_index.py 生成——同步前记得在那边先跑一次。
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const OUT = join(repoRoot, "website", "src", "content", "video-prompts.json");

// 默认按同级目录找；找不到就让用户用环境变量指路，别猜第二个路径
const CANDIDATES = [
  process.env.AO_SHORTFILM_DIR,
  resolve(repoRoot, "..", "ai-shortfilm-prompts"),
  resolve(repoRoot, "..", "..", "ai-tools", "ai-shortfilm-prompts"),
].filter(Boolean);

const dir = CANDIDATES.find((d) => existsSync(join(d, "templates", "index.json")));
if (!dir) {
  console.error(
    "❌ 找不到 ai-shortfilm-prompts/templates/index.json。\n" +
    "   试过：" + CANDIDATES.join("、") + "\n" +
    "   用 AO_SHORTFILM_DIR=/你的路径 指定；若那边还没生成索引，先在那个仓跑 python3 scripts/gen_index.py",
  );
  process.exit(1);
}

const src = JSON.parse(readFileSync(join(dir, "templates", "index.json"), "utf-8"));
const KEEP = ["id", "kind", "lang", "title", "category", "description", "variables", "prompt", "source", "license", "author"];
const templates = (src.templates ?? []).map((t) => Object.fromEntries(KEEP.map((k) => [k, t[k]])));

const zhGenres = templates.filter((t) => t.lang === "zh" && t.kind === "genre");
if (zhGenres.length === 0) {
  console.error("❌ 上游索引里一条中文题材模板都没有——多半是那边的生成脚本没跑或解析挂了，先去查，别把空数据同步过来。");
  process.exit(1);
}
const noPrompt = zhGenres.filter((t) => !t.prompt).map((t) => t.id);

writeFileSync(OUT, JSON.stringify({
  note: "视频提示词模板，来自姊妹项目 ai-shortfilm-prompts（MIT，同作者），由该仓 scripts/gen_index.py 生成的 " +
        "templates/index.json 同步而来。**别手改这份文件**——上游改了就重新跑 " +
        "node website/scripts/sync-video-prompts.mjs，否则两边悄悄漂移。" +
        "kind=genre 是题材模板（有可复制正文），kind=module 是可复用构件（运镜库/氛围骨架/负面词等）。",
  upstream: "https://github.com/jnMetaCode/ai-shortfilm-prompts",
  site: "https://prompts.aiolaola.com",
  license: "MIT",
  count: zhGenres.length,
  templates,
}, null, 2) + "\n", "utf-8");

console.log(`✅ ${OUT}`);
console.log(`   来源：${dir}`);
console.log(`   ${templates.length} 条（中文题材 ${zhGenres.length}、构件 ${templates.filter((t) => t.lang === "zh" && t.kind === "module").length}）`);
if (noPrompt.length) console.log(`   ⚠️ 这些题材没有可复制正文：${noPrompt.join(", ")}`);
