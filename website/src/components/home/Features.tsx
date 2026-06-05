import { motion } from "framer-motion";
import { Boxes, FileCode, Repeat, ShieldCheck, Users, Workflow, type LucideIcon } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageProvider";
import { SITE } from "@/lib/site";

const ICONS: Record<string, LucideIcon> = {
  workflow: Workflow,
  users: Users,
  "file-code": FileCode,
  repeat: Repeat,
  boxes: Boxes,
  "shield-check": ShieldCheck,
};

export function Features() {
  const { t } = useLanguage();
  const f = t.features;

  return (
    <section id="features" className="scroll-mt-20 border-t border-border/60 bg-muted/20 py-20 md:py-28">
      <div className="container-page">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{f.title}</h2>
          <p className="mt-4 text-muted-foreground">{f.subtitle}</p>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {f.items.map((item, i) => {
            const Icon = ICONS[item.icon] ?? Workflow;
            return (
              <motion.div
                key={item.title}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.4, delay: (i % 3) * 0.08 }}
                className="group rounded-2xl border border-border/70 bg-card/60 p-6 transition-colors hover:border-primary/40"
              >
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <Icon className="size-5" />
                </div>
                <h3 className="mt-4 text-lg font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.desc}</p>
              </motion.div>
            );
          })}
        </div>

        <div className="mx-auto mt-10 max-w-3xl rounded-2xl border border-gold/30 bg-gold/[0.06] p-6">
          <h3 className="text-base font-bold text-gold">{t.evalNote.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t.evalNote.body}</p>
          <a
            href={SITE.evalFindings}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block text-sm font-semibold text-gold hover:underline"
          >
            {t.evalNote.link} →
          </a>
        </div>
      </div>
    </section>
  );
}
