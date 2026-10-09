import type { PlantingModel } from "./planting";

export function plantingMilestones(model: PlantingModel, suburbCanopy: number | null) {
  const step = model.crown_area_m2 / model.area_m2 * 100;
  if (!Number.isFinite(step) || step <= 0 || model.max_trees <= 0) return [];
  if (suburbCanopy == null || !Number.isFinite(suburbCanopy) || suburbCanopy <= model.baseline_canopy_pct) return [];
  const trees = Math.ceil((suburbCanopy - model.baseline_canopy_pct) / step - 1e-9);
  if (trees <= 0 || trees > model.max_trees) return [];
  return [{ trees, labels: ["Suburb average"] }];
}
