/* Trial only: one map-owned plan, two result panes. */
(()=>{
'use strict';
const $=id=>document.getElementById(id),mapView=$('skyMapView'),aimView=$('aimView'),look=$('aimLook');
let mounted=false,mode='scene',epoch=0,scheduled=false,forceNext=false,frameKey='',pendingKey='',routing=false,intent=false;
let aimHome=null,aimChildren=[],mapHomes=[],buffer=null,workspaceHome=null,heightWasOpen=false,heightFields=null;
const eligible=()=>screenAllowed('skymap')&&screenAllowed('framing');
const active=()=>mounted&&atSkyMap&&!mapView.hidden&&eligible()&&!document.hidden;
const node=(tag,props={},text)=>{const n=document.createElement(tag);Object.assign(n,props);if(text)n.textContent=text;return n;};
const tabs=node('div',{id:'exploreTabs',className:'forecast-tabs explore-tabs'});tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','探す結果の表示');
const sceneTab=node('button',{id:'exploreSceneTab',type:'button'},'見え方'),mapTab=node('button',{id:'exploreMapTab',type:'button'},'地図');
const scene=node('section',{id:'exploreScenePanel'}),map=node('section',{id:'exploreMapPanel'}),status=node('p',{className:'tiny',id:'exploreSceneStatus'});
for(const [tab,pane] of [[sceneTab,scene],[mapTab,map]]){tab.setAttribute('role','tab');tab.setAttribute('aria-controls',pane.id);pane.setAttribute('role','tabpanel');pane.setAttribute('aria-labelledby',tab.id);tabs.append(tab);}
status.setAttribute('role','status');const retry=node('button',{type:'button',className:'chip',hidden:true},'再試行');retry.onclick=()=>sync(true);scene.append(status,retry);
function stamp(s){return JSON.stringify([authGeneration,s.body,s.target,s.observer,s.ground,s.eyeM,s.partId,s.limb,s.matchMode,SoramiSkyMap.dayStart(s.at),aimAirSettings.mode,SoramiAtmosphere.dataKey?.()]);}
function snapshot(){return structuredClone(SkyMapUI.renderState());}
function canFrame(s){if(!eligible())return false;if(s.target.id!=='fuji')return toolAllowed('tower');return s.body==='sun'?toolAllowed('diamond'):s.body==='moon'?toolAllowed('pearl'):toolAllowed('tower')&&(toolAllowed('diamond')||toolAllowed('pearl'));}
function invalidate(){epoch++;frameKey='';pendingKey='';look._lookSeq=(look._lookSeq||0)+1;look._planKey=null;if(look._captionTimer){clearTimeout(look._captionTimer);look._captionTimer=0;}}
function menu(){
 const combined=eligible(),f=$('framingMenu'),m=$('mapMenu');
 if(combined){f.hidden=true;m.hidden=false;m.dataset.tool='#/explore';m.querySelector('b').lastChild.textContent='探す';m.querySelector('span').textContent='条件を選び、見え方と地図で確かめる';}
 else{f.dataset.tool='#/aim/tower';m.dataset.tool='#/skymap';m.querySelector('b').lastChild.textContent='地図';m.querySelector('span').textContent='撮影地点からの天体の方向と高度を調べる';}
}
function mount(){
 if(mounted)return;mounted=true;heightWasOpen=$('skyMapObserverDetails').open;$('skyMapObserverDetails').open=false;mapView.classList.add('explore-mounted');heightFields=node('div',{id:'exploreHeightFields'});const heights=$('skyMapObserverDetails');for(const row of heights.querySelectorAll('.aim-observer-height'))heightFields.append(row);heights.insertBefore(heightFields,$('skyMapHeightError'));
 const candidates=mapView.querySelector('.sky-map-candidates');candidates.after(tabs,scene,map);
 aimHome={parent:aimView.parentNode,next:aimView.nextSibling};
 const workspace=aimView.querySelector('.preview-workspace');workspaceHome={node:workspace,parent:workspace.parentNode,next:workspace.nextSibling};aimView.append(workspace);
 aimChildren=[...aimView.children];buffer=node('div',{hidden:true,inert:true,id:'exploreRetiredConditions'});
 for(const child of aimChildren)if(!child.classList.contains('preview-workspace')&&child.tagName!=='DIALOG')buffer.append(child);
 aimView.append(buffer);scene.append(aimView);aimView.hidden=false;
 const inner=$('previewScene');inner.removeAttribute('role');inner.removeAttribute('aria-labelledby');inner.hidden=false;
 const wrap=mapView.querySelector('.sky-map-wrap'),footer=mapView.querySelector('.sky-map-footer');
 mapHomes=[];for(let n=wrap;n&&n!==footer;){const next=n.nextElementSibling;mapHomes.push({n,parent:n.parentNode,next:n.nextSibling});map.append(n);n=next;}
 wrap.id=wrap.id||'exploreMapFigure';
 $('skyMapTitle').textContent='探す';choose(mode);
}
function unmount(){
 if(!mounted)return;invalidate();mounted=false;$('skyMapObserverDetails').open=heightWasOpen;for(const row of [...heightFields.children])heightFields.before(row);heightFields.remove();heightFields=null;scene.style.minHeight='';scene.removeAttribute('data-loading');scene.removeAttribute('aria-busy');
 for(const h of [...mapHomes].reverse())h.parent.insertBefore(h.n,h.next?.parentNode===h.parent?h.next:null);
 for(const child of aimChildren)aimView.append(child);
 buffer.remove();workspaceHome.parent.insertBefore(workspaceHome.node,workspaceHome.next?.parentNode===workspaceHome.parent?workspaceHome.next:null);aimHome.parent.insertBefore(aimView,aimHome.next?.parentNode===aimHome.parent?aimHome.next:null);
 aimView.hidden=!atAim;$('previewScene').setAttribute('role','tabpanel');$('previewScene').setAttribute('aria-labelledby','previewSceneTab');
 tabs.remove();scene.remove();map.remove();mapView.classList.remove('explore-mounted');$('skyMapTitle').textContent='地図';
}
function choose(next,focus=false){
 mode=next==='map'?'map':'scene';
 for(const [tab,pane,name] of [[sceneTab,scene,'scene'],[mapTab,map,'map']]){const on=mode===name;tab.setAttribute('aria-selected',String(on));tab.tabIndex=on?0:-1;pane.hidden=!on;if(on&&focus)tab.focus();}
 mapView.dataset.exploreMode=mode;
 if(mode==='map'){if(pendingKey)invalidate();scene.style.minHeight='';scene.removeAttribute('data-loading');scene.removeAttribute('aria-busy');SkyMapUI.redraw();}
 else sync();
}
sceneTab.onclick=()=>choose('scene');mapTab.onclick=()=>choose('map');
tabs.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();choose(e.key==='Home'?'scene':e.key==='End'?'map':mode==='scene'?'map':'scene',true);};
function project(s){
 aim.target=aimWithHeights(s.target);aim.body=s.body;aim.from=aimSavedFrom(s.observer);aim.dayMs=SoramiSkyMap.dayStart(s.at);aim.partId=s.partId;aim.limb=s.limb;aim.matchMode=s.matchMode||'overlap';
 aim.candPick=null;aim.wantSpot=null;aim.spot=null;aim.plannerTransfer=null;aimAirCompare=null;
 $('aimDate').value=new Date(s.at+32400000).toISOString().slice(0,10);$('aimBody').value=s.body;
}
function reserveScene(){const h=scene.getBoundingClientRect().height;if(h>0)scene.style.minHeight=h+'px';}
function message(text){status.textContent=text;status.hidden=!text;retry.hidden=!text.includes('再試行');}
async function paint(force=false){
 if(!active())return;let s;
 try{s=snapshot();}catch{invalidate();look.hidden=true;scene.removeAttribute('data-loading');scene.removeAttribute('aria-busy');scene.style.minHeight='';message(SkyMapUI.snapshot()?.observer?'対象と日時を選ぶと見え方を確認できます':'撮影地点を選ぶと見え方を確認できます');return;}
 const key=stamp(s);
 if(mode!=='scene'){if(frameKey&&frameKey!==key)invalidate();return;}
 if(!canFrame(s)){invalidate();look.hidden=true;scene.removeAttribute('data-loading');scene.removeAttribute('aria-busy');scene.style.minHeight='';message('この条件の見え方を利用する権限がありません');return;}
 if(pendingKey===key&&!force)return;
 if(!force&&frameKey===key&&look._uiTime&&!look.hidden){
  if(Math.abs(look._lookAt-s.at)>.5)look._uiTime.set(s.at);
  const cv=look.querySelector('[data-look-canvas]');if(cv&&Math.round(cv.clientWidth)===look._lookW){message('');return;}
 }
 reserveScene();invalidate();const run=epoch;pendingKey=key;project(s);look.hidden=true;scene.dataset.loading='true';scene.setAttribute('aria-busy','true');message('見え方を計算中…');
 try{
  await SoramiAssets.ensureModels();await SoramiBodies.ensure(s.body);
  if(run!==epoch||!active()||mode!=='scene'||stamp(snapshot())!==key)return;
  if(aimAirEnsure(aim.from,aim.dayMs))return;
  const spec={obs:{latitude:s.observer.latitude,longitude:s.observer.longitude,elevation:s.ground??s.observer.groundManualM??0},eyeM:s.eyeM,at:s.at,observerName:s.observer.name,title:'',sub:'',light:''};
  look._uiRequestedTime=null;look._lookAt=null;
  await aimLookRender(look,spec);
  if(run!==epoch||!active()||mode!=='scene'||stamp(snapshot())!==key)return;
  const latest=snapshot();if(Math.abs(look._lookAt-latest.at)>.5)look._uiTime?.set(latest.at);
  frameKey=key;message('');
 }catch(e){if(run===epoch&&active()){look.hidden=true;message('見え方を計算できませんでした。条件を確認して再試行してください');}}
 finally{if(run===epoch){pendingKey='';scene.removeAttribute('data-loading');scene.removeAttribute('aria-busy');if(!look.hidden)scene.style.minHeight='';}}
}
function sync(force=false){
 forceNext=forceNext||force;if(scheduled)return;scheduled=true;
 requestAnimationFrame(()=>{scheduled=false;const f=forceNext;forceNext=false;void paint(f);});
}
function render(){
 menu();if(atSkyMap&&eligible()){mount();aimView.hidden=false;renderAimAccess();sync();}
 else unmount();
}
function routeChanged(){
 render();
 if(atAim&&eligible()&&!routing){
  routing=true;const owner=auth?.token,hash=location.hash,preset=routeFromHash()?.preset;
  SoramiAssets.ensureModels().then(()=>{if(owner!==auth?.token||hash!==location.hash||!atAim||!eligible())return;const restored=aim.pendingPlan;openAim(preset||null);if(restored)aim.pendingPlan=restored;mode='scene';SkyMapUI.enter(true,restored?.at);}).finally(()=>{routing=false;});
 }
}
function sceneDraw(host,at){
 if(host!==look||!active()||mode!=='scene'||!intent||pendingKey||!frameKey)return;
 try{const s=snapshot();if(stamp(s)===frameKey&&Math.abs(s.at-at)>.5)SkyMapUI.setTime(at);}catch{}
}
for(const type of ['click','keydown'])aimView.addEventListener(type,()=>{intent=true;setTimeout(()=>{intent=false;},0);},true);
function assertScene(){SkyMapUI.shareState();const s=snapshot();if(!active()||mode!=='scene'||!canFrame(s)||frameKey!==stamp(s)||Math.abs(look._lookAt-s.at)>.5)throw Error('見え方の更新が終わってから共有してください');}
const style=node('style');style.textContent=
'#skyMapView.explore-mounted .sky-map-head::before{content:"EXPLORE" / "";--kw:6.6em}'+
'.explore-tabs{margin:14px 0 12px;max-width:780px}.explore-tabs button{min-height:44px}'+
'#skyMapView.explore-mounted #skyMapObserverDetails:not([hidden]){padding:0 0 6px}'+
'#exploreHeightFields{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;margin-top:6px}'+
'#skyMapView.explore-mounted #skyMapObserverDetails:not([open]) #exploreHeightFields{display:none}'+
'#skyMapView.explore-mounted #skyMapObserverDetails .aim-observer-height{display:grid;grid-template-columns:minmax(0,1fr) auto 44px;gap:4px;min-width:0;margin:0}'+
'#skyMapView.explore-mounted #skyMapObserverDetails .aim-observer-height label{grid-column:1/-1}'+
'#skyMapView.explore-mounted #skyMapObserverDetails .aim-observer-height input{width:100%;min-width:0;padding:8px 4px;font-size:16px}'+
'#skyMapView.explore-mounted #skyMapHeightError{grid-column:1/-1}'+
'#exploreScenePanel,#exploreMapPanel{max-width:780px;min-width:0}#exploreScenePanel[hidden],#exploreMapPanel[hidden]{display:none!important}'+
'#exploreScenePanel[data-loading=true] #aimLook{visibility:hidden;pointer-events:none}'+
'#exploreScenePanel #aimView .preview-workspace{margin:0;max-width:none}#exploreScenePanel #previewScene:before{display:none}'+
'#exploreScenePanel #aimView{padding:0}#exploreScenePanel #aimView .aim-look{margin:0}'+
'#skyMapView.explore-mounted #shootingCandidatesOpen,#skyMapView.explore-mounted #shootingCandidateStatus,#skyMapView.explore-mounted #shootingOverlap{display:none!important}'+
'.explore-mounted[data-explore-mode=scene] #mySkyPlaces .my-head{display:none!important}'+
'.explore-mounted[data-explore-mode=scene] #skyMapBodyBar,.explore-mounted[data-explore-mode=scene] #shootingPins{display:none!important}'+
'main:has(>#skyMapView.explore-mounted){max-width:1000px}';
document.head.append(style);
globalThis.TrialExplore={active,render,routeChanged,sync,invalidate:()=>{frameKey='';SkyMapUI.render();sync(true);},sceneDraw,assertScene,
 camera:()=>({l:{...aimLens},pan:[...(look._lensOffset||[0,0])]})};
document.addEventListener('visibilitychange',()=>{if(document.hidden)invalidate();else sync();});
window.addEventListener('resize',()=>{if(active())sync();});
routeChanged();
})();
