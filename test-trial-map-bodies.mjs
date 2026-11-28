// 段階④の計算境界。位置は既存の実天文計算、境界/中断は入力を制御して検査する。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url),S=require('./experiments/moon-map/astronotes-shooting.js');
const B=require('./astronotes-bodies.js'),A=require('./astronotes-align.js'),Astro=require('./astronotes-astro.js'),Geo=require('./astronotes-terrain.js'),Sky=require('./astronotes-sky-map.js');
const Atmosphere=require('./astronotes-atmosphere.js');
const points=B.definitions.filter(d=>!d.limbs).map(d=>d.id),observer={latitude:35.7,longitude:139.8,elevation:31.5};
const target=A.targetById('skytree'),day=Date.parse('2026-11-26T00:00:00+09:00');
globalThis.AstroNotesCandidateDiscovery??=require('./src/features/candidates/search.js');
globalThis.AstroNotesCandidateComposition??=require('./src/features/candidates/composition.js');
const C=globalThis.AstroNotesCandidateComposition,G=require('./experiments/moon-map/src/features/candidates/generic-search.js');

test('点天体は太陽の幾何中心−6°以下、境界を含む。太陽/月には適用しない',()=>{
 for(const altitude of [-6.000001,-6,-5.999999])for(const body of points){
  const calls=[],provider={definition:B.definition,state(...args){calls.push(args);return {altitude:altitude+.5,geometricAltitude:altitude};}};
  assert.equal(S.nightAllowed(body,day,observer,provider),altitude<=-6,`${body} ${altitude}`);
  assert.deepEqual(calls,[['sun',day,observer,{refraction:false}]]);
 }
 for(const body of ['sun','moon'])assert.equal(S.nightAllowed(body,day,observer,{state(){throw Error('不要な太陽計算');}}),true);
 const bad={definition:B.definition,state:()=>({altitude:NaN})};
 assert.equal(S.nightAllowed('sirius',day,observer,bad),false);
 assert.equal(S.nightAllowed('unknown',day,observer,B),false);
 assert.equal(S.nightAllowed('sirius',NaN,observer,B),false);
 assert.equal(S.nightAllowed('sirius',day,{latitude:Infinity,longitude:139},B),false);
 assert.equal(S.nightAllowed('sirius',day,observer,{definition:B.definition,state(){throw Error('not ready');}}),false);
});

const fixtures=[
 {body:'sirius',latitude:35.74450397726105,longitude:139.70855846899983,at:1795694814927,night:true},
 {body:'sirius',latitude:35.74450389752619,longitude:139.9128415713853,at:1795644366813,night:false},
 {body:'venus',latitude:35.7302637068377,longitude:139.7029915667039,at:1795631698332,night:true},
 {body:'venus',latitude:35.730266012482176,longitude:139.91840778456188,at:1795670306160,night:false}
];
test('実計算の昼夜両方の幾何重なりから、点天体の夜だけを採る',()=>{
 for(const f of fixtures){const o={latitude:f.latitude,longitude:f.longitude,elevation:31.5},raw=A.prepareDailyView(o,target,f.body,{partId:'__whole',eyeM:0})(f.at,f.at)[0];
  assert(raw.intersects,`${f.body} ${f.night}: 生幾何の重なり`);assert.equal(S.nightAllowed(f.body,f.at,o,B),f.night);
  assert.equal(B.state('sun',f.at,o,{refraction:false}).altitude<=-6,f.night);
 }
});

test('試用版の金線は従来と同じ位置・時刻・高さを返し、操作を譲った間に失効した線を捨てる',async()=>{
 const c=vm.createContext({AstroNotesAstro:Astro,AstroNotesTerrain:Geo,AstroNotesBodies:B,AstroNotesAtmosphere:Atmosphere});
 vm.runInContext(readFileSync(new URL('./experiments/moon-map/astronotes-align.js',import.meta.url),'utf8'),c);
 const next=c.AstroNotesAlign;
 for(const body of ['moon','sun','sirius']){
  const options={partId:'tip',minKm:3,maxKm:34,stepKm:5,elevationAt:async(lat,lon)=>Math.round(lat*lon*5)%120};
  const expected=await A.line(target,body,day,options);
  const actual=structuredClone(await next.line(target,body,day,{...options,cooperate:()=>Promise.resolve()}));
  assert(expected.some(line=>line.points.length>1),body);
  assert.deepEqual(actual,expected,body);
 }
 let current=true;
 const cancelled=await next.line(target,'moon',day,{partId:'tip',isCurrent:()=>current,cooperate:()=>{current=false;return Promise.resolve();}});
 assert.equal(cancelled.length,0);
});

test('候補の輪郭だけを取得しても、全投影と同じ頂点と順序を返す',()=>{
 const c=vm.createContext({AstroNotesAstro:Astro,AstroNotesTerrain:Geo,AstroNotesBodies:B,AstroNotesAtmosphere:Atmosphere,
  AstroNotesTowerModels:A.TOWER_MODELS,AstroNotesCityModels:A.CITY_MODELS});
 vm.runInContext(readFileSync(new URL('./experiments/moon-map/astronotes-align.js',import.meta.url),'utf8'),c);
 const next=c.AstroNotesAlign;
 for(const id of ['skytree','tokyotower','tocho-building','cinderella','tower-terror','tinkerbell','fuji']){
  const t=A.targetById(id);assert(t,id);
  for(const [az,km,eyeM]of [[7,.15,1.5],[135,2,21],[259,12,0],[19,90,1.5]]){
   const p={...Geo.destination(t.latitude,t.longitude,az,km),elevation:25};
   const full=A.towerOutline(p,t,{eyeM});
   assert.deepEqual(structuredClone(next.towerOutline(p,t,{eyeM})),full,id);
   const rings=structuredClone(next.towerOutline(p,t,{eyeM,ringsOnly:true}));
   if(!full||!full.polygons){assert.deepEqual(rings,full,id);continue;}
   assert.deepEqual(rings,{polygons:full.polygons,hitPolygons:full.hitPolygons,known:full.known,schematic:full.schematic},id);
  }
 }
});

// private関数の露出はこのVMだけ。配信資産やアプリのglobalには検査用口を追加しない。
function workspace({body='sirius',bodies=B,align=A}={}){
 const h={session:{body,at:day,eyeM:1.5,partId:'__whole',target,eye:observer,observer},targetOn:true,redraw(){},skyState:(body,at,o)=>B.state(body,at,o,{refraction:false})};
 const c=vm.createContext({console,Date,Math,Promise,Map,Set,performance,Number,Object,Array,JSON,Error,Event,setTimeout,clearTimeout,requestAnimationFrame:()=>1,cancelAnimationFrame(){},document:{hidden:true,getElementById:id=>id==='skyMapView'?{hasAttribute:()=>false}:null,dispatchEvent(){}},
  AstroNotesBodies:bodies,AstroNotesAlign:align,AstroNotesShooting:S,AstroNotesSkyMap:Sky,AstroNotesAstro:Astro,AstroNotesTerrain:Geo,AstroNotesAtmosphere:Atmosphere,groundAt:async()=>30,aimIsMountain:()=>false,SkyMapUI:{workspaceHost:()=>h}});
 const source=readFileSync(new URL('./experiments/moon-map/astronotes-map-workspace.js',import.meta.url),'utf8');
 assert(source.includes('\ninit();\n'));
 vm.runInContext(source.replace('\ninit();\n','\nactive=true;viewMode="target";g.probe={lineFor,computeBand,nightBandShape,windowsAt,state:()=>lineState,band:()=>bandState,setMode:v=>viewMode=v,setBand:v=>bandState=v,setLine:v=>lineState=v,key:()=>targetKey(host())};\n'),c);
 return {h,c,probe:c.probe};
}
async function finishLine(f){f.probe.lineFor(f.h);for(let i=0;i<2000&&f.probe.state().busy;i++)await new Promise(r=>setTimeout(r,10));assert.equal(f.probe.state().busy,false,'線計算は20秒内に完了');assert(!f.probe.state().error);return f.probe.state().lines;}

test('昼の欠けた区間をまたぐ線を結ばず、1点だけ残る孤立区間も線にしない',async()=>{
 const ps=Array.from({length:7},(_,i)=>({at:day+i*60000,latitude:35+i*.01,longitude:139,elevationM:30}));
 const bodies={...B,state:(body,at)=>({altitude:[-8,-8,2,-8,-8,2,-8][Math.round((at-day)/60000)]})};
 const f=workspace({bodies,align:{...A,line:async()=>[{side:'rise',points:ps}]}}),lines=await finishLine(f);
 assert.deepEqual(JSON.parse(JSON.stringify(lines.map(l=>l.points.map(p=>p.at)))),[[ps[0].at,ps[1].at],[ps[3].at,ps[4].at]]);
});

test('実際のシリウス/金星の線は各撮影地点の夜間だけ、記録の区間も同じ判定',async()=>{
 for(const body of ['sirius','venus']){
  const f=workspace({body}),lines=await finishLine(f);assert(lines.length>0,body+': 夜の線がある');
  for(const p of lines.flatMap(l=>l.points)){const o={latitude:p.latitude,longitude:p.longitude,elevation:(p.elevationM??p.groundM??0)+1.5};assert(B.state('sun',p.at,o,{refraction:false}).altitude<=-6,body+': 線の観測地点は夜');}
  for(const p of fixtures.filter(x=>x.body===body)){const rows=f.probe.windowsAt(f.h,{latitude:p.latitude,longitude:p.longitude,elevation:30,eyeHeightAGL:1.5});assert.equal(rows.length>0,p.night,body+': 記録の昼夜');}
 }
});

test('点天体の探索seed帯は対象の横幅だけ、薄明差の保守的余裕を持つ',async()=>{
 for(const body of ['sirius','venus','sun']){
  const f=workspace({body}),runs=await f.probe.computeBand(f.h),samples=runs.flatMap(r=>r.raw);assert(samples.length>0,body);
  assert(samples.every(p=>p.hw>0));
  if(body==='sun')assert(samples.every(p=>p.w>0));else{
   assert(samples.every(p=>p.w===0),body+': 月の円盤幅/大気差余裕の角幅を付けない');
   // 最大探索距離150kmでも太陽高度差は約1.35°。昼まで広げない。
   assert(samples.every(p=>B.state('sun',p.at,target,{refraction:false}).altitude<-4.64),body+': 探索seedの薄明差の余裕を上限150kmに抑える');
  }
 }
});

test('表示帯は実撮影地点の夜だけ。短い到達距離を最大距離の薄明余裕で昼表示しない',async()=>{
 const f=workspace({body:'sirius'}),runs=await f.probe.computeBand(f.h),at=1795640520000;
 const seed=runs.flatMap(r=>r.raw).find(p=>p.at===at);assert(seed,'探索seedの保守的余裕は保持');
 assert(seed.d<2.7&&B.state('sun',at,target,{refraction:false}).altitude>-5.5,'11/26 06:02の既知の昼負例');
 const vertices=runs.flatMap(r=>{assert(Array.isArray(r.polygons),'点天体に表示用polygonsがある');return r.polygons.flat();});
 assert(vertices.length>0,'夜の表示帯は存在する');
 assert(!vertices.some(p=>p.at===at),'全到達範囲が昼の06:02には表示頂点を出さない');
 for(const p of vertices)assert(B.state('sun',p.at,{...p,elevation:31.5},{refraction:false}).altitude<=-6+1e-7,'表示帯の各頂点は実際の夜');
});

test('目標物がまだ昼でも遠方だけ夜になる帯は、夜側の面を残す',()=>{
 const f=workspace(),atTarget=ms=>B.state('sun',ms,target,{refraction:false}).altitude;
 let lo=day+16*3600000,hi=day+18*3600000;for(let i=0;i<36;i++){const mid=(lo+hi)/2;if(atTarget(mid)>-5.9)lo=mid;else hi=mid;}
 const at=(lo+hi)/2,raw=[{at},{at:at+1000}],L=[0,.01].map(d=>({latitude:target.latitude+d,longitude:target.longitude+.5})),R=[-.01,0].map(d=>({latitude:target.latitude+d,longitude:target.longitude+.5}));
 assert(raw.every(p=>atTarget(p.at)>-6));assert(L.every((p,i)=>B.state('sun',raw[i].at,p,{refraction:false}).altitude<-6));
 const shape=f.probe.nightBandShape('sirius',target,raw,L,R,1.5);assert(shape.polygons.length>0,'目標物の昼だけで夜側を丸ごと落とさない');
 for(const p of [...shape.polygons.flat(),...shape.outlines.flat()])assert(B.state('sun',p.at,p,{refraction:false}).altitude<=-6+1e-7);
});

test('日付変更線をまたぐ薄明clipの交点は近い経度側に留まる',()=>{
 const f=workspace(),target={latitude:0,longitude:179.9},at=1795673572792.2075,raw=[{at},{at:at+60000}],L=[{latitude:0,longitude:179.8},{latitude:.01,longitude:179.8}],R=[{latitude:0,longitude:-179.8},{latitude:.01,longitude:-179.8}];
 const shape=f.probe.nightBandShape('sirius',target,raw,L,R,1.5),vertices=[...shape.polygons.flat(),...shape.outlines.flat()];
 assert(vertices.length>0);for(const p of vertices){assert(Math.abs(p.longitude)>179&&Math.abs(p.longitude)<=180,'交点が経度0°側へ飛ばない '+JSON.stringify(p));assert(B.state('sun',p.at,p,{refraction:false}).altitude<=-6+1e-7);}
});

test('帯の非対象・準備中・失敗・計算済み空を区別し、異なる天体の帯を流用しない',()=>{
 const f=workspace(),api=f.c.AstroNotesMapWorkspace,s=f.h.session,key=f.probe.key();
 f.probe.setMode('obs');assert.equal(api.searchBand(s),null);f.probe.setMode('target');
 assert.equal(api.searchBand(s).status,'pending');assert.equal(api.searchBand({...s,body:'venus'}).status,'pending');
 f.probe.setLine({key,body:s.body,busy:false,error:true,lines:[]});assert.equal(api.searchBand(s).status,'error');
 f.probe.setLine({key,body:s.body,busy:false,lines:[]});f.probe.setBand({key:key+'|line',base:key,runs:[]});
 const empty=api.searchBand(s);assert.equal(empty.status,'ready');assert.equal(empty.samples.length,0);assert.equal(empty.body,s.body);
 assert.equal(api.searchBand({...s,body:'venus'}).status,'pending','ready cacheより先に天体一致を確認');
});

test('準備中/失敗/空帯は無制限探索へ戻さず、body/state/night条件を探索cacheに含める',async()=>{
 let calls=0;const never=async()=>{calls++;throw Error('帯が準備できていない探索');},engine=G.createGenericSearch({provider:{load:never,surveyed:never},bodies:{ensure:never},evaluate:never});
 const plan={owner:'fixture',target,body:'sirius',at:day,pointNight:true};
 for(const status of ['pending','error']){const r=await engine.search({...plan,seedBand:{key:'b',status,body:'sirius',target,samples:[]}});assert(r.cancelled);assert.equal(r.reason,'seed-band-'+status);}
 const empty=await engine.search({...plan,seedBand:{key:'b',status:'ready',body:'sirius',target,samples:[]}});assert.equal(empty.rows.length,0);assert.equal(empty.canContinue,false);assert.equal(calls,0);
 const p={...plan,seedBand:{key:'b',status:'pending',body:'sirius',target,samples:[]}};
 for(const changed of [{...p,pointNight:false},{...p,seedBand:{...p.seedBand,status:'ready'}},{...p,seedBand:{...p.seedBand,body:'venus'}}])assert.notEqual(G.requestKey(p),G.requestKey(changed));
});

test('最終候補は追加候補も含め、種ではなく解かれた撮影地点の薄明で判定する',async()=>{
 const source=readFileSync(new URL('./experiments/moon-map/src/features/candidates/ui.js',import.meta.url),'utf8'),start=source.indexOf('acceptCandidate:'),end=source.indexOf('},evaluate:',start);
 assert(start>0&&end>start);const acceptCandidate=vm.runInNewContext('('+source.slice(start+'acceptCandidate:'.length,end+1)+')',{AstroNotesShooting:S,AstroNotesBodies:B});
 // 目標物でちょうど薄明終わりの時刻を実計算で求め、東西の近い地点の昼夜差を使う。
 let lo=day+16*3600000,hi=day+18*3600000;for(let i=0;i<36;i++){const mid=(lo+hi)/2;if(B.state('sun',mid,target,{refraction:false}).altitude>-6)lo=mid;else hi=mid;}
 const at=(lo+hi)/2,night={...observer,longitude:target.longitude+.2},light={...observer,longitude:target.longitude-.2};
 assert(B.state('sun',at,night,{refraction:false}).altitude<=-6);assert(B.state('sun',at,light,{refraction:false}).altitude>-6);
 const row=(id,place,actual)=>({id,recommend:true,place:{...place,placeKind:'viewpoint'},assumedObserver:{...actual,eyeM:0},event:{at},placeKind:'viewpoint'});
 const bad=row('seed-night-solved-day',night,light),good=row('seed-day-solved-night',light,night),extra=row('additional-night',light,night),extraBad=row('additional-day',night,light);
 const old=C.inverseSeeds;C.inverseSeeds=async()=>({seeds:[{...observer,radiusM:300}],partial:true});
 try{
  const engine=G.createGenericSearch({bodies:B,acceptCandidate,yieldTask:async()=>{},provider:{load:async()=>({points:[{...observer,placeKind:'viewpoint'}],coverage:{nextCursor:null}})},evaluate:async()=>({...bad,additionalCandidates:[good,extra,extraBad]})});
  const result=await engine.search({owner:'fixture',target,body:'sirius',at:day,pointNight:true,timeSpec:{kind:'day',at:day}});
  assert.deepEqual(result.rows.map(r=>r.id).sort(),['additional-night','seed-day-solved-night']);
  assert.equal(acceptCandidate({body:'sirius',pointNight:false},bad),true,'従来の非夜間指定は変更しない');
 }finally{C.inverseSeeds=old;}
});
