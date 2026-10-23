import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createRequire} from 'node:module';import vm from 'node:vm';
const require=createRequire(import.meta.url),A=require('./astronotes-align.js'),reference=JSON.parse(fs.readFileSync(new URL('./fixtures/daily-view-reference.json',import.meta.url),'utf8'));
// Independent fixture produced by unmodified 2e0e2de; do not regenerate from the optimized solver.
// Stellar engine uses Date milliseconds; equal minima can choose adjacent millisecond samples.
// Keep discrete judgments exact and numeric differences below 2ms / 0.00001 degrees.
function equivalent(actual,expected,label=''){
 assert.equal(actual.length,expected.length,label);
 for(let i=0;i<expected.length;i++)for(const key of Object.keys(expected[i])){
  const x=actual[i][key],y=expected[i][key];
  if(typeof y==='number')assert(Math.abs(x-y)<=(key==='at'?2:1e-5),`${label}/${key}: ${x} != ${y}`);
  else assert.equal(x,y,`${label}/${key}`);
 }
}
test('幾何共有と枝刈りは旧36日・山/3建物・月/太陽/恒星の判定と数値精度を維持',()=>{
 for(const c of reference.cases){const target=A.targetById(c.targetId),actual=A.dailyView(c.observer,target,c.body,c.day,c.opts),prepared=A.prepareDailyView(c.observer,target,c.body,c.opts);equivalent(actual,c.rows,`${c.targetId}/${c.body}/${c.day}`);equivalent(prepared(c.day),c.rows);for(const row of c.rows)equivalent(A.dailyView(c.observer,target,c.body,c.day,{...c.opts,at:row.at}),[row]);}
});
const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8'),from=html.indexOf('async function aimBuildingDays('),to=html.indexOf('// 表示日を替えても',from),DAY=86400000,now=Date.parse('2026-10-19T12:00:00+09:00');
function fixture(){let calls=0,air='standard';const start=t=>Math.floor((t+32400000)/DAY)*DAY-32400000,c={Date:class extends Date{static now(){return now}},setTimeout,S:{Cal:{startOfDay:start}},aim:{limb:'center',matchMode:'overlap'},aimIsMountain:()=>false,AstroNotesAtmosphere:{dataKey:()=>air},AstroNotesShooting:{eventsFor:(p,o,d)=>{calls++;return[{at:d+23*3600000,intersects:true,sunAltitude:-10}]},matches:e=>e.intersects},AstroNotesAlign:{prepareDailyView:()=>()=>[]}};vm.createContext(c);vm.runInContext(html.slice(from,to),c);const obs={latitude:35,longitude:139,elevation:19,eyeM:1.5},target={id:'custom',parts:[{id:'tip',m:100}]};return {c,obs,target,get calls(){return calls},setAir:v=>air=v,run:(extra={})=>c.aimBuildingDays(obs,target,'moon','__whole',0,{from:now,limb:'center',matchMode:'overlap',isCurrent:()=>true,...extra})};}
test('構図/地図で完成候補を共有し、標高/大気/部位/検索範囲が違えば再計算',async()=>{const f=fixture(),rows=await f.run(),n=f.calls;assert.equal(JSON.stringify(await f.run({from:now+1000})),JSON.stringify(rows));assert.equal(f.calls,n);f.obs.elevation++;await f.run();assert(f.calls>n);const after=f.calls;f.setAir('manual');await f.run();assert(f.calls>after);});
test('過ぎた候補/以前の開始時刻/キャンセル済み計算をcacheとして再利用しない',async()=>{const f=fixture();await f.run({isCurrent:()=>false});assert.equal(f.calls,0);await f.run();const n=f.calls;await f.run({from:now-1000});assert(f.calls>n);const m=f.calls;await f.run({from:now+12*3600000});assert(f.calls>m);});
test('キャラ待機表示はメッセージをエスケープし装飾を読み上げない',()=>{const c={esc:s=>s.replaceAll('<','&lt;')};vm.createContext(c);const a=html.indexOf('function candidateWaitMarkup('),b=html.indexOf('function aimSyncFromDay()',a);vm.runInContext(html.slice(a,b),c);const output=c.candidateWaitMarkup('<計算中>');assert.match(output,/note-wait-character.*aria-hidden="true"/);assert.match(output,/role="status"/);assert.match(output,/&lt;計算中>/);});

test('部位を残したoverlapでもeventsForと同じ全体部位で準備する',async()=>{
 const f=fixture();let prepared;f.c.AstroNotesAlign.prepareDailyView=(obs,target,body,options)=>{prepared=options.partId;return()=>[]};
 await f.c.aimBuildingDays(f.obs,f.target,'moon','north',0,{from:now,matchMode:'overlap',limb:'center',isCurrent:()=>true});assert.equal(prepared,'__whole');
});
