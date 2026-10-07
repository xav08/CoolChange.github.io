import test from 'node:test';
import assert from 'node:assert/strict';
import { canopyFootprint, melbourneSunDirection, plantedTreeScale, clampTreeCount, sampleStreetView, plantingLocations, streetChapters } from '../src/data/streetStory.ts';

test('planting counts handle slider boundaries and invalid input', () => {
  assert.deepEqual([-5, 0, 12, 36, 50, NaN].map(clampTreeCount), [0, 0, 12, 36, 36, 0]);
  assert.equal(plantingLocations.length, 36);
  assert.equal(new Set(plantingLocations.map(point => point.join(','))).size, 36);
  for (const [x, , z] of plantingLocations) {
    assert.ok(Math.abs(z) > 4.3, 'trees must stay off the road and footpaths');
    for (const houseX of [-12, -4, 4, 12]) {
      assert.ok(Math.abs(x - houseX) > 2.15 || Math.abs(Math.abs(z) - 8.8) > 1.9, 'trees must not grow through a house');
    }
  }
});

test('story sampling clamps progress and can be traversed backwards without history', () => {
  assert.deepEqual(sampleStreetView(-1), streetChapters[0].view);
  assert.deepEqual(sampleStreetView(99), streetChapters[5].view);
  const forward = sampleStreetView(2.15);
  sampleStreetView(4.8);
  assert.deepEqual(sampleStreetView(2.15), forward);
});

test('camera settles for reading and reduced motion samples static views', () => {
  assert.deepEqual(sampleStreetView(2.5), sampleStreetView(2.9));
  assert.deepEqual(sampleStreetView(2.5, false, true), streetChapters[2].view);
  assert.ok(sampleStreetView(3, true).camera[1] >= 19);
});

test('story sampling never owns the user tree selection', () => {
  assert.equal('trees' in sampleStreetView(5), false);
  assert.equal(sampleStreetView(4).planting, 0);
  assert.equal(sampleStreetView(5).planting, 1);
});

test('heat remains conspicuous through the exposed, shade and shared-street beats', () => {
  for (const beat of [1, 2, 3]) {
    assert.ok(sampleStreetView(beat).heat >= 0.75);
    assert.equal(sampleStreetView(beat, false, true).heat, streetChapters[beat].view.heat);
  }
  assert.equal(sampleStreetView(0).heat, 0);
  assert.equal(sampleStreetView(4).heat, 0);
});

test('simulator keeps exposed heat and grows the canopy footprint with the tree', () => {
  assert.equal(sampleStreetView(5).heat, 0.85);
  assert.deepEqual(plantingLocations[0], [0, 0.05, 6.1]);
  const [, , width] = canopyFootprint(0, 5.3, 0.9);
  assert.equal(canopyFootprint(0, 5.3, 0)[2], 0);
  assert.ok(canopyFootprint(0, 5.3, 0.45)[2] < width);
});

test('Melbourne sun follows the northern sky from east to west', () => {
  const morning = melbourneSunDirection(0);
  const noon = melbourneSunDirection(0.5);
  const afternoon = melbourneSunDirection(1);
  assert.ok(morning[0] > 0 && afternoon[0] < 0);
  assert.ok(noon[1] > morning[1]);
  for (const direction of [morning, noon, afternoon]) {
    assert.ok(direction[1] > 0 && direction[2] < 0);
    assert.ok(Math.abs(Math.hypot(...direction) - 1) < 1e-10);
  }
});

test('shade is opposite the sun on both verges, with no side-dependent flip', () => {
  for (const z of [-5.3, 5.3]) {
    for (const time of [0, 0.5, 1]) {
      const [sunX, sunY, sunZ] = melbourneSunDirection(time);
      const [x, shadowZ] = canopyFootprint(0, z, 1, time);
      assert.ok(Math.abs(x + 3.1 * sunX / sunY) < 1e-10);
      assert.ok(Math.abs(shadowZ - z + 3.1 * sunZ / sunY) < 1e-10);
      assert.ok(shadowZ > z, 'shade falls south on both sides of this east-west street');
    }
  }
});

test('before/after changes visible planting without consuming the saved selection', () => {
  for (const count of [0, 1, 12, 36]) {
    const scales = before => plantingLocations.map((_, index) => plantedTreeScale(index, count, 1, before));
    assert.equal(scales(false).filter(Boolean).length, count);
    assert.equal(scales(true).filter(Boolean).length, 0);
    assert.equal(scales(false).filter(Boolean).length, count);
    assert.equal(plantedTreeScale(0, count, 0, false), 0);
  }
});

test('five-tree challenge supports individual locations, removal and replacement', async () => {
  const { togglePlantingSite } = await import('../src/data/streetStory.ts');
  let selected = [];
  for (const site of [7, 0, 4, 2, 6]) selected = togglePlantingSite(selected, site);
  assert.deepEqual(selected, [7, 0, 4, 2, 6]);
  assert.deepEqual(togglePlantingSite(selected, 1), selected);
  selected = togglePlantingSite(selected, 4);
  assert.deepEqual(selected, [7, 0, 2, 6]);
  selected = togglePlantingSite(selected, 1);
  assert.deepEqual(selected, [7, 0, 2, 6, 1]);
  for (const invalid of [-1, 3, 8, NaN, 1.5]) assert.deepEqual(togglePlantingSite(selected, invalid), selected);
  assert.deepEqual(togglePlantingSite([], 3), [], 'East homes is no longer a planting option');
});
