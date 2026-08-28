/**
 * 开跑前的「媒体花费预览」——把这次运行**会花钱的步骤**列清楚：几条片、各多少秒、什么档位、哪家；
 * 几张图、几段配音；合成几条（本机 ffmpeg，不花钱）。
 *
 * 为什么必须有它：AO 对短剧类产品的差异化之一就是"成本可见"，可此前 `ao plan` 与 Studio 的
 * 运行弹窗只列步骤、不说要出几条片——用户把 video_duration 从 5 改成 8、镜数从 3 改成 5，
 * 没有任何地方在按下运行之前告诉他"这次是 5 × 8s"。视频按秒计费，钱是在这一下花出去的。
 *
 * 只说数量、不报价：各家价目表不在我们手里，编一个"约 ¥x"比不报更糟（见 CLAUDE.md 用量页那条）。
 * 纯函数：不联网、不读盘，同样输入永远同样结论——所以 CLI、`ao plan`、Studio 弹窗能共用一份。
 */
import type { WorkflowDefinition, StepDefinition } from '../types.js';
import { renderTemplate } from '../core/template.js';
import { evaluateCondition } from '../core/condition.js';

export interface MediaSpendItem {
  id: string;
  kind: 'video' | 'image' | 'tts' | 'concat';
  provider: string;      // 渲染后；空串 = 跟随文本供应商
  model: string;         // 渲染后；可能仍含 {{…}}（输入未填）
  /** 视频：分辨率 / 秒数 / 宽高比；图片：size；配音：音色 */
  spec: string;
  seconds?: number;      // 视频秒数（能解析出数字时）
  /** 该步带 condition 且条件靠上游产出才能判 → 视条件；条件只引用输入时已经判定 */
  conditional: 'yes' | 'no' | 'unknown';
  /** 挂了 acceptance。图片：不过会重出一张（最多多花一张）；视频：只审不重出，除非 rework */
  verified?: boolean;
  /** 视频：验收不过会重出（video.rework: true），最多再花一条 */
  rework?: boolean;
}

export interface MediaSpendSummary {
  items: MediaSpendItem[];
  /** 会跑的视频总秒数（排除已判定不跑的；unknown 按会跑算，宁可高估） */
  videoSeconds: number;
  videoCount: number;
  imageCount: number;
  ttsCount: number;
  concatCount: number;
  /** 直接可打印的行（CLI / Studio 共用） */
  lines: string[];
}

/** 变量没填时保留原样 {{name}}，不抛：预览阶段没值是常态，抛出去等于把预览搞没了 */
function soft(tpl: string | undefined, ctx: Map<string, string>): string {
  if (!tpl) return '';
  try { return renderTemplate(tpl, ctx); } catch { return tpl; }
}

function judgeCondition(step: StepDefinition, ctx: Map<string, string>): MediaSpendItem['conditional'] {
  if (!step.condition) return 'no';
  // 条件引用的变量都在输入里 → 现在就能判；引用了上游产出 → 只能"视条件"
  try { return evaluateCondition(step.condition, ctx) ? 'no' : 'yes'; } catch { return 'unknown'; }
}

export function summarizeMediaSpend(workflow: WorkflowDefinition, inputs: Map<string, string>): MediaSpendSummary {
  const items: MediaSpendItem[] = [];
  const textProvider = workflow.llm?.provider || '';

  for (const s of workflow.steps) {
    if (s.type === 'video') {
      const v = s.video ?? {};
      const secRaw = soft(String(v.duration ?? ''), inputs);
      const sec = Number(secRaw);
      items.push({
        id: s.id, kind: 'video',
        provider: soft(v.provider, inputs) || textProvider,
        model: soft(v.model, inputs),
        spec: [soft(v.resolution, inputs), Number.isFinite(sec) && sec > 0 ? `${sec}s` : secRaw ? `${secRaw}s` : '', soft(v.ratio, inputs)].filter(Boolean).join(' · '),
        ...(Number.isFinite(sec) && sec > 0 ? { seconds: sec } : {}),
        conditional: judgeCondition(s, inputs),
        ...(s.acceptance ? { verified: true, rework: v.rework === true } : {}),
      });
    } else if (s.type === 'image') {
      const im = s.image ?? {};
      items.push({
        id: s.id, kind: 'image',
        provider: soft(im.provider, inputs) || textProvider,
        model: soft(im.model, inputs),
        spec: soft(im.size, inputs),
        conditional: judgeCondition(s, inputs),
        ...(s.acceptance ? { verified: true } : {}),
      });
    } else if (s.type === 'tts') {
      const t = s.tts ?? {};
      items.push({
        id: s.id, kind: 'tts',
        provider: soft(t.provider, inputs) || textProvider,
        model: soft(t.model, inputs),
        spec: soft(t.voice, inputs),
        conditional: judgeCondition(s, inputs),
      });
    } else if (s.type === 'concat') {
      items.push({ id: s.id, kind: 'concat', provider: 'ffmpeg', model: '', spec: `${s.concat?.inputs?.length ?? 0} 段`, conditional: judgeCondition(s, inputs) });
    }
  }

  const willRun = (i: MediaSpendItem) => i.conditional !== 'yes';
  const videos = items.filter((i) => i.kind === 'video' && willRun(i));
  const images = items.filter((i) => i.kind === 'image' && willRun(i));
  const tts = items.filter((i) => i.kind === 'tts' && willRun(i));
  const concat = items.filter((i) => i.kind === 'concat' && willRun(i));
  const videoSeconds = videos.reduce((n, v) => n + (v.seconds ?? 0), 0);

  const lines: string[] = [];
  if (videos.length) {
    // 同规格合并成一行："3 条 × 8s · 720p · 16:9（apimart / veo3.1-fast）"
    const groups = new Map<string, MediaSpendItem[]>();
    for (const v of videos) {
      const k = `${v.provider}|${v.model}|${v.spec}`;
      groups.set(k, [...(groups.get(k) ?? []), v]);
    }
    for (const g of groups.values()) {
      const v = g[0];
      const cond = g.some((x) => x.conditional === 'unknown') ? '（视条件）' : '';
      const rw = g.filter((x) => x.rework).length;
      const judged = g.filter((x) => x.verified && !x.rework).length;
      const note = rw ? `（${rw} 条挂了验收且开了重出，不过会再出一条，最多 +${rw}）` : judged ? `（${judged} 条挂了验收，只审不重出）` : '';
      lines.push(`🎬 出片 ${g.length} 条 × ${v.spec || '档位未填'}  ${v.provider}${v.model ? ` / ${v.model}` : ''}${cond}${note}`);
    }
    const unknownSec = videos.some((v) => v.seconds === undefined);
    lines.push(`   合计 ${videoSeconds}${unknownSec ? '+' : ''} 秒——按秒计费，钱在这一步花出去`);
  }
  if (images.length) {
    const v = images[0];
    const rework = images.filter((i) => i.verified).length;
    lines.push(`🎨 出图 ${images.length} 张${v.spec ? ` · ${v.spec}` : ''}  ${v.provider}${v.model ? ` / ${v.model}` : ''}${rework ? `（${rework} 张挂了验收，不过会重出一张，最多 +${rework}）` : ''}`);
  }
  if (tts.length) {
    const v = tts[0];
    const cond = tts.some((x) => x.conditional === 'unknown') ? '（视条件）' : '';
    lines.push(`🎙 配音 ${tts.length} 段  ${v.provider}${v.model ? ` / ${v.model}` : ''}${v.spec ? ` · ${v.spec}` : ''}${cond}`);
  }
  if (concat.length) lines.push(`🎞 合成 ${concat.length} 条（本机 ffmpeg，不花厂商的钱）`);

  // 已判定不跑的媒体步骤也说一句——否则用户会以为"配音怎么没了"
  const off = items.filter((i) => i.conditional === 'yes');
  if (off.length) lines.push(`·  本次不跑（条件未满足）：${off.map((i) => i.id).join(' / ')}`);

  return { items, videoSeconds, videoCount: videos.length, imageCount: images.length, ttsCount: tts.length, concatCount: concat.length, lines };
}
