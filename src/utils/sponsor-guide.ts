/**
 * 赞助商曝光位——CLI 与 web 服务共用这份数据。
 *
 * 档位规则（2026-07-17 与赞助商约定）：
 * - 进阶档（多元探索）的定制权益 = **默认 provider 位**（Studio 下拉默认选中 +
 *   服务端 AO_PROVIDER 兜底 + 无凭证响应的 provider 字段）——不再占引导横幅
 * - 无凭证引导横幅/CLI ② 路径 = 其余 5 家（旗舰 APINEBULA + 4 家标准）按自然日
 *   轮换，每天显示相邻 2 家：等份轮值、确定性、可向赞助商解释份额（每家 2/6 天数）
 */

export interface SponsorGuideEntry {
  /**
   * AO 内的 provider id（引导示例命令 `--provider <id>` 用）。
   * 纯编码 CLI 中转商没有可直连的 API provider，此字段留空并置 relayOnly。
   */
  providerId?: string;
  name: string;
  bonus?: string;
  url: string;
  /**
   * 只提供编码 CLI（Claude Code / Codex / Gemini）中转，没有 AO 可直连的 API 端点。
   * 这类赞助商照常进轮换曝光，但不能被拿去拼 `--provider` 示例命令 —— 那会打印出
   * 一条"unknown provider"的命令，比不展示更糟。配置入口在 Studio 供应商页的
   * 「CLI 中转商预设」（website/src/lib/studio.ts 的 CLI_RELAY_PRESETS）。
   */
  relayOnly?: boolean;
}

/** 进阶档（默认 provider 位持有者，provider id: duoyuanx）。不进横幅轮换。 */
export const PREMIUM_SPONSOR: SponsorGuideEntry = {
  providerId: 'duoyuanx',
  name: '多元探索',
  bonus: '注册送 3 元',
  url: 'https://duoyuanx.com/register?aff=LErO',
};

/** 引导横幅轮换池：旗舰 + 标准共 5 家（顺序无偏好，轮值即公平；每家 2/5 天数）。
 *  RootFlowAI 与 CCSub 已下架赞助（2026-08），AICodeMirror 顶上其中一位。 */
export const SPONSOR_ROTATION: SponsorGuideEntry[] = [
  { providerId: 'apinebula', name: 'APINEBULA', bonus: '充值码 agent 九折', url: 'https://apinebula.ai/V6ekjG' },
  { providerId: 'cubence', name: 'Cubence', bonus: '首购 9 折', url: 'https://cubence.com/signup?code=SCW29JP9&source=agency' },
  { providerId: 'compshare', name: '优云智算', bonus: '注册送 5 元', url: 'https://passport.compshare.cn/register?referral_code=ETD3L5JBM13CtKARkMORot&ytag=GPU_YY_YX_git_agency-agents' },
  { providerId: 'volcengine', name: '火山引擎', bonus: '注册领 2500 万 Tokens', url: 'https://www.volcengine.com/activity/ai618?utm_campaign=hw&utm_content=hw&utm_medium=devrel_tool_web&utm_source=OWO&utm_term=agency-agents-zh' },
  // AICodeMirror：只做 Claude / Codex / Gemini 的编码 CLI 中转，没有 AO 可直连的 API
  // 端点（根 /v1/chat/completions 实测 404），所以 relayOnly —— 照常曝光，但不参与
  // `--provider` 示例命令。配置走 Studio 供应商页的 CLI 中转商预设。
  { name: 'AICodeMirror', relayOnly: true, bonus: '首充 8 折', url: 'https://www.aicodemirror.ai/register?invitecode=XO5L7R' },
];

/**
 * 引导示例命令该用哪个 provider id：取当天轮值里第一个**有直连 API** 的赞助商；
 * 若当天两家都是纯 CLI 中转商，退回轮换池里第一个有 provider 的（保证命令永远可执行）。
 */
export function guideProviderId(rots: SponsorGuideEntry[] = rotatingSponsors()): string {
  const pick = rots.find((s) => s.providerId) ?? SPONSOR_ROTATION.find((s) => s.providerId);
  return pick!.providerId!;
}

/**
 * 从给定池子里取当天轮值的相邻 count 家（按自然日，确定性）。
 *
 * 抽成独立函数是为了让**远程清单**能替换池子：赞助商上/下架此前只能改这份代码
 * 再发一次 npm + 桌面端，而没升级的用户会继续看到已下架的赞助商。清单通道
 * （website/public/providers-manifest.json）改完 push 官网即对所有已安装用户生效，
 * 轮换算法则两边共用这一份，份额口径不会因来源不同而漂移。
 */
export function rotateFrom(pool: SponsorGuideEntry[], count = 2, now: number = Date.now()): SponsorGuideEntry[] {
  if (!Array.isArray(pool) || pool.length === 0) return [];
  const start = Math.floor(now / 86_400_000) % pool.length;
  return Array.from({ length: Math.min(count, pool.length) }, (_, i) => pool[(start + i) % pool.length]);
}

/** 当天轮值的赞助商（按自然日取相邻 count 家，默认 2 家） */
export function rotatingSponsors(count = 2, now: number = Date.now()): SponsorGuideEntry[] {
  return rotateFrom(SPONSOR_ROTATION, count, now);
}
