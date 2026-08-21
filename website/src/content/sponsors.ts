import type { Language } from "@/i18n/translations";

/**
 * 赞助商数据。
 *
 * 当前赞助商：APINEBULA（旗舰，银河录像局旗下 AI 聚合平台）、优云智算（UCloud 旗下 AI 云平台）、Cubence（API 中转服务商）、火山引擎（字节跳动云服务，中英文分别对应 volcengine.com / byteplus.com 两个不同站点）、AICodeMirror（Claude / Codex / Gemini 官方高稳定中转）、LanoX AI（全球模型聚合，500+ 模型）、胜算云（面向 AI 原生团队的模型 API 聚合 + 企业级网关）、APIMart（AI 图片/视频生成低价 API）。
 * 均为真实付费赞助，非占位样例。新增赞助商时按 Sponsor 结构追加即可。
 * 已下架：RootFlowAI、CCSub（2026-08）、多元探索（2026-08-17，赞助到期）——赞助身份与
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
  {
    id: "lanox",
    name: "LanoX AI",
    badge: "LX",
    accent: "from-blue-600 to-violet-500",
    logo: "/sponsors/logo-lanox-icon.png",
    url: "https://lanox.ai/?c=X3RD38F7&inviteCode=A3HRUB6M",
    tier: "standard",
    since: "2026-08",
    featured: false,
    tagline: {
      zh: "全球模型接入 · 500+ 免费模型，顶级模型低至官方价 1 折起",
      en: "Global model access · 500+ free models, top-tier models from 10% of list price",
    },
    description: {
      zh: "感谢 LanoX AI 赞助了本项目！LanoX AI 为开发者、团队与企业提供稳定、高性价比的全球模型接入服务：GPT、Claude、Gemini、Qwen、Grok 等全球主流模型，以及 Seedance 2.0、GPT Image、Gemini Nano Banana 等多模态创作能力。企业级稳定服务——高可用、原生能力输出、不降智、不混模、调用与计费透明；顶级模型低至官方价 1 折起，文档清晰、接入简单、支持开票与企业批量调用，适用于 AI 产品、Agent、内容平台与研发团队的批量调用场景。",
      en: "Thanks to LanoX AI for sponsoring this project! LanoX AI provides stable, cost-effective global model access for developers, teams and enterprises: mainstream models including GPT, Claude, Gemini, Qwen and Grok, plus multimodal creation with Seedance 2.0, GPT Image and Gemini Nano Banana. Enterprise-grade reliability — high availability, native capability output, no intelligence degradation, no model mixing, transparent usage and billing. Top-tier models start from 10% of official pricing, with clear documentation, simple integration, invoicing support and enterprise-scale batch usage — ideal for AI products, agents, content platforms and R&D teams.",
    },
    perk: {
      zh: "注册即送 5 美金，免费领取百万 Token，另有 500+ 免费模型可用",
      en: "Sign up for $5 in free credit, claim millions of free tokens, plus 500+ free models",
    },
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
    id: "apimart",
    name: "APIMart",
    badge: "M",
    accent: "from-neutral-800 to-neutral-500",
    logo: "/sponsors/logo-apimart-icon.png",
    url: "https://go.apimart.ai/gh-agency-agents-zh",
    tier: "standard",
    since: "2026-08",
    featured: false,
    tagline: {
      zh: "AI 图片/视频生成低价 API · GPT-Image-2 低至 $0.006/张",
      en: "Low-cost API for AI image & video generation · GPT-Image-2 from $0.006/image",
    },
    description: {
      zh: "感谢 APIMart 赞助了本项目！APIMart 是专注 AI 图片/视频生成的低价 API 平台，GPT-Image-2 低至 $0.006/张，1 美元可出图 160+ 张。图片、视频一套异步 API 通吃，提交任务拿 ID、回调取结果，跑批万张不超时、换模型不改代码。按量付费、无月费，通过此注册链接注册即可开用。",
      en: "Thanks to APIMart for sponsoring this project! APIMart is a low-cost API platform for AI image & video generation — GPT-Image-2 from $0.006/image, 160+ images per dollar. One async API covers both image and video: submit a task, get an ID, fetch results via polling or callback. Batch tens of thousands of images without timeouts, switch models without changing code. Pay-as-you-go with no monthly fee — sign up here to get started.",
    },
    perk: {
      zh: "按量付费、无月费，1 美元可出图 160+ 张，通过专属链接注册即可开用",
      en: "Pay-as-you-go with no monthly fee — 160+ images per dollar; sign up via our link to start",
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
