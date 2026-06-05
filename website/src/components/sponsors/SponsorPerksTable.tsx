import { Check } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageProvider";

function Cell({ value }: { value: string }) {
  if (value === "✓") return <Check className="mx-auto size-4 text-emerald-500" />;
  if (value === "—") return <span className="text-muted-foreground/50">—</span>;
  return <span>{value}</span>;
}

export function SponsorPerksTable() {
  const { t } = useLanguage();
  const p = t.sponsors.perksTable;

  return (
    <section className="container-page py-14">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{t.sponsors.perksTitle}</h2>
        <p className="mt-3 text-muted-foreground">{t.sponsors.perksSubtitle}</p>
      </div>

      <div className="mx-auto mt-8 max-w-3xl overflow-hidden rounded-2xl border border-border/70">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-left">
              <th className="px-5 py-3.5 font-semibold">{p.perk}</th>
              <th className="px-5 py-3.5 text-center font-semibold text-gold">{p.flagship}</th>
              <th className="px-5 py-3.5 text-center font-semibold">{p.standard}</th>
            </tr>
          </thead>
          <tbody>
            {p.rows.map((row, i) => (
              <tr key={row.perk} className={i % 2 ? "bg-muted/20" : ""}>
                <td className="px-5 py-3.5">{row.perk}</td>
                <td className="px-5 py-3.5 text-center font-medium">
                  <Cell value={row.flagship} />
                </td>
                <td className="px-5 py-3.5 text-center text-muted-foreground">
                  <Cell value={row.standard} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
