import type { PlantingModel } from "./planting";

export function plantingMilestones(model: PlantingModel, suburbCanopy: number | null) {
  const step = model.crown_area_m2 / model.area_m2 * 100;
  if (!Number.isFinite(step) || step <= 0 || model.max_trees <= 0) return [];
  const milestones: { trees: number; labels: string[] }[] = [];
  const add = (target: number, label: string) => {
    if (!Number.isFinite(target) || target <= model.baseline_canopy_pct) return;
    const trees = Math.ceil((target - model.baseline_canopy_pct) / step - 1e-9);
    if (trees <= 0 || trees > model.max_trees) return;
    const existing = milestones.find(item => item.trees === trees);
    if (existing) existing.labels.push(label);
    else milestones.push({ trees, labels: [label] });
  };
  if (suburbCanopy != null) add(suburbCanopy, "Suburb average canopy");
  add(model.baseline_canopy_pct + 5, "+5 percentage points canopy");
  return milestones.sort((a, b) => a.trees - b.trees);
}
