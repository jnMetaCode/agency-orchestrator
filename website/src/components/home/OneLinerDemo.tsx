import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageProvider";

export function OneLinerDemo() {
  const { t } = useLanguage();
  const d = t.oneLiner;

  return (
    <section className="container-page py-20 md:py-28">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{d.title}</h2>
        <p className="mt-4 text-muted-foreground">{d.desc}</p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.5 }}
        className="mx-auto mt-10 max-w-3xl overflow-hidden rounded-2xl border border-border/70 bg-[#0b0e16] shadow-2xl shadow-black/40"
      >
        <div className="flex items-center gap-2 border-b border-white/10 bg-white/[0.03] px-4 py-3">
          <span className="h-3 w-3 rounded-full bg-[#ff5f56]" />
          <span className="h-3 w-3 rounded-full bg-[#ffbd2e]" />
          <span className="h-3 w-3 rounded-full bg-[#27c93f]" />
          <span className="ml-3 font-mono text-xs text-white/40">ao compose --run</span>
        </div>

        <div className="space-y-1 p-5 font-mono text-[13px] leading-relaxed">
          <p className="text-white/60">
            <span className="text-emerald-400">$</span> ao compose{" "}
            <span className="text-amber-300">"程序员想用 AI 做副业，月入 2 万，做完整规划"</span> --run
          </p>
          <p className="pt-2 text-white/40">
            工作流: 自动编排 · 步骤数 {d.steps.length} · 模型 deepseek-chat
          </p>
          <p className="flex flex-wrap gap-x-3 gap-y-1 pb-2 text-white/70">
            {d.roles.map((r) => (
              <span key={r}>{r}</span>
            ))}
          </p>
          <div className="my-2 h-px bg-white/10" />
          {d.steps.map((s, i) => (
            <motion.p
              key={s.name}
              initial={{ opacity: 0, x: -8 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.35, delay: 0.2 + i * 0.22 }}
              className="flex items-baseline gap-2 text-white/85"
            >
              <Check className="size-3.5 shrink-0 translate-y-0.5 text-emerald-400" />
              <span className="shrink-0">{s.emoji}</span>
              <span className="shrink-0 font-semibold text-white">{s.name}</span>
              <span className="shrink-0 text-white/40">{s.time}</span>
              <span className="text-white/55">→ {s.out}</span>
            </motion.p>
          ))}
          <div className="my-2 h-px bg-white/10" />
          <p className="text-emerald-400/90">✓ 完成 · 产物已保存到 ao-output/</p>
        </div>
      </motion.div>
    </section>
  );
}
