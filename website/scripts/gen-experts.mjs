// 预生成「专家库」静态数据，供官网公开浏览页使用（无需后端）。
// 读取中文库(node_modules/agency-agents-zh)与英文库(../agency-agents)的角色 .md frontmatter，
// 产出 src/content/experts.json（含 zh / en 两套）。本地跑一次并提交；CF 构建只读这份 JSON。
//   用法：node scripts/gen-experts.mjs
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

const CATEGORY_NAMES = {
  zh: { marketing: "市场营销", "paid-media": "付费媒体", sales: "销售", product: "产品", "project-management": "项目管理", testing: "质量测试", support: "运营支持", "spatial-computing": "空间计算", specialized: "专业服务", "game-development": "游戏开发", engineering: "工程开发", design: "设计", academic: "学术研究", finance: "财务金融", hr: "人力资源", legal: "法务", strategy: "战略", "supply-chain": "供应链" },
  en: { marketing: "Marketing", "paid-media": "Paid Media", sales: "Sales", product: "Product", "project-management": "Project Management", testing: "Testing", support: "Support", "spatial-computing": "Spatial Computing", specialized: "Specialized", "game-development": "Game Dev", engineering: "Engineering", design: "Design", academic: "Academic", finance: "Finance", hr: "HR", legal: "Legal", strategy: "Strategy", "supply-chain": "Supply Chain" },
};

function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split("\n")) {
    const mm = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (mm) fm[mm[1]] = mm[2].trim().replace(/^["']|["']$/g, "");
  }
  return fm;
}

function loadLib(dir, lang) {
  if (!existsSync(dir)) return null;
  const cats = CATEGORY_NAMES[lang];
  const out = [];
  for (const cat of readdirSync(dir)) {
    const catDir = join(dir, cat);
    try { if (!statSync(catDir).isDirectory()) continue; } catch { continue; }
    for (const f of readdirSync(catDir)) {
      if (!f.endsWith(".md")) continue;
      const fm = parseFrontmatter(readFileSync(join(catDir, f), "utf-8"));
      if (!fm || !fm.name) continue;
      out.push({
        category: cat,
        categoryName: cats[cat] || cat,
        id: f.replace(/\.md$/, ""),
        name: fm.name,
        description: fm.description || "",
        emoji: fm.emoji || "",
        color: fm.color || "#888",
      });
    }
  }
  out.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  return out;
}

const zh = loadLib(join(repoRoot, "node_modules", "agency-agents-zh"), "zh");
const en = loadLib(join(repoRoot, "agency-agents"), "en");

if (!zh || !en) {
  console.error("❌ 找不到角色库：zh=" + !!zh + " en=" + !!en + "。请在仓库根装好 agency-agents-zh 依赖、且 agency-agents/ 存在。");
  process.exit(1);
}

const outFile = join(__dirname, "..", "src", "content", "experts.json");
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify({ zh, en }, null, 0) + "\n", "utf-8");
console.log(`✅ 生成 ${outFile}\n   zh: ${zh.length} 个专家 | en: ${en.length} 个专家`);
