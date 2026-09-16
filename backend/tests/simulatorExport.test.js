const fixture = require("./fixtures/simulator-v3.json");
const { validateExport, validateDatabaseBlocks } = require("../src/db/simulatorExport");
const clone = () => JSON.parse(JSON.stringify(fixture));
const baselines = (data) => data.blocks.map((b) => ({
  mb_code16: b.mb_code16, uhi_mean: Math.fround(b.observed_uhi),
  canopy_pct: Math.fround(b.observed_canopy_pct), area_sqkm: Math.fround(b.tree_planting.area_m2 / 1e6),
}));

test("accepts real indicative, screened and outside-domain exports without rounding", () => {
  const data = validateExport(clone());
  const casey = data.blocks.find((b) => b.mb_code16 === "20631942810");
  expect(casey.observed_uhi).toBe(15.6781);
  expect(casey.tree_planting.default_limits_by_profile.B.max_trees_with_estimate).toBe(542);
  expect(casey.scenarios[1].cooling_c).toBe(0.8049602482108102);
  expect(data.metadata.blocks).toBeUndefined();
  expect(() => validateDatabaseBlocks(data.blocks, baselines(data))).not.toThrow();
});

test.each([
  ["schema version", (d) => { d.schema_version = 2; }],
  ["duplicate block", (d) => { d.blocks.push(d.blocks[0]); }],
  ["numeric block code", (d) => { d.blocks[0].mb_code16 = 20046872000; }],
  ["missing source hash", (d) => { delete d.inputs.points_sha256; }],
  ["unknown reason", (d) => { d.blocks[0].reason_codes.push("invented"); }],
  ["null cooling replaced by zero", (d) => { d.blocks[0].scenarios[1].cooling_c = 0; }],
  ["screened slope replaced by zero", (d) => { d.blocks[0].tree_planting.simulation_slope = 0; }],
  ["positive simulation slope", (d) => { d.blocks[1].tree_planting.simulation_slope = 0.1; }],
  ["invented site capacity", (d) => { d.blocks[1].tree_planting.site_capacity_trees = 542; }],
  ["inflated tree limit", (d) => { d.blocks[1].tree_planting.default_limits_by_profile.B.max_trees_with_estimate = 543; }],
  ["nonfinite baseline", (d) => { d.blocks[1].observed_uhi = Infinity; }],
  ["rounded baseline", (d) => { d.blocks[1].observed_uhi = 15.68; }],
  ["incorrect cooling", (d) => { d.blocks[1].scenarios[1].cooling_c = 8; }],
  ["missing scenario", (d) => { d.blocks[1].scenarios.pop(); }],
])("rejects %s", (_, mutate) => {
  const data = clone();
  mutate(data);
  expect(() => validateExport(data)).toThrow("Invalid simulator export");
});

test.each(["uhi_mean", "canopy_pct", "area_sqkm", "mb_code16"])("rejects different database %s", (key) => {
  const rows = baselines(fixture);
  rows[0][key] = key === "mb_code16" ? "00000000000" : rows[0][key] + 0.001;
  expect(() => validateDatabaseBlocks(fixture.blocks, rows)).toThrow("does not match database");
});

test("rejects missing or extra database blocks", () => {
  expect(() => validateDatabaseBlocks(fixture.blocks, baselines(fixture).slice(1))).toThrow("count differs");
});

const uncertaintyFixture = require("./helpers/uncertaintyFixture")();
test("accepts the new conditional mean uncertainty export", () => {
  expect(() => validateExport(uncertaintyFixture)).not.toThrow();
});

test.each([
  ["negative standard error", (d, b) => { b.tree_planting.coefficient_uncertainty.standard_error = -1; }],
  ["incorrect coefficient bounds", (d, b) => { b.tree_planting.coefficient_uncertainty.upper = 4; }],
  ["incorrect cooling bounds", (d, b) => { b.scenarios[1].cooling_interval.lower_c = 4; }],
  ["invented validated coverage", d => { d.uncertainty.coverage_validated = true; }],
  ["unsupported prediction interval", d => { d.uncertainty.scope = "future_temperature"; }],
  ["unsupported critical value", d => { d.uncertainty.critical_value = 1; }],
])("rejects %s in the uncertainty export", (_, mutate) => {
  const data = JSON.parse(JSON.stringify(uncertaintyFixture));
  mutate(data, data.blocks.find(b => b.status === "indicative" && b.scenarios[1].status === "indicative"));
  expect(() => validateExport(data)).toThrow("Invalid simulator export");
});
