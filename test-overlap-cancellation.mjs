import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const source=read('astronotes-myplaces.js'),tick=()=>new Promise(setImmediate);

for(const kind of ['worker','frame'])test(`${kind}: cancel running and queued jobs without stopping another job`,async()=>{
 const sent=[],started=[];let handler,release;
 const parent={postMessage:message=>sent.push(message)},origin='https://local.invalid';
 const engine={solve:async(input,context)=>{started.push(input.n);if(input.n===1)await new Promise(r=>release=r);if(!context.isCurrent())throw Error('calculation-cancelled');return input.n;}};
 const c=vm.createContext({location:{origin},parent,document:{documentElement:{dataset:{engine:'a'.repeat(64)}}},Image:function(){},OVERLAP_ENGINE:'a'.repeat(64),OVERLAP_SOURCE:'local.js',importScripts(){c.__overlap=engine;},__overlap:engine,addEventListener:(name,fn)=>handler=fn,postMessage:message=>sent.push(message)});
 vm.runInContext(read(`tools/overlap-calculation-${kind}.js`),c);
 const send=(id,op='solve',n=id,extra={})=>handler({origin,source:parent,data:{type:'astronotes-overlap',id,op,input:{n}},...extra});
 send(1);send(2);send(3);await tick();assert.deepEqual(started,[1]);
 if(kind==='frame'){send(1,'cancel',1,{origin:'https://other.invalid'});send(1,'cancel',1,{source:{}});}
 send(1,'cancel');send(2,'cancel');release();await tick();await tick();
 assert.deepEqual(started,[1,3]);
 assert.equal(sent.find(m=>m.id===1).error,'calculation-cancelled');
 assert.equal(sent.find(m=>m.id===2).error,'calculation-cancelled');
 assert.equal(sent.find(m=>m.id===3).result,3);
 // Unknown/late cancels leave no tombstone that can cancel a future job.
 send(4,'cancel');send(4);await tick();assert.equal(sent.find(m=>m.id===4).result,4);
});

test('parent cancels only its stale request and clears its timers',async()=>{
 const timers=new Map(),sent=[],calls=new Map();let next=0,current=true,closed=0;
 const c=vm.createContext({setTimeout:(fn,ms)=>{timers.set(++next,{fn,ms});return next;},clearTimeout:id=>timers.delete(id)});
 vm.runInContext(source.slice(source.indexOf('function opportunityCalculationCall('),source.indexOf('async function opportunityFrameSolve(')),c);
 const run=(id,live)=>c.opportunityCalculationCall(calls,id,{type:'astronotes-overlap',id,op:'solve'},m=>sent.push(m),()=>closed++,live);
 const first=run(1,()=>current),second=run(2,()=>true),rejected=assert.rejects(first,/calculation-cancelled/);
 current=false;for(const [id,{fn,ms}] of [...timers])if(ms===40){timers.delete(id);fn();}
 await rejected;assert.equal(calls.has(1),false);assert.equal(calls.has(2),true);assert.equal(closed,0);
 assert.deepEqual(sent.filter(x=>x.op==='cancel').map(x=>x.id),[1]);
 calls.get(2).resolve('ok');assert.equal(await second,'ok');assert.equal(timers.size,0);assert.equal(calls.size,0);
 await assert.rejects(run(3,()=>false),/calculation-cancelled/);assert.equal(sent.length,3);
});

test('legacy and current engine capabilities preserve cancellation and later requests',async()=>{
 for(const mode of ['worker','frame'])for(const cancellation of [false,true]){
  const timers=new Map(),sent=[],calls=new Map();let n=0,live=true,closed=0;
  const state={calls,cancellation,frame:{contentWindow:{postMessage:m=>sent.push(m)}}},slot={calls,cancellation,worker:{postMessage:m=>sent.push(m)}},pool={slots:[slot]};
  const c=vm.createContext({location:{origin:'https://local.invalid'},opportunityFrame:state,opportunityWorkers:pool,opportunityFrameSeq:0,opportunityWorkerSeq:0,
   opportunityFrameOpen:async()=>state,opportunityWorkersOpen:async()=>pool,opportunityFrameClose:()=>closed++,opportunityWorkersClose:()=>closed++,
   setTimeout:(fn,ms)=>{timers.set(++n,{fn,ms});return n;},clearTimeout:id=>timers.delete(id)});
  vm.runInContext(source.slice(source.indexOf('function opportunityCalculationCall('),source.indexOf('// 2026-11-09 Where the browser')),c);
  vm.runInContext(source.slice(source.indexOf('async function opportunityWorkerSolve('),source.indexOf('// Workers first;')),c);
  const run=()=>mode==='worker'?c.opportunityWorkerSolve({},'solve',null,()=>live):c.opportunityFrameSolve({},'solve',()=>live);
  const first=run(),rejected=assert.rejects(first,/calculation-cancelled/);await tick();live=false;
  for(const [id,{fn,ms}] of [...timers])if(ms===40){timers.delete(id);fn();}
  await rejected;assert.equal(sent.filter(m=>m.op==='cancel').length,cancellation?1:0,mode+' capability');
  assert.equal(timers.size,0);assert.equal(closed,0);
  live=true;const second=run();await tick();calls.get(sent.at(-1).id).resolve('next');assert.equal(await second,'next');assert.equal(timers.size,0);
 }
});

function deviceFixture(){
 const pending=[],writes=[],flights=new Map();
 const c=vm.createContext({auth:{loginId:'fixture',token:'local',tools:['records']},accessState:{generation:1},opportunityDeviceFlights:flights,opportunityDeviceStats:{hits:0,solves:0,failures:0,solveMs:0},performance,
  opportunityEngineOpen:async()=>({engine:'engine'}),opportunityListSettings:()=>({model:'geometric-candidate-v1'}),opportunityDigest:async value=>JSON.stringify(value),opportunitySemantic:p=>p,opportunityDateAt:()=> '2026-11-20',
  opportunityDbDo:async(mode,fn)=>fn({get:()=>null,put:value=>writes.push(value)}),opportunityGeometryFor:async()=>({id:'g',entries:{shared:true}}),opportunityDeviceRun:async(priority,work)=>work(),opportunityDevicePromote:flight=>{flight.priority='high';},opportunityDeviceInput:()=>({}),opportunityGeometryKeep:async()=>{},
  opportunityEngineSolve:(input,op,slot,live)=>new Promise((resolve,reject)=>pending.push({resolve,reject,live})),
 });
 vm.runInContext(source.slice(source.indexOf('async function opportunityDeviceSolve('),source.indexOf('// While the app is in front')),c);
 const pair={id:'p',place:{name:'place'},target:{id:'target'}};
 const run=live=>c.opportunityDeviceSolve(pair,0,{isCurrent:live});
 const finish=job=>job.resolve({status:'complete',rows:[{place:{name:'old'},target:{}}]});
 return {c,pending,writes,flights,run,finish};
}
test('shared calculation survives one reader cancelling; stale reader receives no rows',async()=>{
 const f=deviceFixture();let a=true,b=true;
 const first=f.run(()=>a);await tick();const second=f.run(()=>b);await tick();
 assert.equal(f.pending.length,1);a=false;assert.equal(f.pending[0].live(),true);
 f.finish(f.pending[0]);const [x,y]=await Promise.all([first,second]);
 assert.equal(x.cancelled,true);assert.equal(x.rows.length,0);assert.equal(y.rows.length,1);assert.equal(f.writes.length,1);assert.equal(f.flights.size,0);
});
test('all stale readers cancel work without caching; a new reader retries exactly once',async()=>{
 const f=deviceFixture();let active=true;
 const first=f.run(()=>active);await tick();active=false;assert.equal(f.pending[0].live(),false);
 const second=f.run(()=>true);await tick();assert.equal(f.pending.length,1);
 f.pending[0].reject(Error('calculation-cancelled'));await tick();assert.equal(f.pending.length,2);assert.equal(f.writes.length,0);
 f.finish(f.pending[1]);assert.equal((await first).cancelled,true);assert.equal((await second).rows.length,1);assert.equal(f.writes.length,1);
});
test('same-account reauthentication cancels the older generation before retry',async()=>{
 const f=deviceFixture(),first=f.run(()=>true);await tick();f.c.accessState.generation++;f.c.auth.token='next';
 const second=f.run(()=>true);await tick();assert.equal(f.pending[0].live(),false);
 f.pending[0].reject(Error('calculation-cancelled'));await tick();f.finish(f.pending[1]);
 assert.equal((await first).cancelled,true);assert.equal((await second).rows.length,1);assert.equal(f.writes.length,1);
});

test('a visible reader promotes queued background work; unused queued work is removed',async()=>{
 const timers=new Map(),queue={high:[],low:[],running:0};let n=0,current=true,ran=0;
 const c=vm.createContext({opportunityDeviceQueue:queue,recordDiscoveryBusy:1,opportunityEngineSlots:()=>1,setTimeout:fn=>{timers.set(++n,fn);return n;},clearTimeout:id=>timers.delete(id)});
 vm.runInContext(source.slice(source.indexOf('function opportunityDeviceRun('),source.indexOf('// One (pair, day) check.')),c);
 const flight={},p=c.opportunityDeviceRun('low',async()=>{ran++;return 'visible';},flight,()=>true);
 assert.equal(queue.low.length,1);assert.equal(ran,0);c.opportunityDevicePromote(flight);
 assert.equal(await p,'visible');await tick();assert.equal(ran,1);assert.equal(queue.low.length,0);assert.equal(timers.size,0);
 const stale=c.opportunityDeviceRun('low',async()=>{ran++;},{},()=>current);current=false;
 for(const [id,fn] of [...timers]){timers.delete(id);fn();}
 assert.equal((await stale).cancelled,true);assert.equal(ran,1);assert.equal(queue.low.length,0);assert.equal(timers.size,0);
});

function adapterFixture(){
 let count=0,time=0,yields=0;const active={value:true};
 const c=vm.createContext({auth:{tools:[]},version:0,accessState:{generation:0},recordSearchSession:null,recordIndexMemo:null,aimAirSettings:{},values:{},favorites:[],performance:{now:()=>time},
  AstroNotesAtmosphere:{configure(){},resetSnapshot(){}},AstroNotesBodies:{ensure:async()=>{}},AstroNotesAlign:{prepareDailyView:()=>()=>[]},AstroNotesShooting:{eventsFor:()=>{count++;time+=5;return [];},matches:()=>true},recordGeometry:{},
  recordSearch:async(plan,entries,options)=>{count++;assert.equal(typeof options.isCurrent,'function');return {rows:[],cancelled:!options.isCurrent()};},recordSearchYield:async()=>{yields++;active.value=false;},
 });
 vm.runInContext(read('tools/overlap-calculation-adapter.js'),c);
 return {c,active,count:()=>count,yields:()=>yields,context:{isCurrent:()=>active.value}};
}
test('adapter days and discovery stop at cooperative boundaries instead of finishing all input',async()=>{
 const f=adapterFixture();await assert.rejects(f.c.__overlap.days({tools:['records'],obs:{},target:{},body:'sun',start:0,count:40,from:0,limit:4},f.context),/calculation-cancelled/);
 assert.equal(f.count(),2);assert.equal(f.yields(),1);
 const d=adapterFixture();await assert.rejects(d.c.__overlap.discover({tools:['records'],plan:{target:{}},entries:[{}, {}, {}]},d.context),/calculation-cancelled/);
 assert.equal(d.count(),1);assert.equal(d.yields(),1);
});
