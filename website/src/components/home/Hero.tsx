import { motion } from "framer-motion";
import { ArrowRight, Github, Terminal } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { useLanguage } from "@/i18n/LanguageProvider";
import { SITE } from "@/lib/site";

export function Hero() {
  const { t, prefix } = useLanguage();
  const h = t.hero;

  return (
    <section className="relative overflow-hidden pt-28 md:pt-36">
      <div className="pointer-events-none absolute inset-0 grid-bg opacity-60 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
      <div className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[480px] w-[820px] -translate-x-1/2 rounded-full bg-primary/20 blur-[120px]" />

      <div className="container-page relative">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mx-auto max-w-3xl text-center"
        >
          <Badge className="mx-auto border-primary/30 bg-primary/10 text-primary">{h.badge}</Badge>
          <h1 className="mt-6 text-balance text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl md:text-6xl">
            {h.title} <span className="text-gradient">{h.titleHighlight}</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            {h.subtitle}
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg">
              <a href={SITE.repo} target="_blank" rel="noreferrer">
                <Github className="size-5" />
                {h.ctaPrimary}
              </a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to={prefix("/sponsors")}>
                {h.ctaSecondary}
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>

          <div className="mx-auto mt-8 max-w-xl">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{h.installHint}</p>
            <div className="glass flex items-center justify-between rounded-xl px-4 py-3 font-mono text-sm">
              <span className="flex items-center gap-2 truncate">
                <Terminal className="size-4 shrink-0 text-primary" />
                <span className="truncate">{SITE.install}</span>
              </span>
              <CopyButton value={SITE.install} label={h.copy} copiedLabel={h.copied} />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="mx-auto mt-12 grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4"
        >
          {h.stats.map((s) => (
            <div key={s.label} className="glass rounded-2xl px-4 py-4 text-center">
              <div className="text-2xl font-extrabold text-gradient">{s.value}</div>
              <div className="mt-1 text-xs text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
