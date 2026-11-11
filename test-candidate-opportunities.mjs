import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const C=require('./src/features/candidates/composition.js');
const A=require('./astronotes-align.js'),B=require('./astronotes-bodies.js'),G=require('./astronotes-terrain.js');
const target={id:'my-building',latitude:35.01,longitude:139,groundM:0,parts:[{id:'tip',m:100}]};
const point={latitude:35,longitude:139,elevation:0,eyeM:1.5,surfaceId:'park-surface',sourceId:'official-area',standingSurfaceKnown:true};
const align={geometryFrom:()=>({azimuth:0,angle:10,topM:100,distanceKm:1}),viewProjector:(az,alt)=>(a,h)=>[a-az,h-alt]};
const fixed=at=>({kind:'instant',at});
const plan={target,body:'moon',at:0,partId:'tip',timeSpec:fixed(0)};
function fakeBodies(position){return {definition:id=>B.definition(id),nearAngle:id=>B.nearAngle(id),state:(id,t,o)=>({azimuth:0,apparentAltitude:10,angularRadius:id==='sirius'?0:id==='moon'||id==='sun'?.25:.001,...position(id,t,o)})};}
const dependencies=bodies=>({align,bodies,yieldTask:async()=>{}});

test('day UTC boundaries honor JST, explicit date, DST, invalid dates and fixed time zero',()=>{
 const start=Date.parse('2026-11-05T00:00:00+09:00'),r=C.timeRange({at:start+12345});assert.equal(r.start,start);assert.equal(r.end,start+86400000-1);
 const dst=C.timeRange({timeSpec:{kind:'day',date:'2026-03-08',timezone:'America/New_York'}});assert.equal(dst.end-dst.start+1,23*3600000);
 assert.deepEqual(C.timeRange({timeSpec:fixed(0)}),{kind:'instant',start:0,end:0});
 assert.equal(C.timeRange({timeSpec:{kind:'day',date:'2026-02-30'}}),null);
 assert.equal(C.timeRange({timeSpec:{kind:'day',date:'2026-11-05',timezone:'invalid-zone'}}),null);
 assert.equal(C.timeRange({timeSpec:{kind:'window',start:10,end:1}}),null);
});

test('fixed time never moves to the later exact alignment and preserves standing metadata',async()=>{
 const bodies=fakeBodies((id,t)=>({azimuth:.6-t/100000}));
 const r=await C.opportunities(plan,point,dependencies(bodies));assert.equal(r.solutions.length,1);assert.equal(r.solutions[0].event.at,0);assert.equal(r.partial,false);assert.equal(r.solutions[0].event.relation,'near');
 assert.equal(r.solutions[0].observer.surfaceId,'park-surface');assert.equal(r.solutions[0].observer.sourceId,'official-area');assert.equal(r.solutions[0].observer.standingSurfaceKnown,true);
 assert.equal(r.solutions[0].event.visibility,'unknown');
 const miss=await C.opportunities(plan,point,dependencies(fakeBodies((id,t)=>({azimuth:2-t/100000}))));assert.equal(miss.solutions.length,0);assert.equal(miss.reason,'no-opportunity-at-fixed-time');
});

test('Moon near width is one diameter beyond the disk edge; point/planet width is independently 0.5 degrees',async()=>{
 for(const [body,separation,expected]of [['moon',.7,true],['moon',.9,false],['sirius',.45,true],['sirius',.55,false],['venus',.45,true]]){
  const r=await C.opportunities({...plan,body},point,dependencies(fakeBodies(()=>({azimuth:separation}))));assert.equal(r.solutions.length>0,expected,body+' '+separation);
 }
 const below=await C.opportunities(plan,point,dependencies(fakeBodies(()=>({apparentAltitude:9.4}))));assert.equal(below.solutions.length,0);
 const overlap=await C.opportunities(plan,point,dependencies(fakeBodies(()=>({apparentAltitude:9.9}))));assert.equal(overlap.solutions.length,1,'below the tip but overlapping is allowed');
});

test('arbitrary anchor is never replaced by a schematic display silhouette',async()=>{
 const schema={...align,towerOutline:()=>({known:false,schematic:true,points:[[-5,0],[5,0],[5,20],[-5,20]]})};
 const r=await C.opportunities({...plan,partId:'__whole'},point,{...dependencies(fakeBodies(()=>({azimuth:3}))),align:schema});assert.equal(r.solutions.length,0);
 const near=await C.opportunities({...plan,partId:'__whole'},point,{...dependencies(fakeBodies(()=>({azimuth:.6}))),align:schema});assert.equal(near.solutions[0].event.targetGeometryKind,'anchor');
});

test('strict contact is not silently widened and a narrow off-grid minimum is refined within the chosen window',async()=>{
 const contact=130123,bodies=fakeBodies((id,t)=>({azimuth:(t-contact)/10000}));
 const strict={...plan,strict:true,timeSpec:{kind:'window',start:0,end:300000}};
 const r=await C.opportunities(strict,point,dependencies(bodies));assert(r.solutions.length);assert(r.solutions.every(s=>Math.abs(s.event.at-contact)<500));assert(r.solutions.every(s=>s.event.at>=0&&s.event.at<=300000));assert(r.partial);
 const instant=await C.opportunities({...strict,timeSpec:fixed(100000)},point,dependencies(bodies));assert.equal(instant.solutions.length,0);
 const outside=await C.opportunities({...strict,timeSpec:{kind:'window',start:0,end:60000}},point,dependencies(bodies));assert.equal(outside.solutions.length,0);
});

test('point bodies keep visible near passages on both sides of a known building instead of its blocked minimum',async()=>{
 const shape={...align,towerOutline:()=>({known:true,schematic:false,polygons:[[[-.1,9.8],[.1,9.8],[.1,10.2],[-.1,10.2]]]})},at=150000,bodies=fakeBodies((id,t)=>({azimuth:(t-at)/100000}));
 for(const body of ['sirius','venus']){
  const r=await C.opportunities({...plan,body,partId:'tip',timeSpec:{kind:'window',start:0,end:300000}},point,{...dependencies(bodies),align:shape});
  assert(r.solutions.some(s=>s.event.at<at),body+' before occultation');assert(r.solutions.some(s=>s.event.at>at),body+' after occultation');assert(r.solutions.every(s=>Math.abs(s.event.azimuth)>.1));
  const fixed=await C.opportunities({...plan,body,strict:true,timeSpec:fixedSpec(at)},point,{...dependencies(bodies),align:shape});assert.equal(fixed.solutions.length,0,'strict contact is not shifted into a near opportunity');
 }
 function fixedSpec(at){return {kind:'instant',at};}
});

test('unknown height/body/ephemeris, cancellation and exhausted budget remain distinct',async()=>{
 const bodies=fakeBodies(()=>({}));
 assert.equal((await C.opportunities(plan,{...point,elevation:null},dependencies(bodies))).reason,'standing-height-unknown');
 assert.equal((await C.opportunities({...plan,body:'not-a-body'},point,dependencies(bodies))).reason,'unknown-body');
 assert.equal((await C.opportunities(plan,point,dependencies(fakeBodies(()=>({apparentAltitude:NaN}))))).reason,'some-calculations-unknown');
 assert.equal((await C.opportunities(plan,point,{...dependencies(bodies),isCurrent:()=>false})).reason,'cancelled');
 const limited=await C.opportunities({...plan,timeSpec:{kind:'window',start:0,end:3600000}},point,{...dependencies(bodies),budget:3});assert.equal(limited.reason,'budget-exhausted');assert(limited.partial);
});

test('flat-horizon rise/set filtering also applies to a fixed instant',async()=>{
 const rising=fakeBodies((id,t)=>({apparentAltitude:t/60000,angularRadius:0})),low={...align,geometryFrom:()=>({azimuth:0,angle:0,topM:1.5,distanceKm:1})};
 const r=await C.opportunities({...plan,timeWindow:{kind:'rise',beforeMin:0,afterMin:0}},point,{...dependencies(rising),align:low});assert.equal(r.solutions.length,1);assert.equal(r.solutions[0].event.at,0);
 const set=await C.opportunities({...plan,timeWindow:{kind:'set',beforeMin:0,afterMin:0}},point,{...dependencies(rising),align:low});assert.equal(set.solutions.length,0);
 const limited=await C.opportunities({...plan,timeSpec:{kind:'window',start:0,end:86400000*365},timeWindow:{kind:'rise',beforeMin:60,afterMin:60}},point,{...dependencies(rising),align:low,budget:3});assert(limited.partial);assert.equal(limited.reason,'budget-exhausted');
});

test('all eight real body providers accept a custom target at the exact requested instant',async()=>{
 const start=Date.parse('2026-11-05T00:00:00+09:00'),obs={latitude:35.68,longitude:139.76,elevation:30,eyeM:1.5};
 for(const def of B.definitions){
  await B.ensure(def.id);let chosen;
  for(let t=start;t<start+86400000;t+=3600000){const s=B.state(def.id,t,{...obs,elevation:31.5});if(s.apparentAltitude>5&&s.apparentAltitude<65){chosen={t,s};break;}}
  assert(chosen,def.id+' above horizon');const p=G.destination(obs.latitude,obs.longitude,chosen.s.azimuth,2),custom={id:'custom-'+def.id,...p,groundM:0,parts:[{id:'tip',m:100}]},back=C.screenAnchor({azimuth:chosen.s.azimuth,altitude:chosen.s.apparentAltitude,obs,target:custom,align:A});custom.parts[0].m=back.heightM;
  const r=await C.opportunities({target:custom,body:def.id,partId:'tip',timeSpec:fixed(chosen.t)},obs,{align:A,bodies:B,yieldTask:async()=>{}});
  assert(r.solutions.length,def.id+' '+r.reason);assert.equal(r.solutions[0].event.at,chosen.t);assert.equal(r.solutions[0].anchor.latitude,custom.latitude);
 }
});

test('inverse seeds are true opposite-side geometric estimates, permit Fuji distances, and do not claim real ground',async()=>{
 const bodies=fakeBodies(()=>({azimuth:90,apparentAltitude:3})),fuji={id:'custom-mountain',latitude:35.36,longitude:138.73,groundM:0,parts:[{id:'tip',m:3776}]};
 const r=await C.inverseSeeds({...plan,target:fuji},{bodies,yieldTask:async()=>{},groundHypothesesM:[0]});assert(r.partial);assert(r.seeds.some(s=>s.distanceM>20000));assert(r.seeds.every(s=>s.longitude<fuji.longitude&&s.approximate&&s.radiusM>0));assert(r.seeds.every(s=>s.at===0));
 const limited=await C.inverseSeeds({...plan,target:fuji,timeSpec:{kind:'window',start:0,end:3600000}},{bodies,yieldTask:async()=>{},budget:2});assert(limited.partial);assert.equal(limited.reason,'seed-budget-exhausted');assert.equal(limited.seeds.length,2);
});

test('inverse distant ray uses the target local frame rather than treating its altitude as observer altitude',async()=>{
 const R=6371008.8,top=3776,angle=3,body=fakeBodies(()=>({azimuth:90,apparentAltitude:angle})),mountain={...target,parts:[{id:'tip',m:top}]};
 const r=await C.inverseSeeds({...plan,target:mountain},{bodies:body,yieldTask:async()=>{},groundHypothesesM:[0]});
 const seed=r.seeds.find(s=>s.priority===0);assert(seed);const theta=seed.distanceM/R,observerAltitude=Math.atan2((R+top)*Math.cos(theta)-(R+1.5),(R+top)*Math.sin(theta))*180/Math.PI;
 assert(Math.abs(observerAltitude+theta*180/Math.PI-angle)<1e-8);assert(Math.abs(observerAltitude-angle)>.2);
});

test('ridge contacts use the observed upper rim geographic point and the selected existing limb ID',async()=>{
 const points=[{latitude:35.009,longitude:139,m:80},{latitude:35.01,longitude:139,m:150},{latitude:35.01,longitude:139.001,m:130}],mountain={...target,parts:[{id:'summit',m:200}],rim:{latitude:35.01,longitude:139,points}},winner=points[1],g=A.geometryFrom(point,{...mountain,...winner},{heightM:winner.m,eyeM:1.5}),bodies=fakeBodies(()=>({azimuth:g.azimuth,apparentAltitude:g.angle-.25}));
 const r=await C.opportunities({...plan,target:mountain,partId:'summit',limb:'behind'},point,{align:A,bodies,yieldTask:async()=>{}});
 assert.equal(r.solutions.length,1);const s=r.solutions[0];assert.deepEqual(s.anchor,{latitude:winner.latitude,longitude:winner.longitude,heightM:winner.m});assert.equal(s.geometry.topM,winner.m);assert.equal(s.event.targetGeometryKind,'ridge');assert.equal(s.event.contactLimb,'upper');assert.equal(s.event.relation,'edge-contact');assert(s.event.gapAngleDeg<1e-8);
 const wrong=await C.opportunities({...plan,target:mountain,partId:'summit',limb:'onTop'},point,{align:A,bodies,yieldTask:async()=>{}});assert.equal(wrong.solutions.length,0);
 // A rim without points falls back to the stored rim shape when the geometry offers one; without it the ridge is unknown.
 const unknown=await C.opportunities({...plan,target:{...mountain,rim:{latitude:35.01,longitude:139}}},point,{align:{...A,rimPoints:undefined},bodies,yieldTask:async()=>{}});assert.equal(unknown.reason,'ridge-data-unavailable');assert(unknown.partial);
});

test('Fuji real rim data returns exactly the source coordinate used for final apparent elevation',async()=>{
 const filename=new URL('./astronotes-align.js',import.meta.url),source=fs.readFileSync(filename,'utf8').replace('rimOutline, judge','rimOutline, rimPoints, judge'),sandbox={module:{exports:{}},require:createRequire(filename)};vm.runInNewContext(source,sandbox);const real=sandbox.module.exports,fuji=real.targetById('fuji'),rim=real.rimPoints(fuji.rim),obs={latitude:35.6251,longitude:139.2434,elevation:599,eyeM:1.5};
 const highest=rim.map(p=>({p,g:real.geometryFrom(obs,{...fuji,...p},{heightM:p.m,eyeM:1.5})})).sort((a,b)=>b.g.angle-a.g.angle)[0],bodies=fakeBodies(()=>({azimuth:highest.g.azimuth,apparentAltitude:highest.g.angle+.25}));
 const r=await C.opportunities({...plan,target:fuji,partId:'summit',limb:'onTop'},obs,{align:real,bodies,yieldTask:async()=>{}});assert.equal(r.solutions.length,1);
 const s=r.solutions[0];assert.equal(s.anchor.latitude,highest.p.latitude);assert.equal(s.anchor.longitude,highest.p.longitude);assert.equal(s.anchor.heightM,highest.p.m);assert(Math.abs(s.geometry.angle-highest.g.angle)<1e-12);assert.notEqual(s.anchor.latitude,fuji.latitude);
});

function surfaceFixture({line=false,hole=false,desiredNorthM=0}={}){
 const desired={...G.destination(point.latitude,point.longitude,0,desiredNorthM/1000),eyeM:1.5},seed={...point,...G.destination(point.latitude,point.longitude,90,.06),groundM:999,elevation:999,surfaceElevationM:999,surfaceAglM:10},groundAt=p=>5+(p.longitude-point.longitude)*10000;
 const floor=groundAt(desired)+10,c={heightM:100,xM:0,limb:'center'},g=C.geometry({...desired,elevation:floor},target,c,A),west=G.destination(point.latitude,point.longitude,270,.1),east=G.destination(point.latitude,point.longitude,90,.1),ring=[[138.998,34.999],[139.002,34.999],[139.002,35.001],[138.998,35.001]];
 seed.surfaceGeometry=line?{lines:[[[west.longitude,west.latitude],[east.longitude,east.latitude]]],polygons:[]}:{polygons:[[ring,...(hole?[[[138.9998,34.9998],[139.0002,34.9998],[139.0002,35.0002],[138.9998,35.0002]]]:[])]],lines:[]};
 return {seed,desired,groundAt,g,c};
}

test('fixed-time polygon inverse moves only inside its walking face and refreshes ground/floor at the final point',async()=>{
 const f=surfaceFixture(),bodies=fakeBodies(()=>({azimuth:f.g.azimuth,apparentAltitude:f.g.angle})),r=await C.opportunities({...plan,composition:f.c},f.seed,{align:A,bodies,groundAt:async p=>f.groundAt(p),standingAt:async()=>({placeKind:'sidewalk',name:'移動後の歩道'}),yieldTask:async()=>{}});
 assert(r.partial);const s=r.solutions.find(s=>s.event.inverseSurfaceSolved);assert(s,r.reason);assert.equal(s.event.at,0);assert(G.distanceKm(s.observer.latitude,s.observer.longitude,f.desired.latitude,f.desired.longitude)<.001);assert.equal(s.observer.groundM,f.groundAt(s.observer));assert.equal(s.observer.elevation,s.observer.groundM+10);assert.equal(s.observer.surfaceElevationM,s.observer.elevation);assert.equal(s.observer.standingElevationM,s.observer.elevation);assert.notEqual(s.observer.groundM,999);assert.equal(s.observer.surfaceId,'park-surface');assert.equal(s.observer.placeKind,'sidewalk');assert.equal(s.observer.name,'移動後の歩道');assert(s.event.compositionResidualDeg<.002);
 const h=surfaceFixture({hole:true}),excluded=await C.opportunities({...plan,composition:h.c},h.seed,{align:A,bodies,groundAt:h.groundAt,yieldTask:async()=>{}});assert.equal(excluded.solutions.length,0,'a polygon hole is never accepted');
});

test('line inverse has zero invented width, retains instant time, and jointly solves station/time in a window',async()=>{
 const f=surfaceFixture({line:true}),bodies=fakeBodies(()=>({azimuth:f.g.azimuth,apparentAltitude:f.g.angle})),deps={align:A,bodies,groundAt:f.groundAt,yieldTask:async()=>{}},r=await C.opportunities({...plan,composition:f.c},f.seed,deps),s=r.solutions.find(s=>s.event.inverseSurfaceSolved);assert(s,r.reason);assert.equal(s.event.at,0);assert(G.distanceKm(s.observer.latitude,s.observer.longitude,f.desired.latitude,f.desired.longitude)<.001);
 const off=surfaceFixture({line:true,desiredNorthM:30}),offBodies=fakeBodies(()=>({azimuth:off.g.azimuth,apparentAltitude:off.g.angle})),miss=await C.opportunities({...plan,composition:off.c},off.seed,{...deps,bodies:offBodies});assert.equal(miss.solutions.length,0,'a solution 30 metres off the line is rejected');
 const at=123456,windowBodies=fakeBodies((id,t)=>({azimuth:f.g.azimuth,apparentAltitude:f.g.angle+(t-at)/1000000})),windowed=await C.opportunities({...plan,composition:f.c,timeSpec:{kind:'window',start:0,end:3600000}},f.seed,{...deps,bodies:windowBodies});const solved=windowed.solutions.find(s=>s.event.inverseSurfaceSolved);assert(solved,windowed.reason);assert(Math.abs(solved.event.at-at)<1000);assert(solved.event.at>=0&&solved.event.at<=3600000);
});

test('published point surfaces cannot move and inverse never guesses missing terrain',async()=>{
 const f=surfaceFixture(),bodies=fakeBodies(()=>({azimuth:f.g.azimuth,apparentAltitude:f.g.angle})),fixedPoint={...f.seed,surfaceGeometry:{polygons:[],lines:[],position:{latitude:f.seed.latitude,longitude:f.seed.longitude}}};
 const fixed=await C.opportunities({...plan,composition:f.c},fixedPoint,{align:A,bodies,groundAt:f.groundAt,yieldTask:async()=>{}});assert.equal(fixed.solutions.length,0);
 const unknown=await C.opportunities({...plan,composition:f.c},f.seed,{align:A,bodies,groundAt:async()=>null,yieldTask:async()=>{}});assert.equal(unknown.solutions.length,0);assert(unknown.partial);assert.equal(unknown.reason,'some-calculations-unknown');
});

test('strict rim alignment can solve on a mapped line and exhausted location work stays partial',async()=>{
 const f=surfaceFixture({line:true}),mountain={...target,rim:{latitude:target.latitude,longitude:target.longitude,points:[{latitude:target.latitude,longitude:target.longitude,m:100},{latitude:target.latitude-.001,longitude:target.longitude,m:50}]}},bodies=fakeBodies(()=>({azimuth:f.g.azimuth,apparentAltitude:f.g.angle+.25})),deps={align:A,bodies,groundAt:f.groundAt,yieldTask:async()=>{}},r=await C.opportunities({...plan,target:mountain,limb:'onTop'},f.seed,deps),s=r.solutions.find(s=>s.event.inverseSurfaceSolved);
 assert(s,r.reason);assert.equal(s.event.at,0);assert.equal(s.event.contactLimb,'lower');assert.equal(s.event.targetGeometryKind,'ridge');assert.equal(s.anchor.heightM,100);assert(s.event.alignmentResidualDeg<.002);assert.equal(s.event.composition,undefined);
 const limited=await C.opportunities({...plan,target:mountain,limb:'onTop'},f.seed,{...deps,budget:1});assert(limited.partial);assert.equal(limited.reason,'budget-exhausted');assert.equal(limited.evaluated,1);
});

test('generic composition inverse preserves surveyed scene-surface and seed distance with a requested time window',async()=>{
 const S=require('./src/features/candidates/scene-surface.js'),skytree=A.targetById('skytree'),reference={latitude:35.7119003406,longitude:139.8088988752,elevation:1.01,eyeM:1.5},preset=S.preset({obs:reference,target:skytree,align:A,heightM:636}),g=S.geometry(reference,skytree,preset,A),c=S.pick({obs:reference,target:skytree,align:A,azimuth:g.azimuth,altitude:g.angle,limb:'lower'}),seed={latitude:35.71120995761859,longitude:139.80833348838522,elevation:1.01,eyeM:1.5},at=Date.parse('2026-11-29T12:00:00+09:00'),roads=JSON.parse(fs.readFileSync(new URL('./data/candidate-sidewalks.json',import.meta.url))),p={target:skytree,body:'moon',at,composition:c,timeSpec:{kind:'window',start:at-43200000,end:at+43200000-1}},r=await C.opportunities(p,seed,{align:A,bodies:B,terrain:{at:()=>1.01},sidewalks:roads,yieldTask:async()=>{}}),solved=r.solutions.find(s=>s.event.inverseSurfaceSolved);
 assert(solved,r.reason);assert.equal(solved.event.composition.basis,'scene-surface');assert(C.roadAt(roads,solved.observer));assert(Math.abs(G.distanceKm(seed.latitude,seed.longitude,skytree.latitude,skytree.longitude)-G.distanceKm(solved.observer.latitude,solved.observer.longitude,skytree.latitude,skytree.longitude))<1e-8);assert(solved.event.at>=p.timeSpec.start&&solved.event.at<=p.timeSpec.end);assert.deepEqual(solved.anchor,S.anchor(skytree,c));
});
