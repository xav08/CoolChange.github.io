export type Position = [number, number];
export type Polygon = Position[][];
export type BlockGeometry = { type: string; coordinates?: unknown };

export function polygonsFor(geometry: BlockGeometry | null): Polygon[] {
  const raw = geometry?.type === "Polygon" ? [geometry.coordinates] : geometry?.type === "MultiPolygon" ? geometry.coordinates : [];
  if (!Array.isArray(raw)) return [];
  return raw.filter((polygon): polygon is Polygon => Array.isArray(polygon) && polygon.length > 0 &&
    polygon.every(ring => Array.isArray(ring) && ring.length >= 4 && ring.every(point =>
      Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]))));
}

function insideRing([x, y]: Position, ring: Position[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function insidePolygons(point: Position, polygons: Polygon[]) {
  return polygons.some(polygon => insideRing(point, polygon[0]) && !polygon.slice(1).some(hole => insideRing(point, hole)));
}

export function polygonBounds(polygons: Polygon[]): [Position, Position] | null {
  const points = polygons.flatMap(polygon => polygon[0]);
  if (!points.length) return null;
  return [[Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1]))],
    [Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))]];
}

function halton(index: number, base: number) {
  let value = 0;
  let fraction = 1;
  while (index > 0) { fraction /= base; value += fraction * (index % base); index = Math.floor(index / base); }
  return value;
}

// Stable illustrative locations, unrelated to the count or physical planting capacity.
export function canopyPoints(polygons: Polygon[]): Position[] {
  const bounds = polygonBounds(polygons);
  if (!bounds) return [];
  const [[west, south], [east, north]] = bounds;
  const points: Position[] = [];
  for (let i = 1; i <= 4096 && points.length < 10; i++) {
    const point: Position = [west + halton(i, 2) * (east - west), south + halton(i, 3) * (north - south)];
    if (insidePolygons(point, polygons)) points.push(point);
  }
  return points;
}

export function canopyDensity(trees: number, maxTrees: number) {
  if (!Number.isFinite(trees) || !Number.isFinite(maxTrees) || maxTrees <= 0) return { ratio: 0, count: 0 };
  const ratio = Math.max(0, Math.min(1, trees / maxTrees));
  return { ratio, count: ratio > 0 ? Math.max(1, Math.round(ratio * 10)) : 0 };
}

// Screen-space crowns stay separate even on narrow blocks or at low zoom.
export function canopyMarkerSize(points: { x: number; y: number }[], index: number, blockSize: number) {
  const point = points[index];
  if (!point || !Number.isFinite(blockSize) || blockSize <= 0) return 0;
  const nearest = Math.min(...points.filter((_, other) => other !== index)
    .map(other => Math.hypot(point.x - other.x, point.y - other.y)));
  return Math.min(24, blockSize / 3, nearest * 0.75);
}

export function selectedBlockPadding(width: number, height: number, panel: { right: number; bottom: number; top?: number }) {
  if (width <= 760 && panel.top != null) {
    const top = Math.min(184, height * 0.24);
    return { top, bottom: Math.min(height - top - 80, height - panel.top + 16), left: 24, right: 24 };
  }
  if (width <= 620) return { top: Math.min(panel.bottom + 16, Math.max(16, height - 160)), bottom: 70, left: 24, right: 24 };
  return { top: 96, bottom: 96, left: Math.min(panel.right + 24, width - 180), right: 40 };
}
