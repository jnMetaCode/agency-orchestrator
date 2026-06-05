import { KeyRound, Unlock } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageProvider";
import { SITE } from "@/lib/site";

export function Providers() {
  const { t } = useLanguage();
  const p = t.providers;

  return (
    <section className="container-page py-20 md:py-28">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{p.title}</h2>
        <p className="mt-4 text-muted-foreground">{p.subtitle}</p>
      </div>

      <div className="mt-10 grid gap-5 md:grid-cols-2">
        <div className="rounded-2xl border border-primary/30 bg-primary/[0.05] p-6">
          <div className="flex items-center gap-2 font-semibold text-primary">
            <KeyRound className="size-5" />
            {p.keyed}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {SITE.providersKeyed.map((name) => (
              <span key={name} className="rounded-lg border border-border/70 bg-card/70 px-3 py-1.5 text-sm font-medium">
                {name}
              </span>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-border/70 bg-card/60 p-6">
          <div className="flex items-center gap-2 font-semibold">
            <Unlock className="size-5 text-muted-foreground" />
            {p.keyfree}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {SITE.providersKeyfree.map((name) => (
              <span key={name} className="rounded-lg border border-border/70 bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground">
                {name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
