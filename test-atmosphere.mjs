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
