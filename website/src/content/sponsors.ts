import type { Language } from "@/i18n/translations";

/**
 * 赞助商数据。
 *
 * 当前唯一赞助商：优云智算（UCloud 旗下 AI 云平台）。
 * 真实付费赞助，非占位样例。新增赞助商时按 Sponsor 结构追加即可。
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
  /** 小 logo 图（public 目录下的路径），优先于 badge 作为头像 */
  logo?: string;
  url: string;
  tier: SponsorTier;
  tagline: LocalizedText;
  description: LocalizedText;
  perk?: LocalizedText;
  couponCode?: string;
  since?: string;
  featured?: boolean;
  /** 占位/推荐样例数据，非真实付费赞助 */
  placeholder?: boolean;
}

export const sponsors: Sponsor[] = [
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
