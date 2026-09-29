import { ArrowRight, Heart } from "lucide-react";
import { Link } from "react-router-dom";
import { useLanguage } from "@/i18n/LanguageProvider";
import { sponsorLogo, sponsorUrl, sponsors } from "@/content/sponsors";
import { cn } from "@/lib/utils";

export function SponsorStrip() {
  const { t, lang, prefix } = useLanguage();

  return (
    <section className="border-t border-border/60 bg-muted/20 py-16">
      <div className="container-page">
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-2 text-center">
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-primary">
            <Heart className="size-4 fill-primary/20" />
            {t.sponsors.heroBadge}
          </div>
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{t.sponsors.stripTitle}</h2>
          <p className="text-sm text-muted-foreground">{t.sponsors.stripSubtitle}</p>
        </div>

        <div className="mt-8 flex flex-wrap items-stretch justify-center gap-4">
          {sponsors.map((s) => (
            <a
              key={s.id}
              href={sponsorUrl(s, lang)}
              target="_blank"
              rel="noreferrer"
              className="flex w-[260px] items-center gap-3 rounded-2xl border border-border/70 bg-card/60 p-4 transition-colors hover:border-primary/40"
            >
              {s.logo ? (
                <span
                  className={cn(
                    "grid h-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-border/60 bg-white",
                    s.logoShape === "wide" ? "w-20 px-1.5" : "w-11",
                  )}
                >
                  <img
                    src={sponsorLogo(s, lang)}
                    alt={s.name}
                    className={cn("object-contain", s.logoShape === "wide" ? "h-9 w-16" : "h-8 w-8")}
                  />
                </span>
              ) : (
                <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-xl ${s.accent ?? "from-primary to-fuchsia-500"}`}>
                  {s.badge}
                </span>
              )}
              <span className="min-w-0">
                <span className="block truncate font-semibold">{s.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{s.tagline[lang]}</span>
              </span>
            </a>
          ))}
        </div>

        <div className="mt-8 text-center">
          <Link
            to={prefix("/sponsors")}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
          >
            {t.sponsors.viewAll}
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
