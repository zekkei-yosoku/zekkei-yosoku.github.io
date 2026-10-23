import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),AL=require('./astronotes-align.js'),TR=require('./astronotes-terrain.js');
const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8'),data=JSON.parse(fs.readFileSync(new URL('./data/aim-viewpoints.json',import.meta.url),'utf8'));
const grab=name=>{const i=html.indexOf(name);assert.ok(i>=0);return html.slice(i,html.indexOf('\n}\n',i)+2)};
const ctx={aim:{target:AL.targetById('fuji')},AstroNotesAlign:AL,AstroNotesTerrain:TR};
vm.createContext(ctx);vm.runInContext(grab('function aimCandidateSiteSupported')+grab('function aimCandidateAccessible'),ctx);
const at=(date,time)=>Date.parse(`${date}T${time}:00+09:00`);
test('目標別に根拠のある登録点を選び、一般道路・未確認・高さ不明は推薦しない',()=>{
 for(const id of ['nerima-lookout','tocho-south','shibuya-sky-lookout']){const p=data.places.find(x=>x.id===id);assert.ok(p);assert.equal(ctx.aimCandidateSiteSupported(p),true);assert.equal(p.heightBasis,'published-viewpoint');assert.match(p.sightline.source,/^https:/);}
 for(const p of data.pending)assert.equal(ctx.aimCandidateSiteSupported(p),false);
 for(const kind of ['橋','海岸','展望台'])assert.equal(ctx.aimCandidateSiteSupported({kind,name:'富士見'}),false);
 const wakasu=data.places.find(x=>x.id==='wakasu-terror');assert.equal(ctx.aimCandidateSiteSupported(wakasu),false);
 ctx.aim.target=AL.targetById('tower-terror');assert.equal(ctx.aimCandidateSiteSupported(wakasu),true);ctx.aim.target=AL.targetById('fuji');
});
test('練馬は日本時間の利用時間・第4日曜・年末年始を候補へ通さない',()=>{
 const p=data.places.find(x=>x.id==='nerima-lookout');
 for(const [day,time] of [['2026-10-12','08:59'],['2026-10-12','21:30'],['2026-10-25','16:00'],['2026-12-29','16:00'],['2027-01-03','16:00']])assert.equal(ctx.aimCandidateAccessible(p,at(day,time)),false);
 for(const [day,time] of [['2026-10-12','09:00'],['2026-10-12','21:29'],['2026-10-18','16:00'],['2027-01-04','16:00']])assert.equal(ctx.aimCandidateAccessible(p,at(day,time)),true);
 assert.equal(ctx.aimCandidateAccessible(p,NaN),false);
});
test('公称眺望80mと床78.5m＋目1.5mは実際の候補計算で同じ時刻・角度になる',async()=>{
 const target=AL.targetById('skytree'),day=at('2026-10-20','00:00');
 const lines=await AL.line(target,'sun',day,{sides:['set'],minKm:5,maxKm:20,stepKm:1,partId:'tip',limb:'center',elevationAt:async()=>78.5});
 const point=lines[0].points.find(p=>p.distanceKm>=10),common={shape:'point',latitude:point.latitude,longitude:point.longitude};
 const places=[{...common,id:'published',deckM:80,heightBasis:'published-viewpoint'},{...common,id:'floor',deckM:78.5}];
 const rows=await AL.candidates(lines,places,target,'sun',{partId:'tip',limb:'center',requireFreshElevation:true,elevationAt:async()=>0});
 assert.equal(rows.length,2);assert.equal(rows[0].at,rows[1].at);assert.equal(rows[0].targetAngle,rows[1].targetAngle);assert.equal(rows[0].stand.elevationM,0);
 assert.equal(AL.placeEyeM(places[0]),80);assert.equal(AL.placeEyeM(places[1]),80);
});
test('見通しを確認した点を水面判定時に別の道へ移動しない',async()=>{
 let moves=0;const c={place:data.places[0],stand:{latitude:35,longitude:139}};
 const k={AIM_STAND_ON_WATER_OK:new Set(['橋']),AstroNotesTerrain:{waterAt:async()=>[true]},aimMoveToLand:()=>{moves++;return c;}};
 const f=vm.runInNewContext(grab('async function aimOnLand')+';aimOnLand',k);
 assert.equal(await f(c,[],{}),null);assert.equal(moves,0);
 k.AstroNotesTerrain.waterAt=async()=>[false];assert.equal(await f(c,[],{}),c);
});
test('登録点の読込失敗を保持せず、正常なデータは同時呼出しで再利用する',async()=>{
 let calls=0,bad=true;const k={aimPlacesPromise:null,fetch:async()=>{calls++;return{ok:true,json:async()=>bad?{version:9,places:[]} : data}}};
 const f=vm.runInNewContext(grab('function aimPlaces')+';aimPlaces',k);
 await assert.rejects(f(),/データ/);assert.equal(k.aimPlacesPromise,null);bad=false;
 const [a,b]=await Promise.all([f(),f()]);assert.equal(a,b);assert.equal(a.length,data.places.length);assert.equal(calls,2);assert.ok(a.every(p=>!data.pending.some(q=>q.id===p.id)));
});

test('都庁の定期休室と祝日振替を区別し、未公表年の可能性を確認済みにしない',()=>{
 const p=data.places.find(x=>x.id==='tocho-south');
 assert.equal(ctx.aimCandidateAccessible(p,at('2026-10-20','16:00')),false);
 assert.equal(ctx.aimCandidateAccessible(p,at('2026-11-03','16:00')),true);
 assert.equal(ctx.aimCandidateAccessible(p,at('2026-11-04','16:00')),false);
 assert.equal(ctx.aimCandidateAccessible(p,at('2026-05-05','16:00')),true);
 assert.equal(ctx.aimCandidateAccessible(p,at('2026-05-06','16:00')),true);
 assert.equal(ctx.aimCandidateAccessible(p,at('2026-05-07','16:00')),false);
 assert.equal(ctx.aimCandidateAccessible(p,at('2026-12-29','16:00')),false);
 assert.equal(ctx.aimCandidateAccessible(p,at('2028-03-21','16:00')),false);
});
