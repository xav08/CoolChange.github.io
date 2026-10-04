import assert from 'node:assert/strict';
import test from 'node:test';
import { canopyDensity, canopyPoints, insidePolygons, polygonsFor, selectedBlockPadding } from '../src/utils/canopyGeometry.ts';
import { queueCoolingPulse } from '../src/utils/coolingFeedback.ts';

test('illustrative canopy stays capped and handles zero, invalid and out-of-range inputs', () => {
  assert.deepEqual(canopyDensity(0, 100), {ratio:0,count:0});
  assert.deepEqual(canopyDensity(1, 100), {ratio:0.01,count:1});
  assert.deepEqual(canopyDensity(50, 100), {ratio:0.5,count:5});
  assert.deepEqual(canopyDensity(999, 100), {ratio:1,count:10});
  assert.deepEqual(canopyDensity(2, 0), {ratio:0,count:0});
  assert.deepEqual(canopyDensity(NaN, 100), {ratio:0,count:0});
});

test('marker placement is stable and excludes holes and concave cutouts', () => {
  const polygon = polygonsFor({type:'Polygon',coordinates:[
    [[0,0],[10,0],[10,4],[4,4],[4,10],[0,10],[0,0]],
    [[1,1],[3,1],[3,3],[1,3],[1,1]],
  ]});
  const points = canopyPoints(polygon);
  assert.equal(points.length, 10);
  assert.deepEqual(canopyPoints(polygon), points);
  for (const point of points) assert.equal(insidePolygons(point, polygon), true);
  assert.equal(insidePolygons([2,2],polygon),false);
  assert.equal(insidePolygons([8,8],polygon),false);
});

test('multipolygon placement never invents markers in the space between islands', () => {
  const polygons=polygonsFor({type:'MultiPolygon',coordinates:[
    [[[0,0],[1,0],[1,1],[0,1],[0,0]]],
    [[[4,4],[5,4],[5,5],[4,5],[4,4]]],
  ]});
  const points=canopyPoints(polygons);
  assert.equal(points.length,10);
  assert.ok(points.every(point=>insidePolygons(point,polygons)));
  assert.deepEqual(canopyPoints(polygonsFor(null)),[]);
  assert.deepEqual(polygonsFor({type:'Point',coordinates:[1,2]}),[]);
});

test('camera reserves the actual side panel and enough visible space on mobile', () => {
  const desktop=selectedBlockPadding(1280,720,{right:461,bottom:690});
  assert.equal(desktop.left,485);
  assert.ok(1280-desktop.left-desktop.right>500);
  const mobile=selectedBlockPadding(390,760,{right:378,bottom:550});
  assert.ok(mobile.top>550);
  assert.ok(760-mobile.top-mobile.bottom>=90);
});

function fakeTimer() {
  let serial=0;
  const jobs=new Map();
  return {set(fn,delay){assert.equal(delay,250);jobs.set(++serial,fn);return serial;},clear(id){jobs.delete(id);},flush(){const list=[...jobs.values()];jobs.clear();list.forEach(fn=>fn());},count(){return jobs.size;}};
}

test('held slider never pulses; release and repeated updates yield exactly one latest pulse', () => {
  const timer=fakeTimer();const consumed={current:0};const emitted=[];
  const emit=n=>emitted.push(n);
  queueCoolingPulse(1,consumed,true,true,emit,timer);timer.flush();
  assert.deepEqual(emitted,[]);
  let cancel=queueCoolingPulse(1,consumed,true,false,emit,timer);
  cancel();cancel=queueCoolingPulse(2,consumed,true,false,emit,timer);
  assert.equal(timer.count(),1);timer.flush();
  assert.deepEqual(emitted,[2]);
  cancel();queueCoolingPulse(2,consumed,true,false,emit,timer);timer.flush();
  assert.deepEqual(emitted,[2]);
});

test('Before, reset, selection cleanup and reduced motion cancel pending feedback without replay', () => {
  const timer=fakeTimer();const consumed={current:0};const emitted=[];
  const emit=n=>emitted.push(n);
  const cancel=queueCoolingPulse(1,consumed,true,false,emit,timer);
  cancel();queueCoolingPulse(1,consumed,false,false,emit,timer);timer.flush();
  queueCoolingPulse(1,consumed,true,false,emit,timer);timer.flush();
  assert.deepEqual(emitted,[]);
  queueCoolingPulse(2,consumed,true,false,emit,timer);timer.flush();
  assert.deepEqual(emitted,[2]);
});
