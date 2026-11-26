/**
 * 赞助商曝光位——CLI 与 web 服务共用这份数据。
 *
 * 档位规则（2026-07-17 与赞助商约定，2026-08-17 更新）：
 * - 进阶档的定制权益 = **默认 provider 位**（Studio 下拉默认选中 + 服务端兜底 +
 *   无凭证响应的 provider 字段）——不占引导横幅，避免双份曝光。
 *   **该档位现无人持有**（多元探索 2026-08-17 到期下架），默认 provider 位暂由
 *   旗舰赞助商 APINEBULA 顶上（旗舰权益的延伸，不是进阶档本身）。
 * - 无凭证引导横幅/CLI ② 路径 = 按自然日轮换，每天显示相邻两家。
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

/**
 * 进阶档（默认 provider 位持有者）——**目前无人持有**：多元探索的赞助于 2026-08-17 到期下架。
 *
 * 为什么是 null 而不是随手填一家：进阶档是独立的付费档位，拿轮换池里的某家来充数
 * 等于白送双份曝光（横幅轮值 + 进阶位），对其余赞助商不公平——有断言钉着"进阶档持有者
 * 不得同时在轮换池里"。默认 provider 位（DEFAULT_PROVIDER / DEFAULT_PROVIDER_ID）
 * 眼下暂交给旗舰赞助商 APINEBULA，那是旗舰权益的延伸，与这里的进阶档是两件事。
 * 下一家买进阶档时，把它填回来即可（届时须把它从轮换池移出）。
 */
export const PREMIUM_SPONSOR: SponsorGuideEntry | null = null;

/** 引导横幅轮换池，按官网赞助商展示顺序排列。 */
export const SPONSOR_ROTATION: SponsorGuideEntry[] = [
  { providerId: 'apinebula', name: 'APINEBULA', bonus: '充值码 agent 九折', url: 'https://apinebula.ai/V6ekjG' },
  { providerId: 'cubence', name: 'Cubence', bonus: '首购 9 折', url: 'https://cubence.com/signup?code=SCW29JP9&source=agency' },
  { providerId: 'shengsuanyun', name: '胜算云', bonus: '注册送 5 元 Token', url: 'https://www.shengsuanyun.com/?from=CH_QKH696UI' },
  { providerId: 'astraflow', name: '星图 AstraFlow', bonus: '专属链接注册领 50 元算力金', url: 'https://www.ucloud.cn/site/active/astraflow-credit?cps_code=ASUZ5FRlJfFEoXQDPQAv8v&ytag=geo_waituo_agencyagentszh' },
  { providerId: 'apixo', name: 'APIXO AI', url: 'https://apixo.ai/docs' },
  { providerId: 'beichenapi', name: '北辰 API', url: 'https://beichenapi.com/register?aff=RM34GKKSY7EC' },
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
