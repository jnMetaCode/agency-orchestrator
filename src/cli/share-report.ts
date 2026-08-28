/**
 * `ao report` — 把一次运行渲染成可分享的自包含 HTML 报告（纯函数，便于单测）。
 *
 * 设计目标：用户跑出一份满意的成果后，一条命令得到一张能直接发给任何人的
 * 静态页面（微信/群里双击即开，无需装 AO）——专家分工时间线 + 每步产出 +
 * 最终成品。页面自带 "Made with Agency Orchestrator" 署名，是产品的传播载体。
 *
 * 约束：单文件、零外链（图片内联为 data URI）、亮暗色自适应、可打印。
 */
import { marked } from 'marked';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface ShareStep {
  id: string;
  agentName?: string;
  agentEmoji?: string;
  role?: string;
  status?: string;
  duration?: string;
  tokens?: { input?: number; output?: number };
  /** 该步骤的 markdown 产出（steps/N-id.md 的正文） */
  markdown: string;
}

export interface ShareReportData {
  name: string;
  success?: boolean;
  totalDuration?: string;
  totalTokens?: { input?: number; output?: number };
  steps: ShareStep[];
  /** 由调用方传入（如 new Date().toLocaleString()），渲染保持纯函数可测 */
  generatedAt?: string;
  /** 相对资源路径 → data URI；返回 null 表示保持原样 */
  resolveAsset?: (src: string) => string | null;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 步骤 md 开头的元信息引用块（"> 🦴 **人类学家** | 步骤 1/1 | 10.1s" + "---"）——
 *  报告页自己会渲染这些信息，正文里再出现一遍就是噪音。 */
export function stripStepHeader(md: string): string {
  return md.replace(/^>\s[^\n]*\n\s*\n---\s*\n\s*/, '');
}

function mdToHtml(md: string, resolveAsset?: (src: string) => string | null): string {
  let html = marked.parse(md, { async: false }) as string;
  if (resolveAsset) {
    html = html.replace(/src="([^"]+)"/g, (whole, src: string) => {
      const inlined = resolveAsset(src);
      return inlined ? `src="${inlined}"` : whole;
    });
    // type: video 的产物在 md 里是链接（[▶ id.mp4](assets/id.mp4)）。报告页的卖点是"单文件、
    // 发给谁都能看"，所以能内联就内联成播放器；文件太大时 resolveAsset 会拒绝（返回 null），
    // 那就保留原链接并在旁边说清楚"视频没内联、在运行目录的 assets/ 里"——不假装它能播。
    html = html.replace(/<a href="([^"]+\.mp4)"[^>]*>(.*?)<\/a>/gi, (whole, src: string) => {
      const inlined = resolveAsset(src);
      return inlined
        ? `<video src="${inlined}" controls preload="metadata" style="max-width:100%;border-radius:10px;margin:8px 0"></video>`
        : `${whole} <em style="opacity:.7">（视频体积较大，未内联到本页；原文件在运行目录的 assets/ 下）</em>`;
    });
    // type: tts 的配音产物同理（[🔊 id.mp3](assets/id.mp3)）。配音一般只有几十 KB，
    // 不内联的话报告里就是一条点了下载文件的死链——听不到等于没有。
    html = html.replace(/<a href="([^"]+\.(?:mp3|wav|m4a|aac|opus|flac))"[^>]*>(.*?)<\/a>/gi, (whole, src: string) => {
      const inlined = resolveAsset(src);
      return inlined
        ? `<audio src="${inlined}" controls preload="metadata" style="max-width:100%;margin:8px 0"></audio>`
        : `${whole} <em style="opacity:.7">（音频未内联到本页；原文件在运行目录的 assets/ 下）</em>`;
    });
  }
  return html;
}

/**
 * 从一个运行输出目录直接产出报告 HTML（CLI 的 `ao report` 与 Studio 的
 * `GET /api/runs/:id/report` 共用；目录不合法时抛 Error，消息可直接给用户看）。
 */
export function renderRunDirReport(runDir: string, generatedAt?: string): string {
  const metaFile = join(runDir, 'metadata.json');
  if (!existsSync(metaFile)) throw new Error(`"${runDir}" 里没有 metadata.json —— 不是一个 AO 运行输出目录。`);
  const meta = JSON.parse(readFileSync(metaFile, 'utf-8'));

  const stepsDir = join(runDir, 'steps');
  const files = existsSync(stepsDir)
    ? readdirSync(stepsDir).filter((f) => f.endsWith('.md'))
        .sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))
    : [];
  if (files.length === 0) throw new Error(`"${runDir}" 里没有步骤产出（steps/*.md）。`);

  const metaSteps: Array<Record<string, any>> = Array.isArray(meta.steps) ? meta.steps : [];
  const steps: ShareStep[] = files.map((f) => {
    const id = f.replace(/^\d+-/, '').replace(/\.md$/, '');
    const m = metaSteps.find((s) => s.id === id) ?? {};
    return {
      id,
      agentName: m.agentName, agentEmoji: m.agentEmoji, role: m.role,
      status: m.status, duration: m.duration, tokens: m.tokens,
      markdown: readFileSync(join(stepsDir, f), 'utf-8'),
    };
  });

  // 相对图片内联成 data URI。注意 md 里的引用是相对 steps/ 目录写的
  // （image 步骤产物是 `../assets/xx.png`），所以先按 steps/ 为基准解析，再退回 runDir。
  const MIME: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.opus': 'audio/ogg', '.flac': 'audio/flac',
  };
  // 视频内联上限：一段 5s/768P 的片子一般 1~3MB，内联没问题；2K 长片可能几十 MB，
  // base64 还要再涨 1/3 —— 那种体积的单文件 HTML 发不出去也打不开，宁可退回链接并说明。
  const INLINE_CAP = 12 * 1024 * 1024;
  const resolveAsset = (src: string): string | null => {
    if (/^(https?:|data:)/.test(src)) return null;
    const ext = (src.match(/\.[a-z0-9]+$/i)?.[0] || '').toLowerCase();
    if (!MIME[ext]) return null;
    for (const base of [join(runDir, 'steps'), runDir]) {
      const f = join(base, src);
      if (!existsSync(f)) continue;
      const bytes = readFileSync(f);
      if (bytes.length > INLINE_CAP) return null;
      return `data:${MIME[ext]};base64,${bytes.toString('base64')}`;
    }
    return null;
  };

  return renderShareReport({
    name: meta.name || runDir,
    success: meta.success,
    totalDuration: meta.totalDuration,
    totalTokens: meta.totalTokens,
    steps,
    generatedAt,
    resolveAsset,
  });
}

export function renderShareReport(d: ShareReportData): string {
  const tokens = d.totalTokens ? (d.totalTokens.input ?? 0) + (d.totalTokens.output ?? 0) : 0;
  const emojis = d.steps.map((s) => s.agentEmoji).filter(Boolean).join(' ');
  const chips: string[] = [];
  chips.push(`${d.steps.length} 个专家步骤`);
  if (d.totalDuration) chips.push(`总耗时 ${esc(d.totalDuration)}`);
  if (tokens > 0) chips.push(`${tokens.toLocaleString()} tokens`);
  if (d.success !== undefined) chips.push(d.success ? '✅ 全部完成' : '⚠️ 部分完成');

  const stepsHtml = d.steps
    .map((s, i) => {
      const isFinal = i === d.steps.length - 1 && d.steps.length > 1;
      const title = `${s.agentEmoji ? esc(s.agentEmoji) + ' ' : ''}${esc(s.agentName || s.id)}`;
      const meta: string[] = [];
      if (s.role) meta.push(esc(s.role));
      if (s.duration) meta.push(esc(s.duration));
      const t = s.tokens ? (s.tokens.input ?? 0) + (s.tokens.output ?? 0) : 0;
      if (t > 0) meta.push(`${t.toLocaleString()} tokens`);
      return `
    <section class="step${isFinal ? ' final' : ''}">
      <header>
        <span class="no">${i + 1}</span>
        <h2>${title}${isFinal ? ' <span class="star">⭐ 最终成品</span>' : ''}</h2>
        <span class="meta">${meta.join(' · ')}</span>
      </header>
      <div class="body">${mdToHtml(stripStepHeader(s.markdown), d.resolveAsset)}</div>
    </section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.name)} · AO 运行报告</title>
<style>
  :root {
    --bg: #f6f7f9; --card: #ffffff; --ink: #1d2530; --muted: #5d6b7e;
    --line: #e3e7ee; --accent: #4056c7; --accent-soft: #eef1fc;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #11151c; --card: #191f29; --ink: #e6ebf2; --muted: #93a0b3;
      --line: #2a3341; --accent: #8ea2f0; --accent-soft: #202942;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px 16px 48px; background: var(--bg); color: var(--ink);
    font-family: -apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif;
    line-height: 1.75; font-size: 15.5px;
  }
  .page { max-width: 860px; margin: 0 auto; }
  .hero { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 28px 30px; }
  .emojis { font-size: 22px; letter-spacing: 6px; margin: 0 0 10px; }
  h1 { font-size: 26px; line-height: 1.35; margin: 0 0 14px; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; list-style: none; }
  .chips li {
    font-size: 12.5px; color: var(--muted); background: var(--accent-soft);
    border: 1px solid var(--line); border-radius: 999px; padding: 3px 12px;
  }
  .step { background: var(--card); border: 1px solid var(--line); border-radius: 14px; margin-top: 18px; overflow: hidden; }
  .step.final { border-color: var(--accent); }
  .step > header {
    display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap;
    padding: 14px 22px; border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--accent-soft) 45%, var(--card));
  }
  .step .no {
    font-size: 12px; font-weight: 700; color: var(--accent);
    border: 1px solid var(--accent); border-radius: 999px; width: 22px; height: 22px;
    display: inline-flex; align-items: center; justify-content: center; align-self: center; flex-shrink: 0;
  }
  .step h2 { font-size: 17px; margin: 0; }
  .step .star { font-size: 12.5px; color: var(--accent); font-weight: 600; margin-left: 4px; }
  .step .meta { font-size: 12.5px; color: var(--muted); margin-left: auto; }
  .step .body { padding: 8px 26px 20px; overflow-wrap: break-word; }
  .body img { max-width: 100%; border-radius: 8px; }
  .body pre { background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; overflow-x: auto; font-size: 13px; }
  .body code { font-family: ui-monospace, "SF Mono", Consolas, monospace; }
  .body table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto; font-size: 14px; }
  .body th, .body td { border: 1px solid var(--line); padding: 6px 12px; text-align: left; }
  .body blockquote { margin: 12px 0; padding: 2px 16px; border-left: 3px solid var(--accent); color: var(--muted); }
  .body a { color: var(--accent); }
  footer {
    margin-top: 28px; padding: 18px 6px 0; border-top: 1px solid var(--line);
    font-size: 13px; color: var(--muted); display: flex; flex-wrap: wrap; gap: 6px 18px; align-items: center;
  }
  footer a { color: var(--accent); text-decoration: none; }
  footer code { background: var(--card); border: 1px solid var(--line); border-radius: 6px; padding: 1px 8px; font-size: 12px; }
  @media print { body { background: #fff; } .step, .hero { border-color: #ccc; break-inside: avoid; } }
</style>
</head>
<body>
<div class="page">
  <header class="hero">
    ${emojis ? `<p class="emojis">${esc(emojis)}</p>` : ''}
    <h1>${esc(d.name)}</h1>
    <ul class="chips">${chips.map((c) => `<li>${c}</li>`).join('')}</ul>
  </header>
${stepsHtml}
  <footer>
    <span>本页由 <strong>Agency Orchestrator</strong> 的 AI 专家团队协作生成${d.generatedAt ? ` · ${esc(d.generatedAt)}` : ''}</span>
    <a href="https://github.com/jnMetaCode/agency-orchestrator">github.com/jnMetaCode/agency-orchestrator</a>
    <span>一句话，让多个 AI 角色自动协作：<code>npm i -g agency-orchestrator</code></span>
  </footer>
</div>
</body>
</html>
`;
}
