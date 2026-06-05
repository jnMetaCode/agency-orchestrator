import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useLanguage } from "@/i18n/LanguageProvider";

export function SponsorFAQ() {
  const { t } = useLanguage();
  const s = t.sponsors;

  return (
    <section className="container-page py-14">
      <div className="mx-auto max-w-2xl">
        <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">{s.faqTitle}</h2>
        <Accordion type="single" collapsible className="mt-8 space-y-3">
          {s.faq.map((item, i) => (
            <AccordionItem key={item.q} value={`faq-${i}`}>
              <AccordionTrigger>{item.q}</AccordionTrigger>
              <AccordionContent>{item.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
