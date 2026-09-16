const { plantingModel } = require("../src/services/plantingModel");
const fixture = require("./fixtures/simulator-v3.json");
const block = fixture.blocks.find(b => b.status === "indicative");
const baseline = { uhi_mean: 8.33591234, canopy_pct: 24.74951234, area_sqkm: 0.0142001234 };

test("uses unrounded mesh_block baseline and whole trees below the model ceiling", () => {
  const result = plantingModel(block, fixture, baseline);
  expect(result.baseline_heat_c).toBe(baseline.uhi_mean);
  expect(result.area_m2).toBe(baseline.area_sqkm * 1e6);
  const newCanopy = n => baseline.canopy_pct + n * 50.3 / result.area_m2 * 100;
  expect(newCanopy(result.max_trees)).toBeLessThanOrEqual(result.canopy_ceiling_pct);
  expect(newCanopy(result.max_trees + 1)).toBeGreaterThan(result.canopy_ceiling_pct);
});

test("a donor supplies the coefficient and uncertainty but not baseline, area or a higher ceiling", () => {
  const selected = { ...block, tree_planting: { ...block.tree_planting, local_canopy_max_pct: 40 } };
  const fit = { ...block, mb_code16: "20000000000", tree_planting: { ...block.tree_planting,
    local_canopy_min_pct: 0, local_canopy_max_pct: 60, simulation_slope: -0.08,
    coefficient_uncertainty: { lower: -0.1, upper: -0.06 } } };
  const result = plantingModel(selected, fixture, baseline, { payload: fit, adjacent: true });
  expect(result).toMatchObject({ baseline_heat_c: baseline.uhi_mean, baseline_canopy_pct: baseline.canopy_pct,
    canopy_ceiling_pct: 40, slope: -0.08, source_kind: "adjacent", source_mb_code16: fit.mb_code16,
    coefficient_uncertainty: fit.tree_planting.coefficient_uncertainty });
  fit.tree_planting.local_canopy_max_pct = 30;
  expect(plantingModel(selected, fixture, baseline, { payload: fit, adjacent: false })).toMatchObject({
    canopy_ceiling_pct: 30, source_kind: "nearest" });
});

test("blocks at the ceiling or without a supported fit cannot add trees", () => {
  expect(plantingModel(block, fixture, { ...baseline, canopy_pct: block.tree_planting.local_canopy_max_pct }).max_trees).toBe(0);
  const unavailable = fixture.blocks.find(b => b.status === "unavailable");
  expect(plantingModel(unavailable, fixture, baseline)).toMatchObject({ max_trees: 0, slope: null });
});
