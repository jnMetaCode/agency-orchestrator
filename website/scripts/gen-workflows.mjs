// 预生成「工作流模板」静态快照，供公开演示站(无后端)展示完整模板库。
// 读取 repo 根的 workflows/*.yaml(中文)与 workflows/en/*.yaml(英文),
// 产出 src/content/workflows.json（含 zh / en）。本地跑一次并提交。
//   用法(在 repo 根)：node website/scripts/gen-workflows.mjs
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
// js-yaml 在 repo 根 node_modules
const require = createRequire(join(repoRoot, "package.json"));
const yaml = require("js-yaml");

// 没写 name/emoji 的媒体步骤在卡片上要有个说得过去的显示名（与 executor 里的默认值保持一致）
const DEFAULT_STEP_NAME = { image: "文生图", video: "文生视频", concat: "合成", tts: "配音", approval: "人工确认", human_input: "人工输入" };
const DEFAULT_STEP_EMOJI = { image: "🎨", video: "🎬", concat: "🎞", tts: "🎙", approval: "✋", human_input: "⌨️" };

function loadDir(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".yaml") && !f.endsWith(".yml")) continue;
    const full = join(dir, f);
    try {
      if (statSync(full).isDirectory()) continue;
      const doc = yaml.load(readFileSync(full, "utf-8"));
      if (!doc || !doc.name || !Array.isArray(doc.steps)) continue;
      out.push({
        name: String(doc.name),
        description: doc.description ? String(doc.description) : "",
        // 类目/精选随 YAML 带出（如「一人公司」系列），演示站货架才能和本地一致地分组置顶
        category: doc.category ? String(doc.category) : undefined,
        featured: doc.featured === true ? true : undefined,
        // 媒体步骤（image / video / concat / tts）**没有 role**——按 role 过滤会把它们整条丢掉，
        // 于是演示站上「一句话出短片」只剩 3 步（出片那步不见了），
        // 而「创意出片」是按 step.type 筛模板的，一条都匹配不到、整页空白。
        // 该展示的要展示，能不能跑是另一回事（演示模式本来就只看不跑）。
        steps: doc.steps
          .filter((s) => s && (s.role || s.type))
          .map((s) => ({
            id: String(s.id || ""),
            ...(s.role ? { role: String(s.role) } : {}),
            ...(s.type && s.type !== "normal" ? { type: String(s.type) } : {}),
            name: s.name ? String(s.name) : DEFAULT_STEP_NAME[s.type] || undefined,
            emoji: s.emoji ? String(s.emoji) : DEFAULT_STEP_EMOJI[s.type] || undefined,
          })),
      });
    } catch {
      /* 跳过解析失败的模板 */
    }
  }
  // 按步骤数(更有看头的排前)再按名字，稳定排序
  return out.sort((a, b) => b.steps.length - a.steps.length || a.name.localeCompare(b.name));
}

const zh = loadDir(join(repoRoot, "workflows"));
const en = loadDir(join(repoRoot, "workflows", "en"));
const outFile = join(repoRoot, "website", "src", "content", "workflows.json");
writeFileSync(outFile, JSON.stringify({ zh, en }, null, 2), "utf-8");
console.log(`workflows.json: zh=${zh.length} en=${en.length} → ${outFile}`);
