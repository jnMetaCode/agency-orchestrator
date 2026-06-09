import { useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Search } from "lucide-react";
import { CopyButton } from "@/components/ui/copy-button";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Markdown } from "@/components/studio/Markdown";
import { useLanguage } from "@/i18n/LanguageProvider";
import { cn } from "@/lib/utils";
import { docBySlug, docGroups, firstDocSlug } from "@/content/docs";

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative mt-4 overflow-hidden rounded-xl border border-border/70 bg-[#0b0e16]">
      <div className="absolute right-2 top-2">
        <CopyButton value={code} className="border-white/10 bg-white/5 text-white/60" />
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed text-white/85">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default function Docs() {
  const { t, lang, prefix } = useLanguage();
  const d = t.docs;
  const { slug } = useParams();
  const [query, setQuery] = useState("");

  const activeSlug = slug ?? firstDocSlug;
  const page = docBySlug(activeSlug);
  if (slug && !page) return <Navigate to={prefix("/docs")} replace />;

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return docGroups;
    return docGroups
      .map((g) => ({ ...g, pages: g.pages.filter((p) => p.title[lang].toLowerCase().includes(q)) }))
      .filter((g) => g.pages.length > 0);
  }, [query, lang]);

  return (
    <>
      <main className="pt-16">
        <div className="container-page grid gap-8 py-10 lg:grid-cols-[220px_1fr] xl:grid-cols-[220px_1fr_200px]">
          {/* 左侧导航 */}
          <aside className="lg:sticky lg:top-20 lg:self-start">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={d.searchPlaceholder}
                className="w-full rounded-lg border border-border/70 bg-card/60 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary/40"
              />
            </div>

            <nav className="mt-5 space-y-5">
              {filteredGroups.map((g) => (
                <div key={g.label[lang]}>
                  <div className="mb-1.5 flex items-center gap-2 px-2 text-sm font-semibold">
                    <span>{g.icon}</span>
                    {g.label[lang]}
                  </div>
                  <ul className="space-y-0.5">
                    {g.pages.map((p) => (
                      <li key={p.slug}>
                        <Link
                          to={prefix(`/docs/${p.slug}`)}
                          className={cn(
                            "block rounded-lg px-3 py-1.5 text-sm transition-colors",
                            p.slug === activeSlug
                              ? "bg-primary/10 font-medium text-primary"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground",
                          )}
                        >
                          {p.title[lang]}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </aside>

          {/* 中间正文 */}
          <article className="min-w-0">
            <h1 className="text-3xl font-extrabold tracking-tight">{page?.title[lang]}</h1>
            <div className="mt-8 space-y-10">
              {page?.sections.map((s, i) => (
                <section key={i} id={`sec-${i}`} className="scroll-mt-24">
                  <h2 className="text-xl font-bold">{s.heading[lang]}</h2>
                  <Markdown className="mt-2 text-base text-muted-foreground">{s.body[lang]}</Markdown>
                  {s.code && <CodeBlock code={s.code} />}
                </section>
              ))}
            </div>
          </article>

          {/* 右侧本页目录 */}
          <aside className="hidden xl:sticky xl:top-20 xl:block xl:self-start">
            <div className="text-sm font-semibold">{d.onThisPage}</div>
            <ul className="mt-3 space-y-2 border-l border-border/70">
              {page?.sections.map((s, i) => (
                <li key={i}>
                  <a
                    href={`#sec-${i}`}
                    className="-ml-px block border-l border-transparent pl-3 text-sm text-muted-foreground hover:border-primary hover:text-foreground"
                  >
                    {s.heading[lang]}
                  </a>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
