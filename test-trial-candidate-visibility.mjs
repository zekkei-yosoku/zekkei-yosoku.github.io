import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const require=createRequire(import.meta.url);
const geo=require('./astronotes-terrain.js');
const archivedTerrain=require('./src/features/candidates/terrain-model.js');
const archive=JSON.parse(readFileSync(new URL('./data/candidate-terrain.json',import.meta.url),'utf8'));
const composition=require('./src/features/candidates/composition.js');
const candidateModel={...require('./src/features/candidates/model-evaluator.js'),towerQuality:require('./src/features/candidates/tower-quality.js')};
const load=path=>{
 const module={exports:{}};
 const context={module,require,AstroNotesCandidateModel:candidateModel,AstroNotesCandidateComposition:composition};
 vm.runInNewContext(readFileSync(new URL(path,import.meta.url),'utf8'),context);
 return {createGeneric:module.exports.createGeneric,context};
};
const base='./src/features/candidates/generic-evaluator.js';
const trial='./experiments/moon-map/src/features/candidates/generic-evaluator.js';
const observer={latitude:35.68626,longitude:139.73068,elevation:29.4,eyeM:1.5,groundM:19.38,surfaceElevationM:29.4,
 standingSurfaceKnown:true,nonTerrainStructure:true,surfaceId:'hongo-bridge',placeKind:'viewpoint'};
const target={id:'fixture-tower',latitude:35.710063,longitude:139.8107,groundM:2,parts:[{id:'tip',m:637}]};
const inverse=geo.inverse(observer.latitude,observer.longitude,target.latitude,target.longitude);
const distance=inverse.km*1000;
const angle=Math.atan2(target.parts[0].m-observer.elevation-observer.eyeM-distance*distance/(2*6371008.8*(7/6)),distance)*180/Math.PI;
const geometry={azimuth:inverse.azimuth,angle,topM:target.parts[0].m,distanceKm:inverse.km};
const align={geometryFrom:()=>geometry,
 viewProjector:(az,alt)=>(a,h)=>[a-az,h-alt],viewUnprojector:(az,alt)=>(x,y)=>[az+x,alt+y],
 towerOutline:()=>({known:true,polygons:[[[geometry.azimuth-.001,angle-2],[geometry.azimuth+.001,angle-2],[geometry.azimuth+.001,angle],[geometry.azimuth-.001,angle]]]})};
const bodies={definition:id=>({id,limbs:true}),ensure:async()=>{},state:()=>({azimuth:geometry.azimuth,apparentAltitude:angle,angularRadius:.25})};
const heights={trace:async()=>({status:'clear',heights:'plateau'})};
const live={at:async()=>observer.groundM,trace:async()=>({status:'model-clear',checked:1,missing:0})};
const plan={target,body:'moon',timeSpec:{kind:'instant',at:0},partId:'tip'};
const solution={observer,event:{at:0},geometry,anchor:target};

test('archive checks the actual tower-tip slope on the Hongo bridge before the event solver',async()=>{
 const staticTerrain=await archivedTerrain.decode(archive);
 const direct={azimuth:geometry.azimuth,altitude:angle,maxM:distance,refractionK:7/6,endpoint:{...target,elevation:geometry.topM}};
 assert(staticTerrain.trace(observer,{...direct,altitude:0}).hit);
 assert.equal(staticTerrain.trace(observer,direct).hit,null);
 const inputs={align,bodies,geo,terrain:live,heights,staticTerrain,yieldTask:async()=>{}};
 const old=await load(base).createGeneric(inputs).evaluate(plan,observer,{});
 assert.equal(old.reason,'target-line-terrain');
 const changed=await load(trial).createGeneric(inputs).evaluate(plan,observer,{});
 assert.equal(changed.recommend,true);
 assert.equal(changed.event.at,0);
});

test('trial retries unread lines and invalidates visibility results when a target model is replaced',async()=>{
 const {createGeneric,context}=load(trial);
 let reads=0,unknown=true,blocked=false;
 const terrain={...live,trace:async(o,ray)=>{
  if(!ray.endpoint)return live.trace(o,ray);
  reads++;
  if(unknown)return {status:'unknown',missing:1};
  if(blocked)return {status:'blocked',hit:{distanceM:200}};
  return live.trace(o,ray);
 }};
 context.AstroNotesCityModels={[target.id]:{}};
 const model=createGeneric({align,bodies,geo,terrain,heights,yieldTask:async()=>{}});
 assert.equal((await model.visibility(plan,solution)).status,'unknown');
 unknown=false;
 assert.equal((await model.visibility(plan,solution)).status,'model-clear');
 assert.equal((await model.visibility(plan,solution)).status,'model-clear');
 assert.equal(reads,2);
 blocked=true;
 context.AstroNotesCityModels[target.id]={};
 assert.equal((await model.visibility(plan,solution)).status,'blocked');
 assert.equal(reads,3);
 await assert.rejects(model.visibility(plan,solution,{isCurrent:()=>false}),/candidate-cancelled/);
});

test('trial reuses exact building endpoints within one search and retries unread tiles',async()=>{
 for(const reason of ['near-building','height-data-unavailable']){
  const {createGeneric,context}=load(trial);
  let reads=0;
  const model=createGeneric({align,bodies,geo,terrain:live,heights:{trace:async()=>{
   reads++;
   if(reason==='height-data-unavailable'&&reads>1)return {status:'blocked'};
   return {status:'unknown',source:'plateau-grid',reason,hit:{distanceM:30}};
  }},yieldTask:async()=>{}});
  const same={...plan,requestKey:'first request'};
  assert.equal((await model.evaluate(same,observer,{})).status,'unverified');
  const again=await model.evaluate(same,{...observer,surfaceId:'same-standing-point'},{});
  if(reason==='height-data-unavailable'){
   assert.equal(again.status,'model-blocked');
   assert.equal(reads,2);
   continue;
  }
  assert.equal(again.status,'unverified');
  assert.equal(again.nearBuilding,true);
  assert.equal(reads,1);
  context.AstroNotesCityModels={[target.id]:{}};
  await model.evaluate(same,observer,{});
  assert.equal(reads,2,'a replacement model must be read again');
  await model.evaluate({...same,requestKey:'second request'},observer,{});
  assert.equal(reads,3,'cache entries are limited to one search request');
 }
});
