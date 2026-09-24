import { AddressExplorer } from "./AddressExplorer";
import { Footer } from "./Footer";
import { StreetExperience } from "./street/StreetExperience";
import { TrustSection } from "./TrustSection";
import "../street-story.css";

// compose the full scroll-led home page
export function StoryPage() {
  return (
    <div className="street-page">
      <main id="story">
        <StreetExperience />
        <AddressExplorer />
        <TrustSection />
      </main>
      <Footer />
      <img
        className="street-closing-image"
        src={`${import.meta.env.BASE_URL}images/cool-change-closing.webp`}
        alt="Cool Change. See the heat. Change the street. An aerial neighbourhood heat illustration meets green tree canopy."
        width="1732"
        height="908"
        loading="lazy"
        decoding="async"
      />
    </div>
  );
}
