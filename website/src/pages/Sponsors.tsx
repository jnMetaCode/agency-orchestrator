import { SiteFooter } from "@/components/layout/SiteFooter";
import { SponsorBenefits } from "@/components/sponsors/SponsorBenefits";
import { SponsorFAQ } from "@/components/sponsors/SponsorFAQ";
import { SponsorPerksTable } from "@/components/sponsors/SponsorPerksTable";
import { SponsorTierSection } from "@/components/sponsors/SponsorTierSection";
import { SponsorsHero } from "@/components/sponsors/SponsorsHero";

export default function Sponsors() {
  return (
    <>
      <main className="pt-16">
        <SponsorsHero />
        <SponsorTierSection tier="flagship" />
        <SponsorTierSection tier="standard" />
        <SponsorPerksTable />
        <SponsorFAQ />
        <SponsorBenefits />
      </main>
      <SiteFooter />
    </>
  );
}
