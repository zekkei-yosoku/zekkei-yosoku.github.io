// Injected inside the existing Explore controller; no new global or saved plan.
export const searchFlowSource=`
let resultRequested=false,selectionPending=false,flowOwner=null,flowGeneration=null;
let searchRoot=null,candidatePanelHome=null,searchStarted=false,returnIntent=null,pendingScroll=null;
const candidateBack=node('button',{id:'exploreBackToCandidates',type:'button',className:'chip',hidden:true},'‹ 探すへ戻る');scene.prepend(candidateBack);
const resultActive=()=>active()&&resultRequested;
const mainSearchActive=()=>active()&&!resultRequested&&!selectionPending&&flowOwner===auth?.loginId&&flowGeneration===accessState.generation;
function ensureSearchRoot(){
 if(!layout.mounted)return;
 if(!searchRoot){
  searchRoot=node('section',{id:'exploreSearchResults'});searchRoot.setAttribute('aria-label','撮影候補');
  searchRoot.append(node('h2',{},'撮影候補'),node('p',{id:'candidateSearchEmpty',className:'tiny'},'検索すると、ここに候補が出ます'));
 }
 if(!searchRoot.isConnected)layout.conditions.after(searchRoot);
 const panel=$('recentCandidates');if(panel.parentNode!==searchRoot){candidatePanelHome={parent:panel.parentNode,next:panel.nextSibling};searchRoot.append(panel);panel.setAttribute('role','region');panel.setAttribute('aria-label','撮影候補');panel.removeAttribute('aria-labelledby');}
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
 resultRequested=false;selectionPending=false;invalidate();look.hidden=true;
 const s=saved.selection;SkyMapUI.setTarget(s.target.id);
 // Restore the full target as well: custom target coordinates/heights are part of the search.
 SkyMapUI.workspaceHost()?.restoreTarget({target:structuredClone(s.target),custom:saved.custom,customTarget:saved.customTarget});
 const body=$('skyMapBody');body.value=s.body;body.dispatchEvent(new Event('change',{bubbles:true}));SkyMapUI.setAlignment(s.partId,s.limb,s.matchMode);SkyMapUI.setTime(s.at);
 SkyMapUI.workspaceHost()?.restoreObserver(structuredClone(s.observer));searchStarted=saved.searched;pendingScroll={top:saved.scrollTop,count:saved.count};syncWorkspace();if(!searchStarted)restoreSearchScroll(0);
}
function leaveSearchFlow(){
 resultRequested=false;selectionPending=false;searchStarted=false;returnIntent=null;pendingScroll=null;candidateBack.hidden=true;
 const panel=$('recentCandidates');if(candidatePanelHome&&panel){candidatePanelHome.parent.insertBefore(panel,candidatePanelHome.next?.parentNode===candidatePanelHome.parent?candidatePanelHome.next:null);panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby','placeTab-candidates');panel.removeAttribute('aria-label');candidatePanelHome=null;}
 searchRoot?.remove();delete mapView.dataset.exploreStage;
}
const mainCandidateWorkspace={epoch:()=>flowGeneration,previewWidth:()=>Math.max(200,Math.round(Math.min(780,mapView.clientWidth||320))),active:mainSearchActive,selectable:()=>mainSearchActive()&&!$('placeSheet').open,visible:()=>searchStarted,
 reveal(){if(!mainSearchActive())return;const first=!searchStarted;searchStarted=true;$('recentCandidates').hidden=false;$('candidateSearchEmpty').hidden=true;if(first)globalThis.MyPlacesUI?.renderPickerPanel($('recentCandidates'));},
 reset(){searchStarted=false;$('recentCandidates').hidden=true;$('candidateSearchEmpty').hidden=false;},
 restoreScroll:restoreSearchScroll,scroller:()=>document.scrollingElement};
candidateBack.onclick=showSearch;
document.addEventListener('astronotes-candidate-selecting',()=>{if(mainCandidateWorkspace.selectable()){captureSearch();selectionPending=true;}});
document.addEventListener('astronotes-candidate-selected',()=>{if(selectionPending&&returnIntent?.owner===auth?.loginId&&returnIntent.generation===accessState.generation)showResult();});
`;
export const searchFlowStyle=
 '#skyMapView[data-explore-stage="search"] #exploreScenePanel,#skyMapView[data-explore-stage="search"] #exploreMapPanel,#skyMapView[data-explore-stage="search"] #exploreSkyInfo,#skyMapView[data-explore-stage="search"] .sky-map-footer{display:none!important}'+
 '#skyMapView[data-explore-stage="preview"] #exploreConditions,#skyMapView[data-explore-stage="preview"] #exploreSearchResults{display:none!important}'+
 '#candidateWorkspaceDate{margin-top:12px}#candidateWorkspaceAction #candidateSearchAction{width:100%;min-height:44px}#exploreSearchResults{max-width:780px;padding:12px 0}#exploreSearchResults>h2{font-size:16px;margin:0 0 12px}#candidateSearchEmpty{padding:24px 16px;background:var(--sunk);border-radius:12px;text-align:center}#exploreSearchResults #recentCandidates{overflow:visible}#exploreBackToCandidates{min-height:44px;margin:0 0 12px}';

const patch=(s,from,to)=>{if(s.split(from).length!==2)throw Error('Main search boundary changed: '+from.slice(0,80));return s.replace(from,to);};
export function registeredMainSearch(s){
 s=patch(s,"const mode=placeSheetFor,isSky=mode==='skymap';","const workspace=globalThis.TrialExplore?.candidateWorkspace?.(),workspaceEpoch=workspace?.epoch(),mode=placeSheetFor,isSky=!!workspace||mode==='skymap';\n if(workspace&&(!workspace.active()||!workspace.visible()))return;");
 s=patch(s,"&&el('placeSheet').open&&placeSheetFor===mode&&key===query();","&&(workspace?workspace.epoch()===workspaceEpoch&&workspace.active()&&workspace.visible():el('placeSheet').open&&placeSheetFor===mode)&&key===query();");
 s=patch(s,"button.onclick=()=>{if(!current())return;if(isSky)","button.onclick=()=>{if(!current()||workspace&&!workspace.selectable())return;if(isSky)");
 return s;
}
