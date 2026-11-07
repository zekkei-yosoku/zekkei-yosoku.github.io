import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {registeredDiscoveryMethods} from './tools/build-record-discovery.mjs';
const shooting=()=>{const context=vm.createContext({setTimeout});vm.runInContext(readFileSync('trial/astronotes-shooting.js','utf8'),context);return context.AstroNotesShooting;};
const point=(id,height=1.5)=>({id,name:id,latitude:35.5,longitude:139.5,elevation:87.2,eyeHeightAGL:height});
const record=(id,placeId,height=1.5,target='past-target')=>({id,placeId,target:{key:target},observer:{latitude:35.5,longitude:139.5,elevation:87.2,eyeHeightAGL:height},registration:true,removed:false,result:'seen',createdAt:1,updatedAt:1});
const searchRuntime=readFileSync('tools/record-search-runtime.js','utf8');
const indexRuntime=searchRuntime.slice(searchRuntime.indexOf('const recordSameScope='),searchRuntime.indexOf('function recordBounded('));
function points(favorites,records,allowed=true){
 const c=vm.createContext({auth:{token:'synthetic'},accessState:{generation:0},version:0,toolAllowed:()=>allowed,favorites,load:()=>records,shapeData:()=>({}),when:r=>r.createdAt});
 vm.runInContext('let recordIndexMemo=null;'+indexRuntime+registeredDiscoveryMethods+';globalThis.result=discoveryPoints();',c);
 return JSON.parse(JSON.stringify(c.result));
}
test('all registered targets are eligible, without using the currently selected observer height',()=>{const result=points([point('a',100),point('b')],[record('1','a',4,'unrelated'),record('2','b',1.5,'another')]);assert.equal(result.length,2);assert.equal(result[0].place.standAglM,4);assert.equal(result[0].place.groundManualM,87.2);});
test('identical positions/heights merge, different recorded heights remain distinct',()=>{const result=points([point('a')],[record('1','a'),record('2','a',1.5,'other'),record('3','a',4)]);assert.equal(result.length,2);assert.deepEqual(result.map(r=>r.place.standAglM),[1.5,4]);});
test('latest tombstone removes that registration but preserves another active target',()=>{const removed={...record('2','a'),removed:true,updatedAt:2};assert.equal(points([point('a')],[record('1','a'),removed]).length,0);assert.equal(points([point('a')],[record('1','a'),removed,record('3','a',1.5,'active')]).length,1);});
test('no records, deleted favorites and missing permission do not leak data',()=>{assert.equal(points([point('a')],[]).length,0);assert.equal(points([],[record('1','a')]).length,0);assert.equal(points([point('a')],[record('1','a')],false).length,0);});
test('trial solver includes daytime lunar overlaps but rejects near misses and out-of-day events',async()=>{const api=shooting(),at=Date.parse('2026-11-25T09:00:00+09:00'),plan={at,body:'moon',target:point('target'),partId:'__whole',matchMode:'overlap'};const result=await api.candidates(plan,[{place:point('a'),record:record('1','a')}],{align:{dailyView:()=>[{at,intersects:true,sunAltitude:20},{at:at+1000,intersects:false,sunAltitude:20},{at:at+86400000,intersects:true,sunAltitude:20}]},isMountain:()=>false,observerAt:(p,g)=>({...p,elevation:g,eyeM:p.eyeHeightAGL}),elevationAt:async()=>87.2,ensure:async()=>{}});assert.equal(result.rows.length,1);assert.equal(result.rows[0].event.sunAltitude,20);assert.equal(result.rows[0].assumedObserver.eyeM,1.5);});
test('trial solver invalidates a cancelled run rather than publishing its previous rows',async()=>{const api=shooting();const result=await api.candidates({at:Date.now(),body:'moon',target:point('target')},[{place:point('a')}],{ensure:async()=>{},isCurrent:()=>false});assert.equal(result.cancelled,true);assert.equal(result.rows.length,0);});
