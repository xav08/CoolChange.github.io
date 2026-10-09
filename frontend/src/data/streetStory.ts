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
    title: "Make your everyday walk a little cooler.",
    body: "Picture a shaded walk home, a cooler bus stop, a place to pause. More trees on your street could make those everyday moments feel better.",
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
    title: "Five trees. Your street.",
    body: "Start beside the bus stop. Add trees and watch exposed heat retreat beneath their growing canopy.",
    object: "More trees. More places in the shade.",
    view: { camera: [26, 28, 32], target: [0, 0, 0], heat: 0.85, growth: 1, planting: 1 },
  },
];

export const MAX_STORY_TREES = 36;
export const INITIAL_STORY_TREES = 12;

export const plantingSites = [
  { index: 0, label: "Bus stop" },
  { index: 1, label: "Opposite bus stop" },
  { index: 2, label: "East footpath" },
  { index: 4, label: "Crossing" },
  { index: 5, label: "West homes" },
  { index: 6, label: "East corner" },
  { index: 7, label: "Far corner" },
] as const;

export function togglePlantingSite(selected: readonly number[], index: number): number[] {
  if (!plantingSites.some(site => site.index === index)) return [...selected];
  if (selected.includes(index)) return selected.filter(site => site !== index);
  return selected.length < 5 ? [...selected, index] : [...selected];
}

// Fixed positions prevent trees jumping around when the slider is reversed.
// Three rows of verge/yard planting, clear of the bus stop and front doors.
export const plantingLocations: readonly Point3[] = Array.from({ length: MAX_STORY_TREES }, (_, index) => {
  // Beside the red-roof house, behind the shelter and clear of the building.
  if (index === 0) return [-0.8, 0.05, 8.8];
  const pair = Math.floor(index / 2);
  const row = Math.floor(pair / 6);
  const column = pair % 6;
  const side = index % 2 === 0 ? 1 : -1;
  const x = row === 0 ? [0, 7, -7, 15, -13, -16][column]
    : row === 1 ? -15 + column * 6 : [-17, -8, 0, 8, 17, 0][column];
  const z = row === 0 ? 5.3 : row === 1 ? 11.7 : column === 5 ? 9.8 : 7.1;
  return [x, 0.05, side * z];
});

// Representative equinox, 9 am to 3 pm solar time at Melbourne's latitude.
// World axes: +X east, -Z north, +Y up. Not a date-specific forecast.
export function melbourneSunDirection(daylight: number): Point3 {
  const t = Math.max(0, Math.min(1, Number.isFinite(daylight) ? daylight : 0));
  const hourAngle = (t - 0.5) * Math.PI / 2;
  const latitude = -37.81 * Math.PI / 180;
  return [-Math.sin(hourAngle), Math.cos(latitude) * Math.cos(hourAngle), Math.sin(latitude) * Math.cos(hourAngle)];
}

// Project the canopy centre away from the sun onto the ground.
export function canopyFootprint(x: number, z: number, scale: number, daylight = 0, crownSpread = 1): readonly [number, number, number, number] {
  const size = Math.max(0, scale);
  const [east, up, south] = melbourneSunDirection(daylight);
  const dx = east / up;
  const dz = south / up;
  const height = 3.1 * size;
  return [x - dx * height, z - dz * height,
    size * Math.hypot(1.5 * crownSpread, 1.6 * dx), size * Math.hypot(1.5 * crownSpread, 1.6 * dz)];
}

// The illustrative cooling area includes both the canopy overhead and its
// cast shade, so growing a tree can shelter the adjoining footpath and road.
export function plantedCanopyFootprint(x: number, z: number, scale: number, daylight: number, maturity: number): readonly [number, number, number, number] {
  const size = Math.max(0, scale);
  const age = Math.max(0, Math.min(1, maturity));
  const [shadowX, shadowZ] = canopyFootprint(x, z, size, daylight);
  const radius = size * 1.5 * (1 + age * 0.7) * (1 + age * 0.5);
  return [(x + shadowX) / 2, (z + shadowZ) / 2,
    radius + Math.abs(shadowX - x) / 2, radius + Math.abs(shadowZ - z) / 2];
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
