/**
 * ao ledger — 人工介入账本
 *
 * 回答一个被大厂演示刻意模糊的问题：「这件事里，AI 自己做了多少，人插手了多少？」
 *
 * 人工次数有两个来源：
 *   1. 工作流里的人工节点（type: approval / human_input）—— 引擎已经记在运行目录里，自动统计；
 *   2. 工作流之外的手动介入（人工部署、人工发外联、接手改代码…）—— `ao ledger add` 手记。
 *
 * AI 自主率 = AI 完成步骤 ÷ (AI 完成步骤 + 人工节点 + 手记介入)。
 * 按「次数」算，不按工作量；人工耗时只统计手记里填写的分钟数。口径写进报告，不藏。
 * 不折算金额：我们不持有厂商价目表（与 media/preflight 同一纪律），只报 token 数量。
 *
 * 存储：JSONL，一行一条，默认 <ao-output>/ledger.jsonl（AO_LEDGER_FILE 覆盖）。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { defaultOutputDir } from '../utils/paths.js';

export const LEDGER_REASONS = {
  unsupported: 'AO 不支持',
  quality: '质量不够',
  judgment: '需要人判断',
  external: '对外操作',
} as const;

export type LedgerReason = keyof typeof LEDGER_REASONS;

export interface LedgerEntry {
  at: string;          // ISO 时间
  action: string;      // 人做了什么
  reason: LedgerReason;
  minutes: number;     // 人工耗时（分钟），不填为 0
  step?: string;       // 关联的步骤 id
  run?: string;        // 关联的运行目录名
}

/** 账本文件：AO_LEDGER_FILE > <运行产物目录>/ledger.jsonl */
export function ledgerFile(): string {
  return process.env.AO_LEDGER_FILE
    ? resolve(process.env.AO_LEDGER_FILE)
    : join(defaultOutputDir(), 'ledger.jsonl');
}

/** 校验并构造一条账本记录；不合法直接抛错（账本要公开，宁可拒收也不记糊涂账）。 */
export function makeEntry(input: {
  action?: string;
  reason?: string;
  minutes?: string | number;
  step?: string;
  run?: string;
  at?: Date;
}): LedgerEntry {
  const action = (input.action ?? '').trim();
  if (!action) throw new Error('缺少「做了什么」：ao ledger add "人工部署到 Vercel" --reason unsupported');

  const reasons = Object.keys(LEDGER_REASONS);
  if (!input.reason || !reasons.includes(input.reason)) {
    const list = reasons.map((r) => `${r}（${LEDGER_REASONS[r as LedgerReason]}）`).join(' / ');
    throw new Error(`--reason 必填，可选：${list}`);
  }

  let minutes = 0;
  if (input.minutes !== undefined && input.minutes !== '') {
    minutes = Number(input.minutes);
    if (!Number.isFinite(minutes) || minutes < 0) throw new Error(`--minutes 必须是 ≥ 0 的数字，收到 "${input.minutes}"`);
  }

  const entry: LedgerEntry = {
    at: (input.at ?? new Date()).toISOString(),
    action,
    reason: input.reason as LedgerReason,
    minutes,
  };
  if (input.step) entry.step = input.step;
  if (input.run) entry.run = input.run;
  return entry;
}

export function appendEntry(file: string, entry: LedgerEntry): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(entry) + '\n', 'utf-8');
}

/** 读账本；坏行跳过并计数（手改文件出错时不让整本账失效，但要让人知道）。 */
export function readEntries(file: string): { entries: LedgerEntry[]; skipped: number } {
  if (!existsSync(file)) return { entries: [], skipped: 0 };
  const entries: LedgerEntry[] = [];
  let skipped = 0;
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (typeof e.at !== 'string' || typeof e.action !== 'string' || !(e.reason in LEDGER_REASONS)) {
        skipped++;
        continue;
      }
      entries.push({ ...e, minutes: Number(e.minutes) || 0 });
    } catch {
      skipped++;
    }
  }
  return { entries, skipped };
}

/** ISO 时间 → 本地日期 YYYY-MM-DD（按系统时区分天，和人记忆里的「第几天」一致）。 */
export function localDay(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function assertDay(value: string | undefined, flag: string): string | undefined {
  if (value === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${flag} 需要 YYYY-MM-DD 格式，收到 "${value}"`);
  return value;
}

export interface RunRecord {
  dir: string;          // 运行目录名
  name: string;
  day: string;
  success: boolean;
  tokens: number;
  aiSteps: number;      // 完成的 AI 步骤（文本 / 图 / 视频 / 配音 / 合成）
  humanSteps: number;   // 完成的人工节点（approval / human_input）
}

const HUMAN_TYPES = new Set(['approval', 'human_input']);

/** 从工作流文件读出 步骤 id → type；文件不在或解析失败返回 null（回退到启发式）。 */
function stepTypesFromWorkflow(file: unknown): Map<string, string> | null {
  if (typeof file !== 'string' || !existsSync(file)) return null;
  try {
    const doc = yaml.load(readFileSync(file, 'utf-8')) as { steps?: Array<{ id?: string; type?: string }> };
    if (!Array.isArray(doc?.steps)) return null;
    return new Map(doc.steps.filter((s) => s?.id).map((s) => [s.id as string, s.type || 'normal']));
  } catch {
    return null;
  }
}

/** 扫描运行产物目录，读每次运行的 metadata.json。 */
export function readRuns(outputDir: string): RunRecord[] {
  if (!existsSync(outputDir)) return [];
  const runs: RunRecord[] = [];
  for (const d of readdirSync(outputDir)) {
    const metaFile = join(outputDir, d, 'metadata.json');
    if (!existsSync(metaFile)) continue;
    let meta: any;
    try {
      meta = JSON.parse(readFileSync(metaFile, 'utf-8'));
    } catch {
      continue;
    }
    if (typeof meta.finishedAt !== 'string') continue;

    const types = stepTypesFromWorkflow(meta.file);
    let aiSteps = 0;
    let humanSteps = 0;
    for (const s of Array.isArray(meta.steps) ? meta.steps : []) {
      if (s?.status !== 'completed') continue;
      // resume / feedback 复用的旧产出不是这次做的，计进来会把同一份工作算两遍。
      // 新档案有 reused；旧档案没有该字段，按「0.0s + 0 token」识别（引擎对复用步骤就是这样写的）
      const reused = s.reused === true
        || (s.reused === undefined && s.duration === '0.0s' && s.tokens?.input === 0 && s.tokens?.output === 0);
      if (reused) continue;
      const type = types?.get(s.id);
      // metadata 不记 type：工作流文件还在就按文件认；不在就看痕迹——
      // 人工节点既没有角色也没有产物文件，AI 步骤至少有其一
      const human = type !== undefined
        ? HUMAN_TYPES.has(type)
        : !s.role && !s.imageAsset && !s.videoAsset && !s.audioAsset;
      // 循环重跑按真实执行次数计（metadata.iterations；旧档案没有这个字段，按 1 次）
      const runs = Math.max(1, Math.floor(Number(s.iterations)) || 1);
      if (human) humanSteps += runs;
      else aiSteps += runs;
    }

    runs.push({
      dir: d,
      name: String(meta.name ?? d),
      day: localDay(meta.finishedAt),
      success: meta.success === true,
      tokens: (Number(meta.totalTokens?.input) || 0) + (Number(meta.totalTokens?.output) || 0),
      aiSteps,
      humanSteps,
    });
  }
  return runs;
}

export interface DayRow {
  day: string;
  runs: number;
  failedRuns: number;
  aiSteps: number;
  humanSteps: number;
  manual: number;
  minutes: number;
  tokens: number;
}

export interface LedgerSummary {
  since?: string;
  until?: string;
  rows: DayRow[];
  total: DayRow;
  autonomy: number | null;     // 0~1；没有任何动作时为 null
  byReason: Record<LedgerReason, number>;
  entries: LedgerEntry[];      // 区间内的手记，按时间排序
}

function inRange(day: string, since?: string, until?: string): boolean {
  return (!since || day >= since) && (!until || day <= until);
}

export function summarize(
  entries: LedgerEntry[],
  runs: RunRecord[],
  range: { since?: string; until?: string } = {},
): LedgerSummary {
  const { since, until } = range;
  const days = new Map<string, DayRow>();
  const row = (day: string): DayRow => {
    let r = days.get(day);
    if (!r) {
      r = { day, runs: 0, failedRuns: 0, aiSteps: 0, humanSteps: 0, manual: 0, minutes: 0, tokens: 0 };
      days.set(day, r);
    }
    return r;
  };

  for (const run of runs) {
    if (!inRange(run.day, since, until)) continue;
    const r = row(run.day);
    r.runs++;
    if (!run.success) r.failedRuns++;
    r.aiSteps += run.aiSteps;
    r.humanSteps += run.humanSteps;
    r.tokens += run.tokens;
  }

  const byReason = Object.fromEntries(Object.keys(LEDGER_REASONS).map((k) => [k, 0])) as Record<LedgerReason, number>;
  const kept = entries
    .filter((e) => inRange(localDay(e.at), since, until))
    .sort((a, b) => a.at.localeCompare(b.at));
  for (const e of kept) {
    const r = row(localDay(e.at));
    r.manual++;
    r.minutes += e.minutes;
    byReason[e.reason]++;
  }

  const rows = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
  const total: DayRow = { day: '合计', runs: 0, failedRuns: 0, aiSteps: 0, humanSteps: 0, manual: 0, minutes: 0, tokens: 0 };
  for (const r of rows) {
    total.runs += r.runs;
    total.failedRuns += r.failedRuns;
    total.aiSteps += r.aiSteps;
    total.humanSteps += r.humanSteps;
    total.manual += r.manual;
    total.minutes += r.minutes;
    total.tokens += r.tokens;
  }
  const actions = total.aiSteps + total.humanSteps + total.manual;
  return { since, until, rows, total, autonomy: actions > 0 ? total.aiSteps / actions : null, byReason, entries: kept };
}

/** 表格单元格转义：竖线会切断 markdown 表格，换行会撑破行。 */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
}

export function formatAutonomy(autonomy: number | null): string {
  return autonomy === null ? '—（区间内没有任何记录）' : `${(autonomy * 100).toFixed(1)}%`;
}

/** 渲染成可直接贴进复盘文章的 markdown。 */
export function formatReport(s: LedgerSummary): string {
  const range = s.since || s.until ? `（${s.since ?? '最早'} ~ ${s.until ?? '至今'}）` : '（全部记录）';
  const lines: string[] = [
    `## 人工介入账本${range}`,
    '',
    '| 日期 | 运行（失败） | AI 完成步骤 | 人工节点 | 手记介入 | 人工耗时（分） | Token |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const r of [...s.rows, s.total]) {
    const cells = [r.day, `${r.runs}（${r.failedRuns}）`, r.aiSteps, r.humanSteps, r.manual, r.minutes, r.tokens.toLocaleString('en-US')];
    lines.push(`| ${(r === s.total ? cells.map((c) => `**${c}**`) : cells).join(' | ')} |`);
  }
  lines.push(
    '',
    `**AI 自主率：${formatAutonomy(s.autonomy)}**`,
    '',
    '> 口径：AI 自主率 = AI 完成步骤 ÷（AI 完成步骤 + 工作流人工节点 + 手记介入）。按次数算，不按工作量；',
    '> 人工耗时只含手记里填写的分钟数；Token 为输入 + 输出，不折算金额（金额以服务商账单为准）。',
    '',
    '### 手记介入原因',
    '',
    '| 原因 | 次数 |',
    '|---|---|',
  );
  for (const [k, label] of Object.entries(LEDGER_REASONS)) lines.push(`| ${label} | ${s.byReason[k as LedgerReason]} |`);

  if (s.entries.length > 0) {
    lines.push('', '### 手记明细', '', '| 时间 | 原因 | 人做了什么 | 分钟 | 关联 |', '|---|---|---|---|---|');
    for (const e of s.entries) {
      const link = [e.run, e.step].filter(Boolean).join(' / ') || '—';
      lines.push(`| ${localDay(e.at)} ${new Date(e.at).toTimeString().slice(0, 5)} | ${LEDGER_REASONS[e.reason]} | ${cell(e.action)} | ${e.minutes} | ${cell(link)} |`);
    }
  }
  return lines.join('\n') + '\n';
}
