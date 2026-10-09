import assert from 'node:assert/strict';
import test from 'node:test';
import { comparisonScale, metricValue, relativeInsight } from '../src/utils/blockInsights.ts';

test('heat differences describe the selected block, including cooler blocks', () => {
  assert.equal(relativeInsight(6.2, 4.8, 'heat'), '1.4°C hotter');
  assert.equal(relativeInsight(2.9, 6.2, 'heat'), '3.3°C cooler');
  assert.equal(relativeInsight(-1, -2, 'heat'), '1.0°C hotter');
});

test('canopy coverage gaps subtract coverage values and show their direction', () => {
  assert.equal(relativeInsight(12.4, 21.7, 'canopy'), '−9.3% canopy coverage');
  assert.equal(relativeInsight(30, 20, 'canopy'), '+10.0% canopy coverage');
});

test('missing data is distinct from zero, and rounded equality has neutral wording', () => {
  assert.equal(metricValue(0, 'canopy'), '0.0%');
  assert.equal(metricValue(null, 'heat'), 'Not available');
  assert.equal(relativeInsight(null, 5, 'heat'), null);
  assert.equal(relativeInsight(5, undefined, 'heat'), null);
  assert.equal(relativeInsight(5, NaN, 'heat'), null);
  assert.equal(relativeInsight(5, 5.01, 'heat'), 'About the same surface heat');
  assert.equal(relativeInsight(20.01, 20, 'canopy'), 'About the same tree canopy');
});

test('comparison axes include negative surface heat and preserve equal spacing', () => {
  const scale = comparisonScale([-3, 0, 8, null, NaN], 'heat');
  assert.equal(scale.min, -4);
  assert.equal(scale.max, 8);
  assert.equal(scale.position(-4), 0);
  assert.equal(scale.position(8), 100);
  assert.equal(scale.position(2), 50);
  assert.equal(scale.position(100), 100);
});

test('empty and zero-only comparisons have a usable scale and missing data does not expand it', () => {
  const empty = comparisonScale([null, undefined, NaN], 'heat');
  assert.ok(empty.max > empty.min);
  assert.equal(empty.position(0), 0);
  const canopy = comparisonScale([0, 13.2, 27.1, undefined], 'canopy');
  assert.equal(canopy.min, 0);
  assert.equal(canopy.max, 30);
  assert.ok(canopy.position(13.2) < canopy.position(27.1));
});
