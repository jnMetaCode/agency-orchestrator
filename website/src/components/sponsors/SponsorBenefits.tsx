import { Globe, Heart, LifeBuoy, Mail, Megaphone, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/i18n/LanguageProvider";
import { SITE } from "@/lib/site";

const PERK_ICONS = [Megaphone, Zap, Globe, LifeBuoy];

export function SponsorBenefits() {
  const { t } = useLanguage();
  const s = t.sponsors;

  return (
    <section className="relative overflow-hidden border-t border-border/60 bg-muted/20 py-16 md:py-24">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-transparent via-primary/[0.04] to-transparent" />
      <div className="container-page">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary">
            <Sparkles className="size-3.5" />
            {s.benefitsBadge}
          </span>
          <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl md:text-4xl">{s.benefitsTitle}</h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground md:text-base">{s.benefitsSubtitle}</p>
        </div>

        <div className="mx-auto mt-10 grid max-w-5xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {s.benefits.map((b, i) => {
            const Icon = PERK_ICONS[i] ?? Sparkles;
            return (
              <div key={b.title} className="flex h-full flex-col gap-3 rounded-2xl border border-border/70 bg-card/60 p-5 transition-colors hover:border-primary/40">
                <div className="inline-flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-5" />
                </div>
                <h3 className="text-base font-semibold md:text-lg">{b.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{b.desc}</p>
              </div>
            );
          })}
        </div>

        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="lg" variant="gold">
            <a href={SITE.sponsorContact} target="_blank" rel="noreferrer">
              <Heart className="size-4" />
              {s.becomeCta}
            </a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href={SITE.issues} target="_blank" rel="noreferrer">
              <Mail className="size-4" />
              GitHub Issue
            </a>
          </Button>
        </div>
      </div>
    </section>
  );
}
