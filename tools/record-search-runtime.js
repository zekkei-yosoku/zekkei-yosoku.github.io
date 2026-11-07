// One in-memory calculation session for both registered-place screens.
let recordSearchSession=null,recordIndexMemo=null;
const recordSearchFrame=()=>{
 let yielded=performance.now(),pending=null,finish=null,timer=null,ticket=0;
 const wake=id=>{if(!pending||id!==ticket)return;const done=finish;finish=null;pending=null;if(timer!==null)clearTimeout(timer);timer=null;yielded=performance.now();done();};
 const channel=new MessageChannel();channel.port1.onmessage=e=>wake(e.data);
 // A mobile page can suspend while its posted task is still pending. Neither
 // all future searches nor foreground recovery may depend on that one task.
 const resume=()=>{if(typeof document==='undefined'||!document.hidden)wake(ticket);};
 if(typeof document!=='undefined')document.addEventListener('visibilitychange',resume);
 globalThis.addEventListener?.('pageshow',resume);globalThis.addEventListener?.('focus',resume);
 return ()=>{
  if(pending)return pending;if(performance.now()-yielded<8)return Promise.resolve();
  const id=++ticket;pending=new Promise(resolve=>{finish=resolve;});
  timer=setTimeout(()=>wake(id),50);channel.port2.postMessage(id);return pending;
 };
};
const recordSearchYield=recordSearchFrame();
const recordSearchScope=()=>[auth?.token,auth?.loginId,accessState.generation,version,JSON.stringify([auth?.tools,aimAirSettings]),AstroNotesAtmosphere.dataKey(),globalThis.AstroNotesTowerModels,globalThis.AstroNotesCityModels];
const recordSameScope=(a,b)=>a?.length===b.length&&a.every((v,i)=>v===b[i]);
function recordSearchIndex(){
 const scope=[auth?.token,auth?.loginId,accessState.generation,version];
 if(!recordSameScope(recordIndexMemo?.scope,scope)){
  const records=load(),groups=new Map(),shapes=shapeData();
  for(const record of records){
   let targets=groups.get(record.placeId);if(!targets){targets=new Map();groups.set(record.placeId,targets);}
   let group=targets.get(record.target.key);if(!group){group=[];targets.set(record.target.key,group);}group.push(record);
  }
  recordIndexMemo={scope,records,groups,shapes};
 }
 return recordIndexMemo;
}
function recordSearchShape(f,shapes){const r=shapes[f.id];return r&&r.latitude===f.latitude&&r.longitude===f.longitude?AstroNotesShooting.cleanShape(r.shape):null;}
function recordBounded(map,key,build,limit){
 if(map.has(key)){const value=map.get(key);map.delete(key);map.set(key,value);return value;}
 const value=build();map.set(key,value);while(map.size>limit)map.delete(map.keys().next().value);return value;
}
function recordPrepared(session,shaped,obs,target,body,opts){
 const views=shaped?session.shapeViews:session.pointViews,key=JSON.stringify([obs,target,body,opts]);
 return recordBounded(views,key,()=>{session.prepares++;return AstroNotesAlign.prepareDailyView(obs,target,body,opts);},shaped?128:192);
}
function recordSolverFor(session,variant,shaped,override){
 const terrain=override||session.terrain,align=Object.create(AstroNotesAlign);
 align.prepareDailyView=(obs,target,body,opts)=>recordPrepared(session,shaped,obs,target,body,opts);
 align.dailyView=(obs,target,body,day,{at,...opts}={})=>recordPrepared(session,shaped,obs,target,body,opts)(day,at);
 const viewFor=(obs,p)=>{
  if(p.matchMode==='overlap'&&aimIsMountain(p.target)){
   // Keep the registered-point set across date/body switches. Dense line/area
   // samples have a separate, smaller budget and cannot evict these views.
   const views=shaped?session.shapeMountains:session.mountains,key=JSON.stringify([obs,p.target,p.body,p.partId,p.matchMode]);
   return recordBounded(views,key,()=>{
    const pending=aimShootingView(obs,p.target,p.body,p.partId,p.matchMode).catch(e=>{if(views.get(key)===pending)views.delete(key);throw e;});
    return pending;
   },shaped?96:384);
  }
  // Explore's original spatial branch computes an exact gap for its crossing probes.
  // Keep that branch while sharing its prepareDailyView through align.dailyView.
  if(shaped&&variant==='discovery')return null;
  const o=AstroNotesShooting.searchOptions(p,aimIsMountain);
  if(!(o.broad&&o.disc||o.partId==='__whole'&&!aimIsMountain(p.target)))return null;
  return recordPrepared(session,shaped,obs,p.target,p.body,{partId:o.partId,eyeM:obs.eyeM});
 };
 return recordHeightSolver({align,observerAt:(f,g)=>aimObserverAt(aimSavedFrom(f),g),ensure:b=>AstroNotesBodies.ensure(b),viewFor,yieldTask:recordSearchYield,elevationAt:(lat,lon)=>{
  const key=lat+','+lon;
  return recordBounded(terrain,key,()=>candidateElevation(lat,lon).then(value=>{if(!Number.isFinite(value))terrain.delete(key);return value;}),12000);
 }});
}
async function recordSearch(plan,entries,{isCurrent=()=>true,variant='discovery',terrainCache,onProgress=()=>{}}={}){
 const cancelled=()=>({rows:[],failed:0,cancelled:true});
 if(!isCurrent())return cancelled();
 const owner=auth?.token,loginId=auth?.loginId,generation=accessState.generation,revision=version;
 if(!owner||!toolAllowed('records'))return cancelled();
 const p=AstroNotesShooting.conditions(plan);if(!p)return {rows:[],failed:0};
 if(entries.length&&!AstroNotesAssets.modelsReady()){await AstroNotesAssets.ensureModels();if(!isCurrent()||owner!==auth?.token||loginId!==auth?.loginId||generation!==accessState.generation||revision!==version||!toolAllowed('records'))return cancelled();}
 const start=AstroNotesShooting.day(p.at),scope=recordSearchScope(),air=AstroNotesAtmosphere.dataKey(start);
 if(!recordSameScope(recordSearchSession?.scope,scope))recordSearchSession={scope,cache:createRecordSearchCache(),pointViews:new Map(),shapeViews:new Map(),mountains:new Map(),shapeMountains:new Map(),terrain:new Map(),solvers:new Map(),prepares:0};
 const session=recordSearchSession,current=()=>isCurrent()&&recordSearchSession===session&&recordSameScope(scope,recordSearchScope())&&air===AstroNotesAtmosphere.dataKey(start)&&toolAllowed('records');
 const planKey=JSON.stringify([start,air,p.target,p.body,p.partId,p.limb,p.matchMode]),rows=[],issues=[];
 let failed=0,checked=0,processed=0,stepM;
 for(const entry of entries){
  if(!current())return cancelled();
  const shaped=!!entry.place.shape,kind=shaped?variant:'point',solverKey=kind+(shaped?':shape':'');
  let solver=terrainCache?null:session.solvers.get(solverKey);
  if(!solver){solver=recordSolverFor(session,variant,shaped,terrainCache);if(!terrainCache)session.solvers.set(solverKey,solver);}
  const {discoveryKey,discoveryRecordIds,...place}=entry.place;
  const key=planKey+'|'+kind+'|'+JSON.stringify(Object.entries(place).sort(([a],[b])=>a.localeCompare(b)));
  const solve=async live=>{
   const value=await solver.candidates({...p,at:start},[{place,record:entry.record}],{isCurrent:live});
   const result=Array.isArray(value)?{rows:value,failed:0}:value;
   return {...result,rows:(result.rows||[]).map(({record,...row})=>row)};
  };
  const result=terrainCache?await solve(current):await session.cache.read(key,solve,current);
  if(!current()||result.cancelled)return cancelled();
  rows.push(...result.rows.map(row=>({...row,record:entry.record,...(discoveryKey?{place:{...row.place,discoveryKey,discoveryRecordIds}}:{})})));
  failed+=result.failed||0;checked+=result.checked||0;stepM=result.stepM??stepM;issues.push(...(result.issues||[]));
  onProgress({checked:++processed,total:entries.length});
  await recordSearchYield();
 }
 if(!current())return cancelled();
 rows.sort((a,b)=>a.event.at-b.event.at||a.place.name.localeCompare(b.place.name));
 return {rows,failed,...(checked?{checked}:{}),...(stepM?{stepM}:{}),...(issues.length?{issues}:{})};
}
// Use the forecast's existing mascot, speech bubble, track and motion rules.
function showRecordProgress(host,label,unit='件'){
 const element=(tag,cls)=>{const n=document.createElement(tag);n.className=cls;return n;};
 const node=element('div','note-wait record-search-progress'),character=element('span','note-wait-character'),bubble=element('div','note-wait-message'),headline=element('span','record-progress-title'),count=element('span','record-progress-count'),bar=element('div','note-progress'),fill=element('span','note-progress-fill');
 character.setAttribute('aria-hidden','true');count.setAttribute('aria-hidden','true');fill.setAttribute('aria-hidden','true');
 bar.setAttribute('role','progressbar');bar.setAttribute('aria-label','検索の進捗');bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax','100');
 bar.append(fill);bubble.append(headline,count,bar);node.append(character,bubble);host.replaceChildren(node);
 let last='';
 function update(n,total,message=label){
  const known=Number.isInteger(n)&&Number.isInteger(total)&&total>0&&n>=0&&n<=total,key=[n,total,message].join('|');if(last===key)return;last=key;
  if(headline.textContent!==message)headline.textContent=message;
  count.textContent=known?' '+n+' / '+total+unit:'';
  if(known)bar.setAttribute('aria-valuetext',n+' / '+total+unit);else bar.removeAttribute('aria-valuetext');
  if(known&&n>0){const percent=Math.min(99,Math.floor(n/total*100));bar.removeAttribute('data-indeterminate');bar.setAttribute('aria-valuenow',String(percent));fill.style.transform='scaleX('+percent/100+')';}
  else{bar.setAttribute('data-indeterminate','');bar.removeAttribute('aria-valuenow');fill.style.removeProperty('transform');}
 }
 update(0,0);return {node,update};
}
function recordSearchReset(){
 if(recordSearchSession&&!recordSameScope(recordSearchSession.scope,recordSearchScope()))recordSearchSession=null;
 if(recordIndexMemo&&!recordSameScope(recordIndexMemo.scope,[auth?.token,auth?.loginId,accessState.generation,version]))recordIndexMemo=null;
}
