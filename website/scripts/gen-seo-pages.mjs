// 程序化 SEO：为每个专家角色与工作流模板生成静态详情页（构建后写入 dist/）。
//
// 为什么是静态页而不是 SPA 路由：百度等国内爬虫不执行 JS，SPA 里的内容对它们不存在；
// Vercel 的 rewrites 是「文件系统优先」，所以 dist/experts/<id>/index.html 会直接命中，
// 与 SPA 的 /experts 列表页（无对应文件，落回 index.html）互不干扰。
//
// 输入：src/content/experts.json（zh）、src/content/workflows.json（zh）、public/prompts/zh/
// 输出：dist/experts/<id>/index.html ×267、dist/workflows/<slug>/index.html、dist/sitemap.xml
// 挂载：package.json 的 build = `vite build && node scripts/gen-seo-pages.mjs`
//   用法：node scripts/gen-seo-pages.mjs（需先 vite build）
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const __dirname = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(__dirname, "..");
const repoRoot = resolve(siteRoot, "..");
const dist = join(siteRoot, "dist");
const ORIGIN = "https://ao.aiolaola.com";

if (!existsSync(join(dist, "index.html"))) {
  console.error("dist/ 不存在或没有 index.html —— 先跑 vite build 再执行本脚本。");
  process.exit(1);
}

const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const today = new Date().toISOString().slice(0, 10);

const experts = JSON.parse(readFileSync(join(siteRoot, "src/content/experts.json"), "utf-8")).zh ?? [];
const workflows = JSON.parse(readFileSync(join(siteRoot, "src/content/workflows.json"), "utf-8")).zh ?? [];

// ── 页面骨架（轻量静态页：零 JS、内联 CSS、亮暗自适应，与产品报告页同一气质）──
function page({ title, description, canonical, body, lang = "zh" }) {
  const L = lang === "en"
    ? { experts: "267 expert roles", evals: "Evals", docs: "Docs", tagline: "Open-source AI expert-team orchestrator — one sentence in, a full plan out" }
    : { experts: "267 个专家角色", evals: "评测", docs: "文档", tagline: "开源 AI 专家团队编排器 —— 一句话，让多个 AI 角色自动协作" };
  return `<!doctype html>
<html lang="${lang === "en" ? "en" : "zh-CN"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${ORIGIN}/og-image.png">
<style>
  :root { --bg:#f6f7f9; --card:#fff; --ink:#1d2530; --muted:#5d6b7e; --line:#e3e7ee; --accent:#4056c7; --soft:#eef1fc; }
  @media (prefers-color-scheme: dark) { :root { --bg:#11151c; --card:#191f29; --ink:#e6ebf2; --muted:#93a0b3; --line:#2a3341; --accent:#8ea2f0; --soft:#202942; } }
  * { box-sizing: border-box; }
  body { margin:0; padding:28px 16px 44px; background:var(--bg); color:var(--ink); line-height:1.75; font-size:15.5px;
         font-family:-apple-system,"PingFang SC","Microsoft YaHei","Segoe UI",sans-serif; }
  .page { max-width:820px; margin:0 auto; }
  nav { font-size:13px; margin-bottom:18px; }
  nav a { color:var(--muted); text-decoration:none; }
  nav a:hover { color:var(--accent); }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:26px 28px; margin-top:16px; }
  h1 { font-size:25px; line-height:1.35; margin:0 0 10px; }
  h2 { font-size:17px; margin:26px 0 10px; }
  .chip { display:inline-block; font-size:12.5px; color:var(--muted); background:var(--soft); border:1px solid var(--line); border-radius:999px; padding:2px 12px; margin-right:6px; }
  .desc { color:var(--muted); margin:10px 0 0; }
  pre { background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:12px 14px; overflow-x:auto; font-size:13px; line-height:1.6; }
  code { font-family:ui-monospace,"SF Mono",Consolas,monospace; }
  ul.plain { list-style:none; padding:0; margin:8px 0 0; display:flex; flex-wrap:wrap; gap:8px; }
  ul.plain a { display:inline-block; font-size:13px; color:var(--accent); text-decoration:none; background:var(--soft); border:1px solid var(--line); border-radius:999px; padding:3px 12px; }
  ol.steps { margin:8px 0 0; padding-left:0; list-style:none; }
  ol.steps li { padding:8px 0; border-bottom:1px solid var(--line); }
  ol.steps li:last-child { border-bottom:none; }
  ol.steps .role { color:var(--muted); font-size:12.5px; margin-left:8px; }
  .excerpt { color:var(--muted); font-size:14px; white-space:pre-wrap; }
  footer { margin-top:26px; padding-top:16px; border-top:1px solid var(--line); font-size:13px; color:var(--muted); display:flex; flex-wrap:wrap; gap:6px 18px; }
  footer a { color:var(--accent); text-decoration:none; }
</style>
</head>
<body>
<div class="page">
  <nav><a href="/">Agency Orchestrator</a> · <a href="/experts">${L.experts}</a> · <a href="${lang === "en" ? "/en/evals/" : "/evals/"}">${L.evals}</a> · <a href="/docs">${L.docs}</a> · <a href="https://github.com/jnMetaCode/agency-orchestrator">GitHub</a></nav>
${body}
  <footer>
    <span>${L.tagline}</span>
    <span><code>npm i -g agency-orchestrator</code></span>
    <a href="https://github.com/jnMetaCode/agency-orchestrator">github.com/jnMetaCode/agency-orchestrator</a>
  </footer>
</div>
</body>
</html>
`;
}

const urls = [];
function emit(relPath, html) {
  const dir = join(dist, relPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), html, "utf-8");
  urls.push(`${ORIGIN}/${relPath.replace(/\\/g, "/")}/`);
}

// ── 专家角色页 ×267 ──
let roleCount = 0;
for (const e of experts) {
  const roleRef = `${e.category}/${e.id}`;
  const promptFile = join(siteRoot, "public", "prompts", "zh", e.category, `${e.id}.md`);
  let excerpt = "";
  if (existsSync(promptFile)) {
    const raw = readFileSync(promptFile, "utf-8").replace(/^---[\s\S]*?---\s*/, "").trim();
    excerpt = raw.slice(0, 480) + (raw.length > 480 ? "…" : "");
  }
  const related = experts.filter((x) => x.category === e.category && x.id !== e.id).slice(0, 10);
  const body = `
  <article class="card">
    <h1>${esc(e.emoji ?? "")} ${esc(e.name)} —— AI 专家角色</h1>
    <p><span class="chip">${esc(e.categoryName ?? e.category)}</span><span class="chip">role: ${esc(roleRef)}</span></p>
    <p class="desc">${esc(e.description ?? "")}</p>

    <h2>在工作流里使用</h2>
    <pre><code>steps:
  - id: consult
    role: "${esc(roleRef)}"
    task: "你的任务描述"</code></pre>
    <p class="desc">或者一句话自动组队（AO 会按任务从 267 个角色中挑人）：</p>
    <pre><code>ao compose "描述你的任务" --run</code></pre>

    <h2>装进你的编程工具</h2>
    <p class="desc">这个角色可以作为子代理安装进 Claude Code / Cursor / Copilot 等工具：</p>
    <pre><code>npm i -g agency-orchestrator
ao install --tool claude-code --lang zh</code></pre>
${excerpt ? `
    <h2>系统提示词（节选）</h2>
    <p class="excerpt">${esc(excerpt)}</p>
    <p class="desc"><a href="/experts">在专家库查看完整提示词 →</a></p>` : ""}
${related.length ? `
    <h2>同部门的其他专家</h2>
    <ul class="plain">${related.map((r) => `<li><a href="/experts/${esc(r.id)}/">${esc(r.emoji ?? "")} ${esc(r.name)}</a></li>`).join("")}</ul>` : ""}
  </article>`;
  emit(join("experts", ...e.id.split("/")), page({
    title: `${e.name}（AI ${e.categoryName ?? ""}角色）· Agency Orchestrator`,
    description: (e.description ?? "").slice(0, 150),
    canonical: `${ORIGIN}/experts/${e.id}/`,
    body,
  }));
  roleCount++;
}

// ── 工作流模板页 ──
const slugify = (s) => s.replace(/[^\p{Script=Han}a-zA-Z0-9]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60);
let wfCount = 0;
const seenSlugs = new Set();
for (const w of workflows) {
  let slug = slugify(w.name);
  if (!slug || seenSlugs.has(slug)) slug = `${slug || "workflow"}-${wfCount}`;
  seenSlugs.add(slug);
  const steps = Array.isArray(w.steps) ? w.steps : [];
  const body = `
  <article class="card">
    <h1>${esc(w.name)} —— AI 多专家协作工作流</h1>
    <p>${w.category ? `<span class="chip">${esc(w.category)}</span>` : ""}<span class="chip">${steps.length} 个专家步骤</span></p>
    <p class="desc">${esc(w.description ?? "")}</p>

    <h2>专家分工</h2>
    <ol class="steps">${steps.map((s, i) => `<li>${i + 1}. ${esc(s.emoji ?? "")} <strong>${esc(s.name ?? s.id)}</strong>${s.role ? `<span class="role">${esc(s.role)}</span>` : ""}</li>`).join("")}</ol>

    <h2>怎么跑</h2>
    <p class="desc">装好 AO 后，在网页 Studio（<code>ao web</code>）的「工作流模板」里一键运行；或命令行：</p>
    <pre><code>npm i -g agency-orchestrator
ao web   # 图形界面，模板一键运行</code></pre>
    <p class="desc">支持 11 种大模型（推荐 DeepSeek，也有 7 种免 key 方式），全程本地运行、密钥不出机器。</p>
  </article>`;
  emit(join("workflows", slug), page({
    title: `${w.name} · AO 工作流模板`,
    description: (w.description ?? "").slice(0, 150),
    canonical: `${ORIGIN}/workflows/${encodeURI(slug)}/`,
    body,
  }));
  wfCount++;
}

// ── 创意库提示词页 ×229 + 分类索引页 ──
// 内容源自 CC BY 4.0 开源库（收录时已带作者/出处链），每页逐条署名 + 页脚许可声明。
// "XX 提示词" 是 AI 绘图领域搜索量最大的长尾词族之一，且每条都有完整正文（不是薄页）。
{
  const creative = JSON.parse(readFileSync(join(siteRoot, "src/content/creative-prompts.json"), "utf-8"));
  const cPrompts = creative.prompts ?? [];

  // 扩充池（1275 条，CC BY 4.0 + MIT）**只出精选**，不是全量出页。
  // 为什么不全出：那批提示词正文在 youmind.com / x.com / 上游仓库都公开，我们出的是副本；
  // 一次性放出上千个"标题是机翻中文、正文是别处原文"的页面，正是搜索引擎判定
  // programmatic thin content 的典型形态——而这个域名上还挂着 267 个真正原创的专家页，
  // 被连累不值得。每类取前 N 条（trending 源本身按互动量排过序，靠前的即热门），
  // 这些页有中文标题+中文描述+预览图+一键出图入口，是能独立回答一个搜索意图的。
  const EXTRA_PER_CAT_SEO = 15;
  let extraPrompts = [];
  try {
    const extra = JSON.parse(readFileSync(join(siteRoot, "src/content/creative-prompts-extra.json"), "utf-8"));
    const perCat = new Map();
    for (const p of extra.prompts ?? []) {
      const c = p.category || "其他";
      const arr = perCat.get(c) ?? [];
      if (arr.length >= EXTRA_PER_CAT_SEO) continue;
      // 出页要求：有中文标题（机翻已补）+ 有预览图。缺任一条就不是一个像样的落地页。
      if (!p.titleZh || !p.image) continue;
      arr.push({ ...p, title: p.titleZh, description: p.descZh || p.description || "", _extra: true });
      perCat.set(c, arr);
    }
    extraPrompts = [...perCat.values()].flat();
  } catch { /* 扩充池不存在就只出策展那批 */ }

  const catMap = new Map();
  for (const cp of [...cPrompts, ...extraPrompts]) {
    const c = cp.category || "其他";
    if (!catMap.has(c)) catMap.set(c, []);
    catMap.get(c).push(cp);
  }
  const catSlug = (c) => slugify(c) || "misc";
  const licenseLine = (creative.sources ?? [])
    .map((sc) => `<a href="${esc(sc.url)}">${esc(sc.name)}</a>（<a href="${esc(sc.licenseUrl)}">${esc(sc.license)}</a>）`)
    .join(" · ");

  for (const cp of [...cPrompts, ...extraPrompts]) {
    const cat = cp.category || "其他";
    const related = (catMap.get(cat) || []).filter((x) => x.id !== cp.id).slice(0, 8);
    const body = `
  <article class="card">
    <h1>${esc(cp.title)} —— AI 绘图提示词</h1>
    <p><a class="chip" href="/creative/c/${catSlug(cat)}/">${esc(cat)}</a>${cp.author ? `<span class="chip">by ${esc(cp.author)}</span>` : ""}</p>
    <p class="desc">${esc(cp.description ?? "")}</p>
    ${cp.image ? `<p><img src="${esc(cp.image)}" alt="${esc(cp.title)} 示例图" loading="lazy" style="max-width:100%;border-radius:10px;border:1px solid var(--line)"></p>` : ""}
    <h2>提示词（复制即用）</h2>
    <pre><code>${esc(cp.prompt ?? "")}</code></pre>
    <p class="desc">在 <a href="/creative">AO 创意库</a> 可以直接选服务商一键出图；或在工作流里用 <code>type: image</code> 步骤把它接进内容流水线。</p>
    <h2>署名与来源</h2>
    <p class="desc">${cp.author ? `作者：${cp.authorUrl ? `<a href="${esc(cp.authorUrl)}">${esc(cp.author)}</a>` : esc(cp.author)} · ` : ""}${
      cp._extra
        ? `收录自 <a href="https://github.com/jau123/nanobanana-trending-prompts">nanobanana-trending-prompts</a>（<a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>）与 <a href="https://github.com/YouMind-OpenLab/ai-image-prompts-skill">ai-image-prompts-skill</a>（MIT）。提示词正文为原文，中文标题与描述由本站翻译。`
        : `收录自 ${licenseLine}`
    }</p>
${related.length ? `
    <h2>同类提示词</h2>
    <ul class="plain">${related.map((r) => `<li><a href="/creative/p/${esc(r.id)}/">${esc(r.title)}</a></li>`).join("")}</ul>` : ""}
  </article>`;
    emit(join("creative", "p", cp.id), page({
      title: `${cp.title} · AI 绘图提示词`,
      description: (cp.description ?? "").slice(0, 150),
      canonical: `${ORIGIN}/creative/p/${cp.id}/`,
      body,
    }));
  }

  for (const [cat, items] of catMap) {
    const body = `
  <article class="card">
    <h1>${esc(cat)} —— AI 绘图提示词合集（${items.length} 条）</h1>
    <p class="desc">每条都可复制即用，也可以在 <a href="/creative">AO 创意库</a> 一键出图。收录自 ${licenseLine}。</p>
    <ol class="steps">${items.map((it) => `<li><a href="/creative/p/${esc(it.id)}/">${esc(it.title)}</a><span class="role">${esc((it.description ?? "").slice(0, 60))}</span></li>`).join("")}</ol>
  </article>`;
    emit(join("creative", "c", catSlug(cat)), page({
      title: `${cat} AI 绘图提示词合集 · Agency Orchestrator`,
      description: `${items.length} 条${cat}方向的 AI 绘图提示词，可复制即用或在 AO 创意库一键出图。`,
      canonical: `${ORIGIN}/creative/c/${catSlug(cat)}/`,
      body,
    }));
  }
  console.log(`✅ 创意库：${cPrompts.length} 策展 + ${extraPrompts.length} 扩充池精选（每类 ≤${EXTRA_PER_CAT_SEO}）= ${cPrompts.length + extraPrompts.length} 个提示词页 + ${catMap.size} 个分类页 → dist/creative/`);
}

// ── 评测基准页：EVAL_FINDINGS.md 原文上网（诚实评测是差异化资产——
//    大厂只能吹参数，我们连「什么时候没用」都写清楚）──
{
  const evalMd = join(repoRoot, "EVAL_FINDINGS.md");
  if (existsSync(evalMd)) {
    const mdHtml = marked.parse(readFileSync(evalMd, "utf-8"), { async: false });
    const body = `
  <article class="card eval-doc">
    <p class="chip">盲评 · 双向评审抵消位置偏置 · 多次取平均 · 持续更新</p>
    ${mdHtml}
    <h2>自己复现</h2>
    <pre><code>git clone https://github.com/jnMetaCode/agency-orchestrator
npm install && npm run eval</code></pre>
  </article>
  <style>
    .eval-doc h1 { font-size:24px; } .eval-doc h2 { font-size:18px; margin-top:28px; }
    .eval-doc table { border-collapse:collapse; width:100%; display:block; overflow-x:auto; font-size:14px; }
    .eval-doc th, .eval-doc td { border:1px solid var(--line); padding:6px 12px; text-align:left; }
    .eval-doc blockquote { margin:12px 0; padding:2px 16px; border-left:3px solid var(--accent); color:var(--muted); }
  </style>`;
    emit("evals", page({
      title: "多智能体什么时候真的有用——盲评数据 · Agency Orchestrator",
      description: "AO 的公开质量评测：多角色协作 vs 单次 prompt，盲评、双向评审、多次平均。结论是 Goldilocks 非单调——中档模型（DeepSeek）上多智能体明显更好，极弱模型上反而更差。含复现方法与边界说明。",
      canonical: `${ORIGIN}/evals/`,
      body,
    }));
    console.log("✅ 评测基准页 → dist/evals/");
  }
  // 英文版（面向 HN / 英文搜索）：内容源是人工写的 evals.en.md，不是机器翻译
  const evalEn = join(siteRoot, "src/content/evals.en.md");
  if (existsSync(evalEn)) {
    const mdHtml = marked.parse(readFileSync(evalEn, "utf-8"), { async: false });
    const body = `
  <article class="card eval-doc">
    <p class="chip">Blind judging · position-debiased · multi-run averaged · living document</p>
    ${mdHtml}
  </article>
  <style>
    .eval-doc h1 { font-size:24px; } .eval-doc h2 { font-size:18px; margin-top:28px; }
    .eval-doc table { border-collapse:collapse; width:100%; display:block; overflow-x:auto; font-size:14px; }
    .eval-doc th, .eval-doc td { border:1px solid var(--line); padding:6px 12px; text-align:left; }
    .eval-doc blockquote { margin:12px 0; padding:2px 16px; border-left:3px solid var(--accent); color:var(--muted); }
  </style>`;
    emit(join("en", "evals"), page({
      title: "When do multi-agent pipelines beat a single prompt? · Agency Orchestrator",
      description: "Blind-judged evals of multi-agent vs one-shot prompting. The result is non-monotonic: mid-tier models (DeepSeek) gain clearly from multi-agent; very weak models get worse; frontier models tie. Full data, bugs found, limits, and how to reproduce.",
      canonical: `${ORIGIN}/en/evals/`,
      body,
      lang: "en",
    }));
    console.log("✅ English evals page → dist/en/evals/");
  }
}

// ── sitemap：核心路由 + 全部生成页 ──
const core = ["", "experts", "creative", "prompt", "studio", "docs", "tutorials", "sponsors", "changelog"]
  .map((p) => `${ORIGIN}/${p}${p ? "" : ""}`);
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${core.map((u) => `  <url><loc>${u || ORIGIN + "/"}</loc><changefreq>weekly</changefreq><priority>0.9</priority></url>`).join("\n")}
${urls.map((u) => `  <url><loc>${encodeURI(u)}</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>`).join("\n")}
</urlset>
`;
writeFileSync(join(dist, "sitemap.xml"), xml, "utf-8");

console.log(`✅ SEO 静态页：${roleCount} 个专家页 + ${wfCount} 个工作流页 + sitemap（共 ${urls.length + core.length} 条 URL）→ dist/`);
