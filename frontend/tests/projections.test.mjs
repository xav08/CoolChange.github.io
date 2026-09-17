import test from "node:test";
import assert from "node:assert/strict";
import { daysBand, bandLabel, projectionColor, warmingLabel, isProjectionData, UNAVAILABLE_COLOR } from "../src/utils/projections.ts";

const open = { days_label: "15+", days_lower: 15, days_upper: null };
const closed = { days_label: "5-10", days_lower: 5, days_upper: 10 };
test("ranges preserve open upper bounds and missing values", () => {
  assert.equal(daysBand(open), "15+");
  assert.equal(daysBand(closed), "5–10");
  assert.equal(daysBand(undefined), "not available");
  assert.equal(daysBand({ days_lower: null, days_upper: null, days_label: null }), "not available");
  assert.equal(bandLabel({ ...closed, days_label: "Moderate" }), "Moderate (5–10)");
});
test("colour only depends on the band and the fixed global domain", () => {
  const scale = { min: 1, max: 40 };
  const colors = [1.2, 1.5, 2, 3].map(warming_level => projectionColor({ ...closed, warming_level }, scale));
  assert.equal(new Set(colors).size, 1);
  assert.notEqual(projectionColor(open, scale), colors[0]);
  assert.equal(projectionColor(undefined, scale), UNAVAILABLE_COLOR);
});
test("3.0 is explicitly a scenario and malformed data is rejected", () => {
  assert.equal(warmingLabel(3), "3.0°C scenario");
  assert.equal(warmingLabel(2), "2.0°C");
  const data = { scale: { min: 1, max: 40 }, bands: [open], suburbs: [{ ...open, sa2_code16: "123456789", warming_level: 3 }] };
  assert.equal(isProjectionData(data), true);
  assert.equal(isProjectionData({ ...data, scale: { min: null, max: 40 } }), false);
  assert.equal(isProjectionData({ ...data, suburbs: [{ ...data.suburbs[0], days_lower: "15" }] }), false);
  assert.equal(isProjectionData({ ...data, bands: [] }), false);
});
