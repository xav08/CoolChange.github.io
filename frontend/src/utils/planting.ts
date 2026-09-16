export type PlantingModel = {
  baseline_heat_c: number;
  baseline_canopy_pct: number;
  area_m2: number;
  crown_area_m2: number;
  canopy_ceiling_pct: number;
  max_trees: number;
  slope: number | null;
  coefficient_uncertainty: { lower: number; upper: number; level: number; coverage_validated: boolean } | null;
  source_mb_code16: string;
  source_kind: "local" | "adjacent" | "nearest";
  unavailable_reason: string | null;
};

export type PlantingScenario = {
  code: string;
  suburb_code: string;
  release: string;
  trees: number;
  model: PlantingModel;
};

export const PLANTING_STORAGE_KEY = "coolchange-planting-v2";

export function calculatePlanting(model: PlantingModel, requestedTrees: number) {
  const trees = Math.min(model.max_trees, Math.max(0, Math.floor(Number.isFinite(requestedTrees) ? requestedTrees : 0)));
  const delta = trees * model.crown_area_m2 / model.area_m2 * 100;
  const heat = model.baseline_heat_c + (model.slope ?? 0) * delta;
  const u = model.coefficient_uncertainty;
  return {
    trees,
    canopy: model.baseline_canopy_pct + delta,
    heat,
    cooling: model.baseline_heat_c - heat,
    // Zero additions are the observed baseline, not a zero-width uncertainty claim.
    range: trees > 0 && u ? [model.baseline_heat_c + u.lower * delta, model.baseline_heat_c + u.upper * delta] as const : null,
  };
}

export function keepSuburbPlanting(scenarios: PlantingScenario[], suburbCode: string) {
  return scenarios.filter(s => s.suburb_code === suburbCode);
}

// Keep every planted block in the current suburb, in order of first addition.
export function updatePlanting(scenarios: PlantingScenario[], next: PlantingScenario) {
  const trees = calculatePlanting(next.model, next.trees).trees;
  const current = keepSuburbPlanting(scenarios, next.suburb_code).filter(s => s.release === next.release);
  if (!trees) return current.filter(s => s.code !== next.code);
  const existing = current.find(s => s.code === next.code);
  if (existing) return current.map(s => s.code === next.code ? { ...next, trees } : s);
  return [...current, { ...next, trees }];
}

// Storage can be unavailable or contain stale/edited data. Restore only complete models.
export function restorePlanting(raw: string | null): PlantingScenario[] {
  try {
    const value: unknown = JSON.parse(raw || "[]");
    if (!Array.isArray(value)) return [];
    const result: PlantingScenario[] = [];
    for (const s of value) {
      const m = s?.model;
      if (!s || !/^\d{11}$/.test(s.code) || !/^\d{9}$/.test(s.suburb_code) || !/^[a-f0-9]{64}$/.test(s.release) ||
        !Number.isSafeInteger(s.trees) || s.trees <= 0 || !m ||
        ![m.baseline_heat_c, m.baseline_canopy_pct, m.area_m2, m.crown_area_m2, m.canopy_ceiling_pct, m.slope].every(v => typeof v === "number" && Number.isFinite(v)) ||
        m.area_m2 <= 0 || m.crown_area_m2 <= 0 || m.slope >= 0 ||
        m.baseline_canopy_pct < 0 || m.canopy_ceiling_pct > 100 || m.canopy_ceiling_pct < m.baseline_canopy_pct ||
        !Number.isSafeInteger(m.max_trees) || m.max_trees < s.trees ||
        m.max_trees > Math.floor((m.canopy_ceiling_pct - m.baseline_canopy_pct) / 100 * m.area_m2 / m.crown_area_m2 + 1e-9) ||
        !["local", "adjacent", "nearest"].includes(m.source_kind) || !/^\d{11}$/.test(m.source_mb_code16)) continue;
      const u = m.coefficient_uncertainty;
      if (u !== null && (!u || !Number.isFinite(u.lower) || !Number.isFinite(u.upper) ||
        u.lower > m.slope || u.upper < m.slope || u.level !== 0.95 || u.coverage_validated !== false)) continue;
      if (!result.some(item => item.code === s.code)) result.push(s as PlantingScenario);
    }
    return result.length ? keepSuburbPlanting(result, result[result.length - 1].suburb_code) : [];
  } catch { return []; }
}
