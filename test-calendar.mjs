import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import vm from "node:vm";
const require=createRequire(import.meta.url), AL=require("./sorami-align.js"), S=require("./sorami-core.js"), MOON=require("./sorami-moon.js");
const html=readFileSync(new URL("./index.html",import.meta.url),"utf8");
const code=html.slice(html.indexOf("const aimCal ="),html.indexOf("async function aimSetCustomTarget"));
function setup(al=AL){
 const els=new Map(), buttons=[];
 const $=id=>{if(!els.has(id))els.set(id,{value:"",innerHTML:"",textContent:"",open:true,setAttribute(k,v){this[k]=v},querySelectorAll(){return buttons},addEventListener(){},focus(){},close(){this.open=false}});return els.get(id)};
 const aim={dayMs:Date.parse("2026-12-22T00:00:00+09:00"),body:"sun",partId:"summit",target:AL.targetById("fuji"),candSide:"set",spot:{}};
 const c=vm.createContext({SoramiBodies:globalThis.SoramiBodies,SoramiMoon:MOON,$,aim,S,SoramiAlign:al,Date,Map,Number,String,Array,JSON,Error,Math,Promise,setTimeout,esc:s=>s.replaceAll('"','&quot;'),aimIsMountain:t=>t?.id!=="skytree",aimSideName:s=>s==="set"?"日の入":"日の出",aimFromPoint:()=>({name:"高尾山",latitude:35.6252,longitude:139.2436}),aimElevation:async()=>599,showSheet:e=>{e.open=true},aimApply:()=>{c.applied=true}});
 vm.runInContext(code+';this.cal=aimCal;this.rows=aimCalRows;this.grid=aimCalGridHtml;this.solid=aimCalSolid;this.render=aimCalRender;this.draw=aimCalDraw;',c);
 return {c,$,aim,buttons};
}
test("連続する重なる日を代表日にまとめず全日表示する",()=>{
 const {c}=setup(), obs={latitude:35.6252,longitude:139.2436,elevation:599}, target=AL.targetById("fuji");
 const rows=c.rows(obs,target,"sun",2026,11,"summit");
 assert.equal(rows.filter(c.solid).length,20); assert.equal(rows.length,22); assert.ok(rows.every(e=>e.dayCount===1));
 const grouped=AL.upcoming(obs,target,"sun",{from:Date.parse("2026-12-01T00:00:00+09:00"),days:31,limit:Infinity,partId:"summit",stepMs:3600000});
 assert.equal(grouped.length,1); assert.ok(grouped[0].dayCount>1);
});
test("JST月境界とうるう月・月の昼間除外",()=>{
 let opts;const start=Date.parse("2028-02-01T00:00:00+09:00"),end=Date.parse("2028-03-01T00:00:00+09:00");
 const row=at=>({at,gap:0,radius:1,sunAltitude:-1});
 const {c}=setup({upcoming(o,t,b,x){opts=x;return [row(start-1),row(start),{...row(start+1),sunAltitude:1},row(end-1),row(end)]}});
 assert.equal(c.rows({}, {}, "moon",2028,1,"summit").length,2);
 assert.equal(opts.days,29);assert.equal(opts.from,start);assert.equal(opts.groupDays,false);assert.equal(opts.limit,Infinity);
 const grid=c.grid(2028,1,new Map([[start,[{...row(start),side:"set"}]]]),start,start);
 assert.equal((grid.match(/data-cal-day=/g)||[]).length,29);assert.equal((grid.match(/has-event/g)||[]).length,1);
 assert.match(grid,/aria-pressed="true" aria-current="date"/);assert.match(grid,/重なる日、日の入/);
});
test("月の計算結果・キャッシュ条件・日付選択が既存描画へ接続する",async()=>{
 let calls=0;const {c,$,aim,buttons}=setup({upcoming(o,t,b,x){calls++;return [{at:x.from+86400000,gap:0,radius:1,side:"set"}]}});
 c.cal.year=2027;c.cal.month=0;await c.render();assert.equal(c.cal.events.size,1);assert.match($("aimCalStatus").textContent,/1日/);
 await c.render();assert.equal(calls,1);aim.body="moon";await c.render();assert.equal(calls,2);
 aim.body="sun";await c.render();buttons.push({dataset:{calDay:String(Date.parse("2027-01-02T00:00:00+09:00"))}});c.draw();buttons[0].onclick();
 assert.equal($("aimDate").value,"2027-01-02");assert.equal(aim.spot,null);assert.equal(aim.candSide,"set");assert.equal(c.applied,true);assert.equal($("aimCalendar").open,false);
});
test("古い月の非同期結果と閉じた後の結果を捨てる・エラーは候補なしと分ける",async()=>{
 let waits=[];const {c,$}=setup({upcoming(o,t,b,x){return [{at:x.from,gap:0,radius:1,side:"set"}]}});
 c.aimElevation=()=>new Promise(r=>waits.push(r));c.cal.year=2027;c.cal.month=0;const p=c.render();c.cal.month=1;const q=c.render();waits[1](599);await q;waits[0](599);await p;
 assert.equal([...c.cal.events.keys()][0],Date.parse("2027-02-01T00:00:00+09:00"));
 c.cal.month=2;const closed=c.render();$("aimCalendar").open=false;waits[2](599);await closed;assert.equal(c.cal.events.size,0);
 $("aimCalendar").open=true;c.aimElevation=async()=>{throw Error("test")};await c.render();assert.match($("aimCalStatus").textContent,/計算できませんでした/);assert.equal($("aimCalGrid")["aria-busy"],"false");
});

test("先端の下を通る日は建物全体との重なりとしてカレンダーへ表示する",()=>{
 const {c}=setup();const obs={latitude:35.58386,longitude:139.56853,elevation:83},target=AL.targetById("skytree");
 const rows=c.rows(obs,target,"moon",2026,9,"tip");
 const start=Date.parse("2026-10-03T00:00:00+09:00"), today=rows.find(e=>S.JstCal.sameDay(e.at,start));
 assert.ok(today);assert.ok(Math.abs(today.gap)>1.2*today.radius);assert.equal(c.solid(today),true);assert.equal(today.intersects,true);
 const actual=AL.upcoming(obs,target,"moon",{from:start,days:1,limit:4,limb:"center",partId:"tip",stepMs:3600000});
 assert.ok(Math.abs(today.at-actual[0].at)<1000);
 const events=new Map(rows.map(e=>[S.Cal.startOfDay(e.at),[e]]));
 const grid=c.grid(2026,9,events,start,start);
 assert.match(grid,/2026年10月3日、重なる日/);assert.match(grid,/>●<\/span>/);
 assert.equal(events.has(start-86400000),false);assert.equal(events.has(start+86400000),false);
});

test("カレンダーの今日は今日を選択して候補地を解除し図へ反映する",()=>{
 const {c,$,aim}=setup();aim.candPick=3;aim.wantKey="old";aim.candSide="set";
 $("aimCalToday").onclick();
 assert.equal($("aimDate").value,new Date(S.JstCal.startOfDay(Date.now())+9*3600000).toISOString().slice(0,10));
 assert.equal(aim.candPick,null);assert.equal(aim.spot,null);assert.equal(aim.wantKey,null);assert.equal(aim.candSide,null);assert.equal($("aimCalendar").open,false);assert.equal(c.applied,true);
});
