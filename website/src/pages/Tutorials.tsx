import { ArrowUpRight, Clock } from "lucide-react";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/i18n/LanguageProvider";
import { SITE } from "@/lib/site";

export default function Tutorials() {
  const { t } = useLanguage();
  const tut = t.tutorials;

  return (
    <>
      <main className="pt-24">
        <div className="container-page pb-20">
          <div className="max-w-2xl">
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{tut.title}</h1>
            <p className="mt-3 text-muted-foreground">{tut.subtitle}</p>
          </div>

          <div className="mt-10 grid gap-5 sm:grid-cols-2">
            {tut.items.map((item) => (
              <a
                key={item.title}
                href={SITE.repo}
                target="_blank"
                rel="noreferrer"
                className="group flex flex-col rounded-2xl border border-border/70 bg-card/60 p-6 transition-all hover:-translate-y-0.5 hover:border-primary/40"
              >
                <div className="flex items-center justify-between">
                  <Badge className="border-primary/30 bg-primary/10 text-primary">{item.tag}</Badge>
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="size-3.5" />
                    {item.min}
                  </span>
                </div>
                <h3 className="mt-4 text-lg font-semibold">{item.title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{item.desc}</p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
                  {tut.readMore}
                  <ArrowUpRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </span>
              </a>
            ))}
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
