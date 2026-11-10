/* Search job owner for the generic trial. No DOM, storage, or ambient IO. */
(function(root){
'use strict';
const api=root.AstroNotesCandidateDiscovery||(typeof require==='function'?require('./search.js'):null);
const Composition=root.AstroNotesCandidateComposition||(typeof require==='function'?require('./composition.js'):null);
const allowedPoint=p=>p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Math.abs(p.latitude)<85&&Math.abs(p.longitude)<=180;
function requestKey(p){return JSON.stringify([p.owner,p.body,p.target,p.partId,p.limb,p.matchMode,p.profile,p.strict,p.composition,!!p.compositionInvalid,p.timeWindow,p.timeSpec||{kind:'day',at:api.day(p.at)},p.atmosphere,p.lens?.mode==='unspecified'?{mode:'unspecified'}:p.lens,p.extraTargets,p.requireAllTargets]);}
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
   // A low body is seen from far away, nearly level; a high one only from close by, looking up.
   // Recorded shots centre on 2-6 deg (median 2.9, 75% under 5.8). Below 2 deg the line rises
   // under 35 m per km, so the first house in front decides; those seeds come after the 2-6 deg band.
   const alt=Math.max(0,seed.bodyAltitude||0),preferAngle=alt<2?(2-alt)*1.5:alt<6?0:(alt-6)/4;
   const priority=(seed.priority||0)+near/radius+preferAngle,id=x+','+y;
   const previous=map.get(id);if(!previous||priority<previous.priority)map.set(id,{id,bbox,priority,source:'inverse-celestial-rays',seedAt:seed.at,seedRadiusM:radius,localEnvelopeIncomplete:dx>3*size||dy>3*size});
  }
 }
 return [...map.values()].sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id));
}
const placeKinds=new Set(['viewpoint','plaza','park','riverbank']);
function createGenericSearch({provider,evaluate,bodies,loadStatic=null,maxPointsPerBatch=40,inverseOptions={},yieldTask=()=>new Promise(r=>setTimeout(r,0))}={}){
 const sessions=new Map();
 const fresh=(key,inverse,lastResult=null)=>({key,regions:regionsFor(inverse.seeds),inverse,lastResult,rows:[],queue:[],seen:new Set(),seenRows:new Set(),cursor:0,started:false,counts:{checked:0,unknown:0,blocked:0,noOverlap:0,unverified:0,heightUnknown:0,nearBuilding:0,obstacle:0,outsideFrame:0,deferred:0},coverage:[],busy:false});
 // Rechecking the same conditions replaces only working progress. The last
 // complete result remains available when a recheck fails or is cancelled.
 function restart(plan){const key=requestKey(plan),previous=sessions.get(key);if(previous?.busy&&previous.current?.()!==false)return false;if(previous)sessions.set(key,fresh(key,previous.inverse,previous.lastResult));return true;}
 async function search(plan,{onProgress=()=>{},isCurrent=()=>true,signal,more=false,retryFailed=true}={}){
  if(plan.compositionInvalid)throw Error('invalid-composition');
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
   session=fresh(key,inverse);
   sessions.set(key,session);while(sessions.size>4)sessions.delete(sessions.keys().next().value);
  }
  if(!more&&session.started)return {...result(session),cached:true};
  session.busy=true;session.current=wanted;
  try{
   if(!session.queue.length&&(session.cursor!==null||!session.started)){
    onProgress({stage:'places',...session.counts});
    const data=await provider.load(plan,{regions:session.regions,cursor:session.cursor??0,isCurrent:wanted,onProgress,signal,retryFailed});
    if(!wanted()||data.cancelled)return {cancelled:true};
    const points=[...(data.points||[])];
    if(!session.started&&loadStatic){
     try{const legacy=await loadStatic();for(const p of api.sampleSidewalks(legacy).rows){if(!session.regions.some(r=>p.longitude>=r.bbox[0]&&p.longitude<=r.bbox[2]&&p.latitude>=r.bbox[1]&&p.latitude<=r.bbox[3]))continue;points.push({...p,surfaceId:p.polygonId||p.sourceId,placeKind:'road',standingSurfaceKnown:p.structureClassificationKnown&&!p.nonTerrainStructure,accessKnown:undefined,sourceEvidence:{kind:'PLATEAU-pedestrian-surface',sourceId:p.sourceId},name:'歩道の撮影候補'});}}catch{/* Live source remains usable. */}
    }
    // Commit a provider page only after all awaited preparation is current.
    if(!wanted())return {cancelled:true};
    session.coverage.push(data.coverage||{});session.cursor=data.coverage?.nextCursor??null;session.providerPartial=!!data.partial;
    session.retryAt=data.coverage?.retryAfterMs>0?Date.now()+data.coverage.retryAfterMs:0;
    // New places are squares, viewpoints and observation decks, parks and riverbanks; plain walkways are not offered.
    for(const p of points){if(!allowedPoint(p)||!placeKinds.has(p.placeKind))continue;const id=[p.surfaceId||p.sourceId,p.latitude.toFixed(7),p.longitude.toFixed(7),p.surfaceHeightM??p.groundM].join(':');if(session.seen.has(id))continue;session.seen.add(id);session.queue.push(p);}
    const order=['viewpoint','riverbank','plaza','park'];session.queue.sort((a,b)=>order.indexOf(a.placeKind)-order.indexOf(b.placeKind));
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
    if(tested.status==='model-blocked')session.counts.blocked++;else if(tested.status==='no-overlap')session.counts.noOverlap++;
    else if(tested.status==='unverified'){session.counts.unverified++;if(tested.heightUnknown)session.counts.heightUnknown++;if(tested.nearBuilding)session.counts.nearBuilding++;if(tested.obstacle)session.counts.obstacle++;}
    else if(tested.status==='outside-frame')session.counts.outsideFrame++;else if(!tested.recommend)session.counts.unknown++;
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
 // Drain scheduled pages and point batches as one cancellable foreground search.
 // onPage(page): each finished page with every row found so far, so a long search can show its rows as it goes.
 async function searchAll(plan,{onBatchStart=()=>{},onPage=()=>{},...options}={}){
  const wanted=()=>!options.signal?.aborted&&(options.isCurrent?.()??true);
  const cursors=new Set();let more=!!options.more,waits=0;
  while(wanted()){
   onBatchStart();
   const page=await search(plan,{...options,more,retryFailed:false});
   if(!wanted()||page.cancelled)return {cancelled:true};
   if(!page.canContinue)return page;
   onPage(page);
   // The place source asked to wait (Overpass cooling down): wait, then fetch the regions it left. Three waits at most;
   // a busier Overpass ends the search with its regions reported as not fetched.
   const waitMs=(page.retryAt||0)-Date.now();
   if(!page.coverage.pendingPoints&&waitMs>0&&waits<3){waits++;options.onProgress?.({stage:'places-wait',waitMs,...page.counts});for(const end=Date.now()+waitMs+250;Date.now()<end;){if(!wanted())return {cancelled:true};await new Promise(r=>setTimeout(r,Math.min(250,end-Date.now())));}more=true;continue;}
   if(!page.coverage.pendingPoints){
    const cursor=JSON.stringify(page.coverage.nextCursor);
    if(cursors.has(cursor)){const stalled={...page,stalled:true};sessions.get(page.requestKey).lastResult=stalled;return stalled;}
    cursors.add(cursor);
   }
   more=true;await yieldTask();
  }
  return {cancelled:true};
 }
 function result(s){return {rows:s.rows.slice(),counts:{...s.counts},retryAt:s.retryAt||0,requestKey:s.key,cached:false,limited:true,coverageStatus:'partial',jobStatus:'complete',canContinue:s.queue.length>0||s.cursor!==null,coverage:{regions:s.regions.length,loaded:s.coverage,pendingPoints:s.queue.length,nextCursor:s.cursor,approximateInverse:true},dataVersion:'generic-v1'};}
 return {search,searchAll,restart,cached:plan=>{const s=sessions.get(requestKey(plan));return s?.lastResult?{...s.lastResult,rows:s.lastResult.rows.slice(),cached:true}:null;},clear:()=>sessions.clear()};
}
api.requestKey=requestKey;api.regionsFor=regionsFor;api.createGenericSearch=createGenericSearch;
if(typeof module==='object'&&module.exports)module.exports={requestKey,regionsFor,createGenericSearch};
})(globalThis);
