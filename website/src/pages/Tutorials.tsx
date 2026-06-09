import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Clock, Mail, User } from "lucide-react";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/i18n/LanguageProvider";
import { SITE } from "@/lib/site";
import { cn } from "@/lib/utils";
import {
  tutorials,
  tutorialCategories,
  tutorialSources,
  type TutorialCategory,
  type TutorialSource,
} from "@/content/tutorials";

type CatFilter = TutorialCategory | "all";
type SrcFilter = TutorialSource | "all";

export default function Tutorials() {
  const { t, lang, prefix } = useLanguage();
  const tut = t.tutorials;
  const [cat, setCat] = useState<CatFilter>("all");
  const [src, setSrc] = useState<SrcFilter>("all");

  const cats = tutorialCategories();
  const srcs = tutorialSources();

  const list = useMemo(
    () => tutorials.filter((x) => (cat === "all" || x.category === cat) && (src === "all" || x.source === src)),
    [cat, src],
  );

  const Chip = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
        active
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border/70 text-muted-foreground hover:border-primary/30 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );

  return (
    <>
      <main className="pt-24">
        <div className="container-page pb-20">
          {/* Hero */}
          <div className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-sm font-semibold text-primary">
              {tut.badge}
            </span>
            <h1 className="mt-5 text-3xl font-extrabold tracking-tight sm:text-4xl md:text-5xl">{tut.title}</h1>
            <p className="mx-auto mt-4 max-w-xl text-pretty leading-relaxed text-muted-foreground">{tut.subtitle}</p>
            <div className="mt-6">
              <Button asChild variant="outline">
                <a href={`mailto:${SITE.sponsorEmail}?subject=Tutorial%20submission`}>
                  <Mail className="size-4" />
                  {tut.submit}
                </a>
              </Button>
            </div>
          </div>

          {/* Filters */}
          <div className="mt-12 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-12 shrink-0 text-sm text-muted-foreground">{tut.filterCategory}</span>
              <Chip active={cat === "all"} onClick={() => setCat("all")}>{tut.all}</Chip>
              {cats.map((c) => (
                <Chip key={c} active={cat === c} onClick={() => setCat(c)}>{tut.categories[c]}</Chip>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-12 shrink-0 text-sm text-muted-foreground">{tut.filterSource}</span>
              <Chip active={src === "all"} onClick={() => setSrc("all")}>{tut.all}</Chip>
              {srcs.map((sname) => (
                <Chip key={sname} active={src === sname} onClick={() => setSrc(sname)}>{tut.sources[sname]}</Chip>
              ))}
            </div>
          </div>

          {/* Cards */}
          {list.length === 0 ? (
            <p className="mt-16 text-center text-sm text-muted-foreground">{tut.empty}</p>
          ) : (
            <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((item) => (
                <Link
                  key={item.slug}
                  to={prefix(`/tutorials/${item.slug}`)}
                  className="group flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/60 transition-all hover:-translate-y-0.5 hover:border-primary/40"
                >
                  {/* header band */}
                  <div className={cn("relative flex h-28 items-center justify-center gap-2 bg-gradient-to-br", item.accent)}>
                    <span className="absolute left-3 top-3 flex items-center gap-1.5">
                      <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                        {tut.sources[item.source]}
                      </span>
                      <span className="rounded-md bg-background/70 px-1.5 py-0.5 text-[11px] font-medium text-foreground/70">
                        {tut.categories[item.category]}
                      </span>
                    </span>
                    {item.external && (
                      <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-md bg-background/70 px-1.5 py-0.5 text-[11px] text-foreground/60">
                        <ArrowUpRight className="size-3" />
                      </span>
                    )}
                    {item.icons.map((ic, idx) => (
                      <span
                        key={idx}
                        className="grid size-11 place-items-center rounded-full bg-white text-xl shadow"
                      >
                        {ic}
                      </span>
                    ))}
                  </div>

                  {/* body */}
                  <div className="flex flex-1 flex-col p-5">
                    <h3 className="text-base font-semibold leading-snug">{item.title[lang]}</h3>
                    <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{item.summary[lang]}</p>
                    <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <User className="size-3.5" />
                        {item.author}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="size-3.5" />
                        {item.min} {tut.minRead}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
