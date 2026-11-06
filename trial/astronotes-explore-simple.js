/*
 * AstroNotes — 探すの見え方job（SkyMapUI sessionの読取口と描画世代）
 *
 * 編集条件の正本はSkyMapUIのsessionのまま。ここは読取snapshotとcache key、
 * 描画jobの世代（epoch/frameKey/frameBase/pendingKey）だけを持ち、DOMに触れない（2026-10-29 構造整理）。
 * cache keyのフィールドと並びは旧exploreと同じ。変えると描き直し判定が変わる。
 */
(function (global) {
  "use strict";

  function create(deps) {
    const { readRenderState, clone, getAuthGeneration, dayStart, getAirMode, getAtmosphereKey, onInvalidate } = deps;
    let epoch = 0, frameKey = "", frameBase = "", pendingKey = "";

    function snapshot() { return clone(readRenderState()); }
    function stamp(s) { return JSON.stringify([getAuthGeneration(), s.body, s.target, s.observer, s.ground, s.eyeM, s.partId, s.limb, s.matchMode, dayStart(s.at), getAirMode(), getAtmosphereKey()]); }
    function baseStamp(s) { return JSON.stringify([getAuthGeneration(), s.body, s.target, s.observer, s.ground, s.eyeM, s.partId, s.limb, s.matchMode, getAirMode()]); }
    function invalidate(keepScene = false) { epoch++; frameKey = ""; frameBase = ""; pendingKey = ""; if (onInvalidate) onInvalidate(keepScene); }
    // soft refreshは前の見え方を残すため、invalidate後もframeBaseを戻す
    function begin(key, soft) { const keep = frameBase; invalidate(soft); if (soft) frameBase = keep; pendingKey = key; return epoch; }
    function current(run) { return run === epoch; }
    function matches(key) { return stamp(snapshot()) === key; }
    function commit(key, s) { frameKey = key; frameBase = baseStamp(s); }
    // 古いjobのfinallyは無視する
    function settle(run) { if (run !== epoch) return false; pendingKey = ""; return true; }
    function forgetFrame() { frameKey = ""; }

    return {
      snapshot, stamp, baseStamp, invalidate, begin, current, matches, commit, settle, forgetFrame,
      get epoch() { return epoch; },
      get frameKey() { return frameKey; },
      get frameBase() { return frameBase; },
      get pendingKey() { return pendingKey; },
    };
  }

  const api = { create };
  global.AstroNotesPlanningSession = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
/* 探す: portal adapter that moves the existing map/aim DOM into the explore layout and restores it. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesExploreLayout=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const DATES_OPEN_KEY='astronotes.exploreDatesOpen';
function create(deps){
 const {$,node,store,mapView,aimView,skyInfo,tabs,scene,map,aimState,requestAnimationFrame,getMode,isAimActive,showResult,candidateChosen,addSaveAction,updateConditions,choose,invalidate,placePins,updateSkyInfo}=deps;
 let mounted=false,aimHome=null,aimChildren=[],mapHomes=[],buffer=null,workspaceHome=null,heightWasOpen=false,heightFields=null;
 let conditions=null,conditionHomes=[];
 // Candidate dates live in the fixed time bar so choosing one never scrolls them away from under the finger.
 function mountDates(candidates){
  const toggle=node('button',{type:'button',id:'exploreDatesToggle',className:'explore-dates-toggle'});toggle.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';toggle.setAttribute('aria-controls','skyMapDates');
  const show=open=>{candidates.classList.toggle('dates-collapsed',!open);toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',open?'候補日を折りたたむ':'候補日を開く');};
  toggle.onclick=()=>{const open=candidates.classList.contains('dates-collapsed');show(open);store.set(DATES_OPEN_KEY,open);};
  show(store.get(DATES_OPEN_KEY,true)!==false);candidates.prepend(toggle);mapView.querySelector('.sky-map-footer').prepend(candidates);
 }
 function unmountDates(){
  const candidates=mapView.querySelector('.sky-map-candidates');$('exploreDatesToggle').remove();candidates.classList.remove('dates-collapsed');mapView.querySelector('.sky-map-wrap').before(candidates);
 }
 function mount(){
  if(mounted)return;mounted=true;const aim=aimState();aim.fromSeq++;aim.lookSeq++;heightWasOpen=$('skyMapObserverDetails').open;$('skyMapObserverDetails').open=false;mapView.classList.add('explore-mounted');heightFields=node('div',{id:'exploreHeightFields'});const heights=$('skyMapObserverDetails');for(const row of heights.querySelectorAll('.aim-observer-height')){const value=node('div',{className:'explore-height-value'}),input=row.querySelector('input'),unit=row.querySelector('span');input.before(value);value.append(input,unit);heightFields.append(row);}heights.insertBefore(heightFields,$('skyMapHeightError'));
  const candidates=mapView.querySelector('.sky-map-candidates');candidates.after(skyInfo,tabs,scene,map);
  mountDates(candidates);
  conditions=node('details',{id:'exploreConditions',className:'explore-conditions',open:true});const summary=node('summary');summary.append(node('span',{id:'exploreConditionTitle'}),node('span',{id:'exploreConditionDetail'}),node('span',{className:'explore-condition-edit'},'条件を編集'));conditions.append(summary);
  // Wait for the native summary action to expand the fields before returning to them.
  summary.addEventListener('click',()=>requestAnimationFrame(()=>{if(mounted&&conditions?.open)mapView.scrollIntoView({block:'start',behavior:'auto'});}));
  const controls=mapView.querySelector('.sky-map-controls'),observer=$('skyMapChoose').closest('.aim-say-from'),alignment=$('skyMapAlignmentDetails');conditionHomes=[controls,observer,alignment].map(n=>({n,parent:n.parentNode,next:n.nextSibling}));controls.before(conditions);const fields=node('div',{className:'explore-condition-fields'});
  fields.setAttribute('role','group');fields.setAttribute('aria-labelledby','exploreSearchHeading');
  const heading=node('div',{className:'explore-search-intro'});heading.append(node('h2',{id:'exploreSearchHeading',className:'explore-section-title'},'撮影条件'),node('p',{className:'tiny'},'天体と目標物を選んで、撮影できる場所を探す。'));fields.append(heading);
  fields.append(controls,observer,alignment,node('div',{id:'candidateWorkspaceAction'}));
  conditions.append(fields);
  const confirm=node('button',{id:'exploreShowResult',type:'button',className:'chip explore-show-result'},'結果を確認');confirm.onclick=showResult;fields.querySelector('#candidateWorkspaceAction').append(confirm);conditions.addEventListener('toggle',()=>{summary.querySelector('.explore-condition-edit').textContent=conditions.open?'条件を閉じる':'条件を編集';});
  $('skyMapDates').addEventListener('click',candidateChosen);
  aimHome={parent:aimView.parentNode,next:aimView.nextSibling};
  const workspace=aimView.querySelector('.preview-workspace');workspaceHome={node:workspace,parent:workspace.parentNode,next:workspace.nextSibling};aimView.append(workspace);
  aimChildren=[...aimView.children];buffer=node('div',{hidden:true,inert:true,id:'exploreRetiredConditions'});
  for(const child of aimChildren)if(!child.classList.contains('preview-workspace')&&child.tagName!=='DIALOG')buffer.append(child);
  aimView.append(buffer);scene.append(aimView);aimView.hidden=false;
  const inner=$('previewScene');inner.removeAttribute('role');inner.removeAttribute('aria-labelledby');inner.hidden=false;
  const wrap=mapView.querySelector('.sky-map-wrap'),footer=mapView.querySelector('.sky-map-footer');
  mapHomes=[];for(let n=wrap;n&&n!==footer;){const next=n.nextElementSibling;mapHomes.push({n,parent:n.parentNode,next:n.nextSibling});map.append(n);n=next;}
  wrap.id=wrap.id||'exploreMapFigure';
  $('skyMapTitle').textContent='探す';addSaveAction($('skyMapShareRow'),'skymap');updateConditions();choose(getMode());
 }
 function unmount(){
  if(!mounted)return;invalidate();mounted=false;placePins();$('skyMapObserverDetails').open=heightWasOpen;for(const value of heightFields.querySelectorAll('.explore-height-value')){for(const child of [...value.children])value.before(child);value.remove();}for(const row of [...heightFields.children])heightFields.before(row);heightFields.remove();heightFields=null;scene.style.minHeight='';scene.removeAttribute('data-loading');scene.removeAttribute('aria-busy');
  for(const h of [...conditionHomes].reverse())h.parent.insertBefore(h.n,h.next?.parentNode===h.parent?h.next:null);conditions.remove();conditions=null;conditionHomes=[];mapView.querySelectorAll('.explore-save').forEach(b=>b.remove());
  $('skyMapDates').removeEventListener('click',candidateChosen);
  for(const h of [...mapHomes].reverse())h.parent.insertBefore(h.n,h.next?.parentNode===h.parent?h.next:null);
  unmountDates();
  for(const child of aimChildren)aimView.append(child);
  buffer.remove();workspaceHome.parent.insertBefore(workspaceHome.node,workspaceHome.next?.parentNode===workspaceHome.parent?workspaceHome.next:null);aimHome.parent.insertBefore(aimView,aimHome.next?.parentNode===aimHome.parent?aimHome.next:null);
  aimView.hidden=!isAimActive();$('previewScene').setAttribute('role','tabpanel');$('previewScene').setAttribute('aria-labelledby','previewSceneTab');
  skyInfo.remove();updateSkyInfo(null);tabs.remove();scene.remove();map.remove();mapView.classList.remove('explore-mounted');$('skyMapTitle').textContent='探す';
 }
 return {mount,unmount,get mounted(){return mounted;},get conditions(){return conditions;}};
}
return {create};
});
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
 try{let text='';if(s.body==='moon'){const moon=AstroNotesAstro.moon(s.at,o);text=moonGlyphAt(s.at,o)+' 輝面 '+Math.round(moon.illuminatedFraction*100)+'% ・ '+esc(lightTimingText(s.at,o));}else if(!AstroNotesBodies.definition(s.body).limbs){text=esc(AstroNotesBodies.sky(AstroNotesAstro.sun(s.at,o).geometricAltitude));}skyInfo.innerHTML=text;skyInfo.hidden=!text;}catch{skyInfoKey='';skyInfo.hidden=true;skyInfo.textContent='';}
}
const plan=AstroNotesPlanningSession.create({readRenderState:()=>SkyMapUI.renderState(),clone:v=>structuredClone(v),getAuthGeneration:()=>accessState.generation,dayStart:at=>AstroNotesSkyMap.dayStart(at),getAirMode:()=>aimAirSettings.mode,getAtmosphereKey:()=>AstroNotesAtmosphere.dataKey?.(),
 onInvalidate:(keepScene=false)=>{if(!keepScene)look._lookSeq=(look._lookSeq||0)+1;look._planKey=null;if(look._captionTimer){clearTimeout(look._captionTimer);look._captionTimer=0;}}});
const stamp=plan.stamp,baseStamp=plan.baseStamp,snapshot=plan.snapshot,invalidate=plan.invalidate;
// 候補ピンの切替は地図だけに効くので、地図の下（共有の行）へ置く（2026-10-22 ユーザー「候補ピンは下に下ろしてほしい」）
function placePins(){const row=$('skyMapShareRow'),all=[...document.querySelectorAll('#shootingPins')],t=all.find(x=>x.parentNode!==row)||all[0];if(!t)return;for(const x of all)if(x!==t)x.remove();if(layout.mounted){if(row&&t.parentNode!==row)row.prepend(t);}else{const head=$('mySkyPlaces')?.querySelector('.my-head');if(head&&t.parentNode!==head)head.append(t);}}
new MutationObserver(()=>{if(layout.mounted)placePins();}).observe(mapView,{childList:true,subtree:true});
function conditionText(s){
 const body=AstroNotesBodies.definition(s?.body)?.name||'天体を選ぶ',target=s?.target?.name||'対象を選ぶ',extras=s?.target?aimSceneExtraTargets(s.target.id).length:0;
 const part=s?.target?.parts?.find(p=>p.id===s.partId)||s?.target?.parts?.[0];
 const alignment=s?.matchMode==='overlap'?'全体に重なる':s?.partId==='__whole'?(s.target?.wholeLabel||'建物全体に重なる'):`${part?.name||'対象'}・${AstroNotesAlign.limbById(s?.limb||'center').name}`;
 const height=s?.observer?$('skyMapObserverSummary')?.textContent?.trim().replace(/^高さ\s*[:：]?\s*/,''):'';
 return {title:body+' × '+target+(extras?'ほか'+extras+'件':''),detail:(s?.observer?.name||'撮影地点を選ぶ')+(height?' · '+height:'')+(s?.target?' · '+(s.candidateOpportunity?.at===s.at&&s.candidateOpportunity?.targetId===s.target?.id&&s.candidateOpportunity?.relation==='near'?'候補の時刻':globalThis.AstroNotesTrialComposition?.label?.(s)||alignment):'')};
}
function updateConditions(){
 if(!layout.mounted||!layout.conditions)return;const s=SkyMapUI.selectionState(),text=conditionText(s);
 for(const [id,value] of [['exploreConditionTitle',text.title],['exploreConditionDetail',text.detail]])if($(id).textContent!==value)$(id).textContent=value;
 syncWorkspace();const confirm=$('exploreShowResult');confirm.disabled=false;confirm.textContent=!s?.target?'対象を選んで見え方を確認':!s?.observer?'撮影地点を指定して確認':'この地点の見え方を確認';
 for(const b of mapView.querySelectorAll('[data-quick-save]')){b.hidden=false;b.disabled=b.dataset.planSource==='skymap'?!!$('skyMapShareRow').querySelector('[data-plan-action="share"]')?.disabled:!!plan.pendingKey||!plan.frameKey||look.hidden;}
}
function showResult(){
 if(!layout.mounted)return;const selected=SkyMapUI.selectionState();if(!selected?.target){$('skyMapTargetOpen').click();return;}if(!selected?.observer){$('skyMapChoose').click();return;}enterResult();layout.conditions.open=false;
 scene.tabIndex=-1;scene.focus({preventScroll:true});scene.style.scrollMarginTop=(layout.conditions.getBoundingClientRect().height+12)+'px';scene.scrollIntoView({block:'start',behavior:'auto'});if(mode==='scene')sync();
}
function addSaveAction(row,source){
 if(!row||row.querySelector('[data-quick-save]'))return;
 const point=node('button',{type:'button',className:'plan-trigger explore-save'});point.setAttribute('aria-label','撮影地点に保存');point.title='撮影地点に保存';point.dataset.quickSave='place';point.dataset.planSource=source;point.innerHTML='<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 10c0 5-6 11-6 11S3 15 3 10a6 6 0 1 1 12 0Z"/><circle cx="9" cy="10" r="2.5"/><path data-place-add d="M19 3v6m-3-3h6"/></svg>';row.append(point);
 const b=node('button',{type:'button',className:'plan-trigger explore-save'});b.setAttribute('aria-label','予定に追加');b.title='予定に追加';b.innerHTML='<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6M7 2v4M17 2v4M3 9h18M18 14v8M14 18h8"/></svg>';b.dataset.quickSave='plan';b.dataset.planSource=source;row.append(b);updateConditions();
}
function canFrame(s){return eligible()&&AstroNotesAccess.canFrame(toolAllowed,s.target.id,s.body);}
function menu(){
 const combined=eligible(),f=$('framingMenu'),m=$('mapMenu');
 if(combined){f.hidden=true;m.hidden=false;m.dataset.tool='#/explore';m.querySelector('b').lastChild.textContent='探す';m.querySelector('span').textContent='条件を選び、見え方と地図で確かめる';}
 else{f.dataset.tool='#/aim/tower';m.dataset.tool='#/skymap';m.querySelector('b').lastChild.textContent='探す';m.querySelector('span').textContent='撮影地点からの天体の方向と高度を調べる';}
}

let resultRequested=false,selectionPending=false,flowOwner=null,flowGeneration=null;
let searchRoot=null,candidatePanelHome=null,searchStarted=false,returnIntent=null,pendingScroll=null;
const candidateBack=node('button',{id:'exploreBackToCandidates',type:'button',className:'chip',hidden:true},'‹ 探すへ戻る');scene.prepend(candidateBack);
const resultActive=()=>active()&&resultRequested;
const mainSearchActive=()=>active()&&!resultRequested&&!selectionPending&&flowOwner===auth?.loginId&&flowGeneration===accessState.generation;
function ensureSearchRoot(){
 if(!layout.mounted)return;
 if(!searchRoot){
  searchRoot=node('section',{id:'exploreSearchResults'});searchRoot.setAttribute('aria-labelledby','exploreResultsHeading');
  const heading=node('div',{className:'explore-results-heading'});heading.append(node('h2',{id:'exploreResultsHeading'},'撮影候補'),node('span',{className:'tiny'},'場所と時刻を選んで、見え方へ'));
  searchRoot.append(heading,node('p',{id:'candidateSearchEmpty',className:'tiny'},'条件を選んで「候補を探す」を押すと、ここに候補が出ます。'),node('div',{id:'candidateSearchFeedback'}),node('div',{id:'candidateSearchCredits'}));
 }
 if(!searchRoot.isConnected)layout.conditions.after(searchRoot);
 const panel=$('recentCandidates');if(panel.parentNode!==searchRoot){candidatePanelHome={parent:panel.parentNode,next:panel.nextSibling};searchRoot.insertBefore(panel,$('candidateSearchCredits'));panel.setAttribute('role','region');panel.setAttribute('aria-label','撮影候補の一覧');panel.removeAttribute('aria-labelledby');}
}
function restoreSearchScroll(count){
 if(!pendingScroll||!mainSearchActive()||count<pendingScroll.count)return;
 const saved=pendingScroll;pendingScroll=null;requestAnimationFrame(()=>{if(mainSearchActive())document.scrollingElement.scrollTop=saved.top;});
}
function syncWorkspace(){
 if(!layout.mounted)return;ensureSearchRoot();
 if(flowOwner!==auth?.loginId||flowGeneration!==accessState.generation){resultRequested=false;selectionPending=false;searchStarted=false;returnIntent=null;pendingScroll=null;flowOwner=auth?.loginId;flowGeneration=accessState.generation;invalidate();}
 mapView.dataset.exploreStage=resultRequested?'preview':'search';
 layout.conditions.hidden=resultRequested;if(!resultRequested)layout.conditions.open=true;
 searchRoot.hidden=resultRequested;scene.hidden=!resultRequested;candidateBack.hidden=!resultRequested;
 $('recentCandidates').hidden=resultRequested||!searchStarted;$('candidateSearchEmpty').hidden=searchStarted;
 candidateBack.textContent=returnIntent?.searched?'‹ 候補へ戻る':'‹ 探すへ戻る';
 document.dispatchEvent(new Event('astronotes-search-state'));
}
function captureSearch(){
 const s=SkyMapUI.selectionState();if(!s)return;
 returnIntent={owner:auth.loginId,generation:accessState.generation,selection:structuredClone(s),custom:structuredClone(SkyMapUI.workspaceHost()?.session.custom??null),customTarget:structuredClone(SkyMapUI.workspaceHost()?.session.customTarget??null),searched:searchStarted,scrollTop:document.scrollingElement.scrollTop,count:globalThis.AstroNotesCandidatePicker?.visibleRows().length||0};
}
function enterResult(){
 if(!selectionPending)captureSearch();selectionPending=false;resultRequested=true;syncWorkspace();
}
function showSearch(){
 if(!returnIntent&&active())captureSearch();const saved=returnIntent;if(!active()||!saved||saved.owner!==auth?.loginId||saved.generation!==accessState.generation)return;
 resultRequested=false;selectionPending=true;invalidate();look.hidden=true;
 const s=saved.selection;SkyMapUI.setTarget(s.target.id);
 // Restore the full target as well: custom target coordinates/heights are part of the search.
 SkyMapUI.workspaceHost()?.restoreTarget({target:structuredClone(s.target),custom:saved.custom,customTarget:saved.customTarget});
 const body=$('skyMapBody');body.value=s.body;body.dispatchEvent(new Event('change',{bubbles:true}));SkyMapUI.setAlignment(s.partId,s.limb,s.matchMode);SkyMapUI.setTime(s.at);
 SkyMapUI.workspaceHost()?.restoreObserver(structuredClone(s.observer));selectionPending=false;searchStarted=saved.searched;pendingScroll={top:saved.scrollTop,count:saved.count};syncWorkspace();if(!searchStarted)restoreSearchScroll(0);
}
function leaveSearchFlow(){
 resultRequested=false;selectionPending=false;searchStarted=false;returnIntent=null;pendingScroll=null;candidateBack.hidden=true;
 const panel=$('recentCandidates');if(candidatePanelHome&&panel){candidatePanelHome.parent.insertBefore(panel,candidatePanelHome.next?.parentNode===candidatePanelHome.parent?candidatePanelHome.next:null);panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby','placeTab-candidates');panel.removeAttribute('aria-label');candidatePanelHome=null;}
 searchRoot?.remove();delete mapView.dataset.exploreStage;
}
const mainCandidateWorkspace={epoch:()=>flowGeneration,previewWidth:()=>Math.max(200,Math.round(Math.min(780,mapView.clientWidth||320))),active:mainSearchActive,selectable:()=>mainSearchActive()&&!$('placeSheet').open,visible:()=>searchStarted,
 reveal(){if(!mainSearchActive())return;const first=!searchStarted;searchStarted=true;$('recentCandidates').hidden=false;$('candidateSearchEmpty').hidden=true;if(first)globalThis.MyPlacesUI?.renderPickerPanel($('recentCandidates'));},
 reset(){if(searchStarted)$('candidateSearchEmpty').textContent='条件を変更しました。「候補を探す」で新しい候補を確認できます。';searchStarted=false;$('recentCandidates').hidden=true;$('candidateSearchEmpty').hidden=false;},
 restoreScroll:restoreSearchScroll,scroller:()=>document.scrollingElement};
candidateBack.onclick=showSearch;
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
 const soft=!!plan.frameBase&&plan.frameBase===baseStamp(s)&&!look.hidden&&!!look.querySelector('[data-look-canvas]');
 reserveScene();run=plan.begin(key,soft);project(s);if(soft)updateRetainedTime(s);scene.setAttribute('aria-busy','true');
 if(!soft){look.hidden=true;scene.dataset.loading='true';message('見え方を計算中…');}
  await AstroNotesAssets.ensureModels();await AstroNotesBodies.ensure(s.body);
  if(!plan.current(run)||!resultActive()||mode!=='scene'||!plan.matches(key))return;
  if(aimAirEnsure(aim.from,aim.dayMs))return;
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
 AstroNotesAssets.ensureModels().then(()=>{if(generation!==accessState.generation||loginId!==auth?.loginId||hash!==location.hash||!viewState.aim||!eligible())return;openAim(preset||null);if(restored){aim.pendingPlan=restored;flowOwner=loginId;flowGeneration=generation;resultRequested=true;}mode=desiredMode;SkyMapUI.enter(true,restored?.at);}).finally(()=>{routing=false;if(transferMode&&viewState.aim&&eligible())routeChanged();});
}
function routeChanged(){render();}
function sceneDraw(host,at){
 if(host!==look||!resultActive()||mode!=='scene'||!intent||plan.pendingKey||!plan.frameKey)return;
 try{const s=snapshot();if(stamp(s)===plan.frameKey&&Math.abs(s.at-at)>.5)SkyMapUI.setTime(at);}catch{}
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
"#skyMapView[data-explore-stage=\"search\"] #exploreScenePanel,#skyMapView[data-explore-stage=\"search\"] #exploreMapPanel,#skyMapView[data-explore-stage=\"search\"] #exploreSkyInfo,#skyMapView[data-explore-stage=\"search\"] .sky-map-candidates{display:none!important}#skyMapView[data-explore-stage=\"preview\"] #exploreConditions,#skyMapView[data-explore-stage=\"preview\"] #exploreSearchResults{display:none!important}#exploreBackToCandidates{min-height:44px;margin:0 0 12px}"+
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
style.textContent+="\nmain:has(>#skyMapView[data-explore-stage=\"search\"]){max-width:1280px}\n#skyMapView[data-explore-stage=\"search\"] #exploreConditions{max-width:none;margin:0;border:0;border-radius:0;background:transparent;position:static}\n#skyMapView[data-explore-stage=\"search\"] #exploreConditions>summary{display:none}\n#skyMapView[data-explore-stage=\"search\"] .explore-condition-fields{padding:0;display:grid;grid-template-columns:minmax(0,1fr);gap:12px}\n#skyMapView[data-explore-stage=\"search\"] .explore-section-title,#skyMapView[data-explore-stage=\"search\"] .explore-results-heading h2{font-size:1.1rem;font-weight:700;line-height:1.5;margin:0}\n#skyMapView[data-explore-stage=\"search\"] .explore-search-intro{padding:0 0 8px}\n#skyMapView[data-explore-stage=\"search\"] .explore-search-intro p{font-size:.75rem;line-height:1.6;margin:4px 0 0;color:var(--secondary)}\n#skyMapView[data-explore-stage=\"search\"] .sky-map-controls{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;margin:0;max-width:none}\n#skyMapView[data-explore-stage=\"search\"] #exploreConditions .condition-field,#skyMapView[data-explore-stage=\"search\"] #exploreConditions .condition-field:has(.condition-clear){grid-template-columns:80px minmax(0,1fr)!important;gap:10px;margin:0;max-width:none;align-items:start}\n#skyMapView[data-explore-stage=\"search\"] .condition-field>.condition-label{display:flex;grid-column:1;grid-row:1;align-items:center;gap:6px;min-height:48px;font-size:.75rem;font-weight:600;color:var(--secondary);white-space:nowrap}\n#skyMapView[data-explore-stage=\"search\"] .condition-field>.condition-label>svg{width:20px;height:20px;margin:0;align-self:auto;stroke-width:1.8}\n#skyMapView[data-explore-stage=\"search\"] .condition-field>.condition-label>span{position:static;width:auto;height:auto;padding:0;margin:0;overflow:visible;clip-path:none;white-space:nowrap}\n#skyMapView[data-explore-stage=\"search\"] .condition-field>.condition-label{width:auto}\n#skyMapView[data-explore-stage=\"search\"] .condition-field :is(.condition-choice,.preview-body-open,.preview-target-open){height:auto;min-height:48px;border-radius:10px;font-size:16px;font-weight:600;padding:10px 12px;box-shadow:none}\n#skyMapView[data-explore-stage=\"search\"] .condition-choice>span{white-space:normal;overflow-wrap:anywhere;text-overflow:clip;line-height:1.5}\n#skyMapView[data-explore-stage=\"search\"] .aim-say-from{margin:0;max-width:none}\n#skyMapView[data-explore-stage=\"search\"] .aim-observer-card{background:transparent;border-radius:0}\n#skyMapView[data-explore-stage=\"search\"] .aim-observer-card>.place-row{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:0 6px 0 12px;box-shadow:none}\n#skyMapView[data-explore-stage=\"search\"] .condition-field .place-pick{min-height:48px;padding:8px 0;gap:8px}\n#skyMapView[data-explore-stage=\"search\"] .place-row .name{font-size:16px;line-height:1.5;font-weight:600}\n#skyMapView[data-explore-stage=\"search\"] .place-row .muted{font-size:.69rem;line-height:1.5}\n#skyMapView[data-explore-stage=\"search\"] .aim-observer-card #skyMapObserverDetails{margin:0;padding:0;border:0}\n#skyMapView[data-explore-stage=\"search\"] #skyMapObserverSummary{min-height:44px;display:flex;align-items:center;font-size:.75rem;color:var(--secondary)}\n#skyMapView[data-explore-stage=\"search\"] #skyMapAlignmentDetails{margin:0 0 0 90px;padding:8px 0;border-top:1px solid var(--line)}\n#skyMapView[data-explore-stage=\"search\"] #candidateWorkspaceAction{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;margin:0}\n#skyMapView[data-explore-stage=\"search\"] #additionalCandidateSearch{display:contents}\n#skyMapView[data-explore-stage=\"search\"] #candidateWorkspaceAction .aim-disclosure{grid-column:1/-1;margin:0;padding:0;border:0}\n#skyMapView[data-explore-stage=\"search\"] #candidateWorkspaceAction .aim-disclosure>summary{display:flex;align-items:center;gap:8px;min-height:44px;border-top:1px solid var(--line);font-size:.75rem;font-weight:600;color:var(--secondary);list-style:none;cursor:pointer}\n#skyMapView[data-explore-stage=\"search\"] #candidateWorkspaceAction .aim-disclosure>summary::before{content:'›';display:inline-block;font-size:1.25rem;font-weight:400;color:var(--accent);transform-origin:center}\n#skyMapView[data-explore-stage=\"search\"] #candidateWorkspaceAction .aim-disclosure[open]>summary::before{transform:rotate(90deg)}\n#skyMapView[data-explore-stage=\"search\"] #candidateWorkspaceAction .aim-disclosure>summary::-webkit-details-marker{display:none}\n#skyMapView[data-explore-stage=\"search\"] #candidateWorkspaceAction .aim-disclosure>p{font-size:.75rem;line-height:1.7;margin:8px 0}\n#skyMapView[data-explore-stage=\"search\"] #candidateWorkspaceAction .aim-disclosure label{font-size:.75rem;line-height:1.7}\n#skyMapView[data-explore-stage=\"search\"] #candidateWorkspaceAction :is(select,input){font-size:16px;min-height:44px;max-width:100%}\n#skyMapView[data-explore-stage=\"search\"] #candidateSearchAction,#skyMapView[data-explore-stage=\"search\"] .explore-show-result{width:100%;min-height:48px;margin:0;padding:12px;border-radius:10px;box-sizing:border-box;font-size:.88rem;font-weight:700;line-height:1.5;box-shadow:none}\n#skyMapView[data-explore-stage=\"search\"] #candidateSearchAction{background:var(--accent);color:var(--on-accent);border:1px solid var(--accent)}\n#skyMapView[data-explore-stage=\"search\"] #candidateSearchAction:disabled{opacity:.5;cursor:not-allowed}\n#skyMapView[data-explore-stage=\"search\"] #candidateSearchAction[data-state=\"searching\"]{background:var(--card);color:var(--accent);border-color:var(--accent)}\n#skyMapView[data-explore-stage=\"search\"] .explore-show-result{background:transparent;color:var(--accent);border:1px solid var(--line)}\n#skyMapView[data-explore-stage=\"search\"] #exploreSearchResults{width:100%;max-width:none;margin:16px 0 0;padding:16px 0 0;border-top:1px solid var(--line)}\n#skyMapView[data-explore-stage=\"search\"] .explore-results-heading{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:4px 12px;margin:0 0 12px}\n#skyMapView[data-explore-stage=\"search\"] .explore-results-heading>.tiny{font-size:.69rem;color:var(--secondary)}\n#skyMapView[data-explore-stage=\"search\"] #candidateSearchEmpty{margin:0;padding:16px;background:transparent;border:1px dashed var(--line);border-radius:10px;font-size:.75rem;line-height:1.7;text-align:left;color:var(--secondary)}\n#skyMapView[data-explore-stage=\"search\"] #candidateSearchFeedback:empty,#skyMapView[data-explore-stage=\"search\"] #candidateSearchCredits:empty{display:none}\n#skyMapView[data-explore-stage=\"search\"] #candidateSearchFeedback>[role=\"status\"]:empty{display:none}\n#skyMapView[data-explore-stage=\"search\"] #candidateSearchFeedback>[role=\"status\"]{font-size:.75rem;line-height:1.7;margin:0 0 12px;color:var(--secondary)}\n#skyMapView[data-explore-stage=\"search\"] #candidateSearchFeedback .candidate-wait{background:var(--sunk);border-radius:10px;padding:12px}\n#skyMapView[data-explore-stage=\"search\"] #exploreSearchResults #recentCandidates{overflow:visible}\n#skyMapView[data-explore-stage=\"search\"] #candidateListControls{border:0;margin:0!important;padding:0!important}\n#skyMapView[data-explore-stage=\"search\"] .candidate-filter-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0 0 8px}\n#skyMapView[data-explore-stage=\"search\"] .candidate-filter-fields>label{display:flex!important;flex-direction:column;align-items:stretch!important;gap:4px!important;margin:0!important;font-size:.72rem!important;color:var(--secondary)}\n#skyMapView[data-explore-stage=\"search\"] .candidate-filter-fields select{background-color:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 28px 8px 10px;color:var(--text)}\n#skyMapView[data-explore-stage=\"search\"] .candidate-list-actions{align-items:center;justify-content:flex-end;gap:8px!important}\n#skyMapView[data-explore-stage=\"search\"] .candidate-list-actions button{flex:0 1 auto;width:auto;min-height:44px;padding:6px 10px;border:1px solid var(--line);border-radius:9px;background:transparent;font-size:.75rem;font-weight:700;color:var(--accent);box-shadow:none}\n#skyMapView[data-explore-stage=\"search\"] .candidate-filter-status{font-size:.72rem;line-height:1.6;color:var(--secondary);margin:8px 0!important;font-variant-numeric:tabular-nums}\n#skyMapView[data-explore-stage=\"search\"] .candidate-list-heading{margin:0!important;background:var(--sunk);border-radius:9px 9px 0 0;padding:0 10px;grid-template-columns:minmax(0,1fr) 52px 64px!important;gap:8px!important}\n#skyMapView[data-explore-stage=\"search\"] .candidate-list-heading button{font-size:.75rem!important;font-weight:700!important}\n#skyMapView[data-explore-stage=\"search\"] #candidateUnifiedResults>.list-item{grid-template-columns:minmax(0,1fr) 52px 64px!important;column-gap:8px!important;padding:12px 10px!important;border-bottom:1px solid var(--line);border-radius:0;background:transparent;box-shadow:none}\n#skyMapView[data-explore-stage=\"search\"] #candidateUnifiedResults [data-candidate-place]{font-size:.88rem!important;line-height:1.5;font-weight:600!important}\n#skyMapView[data-explore-stage=\"search\"] #candidateUnifiedResults :is([data-candidate-time],[data-place-kind]){font-size:.81rem!important;line-height:1.6}\n#skyMapView[data-explore-stage=\"search\"] #candidateUnifiedResults .sub-line{font-size:.69rem;line-height:1.6;color:var(--secondary)}\n#skyMapView[data-explore-stage=\"search\"] #candidateSearchCredits p{margin:8px 0 0;font-size:.63rem;color:var(--tertiary)}\n#skyMapView[data-explore-stage=\"search\"] :is(button,summary,select):focus-visible{outline:2px solid var(--accent);outline-offset:2px}\n@media (hover:hover){#skyMapView[data-explore-stage=\"search\"] :is(.explore-show-result,.candidate-list-actions button):hover{background:var(--sunk)}#skyMapView[data-explore-stage=\"search\"] #candidateUnifiedResults>.list-item:hover{background:var(--sunk)}}\n@media(min-width:760px){\n #skyMapView[data-explore-stage=\"search\"] .explore-condition-fields{gap:14px}\n #skyMapView[data-explore-stage=\"search\"] #exploreConditions .condition-field,#skyMapView[data-explore-stage=\"search\"] #exploreConditions .condition-field:has(.condition-clear){grid-template-columns:104px minmax(0,1fr)!important;gap:16px}\n #skyMapView[data-explore-stage=\"search\"] #skyMapAlignmentDetails{margin-left:120px}\n #skyMapView[data-explore-stage=\"search\"] #candidateWorkspaceAction{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}\n #skyMapView[data-explore-stage=\"search\"] #candidateWorkspaceAction .aim-disclosure{margin-left:120px}\n #skyMapView[data-explore-stage=\"search\"] #candidateListControls{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:16px}\n #skyMapView[data-explore-stage=\"search\"] .candidate-filter-fields{grid-column:1;margin:0}\n #skyMapView[data-explore-stage=\"search\"] .candidate-filter-fields>label{display:grid!important;grid-template-columns:auto minmax(0,1fr)!important;align-items:center!important;gap:10px!important}\n #skyMapView[data-explore-stage=\"search\"] .candidate-list-actions{grid-column:2;align-self:end}\n #skyMapView[data-explore-stage=\"search\"] #candidateListControls>:is(.candidate-filter-status,.candidate-list-heading,#candidateUnifiedResults,#candidateMapPanel){grid-column:1/-1}\n #skyMapView[data-explore-stage=\"search\"] .candidate-list-heading,#skyMapView[data-explore-stage=\"search\"] #candidateUnifiedResults>.list-item{grid-template-columns:minmax(0,1fr) 96px 144px!important}\n}\n";document.head.append(style);
document.addEventListener('astronotes-composition-change',updateConditions);
globalThis.TrialExplore={candidateWorkspace:()=>layout.mounted?mainCandidateWorkspace:null,active,ownsScene,render,routeChanged,preferMap:()=>{transferMode='map';if(active())choose('map');},sync,invalidate:()=>{plan.forgetFrame();SkyMapUI.render();sync(true);},sceneDraw,assertScene,
 camera:()=>{let timelapse=null;try{if(plan.frameKey===stamp(snapshot())&&AstroNotesTimelapse.settings(look._timelapseConfig))timelapse={...look._timelapseConfig};}catch{}return {l:{...aimLens,focal:Number(look.querySelector('[data-lens-focal]')?.value)||aimLens.focal||50},pan:[...(look._lensOffset||[0,0])],timelapse};}};
document.addEventListener('visibilitychange',()=>{if(document.hidden)invalidate();else sync();});
window.addEventListener('resize',()=>{if(active())sync();});
routeChanged();
})();

/* Legacy global names remain aliases for cached integrations. */
if(typeof AstroNotesAssets!=='undefined')globalThis.SoramiAssets=AstroNotesAssets;if(typeof AstroNotesAtmosphere!=='undefined')globalThis.SoramiAtmosphere=AstroNotesAtmosphere;if(typeof AstroNotesBodies!=='undefined')globalThis.SoramiBodies=AstroNotesBodies;if(typeof AstroNotesSkyMap!=='undefined')globalThis.SoramiSkyMap=AstroNotesSkyMap;
