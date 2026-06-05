import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/i18n/LanguageProvider";
import { SITE } from "@/lib/site";

export function SponsorsHero() {
  const { t } = useLanguage();
  const s = t.sponsors;

  return (
    <section className="relative overflow-hidden border-b border-border/60 py-16 md:py-20">
      <div className="pointer-events-none absolute left-1/2 top-0 -z-10 h-80 w-[640px] -translate-x-1/2 rounded-full bg-gold/15 blur-[110px]" />
      <div className="container-page text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-4 py-1.5 text-sm font-semibold text-gold">
          <Heart className="size-4 fill-gold/30" />
          {s.heroBadge}
        </div>
        <h1 className="mx-auto mt-5 max-w-2xl text-balance text-3xl font-extrabold tracking-tight sm:text-4xl md:text-5xl">
          {s.heroTitle}
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-pretty leading-relaxed text-muted-foreground">{s.heroSubtitle}</p>
        <div className="mt-7">
          <Button asChild size="lg" variant="gold">
            <a href={SITE.sponsorContact} target="_blank" rel="noreferrer">
              <Heart className="size-4" />
              {s.becomeCta}
            </a>
          </Button>
        </div>
      </div>
    </section>
  );
}
