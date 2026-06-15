import { useMemo, useState } from "react";
import { ArrowUpRight, Search } from "lucide-react";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { useLanguage } from "@/i18n/LanguageProvider";
import { SITE } from "@/lib/site";
import { cn } from "@/lib/utils";
import expertsData from "@/content/experts.json";

interface Expert {
  category: string;
  categoryName: string;
  id: string;
  name: string;
  description: string;
  emoji: string;
  color: string;
}

const DATA = expertsData as { zh: Expert[]; en: Expert[] };

function Avatar({ e }: { e: Expert }) {
  return (
    <span
      className="grid size-10 shrink-0 place-items-center rounded-xl text-lg font-bold text-white"
      style={{ background: e.color || "#888" }}
    >
      {e.emoji || e.name.slice(0, 1)}
    </span>
  );
}

export default function Experts() {
  const { t, lang } = useLanguage();
  const x = t.experts;
  const all = DATA[lang] ?? DATA.zh;
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");

  const categories = useMemo(() => {
    const m = new Map<string, string>();
    all.forEach((e) => m.set(e.category, e.categoryName));
    return Array.from(m, ([id, name]) => ({ id, name }));
  }, [all]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((e) => {
      if (cat !== "all" && e.category !== cat) return false;
      if (!needle) return true;
      return (e.name + e.description + e.categoryName).toLowerCase().includes(needle);
    });
  }, [all, q, cat]);

  return (
    <>
      <main className="pt-24">
        <div className="container-page pb-20">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl md:text-5xl">{x.title}</h1>
            <p className="mx-auto mt-4 text-pretty leading-relaxed text-muted-foreground">{x.subtitle}</p>
          </div>

          <div className="mx-auto mt-8 max-w-xl">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={x.searchPlaceholder}
                className="w-full rounded-xl border border-border/70 bg-card/60 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-primary/40"
              />
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <Chip active={cat === "all"} onClick={() => setCat("all")}>{x.all}</Chip>
            {categories.map((c) => (
              <Chip key={c.id} active={cat === c.id} onClick={() => setCat(c.id)}>{c.name}</Chip>
            ))}
          </div>

          <p className="mt-4 text-center text-sm text-muted-foreground">{list.length} {x.countSuffix}</p>

          {list.length === 0 ? (
            <p className="mt-16 text-center text-sm text-muted-foreground">{x.empty}</p>
          ) : (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((e) => (
                <div
                  key={`${e.category}/${e.id}`}
                  className="flex flex-col rounded-2xl border border-border/70 bg-card/60 p-5 transition-colors hover:border-primary/40"
                >
                  <div className="flex items-center gap-3">
                    <Avatar e={e} />
                    <div className="min-w-0">
                      <div className="truncate text-[11px] font-medium text-primary">{e.categoryName}</div>
                      <h3 className="truncate font-semibold">{e.name}</h3>
                    </div>
                  </div>
                  <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-muted-foreground">{e.description}</p>
                </div>
              ))}
            </div>
          )}

          <div className="mt-12 text-center">
            <a
              href={SITE.rolesRepo}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 bg-card/60 px-4 py-3 text-sm font-medium hover:border-primary/40"
            >
              {x.repoCta}
              <ArrowUpRight className="size-4 text-primary" />
            </a>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-sm font-medium transition-colors",
        active ? "border-primary/40 bg-primary/10 text-primary" : "border-border/70 text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
