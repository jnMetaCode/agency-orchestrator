/**
 * 运行结果 webhook 推送 —— `ao run --notify <url>`（或 AO_NOTIFY_URL）。
 *
 * 定位：留存闭环的一环——`cron + ao run --notify` = "每天 8 点，AI 团队把简报推到群里"。
 * 大厂互相不接生态（微信绑 WorkBuddy、钉钉绑千问），AO 全都接：按 webhook 域名自动适配
 * 钉钉 / 飞书 / 企业微信自定义机器人的消息格式，其他地址走通用 JSON（{text}）。
 *
 * 纪律：推送永远不能搞坏运行本身——发送失败只打一行提示，绝不抛错、绝不影响退出码。
 */

export interface NotifySummary {
  name: string;
  success: boolean;
  /** 已格式化的耗时（如 "182.1s"） */
  duration: string;
  completedSteps: number;
  totalSteps: number;
  /** 最终产出节选（调用方截好） */
  excerpt?: string;
}

const EXCERPT_LIMIT = 300;

/** 组装推送文案（各平台共用同一段纯文本）。 */
export function buildNotifyText(s: NotifySummary): string {
  const mark = s.success ? '✅' : '⚠️';
  const lines = [
    `${mark} AO 工作流「${s.name}」${s.success ? '完成' : '部分完成'}（${s.completedSteps}/${s.totalSteps} 步 · ${s.duration}）`,
  ];
  if (s.excerpt) {
    const ex = s.excerpt.length > EXCERPT_LIMIT ? s.excerpt.slice(0, EXCERPT_LIMIT) + '…' : s.excerpt;
    lines.push('', ex, '', '完整产出：ao report last（可分享的单文件报告）');
  }
  return lines.join('\n');
}

/**
 * 按 webhook 域名适配消息体。
 * - 钉钉自定义机器人（oapi.dingtalk.com）：{msgtype:'text', text:{content}}
 *   注意钉钉机器人常配"自定义关键词"安全设置——文案固定含 "AO"，把它设为关键词即可。
 * - 飞书自定义机器人（open.feishu.cn / open.larksuite.com）：{msg_type:'text', content:{text}}
 * - 企业微信群机器人（qyapi.weixin.qq.com）：{msgtype:'text', text:{content}}
 * - 其他：通用 {text}（Slack incoming webhook 等也认这个形状）
 */
export function buildNotifyPayload(url: string, s: NotifySummary): Record<string, unknown> {
  const text = buildNotifyText(s);
  let host = '';
  try { host = new URL(url).hostname; } catch { /* 无效 URL 由 sendNotify 报 */ }
  if (host.endsWith('dingtalk.com')) return { msgtype: 'text', text: { content: text } };
  if (host.endsWith('feishu.cn') || host.endsWith('larksuite.com')) return { msg_type: 'text', content: { text } };
  if (host.endsWith('qyapi.weixin.qq.com')) return { msgtype: 'text', text: { content: text } };
  return { text };
}

/** 发送推送。永不抛错；返回给调用方打一行提示用。 */
export async function sendNotify(url: string, s: NotifySummary): Promise<{ ok: boolean; hint: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error('bad protocol');
  } catch {
    return { ok: false, hint: `--notify 地址无效（需要 http(s) URL）：${url}` };
  }
  try {
    // AbortSignal.timeout 覆盖整个请求生命周期（含响应体读取）——手动 clearTimeout 的写法
    // 在「返回 200 头之后 body 永远不结束」的坏 webhook 上会让 ao run（乃至 cron）挂死
    const signal = AbortSignal.timeout(8000);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildNotifyPayload(url, s)),
      signal,
    });
    if (!res.ok) return { ok: false, hint: `推送失败：${parsed.hostname} 返回 HTTP ${res.status}` };
    // 钉钉/企微对格式错误也回 200，错误码在响应体里——尽力读一下，读不动就当成功
    try {
      const body = (await res.json()) as { errcode?: number; errmsg?: string; code?: number; msg?: string };
      const code = body.errcode ?? body.code;
      if (code !== undefined && code !== 0) {
        return { ok: false, hint: `推送被拒：${body.errmsg ?? body.msg ?? `错误码 ${code}`}（检查机器人的关键词/签名安全设置）` };
      }
    } catch { /* 非 JSON 响应：按 HTTP 状态算成功 */ }
    return { ok: true, hint: `已推送到 ${parsed.hostname}` };
  } catch {
    return { ok: false, hint: `推送失败：${parsed.hostname} 不可达或超时（8s）` };
  }
}
