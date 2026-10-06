// Pure helpers for the map tour. No DOM or React here so they can be unit tested.

export type Rect = { left: number; top: number; width: number; height: number };
export type Size = { width: number; height: number };
export type Placement = "right" | "left" | "below" | "above" | "center" | "top" | "bottom";

export const MOBILE_TOUR_WIDTH = 760;

export function unionRects(rects: Rect[]): Rect | null {
  const usable = rects.filter(rect => rect.width > 0 && rect.height > 0);
  if (!usable.length) return null;
  const left = Math.min(...usable.map(rect => rect.left));
  const top = Math.min(...usable.map(rect => rect.top));
  const right = Math.max(...usable.map(rect => rect.left + rect.width));
  const bottom = Math.max(...usable.map(rect => rect.top + rect.height));
  return { left, top, width: right - left, height: bottom - top };
}

export function intersectRect(a: Rect, b: Rect): Rect | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}

export function padRect(rect: Rect, padding: number, minSize = 0): Rect {
  const width = Math.max(minSize, rect.width + padding * 2);
  const height = Math.max(minSize, rect.height + padding * 2);
  return { left: rect.left + rect.width / 2 - width / 2, top: rect.top + rect.height / 2 - height / 2, width, height };
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

// Put the card beside its target without covering it. Phones get a full-width
// card at whichever screen edge is further from the target.
export function placeCard(target: Rect | null, viewport: Size, card: Size, gap = 16, margin = 12): { left: number; top: number; width: number; placement: Placement } {
  if (viewport.width <= MOBILE_TOUR_WIDTH) {
    const width = viewport.width - margin * 2;
    if (!target) return { left: margin, top: Math.max(margin, viewport.height - card.height - margin), width, placement: "bottom" };
    const centre = target.top + target.height / 2;
    return centre > viewport.height / 2
      ? { left: margin, top: margin, width, placement: "top" }
      : { left: margin, top: Math.max(margin, viewport.height - card.height - margin), width, placement: "bottom" };
  }
  const width = card.width;
  if (!target) return { left: (viewport.width - width) / 2, top: Math.max(margin, (viewport.height - card.height) / 2), width, placement: "center" };
  const maxTop = viewport.height - card.height - margin;
  const maxLeft = viewport.width - width - margin;
  const right = target.left + target.width;
  const bottom = target.top + target.height;
  if (right + gap + width <= viewport.width - margin) return { left: right + gap, top: clamp(target.top, margin, maxTop), width, placement: "right" };
  if (target.left - gap - width >= margin) return { left: target.left - gap - width, top: clamp(target.top, margin, maxTop), width, placement: "left" };
  if (bottom + gap + card.height <= viewport.height - margin) return { left: clamp(target.left, margin, maxLeft), top: bottom + gap, width, placement: "below" };
  if (target.top - gap - card.height >= margin) return { left: clamp(target.left, margin, maxLeft), top: target.top - gap - card.height, width, placement: "above" };
  return { left: maxLeft, top: maxTop, width, placement: "center" };
}

// --- Demo block selection -------------------------------------------------

export type DemoCandidate = {
  code: string;
  hasModel: boolean;
  sourceKind: "local" | "adjacent" | "nearest" | null;
  unavailable: boolean;
  maxTrees: number;
  milestoneCount: number;
  streetCount: number;
};

// Higher is better. Null means the block cannot carry the planting chapter.
export function scoreDemoBlock(candidate: DemoCandidate): number | null {
  if (!candidate.hasModel || candidate.unavailable || candidate.maxTrees < 2) return null;
  let score = 0;
  if (candidate.sourceKind === "local") score += 4;
  if (candidate.milestoneCount >= 2) score += 3;
  else if (candidate.milestoneCount === 1) score += 1;
  if (candidate.streetCount > 0) score += 1;
  if (candidate.maxTrees >= 10) score += 1;
  return score;
}

export function pickDemoBlocks(candidates: DemoCandidate[]): { primary: string | null; secondary: string | null } {
  const ranked = candidates
    .map((candidate, order) => ({ candidate, order, score: scoreDemoBlock(candidate) }))
    .filter((item): item is { candidate: DemoCandidate; order: number; score: number } => item.score !== null)
    .sort((a, b) => b.score - a.score || a.order - b.order);
  return { primary: ranked[0]?.candidate.code ?? null, secondary: ranked[1]?.candidate.code ?? null };
}

export function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>();
  let best: string | null = null;
  for (const value of values) {
    const count = (counts.get(value) ?? 0) + 1;
    counts.set(value, count);
    if (best === null || count > (counts.get(best) ?? 0)) best = value;
  }
  return best;
}

// --- Tree targets used by the planting chapter ---------------------------

// A small starting number of trees that is deliberately not one of the
// milestone values, so the "tap a marker" step still has something to do.
export function fewTrees(maxTrees: number, milestones: number[]): number {
  if (maxTrees <= 0) return 0;
  for (let trees = Math.min(3, maxTrees); trees >= 1; trees--) if (!milestones.includes(trees)) return trees;
  for (let trees = 4; trees <= maxTrees; trees++) if (!milestones.includes(trees)) return trees;
  return Math.min(3, maxTrees);
}

export function milestoneTrees(maxTrees: number, milestones: { trees: number; labels: string[] }[]): number {
  const suburb = milestones.find(item => item.labels.some(label => label.startsWith("Suburb average")));
  return (suburb ?? milestones[0])?.trees ?? Math.min(8, maxTrees);
}
