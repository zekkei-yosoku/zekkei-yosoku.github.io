import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url),D=require('./experiments/candidate-visibility/search.js');
require('./experiments/candidate-visibility/place-provider.js');
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
