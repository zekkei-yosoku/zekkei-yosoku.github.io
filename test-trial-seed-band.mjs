// 2026-11-26 trial（段階②）: 目標物が中心から探す新しい地点は、逆算の種を重なる範囲（帯）の中だけにする。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
// The overlay sits outside src/, so give it the production siblings it would require.
globalThis.AstroNotesCandidateDiscovery??=require('./src/features/candidates/search.js');
globalThis.AstroNotesCandidateComposition??=require('./src/features/candidates/composition.js');
const {bandSeeds,requestKey}=require('./experiments/moon-map/src/features/candidates/generic-search.js');
const target={latitude:35.7101,longitude:139.8107};
const at=(bearing,km)=>{const r=Math.PI/180;return {latitude:target.latitude+km*Math.cos(bearing*r)/111.195,longitude:target.longitude+km*Math.sin(bearing*r)/(111.195*Math.cos(target.latitude*r))};};
const band={key:'band-1',target,samples:[[240,26,.3],[241,20,.3],[250,3,.3]]};

test('seeds outside the band are dropped; those inside or within their own radius are kept',()=>{
 const inside={...at(240,20),radiusM:250},edge={...at(240,26.2),radiusM:300},far={...at(240,40),radiusM:250},side={...at(200,10),radiusM:250},near={...at(250,1),radiusM:250};
 const out=bandSeeds({seeds:[inside,edge,far,side,near],partial:true,reason:'x'},band);
 assert.deepEqual(out.seeds,[inside,edge,near]);assert.equal(out.bandFiltered,2);assert.equal(out.reason,'x');
});
test('the target width widens the band more near the target than far away',()=>{
 const wide={key:'w',target,samples:[[240,26,.3,.1]]};
 const near={...at(245,1.2),radiusM:10},far={...at(240.8,24),radiusM:10};
 assert.deepEqual(bandSeeds({seeds:[near,far]},wide).seeds,[near],'0.1km half width is ~4.8° at 1.2km but only ~0.24° at 24km');
});
test('without a band the inverse result is returned unchanged',()=>{
 const inverse={seeds:[{...at(10,5),radiusM:250}],partial:true};
 assert.equal(bandSeeds(inverse,null),inverse);assert.equal(bandSeeds(inverse,{key:'b'}),inverse);
});
test('the band is part of the request identity so a band search never reuses an unbanded cache',()=>{
 const plan={owner:'a',body:'moon',target:{id:'skytree'},partId:'__whole',at:Date.parse('2026-12-24T12:00:00+09:00')};
 assert.notEqual(requestKey(plan),requestKey({...plan,seedBand:band}));
 assert.equal(requestKey({...plan,seedBand:band}),requestKey({...plan,seedBand:{...band,samples:[]}}),'only the band key identifies it');
});
