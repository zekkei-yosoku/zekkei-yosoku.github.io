import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),root=new URL('./',import.meta.url).pathname,M=require(root+'sorami-atmosphere.js'),A=require(root+'sorami-astro.js'),B=require(root+'sorami-bodies.js'),L=require(root+'sorami-align.js');
const obs={latitude:35.58426157,longitude:139.5685059,elevation:79},day=Date.parse('2026-10-03T00:00:00+09:00');
const raw={hourly_units:{temperature_2m:'°C',surface_pressure:'hPa'},hourly:{time:[day/1000,day/1000+3600,day/1000+7200],temperature_2m:[10,20,30],surface_pressure:[1000,1020,null]}};
test('独立のSæmundsson基準値と気圧温度感度',()=>{
 const air={pressureHPa:1010,temperatureC:10};for(const [h,minutes] of [[0,28.981927],[1,21.743887],[2,16.925715]])assert.ok(Math.abs(M.correction(h,air)*60-minutes)<0.0001);
 assert.equal(M.correction(1,{pressureHPa:505,temperatureC:10}),M.correction(1,air)*.5);
 assert.ok(Math.abs(M.correction(1,{pressureHPa:1010,temperatureC:20})/M.correction(1,air)-283/293)<1e-12);
 assert.equal(M.correction(90,air),0);assert.equal(M.correction(-2,air),0);assert.throws(()=>M.configure('manual',{pressureHPa:1010,temperatureC:-273}),RangeError);
});
test('補正の単調写像と同じモデルの逆関数、範囲外継続も有限',()=>{
 let prev=-Infinity;for(let h=-2;h<=90;h+=.02){const air={pressureHPa:1090,temperatureC:-40},v=h+M.correction(h,air);assert.ok(v>prev);prev=v;assert.ok(Math.abs(M.unrefract(v,air)-h)<1e-8);}
});
test('現地気圧の時間補間、欠測/範囲外/遠方は外挿しない、目の高さ補正',()=>{
 const r=M.parse(raw,obs,'test');let x=M.sample(r,day+1800000,obs);assert.equal(x.temperatureC,15);assert.equal(x.pressureHPa,1010);
 assert.equal(M.sample(r,day-1,obs),null);assert.equal(M.sample(r,day+5400000,obs),null);assert.equal(M.sample(r,day+10800000,obs),null);
 assert.equal(M.sample(r,day,{...obs,latitude:36}),null);assert.equal(M.sample(r,day,{...obs,elevation:400}),null);
 assert.ok(M.sample(r,day,{...obs,elevation:80.5}).pressureHPa<1000);
 assert.throws(()=>M.parse({...raw,hourly_units:{surface_pressure:'Pa',temperature_2m:'°C'}},obs,'test'));
});
test('先の予報をでっち上げない、過去は過去モデル、共有取得と欠測fallback',async()=>{
 const now=day;assert.equal(M.endpoint(obs,day+16*86400000,now),null);assert.match(M.endpoint(obs,day-6*86400000,now).url,/historical-forecast-api/);
 let n=0;await Promise.all([M.load(obs,day,{now,fetcher:async url=>{n++;assert.match(url,/surface_pressure/);assert.doesNotMatch(url,/pressure_msl/);return {ok:true,json:async()=>raw};}}),M.load(obs,day,{now,fetcher:async()=>{throw Error('duplicate');}})]);assert.equal(n,1);
 M.configure('auto');assert.equal(M.at(day+1800000,obs).pressureHPa,1010);assert.equal(M.at(day+86400000*10,obs).fallback,true);
});
test('全8天体の幾何位置不変・比較モード・キャッシュ再補正・月の上下縁',()=>{
 const at=day+22*3600000;M.configure('manual',{pressureHPa:1000,temperatureC:25});
 for(const def of B.definitions){const hot=B.state(def.id,at,obs);M.configure('none');const bare=B.state(def.id,at,obs);assert.equal(hot.azimuth,bare.azimuth);assert.equal(hot.geometricAltitude??hot.altitude,bare.geometricAltitude??bare.altitude);assert.equal(bare.apparentAltitude,bare.geometricAltitude??bare.altitude);M.configure('manual',{pressureHPa:1000,temperatureC:25});}
 const synthetic={geometricAltitude:1,apparentAltitude:1,angularRadius:.25},s=M.apply(synthetic,at,obs);assert.ok(s.upperRadius<.25&&s.lowerRadius<.25);assert.ok(s.lowerRadius<s.upperRadius);
 assert.equal(M.limbAltitude(s,1),s.lowerAltitude);assert.equal(M.limbAltitude(s,-1),s.upperAltitude);
});
test('合わせ方・逆算・図の経路が共通の補正を参照、屈折なし目標k=1',async()=>{
 const t=L.targetById('skytree');M.configure('manual',{pressureHPa:1020,temperatureC:5});
 const s=B.state('moon',day+20*3600000,obs),g=L.geometryFrom(obs,t),j=L.judge('moon',day+20*3600000,obs,g.angle,1,null);assert.equal(j.gap,s.lowerAltitude-g.angle);
 const at=L.altitudeCrossing('moon',day,obs,1,'rise',120000,1);assert.ok(Number.isFinite(at));assert.ok(Math.abs(B.state('moon',at,obs).lowerAltitude-1)<1e-7);
 const rows=L.dailyView(obs,t,'moon',day);assert.ok(rows.length);const center=rows[0];const inv=await L.solveComposition(t,'moon',{around:obs,distanceKm:g.distanceKm,at0:center.at,dx:0,dy:center.gap,groundM:79,dayMs:day});assert.ok(inv&&Math.abs(inv.at-center.at)<60000);
 const path=L.viewPath('moon',obs,center.at,L.viewProjector(0,0),{halfW:30,halfH:30},{includeAt:center.at});const p=path.find(p=>p.at===center.at);assert.equal(p.upperRadius,B.state('moon',center.at,obs).upperRadius);
 M.configure('none');assert.equal(M.targetK(),1);const bare=L.geometryFrom(obs,t);assert.ok(bare.angle<g.angle);M.configure('standard');assert.equal(M.targetK(),7/6);
});
test('予報の終了日はOpen-Meteoの上限（UTCの今日＋15日）を超えない。日本時間0〜9時も',()=>{
 for(const nowIso of ['2026-10-05T01:30:00+09:00','2026-10-05T08:59:00+09:00','2026-10-05T09:00:00+09:00','2026-10-05T23:59:00+09:00']){
  const now=Date.parse(nowIso),utcToday=Date.parse(new Date(now).toISOString().slice(0,10)+'T00:00:00Z');
  const latest=now+14*86400000,url=M.endpoint(obs,latest,now).url,end=new URL(url).searchParams.get('end_date');
  assert.ok(Date.parse(end+'T00:00:00Z')<=utcToday+15*86400000,nowIso+' end_date '+end);
  const jstLatestDay=new Date(latest+9*3600000).toISOString().slice(0,10);
  assert.ok(Date.parse(end+'T23:00:00Z')>=Date.parse(jstLatestDay+'T15:00:00Z')-3600000,'選べる最後の日（+14日）の日本時間の終わりまで取る '+nowIso);
 }
});

// ---- 気象予報: 視線上の気温の柱（2026-10-05）
const RF=require(root+'sorami-refraction.js'),LV=[1000,975,950,925,900,850,800,700,600,500],RG=287.05/9.80665;
const sky=L.targetById('skytree'),skyT={latitude:sky.latitude,longitude:sky.longitude,topM:sky.parts[0].m};
const zOf=p=>44330*(1-Math.pow(p/1013.25,0.1903));
function lineRaw(ep,times,{t2=15,ps=1008,inversion=0,drop=null,peakAt=null}={}){
 return ep.ss.map((s,j)=>j===peakAt?peakRaw(times):({elevation:j?10:79,hourly_units:{temperature_2m:'°C',surface_pressure:'hPa',...Object.fromEntries(LV.map(l=>[`temperature_${l}hPa`,'°C']))},
  hourly:{time:times,temperature_2m:times.map(()=>t2),surface_pressure:times.map(()=>ps),...Object.fromEntries(LV.map(l=>[`temperature_${l}hPa`,times.map((x,i)=>i===drop?null:t2-6.5*zOf(l)/1000+(l>=950?inversion:0))]))}}));
}
// 山頂の点（地上気圧630hPa）。地面より上の気圧面は600・500hPaの2つだけ
function peakRaw(times){return {elevation:3736,hourly_units:{temperature_2m:'°C',surface_pressure:'hPa',...Object.fromEntries(LV.map(l=>[`temperature_${l}hPa`,'°C']))},
 hourly:{time:times,temperature_2m:times.map(()=>-6),surface_pressure:times.map(()=>630),...Object.fromEntries(LV.map(l=>[`temperature_${l}hPa`,times.map(()=>l<630?-6-6.5*(zOf(l)-3736)/1000:5)]))}};}
// テストと同じ作り方で柱を組む（静水圧で高さを積む）
function cols(raw,i){return raw.map((w,j)=>{const h=w.hourly,t2=h.temperature_2m[i],ps=h.surface_pressure[i],g=w.elevation;const lv=[{p:ps,t:t2},...LV.filter(l=>l<ps-1).map(l=>({p:l,t:h[`temperature_${l}hPa`][i]}))];let z=g+2,prev=null;return {s:0,groundM:g,pressureHPa:ps*Math.exp(2/(RG*(t2+273.15))),points:lv.map(l=>{if(prev)z+=RG*((prev.t+l.t)/2+273.15)*Math.log(prev.p/l.p);prev=l;return {z,t:l.t};})};});}
async function loadLine(opts={},o=obs){
 const now=day,ep=M.lineEndpoint(o,skyT,day,now),times=[0,1,2,3].map(k=>(day+20*3600000)/1000+k*3600),raw=lineRaw(ep,times,opts),urls=[];
 await M.load(o,day,{now,target:skyT,fetcher:async url=>{urls.push(url);return {ok:true,json:async()=>/temperature_975hPa/.test(url)?(opts.badUnits?raw.map(w=>({...w,hourly_units:{...w.hourly_units,surface_pressure:'Pa'}})):raw):{hourly_units:{temperature_2m:'°C',surface_pressure:'hPa'},hourly:{time:times,temperature_2m:times.map(()=>opts.t2??15),surface_pressure:times.map(()=>opts.ps??1008)}}};}});
 return {ep,raw,urls};
}
test('視線上の柱の取得: 観測点→目標→その先200kmの8地点、気圧面つき、予報の終了日は地上と同じ',()=>{
 const ep=M.lineEndpoint(obs,skyT,day,day),u=new URL(ep.url),surface=new URL(M.endpoint(obs,day,day).url);
 assert.equal(u.searchParams.get('latitude').split(',').length,8);assert.deepEqual(ep.ss.map(Math.round),[0,13,26,36,51,76,126,226]);
 assert.match(u.searchParams.get('hourly'),/temperature_975hPa/);assert.equal(u.searchParams.get('elevation'),null);
 assert.equal(u.searchParams.get('end_date'),surface.searchParams.get('end_date'));assert.ok(Math.abs(ep.azimuth-57.34)<0.05);
 assert.equal(M.lineEndpoint(obs,{...skyT,topM:NaN},day,day),null);assert.equal(M.lineEndpoint(obs,skyT,day+20*86400000,day),null);
});
test('気象予報で柱がそろえば、目標のてっぺんでの天体と目標の上下は光線追跡どおり（画面のk=7/6の角へずらして返す）',async()=>{
 const {ep,raw,urls}=await loadLine({inversion:4});assert.ok(urls.some(u=>/temperature_975hPa/.test(u)));M.configure('auto');
 const at=day+20*3600000+1800000,eye={...obs,elevation:80.5},g=A.targetElevationAngle(ep.distanceKm,80.5,skyT.topM,{k:7/6});
 // 期待値: 同じ柱で目標の見かけの角を解き、その光が抜ける向き＝てっぺんに重なる天体の真高度（20時と21時の平均の近く）
 const q=i=>{const F=RF.field(cols(raw,i).map((c,j)=>({...c,s:ep.ss[j]*1000})));const e=RF.targetElevation(F,80.5,ep.distanceKm*1000,skyT.topM,{stepScale:4});return RF.trace(F,80.5,e,{stepScale:4}).trueAltitude;};
 const h=(q(0)+q(1))/2,st=M.apply({azimuth:57.3,geometricAltitude:h,apparentAltitude:h,angularRadius:.26},at,eye);
 assert.equal(st.atmosphere.traced,true);assert.ok(Math.abs(st.apparentAltitude-g)*60<0.06,`${(st.apparentAltitude-g)*60}′`);
 assert.ok(st.lowerRadius<st.upperRadius&&st.upperRadius<.26);
 // てっぺん以外（縁・2°上）も、同じ柱でその場で解いた見かけの高さ（k=7/6の枠）と0.1′以内
 const direct=(i,t)=>{const F=RF.field(cols(raw,i).map((c,j)=>({...c,s:ep.ss[j]*1000})));const e=RF.targetElevation(F,80.5,ep.distanceKm*1000,skyT.topM,{stepScale:4});let lo=t,hi=t+1;for(let k=0;k<40;k++){const m=(lo+hi)/2;if(RF.trace(F,80.5,m,{stepScale:4}).trueAltitude<t)lo=m;else hi=m;}return (lo+hi)/2+g-e;};
 for(const x of [h-.26,h+.26,h+2]){const want=(direct(0,x)+direct(1,x))/2,got=M.apply({azimuth:57.3,geometricAltitude:x,apparentAltitude:x,angularRadius:0},at,eye).apparentAltitude;assert.ok(Math.abs(got-want)*60<0.1,`${x}: ${(got-want)*60}′`);}
 const info=M.lineInfo(at,eye);assert.equal(info.points,8);assert.equal(Math.round(info.beyondKm),200);
 // 目標よりずっと高い天体・視線から外れた方角・2km より遠い地点・標準モードは従来の式
 assert.equal(M.apply({azimuth:57.3,geometricAltitude:30,apparentAltitude:30,angularRadius:.26},at,eye).atmosphere.traced,undefined);
 assert.equal(M.apply({azimuth:120,geometricAltitude:h,apparentAltitude:h,angularRadius:.26},at,eye).atmosphere.traced,undefined);
 assert.equal(M.apply({azimuth:57.3,geometricAltitude:h,apparentAltitude:h,angularRadius:.26},at,{...eye,latitude:obs.latitude+.05}).atmosphere.traced,undefined);
 M.configure('standard');assert.equal(M.apply({azimuth:57.3,geometricAltitude:h,apparentAltitude:h,angularRadius:.26},at,eye).atmosphere.traced,undefined);
});
test('気圧面が欠けた時刻・単位の違う応答は柱を作らず、従来の式に戻る（推測で埋めない）',async()=>{
 // 前のテストの取得と混ざらないよう、別の観測地点（10km 北）で確かめる
 const o2={...obs,latitude:obs.latitude+.09},o3={...obs,latitude:obs.latitude-.09};
 const {ep:ep2}=await loadLine({drop:1},o2);M.configure('auto');const eye={...o2,elevation:80.5};
 const s=t=>M.apply({azimuth:ep2.azimuth,geometricAltitude:1,apparentAltitude:1,angularRadius:.26},t,eye).atmosphere.traced;
 assert.equal(s(day+20*3600000+1800000),undefined);assert.equal(s(day+22*3600000+1800000),true);
 const {ep:ep3}=await loadLine({badUnits:true},o3);
 const x=M.apply({azimuth:ep3.azimuth,geometricAltitude:1,apparentAltitude:1,angularRadius:.26},day+20*3600000+1800000,{...o3,elevation:80.5});
 assert.equal(x.atmosphere.traced,undefined);assert.ok(Number.isFinite(x.apparentAltitude));
});
test('山頂が目標でも柱を作る（山頂の点は地面より上の気圧面が2つだけ）',async()=>{
 const fuji=L.targetById('fuji'),ft={latitude:fuji.latitude,longitude:fuji.longitude,topM:fuji.parts[0].m},o4={latitude:35.7437824,longitude:139.9384215,elevation:20};
 const ep=M.lineEndpoint(o4,ft,day,day),times=[0,1,2,3].map(k=>(day+16*3600000)/1000+k*3600),peakAt=ep.ss.findIndex(s=>Math.abs(s-ep.distanceKm)<0.002);
 assert.ok(peakAt>0);const raw=lineRaw(ep,times,{peakAt});
 await M.load(o4,day,{now:day,target:ft,fetcher:async url=>({ok:true,json:async()=>/temperature_975hPa/.test(url)?raw:{hourly_units:{temperature_2m:'°C',surface_pressure:'hPa'},hourly:{time:times,temperature_2m:times.map(()=>15),surface_pressure:times.map(()=>1008)}}})});
 M.configure('auto');const at=day+16*3600000+1800000,eye={...o4,elevation:21.5};
 assert.equal(M.apply({azimuth:ep.azimuth,geometricAltitude:1,apparentAltitude:1,angularRadius:.26},at,eye).atmosphere.traced,true);
 const info=M.lineInfo(at,eye);assert.ok(info&&Math.abs(info.targetApparent-A.targetElevationAngle(ep.distanceKm,21.5,ft.topM,{k:7/6}))*60<3);
});
test('標準は観測地点の高さの大気（海面は従来どおり1010hPa・10℃）。高い所から見下ろす天体も光線追跡どおり',()=>{
 M.configure('standard');
 const sea=M.at(day,{latitude:35,longitude:139,elevation:0});assert.equal(sea.pressureHPa,1010);assert.equal(sea.temperatureC,10);
 const top=M.at(day,{latitude:35,longitude:139,elevation:2000});assert.ok(Math.abs(top.pressureHPa-1010*Math.pow(270.15/283.15,5.2559))<0.1&&Math.abs(top.temperatureC+3)<1e-9,JSON.stringify(top));
 const st=x=>({azimuth:90,geometricAltitude:x,apparentAltitude:x,angularRadius:0});
 // 100m未満は式のまま（以前と同じ）
 const low={latitude:35,longitude:139,elevation:30};
 for(const x of [-0.5,0,1])assert.equal(M.apply(st(x),day,low).apparentAltitude,x+M.correction(x,M.at(day,low)));
 // 標高2000m: 同じ標準大気をその場で密に追った値と0.3′以内（以前は見かけ−1°で33′小さかった）
 const F=RF.field([{s:0,groundM:0,pressureHPa:1010,points:[{z:0,t:10},{z:11000,t:-61.5}]}]),hi={latitude:35,longitude:139,elevation:2000},tb=RF.bodyTable(F,2000);
 for(const x of [tb.lowestTrue+0.05,-1.7,-1,-0.5,0,0.5,1.5,2.5]){const got=M.apply(st(x),day,hi).apparentAltitude,want=tb.apparentFromTrue(x);assert.ok(Math.abs(got-want)*60<(x<2?0.3:1),`${x}: ${(got-want)*60}′`);}
 // 高度2°と標高100mの境目で段を作らない。見かけは真高度に対して単調（重なる時刻の探索が二分法なので）
 const a=x=>M.apply(st(x),day,hi).apparentAltitude,b=h=>M.apply(st(-0.5),day,{...hi,elevation:h}).apparentAltitude;
 assert.ok(Math.abs(a(2-1e-7)-a(2+1e-7))<1e-5);assert.ok(Math.abs(b(100-1e-7)-b(100+1e-7))<1e-5);
 let prev=-Infinity;for(let x=-2.5;x<5;x+=0.01){const v=a(x);assert.ok(v>prev,`${x}`);prev=v;}
 M.configure('none');assert.equal(M.apply(st(-1),day,hi).apparentAltitude,-1);
});
