import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {sourceUnit,sourceDeclaration} from './tools/test-source.mjs';

const obs={latitude:35.5,longitude:139.5},target={id:'hill',latitude:35.7,longitude:139.7,parts:[{m:1000}]};
function fixture(){
 const state={reads:0,angles:0,hold:true,missing:false,k:.13,releases:[]};
 const read=async points=>{state.reads++;if(state.hold)await new Promise(resolve=>state.releases.push(resolve));return points.map(()=>state.missing?null:100);};
 const angle=(_d,_eye,m)=>{state.angles++;return m/100;};
 const ctx=vm.createContext({AstroNotesAtmosphere:{targetK:()=>state.k},AstroNotesAlign:{rimOutline:()=>null},aimAirAngle:angle,
  AstroNotesTerrain:{distanceKm:()=>10,bearing:()=>90,inverse:()=>({km:10,azimuth:90}),destination:(latitude,longitude)=>({latitude,longitude}),
   prepareRidgeDestination:(latitude,longitude)=>()=>({latitude,longitude}),prepareRidgeElevation:(d,eye)=>m=>angle(d,eye,m),elevations:read,tileElevations:read}});
 vm.runInContext(sourceUnit('src/features/framing/scene/terrain.js')+';globalThis.api={ridge:aimLookRidge,front:aimTerrainFront,beyond:aimTerrainBeyond,caches:{ridge:aimRidgeCache,front:aimFrontCache,beyond:aimBeyondCache},pending:{ridge:aimRidgePending,front:aimFrontPending,beyond:aimBeyondPending}};',ctx);
 const run=(kind,isCurrent,eye=20)=>kind==='ridge'?ctx.api.ridge(obs,eye,target,{isCurrent}):ctx.api[kind](obs,eye,target,45,{isCurrent});
 return {state,api:ctx.api,run,release:()=>{for(const release of state.releases.splice(0))release();}};
}
for(const kind of ['ridge','front','beyond']){
 test(`${kind}: a superseded consumer does not cancel the current shared consumer`,async()=>{
  const f=fixture();let a=true,b=true;
  const first=f.run(kind,()=>a),second=f.run(kind,()=>b);assert.equal(f.state.reads,1);
  const entry=[...f.api.pending[kind].values()][0];a=false;f.release();
  const [x,y]=await Promise.all([first,second]);assert(x);assert.equal(x,y);assert(f.state.angles>0);
  assert.equal(f.api.pending[kind].size,0);assert.equal(entry.consumers.size,0);
  assert.equal(await f.run(kind,()=>true),x);assert.equal(f.state.reads,1);
 });
 test(`${kind}: all expired consumers stop post-read work and can retry`,async()=>{
  const f=fixture();let active=true;
  const old=f.run(kind,()=>active);active=false;f.release();assert.equal(await old,null);
  assert.equal(f.state.angles,0);assert.equal(f.api.caches[kind].size,0);assert.equal(f.api.pending[kind].size,0);
  f.state.hold=false;assert(await f.run(kind,()=>true));assert.equal(f.state.reads,2);assert(f.state.angles>0);
 });
 test(`${kind}: search callers keep a shared read alive without retaining view callbacks`,async()=>{
  const f=fixture();let active=true;const view=f.run(kind,()=>active),search=f.run(kind);
  const entry=[...f.api.pending[kind].values()][0];assert(entry.persistent);assert.equal(entry.consumers.size,0);
  active=false;f.release();const [a,b]=await Promise.all([view,search]);assert(a);assert.equal(a,b);assert.equal(f.state.reads,1);
 });
 test(`${kind}: an already expired caller issues no read; changed atmosphere is not cached`,async()=>{
  const f=fixture();assert.equal(await f.run(kind,()=>false),null);assert.equal(f.state.reads,0);
  const read=f.run(kind,()=>true);f.state.k=.2;f.release();assert.equal(await read,null);assert.equal(f.state.angles,0);assert.equal(f.api.caches[kind].size,0);
 });
}
test('front: completed profiles use a 256-entry LRU; pending and retry remain independent',async()=>{
 const f=fixture();f.state.hold=false;
 for(let i=0;i<256;i++)await f.run('front',undefined,20+i);
 assert.equal(f.api.caches.front.size,256);const initial=await f.run('front',undefined,20);assert.equal(f.state.reads,256);
 await f.run('front',undefined,276);assert.equal(f.api.caches.front.size,256);
 assert.equal(await f.run('front',undefined,20),initial);assert.equal(f.state.reads,257);
 await f.run('front',undefined,21);assert.equal(f.state.reads,258,'least recently used profile is read again');
 f.state.hold=true;const inFlight=f.run('front',()=>true,1000);assert.equal(f.api.pending.front.size,1);assert.equal(f.api.caches.front.size,256);
 f.release();await inFlight;assert.equal(f.api.pending.front.size,0);assert.equal(f.api.caches.front.size,256);
});
test('ridge/front: missing profiles remain retryable and exact search remains independent',async()=>{
 for(const kind of ['ridge','front']){
  const f=fixture();f.state.hold=false;f.state.missing=true;assert.equal(await f.run(kind),null);assert.equal(f.api.caches[kind].size,0);
  f.state.missing=false;assert(await f.run(kind));assert.equal(f.state.reads,2);
 }
 const f=fixture();f.state.hold=false;
 const a=await f.api.ridge(obs,20,target,{exactSearch:true}),b=await f.api.ridge(obs,20,target,{exactSearch:true});
 assert.deepEqual(a,b);assert.equal(f.state.reads,2);assert.equal(f.api.caches.ridge.size,0);
});
test('visible host excludes hidden ancestors and background tabs, and recovers on return',()=>{
 const document={hidden:false},host={isConnected:true,hidden:true,rects:1,getClientRects(){return Array(this.rects);}};
 const ctx=vm.createContext({document});vm.runInContext(sourceDeclaration('aimLookVisible')+';globalThis.visible=aimLookVisible;',ctx);
 assert.equal(ctx.visible(host),false);host.hidden=false;assert.equal(ctx.visible(host),true,'initially hidden host becomes renderable');
 host.rects=0;assert.equal(ctx.visible(host),false);host.rects=1;document.hidden=true;assert.equal(ctx.visible(host),false);
 document.hidden=false;assert.equal(ctx.visible(host),true);host.isConnected=false;assert.equal(ctx.visible(host),false);
});
test('a replacement arriving after cancellation does not inherit the cancelled pending result',async()=>{
 const ctx=vm.createContext({});vm.runInContext(sourceDeclaration('aimTerrainTask')+';globalThis.run=aimTerrainTask;',ctx);
 const pending=new Map();let alive=true,release,afterCancelled,newWork=0;
 const old=ctx.run(pending,'same',()=>alive,async current=>{
  await new Promise(resolve=>release=resolve);
  assert.equal(current(),false);afterCancelled=ctx.run(pending,'same',()=>true,async()=>{newWork++;return 'current';});
  return null;
 });
 alive=false;release();assert.equal(await old,null);assert.equal(await afterCancelled,'current');assert.equal(newWork,1);assert.equal(pending.size,0);
});
test('legacy resume commits a crossed day before retrying an unfinished scene',()=>{
 const source=sourceUnit('src/features/framing/presentation.js'),start=source.indexOf(' function resumeLegacyPreview(){'),end=source.indexOf(" document.addEventListener('visibilitychange',resumeLegacyPreview)",start);
 const day=Date.parse('2026-11-25T00:00:00+09:00'),at=day+86400000+7000,calls=[];
 const look={_uiTime:{current:at},_lookNeedsRefresh:true,_lookSpec:{at:day+40000}};
 const ctx=vm.createContext({look,aim:{dayMs:day},S:{JstCal:{startOfDay:t=>Math.floor((t+32400000)/86400000)*86400000-32400000}},legacyTimelineVisible:()=>true,commitPreviewTime:t=>calls.push(['commit',t]),aimLookRender:(_h,s)=>calls.push(['render',s.at]),update(){}});
 vm.runInContext(source.slice(start,end)+';globalThis.resume=resumeLegacyPreview;',ctx);ctx.resume();assert.deepEqual(calls,[['commit',at]]);
 calls.length=0;ctx.aim.dayMs=day+86400000;ctx.resume();assert.deepEqual(calls,[['render',at]]);
 calls.length=0;look._lookNeedsRefresh=false;ctx.resume();assert.deepEqual(calls,[]);
});
test('Explore invalidation only expires the scene it owns, including after leaving its route',()=>{
 const source=sourceUnit('src/features/explore/controller.js'),start=source.indexOf(' onInvalidate:'),end=source.indexOf('\nconst stamp=',start);
 const calls=[],look={_lookOwner:'framing',_lookSeq:4,_planKey:'legacy',_captionTimer:1};
 const ctx=vm.createContext({look,clearTimeout:id=>calls.push(id)});
 vm.runInContext('globalThis.invalidate=({'+source.slice(start,end).replace(/\}\);\s*$/,'}')+').onInvalidate;',ctx);
 ctx.invalidate();assert.equal(look._lookSeq,4);assert.equal(look._planKey,'legacy');assert.deepEqual(calls,[]);
 look._lookOwner='explore';ctx.invalidate(true);assert.equal(look._lookSeq,4);assert.equal(look._planKey,null);assert.deepEqual(calls,[1]);
 ctx.invalidate();assert.equal(look._lookSeq,5);
});
