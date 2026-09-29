import { ArrowUpRight, Sparkles } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageProvider";
import { sponsorLogo, sponsorUrl, type Sponsor } from "@/content/sponsors";
import { PerkText } from "./PerkText";
import { cn } from "@/lib/utils";

export function SponsorCard({ sponsor }: { sponsor: Sponsor }) {
  const { lang } = useLanguage();
  const s = sponsor;
  const href = sponsorUrl(s, lang);

  // 旗舰 + 有 banner：全宽大屏卡片，图片在上、文字在下（参考 CC Switch 旗舰位）
  if (s.banner) {
    return (
      <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-gold/40 bg-card/60 transition-all hover:border-gold/70 sm:col-span-2 lg:col-span-4">
        <a href={href} target="_blank" rel="noreferrer" className="block">
          <img src={s.banner} alt={s.name} className="aspect-[1269/337] w-full object-cover" />
        </a>

        <div className="flex flex-col gap-3 p-6 sm:p-8">
          <h3 className="text-2xl font-bold">{s.name}</h3>
          <p className="text-sm font-semibold text-gold">{s.tagline[lang]}</p>

          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{s.description[lang]}</p>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
            {s.perk && (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-gold/10 px-2.5 py-1.5 text-sm font-medium text-gold">
                <Sparkles className="size-4 shrink-0" />
                <PerkText text={s.perk[lang]} code={s.couponCode} />
              </span>
            )}
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex items-center gap-2 rounded-xl bg-gold px-5 py-2.5 text-sm font-semibold text-gold-foreground transition-opacity hover:opacity-90"
            >
              {s.couponCode && (
                <span className="rounded-md bg-gold-foreground/15 px-1.5 py-0.5 text-sm font-bold tracking-wide">
                  {s.couponCode}
                </span>
              )}
              {s.perkCta?.[lang] ?? s.tagline[lang]}
              <ArrowUpRight className="size-4" />
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="group relative flex min-w-0 flex-col gap-3 rounded-2xl border border-border/70 bg-card/60 p-4 transition-all hover:z-20 hover:-translate-y-0.5 hover:border-primary/40"
    >
      <ArrowUpRight className="absolute right-4 top-5 size-4 text-muted-foreground transition-colors group-hover:text-primary" />

      {/* 紧凑卡：logo + 名称 + 一句话，一行 4 张；完整介绍在悬停浮层里 */}
      <div className="flex items-center gap-3 pr-6">
        {s.logo ? (
          <span
            className={cn(
              "grid h-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-border/60 bg-white shadow-sm",
              s.logoShape === "wide" ? "w-20 px-1.5" : "w-12",
            )}
          >
            <img
              src={sponsorLogo(s, lang)}
              alt={s.name}
              className={cn("object-contain", s.logoShape === "wide" ? "h-10 w-16" : "h-9 w-9")}
            />
          </span>
        ) : (
          <span
            className={cn(
              "grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-xl shadow-sm",
              s.accent ?? "from-primary to-fuchsia-500",
            )}
          >
            {s.badge}
          </span>
        )}
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold" title={s.name}>
            {s.name}
          </h3>
          <p className="truncate text-xs text-muted-foreground" title={s.tagline[lang]}>
            {s.tagline[lang]}
          </p>
        </div>
      </div>

      {s.perk && (
        <span
          className="inline-flex max-w-full items-center gap-1.5 self-start rounded-lg bg-gold/10 px-2.5 py-1 text-xs font-medium text-gold"
          title={s.perk[lang]}
        >
          <Sparkles className="size-3.5 shrink-0" />
          <span className="truncate">{s.perk[lang]}</span>
        </span>
      )}

      <div className="invisible absolute left-0 top-full z-20 mt-2 w-full rounded-xl border border-border/70 bg-background/95 p-4 text-sm leading-relaxed text-foreground opacity-0 shadow-xl backdrop-blur-xl transition-all group-hover:visible group-hover:opacity-100">
        {s.description[lang]}
      </div>
    </a>
  );
}
