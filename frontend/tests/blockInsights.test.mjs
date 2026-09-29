import assert from 'node:assert/strict';
import test from 'node:test';
import { metricValue, relativeInsight } from '../src/utils/blockInsights.ts';

test('heat differences describe the selected block, including cooler blocks', () => {
  assert.equal(relativeInsight(6.2, 4.8, 'heat'), '1.4°C hotter');
  assert.equal(relativeInsight(2.9, 6.2, 'heat'), '3.3°C cooler');
  assert.equal(relativeInsight(-1, -2, 'heat'), '1.0°C hotter');
});

test('canopy comparisons use percentage points rather than relative percentages', () => {
  assert.equal(relativeInsight(12.4, 21.7, 'canopy'), '9.3 percentage points less tree canopy');
  assert.equal(relativeInsight(30, 20, 'canopy'), '10.0 percentage points more tree canopy');
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
