// Real main-load, navigation, retry owner and cache contracts; synthetic DTOs only.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {sourceUnit,sourceDeclaration} from './tools/test-source.mjs';
const require=createRequire(import.meta.url),Library=require('./astronotes-library.js'),S=require('./astronotes-core.js'),Prediction=require('./astronotes-prediction.js');
const start=Date.parse('2026-11-23T00:00:00+09:00'),H=3600000;
S.setTimezoneOffset(32400);
const copy=x=>JSON.parse(JSON.stringify(x));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function harness({cache=false}={}){
 let now=start,next=0,route=null,respond=null;const timers=new Map(),listeners=new Set(),requests=[],data=new Map(),nodes=new Map(),errors=[];
 const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:true,innerHTML:'',textContent:'',open:false,button:{},querySelector(){return this.button;},setAttribute(){},removeAttribute(){},focus(){}});return nodes.get(id);};
 const document={hidden:false,addEventListener(event,fn){assert.equal(event,'visibilitychange');listeners.add(fn);},removeEventListener(event,fn){listeners.delete(fn);}};
 const sandbox={AstroNotesLibrary:Library,S,document,navigator:{onLine:true},console:{warn:(...args)=>errors.push(args)},
  Date:class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}},
  setTimeout(fn,delay){const id=++next;timers.set(id,{fn,at:now+delay,delay});return id;},clearTimeout:id=>timers.delete(id),
  $:node,place:{id:'fixture',name:'合成地点',latitude:35,longitude:139,elevation:10,eyeHeightAGL:1.5,terrain:null},
  extrasRetry:{reset(){}},routeFromHash:()=>route,forecastSummary:{waiting(){}},renderSkeleton:()=>'',
  store:{get:(key,fallback)=>copy(data.get(key)??fallback),set:(key,value)=>data.set(key,copy(value))},collectObservations:()=>({cloud:30}),
  restoreSharedPlan:()=>null,viewState:{},almanacPlayback:null,almanacTimeline:null,aim:{},SkyMapUI:null,clearAdminView(){},loadPhotos(){},render(){},
  currentView:'list',window:{scrollY:0,scrollTo(){}},picked:null,listScrollY:0,selectedDay:{},nextAimCustomRequest(){},setAlmanacDay(){},
 };
 const x=vm.createContext(sandbox);
 const send=()=>{const d=deferred();requests.push(d);if(respond)Promise.resolve().then(()=>respond()).then(d.resolve,d.reject);return d.promise;};
 const client=Prediction.createClient({cacheStorage:null,now:()=>now,transport:async()=>new Response(JSON.stringify(await send()),{headers:{'content-type':'application/json'}})});
 x.AstroNotesPrediction={fresh:Prediction.fresh,fetch:cache?p=>client.request(p):()=>send()};
 vm.runInContext(sourceDeclaration('createForecastRetry')+'\n'+sourceDeclaration('ROUND_KEEP_MS')+'\n'+sourceDeclaration('samePlaceAs')+'\n'+sourceDeclaration('keepRounds')+'\n'+sourceUnit('src/features/forecast/load.js')+'\n'+sourceDeclaration('applyRoute'),x);
 const run=code=>vm.runInContext(code,x);
 const settle=async()=>{for(let i=0;i<16;i++)await new Promise(resolve=>setImmediate(resolve));};
 const fire=async()=>{const item=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];assert(item,'retry timer exists');timers.delete(item[0]);now=item[1].at;item[1].fn();await settle();return item[1].delay;};
 const dto=({partial=true,light=false,score=70,missing=false,label='fixture'}={})=>{
  const p=copy(x.place),day=S.Cal.startOfDay(now),event={phenomenon:'sunrise',peak:day+6*H,window:[day+5*H,day+7*H],score,rank:{key:'good'},confidence:{key:'medium'},models:3,perModel:{jma_msm:score},factors:[],spread:[score,score],uncertainty:{basis:'models',expectedError:null},scoringVersion:'quality-v1',algorithmVersion:Prediction.VERSION,predictionAsOf:now,fetchedAt:now};
  if(missing)event.unavailable={kind:'missingData',message:'太陽方向の予報がありません'};
  return {schemaVersion:1,algorithmVersion:Prediction.VERSION,scoringVersion:'quality-v1',place:p,asOf:now,days:[day],bundle:{label,fetchedAt:now,utcOffsetSeconds:32400,home:{byModel:{}}},weeks:Object.fromEntries(Prediction.IDS.map(id=>[id,id==='sunrise'?[{dayMs:day,evaluation:event}]:[]])),...(partial||light?{warnings:{...(partial?{sunward:true}:{}),...(light?{lightPollution:true}:{})},retryAt:now+60000}:{})};
 };
 return {x,run,requests,timers,listeners,nodes,data,errors,document,dto,settle,fire,setTime:v=>now=v,setResponder:fn=>respond=fn,
  async load(value){const pending=run('load(false)');requests.at(-1).resolve(value);await pending;await settle();},
  async route(value){route=value;run('applyRoute()');await settle();}};
}

test('層欠測DTOのretryAtをmainが消費し、他の予測と事前保存を保ち、完全成功で停止する',async()=>{
 const h=harness();await h.load(h.dto());assert.equal(h.timers.size,1);assert.match(h.nodes.get('predictionDataNotice').innerHTML,/太陽方向.*再取得/);
 const before=copy(h.data.get('sorami.rounds'));assert.equal(before[0].uncertainty.expectedError,null);assert.equal(before[0].scoringVersion,'quality-v1');
 assert.equal(await h.fire(),60000);assert.equal(h.requests.length,2);assert.equal(h.run('bundle.label'),'fixture');assert.deepEqual(h.data.get('sorami.rounds'),before);
 h.requests[1].resolve(h.dto({partial:false,label:'complete'}));await h.settle();assert.equal(h.run('bundle.label'),'complete');assert.equal(h.timers.size,0);assert.equal(h.nodes.get('predictionDataNotice').hidden,true);
});
test('自動再試行後の一時network失敗は既存予測/記録を壊さず残り予算で回復する',async()=>{
 const h=harness();await h.load(h.dto());const saved=copy(h.data.get('sorami.rounds'));
 await h.fire();h.requests[1].reject(Error('temporary'));await h.settle();assert.equal(h.timers.size,1);assert.equal(h.run('bundle.label'),'fixture');assert.deepEqual(h.data.get('sorami.rounds'),saved);
 const pending=[...h.timers];assert.equal(h.run('predictionDirty'),false);await h.route({id:'sunrise',dayMs:start});await h.route(null);assert.equal(h.requests.length,2);assert.deepEqual([...h.timers],pending,'failed auto refresh preserves budget during internal navigation');
 assert.equal(await h.fire(),120000);h.requests[2].resolve(h.dto({partial:false}));await h.settle();assert.equal(h.timers.size,0);
});
test('連続層欠測はapplyRoute再入でも予算をresetせず、自動3回で止まる',async()=>{
 const h=harness();await h.load(h.dto());
 for(const delay of [60000,120000,240000]){assert.equal(await h.fire(),delay);h.requests.at(-1).resolve(h.dto());await h.settle();}
 assert.equal(h.requests.length,4);assert.equal(h.timers.size,0);assert.equal(h.run('predictionDirty'),false);assert.equal(h.nodes.get('predictionDataNotice').hidden,false);
 await h.load(h.dto());assert.equal(await h.fire(),60000,'manual/new load starts a fresh bounded budget');
 h.requests.at(-1).resolve(h.dto({partial:false}));await h.settle();
});
test('retryAtを過ぎても一覧と詳細の移動は取得せず、timerと3回上限を維持する',async()=>{
 const h=harness({cache:true});h.setResponder(()=>h.dto());await h.run('load(false)');await h.settle();await h.fire();
 h.setTime(start+120001);const pending=[...h.timers];
 await h.route({id:'sunrise',dayMs:start});await h.route(null);
 assert.equal(h.requests.length,2,'navigation is not a manual retry');assert.deepEqual([...h.timers],pending,'backoff deadline stays unchanged');
 assert.equal(await h.fire(),120000);assert.equal(await h.fire(),240000);assert.equal(h.requests.length,4);assert.equal(h.timers.size,0);
 h.setTime(start+600000);await h.route({id:'sunrise',dayMs:start});await h.route(null);assert.equal(h.requests.length,4);assert.equal(h.timers.size,0,'navigation cannot replenish an exhausted budget');
 await h.route({almanac:true});await h.route(null);assert.equal(h.requests.length,5,'leaving and returning still refreshes through predictionDirty');assert.equal(h.timers.size,1);
});
test('非表示の期限到来では取得せず、可視復帰で1回だけ再開する',async()=>{
 const h=harness();await h.load(h.dto());h.document.hidden=true;await h.fire();assert.equal(h.requests.length,1);assert.equal(h.listeners.size,1);
 h.document.hidden=false;for(const fn of [...h.listeners])fn();await h.settle();assert.equal(h.requests.length,2);assert.equal(h.listeners.size,0);h.requests[1].resolve(h.dto({partial:false}));await h.settle();
});
test('画面離脱はtimer/hidden listenerを取消し、再入では期限前cacheを使って再armする',async()=>{
 const h=harness({cache:true});h.setResponder(()=>h.dto());await h.run('load(false)');await h.settle();assert.equal(h.requests.length,1);
 await h.route({almanac:true});assert.equal(h.timers.size,0);
 await h.route(null);assert.equal(h.requests.length,1,'before retryAt: no cache bypass');assert.equal(h.timers.size,1);
 h.document.hidden=true;await h.fire();assert.equal(h.listeners.size,1);await h.route({almanac:true});assert.equal(h.listeners.size,0);
 h.document.hidden=false;await h.route(null);assert.equal(h.requests.length,2,'after retryAt: actual client refetches');
 await h.route({almanac:true});assert.equal(h.timers.size,0);
});
test('手動再取得も期限前cacheを遵守し、光害/太陽側は同じnoticeと操作に統合する',async()=>{
 const h=harness({cache:true});h.setResponder(()=>h.dto({light:true}));await h.run('load(false)');await h.settle();
 const notice=h.nodes.get('predictionDataNotice');assert.match(notice.innerHTML,/太陽方向/);assert.match(notice.innerHTML,/光害/);assert.equal((notice.innerHTML.match(/<button/g)||[]).length,1);
 await notice.button.onclick();await h.settle();assert.equal(h.requests.length,1);assert.equal(h.timers.size,1);
 await h.fire();assert.equal(h.requests.length,2);await h.route({almanac:true});
});
test('地点変更と通常loadの世代更新は古いretry、成功応答、失敗応答を採用しない',async()=>{
 const h=harness();await h.load(h.dto());const oldRetry=h.run('predictionRetryContext');await h.fire();const old=h.requests[1];
 h.x.place={...h.x.place,latitude:36};const current=h.run('load(true)'),newDto=h.dto({partial:false,label:'new-place'});h.requests[2].resolve(newDto);await current;
 old.resolve({...h.dto(),bundle:{label:'stale'}});await h.settle();assert.equal(h.run('bundle.label'),'new-place');assert.equal(h.timers.size,0);
 h.x.oldRetry=oldRetry;await h.run('load(false,oldRetry)');assert.equal(h.requests.length,3);
 const first=h.run('load(true)');await h.route({almanac:true});await h.route(null);h.requests[4].resolve(h.dto({partial:false,label:'new-generation'}));await h.settle();h.requests[3].reject(Error('old failure'));await first;assert.equal(h.run('bundle.label'),'new-generation');assert.equal(h.nodes.get('status').hidden,true);
});
test('取得中の画面離脱では後着DTOを採用せず、予測や事前記録を増やさない',async()=>{
 const h=harness();const pending=h.run('load(false)'),late=h.dto();await h.route({almanac:true});h.requests[0].resolve(late);await pending;assert.equal(h.run('bundle'),null);assert.equal(h.data.has('sorami.rounds'),false);assert.equal(h.timers.size,0);
});
test('初回失敗と地点変更後の失敗はdirtyのまま、保持予測のTTL満了では再取得する',async()=>{
 const h=harness();let job=h.run('load(false)');h.requests[0].reject(Error('first'));await job;assert.equal(h.run('predictionDirty'),true);
 await h.load(h.dto({partial:false}));h.x.place={...h.x.place,latitude:36};job=h.run('load(false)');h.requests[2].reject(Error('new place'));await job;assert.equal(h.run('predictionDirty'),true);assert.equal(h.run('bundle'),null);
 await h.load(h.dto({partial:false}));h.setTime(start+31*60000);await h.route({id:'sunrise',dayMs:start});assert.equal(h.requests.length,5,'ordinary TTL expiry still refreshes');h.requests[4].resolve(h.dto({partial:false}));await h.settle();
});
test('欠測回を保存せず、既に開始した事前控えは再取得で上書きしない',async()=>{
 const h=harness();await h.load(h.dto({missing:true}));assert.equal(h.data.get('sorami.rounds').length,0);
 await h.load(h.dto({score:70}));const saved=copy(h.data.get('sorami.rounds'));
 h.setTime(start+6*H);await h.load(h.dto({partial:false,score:20}));assert.deepEqual(h.data.get('sorami.rounds'),saved);assert.equal(h.run('weeks.sunrise[0].evaluation.score'),20);
});

function withMoonExtras(h){
 const calls=[];
 h.x.AstroNotesPrediction.visibility=()=>{const d=deferred();calls.push(d);return d.promise;};
 h.x.AstroNotesTerrain={combinedHorizon:()=>()=>0,flatProfile:()=>[]};h.x.rerenderList=()=>{};h.x.refreshLightTimes=()=>{};
 h.run('let extrasLoadedSeq=-1,extrasRunning=false,extrasRunningSeq=-1,moonWeeklySeq=AstroNotesLibrary.gate(),moonEvalSeq=AstroNotesLibrary.gate(),moonAcceptedSeq=0,moonTerrainProfile=null,moonUrbanProfile=null,moonHorizon=null,moonPredictionPlace=null,moonDetailKey=null;const moonVisibility=new Map(),moonDetailPending=new Map();');
 h.run(sourceDeclaration('setExtrasLoadedSeq')+'\n'+sourceDeclaration('kickExtras')+'\n'+sourceDeclaration('updateMoonPrediction'));
 // Geometry is synthetic; the real extras owner and real late-response consumer run.
 h.x.loadExtras=()=>h.run('updateMoonPrediction({},predictionPlace||place,extraSeq.ticket())');
 h.x.render=()=>h.run('kickExtras()');
 return {calls,reply:(index,label)=>calls[index].resolve({visibilityKey:label,asOf:start,bundle:{fetchedAt:start},weeks:{moon:[label]}})};
}
test('同地点main再試行がHTTP失敗しても進行中の月は採用され、追加取得を重複しない',async()=>{
 const h=harness(),moon=withMoonExtras(h);await h.load(h.dto());assert.equal(moon.calls.length,1);const generation=h.run('extraSeq.ticket()');
 await h.fire();assert.equal(h.run('extraSeq.ticket()'),generation,'accepted forecast extras stay current while refreshing');
 h.requests[1].reject(Error('temporary'));await h.settle();moon.reply(0,'accepted-moon');await h.settle();assert.equal(h.run('weeks.moon[0]'),'accepted-moon');
 h.run('kickExtras();kickExtras()');assert.equal(moon.calls.length,1,'the old completed generation is not restarted');
});
test('main採用時は旧月を失効し、新月を1回だけ開始する。離脱後の結果も拒否する',async()=>{
 const h=harness(),moon=withMoonExtras(h);await h.load(h.dto());await h.fire();h.requests[1].resolve(h.dto({partial:false}));await h.settle();assert.equal(moon.calls.length,2);
 moon.reply(0,'stale-moon');await h.settle();assert.equal(h.run('weeks.moon'),undefined);h.run('kickExtras();kickExtras()');assert.equal(moon.calls.length,2);
 moon.reply(1,'new-moon');await h.settle();assert.equal(h.run('weeks.moon[0]'),'new-moon');
 await h.load(h.dto());assert.equal(moon.calls.length,3);await h.route({almanac:true});moon.reply(2,'left-moon');await h.settle();assert.equal(h.run('weeks.moon'),undefined);
});
