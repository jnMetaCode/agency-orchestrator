import type { Language } from "@/i18n/translations";

/**
 * 赞助商数据。
 *
 * 均为真实付费赞助，非占位样例。新增赞助商时按 Sponsor 结构追加即可。
 * 已下架：优云智算、火山引擎（2026-10-16）、秘塔科技（2026-10-08）、RootFlowAI、CCSub（2026-08）、多元探索（2026-08-17，赞助到期）、AICodeMirror（2026-09-14）——赞助身份与
 * 曝光位一并摘除，但它们在 Studio 里仍是可用供应商（已配过 key 的用户不该被搞坏）。
 */

export type SponsorTier = "flagship" | "standard";

export type LocalizedText = Record<Language, string>;

export interface Sponsor {
  id: string;
  name: string;
  /** 没有 logo 时用作头像的文字/emoji */
  badge: string;
  /** 头像底色（tailwind 渐变类），可选 */
  accent?: string;
  /** 小 logo 图（public 目录下的路径），优先于 badge 作为头像。中英文品牌不同时传 LocalizedText（如火山引擎/BytePlus） */
  logo?: string | LocalizedText;
  /** 横版品牌图使用更宽的白色承载区，避免暗色主题下深色字标看不清 */
  logoShape?: "square" | "wide";
  /** 大屏 banner 图（public 目录下的路径）。旗舰赞助商用,全宽展示 */
  banner?: string;
  /** 跳转链接。多数赞助商中英文共用同一个链接；少数品牌中国大陆站点和国际站点是不同域名（如火山引擎/BytePlus），此时传 LocalizedText，按当前语言取值 */
  url: string | LocalizedText;
  tier: SponsorTier;
  tagline: LocalizedText;
  description: LocalizedText;
  perk?: LocalizedText;
  /** 旗舰大屏卡片的 CTA 按钮文案，缺省时退回 tagline */
  perkCta?: LocalizedText;
  couponCode?: string;
  since?: string;
  featured?: boolean;
  /** 占位/推荐样例数据，非真实付费赞助 */
  placeholder?: boolean;
}

export const sponsors: Sponsor[] = [

  {
    id: "apinebula",
    name: "APINEBULA",
    badge: "🌌",
    accent: "from-violet-600 to-indigo-500",
    logo: "/sponsors/logo-apinebula-icon.png",
    banner: "/sponsors/banner-apinebula.jpeg",
    url: "https://apinebula.ai/V6ekjG",
    tier: "flagship",
    since: "2026-06",
    featured: true,
    tagline: {
      zh: "银河录像局旗下企业级 AI 聚合平台 · Claude / GPT / Gemini 满血模型低至 1 折",
      en: "Enterprise AI aggregation platform · Claude / GPT / Gemini at up to 90% off",
    },
    description: {
      zh: "感谢 APINEBULA 大屏赞助本项目！APINEBULA 是银河录像局旗下的企业级 AI 聚合平台，背靠大平台资源，面向开发者、团队与企业用户提供稳定、高性价比的大模型 API 接入服务。平台聚合 Claude、GPT、Gemini 等主流满血模型，一个接口接入全球顶尖 AI 大模型，各大模型价格低至 1 折起，支持企业级高并发、正式合同、对公打款与开票服务，适合 AI 编程、Agent 开发、业务系统集成等多种场景！",
      en: "Thanks to APINEBULA for sponsoring this project! APINEBULA is an enterprise-grade AI aggregation platform under Galaxy Video Bureau, backed by strong platform resources. It provides developers, teams and enterprises with stable, cost-effective large-model API access. The platform aggregates full-capability mainstream models including Claude, GPT and Gemini — with one unified API, access top global AI models at prices as low as 10% of the official rate. It also supports enterprise-grade high concurrency, formal contracts, corporate payments and invoicing, making it suitable for AI coding, Agent development, business-system integration and more.",
    },
    perk: {
      zh: "注册并在充值时填写优惠码 agent，可享九折优惠",
      en: "Use coupon code agent at recharge for a 10% discount",
    },
    perkCta: {
      zh: "使用专属优惠访问",
      en: "Get the exclusive offer",
    },
    couponCode: "agent",
  },
  {
    id: "cubence",
    name: "Cubence",
    badge: "CB",
    accent: "from-slate-700 to-slate-500",
    logo: "/sponsors/logo-cubence-icon.png",
    url: "https://cubence.com/signup?code=SCW29JP9&source=agency",
    tier: "standard",
    since: "2026-07",
    featured: false,
    tagline: {
      zh: "专业 API 中转服务商 · 稳定高效接入 Claude Code / Codex / Gemini",
      en: "Professional API relay service · stable access to Claude Code / Codex / Gemini",
    },
    description: {
      zh: "感谢 Cubence 对本项目的支持。Cubence 是一家致力为客户提供稳定、高效的 API 中转服务商。从 25 年 9 月运营至今，提供了 Claude Code、Codex、Gemini 等多种模型支持。",
      en: "Thanks to Cubence for supporting this project! Cubence is dedicated to providing customers with stable, efficient API relay services. Operating since September 2025, it supports Claude Code, Codex, Gemini and more.",
    },
    perk: {
      zh: "首次购买享 9 折优惠",
      en: "10% off your first purchase",
    },
    couponCode: "AGENCY",
  },
  {
    id: "shengsuanyun",
    name: "胜算云",
    badge: "SS",
    accent: "from-indigo-600 to-violet-500",
    logo: "/sponsors/logo-shengsuanyun-icon.png",
    url: "https://www.shengsuanyun.com/?from=CH_QKH696UI",
    tier: "standard",
    since: "2026-08",
    featured: false,
    tagline: {
      zh: "面向 AI 原生团队的模型 API 聚合 · 合规直供 + 企业级定制网关",
      en: "Model API aggregation for AI-native teams · compliant supply + enterprise gateway",
    },
    description: {
      zh: "感谢胜算云对本项目的赞助！胜算云是面向 AI 原生团队的模型 API 聚合平台，汇集 Claude、ChatGPT、Gemini 等海内外大语言模型及多媒体模型，支持统一接入与按量调用。平台坚持合规 API 服务，杜绝逆向工程和资源稀释。此外平台提供企业级定制网关，包括团队成本与权限管理、智能路由、安全防护及 BYOK 密钥托管，并提供发票服务。",
      en: "Thanks to ShengSuanYun for sponsoring this project! ShengSuanYun is a model API aggregation platform built for AI-native teams, bringing together Claude, ChatGPT, Gemini and other Chinese and international LLMs plus multimedia models under one integration with pay-as-you-go billing. It sticks to compliant API supply — no reverse engineering, no resource dilution — and offers an enterprise-grade custom gateway with team cost and permission controls, smart routing, security protection, BYOK key custody and invoicing.",
    },
    perk: {
      zh: "新用户通过专属链接注册，即可领取 5 元 Token 体验额度",
      en: "New users get ¥5 in token credit when signing up via our link",
    },
  },
  {
    id: "astraflow",
    name: "星图 AstraFlow",
    badge: "✦",
    accent: "from-indigo-500 to-violet-500",
    logo: "/sponsors/logo-astraflow.png",
    url: "https://www.ucloud.cn/site/active/astraflow-credit?cps_code=ASUZ5FRlJfFEoXQDPQAv8v&ytag=geo_waituo_agencyagentszh",
    tier: "standard",
    since: "2026-10",
    featured: false,
    tagline: {
      zh: "UCloud 出品 · 视频与 200+ 大模型一站式调用",
      en: "By UCloud · one platform for video generation and 200+ AI models",
    },
    description: {
      zh: "感谢星图 AstraFlow 赞助本项目！星图由上市公司 UCloud 出品，聚合 MiniMax-H3、Seedance 2.5 等主流视频生成模型，以及 DeepSeek、Kimi、Qwen、GLM、GPT、Claude 等 200+ 大模型，文案与视频生成一个平台全搞定，无需多端注册、多处对接。新模型上线当天即可接入，支持按 Key 级别计费，调用明细全程可查。通过本项目专属推广链接注册，即可领取 50 元算力金，开箱即用！",
      en: "Thanks to AstraFlow for sponsoring this project! Built by publicly listed UCloud, AstraFlow brings together video generation models such as MiniMax-H3 and Seedance 2.5, plus 200+ AI models including DeepSeek, Kimi, Qwen, GLM, GPT and Claude. Generate text and video on one platform without managing multiple registrations and integrations. Access new models on launch day, with per-key billing and transparent usage records. Register through our exclusive link to claim ¥50 in compute credit and get started!",
    },
    perk: {
      zh: "专属链接注册，领取 50 元算力金",
      en: "Register via our link to claim ¥50 in compute credit",
    },
  },
  {
    id: "apixo",
    name: "APIXO AI",
    badge: "A",
    logo: { zh: "/sponsors/apixo-ai-zh.jpg", en: "/sponsors/apixo-ai-en.jpg" },
    logoShape: "wide",
    url: "https://apixo.ai/models/seedream-5-5?utm_source=github&utm_medium=sponsorship&utm_campaign=github_readme&utm_content=jnmetacode_agency-agents-zh",
    tier: "standard",
    since: "2026-11",
    featured: false,
    tagline: {
      zh: "AI 图片与视频创作｜黑五特惠",
      en: "AI Image & Video Creation | Black Friday Deals",
    },
    description: {
      zh: "感谢 APIXO 赞助本项目！无需编程，在 APIXO 网页端即可生成 AI 图片与视频，也可通过 API 接入自己的应用与自动化工作流。黑五期间，seedream5.5仅 $0.014/张，原价 $0.02/张，限时 7 折。指定模型与规格较活动页列示的市场参考价最高省 66%，优惠自动生效，无需优惠码。活动截至北京时间 2026 年 12 月 31 日 23:59。",
      en: "Thanks to APIXO for sponsoring this project! Create AI images and videos in your browser with no coding required, or use the API to connect your apps and automated workflows. For Black Friday, Seedream 5.5 is just $0.014/image, down from $0.02—30% off. Selected models and specifications are up to 66% below the market reference prices listed on the campaign page. Discounts apply automatically; no promo code needed. Ends December 31, 2026 at 23:59 Beijing time (UTC+8).",
    },
    perk: {
      zh: "查看 APIXO 黑五优惠 →",
      en: "Explore APIXO Black Friday Deals →",
    },
  },

  {
    id: "beichenapi",
    name: "北辰 API",
    badge: "北",
    logo: "/sponsors/logo-beichenapi.jpg",
    url: "https://beichenapi.com/register?aff=RM34GKKSY7EC",
    tier: "standard",
    since: "2026-11",
    featured: false,
    tagline: {
      zh: "稳定、高效的多模型 API 聚合服务",
      en: "Stable, efficient multi-model API aggregation",
    },
    description: {
      zh: "感谢北辰 API 赞助本项目！北辰 API 提供稳定、高效的多模型 API 聚合服务，支持 DeepSeek、GPT-6.1、Gemini 4A / 4C、Kimi K3.1 Pro 等主流模型，适用于 AI 编程、Agent 开发及多模型调用场景。平台目前已上线 Kimi K3.1 Pro、GPT-6.1 Terra、Gemini 4A / 4C，并提供自建 Gemini / GPT / DS 号池，接入便捷，适合开发者与团队使用。通过此链接注册即可了解更多服务信息。",
      en: "Thanks to Beichen API for sponsoring this project! Beichen API provides stable, efficient multi-model API aggregation, supporting DeepSeek, GPT-6.1, Gemini 4A / 4C and Kimi K3.1 Pro for AI coding, agent development and multi-model applications. The platform offers Kimi K3.1 Pro, GPT-6.1 Terra and Gemini 4A / 4C, with self-managed Gemini / GPT / DS account pools and easy integration for developers and teams. Register through our link to learn more.",
    },
    perk: {
      zh: "通过专属链接注册，了解更多服务信息",
      en: "Register via our link to learn more",
    },
  },

];

export function sponsorsByTier(tier: SponsorTier) {
  return sponsors.filter((s) => s.tier === tier);
}

export function sponsorUrl(sponsor: Pick<Sponsor, "url">, lang: Language): string {
  return typeof sponsor.url === "string" ? sponsor.url : sponsor.url[lang];
}

export function sponsorLogo(sponsor: Pick<Sponsor, "logo">, lang: Language): string | undefined {
  return typeof sponsor.logo === "string" || sponsor.logo === undefined ? sponsor.logo : sponsor.logo[lang];
}
