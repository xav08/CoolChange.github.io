import assert from 'node:assert/strict';
import test from 'node:test';
import { initialWelcomePhase, shouldShowWelcome } from '../src/data/welcome.ts';

test('new visits enter through the welcome while direct destination links stay intact', () => {
  for (const hash of ['', '#', '#top', '#story']) assert.equal(shouldShowWelcome(hash), true);
  for (const hash of ['#map', '#about', '#explore', '#street-plant', '#street-time']) {
    assert.equal(shouldShowWelcome(hash), false);
  }
});

test('refreshing the homepage always welcomes returning visitors, even with the old seen flag', (t) => {
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const savedStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  t.after(() => {
    if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow);
    else delete globalThis.window;
    if (savedStorage) Object.defineProperty(globalThis, 'sessionStorage', savedStorage);
    else delete globalThis.sessionStorage;
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { hash: '#top' } } });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: () => 'true' } });
  assert.equal(initialWelcomePhase(), 'welcome');
  assert.equal(initialWelcomePhase(), 'welcome');
  window.location.hash = '#map';
  assert.equal(initialWelcomePhase(), 'complete');
});
