import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url),P=require('./trial/sorami-saved-rounds.js');
const now=Date.parse('2026-10-17T00:00:00Z'),H=3600000,version='v4';
const spot={id:'takabotchi',name:'高ボッチ高原',latitude:36.13307,longitude:138.03936,elevation:1657.3,terrain:'summit'};
const here={...spot,latitude:36.13807,name:'高ボッチ展望台'};
const r={pid:'seaOfClouds',spotId:spot.id,spotName:spot.name,latitude:spot.latitude,longitude:spot.longitude,peak:now-3*H,capturedAt:now-12*H,window:[now-4*H,now-2*H],score:56,rank:'fair',confidence:'medium',algorithmVersion:version};
const dto=()=>({spot,rounds:[{...r}]});
test('近隣地点の事前予測を地点と保存時刻付きで取り出す。観測値は補わない',()=>{
 const out=P.validate(dto(),here,version,now);assert.equal(out.rounds.length,1);const x=out.rounds[0];assert.equal(x.latitude,spot.latitude);assert.equal(x.predictionSource.spotName,spot.name);assert.equal(x.predictionSource.capturedAt,r.capturedAt);assert.ok(x.predictionSource.distanceKm>0.5);assert.equal(x.observations,null);
});
test('開始後・未来取得・古い・不正・他地点・別アルゴリズムの予測を使わない',()=>{
 for(const patch of [{capturedAt:r.window[0]},{capturedAt:now+1},{peak:now-9*86400000},{score:NaN},{score:101},{window:[now-2*H,now-4*H]},{pid:'unknown'},{spotId:'other'},{latitude:35},{algorithmVersion:'old'}])assert.equal(P.validate({spot,rounds:[{...r,...patch}]},here,version,now).rounds.length,0,JSON.stringify(patch));
 assert.throws(()=>P.validate(dto(),{...here,latitude:35},version,now));
 assert.equal(P.validate(dto(),{...here,elevation:1300},version,now).rounds.length,0);
 assert.equal(P.validate(dto(),{...here,terrain:'basinFloor'},version,now).rounds.length,0);
 assert.deepEqual(P.validate({spot:null,rounds:[]},here,version,now).rounds,[]);
});
test('同時要求をまとめる。失敗は空データと区別し手動で再取得できる',async()=>{
 let count=0;const c=P.createClient({version,now:()=>now,transport:async()=>{count++;return new Response(JSON.stringify(dto()),{status:count===1?503:200});}});
 await Promise.all([c.ensure(here),c.ensure(here)]);assert.equal(count,1);assert.equal(c.state(here).status,'error');await c.ensure(here);assert.equal(count,1);
 await c.ensure(here,()=>{},true);assert.equal(c.state(here).status,'ready');assert.equal(count,2);assert.equal(c.state(here).rounds.length,1);
});
test('地点切替で遅い旧応答が新しい地点の予測にならない',async()=>{
 const pending=[];const c=P.createClient({version,now:()=>now,transport:()=>new Promise(resolve=>pending.push(resolve))});
 const a=c.ensure(here),other={latitude:35,longitude:139},b=c.ensure(other);
 pending[1](new Response(JSON.stringify({spot:null,rounds:[]})));await b;
 pending[0](new Response(JSON.stringify(dto())));await a;
 assert.equal(c.state(other).rounds.length,0);assert.equal(c.state(here).rounds.length,1);
});
const html=readFileSync(new URL('./trial/index.html',import.meta.url),'utf8');
function context(local,server){const s={...r,score:74,latitude:here.latitude,longitude:here.longitude};const c=vm.createContext({Date:{now:()=>now},Number,S:{JstCal:{sameDay:(a,b)=>Math.floor(a/86400000)===Math.floor(b/86400000)},PHENOMENA:{seaOfClouds:{}},RANKS:[],rankOf:score=>({key:'fair'}),outcomeFromActual:()=>"seen"},place:here,store:{get:()=>local?[s]:[],set:(k,v)=>c.saved=v},savedRoundClient:{state:()=>({rounds:server?P.validate(dto(),here,version,now).rounds:[]})},samePlaceAs:(a,b)=>a.latitude===b.latitude,crypto:{randomUUID:()=>"new"},queuePush(){},render(){},sightings:[]});return c;}
const source=html.slice(html.indexOf('/// 残した回を'),html.indexOf('/// 写真の時刻・位置から、記録に足す項目'));
const declaration='const ROUND_KEEP_MS=8*86400000,ROUND_ANSWER_MS=7*86400000;';
test('端末を優先しサーバーと重複させない。保存出典と元の点数を答え直しでも維持',()=>{
 const c=context(true,true);vm.runInContext(declaration+source,c);assert.equal(vm.runInContext('answerableRounds(Date.now()).length',c),1);assert.equal(vm.runInContext('roundOf("seaOfClouds",Date.now()-3*3600000).ev.score',c),74);
 const d=context(false,true);vm.runInContext(declaration+source,d);vm.runInContext('recordAnswer("seaOfClouds",Date.now()-3*3600000,90)',d);assert.equal(d.saved[0].score,56);assert.equal(d.saved[0].predictionSource.spotName,spot.name);assert.equal(d.saved[0].latitude,here.latitude);assert.deepEqual(Object.keys(d.saved[0].observations),[]);
 vm.runInContext('recordAnswer("seaOfClouds",Date.now()-3*3600000,20)',d);assert.equal(d.saved[0].score,56);assert.equal(d.saved[0].predictionSource.capturedAt,r.capturedAt);assert.equal(d.saved[0].actualScore,20);
});
test('8日保持と終了後7日の回答期限を分ける',()=>{
 const c=context(false,true);vm.runInContext(declaration+source,c);assert.equal(vm.runInContext('answerableRounds(Date.now()+8*86400000).length',c),0);
});

test('標高不明は近隣予測を使わず、更新失敗でも取得済み予測を保持する',async()=>{
 assert.equal(P.validate(dto(),{...here,elevation:null},version,now).rounds.length,0);
 assert.equal(P.validate({...dto(),spot:{...spot,elevation:null}},here,version,now).rounds.length,0);
 let time=now,count=0;const c=P.createClient({version,now:()=>time,transport:async()=>new Response(JSON.stringify(dto()),{status:++count===1?200:503})});
 await c.ensure(here);time+=31*60000;const pending=c.ensure(here);assert.equal(c.state(here).rounds.length,1);await pending;assert.equal(c.state(here).status,'error');assert.equal(c.state(here).rounds[0].score,56);
});
test('未終了・期限超過の回は新しい回答を保存できない',()=>{
 const c=context(false,true);vm.runInContext(declaration+source,c);c.Date.now=()=>now-3*H;vm.runInContext('recordAnswer("seaOfClouds",'+r.peak+',90)',c);assert.equal(c.saved,undefined);
 c.Date.now=()=>now+8*86400000;vm.runInContext('recordAnswer("seaOfClouds",'+r.peak+',90)',c);assert.equal(c.saved,undefined);
});

test('重複応答は最新の事前予測一件。同期へ渡すモデル点と要素を正規化',()=>{
 const out=P.validate({spot,rounds:[{...r,score:40},{...r,capturedAt:r.capturedAt+1,perModel:{a:56,b:200,c:"bad"},factors:[{label:"低い雲",c:-2,detail:"確認"},{label:"bad",c:"x"}]}]},here,version,now);
 assert.equal(out.rounds.length,1);assert.equal(out.rounds[0].score,56);assert.deepEqual(out.rounds[0].perModel,{a:56});assert.equal(out.rounds[0].factors.length,1);
});
