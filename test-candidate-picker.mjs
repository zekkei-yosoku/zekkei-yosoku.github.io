import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),P=require('./sorami-shooting.js');
const source=fs.readFileSync(new URL('./sorami-myplaces.js',import.meta.url),'utf8');
const fn=source.slice(source.indexOf('async function renderPickerPanel('),source.indexOf('// ---------------------------------------------------------------- 地図：'));
function fixture(mode='aim',{waiting=false}={}){
 const node=tag=>({tag,children:[],textContent:'',append(...v){this.children.push(...v)},prepend(...v){this.children.unshift(...v)},replaceChildren(...v){this.children=v},querySelector(){return this.children.find(x=>x.className==='my-picker')}});
 const panel=node('section'),sheet={open:true,close(){this.open=false}},at=Date.parse('2026-10-24T00:00:00+09:00'),target={id:'skytree',name:'塔',latitude:35,longitude:139,parts:[{id:'tip',m:634}]};
 const point={place:{id:'my-place',name:'登録した地点',latitude:35.1,longitude:139.1,elevation:20,eyeHeightAGL:4},record:{result:'seen'}};
 let resolve,selected;const state={observer:null,target,body:'sun',partId:'tip',limb:'center',at};
 const c={pickerToken:0,auth:{token:'owner',loginId:'owner'},placeSheetFor:mode,skySession:state,aim:{...state,dayMs:at},document:{createElement:node},el:()=>sheet,SoramiShooting:P,SoramiAtmosphere:{dataKey:()=>''},screenAllowed:()=>true,S:{Cal:{monthDay:()=> '10/24'},JstCal:{hhmm:()=> '16:13'}},SoramiBodies:{definition:()=>({name:'太陽'}),ensure:()=>waiting?new Promise(r=>resolve=r):Promise.resolve()},pointsForPlan:()=>[point],aimIsMountain:()=>false,aimSavedFrom:x=>x,aimObserverAt:(f,g)=>({...f,elevation:g,eyeM:f.eyeHeightAGL}),aimElevation:async()=>20,SoramiAlign:{upcoming:(o,t,b,opts)=>{assert.equal(o.eyeM,4);assert.equal(opts.from,at);return[{at:at+16*3600000+13*60000+57000,gap:0,side:'set'}]}},sideName:()=> '日の入',RESULTS:{seen:{name:'見えた'}},contextOf:()=> 'current',SkyMapUI:{selectCandidate:(row,key)=>{selected={row,key,mode:'sky'};return true}},openInAim:(place,event)=>selected={place,event,mode:'aim'}};
 vm.createContext(c);vm.runInContext(fn,c);return {c,panel,sheet,point,run:()=>c.renderPickerPanel(panel),release:()=>resolve(),selected:()=>selected,buttons:()=>panel.children[0].children.filter(x=>x.tag==='button')};
}
test('構図と地図の地点入力は未選択でも同じ指定日候補を出し、選択に地点・高さ・秒まで渡す',async()=>{
 for(const mode of ['aim','skymap']){const f=fixture(mode);await f.run();const buttons=f.buttons();assert.equal(buttons.length,1);buttons[0].onclick();assert.equal(f.sheet.open,false);const selected=f.selected(),event=selected.event||selected.row.event,place=selected.place||selected.row.place;assert.equal(place.id,'my-place');assert.equal(place.eyeHeightAGL,4);assert.equal(new Date(event.at).getUTCSeconds(),57);}
});
test('候補の計算中にアカウント変更・閉じる・条件変更が起きると古い候補を描かない',async()=>{
 for(const change of [f=>f.c.auth={token:'other',loginId:'other'},f=>f.sheet.close(),f=>f.c.aim.dayMs+=86400000]){const f=fixture('aim',{waiting:true}),job=f.run();change(f);f.release();await job;assert.equal(f.buttons().length,0);}
});
test('表示済み候補も条件や所有者が変われば選べない',async()=>{const f=fixture();await f.run();const button=f.buttons()[0];f.c.auth={token:'other',loginId:'other'};button.onclick();assert.equal(f.selected(),undefined);assert.equal(f.sheet.open,true);});
test('次に重なる日も保存標高と地上高で計算し、保存標高の変更はcacheを共有しない',async()=>{
 const start=source.indexOf('function nextFor('),end=source.indexOf('// ---------------------------------------------------------------- 一覧の行',start),seen=[];
 const c={cache:new Map(),queue:Promise.resolve(),SoramiShooting:P,aimSavedFrom:p=>p,aimObserverEye:p=>p.eyeHeightAGL,aimElevation:async()=>{throw Error('DEM must not replace saved height');},aimObserverAt:(f,g)=>({...f,elevation:g,eyeM:f.eyeHeightAGL}),SoramiAlign:{partOf:()=>({m:634})},SoramiBodies:{ensure:async()=>{}},aimBuildingDays:async o=>{seen.push([o.elevation,o.eyeM]);return[{at:Date.now()+3600000}]},S:{Cal:{startOfDay:P.day}},DAY:86400000,Date,Promise,JSON};
 vm.createContext(c);vm.runInContext(source.slice(start,end),c);const p={latitude:35,longitude:139,elevation:30,eyeHeightAGL:4},t={id:'tower',latitude:35.1,longitude:139.1};await c.nextFor(p,t,'sun');await c.nextFor(p,t,'sun');await c.nextFor({...p,elevation:31},t,'sun');assert.deepEqual(seen,[[30,4],[31,4]]);
});
