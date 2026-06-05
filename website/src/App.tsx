import { lazy, Suspense, useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { SiteNavbar } from "@/components/layout/SiteNavbar";
import { LanguageProvider, useLanguage } from "@/i18n/LanguageProvider";

const Home = lazy(() => import("@/pages/Home"));
const Sponsors = lazy(() => import("@/pages/Sponsors"));
const Studio = lazy(() => import("@/pages/Studio"));
const Docs = lazy(() => import("@/pages/Docs"));
const Tutorials = lazy(() => import("@/pages/Tutorials"));
const NotFound = lazy(() => import("@/pages/NotFound"));

function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) return;
    window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

function Fallback() {
  const { t } = useLanguage();
  return (
    <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">{t.common.loading}</div>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <ScrollToTop />
      <SiteNavbar />
      <Suspense fallback={<Fallback />}>
        <Routes>
          {["/", "/zh", "/en"].map((p) => (
            <Route key={p} path={p} element={<Home />} />
          ))}
          {["/sponsors", "/zh/sponsors", "/en/sponsors"].map((p) => (
            <Route key={p} path={p} element={<Sponsors />} />
          ))}
          {["/studio", "/zh/studio", "/en/studio"].map((p) => (
            <Route key={p} path={p} element={<Studio />} />
          ))}
          {["/docs", "/zh/docs", "/en/docs"].map((p) => (
            <Route key={p} path={p} element={<Docs />} />
          ))}
          {["/tutorials", "/zh/tutorials", "/en/tutorials"].map((p) => (
            <Route key={p} path={p} element={<Tutorials />} />
          ))}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </LanguageProvider>
  );
}
