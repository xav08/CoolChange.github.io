import { AddressExplorer } from "./AddressExplorer";
import { ClosingImage, Footer } from "./Footer";
import { Hero, LeadCopy } from "./Hero";
import { CaseStudy, EvidenceSection, StorySteps, TreeTimeline } from "./StorySections";
import { TreeSimulator } from "./TreeSimulator";
import { TrustSection } from "./TrustSection";
import { useActiveStoryStep } from "../hooks/useActiveStoryStep";

// compose the full scroll-led home page
export function StoryPage() {
  const activeStoryStep = useActiveStoryStep();

  return (
    <>
      <main>
        <Hero />
        <LeadCopy />
        <StorySteps activeStep={activeStoryStep} />
        <CaseStudy />
        <TreeTimeline />
        <TreeSimulator />
        <EvidenceSection />
        <AddressExplorer />
        <TrustSection />
        <ClosingImage />
      </main>
      <Footer />
    </>
  );
}
