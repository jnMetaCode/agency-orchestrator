import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { ArrowUpRight, Tag } from "lucide-react";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "@/components/studio/Markdown";
import { useLanguage } from "@/i18n/LanguageProvider";
import { SITE } from "@/lib/site";
import { changelog, changelogAnchor } from "@/lib/changelog";

export default function Changelog() {
  const { t } = useLanguage();
  const c = t.changelog;
  const { hash } = useLocation();

  // 支持 /changelog#v0.6.17 直接定位到某个版本
  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [hash]);

  return (
    <>
      <main className="pt-24">
        <div className="container-page max-w-3xl pb-20">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{c.title}</h1>
          <p className="mt-3 text-muted-foreground">{c.subtitle}</p>

          <div className="mt-10 space-y-5">
            {changelog.map((entry, i) => {
              const anchor = changelogAnchor(entry.version);
              return (
                <section
                  key={entry.version}
                  id={anchor}
                  className="scroll-mt-24 rounded-2xl border border-border/70 bg-card/60 p-6"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <a href={`#${anchor}`} className="inline-flex items-center gap-1.5 text-xl font-bold hover:text-primary">
                      <Tag className="size-4 text-primary" />
                      {/^\d/.test(entry.version) ? `v${entry.version}` : entry.version}
                    </a>
                    {i === 0 && (
                      <Badge className="border-primary/30 bg-primary/10 text-primary">{c.latest}</Badge>
                    )}
                    {entry.date && <span className="text-sm text-muted-foreground">{entry.date}</span>}
                  </div>
                  {entry.body && <Markdown className="mt-4">{entry.body}</Markdown>}
                </section>
              );
            })}
          </div>

          <a
            href={SITE.changelog}
            target="_blank"
            rel="noreferrer"
            className="mt-12 inline-flex items-center gap-1.5 rounded-xl border border-border/70 bg-card/60 px-4 py-3 text-sm font-medium hover:border-primary/40"
          >
            {c.repoLink}
            <ArrowUpRight className="size-4 text-primary" />
          </a>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
