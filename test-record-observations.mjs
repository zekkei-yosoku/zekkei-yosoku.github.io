import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),L=require('./astronotes-library.js'),terrain=require('./astronotes-terrain.js');
const source=fs.readFileSync(new URL('./astronotes-myplaces.js',import.meta.url),'utf8');
function fixture(){const values=new Map(),auth={loginId:'first'},favorites=[{id:'p',name:'撮影地',latitude:35,longitude:139,elevation:50,eyeHeightAGL:4}];const api=new Function('AstroNotesLibrary','store','auth','favorites','AstroNotesTerrain','const withShape=f=>f;'+source.slice(source.indexOf('const RESULTS'),source.indexOf('// 目標は構図'))+';return {clean,load,statusOf,placesFor};')(L,{get:(k,d)=>values.get(k)??d,set:(k,v)=>values.set(k,v)},auth,favorites,terrain);return {api,values,auth,favorites};}
const raw={id:'one',placeId:'p',target:{key:'tower',name:'塔',latitude:35.1,longitude:139.1},result:'seen',date:'2026-10-16',observer:{latitude:35,longitude:139,elevation:50,eyeHeightAGL:4},createdAt:1,updatedAt:1};
test('記録時の観測座標と高さを保持し、不正な識別子を保存対象にしない',()=>{const {api}=fixture(),r=api.clean(raw);assert.deepEqual(r.observer,raw.observer);assert.equal(api.clean({...raw,target:{...raw.target,name:'x'.repeat(201)}}),null);assert.equal(api.clean({...raw,result:'unknown'}),null);});
test('撮影場所の移動・立つ高さの変更後は古い実績を候補へ流用しない',()=>{const {api,favorites}=fixture(),r=api.clean(raw);assert.equal(api.statusOf('p','tower',[r]).id,'one');favorites[0].latitude=35.01;assert.equal(api.statusOf('p','tower',[r]),null);favorites[0].latitude=35;favorites[0].eyeHeightAGL=20;assert.equal(api.statusOf('p','tower',[r]),null);assert.equal(r.observer.eyeHeightAGL,4);});
test('最新が見えなかった組を候補にしない。アカウントの保存先を混ぜない',()=>{const {api,values,auth}=fixture();values.set('sorami.observations.v1:first',[raw,{...raw,id:'two',result:'hidden',updatedAt:2}]);assert.equal(api.load().length,2);assert.equal(api.placesFor('tower').length,0);auth.loginId='second';assert.deepEqual(api.load(),[]);});
test('同じ地点の複数対象を独立に保持し、別の対象の不可視記録に巻き込まない',()=>{
 const {api,values}=fixture();values.set('sorami.observations.v1:first',[raw,{...raw,id:'mountain',target:{...raw.target,key:'fuji',name:'富士山'}},{...raw,id:'tower-hidden',result:'hidden',updatedAt:2}]);
 assert.equal(api.load().length,3);assert.equal(api.placesFor('fuji').length,1);assert.equal(api.placesFor('tower').length,0);
});
test('見えた対象×複数天体の全組を作り、見えない対象・未知天体・権限のない組を除く',()=>{
 const fn=source.slice(source.indexOf('function planningPairs('),source.indexOf('function buildSheet('));
 const grants=new Set(['tower','diamond','pearl']);
 const pairs=new Function('AstroNotesBodies','toolAllowed','AstroNotesAccess',fn+';return planningPairs;')({definition:id=>['sun','moon','sirius'].includes(id)},id=>grants.has(id),require('./astronotes-access.js'));
 const records=[{result:'seen',target:{key:'fuji'}},{result:'partial',target:{key:'tower'}},{result:'hidden',target:{key:'blocked'}}];
 assert.deepEqual(pairs(records,['sun','moon','unknown']).map(p=>[p.record.target.key,p.body]),[['fuji','sun'],['fuji','moon'],['tower','sun'],['tower','moon']]);
 assert.deepEqual(pairs(records,[]),[]);grants.delete('pearl');assert.deepEqual(pairs(records,['moon']).map(p=>p.record.target.key),['tower']);
 grants.delete('tower');assert.deepEqual(pairs(records,['sirius']),[]);
});
test('記録から選んだ天体と秒までの時刻を構図・地図へ渡し、未許可の転送を拒否する',()=>{
 const fn=source.slice(source.indexOf('function openWith('),source.indexOf('function saveRecord('));
 for(const mode of ['aim','sky']){
  const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,{value:'',dispatchEvent(e){this.event=e.type;}});return elements.get(id);};
  const aim={body:'sun',from:null},calls=[],P=require('./astronotes-shooting.js'),at=Date.parse('2026-10-24T16:13:57+09:00');let allowed=true;
  const run=new Function('planningPairs','openFromRecords','el','SkyMapUI','openInSky','aim','aimFillSelects','aimSetFrom','AstroNotesShooting','S','aimApply','adoptOverlap',fn+';return openWith;')(()=>allowed?[1]:[],()=>{},el,{setTarget:id=>calls.push(id)},(p,r)=>calls.push(r),aim,()=>{},()=>{},P,{Cal:{startOfDay:P.day}},()=>{},()=>{});
  run({latitude:35,longitude:139},{id:'tower'},{at,body:'moon',side:'set'},mode);
  if(mode==='aim'){assert.equal(aim.body,'moon');assert.equal(aim.plannerTransfer.at,at);assert.equal(aim.plannerTransfer.body,'moon');}
  else{assert.equal(el('skyMapBody').value,'moon');assert.equal(el('skyMapBody').event,'change');assert.equal(calls[1].at,at);}
  allowed=false;run({},{id:'tower'},{at,body:'sirius'},mode);assert.notEqual(aim.body,'sirius');assert.notEqual(el('skyMapBody').value,'sirius');
 }
});

test('記録からの指定なし候補は前の縁指定を残さず、全体の条件を復元する',()=>{
 const fn=source.slice(source.indexOf('function adoptOverlap('),source.indexOf('function openInAim(')),aim={matchMode:'limb',partId:'tip',limb:'behind'},nodes={aimPart:{value:'tip'},aimLimb:{innerHTML:'old'}};
 const adopt=new Function('aim','el',fn+';return adoptOverlap;')(aim,id=>nodes[id]);adopt({matchMode:'overlap',partId:'__whole'});assert.equal(aim.matchMode,'overlap');assert.equal(aim.partId,'__whole');assert.equal(aim.limb,'center');assert.equal(nodes.aimLimb.innerHTML,'');assert.equal(nodes.aimPart.value,'__whole');
});
test('対象一覧は対象ごとに1行へまとめ、同じ対象の全履歴を保持する',()=>{
 const start=source.indexOf('function recordGroups('),end=source.indexOf('function showRecordEditor(',start),fn=new Function('when',source.slice(start,end)+';return recordGroups;')(r=>r.date?Date.parse(r.date):r.createdAt);
 const rows=[raw,{...raw,id:'tower-again',updatedAt:2},{...raw,id:'fuji-one',target:{...raw.target,key:'fuji',name:'富士山'}}];const groups=fn(rows);assert.equal(groups.length,2);assert.equal(groups[0].records.length,2);assert.equal(groups[0].latest.id,'tower-again');assert.equal(rows.length,3);
});
test('対象の履歴内で新しい見え方を先にし、別の対象の状態を混ぜない',()=>{
 const start=source.indexOf('function recordGroups('),end=source.indexOf('function showRecordEditor(',start),fn=new Function('when',source.slice(start,end)+';return recordGroups;')(r=>Date.parse(r.date));
 const groups=fn([raw,{...raw,id:'later',date:'2026-10-17',result:'hidden'},{...raw,id:'other',target:{...raw.target,key:'fuji'},result:'partial'}]);assert.equal(groups[0].latest.result,'hidden');assert.equal(groups[1].latest.result,'partial');assert.equal(groups[0].records.length,2);
});

test('対象の一括変更は追加と除外だけを追記し、観測日や既存履歴を変更しない',()=>{
 const {api}=fixture();const start=source.indexOf('function registrationChanges('),end=source.indexOf('function buildSheet(',start);
 const run=L.registrationChanges;
 const place={id:'p',latitude:35,longitude:139,eyeHeightAGL:4};const before=[raw.target],next=[{...raw.target,key:'fuji',name:'富士山'}];
 const rows=run(place,before,next,1000);assert.equal(rows.length,2);assert.equal(rows[0].removed,true);assert.equal(rows[1].removed,false);assert.ok(rows.every(r=>r.date===''&&r.note===''&&r.createdAt===1000&&r.registration));
 assert.equal(api.statusOf('p','tower',[api.clean(raw),...rows]),null);assert.equal(api.statusOf('p','fuji',rows).target.name,'富士山');assert.equal(raw.date,'2026-10-16');assert.deepEqual(run(place,next,next,1001),[]);
 const readd=run(place,[],before,1001);assert.equal(api.statusOf('p','tower',[api.clean(raw),...rows,...readd]).removed,false);
});

test('対象の近傍照合は組み込み/自作の既存IDを保持する',()=>{
 for(const id of ['skytree','fav:owned']){const target={id,latitude:35,longitude:139};assert.equal(L.nearby([target],{latitude:35.00001,longitude:139}).id,id);}
});
