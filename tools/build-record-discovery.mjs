// Trial-only registered-place discovery, reusing the existing observer solver.
export const recordDiscoverySource=String.raw`
let discoveryTab='records',recordPane=null,newPlacePane=null,recordTabs=null,recordSeq=0,recordState={key:'',status:'idle'},recordOwner='',recordTimer=null;
const recordCache=new Map(),recordJobs=new Map();let recordCalendarArgs=null,recordMemo=null,recordDataEpoch=0,recordCalendarSeq=0;
const recordDiscoveryActive=()=>mainSearchActive()&&!document.hidden&&discoveryTab==='records';
function recordRequest(at){
 const selected=SkyMapUI.selectionState(),api=globalThis.MyPlacesUI;
 if(!selected?.target||!Number.isFinite(selected.at)||!api?.discoveryPoints||!toolAllowed('records'))return null;
 const revision=api.discoveryRevision(),owner=auth?.loginId;
 if(!recordMemo||recordMemo.revision!==revision||recordMemo.owner!==owner)recordMemo={owner,revision,epoch:++recordDataEpoch,points:api.discoveryPoints()};
 const overlap=globalThis.AstroNotesTrialOverlap?.searchPlan?.(selected),points=recordMemo.points,plan={...AstroNotesShooting.conditions(selected),observer:null,at:AstroNotesShooting.day(at??selected.at),...(overlap?{overlapMembers:overlap.overlapMembers}:{})};
 const condition=JSON.stringify([plan.target,plan.body,plan.partId,plan.limb,plan.matchMode,globalThis.AstroNotesTrialOverlap?.key?.(selected)??null]),identity=JSON.stringify([owner,accessState.generation,recordMemo.epoch,condition]);
 return {plan,points,condition,owner,generation:accessState.generation,revision,epoch:recordMemo.epoch,atmosphere:AstroNotesAtmosphere.dataKey(plan.at),identity,key:identity+'|'+plan.at+'|'+AstroNotesAtmosphere.dataKey(plan.at)};
}
function recordCurrent(request,extra=()=>true){
 const s=AstroNotesShooting.conditions(SkyMapUI.selectionState());return active()&&toolAllowed('records')&&flowOwner===request.owner&&auth?.loginId===request.owner&&flowGeneration===request.generation&&accessState.generation===request.generation&&recordMemo?.epoch===request.epoch&&MyPlacesUI.discoveryRevision()===request.revision&&AstroNotesAtmosphere.dataKey(request.plan.at)===request.atmosphere&&extra()&&JSON.stringify([s?.target,s?.body,s?.partId,s?.limb,s?.matchMode,globalThis.AstroNotesTrialOverlap?.key?.(SkyMapUI.selectionState())??null])===request.condition;
}
const recordWorkCount=request=>request.points.length*Math.max(1,request.plan.overlapMembers?.length||1);
async function recordRows(request,current,progress=()=>{}){
 if(recordCache.has(request.key))return recordCache.get(request.key);
 let job=recordJobs.get(request.key);
 // A hidden/obsolete caller can still be awaiting suspended work. Do not
 // attach the foreground search to it; completed per-place values stay cached.
 if(job&&![...job.watchers].some(w=>w.current()))job=null;
 if(!job){
  job={watchers:new Set(),checked:0};recordJobs.set(request.key,job);
  const live=()=>recordJobs.get(request.key)===job&&[...job.watchers].some(w=>w.current()),total=recordWorkCount(request);
  const publish=n=>{if(!live())return;job.checked=Math.max(job.checked,n);for(const w of job.watchers)if(w.current())w.progress(job.checked,total);};
  job.promise=Promise.resolve().then(()=>{
   let batch=0;
   const run=p=>{const offset=batch++*request.points.length;return MyPlacesUI.discoverySearch(p,request.points,live,undefined,step=>publish(offset+step.checked));};
   return globalThis.AstroNotesTrialOverlap?.discovery?.(request.plan,run)??run(request.plan);
  }).then(result=>{if(live()&&!result.cancelled&&!result.failed){recordCache.set(request.key,result);if(recordCache.size>96)recordCache.delete(recordCache.keys().next().value);}return result;}).finally(()=>{if(recordJobs.get(request.key)===job)recordJobs.delete(request.key);});
 }
 const watcher={current,progress};job.watchers.add(watcher);if(current()&&job.checked)progress(job.checked,recordWorkCount(request));
 try{const result=await job.promise;if(result.cancelled&&current())return recordRows(request,current,progress);return result;}finally{job.watchers.delete(watcher);}
}

function chooseDiscovery(tab,focus=false){
 discoveryTab=tab==='new'?'new':'records';
 if(!recordPane)return;
 for(const [name,pane]of [['records',recordPane],['new',newPlacePane]]){const button=$('exploreDiscovery-'+name),on=discoveryTab===name;button.setAttribute('aria-selected',String(on));button.tabIndex=on?0:-1;if(pane.hidden===on)pane.hidden=!on;if(on&&focus)button.focus();}
 syncRecordDiscovery();document.dispatchEvent(new Event('astronotes-search-state'));
}
function ensureRecordDiscovery(){
 const parent=$('candidateWorkspaceAction');if(!parent)return;
 if(!recordPane){
  recordTabs=node('div',{className:'explore-discovery-tabs'});recordTabs.setAttribute('role','tablist');recordTabs.setAttribute('aria-label','撮影地点の検索範囲');
  recordPane=node('section',{id:'exploreRecordedPlaces'});recordPane.setAttribute('aria-live','polite');newPlacePane=node('section',{id:'exploreNewPlaces'});
  for(const [name,pane,label]of [['records',recordPane,'記録の撮影地点'],['new',newPlacePane,'新しい地点']]){
   const button=node('button',{id:'exploreDiscovery-'+name,type:'button'},label);button.setAttribute('role','tab');button.setAttribute('aria-controls',pane.id);pane.setAttribute('role','tabpanel');pane.setAttribute('aria-labelledby',button.id);button.onclick=()=>chooseDiscovery(name);recordTabs.append(button);
  }
  recordTabs.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();chooseDiscovery(e.key==='Home'?'records':e.key==='End'?'new':discoveryTab==='records'?'new':'records',true);};
 }
 if(recordTabs.parentNode!==parent)parent.append(recordTabs,recordPane,newPlacePane);
 if(searchRoot&&searchRoot.parentNode!==newPlacePane)newPlacePane.append(searchRoot);
 const additional=$('additionalCandidateSearch');if(additional&&newPlacePane.firstElementChild!==additional)newPlacePane.prepend(additional);
 chooseDiscoveryQuiet();
}
function chooseDiscoveryQuiet(){for(const [name,pane]of [['records',recordPane],['new',newPlacePane]]){if(!pane)continue;const button=$('exploreDiscovery-'+name),on=discoveryTab===name;button.setAttribute('aria-selected',String(on));button.tabIndex=on?0:-1;if(pane.hidden===on)pane.hidden=!on;}}
function renderRecordRows(request,result){
 recordPane.replaceChildren();const rows=result.rows||[];
 const list=node('div',{id:'exploreRecordedResults'});recordPane.append(list);
 for(const row of rows){
  const b=node('button',{type:'button',className:'explore-record-row'}),name=node('strong',{},row.place.name),time=node('span',{className:'explore-record-time'},new Date(row.event.at+32400000).toISOString().slice(11,16)),sub=node('span',{className:'tiny'}),arrow=node('span',{className:'explore-record-arrow'},'›');arrow.setAttribute('aria-hidden','true');
  if(row.heightSearch||rows.some(other=>(other.place.sourcePlaceId??other.place.id)===(row.place.sourcePlaceId??row.place.id)&&(other.assumedObserver?.eyeM??other.place.standAglM)!==(row.assumedObserver?.eyeM??row.place.standAglM)))sub.textContent='地上'+(row.assumedObserver?.eyeM??row.place.standAglM??row.place.eyeHeightAGL)+'m';b.append(name,time,arrow);if(sub.textContent){b.classList.add('has-height');b.append(sub);}b.onclick=()=>{if(!mainSearchActive()||recordState.key!==request.key||!recordCurrent(request)||!mainCandidateWorkspace.selectable()){syncRecordDiscovery();return;}const s=SkyMapUI.selectionState(),expected=JSON.stringify([s.body,s.target,s.partId,s.limb,AstroNotesShooting.day(s.at),s.matchMode||'limb']);SkyMapUI.selectCandidate(row,expected);};list.append(b);
 }
 if(!rows.length&&!result.failed){const p=node('p',{className:'tiny'},request.points.length?'この日に重なる記録の撮影地点はありません':'記録の撮影地点がありません');recordPane.append(p);if(!request.points.length){const link=node('a',{href:'#/records',className:'chip'},'記録を開く');recordPane.append(link);}}
 if(result.failed){const p=node('p',{className:'tiny'},rows.length?'確認できなかった地点があります':'記録の撮影地点を確認できませんでした');p.setAttribute('role','status');const retry=node('button',{type:'button',className:'chip'},'再試行');retry.onclick=()=>{recordCache.delete(request.key);recordState.key='';syncRecordDiscovery();};recordPane.append(p,retry);}
}
function stopRecordLoading(){
 if(recordState.status!=='loading')return;
 recordSeq++;recordState={key:'',status:'idle'};if(recordTimer!==null)clearTimeout(recordTimer);recordTimer=null;recordPane?.replaceChildren();recordPane?.setAttribute('aria-busy','false');
}
function syncRecordDiscovery(){
 if(!mainSearchActive()||document.hidden){stopRecordLoading();return;}
 ensureRecordDiscovery();if(!recordPane)return;
 const owner=JSON.stringify([auth?.loginId,accessState.generation]);if(recordOwner!==owner){recordOwner=owner;recordCache.clear();recordMemo=null;recordState={key:'',status:'idle'};discoveryTab='records';chooseDiscoveryQuiet();}
 if(!recordDiscoveryActive()){stopRecordLoading();return;}
 if(!toolAllowed('records')){recordSeq++;recordState={key:'denied',status:'idle'};recordPane.setAttribute('aria-busy','false');recordPane.replaceChildren(node('p',{className:'tiny'},'記録の利用権限を確認してください'));return;}
 const request=recordRequest();if(!request){if(recordState.key!=='missing'){recordSeq++;recordState={key:'missing',status:'idle'};recordPane.setAttribute('aria-busy','false');recordPane.replaceChildren(node('p',{className:'tiny'},'天体と対象を選んでください'));}return;}
 if(recordState.key===request.key)return;
 if(recordTimer!==null)clearTimeout(recordTimer);
 recordTimer=null;
 const seq=++recordSeq,cached=recordCache.get(request.key);
 if(!request.points.length){recordState={key:request.key,status:'complete'};recordPane.setAttribute('aria-busy','false');renderRecordRows(request,{rows:[],failed:0});return;}
 if(cached&&recordCurrent(request)){recordState={key:request.key,status:'complete'};recordPane.setAttribute('aria-busy','false');renderRecordRows(request,cached);return;}
 recordState={key:request.key,status:'loading'};recordPane.setAttribute('aria-busy','true');
 const progress=MyPlacesUI.recordProgress?.(recordPane,'記録の撮影地点を確認中');
 if(progress)progress.update(0,recordWorkCount(request));else recordPane.replaceChildren(node('p',{className:'tiny'},'記録の撮影地点を確認中…'));
 recordTimer=setTimeout(async()=>{
  recordTimer=null;const current=()=>seq===recordSeq&&recordDiscoveryActive()&&AstroNotesShooting.day(SkyMapUI.selectionState()?.at)===request.plan.at&&recordCurrent(request);
  try{const result=await recordRows(request,current,(n,total)=>progress?.update(n,total));if(!current()||result.cancelled)return;recordState.status='complete';renderRecordRows(request,result);}
  catch{if(current()){recordState.status='error';recordPane.replaceChildren(node('p',{className:'tiny'},'記録の撮影地点を確認できませんでした'));const retry=node('button',{type:'button',className:'chip'},'再試行');retry.onclick=()=>{recordState.key='';syncRecordDiscovery();};recordPane.append(retry);}}
  finally{if(seq===recordSeq){recordPane.setAttribute('aria-busy','false');if(recordState.status==='loading'){recordState={key:'',status:'idle'};if(recordDiscoveryActive())queueMicrotask(syncRecordDiscovery);}}}
 },180);
}
async function recordCalendar(args,scanMonth=false){
 const calendarSeq=++recordCalendarSeq;recordCalendarArgs=args;const {year,month,grid,status,draw,pickDay,isCurrent}=args,request=recordRequest();
 if(!toolAllowed('records')){status.textContent='記録の利用権限を確認してください';grid.setAttribute('aria-busy','false');return;}
 if(!request){status.textContent='天体と対象を選んでください';grid.setAttribute('aria-busy','false');return;}
 if(!request.points.length){draw(new Map());status.textContent='記録の撮影地点がありません';grid.setAttribute('aria-busy','false');return;}
 const current=()=>calendarSeq===recordCalendarSeq&&isCurrent()&&mainSearchActive()&&!document.hidden&&recordCurrent(request);
 if(!scanMonth){
  grid.setAttribute('aria-busy','false');
  const scan=node('button',{type:'button',className:'chip record-calendar-scan'},'この月を確認');scan.onclick=()=>{if(current())void recordCalendar(args,true);};status.replaceChildren(scan);
  return;
 }
 const progress=MyPlacesUI.recordProgress?.(status,'この月を確認中','日');
 if(!progress)status.textContent='記録の撮影地点・重なる日を確認中…';grid.setAttribute('aria-busy','true');
 try{
  const events=new Map(),days=[];let failed=0;
  for(let at=Date.UTC(year,month,1)-32400000,end=Date.UTC(year,month+1,1)-32400000;at<end;at+=86400000)days.push(at);
  if(days.includes(request.plan.at)){days.splice(days.indexOf(request.plan.at),1);days.unshift(request.plan.at);}
  progress?.update(0,days.length);
  for(const [i,at] of days.entries()){
   if(!current())return;const dayRequest=recordRequest(at),result=await recordRows(dayRequest,current);if(!current()||result.cancelled)return;
   failed+=result.failed||0;if(result.rows.length)events.set(at,result.rows.map(r=>({...r.event,selectedMatch:true,intersects:true})));
   progress?.update(i+1,days.length);
  }
  if(!current())return;draw(events);
  for(const b of grid.querySelectorAll('[data-cal-day]'))b.onclick=()=>{if(!current())return;chooseDiscovery('records');pickDay(+b.dataset.calDay);};
  status.textContent='記録の撮影地点・'+(events.size?'重なる日 '+events.size+'日':request.points.length?'この月は重なる日がありません':'記録の撮影地点がありません')+(failed?'・確認できなかった地点があります':'');
 }catch{if(current()){status.textContent='記録の撮影地点を確認できませんでした。';const retry=node('button',{type:'button',className:'chip record-calendar-scan'},'再試行');retry.onclick=()=>{if(current())void recordCalendar(args,true);};status.append(retry);}}
 finally{if(calendarSeq===recordCalendarSeq){if(current())grid.setAttribute('aria-busy','false');else if(isCurrent()&&mainSearchActive()){if(toolAllowed('records')&&recordRequest()?.key!==request.key)setTimeout(()=>{if(calendarSeq===recordCalendarSeq&&isCurrent()&&mainSearchActive())args.restart();},0);else{status.textContent=toolAllowed('records')?'条件を確認して月を選び直してください':'記録の利用権限を確認してください';grid.setAttribute('aria-busy','false');}}}}
}
`;
export const recordDiscoveryStyle=String.raw`
#skyMapView[data-explore-stage="search"] #candidateWorkspaceAction{display:block}
.explore-discovery-tabs{display:flex;gap:24px;border-bottom:1px solid var(--line);margin:12px 0 16px}
.explore-discovery-tabs button{min-height:44px;padding:8px 2px;border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;color:var(--secondary);font-size:.85rem;font-weight:600}
.explore-discovery-tabs button[aria-selected="true"]{color:var(--accent);border-bottom-color:var(--accent)}
#exploreNewPlaces:not([hidden]){display:grid;gap:12px}
.record-calendar-scan{min-height:44px}
#exploreRecordedPlaces[hidden],#exploreNewPlaces[hidden]{display:none!important}
.explore-record-row{display:grid;grid-template-columns:minmax(0,1fr) auto 14px;gap:4px 12px;align-items:center;text-align:left;width:100%;min-height:64px;border:0;border-bottom:1px solid var(--line);border-radius:0;padding:12px 0;background:transparent;color:var(--text)}
.explore-record-row strong{grid-column:1;grid-row:1/3;font-size:.9rem;overflow-wrap:anywhere}
.explore-record-row.has-height{min-height:76px}.explore-record-row.has-height strong{grid-row:1}
.explore-record-row .tiny{grid-column:1;grid-row:2;color:var(--secondary)}
.explore-record-time{grid-column:2;grid-row:1/3;color:var(--accent);font-size:1rem;font-variant-numeric:tabular-nums;white-space:nowrap}
.explore-record-arrow{grid-column:3;grid-row:1/3;color:var(--secondary)}
`;
export const registeredDiscoveryMethods=String.raw`
function discoveryPoints(){
 if(!auth?.token||!toolAllowed('records'))return [];
 const {groups,shapes}=recordSearchIndex(),out=[],seen=new Map();
 for(const f of favorites){
  const shape=recordSearchShape(f,shapes),saved=shape?{...f,shape}:f;
  const live=[...(groups.get(f.id)?.values()||[])].flatMap(source=>{const group=source.slice().sort((a,b)=>Number(!!b.registration)-Number(!!a.registration)||when(b)-when(a)||b.updatedAt-a.updatedAt);return group[0]?.removed?[]:group.filter(r=>!r.removed);});
  for(const r of (f.eyeHeightRangeAGL!=null?live.slice(0,1):live)){
   const o=f.eyeHeightRangeAGL!=null?f:r.observer||f,p={...saved,latitude:o.latitude,longitude:o.longitude,elevation:o.elevation??f.elevation,groundManualM:o.elevation??f.groundManualM??f.elevation,eyeHeightAGL:o.eyeHeightAGL??f.eyeHeightAGL};
   // Keep the actual recorded eye height, even if the current picker uses another floor.
   if(Number.isFinite(o.eyeHeightAGL)){p.standAglM=o.eyeHeightAGL;p.stand='ground';}
   const key=p.shape?JSON.stringify([f.id,p.eyeHeightAGL,p.eyeHeightRangeAGL,p.shape]):JSON.stringify([p.latitude,p.longitude,p.groundManualM,p.eyeHeightAGL,p.eyeHeightRangeAGL]);if(seen.has(key)){seen.get(key).place.discoveryRecordIds.push(r.id);continue;}p.discoveryKey=key;p.discoveryRecordIds=[r.id];const entry={place:p,record:r};seen.set(key,entry);out.push(entry);
  }
  if(shape&&!live.length){const p={...saved},key=JSON.stringify([p.latitude,p.longitude,p.elevation,p.eyeHeightAGL,p.shape]);if(!seen.has(key)){p.discoveryKey=key;p.discoveryRecordIds=[];const entry={place:p,record:{result:'seen'}};seen.set(key,entry);out.push(entry);}}
 }
 return out;
}
function discoveryRevision(){return version;}
async function discoverySearch(plan,points,isCurrent,terrainCache,onProgress){
 if(!terrainCache){const value=await recordEngineDiscover(plan,points,isCurrent,onProgress);if(value)return value;}
 return recordSearch(plan,points,{isCurrent,terrainCache,onProgress});
}
`;
