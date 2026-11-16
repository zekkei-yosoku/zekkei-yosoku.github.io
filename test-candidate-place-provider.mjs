import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url),D=require('./src/features/candidates/search.js');
require('./src/features/candidates/place-provider.js');
const region={id:'custom-region',bbox:[139.001,35.001,139.004,35.004]};
const way=(id,tags,xy)=>({type:'way',id,tags,geometry:xy.map(([lon,lat])=>({lon,lat}))});
const ring=(w,s,e,n)=>[[w,s],[e,s],[e,n],[w,n],[w,s]];
const line=(id,tags,s,n,lon=139.002)=>way(id,{highway:'footway',...tags},[[lon,s],[lon,n]]);
const terrain={OVERPASS:['https://osm.test/query'],groundElevation:async()=>({elevation:12,source:'5m（レーザ）'}),inJapan:()=>true,waterAt:async p=>p.map(()=>false)};
const response=elements=>({ok:true,json:async()=>({osm3s:{timestamp_osm_base:'2026-11-05T00:00:00Z'},elements:[...elements,{type:'count',tags:{total:String(elements.length)}}]})});
const provider=(elements,extra={})=>D.createPlaceProvider({terrain,fetchImpl:async()=>response(elements),maxTiles:4,maxPoints:100,...extra});
test('公園ポリゴン全体を歩行面とせず、園路geometry上に任意対象の新規候補を作る',async()=>{
 const park=way(1,{leisure:'park',name:'実形状の公園'},ring(139.001,35.001,139.004,35.004));
 const empty=await provider([park]).load({target:{id:'user-building-913'}},{regions:[region]});assert.equal(empty.points.length,0);
 const result=await provider([park,line(2,{},35.0012,35.0038)]).load({target:{id:'user-building-913'}},{regions:[region]});
 assert(result.points.length>3);assert(result.points.every(p=>p.placeKind==='park'&&p.longitude===139.002));assert(result.points.every(p=>p.groundKnown&&p.standingSurfaceKnown&&p.surfaceHeightM===0));assert.equal(result.points[0].placeId,'osm/way/1');assert.equal(result.visibilityCertified,false);
 assert.equal(result.points[0].surfaceAglM,0);assert.equal(result.points[0].surfaceElevationM,12);assert.equal(result.points[0].surfaceGeometry.polygons.length,0);assert.equal(result.points[0].surfaceGeometry.lines.length,1);
});
test('堤防の上の道は広い川の河川敷、堤防の外の道は河川敷にしない',async()=>{
 // A wide river (centre line at 139.0010) with its water 0.0012 deg (~110 m) wide; levee path ~100 m from the water,
 // a street ~300 m from the water and ~350 m from the centre line.
 const river=way(11,{waterway:'river',name:'江戸川'},[[139.0010,35.000],[139.0010,35.005]]);
 const water=way(12,{natural:'water',water:'river'},ring(139.0004,35.000,139.0016,35.005));
 const levee=line(13,{},35.0015,35.0035,139.0027),street=line(14,{},35.0015,35.0035,139.0049);
 const result=await provider([river,water,levee,street]).load({}, {regions:[{id:'r',bbox:[139.0001,35.001,139.006,35.004]}]});
 const kind=lon=>new Set(result.points.filter(p=>Math.abs(p.longitude-lon)<1e-6).map(p=>p.placeKind));
 assert.deepEqual(kind(139.0027),new Set(['riverbank']));assert.deepEqual(kind(139.0049),new Set(['sidewalk']));
 assert.deepEqual(new Set(result.points.filter(p=>p.placeKind==='riverbank').map(p=>p.sourceEvidence.riverName)),new Set(['江戸川']));
 assert(result.points.filter(p=>p.placeKind==='sidewalk').every(p=>!p.sourceEvidence.riverName));
});
test('河川敷の名前は実際にそばにある水域から取り、合流部や並行する池では川名を選ばない',async()=>{
 const river=way(11,{waterway:'river',name:'River A','name:ja':'甲川'},[[139.0012,35],[139.0012,35.005]]);
 const fork=way(12,{waterway:'canal',name:'乙川'},[[139.0014,35.001],[139.0014,35.004]]);
 const geometry=ring(139.001,35,139.0016,35.005),banks=way(13,{natural:'water',water:'river'},geometry);
 const path=line(14,{name:'川テラス'},35.0015,35.0035,139.0020);
 const pond=way(15,{natural:'water',water:'pond',name:'並行する池'},ring(139.0021,35,139.0025,35.005));
 const forWater=async(data,expected)=>{
  const {points}=await provider(data).load({}, {regions:[region]});
  const pathPoints=points.filter(p=>p.sourceId==='osm/way/14');
  assert(pathPoints.length);
  assert(pathPoints.every(p=>p.placeKind==='riverbank'&&p.name==='川テラス'));
  assert.deepEqual(new Set(pathPoints.map(p=>p.sourceEvidence.riverName)),new Set([expected]));
 };
 await forWater([banks,river,path],'甲川');
 await forWater([banks,river,fork,path],undefined);
 await forWater([banks,river,{...fork,tags:{waterway:'canal'}},path],undefined);
 await forWater([banks,river,pond,path],undefined);
 await forWater([way(13,{natural:'water',water:'river',name:'River A','name:ja':'甲川'},geometry),path],'甲川');
});
test('river proximity keeps the latitude-dependent cutoff for a shore far away in longitude',async()=>{
 const lon=139.002,lat=80.0015;
 const river=way(11,{waterway:'river'},[[lon,80],[lon,80.004]]);
 const water=way(12,{natural:'water'},ring(lon-.001,80,lon,80.004));
 const lonAt=metres=>lon+metres/(111195*Math.cos(lat*Math.PI/180));
 const near=line(13,{},lat,lat+.000001,lonAt(149.99));
 const far=line(14,{},lat,lat+.000001,lonAt(150.01));
 const result=await provider([river,water,near,far]).load({}, {regions:[{bbox:[139.001,80.001,139.014,80.003]}]});
 const kindsFor=id=>new Set(result.points.filter(p=>p.sourceId==='osm/way/'+id).map(p=>p.placeKind));
 assert.deepEqual(kindsFor(13),new Set(['riverbank']));
 assert.deepEqual(kindsFor(14),new Set(['sidewalk']));
});
test('広場・河川敷・展望地点を独立geometryから作り、歩道より先に選ぶ',async()=>{
 const square=way(2,{highway:'pedestrian',area:'yes',place:'square',name:'広場'},ring(139.0011,35.0011,139.0018,35.0018));
 const riverPark=way(3,{leisure:'park',name:'川テラス'},ring(139.0021,35.0021,139.0028,35.0028));
 const view={type:'node',id:7,lat:35.0032,lon:139.0032,tags:{tourism:'viewpoint',name:'展望台',ele:'300',height:'90',level:'20'}};
 const result=await provider([line(1,{},35.0012,35.0038,139.0039),square,riverPark,line(4,{},35.0022,35.0027,139.0025),view]).load({}, {regions:[region]});
 assert.deepEqual(new Set(result.points.map(p=>p.placeKind)),new Set(['plaza','riverbank','viewpoint','sidewalk']));
 const deck=result.points.find(p=>p.placeKind==='viewpoint');assert.equal(deck.standingSurfaceKnown,false);assert.equal(deck.surfaceHeightM,null);assert.equal(deck.groundM,12);
 const firstSidewalk=result.points.findIndex(p=>p.placeKind==='sidewalk');assert(result.points.slice(firstSidewalk).every(p=>p.placeKind==='sidewalk'));
});
test('屋上庭園・建物内・橋の未知床をDEMで地上化しない。private/noは除外',async()=>{
 const roof=way(1,{leisure:'garden',name:'ドームガーデン',location:'roof',level:'7'},ring(139.001,35.001,139.003,35.003));
 const building=way(4,{building:'yes'},ring(139.0031,35.0031,139.0038,35.0038));
 const result=await provider([roof,line(2,{},35.0012,35.0028),line(3,{access:'private'},35.0012,35.0028),building,line(5,{},35.0032,35.0037,139.0035),line(6,{bridge:'yes'},35.0031,35.0038,139.0012)]).load({}, {regions:[region]});
 assert(result.points.length);assert(result.points.every(p=>p.sourceId!=='osm/way/3'&&!p.standingSurfaceKnown&&p.nonTerrainStructure));assert(result.points.every(p=>p.surfaceHeightM===null));
});
test('明示した床高根拠だけを使いheight/階数から推定しない',async()=>{
 const view={type:'node',id:1,lat:35.002,lon:139.002,tags:{tourism:'viewpoint',location:'roof','floor:height':'43.2','source:floor:height':'survey:physical-standing-floor'}};
 const result=await provider([view]).load({}, {regions:[region]});assert.equal(result.points[0].surfaceHeightM,43.2);assert.equal(result.points[0].standingSurfaceKnown,true);
 assert.equal(result.points[0].surfaceAglM,43.2);assert.equal(result.points[0].surfaceElevationM,55.2);assert(result.points[0].sourceEvidence.heightBasis.includes('height-above-local-ground'));
});
test('水上を排除しGSI欠測を0mに変換しない。樹木不明は全候補を拒否しない',async()=>{
 const items=[line(1,{},35.0012,35.0038)];
 const missing=await provider(items,{terrain:{...terrain,groundElevation:async()=>({elevation:0,source:'海'})}}).load({}, {regions:[region]});
 assert(missing.points.every(p=>p.groundM===null&&!p.groundKnown));assert(missing.partial);
 const water=await provider(items,{terrain:{...terrain,waterAt:async p=>p.map(()=>true)}}).load({}, {regions:[region]});assert.equal(water.points.length,0);
 const unknownTrees=await provider(items).load({}, {regions:[region]});assert(unknownTrees.points.every(p=>p.standingSurfaceKnown&&p.sourceEvidence.vegetation==='unknown'));
});
test('途中のtile上限をpartial＋cursorで返し、次回は異なる地域を取得する',async()=>{
 const requests=[];const p=provider([],{maxTiles:1,fetchImpl:async(url,options)=>{requests.push(options.body);return response([]);}}),regions=[{bbox:[139.001,35.001,139.014,35.004]}];
 const a=await p.load({}, {regions});assert(a.partial);assert(a.coverage.nextCursor);assert.equal(a.coverage.evaluatedRegionIds.length,1);
 const b=await p.load({}, {regions,cursor:a.coverage.nextCursor});assert.notEqual(a.coverage.evaluatedRegionIds[0],b.coverage.evaluatedRegionIds[0]);assert.notEqual(requests[0],requests[1]);
 const c=await p.load({}, {regions,cursor:b.coverage.nextCursor});assert.equal(c.coverage.nextCursor,null);assert(c.partial); // one page is not global coverage
});
test('点上限でも同じ先頭を繰り返さず全点へ続き、その後に次tileへ進める',async()=>{
 const p=provider([line(1,{},35.0012,35.0038)],{maxTiles:1,maxPoints:2}),regions=[{bbox:[139.001,35.001,139.009,35.004]}];
 let cursor=null,pages=0;const seen=new Set(),tiles=new Set();do{const r=await p.load({}, {regions,cursor});for(const p of r.points){const k=p.latitude+','+p.longitude;assert(!seen.has(k),'page must not repeat a point');seen.add(k);}r.coverage.evaluatedRegionIds.forEach(id=>tiles.add(id));cursor=r.coverage.nextCursor;assert(++pages<20);}while(cursor);
 assert(seen.size>5);assert.equal(tiles.size,2);
});
test('pointKinds skips unused height, water and point pages while keeping the retained points and coverage',async()=>{
 const square=way(2,{highway:'pedestrian',area:'yes',place:'square'},ring(139.0011,35.0011,139.0018,35.0018));
 const view={type:'node',id:7,lat:35.0032,lon:139.0032,tags:{tourism:'viewpoint'}};
 const items=[line(1,{},35.0012,35.0038,139.0039),square,view,line(3,{},35.0012,35.0038,139.007)];
 const regions=[{bbox:[139.001,35.001,139.009,35.004]}],wanted=new Set(['plaza','viewpoint']);
 async function readPages(pointKinds){
  const pages=[],calls={height:0,waterPoints:0};
  const p=provider(items,{maxTiles:1,maxPoints:3,terrain:{...terrain,
   groundElevation:async(lat)=>{calls.height++;return lat===view.lat?null:{elevation:12,source:'dem'};},
   waterAt:async(points)=>{calls.waterPoints+=points.length;return points.map(()=>false);}
  }});
  let cursor=null;
  do{
   const page=await p.load({}, {regions,cursor,pointKinds});
   pages.push(page);cursor=page.continuation;
   assert(pages.length<20);
  }while(cursor);
  return {pages,calls};
 }
 const all=await readPages(),filtered=await readPages(wanted);
 assert(filtered.pages.length<all.pages.length);
 assert.deepEqual(filtered.pages[0].continuation,all.pages[0].continuation,'the point cursor stays while eligible points remain');
 const allPoints=all.pages.flatMap(p=>p.points),retained=filtered.pages.flatMap(p=>p.points);
 assert.deepEqual(retained,allPoints.filter(p=>wanted.has(p.placeKind)));
 const tileIds=run=>new Set(run.pages.flatMap(p=>p.coverage.evaluatedRegionIds));
 const features=run=>new Map(run.pages.flatMap(p=>p.features).map(f=>[f.id,f]));
 assert.deepEqual(tileIds(filtered),tileIds(all));
 assert.deepEqual(features(filtered),features(all));
 assert.deepEqual(filtered.pages.flatMap(p=>p.coverage.failedRegions),all.pages.flatMap(p=>p.coverage.failedRegions));
 assert(retained.some(row=>row.placeKind==='viewpoint'&&!row.groundKnown));
 const skipped=filtered.pages.reduce((sum,p)=>sum+(p.coverage.pointsSkippedByKind||0),0);
 assert(skipped>0);
 const excluded=skipped+filtered.pages.reduce((sum,p)=>sum+p.coverage.pointsExcludedByKind,0);
 assert(excluded>0);
 assert.equal(all.calls.height-filtered.calls.height,excluded);
 assert.equal(all.calls.waterPoints-filtered.calls.waterPoints,excluded);
 const saturated=await provider(items,{maxPoints:1,spacingM:5}).load({}, {regions:[region],pointKinds:new Set(['park'])});
 assert.equal(saturated.points.length,0);
 assert.equal(saturated.coverage.samplingComplete,false);
 assert(saturated.continuation?.batchTiles?.length,'point generation hit its cap, so later eligible points are still possible');
});
test('一部失敗tileは成功cacheを汚さず次回cursorで再試行できる',async()=>{
 let fail=true,calls=0;const p=provider([],{maxTiles:1,fetchImpl:async()=>{calls++;if(fail)throw Error('unavailable');return response([]);}});
 const a=await p.load({}, {regions:[region]});assert(a.partial);assert.equal(a.coverage.failedRegions.length,1);assert(a.coverage.nextCursor.retryTiles.length);
 fail=false;const b=await p.load({}, {regions:[region],cursor:a.coverage.nextCursor});assert.equal(b.coverage.failedRegions.length,0);assert.equal(b.coverage.evaluatedRegionIds.length,1);assert.equal(b.coverage.nextCursor,null);assert(calls>=3);
});
test('公式map API fallbackのnode/way参照をつなぎ私有タグと名前のentityを保持',async()=>{
 const xml='<?xml version="1.0"?><osm version="0.6"><node id="1" lat="35.002" lon="139.002"/><node id="2" lat="35.003" lon="139.002"/><way id="3"><nd ref="1"/><nd ref="2"/><tag k="highway" v="footway"/><tag k="name" v="A&amp;B"/></way></osm>';
 const p=provider([],{endpoints:[],fetchImpl:async url=>{assert(url.startsWith('https://api.openstreetmap.org/api/0.6/map?bbox='));return {ok:true,text:async()=>xml};}});
 const r=await p.load({}, {regions:[region]});assert(r.points.length);assert.equal(r.points[0].name,'A&B');assert.equal(r.coverage.fetchedRegions[0].fallback,true);
});
test('中止はネット待ち中も速やかに返り成功cacheに入れない',async()=>{
 const abort=new AbortController();const p=provider([],{fetchImpl:()=>new Promise(()=>{}),timeoutMs:5000});
 const started=Date.now(),task=p.load({}, {regions:[region],signal:abort.signal});setTimeout(()=>abort.abort(),20);
 const r=await task;assert(r.cancelled);assert(r.partial);assert(Date.now()-started<1000);
});
test('地域指定なしを候補なし完了とせず、国外・日付変更・別対象に入口制限を置かない',async()=>{
 const p=provider([]);assert((await p.load({target:{id:'fuji'}})).coverage.missing.includes('no-search-regions'));
 const world={bbox:[2.291,48.851,2.294,48.854]},f=way(1,{highway:'pedestrian',area:'yes',place:'square'},ring(2.2912,48.8512,2.2938,48.8538));
 const q=provider([f],{terrain:{...terrain,groundElevation:async()=>null,inJapan:()=>false,fetchElevations:async ps=>ps.map(()=>31)}});
 const r=await q.load({target:{id:'custom-paris'},at:0},{regions:[world]});assert(r.points.length);assert(r.points.every(p=>p.groundM===31&&p.sourceEvidence.ground.resolutionM===90));
});
test('既存展望台はtargetIds制限を継承せず、公称視点高さにeyeMを重ねない',async()=>{
 const data=JSON.parse(readFileSync(new URL('./data/aim-viewpoints.json',import.meta.url))),v=data.places.find(p=>p.id==='nerima-lookout');
 const regions=[{bbox:[v.longitude-.0001,v.latitude-.0001,v.longitude+.0001,v.latitude+.0001]}],p=provider([],{loadViewpoints:async()=>data});
 const r=await p.load({target:{id:'arbitrary-user-building'}},{regions}),point=r.points.find(p=>p.placeId==='viewpoint/nerima-lookout');
 assert(point);assert.equal(point.surfaceAglM,80);assert.equal(point.surfaceElevationM,92);assert.equal(point.eyeM,0);assert.equal(point.quality,'published-viewpoint-point-model');assert.equal(point.sourceEvidence.windowOpening,'unknown');assert.equal(point.sourceEvidence.physicalFloorMeasured,false);assert(point.standingSurfaceKnown);
});
test('施設名だけの未知高さを昇格せず、OSM障害時も既設展望台の補助を保持する',async()=>{
 const loadViewpoints=async()=>({places:[{id:'known',kind:'展望台',name:'既設点',latitude:35.002,longitude:139.002,deckM:40,heightKnown:true,heightBasis:'floor',source:'survey:floor'},{id:'unknown',kind:'展望台',name:'未知点',latitude:35.003,longitude:139.003,deckM:100,heightKnown:false}]}),p=provider([],{loadViewpoints,fetchImpl:async()=>{throw Error('offline');}});
 const r=await p.load({}, {regions:[region]});assert(r.partial);assert.equal(r.points.length,1);assert.equal(r.points[0].eyeM,1.5);assert.equal(r.points[0].surfaceElevationM,52);
});
test('automatic pages leave tiles for later during cooldown, say how long to wait, and never fall back to the editing API',async()=>{
 const requests=[],regions=[{bbox:[139.001,35.001,139.009,35.004]}];
 const p=provider([],{maxTiles:1,fetchImpl:async url=>{requests.push(url);return {ok:false,status:429};}});
 const a=await p.load({}, {regions,retryFailed:false});assert.equal(a.coverage.failedRegions[0].reason,'HTTP 429');assert.deepEqual(a.coverage.nextCursor.retryTiles,[]);
 // During the cooldown the next tile is not failed: it stays pending at the same cursor, with the wait the search should observe.
 const b=await p.load({}, {regions,cursor:a.coverage.nextCursor,retryFailed:false});assert.equal(b.coverage.failedRegions.length,0);assert.equal(b.coverage.pendingRegions.length,1);
 assert(b.coverage.retryAfterMs>20000&&b.coverage.retryAfterMs<=60000);assert.equal(b.coverage.nextCursor.offset,a.coverage.nextCursor.offset);
 assert.deepEqual(requests,terrain.OVERPASS);
});
test('調査済みの地点は調べた対象にだけ出し、足元の高さとその上の高さを別に持つ',async()=>{
 const data=JSON.parse(readFileSync(new URL('./data/candidate-surveyed-viewpoints.json',import.meta.url))),p=provider([],{loadSurveyed:async()=>data});
 assert.equal(data.places.length,159);assert.equal(new Set(data.places.map(x=>x.id)).size,159);
 const sky=await p.surveyed({target:{id:'skytree'}}),tower=await p.surveyed({target:{id:'tokyotower'}}),fuji=await p.surveyed({target:{id:'fuji'}});
 assert.deepEqual([sky.length,tower.length,fuji.length],[50,36,122]);assert.deepEqual(await p.surveyed({target:{id:'custom'}}),[]);
 const room=sky.find(x=>x.name==='東京都庁 南展望室');assert.equal(room.groundM,41.2);assert.equal(room.eyeM,202);assert.equal(room.surfaceAglM,0,'a room is not refused for lacking a floor height');assert.equal(room.nonTerrainStructure,true);assert.equal(room.standingSurfaceKnown,true);assert.equal(room.placeKind,'viewpoint');
 assert.deepEqual(room.surveyedTargets.slice().sort(),['fuji','skytree','tokyotower']);assert.equal(room.sourceEvidence.kind,'surveyed-viewpoint');
 const park=tower.find(x=>x.name==='港区立芝公園 芝生広場');assert.equal(park.eyeM,1.5);assert.equal(park.nonTerrainStructure,false);
 const bridge=sky.find(x=>x.name==='晴海大橋 中央部東側歩道');assert.equal(bridge.groundM,24.2);assert.equal(bridge.nonTerrainStructure,true,'a stated floor is not the terrain');
 assert.deepEqual(await provider([],{loadSurveyed:async()=>{throw Error('data');}}).surveyed({target:{id:'skytree'}}),[],'unreadable data leaves the search going');
});
