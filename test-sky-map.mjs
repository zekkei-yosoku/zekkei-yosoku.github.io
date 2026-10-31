import {sourceHtml} from './tools/test-source.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const require=createRequire(import.meta.url),M=require('./astronotes-sky-map.js'),A=require('./astronotes-astro.js');
const state=(body,at,o)=>{const s=A[body](at,o);return {...s,altitude:s.geometricAltitude};};
const day=Date.parse('2026-10-12T00:00:00+09:00'),o={latitude:35.64285,longitude:139.78291,elevation:7};
test('幾何高度の出没方向を一秒刻みの独立区間走査で確認、大気設定は不要',()=>{
 for(const body of ['sun','moon']){const data=M.daily(body,day,o,state);assert.equal(data.points.length,721);assert.equal(data.events.length,2);for(const e of data.events){let low=Math.floor(e.at/1000)*1000-2000,high=low+5000;let count=0;for(let t=low+1000;t<=high;t+=1000){if((state(body,t-1000,o).altitude>=0)!==(state(body,t,o).altitude>=0))count++;}assert.equal(count,1);assert.ok(Math.abs(state(body,e.at,o).altitude)<.001);assert.ok(Math.abs(state(body,e.at,o).apparentAltitude)>.1);assert.equal(e.azimuth,state(body,e.at,o).azimuth);}}
});
test('時刻操作や同じ条件の再描画で一日の軌道を再計算しない',()=>{let calls=0;const provider=(...args)=>{calls++;return state(...args)};const obs={...o,latitude:35.642851};const a=M.daily('sun',day,obs,provider),n=calls;assert.ok(n>721);assert.equal(M.daily('sun',day,obs,provider),a);assert.equal(calls,n);assert.notEqual(M.daily('sun',day+86400000,obs,provider),a);});
test('JST日境界と高緯度の出没なしを扱う',()=>{assert.equal(M.dayStart(day-1),day-86400000);assert.equal(M.dayStart(day+86399999),day);for(const d of ['2026-06-21','2026-12-21']){const start=Date.parse(d+'T00:00:00+09:00');assert.equal(M.daily('sun',start,{latitude:78,longitude:15,elevation:0},state).events.length,0);}assert.equal(M.delta(1,359),2);assert.equal(M.delta(359,1),-2);});
test('inline構文、地図の時間は候補計算を直接起動せず、目の高さを一度加算する',()=>{const h=sourceHtml();for(const m of h.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);const s=h.slice(h.indexOf('<script id="skyMapPresentation">'));const time=s.slice(s.indexOf(' function setTime('),s.indexOf(' async function refresh('));assert.doesNotMatch(time,/aimApply|aimRenderFrom|upcoming|dailyView/);assert.doesNotMatch(s,/AstroNotesAtmosphere.load|aimAirEnsure/);assert.match(s,/altitude:s.geometricAltitude\?\?s.altitude/);assert.match(s,/elevation:obs.elevation\+obs.eyeM/);assert.match(s,/partId:session.partId,eyeM:0/);assert.match(s,/look._planKey===aimLookKey\(\)/);});
test('太陽と月の出没方向を同時に描き、存在しない要素を地図に渡さない',()=>{const h=sourceHtml();const s=h.slice(h.indexOf('<script id="skyMapPresentation">'));assert.match(s,/session\.showSun\?\['sun'\]/);assert.match(s,/session\.showMoon\?\['moon'\]/);const ids=/createMapView\((\{[^}]*\})\)/.exec(s)[1];for(const m of ids.matchAll(/'([A-Za-z]+)'/g))assert.ok(h.includes(`id="${m[1]}"`),m[1]);});

test('目標方位通過は実太陽/月の方位一致と幾何高度を返し、時刻再描画で探索し直さない',()=>{
 for(const body of ['sun','moon']){let calls=0;const provider=(...args)=>{calls++;return state(...args)},obs={...o,latitude:o.latitude+.000003},data=M.daily(body,day,obs,provider),bearing=240;
  const result=M.passages(data,bearing,body,obs,provider);assert.ok(result.length);for(const p of result){assert.ok(p.at>=day&&p.at<day+86400000);assert.ok(p.altitude>=0);assert.ok(Math.abs(M.delta(state(body,p.at,obs).azimuth,bearing))<.001);assert.equal(p.altitude,state(body,p.at,obs).altitude);const before=state(body,p.at-1000,obs),after=state(body,p.at+1000,obs);assert.ok(M.delta(before.azimuth,bearing)*M.delta(after.azimuth,bearing)<=0);}
  const count=calls;assert.equal(M.passages(data,bearing,body,obs,provider),result);assert.equal(calls,count);assert.equal(M.passages(data,NaN,body,obs,provider).length,0);
 }
});
test('北の折返し/反対方向/複数通過/地平線下を区別し、翌日境界を重複表示しない',()=>{
 const d=1900000000000,points=(fn)=>Array.from({length:721},(_,i)=>({at:d+i*120000,...fn(i*120000)}));
 const north=t=>({azimuth:(350+t/86400000*20)%360,altitude:10});let data={points:points(north)},provider=(_,at)=>north(at-d);assert.equal(M.passages(data,0,'sun',{},provider).length,1);assert.equal(M.passages(data,180,'sun',{},provider).length,0);
 const multiple=t=>({azimuth:100+30*Math.cos(t/86400000*2*Math.PI),altitude:12});data={points:points(multiple)};assert.equal(M.passages(data,100,'moon',{},(_,at)=>multiple(at-d)).length,2);
 const below=t=>({...north(t),altitude:-1});assert.equal(M.passages({points:points(below)},0,'moon',{},(_,at)=>below(at-d)).length,0);
 const edge=t=>({azimuth:100+t/86400000*10,altitude:1});data={points:points(edge)};assert.equal(M.passages(data,100,'sun',{},(_,at)=>edge(at-d)).length,1);assert.equal(M.passages(data,110,'sun',{},(_,at)=>edge(at-d)).length,0);
});

test('天頂付近の急な方位変化でも有効な通過を捨てず、方位の角度収束まで精密化する',()=>{
 const day=1900000000000,root=day+60000.123,state=(_,at)=>({azimuth:180+Math.atan((at-root)/20)*180/Math.PI,altitude:89.999}),data={points:[{at:day,...state('',day)},{at:day+120000,...state('',day+120000)}]};const passes=M.passages(data,180,'sun',{},state);assert.equal(passes.length,1);assert.ok(Math.abs(passes[0].at-root)<.001);assert.ok(Math.abs(passes[0].azimuth-180)<.001);
});
