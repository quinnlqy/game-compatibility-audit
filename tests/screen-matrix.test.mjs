import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMatrix,extractBreakpoints,describeSample,SCREEN_GROUPS} from '../skills/game-compatibility-audit/scripts/screen-matrix.mjs';

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
test('five Chinese groups classify known presets without guessing unknown devices',()=>{
  const result=buildMatrix();
  const counts=Object.fromEntries(SCREEN_GROUPS.map(group=>[group.id,result.cases.filter(row=>row.group===group.id).length]));
  assert.deepEqual(Object.values(counts),[5,3,5,2,0]);
  assert.ok(result.cases.every(row=>/[\u4e00-\u9fff]/.test(row.label)&&row.displayReasons[0]==='常见尺寸'));
  assert.equal(describeSample({width:812,height:593,input:'mouse',reasons:['explicit']}).group,'boundary');
  assert.equal(describeSample({width:812,height:593,input:'mouse',group:'desktop',reasons:['explicit']}).group,'desktop');
  assert.throws(()=>describeSample({group:'imaginary-model'}),/Unknown screen group/);
});
test('boundary origins stay separate even when dimensions match a tablet preset',()=>{
  const boundary=describeSample({width:1024,height:768,input:'touch',label:'1024×768',reasons:['height breakpoint 768px +0']});
  assert.equal(boundary.group,'boundary');assert.equal(boundary.label,'高度边界样本');
  assert.equal(boundary.displayReasons[0],'高度切换点 768像素（临界值）');
  const explicit=describeSample({width:1024,height:768,input:'touch',reasons:['explicit']});
  assert.equal(explicit.group,'tablet');
});
test('old report labels upgrade without changing measurements or source reasons',()=>{
  const old={id:'320x568-touch-1',width:320,height:568,input:'touch',dpr:1,label:'phone-small',reasons:['common','height breakpoint 568px -1']};
  const updated=describeSample(old);
  for(const key of ['id','width','height','input','dpr'])assert.equal(updated[key],old[key]);
  assert.deepEqual(updated.reasons,old.reasons);assert.equal(updated.groupLabel,'手机竖屏');
  assert.deepEqual(updated.displayReasons,['常见尺寸','高度切换点 568像素（前1像素）']);
});
