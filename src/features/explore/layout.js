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
  const controls=mapView.querySelector('.sky-map-controls'),observer=$('skyMapChoose').closest('.aim-say-from'),alignment=$('skyMapAlignmentDetails');conditionHomes=[controls,observer,alignment].map(n=>({n,parent:n.parentNode,next:n.nextSibling}));controls.before(conditions);const fields=node('div',{className:'explore-condition-fields'});fields.append(controls,observer,alignment);conditions.append(fields);
  const confirm=node('button',{id:'exploreShowResult',type:'button',className:'chip explore-show-result'},'結果を確認');confirm.onclick=showResult;fields.append(confirm);conditions.addEventListener('toggle',()=>{summary.querySelector('.explore-condition-edit').textContent=conditions.open?'条件を閉じる':'条件を編集';});
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
  skyInfo.remove();updateSkyInfo(null);tabs.remove();scene.remove();map.remove();mapView.classList.remove('explore-mounted');$('skyMapTitle').textContent='地図';
 }
 return {mount,unmount,get mounted(){return mounted;},get conditions(){return conditions;}};
}
return {create};
});
