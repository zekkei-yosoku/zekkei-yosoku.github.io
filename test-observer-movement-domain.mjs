import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
const require=createRequire(import.meta.url),P=require('./src/features/candidates/place-provider.js'),S=require('./astronotes-shooting.js');
const text=fs.readFileSync(new URL('./tools/fixtures/hongo-walkways.json',import.meta.url),'utf8'),seed={latitude:35.70730860834253,longitude:139.75974230531398,name:'本郷'};
test('missing bundled sidewalks are supplemented from real Hongo geometry and reused including the resolved domain',async()=>{
 let reads=0,bundled=0;const p=P({terrain:{groundElevation:()=>{throw Error('no terrain solve');}},places:{elementsIn:async()=>{bundled++;return[];}},
  fetchImpl:async(url,opts)=>{assert.match(url,/api\/0.6\/map.json\?bbox=/);assert.equal(opts.priority,'low');reads++;return{ok:true,text:async()=>text};}});
 const d=await p.nearby(seed);assert(d?.geometry.lines.length>0);assert.equal(d.radiusM,250,'live-only movement stays inside the verified fetch extent');
 assert(P.movementPoint(d,{latitude:35.707412,longitude:139.759744},20));assert.equal(d.kind,'sidewalk');
 assert.equal(await p.nearby(seed),d);assert.equal(reads,1);assert.equal(bundled,1);
 assert.equal(await p.nearby(seed,{isCurrent:()=>false}),null);assert.equal(reads,1);
 await p.nearby(seed,{refresh:true});assert.equal(reads,2,'manual retry refreshes the live context');
});
test('live movement failures are retryable and cancelled readers cannot apply a late surface',async()=>{
 let release,calls=0,current=true;const p=P({terrain:{},places:{elementsIn:async()=>[]},fetchImpl:async()=>{calls++;await new Promise(r=>release=r);return{ok:true,text:async()=>text};}});
 const pending=p.nearby(seed,{isCurrent:()=>current});await new Promise(r=>setTimeout(r,0));current=false;release();assert.equal(await pending,null);
 current=true;assert(await p.nearby(seed));assert.equal(calls,1,'completed public geometry may be reused by a later live reader');
 let fail=true,attempts=0;const a=P({terrain:{},places:{elementsIn:async()=>[]},fetchImpl:async()=>{attempts++;if(fail)throw Error('offline');return{ok:true,text:async()=>text};}});
 await assert.rejects(a.nearby(seed),/offline/);fail=false;assert(await a.nearby(seed));assert.equal(attempts,2);
 const incomplete=P({terrain:{},places:{elementsIn:async()=>[]},fetchImpl:async()=>({ok:true,text:async()=>'{"error":"unavailable"}'})});
 await assert.rejects(incomplete.nearby(seed),/incomplete/);
 const timeout=P({terrain:{},timeoutMs:5,places:{elementsIn:async()=>[]},fetchImpl:(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}))});
 await assert.rejects(timeout.nearby(seed),/aborted/,'movement reads share the configured timeout and release failed entries');
});
test('recorded shape follows the source id at solved positions, while unknown/stale/off-shape rows never inherit it',()=>{
 const source=fs.readFileSync(new URL('./astronotes-myplaces.js',import.meta.url),'utf8'),fragment=source.slice(source.indexOf('function shapeFor('),source.indexOf('function drawShape('));
 const favorite={id:'line',latitude:35,longitude:139},shape={type:'line',vertices:[{latitude:35,longitude:139},{latitude:35.01,longitude:139}]};
 const fn=Function('favorites','shapeData','AstroNotesShooting',fragment+';return withShape;')([favorite],()=>({line:{...favorite,shape}}),S);
 const point={latitude:35.005,longitude:139,sourcePlaceId:'line'};assert.deepEqual(fn(point).shape,shape);assert.equal(point.shape,undefined);
 assert.equal(fn({...point,longitude:139.01}).shape,undefined);assert.equal(fn({...point,sourcePlaceId:'missing'}).shape,undefined);
 assert.equal(fn({...favorite,latitude:36}).shape,undefined);
});
