import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';

const require=createRequire(import.meta.url);
const A=require('../astronotes-astro.js');
const R=require('../astronotes-routes.js');
const P=require('../experiments/moon-map/astronotes-plane.js');
const DEG=Math.PI/180;
const realAt=Date.parse('2026-11-24T17:00:00+09:00');
const observer={latitude:35.6,longitude:139.8,groundM:50,eyeHeightAGL:1.5};
const absolute=o=>({...o,elevation:o.groundM+o.eyeHeightAGL});

// Independent inverse of targetElevationAngle. This builds a known physical
// point on a selected sky ray, rather than obtaining the oracle from our solver.
function pointOnRay(obs,az,alt,km){
  const earth=6371.0088*A.REFRACTION_K,angle=km/earth;
  const h=(earth+(obs.groundM+obs.eyeHeightAGL)/1000)/(Math.cos(angle)-Math.tan(alt*DEG)*Math.sin(angle));
  return {...R.destination(obs.latitude,obs.longitude,az,km),altitudeM:(h-earth)*1000};
}
function crossingPath(obs,moon,widthKm=0.5){
  const p=pointOnRay(obs,moon.azimuth,moon.apparentAltitude,8);
  return {id:'test route',kind:'landing',runway:'X',airportId:'TEST',points:[
    {...R.destination(p.latitude,p.longitude,moon.azimuth-90,widthKm),altitudeM:p.altitudeM},
    {...R.destination(p.latitude,p.longitude,moon.azimuth+90,widthKm),altitudeM:p.altitudeM}
  ]};
}
function syntheticEngine(moon){
  const scope={AstroNotesAstro:{...A,moonDirection:()=>({...moon})},AstroNotesRoutes:R,module:{exports:{}}};
  vm.runInNewContext(readFileSync(new URL('../experiments/moon-map/astronotes-plane.js',import.meta.url),'utf8'),scope);
  return scope.module.exports;
}

test('real inverse resolves center and lunar limb from the same observer height',()=>{
  const moon=A.moonDirection(realAt,absolute(observer));
  const point=pointOnRay(observer,moon.azimuth,moon.apparentAltitude,8);
  const solved=P.inverseGroundAt(realAt,point,observer);
  assert.equal(solved.status,'ready');
  assert.ok(P.distanceKm(observer.latitude,observer.longitude,solved.latitude,solved.longitude)<0.00001);
  for(const diskAngle of [0,Math.PI/2,Math.PI,3*Math.PI/2]){
    const edge=P.inverseGroundAt(realAt,point,{...observer,diskAngle});
    assert.equal(edge.status,'ready');
    const actual=A.moonDirection(realAt,absolute(edge));
    const seen=P.seenFrom(absolute(edge),point,0);
    const sep=P.separation(seen.azimuth,seen.altitude,actual.azimuth,actual.apparentAltitude);
    assert.ok(Math.abs(sep-actual.angularRadius)<1e-5,`${diskAngle}: ${sep}`);
    assert.ok(edge.angularErrorDeg<1e-5);
  }
});

test('narrow crossing between endpoints and north wrap produces clipped physical polylines',()=>{
  const moon={azimuth:359.8,apparentAltitude:12,angularRadius:0.245};
  const engine=syntheticEngine(moon),path=crossingPath(observer,moon,1);
  for(const endpoint of path.points){
    const v=engine.seenFrom(absolute(observer),endpoint,0);
    assert.ok(engine.separation(v.azimuth,v.altitude,moon.azimuth,moon.apparentAltitude)>moon.angularRadius);
  }
  const r=engine.routeOverlapAt(realAt,observer,[path]);
  assert.equal(r.status,'ready');assert.equal(r.overlaps.length,1);
  assert.ok(r.closest.minSeparationDeg<0.001);
  const line=r.overlaps[0].points;
  for(const point of line){
    const v=engine.seenFrom(absolute(observer),point,0);
    assert.ok(engine.separation(v.azimuth,v.altitude,moon.azimuth,moon.apparentAltitude)<=moon.angularRadius+1e-6);
  }
  for(const point of [line[0],line.at(-1)]){
    const v=engine.seenFrom(absolute(observer),point,0);
    assert.ok(Math.abs(engine.separation(v.azimuth,v.altitude,moon.azimuth,moon.apparentAltitude)-moon.angularRadius)<1e-5);
  }
  const back=crossingPath(observer,{...moon,azimuth:179.8},1);
  assert.equal(engine.routeOverlapAt(realAt,observer,[back]).overlaps.length,0);
});

test('distance limits retain an internal grazing interval and clips stay in range',()=>{
  const moon={azimuth:0,apparentAltitude:10,angularRadius:0.28};
  const engine=syntheticEngine(moon),path=crossingPath(observer,moon,2);
  const r=engine.routeOverlapAt(realAt,observer,[path],{minPlaneKm:7.9,maxPlaneKm:8.001});
  assert.ok(r.overlaps.length>0);
  for(const hit of r.overlaps)for(const p of hit.points){
    const d=engine.distanceKm(observer.latitude,observer.longitude,p.latitude,p.longitude);
    assert.ok(d>=7.9-1e-7&&d<=8.001+1e-7,`${d}`);
  }
});

test('ground samples preserve missing elevations and honor each sample height/horizon',()=>{
  const moon=A.moonDirection(realAt,absolute(observer));
  const path=crossingPath(observer,moon);
  const r=P.groundOverlapAt(realAt,[observer,{...observer,id:'high',groundM:250},
    {...observer,id:'missing',groundM:null},{...observer,id:'blocked',horizonAt:()=>60}],[path]);
  assert.equal(r.samples[0].overlap,true);assert.ok(r.samples[0].score>0.99);
  assert.equal(r.samples[1].overlap,false);
  assert.equal(r.samples[2].status,'missing-elevation');assert.equal(r.samples[2].score,null);assert.equal(r.samples[2].overlap,null);
  assert.equal(r.samples[3].status,'below-horizon');assert.equal(r.samples[3].overlap,false);
  // One selected observer horizon cannot silently mask every ground sample.
  assert.equal(P.groundOverlapAt(realAt,[observer],[path],{horizonAt:()=>90}).samples[0].overlap,true);
});

test('time changes and equal absolute lens heights affect both lunar and aircraft directions consistently',()=>{
  const moon=A.moonDirection(realAt,absolute(observer)),path=crossingPath(observer,moon);
  const a=P.routeOverlapAt(realAt,observer,[path]);
  const b=P.routeOverlapAt(realAt,{...observer,groundM:0,eyeHeightAGL:51.5},[path]);
  assert.deepEqual(a.overlaps,b.overlaps);assert.deepEqual(a.moon,b.moon);
  assert.equal(P.routeOverlapAt(realAt+30*60000,observer,[path]).overlaps.length,0);
  assert.equal(a.moon.angularRadius,moon.angularRadius);
  assert.notEqual(a.moon.angularRadius,P.MOON_RADIUS_DEG);
  const later=P.routeOverlapAt(realAt+14*86400000,observer,[path]);
  assert.notEqual(later.moon.angularRadius,a.moon.angularRadius);
});

test('inverse terrain correction moves the band and invalid data cannot become sea-level candidates',()=>{
  const moon=A.moonDirection(realAt,absolute(observer)),point=pointOnRay(observer,moon.azimuth,moon.apparentAltitude,8);
  const low=P.inverseGroundAt(realAt,point,{groundM:0,eyeHeightAGL:1.5});
  const high=P.inverseGroundAt(realAt,point,{groundM:200,eyeHeightAGL:1.5,anchor:low});
  assert.equal(low.status,'ready');assert.equal(high.status,'ready');assert.ok(high.planeKm<low.planeKm);
  assert.ok(P.distanceKm(low.latitude,low.longitude,high.latitude,high.longitude)>0.5);
  assert.equal(P.inverseGroundAt(realAt,point,{groundM:null}).status,'missing-elevation');
  assert.equal(P.inverseGroundAt(NaN,point,{groundM:0}).status,'invalid-time');
  assert.equal(P.routeOverlapAt(realAt,{...observer,groundM:undefined},[]).status,'missing-elevation');
});

test('legacy deck floors and explicit lens AGL give equal daily crossings without an extra 1.5m',()=>{
  const day=Date.parse('2026-11-24T00:00:00+09:00');
  const spot={id:'x',name:'test',latitude:35.313,longitude:139.8108,elevationM:0};
  const paths=P.pathsFor('north',{landing:true});
  const legacy=P.rankSpots(day,paths,[{...spot,deckM:150}],{limit:1})[0];
  const explicit=P.rankSpots(day,paths,[{...spot,eyeHeightAGL:151.5}],{limit:1})[0];
  assert.ok(legacy&&explicit);assert.deepEqual(legacy.crossings,explicit.crossings);
});

test('ribbon seeds are unverified, bounded in count, and retain linked center/limb topology',()=>{
  const paths=P.pathsFor('north',{landing:true,takeoff:true});
  const r=P.groundRibbonSeedsAt(realAt,paths,{stepKm:2,capSteps:8});
  assert.equal(r.status,'seed');assert.equal(r.terrainVerified,false);
  assert.ok(r.seeds.length>50&&r.seeds.length<=400,`${r.seeds.length}`);
  const ids=new Set(r.seeds.map(s=>s.id));assert.equal(ids.size,r.seeds.length);
  for(const ribbon of r.ribbons){
    for(const section of ribbon.sections)for(const id of Object.values(section))assert.ok(ids.has(id));
    assert.equal(ribbon.startCapIds.length,8);assert.equal(ribbon.endCapIds.length,8);
  }
  for(const seed of r.seeds.filter(s=>s.status==='ready')){
    const p=P.seenFrom(absolute(seed),seed.planePoint,0),moon=A.moonDirection(realAt,absolute(seed));
    const actual=P.separation(p.azimuth,p.altitude,moon.azimuth,moon.apparentAltitude);
    assert.ok(Math.abs(actual-(seed.diskAngle===null?0:moon.angularRadius))<1e-5);
  }
});

test('seed topology preserves bends, subdivides sparse segments, and never bridges missing route vertices',()=>{
  const points=[{latitude:35.5,longitude:139.8,altitudeM:1000},
    {latitude:35.55,longitude:139.8,altitudeM:1100},
    {latitude:35.55,longitude:139.85,altitudeM:1200}];
  const route={id:'curve',kind:'takeoff',runway:'Y',points};
  const r=P.groundRibbonSeedsAt(realAt,[route],{stepKm:2});
  const centers=r.seeds.filter(s=>s.edge==='center');
  assert.ok(centers.some(s=>s.planePoint.latitude===points[1].latitude&&s.planePoint.longitude===points[1].longitude));
  for(let i=1;i<centers.length;i++){
    const a=centers[i-1].planePoint,b=centers[i].planePoint;
    assert.ok(P.distanceKm(a.latitude,a.longitude,b.latitude,b.longitude)<=2+1e-7);
  }
  const missing=P.groundRibbonSeedsAt(realAt,[{...route,points:[points[0],null,points[2]]}]);
  assert.equal(missing.ribbons.length,0);assert.deepEqual(missing.invalidPathIds,['curve']);
  const paths=P.pathsFor('north',{landing:true,takeoff:true});
  assert.ok(paths.every(p=>p.airportId==='RJTT'&&p.altitudeDatum==='MSL'&&p.model==='representative'));
  assert.ok(paths.every(p=>p.flightOrder===(p.kind==='landing'?-1:1)));
});

test('2000 surface samples have finite bounded work and leave inputs untouched',()=>{
  const moon=A.moonDirection(realAt,absolute(observer)),path=crossingPath(observer,moon);
  const samples=Array.from({length:2000},(_,i)=>Object.freeze({...observer,
    ...R.destination(observer.latitude,observer.longitude,(i%80)*4.5,Math.floor(i/80)*0.012)}));
  const t=performance.now(),result=P.groundOverlapAt(realAt,samples,[path]),elapsed=performance.now()-t;
  assert.equal(result.samples.length,2000);assert.equal(result.stats.total,2000);
  assert.ok(result.samples.some(s=>s.overlap));assert.ok(result.samples.some(s=>!s.overlap));
  assert.ok(elapsed<3000,`2000 samples took ${elapsed.toFixed(1)}ms`);
  console.log(`groundOverlapAt 2000 samples / one narrow route: ${elapsed.toFixed(1)}ms`);
});

test('every operation uses the published procedures for its arrivals and departures',()=>{
 // Load the trial routes with the trial engine, as the browser does (globals, not the production require path).
 const context=vm.createContext({});
 for(const file of ['../astronotes-astro.js','../experiments/moon-map/astronotes-routes.js','../experiments/moon-map/astronotes-plane.js'])
  vm.runInContext(readFileSync(new URL(file,import.meta.url),'utf8'),context);
 const plane=context.AstroNotesPlane,paths=plane.pathsFor('dsfi2',{landing:true,takeoff:true});
 const byId=Object.fromEntries(paths.map(p=>[p.id,p]));
 for(const id of ['16L 着陸','16R 着陸']){assert.equal(byId[id].model,'procedure');assert.match(byId[id].source,/AIP RJTT IAC/);assert.ok(byId[id].points.at(-1).distanceKm>30);}
 for(const op of Object.keys(context.AstroNotesRoutes.OPERATIONS))for(const p of plane.pathsFor(op,{landing:true,takeoff:true})){assert.equal(p.model,'procedure',p.id);assert.match(p.source,p.kind==='landing'?/AIP RJTT IAC/:/AIP RJTT SID/);}
 // Each MLIT class draws its own approaches and departures (2026-11-25 ユーザー「悪天好天もない？」「北風も種類あるよね？」).
 const src=(op,id)=>plane.pathsFor(op,{landing:true,takeoff:true}).find(p=>p.id===id)?.source;
 const passes=(op,id,lat,lon)=>plane.pathsFor(op,{landing:true,takeoff:true}).find(p=>p.id===id).points.some(q=>Math.abs(q.latitude-lat)<0.01&&Math.abs(q.longitude-lon)<0.01);
 assert.match(src('dnfi1','34L 着陸'),/ILS X RWY34L/);assert.match(src('dnfo1','34L 着陸'),/ILS Z RWY34L/);assert.ok(passes('dnfi1','34L 着陸',35.41033,139.85153),'fine 34L passes AVION over the bay');
 assert.match(src('dnfi1','34R 離陸'),/BEKLA 3A/);assert.ok(passes('dnfi1','34R 離陸',35.610222,139.836389),'usual 34R departure turns to TORAM');
 assert.match(src('dnfi2','34R 離陸'),/BEKLA 4B/);assert.ok(passes('dnfi2','34R 離陸',35.64689,139.84497),'new-route 34R departure follows the Arakawa (ARAKA)');
 assert.match(src('dsfi1','22 着陸'),/LDA W RWY22/);assert.match(src('dsfo1','22 着陸'),/ILS RWY22/);assert.ok(passes('dsfo1','22 着陸',35.831056,140.0655),'foul 22 passes NIFTY');
 assert.match(src('dsfi1','23 着陸'),/LDA W RWY23/);assert.match(src('dsfo1','23 着陸'),/ILS Z RWY23/);assert.ok(passes('dsfi1','23 着陸',35.571253,140.078714),'fine 23 passes DAMBO');
 assert.match(src('dsfi2','16L 着陸'),/RNP RWY16L/);assert.match(src('dsfo2','16L 着陸'),/ILS RWY16L/);assert.ok(passes('dsfo2','16L 着陸',35.82128,139.635),'foul 16L passes LINEN');
 assert.match(src('dsfo2','16R 着陸'),/ILS RWY16R/);assert.equal(plane.pathsFor('dsfi2',{landing:false,takeoff:true}).map(p=>p.runway).join(),'22,16R');
 assert.match(src('nonN','34L 着陸（深夜）'),/ILS Y RWY34L/);assert.match(src('nonS','23 着陸（深夜）'),/LDA Y RWY23/);
 const seeds=plane.groundRibbonSeedsAt(Date.parse('2026-11-24T16:30:00+09:00'),paths,{eyeHeightAGL:1.5,stepKm:0.5,minPlaneKm:2,maxPlaneKm:20,capSteps:6});
 const turn=seeds.seeds.filter(s=>s.pathId==='16L 着陸'&&s.edge==='center'&&s.status==='ready'&&s.planePoint.distanceKm>20);
 assert.ok(turn.length>10,'the turn before the final yields ground-line seeds');
});
