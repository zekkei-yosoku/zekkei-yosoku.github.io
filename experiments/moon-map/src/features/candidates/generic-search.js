/* Search job owner for the generic trial. No DOM, storage, or ambient IO. */
(function(root){
'use strict';
const api=root.AstroNotesCandidateDiscovery||(typeof require==='function'?require('./search.js'):null);
const Composition=root.AstroNotesCandidateComposition||(typeof require==='function'?require('./composition.js'):null);
const allowedPoint=p=>p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Math.abs(p.latitude)<85&&Math.abs(p.longitude)<=180;
function requestKey(p){return JSON.stringify([p.owner,p.body,p.target,p.partId,p.limb,p.matchMode,p.profile,p.strict,p.composition,!!p.compositionInvalid,p.timeWindow,p.timeSpec||{kind:'day',at:api.day(p.at)},p.atmosphere,p.lens?.mode==='unspecified'?{mode:'unspecified'}:p.lens,p.extraTargets,
p.requireAllTargets,p.includeRoads===true,...(p.overlapMembers?[p.overlapMembers]:[]),...(p.seedBand?[{seedBand:p.seedBand.key}]:[])]);}
// 2026-11-26 trial（段階②）: 目標物が中心の地図から探す時は、逆算の種を重なる範囲（帯）の中だけにする。
// 帯は1分ごとの [目標物から見た方位（子午線の収束を直した値）, 外端までの距離km, 半幅°, 対象の横幅の半分km]。
// 対象の横幅は距離が近いほど大きく見えるので距離ごとに角度へ直し、種の半径ぶんの余裕も見る。
function inSeedBand(band,seed){
 const t=band.target,R=6371,rad=Math.PI/180,dLat=(seed.latitude-t.latitude)*rad,dLon=(seed.longitude-t.longitude)*rad,mean=(seed.latitude+t.latitude)/2*rad;
 const x=dLon*Math.cos(mean)*R,y=dLat*R,dist=Math.hypot(x,y),bearing=(Math.atan2(x,y)/rad+360)%360,pad=Math.max(.05,Math.atan2((seed.radiusM||250)/1000,Math.max(dist,.05))/rad);
 for(const [b,d,w,hw=0] of band.samples){const delta=Math.abs(((bearing-b+540)%360)-180),width=w+Math.atan(hw/Math.max(dist,.05))/rad;if(delta<=width+pad&&dist<=d+(seed.radiusM||250)/1000)return true;}
 return false;
}
function bandSeeds(inverse,band){
 if(!band||!Array.isArray(band.samples)||!inverse?.seeds)return inverse;
 const seeds=inverse.seeds.filter(seed=>inSeedBand(band,seed));
 return {...inverse,seeds,bandFiltered:inverse.seeds.length-seeds.length};
}
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
const placeKindsFor=plan=>new Set(['viewpoint','plaza','park','riverbank',...(plan.includeRoads===true?['sidewalk','road']:[])]);
function createGenericSearch({provider,evaluate,bodies,prefilter=null,maxPointsPerBatch=40,maxDeferredPoints=384,inverseOptions={},now=()=>Date.now(),yieldTask=typeof AstroNotesLibrary==='object'&&AstroNotesLibrary.pause||(()=>new Promise(r=>setTimeout(r,0)))}={}){
 const sessions=new Map();
 const fresh=(key,inverse,lastResult=null)=>({key,regions:regionsFor(inverse?.seeds),inverse,lastResult,rows:[],queue:[],pointData:new Map(),pointDomains:new Map(),visitedDomains:new Set(),timeDeferred:new Set(),seen:new Set(),seenRows:new Set(),cursor:0,started:false,
 counts:{checked:0,unknown:0,blocked:0,noOverlap:0,unverified:0,heightUnknown:0,nearBuilding:0,obstacle:0,outsideFrame:0,mapRegions:0,mapPoints:0,
 deferred:0},coverage:[],retryWork:new Map(),busy:false});
 // Rechecking the same conditions replaces only working progress. The last
 // complete result remains available when a recheck fails or is cancelled.
 function restart(plan){const key=requestKey(plan),previous=sessions.get(key);if(previous?.busy&&previous.current?.()!==false)return false;if(previous)sessions.set(key,fresh(key,previous.inverse,previous.lastResult));return true;}
 async function search(plan,{onProgress=()=>{},onFirstResult,onRows,isCurrent=()=>true,signal,more=false,retryFailed=true,deadline=Infinity,pointLimit=maxPointsPerBatch,
  shouldPause=()=>false,providerOptions={},prioritizeKnown=false,diverse=false,deferTimedOut=()=>false,deprioritizePoints=()=>()=>false,mapBudgetMs=Infinity,retryWork=null,retainFailures=false}={}){
  if(plan.compositionInvalid)throw Error('invalid-composition');
  const key=requestKey(plan),placeKinds=placeKindsFor(plan);let session=sessions.get(key);
  const kindAllowed=(row,fallback)=>{
   const kind=row.placeKind??fallback;if(placeKinds.has(kind))return true;
   if(plan.includeRoads!==true)return false;
   const source=row.sourceEvidence,evidence=source?.categoryEvidence;
   return kind==='unknown'&&source?.kind==='surveyed-viewpoint'&&!!evidence&&['research-kind','research-description','mapped-category','official-description','unclassified'].includes(evidence.basis)
    &&typeof evidence.detail==='string'&&Array.isArray(evidence.sourceUrls)&&evidence.sourceUrls.every(url=>typeof url==='string');
  };
  const wanted=()=>!signal?.aborted&&now()<deadline&&isCurrent();
  // Shared loaders may finish after this action. Stop waiting without granting
  // their late response ownership of the queue or any displayed result.
  const wait=(promise,reader=signal)=>{
   if(!reader)return promise;
   let abort;return Promise.race([promise,new Promise((_,reject)=>{abort=()=>reject(Error('candidate-cancelled'));if(reader.aborted)abort();else reader.addEventListener('abort',abort,{once:true});})])
    .finally(()=>reader.removeEventListener('abort',abort));
  };
  try{
  if(!wanted())return {cancelled:true};
  // A cancelled A job may still await shared IO when the user returns A→B→A.
  // Retire only the obsolete owner; an active same-key job still owns its queue.
  if(session?.busy&&session.current?.()===false){
   // Detach mutable progress from the obsolete owner. Completed batches and
   // the pending point/cursor survive even if its IO never acknowledges abort.
   session={...session,rows:session.rows.slice(),queue:session.queue.slice(),pointData:new Map(session.pointData),pointDomains:new Map(session.pointDomains),visitedDomains:new Set(session.visitedDomains),
    timeDeferred:new Set(session.timeDeferred),seen:new Set(session.seen),seenRows:new Set(session.seenRows),retryWork:new Map(session.retryWork),
    counts:{...session.counts},coverage:session.coverage.slice(),busy:false,current:null};sessions.set(key,session);
  }
  if(session?.busy)return {cancelled:true,reason:'busy'};
  if(!session?.inverse){
   await wait(bodies.ensure(plan.body));if(!wanted())return {cancelled:true};
   onProgress({stage:'inverse',checked:0});
   const inverse=bandSeeds(await wait(root.AstroNotesTrialOverlap?.inverse?.(plan,p=>Composition.inverseSeeds(p,{bodies,isCurrent:wanted,yieldTask,...inverseOptions}))??Composition.inverseSeeds(plan,{bodies,isCurrent:wanted,yieldTask,...inverseOptions})),plan.seedBand);
   if(!wanted())return {cancelled:true};
   session=fresh(key,inverse);
   sessions.set(key,session);while(sessions.size>4)sessions.delete(sessions.keys().next().value);
  }
  if(!more&&session.started)return {...result(session),cached:true};
  session.busy=true;session.current=wanted;let pendingPoint=null;
  try{
   const enqueue=(points,data)=>{for(const p of points){if(!allowedPoint(p)||!kindAllowed(p))continue;
    const id=[p.surfaceId||p.sourceId,p.latitude.toFixed(7),p.longitude.toFixed(7),p.surfaceHeightM??p.groundM].join(':');if(session.seen.has(id))continue;
    session.seen.add(id);session.queue.push(p);session.pointData.set(p,data);if(diverse)session.pointDomains.set(p,Composition.surfaceDomainKey(p));}};
   const visited=p=>{const domain=session.pointDomains.get(p);return domain!=null&&session.visitedDomains.has(domain);};
   const deferred=p=>session.timeDeferred.has(p);
   const hold=(id,work)=>{
    const previous=session.retryWork.get(id),attempts=(previous?.attempts||0)+1;
    session.retryWork.set(id,{...work,id,attempts,retryAt:now()+Math.min(60000,5000*2**Math.min(4,attempts-1))});
   };
   if(retryWork?.kind==='point'){
    const index=session.queue.indexOf(retryWork.point);if(index>=0)session.queue.splice(index,1);
    session.queue.unshift(retryWork.point);session.pointData.set(retryWork.point,retryWork.data);
    if(diverse)session.pointDomains.set(retryWork.point,Composition.surfaceDomainKey(retryWork.point));
   }
   // Known fixed viewpoints need no OSM page or hundreds of ground samples.
   // They still pass the same exact geometry and visibility evaluation.
   if(prioritizeKnown&&!session.surveyedChecked&&typeof provider.surveyed==='function'){
    const known=await wait(provider.surveyed(plan));if(!wanted())return {cancelled:true};
    enqueue(known,{features:[]});session.surveyedChecked=true;
   }
   // Read the current records once per scheduling decision, not once for each
   // point inspected by find/every. Priority changes never remove queued work.
   const lowerPriority=deprioritizePoints();
   const retrySource=retryWork?.kind==='source'?retryWork:null;
   const room=()=>session.queue.length+session.retryWork.size<maxDeferredPoints;
   if(retrySource||room()&&(!session.queue.length||diverse&&session.queue.every(p=>deferred(p)||visited(p)||lowerPriority(p)))&&(session.cursor!==null||!session.started)){
    // The optional map must not hold known fixed viewpoints. Compute it once,
    // just before the first ordinary provider page, within the same deadline.
    if(prefilter&&!session.mapChecked){
     const mapOwner=new AbortController(),cancelMap=()=>mapOwner.abort(),mapDeadline=Math.min(deadline,now()+mapBudgetMs);
     signal?.addEventListener('abort',cancelMap,{once:true});
     const mapTimer=Number.isFinite(mapDeadline)?setTimeout(cancelMap,Math.max(1,mapDeadline-now())):null;
     const mapCurrent=()=>wanted()&&!mapOwner.signal.aborted&&now()<mapDeadline;
     try{const f=await wait(prefilter.regions(plan,session.regions,{isCurrent:mapCurrent,signal:mapOwner.signal,deadline:mapDeadline}),mapOwner.signal);
      if(!wanted())return {cancelled:true};
      if(f&&mapCurrent()){session.counts.mapRegions=session.regions.length-f.regions.length;session.regions=f.regions;session.mapContext=f.context||null;}}
     catch(e){if(!wanted())return {cancelled:true};if(e?.message!=='candidate-cancelled')globalThis.AstroNotesErrors?.note('candidates.visibility-map',e);}
     finally{if(mapTimer!==null)clearTimeout(mapTimer);signal?.removeEventListener('abort',cancelMap);mapOwner.abort();
      // A slow optional filter must not prevent exact evaluation on every resume.
      session.mapChecked=true;}}
    onProgress({stage:'places',...session.counts});
    const cursor=retrySource?.cursor??session.cursor??0;
    const data=await wait(provider.load(plan,{...providerOptions,regions:session.regions,cursor,isCurrent:wanted,onProgress,signal,deadline,retryFailed,pointKinds:placeKinds}));
    if(!wanted()||data.cancelled)return {cancelled:true};
    const points=[...(data.points||[])];
    // Surveyed places of this target go in once, wherever the regions lie (place-provider.js surveyedViewpoints).
    if(!session.started&&!session.surveyedChecked&&typeof provider.surveyed==='function'){const known=await wait(provider.surveyed(plan));if(!wanted())return {cancelled:true};points.unshift(...known);session.surveyedChecked=true;}
    // Commit a provider page only after all awaited preparation is current.
    if(!wanted())return {cancelled:true};
    session.coverage.push(data.coverage||{});session.providerPartial=!!data.partial;
    if(!retrySource)session.cursor=data.coverage?.nextCursor??null;
    session.retryAt=data.coverage?.retryAfterMs>0?now()+data.coverage.retryAfterMs:0;
    if(retrySource){
     if(data.coverage?.failedRegions?.length)hold(retrySource.id,retrySource);
     else if(data.coverage?.nextCursor){session.retryWork.set(retrySource.id,{...retrySource,cursor:data.coverage.nextCursor});}
     else{session.retryWork.delete(retrySource.id);}
    }else if(retainFailures)for(const tile of data.coverage?.failedRegions||[]){
     const id='source:'+tile.id;
     if(!session.retryWork.has(id))hold(id,{kind:'source',cursor:{batchTiles:[{id:tile.id,bbox:tile.bbox,regionId:tile.regionId}],afterCursor:null}});
    }
    // Public places are the default; independent roads need an explicit opt-in.
    enqueue(points,data);
    const order=['viewpoint','plaza','park','riverbank','sidewalk'];session.queue.sort((a,b)=>order.indexOf(a.placeKind)-order.indexOf(b.placeKind));
    session.data=data;
   }
   session.started=true;let count=0;
   let publishFirst=onFirstResult&&!session.rows.length;
   while(session.queue.length&&count<Math.min(maxPointsPerBatch,pointLimit)){
    if(!wanted())return {cancelled:true};
    if(shouldPause())break;
    // Try one seed of each proven surface domain before revisiting the same
    // walkable surface. Keep every other seed and its own page's geometry.
    if(diverse&&!(count===0&&retryWork?.kind==='point'&&session.queue[0]===retryWork.point)){
     const lower=deprioritizePoints();
     let index=session.queue.findIndex(p=>!lower(p)&&!deferred(p)&&!visited(p));
     if(index<0&&session.cursor!==null&&room())break;
     if(index<0)index=session.queue.findIndex(p=>!lower(p)&&!deferred(p));
     if(index<0)index=session.queue.findIndex(p=>!lower(p));
     if(index<0)index=session.queue.findIndex(p=>!deferred(p));
     if(index>0)session.queue.unshift(...session.queue.splice(index,1));
    }
    const point=session.queue[0],data=session.pointData.get(point)||session.data;
    const consume=()=>{session.queue.shift();session.pointData.delete(point);session.timeDeferred.delete(point);pendingPoint=null;
     const domain=session.pointDomains.get(point);if(domain!=null)session.visitedDomains.add(domain);session.pointDomains.delete(point);};
    if(session.mapContext&&!point.surveyedTargets?.includes(plan.target?.id)&&prefilter.point(plan,point,session.mapContext)===false){
     session.retryWork.delete(point);consume();session.counts.checked++;session.counts.blocked++;session.counts.mapPoints++;continue;}
    onProgress({stage:'evaluate',...session.counts,pending:session.queue.length});
    pendingPoint=point;
    const tested=await wait(root.AstroNotesTrialOverlap?.evaluate?.(plan,p=>evaluate({...p,requestKey:key},point,data,{isCurrent:wanted,signal,deadline}))??evaluate({...plan,requestKey:key},point,data,{isCurrent:wanted,signal,deadline}));
    if(!wanted())return {cancelled:true};
    // Only this explicit, non-cached transport failure is retryable. A missing
    // model, a 404 tile or an unknown structure height is not a transport retry.
    const retryable=retainFailures&&tested.status==='unverified'&&tested.upperQuality?.layer==='terrain'&&tested.upperQuality.reason==='terrain-fetch';
    if(retryable){hold(point,{kind:'point',point,data});consume();count++;continue;}
    session.retryWork.delete(point);
    consume();count++;session.counts.checked++;
    if(tested.partial)session.counts.deferred++;
    if(tested.status==='model-blocked')session.counts.blocked++;else if(tested.status==='no-overlap')session.counts.noOverlap++;
    else if(tested.status==='unverified'){session.counts.unverified++;if(tested.heightUnknown)session.counts.heightUnknown++;if(tested.nearBuilding)session.counts.nearBuilding++;if(tested.obstacle)session.counts.obstacle++;}
    else if(tested.status==='outside-frame')session.counts.outsideFrame++;else if(!tested.recommend)session.counts.unknown++;
    const beforeRows=session.rows.length;
    for(const row of [tested,...tested.additionalCandidates||[]]){
     if(!row.recommend||!allowedPoint(row.place)||!Number.isFinite(row.event?.at))continue;
     // Solving may move a park seed onto a road. Check the solved kind too.
     if(!kindAllowed(row,point.placeKind))continue;
     const range=Composition.timeRange(plan);if(!range||row.event.at<range.start||row.event.at>range.end)continue;
     const id=row.id||[row.surfaceId,row.place.latitude,row.place.longitude,row.event.at].join(',');
     if(!session.seenRows.has(id)){session.seenRows.add(id);session.rows.push({...row,id,requestKey:key});}
    }
    if(publishFirst&&session.rows.length){
     publishFirst=false;
     // The first verified row can be selected immediately. Save its position in the
     // search before showing it, just as with the later completed batches.
     session.lastResult=result(session);
     onFirstResult(session.lastResult);
    }
    if(onRows&&session.rows.length>beforeRows){session.lastResult=result(session);onRows(session.lastResult);}
    await yieldTask();
   }
   session.lastResult=result(session);return session.lastResult;
  }finally{
   // A slow location must not starve every other location on each Continue.
   // Retain its exact source data and retry it after untried work; cancellation
   // by the user keeps the original pending position instead.
   if(pendingPoint&&deferTimedOut()){
    const index=session.queue.indexOf(pendingPoint);
    if(index>=0){session.queue.push(...session.queue.splice(index,1));session.timeDeferred.add(pendingPoint);}
   }
   session.busy=false;
  }
  }catch(error){if(!wanted())return {cancelled:true};throw error;}
 }
 // Yield between batches. The normal search ends at the place quota, source
 // exhaustion or a recoverable stall. Callers may opt into a diagnostic deadline.
 async function searchRecommended(plan,{hardBudgetMs=Infinity,mapBudgetMs=2000,targetPlaces=10,maxEvaluations=Infinity,countPlaces=rows=>rows.length,onPage=()=>{},onBatchStart=()=>{},...options}={}){
  if(plan.compositionInvalid)throw Error('invalid-composition');
  const key=requestKey(plan),active=sessions.get(key);
  if(active?.busy&&active.current?.()!==false)return {cancelled:true,reason:'busy'};
  const started=now(),deadline=started+Math.max(1,hardBudgetMs),own=new AbortController();
  const external=()=>!options.signal?.aborted&&(options.isCurrent?.()??true);
  const cancel=()=>own.abort();options.signal?.addEventListener('abort',cancel,{once:true});
  if(options.signal?.aborted)cancel();const timer=Number.isFinite(deadline)?setTimeout(cancel,deadline-started):null;
  let page,more=!!options.more,places=countPlaces(active?.rows||[]),reason=null;
  const initialChecked=active?.counts.checked||0,cursors=new Set();
  // Retry only failures present when the user started this action. A failed
  // request cannot recursively schedule itself throughout the foreground job.
  const retries=new Set(more?active?.retryWork.keys():[]);
  const publish=p=>{page=p;places=countPlaces(p.rows);onPage(p,places);};
  // Continue means more new choices, not an immediate stop at the old quota.
  const goal=places+targetPlaces;
  try{
   while(external()&&!own.signal.aborted&&now()<deadline){
    const session=sessions.get(key),checked=(session?.counts.checked||0)-initialChecked;
    if(checked>=maxEvaluations){reason='point-budget';break;}
    const room=!session||session.queue.length+session.retryWork.size<maxDeferredPoints;
    const work=session?[...session.retryWork.values()]:[],sourceFits=room||!session.queue.length&&!work.some(item=>item.kind==='point');
    const retryWork=work.find(item=>retries.has(item.id)&&item.retryAt<=now()&&(item.kind==='point'||sourceFits));
    if(session?.started&&!session.queue.length&&!retryWork){
     if(session.retryAt>now()||session.retryWork.size&&(!room||session.cursor===null)){reason='source-wait';break;}
    }
    onBatchStart();
    const next=await search(plan,{...options,signal:own.signal,deadline,more,retryFailed:false,retryWork,retainFailures:true,onRows:publish,prioritizeKnown:true,diverse:true,mapBudgetMs,
     deferTimedOut:()=>external()&&(own.signal.aborted||now()>=deadline),
     pointLimit:Math.min(maxPointsPerBatch,maxEvaluations-checked),shouldPause:()=>places>=goal||(sessions.get(key)?.counts.checked||0)-initialChecked>=maxEvaluations,
     providerOptions:{maxTiles:2,maxPoints:48}});
    if(!external())return {cancelled:true};
    if(next.cancelled){if(next.reason==='busy')return next;break;}
    if(retryWork){const retained=sessions.get(key)?.retryWork.get(retryWork.id);if(!retained||retained.attempts!==retryWork.attempts)retries.delete(retryWork.id);}
    page=next;places=countPlaces(page.rows);
    if(!page.canContinue)return page;
    if(places>=goal){reason='enough-places';break;}
    onPage(page,places);
    // Cooling sources resume on a later user action; never wait a minute here.
    if(!page.coverage.pendingPoints&&page.retryAt>now()){reason='source-wait';break;}
    const retryProgress=[...sessions.get(key).retryWork.values()].map(work=>[work.kind,work.attempts,work.cursor]);
    const cursor=JSON.stringify([page.coverage.nextCursor,page.counts.checked,retryProgress]);
    if(cursors.has(cursor)){reason='source-stalled';break;}cursors.add(cursor);
    more=true;await yieldTask();
   }
  }catch(error){if(external()&&!own.signal.aborted&&now()<deadline)throw error;}
  finally{if(timer!==null)clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);own.abort();}
  if(!external())return {cancelled:true};
  let session=sessions.get(key);if(!session){session=fresh(key,null);sessions.set(key,session);while(sessions.size>4)sessions.delete(sessions.keys().next().value);}
  page=result(session);if(session.started&&!page.canContinue)return page;
  const paused={...page,paused:true,pauseReason:reason||'time-budget',stalled:reason==='source-stalled',jobStatus:'paused',canContinue:true,elapsedMs:Math.max(0,now()-started)};
  session.lastResult=paused;
  return paused;
 }
 // Drain scheduled pages and point batches as one cancellable foreground search.
 // onPage(page): each finished page with every row found so far, so a long search can show its rows as it goes.
 async function searchAll(plan,{onBatchStart=()=>{},onPage=()=>{},...options}={}){
  const wanted=()=>!options.signal?.aborted&&(options.isCurrent?.()??true);
  const cursors=new Set();let more=!!options.more,waits=0;
  while(wanted()){
   onBatchStart();
   const page=await search(plan,{...options,more,retryFailed:false,onFirstResult:onPage});
   if(!wanted()||page.cancelled)return {cancelled:true};
   if(!page.canContinue)return page;
   onPage(page);
   // The place source asked to wait (Overpass cooling down): wait, then fetch the regions it left. Three waits at most;
   // a busier Overpass ends the search with its regions reported as not fetched.
   const waitMs=(page.retryAt||0)-Date.now();
   if(!page.coverage.pendingPoints&&waitMs>0&&waits<3){waits++;options.onProgress?.({stage:'places-wait',waitMs,...page.counts});for(const end=Date.now()+waitMs+250;Date.now()<end;){if(!wanted())return {cancelled:true};await new Promise(r=>setTimeout(r,Math.min(250,end-Date.now())));}more=true;
   continue;}
   if(!page.coverage.pendingPoints){
    const cursor=JSON.stringify(page.coverage.nextCursor);
    if(cursors.has(cursor)){const stalled={...page,stalled:true};sessions.get(page.requestKey).lastResult=stalled;return stalled;}
    cursors.add(cursor);
   }
   more=true;await yieldTask();
  }
  return {cancelled:true};
 }
 function result(s){
  const retry=[...s.retryWork.values()],sourceFits=s.queue.length+retry.length<maxDeferredPoints||!s.queue.length&&!retry.some(work=>work.kind==='point');
  const eligible=retry.filter(work=>work.kind==='point'||sourceFits),retryAt=eligible.length?Math.min(...eligible.map(work=>work.retryAt)):0;
  const waitsForRetry=!s.queue.length&&(s.cursor===null||s.retryWork.size>=maxDeferredPoints);
  return {rows:s.rows.slice(),counts:{...s.counts},retryAt:Math.max(s.retryAt||0,waitsForRetry?retryAt:0),requestKey:s.key,cached:false,limited:true,coverageStatus:'partial',jobStatus:'complete',
   canContinue:s.queue.length>0||s.cursor!==null||retry.length>0,coverage:{regions:s.regions.length,loaded:s.coverage,pendingPoints:s.queue.length,timeDeferredPoints:s.timeDeferred.size,
   retryPending:retry.length,retryPoints:retry.filter(work=>work.kind==='point').length,retrySources:retry.filter(work=>work.kind==='source').length,
   nextCursor:s.cursor,approximateInverse:true},dataVersion:'generic-v1'};
 }
 return {search,searchAll,searchRecommended,restart,cached:plan=>{const s=sessions.get(requestKey(plan));return s?.lastResult?{...s.lastResult,rows:s.lastResult.rows.slice(),cached:true}:null;},clear:()=>sessions.clear(),
  // A result kept across a page reload (iOS drops a backgrounded page). It only answers cached(); continuing searches afresh.
  prime:(plan,saved)=>{const key=requestKey(plan);if(!saved||!Array.isArray(saved.rows)||saved.requestKey!==key||sessions.get(key)?.lastResult)return false;
   sessions.set(key,{key,lastResult:{...saved,rows:saved.rows.slice(),cached:false}});while(sessions.size>4)sessions.delete(sessions.keys().next().value);return true;}};
}
api.requestKey=requestKey;api.regionsFor=regionsFor;api.createGenericSearch=createGenericSearch;
if(typeof module==='object'&&module.exports)module.exports={requestKey,regionsFor,createGenericSearch,bandSeeds};
})(globalThis);
