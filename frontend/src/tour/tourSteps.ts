import type { TourStep } from "./tourTypes";

// The map tour, told as one story about one street.
// Edit wording here; behaviour lives in MapTour.tsx.

export const TOUR_CHAPTERS = [
  "Welcome",
  "A hotter future",
  "Where the heat is today",
  "Your block, up close",
  "What trees could change",
  "Your turn",
] as const;

const panel = (selector: string) => [`.map-explorer-panel ${selector}`];

export const tourSteps: TourStep[] = [
  {
    id: "welcome",
    chapter: 0,
    title: "One street, two futures.",
    body: demo => `This tour follows ${demo.streetName} in ${demo.suburb.sa2_name}. We'll start with a hotter Melbourne in the future, come back to today to see where the heat is, then see what planting trees could change. It takes about three minutes.`,
    target: { kind: "none" },
    scene: { future: false, suburb: "none", block: "none" },
  },

  {
    id: "finish",
    chapter: 5,
    title: "Your turn.",
    body: "That's the tour. When you close this card, the tour's trees are removed and anything you'd saved comes back. Search for your own street to start exploring. You can replay the tour any time from the button next to Reset view.",
    target: { kind: "none" },
  },
];
