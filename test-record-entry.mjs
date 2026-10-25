import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('./astronotes-myplaces.js',import.meta.url),'utf8');
function elements(){const map=new Map();return {map,el:id=>{if(!map.has(id))map.set(id,{classList:{toggle(){}},replaceChildren(){},append(){},focus(){},setAttribute(){}});return map.get(id);}};}
test('記録追加は撮影地点が空のフォームで開き、既存の地点オブジェクトを変更しない',()=>{
 const {el}=elements();const sheet={open:false,querySelectorAll:()=>[]};let shown=0;
 const fragment=source.slice(source.indexOf('function openPlace('),source.indexOf('function renderSheet('));
 const api=new Function('sheet','el','aim','savedTargets','targetSetKey','targetChoices','resolveTarget','Option','finite','toolAllowed','screenAllowed','showSheet','renderSheet','addDraftTarget','const shapeFor=()=>null,shapeKey=JSON.stringify,shapeName=()=>"点";const auth={token:"test"};let sheetState=null;'+fragment+';return {openPlace,state:()=>sheetState};')(sheet,el,{target:null,body:'sun'},()=>[],JSON.stringify,()=>[],()=>null,function(text,value){return {text,value};},Number.isFinite,()=>true,()=>true,()=>shown++,()=>{},()=>{});
 api.openPlace(null,'records');assert.equal(api.state().place.id,null);assert.equal(el('myPlaceName').textContent,'撮影地点を選ぶ');assert.equal(el('myPlaceTitle').textContent,'記録を追加');assert.equal(shown,1);
 const place={id:'p',name:'地点',latitude:35,longitude:139};api.openPlace(place,'records');api.state().place.name='編集';assert.equal(place.name,'地点');
});
test('撮影地点未選択では対象と保存を待機にし、補助項目を隠す',()=>{
 const {el}=elements(),state={place:{id:null},ctx:'records',draftTargets:[]};
 const start=source.indexOf('function renderSheet()'),end=source.indexOf('  const next =',start);const body=source.slice(start,end)+'}';
 const render=new Function('sheetState','el','load','document','draftChanged','const ensureRecordLocation=()=>{},recordCoordinates=()=>"座標",finite=Number.isFinite,shapeName=()=>"点",screenAllowed=()=>true,draftPoint=()=>Number.isFinite(sheetState.place.latitude)&&Number.isFinite(sheetState.place.longitude);let sheetToken=0;'+body+';return renderSheet;')(state,el,()=>[],{createElement:()=>({})},()=>false);
 render();assert.equal(el('myRecordSave').disabled,true);assert.equal(el('myRecordPickTarget').disabled,true);assert.equal(el('myPlacePlanning').hidden,true);assert.equal(el('myPlaceDetails').hidden,true);
 state.place.id='p';state.place.latitude=35;state.place.longitude=139;render();assert.equal(el('myRecordPickTarget').disabled,false);assert.equal(el('myRecordSave').disabled,true);
});

test('候補一覧は古い観測日を確認日として表示せず、部分視認と候補時刻は保つ',()=>{
 const create=()=>({textContent:'',children:[],append(...nodes){this.children.push(...nodes);},replaceChildren(){this.children=[];}}),content=create();
 const rows=['seen','partial'].map((result,i)=>({place:{name:'川沿い',latitude:35+i*.001,longitude:139},event:{at:i,side:'set'},record:{result,date:'2020-01-01',createdAt:1},shapeType:'line'}));
 const fragment=source.slice(source.indexOf('function drawCandidateList('),source.indexOf('function chooseCandidate('));
 const draw=new Function('candidateSheet','el','document','candidateState','skySession','S','sideName','chooseCandidate',fragment+';return drawCandidateList;')({open:true},()=>content,{createElement:create},{status:'ready',rows,failed:0},{body:'sun'},{JstCal:{hhmm:()=> '16:20'}},()=> '日の入',()=>{});
 draw();const text=content.children.slice(1).map(n=>n.children.map(c=>c.textContent).join(' '));
 assert.match(text[0],/16:20・日の入・登録済みの対象.*線上/);assert.match(text[1],/一部見える対象/);assert.ok(text.every(t=>!t.includes('2020-01-01')&&!t.includes('確認）')));
});

test('任意名は地点表示と独立し、空欄は逆引き名、取得不能は座標で保存名になる',async()=>{
 const pending=[];let state={place:{name:'',latitude:35,longitude:139}},renders=0;
 const fragment=source.slice(source.indexOf('const recordCoordinates='),source.indexOf('function buildSheet()'));
 const api=new Function('nearName','AbortController','setTimeout','clearTimeout','initial',`let sheetState=initial;const sheet={open:true},draftPoint=()=>Number.isFinite(sheetState.place.latitude),sheetOwnerMatches=()=>true;let renders=0;const renderSheet=()=>renders++;${fragment};return {ensureRecordLocation,recordPlaceName,set:s=>sheetState=s,state:()=>sheetState,renders:()=>renders};`)((lat,lon)=>new Promise(resolve=>pending.push(resolve)),AbortController,setTimeout,clearTimeout,state);
 api.ensureRecordLocation();assert.equal(state.locationPending,true);assert.equal(api.recordPlaceName(state),'35.00000, 139.00000');
 pending.shift()({name:'代々木公園',area:'東京都渋谷区'});await new Promise(setImmediate);
 assert.equal(api.recordPlaceName(state),'代々木公園');assert.equal(state.locationLabel,'東京都渋谷区 ・ 代々木公園');assert.equal(state.place.name,'');assert.equal(state.locationPending,false);
 state.place.name='  お気に入りの撮影場所  ';assert.equal(api.recordPlaceName(state),'お気に入りの撮影場所');assert.match(state.locationLabel,/代々木公園/);
 state.place.name='';state.place.latitude=36;api.ensureRecordLocation();const old=pending.shift();state.place.latitude=37;api.ensureRecordLocation();old({name:'古い地点',area:'旧住所'});await new Promise(setImmediate);assert.notEqual(state.locationName,'古い地点');assert.equal(state.locationPending,true);
 pending.shift()({name:'37.0000, 139.0000',area:''});await new Promise(setImmediate);assert.equal(state.locationName,'37.0000, 139.0000');assert.equal(state.locationPending,false);
});
