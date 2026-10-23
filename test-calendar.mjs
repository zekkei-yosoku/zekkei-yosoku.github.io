import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import vm from "node:vm";
const require=createRequire(import.meta.url), AL=require("./astronotes-align.js"), S=require("./astronotes-core.js"), MOON=require("./astronotes-moon.js");
const html=readFileSync(new URL("./index.html",import.meta.url),"utf8");
const code=html.slice(html.indexOf("const aimCal ="),html.indexOf("async function aimSetCustomTarget"));
function setup(al=AL){
 const els=new Map(), buttons=[];
 const $=id=>{if(!els.has(id))els.set(id,{style:{},value:"",innerHTML:"",textContent:"",open:true,setAttribute(k,v){this[k]=v},querySelectorAll(selector){return selector==="[data-cal-moon]"?[]:buttons},addEventListener(){},focus(){},close(){this.open=false}});return els.get(id)};
 const aim={dayMs:Date.parse("2026-12-22T00:00:00+09:00"),body:"sun",partId:"summit",target:AL.targetById("fuji"),candSide:"set",spot:{}};
 const c=vm.createContext({aimShootingView:async()=>null,candidateWaitMarkup:()=>"待機中",AstroNotesAtmosphere:{dataKey:()=>"standard"},AstroNotesTerrain:{decksFor:()=>null},AstroNotesBodies:globalThis.AstroNotesBodies,AstroNotesMoon:MOON,$,aim,S,AstroNotesAlign:al,AstroNotesShooting:require("./astronotes-shooting.js"),Date,Map,Number,String,Array,JSON,Error,Math,Promise,setTimeout,esc:s=>s.replaceAll('"','&quot;'),aimIsMountain:t=>t?.id!=="skytree",aimSideName:s=>s==="set"?"日の入":"日の出",aimFromPoint:()=>c.fromOverride||({name:"高尾山",latitude:35.6252,longitude:139.2436}),aimElevation:async()=>599,showSheet:e=>{e.open=true},aimCandidateMatch:e=>Number.isFinite(e.gap)&&Math.abs(e.gap)<=Math.max(1/60,.2*(e.radius||0)),aimApply:()=>{c.applied=true}});
 vm.runInContext(readFileSync(new URL("./astronotes-datetime-ui.js",import.meta.url),"utf8"),c);
 vm.runInContext(html.slice(html.indexOf('function aimObserverEye('),html.indexOf('aim.from = aimSavedFrom'))+code+';this.cal=aimCal;this.rows=aimCalRows;this.grid=aimCalGridHtml;this.solid=aimCalSolid;this.render=aimCalRender;this.draw=aimCalDraw;',c);
 return {c,$,aim,buttons};
}
test('撮影地点なしの月カレンダーでも日付を選べ、座標なしの月相や標高を計算しない',async()=>{
 const {c,$,aim,buttons}=setup();c.aimFromPoint=()=>null;c.aimElevation=async()=>{throw Error('no observer elevation');};c.AstroNotesBodies={...c.AstroNotesBodies,state(){throw Error('no observer moon phase');}};aim.body='moon';c.cal.year=2026;c.cal.month=9;await c.render();
 assert.equal(($('aimCalGrid').innerHTML.match(/data-cal-day=/g)||[]).length,31);assert.doesNotMatch($('aimCalGrid').innerHTML,/NaN|data-moon-phase/);assert.match($('aimCalStatus').textContent,/日付を選んで/);assert.equal($('aimCalGrid')['aria-busy'],'false');
 buttons.push({dataset:{calDay:String(Date.parse('2026-10-24T00:00:00+09:00'))}});c.draw();buttons[0].onclick();assert.equal($('aimDate').value,'2026-10-24');assert.equal(c.applied,true);
});
test("連続する重なる日を代表日にまとめず全日表示する",()=>{
 const {c}=setup(), obs={latitude:35.6252,longitude:139.2436,elevation:599}, target=AL.targetById("fuji");
 const rows=c.rows(obs,target,"sun",2026,11,"summit");
 // 2026-10-05: 方位を楕円体で解くようにして、重なる期間が 12/12〜31 から 12/11〜31 へ1日早まった（冬至のころは日の入の方位がほとんど動かず、0.1°で端の1日が入る）
 assert.equal(rows.filter(c.solid).length,21); assert.equal(rows.length,23); assert.ok(rows.every(e=>e.dayCount===1));
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
 // 観測点は仕組みを確かめるための点。10/3 に月が先端の約23′下を通る位置（2026-10-05、方位を楕円体にしたので 35.58386,139.56853 から視線に直角に52m動かした。
 // 元の点では実際の写真どおり月が先端に掛かる）
 const {c}=setup();const obs={latitude:35.583465,longitude:139.568839,elevation:83},target=AL.targetById("skytree");
 const rows=c.rows(obs,target,"moon",2026,9,"tip");
 const start=Date.parse("2026-10-03T00:00:00+09:00"), today=rows.find(e=>S.JstCal.sameDay(e.at,start));
 assert.ok(today);assert.ok(Math.abs(today.gap)>1.2*today.radius);assert.equal(c.solid(today),false);assert.equal(today.intersects,true);
 const actual=AL.upcoming(obs,target,"moon",{from:start,days:1,limit:4,limb:"center",partId:"tip",stepMs:3600000});
 assert.ok(Math.abs(today.at-actual[0].at)<1000);
 const events=new Map(rows.map(e=>[S.Cal.startOfDay(e.at),[e]]));
 const grid=c.grid(2026,9,events,start,start);
 assert.match(grid,/2026年10月3日、近くを通る日/);assert.match(grid,/>○<\/span>/);
 assert.equal(events.has(start-86400000),false);assert.equal(events.has(start+86400000),false);
});

test("カレンダーの今日は今日を選択して候補地を解除し図へ反映する",()=>{
 const {c,$,aim}=setup();aim.candPick=3;aim.wantKey="old";aim.candSide="set";
 $("aimCalToday").onclick();
 assert.equal($("aimDate").value,new Date(S.JstCal.startOfDay(Date.now())+9*3600000).toISOString().slice(0,10));
 assert.equal(aim.candPick,null);assert.equal(aim.spot,null);assert.equal(aim.wantKey,null);assert.equal(aim.candSide,null);assert.equal($("aimCalendar").open,false);assert.equal(c.applied,true);
});

// 2026-10-06 立つ所（展望台／地上）で地上からを決め、目の高さ1.5mを足す（展望台229m→230.5m、地上→1.5m）
test("展望台の高さを月間探索へ渡し、同じ座標の高さ変更でキャッシュを切り替える",async()=>{
 const eyes=[];const {c}=setup({upcoming(o,t,b,x){eyes.push(x.eyeM);return []}});
 c.fromOverride={name:"渋谷スカイ",latitude:35.65838,longitude:139.70222,decks:[{name:"展望台",aglM:229}],stand:"展望台"};
 await c.render();assert.deepEqual(eyes,[230.5]);
 await c.render();assert.deepEqual(eyes,[230.5]);
 c.fromOverride.stand="ground";await c.render();assert.deepEqual(eyes,[230.5,1.5]);
});

test('指定なしの月カレンダーは円盤接触を採用し、縁指定とキャッシュを分ける',async()=>{
 let broad=0,fine=0;const {c,aim,$}=setup({dailyView(o,t,b,day){broad++;return [{at:day+1000,nearTarget:true,intersects:true,gap:.15,radius:.25,side:'set'}];},upcoming(o,t,b,x){fine++;return [];}});
 c.cal.year=2026;c.cal.month=9;aim.matchMode='overlap';await c.render();assert.equal(broad,31);assert.equal(c.cal.events.size,31);assert.match($('aimCalStatus').textContent,/重なる日 31日/);
 aim.matchMode='limb';await c.render();assert.equal(fine,1);assert.equal(c.cal.events.size,0);
 aim.matchMode='overlap';await c.render();assert.equal(broad,31);assert.equal(c.cal.events.size,31);
});

function swipeFixture() {
 const shared=readFileSync(new URL("./astronotes-datetime-ui.js",import.meta.url),"utf8"),a=shared.indexOf("function mountCalendarSwipe("),b=shared.indexOf("function mountCalendarDismiss(",a),listeners={};let clock=1000,open=true;const moves=[];
 const grid={style:{},addEventListener:(type,fn)=>listeners[type]=fn};const c=vm.createContext({Date,Array});vm.runInContext(shared.slice(a,b)+";this.mount=mountCalendarSwipe;",c);const reset=c.mount(grid,n=>moves.push(n),()=>open,()=>clock);
 const touch=(x,y,id=1)=>({clientX:x,clientY:y,identifier:id});
 const fire=(type,touches=[],changedTouches=[])=>{const e={touches,changedTouches,cancelable:true,preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true}};listeners[type](e);return e};
 const swipe=(dx,dy)=>{fire('touchstart',[touch(150,200)]);fire('touchmove',[touch(150+dx,200+dy)]);return fire('touchend',[],[touch(150+dx,200+dy)])};
 return {grid,moves,reset,fire,swipe,touch,advance:n=>clock+=n,setOpen:v=>open=v};
}
test("見た目を変えず日付gridの左右は月・上下は年、gesture一回につき一回だけ移動",()=>{
 const f=swipeFixture();assert.equal(f.grid.style.touchAction,"none");
 for(const [dx,dy,offset] of [[-80,0,1],[80,0,-1],[0,-80,12],[0,80,-12]]){
  const n=f.moves.length;assert(f.swipe(dx,dy).prevented);assert.deepEqual(f.moves.slice(n),[offset]);assert(f.fire('click').stopped);
  f.fire('touchend',[],[f.touch(70,200)]);assert.equal(f.moves.length,n+1);
 }
});
test("tap/短距離/斜め/2指/cancel/左端/閉じた画面で年月を誤変更しない",()=>{
 const f=swipeFixture();
 f.fire('touchstart',[f.touch(150,200)]);f.fire('touchmove',[f.touch(152,202)]);f.fire('touchend',[],[f.touch(152,202)]);assert(!f.fire('click').stopped);assert.deepEqual(f.moves,[]);
 f.swipe(-25,0);assert(f.fire('click').stopped);assert.deepEqual(f.moves,[]);
 f.reset();f.fire('touchstart',[f.touch(150,200)]);f.fire('touchmove',[f.touch(70,120)]);f.advance(2000);f.fire('touchend',[],[f.touch(70,120)]);assert(f.fire('click').stopped);assert.deepEqual(f.moves,[]);
 f.reset();f.fire('touchstart',[f.touch(150,200)]);f.fire('touchstart',[f.touch(150,200),f.touch(170,200,2)]);f.advance(2000);f.fire('touchend',[f.touch(150,200)],[f.touch(170,200,2)]);f.fire('touchend',[],[f.touch(70,200)]);assert(f.fire('click').stopped);assert.deepEqual(f.moves,[]);
 f.reset();f.fire('touchstart',[f.touch(150,200)]);f.fire('touchmove',[f.touch(70,200)]);f.fire('touchcancel');f.fire('touchend',[],[f.touch(70,200)]);assert.deepEqual(f.moves,[]);
 f.reset();f.fire('touchstart',[f.touch(20,200)]);assert(!f.fire('touchmove',[f.touch(120,200)]).prevented);f.fire('touchend',[],[f.touch(120,200)]);assert.deepEqual(f.moves,[]);
 f.reset();f.setOpen(false);f.swipe(-80,0);assert.deepEqual(f.moves,[]);
 f.setOpen(true);f.reset();assert(!f.fire('click').stopped);f.swipe(-80,0);f.advance(501);assert(!f.fire('click').stopped);
 // A fresh deliberate tap immediately after a swipe remains available.
 f.fire('touchstart',[f.touch(150,200)]);f.fire('touchend',[],[f.touch(150,200)]);assert(!f.fire('click').stopped);
});
test("月送りの年境界と年送りは選択中の日付を変更しない",()=>{
 const {c,aim}=setup();const selected=aim.dayMs;c.cal.year=2027;c.cal.month=11;c.aimCalMove(1);assert.equal(c.cal.year,2028);assert.equal(c.cal.month,0);
 c.aimCalMove(-1);assert.equal(c.cal.year,2027);assert.equal(c.cal.month,11);c.cal.month=1;c.aimCalMove(12);assert.equal(c.cal.year,2028);assert.equal(c.cal.month,1);c.aimCalMove(-12);assert.equal(c.cal.year,2027);assert.equal(c.cal.month,1);assert.equal(aim.dayMs,selected);
});
