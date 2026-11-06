import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecordHeightPolicy} from './tools/record-height-policy.mjs';
const H=createRecordHeightPolicy();
test('fixed legacy policy stays distinct from optional range and keeps zero height',()=>{assert.deepEqual(H.parse(H.draft({eyeHeightAGL:0,elevation:0})),{eye:0,ground:0,range:null});const p={eyeHeightAGL:1.5,elevation:87.2,eyeHeightRangeAGL:{min:20,max:100}};assert.deepEqual(H.parse(H.draft(p)),{eye:1.5,ground:87.2,range:{min:20,max:100}});assert.equal(p.eyeHeightAGL,1.5);});
test('invalid/empty/reversed/nonfinite height is never coerced to a valid range',()=>{for(const r of [{min:20,max:20},{min:20,max:0},{min:-1,max:20},{min:0,max:701},{min:NaN,max:10}])assert.equal(H.range(r),null);for(const d of [{mode:'range',min:'',max:'100',fixed:'1.5',ground:''},{mode:'fixed',fixed:'',ground:'0'},{mode:'fixed',fixed:'1.5',ground:'9001'}])assert.throws(()=>H.parse(d));assert.equal(H.parse({mode:'fixed',fixed:'1.5',ground:''}).ground,null);});
test('range and elevation changes invalidate the policy stamp without mutating historical height',()=>{const p={latitude:35,longitude:139,elevation:10,eyeHeightAGL:1.5};assert.notEqual(H.key(p),H.key({...p,eyeHeightRangeAGL:{min:20,max:100}}));assert.notEqual(H.key(p),H.key({...p,elevation:11}));assert.equal(p.eyeHeightRangeAGL,undefined);});
