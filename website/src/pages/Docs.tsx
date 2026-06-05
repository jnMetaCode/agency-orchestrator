import { ArrowUpRight } from "lucide-react";
import { CopyButton } from "@/components/ui/copy-button";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { useLanguage } from "@/i18n/LanguageProvider";
import { SITE } from "@/lib/site";

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
  const { t } = useLanguage();
  const d = t.docs;

  return (
    <>
      <main className="pt-24">
        <div className="container-page max-w-3xl pb-20">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{d.title}</h1>
          <p className="mt-3 text-muted-foreground">{d.subtitle}</p>

          <div className="mt-10 space-y-10">
            {d.sections.map((s, i) => (
              <section key={s.heading} className="scroll-mt-24" id={`doc-${i}`}>
                <h2 className="text-xl font-bold">
                  <span className="mr-2 text-muted-foreground/50">{String(i + 1).padStart(2, "0")}</span>
                  {s.heading}
                </h2>
                <p className="mt-2 leading-relaxed text-muted-foreground">{s.body}</p>
                <CodeBlock code={s.code} />
              </section>
            ))}
          </div>

          <a
            href={SITE.repo}
            target="_blank"
            rel="noreferrer"
            className="mt-12 inline-flex items-center gap-1.5 rounded-xl border border-border/70 bg-card/60 px-4 py-3 text-sm font-medium hover:border-primary/40"
          >
            {d.moreInRepo}
            <ArrowUpRight className="size-4 text-primary" />
          </a>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
