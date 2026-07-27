/**
 * 赞助商曝光位——CLI 与 web 服务共用这份数据。
 *
 * 档位规则（2026-07-17 与赞助商约定）：
 * - 进阶档（多元探索）的定制权益 = **默认 provider 位**（Studio 下拉默认选中 +
 *   服务端 AO_PROVIDER 兜底 + 无凭证响应的 provider 字段）——不再占引导横幅
 * - 无凭证引导横幅/CLI ② 路径 = 其余 6 家（旗舰 APINEBULA + 5 家标准）按自然日
 *   轮换，每天显示相邻 2 家：等份轮值、确定性、可向赞助商解释份额（每家 2/6 天数）
 */

export interface SponsorGuideEntry {
  /** AO 内的 provider id（引导示例命令用） */
  providerId: string;
  name: string;
  bonus?: string;
  url: string;
}

/** 进阶档（默认 provider 位持有者，provider id: duoyuanx）。不进横幅轮换。 */
export const PREMIUM_SPONSOR: SponsorGuideEntry = {
  providerId: 'duoyuanx',
  name: '多元探索',
  bonus: '注册送 3 元',
  url: 'https://duoyuanx.com/register?aff=LErO',
};

/** 引导横幅轮换池：旗舰 + 标准共 6 家（顺序无偏好，轮值即公平） */
export const SPONSOR_ROTATION: SponsorGuideEntry[] = [
  { providerId: 'apinebula', name: 'APINEBULA', bonus: '充值码 agent 九折', url: 'https://apinebula.ai/V6ekjG' },
  { providerId: 'ccsub', name: 'CCSub', bonus: '注册送 $5', url: 'https://www.ccsub.net/register?ref=8G5W4JK4' },
  { providerId: 'cubence', name: 'Cubence', bonus: '首购 9 折', url: 'https://cubence.com/signup?code=SCW29JP9&source=agency' },
  { providerId: 'compshare', name: '优云智算', bonus: '注册送 5 元', url: 'https://passport.compshare.cn/register?referral_code=ETD3L5JBM13CtKARkMORot&ytag=GPU_YY_YX_git_agency-agents' },
  { providerId: 'volcengine', name: '火山引擎', bonus: '注册领 2500 万 Tokens', url: 'https://www.volcengine.com/activity/ai618?utm_campaign=hw&utm_content=hw&utm_medium=devrel_tool_web&utm_source=OWO&utm_term=agency-agents-zh' },
  { providerId: 'rootflowai', name: 'RootFlowAI', bonus: '进群领 $10', url: 'https://rootflowai.com/register?utm_source=agency-agents-zh&utm_medium=sponsor&utm_campaign=web' },
];

/** 当天轮值的赞助商（按自然日取相邻 count 家，默认 2 家） */
export function rotatingSponsors(count = 2, now: number = Date.now()): SponsorGuideEntry[] {
  const start = Math.floor(now / 86_400_000) % SPONSOR_ROTATION.length;
  return Array.from({ length: Math.min(count, SPONSOR_ROTATION.length) }, (_, i) =>
    SPONSOR_ROTATION[(start + i) % SPONSOR_ROTATION.length]);
}
