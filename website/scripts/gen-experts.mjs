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

function parseRole(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split("\n")) {
    const mm = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (mm) fm[mm[1]] = mm[2].trim().replace(/^["']|["']$/g, "");
  }
  return { fm, body: m[2].trim() };
}

// 每个角色的完整提示词正文写成静态文件，供官网点击复制（按需 fetch，不塞进 JSON）。
const promptsRoot = join(__dirname, "..", "public", "prompts");

const SKIP_DIRS = new Set(["node_modules", "scripts", "integrations", "examples"]);

function loadLib(dir, lang) {
  if (!existsSync(dir)) return null;
  const cats = CATEGORY_NAMES[lang];
  const out = [];
  // 在某「部门」目录下递归收集角色（含 game-development/unity/* 等嵌套），id 带子路径
  const walk = (catDir, cat, relDir) => {
    for (const f of readdirSync(catDir)) {
      if (f.startsWith(".") || SKIP_DIRS.has(f)) continue;
      const full = join(catDir, f);
      let isDir = false;
      try { isDir = statSync(full).isDirectory(); } catch { continue; }
      if (isDir) { walk(full, cat, relDir ? `${relDir}/${f}` : f); continue; }
      if (!f.endsWith(".md")) continue;
      const parsed = parseRole(readFileSync(full, "utf-8"));
      if (!parsed || !parsed.fm.name) continue; // 只收真角色（有 name frontmatter）
      const fm = parsed.fm;
      const base = f.replace(/\.md$/, "");
      const id = relDir ? `${relDir}/${base}` : base;
      out.push({
        category: cat,
        categoryName: cats[cat] || cat,
        id,
        name: fm.name,
        description: fm.description || "",
        emoji: fm.emoji || "",
        color: fm.color || "#888",
      });
      const outFile = join(promptsRoot, lang, cat, `${id}.md`);
      mkdirSync(dirname(outFile), { recursive: true });
      writeFileSync(outFile, parsed.body + "\n", "utf-8");
    }
  };
  for (const cat of readdirSync(dir)) {
    if (cat.startsWith(".") || SKIP_DIRS.has(cat)) continue;
    const catDir = join(dir, cat);
    try { if (!statSync(catDir).isDirectory()) continue; } catch { continue; }
    walk(catDir, cat, "");
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
console.log(`✅ 提示词正文 → ${promptsRoot}/<lang>/<category>/<id>.md`);
