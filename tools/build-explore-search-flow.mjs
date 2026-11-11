import {recordDiscoverySource,recordDiscoveryStyle} from './build-record-discovery.mjs';
// Injected inside the existing Explore controller; no new global or saved plan.
export const searchFlowSource=`
let resultRequested=false,selectionPending=false,flowOwner=null,flowGeneration=null,previewBackEpoch=0;
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
 const panel=$('recentCandidates');if(panel.parentNode!==searchRoot){candidatePanelHome={parent:panel.parentNode,next:panel.nextSibling};searchRoot.insertBefore(panel,$('candidateSearchCredits'));panel.setAttribute('role','region');panel.setAttribute('aria-label','撮影候補の一覧');panel.removeAttribute('aria-labelledby');}
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
 returnIntent={owner:auth.loginId,generation:accessState.generation,selection:structuredClone(s),custom:structuredClone(SkyMapUI.workspaceHost()?.session.custom??null),customTarget:structuredClone(SkyMapUI.workspaceHost()?.session.customTarget??null),searched:searchStarted,scrollTop:document.scrollingElement.scrollTop,count:globalThis.AstroNotesCandidatePicker?.visibleRows().length||0};
}
function enterResult(){
 if(!selectionPending)captureSearch();selectionPending=false;resultRequested=true;previewBackEpoch++;foldConditions();syncWorkspace();SkyMapUI.render();
}
function showSearch(){
 if(globalThis.MyPlacesUI?.opportunities?.returnFromPreview())return;
 previewBackEpoch++;
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
 recordSeq++;recordCalendarSeq++;if(recordTimer!==null)clearTimeout(recordTimer);recordTimer=null;recordState={key:'',status:'idle'};recordPane?.replaceChildren();recordCache.clear();recordJobs.clear();recordMemo=null;recordCalendarArgs=null;
 previewBackEpoch++;
 document.dispatchEvent(new Event('astronotes-preview-leave'));
 resultRequested=false;selectionPending=false;searchStarted=false;returnIntent=null;pendingScroll=null;candidateBack.hidden=true;
 const panel=$('recentCandidates');if(candidatePanelHome&&panel){candidatePanelHome.parent.insertBefore(panel,candidatePanelHome.next?.parentNode===candidatePanelHome.parent?candidatePanelHome.next:null);panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby','placeTab-candidates');panel.removeAttribute('aria-label');candidatePanelHome=null;}
 searchRoot?.remove();delete mapView.dataset.exploreStage;
}
${recordDiscoverySource}
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
  const epoch=previewBackEpoch,owner=flowOwner,generation=flowGeneration,saved=returnIntent;let used=false;
  return()=>{if(used)return false;used=true;
   if(epoch!==previewBackEpoch||!resultActive()||selectionPending||flowOwner!==owner||flowGeneration!==generation||owner!==auth?.loginId||generation!==accessState.generation||returnIntent!==saved||document.querySelector('dialog[open]')||!$('toolsMenu').hidden&&$('toolsMenu').classList.contains('on'))return false;
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
`;
// Structural stage visibility belongs here; visual search styling has one owner.
export const searchFlowStyle=
 // 2026-11-11 ユーザー「過去の履歴ボタンってもう要らないのでは?」「見えない文字があってここ消せば間隔狭められる」:
 // 探すの見出しから場所の履歴を外し、行を低くする。読み上げ用の見出しは残すが選べないようにする。
 '#skyMapView.explore-mounted #skyMapRecentOpen{display:none!important}#skyMapView.explore-mounted .sky-map-head{min-height:0!important;margin-bottom:4px!important}#skyMapView.explore-mounted #skyMapTitle{-webkit-user-select:none;user-select:none;pointer-events:none}'+
 '#skyMapView[data-explore-stage="search"] #exploreScenePanel,#skyMapView[data-explore-stage="search"] #exploreMapPanel,#skyMapView[data-explore-stage="search"] #exploreSkyInfo,#skyMapView[data-explore-stage="search"] .sky-map-candidates,#skyMapView[data-explore-stage="search"] #skyMapShareRow{display:none!important}'+
 '#skyMapView[data-explore-stage="preview"] #exploreSearchResults{display:none!important}'+
 '#skyMapView[data-explore-stage="preview"] .explore-conditions>summary{grid-template-columns:auto minmax(0,1fr) auto}'+
 '#skyMapView[data-explore-stage="preview"] #exploreConditionTitle,#skyMapView[data-explore-stage="preview"] #exploreConditionDetail{grid-column:2}#skyMapView[data-explore-stage="preview"] .explore-condition-edit{grid-column:3}'+
 '#exploreBackToCandidates{grid-column:1;grid-row:1/3;align-self:center;width:30px;height:44px;margin:0 2px 0 -8px;padding:0;border:0;border-radius:8px;background:none;color:var(--secondary);display:grid;place-items:center;cursor:pointer;-webkit-tap-highlight-color:transparent}#exploreBackToCandidates:active{color:var(--text)}#exploreBackToCandidates[hidden]{display:none}'+recordDiscoveryStyle;

const patch=(s,from,to)=>{if(s.split(from).length!==2)throw Error('Main search boundary changed: '+from.slice(0,80));return s.replace(from,to);};
export function registeredMainSearch(s){
 s=patch(s,"const mode=placeSheetFor,isSky=mode==='skymap';","const workspace=globalThis.TrialExplore?.candidateWorkspace?.(),workspaceEpoch=workspace?.epoch(),mode=placeSheetFor,isSky=!!workspace||mode==='skymap';\n if(workspace?.separateRecords)return;\n if(workspace&&(!workspace.active()||!workspace.visible()))return;");
 s=patch(s,"&&el('placeSheet').open&&placeSheetFor===mode&&key===query();","&&(workspace?workspace.epoch()===workspaceEpoch&&workspace.active()&&workspace.visible():el('placeSheet').open&&placeSheetFor===mode)&&key===query();");
 s=patch(s,"button.onclick=()=>{if(!current())return;if(isSky)","button.onclick=()=>{if(!current()||workspace&&!workspace.selectable())return;if(isSky)");
 s=patch(s,"if(!current()||result.cancelled)return;\n  note.textContent=", "if(!current()||result.cancelled)return;\n  if(workspace)note.hidden=true;\n  note.textContent=");
 s=patch(s,"if(!result.rows.length){const empty=", "if(!result.rows.length&&!workspace){const empty=");
 return s;
}
