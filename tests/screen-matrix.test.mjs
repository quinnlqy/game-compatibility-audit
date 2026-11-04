import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMatrix,extractBreakpoints} from '../skills/game-compatibility-audit/scripts/screen-matrix.mjs';

test('common matrix is finite and keeps input separate from dimensions',()=>{
  const result=buildMatrix();assert.equal(result.cases.length,15);
  assert.ok(result.cases.some(row=>row.width===1280&&row.input==='mouse'));
  const mixed=buildMatrix({common:false,sizes:[{width:800,height:600,input:'mouse'},{width:800,height:600,input:'touch'}]});
  assert.equal(mixed.cases.length,2);
});
test('extracts pixel min/max and range boundaries; does not guess rem or device width',()=>{
  const result=extractBreakpoints(['(min-width:600px) and (max-height:700px)','(400px < width < 800px)','(width >= 960px)','(max-width:40rem)','(min-device-width:390px)']);
  assert.deepEqual(result.breakpoints.map(row=>`${row.axis}:${row.value}`).sort(),['height:700','width:400','width:600','width:800','width:960']);
  assert.equal(result.unsupportedConditions.length,2);
});
test('generates exact neighbours and deduplicates reasons',()=>{
  const result=buildMatrix({common:false,boundaryHeight:768,sizes:[{width:600,height:768}]},['(min-width:600px)','(max-width:600px)']);
  assert.deepEqual(result.cases.map(row=>row.width).sort(),[599,600,601]);
  assert.equal(result.cases.find(row=>row.width===600).reasons.length,2);
});
test('caps work and explicitly records everything deferred',()=>{
  const result=buildMatrix({common:false,maxCases:2,sweep:{widths:[320,324,1],heights:[568,568,1]}});
  assert.equal(result.cases.length,2);assert.equal(result.deferred.length,3);assert.equal(result.candidateCount,5);
});
test('bounds do not silently discard an explicit requested size',()=>{
  assert.throws(()=>buildMatrix({sizes:[{width:200,height:400}]}),/outside/);
  const result=buildMatrix({bounds:{minWidth:390}});
  assert.ok(result.outsideBounds.length>0);assert.ok(result.cases.every(row=>row.width>=390));
});
test('rejects empty, inverted or unbounded sweeps and invalid metadata',()=>{
  assert.throws(()=>buildMatrix({common:false,boundaries:false}),/no viewport/);
  assert.throws(()=>buildMatrix({common:false,sweep:{widths:[320,400,0],heights:[300,500,10]}}),/Invalid/);
  assert.throws(()=>buildMatrix({bounds:{minWidth:1000,maxWidth:320}}),/increasing/);
  assert.throws(()=>buildMatrix({common:false,sizes:[{width:400,height:600,input:'device-guess'}]}),/Invalid/);
  assert.throws(()=>buildMatrix({maxCases:10000}),/maxCases/);
});
