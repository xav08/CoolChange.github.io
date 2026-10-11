import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReport, firstStreet, reportForSuburb, toggleReportBlock } from '../src/utils/report.ts';
import { loadReport } from '../src/utils/reportData.ts';
import { calculatePlanting } from '../src/utils/planting.ts';

const suburb = { sa2_code16: '206011105', sa2_name: 'Brunswick', persons: 25000 };
const model = { baseline_heat_c: 4, baseline_canopy_pct: 10, area_m2: 10000, crown_area_m2: 50,
  canopy_ceiling_pct: 60, max_trees: 100, slope: -0.1, coefficient_uncertainty: { lower: -0.15, upper: -0.05, level: 0.95, coverage_validated: false },
  source_mb_code16: '20000000001', source_kind: 'local', unavailable_reason: null };
const detail = (code = '20000000001', overrides = {}) => ({
  block: { mb_code16: code, persons: 100, uhi_mean: 4, canopy_pct: 10, area_sqkm: 0.01 },
  streets: ['', 'Sydney Road', 'Other Road'], simulator: { release_id: 'release-a', interactive: model }, ...overrides,
});
const scenario = { code: '20000000001', suburb_code: suburb.sa2_code16, release: 'release-a', trees: 10, model };
const input = (overrides = {}) => ({ suburb, createdAt: '2026-10-11T01:00:00Z', warming: 2,
  projection: { days_lower: 30, days_upper: null, days_label: '30+' }, codes: ['20000000001'], details: [detail()], scenarios: [scenario], ...overrides });

test('report selection is independent of planting, toggles without duplicates and resets only for another suburb', () => {
  const empty = { suburbCode: '', items: [] };
  const item = { code: scenario.code, street: 'Sydney Road' };
  const selected = toggleReportBlock(empty, suburb.sa2_code16, item);
  assert.deepEqual(selected.items, [item]);
  assert.equal(reportForSuburb(selected, suburb.sa2_code16), selected);
  assert.deepEqual(reportForSuburb(selected, '206011106').items, []);
  assert.deepEqual(toggleReportBlock(selected, suburb.sa2_code16, item).items, []);
  assert.deepEqual(empty.items, []);
  assert.equal(firstStreet(['', '  ', ' Sydney Road ', 'Other']), 'Sydney Road');
  assert.equal(firstStreet([]), 'Street not available');
});

test('report uses app planting arithmetic and only includes requested blocks once', () => {
  const source = input({ codes: [scenario.code, scenario.code], details: [detail(), detail('20000000002')] });
  const before = structuredClone(source);
  const report = buildReport(source);
  const expected = calculatePlanting(model, 10);
  assert.equal(report.blocks.length, 1);
  assert.equal(report.blocks[0].simulatedHeat, expected.heat);
  assert.equal(report.blocks[0].simulatedCanopy, expected.canopy);
  assert.deepEqual(report.blocks[0].range, expected.range);
  assert.equal(report.blocks[0].canopyChange, 5);
  assert.equal(report.population, 100);
  assert.equal(report.suburb.persons, 25000);
  assert.equal(report.trees, 10);
  assert.deepEqual(source, before);
});

test('overall cooling is area weighted and includes unplanted blocks, never a sum', () => {
  const second = detail('20000000002', { simulator: null, block: { mb_code16: '20000000002', persons: 300, uhi_mean: -2, canopy_pct: 40, area_sqkm: 0.03 } });
  const report = buildReport(input({ codes: [scenario.code, second.block.mb_code16], details: [detail(), second] }));
  assert.equal(report.overall.baseline, -0.5);
  assert.equal(report.overall.simulated, -0.625);
  assert.equal(report.overall.cooling, 0.125);
  assert.equal(report.population, 400);
  assert.equal(report.blocks[1].cooling, 0);
  assert.equal(report.blocks[1].range, null);
});

test('missing numbers remain unavailable, valid zero population is counted and invalid area is excluded', () => {
  const missing = detail('20000000002', { simulator: null, block: { mb_code16: '20000000002', persons: null, uhi_mean: null, canopy_pct: null, area_sqkm: 0 } });
  const zero = detail('20000000003', { simulator: null, block: { mb_code16: '20000000003', persons: 0, uhi_mean: 0, canopy_pct: 0, area_sqkm: 1 } });
  const report = buildReport(input({ codes: [missing.block.mb_code16, zero.block.mb_code16], details: [missing, zero], scenarios: [] }));
  assert.equal(report.population, 0);
  assert.equal(report.populationIncluded, 1);
  assert.equal(report.overall.included, 1);
  assert.equal(report.blocks[0].cooling, null);
  assert.equal(report.blocks[0].simulatedCanopy, null);
  assert.equal(report.blocks[1].cooling, 0);
  assert.equal(buildReport(input({ codes: [missing.block.mb_code16], details: [missing], scenarios: [] })).overall, null);
});

test('changed or unavailable planted models stop export rather than silently changing the scenario', () => {
  for (const simulator of [null, { release_id: 'release-b', interactive: model },
    { release_id: 'release-a', interactive: { ...model, max_trees: 1 } }]) {
    assert.throws(() => buildReport(input({ details: [detail(scenario.code, { simulator })] })), /Reopen that block/);
  }
  assert.throws(() => buildReport(input({ details: [] })), /unavailable/);
  assert.throws(() => buildReport(input({ codes: [] })), /at least one/);
});

test('projection ranges and selected warming level are retained without planting adjustments', () => {
  const report = buildReport(input({ warming: 3 }));
  assert.equal(report.projection.days_upper, null);
  assert.equal(report.projection.days_lower, 30);
  assert.equal(report.warming, 3);
  const finite = buildReport(input({ projection: { days_lower: 10, days_upper: 20, days_label: '10-20' } }));
  assert.equal(finite.projection.days_upper, 20);
});

const projections = { scale: { min: 0, max: 30 }, bands: [{ days_lower: 30, days_upper: null, days_label: '30+' }],
  suburbs: [{ sa2_code16: suburb.sa2_code16, warming_level: 2, days_lower: 30, days_upper: null, days_label: '30+' }] };
test('export loads block details without depending on future projections and bounds requests', async () => {
  const codes = Array.from({ length: 10 }, (_, i) => String(20000000001 + i));
  let active = 0, max = 0;
  const paths = [];
  const fetcher = async (url, options) => {
    assert.ok(options.signal);
    paths.push(url);
    active++; max = Math.max(max, active);
    await new Promise(resolve => setTimeout(resolve, 2)); active--;
    return { ok: true, json: async () => detail(url.split('/').at(-1)) };
  };
  const report = await loadReport({ ...input({ codes }), apiBase: '/api/v1', signal: new AbortController().signal }, fetcher);
  assert.equal(report.blocks.length, 10);
  assert.ok(max <= 4);
  assert.equal(paths.length, 10);
  assert.ok(paths.every(path => path.startsWith('/api/v1/meshblocks/')));
  assert.equal(report.projection, null);
});

test('failed or malformed responses reject the report, and a subsequent attempt can succeed', async () => {
  const args = { ...input(), apiBase: '/api/v1', signal: new AbortController().signal };
  await assert.rejects(loadReport(args, async () => ({ ok: false })), /retry/);
  await assert.rejects(loadReport(args, async () => ({ ok: true, json: async () => ({}) })), /retry/);
  const report = await loadReport(args, async url => ({ ok: true, json: async () => url.endsWith('/map/projections') ? projections : detail() }));
  assert.equal(report.trees, 10);
});
