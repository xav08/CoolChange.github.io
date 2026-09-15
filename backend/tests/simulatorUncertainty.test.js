const fixture = require('./helpers/uncertaintyFixture');
const { validateExport } = require('../src/db/simulatorExport');

const eligible = d => d.blocks.find(b => b.status === 'indicative');
const scenario = d => eligible(d).scenarios.find(s => s.status === 'indicative');
test('accepts optional uncertainty and retains signed, zero-crossing intervals', () => {
  const data = fixture();
  expect(() => validateExport(data)).not.toThrow();
  expect(scenario(data).cooling_interval.lower_c).toBeLessThan(0);
  expect(scenario(data).cooling_interval.includes_zero).toBe(true);
  expect(data.blocks[0].tree_planting.coefficient_uncertainty).toBeNull();
  expect(eligible(data).scenarios[0].cooling_interval).toBeNull();
});

test.each([
  ['missing metadata', d => { delete d.uncertainty; }],
  ['calibrated coverage claim', d => { d.uncertainty.coverage_validated = true; }],
  ['wrong level', d => { d.uncertainty.level = .9; }],
  ['prediction interval scope', d => { d.uncertainty.scope = 'future_temperature'; }],
  ['missing spatial caveat', d => { d.uncertainty.excludes = []; }],
  ['wrong variance', d => { d.uncertainty.fit.residual_variance = 2; }],
  ['wrong degrees of freedom', d => { d.uncertainty.fit.residual_df = 3; }],
  ['missing coefficient', d => { delete eligible(d).tree_planting.coefficient_uncertainty; }],
  ['negative standard error', d => { eligible(d).tree_planting.coefficient_uncertainty.standard_error = -1; }],
  ['nonfinite standard error', d => { eligible(d).tree_planting.coefficient_uncertainty.standard_error = Infinity; }],
  ['wrong coefficient bounds', d => { eligible(d).tree_planting.coefficient_uncertainty.lower -= .01; }],
  ['null indicative interval', d => { scenario(d).cooling_interval = null; }],
  ['clipping negative lower bound', d => { scenario(d).cooling_interval.lower_c = 0; }],
  ['incorrect zero flag', d => { scenario(d).cooling_interval.includes_zero = false; }],
  ['reversed cooling bounds', d => { const s = scenario(d).cooling_interval; [s.lower_c, s.upper_c] = [s.upper_c,s.lower_c]; }],
  ['interval on unavailable block', d => { d.blocks[0].tree_planting.coefficient_uncertainty = eligible(d).tree_planting.coefficient_uncertainty; }],
  ['interval on baseline', d => { eligible(d).scenarios[0].cooling_interval = scenario(d).cooling_interval; }],
])('rejects %s', (_, mutate) => {
  const data = fixture();
  mutate(data);
  expect(() => validateExport(data)).toThrow('Invalid simulator export: uncertainty');
});
