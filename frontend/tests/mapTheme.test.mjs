import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMapTheme } from '../src/utils/mapTheme.ts';

test('theme changes preserve data layers and restore original basemap expressions', () => {
  const original = ['match', ['get', 'class'], 'park', '#abc', '#fff'];
  const layers = [
    { id: 'land', type: 'fill' },
    { id: 'labels', type: 'symbol', layout: { 'text-field': ['get', 'name'] } },
    { id: 'suburb-projection-fill', type: 'fill' },
    { id: 'suburb-meshblocks-fill', type: 'fill' },
    { id: 'melbourne-suburbs-fill', type: 'fill' },
    { id: 'coolchange-heat', type: 'heatmap' },
  ];
  const values = new Map([['land:fill-color', original], ['labels:text-color', '#333']]);
  const touched = new Set();
  const map = {
    getStyle: () => ({ layers }),
    getLayer: id => layers.find(layer => layer.id === id),
    getPaintProperty: (id, property) => values.get(`${id}:${property}`),
    setPaintProperty: (id, property, value) => { touched.add(id); values.set(`${id}:${property}`, value); },
  };
  applyMapTheme(map, 'dark');
  assert.equal(values.get('land:fill-color'), '#27312d');
  assert.deepEqual([...touched], ['land', 'labels']);
  applyMapTheme(map, 'light');
  assert.deepEqual(values.get('land:fill-color'), original);
  assert.equal(values.get('labels:text-color'), '#333');
  assert.equal(values.get('labels:text-halo-color'), undefined);
  applyMapTheme(map, 'dark');
  applyMapTheme(map, 'light');
  assert.deepEqual(values.get('land:fill-color'), original);
});
