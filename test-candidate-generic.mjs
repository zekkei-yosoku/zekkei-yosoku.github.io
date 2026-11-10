import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),G=require('./astronotes-terrain.js');
const {createLive}=require('./experiments/candidate-visibility/live-terrain.js');
const {createGeneric,lensCheck,standingMetadata}=require('./experiments/candidate-visibility/generic-evaluator.js');
const {requestKey,createGenericSearch,regionsFor}=require('./experiments/candidate-visibility/generic-search.js');
const C=require('./experiments/candidate-visibility/composition.js');
const M=require('./experiments/candidate-visibility/model-evaluator.js'),A=require('./astronotes-align.js');
const dem=value=>Array(65536).fill(value).join(',');

test('live DEM preserves missing pixels, true zero, lower-resolution provenance and retries',async()=>{
 let calls=0;const t=createLive({geo:G,fetchImpl:async url=>{calls++;return {ok:true,text:async()=>dem(url.includes('/dem/')?'0':'e')};}});
 // GSI names the 10 m layer "dem" (xyz/dem/14); "dem10b" is not served (404).
 const s=await t.sample({latitude:35,longitude:139});assert.equal(s.height,0);assert.equal(s.layer,'dem');assert(!/dem10b/.test(String(t.stats?.())));assert.equal(calls,4);
 await t.sample({latitude:35,longitude:139});assert.equal(calls,4);
 const unknown=createLive({geo:G,fetchImpl:async()=>({ok:true,text:async()=>dem('e')})});assert.equal((await unknown.sample({latitude:35,longitude:139})).height,null);
 let failed=true;const retry=createLive({geo:G,fetchImpl:async()=>{if(failed)throw Error('offline');return {ok:true,text:async()=>dem('12')};}});assert.equal((await retry.sample({latitude:35,longitude:139})).height,null);failed=false;assert.equal((await retry.sample({latitude:35,longitude:139})).height,12);
});

test('terrain budget and cancellation do not turn unread terrain into a clear ray',async()=>{
 const t=createLive({geo:G,maxTiles:0,fetchImpl:async()=>{throw Error('must not call');}}),p={latitude:35,longitude:139,elevation:30,eyeM:1.5};
 const r=await t.trace(p,{azimuth:0,altitude:10,maxM:1000});assert.equal(r.status,'unknown');assert(r.partial);
 await assert.rejects(t.trace(p,{azimuth:0,altitude:10,maxM:1000,isCurrent:()=>false}),/cancelled/);
});

test('DEM foreground occluder blocks while known flat ground permits a model ray beyond 20km',async()=>{
 const mountain=createLive({geo:G,fetchImpl:async()=>({ok:true,text:async()=>dem('100')})});
 const p={latitude:35,longitude:139,elevation:0,eyeM:1.5};assert((await mountain.trace(p,{azimuth:0,altitude:1,maxM:1000})).hit);
 const flat=createLive({geo:G,fetchImpl:async()=>({ok:true,text:async()=>dem('0')})});const r=await flat.trace(p,{azimuth:0,altitude:10,maxM:21000});assert.equal(r.status,'model-clear');assert(r.scopeM>=21000);
});
test('terrain immediately before a target endpoint remains unknown rather than falsely clear, and blocks an ordinary sky ray',async()=>{
 const start={latitude:35,longitude:139,elevation:0,eyeM:1.5},end={...G.destination(35,139,0,.1),elevation:20},obstacle=G.destination(35,139,0,.098);
 const z=15,px=Math.floor((obstacle.longitude+180)/360*256*2**z),py=Math.floor((1-Math.asinh(Math.tan(obstacle.latitude*Math.PI/180))/Math.PI)/2*256*2**z);
 const terrain=createLive({geo:G,fetchImpl:async url=>{const match=url.match(/\/(\d+)\/(\d+)\/(\d+)\.txt$/),values=Array(65536).fill('0');if(+match[1]===z&&+match[2]===Math.floor(px/256)&&+match[3]===Math.floor(py/256))values[(py%256)*256+px%256]='100';return {ok:true,text:async()=>values.join(',')};}});
 const altitude=Math.atan2(20-1.5,100)*180/Math.PI,r=await terrain.trace(start,{azimuth:0,altitude,maxM:100,endpoint:end});
 assert.equal(r.status,'unknown');assert.equal(r.endpointContactUncertain,true);assert.equal(r.hit,null);assert(r.minMarginM<0);
 const celestial=await terrain.trace(start,{azimuth:0,altitude,maxM:100});assert.equal(celestial.status,'blocked');assert(celestial.hit.distanceM>90);
});

const target={id:'user-arbitrary',latitude:35.01,longitude:139,parts:[{id:'tip',m:110}]};
const align={geometryFrom:()=>({azimuth:0,angle:10,topM:110,distanceKm:1}),viewProjector:(az,alt)=>(a,h)=>[a-az,h-alt],viewUnprojector:(az,alt)=>(x,y)=>[az+x,alt+y],towerOutline:()=>null};
const bodies={definition:id=>({id,limbs:['sun','moon'].includes(id)}),ensure:async()=>{},nearAngle:()=>.5,state:(id,t,p)=>({azimuth:0,apparentAltitude:10,angularRadius:id==='sirius'?0:.25})};
const plan={target,body:'moon',at:0,timeSpec:{kind:'instant',at:0},partId:'tip'};
const point={latitude:35,longitude:139,groundM:50,surfaceAglM:20,surfaceElevationM:70,eyeM:1.5,standingSurfaceKnown:true,accessKnown:false,surfaceId:'deck',placeKind:'viewpoint',nonTerrainStructure:true,surfaceHeightM:20};
const unknownTerrain={at:async()=>50,trace:async()=>({status:'unknown',missing:1})};
// A clear line needs every part known: terrain, building heights and the target's outline.
const openTerrain={at:async()=>50,trace:async()=>({status:'model-clear',checked:1,missing:0})},openHeights={trace:async()=>({status:'clear',heights:'plateau'})};
const outlined={...align,towerOutline:()=>({known:true,polygons:[[[-.001,0],[.001,0],[.001,10],[-.001,10]]]})};
test('an unconfirmed line is not a candidate; a confirmed one keeps the arbitrary anchor and floor height',async()=>{
 const unknown=await createGeneric({align,bodies,geo:G,terrain:unknownTerrain,yieldTask:async()=>{}}).evaluate(plan,point,{});
 assert.equal(unknown.recommend,false);assert.equal(unknown.status,'unverified');
 const model=createGeneric({align:outlined,bodies,geo:G,terrain:openTerrain,heights:openHeights,yieldTask:async()=>{}}),r=await model.evaluate(plan,point,{});
 assert(r.recommend);assert.equal(r.status,'model-visible');assert.equal(r.quality.visibility,'model-clear');assert.equal(r.quality.buildingHeights,'plateau');assert.equal(r.quality.targetAngleDeg,10);assert.equal(r.assumedObserver.elevation,70);assert.equal(r.place.groundManualM,50);assert.equal(r.place.standAglM,21.5);assert.deepEqual(r.place.decks,[]);assert.equal(r.event.at,0);
 assert.equal((await model.evaluate(plan,{...point,access:'private'},{})).recommend,false);
});
test('a point star hidden by the actual outline cannot be recommended as a visible alignment',async()=>{
 const outlined={...align,towerOutline:()=>({known:true,schematic:false,polygons:[[[-1,9],[1,9],[1,11],[-1,11]]]})};
 const model=createGeneric({align:outlined,bodies,geo:G,terrain:unknownTerrain,yieldTask:async()=>{}}),r=await model.evaluate({...plan,body:'sirius'},point,{});assert.equal(r.recommend,false);assert(['no-overlap','model-blocked'].includes(r.status));
});
test('terrain behind the target is evaluated for the celestial rays',async()=>{
 const lengths=[],terrain={at:async()=>50,trace:async(o,r)=>{lengths.push(r.maxM);return r.endpoint?{status:'model-clear'}:{status:'blocked',hit:{distanceM:2000}};}};
 // The sky lines are traced once the line to the target itself is confirmed.
 const model=createGeneric({align:outlined,bodies,geo:G,terrain,heights:openHeights,yieldTask:async()=>{}});assert.equal((await model.evaluate(plan,point,{})).recommend,false);assert(lengths.some(m=>m>1000));
});
test('FOV uses actual sensor, rotation and crop without changing celestial geometry',()=>{
 const geometry=align.geometryFrom(),state={azimuth:2,apparentAltitude:10,angularRadius:.25},p={...plan,lens:{mode:'required',sensorWidth:36,sensorHeight:24,focal:200,targetExtent:'anchor'}};
 const wide=lensCheck(p,point,state,geometry,align);assert(wide.fits);const narrow=lensCheck({...p,lens:{...p.lens,focal:1000}},point,state,geometry,align);assert(!narrow.fits);assert.equal(state.azimuth,2);
 const missing=lensCheck({...p,lens:{...p.lens,targetExtent:'whole'}},point,state,geometry,align);assert.equal(missing.status,'unknown');assert(!missing.fits);
});
test('request identity includes fixed time, focal length, crop, orientation, target height and secondary conditions',()=>{
 const p={...plan,owner:'fixture'};for(const change of [{timeSpec:{kind:'instant',at:1}},{lens:{focal:200}},{lens:{crop:2}},{lens:{portrait:true}},{target:{...target,parts:[{id:'tip',m:111}]}},{extraTargets:[target],requireAllTargets:true}])assert.notEqual(requestKey({...p,...change}),requestKey(p));
});
test('generic queue is resumable and keeps event-position pairs; cancellation never publishes late results',async()=>{
 const original=C.inverseSeeds;C.inverseSeeds=async()=>({seeds:[{latitude:35,longitude:139,radiusM:300,priority:0}],partial:true});
 try{let calls=0;const provider={load:async()=>({points:[{...point,latitude:35},{...point,latitude:35.001}],coverage:{nextCursor:null}})},engine=createGenericSearch({provider,bodies,maxPointsPerBatch:1,evaluate:async(p,pt)=>{calls++;return {recommend:true,id:String(pt.latitude),place:pt,event:{at:0}};},yieldTask:async()=>{}});
  const first=await engine.search(plan);assert.equal(first.rows.length,1);assert(first.canContinue);const next=await engine.search(plan,{more:true});assert.equal(next.rows.length,2);assert(!next.canContinue);assert.equal(calls,2);assert.equal(next.rows[0].place.latitude,35);assert.equal(next.rows[1].place.latitude,35.001);assert.equal(next.coverageStatus,'partial');
  let current=true;const cancelled=createGenericSearch({provider,bodies,evaluate:async()=>{current=false;return {recommend:true,place:point,event:{at:0}};}});assert((await cancelled.search(plan,{isCurrent:()=>current})).cancelled);
 }finally{C.inverseSeeds=original;}
});

test('invalid composition cannot restore valid candidates or start IO, and recovery reuses the valid cache',async()=>{
 const original=C.inverseSeeds,calls={inverse:0,body:0,provider:0,evaluate:0};
 C.inverseSeeds=async()=>{calls.inverse++;return {seeds:[{latitude:35,longitude:139,radiusM:300}],partial:true};};
 try{
  const engine=createGenericSearch({
   provider:{load:async()=>{calls.provider++;return {points:[point],coverage:{nextCursor:null}};}},
   bodies:{...bodies,ensure:async()=>{calls.body++;}},
   evaluate:async()=>{calls.evaluate++;return {recommend:true,id:'valid-composition',place:point,event:{at:0}};},
   yieldTask:async()=>{}
  });
  const valid={...plan,composition:{heightM:110,xM:0,limb:'lower'}},first=await engine.search(valid);
  assert.equal(first.rows.length,1);assert.deepEqual(calls,{inverse:1,body:1,provider:1,evaluate:1});
  const invalid={...valid,compositionInvalid:true,invalidDraft:{height:'800',x:'0'}};
  assert.notEqual(requestKey(invalid),requestKey(valid));assert.equal(engine.cached(invalid),null);
  await assert.rejects(engine.search(invalid),/invalid-composition/);
  await assert.rejects(engine.search(invalid,{more:true}),/invalid-composition/);
  assert.deepEqual(calls,{inverse:1,body:1,provider:1,evaluate:1},'invalid input must not call any IO or evaluation port');
  const recovered={...invalid,compositionInvalid:false,invalidDraft:null};
  assert.equal(requestKey(recovered),requestKey(valid));assert.deepEqual(engine.cached(recovered).rows,first.rows);
  const reused=await engine.search(recovered);assert(reused.cached);assert.deepEqual(reused.rows,first.rows);
  assert.deepEqual(calls,{inverse:1,body:1,provider:1,evaluate:1},'recovery preserves the completed valid result');
 }finally{C.inverseSeeds=original;}
});

const completeIndex={grid:{},buildings:[],coverageMeshes:[{provided:true,bbox:[138,34,140,36]}]};
const clearTerrain={at:async()=>50,trace:async()=>({status:'model-clear',checked:1,missing:0})};
const clearOutline={...align,towerOutline:()=>({known:true,schematic:false,polygons:[[[-1,8],[1,8],[1,9],[-1,9]]]})};
const solution=(angle=10)=>({observer:{...point,elevation:70},event:{at:0},geometry:{azimuth:0,angle,topM:110,distanceKm:.1},anchor:target});
test('complete source bounds never promote an untraced near-zenith building ray to clear',async()=>{
 const highBodies={...bodies,state:()=>({azimuth:0,apparentAltitude:89.5,angularRadius:0})};
 const model=createGeneric({align:clearOutline,bodies:highBodies,geo:G,terrain:clearTerrain,index:completeIndex,yieldTask:async()=>{}});
 const result=await model.visibility({...plan,body:'sirius'},solution(89.5));
 assert.equal(result.status,'unknown');assert.equal(result.target.buildings.complete,true);assert.equal(result.target.buildings.evaluated,false);assert.equal(result.target.buildings.status,'unknown');assert(result.rays.every(r=>r.status==='unknown'));
});
test('unresolved target-complex contacts and earlier own surfaces remain unknown; only identified terminal contact can clear',async()=>{
 const original=M.trace;
 try{
  for(const [polygonId,fraction,expected]of [['unidentified',1,'unknown'],['documented',.5,'unknown'],['documented',1,'model-clear']]){
   M.trace=(index,observer,ray)=>({faces:1,buildingsChecked:1,hit:null,targetContacts:ray.endpoint?[{polygonId,distanceM:ray.maxM*fraction}]:[]});
   const index={...completeIndex,targetAssociations:{[target.id]:{targetSurfacePolygonIds:['documented']}}},model=createGeneric({align:clearOutline,bodies:{...bodies,state:()=>({azimuth:0,apparentAltitude:10,angularRadius:0})},geo:G,terrain:clearTerrain,index,yieldTask:async()=>{}});
   const r=await model.visibility({...plan,body:'sirius'},solution());assert.equal(r.status,expected);assert.equal(r.target.buildings.unresolvedTargetContacts,expected==='unknown');
  }
 }finally{M.trace=original;}
});
test('visibility cache changes with atmosphere and the actual celestial state, even when targetK is unchanged',async()=>{
 let altitude=10,calls=0;const mutableBodies={...bodies,state:()=>({azimuth:0,apparentAltitude:altitude,angularRadius:0})},terrain={...clearTerrain,trace:async(o,r)=>{calls++;return !r.endpoint&&r.altitude>10.1?{status:'blocked',hit:{distanceM:100}}:{status:'model-clear',checked:1,missing:0};}};
 const model=createGeneric({align:clearOutline,bodies:mutableBodies,geo:G,terrain,index:completeIndex,yieldTask:async()=>{}}),p={...plan,body:'sirius',atmosphere:'manual-1010hPa'};
 assert.equal((await model.visibility(p,solution())).status,'model-clear');const first=calls;
 assert.equal((await model.visibility({...p,atmosphere:'manual-980hPa'},solution())).status,'model-clear');assert(calls>first);
 altitude=10.2;assert.equal((await model.visibility({...p,atmosphere:'manual-980hPa'},solution())).status,'blocked');
});
test('scene FOV shares the renderer target-centred window and normalized pan rather than centring the target tip',()=>{
 const shape={known:true,schematic:false,topAngle:10,baseAngle:0,viewBaseAngle:0,polygons:[[[-1,0],[1,0],[1,10],[-1,10]]]},sceneAlign={...align,viewProjector:A.viewProjector,viewUnprojector:A.viewUnprojector,viewWindow:A.viewWindow,towerOutline:()=>shape},state={azimuth:0,apparentAltitude:10,angularRadius:.25};
 const lens={mode:'required',focal:80,sensorWidth:36,sensorHeight:24,targetExtent:'whole',viewModel:'scene',aspect:1.1,pan:[0,0]},r=lensCheck({...plan,lens},point,state,align.geometryFrom(),sceneAlign);
 assert(r.fits);assert(r.axis.altitude<8&&r.axis.altitude>3);
 const moved=lensCheck({...plan,lens:{...lens,pan:[.1,.2]}},point,state,align.geometryFrom(),sceneAlign),win=A.viewWindow({azimuth:0,baseAngle:0,topAngle:10,radiusDeg:.25,aspect:1.1,include:[10]}),halfH=Math.max(24/(2*80)/(Math.PI/180),36/(2*80)/(Math.PI/180)/1.1)*1.12;
 const expected=A.viewUnprojector(win.az0,win.alt0)(-2*halfH*1.1*.1,2*halfH*.2);assert(Math.abs(moved.axis.azimuth-expected[0])<1e-10);assert(Math.abs(moved.axis.altitude-expected[1])<1e-10);
});
test('secondary targets use the primary camera axis and cannot each centre a different photograph',async()=>{
 const extra={...target,id:'second',longitude:139.01},testAlign={...outlined,geometryFrom:(o,t)=>({azimuth:t.id==='second'?5.2:0,angle:10,topM:110,distanceKm:1})},testBodies={...bodies,state:()=>({azimuth:.5,apparentAltitude:10,angularRadius:.25})};
 const model=createGeneric({align:testAlign,bodies:testBodies,geo:G,terrain:openTerrain,heights:openHeights,yieldTask:async()=>{}}),p={...plan,extraTargets:[extra],lens:{mode:'required',sensorWidth:36,sensorHeight:24,focal:36/(10*Math.PI/180),targetExtent:'anchor'}};
 const optional=await model.evaluate(p,point,{});assert(optional.recommend);assert.equal(optional.extraTargets[0].frame.status,'outside');assert.deepEqual(optional.extraTargets[0].frame.axis,optional.frame.axis);
 const required=await model.evaluate({...p,requireAllTargets:true},point,{});assert.equal(required.recommend,false);assert.equal(required.status,'outside-frame');
});
test('secondary obstruction is evaluated at the same event and observer; required blocked target is excluded',async()=>{
 const extra={...target,id:'second',longitude:139.01},seen=[],terrain={...clearTerrain,trace:async(o,r)=>{seen.push({observer:o,ray:r});return r.endpoint?.longitude===extra.longitude?{status:'blocked',hit:{distanceM:500}}:{status:'model-clear',checked:1,missing:0};}};
 const model=createGeneric({align:outlined,bodies,geo:G,terrain,heights:openHeights,yieldTask:async()=>{}}),p={...plan,extraTargets:[extra]};
 const r=await model.evaluate(p,point,{});assert(r.recommend);assert.equal(r.extraTargets[0].visibility,'blocked');assert.equal(r.extraTargets[0].at,r.event.at);assert.equal(r.extraTargets[0].observer.elevation,r.assumedObserver.elevation);assert(seen.some(x=>x.ray.endpoint?.longitude===extra.longitude));assert.equal(r.status,'visible-partial');
 assert.equal((await model.evaluate({...p,requireAllTargets:true},point,{})).status,'model-blocked');
});
test('a point whose line to the target top is blocked or unconfirmed is ruled out before any event search',async()=>{
 const seen=[],heights=status=>({trace:async(o,ray)=>{seen.push(ray);return {status,reason:status==='unknown'?'building-height-unknown':null};}});
 const blocked=await createGeneric({align:outlined,bodies,geo:G,terrain:openTerrain,heights:heights('blocked'),yieldTask:async()=>{}}).evaluate(plan,point,{});
 assert.equal(blocked.status,'model-blocked');assert.equal(blocked.reason,'target-line-blocked');assert.equal(seen.length,1);assert.equal(seen[0].endpoint.elevation,110);assert.equal(seen[0].targetKey,target.id);
 const unknown=await createGeneric({align:outlined,bodies,geo:G,terrain:openTerrain,heights:heights('unknown'),yieldTask:async()=>{}}).evaluate(plan,point,{});
 assert.equal(unknown.status,'unverified');assert.equal(unknown.heightUnknown,true);
 // A composition may move the observer over its surface, so its events are still searched.
 const moved=await createGeneric({align:outlined,bodies,geo:G,terrain:openTerrain,heights:heights('blocked'),yieldTask:async()=>{}}).evaluate({...plan,strict:true},point,{});
 assert.notEqual(moved.reason,'target-line-blocked');
});
test('a valid absolute or AGL standing height does not depend on the deprecated surfaceHeightM alias',async()=>{
 const model=createGeneric({align:outlined,bodies,geo:G,terrain:openTerrain,heights:openHeights,yieldTask:async()=>{}}),p={...point};delete p.surfaceHeightM;
 const r=await model.evaluate(plan,p,{});assert(r.recommend);assert.equal(r.assumedObserver.elevation,70);assert.equal(r.place.standAglM,21.5);
});
test('surface movement rechecks actual areas, drops the old park label and refuses private, water, unknown roof/building or unfetched positions',()=>{
 const area=(id,w,e,props={})=>({id,sourceId:'osm/'+id,tags:{},polygons:[[[[w,34.999],[e,34.999],[e,35.001],[w,35.001],[w,34.999]]]],...props});
 const path={id:'way/path',sourceId:'osm/way/path',walking:true,tags:{highway:'footway'},name:'公園外へ続く歩道',polygons:[],lines:[[[139,35],[139.01,35]]]},park=area('way/park',138.999,139.004,{kind:'park',name:'元の公園'});
 const data={features:[path,park,area('way/private',139.006,139.007,{tags:{access:'private'}}),area('way/water',139.008,139.009,{water:true}),area('way/building',139.0095,139.011,{building:true}),area('way/roof',139.0051,139.0054,{kind:'park',tags:{location:'roof',level:'7'}})],coverage:{fetchedRegions:[{bbox:[138.99,34.99,139.02,35.01]}]}};
 const seed={...point,sourceId:path.sourceId,polygonId:path.id,nonTerrainStructure:false,sourceEvidence:{kind:'osm-mapped-walking-surface'},name:'元の公園',placeKind:'park'};
 const at=longitude=>standingMetadata({latitude:35,longitude},data,seed);
 assert.equal(at(139.002).placeKind,'park');const moved=at(139.005);assert.equal(moved.placeKind,'road');assert.equal(moved.name,'公園外へ続く歩道');assert.equal(moved.sourceEvidence.resolvedPositionAreaChecked,true);
 for(const lon of [139.0065,139.0085,139.0098,139.0052,139.03])assert.equal(at(lon),false);
});

test('an unknown whole-target outline is never certified: neither its framing nor the line past it',async()=>{
 // Without the outline, rays beside the target cannot be told from rays through it, so the line stays unconfirmed.
 const model=createGeneric({align,bodies,geo:G,terrain:openTerrain,heights:openHeights,yieldTask:async()=>{}}),lens={mode:'evaluate',sensorWidth:36,sensorHeight:24,focal:200,targetExtent:'whole'};
 const r=await model.evaluate({...plan,lens},point,{});assert.equal(r.recommend,false);assert.equal(r.status,'unverified');
 const required=await model.evaluate({...plan,lens:{...lens,mode:'required'}},point,{});assert(!required.recommend);
});

test('returning to a date retires its cancelled in-flight owner without losing active same-key protection',async()=>{
 const original=C.inverseSeeds;C.inverseSeeds=async()=>({seeds:[{latitude:35,longitude:139,radiusM:300,priority:0}],partial:true});
 try{
  let oldCurrent=true,release,entered;const started=new Promise(r=>entered=r);let loads=0;
  const provider={load:async()=>{if(++loads===1){entered();await new Promise(r=>release=r);}return {points:[point],coverage:{nextCursor:null}};}};
  const engine=createGenericSearch({provider,bodies,evaluate:async()=>({recommend:true,id:'new-owner',place:point,event:{at:0}}),yieldTask:async()=>{}});
  const old=engine.search(plan,{isCurrent:()=>oldCurrent});await started;
  const concurrent=await engine.search(plan);assert.equal(concurrent.reason,'busy');assert.equal(loads,1);
  oldCurrent=false;const replacement=await engine.search(plan);assert.equal(replacement.rows.length,1);assert.equal(loads,2);
  release();assert((await old).cancelled);const cached=await engine.search(plan);assert.equal(cached.rows.length,1);assert(cached.cached);
 }finally{C.inverseSeeds=original;}
});

test('unspecified camera display geometry does not invalidate a search; an evaluated camera still does',()=>{
 const a={...plan,lens:{mode:'unspecified',focal:50,aspect:1,pan:[0,0]}},b={...plan,lens:{mode:'unspecified',focal:300,aspect:1.111,pan:[.2,0]}};
 assert.equal(requestKey(a),requestKey(b));assert.notEqual(requestKey({...a,lens:{...a.lens,mode:'evaluate'}}),requestKey({...b,lens:{...b.lens,mode:'evaluate'}}));
});
test('completed candidate batches can be restored without IO, while incomplete jobs and another request cannot',async()=>{
 const original=C.inverseSeeds;C.inverseSeeds=async()=>({seeds:[{latitude:35,longitude:139,radiusM:300,priority:0}],partial:true});
 try{let loads=0;const engine=createGenericSearch({provider:{load:async()=>{loads++;return {points:[point],coverage:{nextCursor:null}};}},bodies,evaluate:async()=>({recommend:true,id:'saved',place:point,event:{at:0}}),yieldTask:async()=>{}});
  assert.equal(engine.cached(plan),null);await engine.search(plan);const restored=engine.cached(plan);assert.equal(restored.rows[0].id,'saved');assert.equal(loads,1);assert.equal(engine.cached({...plan,owner:'another'}),null);
  restored.rows.pop();assert.equal(engine.cached(plan).rows.length,1);engine.clear();assert.equal(engine.cached(plan),null);
 }finally{C.inverseSeeds=original;}
});


test('resuming a cancelled continuation preserves completed rows and pending work without restarting its provider cursor',async()=>{
 const original=C.inverseSeeds;C.inverseSeeds=async()=>({seeds:[{latitude:35,longitude:139,radiusM:300,priority:0}],partial:true});
 try{
  let loads=0,active=true,release,entered,hold=true;const started=new Promise(r=>entered=r);
  const points=[0,1,2].map(i=>({...point,id:'c'+i,surfaceId:'c'+i,longitude:point.longitude+i*.0001}));
  const engine=createGenericSearch({maxPointsPerBatch:1,provider:{load:async()=>{loads++;return {points,coverage:{nextCursor:7}};}},bodies,yieldTask:async()=>{},evaluate:async(p,q)=>{
   if(q.id==='c2'&&hold){hold=false;entered();await new Promise(r=>release=r);}return {recommend:true,id:q.id,place:q,event:{at:0}};
  }});
  await engine.search(plan);const completed=await engine.search(plan,{more:true});assert.deepEqual(completed.rows.map(r=>r.id),['c0','c1']);
  const old=engine.search(plan,{more:true,isCurrent:()=>active});await started;active=false;
  assert.deepEqual(engine.cached(plan).rows.map(r=>r.id),['c0','c1']);
  const resumed=await engine.search(plan,{more:true});assert.deepEqual(resumed.rows.map(r=>r.id),['c0','c1','c2']);assert.equal(loads,1);assert.equal(resumed.coverage.nextCursor,7);assert.equal(resumed.counts.checked,3);
  release();assert((await old).cancelled);assert.deepEqual(engine.cached(plan).rows.map(r=>r.id),['c0','c1','c2']);
 }finally{C.inverseSeeds=original;}
});


test('cancellation while static preparation is pending cannot advance past an uncommitted provider page',async()=>{
 const original=C.inverseSeeds;C.inverseSeeds=async()=>({seeds:[{latitude:35,longitude:139,radiusM:300,priority:0}],partial:true});
 try{
  const cursors=[];let active=true,entered,release,hold=true;const started=new Promise(r=>entered=r);
  const engine=createGenericSearch({provider:{load:async(p,{cursor})=>{cursors.push(cursor);return {points:[{...point,id:'page'+cursor}],coverage:{nextCursor:cursor===0?7:null}};}},bodies,yieldTask:async()=>{},loadStatic:async()=>{if(hold){hold=false;entered();await new Promise(r=>release=r);}return null;},evaluate:async(p,q)=>({recommend:true,id:q.id,place:q,event:{at:0}})});
  const old=engine.search(plan,{isCurrent:()=>active});await started;active=false;
  const resumed=await engine.search(plan,{more:true});assert.deepEqual(cursors,[0,0]);assert.deepEqual(resumed.rows.map(r=>r.id),['page0']);assert.equal(resumed.coverage.nextCursor,7);assert.equal(resumed.coverage.loaded.length,1);
  release();assert((await old).cancelled);assert.deepEqual(engine.cached(plan).rows.map(r=>r.id),['page0']);
 }finally{C.inverseSeeds=original;}
});

test('rechecking the same request reloads places while preserving its completed cache until a new result, including zero rows, completes',async()=>{
 const original=C.inverseSeeds;let inverses=0;C.inverseSeeds=async()=>{inverses++;return {seeds:[{latitude:35,longitude:139,radiusM:300,priority:0}],partial:true};};
 try{
  let loads=0,empty=false;const engine=createGenericSearch({bodies,yieldTask:async()=>{},provider:{load:async()=>({points:empty?(loads++,[]):[{...point,id:'generation-'+(++loads)}],coverage:{nextCursor:null}})},evaluate:async(p,q)=>({recommend:true,id:q.id,place:q,event:{at:0}})});
  const first=await engine.search(plan);assert.equal(first.canContinue,false);assert.equal(first.rows[0].id,'generation-1');
  assert.equal(engine.restart(plan),true);assert.deepEqual(engine.cached(plan).rows,first.rows);assert.equal(loads,1);
  const second=await engine.search(plan);assert.equal(loads,2);assert.equal(inverses,1);assert.equal(second.requestKey,first.requestKey);assert.deepEqual(second.rows.map(r=>r.id),['generation-2']);assert.equal(second.counts.checked,1);assert.deepEqual(engine.cached(plan).rows,second.rows);
  empty=true;assert.equal(engine.restart(plan),true);assert.deepEqual(engine.cached(plan).rows,second.rows);
  const none=await engine.search(plan);assert.equal(loads,3);assert.deepEqual(none.rows,[]);assert.equal(none.canContinue,false);assert.deepEqual(engine.cached(plan).rows,[]);assert.equal(engine.cached(plan).counts.checked,0);
 }finally{C.inverseSeeds=original;}
});

test('provider and evaluation failures during a recheck retain the last completed result and permit another recheck',async()=>{
 const original=C.inverseSeeds;C.inverseSeeds=async()=>({seeds:[{latitude:35,longitude:139,radiusM:300,priority:0}],partial:true});
 try{
  let failure=null,loads=0;const engine=createGenericSearch({bodies,yieldTask:async()=>{},provider:{load:async()=>{loads++;if(failure==='provider')throw Error('provider offline');return {points:[{...point,id:'generation-'+loads}],coverage:{nextCursor:null}};}},evaluate:async(p,q)=>{if(failure==='evaluate')throw Error('evaluation unavailable');return {recommend:true,id:q.id,place:q,event:{at:0}};}});
  const completed=await engine.search(plan);
  for(const stage of ['provider','evaluate']){
   failure=stage;assert.equal(engine.restart(plan),true);await assert.rejects(engine.search(plan),stage==='provider'?/provider offline/:/evaluation unavailable/);assert.deepEqual(engine.cached(plan).rows,completed.rows);assert.equal(engine.cached(plan).counts.checked,1);
  }
  failure=null;assert.equal(engine.restart(plan),true);const recovered=await engine.search(plan);assert.equal(loads,4);assert.deepEqual(recovered.rows.map(r=>r.id),['generation-4']);assert.deepEqual(engine.cached(plan).rows,recovered.rows);
 }finally{C.inverseSeeds=original;}
});

test('an active recheck cannot restart, and a cancelled old recheck cannot release a newer job lock or overwrite its cache', {timeout:5000}, async()=>{
 const original=C.inverseSeeds;C.inverseSeeds=async()=>({seeds:[{latitude:35,longitude:139,radiusM:300,priority:0}],partial:true});
 const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};},oldEntered=deferred(),newEntered=deferred(),oldGate=deferred(),newGate=deferred();
 try{
  let loads=0;const engine=createGenericSearch({bodies,yieldTask:async()=>{},provider:{load:async()=>{const generation=++loads;if(generation===2){oldEntered.resolve();await oldGate.promise;}if(generation===3){newEntered.resolve();await newGate.promise;}return {points:[{...point,id:'generation-'+generation}],coverage:{nextCursor:null}};}},evaluate:async(p,q)=>({recommend:true,id:q.id,place:q,event:{at:0}})});
  const completed=await engine.search(plan);assert.equal(engine.restart(plan),true);
  const oldController=new AbortController(),old=engine.search(plan,{signal:oldController.signal});await oldEntered.promise;
  assert.equal(engine.restart(plan),false);assert.equal((await engine.search(plan)).reason,'busy');assert.equal(loads,2);assert.deepEqual(engine.cached(plan).rows,completed.rows);
  oldController.abort();assert.equal(engine.restart(plan),true);assert.deepEqual(engine.cached(plan).rows,completed.rows);
  const replacement=engine.search(plan);await newEntered.promise;
  oldGate.resolve();assert.equal((await old).cancelled,true);assert.deepEqual(engine.cached(plan).rows,completed.rows);
  assert.equal(engine.restart(plan),false);assert.equal((await engine.search(plan)).reason,'busy');assert.equal(loads,3);
  newGate.resolve();const result=await replacement;assert.deepEqual(result.rows.map(r=>r.id),['generation-3']);assert.equal(result.counts.checked,1);assert.deepEqual(engine.cached(plan).rows,result.rows);
 }finally{oldGate.resolve();newGate.resolve();C.inverseSeeds=original;}
});
test('one search drains multiple provider pages and small evaluation batches, without retrying a failed tile',async()=>{
 const original=C.inverseSeeds;C.inverseSeeds=async()=>({seeds:[{latitude:35,longitude:139,radiusM:300}],partial:true});
 try{
  const loads=[],checked=[],provider={load:async(_,o)=>{
   assert.equal(o.retryFailed,false);loads.push(o.cursor);
   return {points:[{...point,latitude:35+.001*o.cursor},{...point,latitude:35+.001*(o.cursor+1)}],coverage:{nextCursor:o.cursor===0?2:null,failedRegions:o.cursor===0?[{id:'tile-missing'}]:[]}};
  }};
  const engine=createGenericSearch({provider,bodies,maxPointsPerBatch:1,evaluate:async(_,pt)=>{checked.push(pt.latitude);return {recommend:true,id:String(pt.latitude),place:pt,event:{at:0}};}});
  const result=await engine.searchAll(plan);assert.equal(result.canContinue,false);assert.deepEqual(loads,[0,2]);assert.equal(checked.length,4);assert.equal(result.rows.length,4);assert.equal(result.coverage.loaded[0].failedRegions[0].id,'tile-missing');
 }finally{C.inverseSeeds=original;}
});
