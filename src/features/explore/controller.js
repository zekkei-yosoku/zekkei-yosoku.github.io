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
 const body=AstroNotesBodies.definition(s?.body)?.name||'天体を選ぶ',target=s?.target?.name||'対象を選ぶ';
 const part=s?.target?.parts?.find(p=>p.id===s.partId)||s?.target?.parts?.[0];
 const alignment=s?.matchMode==='overlap'?'全体に重なる':s?.partId==='__whole'?(s.target?.wholeLabel||'建物全体に重なる'):`${part?.name||'対象'}・${AstroNotesAlign.limbById(s?.limb||'center').name}`;
 const height=s?.observer?$('skyMapObserverSummary')?.textContent?.trim().replace(/^高さ\s*[:：]?\s*/,''):'';
 return {title:body+' × '+target,detail:(s?.observer?.name||'撮影地点を選ぶ')+(height?' · '+height:'')+(s?.target?' · '+alignment:'')};
}
function updateConditions(){
 if(!layout.mounted||!layout.conditions)return;const s=SkyMapUI.selectionState(),text=conditionText(s);
 for(const [id,value] of [['exploreConditionTitle',text.title],['exploreConditionDetail',text.detail]])if($(id).textContent!==value)$(id).textContent=value;
 const confirm=$('exploreShowResult');confirm.disabled=false;confirm.textContent=!s?.target?'対象を選ぶ':!s?.observer?'撮影地点を選ぶ':'結果を確認';
 for(const b of mapView.querySelectorAll('[data-quick-save]')){b.hidden=false;b.disabled=b.dataset.planSource==='skymap'?!!$('skyMapShareRow').querySelector('[data-plan-action="share"]')?.disabled:!!plan.pendingKey||!plan.frameKey||look.hidden;}
}
function showResult(){
 if(!layout.mounted)return;const selected=SkyMapUI.selectionState();if(!selected?.target){$('skyMapTargetOpen').click();return;}if(!selected?.observer){$('skyMapChoose').click();return;}layout.conditions.open=false;
 const tab=mode==='map'?mapTab:sceneTab;tab.focus({preventScroll:true});tabs.style.scrollMarginTop=(layout.conditions.getBoundingClientRect().height+12)+'px';tabs.scrollIntoView({block:'start',behavior:'auto'});if(mode==='scene')sync();
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
 else{f.dataset.tool='#/aim/tower';m.dataset.tool='#/skymap';m.querySelector('b').lastChild.textContent='地図';m.querySelector('span').textContent='撮影地点からの天体の方向と高度を調べる';}
}
const layout=AstroNotesExploreLayout.create({$,node,mapView,aimView,skyInfo,tabs,scene,map,aimState:()=>aim,requestAnimationFrame:cb=>requestAnimationFrame(cb),getMode:()=>mode,isAimActive:()=>viewState.aim,
 showResult,candidateChosen,addSaveAction,updateConditions,choose,invalidate,placePins,updateSkyInfo});
function choose(next,focus=false){
 mode=next==='map'?'map':'scene';
 for(const [tab,pane,name] of [[sceneTab,scene,'scene'],[mapTab,map,'map']]){const on=mode===name;tab.setAttribute('aria-selected',String(on));tab.tabIndex=on?0:-1;pane.hidden=!on;if(on&&focus)tab.focus();}
 mapView.dataset.exploreMode=mode;
 if(mode==='map'){if(plan.pendingKey)invalidate();scene.style.minHeight='';scene.removeAttribute('data-loading');scene.removeAttribute('aria-busy');SkyMapUI.redraw();}
 else sync();
}
sceneTab.onclick=()=>choose('scene');mapTab.onclick=()=>choose('map');
function candidateChosen(e){if(e.target.closest('[data-from-day]'))showResult();}
tabs.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();choose(e.key==='Home'?'scene':e.key==='End'?'map':mode==='scene'?'map':'scene',true);};
function project(s){
 aim.target=aimWithHeights(s.target);aim.body=s.body;aim.from=aimSavedFrom(s.observer);aim.dayMs=AstroNotesSkyMap.dayStart(s.at);aim.partId=s.partId;aim.limb=s.limb;aim.matchMode=s.matchMode||'overlap';
 aim.candPick=null;aim.wantSpot=null;aim.spot=null;aim.plannerTransfer=null;aimAirCompare=null;
 $('aimDate').value=new Date(s.at+32400000).toISOString().slice(0,10);$('aimBody').value=s.body;
}
function reserveScene(){const h=scene.getBoundingClientRect().height;if(h>0)scene.style.minHeight=h+'px';}
function message(text){status.textContent=text;status.hidden=!text;retry.hidden=!text.includes('再試行');}
function updateRetainedTime(s){
 if(plan.frameBase===baseStamp(s)&&!look.hidden&&look._uiTime&&Math.abs(look._lookAt-s.at)>.5)look._uiTime.set(s.at);
}
async function paint(force=false){
 if(!active())return;updateConditions();let s;
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
  if(!plan.current(run)||!active()||mode!=='scene'||!plan.matches(key))return;
  if(aimAirEnsure(aim.from,aim.dayMs))return;
  const spec={obs:{latitude:s.observer.latitude,longitude:s.observer.longitude,elevation:s.observer.groundManualM??s.ground??0},eyeM:s.eyeM,at:s.at,observerName:s.observer.name,title:'',sub:'',light:''};
  look._uiRequestedTime=null;look._lookAt=null;
  await aimLookRender(look,spec);
  if(!plan.current(run)||!active()||mode!=='scene'||!plan.matches(key))return;
  const latest=snapshot();if(Math.abs(look._lookAt-latest.at)>.5)look._uiTime?.set(latest.at);
  plan.commit(key,s);message('');addSaveAction(look.querySelector('.aim-figure-share'),'aim');
 }catch(e){if((!run||plan.current(run))&&active()){invalidate();look.hidden=true;scene.removeAttribute('data-loading');scene.removeAttribute('aria-busy');scene.style.minHeight='';message('見え方を計算できませんでした。条件を確認して再試行してください');updateConditions();}}
 finally{if(run&&plan.settle(run)){scene.removeAttribute('data-loading');scene.removeAttribute('aria-busy');if(!look.hidden)scene.style.minHeight='';updateConditions();}}
}
function sync(force=false){
 forceNext=forceNext||force;if(scheduled)return;scheduled=true;
 requestAnimationFrame(()=>{scheduled=false;const f=forceNext;forceNext=false;void paint(f);});
}
function render(){
 menu();if(viewState.skyMap&&eligible()){layout.mount();aimView.hidden=false;renderAimAccess();sync();}
 else{layout.unmount();promote();}
}
// Permission changes also render the current route. Promote once without requiring a navigation or reload.
function promote(){
 if(!viewState.aim||!eligible()||routing)return;
 routing=true;const desiredMode=transferMode||'scene';transferMode=null;const generation=accessState.generation,loginId=auth?.loginId,hash=location.hash,preset=routeFromHash()?.preset,restored=aim.pendingPlan;
 // Session renewal rotates the token without changing this authenticated account's generation.
 AstroNotesAssets.ensureModels().then(()=>{if(generation!==accessState.generation||loginId!==auth?.loginId||hash!==location.hash||!viewState.aim||!eligible())return;openAim(preset||null);if(restored)aim.pendingPlan=restored;mode=desiredMode;SkyMapUI.enter(true,restored?.at);}).finally(()=>{routing=false;if(transferMode&&viewState.aim&&eligible())routeChanged();});
}
function routeChanged(){render();}
function sceneDraw(host,at){
 if(host!==look||!active()||mode!=='scene'||!intent||plan.pendingKey||!plan.frameKey)return;
 try{const s=snapshot();if(stamp(s)===plan.frameKey&&Math.abs(s.at-at)>.5)SkyMapUI.setTime(at);}catch{}
}
for(const type of ['click','keydown'])aimView.addEventListener(type,()=>{intent=true;setTimeout(()=>{intent=false;},0);},true);
function assertScene(){SkyMapUI.shareState();const s=snapshot();if(!active()||mode!=='scene'||!canFrame(s)||plan.frameKey!==stamp(s)||Math.abs(look._lookAt-s.at)>.5)throw Error('見え方の更新が終わってから共有してください');}
const style=node('style');style.textContent=
'.explore-conditions{max-width:780px;margin:0 0 12px;border:1px solid var(--line);border-radius:14px;background:var(--card)}'+
'.explore-conditions:not([open]){position:sticky;top:0;z-index:4}'+
'.explore-conditions>summary{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;min-height:64px;padding:12px 14px;cursor:pointer;list-style:none}.explore-conditions>summary::-webkit-details-marker{display:none}'+
'#exploreConditionTitle{font-weight:600;grid-column:1;overflow-wrap:anywhere}#exploreConditionDetail{grid-column:1;font-size:12px;color:var(--secondary);overflow-wrap:anywhere}.explore-condition-edit{grid-column:2;grid-row:1/3;align-self:center;font-size:12px;color:var(--accent)}'+
'.explore-condition-fields{padding:4px 14px 14px}.explore-conditions[open]>summary{border-bottom:1px solid var(--line)}.explore-conditions[open] #exploreConditionDetail{display:none}'+
'.explore-show-result{width:100%;min-height:44px;margin-top:8px}'+
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
document.head.append(style);
globalThis.TrialExplore={active,ownsScene,render,routeChanged,preferMap:()=>{transferMode='map';if(active())choose('map');},sync,invalidate:()=>{plan.forgetFrame();SkyMapUI.render();sync(true);},sceneDraw,assertScene,
 camera:()=>{let timelapse=null;try{if(plan.frameKey===stamp(snapshot())&&AstroNotesTimelapse.settings(look._timelapseConfig))timelapse={...look._timelapseConfig};}catch{}return {l:{...aimLens,focal:Number(look.querySelector('[data-lens-focal]')?.value)||aimLens.focal||50},pan:[...(look._lensOffset||[0,0])],timelapse};}};
document.addEventListener('visibilitychange',()=>{if(document.hidden)invalidate();else sync();});
window.addEventListener('resize',()=>{if(active())sync();});
routeChanged();
})();

/* Legacy global names remain aliases for cached integrations. */
if(typeof AstroNotesAssets!=='undefined')globalThis.SoramiAssets=AstroNotesAssets;if(typeof AstroNotesAtmosphere!=='undefined')globalThis.SoramiAtmosphere=AstroNotesAtmosphere;if(typeof AstroNotesBodies!=='undefined')globalThis.SoramiBodies=AstroNotesBodies;if(typeof AstroNotesSkyMap!=='undefined')globalThis.SoramiSkyMap=AstroNotesSkyMap;
