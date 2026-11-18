import {sourceHtml,sourceDeclaration} from './tools/test-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url),P=require('./astronotes-shooting.js'),A=require('./astronotes-align.js');
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
 const html=sourceHtml();const source=sourceDeclaration("aimRenderList");
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
 const result=await P.candidates({...plan,partId:'__whole',matchMode:'overlap'},[point('a')],d);
 assert.equal(calls,1);assert.deepEqual(result.rows.map(r=>r.event.at),[at]);assert.equal(result.rows[0].event.matchMode,'overlap');
 assert.equal(P.matches(events[0],plan,()=>false),false);
 assert.notEqual(P.queryKey(plan,[],'u','a'),P.queryKey({...plan,matchMode:'overlap'},[],'u','a'));
});
test('指定なしの山は稜線viewの交差を採用し、月は昼間も含める',async()=>{
 const d=deps([{at,gap:.01,radius:0,intersects:false,sunAltitude:-1}]);d.isMountain=()=>true;d.viewFor=async()=>()=>[{at,gap:10,intersects:true,sunAltitude:-1}];
 assert.equal((await P.candidates({...plan,partId:null,body:'sirius',matchMode:'overlap'},[point('a')],d)).rows.length,1);
 d.viewFor=async()=>()=>[{at,gap:.1,intersects:true,sunAltitude:-1},{at:at+1000,intersects:true,sunAltitude:1}];
 assert.equal((await P.candidates({...plan,body:'moon',matchMode:'overlap'},[point('a')],d)).rows.length,2);
});

test('実際のスカイツリーで先端の真ん中が外れる日も、建物への接触は候補帯まで残る',async()=>{
 const target=A.targetById('skytree'),place={latitude:35.72453,longitude:139.86260,elevation:0,eyeHeightAGL:4,name:'検証地点'},date=Date.parse('2026-10-24T12:00:00+09:00');
 const p={target,body:'sun',partId:'__whole',limb:'center',matchMode:'overlap',at:date};
 const d={align:A,isMountain:()=>false,observerAt:(f,g)=>({...f,elevation:g,eyeM:4}),ensure:async()=>{}};
 const result=await P.candidates(p,[{place,record:{result:'seen'}}],d);assert.ok(result.rows.length);
 assert.equal((await P.candidates({...p,partId:'tip',matchMode:'limb'},[{place,record:{result:'seen'}}],d)).rows.length,0);
 const html=sourceHtml(),fn=sourceDeclaration("aimCandidateMatch");
 const match=new Function('aim','AstroNotesShooting','aimIsMountain',fn+';return aimCandidateMatch;')({...p},P,()=>false);
 assert.ok(result.rows.every(r=>match(r.event)));
});

test('指定した先端への通過は円盤との接触を判定し、中心の一致を要求しない',async()=>{
 const event={at,gap:.24,radius:.25,intersects:true};
 const d=deps([event]);d.align.dailyView=(obs,target,body,day,opts)=>{assert.equal(opts.partId,'tip');assert.equal(opts.pointOnly,true);return [event];};
 d.align.upcoming=()=>{throw Error('point passage must use disc distance');};
 const p={...plan,matchMode:'overlap'};
 const result=await P.candidates(p,[point('edge')],d);
 assert.equal(result.rows.length,1);
 assert.equal(result.rows[0].event.partId,'tip');
 assert(!P.matches(event,{...plan,matchMode:'limb'},()=>false));
 assert(P.matches(event,p,()=>false));
});

test('円盤の上下の縁や横が先端を通る場合と、先端を外れて胴体だけに掛かる場合を分ける',()=>{
 const observer={latitude:35.75,longitude:139.85,elevation:20},target=A.targetById('skytree');
 const opts={partId:'tip',eyeM:4,pointOnly:true},g=A.geometryFrom(observer,target,opts);
 const bodies=require('./astronotes-bodies.js'),original=bodies.state;
 const mockBodies={...bodies};
 let dx=0,dy=0;
 mockBodies.state=(body,ms,obs)=>({...original(body,ms,obs),azimuth:g.azimuth+dx,apparentAltitude:g.angle+dy,angularRadius:.25,upperRadius:.25,lowerRadius:.25,upperAltitude:g.angle+dy+.25,lowerAltitude:g.angle+dy-.25});
 const ctx={AstroNotesBodies:mockBodies,module:{exports:{}},require};
 vm.runInNewContext(fs.readFileSync(new URL('./astronotes-align.js',import.meta.url),'utf8'),ctx);
 {
  const judge=ctx.module.exports.prepareDailyView(observer,target,'sun',opts);
  for(const [x,y,hit] of [[0,.24,true],[0,-.24,true],[.24,0,true],[0,.27,false],[0,-.6,false]]){
   dx=x;dy=y;
   assert.equal(judge(start,at)[0].intersects,hit,JSON.stringify([x,y]));
  }
 }
});


test('候補一覧は既存の計算結果から中心の上下と山頂の左右を表示し、欠測は断定しない',()=>{
 const p={target:{parts:[{id:'tip',name:'先端'}]},partId:'tip',body:'moon'},base={radius:.25,altitude:5,targetAltitude:5};
 assert.equal(P.passageText(base,p),'先端付近を通過');
 assert.equal(P.passageText({...base,altitude:5.2},p),'先端の上寄りを通過');
 assert.equal(P.passageText({...base,altitude:4.8},p),'先端の下寄りを通過');
 const mountain={...p,target:{rim:{},parts:[{id:'summit',name:'山頂'}]}};
 assert.equal(P.passageText({...base,azimuth:359.8,targetAzimuth:0},mountain),'山頂の左寄りを通過');
 assert.equal(P.passageText({...base,azimuth:.2,targetAzimuth:359.99},mountain),'山頂の右寄りを通過');
 assert.equal(P.passageText({...base,azimuth:180,targetAzimuth:180},mountain),'山頂の中心を通過');
 assert.equal(P.passageText({radius:.25},p),'');
 assert.equal(P.passageText({...base,azimuth:180},mountain),'');
 assert.equal(P.passageText(base,{...p,body:'sirius'}),'');
});


test('部位通過を惑星・恒星へ引き継いでも従来の点の整列判定を保ち、山頂は稜線を使う',async()=>{
 const p={...plan,body:'sirius',matchMode:'overlap'},d=deps([{at,gap:0}]);
 d.align.dailyView=()=>{throw Error('stars use the existing point solver');};
 assert.equal((await P.candidates(p,[point('star')],d)).rows.length,1);
 assert.equal(P.searchOptions({...plan,target:{...plan.target,rim:{}} ,matchMode:'overlap'},()=>true).pointOnly,undefined);
});


test('方位が揃う瞬間に先端を外れても、斜めの軌道が円盤の縁で触れる候補を残す',()=>{
 const observer={latitude:35.75,longitude:139.85,elevation:20},target=A.targetById('skytree'),opts={partId:'tip',eyeM:4,pointOnly:true},g=A.geometryFrom(observer,target,opts),middle=start+43200000;
 const bodies={state:(_body,ms)=>{const minute=(ms-middle)/60000;return {azimuth:g.azimuth+.15*minute,apparentAltitude:g.angle+.31+.12*minute,angularRadius:.25};}},ctx={AstroNotesBodies:bodies,module:{exports:{}},require};
 vm.runInNewContext(fs.readFileSync(new URL('./astronotes-align.js',import.meta.url),'utf8'),ctx);
 const rows=ctx.module.exports.dailyView(observer,target,'sun',start,opts),hit=rows.find(e=>e.intersects);
 assert.ok(hit,'the diagonal passage must survive the centre-azimuth miss');
 assert.ok(Math.abs(hit.at-(middle-60000))<3000);
});


test('建物全体では先端基準を流用せず、円盤の中心の建物内の位置を示す',()=>{
 const p={target:{parts:[{id:'tip',name:'先端'}]},partId:'__whole',body:'sun'},base={radius:.25};
 for(const [x,y,label] of [[.5,.5,'中央付近'],[.5,.9,'上寄り'],[.5,.1,'下寄り'],[.1,.9,'左上寄り'],[.9,.1,'右下寄り']]){
  assert.equal(P.passageText({...base,targetPosition:{x,y}},p),`全体の${label}を通過`);
 }
 assert.equal(P.passageText({...base,gap:0},p),'','a legacy whole event cannot be described relative to its tip');
 assert.equal(P.passageText({...base,targetAltitude:5,altitude:5,composition:{}},{...p,partId:'tip'}),'指定位置付近を通過');
 const observer={latitude:35.75,longitude:139.85,elevation:20},t=A.targetById('skytree'),events=A.dailyView(observer,t,'sun',start,{partId:'__whole'});
 assert(events.every(e=>Number.isFinite(e.targetPosition?.x)&&Number.isFinite(e.targetPosition?.y)));
});


test('任意追加の山は地面と山頂の標高で判定し、kind/rimがなくても山頂の左右を説明する',()=>{
 const target={id:'fav:added-mountain',favId:'added-mountain',name:'追加した山',groundM:1898,parts:[{id:'tip',name:'てっぺん',m:1898}]},plan={target,body:'moon',partId:null,matchMode:'overlap'},event={radius:.25,azimuth:180,targetAzimuth:180,targetAltitude:5,altitude:5};
 assert.equal(P.passageText(event,plan),'山頂の中心を通過');
 assert.equal(P.passageText({...event,azimuth:179.8},plan),'山頂の左寄りを通過');
 assert.equal(P.passageText({...event,azimuth:180.2},plan),'山頂の右寄りを通過');
 const building={...plan,target:{...target,groundM:10,parts:[{id:'tip',name:'てっぺん',m:110}]}};
 assert.equal(P.passageText(event,{...building,partId:'tip'}),'てっぺん付近を通過');
 assert.equal(P.passageText({...event,altitude:5.2},{...building,partId:'tip'}),'てっぺんの上寄りを通過');
 assert.equal(P.passageText({...event,targetPosition:{x:.8,y:.8}},{...building,partId:'__whole'}),'全体の右上寄りを通過');
 assert.equal(P.passageText(event,{...building,partId:'__whole'}),'','missing whole-object geometry must not invent an offset');
 assert.equal(P.passageText({radius:.25},plan),'','a missing direction must not imply a central summit passage');
});

test('候補は評価済みの観測位置・標高・目高を使い、元の登録アンカーへ戻さない',()=>{
 const row={place:{name:'候補の名前',latitude:35,longitude:139,elevation:10,eyeHeightAGL:1.5},assumedObserver:{latitude:35.0001,longitude:139.0001,elevation:30,eyeM:4}},before=JSON.stringify(row);
 assert.deepEqual(P.candidatePlace(row),{name:'候補の名前',latitude:35.0001,longitude:139.0001,elevation:30,groundManualM:30,standAglM:4,eyeHeightAGL:4});
 assert.equal(JSON.stringify(row),before);assert.equal(P.candidatePlace({place:row.place}),row.place);
});

test('微調整した現在点へ登録ID・形状・展望台を引き継がず、標高と地上高は確定値を使う',()=>{
 const from={id:'saved',name:'保存した公園',latitude:35,longitude:139,shape:{type:'line'},decks:[{}],stand:'展望台',sourcePlaceId:'source',observationElevationM:100},before=JSON.stringify(from);
 const p=P.movedPlace(from,{latitude:35.001,longitude:139.001},32.5,4);
 assert.equal(p.groundManualM,32.5);assert.equal(p.standAglM,4);assert.equal(p.name,'微調整した撮影位置');
 for(const key of ['id','sourcePlaceId','shape','decks','stand','observationElevationM'])assert(!Object.hasOwn(p,key));
 assert.equal(JSON.stringify(from),before);assert.equal(P.movedPlace(from,{latitude:35,longitude:139},NaN,4),null);
 const s={body:'moon',target:{id:'tower'},observer:from,at:0};
 assert.equal(P.observerMoveKey(s),P.observerMoveKey({...s,at:1000}),'moving preserves the live time rather than reverting a time captured before a lookup');
});
