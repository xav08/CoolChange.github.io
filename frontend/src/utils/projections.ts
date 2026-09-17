export type WarmingLevel = 1.2 | 1.5 | 2 | 3;
export const WARMING_LEVELS: WarmingLevel[] = [1.2, 1.5, 2, 3];
export type ProjectionBand = { days_label: string | null; days_lower: number | null; days_upper: number | null };
export type SuburbProjection = ProjectionBand & { sa2_code16: string; warming_level: WarmingLevel };
export type ProjectionData = {
  scale: { min: number; max: number };
  bands: ProjectionBand[];
  suburbs: SuburbProjection[];
};
export const UNAVAILABLE_COLOR = "#c9ccc6";

export function daysBand(band: ProjectionBand | undefined): string {
  if (band?.days_lower == null) return "not available";
  return band.days_upper == null ? `${band.days_lower}+` : `${band.days_lower}–${band.days_upper}`;
}

export function bandLabel(band: ProjectionBand): string {
  // Preserve named national classes, otherwise generate the range from bounds.
  return band.days_label && /[a-z]/i.test(band.days_label)
    ? `${band.days_label} (${daysBand(band)})` : daysBand(band);
}

export function warmingLabel(level: WarmingLevel): string {
  return `${level.toFixed(1)}°C${level === 3 ? " scenario" : ""}`;
}

export function projectionColor(band: ProjectionBand | undefined, scale: ProjectionData["scale"]): string {
  if (band?.days_lower == null) return UNAVAILABLE_COLOR;
  // One solid colour per class. An open-ended class uses its known lower bound;
  // it is never turned into a fabricated upper bound or exact forecast.
  const value = band.days_upper == null ? band.days_lower : (band.days_lower + band.days_upper) / 2;
  const t = Math.max(0, Math.min(1, (value - scale.min) / (scale.max - scale.min || 1)));
  const stops = [[255, 235, 170], [241, 147, 63], [177, 44, 38]];
  const segment = t < 0.5 ? 0 : 1;
  const weight = segment === 0 ? t * 2 : (t - 0.5) * 2;
  const rgb = stops[segment].map((value, index) => Math.round(value + (stops[segment + 1][index] - value) * weight));
  return `rgb(${rgb.join(", ")})`;
}

export function isProjectionData(value: unknown): value is ProjectionData {
  if (!value || typeof value !== "object") return false;
  const data = value as ProjectionData;
  const validBand = (b: ProjectionBand) => b && (b.days_lower === null ||
    (Number.isFinite(b.days_lower) && b.days_lower >= 0)) &&
    (b.days_upper === null || (Number.isFinite(b.days_upper) && b.days_lower !== null && b.days_upper > b.days_lower)) &&
    (b.days_label === null || typeof b.days_label === "string");
  return Number.isFinite(data.scale?.min) && Number.isFinite(data.scale?.max) && data.scale.max >= data.scale.min &&
    Array.isArray(data.bands) && data.bands.length > 0 && data.bands.every(validBand) &&
    Array.isArray(data.suburbs) && data.suburbs.length > 0 &&
    data.suburbs.every(s => validBand(s) && typeof s.sa2_code16 === "string" && WARMING_LEVELS.includes(s.warming_level));
}
