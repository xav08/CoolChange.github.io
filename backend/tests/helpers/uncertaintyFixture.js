const original = require('../fixtures/simulator-v3.json');
const metadata = require('../fixtures/uncertainty-metadata.json');
// Deliberately wide synthetic standard errors test intervals crossing zero.
module.exports = function uncertaintyFixture() {
  const data = JSON.parse(JSON.stringify(original));
  data.uncertainty = JSON.parse(JSON.stringify(metadata));
  const common = { method: metadata.method, level: 0.95, coverage_validated: false };
  for (const b of data.blocks) {
    const slope = b.tree_planting.simulation_slope;
    const se = slope === null ? null : Math.abs(slope) * 2;
    const c = b.status === 'indicative' ? { ...common, standard_error: se,
      lower: slope - metadata.critical_value * se, upper: slope + metadata.critical_value * se } : null;
    b.tree_planting.coefficient_uncertainty = c;
    for (const s of b.scenarios) {
      const lower = c && -c.upper * s.applied_delta_pp;
      const upper = c && -c.lower * s.applied_delta_pp;
      s.cooling_interval = s.status === 'indicative' ? { ...common, lower_c: lower, upper_c: upper,
        includes_zero: lower <= 0 && upper >= 0 } : null;
    }
  }
  return data;
};
