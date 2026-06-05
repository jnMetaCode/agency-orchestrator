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
| `/sponsors` | 赞助商 | 分档展示 + 权益对比表 + 收益 + FAQ + 成为赞助商 |
| `/docs` | 文档 | 安装 / compose / run / resume / YAML 结构 |
| `/tutorials` | 教程 | 常见场景入口（指向仓库） |

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

> 当前为「首发推荐 provider」种子数据（DeepSeek / 硅基流动），是诚实的展示样例，
> **不编造付费关系或假优惠码**。接到真实赞助商后替换即可。

文案统一在 [`src/i18n/translations.ts`](src/i18n/translations.ts) 维护（zh / en 双语）。

## 部署

纯静态 SPA，任意静态托管均可：

- **Vercel / Netlify / Cloudflare Pages**：根目录 `website`，构建命令 `npm run build`，产物目录 `dist`。
  SPA 路由回退已配好（`vercel.json` rewrites / `public/_redirects`）。
- **GitHub Pages**：`npm run build` 后把 `dist/` 推到 Pages 分支；SPA 深链需额外复制
  `index.html` 为 `404.html`。
