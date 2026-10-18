import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),P=require('./sorami-shooting.js'),A=require('./sorami-align.js');
const ll=(x,y=0)=>({latitude:35+y/111195,longitude:139+x/(111195*Math.cos(35*Math.PI/180))});
const shape=(type,coords)=>({type,vertices:coords.map(([x,y])=>ll(x,y))});
const at=Date.parse('2026-10-24T12:00:00+09:00');
const plan={target:{...ll(500,500),parts:[{id:'tip',m:100}]},body:'sirius',at,partId:'tip',limb:'center'};
const entry=s=>({place:{...ll(0),id:'river',name:'川沿い',elevation:999,groundManualM:999,shape:s},record:{result:'seen'}});
const deps=fn=>({ensure:async()=>{},isMountain:()=>false,observerAt:(p,g)=>({...p,elevation:g}),elevationAt:async(lat,lon)=>0,align:{upcoming:o=>[{at,gap:fn(o),radius:0,side:'set'}]}});
test('2点の直線・3点の折れ線を保存し、直線に丸めない',()=>{
 const s=shape('line',[[0,0],[100,100],[200,0]]);assert.equal(P.cleanShape(s).vertices.length,3);
 assert(P.shapeContains(s,ll(50,50)));assert(!P.shapeContains(s,ll(100,0)));
 assert(P.shapeContains(shape('line',[[0,0],[200,0]]),ll(100,0)));
});
test('範囲の内側・境界を含み、凹みと外側を除外する',()=>{
 const s=shape('area',[[0,0],[100,0],[100,100],[50,50],[0,100]]);
 assert(P.cleanShape(s));assert(P.shapeContains(s,ll(50,25)));assert(P.shapeContains(s,ll(0,50)));
 assert(!P.shapeContains(s,ll(50,80)));assert(!P.shapeContains(s,ll(110,50)));
 for(const row of P.shapePaths(s))for(const p of row)assert(P.shapeContains(s,p));
});
test('壊れた形・自己交差・無効座標・巨大な範囲は成功扱いしない',()=>{
 assert.equal(P.cleanShape(shape('line',[[0,0]])),null);
 assert.equal(P.cleanShape(shape('area',[[0,0],[100,100],[0,100],[100,0]])),null);
 assert.equal(P.cleanShape({type:'line',vertices:[ll(0),{latitude:NaN,longitude:139}]}),null);
 assert.throws(()=>P.shapePaths(shape('area',[[0,0],[10000,0],[10000,10000],[0,10000]])),/shape-limit/);
});
test('端点が不一致でも線の途中の狭い重なりを解き、代表点へ戻さない',async()=>{
 const s=shape('line',[[0,0],[100,0]]),root=ll(43.789).longitude;
 const result=await P.candidates(plan,[entry(s)],deps(o=>(o.longitude-root)*1000));
 assert(result.rows.length);for(const r of result.rows){assert(P.shapeContains(s,r.place));assert(P.meters(r.place,ll(43.789))<2);assert.equal(r.place.elevation,0);assert.equal(r.place.groundManualM,0);assert.equal(r.place.shape,undefined);}
});
test('3点の第二辺にある候補も計算する',async()=>{
 const s=shape('line',[[0,0],[0,100],[100,100]]),root=ll(62.345,100).longitude;
 const result=await P.candidates(plan,[entry(s)],deps(o=>(o.longitude-root)*1000));
 assert(result.rows.some(r=>P.meters(r.place,ll(62.345,100))<2));
});
test('枠の内部を走査し、内部だけの解を返す',async()=>{
 const s=shape('area',[[0,0],[100,0],[100,100],[0,100]]),root=ll(43.789).longitude;
 const result=await P.candidates(plan,[entry(s)],deps(o=>Math.abs(o.latitude-ll(0,50).latitude)<.0003?(o.longitude-root)*1000:1));
 assert(result.rows.some(r=>r.place.latitude>ll(0,0).latitude&&r.place.latitude<ll(0,100).latitude));
 assert(result.rows.every(r=>P.shapeContains(s,r.place)));
});
test('地点ごとの標高を使い、標高欠測は部分的な取得不能として残す',async()=>{
 const s=shape('line',[[0,0],[100,0]]),d=deps(()=>0);let calls=0;
 d.elevationAt=async(lat,lon)=>{calls++;return lon>ll(50).longitude?null:17;};
 const result=await P.candidates(plan,[entry(s)],d);assert(calls>2);assert.equal(result.failed,1);assert.equal(result.issues[0].reason,'elevation');assert(result.rows.every(r=>r.place.elevation===17));
});
test('巨大形状の上限と取消を、候補0件の成功へ変換しない',async()=>{
 const d=deps(()=>0),large=shape('area',[[0,0],[10000,0],[10000,10000],[0,10000]]);
 const result=await P.candidates(plan,[entry(large)],d);assert.equal(result.failed,1);assert.equal(result.issues[0].reason,'limit');
 let current=true;d.elevationAt=async()=>{current=false;return 0;};d.isCurrent=()=>current;
 assert.equal((await P.candidates(plan,[entry(shape('line',[[0,0],[100,0]]))],d)).cancelled,true);
});
test('形の変更はキャッシュを変え、撮影地点未選択でも同じ形を計算する',async()=>{
 const a=entry(shape('line',[[0,0],[100,0]])),b=entry(shape('line',[[0,0],[200,0]]));
 assert.notEqual(P.queryKey(plan,[a],'user','a'),P.queryKey(plan,[b],'user','a'));
 const d=deps(()=>0);assert.deepEqual(await P.candidates({...plan,observer:null},[a],d),await P.candidates(plan,[a],d));
});
test('実天文計算でも線上・範囲内の選択位置と時刻で再計算が一致する',async()=>{
 const t=A.targetById('skytree'),lines=await A.line(t,'sun',at,{sides:['set'],partId:'tip',limb:'center',minKm:9,maxKm:11,stepKm:1,elevationAt:async()=>0});
 const hit=lines[0].points[1],s={type:'line',vertices:[{latitude:hit.latitude-.001,longitude:hit.longitude},{latitude:hit.latitude+.001,longitude:hit.longitude}]};
 const p={...plan,target:t,body:'sun',matchMode:'overlap',partId:'__whole'};
 const d={ensure:async()=>{},isMountain:()=>false,observerAt:(f,g)=>({...f,elevation:g,eyeM:1.5}),elevationAt:async()=>0,align:A};
 const result=await P.candidates(p,[entry(s)],d);assert(result.rows.length);
 for(const r of result.rows){assert(P.shapeContains(s,r.place));assert(A.alignmentAt({...r.place,elevation:0},t,'sun',r.event.at,{partId:'__whole',eyeM:1.5}).matched);}
});

import fs from 'node:fs';
import vm from 'node:vm';
const ui=fs.readFileSync(new URL('./sorami-myplaces.js',import.meta.url),'utf8'),html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
test('形はアカウントで隔離し、移動したお気に入りへ旧形状を付け替えない',()=>{
 const values=new Map(),auth={loginId:'first'},f={id:'same',...ll(0)};
 const c={auth,store:{get:(k,d)=>values.get(k)??d},SoramiShooting:P};vm.createContext(c);
 vm.runInContext(ui.slice(ui.indexOf('const shapesKey='),ui.indexOf('let shapeDialog=')),c);
 values.set('sorami.placeShapes.v1:first',{same:{...ll(0),shape:shape('line',[[0,0],[100,0]])}});
 assert.equal(c.shapeFor(f).type,'line');auth.loginId='second';assert.equal(c.shapeFor(f),null);auth.loginId='first';assert.equal(c.shapeFor({...f,latitude:36}),null);
 c.f=f;assert.equal(vm.runInContext('withShape(f).shape.vertices.length',c),2);
});
test('共通ピッカーは線・範囲を代表座標として即選択せず、その日の候補へ進む',()=>{
 let candidates=0;const c={shapeFor:p=>p.id==='shape'?{}:null,recentHistory:{candidates:()=>candidates++}};
 vm.createContext(c);vm.runInContext(ui.slice(ui.indexOf('let pickerToken ='),ui.indexOf('async function renderPickerPanel(')),c);
 assert.equal(c.selectShape({id:'shape'},'aim'),true);assert.equal(candidates,1);
 assert.equal(c.selectShape({id:'shape'},'skymap'),true);assert.equal(c.selectShape({id:'point'},'aim'),false);assert.equal(c.selectShape({id:'shape'},'recordTarget'),false);
 assert.match(html,/function choosePlace\(p\) \{\s*if\(globalThis.MyPlacesUI\?\.selectShape/);
});
test('記録から地図へは非同期起動前に未選択と枠の中心を渡す',()=>{
 const previous={observer:ll(0),body:'sun',at,targetId:'skytree'},shapeValue=shape('area',[[0,0],[100,0],[100,100],[0,100]]);
 const c={auth:{token:'test'},toolAllowed:()=>true,validPoint:P.point,session:previous,store:{get:()=>previous},skyStoreKey:()=>'',SoramiShooting:P,aimSavedFrom:x=>x,pushRoute:()=>{}};vm.createContext(c);
 vm.runInContext('let pending;'+html.slice(html.indexOf(' function enterRecords('),html.indexOf(' function start(){',html.indexOf(' function enterRecords(')))+';this.pendingState=()=>pending;',c);
 assert(c.enterRecords({...ll(0),id:'shape'},{shape:shapeValue,targetIds:['skytree']}));
 assert.equal(c.pendingState().observer,null);assert.equal(c.pendingState().targetId,'skytree');assert(P.shapeContains(shapeValue,c.pendingState().mapCenter));
 c.enterRecords(ll(0));assert.equal(c.pendingState().observer.latitude,35);
});
test('形だけの保存・容量不足・別画面の編集競合を検査する',()=>{
 const f={id:'p',...ll(0)},s=shape('line',[[0,0],[100,0]]),nodes=new Map();let data={},fail=false;
 const state={place:f,initialTargets:[],draftTargets:[],baseline:'[]',initialShape:null,draftShape:s,shapeBaseline:'null'};
 const c={sheetOwnerMatches:()=>true,sheetState:state,el:id=>{if(!nodes.has(id))nodes.set(id,{focus(){}});return nodes.get(id)},placeOf:()=>f,shapeFor:()=>data.p?.shape||null,shapeKey:JSON.stringify,shapeData:()=>data,shapesKey:()=> 'shapes',store:{set:(k,v)=>{if(fail)return false;data=v;return true;}},targetSetKey:JSON.stringify,savedTargets:()=>[],registrationChanges:()=>[],load:()=>[],version:0,candidateCache:new Map(),changed(){},renderSheet(){}};
 vm.createContext(c);vm.runInContext(ui.slice(ui.indexOf('function saveRecord()'),ui.indexOf('// 観測地点（または地図',ui.indexOf('function saveRecord()'))),c);
 fail=true;assert.equal(c.saveRecord(),false);assert.equal(data.p,undefined);assert.equal(state.draftShape,s);
 fail=false;assert.equal(c.saveRecord(),true);assert.equal(data.p.shape.type,'line');assert.equal(state.shapeBaseline,JSON.stringify(s));
 state.draftShape=shape('line',[[0,0],[200,0]]);data={p:{shape:shape('line',[[0,0],[300,0]])}};assert.equal(c.saveRecord(),false);assert.match(nodes.get('myRecordError').textContent,/別の画面/);
});

function newShapeHarness(){
 const nodes=new Map(),make=()=>({children:[],dataset:{},value:'',disabled:false,open:false,append(...v){this.children.push(...v)},replaceChildren(...v){this.children=v},setAttribute(k,v){this[k]=v},addEventListener(){},close(){this.open=false}});
 const state={place:{id:null,name:'',latitude:null,longitude:null},draftShape:null};let picks;
 const map={setOverlay(){},onPick(fn){picks=fn},open(){},setView(...v){this.view=v},center:()=>ll(0),project:(lat,lon)=>[lon,lat],redraw(){}};
 const c={sheetState:state,sheetOwnerMatches:()=>true,auth:{token:'owner'},el:id=>{if(!nodes.has(id))nodes.set(id,make());return nodes.get(id)},document:{createElement:make,body:{append(){}}},PLACE_PICKERS:{},SoramiShooting:P,place:{...ll(0)},placeNear:()=>null,createMapView:()=>map,showSheet:d=>{d.open=true},renderSheet(){},openPlaceSheet(){},shapeName:s=>s?.type==='area'?'範囲':s?.type==='line'?'線':'点',structuredClone,Option:function(text,value){return {text,value}}};
 vm.createContext(c);vm.runInContext(ui.slice(ui.indexOf('let shapeDialog='),ui.indexOf('// ---------------------------------------------------------------- 記録：')),c);
 return {c,state,nodes,map,pick:(p)=>picks(p,{x:1000,y:1000}),value:()=>vm.runInContext('shapeEdit.value',c)};
}
test('地点0件から線を選び、検索は移動だけ、2点/3点を作って未保存の対象入力へ進む',()=>{
 const h=newShapeHarness();h.c.openShapeEditor('line');assert.equal(h.value().vertices.length,0);assert(h.nodes.get('shapeApply').disabled);
 h.c.PLACE_PICKERS.recordShape.set({...ll(500),name:'川沿い'});assert.equal(h.value().vertices.length,0);assert.equal(h.map.view[0],ll(500).latitude);assert.equal(h.state.place.id,null);
 h.pick(ll(0));h.pick(ll(100));assert.equal(h.value().vertices.length,2);assert.equal(h.nodes.get('shapeApply').disabled,false);
 h.pick(ll(100,100));h.nodes.get('shapeApply').onclick();assert.equal(h.state.draftShape.vertices.length,3);assert.equal(h.state.place.id,null);assert.equal(h.state.newPlace,true);assert.equal(h.state.place.name,'川沿い');
});
test('範囲は3点で有効、取消では元の地点・形を変更しない。別所有者の適用も拒否',()=>{
 const h=newShapeHarness();h.c.openShapeEditor('area');h.pick(ll(0));h.pick(ll(100));assert(h.nodes.get('shapeApply').disabled);h.pick(ll(100,100));assert.equal(h.nodes.get('shapeApply').disabled,false);
 h.nodes.get('shapeCancel').onclick();assert.equal(h.state.draftShape,null);assert.equal(h.state.place.latitude,null);
 h.c.openShapeEditor('area');h.pick(ll(0));h.pick(ll(100));h.pick(ll(100,100));h.c.auth.token='other';h.nodes.get('shapeApply').onclick();assert.equal(h.state.draftShape,null);
});
test('点も未登録から置ける。形切替後の点は1点だけになり、戻すと線を保持',()=>{
 const h=newShapeHarness();h.c.openShapeEditor('point');assert(h.nodes.get('shapeApply').disabled);h.pick(ll(0));assert.equal(h.nodes.get('shapeApply').disabled,false);
 h.nodes.get('shapeModes').children.find(x=>x.dataset.shapeMode==='line').onclick();h.pick(ll(100));
 h.nodes.get('shapeModes').children.find(x=>x.dataset.shapeMode==='point').onclick();assert.equal(h.value().vertices.length,1);
 h.nodes.get('shapeUndo').onclick();assert.equal(h.value().type,'line');assert.equal(h.value().vertices.length,2);
});
function newRecordHarness(){
 const data=new Map([['observations',[]],['shapes',{}]]),nodes=new Map();let failKey=null,pushes=0;
 const state={place:{...ll(0),id:null,name:'川沿い'},newPlace:true,draftTargets:[{key:'skytree',name:'東京スカイツリー'}],draftShape:shape('line',[[0,0],[100,0]])};
 const c={sheetState:state,sheetOwnerMatches:()=>true,draftPoint:()=>true,el:id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id)},SoramiShooting:P,placeNear:()=>null,key:()=> 'observations',shapesKey:()=> 'shapes',load:()=>data.get('observations'),shapeData:()=>data.get('shapes'),registrationChanges:(p,a,t)=>t.map(target=>({placeId:p.id,target})),favorites:[],store:{set(k,v){if(k===failKey)return false;data.set(k,v);return true;}},saveFavorites:()=>c.store.set('favorites',c.favorites.map(f=>({...f}))),queuePush(){pushes++},shapeKey:JSON.stringify,targetSetKey:JSON.stringify,version:0,candidateCache:new Map(),changed(){},renderSheet(){}};
 vm.createContext(c);vm.runInContext(ui.slice(ui.indexOf('function saveNewRecord()'),ui.indexOf('function saveRecord()')),c);return {c,state,data,nodes,fail:k=>{failKey=k},pushes:()=>pushes};
}
test('新規地点・形・対象を最後にまとめて保存し、保存失敗では地点を残さない',()=>{
 for(const key of ['observations','shapes','favorites']){
  const h=newRecordHarness();h.fail(key);assert.equal(h.c.saveNewRecord(),false);assert.equal(h.c.favorites.length,0);assert.equal(h.data.get('observations').length,0);assert.equal(Object.keys(h.data.get('shapes')).length,0);assert.equal(h.state.place.id,null);assert.equal(h.pushes(),0);
 }
 const h=newRecordHarness();assert.equal(h.c.saveNewRecord(),true);assert.equal(h.c.favorites.length,1);assert.equal(h.data.get('observations')[0].placeId,h.state.place.id);assert.equal(h.data.get('shapes')[h.state.place.id].shape.type,'line');assert.equal(h.state.newPlace,false);assert.equal(h.pushes(),1);
});
test('重複地点は無断で上書きせず、形と対象を既存地点の下書きへ引き継ぐ',()=>{
 const h=newRecordHarness(),existing={...ll(0),id:'existing',name:'既存の川沿い'};h.state.ctx='records';h.c.placeNear=()=>existing;h.c.placeOf=()=>existing;
 const pending=h.state.draftShape;h.c.openPlace=p=>{h.c.sheetState={place:p,draftTargets:[{key:'fuji',name:'富士山'}],draftShape:null};};
 assert.equal(h.c.saveNewRecord(),false);assert.equal(h.c.favorites.length,0);assert.equal(h.nodes.get('myRecordReuse').hidden,false);
 h.nodes.get('myRecordReuse').onclick();assert.equal(h.c.sheetState.place.id,'existing');assert.equal(h.c.sheetState.draftShape,pending);assert.deepEqual(Array.from(h.c.sheetState.draftTargets,t=>t.key),['fuji','skytree']);assert.equal(h.pushes(),0);
});
