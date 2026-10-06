import assert from 'node:assert/strict';
import test from 'node:test';
import { fewTrees, intersectRect, milestoneTrees, mostCommon, padRect, pickDemoBlocks, placeCard, scoreDemoBlock, unionRects } from '../src/tour/tourLogic.ts';
import { TOUR_CHAPTERS } from '../src/tour/tourSteps.ts';

const desktop = { width: 1440, height: 900 };
const card = { width: 360, height: 280 };

test('cards sit beside their target and never leave the screen', () => {
  const panel = { left: 40, top: 112, width: 410, height: 300 };
  assert.deepEqual(placeCard(panel, desktop, card), { left: 466, top: 112, width: 360, placement: 'right' });
  const rightEdge = { left: 1060, top: 112, width: 350, height: 120 };
  assert.equal(placeCard(rightEdge, desktop, card).placement, 'left');
  const legend = { left: 1200, top: 820, width: 220, height: 60 };
  const low = placeCard(legend, desktop, card);
  assert.ok(low.top + card.height <= desktop.height - 12);
  assert.equal(placeCard(null, desktop, card).placement, 'center');
  const whole = { left: 0, top: 0, width: 1440, height: 900 };
  const fallback = placeCard(whole, desktop, card);
  assert.ok(fallback.left >= 12 && fallback.top >= 12);
});

test('phones get a full-width card on the side away from the target', () => {
  const phone = { width: 390, height: 844 };
  const inSheet = { left: 12, top: 600, width: 366, height: 120 };
  assert.deepEqual(placeCard(inSheet, phone, card), { left: 12, top: 12, width: 366, placement: 'top' });
  const atTop = { left: 12, top: 88, width: 366, height: 80 };
  assert.equal(placeCard(atTop, phone, card).placement, 'bottom');
  assert.equal(placeCard(atTop, phone, card).top, 844 - 280 - 12);
});

test('rect helpers union, clip and pad', () => {
  assert.deepEqual(unionRects([{ left: 0, top: 0, width: 10, height: 10 }, { left: 20, top: 5, width: 10, height: 10 }, { left: 3, top: 3, width: 0, height: 0 }]), { left: 0, top: 0, width: 30, height: 15 });
  assert.equal(unionRects([]), null);
  assert.deepEqual(intersectRect({ left: 0, top: 0, width: 10, height: 10 }, { left: 5, top: 5, width: 10, height: 10 }), { left: 5, top: 5, width: 5, height: 5 });
  assert.equal(intersectRect({ left: 0, top: 0, width: 2, height: 2 }, { left: 5, top: 5, width: 2, height: 2 }), null);
  assert.deepEqual(padRect({ left: 50, top: 50, width: 4, height: 4 }, 2, 40), { left: 32, top: 32, width: 40, height: 40 });
});

test('demo block prefers a local model with both milestones', () => {
  const base = { hasModel: true, sourceKind: 'local', unavailable: false, maxTrees: 20, milestoneCount: 2, streetCount: 1 };
  assert.equal(scoreDemoBlock({ ...base, code: 'a', hasModel: false }), null);
  assert.equal(scoreDemoBlock({ ...base, code: 'a', unavailable: true }), null);
  assert.equal(scoreDemoBlock({ ...base, code: 'a', maxTrees: 1 }), null);
  const picked = pickDemoBlocks([
    { ...base, code: 'borrowed', sourceKind: 'adjacent' },
    { ...base, code: 'one-marker', milestoneCount: 1 },
    { ...base, code: 'best' },
    { ...base, code: 'none', hasModel: false },
  ]);
  assert.deepEqual(picked, { primary: 'best', secondary: 'one-marker' });
  assert.deepEqual(pickDemoBlocks([]), { primary: null, secondary: null });
});

test('tree targets avoid milestones for the starting value and prefer the suburb marker', () => {
  assert.equal(fewTrees(20, [7, 12]), 3);
  assert.equal(fewTrees(20, [3, 9]), 2);
  assert.equal(fewTrees(2, [1, 2]), 2);
  assert.equal(fewTrees(0, []), 0);
  const marks = [{ trees: 6, labels: ['+5 percentage points canopy'] }, { trees: 11, labels: ['Suburb average canopy'] }];
  assert.equal(milestoneTrees(20, marks), 11);
  assert.equal(milestoneTrees(20, [marks[0]]), 6);
  assert.equal(milestoneTrees(5, []), 5);
  assert.equal(mostCommon(['a', 'b', 'b', 'c']), 'b');
  assert.equal(mostCommon([]), null);
});
