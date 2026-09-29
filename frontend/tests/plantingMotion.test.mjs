import assert from 'node:assert/strict';
import test from 'node:test';
import { animateHeatStates, tween } from '../src/utils/plantingMotion.ts';

function frameClock() {
  let time = 0;
  let id = 0;
  const callbacks = new Map();
  return {
    now: () => time,
    request: callback => { callbacks.set(++id, callback); return id; },
    cancel: key => callbacks.delete(key),
    advance(ms) {
      time += ms;
      const ready = [...callbacks.values()];
      callbacks.clear();
      ready.forEach(callback => callback(time));
    },
    pending: () => callbacks.size,
  };
}

test('number tween reaches the exact final result and stops scheduling', () => {
  const clock = frameClock();
  const values = [];
  tween(250, value => values.push(value), clock);
  clock.advance(125);
  assert.ok(values[0] > 0 && values[0] < 1);
  clock.advance(125);
  assert.equal(values.at(-1), 1);
  assert.equal(clock.pending(), 0);
});

test('reduced motion applies the final state immediately without scheduling frames', () => {
  const clock = frameClock();
  const current = new Map();
  const writes = [];
  animateHeatStates(current, new Map([['a', { heat: 5, baseline: 8 }]]), 0,
    (...args) => writes.push(args), () => {}, clock);
  assert.deepEqual(writes, [['a', 5]]);
  assert.equal(clock.pending(), 0);
});

test('rapid slider changes continue from the current heat and cancel stale targets', () => {
  const clock = frameClock();
  const current = new Map();
  const write = () => {};
  const clear = () => {};
  const cancel = animateHeatStates(current, new Map([['a', { heat: 4, baseline: 8 }]]), 400, write, clear, clock);
  clock.advance(100);
  const intermediate = current.get('a').heat;
  assert.ok(intermediate < 8 && intermediate > 4);
  cancel();
  animateHeatStates(current, new Map([['a', { heat: 7, baseline: 8 }]]), 400, write, clear, clock);
  clock.advance(100);
  assert.ok(current.get('a').heat > intermediate && current.get('a').heat < 7);
  clock.advance(300);
  assert.equal(current.get('a').heat, 7);
  assert.equal(clock.pending(), 0);
});

test('resetting one block preserves others and returns reset blocks to observed heat', () => {
  const clock = frameClock();
  const current = new Map([['a', { heat: 4, baseline: 8 }], ['b', { heat: 3, baseline: 6 }]]);
  const cleared = [];
  animateHeatStates(current, new Map([['b', { heat: 3, baseline: 6 }]]), 400,
    () => {}, code => cleared.push(code), clock);
  clock.advance(200);
  assert.ok(current.get('a').heat > 4 && current.get('a').heat < 8);
  assert.equal(current.get('b').heat, 3);
  clock.advance(200);
  assert.deepEqual(cleared, ['a']);
  assert.equal(current.has('a'), false);
  assert.equal(current.get('b').heat, 3);
});

test('before or reset all clears all overrides, including when motion is disabled mid-flight', () => {
  const clock = frameClock();
  const current = new Map();
  const cleared = [];
  const cancel = animateHeatStates(current, new Map([['a', { heat: 4, baseline: 8 }], ['b', { heat: 3, baseline: 6 }]]), 400,
    () => {}, code => cleared.push(code), clock);
  clock.advance(100);
  cancel();
  animateHeatStates(current, new Map(), 0, () => {}, code => cleared.push(code), clock);
  assert.equal(current.size, 0);
  assert.deepEqual(cleared.sort(), ['a', 'b']);
  clock.advance(500);
  assert.equal(current.size, 0);
  assert.equal(clock.pending(), 0);
});
