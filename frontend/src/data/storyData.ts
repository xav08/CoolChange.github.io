export type StoryLayer = "heat" | "canopy" | "future";

// define the scroll-driven story content
export const storyFacts = [
  {
    id: "city",
    kicker: "01 / 2026, the decision point",
    title: "Melbourne is not one temperature.",
    body: "Across 54,239 mesh blocks, the latest public heat layer reveals a summer surface temperature range of more than 23°C. Where you live can shape the heat you carry.",
    stat: "+15.7°C",
    label: "above the rural baseline in the hottest blocks",
  },
  {
    id: "clyde",
    kicker: "02 / Clyde North, seen locally",
    title: "The heat gathers where shade is scarce.",
    body: "In Clyde North and Cranbourne West, some of the hottest blocks in the public dataset coincide with almost no tree canopy. Scroll to switch from heat to canopy.",
    stat: "1.3%",
    label: "tree canopy in a hottest recorded block",
  },
  {
    id: "equity",
    kicker: "03 / Who gets to adapt?",
    title: "Feeling the heat does not mean you can change the roof.",
    body: "Renters, lower income residents and families in new outer suburban estates often have the least control over the places where they live.",
    stat: "23°C",
    label: "the measurable gap across one metropolitan area",
  },
  {
    id: "time",
    kicker: "04 / 2050 starts here",
    title: "The tree that cools 2050 is planted now.",
    body: "A mature canopy can take 20 to 30 years. The final map state is a 2050 illustrative scenario, not a temperature forecast. Its point is the long lead time for shade.",
    stat: "20 to 30",
    label: "years for urban trees to mature",
  },
];

// define labels and legends for map layers
export const mapLayers: Record<StoryLayer, { label: string; low: string; high: string; note: string }> = {
  heat: {
    label: "2026 heat",
    low: "cooler",
    high: "hotter",
    note: "",
  },
  canopy: {
    label: "Canopy",
    low: "sparse",
    high: "denser",
    note: "",
  },
  future: {
    label: "2050 heat",
    low: "2026",
    high: "2050",
    note: "The same local density pattern is intensified for the illustrative 2050 view.",
  },
};

// define the final action journey
export const journeySteps = [
  ["01", "See", "Find your street and see its heat."],
  ["02", "Understand", "Compare canopy and local context."],
  ["03", "Simulate", "Add trees and test a scenario."],
  ["04", "Act", "Take an evidence page to council."],
];
