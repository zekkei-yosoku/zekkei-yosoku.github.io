createRequire(import.meta.url)("./sorami-bodies.js");
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
const S=createRequire(import.meta.url)('./sorami-core.js');
const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const grab=(name)=>{const i=html.indexOf(name);assert.ok(i>=0);return html.slice(i,html.indexOf('\n}\n',i)+2);};
const H=3600000, today=S.Cal.startOfDay(Date.UTC(2026,9,3,2));
const place={name:'東京',latitude:35.68,longitude:139.76};
const ev={peak:today+5.5*H,score:38,rank:S.rankOf(38),confidence:{key:'high'},perModel:{},factors:[],window:[today+5*H,today+6*H]};
function rounds(initial=[],weeks={sunrise:[{dayMs:today,evaluation:ev}]}){
 const mem={'sorami.rounds':initial}; const store={get:(k,d)=>structuredClone(mem[k]??d),set:(k,v)=>mem[k]=structuredClone(v)};
 const src=grab('function samePlaceAs')+'\n'+html.slice(html.indexOf('const ROUND_KEEP_MS'),html.indexOf('function findSighting'));
 const api=new Function('S','store','weeks','place','collectObservations',src+';return {keepRounds,roundOf,answerableRounds};')(S,store,weeks,place,()=>({cloud:1}));
 return {...api,mem,store};
}
test('初回起動が開始時・終了後なら保存せず、現在予報へフォールバックしない',()=>{
 for(const now of [today+5*H,today+11*H]){
  const r=rounds();r.keepRounds(place,now);assert.equal(r.mem['sorami.rounds'].length,0);
  assert.equal(r.roundOf('sunrise',ev.peak),null);assert.equal(r.answerableRounds(now).length,0);
 }
});
test('開始前の予測は終了後も7日間答えられ、保存時刻不明の旧回は保持するが使わない',()=>{
 const old={...ev,pid:'sunrise',...place};const r=rounds([old]);
 assert.equal(r.answerableRounds(today+11*H).length,0);assert.equal(r.mem['sorami.rounds'].length,1);
 r.keepRounds(place,today+4*H);const saved=r.mem['sorami.rounds'][0];assert.equal(saved.capturedAt,today+4*H);
 assert.equal(r.answerableRounds(today+5.9*H).length,0);assert.equal(r.answerableRounds(today+6*H).length,1);
 assert.equal(r.answerableRounds(today+7*86400000+6*H).length,1);
 assert.equal(r.answerableRounds(today+7*86400000+6*H+1).length,0);
 r.keepRounds(place,today+11*H);assert.deepEqual(r.mem['sorami.rounds'][0],saved);
});
test('既存記録の答え直しは予測と写真情報を保持し、新規事後記録は作らない',()=>{
 const src=grab('function recordAnswer')+'\n'+grab('function shotFields');let saved;let pushed=0;
 const existing={id:'old',peak:ev.peak,score:74,confidence:'high',rank:'good',observations:{old:1},photoId:'photo',observedAtMs:123};
 const ctx={S,roundOf:()=>null,findSighting:()=>existing,sightings:[existing],place,crypto:{randomUUID:()=>{throw Error('new ID');}},collectObservations:()=>({new:2}),store:{set:(k,v)=>saved=v},queuePush:()=>pushed++,render:()=>{}};
 const record=runInNewContext(src+';recordAnswer',ctx);record('sunrise',ev.peak,1);
 assert.equal(saved[0].score,74);assert.equal(saved[0].actualScore,1);assert.equal(saved[0].photoId,'photo');assert.equal(saved[0].observedAtMs,123);assert.equal(saved[0].observations.old,1);assert.equal(pushed,1);
 record('sunrise',ev.peak,2,{photoId:'newphoto',observedAtMs:today+8*H});
 assert.equal(saved[0].photoOutsideWindow,null);assert.equal(saved[0].score,74);assert.equal(saved[0].photoId,'newphoto');
 existing.window=ev.window;record('sunrise',ev.peak,2,{photoId:'newphoto',observedAtMs:today+8*H});
 assert.equal(saved[0].photoOutsideWindow,true);
 delete existing.observations;record('sunrise',ev.peak,2);assert.equal(Object.keys(saved[0].observations).length,0);
 ctx.findSighting=()=>null;record('sunrise',ev.peak,1);assert.equal(pushed,4);
});
test('単一モデルの説明は表示と同じexpectedErrorを使い、±0は出さない',()=>{
 const fn=runInNewContext(html.slice(html.indexOf('function confidenceText(ev)'),html.indexOf('// 51メンバーの散らばりを見せる。'))+';confidenceText',{S});
 const make=(e)=>({uncertainty:{basis:'single',expectedError:e,modelWidth:8},confidence:{key:'high'},models:0,daysAhead:0});
 assert.match(fn(make(5)),/±5点/);assert.doesNotMatch(fn(make(5)),/±8/);assert.doesNotMatch(fn(make(0)),/±0/);
});
test('記録案内はピークではなく窓の終了時刻。翌日の日付も付ける',()=>{
 const a=html.indexOf('  const finished = ev.window[1] <= now;');const b=html.indexOf('  // 広い画面では',a);
 const fn=new Function('S','ev','now','id','findSighting','roundOf','outcomeButtons',html.slice(a,b)+';return record;');
 const out=(e,now)=>fn(S,e,now,'sunrise',()=>null,()=>null,()=>{throw Error('no forecast');});
 assert.match(out(ev,today+4*H),/6:00/);assert.doesNotMatch(out(ev,today+4*H),/5:30/);
 assert.match(out({...ev,window:[today+23*H,today+26*H]},today+22*H),/10\/04.*2:00/);
 assert.match(out({...ev,window:[today,today+24*H-1]},today+22*H),/10\/04.*0:00/);
 assert.match(out(ev,today+11*H),/始まる前の予測がない/);
});
function redraw(line){
 const els=Object.fromEntries(['aimLineInfo','aimLineTable','aimCandList','aimSideSeg','aimCandInfo'].map(k=>[k,{hidden:false,textContent:'old',innerHTML:'old',querySelector(){return this;}}]));
 const aim={seq:0,candSeq:0,target:{id:'fuji'},body:'sun',dayMs:today,candPick:null,cands:[]};
 const fn=runInNewContext(grab('async function aimRedrawLine')+';aimRedrawLine',{aim,$:k=>els[k],AimMap:{redraw(){}},SoramiAlign:{line},aimElevation(){},aimFindCandidates(){},S,esc:x=>x,aimSideLabel:x=>x,aimKm:x=>x});
 return {fn,els,aim};
}
test('計算開始時に旧表を消す。古い応答・エラーで新しい画面を上書きしない',async()=>{
 const pending=[];const r=redraw(()=>new Promise((resolve,reject)=>pending.push({resolve,reject})));
 const first=r.fn();assert.equal(r.els.aimLineTable.hidden,true);assert.equal(r.els.aimLineTable.innerHTML,'');
 r.aim.target={id:'tower'};const second=r.fn();pending[1].resolve([{side:'rise',points:[{at:ev.peak,distanceKm:2,azimuth:90},{at:ev.peak,distanceKm:3,azimuth:91}]}]);await second;
 const latest=r.els.aimLineTable.innerHTML;assert.match(latest,/2〜3km/);
 pending[0].reject(Error('old'));await first;assert.equal(r.els.aimLineTable.innerHTML,latest);assert.equal(r.els.aimLineTable.hidden,false);
 const fail=r.fn();pending[2].reject(Error('network'));await fail;assert.equal(r.els.aimLineTable.hidden,true);assert.match(r.els.aimLineInfo.textContent,/計算できません/);assert.doesNotMatch(r.els.aimLineInfo.textContent,/どこからも重なりません/);
});
test('同名の山頂は近くの駅に吸収されず、索引の市町村・標高・位置で出る（高尾山）',async()=>{
 const terrain=createRequire(import.meta.url)('./sorami-terrain.js');
 const osm=[{name:'高尾山',display_name:'高尾山, 高尾山線, 高尾町, 八王子市, 東京都',type:'station',lat:'35.6311',lon:'139.2561',extratags:{}},{name:'高尾山',display_name:'高尾山, 東京都, 193-0841, 日本',type:'peak',lat:'35.62523',lon:'139.24369',extratags:{}}];
 const idx=[{name:'高尾山',muni:'東京都八王子市',elevation:599,kind:'山',latitude:35.6252267,longitude:139.2436878,score:100}];
 const search=runInNewContext(grab('function namedPlaceMatches')+'\n'+grab('async function searchPlaces')+';searchPlaces',{searchJson:async url=>url.includes('msearch')?[]:osm,searchSupplement:async()=>({places:[]}),favorites:[],SoramiAlign:{TARGETS:[]},placeIndex:async()=>({}),SoramiTerrain:{...terrain,searchPlaceIndex:()=>idx},place,URLSearchParams});
 const found=await search('高尾山',{near:{latitude:35.6812,longitude:139.7671}});
 const summit=found.find(r=>r.kind==='山'),station=found.find(r=>r.kind==='駅');
 assert.ok(summit&&station,'山頂と駅は別の候補');assert.match(summit.detail,/八王子市/);assert.match(summit.detail,/599m/);
 assert.equal(summit.latitude,35.6252267);assert.equal(station.latitude,35.6311);
 assert.equal(found.filter(r=>Math.abs(r.latitude-35.6252)<0.001).length,1,'山頂は1件にまとまる');
});
test('同名GSI地点は座標で区別できる。近いOSM住所は引き継ぐ',async()=>{
 const terrain=createRequire(import.meta.url)('./sorami-terrain.js');
 const gsi=[139.76,140.5].map(lon=>({properties:{title:'新宿'},geometry:{coordinates:[lon,35.68]}}));
 const osm=[{name:'新宿',display_name:'新宿, 東京都',lat:'35.68001',lon:'139.76001',extratags:{}}];
 const search=runInNewContext(grab('function namedPlaceMatches')+'\n'+grab('async function searchPlaces')+';searchPlaces',{searchJson:async url=>url.includes('msearch')?gsi:osm,searchSupplement:async()=>({places:[]}),favorites:[],SoramiAlign:{TARGETS:[]},placeIndex:async()=>({}),SoramiTerrain:{...terrain,searchPlaceIndex:()=>[]},place,URLSearchParams});
 const found=await search('新宿');assert.equal(found.length,2);assert.ok(found.some(r=>r.detail.includes('東京都')));assert.ok(found.some(r=>r.detail.includes('140.50000')));
 assert.notEqual(found[0].detail,found[1].detail);assert.ok(found.every(r=>!r.detail.includes('km')));
});

// 写真判定の不明は、再読込・同期受信の正規化でも時間内に変えない。
test('写真時間帯のtrue/false/nullは保存JSONと取込処理を通して保持する',()=>{
 const clean=runInNewContext(grab('function cleanSighting')+';cleanSighting',{S,isText:v=>typeof v==='string'&&v.length<=2000});
 for(const flag of [true,false,null,undefined]){
  const raw={id:'s',phenomenon:'sunrise',peak:ev.peak,score:74,photoOutsideWindow:flag};
  assert.equal(clean(JSON.parse(JSON.stringify(raw))).photoOutsideWindow,typeof flag==='boolean'?flag:null);
 }
});


test('未設定の自由目標へ切り替えると前の目標の時刻表を消す',()=>{
 const a=html.indexOf('  if (!(aim.target.parts || []).length) {',html.indexOf('function aimApply('));
 const b=html.indexOf('  $("aimCandBox").hidden = false;',a);
 const body={innerHTML:'前の目標の時刻'},elements=new Map();
 const $=id=>{if(!elements.has(id)) elements.set(id,{hidden:false,innerHTML:'old',querySelector:()=>body});return elements.get(id);};
 const aim={target:{parts:[]},seq:3,candSeq:3,lines:[1],cands:[1]};
 runInNewContext('(function(){'+html.slice(a,b)+'})()',{$,aim,aimRenderFrom:()=>{},AimMap:{center:()=>({latitude:35}),redraw:()=>{}},Number});
 assert.equal($('aimLineTable').hidden,true);assert.equal(body.innerHTML,'');assert.equal($('aimLineInfo').textContent,'');assert.equal(aim.lines.length,0);
});


test('月の選択はメニュー再入場・再読込でも保持し、明示のダイヤモンドURLだけ太陽を指定する',()=>{
 const saved={'sorami.aimBody':'moon','sorami.aimTarget':'skytree'},store={get:(key,fallback)=>saved[key]??fallback,set:(key,value)=>saved[key]=value};
 const init=html.slice(html.indexOf('const aim = {'),html.indexOf('///',html.indexOf('const aim = {')));
 const declaration=init.slice(0,init.indexOf('};')+2);
 const preset=html.slice(html.indexOf('const AIM_PRESETS = {'),html.indexOf('};',html.indexOf('const AIM_PRESETS = {'))+2);
 const start=html.indexOf('  if (pre) {',html.indexOf('const pre = preset && AIM_PRESETS[preset]'));
 const entry=html.slice(start,html.indexOf('  if (!SoramiBodies.definition(body).limbs',start));
 const sel={value:'skytree',selectedIndex:0};
 const c={store,$:()=>sel,SoramiBodies:globalThis.SoramiBodies,aimLimbValue:()=>"center"};
 runInNewContext(declaration+preset+'; aim.limbsByBody={};result={aim,AIM_PRESETS};',c);
 for(const name of ['tower','tower']){c.aim=c.result.aim;c.pre=c.result.AIM_PRESETS[name];runInNewContext(entry,c);assert.equal(c.aim.body,'moon');}
 c.pre=c.result.AIM_PRESETS.diamond;runInNewContext(entry,c);assert.equal(c.aim.body,'sun');
 c.pre=c.result.AIM_PRESETS.pearl;runInNewContext(entry,c);assert.equal(c.aim.body,'moon');
 runInNewContext('store.set("sorami.aimBody", aim.body);',c);
 const reloaded={store,SoramiBodies:globalThis.SoramiBodies};runInNewContext(declaration+';result=aim;',reloaded);assert.equal(reloaded.result.body,'moon');
});


test('管理者でない直リンクは操作フォームを隠し、管理者では再表示する',async()=>{
 const els={};const $=id=>els[id]||(els[id]={hidden:false,innerHTML:"old",textContent:"",querySelectorAll:()=>[]});let calls=0;
 const ctx={auth:null,$,adminRenderSeq:0,adminRenderAuth:null,adminCodes:["synthetic"],adminCodesFor:"fixture",adminFail:msg=>{$("adminErr").hidden=false;$("adminErr").textContent=msg;},apiCall:async(_,path)=>{calls++;return path==="/admin/users"?{users:[],allowed:[]}:path==="/admin/settings"?{openSignup:false}:{entries:[]};}};
 const src=grab('function clearAdminView')+'\n'+grab('async function renderAdmin');
 const api=runInNewContext(src+';({render:renderAdmin,clear:clearAdminView})',ctx),render=api.render;
 await render();assert.equal($("adminBody").hidden,true);assert.equal(calls,0);assert.equal($("adminErr").textContent,'ログインしてください');
 ctx.auth={role:'user'};$("adminBody").hidden=false;await render();assert.equal($("adminBody").hidden,true);assert.equal(calls,0);assert.equal($("adminErr").textContent,'権限がありません');assert.equal($("adminUsers").innerHTML,'');
 ctx.auth={role:'admin'};await render();assert.equal($("adminBody").hidden,false);assert.equal(calls,3);assert.equal($("adminErr").hidden,true);
 ctx.auth={role:'user'};await render();assert.equal($("adminBody").hidden,true);assert.equal($("signupMode").innerHTML,'');
 // cachedroleが管理者でもサーバーが拒否した場合はカードを出さない。
 ctx.auth={role:'admin'};ctx.apiCall=async()=>{throw Error('権限がありません');};await render();assert.equal($("adminBody").hidden,true);assert.equal($("adminErr").textContent,'権限がありません');
 // 取得待機中の認証切替で旧応答が再表示しない。
 let resolve;ctx.apiCall=()=>new Promise(r=>resolve=r);ctx.auth={role:'admin'};const pending=render();assert.equal($("adminBody").hidden,true);
 ctx.auth={role:'user'};api.clear();resolve({users:[],allowed:[]});await pending;assert.equal($("adminBody").hidden,true);assert.equal($("adminUsers").innerHTML,'');assert.equal($("adminErr").textContent,'権限がありません');
});


test('管理画面を開いたまま認証が更新されたら新しい権限で読み直す',()=>{
 let refresh=0;const button={textContent:'',classList:{toggle(){},remove(){}},setAttribute(){}};
 const auth={role:'admin',loginId:'fixture'};const ctx={auth,atAdmin:true,adminRenderAuth:auth,renderAdmin:()=>refresh++,renderTools(){},redrawIfToolsChanged(){},atRecords:false,$:()=>button,syncError:null,pushQueue:[]};
 const update=runInNewContext(grab('function renderAuthButton')+';renderAuthButton',ctx);update();assert.equal(refresh,0);
 ctx.auth={...auth};update();assert.equal(refresh,1);
 ctx.auth=null;update();assert.equal(refresh,2);assert.equal(button.textContent,'ログイン');
});

test('左端スワイプは主要ページでメニュー、詳細では戻るだけ',()=>{
 const a=html.indexOf('const SWIPE_EDGE_PX = 28;'),b=html.indexOf('// Safari のつまむ拡大',a);
 function boot(main){const handlers={},menu={hidden:true,classList:{contains:()=>false,add(){}},style:{},offsetWidth:300},scrim={hidden:true,classList:{add(){}},style:{}};let opened=0,back=0;
 runInNewContext(html.slice(a,b),{document:{addEventListener:(t,f)=>handlers[t]=f,querySelector:()=>null},$:id=>id==='toolsMenu'?menu:id==='toolsScrim'?scrim:{hidden:false},isMenuPage:()=>main,clearTimeout(){},toolsAnim:0,markToolsCurrent(){},performance:{now:()=>200},openTools:()=>opened++,closeTools(){},goBack:()=>back++});
 const event=(x,y=30,time=100)=>({touches:[{clientX:x,clientY:y}],target:{closest:()=>null},timeStamp:time,preventDefault(){}});
 return {handlers,menu,event,counts:()=>({opened,back})};}
 const detail=boot(false);detail.handlers.touchstart(detail.event(4));detail.handlers.touchmove(detail.event(104,30,200));detail.handlers.touchend({type:'touchend'});assert.deepEqual(detail.counts(),{opened:0,back:1});assert.equal(detail.menu.hidden,true);
 const main=boot(true);main.handlers.touchstart(main.event(4));main.handlers.touchmove(main.event(204,30,200));main.handlers.touchend({type:'touchend'});assert.deepEqual(main.counts(),{opened:1,back:0});
 for(const mode of ['cancel','vertical','short']){const x=boot(false);x.handlers.touchstart(x.event(4));x.handlers.touchmove(mode==='vertical'?x.event(8,100,200):x.event(mode==='short'?20:104,30,200));x.handlers[mode==='cancel'?'touchcancel':'touchend']({type:mode==='cancel'?'touchcancel':'touchend'});assert.deepEqual(x.counts(),{opened:0,back:0});}
});
