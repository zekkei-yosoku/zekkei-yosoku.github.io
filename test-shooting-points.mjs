import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url),P=require('./sorami-shooting.js'),A=require('./sorami-align.js');
const at=Date.parse('2026-10-24T17:00:00+09:00'),start=P.day(at),DAY=86400000;
const plan={observer:{latitude:35,longitude:139},target:{latitude:35.1,longitude:139.1,id:'tower',parts:[{id:'tip',m:600}]},body:'sun',partId:'tip',limb:'center',at};
const point=id=>({place:{id,name:id,latitude:35,longitude:139,elevation:20},record:{result:'seen',updatedAt:1}});
const deps=events=>({ensure:async()=>{},isMountain:()=>false,observerAt:f=>({...f,eyeM:4}),elevationAt:async()=>20,align:{upcoming:()=>events,dailyView:()=>events}});
test('候補は指定日の0時から24時未満。選択時刻より前も含み、翌日は含めない',async()=>{
 const events=[{at:start-1,gap:0},{at:start,gap:0},{at:start+1000,gap:0},{at:start+DAY,gap:0}];
 const d=deps(events);let options;d.align.upcoming=(o,t,b,v)=>{options=v;assert.equal(o.eyeM,4);return events;};
 const result=await P.candidates(plan,[point('a')],d);assert.deepEqual(result.rows.map(x=>x.event.at),[start,start+1000]);assert.equal(options.from,start);assert.equal(options.days,1);assert.equal(options.limb,'center');
});
test('全体のシルエットとの重なりと部位への重なりを区別。月は昼を除外',async()=>{
 const events=[{at:at,gap:0,intersects:false,sunAltitude:-1},{at:at+1000,gap:1,intersects:true,sunAltitude:1}];
 assert.equal((await P.candidates(plan,[point('a')],deps(events))).rows[0].event.at,at);
 assert.equal((await P.candidates({...plan,partId:'__whole'},[point('a')],deps(events))).rows[0].event.at,at+1000);
 assert.equal((await P.candidates({...plan,body:'moon'},[point('a')],deps(events))).rows.length,1);
});
test('標高欠測は失敗として残し、他の地点は候補を返す。古い要求は中断する',async()=>{
 const missing=point('missing');missing.place.elevation=null;const d=deps([{at,gap:0}]);d.elevationAt=async()=>null;
 const result=await P.candidates(plan,[missing,point('valid')],d);assert.equal(result.failed,1);assert.equal(result.rows[0].place.id,'valid');
 d.isCurrent=()=>false;assert.equal((await P.candidates(plan,[point('a')],d)).cancelled,true);
});
test('時刻スクラブ・観測点選択は候補探索を再実行せず、日付・対象・部位・高さ・アカウントは別条件',()=>{
 const points=[point('a')],key=p=>P.queryKey(p,points,'user','weather');
 assert.equal(key(plan),key({...plan,at:at-60000,observer:{latitude:36,longitude:140}}));
 for(const update of [{at:at+DAY},{partId:'__whole'},{limb:'upper'},{body:'moon'},{target:{...plan.target,longitude:140}}])assert.notEqual(key(plan),key({...plan,...update}));
 assert.notEqual(key(plan),P.queryKey(plan,points,'other','weather'));points[0].place.eyeHeightAGL=10;assert.notEqual(key(plan),P.queryKey(plan,[point('a')],'user','weather'));
});
test('振動は重なりへ入った瞬間だけ。連続表示と短時間の往復では繰り返さない',()=>{
 let n=0,now=1000;const gate=P.hapticGate({vibrate:ms=>{assert.equal(ms,12);n++;},clock:()=>now});
 gate(true,'a');gate(true,'a');gate(false,'a');gate(true,'a');assert.equal(n,1);now+=1000;gate(false,'a');gate(true,'a');assert.equal(n,2);
});
test('現在時刻の判定は一日探索と同じ幾何を使い、方位が同じでも高度が違えば重ならない',()=>{
 const target=A.targetById('skytree'),observer={latitude:35.75,longitude:139.85,elevation:20};
 const events=A.dailyView(observer,target,'sun',at,{partId:'__whole',eyeM:4});assert.ok(events.length);
 for(const e of events){const hit=A.alignmentAt(observer,target,'sun',e.at,{partId:'__whole',eyeM:4});assert.equal(hit.matched,e.intersects);}
 const high={...target,parts:[{id:'tip',m:90000}]};assert.equal(A.alignmentAt(observer,high,'sun',at,{partId:'tip',eyeM:4}).matched,false);
});
test('富士山を選んでも構図から定番スポットの提案を起動しない',()=>{
 const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');const source=html.slice(html.indexOf('function aimRenderList()'),html.indexOf('function aimShowDay('));
 const nodes={aimListBox:{hidden:false},aimList:{replaceChildren(){this.cleared=true;}}};let calls=0;
 const c={$:id=>nodes[id],aimIsFuji:()=>true,aimRenderSpots:()=>calls++};vm.runInNewContext(source+';aimRenderList()',c);assert.equal(calls,0);assert.equal(nodes.aimListBox.hidden,true);assert.equal(nodes.aimList.cleared,true);
});

test('候補探索は観測地点が未選択でも同じ登録地点・高さ・日付で計算する',async()=>{
 const events=[{at,gap:0}],points=[point('registered')];
 assert.equal(P.conditions({...plan,observer:null}).observer,null);
 const a=await P.candidates(plan,points,deps(events)),b=await P.candidates({...plan,observer:null},points,deps(events));assert.deepEqual(a,b);assert.equal(b.rows[0].place.id,'registered');
});
test('登録地点の標高はDEMと違っても候補選択後へ保持し、明示的な標高修正を優先する',()=>{
 assert.equal(P.savedObserver({latitude:35,longitude:139,elevation:30,eyeHeightAGL:4}).groundManualM,30);
 assert.equal(P.savedObserver({latitude:35,longitude:139,elevation:30,groundManualM:27.4}).groundManualM,27.4);
 assert.equal(P.savedObserver(null),null);
});

test('指定なしは円盤の接触を一度だけ探し、真ん中指定の不一致を候補から落とさない',async()=>{
 const events=[{at,gap:.15,radius:.25,intersects:true},{at:at+1000,gap:0,radius:.25,intersects:false}];
 const d=deps(events);let calls=0;d.align.dailyView=(o,t,b,day,opts)=>{calls++;assert.equal(opts.partId,'__whole');return events;};d.align.upcoming=()=>{throw Error('指定なしで縁ごとの探索をしない');};
 const result=await P.candidates({...plan,matchMode:'overlap'},[point('a')],d);
 assert.equal(calls,1);assert.deepEqual(result.rows.map(r=>r.event.at),[at]);assert.equal(result.rows[0].event.matchMode,'overlap');
 assert.equal(P.matches(events[0],plan,()=>false),false);
 assert.notEqual(P.queryKey(plan,[],'u','a'),P.queryKey({...plan,matchMode:'overlap'},[],'u','a'));
});
test('指定なしの山は稜線viewの交差を採用し、月は暗い時間だけ',async()=>{
 const d=deps([{at,gap:.01,radius:0,intersects:false,sunAltitude:-1}]);d.isMountain=()=>true;d.viewFor=async()=>()=>[{at,gap:10,intersects:true,sunAltitude:-1}];
 assert.equal((await P.candidates({...plan,body:'sirius',matchMode:'overlap'},[point('a')],d)).rows.length,1);
 d.viewFor=async()=>()=>[{at,gap:.1,intersects:true,sunAltitude:-1},{at:at+1000,intersects:true,sunAltitude:1}];
 assert.equal((await P.candidates({...plan,body:'moon',matchMode:'overlap'},[point('a')],d)).rows.length,1);
});

test('実際のスカイツリーで先端の真ん中が外れる日も、建物への接触は候補帯まで残る',async()=>{
 const target=A.targetById('skytree'),place={latitude:35.72453,longitude:139.86260,elevation:0,eyeHeightAGL:4,name:'検証地点'},date=Date.parse('2026-10-24T12:00:00+09:00');
 const p={target,body:'sun',partId:'tip',limb:'center',matchMode:'overlap',at:date};
 const d={align:A,isMountain:()=>false,observerAt:(f,g)=>({...f,elevation:g,eyeM:4}),ensure:async()=>{}};
 const result=await P.candidates(p,[{place,record:{result:'seen'}}],d);assert.ok(result.rows.length);
 assert.equal((await P.candidates({...p,matchMode:'limb'},[{place,record:{result:'seen'}}],d)).rows.length,0);
 const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8'),fn=html.slice(html.indexOf('function aimCandidateMatch('),html.indexOf('// 400日探索',html.indexOf('function aimCandidateMatch(')));
 const match=new Function('aim','SoramiShooting','aimIsMountain',fn+';return aimCandidateMatch;')({...p},P,()=>false);
 assert.ok(result.rows.every(r=>match(r.event)));
});
