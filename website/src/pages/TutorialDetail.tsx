import { ArrowLeft, Clock } from "lucide-react";
import { Link, Navigate, useParams } from "react-router-dom";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/copy-button";
import { Markdown } from "@/components/studio/Markdown";
import { useLanguage } from "@/i18n/LanguageProvider";
import { tutorialBySlug } from "@/content/tutorials";

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

export default function TutorialDetail() {
  const { t, lang, prefix } = useLanguage();
  const { slug } = useParams();
  const tut = slug ? tutorialBySlug(slug) : undefined;

  if (!tut) return <Navigate to={prefix("/tutorials")} replace />;

  return (
    <>
      <main className="pt-24">
        <div className="container-page max-w-3xl pb-20">
          <Link
            to={prefix("/tutorials")}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            {t.tutorials.back}
          </Link>

          <div className="mt-6 flex items-center gap-3">
            <Badge className="border-primary/30 bg-primary/10 text-primary">{t.tutorials.categories[tut.category]}</Badge>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="size-3.5" />
              {tut.min} {t.tutorials.minRead}
            </span>
          </div>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">{tut.title[lang]}</h1>
          <p className="mt-3 leading-relaxed text-muted-foreground">{tut.summary[lang]}</p>

          <div className="mt-10 space-y-10">
            {tut.sections.map((s) => (
              <section key={s.heading[lang]}>
                <h2 className="text-xl font-bold">{s.heading[lang]}</h2>
                <Markdown className="mt-2 text-base text-muted-foreground">{s.body[lang]}</Markdown>
                {s.code && <CodeBlock code={s.code} />}
              </section>
            ))}
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
