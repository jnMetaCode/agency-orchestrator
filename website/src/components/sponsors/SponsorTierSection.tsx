import { Heart, Plus } from "lucide-react";
import { SponsorCard } from "./SponsorCard";
import { useLanguage } from "@/i18n/LanguageProvider";
import { sponsorsByTier, type SponsorTier } from "@/content/sponsors";
import { SITE } from "@/lib/site";

export function SponsorTierSection({ tier }: { tier: SponsorTier }) {
  const { t } = useLanguage();
  const list = sponsorsByTier(tier);
  const isFlagship = tier === "flagship";
  const title = isFlagship ? t.sponsors.flagshipLabel : t.sponsors.standardLabel;

  return (
    <section className="container-page py-10">
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold">{title}</h2>
          <span className="h-px flex-1 bg-border/70" />
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">{isFlagship ? t.sponsors.flagshipDesc : t.sponsors.standardDesc}</p>
      </div>

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {list.map((s) => (
          <SponsorCard key={s.id} sponsor={s} />
        ))}

        <a
          href={SITE.sponsorContact}
          target="_blank"
          rel="noreferrer"
          className="group flex min-h-[180px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-muted/20 p-6 text-center transition-colors hover:border-primary/50 hover:bg-primary/[0.04]"
        >
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-muted text-muted-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
            <Plus className="size-5" />
          </span>
          <span className="text-sm font-semibold">{t.sponsors.becomeCta}</span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Heart className="size-3" />
            {isFlagship ? t.sponsors.flagshipLabel : t.sponsors.emptyStandard}
          </span>
        </a>
      </div>
    </section>
  );
}
