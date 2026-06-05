import { ArrowRight, Github } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { useLanguage } from "@/i18n/LanguageProvider";
import { SITE } from "@/lib/site";

export function FinalCta() {
  const { t, prefix } = useLanguage();

  return (
    <section className="container-page py-20 md:py-28">
      <div className="relative overflow-hidden rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/15 via-card to-card p-10 text-center md:p-16">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/25 blur-[100px]" />
        <h2 className="relative text-3xl font-extrabold tracking-tight sm:text-4xl">{t.hero.title} {t.hero.titleHighlight}</h2>
        <p className="relative mx-auto mt-4 max-w-xl text-muted-foreground">{t.hero.subtitle}</p>

        <div className="relative mx-auto mt-7 flex max-w-md items-center justify-between rounded-xl border border-border/70 bg-background/70 px-4 py-3 font-mono text-sm backdrop-blur">
          <span className="truncate">{SITE.install}</span>
          <CopyButton value={SITE.install} label={t.hero.copy} copiedLabel={t.hero.copied} />
        </div>

        <div className="relative mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="lg">
            <a href={SITE.repo} target="_blank" rel="noreferrer">
              <Github className="size-5" />
              {t.hero.ctaPrimary}
            </a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to={prefix("/docs")}>
              {t.nav.docs}
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
