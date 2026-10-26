import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),P=require('./trial/astronotes-shooting.js'),Q=require('./trial/astronotes-shape-planner.js');
const DAY=86400000,from=Date.parse('2026-11-01T00:00:00+09:00');
const ll=(x,y=0)=>({latitude:35+y/111195,longitude:139+x/(111195*Math.cos(35*Math.PI/180))});
const plan={target:{...ll(500,500),parts:[{id:'tip',m:100}]},body:'sirius',partId:'tip',limb:'center'};
function fixture(type='line'){
 const shape={type,vertices:(type==='line'?[[0,0],[100,0]]:[[0,0],[100,0],[100,100],[0,100]]).map(([x,y])=>ll(x,y))};
 const entry={place:{...ll(-500),id:'shape',name:'合成地点',elevation:999,groundManualM:999,shape},record:{result:'seen'}};
 const deps={shooting:P,ensure:async()=>{},isMountain:()=>false,observerAt:(p,g)=>({...p,elevation:g}),elevationAt:async()=>17,align:{upcoming:(o,t,b,opts)=>[{at:P.day(opts.from)+12*3600000,gap:(o.longitude-ll(43.789).longitude)*1000,radius:0,side:'set'}]}};
 return {entry,deps};
}
test('線上の実解で4日ずつ進み、代表座標・代表標高へ戻さない',async()=>{
 const {entry,deps}=fixture(),before=JSON.stringify(entry),r=await Q.search(plan,entry,{...deps,from,end:from+20*DAY,budgetMs:Infinity});
 assert.equal(r.rows.length,4);assert.equal(r.searchedUntil,from+4*DAY);
 for(const row of r.rows){assert(P.meters(row.place,ll(43.789))<2);assert(P.shapeContains(entry.place.shape,row.place));assert.equal(row.place.elevation,17);assert.equal(row.place.shape,undefined);}
 const next=await Q.search(plan,entry,{...deps,from:r.searchedUntil,end:from+20*DAY,budgetMs:Infinity});assert.equal(next.rows.length,4);assert(next.rows[0].event.at>r.rows.at(-1).event.at);assert.equal(JSON.stringify(entry),before);
});
test('枠の内部だけの候補も残し、枠外を渡さない',async()=>{
 const {entry,deps}=fixture('area'),original=deps.align.upcoming;
 deps.align.upcoming=(o,...args)=>original(o,...args).map(e=>({...e,gap:Math.abs(o.latitude-ll(0,50).latitude)<.0003?e.gap:1}));
 const r=await Q.search(plan,entry,{...deps,from,end:from+DAY});assert.equal(r.rows.length,1);assert(P.shapeContains(entry.place.shape,r.rows[0].place));assert(r.rows[0].place.latitude>35);
});
test('標高欠測は未完了の日を飛ばさず、確認済み候補と欠測理由を保持',async()=>{
 const {entry,deps}=fixture();deps.elevationAt=async(lat,lon)=>lon>ll(70).longitude?null:17;
 const r=await Q.search(plan,entry,{...deps,from,end:from+10*DAY});assert.equal(r.partial,'elevation');assert.equal(r.searchedUntil,from);assert.equal(r.rows.length,1);
});
test('取消では結果を採用せず、再開カーソルも進めない',async()=>{
 const {entry,deps}=fixture();let current=true;deps.isCurrent=()=>current;deps.elevationAt=async()=>{current=false;return 0;};
 const r=await Q.search(plan,entry,{...deps,from,end:from+DAY});assert(r.cancelled);assert.deepEqual(r.rows,[]);assert.equal(r.searchedUntil,from);
});
test('時間予算で完了した日の境界まで進み、同一位置のDEMを日ごとに再取得しない',async()=>{
 const {entry,deps}=fixture();let clock=0,calls=0;deps.elevationAt=async()=>{calls++;return 17;};deps.align.upcoming=o=>[{at:P.day(o.from)+12*3600000,gap:1,radius:0,side:'set'}];
 const r=await Q.search(plan,entry,{...deps,from,end:from+10*DAY,budgetMs:1,clock:()=>clock++});assert.equal(r.searchedUntil,from+DAY);assert(r.paused);const firstCalls=calls;calls=0;
 const all=await Q.search(plan,entry,{...deps,from,end:from+3*DAY,budgetMs:Infinity});assert.equal(all.searchedUntil,from+3*DAY);assert.equal(calls,firstCalls);
});
test('当日の過去イベントを除外し、巨大形状は未完了として扱う',async()=>{
 const {entry,deps}=fixture();const now=from+13*3600000,r=await Q.search(plan,entry,{...deps,from:now,end:from+2*DAY,budgetMs:Infinity});assert.equal(r.rows.length,1);assert(r.rows[0].event.at>=now);
 entry.place.shape={type:'area',vertices:[[0,0],[10000,0],[10000,10000],[0,10000]].map(([x,y])=>ll(x,y))};const bad=await Q.search(plan,entry,{...deps,from,end:from+DAY});assert.equal(bad.partial,'limit');assert.equal(bad.searchedUntil,from);
});
test('実天文モデルの候補位置・時刻で再計算して重なりを確認する',async()=>{
 const A=require('./astronotes-align.js'),at=Date.parse('2026-10-24T12:00:00+09:00'),target=A.targetById('skytree');
 const lines=await A.line(target,'sun',at,{sides:['set'],partId:'tip',limb:'center',minKm:9,maxKm:11,stepKm:1,elevationAt:async()=>0}),hit=lines[0].points[1];
 const {entry,deps}=fixture();entry.place.shape={type:'line',vertices:[{latitude:hit.latitude-.001,longitude:hit.longitude},{latitude:hit.latitude+.001,longitude:hit.longitude}]};
 const r=await Q.search({target,body:'sun',partId:'__whole',matchMode:'overlap'},entry,{...deps,align:A,observerAt:(f,g)=>({...f,elevation:g,eyeM:1.5}),elevationAt:async()=>0,from:at,end:P.day(at)+DAY});
 assert.equal(r.rows.length,1);for(const row of r.rows){assert(P.shapeContains(entry.place.shape,row.place));assert(A.alignmentAt({...row.place,elevation:0},target,'sun',row.event.at,{partId:'__whole',eyeM:1.5}).matched);}
});
