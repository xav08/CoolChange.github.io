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
    : `${Math.abs(delta).toFixed(1)} percentage points ${delta > 0 ? "more" : "less"} tree canopy`;
}
