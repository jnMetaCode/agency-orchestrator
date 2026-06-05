import type { Language } from "@/i18n/translations";

/**
 * 赞助商数据。
 *
 * 目前为「首发推荐 provider」种子数据——这些是 AO README 里真实支持、且与 DeepSeek 甜区
 * 定位契合的模型 / API 服务商，作为诚实的展示样例，不编造付费关系或假优惠码。
 *
 * 接到真实赞助商后：
 *   1. 在下面新增 Sponsor 条目，tier 设为 'flagship' 或 'standard'；
 *   2. 有专属优惠码就填 couponCode，否则留空；
 *   3. 把 placeholder 设为 false（或删除该字段）。
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
    id: "deepseek",
    name: "DeepSeek",
    badge: "🐬",
    accent: "from-indigo-500 to-blue-500",
    url: "https://platform.deepseek.com/",
    tier: "standard",
    since: "2026-06",
    featured: true,
    placeholder: true,
    tagline: {
      zh: "AO 默认推荐的性价比甜区模型",
      en: "AO's recommended price-quality sweet spot",
    },
    description: {
      zh: "DeepSeek 是 AO 默认推荐的 provider——够强又不贵。我们的盲评显示，正是在这一档上，多智能体协作的产出明显优于单次 prompt。充值少量即可跑很久。",
      en: "DeepSeek is AO's recommended provider — capable yet cheap. Our blind evals show this is exactly the tier where multi-agent collaboration beats a one-shot prompt. A small top-up runs a long way.",
    },
    perk: {
      zh: "AO 工作流默认 provider，开箱即用",
      en: "Default provider for AO workflows, works out of the box",
    },
  },
  {
    id: "siliconflow",
    name: "硅基流动 SiliconFlow",
    badge: "🧊",
    accent: "from-sky-500 to-cyan-500",
    url: "https://siliconflow.cn/",
    tier: "standard",
    since: "2026-06",
    placeholder: true,
    tagline: {
      zh: "OpenAI 兼容的多模型聚合平台",
      en: "OpenAI-compatible multi-model platform",
    },
    description: {
      zh: "硅基流动提供 OpenAI 兼容接口，可一键接入 DeepSeek-V3 等多种模型。在 AO 里通过 base_url 即可作为自定义 provider 使用。",
      en: "SiliconFlow offers an OpenAI-compatible endpoint with one-click access to DeepSeek-V3 and more. Plug it into AO as a custom provider via base_url.",
    },
    perk: {
      zh: "OpenAI 兼容，配置 base_url 即可接入",
      en: "OpenAI-compatible — set base_url to connect",
    },
  },
];

export function sponsorsByTier(tier: SponsorTier) {
  return sponsors.filter((s) => s.tier === tier);
}
