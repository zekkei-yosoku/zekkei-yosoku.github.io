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
function load({legacy=false}={}){
 let body=source;
 if(legacy){const from=body.indexOf('function ridgeAt('),to=body.indexOf('\nfunction ridgeGeometry(',from);assert(from>=0&&to>from);body=body.slice(0,from)+'const ridgeAt='+linear.toString()+';'+body.slice(to);}
 body=body.replace('return {valid,','return {ridgeAt,ridgeGeometry,valid,');
 const mod=new Module(file);mod.filename=file;mod.paths=Module._nodeModulePaths(path.dirname(file));mod._compile(body,file);return mod.exports;
}
const current=load(),legacy=load({legacy:true}),target=A.targetById('fuji'),at=Date.parse('2026-11-21T16:17:00+09:00');
const plan={target,body:'moon',at,partId:'summit',limb:'center',matchMode:'limb',profile:'summit-contact',timeSpec:{kind:'day',at,timezone:'Asia/Tokyo'}};
const seed={latitude:35.35458796073944,longitude:139.07286016122475,groundM:30,elevation:30,eyeM:1.5,surfaceAglM:0,standingSurfaceKnown:true};
const end=G.destination(seed.latitude,seed.longitude,90,.3),line=[[seed.longitude,seed.latitude],[end.longitude,end.latitude]],point={...seed,surfaceGeometry:{lines:[line],polygons:[]}};
const deps={align:A,bodies:B,groundAt:()=>30,standingAt:()=>true,yieldTask:async()=>{}};

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
  assert.deepEqual(r.points,old.points);const centre=G.inverse(observer.latitude,observer.longitude,target.rim.latitude,target.rim.longitude),bin=Math.atan(.015/Math.max(.001,centre.km))*180/Math.PI;
  const angles=[NaN,Infinity,-Infinity,-720,0,360,720];
  for(let i=0;i<r.points.length;i+=13)for(const delta of [0,bin,-bin,bin+1e-12,-bin-1e-12])angles.push(centre.azimuth+r.points[i].relative+delta);
  for(const angle of angles)assert.deepEqual(r.at(angle),old.at(angle));
 }
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
