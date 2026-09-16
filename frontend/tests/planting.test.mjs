import assert from 'node:assert/strict';
import test from 'node:test';
import { calculatePlanting, keepSuburbPlanting, updatePlanting, restorePlanting } from '../src/utils/planting.ts';

const model = {
  baseline_heat_c: 8, baseline_canopy_pct: 20, area_m2: 10000, crown_area_m2: 50.3,
  canopy_ceiling_pct: 30, max_trees: 19, slope: -0.08,
  coefficient_uncertainty: { lower: -0.10, upper: -0.06, level: 0.95, coverage_validated: false },
  source_mb_code16: '20000000001', source_kind: 'local', unavailable_reason: null,
};
const scenario = (n, trees = 1) => ({ code: `2000000000${n}`, suburb_code: '206011001', release: 'a'.repeat(64), trees, model });

test('whole trees update canopy, cooling and both interval bounds', () => {
  const result = calculatePlanting(model, 10);
  assert.ok(Math.abs(result.canopy - 25.03) < 1e-10);
  assert.ok(Math.abs(result.heat - 7.5976) < 1e-10);
  assert.ok(Math.abs(result.cooling - 0.4024) < 1e-10);
  assert.deepEqual(result.range, [7.497, 7.6982]);
  assert.equal(calculatePlanting(model, -1).trees, 0);
  assert.equal(calculatePlanting(model, 100).trees, 19);
  assert.equal(calculatePlanting(model, 0).range, null);
  assert.ok(calculatePlanting(model, 100).canopy <= 30);
});

test('adding a fourth block keeps all additions; zero removes only that block', () => {
  let saved = [];
  for (const n of [1, 2, 3]) saved = updatePlanting(saved, scenario(n));
  saved = updatePlanting(saved, scenario(1, 10));
  saved = updatePlanting(saved, scenario(4));
  assert.deepEqual(saved.map(s => s.code), [1, 2, 3, 4].map(n => scenario(n).code));
  saved = updatePlanting(saved, scenario(3, 0));
  assert.deepEqual(saved.map(s => s.code), [1, 2, 4].map(n => scenario(n).code));
});

test('restore keeps every valid block in the suburb and tolerates corrupted storage', () => {
  assert.deepEqual(restorePlanting('broken'), []);
  assert.deepEqual(restorePlanting(JSON.stringify([scenario(1), { ...scenario(2), trees: 999 }])), [scenario(1)]);
  assert.deepEqual(restorePlanting(JSON.stringify([1, 2, 3, 4].map(n => scenario(n)))).map(s => s.code), [1, 2, 3, 4].map(n => scenario(n).code));
  assert.deepEqual(restorePlanting(JSON.stringify([{ ...scenario(1), model: { ...model, area_m2: null } }])), []);
});

test('a new model release clears previously saved simulations', () => {
  const saved = updatePlanting([scenario(1)], { ...scenario(2), release: 'b'.repeat(64) });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].code, scenario(2).code);
});

test('ranges that cross zero cooling retain potential warming and stay ordered', () => {
  const result = calculatePlanting({ ...model, coefficient_uncertainty: { ...model.coefficient_uncertainty, upper: 0.02 } }, 10);
  assert.ok(result.range[1] > model.baseline_heat_c);
  assert.ok(result.range[0] < result.range[1]);
});

test('reselecting a suburb preserves additions; changing suburb clears them', () => {
  const saved = [1, 2, 3, 4].map(n => scenario(n));
  assert.deepEqual(keepSuburbPlanting(saved, '206011001'), saved);
  assert.deepEqual(keepSuburbPlanting(saved, '206011002'), []);
  const next = { ...scenario(5), suburb_code: '206011002' };
  assert.deepEqual(updatePlanting(saved, next), [next]);
  assert.deepEqual(keepSuburbPlanting([next], '206011001'), []);
  assert.deepEqual(restorePlanting(JSON.stringify([...saved, next])), [next]);
});
