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

   // Chapter 1 · A hotter future
  {
    id: "vision-toggle",
    chapter: 1,
    title: "Start with tomorrow.",
    body: "This switch moves between today's map 🌳 and the 2050 vision ☀️. Flip it to see the heat that's coming.",
    target: { kind: "element", selectors: [".projection-controls"] },
    scene: { future: false, suburb: "none", block: "none", sheet: "half" },
    action: { label: "Show me", done: state => state.future },
  },
  {
    id: "vision-bands",
    chapter: 1,
    title: "Hot days, suburb by suburb.",
    body: "Each suburb is now coloured by how many days a year are projected to reach 35°C or hotter. Pale yellow means fewer hot days, deep red means more. Grey means no estimate is available.",
    target: { kind: "element", selectors: [".projection-legend"] },
    scene: { future: true, suburb: "none" },
  },
  {
    id: "vision-levels",
    chapter: 1,
    title: "Warming levels, not dates.",
    body: "Projections are grouped by how much the world warms above pre-industrial levels, from 1.2°C (about where we are now) to a 3°C scenario. Try a few and watch the colours change. We'll continue at 2.0°C.",
    target: { kind: "element", selectors: [".warming-selector"] },
    scene: { future: true, suburb: "none" },
  },
  {
    id: "vision-search",
    chapter: 1,
    title: "Find a suburb.",
    body: demo => `Type a suburb name and pick it from the list, or click a suburb on the map. Let's find ${demo.suburb.sa2_name}.`,
    target: { kind: "element", selectors: panel(".suburb-search") },
    scene: { future: true, warming: 2, suburb: "none", sheet: "half" },
    action: {
      label: "Show me",
      done: (state, demo) => state.suburbCode === demo.suburb.sa2_code16,
      hint: (state, demo) => state.suburbCode && state.suburbCode !== demo.suburb.sa2_code16 ? `That's another suburb. Try ${demo.suburb.sa2_name}, or press Show me.` : null,
    },
  },
  {
    id: "vision-suburb",
    chapter: 1,
    title: demo => `${demo.suburb.sa2_name} in a 2°C world.`,
    body: (demo, state) => `The map zooms in on ${demo.suburb.sa2_name}. ${state.projectionDays && state.projectionDays !== "not available" ? `It's projected to have ${state.projectionDays} days a year at 35°C or hotter.` : "Its projected hot-day band is shown here."} That's a yearly range, not a forecast for a particular year. Tap "What does this mean?" for a plain explanation. The 2050 view works at suburb level only.`,
    target: { kind: "element", selectors: [...panel(".projection-detail > span"), ...panel(".projection-days"), ...panel(".projection-help")] },
    scene: { future: true, warming: 2, suburb: "demo", sheet: "half" },
  },
  {
    id: "vision-bridge",
    chapter: 1,
    title: "A reason to plant.",
    body: demo => `Planting trees doesn't change this projection, but it does shade the streets that will face that heat. This button takes you back to today's map, inside ${demo.suburb.sa2_name}.`,
    target: { kind: "element", selectors: panel(".projection-planting-link") },
    scene: { future: true, suburb: "demo", sheet: "half" },
    action: { label: "Take me there", done: state => !state.future },
  },

  {
    id: "finish",
    chapter: 5,
    title: "Your turn.",
    body: "That's the tour. When you close this card, the tour's trees are removed and anything you'd saved comes back. Search for your own street to start exploring. You can replay the tour any time from the button next to Reset view.",
    target: { kind: "none" },
  },
];
