import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {patchExactRidgeTerrain,patchExactRidgeHtml} from './build-exact-ridge.mjs';
const require=createRequire(new URL('../astronotes-terrain.js',import.meta.url)),astro=require('./astronotes-astro.js'),align=require('./astronotes-align.js');
const terrainSource=readFileSync(new URL('../astronotes-terrain.js',import.meta.url),'utf8');
const terrainContext=vm.createContext({require});vm.runInContext(patchExactRidgeTerrain(terrainSource),terrainContext);
const terrain=terrainContext.AstroNotesTerrain,originalTerrain=require('./astronotes-terrain.js');
function exact(a,b,path='value'){
 if(b!==null&&typeof b==='object'){
  assert.deepEqual(Reflect.ownKeys(a),Reflect.ownKeys(b),path+' keys');
  for(const k of Reflect.ownKeys(b))exact(a[k],b[k],path+'.'+String(k));
 }else assert(Object.is(a,b),path+': '+a+' !== '+b);
}
test('prepared Vincenty directions retain every coordinate bit',()=>{
 for(const [lat,lon]of [[35.58386,139.56853],[35.360555,138.727363],[0,0],[-89,179.9],[89,-179.9]])for(const az of [0,1,45,89.9,180,270,359.99]){
  const destination=terrain.prepareRidgeDestination(lat,lon,az);
  for(const distance of [0,.000001,.15,1,18,35.7,120,350,20000])exact(destination(distance),originalTerrain.destination(lat,lon,az,distance));
 }
 assert.throws(()=>patchExactRidgeTerrain(patchExactRidgeTerrain(terrainSource)),/boundary changed/);
});
test('prepared elevation retains exact arithmetic at every height and atmospheric radius',()=>{
 for(const d of [0,.15,1,18,120,350])for(const eye of [-500,0,1.5,20,150,700,3776])for(const k of [1,7/6,4/3]){
  const angle=terrain.prepareRidgeElevation(d,eye,{k});
  for(const h of [-500,0,1.5,50,100,1000,3476,3776,9000])exact(angle(h),astro.targetElevationAngle(d,eye,h,{k}));
 }
});
const rawTerrain=readFileSync(new URL('../src/features/framing/scene/terrain.js',import.meta.url),'utf8');
const start=rawTerrain.indexOf('async function aimLookRidge('),end=rawTerrain.indexOf('  return task;\n}',start)+'  return task;\n}'.length;
const original=rawTerrain.slice(start,end),patched=patchExactRidgeHtml(original);
function ridge(code,{holes=false,fail=false}={}){
 const state={calls:0,destinations:0,preparedDirections:0,angles:0,preparedAngles:0,air:7/6,samples:null};
 const tr={...terrain,destination:(...a)=>{state.destinations++;return originalTerrain.destination(...a);},prepareRidgeDestination:(...a)=>{state.preparedDirections++;return terrain.prepareRidgeDestination(...a);},prepareRidgeElevation:(...a)=>{state.preparedAngles++;return terrain.prepareRidgeElevation(...a);},elevations:async points=>{
  state.calls++;if(fail&&state.calls===1)throw Error('temporary terrain error');
  state.samples=points;
  return points.map((p,i)=>holes&&i%121===0?null:Math.sin(p.latitude*.4)*1000+Math.cos(p.longitude*.8)*2000+600);
 }};
 const c=vm.createContext({AstroNotesTerrain:tr,AstroNotesAlign:align,AstroNotesAtmosphere:{targetK:()=>state.air},aimAirAngle:(...a)=>{state.angles++;return astro.targetElevationAngle(...a,{k:state.air});}});
 vm.runInContext('const aimRidgeCache=new Map(),aimRidgePending=new Map();\n'+code+'\nglobalThis.run=aimLookRidge;globalThis.cache=aimRidgeCache;',c);
 return {state,run:c.run,cache:c.cache};
}
test('full mountain ridge keeps all 29,161 sample points and exact resulting skyline',async()=>{
 const target=align.targetById('fuji');
 for(const eye of [88.7,237.2]){
  const observer={latitude:35.58386,longitude:139.56853,elevation:87.2,eyeM:eye-87.2},a=ridge(original,{holes:true}),b=ridge(patched,{holes:true});
  exact(await b.run(observer,eye,target,{}),await a.run(observer,eye,target,{}));
  exact(b.state.samples,a.state.samples);assert.equal(a.state.destinations,29161);assert.equal(b.state.preparedDirections,241);assert.equal(b.state.preparedAngles,121);
  assert.equal(b.state.destinations,0);assert(a.state.angles>28000);assert(b.state.angles<10);
  await b.run(observer,eye,target,{});assert.equal(b.state.calls,1,'exact cached ridge is reused');
 }
 assert.throws(()=>patchExactRidgeHtml(patched),/boundary changed/);
});
test('failed terrain retries and simultaneous identical ridge jobs still join',async()=>{
 const fixture=ridge(patched,{fail:true}),obs={latitude:35.58386,longitude:139.56853,elevation:87.2},target=align.targetById('fuji');
 assert.equal(await fixture.run(obs,88.7,target,{}),null);assert.equal(fixture.cache.size,0);
 const [a,b]=await Promise.all([fixture.run(obs,88.7,target,{}),fixture.run(obs,88.7,target,{})]);
 assert.equal(a,b);assert.equal(fixture.state.calls,2);
 fixture.state.air=1;await fixture.run(obs,88.7,target,{});assert.equal(fixture.state.calls,3,'air radius invalidates old skyline');
});
test('bounded ridge LRU retains the recent recorded set without unbounded growth',async()=>{
 const fixture=ridge(patched),target=align.targetById('fuji'),obs={latitude:35.58386,longitude:139.56853,elevation:87.2};
 // Populate compact fixture entries, then exercise the real insertion/eviction path once.
 for(let i=0;i<256;i++)fixture.cache.set('fixture-'+i,[]);
 await fixture.run(obs,88.7,target,{});assert.equal(fixture.cache.size,256);assert(!fixture.cache.has('fixture-0'));
});
test('174 point mountains across both bodies survive dense shape samples and invalidate by inputs',async()=>{
 const runtime=readFileSync(new URL('./record-search-runtime.js',import.meta.url),'utf8');
 let calls=0,failed=false;const c=vm.createContext({performance:{now:()=>0},MessageChannel:class{constructor(){this.port1={};this.port2={postMessage(){}};}},AstroNotesAlign:{},AstroNotesShooting:{},AstroNotesBodies:{},recordHeightSolver:x=>x,aimIsMountain:()=>true,aimShootingView:async()=>{calls++;if(failed){failed=false;throw Error('retry');}return ()=>[];}});
 vm.runInContext(runtime+'\nglobalThis.make=recordSolverFor;',c);
 const session={mountains:new Map(),shapeMountains:new Map(),terrain:new Map()},point=c.make(session,'discovery',false),shape=c.make(session,'discovery',true),target=align.targetById('fuji');
 const plan=body=>({target,body,partId:null,matchMode:'overlap'}),observer=i=>({latitude:35+i*.0001,longitude:139,elevation:10,eyeM:1.5});
 for(const body of ['sun','moon'])for(let i=0;i<174;i++)await point.viewFor(observer(i),plan(body));
 assert.equal(calls,348);assert.equal(session.mountains.size,348);
 for(let i=0;i<200;i++)await shape.viewFor(observer(i+1000),plan('sun'));
 assert.equal(session.shapeMountains.size,96);assert.equal(session.mountains.size,348);
 for(const body of ['sun','moon'])for(let i=0;i<174;i++)await point.viewFor(observer(i),plan(body));
 assert.equal(calls,548,'next day reuses the complete registered-point set');
 await point.viewFor({...observer(0),eyeM:20},plan('sun'));assert.equal(calls,549);
 failed=true;await assert.rejects(point.viewFor(observer(999),plan('sun')),/retry/);await point.viewFor(observer(999),plan('sun'));assert.equal(calls,551);
 for(let i=0;i<100;i++)await point.viewFor(observer(i+2000),plan('sun'));assert.equal(session.mountains.size,384);
});
test('an evicted mountain promise cannot remove its newer cached replacement on failure',async()=>{
 const runtime=readFileSync(new URL('./record-search-runtime.js',import.meta.url),'utf8');
 for(const shaped of [false,true]){
  let calls=0,rejectOld;
  const c=vm.createContext({performance:{now:()=>0},MessageChannel:class{constructor(){this.port1={};this.port2={postMessage(){}};}},AstroNotesAlign:{},AstroNotesShooting:{},AstroNotesBodies:{},recordHeightSolver:x=>x,aimIsMountain:()=>true,aimShootingView:()=>{calls++;return calls===1?new Promise((_,reject)=>{rejectOld=reject;}):Promise.resolve(()=>[]);}});
  vm.runInContext(runtime+'\nglobalThis.make=recordSolverFor;',c);
  const session={mountains:new Map(),shapeMountains:new Map(),terrain:new Map()},solver=c.make(session,'discovery',shaped),views=shaped?session.shapeMountains:session.mountains,limit=shaped?96:384;
  const plan={target:align.targetById('fuji'),body:'sun',partId:null,matchMode:'overlap'},observer=i=>({latitude:35+i*.0001,longitude:139,elevation:10,eyeM:1.5});
  const old=solver.viewFor(observer(0),plan),failure=assert.rejects(old,/evicted request failed/);
  for(let i=1;i<=limit;i++)await solver.viewFor(observer(i),plan);
  assert.equal(views.size,limit);assert(![...views.values()].includes(old));
  const replacement=solver.viewFor(observer(0),plan);await replacement;
  rejectOld(Error('evicted request failed'));await failure;
  assert.equal(solver.viewFor(observer(0),plan),replacement,'old failure must preserve the new value');
  assert.equal(calls,limit+2);assert.equal(views.size,limit);
 }
});
