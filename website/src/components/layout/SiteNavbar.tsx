import { Github, Languages, Menu, Star, X } from "lucide-react";
import { useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useLanguage } from "@/i18n/LanguageProvider";
import { SITE } from "@/lib/site";
import { cn } from "@/lib/utils";

export function SiteNavbar() {
  const { t, lang, toggle, prefix } = useLanguage();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  const links = [
    { to: prefix("/#features"), label: t.nav.features, hash: true },
    { to: prefix("/studio"), label: t.nav.studio },
    { to: prefix("/sponsors"), label: t.nav.sponsors },
    { to: prefix("/docs"), label: t.nav.docs },
    { to: prefix("/tutorials"), label: t.nav.tutorials },
  ];

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <nav className="container-page flex h-16 items-center justify-between">
        <Link to={prefix("/")} className="flex items-center gap-2.5 font-bold" onClick={() => setOpen(false)}>
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground shadow-lg shadow-primary/30">
            ao
          </span>
          <span className="hidden text-[15px] sm:block">Agency Orchestrator</span>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {links.map((l) =>
            l.hash ? (
              <a
                key={l.to}
                href={l.to}
                className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {l.label}
              </a>
            ) : (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) =>
                  cn(
                    "rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:text-foreground",
                    isActive && pathname === l.to ? "text-foreground" : "text-muted-foreground",
                  )
                }
              >
                {l.label}
              </NavLink>
            ),
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggle}
            className="hidden h-9 items-center gap-1.5 rounded-lg border border-border/70 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
          >
            <Languages className="size-4" />
            {lang === "zh" ? "EN" : "中"}
          </button>
          <ThemeToggle />
          <Button asChild size="sm" variant="outline" className="hidden lg:inline-flex">
            <a href={SITE.repo} target="_blank" rel="noreferrer">
              <Star className="size-4" />
              {t.nav.star}
            </a>
          </Button>
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <a href={SITE.repo} target="_blank" rel="noreferrer">
              <Github className="size-4" />
              GitHub
            </a>
          </Button>
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border/70 md:hidden"
            onClick={() => setOpen((p) => !p)}
            aria-label="Menu"
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </nav>

      {open && (
        <div className="border-t border-border/60 bg-background/95 md:hidden">
          <div className="container-page flex flex-col gap-1 py-3">
            {links.map((l) => (
              <a
                key={l.to}
                href={l.to}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {l.label}
              </a>
            ))}
            <button
              type="button"
              onClick={() => {
                toggle();
                setOpen(false);
              }}
              className="rounded-lg px-3 py-2.5 text-left text-sm font-medium text-muted-foreground hover:bg-muted"
            >
              {t.meta.switchTo}
            </button>
            <a
              href={SITE.repo}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              <Github className="size-4" />
              GitHub
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
