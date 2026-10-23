import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('async function updateMoonPrediction'),html.indexOf('/// 富士山と月の行を作って'));
const kick=html.slice(html.indexOf('function kickExtras()'),html.indexOf('function wireMoonTimeRetry'));
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
function context(){const calls=[],x=vm.createContext({currentView:"list",predictionNeeded:()=>true,AstroNotesPrediction:{visibility(input){const d=defer();calls.push({input,...d});return d.promise;}},AstroNotesTerrain:{combinedHorizon:()=>()=>0,flatProfile:()=>[]},rerenderList(){},refreshLightTimes(){},console});vm.runInContext('let extraSeq=1,moonEvalSeq=0,moonWeeklySeq=0,moonAcceptedSeq=0,moonTerrainProfile=null,moonUrbanProfile=null,moonHorizon=null,moonPredictionPlace=null,moonDetailKey=null,moonObs={},forecastDays=[1],weeks={};const moonVisibility=new Map(),moonDetailPending=new Map();'+source,x);return {x,calls};}
const dto=label=>({visibilityKey:label,asOf:1,bundle:{fetchedAt:1},weeks:{moon:[label]}});
test('先の地点の月が後から返っても、新地点の週間を上書きしない',async()=>{
 const {x,calls}=context();const old=vm.runInContext('updateMoonPrediction({}, {latitude:1},1)',x);vm.runInContext('extraSeq=2',x);const fresh=vm.runInContext('updateMoonPrediction({}, {latitude:2},2)',x);
 calls[1].resolve(dto('new'));await fresh;calls[0].resolve(dto('old'));await old;assert.equal(vm.runInContext('weeks.moon[0]',x),'new');assert.equal(vm.runInContext('moonPredictionPlace.latitude',x),2);
});
test('同じ週間の再表示が進行中の月詳細を無効にせず、取得後に採用する',async()=>{
 const {x,calls}=context();const first=vm.runInContext('updateMoonPrediction({}, {},1)',x);calls[0].resolve(dto('same'));await first;
 vm.runInContext('requestMoonDetails(1)',x);const again=vm.runInContext('updateMoonPrediction({}, {},1)',x);calls[2].resolve(dto('same'));await again;
 calls[1].resolve({moonVisibility:[{dayMs:1,rise:{at:123}}]});await calls[1].promise;await Promise.resolve();await Promise.resolve();assert.equal(vm.runInContext('moonVisibility.get(1).rise.at',x),123);
});
test('前地点の付随処理を待たず、新地点の処理を開始して新しい実行状態を保持する',async()=>{
 const calls=[],x=vm.createContext({currentView:"list",predictionNeeded:()=>true,console,loadExtras(){const d=defer();calls.push(d);return d.promise;}});vm.runInContext('let bundle={},extrasRunning=false,extrasRunningSeq=-1,extrasLoadedSeq=-1,predictionLoadSeq=1;'+kick,x);
 vm.runInContext('kickExtras();predictionLoadSeq=2;kickExtras()',x);assert.equal(calls.length,2);calls[0].resolve();await calls[0].promise;await Promise.resolve();await Promise.resolve();assert.equal(calls.length,2);assert.equal(vm.runInContext('extrasRunning',x),true);calls[1].resolve();
 assert.match(html,/const seq = \+\+loadSeq;\s+\+\+extraSeq/);
});
test('可視時刻の更新は太陽イベントなしでも動き、再試行は時計ずれで連打しない',()=>{
 const refresh=html.slice(html.indexOf('function refreshLightTimes()'),html.indexOf('function redrawDayDetail()'));
 assert.doesNotMatch(refresh,/if \(!lt/);assert.match(refresh,/mt\.outerHTML = renderMoonTimes/);
 assert.match(html,/attempts >= maxAttempts/);assert.match(html,/dto\.retryAt - dto\.asOf/);assert.doesNotMatch(html,/dto\.retryAt - Date\.now/);
});

test('非表示で期限到来しても予算を消費せず、復帰時に一度だけ再試行しresetで解除する',()=>{
 const timers=new Map(),listeners=new Set();let next=0,runs=0;
 const doc={hidden:true,addEventListener:(event,fn)=>listeners.add(fn),removeEventListener:(event,fn)=>listeners.delete(fn)};
 const x=vm.createContext({currentView:"list",predictionNeeded:()=>true,document:doc,setTimeout(fn){timers.set(++next,fn);return next;},clearTimeout(id){timers.delete(id);},run(){runs++;}});
 const retry=html.slice(html.indexOf('function createForecastRetry'),html.indexOf('const extrasRetry'));
 vm.runInContext(retry+';const retry=createForecastRetry(run,1);retry.schedule();',x);
 [...timers.values()][0]();assert.equal(runs,0);assert.equal(listeners.size,1);
 doc.hidden=false;[...listeners][0]();assert.equal(runs,1);assert.equal(listeners.size,0);
 vm.runInContext('retry.schedule()',x);assert.equal(timers.size,1,'実行済みtimerを含めて追加されない');
 vm.runInContext('retry.reset();retry.schedule()',x);doc.hidden=true;[...timers.values()].at(-1)();assert.equal(listeners.size,1);
 vm.runInContext('retry.reset()',x);assert.equal(listeners.size,0);
});
test('同じ地点で再読込しても都市地平線の進行中取得を共有し、古い地点の幾何を採用しない',async()=>{
 const d=defer();let calls=0;const x=vm.createContext({currentView:"list",predictionNeeded:()=>true,AstroNotesTerrain:{urbanCacheKey:o=>o.key},computeUrbanHorizon(){calls++;return d.promise;}});
 const wrapper=html.slice(html.indexOf('const urbanPending'),html.indexOf('async function computeUrbanHorizon'));
 vm.runInContext(wrapper,x);const one=vm.runInContext('loadUrbanHorizon({key:"one"})',x),two=vm.runInContext('loadUrbanHorizon({key:"one"})',x);
 assert.equal(one,two);assert.equal(calls,1);d.resolve([]);await one;assert.equal(vm.runInContext('urbanPending.size',x),0);
 assert.match(html,/moonUrbanTried \|\| urbanPending.has/);assert.match(html,/if \(seq !== extraSeq\) return;\s+fujiGeom = resolved/);
});
