# Agency Orchestrator — 官网 (website)

AO 的对外营销官网。技术栈对齐参考站 [ccswitch.io](https://ccswitch.io)：
**React 18 + Vite + TailwindCSS + Radix + framer-motion + react-router**，纯静态 SPA，中英双语。

> 注意：本目录是**对外官网**，和仓库根的 `web/`（本地交互式控制台）是两回事。

## 开发

```bash
cd website
npm install
npm run dev        # http://localhost:5273
npm run build      # 产物在 dist/
npm run preview    # 本地预览构建产物
npm run typecheck
```

## 页面

| 路由 | 页面 | 说明 |
|------|------|------|
| `/` `/en` | 首页 | Hero + 一句话演示 + 能力 + provider + 赞助商条 + CTA |
| `/studio` | Studio | 网页 GUI（在线需本地引擎；公开站离线 → 纯前端演示） |
| `/experts` | 专家库 | 公开浏览 agency-agents 全部专家（静态，免后端，可搜索/筛选） |
| `/sponsors` | 赞助商 | 分档展示 + 虚位以待 + 福利表 + FAQ + 成为赞助商 |
| `/docs` `/docs/:slug` | 文档 | 三栏（导航+正文+本页目录），安装/compose/run/YAML/角色/provider |
| `/tutorials` `/tutorials/:slug` | 攻略 | 分类筛选 + 站内详情页 |
| `/changelog` | 更新日志 | 站内渲染仓库根 `CHANGELOG.md` |

中英文通过路径前缀切换：中文无前缀（`/sponsors`），英文加 `/en`（`/en/sponsors`）。

## 维护赞助商

赞助商是**数据驱动**的，编辑 [`src/content/sponsors.ts`](src/content/sponsors.ts) 即可：

```ts
{
  id: "your-id",
  name: "服务商名称",
  badge: "🚀",                 // 没有 logo 时的头像文字/emoji
  url: "https://...",
  tier: "flagship",            // flagship | standard
  tagline: { zh: "...", en: "..." },
  description: { zh: "...", en: "..." },
  perk: { zh: "...", en: "..." },
  couponCode: "AO",            // 有专属优惠码就填，否则删掉
}
```

> 当前真实赞助商：优云智算 CompShare。文案统一在
> [`src/i18n/translations.ts`](src/i18n/translations.ts) 维护（zh / en 双语）。

## 维护专家库页（/experts）

专家数据由脚本从角色库**预生成并提交**（CF 构建时没有 zh 角色库依赖，故走提交的 JSON）：

```bash
npm run gen:experts   # 读 ../node_modules/agency-agents-zh + ../agency-agents → src/content/experts.json
```

角色库有更新时本地重跑一次并提交 `src/content/experts.json` 即可。

## 部署（推荐 Cloudflare Pages）

纯静态 SPA。**Cloudflare Pages**（在面板连接本仓库）：

- **Root directory（根目录）**：`website`
- **Build command**：`npm run build`
- **Build output directory**：`dist`
- SPA 路由回退：`public/_redirects` 已配好（CF 原生支持）
- ⚠️ 更新日志页构建时会读**仓库根的 `CHANGELOG.md`**（`?raw` 内联）——CF 默认检出整个仓库，根目录设为 `website` 即可正常读到。务必整仓库部署，不要单独抽 `website/`。

> Vercel 同理（已带 `vercel.json` 的 SPA rewrite，根目录设 `website`）。
> GitHub Pages 对该 SPA 最麻烦（需 404.html 回退 + 子路径 base + CHANGELOG 走 Action），不推荐。
