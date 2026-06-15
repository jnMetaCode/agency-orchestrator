import { useCallback, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, Copy, Search, X } from "lucide-react";
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

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function Avatar({ e, className }: { e: Expert; className?: string }) {
  return (
    <span
      className={cn("grid size-10 shrink-0 place-items-center rounded-xl text-lg font-bold text-white", className)}
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

  // 提示词正文按需 fetch + 缓存；点击复制 / 预览
  const cache = useRef<Map<string, string>>(new Map());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [modal, setModal] = useState<Expert | null>(null);
  const [modalText, setModalText] = useState("");
  const [modalLoading, setModalLoading] = useState(false);

  const fetchPrompt = useCallback(
    async (e: Expert): Promise<string> => {
      const key = `${lang}/${e.category}/${e.id}`;
      if (cache.current.has(key)) return cache.current.get(key)!;
      const res = await fetch(`/prompts/${lang}/${e.category}/${e.id}.md`);
      if (!res.ok) throw new Error("fetch failed");
      const text = await res.text();
      cache.current.set(key, text);
      return text;
    },
    [lang],
  );

  const flash = (key: string) => {
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((c) => (c === key ? null : c)), 1800);
  };

  const handleCopy = async (e: Expert) => {
    const k = `${e.category}/${e.id}`;
    try {
      const ok = await copyText(await fetchPrompt(e));
      flash(ok ? k : `fail:${k}`);
    } catch {
      flash(`fail:${k}`);
    }
  };

  const openModal = async (e: Expert) => {
    setModal(e);
    setModalText("");
    setModalLoading(true);
    try {
      setModalText(await fetchPrompt(e));
    } catch {
      setModalText("");
    }
    setModalLoading(false);
  };

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
              {list.map((e) => {
                const k = `${e.category}/${e.id}`;
                const copied = copiedKey === k;
                const failed = copiedKey === `fail:${k}`;
                return (
                  <div
                    key={k}
                    className="flex flex-col rounded-2xl border border-border/70 bg-card/60 p-5 transition-colors hover:border-primary/40"
                  >
                    <button type="button" onClick={() => openModal(e)} className="flex items-center gap-3 text-left">
                      <Avatar e={e} />
                      <div className="min-w-0">
                        <div className="truncate text-[11px] font-medium text-primary">{e.categoryName}</div>
                        <h3 className="truncate font-semibold">{e.name}</h3>
                      </div>
                    </button>
                    <p className="mt-3 line-clamp-4 flex-1 text-sm leading-relaxed text-muted-foreground">{e.description}</p>
                    <div className="mt-4 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openModal(e)}
                        className="rounded-lg border border-border/70 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-primary/40 hover:text-foreground"
                      >
                        {x.viewPrompt}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCopy(e)}
                        className={cn(
                          "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                          copied
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
                            : failed
                              ? "border-red-500/40 bg-red-500/10 text-red-500"
                              : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15",
                        )}
                      >
                        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                        {copied ? x.copied : failed ? x.copyFailed : x.copyPrompt}
                      </button>
                    </div>
                  </div>
                );
              })}
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

      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6"
          onClick={() => setModal(null)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-border/70 bg-card shadow-2xl sm:rounded-2xl"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-border/70 p-4">
              <Avatar e={modal} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-medium text-primary">{modal.categoryName}</div>
                <h3 className="truncate font-semibold">{modal.name}</h3>
              </div>
              <button
                type="button"
                onClick={() => setModal(null)}
                aria-label={x.close}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>
            <p className="px-4 pt-3 text-xs text-muted-foreground">{x.promptHint}</p>
            <div className="m-4 flex-1 overflow-auto rounded-xl border border-border/60 bg-background/60 p-4">
              {modalLoading ? (
                <p className="text-sm text-muted-foreground">{x.loading}</p>
              ) : (
                <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">{modalText}</pre>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border/70 p-4">
              {(() => {
                const k = `${modal.category}/${modal.id}`;
                const copied = copiedKey === k;
                const failed = copiedKey === `fail:${k}`;
                return (
                  <button
                    type="button"
                    onClick={() => handleCopy(modal)}
                    disabled={modalLoading || !modalText}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50",
                      copied
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
                        : failed
                          ? "border-red-500/40 bg-red-500/10 text-red-500"
                          : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15",
                    )}
                  >
                    {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                    {copied ? x.copied : failed ? x.copyFailed : x.copyPrompt}
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      )}
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
