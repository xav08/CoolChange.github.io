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

  // Chapter 2 · Where the heat is today
  {
    id: "heat-map",
    chapter: 2,
    title: "Heat you can see from space.",
    body: "This is today's map, across all of Melbourne. The colours show surface heat from 2018 satellite images: how much hotter the ground was than nearby non-urban land, at about 9:50 in the morning. Teal is cooler, red is hotter. It isn't air temperature.",
    target: { kind: "element", selectors: [".map-heat-legend"] },
    scene: { future: false, suburb: "none", block: "none", sheet: "collapsed" },
  },
  {
    id: "suburb-search",
    chapter: 2,
    title: "Search by suburb.",
    body: demo => `Type a suburb name, or just click one on the map. Either way it opens up into smaller blocks. Try ${demo.suburb.sa2_name}.`,
    target: { kind: "element", selectors: panel(".suburb-search") },
    scene: { future: false, suburb: "none", sheet: "half" },
    action: {
      label: "Show me",
      done: (state, demo) => state.suburbCode === demo.suburb.sa2_code16 && state.meshReady,
      hint: (state, demo) => state.suburbCode && state.suburbCode !== demo.suburb.sa2_code16 ? `That's another suburb. Try ${demo.suburb.sa2_name}, or press Show me.` : null,
    },
  },
  {
    id: "mesh-blocks",
    chapter: 2,
    title: demo => `${demo.suburb.sa2_name}, block by block.`,
    body: "Each shape is a mesh block, the smallest area the census counts, usually 30 to 60 homes. The colours are the same: teal is cooler, red is hotter. Blocks next door to each other can differ by several degrees.",
    target: { kind: "suburb" },
    scene: { future: false, suburb: "demo", highlight: false, block: "none", sheet: "collapsed" },
  },
  {
    id: "street-search",
    chapter: 2,
    title: "Search by street.",
    body: demo => `Add a comma to search for a street: "${demo.streetQuery}". Blocks on that street stay bright and the rest fade.`,
    target: { kind: "element", selectors: panel(".suburb-search") },
    scene: { future: false, suburb: "demo", highlight: false, block: "none", sheet: "half" },
    action: { label: "Show me", done: (state, demo) => state.highlighted > 0 && state.suburbCode === demo.suburb.sa2_code16 },
  },
  {
    id: "open-block",
    chapter: 2,
    title: "Open a block.",
    body: demo => `These are the blocks along ${demo.streetName}. Click the one with the ring to open its details.`,
    target: { kind: "block", which: "primary" },
    scene: { future: false, suburb: "demo", highlight: true, block: "none", sheet: "collapsed" },
    action: {
      label: "Show me",
      done: (state, demo) => state.blockCode === demo.primary && !state.blockLoading,
      hint: (state, demo) => state.blockCode && state.blockCode !== demo.primary ? "That's a different block. Try the one with the ring, or press Show me." : null,
    },
  },

  // Chapter 3 · Your block, up close
  {
    id: "block-details",
    chapter: 3,
    title: "Everything about this block.",
    body: "At the top are the streets in this block, plus its suburb and council. Below that are its surface heat and tree canopy from 2018. Tap ? to see what each one means. The last line shows what the land is used for and how many people live there.",
    target: { kind: "element", selectors: [...panel(".selected-block-header"), ...panel(".selected-block-metrics"), ...panel(".selected-block-meta")] },
    scene: { future: false, suburb: "demo", block: "primary", tab: "Overview", trees: "zero", sheet: "half" },
  },
  {
    id: "tab-overview",
    chapter: 3,
    title: "Overview: the short version.",
    body: "There are three tabs. Overview tells you in plain words whether this block is hotter or cooler than its suburb, and whether it has more or less tree canopy.",
    target: { kind: "element", selectors: [...panel(".block-tabs"), ...panel('[role="tabpanel"]:not([hidden]) .block-insight')] },
    scene: { block: "primary", tab: "Overview", sheet: "half" },
  },
  {
    id: "tab-compare",
    chapter: 3,
    title: "Compare: side by side.",
    body: "Compare puts this block next to its suburb, its council, the Melbourne average and the coolest block in the council, for both heat and canopy. \"pp\" means percentage points.",
    target: { kind: "element", selectors: [...panel(".block-tabs"), ...panel(".block-comparison-section")] },
    scene: { block: "primary", tab: "Compare", sheet: "half" },
  },

  // Chapter 4 · What trees could change
  {
    id: "plant-slider",
    chapter: 4,
    title: "Add trees.",
    body: "Plant lets you test a greener version of this block. Drag the slider or use − and +. Each tree adds about 50 m² of fully grown canopy. The maximum is where the model runs out of data, not how many trees would actually fit.",
    target: { kind: "element", selectors: [...panel(".planting-slider-label"), ...panel(".planting-slider-row")] },
    scene: { block: "primary", tab: "Plant", trees: "zero", comparison: "after", sheet: "half" },
    action: { label: "Show me", done: state => state.trees > 0 },
  },
  {
    id: "plant-milestones",
    chapter: 4,
    title: "Two markers to aim for.",
    body: demo => `The ticks under the slider are shortcuts. One brings this block up to the ${demo.suburb.sa2_name} average canopy, and the other adds 5 percentage points. Tap one to jump straight there.`,
    target: { kind: "element", selectors: [...panel(".planting-slider-scale"), ...panel(".planting-milestones button")] },
    scene: { block: "primary", tab: "Plant", trees: "few", comparison: "after", sheet: "half" },
    action: { label: "Show me", done: state => state.milestones.some(item => item.trees === state.trees) },
  },
  {
    id: "plant-result",
    chapter: 4,
    title: "What it could mean.",
    body: "This shows the modelled cooling, canopy and surface heat before and after, and the model's likely range. It assumes fully grown trees in 2018 conditions, so it's not instant cooling and not a 2050 forecast. On the map, the green dots show how dense the canopy is, not where each tree goes.",
    target: { kind: "element", selectors: [...panel(".planting-cooling"), ...panel(".planting-result-rows")] },
    scene: { block: "primary", tab: "Plant", trees: "milestone", comparison: "after", sheet: "half" },
  },
  {
    id: "plant-before-after",
    chapter: 4,
    title: "Before and after.",
    body: "Press and hold \"Hold to see before\" for a quick look without your trees. The Before and After buttons switch every planted block on the map at once, and Reset all clears every tree you've added.",
    target: { kind: "element", selectors: [...panel(".hold-before button"), ...panel(".planting-controls")] },
    scene: { block: "primary", tab: "Plant", comparison: "after", sheet: "half" },
  },
  {
    id: "plant-many",
    chapter: 4,
    title: "Plant more than one block.",
    body: (demo, state) => state.plantedBlocks > 1
      ? `We've added trees to a second block on ${demo.streetName}. Every block you plant is listed here, and you can tap one to go back to it. Keep planting across ${demo.suburb.sa2_name}. Switching to another suburb clears the list.`
      : `Open another block and keep planting. Every block you plant is listed here, and you can tap one to go back to it. Switching to another suburb clears the list.`,
    target: { kind: "element", selectors: panel(".planted-blocks") },
    scene: { block: "secondary", tab: "Plant", trees: "few", comparison: "after", openPlantedList: true, sheet: "half" },
  },

  {
    id: "finish",
    chapter: 5,
    title: "Your turn.",
    body: "That's the tour. When you close this card, the tour's trees are removed and anything you'd saved comes back. Search for your own street to start exploring. You can replay the tour any time from the button next to Reset view.",
    target: { kind: "none" },
  },
];
