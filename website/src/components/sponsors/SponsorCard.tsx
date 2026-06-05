import { ExternalLink, Sparkles, Ticket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/copy-button";
import { useLanguage } from "@/i18n/LanguageProvider";
import type { Sponsor } from "@/content/sponsors";
import { cn } from "@/lib/utils";

export function SponsorCard({ sponsor }: { sponsor: Sponsor }) {
  const { t, lang } = useLanguage();
  const s = sponsor;
  const isFlagship = s.tier === "flagship";

  return (
    <div
      className={cn(
        "group relative flex flex-col rounded-2xl border bg-card/60 p-6 transition-all hover:-translate-y-0.5",
        isFlagship ? "border-gold/40 hover:border-gold/70 md:col-span-2" : "border-border/70 hover:border-primary/40",
      )}
    >
      {s.featured && (
        <Badge className="absolute right-4 top-4 border-gold/40 bg-gold/10 text-gold">
          <Sparkles className="size-3" />
          {isFlagship ? t.sponsors.flagshipLabel : t.sponsors.standardLabel}
        </Badge>
      )}

      <div className="flex items-center gap-4">
        <span
          className={cn(
            "grid place-items-center rounded-2xl bg-gradient-to-br text-2xl shadow-lg",
            isFlagship ? "h-16 w-16" : "h-14 w-14",
            s.accent ?? "from-primary to-fuchsia-500",
          )}
        >
          {s.badge}
        </span>
        <div className="min-w-0">
          <h3 className={cn("truncate font-bold", isFlagship ? "text-xl" : "text-lg")}>{s.name}</h3>
          <p className="truncate text-sm text-muted-foreground">{s.tagline[lang]}</p>
        </div>
      </div>

      <p className="mt-4 flex-1 text-sm leading-relaxed text-muted-foreground">{s.description[lang]}</p>

      {s.perk && (
        <div className="mt-4 rounded-xl border border-primary/25 bg-primary/[0.06] px-4 py-3 text-sm">
          <span className="font-medium text-primary">{s.perk[lang]}</span>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        {s.couponCode ? (
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-3 py-1.5 font-mono text-sm">
            <Ticket className="size-3.5 text-muted-foreground" />
            <span>{s.couponCode}</span>
            <CopyButton value={s.couponCode} label={t.sponsors.copyCoupon} copiedLabel={t.sponsors.copied} className="border-0 bg-transparent px-1 py-0" />
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            {s.since ? `${t.sponsors.since} ${s.since}` : ""}
          </span>
        )}
        <a
          href={s.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
        >
          {t.sponsors.visit}
          <ExternalLink className="size-3.5" />
        </a>
      </div>
    </div>
  );
}
