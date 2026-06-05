import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/i18n/LanguageProvider";

export default function NotFound() {
  const { t, prefix } = useLanguage();
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center">
      <div>
        <div className="text-7xl font-extrabold text-gradient">404</div>
        <h1 className="mt-4 text-2xl font-bold">{t.notFound.title}</h1>
        <p className="mt-2 text-muted-foreground">{t.notFound.desc}</p>
        <Button asChild className="mt-6">
          <Link to={prefix("/")}>{t.notFound.back}</Link>
        </Button>
      </div>
    </main>
  );
}
