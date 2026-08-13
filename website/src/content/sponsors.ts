import type { Language } from "@/i18n/translations";

/**
 * 赞助商数据。
 *
 * 当前赞助商：APINEBULA（旗舰，银河录像局旗下 AI 聚合平台）、优云智算（UCloud 旗下 AI 云平台）、Cubence（API 中转服务商）、火山引擎（字节跳动云服务，中英文分别对应 volcengine.com / byteplus.com 两个不同站点）、多元探索（AI 模型 API 聚合与源头直供）、AICodeMirror（Claude / Codex / Gemini 官方高稳定中转）。
 * 均为真实付费赞助，非占位样例。新增赞助商时按 Sponsor 结构追加即可。
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
    id: "duoyuanx",
    name: "多元探索",
    badge: "DX",
    accent: "from-zinc-800 to-zinc-500",
    logo: "/sponsors/logo-duoyuanx-icon.png",
    url: "https://duoyuanx.com/register?aff=LErO",
    tier: "standard",
    since: "2026-07",
    featured: false,
    tagline: {
      zh: "全球 AI 模型 API 聚合与源头直供 · 一次接入调用数百款主流模型",
      en: "Global AI model API aggregation & first-hand supply · one integration, hundreds of models",
    },
    description: {
      zh: "感谢多元探索赞助本项目！多元探索专注全球 AI 模型 API 聚合与源头直供服务，已与多家头部科技企业建立合作，汇集 OpenAI、Claude、Gemini、DeepSeek 等数百款主流模型。平台构建统一、稳定、安全、高性价比的服务体系，实现一次接入、多模型调用，持续提升使用效率并优化算力成本；同时提供企业级解决方案、专业技术支持与快速客服响应，为每一次 AI 调用提供可靠保障。",
      en: "Thanks to DuoyuanX (多元探索) for sponsoring this project! DuoyuanX focuses on global AI model API aggregation and first-hand supply, partnering with leading tech companies to bring together hundreds of mainstream models including OpenAI, Claude, Gemini and DeepSeek. The platform delivers a unified, stable, secure and cost-effective service — integrate once and call any model — continuously improving efficiency and optimizing compute costs, with enterprise solutions, professional technical support and fast customer service backing every AI call.",
    },
    perk: {
      zh: "专属链接注册立获 3 元免费测试额度，充值 100 元以上返现 10%（找客服领取）",
      en: "¥3 free trial credit on sign-up via our link, plus 10% cashback on top-ups over ¥100 (via support)",
    },
  },
  {
    id: "aicodemirror",
    name: "AICodeMirror",
    badge: "✕",
    accent: "from-orange-500 to-amber-400",
    logo: "/sponsors/logo-aicodemirror-icon.svg",
    url: "https://www.aicodemirror.ai/register?invitecode=XO5L7R",
    tier: "standard",
    since: "2026-08",
    featured: false,
    tagline: {
      zh: "Claude / Codex / Gemini 官方高稳定中转 · Codex 官方渠道低至 0.7 折",
      en: "Highly reliable official relay for Claude / Codex / Gemini · Codex from 7% of list price",
    },
    description: {
      zh: "感谢 AICodeMirror 赞助了本项目！AICodeMirror 提供 Claude / Codex / Gemini 官方高稳定中转服务，支持企业级高并发、极速开票、7×24 专属技术支持。Codex 官方渠道低至 0.7 折，充值更有折上折！",
      en: "Thanks to AICodeMirror for sponsoring this project! AICodeMirror provides highly reliable official relay services for Claude, Codex, and Gemini, supporting enterprise-grade concurrency, fast invoice issuance, and dedicated 24/7 technical support. Official Codex access is available for as little as 7% of the standard price, with additional discounts on account top-ups!",
    },
    perk: {
      zh: "AICodeMirror 为本项目用户提供特别福利：通过专属链接注册，可享首充 8 折",
      en: "Exclusive benefit for users of this project: register through our link to receive 20% off your first top-up",
    },
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
    id: "volcengine",
    name: "火山引擎",
    badge: "🌋",
    accent: "from-blue-600 to-cyan-400",
    logo: {
      zh: "/sponsors/logo-volcengine-icon.png",
      en: "/sponsors/logo-byteplus-icon.png",
    },
    url: {
      zh: "https://www.volcengine.com/activity/ai618?utm_campaign=hw&utm_content=hw&utm_medium=devrel_tool_web&utm_source=OWO&utm_term=agency-agents-zh",
      en: "https://www.byteplus.com/en/product/modelark?utm_campaign=hw&utm_content=jnMetaCode&utm_medium=devrel_tool_web&utm_source=OWO&utm_term=jnMetaCode",
    },
    tier: "standard",
    since: "2026-07",
    featured: false,
    tagline: {
      zh: "豆包大模型限时 5 折起 · 编程模型套餐 2.5 折订阅",
      en: "Dola Seed 2.0 — ByteDance's full-modal general large model, on the ModelArk platform",
    },
    description: {
      zh: "感谢火山引擎赞助了本项目！火山引擎AI巅峰盛惠来袭！豆包大模型限时5折起，19元即可入手约440万Tokens文本模型，新客首单再享AI统一节省计划。从文本生成、图像创作到视频合成、语音复刻，全模态AI能力一站式配齐。开发者专属编程模型套餐2.5折订阅，支持Kimi-K2.7、GLM-5.2等主流模型。",
      en: "Thanks to Dola Seed for sponsoring this project! Dola Seed 2.0 is a full-modal general large model independently developed by ByteDance for the global market. Built on a unified multimodal architecture, it supports joint understanding and generation of text, images, audio and video. It natively enables agent collaboration, with strong reasoning, long-task execution, tool integration and coding capabilities — widely applicable to smart cockpits, personal assistants, education, customer support, marketing, retail and more. It excels in multimodal perception, end-to-end complex task delivery, stable interaction and data security, and is readily accessible and deployable via the ModelArk platform.",
    },
    perk: {
      zh: "注册即领2500万Tokens，立即访问火山引擎活动页面抢购。",
      en: "Register via the link to get 500,000 tokens of free inference quota per model",
    },
  },
  {
    id: "youyun",
    name: "优云智算",
    badge: "☁️",
    accent: "from-sky-500 to-indigo-500",
    logo: "/sponsors/logo-compshare-icon.png",
    url: "https://passport.compshare.cn/register?referral_code=ETD3L5JBM13CtKARkMORot&ytag=GPU_YY_YX_git_agency-agents",
    tier: "standard",
    since: "2026-06",
    featured: false,
    tagline: {
      zh: "UCloud 旗下 AI 云平台 · 高性价比国产模型 Agent Plan",
      en: "AI cloud platform by UCloud · cost-effective Agent Plans",
    },
    description: {
      zh: "感谢优云智算赞助了本项目！优云智算是 UCloud 旗下 AI 云平台，主打包月、按次的高性价比国产模型 Agent Plan 套餐，低至 49 元/月起。同时提供官转稳定海外模型，支持接入 Claude Code、Codex 及 API 调用。企业级高并发、7×24 技术支持、自助开票。",
      en: "Thanks to CompShare (优云智算) for sponsoring this project! CompShare is UCloud's AI cloud platform, offering cost-effective monthly / pay-per-call Agent Plans for Chinese models from ¥49/mo, plus stable official relays for overseas models. Works with Claude Code, Codex and direct API calls — with enterprise-grade concurrency, 24/7 support and self-service invoicing.",
    },
    perk: {
      zh: "新用户注册立得 5 元平台体验金",
      en: "¥5 free platform credit for new sign-ups",
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
