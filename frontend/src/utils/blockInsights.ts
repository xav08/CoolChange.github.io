export function metricValue(value: number | null | undefined, kind: "heat" | "canopy") {
  return value == null || !Number.isFinite(value) ? "Not available" : `${value.toFixed(1)}${kind === "heat" ? "°C" : "%"}`;
}

// Round before choosing wording so near-equal values never read “0.0 hotter”.
export function relativeInsight(value: number | null | undefined, reference: number | null | undefined, kind: "heat" | "canopy") {
  if (value == null || reference == null || !Number.isFinite(value) || !Number.isFinite(reference)) return null;
  const delta = Math.round((value - reference) * 10) / 10;
  if (delta === 0) return kind === "heat" ? "About the same surface heat" : "About the same tree canopy";
  return kind === "heat"
    ? `${Math.abs(delta).toFixed(1)}°C ${delta > 0 ? "hotter" : "cooler"}`
    : `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}%`;
}

export type MetricKind = "heat" | "canopy";

export function heatTone(value: number | null | undefined, reference: number | null | undefined) {
  if (value == null || reference == null || !Number.isFinite(value) || !Number.isFinite(reference)) return "neutral";
  const delta = Math.round((value - reference) * 10) / 10;
  return delta > 0 ? "hotter" : delta < 0 ? "cooler" : "neutral";
}

export function comparisonScale(values: Array<number | null | undefined>, kind: MetricKind) {
  const available = values.filter((value): value is number => value != null && Number.isFinite(value));
  const step = kind === "heat" ? 2 : 10;
  const min = Math.floor(Math.min(0, ...available) / step) * step;
  const max = Math.max(min + step, Math.ceil(Math.max(0, ...available) / step) * step);
  return { min, max, position: (value: number) => Math.max(0, Math.min(100, (value - min) / (max - min) * 100)) };
}

export function compactInsight(value: number | null | undefined, reference: number | null | undefined, kind: MetricKind) {
  const insight = relativeInsight(value, reference, kind);
  if (!insight) return "Comparison unavailable";
  return insight.replace("About the same surface heat", "Similar heat")
    .replace("About the same tree canopy", "Similar canopy");
}
