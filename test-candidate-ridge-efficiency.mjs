// Offline comparisons against the prior linear ridge selection. Neither
// variant changes the surface samples, memo lifetime or solve budget.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire,Module} from 'node:module';
const require=createRequire(import.meta.url),A=require('./astronotes-align.js'),B=require('./astronotes-bodies.js'),G=require('./astronotes-terrain.js');
const file=new URL('./src/features/candidates/composition.js',import.meta.url).pathname,source=fs.readFileSync(file,'utf8');
function linear(points,relative,bin){
 let visible=null,closest=null;
 for(const p of points){if(!closest||Math.abs(p.relative-relative)<Math.abs(closest.relative-relative))closest=p;if(Math.abs(p.relative-relative)<=bin&&(!visible||p.geometry.angle>visible.geometry.angle))visible=p;}
 return visible||closest;
}
// The pre-lazy implementation is deliberately kept as an independent oracle:
// every raw vertex takes the public geometryFrom path before any lookup.
const eagerRidge=String.raw`function ridgeGeometry(observer,target,align){
 const raw=target.rim?.points||align.rimPoints?.(target.rim);if(!Array.isArray(raw)||!raw.length)return null;
 const center=Geo().inverse(observer.latitude,observer.longitude,target.rim.latitude??target.latitude,target.rim.longitude??target.longitude),difference=(a,b)=>((a-b+540)%360)-180;
 const points=raw.filter(p=>[p.latitude,p.longitude,p.m??p.heightM].every(Number.isFinite)).map(p=>{const anchor={latitude:p.latitude,longitude:p.longitude,heightM:p.m??p.heightM},geometry=align.geometryFrom(observer,{...target,...anchor,rim:null,parts:[{id:'ridge',m:anchor.heightM}]},{heightM:anchor.heightM,eyeM:observer.eyeM??1.5});return {anchor,geometry,relative:difference(geometry.azimuth,center.azimuth)};}).filter(p=>Number.isFinite(p.geometry?.angle)).sort((a,b)=>a.relative-b.relative);
 if(!points.length)return null;
 const bin=Math.atan(.015/Math.max(.001,center.km))/rad;
 return {points,at:azimuth=>ridgeAt(points,difference(azimuth,center.azimuth),bin)};
}`;
function load({legacy=false}={}){
 let body=source;
 body=body.replace("'use strict';","'use strict';let __certificateHits=0;").replace('return certifiedRow;','__certificateHits++;return certifiedRow;');
 if(legacy){const from=body.indexOf('function ridgeAt('),to=body.indexOf('\nfunction ridgeGeometry(',from);assert(from>=0&&to>from);body=body.slice(0,from)+'const ridgeAt='+linear.toString()+';'+body.slice(to);}
 if(legacy){const from=body.indexOf('function ridgeGeometry('),to=body.indexOf('\nfunction standingDomain(',from);assert(from>=0&&to>from);body=body.slice(0,from)+eagerRidge+body.slice(to);}
 body=body.replace('return {valid,','return {localCertificateHits:()=>__certificateHits,certifyRidgeRange,ridgeAt,ridgeGeometry,prepareRidge,surfaceInverse,timeRange,valid,');
 const mod=new Module(file);mod.filename=file;mod.paths=Module._nodeModulePaths(path.dirname(file));mod._compile(body,file);return mod.exports;
}
const current=load(),legacy=load({legacy:true}),target=A.targetById('fuji'),at=Date.parse('2026-11-21T16:17:00+09:00');
const plan={target,body:'moon',at,partId:'summit',limb:'center',matchMode:'limb',profile:'summit-contact',timeSpec:{kind:'day',at,timezone:'Asia/Tokyo'}};
const seed={latitude:35.35458796073944,longitude:139.07286016122475,groundM:30,elevation:30,eyeM:1.5,surfaceAglM:0,standingSurfaceKnown:true};
const end=G.destination(seed.latitude,seed.longitude,90,.3),line=[[seed.longitude,seed.latitude],[end.longitude,end.latitude]],point={...seed,surfaceGeometry:{lines:[line],polygons:[]}};
const deps={align:A,bodies:B,groundAt:()=>30,standingAt:()=>true,yieldTask:async()=>{}};
// Exercise the row store independently of geometry, using a fixed scalar
// reader prefix and one exact query Number (including signed zero).
function rowMemo(prepared){const memo=prepared.memo,reader=memo.reader([1]);return {get:values=>reader.get(reader.key(values[0]),values[0])?.row??null,put:(values,row)=>reader.put(reader.key(values[0]),row,null),invalidate:()=>memo.invalidate()};}

test('ridge lookup preserves first ties, exact bin edges and non-finite fallback',()=>{
 const cases=[[],[-2,-1,-1,-1,0,0,1,2],[-180,-179.9,0,179.9,180],[NaN,-2,0,2],[0,NaN,1]];
 for(const values of cases){const points=values.map((relative,i)=>({relative,geometry:{angle:i%3},i})),ordered=values.every(Number.isFinite);
  for(const relative of [-Infinity,-181,-2,-1,-.5,0,.5,1,2,181,Infinity,NaN])for(const bin of [-1,0,Number.EPSILON,.5,1,Infinity,NaN])assert.strictEqual(current.ridgeAt(points,relative,bin,ordered),linear(points,relative,bin));
 }
 const points=[{relative:0,geometry:{angle:5}},{relative:0,geometry:{angle:5}},{relative:2,geometry:{angle:5}}];
 assert.strictEqual(current.ridgeAt(points,1,0),points[0]);assert.strictEqual(current.ridgeAt(points,0,1),points[0]);
});

test('real Fuji ridge lookup preserves every queried anchor across bearings, heights and azimuth wrap',()=>{
 for(const bearing of [0,89.9,180,270])for(const km of [1,30,100]){
  const observer={...G.destination(target.latitude,target.longitude,bearing,km),elevation:bearing+20,eyeM:1.5},r=current.ridgeGeometry(observer,target,A),old=legacy.ridgeGeometry(observer,target,A);
  const centre=G.inverse(observer.latitude,observer.longitude,target.rim.latitude,target.rim.longitude),bin=Math.atan(.015/Math.max(.001,centre.km))*180/Math.PI;
  const angles=[-720,0,360,720];
  for(let i=0;i<old.points.length;i+=13)for(const delta of [0,bin,-bin,bin+1e-12,-bin-1e-12])angles.push(centre.azimuth+old.points[i].relative+delta);
  for(const angle of angles)assert.deepEqual(r.at(angle),old.at(angle));
  // Reading .points or querying NaN deliberately materializes the lazy tree.
  // Do both only after the finite queries have exercised its actual pruning.
  assert.deepEqual(r.points,old.points);
  for(const angle of [NaN,Infinity,-Infinity])assert.deepEqual(current.ridgeGeometry(observer,target,A).at(angle),old.at(angle));
 }
});

test('lazy ridge evaluates a strict subset of canonical Fuji geometry before materialization',()=>{
 let reads=0;const align=Object.create(A);
 align.prepareRidgeObserver=function(observer){const reader=A.prepareRidgeObserver.call(this,observer);return reader&&{...reader,geometry:anchor=>{reads++;return reader.geometry(anchor);}};};
 const observer={...G.destination(target.latitude,target.longitude,90,30),elevation:30,eyeM:1.5},centre=G.inverse(observer.latitude,observer.longitude,target.rim.latitude,target.rim.longitude);
 const ridge=current.ridgeGeometry(observer,target,align),old=legacy.ridgeGeometry(observer,target,A);
 assert.deepEqual(ridge.at(centre.azimuth),old.at(centre.azimuth));
 assert(reads>0&&reads<old.points.length/2,`lazy geometry reads ${reads}/${old.points.length}`);
 const before=reads;assert.deepEqual(ridge.at(centre.azimuth),old.at(centre.azimuth));assert.equal(reads,before,'same observer/query reuses only its local exact rows');
 assert.deepEqual(ridge.points,old.points);assert.equal(reads,old.points.length,'the diagnostic getter still materializes all exact rows');
});

test('lazy ridge preserves unwrapped relative boundaries, bin edges, duplicates and nearest choices',()=>{
 const observer={latitude:35,longitude:139,elevation:30,eyeM:1.5};
 const bearings=[0,0,.001,1,2,89.9,90,179.99,180,180.01,270,358,359,359.999];
 const rim={latitude:35.5,longitude:139,points:bearings.map((az,i)=>({...G.destination(observer.latitude,observer.longitude,az,30),m:2000+(i%3)*200}))};
 rim.points.push({...rim.points[1]},{latitude:NaN,longitude:139,m:3000},{latitude:35,longitude:139,m:NaN});
 const t={...target,rim},old=legacy.ridgeGeometry(observer,t,A),ridge=current.ridgeGeometry(observer,t,A),center=G.inverse(observer.latitude,observer.longitude,rim.latitude,rim.longitude),bin=Math.atan(.015/center.km)*180/Math.PI;
 const queries=[-720,-180,-179.999,0,179.999,180,360,720];
 for(const p of old.points)for(const d of [0,bin,-bin,bin+1e-12,-bin-1e-12])queries.push(center.azimuth+p.relative+d);
 for(let i=0;i<old.points.length-1;i++)queries.push(center.azimuth+(old.points[i].relative+old.points[i+1].relative)/2);
 for(const q of queries)assert.deepEqual(ridge.at(q),old.at(q));
 assert.deepEqual(ridge.points,old.points);
});

test('ridge preparations do not retain mutated raw values, observer or refraction settings',()=>{
 const Air=require('./astronotes-atmosphere.js'),observer={...seed},t={...target,rim:{...target.rim,points:A.rimPoints(target.rim).map(p=>({...p}))}};
 Air.configure('standard');
 try{
  const prepared=current.prepareRidge(t,A,observer),first=current.ridgeGeometry(observer,t,A,prepared),oldFirst=legacy.ridgeGeometry(observer,t,A);
  const angle=G.inverse(observer.latitude,observer.longitude,t.rim.latitude,t.rim.longitude).azimuth;
  // Eager geometry captured these settings synchronously; late lazy queries
  // must not pick up a different eye height or k for unvisited vertices.
  observer.elevation+=20;observer.eyeM+=3;Air.configure('none');
  assert.deepEqual(first.at(angle),oldFirst.at(angle));
  t.rim.points[0].m+=100;t.rim.latitude+=.001;
  assert.deepEqual(current.ridgeGeometry(observer,t,A,prepared).points,legacy.ridgeGeometry(observer,t,A).points);
  assert.deepEqual(current.ridgeGeometry(observer,t,A).at(angle),legacy.ridgeGeometry(observer,t,A).at(angle));
  t.rim.points.push({...t.rim.points[1],m:4500});
  assert.deepEqual(current.ridgeGeometry(observer,t,A,prepared).points,legacy.ridgeGeometry(observer,t,A).points);
 }finally{Air.configure('standard');}
});

test('custom geometry and rim providers retain eager behavior and raw-read count',()=>{
 let calls=0;const custom={...A,prepareRidgeObserver:undefined,rimPoints(rim){calls++;return A.rimPoints(rim);}},observer={...seed};
 const ridge=current.ridgeGeometry(observer,target,custom);assert.equal(calls,1);assert.deepEqual(ridge.points,legacy.ridgeGeometry(observer,target,A).points);
 const dynamic={...A,geometryFrom(...args){const row=A.geometryFrom(...args);return row&&{...row,angle:row.angle+.01};}};
 assert.deepEqual(current.ridgeGeometry(observer,target,dynamic).points,legacy.ridgeGeometry(observer,target,dynamic).points);
 for(const origin of [{...observer,latitude:0},{...observer,latitude:89},{...observer,latitude:target.rim.latitude,longitude:target.rim.longitude}])assert.deepEqual(current.ridgeGeometry(origin,target,A).points,legacy.ridgeGeometry(origin,target,A).points);
});

test('ridge search retains every event field, solve count and partial status',async()=>{
 for(const timeSpec of [plan.timeSpec,{kind:'instant',at:1795192803836.6453},{kind:'window',start:1795192500000,end:1795193100000}])for(const limb of ['center','upper','lower']){
  const input={...plan,timeSpec,limb};
  assert.deepEqual(await current.opportunities(input,point,deps),await legacy.opportunities(input,point,deps));
 }
 // A polygon still uses the supplied surface and the original distance constraint.
 const p={...point,surfaceGeometry:{lines:[],polygons:[[[[seed.longitude-.001,seed.latitude-.001],[seed.longitude+.001,seed.latitude-.001],[seed.longitude+.001,seed.latitude+.001],[seed.longitude-.001,seed.latitude+.001],[seed.longitude-.001,seed.latitude-.001]]]]}};
 assert.deepEqual(await current.opportunities({...plan,timeSpec:{kind:'instant',at}},p,deps),await legacy.opportunities({...plan,timeSpec:{kind:'instant',at}},p,deps));
});

test('ridge search retains body reads and has no state across calls',async()=>{
 const run=async engine=>{let reads=0;const bodies={...B,state(...args){reads++;return B.state(...args);}};const result=await engine.opportunities(plan,point,{...deps,bodies});return {reads,result};};
 const before=await run(legacy),after=await run(current);assert.deepEqual(after.result,before.result);assert.equal(after.reads,before.reads,'optimization keeps every celestial sample');
 assert.deepEqual(await run(current),after,'another call evaluates fresh conditions');
 const higher={...point,elevation:130,groundM:130,surfaceAglM:100};
 assert.deepEqual(await current.opportunities(plan,higher,deps),await legacy.opportunities(plan,higher,deps));
});

test('budget exhaustion, missing ground and cancellation retain the prior contracts',async()=>{
 for(const budget of [1,96,600,650])assert.deepEqual(await current.opportunities(plan,point,{...deps,budget}),await legacy.opportunities(plan,point,{...deps,budget}));
 const unavailable={...deps,groundAt:()=>null};assert.deepEqual(await current.opportunities(plan,point,unavailable),await legacy.opportunities(plan,point,unavailable));
 const cancelled=async engine=>{let yields=0;return {result:await engine.opportunities(plan,point,{...deps,isCurrent:()=>yields<9,yieldTask:async()=>{yields++;}}),yields};};
 assert.deepEqual(await cancelled(current),await cancelled(legacy));
});

test('cancellation after lazy queries preserves both point and surface solve results',async()=>{
 for(const surface of [false,true]){
  let bounds=0,reads=0,yields=0,alive=true;const align=Object.create(A);
  align.prepareRidgeObserver=function(observer){const reader=A.prepareRidgeObserver.call(this,observer);return reader&&{...reader,
   bearingIntervals:region=>{bounds++;return reader.bearingIntervals(region);},geometry:anchor=>{reads++;return reader.geometry(anchor);}};};
  const run=(engine,options)=>surface?engine.surfaceInverse(plan,point,engine.timeRange(plan),[],{...deps,budget:600,...options}):engine.opportunities(plan,point,{...deps,...options});
  const actual=await run(current,{align,isCurrent:()=>alive,yieldTask:async()=>{yields++;if(bounds>0)alive=false;}});
  assert(bounds>0&&reads>0,`${surface?'surface':'point'} cancellation follows an actual lazy query`);
  assert(yields>=2);assert.equal(alive,false);
  const stoppedAt=yields;let oldYields=0;
  const expected=await run(legacy,{isCurrent:()=>oldYields<stoppedAt,yieldTask:async()=>{oldYields++;}});
  assert.equal(oldYields,stoppedAt);assert.deepEqual(actual,expected);
  assert.equal(surface?actual.cancelled:actual.reason==='cancelled',true);
 }
});

test('weather changes during a yielded solve and replaced providers remain observable',async()=>{
 const previous=globalThis.AstroNotesAtmosphere;
 try{
  const run=async engine=>{let revision=0,yields=0;globalThis.AstroNotesAtmosphere={dataKey:()=>revision,targetK:()=>7/6};
   const state=(...args)=>{const st=B.state(...args);return {...st,apparentAltitude:st.apparentAltitude+revision*.001};},bodies={...B,state};
   return engine.opportunities(plan,point,{...deps,bodies,yieldTask:async()=>{if(++yields===15)revision=1;if(yields===22)bodies.state=(...args)=>{const st=state(...args);return {...st,apparentAltitude:st.apparentAltitude+.001};};}});
  };
  assert.deepEqual(await run(current),await run(legacy));
 }finally{if(previous===undefined)delete globalThis.AstroNotesAtmosphere;else globalThis.AstroNotesAtmosphere=previous;}
});

test('request row memo reuses exact geometry and trees without sharing returned objects',()=>{
 const context=current.createRidgeContext(),owner=context.forOwner(),observer={...seed},angle=G.inverse(seed.latitude,seed.longitude,target.rim.latitude,target.rim.longitude).azimuth;
 const prepared=owner.prepare(target,A,observer),first=current.ridgeGeometry(observer,target,A,prepared).at(angle),expected=legacy.ridgeGeometry(observer,target,A).at(angle);
 assert.deepEqual(first,expected);assert.equal(context.stats().size,1);
 first.anchor.heightM+=100;first.geometry.angle+=100;
 const again=owner.prepare(target,A,observer),second=current.ridgeGeometry(observer,target,A,again).at(angle);
 assert.strictEqual(again.tree,prepared.tree);assert.equal(context.stats().builds,1);assert.equal(context.stats().hits,1);assert.deepEqual(second,expected);
 second.anchor.latitude=0;second.geometry.topM=0;
 assert.deepEqual(current.ridgeGeometry(observer,target,A,owner.prepare(target,A,observer)).at(angle),expected);
 const other={...observer,longitude:observer.longitude+1e-10};assert.equal(other.longitude.toFixed(8),observer.longitude.toFixed(8));
 const misses=context.stats().misses;assert.deepEqual(current.ridgeGeometry(other,target,A,owner.prepare(target,A,other)).at(angle),legacy.ridgeGeometry(other,target,A).at(angle));assert.equal(context.stats().misses,misses+1,'no new coordinate rounding crosses solves');
});

test('request row memo bounds LRU, distinguishes signed zero and excludes unknown values',()=>{
 const context=current.createRidgeContext({capacity:2}),memo=rowMemo(context.forOwner().prepare(target,A,seed));
 const row=legacy.ridgeGeometry(seed,target,A).at(270),positive=[0],negative=[-0];
 memo.put(positive,row);memo.put(negative,{...row,relative:row.relative+1});assert.equal(context.stats().size,2);
 assert.equal(memo.get(positive).relative,row.relative);memo.put([1],row);
 assert.equal(memo.get(negative),null,'access updates LRU');assert(memo.get(positive));
 const size=context.stats().size;memo.put([NaN],row);memo.put([Infinity],row);memo.put([2],null);memo.put([2],{...row,geometry:{...row.geometry,angle:NaN}});assert.equal(context.stats().size,size);
 const full=current.createRidgeContext({capacity:99999}),all=rowMemo(full.forOwner().prepare(target,A,seed));
 for(let i=0;i<8200;i++)all.put([i],row);assert.equal(full.stats().capacity,8192);assert.equal(full.stats().size,8192);assert.equal(all.get([0]),null);assert(all.get([8199]));
});

test('each observer, query, target centre and provider dependency isolates shared rows',()=>{
 const context=current.createRidgeContext(),owner=context.forOwner(),t={...target,rim:{...target.rim,points:A.rimPoints(target.rim).map(p=>({...p}))}},align=Object.create(A),angle=270;
 const query=(observer=seed,q=angle)=>{const prepared=owner.prepare(t,align,observer);return current.ridgeGeometry(observer,t,align,prepared).at(q);};
 for(const observer of [seed,{...seed,elevation:seed.elevation+1},{...seed,eyeM:seed.eyeM+1}]){const misses=context.stats().misses;assert.deepEqual(query(observer),legacy.ridgeGeometry(observer,t,A).at(angle));assert.equal(context.stats().misses,misses+1);}
 const before=context.stats();assert.deepEqual(query(seed,angle+1e-10),legacy.ridgeGeometry(seed,t,A).at(angle+1e-10));assert.equal(context.stats().hits,before.hits,'a changed query is never rounded into the exact key');assert.equal(context.stats().rangeHits,before.rangeHits+1,'only the certified interval permits this distinct query');
 for(const mutate of [()=>{t.rim.latitude+=.001;},()=>{t.rim.points[0].m+=1;}]){mutate();const builds=context.stats().builds;assert.deepEqual(query(),legacy.ridgeGeometry(seed,t,A).at(angle));assert.equal(context.stats().builds,builds+1);assert.equal(context.stats().size,1);}
 align.geometryFrom=(...args)=>A.geometryFrom(...args);assert.equal(owner.prepare(t,align,seed),null);assert.equal(context.stats().size,0);
 delete align.geometryFrom;align.prepareRidgeObserver=function(observer){const reader=A.prepareRidgeObserver.call(this,observer);return reader&&{...reader,cacheKey:'12345'};};
 assert.deepEqual(query(),legacy.ridgeGeometry(seed,t,A).at(angle));assert.equal(context.stats().size,0,'an unknown cache capability is not shared');
});

test('raw epochs, captured refraction and retired owners cannot revive old rows',()=>{
 const Air=require('./astronotes-atmosphere.js'),context=current.createRidgeContext(),t={...target,rim:{...target.rim,points:A.rimPoints(target.rim).map(p=>({...p}))}},observer={...seed};let active=true;
 const owner=context.forOwner(()=>active),angle=G.inverse(seed.latitude,seed.longitude,t.rim.latitude,t.rim.longitude).azimuth;
 Air.configure('standard');
 try{
  const old=owner.prepare(t,A,observer),ridge=current.ridgeGeometry(observer,t,A,old),expected=legacy.ridgeGeometry(observer,t,A);ridge.at(angle);
  Air.configure('none');assert.deepEqual(ridge.at(angle),expected.at(angle),'existing local reader keeps its original k');
  const misses=context.stats().misses;assert.deepEqual(current.ridgeGeometry(observer,t,A,owner.prepare(t,A,observer)).at(angle),legacy.ridgeGeometry(observer,t,A).at(angle));assert.equal(context.stats().misses,misses+1);
  t.rim.points[0].m+=1;t.rim.latitude+=.0001;
  const fresh=owner.prepare(t,A,observer);assert.notStrictEqual(fresh.tree,old.tree);assert.equal(context.stats().size,0);
  rowMemo(old).put([1],expected.at(angle));rowMemo(old).invalidate();assert.equal(context.stats().size,0);
  rowMemo(fresh).put([1],expected.at(angle));assert.equal(context.stats().size,1);
  active=false;rowMemo(fresh).invalidate();rowMemo(fresh).put([2],expected.at(angle));assert.equal(rowMemo(fresh).get([1]),null);assert.equal(context.stats().size,1,'cancelled same-key owner cannot clear current rows');
  context.retire();assert.equal(context.stats().size,0);assert.equal(context.forOwner().prepare(t,A,observer),null);rowMemo(fresh).put([3],expected.at(angle));assert.equal(context.stats().size,0);
 }finally{Air.configure('standard');}
});

test('shared ridge rows keep all six walkway results and body/ground/yield budgets identical',async()=>{
 const points=Array.from({length:6},(_,i)=>({...point,...G.destination(seed.latitude,seed.longitude,90,i*.03)}));
 const run=async(engine,cache)=>{let bodyReads=0,groundReads=0,yields=0;const context=cache?engine.createRidgeContext():null,out=[];
  for(const p of points)out.push(await engine.opportunities(plan,p,{...deps,ridgeContext:context?.forOwner(),bodies:{...B,state(...args){bodyReads++;return B.state(...args);}},groundAt:()=>{groundReads++;return 30;},yieldTask:async()=>{yields++;}}));
  return {out,bodyReads,groundReads,yields,stats:context?.stats()};
 };
 const expected=await run(legacy,false),actual=await run(current,true);assert.deepEqual(actual.out,expected.out);assert.equal(actual.bodyReads,expected.bodyReads);assert.equal(actual.groundReads,expected.groundReads);assert.equal(actual.yields,expected.yields);
 assert(actual.stats.hits>0);assert.equal(actual.stats.builds,1);assert(actual.stats.size<=8192);
});

test('generic evaluator has one request context and clear retires old asynchronous owners',async()=>{
 const previous=globalThis.AstroNotesCandidateComposition,contexts=[],ports=[],pending=[];
 globalThis.AstroNotesCandidateComposition={...current,createRidgeContext(){const c=current.createRidgeContext();contexts.push(c);return c;},async opportunities(p,obs,options){ports.push(options.ridgeContext);return {solutions:[],partial:true,reason:'fixture'};}};
 try{
  const filename=new URL('./src/features/candidates/generic-evaluator.js',import.meta.url).pathname,m=new Module(filename);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));m._compile(fs.readFileSync(filename,'utf8'),filename);
  const model=m.exports.createGeneric({align:A,bodies:B,geo:G,terrain:{at:()=>new Promise(resolve=>pending.push(resolve))},yieldTask:async()=>{}}),p={...point,groundM:undefined};
  const oldA=model.evaluate({...plan,requestKey:'A'},p,null),b=model.evaluate({...plan,requestKey:'B'},p,null),newA=model.evaluate({...plan,requestKey:'A'},p,null);
  assert.equal(contexts.length,3);assert(contexts[0].stats().retired);assert(contexts[1].stats().retired);assert.equal(contexts[2].stats().retired,false);
  pending[0](30);await oldA;assert.equal(ports[0].prepare(target,A,seed),null);assert.equal(contexts[2].stats().retired,false);
  pending[1](30);await b;pending[2](30);await newA;assert(ports[2].prepare(target,A,seed));
  model.clear();assert(contexts[2].stats().retired);assert.equal(ports[2].prepare(target,A,seed),null);
  const direct=model.evaluate(plan,p,null);pending[3](30);await direct;assert.equal(ports[3],null,'unowned callers do not share rows');assert.equal(contexts.length,3);
  delete globalThis.AstroNotesCandidateComposition.createRidgeContext;
  const compatible=model.evaluate({...plan,requestKey:'older-capability'},p,null);pending[4](30);await compatible;assert.equal(ports[4],null,'optional optimization does not become mandatory for injected composition providers');assert.equal(contexts.length,3);
 }finally{if(previous===undefined)delete globalThis.AstroNotesCandidateComposition;else globalThis.AstroNotesCandidateComposition=previous;}
});

test('certified visible and nearest intervals preserve the old selector throughout their interior',()=>{
 const fixtures=[
  {visible:true,q:.2,bin:.4,rows:[[-.5,5],[1,8],[0,5],[-20,30],[10,30]],visited:[0,1,2],frontier:[[[ -21,-19]],[[9,11]]]},
  {visible:false,q:1,bin:.1,rows:[[0,5],[-2,8],[5,30],[8,1]],visited:[0,1],frontier:[[[5,8]]]},
  {visible:false,q:-1,bin:.1,rows:[[0,5],[2,8],[-8,30],[-5,1]],visited:[0,1],frontier:[[[-8,-5]]]},
 ];
 for(const f of fixtures){const rows=f.rows.map(([relative,angle])=>({relative,geometry:{angle}})),ordered=rows.slice().sort((a,b)=>a.relative-b.relative),selected=rows.indexOf(linear(ordered,f.q,f.bin)),certificate=current.certifyRidgeRange(f.q,f.bin,selected,f.visited,i=>rows[i],f.frontier,f.visible);
  assert(certificate);assert(certificate.lo<f.q&&f.q<certificate.hi);
  for(const t of [1e-8,.01,.25,.5,.75,.99,1-1e-8]){const q=certificate.lo+(certificate.hi-certificate.lo)*t;assert.strictEqual(linear(ordered,q,f.bin),rows[selected]);}
 }
});

test('the local certified path answers a distinct azimuth without consulting the shared row store',()=>{
 const ridge=current.ridgeGeometry(seed,target,A),old=legacy.ridgeGeometry(seed,target,A),before=current.localCertificateHits();
 assert.deepEqual(ridge.at(270),old.at(270));assert.deepEqual(ridge.at(270+1e-10),old.at(270+1e-10));
 assert(current.localCertificateHits()>before,'actual local certificate branch is executed without a request context');
});

test('certificates reject unknown, crossing, wrap and the generic binary64 distant-tie counterexample',()=>{
 // These are direct relative doubles, not a claim that the production +540/%360
 // normalization generates this near-coincident pair. Refuse the general hazard.
 const rows=[{relative:.01-1e-14,geometry:{angle:0}},{relative:.01,geometry:{angle:0}}],q=.011,bin=.0001;
 assert.strictEqual(linear(rows,q,bin),rows[1]);assert.strictEqual(linear(rows,179,bin),rows[0]);
 assert.equal(current.certifyRidgeRange(q,bin,1,[0,1],i=>rows[i],[],false),null);
 const normal=[{relative:0,geometry:{angle:0}},{relative:2,geometry:{angle:0}}],row=i=>normal[i];
 for(const frontier of [[null],[[[-1,1]]],[[[-1,-1e-10]]]])assert.equal(current.certifyRidgeRange(1,.1,0,[0,1],row,frontier,false),null);
 for(const az of [-Infinity,-720,-180,180,720,Infinity,NaN])assert.equal(current.certifyRidgeRange(az,.1,0,[0,1],row,[],false),null);
 const tied=[{relative:0,geometry:{angle:1}},{relative:0,geometry:{angle:1}}];
 assert(current.certifyRidgeRange(1,.1,0,[0,1],i=>tied[i],[],false));assert.equal(current.certifyRidgeRange(1,.1,1,[0,1],i=>tied[i],[],false),null);
});

test('shared range entries keep strict endpoints, detached rows, latest references and bounded lifetime',()=>{
 const context=current.createRidgeContext({capacity:2}),prepared=context.forOwner().prepare(target,A,seed),a=prepared.memo.reader([1]),b=prepared.memo.reader([2]),row=legacy.ridgeGeometry(seed,target,A).at(270);
 a.put(a.key(1),row,{lo:0,hi:10});const hit=a.get(a.key(2),2);assert.deepEqual(hit.row,row);assert.equal(context.stats().rangeHits,1);
 hit.row.geometry.angle+=100;hit.row.anchor.heightM+=100;hit.certificate.lo=-100;assert.deepEqual(a.get(a.key(3),3).row,row);
 assert.equal(a.get(a.key(0),0),null);assert.equal(a.get(a.key(10),10),null,'certificate endpoints always use exact lookup');
 a.put(a.key(20),row,{lo:20,hi:30});assert.equal(context.stats().rangeRows,1);assert.equal(a.get(a.key(5),5),null,'only the latest range reference is used');assert(a.get(a.key(1),1),'older exact key remains valid');
 b.put(b.key(1),row,{lo:0,hi:10});assert.equal(context.stats().size,2);assert.equal(a.get(a.key(25),25),null,'evicting the current certified entry removes its reference');assert(b.get(b.key(2),2));
 context.retire();assert.equal(context.stats().size,0);assert.equal(context.stats().rangeRows,0);assert.equal(b.get(b.key(2),2),null);
 const full=current.createRidgeContext(),owner=full.forOwner();for(let i=0;i<8200;i++){const reader=owner.prepare(target,A,seed).memo.reader([i]);reader.put(reader.key(1),row,{lo:0,hi:10});}
 assert.equal(full.stats().size,8192);assert.equal(full.stats().rangeRows,8192);full.retire();assert.equal(full.stats().rangeRows,0);
});
