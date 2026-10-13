import { lazy, Suspense, useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { SiteNavbar } from "@/components/layout/SiteNavbar";
import { BackToTop } from "@/components/layout/BackToTop";
import { LanguageProvider, useLanguage } from "@/i18n/LanguageProvider";

const Home = lazy(() => import("@/pages/Home"));
const Sponsors = lazy(() => import("@/pages/Sponsors"));
const Studio = lazy(() => import("@/pages/Studio"));
const Experts = lazy(() => import("@/pages/Experts"));
const PromptStudio = lazy(() => import("@/pages/PromptStudio"));
const CreativeLibrary = lazy(() => import("@/pages/CreativeLibrary"));
const Docs = lazy(() => import("@/pages/Docs"));
const Tutorials = lazy(() => import("@/pages/Tutorials"));
const TutorialDetail = lazy(() => import("@/pages/TutorialDetail"));
const Changelog = lazy(() => import("@/pages/Changelog"));
const NotFound = lazy(() => import("@/pages/NotFound"));

function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) return;
    window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

// GA4 单页应用 page_view：gtag 已设 send_page_view:false，由这里在每次路由变化（含首屏）
// 手动补发，确保各页访问都被统计且不重复。gtag 缺失（如本地无网/被拦）时静默跳过。
function PageViews() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    const gtag = (window as unknown as { gtag?: (...a: unknown[]) => void }).gtag;
    if (typeof gtag !== "function") return;
    gtag("event", "page_view", {
      page_location: window.location.href,
      page_path: pathname + search,
      page_title: document.title,
    });
  }, [pathname, search]);
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
      <PageViews />
      <SiteNavbar />
      <BackToTop />
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
          {["/experts", "/zh/experts", "/en/experts"].map((p) => (
            <Route key={p} path={p} element={<Experts />} />
          ))}
          {["/creative", "/zh/creative", "/en/creative"].map((p) => (
            <Route key={p} path={p} element={<CreativeLibrary />} />
          ))}
          {["/prompt", "/zh/prompt", "/en/prompt"].map((p) => (
            <Route key={p} path={p} element={<PromptStudio />} />
          ))}
          {["/docs", "/zh/docs", "/en/docs"].map((p) => (
            <Route key={p} path={p} element={<Docs />} />
          ))}
          {["/docs/:slug", "/zh/docs/:slug", "/en/docs/:slug"].map((p) => (
            <Route key={p} path={p} element={<Docs />} />
          ))}
          {["/tutorials", "/zh/tutorials", "/en/tutorials"].map((p) => (
            <Route key={p} path={p} element={<Tutorials />} />
          ))}
          {["/tutorials/:slug", "/zh/tutorials/:slug", "/en/tutorials/:slug"].map((p) => (
            <Route key={p} path={p} element={<TutorialDetail />} />
          ))}
          {["/changelog", "/zh/changelog", "/en/changelog"].map((p) => (
            <Route key={p} path={p} element={<Changelog />} />
          ))}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </LanguageProvider>
  );
}
