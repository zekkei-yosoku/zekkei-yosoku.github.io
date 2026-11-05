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
 let calls=0;const t=createLive({geo:G,fetchImpl:async url=>{calls++;return {ok:true,text:async()=>dem(url.includes('dem10b')?'0':'e')};}});
 const s=await t.sample({latitude:35,longitude:139});assert.equal(s.height,0);assert.equal(s.layer,'dem10b');assert.equal(calls,4);
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
test('arbitrary anchor survives missing building model with explicit unknown quality and correct floor height',async()=>{
 const model=createGeneric({align,bodies,geo:G,terrain:unknownTerrain,yieldTask:async()=>{}}),r=await model.evaluate(plan,point,{});
 assert(r.recommend);assert.equal(r.status,'geometry-only');assert.equal(r.quality.visibility,'unknown');assert.equal(r.assumedObserver.elevation,70);assert.equal(r.place.groundManualM,50);assert.equal(r.place.standAglM,21.5);assert.deepEqual(r.place.decks,[]);assert.equal(r.event.at,0);
 assert.equal((await model.evaluate(plan,{...point,access:'private'},{})).recommend,false);
});
test('a point star hidden by the actual outline cannot be recommended as a visible alignment',async()=>{
 const outlined={...align,towerOutline:()=>({known:true,schematic:false,polygons:[[[-1,9],[1,9],[1,11],[-1,11]]]})};
 const model=createGeneric({align:outlined,bodies,geo:G,terrain:unknownTerrain,yieldTask:async()=>{}}),r=await model.evaluate({...plan,body:'sirius'},point,{});assert.equal(r.recommend,false);assert(['no-overlap','model-blocked'].includes(r.status));
});
test('terrain behind the target is evaluated for the celestial rays',async()=>{
 const lengths=[],terrain={at:async()=>50,trace:async(o,r)=>{lengths.push(r.maxM);return r.endpoint?{status:'model-clear'}:{status:'blocked',hit:{distanceM:2000}};}};
 const model=createGeneric({align,bodies,geo:G,terrain,yieldTask:async()=>{}});assert.equal((await model.evaluate(plan,point,{})).recommend,false);assert(lengths.some(m=>m>1000));
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
 const extra={...target,id:'second',longitude:139.01},testAlign={...align,geometryFrom:(o,t)=>({azimuth:t.id==='second'?5.2:0,angle:10,topM:110,distanceKm:1})},testBodies={...bodies,state:()=>({azimuth:.5,apparentAltitude:10,angularRadius:.25})};
 const model=createGeneric({align:testAlign,bodies:testBodies,geo:G,terrain:unknownTerrain,yieldTask:async()=>{}}),p={...plan,extraTargets:[extra],lens:{mode:'required',sensorWidth:36,sensorHeight:24,focal:36/(10*Math.PI/180),targetExtent:'anchor'}};
 const optional=await model.evaluate(p,point,{});assert(optional.recommend);assert.equal(optional.extraTargets[0].frame.status,'outside');assert.deepEqual(optional.extraTargets[0].frame.axis,optional.frame.axis);
 const required=await model.evaluate({...p,requireAllTargets:true},point,{});assert.equal(required.recommend,false);assert.equal(required.status,'outside-frame');
});
test('secondary obstruction is evaluated at the same event and observer; required blocked target is excluded',async()=>{
 const extra={...target,id:'second',longitude:139.01},seen=[],terrain={...clearTerrain,trace:async(o,r)=>{seen.push({observer:o,ray:r});return r.endpoint?.longitude===extra.longitude?{status:'blocked',hit:{distanceM:500}}:{status:'model-clear',checked:1,missing:0};}};
 const model=createGeneric({align,bodies,geo:G,terrain,yieldTask:async()=>{}}),p={...plan,extraTargets:[extra]};
 const r=await model.evaluate(p,point,{});assert(r.recommend);assert.equal(r.extraTargets[0].visibility,'blocked');assert.equal(r.extraTargets[0].at,r.event.at);assert.equal(r.extraTargets[0].observer.elevation,r.assumedObserver.elevation);assert(seen.some(x=>x.ray.endpoint?.longitude===extra.longitude));assert.equal(r.status,'geometry-only');
 assert.equal((await model.evaluate({...p,requireAllTargets:true},point,{})).status,'model-blocked');
});
test('a valid absolute or AGL standing height does not depend on the deprecated surfaceHeightM alias',async()=>{
 const model=createGeneric({align,bodies,geo:G,terrain:unknownTerrain,yieldTask:async()=>{}}),p={...point};delete p.surfaceHeightM;
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

test('existing camera settings retain unknown whole-target framing without certifying it',async()=>{
 const model=createGeneric({align,bodies,geo:G,terrain:unknownTerrain,yieldTask:async()=>{}}),lens={mode:'evaluate',sensorWidth:36,sensorHeight:24,focal:200,targetExtent:'whole'};
 const r=await model.evaluate({...plan,lens},point,{});assert(r.recommend);assert.equal(r.frame.status,'unknown');assert.equal(r.quality.frame,'unknown');assert.equal(r.status,'geometry-only');
 const required=await model.evaluate({...plan,lens:{...lens,mode:'required'}},point,{});assert(!required.recommend);
});
