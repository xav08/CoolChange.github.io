import assert from 'node:assert/strict';
import test from 'node:test';
import { plantingMilestones } from '../src/utils/plantingMilestones.ts';
import { sheetAfterDrag } from '../src/utils/explorerSheet.ts';
import { selectedBlockPadding } from '../src/utils/canopyGeometry.ts';

const model={baseline_canopy_pct:20,crown_area_m2:50.3,area_m2:10000,max_trees:19};

test('milestones round upward to the first whole tree that reaches the real canopy target',()=>{
  const milestones=plantingMilestones(model,22);
  assert.deepEqual(milestones,[{trees:4,labels:['Suburb average']}]);
  assert.ok(20+4*0.503>=22);
  assert.ok(20+3*0.503<22);
});
test('unsupported and already-met suburb targets never appear as reachable goals',()=>{
  for(const avg of [null,NaN,10,20,40]) {
    assert.deepEqual(plantingMilestones(model,avg),[]);
  }
  assert.deepEqual(plantingMilestones({...model,max_trees:0},25),[]);
  assert.deepEqual(plantingMilestones({...model,max_trees:5},40),[]);
});
test('the suburb average is the only target and exact whole-tree thresholds do not round one too high',()=>{
  assert.deepEqual(plantingMilestones(model,25),[{trees:10,labels:['Suburb average']}]);
  assert.equal(plantingMilestones({...model,crown_area_m2:50},22)[0].trees,4);
});
test('sheet drag ignores taps, follows direction, and clamps both ends',()=>{
  assert.equal(sheetAfterDrag('half',20),'half');
  assert.equal(sheetAfterDrag('half',-60),'full');
  assert.equal(sheetAfterDrag('half',60),'collapsed');
  assert.equal(sheetAfterDrag('collapsed',-200),'full');
  assert.equal(sheetAfterDrag('full',200),'collapsed');
  assert.equal(sheetAfterDrag('collapsed',60),'collapsed');
});
test('bottom-sheet camera padding keeps the block between top controls and the sheet',()=>{
  const half=selectedBlockPadding(390,844,{top:388,right:390,bottom:844});
  assert.ok(half.top>=176);
  assert.ok(844-half.bottom<388);
  assert.ok(844-half.top-half.bottom>=80);
  const collapsed=selectedBlockPadding(390,844,{top:675,right:390,bottom:844});
  assert.ok(collapsed.bottom<half.bottom);
});
