/**
 * 解析时长字符串 → 毫秒。
 *   "300000" / "300000ms" → 300000
 *   "300s" → 300000
 *   "5m"   → 300000
 *   "0"    → 0  （调用方可用来表示"不限时"）
 * 非法输入返回 null，由调用方报错。
 */
export function parseDuration(input: string): number | null {
  const m = /^(\d+)\s*(ms|s|m)?$/i.exec(input.trim());
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n < 0) return null;
  const unit = (m[2] || 'ms').toLowerCase();
  if (unit === 'ms') return n;
  if (unit === 's') return n * 1000;
  if (unit === 'm') return n * 60_000;
  return null;
}
