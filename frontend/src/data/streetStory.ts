export type Point3 = readonly [number, number, number];

export type StreetView = {
  camera: Point3;
  target: Point3;
  heat: number;
  growth: number;
  planting: number;
};

export type StreetChapter = {
  id: string;
  title: string;
  body: string;
  object: string;
  view: StreetView;
};

// One set, one camera. All coordinates belong to the same miniature street.
export const streetChapters: readonly StreetChapter[] = [
  {
    id: "top",
    title: "A cooler street starts with what we can see.",
    body: "Take a closer look at the heat we share, and the shade we can grow.",
    object: "One street. A shared future.",
    view: { camera: [32, 30, 37], target: [0, 0, 0], heat: 0, growth: 0.16, planting: 0 },
  },
  {
    id: "street-heat",
    title: "Same city. Different heat.",
    body: "Across Melbourne, heat is uneven. Look closer and the differences become part of an everyday street.",
    object: "Heat gathers on exposed surfaces",
    view: { camera: [22, 22, 27], target: [1, 0, 0], heat: 0.85, growth: 0.16, planting: 0 },
  },
  {
    id: "street-shade",
    title: "A little shade changes the street.",
    body: "A tree-lined footpath. A sheltered place to wait. Where the canopy stops, the shade stops too.",
    object: "Follow the edge of the tree shade",
    view: { camera: [13, 13, 17], target: [0, 0.8, 3], heat: 0.8, growth: 0.16, planting: 0 },
  },
  {
    id: "street-shared",
    title: "We share the heat. And the street.",
    body: "You can choose where to stand. Changing a roof, a rental home or a public footpath takes more than one person's choice.",
    object: "A place everyone should be able to use",
    view: { camera: [8, 8.5, 15], target: [0.5, 1, 3.5], heat: 0.75, growth: 0.16, planting: 0 },
  },
  {
    id: "street-time",
    title: "Tomorrow's shade starts small.",
    body: "Picture this same place in 2050. The tree beside the bus stop has room to grow. So does the shade beneath it.",
    object: "The little tree becomes a place of shade",
    view: { camera: [11, 12, 19], target: [1, 1.4, 3], heat: 0, growth: 1, planting: 0 },
  },
  {
    id: "street-plant",
    title: "What could you grow here?",
    body: "Start beside the bus stop. Add trees and watch exposed heat retreat beneath their growing canopy.",
    object: "More trees. More places in the shade.",
    view: { camera: [26, 28, 32], target: [0, 0, 0], heat: 0.85, growth: 1, planting: 1 },
  },
];

export const MAX_STORY_TREES = 36;
export const INITIAL_STORY_TREES = 12;

// Fixed positions prevent trees jumping around when the slider is reversed.
// Three rows of verge/yard planting, clear of the bus stop and front doors.
export const plantingLocations: readonly Point3[] = Array.from({ length: MAX_STORY_TREES }, (_, index) => {
  const pair = Math.floor(index / 2);
  const row = Math.floor(pair / 6);
  const column = pair % 6;
  const side = index % 2 === 0 ? 1 : -1;
  const x = row === 0 ? [0, 7, -7, 15, -13, -16][column]
    : row === 1 ? -15 + column * 6 : [-17, -8, 0, 8, 17, 0][column];
  const z = row === 0 ? 5.3 : row === 1 ? 11.7 : column === 5 ? 9.8 : 7.1;
  return [x, 0.05, side * z];
});

// An expressive canopy footprint, not a physical cooling model. The shared
// dimensions keep the shade geometry and thermal mask in exact agreement.
export function canopyFootprint(x: number, z: number, scale: number): readonly [number, number, number, number] {
  const size = Math.max(0, scale);
  return [x - 0.7 * size, z - Math.sign(z) * 1.4 * size, 3.3 * size, 3 * size];
}

export function plantedTreeScale(index: number, count: number, planting: number, before: boolean): number {
  return !before && index < clampTreeCount(count) ? Math.max(0, Math.min(1, planting)) * 0.9 : 0;
}

export function clampTreeCount(value: number): number {
  return Number.isFinite(value) ? Math.min(MAX_STORY_TREES, Math.max(0, Math.round(value))) : 0;
}

export function sampleStreetView(progress: number, mobile = false, reducedMotion = false): StreetView {
  const safe = Math.min(streetChapters.length - 1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  const nextIndex = Math.min(streetChapters.length - 1, Math.ceil(safe));
  const from = streetChapters[Math.floor(safe)].view;
  const to = streetChapters[nextIndex].view;
  // Moving during the first third leaves a stable composition for reading.
  const fraction = Math.min(1, (safe % 1) / 0.34);
  const blend = reducedMotion ? 0 : fraction * fraction * (3 - 2 * fraction);
  const mix = (a: number, b: number) => a + (b - a) * blend;
  const point = (a: Point3, b: Point3): Point3 => [mix(a[0], b[0]), mix(a[1], b[1]), mix(a[2], b[2])];
  const camera = point(from.camera, to.camera);
  return {
    camera: mobile ? [camera[0] * 1.12, Math.max(19, camera[1]), camera[2] * 1.12] : camera,
    target: point(from.target, to.target),
    heat: mix(from.heat, to.heat),
    growth: mix(from.growth, to.growth),
    planting: mix(from.planting, to.planting),
  };
}
