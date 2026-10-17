import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('./sorami-myplaces.js',import.meta.url),'utf8');
function elements(){const map=new Map();return {map,el:id=>{if(!map.has(id))map.set(id,{classList:{toggle(){}},replaceChildren(){},append(){},focus(){}});return map.get(id);}};}
test('記録追加は撮影地点が空のフォームで開き、既存の地点オブジェクトを変更しない',()=>{
 const {el}=elements();const sheet={open:false,querySelectorAll:()=>[]};let shown=0;
 const fragment=source.slice(source.indexOf('function openPlace('),source.indexOf('function renderSheet('));
 const api=new Function('sheet','el','aim','savedTargets','targetSetKey','targetChoices','resolveTarget','Option','finite','toolAllowed','screenAllowed','showSheet','renderSheet','addDraftTarget','const auth={token:"test"};let sheetState=null;'+fragment+';return {openPlace,state:()=>sheetState};')(sheet,el,{target:null,body:'sun'},()=>[],JSON.stringify,()=>[],()=>null,function(text,value){return {text,value};},Number.isFinite,()=>true,()=>true,()=>shown++,()=>{},()=>{});
 api.openPlace(null,'records');assert.equal(api.state().place.id,null);assert.equal(el('myPlaceName').textContent,'撮影地点を選ぶ');assert.equal(el('myPlaceTitle').textContent,'記録を追加');assert.equal(shown,1);
 const place={id:'p',name:'地点',latitude:35,longitude:139};api.openPlace(place,'records');api.state().place.name='編集';assert.equal(place.name,'地点');
});
test('撮影地点未選択では対象と保存を待機にし、補助項目を隠す',()=>{
 const {el}=elements(),state={place:{id:null},ctx:'records',draftTargets:[]};
 const start=source.indexOf('function renderSheet()'),end=source.indexOf('  const next =',start);const body=source.slice(start,end)+'}';
 const render=new Function('sheetState','el','load','document','draftChanged','let sheetToken=0;'+body+';return renderSheet;')(state,el,()=>[],{createElement:()=>({})},()=>false);
 render();assert.equal(el('myRecordSave').disabled,true);assert.equal(el('myRecordPickTarget').disabled,true);assert.equal(el('myPlacePlanning').hidden,true);assert.equal(el('myPlaceDetails').hidden,true);
 state.place.id='p';render();assert.equal(el('myRecordPickTarget').disabled,false);assert.equal(el('myRecordSave').disabled,true);
});
