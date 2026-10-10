import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
const helpers=html.slice(html.indexOf('function aimDaysInputKey('),html.indexOf('async function aimRenderFrom()'));
const DAY=86400000,base=Date.parse('2026-10-10T12:00:00+09:00');
const start=t=>Math.floor((t+9*3600000)/DAY)*DAY-9*3600000;
function fixture(){
 let now=base,calls=0,air='a',pending=null;
 const point={name:'豊洲',latitude:35.64,longitude:139.78,groundManualM:5.5,standAglM:1.5};
 const obs={latitude:point.latitude,longitude:point.longitude,elevation:5.5,eyeM:1.5};
 const aim={target:{id:'tower',latitude:35.66,longitude:139.74,parts:[{id:'tip',m:330}]},body:'moon',partId:'__whole',limb:'onTop',dayMs:start(now),fromSeq:1};
 const dom={innerHTML:'候補日',querySelectorAll:()=>[]};
 const c={Date:class extends Date{static now(){return now}},setTimeout,aim,fujiGrid:null,S:{Cal:{startOfDay:start},JstCal:{sameDay:(a,b)=>start(a)===start(b)}},SoramiAtmosphere:{dataKey:()=>air},$:()=>dom,esc:x=>x,aimFromPoint:()=>point,aimObserverEye:f=>f.standAglM,aimIsMountain:()=>false,
  aimBuildingDays:async(o,t,b,p,s,options)=>{calls++;if(pending)await pending;return options.isCurrent()?[{at:now+3600000,intersects:true,sunAltitude:-10}]:[];},SoramiAlign:{upcoming:()=>{throw Error('wrong route')}}};
 vm.createContext(c);vm.runInContext(helpers,c);
 return {c,aim,point,obs,dom,get calls(){return calls},setNow:t=>now=t,setAir:x=>air=x,hold:()=>{let release;pending=new Promise(r=>release=r);return release},key:()=>c.aimDaysInputKey(point),run:()=>c.aimDaysFor(obs,c.aimDaysInputKey(point))};
}
test('日付・描画世代が変わっても完成済みの候補と空の結果を再利用',async()=>{
 const f=fixture(),rows=await f.run();f.dom.innerHTML='候補日';f.aim.dayMs+=DAY;f.aim.fromSeq++;assert.equal(await f.run(),rows);assert.equal(f.calls,1);assert.equal(f.dom.innerHTML,'候補日');
 f.aim.fromDays.rows=[];assert.deepEqual(await f.run(),[]);assert.equal(f.calls,1);
});
test('候補探索中の連続した日付操作でも探索は1回',async()=>{
 const f=fixture(),release=f.hold(),a=f.run();await new Promise(r=>setTimeout(r,10));f.aim.dayMs+=DAY;f.aim.fromSeq++;const b=f.run();release();assert.equal(await a,await b);assert.equal(f.calls,1);
});
test('地点・標高・目の高さ・天体・部位・目標の同ID座標と形状・大気を鍵にする',()=>{
 const mutations=[f=>f.point.latitude+=.01,f=>f.point.longitude+=.01,f=>f.point.groundManualM++,f=>f.point.observationElevationM=10,f=>f.point.standAglM++,f=>f.aim.body='sun',f=>f.aim.partId='tip',f=>f.aim.target.latitude+=.01,f=>f.aim.target.parts[0].m++,f=>f.aim.target.rim=[[1,2]],f=>f.setAir('b')];
 for(const change of mutations){const f=fixture(),k=f.key();change(f);assert.notEqual(f.key(),k);}
 const f=fixture(),k=f.key();f.aim.dayMs+=DAY;f.aim.limb='behind';f.c.fujiGrid={};assert.equal(f.key(),k);f.aim.partId='tip';const partKey=f.key();f.aim.limb='center';assert.notEqual(f.key(),partKey);
});
test('必要な再探索と古い非同期結果の破棄、実際の地面標高の更新',async()=>{
 const f=fixture(),release=f.hold(),old=f.run();await new Promise(r=>setTimeout(r,10));f.point.latitude+=.01;const newer=f.run();release();assert.equal(await old,null);assert.ok(await newer);assert.equal(f.calls,2);
 f.obs.elevation++;await f.run();assert.equal(f.calls,3);
});
test('探索中の気象データ更新は結果をキャッシュしない',async()=>{
 const f=fixture(),release=f.hold(),task=f.run();await new Promise(r=>setTimeout(r,10));f.setAir('b');release();assert.equal(await task,null);assert.equal(f.aim.fromDays,null);await f.run();assert.equal(f.calls,2);
});
test('候補時刻を過ぎたときと日本時間の日付が変わったときは再探索',async()=>{
 const f=fixture();await f.run();f.setNow(base+3600000);await f.run();assert.equal(f.calls,2);f.setNow(start(base)+DAY);await f.run();assert.equal(f.calls,3);
});
test('大気データの鍵は取得失敗を除外し成功・期限切れ・設定変更を検知',async()=>{
 const require=createRequire(import.meta.url);let now=base;
 const c={require,Date:class extends Date{static now(){return now}},URLSearchParams,AbortController,setTimeout,clearTimeout};vm.createContext(c);vm.runInContext(fs.readFileSync(new URL('./sorami-atmosphere.js',import.meta.url),'utf8'),c);const M=c.SoramiAtmosphere,o={latitude:35,longitude:139,elevation:0};M.configure('auto');const initial=M.dataKey();
 await M.load(o,base+30*DAY,{now,fetcher:async()=>{throw Error('must not fetch')}});assert.equal(M.dataKey(),initial);
 await M.load({...o,latitude:36},base,{now,fetcher:async()=>{throw Error('network')}});assert.equal(M.dataKey(),initial);
 const raw={hourly_units:{surface_pressure:'hPa',temperature_2m:'°C'},hourly:{time:[base/1000,(base+3600000)/1000],surface_pressure:[1010,1008],temperature_2m:[10,11]}};
 await M.load(o,base,{now,fetcher:async()=>({ok:true,json:async()=>raw})});const loaded=M.dataKey();assert.notEqual(loaded,initial);assert.equal(M.dataKey(),loaded);now+=3600000;assert.equal(M.dataKey(),initial);
 await M.load(o,base,{now,fetcher:async()=>({ok:true,json:async()=>raw})});assert.notEqual(M.dataKey(),loaded);
 M.configure('manual',{pressureHPa:1000,temperatureC:10});const manual=M.dataKey();M.configure('manual',{pressureHPa:1001,temperatureC:10});assert.notEqual(M.dataKey(),manual);M.configure('standard');const standard=M.dataKey();now+=3600000;assert.equal(M.dataKey(),standard);
});
