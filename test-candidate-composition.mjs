import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';const require=createRequire(import.meta.url),C=require('./src/features/candidates/composition.js'),A=require('./astronotes-align.js'),B=require('./astronotes-bodies.js'),fs=require('node:fs');
const target=A.targetById('skytree');
test('auto refraction prefilter retains a body that can overlap after weather data changes its altitude',async()=>{
 const at=0,observer={...require('./astronotes-terrain.js').destination(target.latitude,target.longitude,45,8),groundM:5,elevation:5,eyeM:1.5};
 const g=A.geometryFrom(observer,target,{partId:'tip'}),base={body:'moon',target,partId:'tip',timeSpec:{kind:'instant',at}};
 const previous=globalThis.AstroNotesAtmosphere;
 try{
  globalThis.AstroNotesAtmosphere={mode:()=> 'auto'};
  for(const [azimuth,expected] of [[g.azimuth,false],[g.azimuth+30,true]]){
   const bodies={definition:()=>({limbs:true}),state:(_body,_at,_observer,opts)=>({
    azimuth,apparentAltitude:opts?.refraction===false?g.angle-12:g.angle,angularRadius:.25
   })};
   assert.equal(C.definiteAngularMiss(base,observer,{align:A,bodies}),expected);
   if(expected)assert.equal((await C.opportunities(base,observer,{align:A,bodies,yieldTask:async()=>{}})).solutions.length,0);
   else assert.equal((await C.opportunities(base,observer,{align:A,bodies,yieldTask:async()=>{}})).solutions.length,1);
  }
 }finally{
  if(previous===undefined)delete globalThis.AstroNotesAtmosphere;else globalThis.AstroNotesAtmosphere=previous;
 }
});
test('composition validates target height, offset, limb and explicit time widths',()=>{assert(C.valid({heightM:452,xM:0,limb:'lower'},target));for(const c of [{heightM:NaN,xM:0,limb:'center'},{heightM:1,xM:0,limb:'center'},{heightM:637,xM:0,limb:'center'},{heightM:452,xM:Infinity,limb:'center'},{heightM:452,xM:0,limb:'unknown'}])assert(!C.valid(c,target));assert(C.windowValid({kind:'none'}));assert(!C.windowValid({kind:'both',beforeMin:null,afterMin:30}));assert(C.windowValid({kind:'rise',beforeMin:0,afterMin:90}));});
test('optional windows include both endpoints, neighbouring-day anchors and distinguish rise from set',()=>{const events=[{at:0,kind:'rise'},{at:600000,kind:'set'}];assert(C.inWindow(-60000,{kind:'rise',beforeMin:1,afterMin:2},events));assert(C.inWindow(120000,{kind:'rise',beforeMin:1,afterMin:2},events));assert(!C.inWindow(120001,{kind:'rise',beforeMin:1,afterMin:2},events));assert(!C.inWindow(600000,{kind:'rise',beforeMin:1,afterMin:2},events));assert(C.inWindow(600000,{kind:'both',beforeMin:1,afterMin:2},events));assert(C.inWindow(999999,{kind:'none'},events));});
test('road eligibility respects holes and bridge classification',()=>{const ring=[[139,35,0],[139.01,35,0],[139.01,35.01,0],[139,35.01,0],[139,35,0]],hole=[[139.004,35.004],[139.006,35.004],[139.006,35.006],[139.004,35.006]],f={function:'2000',coordinatesLonLatHeight:ring,interiorRingsLonLatHeight:[hole],structureClassificationKnown:true,nonTerrainStructure:false};assert(C.roadAt({features:[f]},{latitude:35.002,longitude:139.002}));assert.equal(C.roadAt({features:[f]},{latitude:35.005,longitude:139.005}),null);assert.equal(C.roadAt({features:[{...f,nonTerrainStructure:true}]},{latitude:35.002,longitude:139.002}),null);});
test('candidate-local flat-horizon rise times differ by place and include missing event kinds',()=>{const start=Date.parse('2026-12-02T00:00:00+09:00'),o={latitude:35.68626,longitude:139.73068,elevation:30.9,eyeM:1.5},r=C.riseSet('moon',start,start+86400000,o,B);assert.equal(r.filter(x=>x.kind==='rise').length,0);assert.equal(r.filter(x=>x.kind==='set').length,1);const day=Date.parse('2026-11-29T00:00:00+09:00'),one=C.riseSet('moon',day,day+86400000,o,B),two=C.riseSet('moon',day,day+86400000,{...o,latitude:35.7119,longitude:139.8089},B);assert(Math.abs(one[0].at-two[0].at)>10000);});
test('inverse solve recomputes ground and target/limb at the final position, and rejects missing ground',async()=>{const roads=JSON.parse(fs.readFileSync(new URL('./data/candidate-sidewalks.json',import.meta.url))),o={latitude:35.71099980659717,longitude:139.8085729086673,elevation:1.59,eyeM:1.5},at=1795885135040.1123,st=B.state('moon',at,{...o,elevation:o.elevation+1.5}),c={heightM:452,xM:0,limb:'center'},plan={target,body:'moon',at,composition:c,timeWindow:{kind:'none'}},solver=C.make({align:A,bodies:B,terrain:{at:()=>1.59},sidewalks:roads,yieldTask:async()=>{}}),result=await solver.solve(plan,o);assert(result.solutions.length);for(const s of result.solutions){assert(s.event.compositionResidualDeg<=.002);assert(C.roadAt(roads,s.observer));assert.equal(s.observer.elevation,1.59);const g=C.geometry(s.observer,target,c,A),state=B.state('moon',s.event.at,{...s.observer,elevation:3.09}),xy=A.viewProjector(g.azimuth,g.angle)(state.azimuth,state.apparentAltitude);assert(Math.hypot(...xy)<=.002);}const missing=C.make({align:A,bodies:B,terrain:{at:()=>null},sidewalks:roads,yieldTask:async()=>{}});assert.equal((await missing.solve(plan,o)).solutions.length,0);});

test('screen-to-target plane round trip preserves an off-centre anchor height',()=>{const G=require('./astronotes-terrain.js'),p=G.destination(target.latitude,target.longitude,180,1),o={...p,elevation:10,eyeM:1.5},c={heightM:380,xM:200,limb:'center'},g=C.geometry(o,target,c,A),back=C.screenAnchor({azimuth:g.azimuth,altitude:g.angle,obs:o,target,align:A});assert(Math.abs(back.heightM-c.heightM)<.01);assert(Math.abs(back.xM-c.xM)<.01);});
test('composition and each time-window choice have separate completed-result cache keys',()=>{const D=require('./src/features/candidates/search.js'),p={at:0,body:'moon',target},key=x=>D.keyFor(x,1,'standard'),base=key(p),c={heightM:452,xM:0,limb:'center'};assert.notEqual(key({...p,composition:c}),base);assert.notEqual(key({...p,composition:{...c,limb:'lower'}}),key({...p,composition:c}));assert.notEqual(key({...p,timeWindow:{kind:'rise',beforeMin:30,afterMin:90}}),key({...p,timeWindow:{kind:'rise',beforeMin:31,afterMin:90}}));});
test('real model rejects a hidden Moon and keeps a display-model disagreement unknown',async()=>{const M=require('./src/features/candidates/model-evaluator.js'),G=require('./src/features/candidates/building-model.js'),T=require('./src/features/candidates/terrain-model.js'),P=require('./astronotes-shooting.js'),load=n=>JSON.parse(fs.readFileSync(new URL('./data/candidate-'+({'model-buildings.json':'buildings.json','surface-samples.json':'surfaces.json'}[n]||n),import.meta.url))),index=await G.decode(load('model-buildings.json')),terrain=await T.decode(load('terrain.json')),sidewalks=load('sidewalks.json'),evaluate=M.create({align:A,bodies:B,shooting:P,index,terrain,sidewalks,surfaceAt:()=>({}),mode:'model-los',yieldTask:async()=>{}}),plan={target,body:'moon',at:Date.parse('2026-11-29T12:00:00+09:00'),partId:'gallery',limb:'behind',matchMode:'limb',composition:{heightM:452,xM:0,limb:'center'}};const hidden=await evaluate(plan,{latitude:35.70944509488773,longitude:139.80840439982288});assert.equal(hidden.recommend,false);assert(hidden.events.some(e=>e.targetOccluded));const exposed=await evaluate({...plan,composition:{heightM:636,xM:0,limb:'lower'}},{latitude:35.70868232029841,longitude:139.8082119762783});assert.equal(exposed.recommend,false);assert.equal(exposed.status,'model-unknown');assert.equal(exposed.reason,'display-model-disagreement');assert(exposed.events.some(e=>e.sceneExposure?.known&&!e.sceneExposure.visible));assert(exposed.events.some(e=>e.rays.some(r=>r.targetDepthM>0)));});

test('rise windows search neighbouring days rather than losing early-day candidates',()=>{const start=Date.parse('2026-11-29T00:00:00+09:00'),anchor=start-30*60000,bodies={state:(id,t)=>({apparentAltitude:Math.sin((t-anchor)/86400000*2*Math.PI),angularRadius:0})},plan={body:'moon',at:start,timeWindow:{kind:'rise',beforeMin:0,afterMin:60}},events=C.windowEvents(plan,{latitude:35,longitude:139,elevation:0,eyeM:1.5},bodies);assert(events.some(e=>e.kind==='rise'&&e.at<start));assert(C.inWindow(start,plan.timeWindow,events));});

test('rise and set exactly on scan endpoints are retained and not duplicated',()=>{const o={latitude:35,longitude:139,elevation:0},body=slope=>({state:(id,t)=>({apparentAltitude:slope*t/60000,angularRadius:0})});assert.equal(C.riseSet('moon',0,60000,o,body(-1))[0].kind,'set');assert.equal(C.riseSet('moon',-60000,0,o,body(1))[0].kind,'rise');assert.equal(C.riseSet('moon',-60000,60000,o,body(1)).length,1);});

test('walkway boundaries and overlapping elevated surfaces do not certify a standing point',()=>{const r=[[139,35],[139.01,35],[139.01,35.01],[139,35.01],[139,35]],f={function:'2000',coordinatesLonLatHeight:r,structureClassificationKnown:true,nonTerrainStructure:false};assert.equal(C.roadAt({features:[f]},{latitude:35.005,longitude:139}),null);assert.equal(C.roadAt({features:[f,{...f,nonTerrainStructure:true}]},{latitude:35.005,longitude:139.005}),null);});

// The anchor redesign remains unreleased. A projection becoming invalid must not crash an entire search.
test('an invalid projection after convergence safely discards the draft solution',async()=>{let n=0;const align={geometryFrom:()=>({azimuth:0,angle:10}),viewProjector:()=>()=>++n===1?[0,0]:null},bodies={state:()=>({azimuth:0,apparentAltitude:10,angularRadius:.25})},solver=C.make({align,bodies,terrain:{at:()=>1},sidewalks:{features:[]},yieldTask:async()=>{}});const result=await solver.solve({target,body:'moon',at:Date.parse('2026-11-29T12:00:00+09:00'),composition:{heightM:452,xM:0,limb:'center'}},{latitude:35.71099,longitude:139.80857});assert.equal(result.solutions.length,0);assert(n>1);});


test('visible drawing surface pick preserves the clicked ray and rejects a hidden surface point',()=>{const S=require('./src/features/candidates/scene-surface.js'),obs={latitude:35.7119003406,longitude:139.8088988752,elevation:1.01,eyeM:1.5},front=S.preset({obs,target,align:A,heightM:636,limb:'lower'}),g=C.geometry(obs,target,front,A),picked=S.pick({obs,target,align:A,azimuth:g.azimuth,altitude:g.angle,limb:'lower'});assert(picked);assert.equal(picked.basis,'scene-surface');const back=C.geometry(obs,target,picked,A);assert(Math.hypot(...A.viewProjector(g.azimuth,g.angle)(back.azimuth,back.angle))<1e-6);assert(S.visible({obs,target,align:A,composition:picked}).visible);assert(!C.valid(picked,{...target,latitude:target.latitude+.001}));const G=require('./astronotes-terrain.js'),backObs={...G.destination(target.latitude,target.longitude,142,.25),elevation:1.01,eyeM:1.5},deck=S.preset({obs,target,align:A,heightM:452});assert.equal(S.visible({obs:backObs,target,align:A,composition:deck}).visible,false);assert(!S.visible({obs,target,align:A,composition:front}).visible);assert.equal(S.pick({obs,target,align:A,azimuth:g.azimuth+90,altitude:g.angle}),null);const plane=C.geometry(obs,target,{heightM:636,xM:0,limb:'lower'},A);assert(g.angle-plane.angle>.5,'near surface depth changes apparent height materially');});

test('a real surface composition passes full model LOS and the final scene exposes the requested limb',async()=>{const S=require('./src/features/candidates/scene-surface.js'),M=require('./src/features/candidates/model-evaluator.js'),G=require('./src/features/candidates/building-model.js'),T=require('./src/features/candidates/terrain-model.js'),P=require('./astronotes-shooting.js'),load=n=>JSON.parse(fs.readFileSync(new URL('./data/candidate-'+({'model-buildings.json':'buildings.json','surface-samples.json':'surfaces.json'}[n]||n),import.meta.url))),index=await G.decode(load('model-buildings.json')),terrain=await T.decode(load('terrain.json')),roads=load('sidewalks.json'),reference={latitude:35.7119003406,longitude:139.8088988752,elevation:1.01,eyeM:1.5},surface=S.preset({obs:reference,target,align:A,heightM:636}),g=S.geometry(reference,target,surface,A),c=S.pick({obs:reference,target,align:A,azimuth:g.azimuth,altitude:g.angle,limb:'lower'}),evaluate=M.create({align:A,bodies:B,shooting:P,index,terrain,sidewalks:roads,surfaceAt:()=>({}),mode:'model-los',yieldTask:async()=>{}}),plan={target,body:'moon',at:Date.parse('2026-11-29T12:00:00+09:00'),partId:'__whole',composition:c,timeWindow:{kind:'none'}},seed={latitude:35.71120995761859,longitude:139.80833348838522},r=await evaluate(plan,seed);assert.equal(r.recommend,true);assert(r.modelEvidence.selectedSurfaceChecked&&r.modelEvidence.buildingRangeComplete&&r.modelEvidence.terrainNumericComplete);assert(r.events.some(e=>e.sceneExposure?.visible&&e.selectedSurface?.visible));assert(r.event.compositionResidualDeg<=.002);const windowed=await evaluate({...plan,timeWindow:{kind:'rise',beforeMin:0,afterMin:0}},seed);assert.equal(windowed.recommend,false,'flat-horizon zero-width window excludes this high-altitude event');});

test('surface hulls are bound to the exact drawing geometry and reject a mixed model version',()=>{const S=require('./src/features/candidates/scene-surface.js'),H=require('./src/features/candidates/scene-hulls.js'),crypto=require('node:crypto'),m=A.TOWER_MODELS.skytree;assert.equal(crypto.createHash('sha256').update(JSON.stringify(m)).digest('hex'),H.modelSha256);assert(S.model(A,target));const previous=globalThis.AstroNotesTowerModels,changed={...m,vertices:m.vertices.map((v,i)=>i?v:[v[0]+1,v[1],v[2]])};try{globalThis.AstroNotesTowerModels={skytree:changed};assert.equal(S.model(A,target),null);}finally{if(previous===undefined)delete globalThis.AstroNotesTowerModels;else globalThis.AstroNotesTowerModels=previous;}});


test('invalid composition is distinct from the previous valid search and never loads data',async()=>{const D=require('./src/features/candidates/search.js'),plan={target,body:'moon',at:0},key=p=>D.keyFor(p,1,'standard');assert.notEqual(key(plan),key({...plan,compositionInvalid:true}));let loads=0;const engine=D.create({loadData:async()=>{loads++;return {};},evaluate:async()=>({})});await assert.rejects(engine.search({...plan,compositionInvalid:true}),/invalid-composition/);assert.equal(loads,0);});

test('closest point on an outline: the boxed rings give the same answer as checking every edge',()=>{
 const inside=(r,x,y)=>{let on=false;for(let i=0,j=r.length-1;i<r.length;j=i++)if((r[i][1]>y)!==(r[j][1]>y)&&x<(r[j][0]-r[i][0])*(y-r[i][1])/(r[j][1]-r[i][1])+r[i][0])on=!on;return on;};
 const every=(p,polygons)=>{let nearest=null,distance=Infinity;for(const ring of polygons){if(inside(ring,p[0],p[1]))return {point:p,distance:0};for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],dx=b[0]-a[0],dy=b[1]-a[1],u=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1))),q=[a[0]+u*dx,a[1]+u*dy],d=Math.hypot(p[0]-q[0],p[1]-q[1]);if(d<distance){distance=d;nearest=q;}}}return {point:nearest||[0,0],distance};};
 let seed=7;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
 for(let t=0;t<300;t++){
  const polygons=Array.from({length:1+Math.floor(rnd()*12)},()=>{const cx=rnd()*20-10,cy=rnd()*20-10,n=1+Math.floor(rnd()*9);return Array.from({length:n},(_,i)=>{const a=2*Math.PI*i/n,r=.2+rnd()*3;return [cx+r*Math.cos(a),cy+r*Math.sin(a)];});});
  for(let k=0;k<20;k++){const p=[rnd()*30-15,rnd()*30-15],a=C.closestPoint(p,polygons),b=every(p,polygons);assert.equal(a.distance,b.distance);assert.deepEqual(a.point,b.point);}
 }
 const shapeObserver={latitude:35.74546,longitude:139.893785,elevation:15.6};
 const outline=A.towerOutline(shapeObserver,target);
 const project=A.viewProjector(outline.azimuth,outline.topAngle);
 const polygons=outline.polygons.map(ring=>ring.map(([az,alt])=>project(az,alt)));
 assert(polygons.length>3000);
 for(let k=0;k<180;k++){
  const p=[rnd()*.5-.25,rnd()*(outline.topAngle-outline.baseAngle+1)-(outline.topAngle-outline.baseAngle+.5)];
  assert.deepEqual(C.closestPoint(p,polygons),every(p,polygons));
 }
 // The lower-index ring is on the right of the query, in a different branch.
 const tied=[[[1,0]],[[-1,0]],...Array.from({length:39},(_,i)=>[[i<19?-2-i:2+i,0]])];
 assert.deepEqual(C.closestPoint([0,0],tied),{point:[1,0],distance:1});
 for(const p of [[1,1],[NaN,0],[0,Infinity]])assert.deepEqual(C.closestPoint(p,[]),{point:[0,0],distance:Infinity});
 for(const p of [[NaN,0],[0,Infinity]])assert.deepEqual(C.closestPoint(p,polygons),{point:[0,0],distance:Infinity});
});

test('fixed-time angular exclusion matches the part solver around the tolerance and below-target boundaries',async()=>{
 const observer={latitude:35.74546,longitude:139.893785,groundM:15.6,elevation:15.6,eyeM:1.5};
 const at=1794823200000,plan={target,body:'moon',partId:'tip',timeSpec:{kind:'instant',at}};
 const g=A.geometryFrom(observer,target,{partId:plan.partId,eyeM:observer.eyeM});
 const unproject=A.viewUnprojector(g.azimuth,g.angle);
 const degrees=Math.PI/180,limit=Math.tan(.75*degrees)/degrees;
 let misses=0,kept=0;
 for(const x of [-2,-limit-1e-7,-limit,-.25,0,.25,limit,limit+1e-7,2]){
  for(const y of [-1,-.2501,-.25,0,.25,1]){
   const [azimuth,apparentAltitude]=unproject(x,y);
   const bodies={state:()=>({azimuth,apparentAltitude,angularRadius:.25})};
   const options={align:A,bodies,yieldTask:async()=>{}};
   const result=await C.opportunities(plan,observer,options);
   const miss=C.definiteAngularMiss(plan,observer,options);
   assert.equal(miss,result.solutions.length===0,`${x}, ${y}`);
   if(miss)misses++;else kept++;
  }
 }
 assert(misses>kept&&kept>0);
});

test('angular exclusion respects off-axis outlines, upper limbs and elevation, and leaves intervals to the solver',async()=>{
 const observer={latitude:35.71,longitude:139.80,groundM:90,elevation:0,surfaceElevationM:90,eyeM:1.5};
 const plan={target,body:'moon',partId:'__whole',timeSpec:{kind:'instant',at:0}};
 let outlines=0;
 const align={...A,geometryFrom:()=>({azimuth:0,angle:10,distanceKm:1,topM:100}),
  viewProjector:(a,h)=>(x,y)=>x>90?null:[x-a,y-h],outlineScreenBounds:undefined,
  towerOutline:()=>{outlines++;return {known:true,polygons:[[[1.9,9.8],[2.1,9.8],[2.1,10.2],[1.9,10.2]]]};}};
 const sky={azimuth:2,apparentAltitude:10,angularRadius:.25};
 const options={align,bodies:{state:()=>sky},yieldTask:async()=>{}};
 assert.equal(C.definiteAngularMiss(plan,observer,options),false);
 assert.equal(outlines,0,'the cheap check does not construct the target model');
 assert.equal((await C.opportunities(plan,observer,options)).solutions.length,1);
 const withSky=state=>({...options,bodies:{state:()=>({...sky,...state})}});
 const low=withSky({apparentAltitude:-.8,upperAltitude:-.2});
 assert.equal(C.definiteAngularMiss(plan,observer,low),false,'the actual refracted upper limb reaches the elevated horizon');
 assert.equal(C.definiteAngularMiss(plan,{...observer,surfaceElevationM:0},low),true);
 assert.equal(C.definiteAngularMiss(plan,observer,withSky({azimuth:180})),true);
 assert.equal(C.definiteAngularMiss(plan,observer,withSky({azimuth:NaN})),false);
 assert.equal(C.definiteAngularMiss({...plan,strict:true},observer,withSky({azimuth:180})),false);
 assert.equal(C.definiteAngularMiss({...plan,timeWindow:{kind:'rise',beforeMin:0,afterMin:0}},observer,withSky({azimuth:180})),false);
 const window={...plan,timeSpec:{kind:'window',start:0,end:10000}};
 const changing={...options,bodies:{state:(_,t)=>({...sky,azimuth:t===5000?2:45})}};
 assert.equal(C.definiteAngularMiss(window,observer,changing),false);
 assert((await C.opportunities(window,observer,changing)).solutions.some(s=>s.event.at===5000));
});

test('fixed-time whole-target bounds contain the real Skytree outline and preserve every solver hit',async()=>{
 const observer={latitude:35.7109998066,longitude:139.808572909,groundM:1.59,elevation:1.59,eyeM:1.5};
 const plan={target,body:'moon',partId:'__whole',timeSpec:{kind:'instant',at:1795885135040.1123}};
 const options={align:A,bodies:B,yieldTask:async()=>{}};
 let rejected=0,hits=0,finiteBounds=0;
 for(const dy of [-.006,-.0008,0,.0008,.006])for(const dx of [-.006,0,.006]){
  const o={...observer,latitude:observer.latitude+dy,longitude:observer.longitude+dx};
  const g=A.geometryFrom(o,target,{partId:null,eyeM:o.eyeM});
  const box=A.outlineScreenBounds(o,target,g,{eyeM:o.eyeM});
  if(box){
   assert(Object.values(box).every(Number.isFinite));
   finiteBounds++;
   const project=A.viewProjector(g.azimuth,g.angle);
   const outline=A.towerOutline(o,target,{eyeM:o.eyeM});
   for(const ring of outline.hitPolygons||outline.polygons)for(const v of ring){
    const q=project(...v);
    if(!q)continue;
    assert(q[0]>=box.minX&&q[0]<=box.maxX&&q[1]>=box.minY&&q[1]<=box.maxY);
   }
  }
  const miss=C.definiteAngularMiss(plan,o,options);
  const found=(await C.opportunities(plan,o,options)).solutions.length>0;
  if(miss){assert.equal(found,false);rejected++;}
  if(found)hits++;
 }
 assert(rejected>0&&hits>0&&finiteBounds>0);
});

test('whole-target angular bounds defer when the first part moves the camera axis off the model centre',()=>{
 const observer={latitude:35.74546,longitude:139.893785,groundM:15.6,elevation:15.6,eyeM:1.5};
 const [tip,...parts]=target.parts;
 const shifted={...target,parts:[{...tip,latitude:target.latitude,longitude:target.longitude+.001},...parts]};
 const normal=A.geometryFrom(observer,target,{partId:null,eyeM:observer.eyeM});
 const moved=A.geometryFrom(observer,shifted,{partId:null,eyeM:observer.eyeM});
 assert.notEqual(moved.azimuth,normal.azimuth);
 assert(A.outlineScreenBounds(observer,target,normal,{eyeM:observer.eyeM}));
 assert.equal(A.outlineScreenBounds(observer,shifted,moved,{eyeM:observer.eyeM}),null);
 const plan={target:shifted,body:'moon',partId:'__whole',timeSpec:{kind:'instant',at:0}};
 const bodies={state:()=>({azimuth:moved.azimuth+5,apparentAltitude:moved.angle,angularRadius:.25})};
 assert.equal(C.definiteAngularMiss(plan,observer,{align:A,bodies}),false);
});


test('named overlap accepts disc edges but excludes mere proximity before heavy visibility work',async()=>{
 const observer={latitude:35.75,longitude:139.85,elevation:20,eyeM:1.5},g=A.geometryFrom(observer,target,{partId:'tip',eyeM:1.5});
 const plan={body:'sun',target,partId:'tip',matchMode:'overlap',timeSpec:{kind:'instant',at:0}};
 for(const dy of [-.24,0,.24,.3,-.6]){
  const bodies={definition:()=>({limbs:true}),state:()=>({azimuth:g.azimuth,apparentAltitude:g.angle+dy,angularRadius:.25})};
  const result=await C.opportunities(plan,observer,{align:A,bodies,yieldTask:async()=>{}});
  assert.equal(result.solutions.length,Math.abs(dy)<.25?1:0,String(dy));
  if(result.solutions.length){const e=result.solutions[0].event;assert.equal(e.matchMode,'overlap');assert.equal(e.targetAzimuth,g.azimuth);assert.equal(e.targetAltitude,g.angle);}
 }
});

test('部位の目安は現在地近くの線上で時刻も解き、標高通信をしない',async()=>{
 const at=Date.parse('2026-11-19T14:27:00+09:00'),one={...target,parts:target.parts.filter(p=>p.id==='tip')},[reference]=A.observerGuides(one,'moon',{at,groundM:4}),G=require('./astronotes-terrain.js');assert(reference);
 const a=G.destination(reference.latitude,reference.longitude,0,.2),b=G.destination(reference.latitude,reference.longitude,180,.2),domain={origin:reference,radiusM:600,geometry:{lines:[[[a.longitude,a.latitude],[b.longitude,b.latitude]]],polygons:[]}};
 const {guides}=await C.localGuides({target:one,body:'moon',at:at+60000},domain,{groundM:4,align:A,bodies:B,yieldTask:async()=>{}});assert.equal(guides.length,1);
 const guide=guides[0];assert(Math.abs(guide.longitude-reference.longitude)<1e-7);assert(Math.abs(guide.at-at)<2*3600000);assert(G.distanceKm(reference.latitude,reference.longitude,guide.latitude,guide.longitude)<.601);
 const obs={...guide,elevation:4},g=A.geometryFrom(obs,one,{partId:'tip',eyeM:1.5}),body=B.state('moon',guide.at,{...obs,elevation:5.5});assert(Math.hypot(...A.viewProjector(g.azimuth,g.angle)(body.azimuth,body.apparentAltitude))<.002);
 const cancelled=await C.localGuides({target:one,body:'moon',at},domain,{groundM:4,align:A,bodies:B,isCurrent:()=>false});assert.equal(cancelled.guides.length,0);
});

test('近くの短い園路で予算を使う前に、逆算軌跡が交わる園路へ絞る',async()=>{
 const at=Date.parse('2026-11-19T14:27:00+09:00'),one={...target,parts:target.parts.filter(p=>p.id==='tip')},[p]=A.observerGuides(one,'moon',{at,groundM:4}),G=require('./astronotes-terrain.js'),origin=G.destination(p.latitude,p.longitude,180,.3);
 const lines=Array.from({length:60},(_,i)=>{const a=G.destination(origin.latitude,origin.longitude,90,i*.0001),b=G.destination(a.latitude,a.longitude,0,.002);return [[a.longitude,a.latitude],[b.longitude,b.latitude]];});
 const a=G.destination(p.latitude,p.longitude,0,.05),b=G.destination(p.latitude,p.longitude,180,.05);lines.push([[a.longitude,a.latitude],[b.longitude,b.latitude]]);
 let heavy=0;const align={...A,geometryFrom:(...args)=>{heavy++;return A.geometryFrom(...args);}},r=await C.localGuides({target:one,body:'moon',at},{origin,radiusM:600,geometry:{lines,polygons:[]}},{groundM:4,align,bodies:B,yieldTask:async()=>{}});
 assert.equal(r.guides.length,1);assert.equal(r.partial,false);assert(heavy<100,'constrained Newton starts at the coarse trajectory crossing');assert(Math.abs(r.guides[0].at-at)<1000);
});

test('面の粗い逆算点も通常の天体と部位で検算し、途中の取消を成功にしない',async()=>{
 const at=Date.parse('2026-11-19T14:27:00+09:00'),one={...target,parts:target.parts.filter(p=>p.id==='tip')},[p]=A.observerGuides(one,'moon',{at,groundM:4}),x=p.longitude,y=p.latitude,domain={origin:p,radiusM:600,geometry:{lines:[],polygons:[[[[x-.001,y-.001],[x+.001,y-.001],[x+.001,y+.001],[x-.001,y+.001],[x-.001,y-.001]]]]}};
 let checks=0;const align={...A,geometryFrom:(...args)=>{checks++;return A.geometryFrom(...args);}},r=await C.localGuides({target:one,body:'moon',at},domain,{groundM:4,align,bodies:B,yieldTask:async()=>{}});assert.equal(r.guides.length,1);assert(checks>0);assert.equal(r.guides[0].eyeM,1.5);assert.equal(r.guides[0].groundM,4);
 let current=true;const cancelled=await C.localGuides({target:one,body:'moon',at},domain,{groundM:4,align,bodies:B,isCurrent:()=>current,yieldTask:async()=>{current=false;}});assert(cancelled.cancelled);assert(cancelled.partial);assert.equal(cancelled.guides.length,0);
});
