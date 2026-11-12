import {esc} from '../../ui/presentation-helpers.js';
import {SkyMapUI,store,viewState} from '../../app/browser-state.js';
import {lightTimingText,moonGlyphAt} from '../forecast/view.js';
import {routeFromHash} from '../../app/navigation.js';
import {aim,aimSceneExtraTargets,aimWithHeights} from '../framing/controller.js';
import {aimSavedFrom} from '../framing/observer.js';
import {aimLens} from '../framing/scene/lens.js';
import {aimLookRender} from '../framing/scene/render.js';
import {aimAirEnsure,aimAirSettings,clearAimAirCompare,openAim,renderAimAccess} from '../framing/reverse-and-entry.js';
import {accessState,auth,screenAllowed,toolAllowed} from '../account/session-and-access.js';
/* 探す: one map-owned plan, two result panes (scene / map). */
(()=>{
'use strict';
const $=id=>document.getElementById(id),mapView=$('skyMapView'),aimView=$('aimView'),look=$('aimLook');
let mode='scene',scheduled=false,forceNext=false,routing=false,intent=false,transferMode=null;
const eligible=()=>screenAllowed('skymap')&&screenAllowed('framing');
const ownsScene=()=>layout.mounted&&viewState.skyMap&&!mapView.hidden&&eligible();
const active=()=>ownsScene()&&!document.hidden;
const node=(tag,props={},text)=>{const n=document.createElement(tag);Object.assign(n,props);if(text)n.textContent=text;return n;};
const tabs=node('div',{id:'exploreTabs',className:'forecast-tabs explore-tabs'});tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','探す結果の表示');
const sceneTab=node('button',{id:'exploreSceneTab',type:'button'},'見え方'),mapTab=node('button',{id:'exploreMapTab',type:'button'},'地図');
const scene=node('section',{id:'exploreScenePanel'}),map=node('section',{id:'exploreMapPanel'}),status=node('p',{className:'tiny',id:'exploreSceneStatus'});
for(const [tab,pane] of [[sceneTab,scene],[mapTab,map]]){tab.setAttribute('role','tab');tab.setAttribute('aria-controls',pane.id);pane.setAttribute('role','tabpanel');pane.setAttribute('aria-labelledby',tab.id);tabs.append(tab);}
status.setAttribute('role','status');const retry=node('button',{type:'button',className:'chip',hidden:true},'再試行');retry.onclick=()=>sync(true);scene.append(status,retry);
const skyInfo=node('p',{id:'exploreSkyInfo',className:'tiny explore-sky-info',hidden:true});let skyInfoKey='';
function updateSkyInfo(s){
 if(!s?.observer||!Number.isFinite(s.at)){skyInfoKey='';skyInfo.hidden=true;skyInfo.textContent='';return;}
 const o={latitude:s.observer.latitude,longitude:s.observer.longitude,elevation:(s.ground??s.observer.groundManualM??0)+(s.eyeM??1.5)},key=JSON.stringify([s.body,Math.floor(s.at/60000),o]);if(key===skyInfoKey)return;skyInfoKey=key;
 try{let text='';if(s.body==='moon'){const moon=AstroNotesAstro.moon(s.at,o);text=moonGlyphAt(s.at,o)+' 輝面 '+Math.round(moon.illuminatedFraction*100)+'% ・ '+esc(lightTimingText(s.at,o));
 }else if(!AstroNotesBodies.definition(s.body).limbs){text=esc(AstroNotesBodies.sky(AstroNotesAstro.sun(s.at,o).geometricAltitude));}skyInfo.innerHTML=text;skyInfo.hidden=!text;}catch{skyInfoKey='';skyInfo.hidden=true;skyInfo.textContent='';}
}
const plan=AstroNotesPlanningSession.create({readRenderState:()=>SkyMapUI.renderState(),clone:v=>structuredClone(v),getAuthGeneration:()=>accessState.generation,dayStart:at=>AstroNotesSkyMap.dayStart(at),getAirMode:()=>aimAirSettings.mode,getAtmosphereKey:()=>AstroNotesAtmosphere.dataKey?.(),
 onInvalidate:(keepScene=false)=>{if(!keepScene)look._lookSeq=(look._lookSeq||0)+1;look._planKey=null;if(look._captionTimer){clearTimeout(look._captionTimer);look._captionTimer=0;}}});
const stamp=plan.stamp,baseStamp=plan.baseStamp,snapshot=plan.snapshot,invalidate=plan.invalidate;
// 候補ピンの切替は地図だけに効くので、地図の下（共有の行）へ置く（2026-10-22 ユーザー「候補ピンは下に下ろしてほしい」）
function placePins(){const row=$('skyMapShareRow'),all=[...document.querySelectorAll('#shootingPins')],t=all.find(x=>x.parentNode!==row)||all[0];if(!t)return;for(const x of all)if(x!==t)x.remove();if(layout.mounted){if(row&&t.parentNode!==row)row.prepend(t);
}else{const head=$('mySkyPlaces')?.querySelector('.my-head');if(head&&t.parentNode!==head)head.append(t);}}
new MutationObserver(()=>{if(layout.mounted)placePins();}).observe(mapView,{childList:true,subtree:true});
function conditionText(s){
 const body=AstroNotesBodies.definition(s?.body)?.name||'天体を選ぶ',target=s?.target?.name||'対象を選ぶ',extras=s?.target?aimSceneExtraTargets(s.target.id).length:0;
 const part=s?.target?.parts?.find(p=>p.id===s.partId)||s?.target?.parts?.[0];
 const alignment=s?.matchMode==='overlap'?'全体に重なる':s?.partId==='__whole'?(s.target?.wholeLabel||'建物全体に重なる'):`${part?.name||'対象'}・${AstroNotesAlign.limbById(s?.limb||'center').name}`;
 const height=s?.observer?$('skyMapObserverSummary')?.textContent?.trim().replace(/^高さ\s*[:：]?\s*/,''):'';
 return {title:body+' × '+target+(extras?'ほか'+extras+'件':''),
 detail:(s?.observer?.name||'撮影地点を選ぶ')+(height?' · '+height:'')+(s?.target?' · '+(s.candidateOpportunity?.at===s.at&&s.candidateOpportunity?.targetId===s.target?.id&&s.candidateOpportunity?.relation==='near'?'候補の時刻':globalThis.AstroNotesTrialOverlap?.label?.(s)||
 globalThis.AstroNotesTrialComposition?.label?.(s)||alignment):'')};
}
function updateConditions(){
 if(!layout.mounted||!layout.conditions)return;const s=SkyMapUI.selectionState(),text=conditionText(s);
 for(const [id,value] of [['exploreConditionTitle',text.title],['exploreConditionDetail',text.detail]])if($(id).textContent!==value)$(id).textContent=value;
 syncWorkspace();const confirm=$('exploreShowResult');confirm.disabled=false;
 if(!confirm.firstElementChild)confirm.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg><span>検索</span>';
 const actionLabel=!s?.target?'検索：対象を選ぶ':!s?.observer?'検索：撮影地点を選ぶ':'この撮影条件で検索';if(confirm.getAttribute('aria-label')!==actionLabel)confirm.setAttribute('aria-label',actionLabel);
 for(const b of mapView.querySelectorAll('[data-quick-save]')){b.hidden=false;b.disabled=b.dataset.planSource==='skymap'?!!$('skyMapShareRow').querySelector('[data-plan-action="share"]')?.disabled:!!plan.pendingKey||!plan.frameKey||look.hidden;}
}
function showResult(){
 if(!layout.mounted)return;const selected=SkyMapUI.selectionState();if(!selected?.target){$('skyMapTargetOpen').click();return;}if(!selected?.observer){$('skyMapChoose').click();return;}enterResult();layout.conditions.open=false;
 scene.tabIndex=-1;scene.focus({preventScroll:true});scene.style.scrollMarginTop=(layout.conditions.getBoundingClientRect().height+12)+'px';scene.scrollIntoView({block:'start',behavior:'auto'});if(mode==='scene')sync();
}
function addSaveAction(row,source){
 if(!row||row.querySelector('[data-quick-save]'))return;
 const point=node('button',{type:'button',className:'plan-trigger explore-save'});point.setAttribute('aria-label','撮影地点に保存');point.title='撮影地点に保存';point.dataset.quickSave='place';point.dataset.planSource=source;
 point.innerHTML=('<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 10c0 5-6 11-6 11S3 15 3 10a6 6 0 1 1 12 0Z"/><circle cx="9" cy="10" r="2.5"/>'+
 '<path data-place-add d="M19 3v6m-3-3h6"/></svg>');
 row.append(point);
 const b=node('button',{type:'button',className:'plan-trigger explore-save'});b.setAttribute('aria-label','予定に追加');b.title='予定に追加';
 b.innerHTML='<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6M7 2v4M17 2v4M3 9h18M18 14v8M14 18h8"/></svg>';
 b.dataset.quickSave='plan';b.dataset.planSource=source;row.append(b);updateConditions();
}
function canFrame(s){return eligible()&&AstroNotesAccess.canFrame(toolAllowed,s.target.id,s.body);}
function menu(){
 const combined=eligible(),f=$('framingMenu'),m=$('mapMenu');
 if(combined){f.hidden=true;m.hidden=false;m.dataset.tool='#/explore';m.querySelector('b').lastChild.textContent='探す';m.querySelector('span').textContent='条件を選び、見え方と地図で確かめる';}
 else{f.dataset.tool='#/aim/tower';m.dataset.tool='#/skymap';m.querySelector('b').lastChild.textContent='探す';m.querySelector('span').textContent='撮影地点からの天体の方向と高度を調べる';}
}

let resultRequested=false,selectionPending=false,flowOwner=null,flowGeneration=null,previewBackEpoch=AstroNotesLibrary.gate();
let searchRoot=null,candidatePanelHome=null,searchStarted=false,returnIntent=null,pendingScroll=null;
// 2026-11-11 ユーザー「探すへ戻るのボタンの形状と配置場所」「見え方に入ったらなんの条件の見え方なのかがわからない」
// 「重ねる天体とかの条件が気軽に変えられない」: 見え方でも条件の欄をたたんで先頭に残し（何×何・撮影地点・重ね方）、
// 戻るは丸い枠なしの ＜ だけにしてその左端に置く（2026-11-11 ユーザー「戻るボタンがなんかダサい」→「丸をやめて ＜ だけ」）。条件を開けば、その場で天体・対象・重ね方を変えられる。
const candidateBack=node('button',{id:'exploreBackToCandidates',type:'button',className:'explore-back',hidden:true});
candidateBack.innerHTML='<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// Inside the summary: a click goes back and never toggles the conditions.
candidateBack.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();});scene.prepend(candidateBack);
const resultActive=()=>active()&&resultRequested;
const mainSearchActive=()=>active()&&!resultRequested&&!selectionPending&&flowOwner===auth?.loginId&&flowGeneration===accessState.generation;
function ensureSearchRoot(){
 if(!layout.mounted)return;
 if(!searchRoot){
  searchRoot=node('section',{id:'exploreSearchResults'});searchRoot.setAttribute('aria-labelledby','exploreResultsHeading');
  const heading=node('h2',{id:'exploreResultsHeading',className:'explore-section-title'},'撮影候補');
  searchRoot.append(node('p',{id:'candidateSearchEmpty',className:'tiny'}),node('div',{id:'candidateSearchFeedback'}),heading,node('div',{id:'candidateSearchCredits'}));
 }
 if(!searchRoot.isConnected)layout.conditions.after(searchRoot);
 const panel=$('recentCandidates');if(panel.parentNode!==searchRoot){candidatePanelHome={parent:panel.parentNode,next:panel.nextSibling};searchRoot.insertBefore(panel,$('candidateSearchCredits'));panel.setAttribute('role','region');panel.setAttribute('aria-label','撮影候補の一覧');
 panel.removeAttribute('aria-labelledby');}
}
function restoreSearchScroll(count){
 if(!pendingScroll||!mainSearchActive()||count<pendingScroll.count)return;
 const saved=pendingScroll;pendingScroll=null;requestAnimationFrame(()=>{if(mainSearchActive())document.scrollingElement.scrollTop=saved.top;});
}
function foldConditions(){if(layout.conditions)layout.conditions.removeAttribute('open');}
function placeBack(){
 const summary=layout.conditions?.querySelector('summary');
 if(resultRequested&&summary&&candidateBack.parentNode!==summary)summary.prepend(candidateBack);
 else if(!resultRequested&&candidateBack.parentNode!==scene)scene.prepend(candidateBack);
}
function syncWorkspace(){
 if(!layout.mounted)return;ensureSearchRoot();
 if(flowOwner!==auth?.loginId||flowGeneration!==accessState.generation){resultRequested=false;selectionPending=false;searchStarted=false;returnIntent=null;pendingScroll=null;$('candidateSearchEmpty').textContent='';flowOwner=auth?.loginId;flowGeneration=accessState.generation;invalidate();}
 mapView.dataset.exploreStage=resultRequested?'preview':'search';
 layout.conditions.hidden=false;if(!resultRequested)layout.conditions.open=true;placeBack();
 searchRoot.hidden=resultRequested;scene.hidden=!resultRequested;candidateBack.hidden=!resultRequested;
 $('recentCandidates').hidden=resultRequested||!searchStarted;$('candidateSearchEmpty').hidden=searchStarted;
 $('exploreResultsHeading').hidden=!searchStarted;
 const backLabel=globalThis.MyPlacesUI?.opportunities?.hasReturn()?'重なる日へ戻る':returnIntent?.searched?'候補へ戻る':'探すへ戻る';candidateBack.setAttribute('aria-label',backLabel);candidateBack.title=backLabel;
 syncRecordDiscovery();document.dispatchEvent(new Event('astronotes-search-state'));
}
function captureSearch(){
 const s=SkyMapUI.selectionState();if(!s)return;
 returnIntent={owner:auth.loginId,generation:accessState.generation,selection:structuredClone(s),custom:structuredClone(SkyMapUI.workspaceHost()?.session.custom??null),customTarget:structuredClone(SkyMapUI.workspaceHost()?.session.customTarget??null),searched:searchStarted,
 scrollTop:document.scrollingElement.scrollTop,count:globalThis.AstroNotesCandidatePicker?.visibleRows().length||0};
}
function enterResult(){
 if(!selectionPending)captureSearch();selectionPending=false;resultRequested=true;previewBackEpoch.cancel();foldConditions();syncWorkspace();SkyMapUI.render();
}
function showSearch(){
 if(globalThis.MyPlacesUI?.opportunities?.returnFromPreview())return;
 previewBackEpoch.cancel();
 document.dispatchEvent(new Event('astronotes-preview-leave'));
 if(!returnIntent&&active())captureSearch();const saved=returnIntent;if(!active()||!saved||saved.owner!==auth?.loginId||saved.generation!==accessState.generation)return;
 resultRequested=false;selectionPending=true;invalidate();look.hidden=true;
 const s=saved.selection;SkyMapUI.setTarget(s.target.id);
 // Restore the full target as well: custom target coordinates/heights are part of the search.
 SkyMapUI.workspaceHost()?.restoreTarget({target:structuredClone(s.target),custom:saved.custom,customTarget:saved.customTarget});
 const body=$('skyMapBody');body.value=s.body;body.dispatchEvent(new Event('change',{bubbles:true}));SkyMapUI.setAlignment(s.partId,s.limb,s.matchMode);SkyMapUI.setTime(s.at);
 SkyMapUI.workspaceHost()?.restoreObserver(structuredClone(s.observer));selectionPending=false;searchStarted=saved.searched;pendingScroll={top:saved.scrollTop,count:saved.count};syncWorkspace();if(discoveryTab==='records'||!searchStarted)restoreSearchScroll(0);
}
function leaveSearchFlow(){
 recordSeq.cancel();recordCalendarSeq.cancel();if(recordTimer!==null)clearTimeout(recordTimer);recordTimer=null;recordState={key:'',status:'idle'};recordPane?.replaceChildren();recordCache.clear();recordJobs.clear();recordMemo=null;recordCalendarArgs=null;
 previewBackEpoch.cancel();
 document.dispatchEvent(new Event('astronotes-preview-leave'));
 resultRequested=false;selectionPending=false;searchStarted=false;returnIntent=null;pendingScroll=null;candidateBack.hidden=true;
 const panel=$('recentCandidates');if(candidatePanelHome&&panel){candidatePanelHome.parent.insertBefore(panel,candidatePanelHome.next?.parentNode===candidatePanelHome.parent?candidatePanelHome.next:null);panel.setAttribute('role','tabpanel');
 panel.setAttribute('aria-labelledby','placeTab-candidates');panel.removeAttribute('aria-label');candidatePanelHome=null;}
 searchRoot?.remove();delete mapView.dataset.exploreStage;
}

let discoveryTab='records',recordPane=null,newPlacePane=null,recordTabs=null,recordSeq=AstroNotesLibrary.gate(),recordState={key:'',status:'idle'},recordOwner='',recordTimer=null;
const recordCache=new Map(),recordJobs=new Map();let recordCalendarArgs=null,recordMemo=null,recordDataEpoch=0,recordCalendarSeq=AstroNotesLibrary.gate();
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
 const s=AstroNotesShooting.conditions(SkyMapUI.selectionState());
 return active()&&toolAllowed('records')&&flowOwner===request.owner&&auth?.loginId===request.owner&&flowGeneration===request.generation&&accessState.generation===request.generation&&recordMemo?.epoch===request.epoch&&MyPlacesUI.discoveryRevision()===request.revision&&
 AstroNotesAtmosphere.dataKey(request.plan.at)===request.atmosphere&&extra()&&JSON.stringify([s?.target,s?.body,s?.partId,s?.limb,s?.matchMode,globalThis.AstroNotesTrialOverlap?.key?.(SkyMapUI.selectionState())??null])===request.condition;
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
   const button=node('button',{id:'exploreDiscovery-'+name,type:'button'},label);button.setAttribute('role','tab');button.setAttribute('aria-controls',pane.id);pane.setAttribute('role','tabpanel');pane.setAttribute('aria-labelledby',button.id);button.onclick=()=>chooseDiscovery(name);
   recordTabs.append(button);
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
  const b=node('button',{type:'button',className:'explore-record-row'}),name=node('strong',{},row.place.name),time=node('span',{className:'explore-record-time'},new Date(row.event.at+32400000).toISOString().slice(11,16)),sub=node('span',{className:'tiny'}),arrow=node('span',{
  className:'explore-record-arrow'},'›');arrow.setAttribute('aria-hidden','true');
  if(row.heightSearch||rows.some(other=>(other.place.sourcePlaceId??other.place.id)===(row.place.sourcePlaceId??row.place.id)&&(other.assumedObserver?.eyeM??other.place.standAglM)!==(row.assumedObserver?.eyeM??row.place.standAglM)))sub.textContent='地上'+
  (row.assumedObserver?.eyeM??row.place.standAglM??row.place.eyeHeightAGL)+'m';
  b.append(name,time,arrow);if(sub.textContent){b.classList.add('has-height');b.append(sub);}b.onclick=()=>{if(!mainSearchActive()||recordState.key!==request.key||!recordCurrent(request)||!mainCandidateWorkspace.selectable()){syncRecordDiscovery();return;
  }const s=SkyMapUI.selectionState(),expected=JSON.stringify([s.body,s.target,s.partId,s.limb,AstroNotesShooting.day(s.at),s.matchMode||'limb']);SkyMapUI.selectCandidate(row,expected);};list.append(b);
 }
 if(!rows.length&&!result.failed){const p=node('p',{className:'tiny'},request.points.length?'この日に重なる記録の撮影地点はありません':'記録の撮影地点がありません');recordPane.append(p);if(!request.points.length){const link=node('a',{href:'#/records',className:'chip'},'記録を開く');recordPane.append(link);}}
 if(result.failed){const p=node('p',{className:'tiny'},rows.length?'確認できなかった地点があります':'記録の撮影地点を確認できませんでした');p.setAttribute('role','status');const retry=node('button',{type:'button',className:'chip'},'再試行');retry.onclick=()=>{recordCache.delete(request.key);recordState.key='';syncRecordDiscovery();};
 recordPane.append(p,retry);}
}
function stopRecordLoading(){
 if(recordState.status!=='loading')return;
 recordSeq.cancel();recordState={key:'',status:'idle'};if(recordTimer!==null)clearTimeout(recordTimer);recordTimer=null;recordPane?.replaceChildren();recordPane?.setAttribute('aria-busy','false');
}
function syncRecordDiscovery(){
 if(!mainSearchActive()||document.hidden){stopRecordLoading();return;}
 ensureRecordDiscovery();if(!recordPane)return;
 const owner=JSON.stringify([auth?.loginId,accessState.generation]);if(recordOwner!==owner){recordOwner=owner;recordCache.clear();recordMemo=null;recordState={key:'',status:'idle'};discoveryTab='records';chooseDiscoveryQuiet();}
 if(!recordDiscoveryActive()){stopRecordLoading();return;}
 if(!toolAllowed('records')){recordSeq.cancel();recordState={key:'denied',status:'idle'};recordPane.setAttribute('aria-busy','false');recordPane.replaceChildren(node('p',{className:'tiny'},'記録の利用権限を確認してください'));return;}
 const request=recordRequest();if(!request){if(recordState.key!=='missing'){recordSeq.cancel();recordState={key:'missing',status:'idle'};recordPane.setAttribute('aria-busy','false');recordPane.replaceChildren(node('p',{className:'tiny'},'天体と対象を選んでください'));}return;}
 if(recordState.key===request.key)return;
 if(recordTimer!==null)clearTimeout(recordTimer);
 recordTimer=null;
 const seq=recordSeq.next(),cached=recordCache.get(request.key);
 if(!request.points.length){recordState={key:request.key,status:'complete'};recordPane.setAttribute('aria-busy','false');renderRecordRows(request,{rows:[],failed:0});return;}
 if(cached&&recordCurrent(request)){recordState={key:request.key,status:'complete'};recordPane.setAttribute('aria-busy','false');renderRecordRows(request,cached);return;}
 recordState={key:request.key,status:'loading'};recordPane.setAttribute('aria-busy','true');
 const progress=MyPlacesUI.recordProgress?.(recordPane,'記録の撮影地点を確認中');
 if(progress)progress.update(0,recordWorkCount(request));else recordPane.replaceChildren(node('p',{className:'tiny'},'記録の撮影地点を確認中…'));
 recordTimer=setTimeout(async()=>{
  recordTimer=null;const current=()=>recordSeq.current(seq)&&recordDiscoveryActive()&&AstroNotesShooting.day(SkyMapUI.selectionState()?.at)===request.plan.at&&recordCurrent(request);
  try{const result=await recordRows(request,current,(n,total)=>progress?.update(n,total));if(!current()||result.cancelled)return;recordState.status='complete';renderRecordRows(request,result);}
  catch{if(current()){recordState.status='error';recordPane.replaceChildren(node('p',{className:'tiny'},'記録の撮影地点を確認できませんでした'));const retry=node('button',{type:'button',className:'chip'},'再試行');retry.onclick=()=>{recordState.key='';syncRecordDiscovery();};recordPane.append(retry);}}
  finally{if(recordSeq.current(seq)){recordPane.setAttribute('aria-busy','false');if(recordState.status==='loading'){recordState={key:'',status:'idle'};if(recordDiscoveryActive())queueMicrotask(syncRecordDiscovery);}}}
 },180);
}
async function recordCalendar(args,scanMonth=false){
 const calendarSeq=recordCalendarSeq.next();recordCalendarArgs=args;const {year,month,grid,status,draw,pickDay,isCurrent}=args,request=recordRequest();
 if(!toolAllowed('records')){status.textContent='記録の利用権限を確認してください';grid.setAttribute('aria-busy','false');return;}
 if(!request){status.textContent='天体と対象を選んでください';grid.setAttribute('aria-busy','false');return;}
 if(!request.points.length){draw(new Map());status.textContent='記録の撮影地点がありません';grid.setAttribute('aria-busy','false');return;}
 const current=()=>recordCalendarSeq.current(calendarSeq)&&isCurrent()&&mainSearchActive()&&!document.hidden&&recordCurrent(request);
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
 finally{if(recordCalendarSeq.current(calendarSeq)){if(current())grid.setAttribute('aria-busy','false');
 else if(isCurrent()&&mainSearchActive()){if(toolAllowed('records')&&recordRequest()?.key!==request.key)setTimeout(()=>{if(recordCalendarSeq.current(calendarSeq)&&isCurrent()&&mainSearchActive())args.restart();},0);
 else{status.textContent=toolAllowed('records')?'条件を確認して月を選び直してください':'記録の利用権限を確認してください';grid.setAttribute('aria-busy','false');}}}}
}

document.addEventListener('visibilitychange',()=>{syncRecordDiscovery();if(!document.hidden&&recordCalendarArgs?.isCurrent()&&mainSearchActive())recordCalendarArgs.restart();});
window.addEventListener('pagehide',stopRecordLoading);
// The normal hidden handler suspends the map's selection session as well.
// Restore it through its existing access check before reading the search plan.
// open() coalesces repeated foreground signals; live searches stay running.
function resumeRecordDiscovery(){
 if(document.hidden||!active())return;
 if(SkyMapUI.resuming?.()){void SkyMapUI.open();return;}
 syncRecordDiscovery();
}
for(const type of ['pageshow','focus'])window.addEventListener(type,resumeRecordDiscovery);
document.addEventListener('astronotes-records-change',()=>{recordMemo=null;recordState.key='';queueMicrotask(()=>{syncRecordDiscovery();if(recordCalendarArgs?.isCurrent()&&mainSearchActive())recordCalendarArgs.restart();});});
const mainCandidateWorkspace={separateRecords:true,newPlacesHost:()=>newPlacePane,calendarMonth:recordCalendar,returnScroll:()=>returnIntent?.scrollTop,epoch:()=>flowGeneration,previewWidth:()=>Math.max(200,Math.round(Math.min(780,mapView.clientWidth||320))),active:mainSearchActive,selectable:()=>mainSearchActive()&&!$('placeSheet').open,visible:()=>searchStarted,
 beginBack(){
  if(!resultActive()||selectionPending||flowOwner!==auth?.loginId||flowGeneration!==accessState.generation)return null;
  const epoch=previewBackEpoch.ticket(),owner=flowOwner,generation=flowGeneration,saved=returnIntent;let used=false;
  return()=>{if(used)return false;used=true;
   if(!previewBackEpoch.current(epoch)||!resultActive()||selectionPending||flowOwner!==owner||flowGeneration!==generation||owner!==auth?.loginId||generation!==accessState.generation||returnIntent!==saved||document.querySelector('dialog[open]')||!$('toolsMenu').hidden&&
   $('toolsMenu').classList.contains('on'))return false;
   showSearch();return true;
  };
 },
 reveal(){if(!mainSearchActive())return;const first=!searchStarted;searchStarted=true;$('recentCandidates').hidden=false;$('candidateSearchEmpty').hidden=true;$('exploreResultsHeading').hidden=false;if(first)globalThis.MyPlacesUI?.renderPickerPanel($('recentCandidates'));},
 reset(){if(searchStarted)$('candidateSearchEmpty').textContent='条件を変更しました。もう一度候補を探してください。';searchStarted=false;$('recentCandidates').hidden=true;$('candidateSearchEmpty').hidden=false;$('exploreResultsHeading').hidden=true;},
 restoreScroll:restoreSearchScroll,scroller:()=>document.scrollingElement};
candidateBack.onclick=showSearch;
// Conditions changed in the view: showing the result again folds them back above the view.
document.addEventListener('click',e=>{if(e.target.closest?.('#exploreShowResult')&&resultRequested&&layout.conditions)requestAnimationFrame(()=>{if(resultRequested)foldConditions();});},true);
document.addEventListener('astronotes-candidate-selecting',()=>{if(mainCandidateWorkspace.selectable()){captureSearch();selectionPending=true;}});
document.addEventListener('astronotes-candidate-selected',()=>{if(selectionPending&&returnIntent?.owner===auth?.loginId&&returnIntent.generation===accessState.generation)showResult();});

const layout=AstroNotesExploreLayout.create({$,node,store,mapView,aimView,skyInfo,tabs,scene,map,aimState:()=>aim,requestAnimationFrame:cb=>requestAnimationFrame(cb),getMode:()=>mode,isAimActive:()=>viewState.aim,
 showResult,candidateChosen,addSaveAction,updateConditions,choose,invalidate,placePins,updateSkyInfo});
function choose(next,focus=false){
 mode='scene';
 tabs.hidden=true;scene.setAttribute('aria-label','見え方');scene.removeAttribute('aria-labelledby');scene.tabIndex=-1;
 for(const [tab,pane,name] of [[sceneTab,scene,'scene'],[mapTab,map,'map']]){const on=mode===name;tab.setAttribute('aria-selected',String(on));tab.tabIndex=on?0:-1;pane.hidden=!on;if(on&&focus)scene.focus({preventScroll:true});}
 mapView.dataset.exploreMode=mode;
 if(mode==='map'){if(plan.pendingKey)invalidate();scene.style.minHeight='';scene.removeAttribute('data-loading');scene.removeAttribute('aria-busy');SkyMapUI.redraw();}
 else sync();
}
sceneTab.onclick=()=>choose('scene');mapTab.onclick=()=>choose('map');
// Only the first choice has to reveal the result; after that the page stays where the user put it.
function candidateChosen(e){if(e.target.closest('[data-from-day]')&&layout.conditions?.open)showResult();}
tabs.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();choose(e.key==='Home'?'scene':e.key==='End'?'map':mode==='scene'?'map':'scene',true);};
function project(s){
 aim.target=aimWithHeights(s.target);aim.body=s.body;aim.from=aimSavedFrom(s.observer);aim.dayMs=AstroNotesSkyMap.dayStart(s.at);aim.partId=s.partId;aim.limb=s.limb;aim.matchMode=s.matchMode||'overlap';
 aim.candPick=null;aim.wantSpot=null;aim.spot=null;aim.plannerTransfer=null;clearAimAirCompare();
 $('aimDate').value=new Date(s.at+32400000).toISOString().slice(0,10);$('aimBody').value=s.body;
}
function reserveScene(){const h=scene.getBoundingClientRect().height;if(h>0)scene.style.minHeight=h+'px';}
function message(text){status.textContent=text;status.hidden=!text;retry.hidden=!text.includes('再試行');}
function updateRetainedTime(s){
 if(plan.frameBase===baseStamp(s)&&!look.hidden&&look._uiTime&&Math.abs(look._lookAt-s.at)>.5)look._uiTime.set(s.at);
}
async function paint(force=false){
 if(!active())return;updateConditions();if(!resultRequested)return;let s;
 try{s=snapshot();updateSkyInfo(s);}catch{updateSkyInfo(null);invalidate();look.hidden=true;scene.removeAttribute('data-loading');scene.removeAttribute('aria-busy');scene.style.minHeight='';message(!SkyMapUI.selectionState()?.target?'対象を選ぶと見え方を確認できます':'撮影地点を選ぶと見え方を確認できます');return;}
 const key=stamp(s);
 if(mode!=='scene'){if(plan.frameKey&&plan.frameKey!==key)invalidate();return;}
 if(!canFrame(s)){invalidate();look.hidden=true;scene.removeAttribute('data-loading');scene.removeAttribute('aria-busy');scene.style.minHeight='';message('この条件の見え方を利用する権限がありません');return;}
 let run=null;
 try{
 if(plan.pendingKey===key&&!force){updateRetainedTime(s);return;}
 if(!force&&plan.frameKey===key&&look._uiTime&&!look.hidden){
  if(Math.abs(look._lookAt-s.at)>.5)look._uiTime.set(s.at);
  const cv=look.querySelector('[data-look-canvas]');if(cv&&Math.round(cv.clientWidth)===look._lookW){addSaveAction(look.querySelector('.aim-figure-share'),'aim');updateConditions();message('');return;}
 }
 // 日付だけが変わったときは、前の見え方を出したまま描き直す（2026-10-22 ユーザー「ブラックアウトして全て再読み込みするのはやめて必要な箇所だけの更新で」）
 const soft=!!plan.frameBase&&(plan.frameBase===baseStamp(s)||globalThis.MyPlacesUI?.eyeAdjustmentFor?.(s))&&!look.hidden&&!!look.querySelector('[data-look-canvas]');
 reserveScene();run=plan.begin(key,soft);project(s);if(soft)updateRetainedTime(s);scene.setAttribute('aria-busy','true');
 if(!soft){look.hidden=true;scene.dataset.loading='true';message('見え方を計算中…');}
  aimAirEnsure(aim.from,aim.dayMs);
  await AstroNotesAssets.ensureModels();await AstroNotesBodies.ensure(s.body);
  if(!plan.current(run)||!resultActive()||mode!=='scene'||!plan.matches(key))return;
  const spec={obs:{latitude:s.observer.latitude,longitude:s.observer.longitude,elevation:s.observer.groundManualM??s.ground??0},eyeM:s.eyeM,at:s.at,observerName:s.observer.name,title:'',sub:'',light:''};
  look._uiRequestedTime=null;look._lookAt=null;
  await aimLookRender(look,spec);
  if(!plan.current(run)||!resultActive()||mode!=='scene'||!plan.matches(key))return;
  const latest=snapshot();if(Math.abs(look._lookAt-latest.at)>.5)look._uiTime?.set(latest.at);
  plan.commit(key,s);message('');addSaveAction(look.querySelector('.aim-figure-share'),'aim');
 }catch(e){if((!run||plan.current(run))&&resultActive()){invalidate();look.hidden=true;scene.removeAttribute('data-loading');scene.removeAttribute('aria-busy');scene.style.minHeight='';message('見え方を計算できませんでした。条件を確認して再試行してください');updateConditions();}}
 finally{if(run&&plan.settle(run)&&resultActive()){scene.removeAttribute('data-loading');scene.removeAttribute('aria-busy');if(!look.hidden)scene.style.minHeight='';updateConditions();}}
}
function sync(force=false){
 forceNext=forceNext||force;if(scheduled)return;scheduled=true;
 requestAnimationFrame(()=>{scheduled=false;const f=forceNext;forceNext=false;void paint(f);});
}
function render(){
 menu();if(viewState.skyMap&&eligible()){layout.mount();aimView.hidden=false;renderAimAccess();sync();}
 else{leaveSearchFlow();layout.unmount();promote();}
}
// Permission changes also render the current route. Promote once without requiring a navigation or reload.
function promote(){
 if(!viewState.aim||!eligible()||routing)return;
 routing=true;const desiredMode=transferMode||'scene';transferMode=null;const generation=accessState.generation,loginId=auth?.loginId,hash=location.hash,preset=routeFromHash()?.preset,restored=aim.pendingPlan;
 // Session renewal rotates the token without changing this authenticated account's generation.
 AstroNotesAssets.ensureModels().then(()=>{if(generation!==accessState.generation||loginId!==auth?.loginId||hash!==location.hash||!viewState.aim||!eligible())return;openAim(preset||null);if(restored){aim.pendingPlan=restored;flowOwner=loginId;flowGeneration=generation;resultRequested=true;
 }mode=desiredMode;SkyMapUI.enter(true,restored?.at);}).finally(()=>{routing=false;if(transferMode&&viewState.aim&&eligible())routeChanged();});
}
function routeChanged(){render();}
function sceneDraw(host,at){
 if(host!==look||!resultActive()||mode!=='scene'||!intent||plan.pendingKey||!plan.frameKey)return;
 try{const s=snapshot();if(stamp(s)===plan.frameKey&&Math.abs(s.at-at)>.5)SkyMapUI.setTime(at);}catch(e){globalThis.AstroNotesErrors?.note('explore.restoreTime',e);}
}
for(const type of ['click','keydown'])aimView.addEventListener(type,()=>{intent=true;setTimeout(()=>{intent=false;},0);},true);
function assertScene(){SkyMapUI.shareState();const s=snapshot();if(!resultActive()||mode!=='scene'||!canFrame(s)||plan.frameKey!==stamp(s)||Math.abs(look._lookAt-s.at)>.5)throw Error('見え方の更新が終わってから共有してください');}
const style=node('style');style.textContent=
'.explore-conditions{max-width:780px;margin:0 0 12px;border:1px solid var(--line);border-radius:14px;background:var(--card)}'+
'.explore-conditions:not([open]){position:sticky;top:0;z-index:4}'+
'.explore-conditions>summary{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;min-height:64px;padding:12px 14px;cursor:pointer;list-style:none}.explore-conditions>summary::-webkit-details-marker{display:none}'+
'#exploreConditionTitle{font-weight:600;grid-column:1;overflow-wrap:anywhere}#exploreConditionDetail{grid-column:1;font-size:12px;color:var(--secondary);overflow-wrap:anywhere}.explore-condition-edit{grid-column:2;grid-row:1/3;align-self:center;font-size:12px;color:var(--accent)}'+
'.explore-condition-fields{padding:4px 14px 14px}.explore-conditions[open]>summary{border-bottom:1px solid var(--line)}.explore-conditions[open] #exploreConditionDetail{display:none}'+
'.explore-show-result{width:100%;min-height:44px;margin-top:8px}'+
("#skyMapView.explore-mounted #skyMapRecentOpen{display:none!important}#skyMapView.explore-mounted .sky-map-head{min-height:0!important;margin-bottom:4px!important}#skyMapView.explore-mounted #skyMapTitle{-webkit-user-select:none;user-select:none;pointer-events:none}"+
"#skyMapView[data-explore-stage=\"search\"] #exploreScenePanel,#skyMapView[data-explore-stage=\"search\"] #exploreMapPanel,#skyMapView[data-explore-stage=\"search\"] #exploreSkyInfo,#skyMapView[data-explore-stage=\"search\"] .sky-map-candidates,#skyMapView[data-explore-stage=\"search\"] #skyMapShareRow{display:none!important}"+
"#skyMapView[data-explore-stage=\"preview\"] #exploreSearchResults{display:none!important}#skyMapView[data-explore-stage=\"preview\"] .explore-conditions>summary{grid-template-columns:auto minmax(0,1fr) auto}"+
"#skyMapView[data-explore-stage=\"preview\"] #exploreConditionTitle,#skyMapView[data-explore-stage=\"preview\"] #exploreConditionDetail{grid-column:2}#skyMapView[data-explore-stage=\"preview\"] .explore-condition-edit{grid-column:3}#exploreBackToCandidates{grid-column:1;grid-row:1/3;"+
"align-self:center;width:30px;height:44px;margin:0 2px 0 -8px;padding:0;border:0;border-radius:8px;background:none;color:var(--secondary);display:grid;place-items:center;cursor:pointer;-webkit-tap-highlight-color:transparent}#exploreBackToCandidates:active{color:var(--text)}"+
"#exploreBackToCandidates[hidden]{display:none}\n#skyMapView[data-explore-stage=\"search\"] #candidateWorkspaceAction{display:block}\n.explore-discovery-tabs{display:flex;gap:24px;border-bottom:1px solid var(--line);margin:12px 0 16px}\n.explore-discovery-tabs button{min-height:44px;"+
"padding:8px 2px;border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;color:var(--secondary);font-size:.85rem;font-weight:600}\n.explore-discovery-tabs button[aria-selected=\"true\"]{color:var(--accent);border-bottom-color:var(--accent)}"+
"\n#exploreNewPlaces:not([hidden]){display:grid;gap:12px}\n.record-calendar-scan{min-height:44px}\n#exploreRecordedPlaces[hidden],#exploreNewPlaces[hidden]{display:none!important}\n.explore-record-row{display:grid;grid-template-columns:minmax(0,1fr) auto 14px;gap:4px 12px;align-items:center;"+
"text-align:left;width:100%;min-height:64px;border:0;border-bottom:1px solid var(--line);border-radius:0;padding:12px 0;background:transparent;color:var(--text)}\n.explore-record-row strong{grid-column:1;grid-row:1/3;font-size:.9rem;overflow-wrap:anywhere}"+
"\n.explore-record-row.has-height{min-height:76px}.explore-record-row.has-height strong{grid-row:1}\n.explore-record-row .tiny{grid-column:1;grid-row:2;color:var(--secondary)}\n.explore-record-time{grid-column:2;grid-row:1/3;color:var(--accent);font-size:1rem;font-variant-numeric:tabular-nums;"+
"white-space:nowrap}\n.explore-record-arrow{grid-column:3;grid-row:1/3;color:var(--secondary)}\n")+
'.explore-tabs{scroll-margin-top:12px}.explore-save{min-height:44px}.explore-mounted .aim-figure-share{gap:8px;align-items:center}.explore-mounted .aim-figure-share .explore-save{order:-1;margin-right:0}'+
'#skyMapView.explore-mounted .sky-map-head::before{content:"EXPLORE" / "";--kw:6.6em}'+
'.explore-tabs{margin:14px 0 12px;max-width:780px}.explore-tabs button{min-height:44px}'+
'#skyMapView.explore-mounted #skyMapObserverDetails:not([hidden]){padding:0 0 6px}'+
'#exploreHeightFields{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;margin-top:6px}'+
'#skyMapView.explore-mounted #skyMapObserverDetails:not([open]) #exploreHeightFields{display:none}'+
'#skyMapView.explore-mounted #skyMapObserverDetails .aim-observer-height{display:grid;grid-template-columns:minmax(0,1fr) 44px;gap:4px;min-width:0;margin:0}'+
'#skyMapView.explore-mounted #skyMapObserverDetails .aim-observer-height label{grid-column:1/-1}'+
'#skyMapView.explore-mounted #skyMapObserverDetails .aim-observer-height input{width:100%;min-width:0;padding:8px 4px;font-size:16px;background:transparent;border:0;border-radius:8px;outline:none;box-shadow:none}'+
'#exploreHeightFields .explore-height-value{display:flex;align-items:center;min-width:0;background:var(--sunk);border:1px solid color-mix(in srgb,var(--text) 30%,transparent);border-radius:8px}'+
'#exploreHeightFields .explore-height-value input{flex:1;width:0}'+
'#exploreHeightFields .explore-height-value>span{flex:none;padding-right:6px}'+
'#exploreHeightFields .explore-height-value:focus-within{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}'+
'#exploreHeightFields input[type=number]{-moz-appearance:textfield;appearance:textfield}'+
'#exploreHeightFields input[type=number]::-webkit-inner-spin-button,#exploreHeightFields input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;appearance:none;margin:0}'+
'#skyMapView.explore-mounted #skyMapObserverDetails[open] .height-summary-values{display:none}'+
'#skyMapView.explore-mounted #skyMapObserverDetails:not([open]) .height-summary-values{animation:explore-height-in .18s ease-out}'+
'#skyMapView.explore-mounted #skyMapObserverDetails[open] #exploreHeightFields{animation:explore-height-down .22s ease-out}'+
'@keyframes explore-height-down{from{opacity:0;transform:translateY(-14px)}to{opacity:1;transform:none}}'+
'@keyframes explore-height-in{from{opacity:0}to{opacity:1}}'+
'@media(prefers-reduced-motion:reduce){#skyMapView.explore-mounted #skyMapObserverDetails #exploreHeightFields,#skyMapView.explore-mounted #skyMapObserverDetails .height-summary-values{animation:none}}'+
'#skyMapView.explore-mounted #skyMapHeightError{grid-column:1/-1}'+
'#exploreScenePanel,#exploreMapPanel{max-width:780px;min-width:0}#exploreScenePanel[hidden],#exploreMapPanel[hidden]{display:none!important}'+
'#exploreScenePanel[data-loading=true] #aimLook{visibility:hidden;pointer-events:none}'+
'#exploreScenePanel #aimView .preview-workspace{margin:0;max-width:none}#exploreScenePanel #previewScene:before{display:none}'+
'#exploreScenePanel #aimView{padding:0}#exploreScenePanel #aimView .aim-look{margin:0}'+
'#skyMapView.explore-mounted #shootingCandidatesOpen,#skyMapView.explore-mounted #shootingCandidateStatus,#skyMapView.explore-mounted #shootingOverlap{display:none!important}'+
'#skyMapView.explore-mounted #mySkyPlaces .my-head{display:none!important}'+
'#skyMapView.explore-mounted #skyMapShareRow:not([hidden]){display:flex;align-items:center;gap:8px}#skyMapView.explore-mounted #skyMapShareRow #shootingPins{margin-right:auto}'+
'.explore-mounted[data-explore-mode=scene] #skyMapBodyBar,.explore-mounted[data-explore-mode=scene] #shootingPins{display:none!important}'+
'main:has(>#skyMapView.explore-mounted){max-width:1000px}';
style.textContent+=`
main:has(>#skyMapView[data-explore-stage="search"]){max-width:1280px}
#skyMapView[data-explore-stage="search"] #exploreConditions{max-width:none;margin:0;border:0;border-radius:0;background:transparent;position:static}
#skyMapView[data-explore-stage="search"] #exploreConditions>summary{display:none}
#skyMapView[data-explore-stage="search"] .explore-condition-fields{padding:0;display:grid;grid-template-columns:minmax(0,1fr);gap:12px}
#skyMapView[data-explore-stage="search"] .explore-section-title{font-size:1.1rem;font-weight:700;line-height:1.5;margin:0}
#skyMapView[data-explore-stage="search"] .sky-map-controls{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;margin:0;max-width:none}
#skyMapView[data-explore-stage="search"] #exploreConditions .condition-field,#skyMapView[data-explore-stage="search"] #exploreConditions .condition-field:has(.condition-clear){grid-template-columns:80px minmax(0,1fr)!important;gap:10px;margin:0;max-width:none;align-items:start}
#skyMapView[data-explore-stage="search"] .condition-field>.condition-label{display:flex;grid-column:1;grid-row:1;align-items:center;gap:6px;min-height:48px;font-size:.75rem;font-weight:600;color:var(--secondary);white-space:nowrap}
#skyMapView[data-explore-stage="search"] .condition-field>.condition-label>svg{width:20px;height:20px;margin:0;align-self:auto;stroke-width:1.8}
#skyMapView[data-explore-stage="search"] .condition-field>.condition-label>span{position:static;width:auto;height:auto;padding:0;margin:0;overflow:visible;clip-path:none;white-space:nowrap}
#skyMapView[data-explore-stage="search"] .condition-field>.condition-label{width:auto}
#skyMapView[data-explore-stage="search"] .condition-field :is(.condition-choice,.preview-body-open,.preview-target-open){height:auto;min-height:48px;border-radius:10px;font-size:16px;font-weight:600;padding:10px 12px;box-shadow:none}
#skyMapView[data-explore-stage="search"] .condition-choice>span{white-space:normal;overflow-wrap:anywhere;text-overflow:clip;line-height:1.5}
#skyMapView[data-explore-stage="search"] .aim-say-from{margin:0;max-width:none}
#skyMapView[data-explore-stage="search"] .aim-observer-card{background:transparent;border-radius:0}
#skyMapView[data-explore-stage="search"] .aim-observer-card>.place-row{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:0 6px 0 12px;box-shadow:none}
#skyMapView[data-explore-stage="search"] .condition-field .place-pick{min-height:48px;padding:8px 0;gap:8px}
#skyMapView[data-explore-stage="search"] .place-row .name{font-size:16px;line-height:1.5;font-weight:600}
#skyMapView[data-explore-stage="search"] .place-row .muted{font-size:.69rem;line-height:1.5}
#skyMapView[data-explore-stage="search"] .explore-place-tools{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;align-items:start}
#skyMapView[data-explore-stage="search"] .explore-place-tools>#skyMapObserverDetails{margin:0;padding:0;border:0}
#skyMapView[data-explore-stage="search"] .explore-place-tools #skyMapObserverSummary{padding:0;list-style:none}
#skyMapView[data-explore-stage="search"] .explore-place-tools #skyMapObserverSummary::-webkit-details-marker{display:none}
#skyMapView[data-explore-stage="search"] #skyMapObserverSummary{min-height:44px;display:flex;align-items:center;font-size:.75rem;color:var(--secondary)}
#skyMapView[data-explore-stage="search"] #skyMapAlignmentDetails{display:grid;grid-template-columns:80px minmax(0,1fr);gap:10px;margin:0;padding:0;border:0}
#skyMapView[data-explore-stage="search"] #skyMapAlignmentDetails[hidden]{display:none!important}
#skyMapView #skyMapAlignmentSummary{display:flex;align-items:center;gap:6px;min-height:48px;margin:0;font-size:.75rem;font-weight:600;color:var(--secondary)}
#skyMapView #skyMapAlignmentSummary svg{width:20px;height:20px;color:var(--accent);flex:none}
#skyMapView[data-explore-stage="search"] #skyMapAlignmentControls .record-alignment-position>.tiny{display:none}
#skyMapView[data-explore-stage="search"] #skyMapAlignmentControls select{min-height:48px;border-radius:10px;font-weight:600}
#skyMapView[data-explore-stage="search"] #candidateWorkspaceAction{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;margin:8px 0 0;padding:20px 0 0;border-top:1px solid var(--line)}
#skyMapView[data-explore-stage="search"] #additionalCandidateSearch{display:contents}
#skyMapView[data-explore-stage="search"] #candidateWorkspaceAction .aim-disclosure{grid-column:1/-1;margin:0;padding:0;border:0}
#skyMapView[data-explore-stage="search"] #candidateWorkspaceAction .aim-disclosure>summary{display:flex;align-items:center;gap:8px;min-height:44px;font-size:.75rem;font-weight:600;color:var(--secondary);list-style:none;cursor:pointer}
#skyMapView[data-explore-stage="search"] #candidateWorkspaceAction .aim-disclosure>summary::before{content:'›';display:inline-block;font-size:1.25rem;font-weight:400;color:var(--accent);transform-origin:center}
#skyMapView[data-explore-stage="search"] #candidateWorkspaceAction .aim-disclosure[open]>summary::before{transform:rotate(90deg)}
#skyMapView[data-explore-stage="search"] #candidateWorkspaceAction .aim-disclosure>summary::-webkit-details-marker{display:none}
#skyMapView[data-explore-stage="search"] #candidateWorkspaceAction .aim-disclosure>p{font-size:.75rem;line-height:1.7;margin:8px 0}
#skyMapView[data-explore-stage="search"] #candidateWorkspaceAction .aim-disclosure label{font-size:.75rem;line-height:1.7}
#skyMapView[data-explore-stage="search"] #candidateWorkspaceAction :is(select,input){font-size:16px;min-height:44px;max-width:100%}
#skyMapView[data-explore-stage="search"] #candidateSearchAction,#skyMapView[data-explore-stage="search"] .explore-show-result{min-height:44px;margin:0;padding:10px 12px;border-radius:10px;box-sizing:border-box;font-size:.88rem;font-weight:700;line-height:1.5;box-shadow:none}
#skyMapView[data-explore-stage="search"] #candidateSearchAction{width:100%;min-height:48px}
#skyMapView[data-explore-stage="search"] #candidateSearchAction{background:transparent;color:var(--accent);border:1px solid var(--line)}
#skyMapView[data-explore-stage="search"] #candidateSearchAction:disabled{opacity:.5;cursor:not-allowed}
#skyMapView[data-explore-stage="search"] #candidateSearchAction[data-state="searching"]{background:var(--card);color:var(--accent);border-color:var(--accent)}
#skyMapView[data-explore-stage="search"] .explore-show-result{width:100%;min-height:48px;display:flex;align-items:center;justify-content:center;gap:8px;white-space:nowrap;background:var(--accent);color:var(--on-accent);border:1px solid var(--accent)}
#skyMapView[data-explore-stage="search"] .explore-show-result svg{flex:none;width:20px;height:20px}
#skyMapView[data-explore-stage="search"] #exploreSearchResults{width:100%;max-width:none;margin:12px 0 0;padding:0;border:0}
#skyMapView[data-explore-stage="search"] #exploreResultsHeading{margin:16px 0 12px}
#skyMapView[data-explore-stage="search"] #candidateSearchEmpty:empty{display:none}
#skyMapView[data-explore-stage="search"] #candidateSearchEmpty{margin:0;padding:0;background:transparent;border:0;border-radius:0;font-size:.75rem;line-height:1.7;text-align:left;color:var(--secondary)}
#skyMapView[data-explore-stage="search"] #candidateSearchFeedback:empty,#skyMapView[data-explore-stage="search"] #candidateSearchCredits:empty{display:none}
#skyMapView[data-explore-stage="search"] #candidateSearchFeedback>[role="status"]:empty{display:none}
#skyMapView[data-explore-stage="search"] #candidateSearchFeedback>[role="status"]{font-size:.75rem;line-height:1.7;margin:0 0 12px;color:var(--secondary)}
#skyMapView[data-explore-stage="search"] #candidateSearchFeedback .candidate-wait{background:var(--sunk);border-radius:10px;padding:12px}
#skyMapView[data-explore-stage="search"] #exploreSearchResults #recentCandidates{overflow:visible}
#skyMapView[data-explore-stage="search"] #candidateListControls{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 12px;align-items:center;border:0;margin:0!important;padding:0!important}
#skyMapView[data-explore-stage="search"] .candidate-filter-fields{grid-column:1/-1;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0}
#skyMapView[data-explore-stage="search"] .candidate-filter-fields>label{display:flex!important;flex-direction:column;align-items:stretch!important;gap:4px!important;margin:0!important;font-size:.72rem!important;color:var(--secondary)}
#skyMapView[data-explore-stage="search"] .candidate-filter-fields select{background-color:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 28px 8px 10px;color:var(--text)}
#skyMapView[data-explore-stage="search"] .candidate-list-actions{grid-column:2;grid-row:2;align-items:center;justify-content:flex-end;gap:8px!important}
#skyMapView[data-explore-stage="search"] .candidate-list-actions button{flex:0 1 auto;width:auto;min-height:44px;padding:6px 10px;border:1px solid var(--line);border-radius:9px;background:transparent;font-size:.75rem;font-weight:700;color:var(--accent);box-shadow:none}
#skyMapView[data-explore-stage="search"] .candidate-filter-status{grid-column:1;grid-row:2;font-size:.72rem;line-height:1.6;color:var(--secondary);margin:0!important;font-variant-numeric:tabular-nums}
#skyMapView[data-explore-stage="search"] #candidateListControls>:is(.candidate-list-heading,#candidateUnifiedResults,#candidateMapPanel){grid-column:1/-1}
#skyMapView[data-explore-stage="search"] .candidate-list-heading{margin:0!important;background:var(--sunk);border-radius:9px 9px 0 0;padding:0 10px;grid-template-columns:minmax(0,1fr) 52px 80px!important;gap:8px!important}
#skyMapView[data-explore-stage="search"] .candidate-list-heading button{font-size:.75rem!important;font-weight:700!important}
#skyMapView[data-explore-stage="search"] #candidateUnifiedResults>.list-item{grid-template-columns:minmax(0,1fr) 52px 80px!important;column-gap:8px!important;padding:12px 10px!important;border-bottom:1px solid var(--line);border-radius:0;background:transparent;box-shadow:none}
#skyMapView[data-explore-stage="search"] #candidateUnifiedResults [data-candidate-place]{font-size:.88rem!important;line-height:1.5;font-weight:600!important}
#skyMapView[data-explore-stage="search"] #candidateUnifiedResults :is([data-candidate-time],[data-place-kind]){font-size:.81rem!important;line-height:1.6}
#skyMapView[data-explore-stage="search"] #candidateUnifiedResults .sub-line{font-size:.69rem;line-height:1.6;color:var(--secondary)}
#skyMapView[data-explore-stage="search"] #candidateSearchCredits p{margin:8px 0 0;font-size:.63rem;color:var(--tertiary)}
#skyMapView[data-explore-stage="search"] :is(button,summary,select):focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (hover:hover){#skyMapView[data-explore-stage="search"] :is(#candidateSearchAction,.candidate-list-actions button):hover{background:var(--sunk)}#skyMapView[data-explore-stage="search"] #candidateUnifiedResults>.list-item:hover{background:var(--sunk)}}
@media(min-width:760px){
 #skyMapView[data-explore-stage="search"] .explore-condition-fields{gap:14px}
 #skyMapView[data-explore-stage="search"] #exploreConditions .condition-field,#skyMapView[data-explore-stage="search"] #exploreConditions .condition-field:has(.condition-clear){grid-template-columns:104px minmax(0,1fr)!important;gap:16px}
 #skyMapView[data-explore-stage="search"] #skyMapAlignmentDetails{grid-template-columns:104px minmax(0,1fr);gap:16px}
 #skyMapView[data-explore-stage="search"] .candidate-filter-fields>label{display:grid!important;grid-template-columns:auto minmax(0,1fr)!important;align-items:center!important;gap:10px!important}
 #skyMapView[data-explore-stage="search"] .candidate-list-heading,#skyMapView[data-explore-stage="search"] #candidateUnifiedResults>.list-item{grid-template-columns:minmax(0,1fr) 96px 144px!important}
}
@media(max-width:359px){
 #skyMapView[data-explore-stage="search"] .candidate-filter-status{grid-column:1/-1}
 #skyMapView[data-explore-stage="search"] .candidate-list-actions{grid-column:1/-1;grid-row:3}
}
@media(prefers-reduced-motion:reduce){
 #skyMapView[data-explore-stage="search"] #skyMapObserverDetails[open] #exploreHeightFields,#skyMapView[data-explore-stage="search"] #skyMapObserverDetails:not([open]) .height-summary-values{animation:none}
}

html:has(#skyMapView[data-explore-stage="search"]),body:has(#skyMapView[data-explore-stage="search"]){overscroll-behavior-y:none}
html:has(#skyMapView.explore-mounted:not([hidden])){scroll-padding-bottom:calc(var(--sky-footer-h,100px) + 12px)}
@media(max-width:959px){#skyMapView[data-explore-stage="search"] .sky-map-footer{transform:translate3d(0,0,0);backface-visibility:hidden}}
main:has(>#skyMapView.explore-mounted:not([hidden]))>#footer>summary{min-height:44px;display:list-item;padding-block:12px}
`;document.head.append(style);
document.addEventListener('astronotes-composition-change',updateConditions);
// 探すを開いた時点で塔の模型を読み始め、地点を選んだ後の待ちから外す。
const warmModels=()=>{if(/^#\/explore/.test(location.hash)&&eligible())AstroNotesAssets.ensureModels().catch(()=>{});};addEventListener('hashchange',warmModels);setTimeout(warmModels,0);
globalThis.TrialExplore={candidateWorkspace:()=>layout.mounted?mainCandidateWorkspace:null,active,ownsScene,render,routeChanged,preferMap:()=>{transferMode='map';if(active())choose('map');},sync,invalidate:()=>{plan.forgetFrame();SkyMapUI.render();sync(true);},sceneDraw,assertScene,
 camera:()=>{let timelapse=null;try{if(plan.frameKey===stamp(snapshot())&&AstroNotesTimelapse.settings(look._timelapseConfig))timelapse={...look._timelapseConfig};}catch(e){globalThis.AstroNotesErrors?.note('explore.timelapse',e);
 }return {l:{...aimLens,focal:Number(look.querySelector('[data-lens-focal]')?.value)||aimLens.focal||50},pan:[...(look._lensOffset||[0,0])],timelapse};}};
document.addEventListener('visibilitychange',()=>{if(document.hidden)invalidate();else sync();});
window.addEventListener('resize',()=>{if(active())sync();});
routeChanged();
})();

/* Legacy global names remain aliases for cached integrations. */
if(typeof AstroNotesAssets!=='undefined')globalThis.SoramiAssets=AstroNotesAssets;if(typeof AstroNotesAtmosphere!=='undefined')globalThis.SoramiAtmosphere=AstroNotesAtmosphere;if(typeof AstroNotesBodies!=='undefined')globalThis.SoramiBodies=AstroNotesBodies;
if(typeof AstroNotesSkyMap!=='undefined')globalThis.SoramiSkyMap=AstroNotesSkyMap;
