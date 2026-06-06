import { Activity, Coins, DollarSign, Loader2, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, PRICING, type UsageResponse } from "@/lib/studio";

function fmt(n: number) {
  if (n >= 1e8) return (n / 1e8).toFixed(2) + " 亿";
  if (n >= 1e4) return (n / 1e4).toFixed(1) + " 万";
  return n.toLocaleString();
}

export function UsagePanel() {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [model, setModel] = useState("deepseek");

  useEffect(() => {
    api.usage().then(setData).catch((e) => setErr(e.message));
  }, []);

  const cost = useMemo(() => {
    if (!data) return 0;
    const p = PRICING[model];
    return (data.totalInput * p.in + data.totalOutput * p.out) / 1e6;
  }, [data, model]);

  if (err) return <p className="py-20 text-center text-sm text-red-500">加载失败：{err}</p>;
  if (!data)
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> 统计中…
      </div>
    );
  if (!data.totalRuns)
    return <p className="py-20 text-center text-sm text-muted-foreground">还没有运行记录,跑几个工作流后这里会有用量统计。</p>;

  const cards = [
    { icon: Coins, label: "累计 Tokens", value: fmt(data.totalTokens), sub: `${data.totalRuns} 次运行` },
    { icon: TrendingUp, label: "输入 Tokens", value: fmt(data.totalInput), sub: "input" },
    { icon: Activity, label: "输出 Tokens", value: fmt(data.totalOutput), sub: "output" },
    { icon: DollarSign, label: "估算成本", value: `$${cost.toFixed(2)}`, sub: `按 ${PRICING[model].label} 估算` },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {data.firstDate && data.lastDate ? `${data.firstDate} ~ ${data.lastDate}` : "全部运行"}
        </p>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          成本按模型估算
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="h-9 rounded-lg border border-border/70 bg-card/60 px-2 text-sm text-foreground outline-none"
          >
            {Object.entries(PRICING).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="rounded-2xl border border-border/70 bg-card/60 p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Icon className="size-4 text-primary" />
                {c.label}
              </div>
              <div className="mt-2 text-2xl font-extrabold tracking-tight">{c.value}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{c.sub}</div>
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl border border-border/70 bg-card/60 p-5">
        <h3 className="mb-3 text-sm font-semibold">每日 Token 用量</h3>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.byDay} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
              <defs>
                <linearGradient id="gIn" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="gOut" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(d) => String(d).slice(5)} />
              <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => fmt(Number(v))} width={48} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }}
                formatter={(v: number, n) => [fmt(Number(v)), n === "input" ? "输入" : "输出"]}
              />
              <Area type="monotone" dataKey="input" stroke="hsl(var(--primary))" fill="url(#gIn)" strokeWidth={2} />
              <Area type="monotone" dataKey="output" stroke="#f59e0b" fill="url(#gOut)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-2xl border border-border/70 bg-card/60 p-5">
        <h3 className="mb-3 text-sm font-semibold">用量最高的角色 Top {data.byRole.length}</h3>
        <div className="space-y-2">
          {data.byRole.map((r, i) => {
            const tot = r.input + r.output;
            const max = data.byRole[0] ? data.byRole[0].input + data.byRole[0].output : 1;
            return (
              <div key={r.role} className="flex items-center gap-3">
                <span className="w-5 text-right text-xs text-muted-foreground">{i + 1}</span>
                <span className="w-28 shrink-0 truncate text-sm">{r.name}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(3, (tot / max) * 100)}%` }} />
                </div>
                <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">{fmt(tot)}</span>
                <span className="w-12 shrink-0 text-right text-[11px] text-muted-foreground/70">{r.runs}次</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
