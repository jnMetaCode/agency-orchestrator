import { Github } from "lucide-react";
import { Link } from "react-router-dom";
import { useLanguage } from "@/i18n/LanguageProvider";
import { SITE } from "@/lib/site";

export function SiteFooter() {
  const { t, prefix } = useLanguage();
  const f = t.footer;

  const cols = [
    {
      title: f.product,
      links: [
        { label: f.links.features, href: prefix("/#features"), external: false },
        { label: f.links.sponsors, href: prefix("/sponsors"), external: false },
        { label: f.links.docs, href: prefix("/docs"), external: false },
        { label: f.links.tutorials, href: prefix("/tutorials"), external: false },
      ],
    },
    {
      title: f.resources,
      links: [
        { label: f.links.github, href: SITE.repo, external: true },
        { label: f.links.roles, href: SITE.rolesRepo, external: true },
        { label: f.links.changelog, href: SITE.changelog, external: true },
        { label: f.links.license, href: SITE.license, external: true },
      ],
    },
    {
      title: f.community,
      links: [
        { label: f.links.issues, href: SITE.issues, external: true },
        { label: "npm", href: SITE.npm, external: true },
      ],
    },
  ];

  return (
    <footer className="border-t border-border/60 bg-muted/30">
      <div className="container-page grid gap-10 py-14 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Link to={prefix("/")} className="flex items-center gap-2.5 font-bold">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">ao</span>
            Agency Orchestrator
          </Link>
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">{f.tagline}</p>
          <a
            href={SITE.repo}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border/70 px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <Github className="size-4" />
            jnMetaCode/agency-orchestrator
          </a>
        </div>
        {cols.map((col) => (
          <div key={col.title}>
            <h4 className="text-sm font-semibold">{col.title}</h4>
            <ul className="mt-3 space-y-2.5 text-sm">
              {col.links.map((l) =>
                l.external ? (
                  <li key={l.label}>
                    <a href={l.href} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                      {l.label}
                    </a>
                  </li>
                ) : l.href.includes("#") ? (
                  <li key={l.label}>
                    <a href={l.href} className="text-muted-foreground hover:text-foreground">
                      {l.label}
                    </a>
                  </li>
                ) : (
                  <li key={l.label}>
                    <Link to={l.href} className="text-muted-foreground hover:text-foreground">
                      {l.label}
                    </Link>
                  </li>
                ),
              )}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-border/60">
        <div className="container-page flex flex-col items-center justify-between gap-2 py-5 text-xs text-muted-foreground sm:flex-row">
          <span>© {SITE.name}</span>
          <span>{f.copyright}</span>
        </div>
      </div>
    </footer>
  );
}
