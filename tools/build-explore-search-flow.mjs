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
 reset(){if(searchStarted)$('candidateSearchEmpty').textContent='条件を変更しました。「候補を探す」で新しい候補を確認できます。';searchStarted=false;$('recentCandidates').hidden=true;$('candidateSearchEmpty').hidden=false;},
 restoreScroll:restoreSearchScroll,scroller:()=>document.scrollingElement};
candidateBack.onclick=showSearch;
document.addEventListener('astronotes-candidate-selecting',()=>{if(mainCandidateWorkspace.selectable()){captureSearch();selectionPending=true;}});
document.addEventListener('astronotes-candidate-selected',()=>{if(selectionPending&&returnIntent?.owner===auth?.loginId&&returnIntent.generation===accessState.generation)showResult();});
`;
// Structural stage visibility belongs here; visual search styling has one owner.
export const searchFlowStyle=
 '#skyMapView[data-explore-stage="search"] #exploreScenePanel,#skyMapView[data-explore-stage="search"] #exploreMapPanel,#skyMapView[data-explore-stage="search"] #exploreSkyInfo,#skyMapView[data-explore-stage="search"] .sky-map-footer{display:none!important}'+
 '#skyMapView[data-explore-stage="preview"] #exploreConditions,#skyMapView[data-explore-stage="preview"] #exploreSearchResults{display:none!important}'+
 '#exploreBackToCandidates{min-height:44px;margin:0 0 12px}';

const patch=(s,from,to)=>{if(s.split(from).length!==2)throw Error('Main search boundary changed: '+from.slice(0,80));return s.replace(from,to);};
export function registeredMainSearch(s){
 s=patch(s,"const mode=placeSheetFor,isSky=mode==='skymap';","const workspace=globalThis.TrialExplore?.candidateWorkspace?.(),workspaceEpoch=workspace?.epoch(),mode=placeSheetFor,isSky=!!workspace||mode==='skymap';\n if(workspace&&(!workspace.active()||!workspace.visible()))return;");
 s=patch(s,"&&el('placeSheet').open&&placeSheetFor===mode&&key===query();","&&(workspace?workspace.epoch()===workspaceEpoch&&workspace.active()&&workspace.visible():el('placeSheet').open&&placeSheetFor===mode)&&key===query();");
 s=patch(s,"button.onclick=()=>{if(!current())return;if(isSky)","button.onclick=()=>{if(!current()||workspace&&!workspace.selectable())return;if(isSky)");
 s=patch(s,"if(!current()||result.cancelled)return;\n  note.textContent=", "if(!current()||result.cancelled)return;\n  if(workspace)note.hidden=true;\n  note.textContent=");
 s=patch(s,"if(!result.rows.length){const empty=", "if(!result.rows.length&&!workspace){const empty=");
 return s;
}
