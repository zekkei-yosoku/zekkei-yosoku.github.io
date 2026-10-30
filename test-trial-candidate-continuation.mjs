import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const h=fs.readFileSync(new URL('./trial/index.html',import.meta.url),'utf8'),D=86400000,now=Date.parse('2026-10-26T12:00:00+09:00'),start=x=>Math.floor((x+32400000)/D)*D-32400000;
const extract=(a,b)=>{const x=h.indexOf(a),y=h.indexOf(b,x);assert(x>=0&&y>x);return h.slice(x,y);};
const helpers=extract('function aimCandidateSearchEnd(','async function aimMoreDays(');
function fixture({empty=false,map=false}={}){
 const rows=[{at:now+D}],entry={rows,inputKey:'a',origin:now,searchedUntil:start(now)+400*D,until:now+D,morePromise:null,current:()=>c.key==='a'},calls=[];let fail=false,release;
 const button={},c={S:{Cal:{startOfDay:start}},Date:class extends Date{static now(){return now}},aim:{fromDays:entry,target:{parts:[]},body:'sun',partId:'__whole',limb:'center',matchMode:'overlap'},key:'a',aimFromPoint:()=>({latitude:35,longitude:139}),aimDaysInputKey:()=>c.key,aimRenderFrom:async()=>{},aimElevation:async()=>1,aimObserverAt:()=>({}),$:()=>({querySelector:()=>button,querySelectorAll:()=>[]}),el:()=>({querySelector:()=>button}),dateEntry:entry,renderCandidateDates:()=>{},aimBuildingDays:async(o,t,b,p,s,opt)=>{calls.push({from:opt.from,days:opt.days});if(release)await release.promise;opt.onScanned(opt.from+(empty?opt.days:1)*D);if(fail)throw Error('solver');return empty?[]:[{at:opt.from+3600000}];}};
 entry.obs={};entry.snapshot={target:{},body:'sun',partId:'__whole',limb:'center',matchMode:'overlap'};
 vm.createContext(c);vm.runInContext(helpers+extract('async function aimMoreDays(','function candidateDatesMarkup('),c);if(map)vm.runInContext(extract(' async function moreCandidateDates(){',' function renderObserverHeight()'),c);
 return {c,entry,calls,button,more:()=>map?c.moreCandidateDates():c.aimMoreDays(),fail:()=>{fail=true;},hold:()=>{let done;release={promise:new Promise(r=>done=r)};return done;}};
}
test('継続区間はoriginでなく未探索日の2暦年後、閏日とJSTを正しく丸める',()=>{const {c}=fixture();assert.equal(c.aimCandidatePageEnd(Date.parse('2028-02-29T00:00:00+09:00')),Date.parse('2030-02-28T00:00:00+09:00'));assert.equal(c.aimCandidatePageEnd(Date.parse('2033-12-31T00:00:00+09:00')),Date.parse('2035-12-31T00:00:00+09:00'));assert.equal(c.aimCandidatePageEnd(Date.parse('2100-02-28T00:00:00+09:00')),Date.parse('2101-01-01T00:00:00+09:00'));});
for(const map of[false,true]){
 const name=map?'統合Explore':'旧構図';
 test(name+'：空区間を3回継続して2/4/6年以上へ進み既存候補を保持',async()=>{const f=fixture({empty:true,map}),first=f.entry.rows[0];let next=f.entry.searchedUntil;for(let i=0;i<3;i++){const end=f.c.aimCandidatePageEnd(next);await f.more();assert.equal(f.calls[i].from,next);assert.equal(f.entry.searchedUntil,end);assert.equal(f.entry.rows[0],first);next=end;}assert(f.entry.searchedUntil>Date.parse('2032-01-01T00:00:00+09:00'));});
 test(name+'：候補がある区間は4件以内で止めたカーソルから再開し重複しない',async()=>{const f=fixture({map}),from=f.entry.searchedUntil;await f.more();await f.more();assert.deepEqual(f.calls.map(x=>x.from),[from,from+D]);assert.equal(new Set(f.entry.rows.map(x=>x.at)).size,3);});
 test(name+'：途中失敗時は候補/探索開始位置を不変にして再試行を示す',async()=>{const f=fixture({map}),from=f.entry.searchedUntil;f.fail();await f.more();assert.equal(f.entry.searchedUntil,from);assert.equal(f.entry.rows.length,1);assert.equal(f.entry.morePromise,null);assert.match(f.button.textContent,/再試行/);});
 test(name+'：多重実行を防ぎ、条件変更で旧結果を破棄',async()=>{const f=fixture({map}),from=f.entry.searchedUntil,done=f.hold(),p=f.more();await Promise.resolve();await f.more();f.c.key='b';done();await p;assert.equal(f.calls.length,1);assert.equal(f.entry.searchedUntil,from);assert.equal(f.entry.rows.length,1);});
 test(name+'：対応暦の排他的終端を越えず終了する',async()=>{const f=fixture({map,empty:true});f.entry.searchedUntil=Date.parse('2100-12-30T00:00:00+09:00');await f.more();assert.equal(f.calls[0].days,2);assert.equal(f.entry.searchedUntil,f.c.aimCandidateSearchEnd());await f.more();assert.equal(f.calls.length,1);});
}
test('探索済み最終日は排他的終端の前日、2年で完了とは表示しない',()=>{const c={Date:class extends Date{static now(){return now}},S:{Cal:{startOfDay:start}}};vm.createContext(c);vm.runInContext(helpers+extract('function candidateDatesMarkup(','// The selected place'),c);const entry={origin:now,searchedUntil:Date.parse('2033-01-01T00:00:00+09:00')};const text=c.candidateDatesMarkup([],entry,{body:'sun'},now);assert.match(text,/2032\/12\/31まで探索済み/);assert.match(text,/さらに先の候補を探す/);assert.doesNotMatch(text,/2年先まで/);entry.searchedUntil=c.aimCandidateSearchEnd();assert.doesNotMatch(c.candidateDatesMarkup([],entry,{body:'sun'},now),/data-from-more/);});

test('実際の日走査は4候補で停止し、cache再利用も同じ未探索カーソルを返す',async()=>{
 let dailyCalls=0;const from=start(now)+400*D,c={Date,setTimeout,S:{Cal:{startOfDay:start}},aim:{limb:'center',matchMode:'limb'},aimIsMountain:()=>false,aimCandidateMatch:()=>true,AstroNotesAlign:{dailyView:(o,t,b,day)=>{dailyCalls++;return[{at:day+3600000,side:'set'}];}}};
 vm.createContext(c);vm.runInContext(extract('async function aimBuildingDays(','// 表示日を替えても'),c);let scanned=from;
 const args=[{}, {parts:[]}, 'sun','__whole',null,{from,days:730,limit:4,limb:'center',matchMode:'limb',isCurrent:()=>true,onScanned:x=>scanned=x}];
 const rows=await c.aimBuildingDays(...args);assert.equal(rows.length,4);assert.equal(dailyCalls,4);assert.equal(scanned,from+4*D);scanned=0;
 const cached=await c.aimBuildingDays(...args);assert.equal(cached.length,4);assert.equal(dailyCalls,4);assert.equal(scanned,from+4*D);
});
test('末尾追加中のsnap停止は利用者のscroll終了でだけ解除し、プログラムのscrollでは戻さない',async()=>{
 const c={setTimeout,clearTimeout};vm.createContext(c);vm.runInContext(extract('function candidateDatesHoldSnap(','// The selected place'),c);
 const on=new Map(),strip={style:{scrollSnapType:''},addEventListener:(n,f)=>on.set(n,f),removeEventListener:(n,f)=>{if(on.get(n)===f)on.delete(n);}},fire=n=>on.get(n)?.();
 c.candidateDatesHoldSnap(strip);assert.equal(strip.style.scrollSnapType,'none');const listeners=on.size;c.candidateDatesHoldSnap(strip);assert.equal(on.size,listeners);
 fire('scroll');await new Promise(r=>setTimeout(r,200));assert.equal(strip.style.scrollSnapType,'none');
 fire('wheel');fire('scroll');await new Promise(r=>setTimeout(r,80));fire('scroll');await new Promise(r=>setTimeout(r,80));assert.equal(strip.style.scrollSnapType,'none');
 await new Promise(r=>setTimeout(r,120));assert.equal(strip.style.scrollSnapType,'');assert.equal(on.size,0);assert.equal(strip._snapHeld,false);
});
