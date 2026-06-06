import { ExternalLink, Sparkles } from "lucide-react";
import { CopyButton } from "@/components/ui/copy-button";
import { useLanguage } from "@/i18n/LanguageProvider";
import { sponsors } from "@/content/sponsors";

export function SponsorPerksTable() {
  const { t, lang } = useLanguage();
  const s = t.sponsors;
  const p = s.perksTable;
  if (!sponsors.length) return null;

  return (
    <section className="container-page py-14">
      <div className="mx-auto max-w-2xl text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          <Sparkles className="size-3.5" />
          {s.perksBadge}
        </span>
        <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">{s.perksTitle}</h2>
        <p className="mt-2 text-muted-foreground">{s.perksSubtitle}</p>
      </div>

      <div className="mx-auto mt-8 max-w-3xl overflow-hidden rounded-2xl border border-border/70">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-left">
              <th className="px-5 py-3.5 font-semibold">{p.sponsor}</th>
              <th className="px-5 py-3.5 font-semibold">{p.perk}</th>
              <th className="px-5 py-3.5 font-semibold">{p.coupon}</th>
              <th className="px-5 py-3.5 text-right font-semibold">{p.link}</th>
            </tr>
          </thead>
          <tbody>
            {sponsors.map((sp, i) => (
              <tr key={sp.id} className={i % 2 ? "bg-muted/20" : ""}>
                <td className="px-5 py-3.5">
                  <span className="flex items-center gap-2.5">
                    <span className={`grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br text-base ${sp.accent ?? "from-primary to-fuchsia-500"}`}>
                      {sp.badge}
                    </span>
                    <span className="font-medium">{sp.name}</span>
                  </span>
                </td>
                <td className="px-5 py-3.5 text-muted-foreground">{sp.perk?.[lang] ?? sp.tagline[lang]}</td>
                <td className="px-5 py-3.5">
                  {sp.couponCode ? (
                    <span className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border bg-muted/40 px-2 py-1 font-mono text-xs">
                      {sp.couponCode}
                      <CopyButton value={sp.couponCode} className="border-0 bg-transparent px-1 py-0" />
                    </span>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </td>
                <td className="px-5 py-3.5 text-right">
                  <a href={sp.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                    {s.visit}
                    <ExternalLink className="size-3.5" />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
