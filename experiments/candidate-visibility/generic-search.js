/* Search job owner for the generic trial. No DOM, storage, or ambient IO. */
(function(root){
'use strict';
const api=root.AstroNotesCandidateDiscovery||(typeof require==='function'?require('./search.js'):null);
const Composition=root.AstroNotesCandidateComposition||(typeof require==='function'?require('./composition.js'):null);
const allowedPoint=p=>p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Math.abs(p.latitude)<85&&Math.abs(p.longitude)<=180;
function requestKey(p){return JSON.stringify([p.owner,p.body,p.target,p.partId,p.limb,p.matchMode,p.profile,p.strict,p.composition,p.timeWindow,p.timeSpec||{kind:'day',at:api.day(p.at)},p.atmosphere,p.lens?.mode==='unspecified'?{mode:'unspecified'}:p.lens,p.extraTargets,p.requireAllTargets]);}
function regionsFor(seeds){
 const map=new Map(),size=.005;
 for(const seed of seeds||[]){
  if(!allowedPoint(seed))continue;
  // Small service tiles are scheduling units. A budget never turns the unvisited tiles into 'no solution'.
  const radius=Math.max(200,seed.radiusM||500),dy=radius/111195,dx=dy/Math.max(.1,Math.cos(seed.latitude*Math.PI/180));
  const cx=Math.floor(seed.longitude/size),cy=Math.floor(seed.latitude/size);
  const nx=Math.min(3,Math.ceil(dx/size)),ny=Math.min(3,Math.ceil(dy/size));
  for(let x=cx-nx;x<=cx+nx;x++)for(let y=cy-ny;y<=cy+ny;y++){
   const bbox=[x*size,y*size,(x+1)*size,(y+1)*size];if(bbox[0]<-180||bbox[2]>180||bbox[1]<-85||bbox[3]>85)continue;
   const near=Math.hypot(((x+.5)*size-seed.longitude)*Math.cos(seed.latitude*Math.PI/180),(y+.5)*size-seed.latitude)*111195;
   const priority=(seed.priority||0)+near/radius,id=x+','+y;
   const previous=map.get(id);if(!previous||priority<previous.priority)map.set(id,{id,bbox,priority,source:'inverse-celestial-rays',seedAt:seed.at,seedRadiusM:radius,localEnvelopeIncomplete:dx>3*size||dy>3*size});
  }
 }
 return [...map.values()].sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id));
}
function createGenericSearch({provider,evaluate,bodies,loadStatic=null,maxPointsPerBatch=40,inverseOptions={},yieldTask=()=>new Promise(r=>setTimeout(r,0))}={}){
 const sessions=new Map();
 async function search(plan,{onProgress=()=>{},isCurrent=()=>true,signal,more=false}={}){
  const key=requestKey(plan);let session=sessions.get(key);
  const wanted=()=>!signal?.aborted&&isCurrent();
  if(!wanted())return {cancelled:true};
  // A cancelled A job may still await shared IO when the user returns A→B→A.
  // Retire only the obsolete owner; an active same-key job still owns its queue.
  if(session?.busy&&session.current?.()===false){
   // Detach mutable progress from the obsolete owner. Completed batches and
   // the pending point/cursor survive even if its IO never acknowledges abort.
   session={...session,rows:session.rows.slice(),queue:session.queue.slice(),seen:new Set(session.seen),seenRows:new Set(session.seenRows),counts:{...session.counts},coverage:session.coverage.slice(),busy:false,current:null};sessions.set(key,session);
  }
  if(session?.busy)return {cancelled:true,reason:'busy'};
  if(!session){
   await bodies.ensure(plan.body);if(!wanted())return {cancelled:true};
   onProgress({stage:'inverse',checked:0});
   const inverse=await Composition.inverseSeeds(plan,{bodies,isCurrent:wanted,yieldTask,...inverseOptions});
   if(!wanted())return {cancelled:true};
   session={key,regions:regionsFor(inverse.seeds),inverse,rows:[],queue:[],seen:new Set(),seenRows:new Set(),cursor:0,started:false,counts:{checked:0,unknown:0,blocked:0,noOverlap:0,deferred:0},coverage:[],busy:false};
   sessions.set(key,session);while(sessions.size>4)sessions.delete(sessions.keys().next().value);
  }
  if(!more&&session.started)return {...result(session),cached:true};
  session.busy=true;session.current=wanted;
  try{
   if(!session.queue.length&&(session.cursor!==null||!session.started)){
    onProgress({stage:'places',...session.counts});
    const data=await provider.load(plan,{regions:session.regions,cursor:session.cursor??0,isCurrent:wanted,onProgress,signal});
    if(!wanted()||data.cancelled)return {cancelled:true};
    const points=[...(data.points||[])];
    if(!session.started&&loadStatic){
     try{const legacy=await loadStatic();for(const p of api.sampleSidewalks(legacy).rows){if(!session.regions.some(r=>p.longitude>=r.bbox[0]&&p.longitude<=r.bbox[2]&&p.latitude>=r.bbox[1]&&p.latitude<=r.bbox[3]))continue;points.push({...p,surfaceId:p.polygonId||p.sourceId,placeKind:'road',standingSurfaceKnown:p.structureClassificationKnown&&!p.nonTerrainStructure,accessKnown:undefined,sourceEvidence:{kind:'PLATEAU-pedestrian-surface',sourceId:p.sourceId},name:'歩道の撮影候補'});}}catch{/* Live source remains usable. */}
    }
    // Commit a provider page only after all awaited preparation is current.
    if(!wanted())return {cancelled:true};
    session.coverage.push(data.coverage||{});session.cursor=data.coverage?.nextCursor??null;session.providerPartial=!!data.partial;
    for(const p of points){if(!allowedPoint(p))continue;const id=[p.surfaceId||p.sourceId,p.latitude.toFixed(7),p.longitude.toFixed(7),p.surfaceHeightM??p.groundM].join(':');if(session.seen.has(id))continue;session.seen.add(id);session.queue.push(p);}
    const preferred=new Set(['park','viewpoint','plaza','riverbank']);session.queue.sort((a,b)=>Number(!preferred.has(a.placeKind))-Number(!preferred.has(b.placeKind)));
    session.data=data;
   }
   session.started=true;let count=0;
   while(session.queue.length&&count<maxPointsPerBatch){
    if(!wanted())return {cancelled:true};
    const point=session.queue[0];onProgress({stage:'evaluate',...session.counts,pending:session.queue.length});
    const tested=await evaluate({...plan,requestKey:key},point,session.data,{isCurrent:wanted,signal});
    if(!wanted())return {cancelled:true};
    session.queue.shift();count++;session.counts.checked++;
    if(tested.partial)session.counts.deferred++;
    if(tested.status==='model-blocked')session.counts.blocked++;else if(tested.status==='no-overlap')session.counts.noOverlap++;else if(!tested.recommend)session.counts.unknown++;
    for(const row of [tested,...tested.additionalCandidates||[]]){
     if(!row.recommend||!allowedPoint(row.place)||!Number.isFinite(row.event?.at))continue;
     const range=Composition.timeRange(plan);if(!range||row.event.at<range.start||row.event.at>range.end)continue;
     const id=row.id||[row.surfaceId,row.place.latitude,row.place.longitude,row.event.at].join(',');
     if(!session.seenRows.has(id)){session.seenRows.add(id);session.rows.push({...row,id,requestKey:key});}
    }
    await yieldTask();
   }
   session.lastResult=result(session);return session.lastResult;
  }finally{session.busy=false;}
 }
 function result(s){return {rows:s.rows.slice(),counts:{...s.counts},requestKey:s.key,cached:false,limited:true,coverageStatus:'partial',jobStatus:'complete',canContinue:s.queue.length>0||s.cursor!==null,coverage:{regions:s.regions.length,loaded:s.coverage,pendingPoints:s.queue.length,nextCursor:s.cursor,approximateInverse:true},dataVersion:'generic-v1'};}
 return {search,cached:plan=>{const s=sessions.get(requestKey(plan));return s?.lastResult?{...s.lastResult,rows:s.lastResult.rows.slice(),cached:true}:null;},clear:()=>sessions.clear()};
}
api.requestKey=requestKey;api.regionsFor=regionsFor;api.createGenericSearch=createGenericSearch;
if(typeof module==='object'&&module.exports)module.exports={requestKey,regionsFor,createGenericSearch};
})(globalThis);
