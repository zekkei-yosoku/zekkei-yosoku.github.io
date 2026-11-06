import {searchFlowSource,searchFlowStyle} from './build-explore-search-flow.mjs';
import {explorePageStyle} from './build-explore-page-layout.mjs';
// Trial-only adapters. The existing picker/session owns all selected places.
const patch=(source,from,to)=>{if(source.split(from).length!==2)throw Error('Explore place trial boundary changed: '+from.slice(0,90));return source.replace(from,to);};
const candidateWorkspaceSource=searchFlowSource;

export function explorePlaceSource(path,source){
 if(path.endsWith('/features/explore/layout.js')){
  source=patch(source,"fields.append(controls,observer,alignment);conditions.append(fields);",`
  fields.setAttribute('role','group');fields.setAttribute('aria-labelledby','exploreSearchHeading');
  const heading=node('div',{className:'explore-search-intro'});heading.append(node('h2',{id:'exploreSearchHeading',className:'explore-section-title'},'撮影条件'),node('p',{className:'tiny'},'天体と目標物を選んで、撮影できる場所を探す。'));fields.append(heading);
  fields.append(controls,observer,alignment,node('div',{id:'candidateWorkspaceAction'}));
  conditions.append(fields);`);
  source=patch(source,'fields.append(confirm);','fields.insertBefore(confirm,alignment);');
 }
 if(path.endsWith('/features/explore/controller.js')){
  source=patch(source,'const layout=AstroNotesExploreLayout.create(',candidateWorkspaceSource+'\nconst layout=AstroNotesExploreLayout.create(');
  source=patch(source,'else{layout.unmount();promote();}',"else{leaveSearchFlow();layout.unmount();promote();}");
  source=patch(source,"const confirm=$('exploreShowResult');","syncWorkspace();const confirm=$('exploreShowResult');");
  source=patch(source,"confirm.textContent=!s?.target?'対象を選ぶ':!s?.observer?'撮影地点を選ぶ':'結果を確認';","confirm.textContent=!s?.target?'対象を選んで見え方を確認':!s?.observer?'撮影地点を指定して確認':'この地点の見え方を確認';");
  source=patch(source,"'.explore-tabs{scroll-margin-top:12px}",JSON.stringify(searchFlowStyle)+"+\n'.explore-tabs{scroll-margin-top:12px}");
  // Last in this controller's stylesheet so legacy card rules cannot override it.
  source=patch(source,"document.head.append(style);","style.textContent+="+JSON.stringify(explorePageStyle)+";document.head.append(style);");
  source=patch(source,'layout.conditions.open=false;', 'enterResult();layout.conditions.open=false;');
  source=patch(source,'if(!active())return;updateConditions();let s;','if(!active())return;updateConditions();if(!resultRequested)return;let s;');
  source=source.replaceAll('!plan.current(run)||!active()', '!plan.current(run)||!resultActive()');
  source=patch(source,'&&active()){invalidate();look.hidden=true;', '&&resultActive()){invalidate();look.hidden=true;');
  source=patch(source,'if(run&&plan.settle(run)){','if(run&&plan.settle(run)&&resultActive()){');
  source=patch(source,"if(host!==look||!active()||mode!=='scene'", "if(host!==look||!resultActive()||mode!=='scene'");
  source=patch(source,"if(!active()||mode!=='scene'||!canFrame(s)","if(!resultActive()||mode!=='scene'||!canFrame(s)");
  source=patch(source,'globalThis.TrialExplore={active,','globalThis.TrialExplore={candidateWorkspace:()=>layout.mounted?mainCandidateWorkspace:null,active,');
  source=patch(source,'if(restored)aim.pendingPlan=restored;','if(restored){aim.pendingPlan=restored;flowOwner=loginId;flowGeneration=generation;resultRequested=true;}');
 }
 return source;
}
export function explorePlaceHtml(html){
 // Reuse the existing datetime bar. Only the trial search adapter receives
 // semantic day-change/settle notifications; the common bar owns its DOM.
 html=patch(html,' function setTime(at,preservePlayback=false){',` function notifyCandidateDate(changed,settled=true){
  if(globalThis.TrialExplore?.candidateWorkspace?.()?.active())document.dispatchEvent(new CustomEvent('astronotes-candidate-date-change',{detail:{changed,settled}}));
 }
 function setTime(at,preservePlayback=false){`);
 html=patch(html,'session.at=at;timelineMoving=false;if(changed||session.timelinePending)refresh();render();}', 'session.at=at;timelineMoving=false;notifyCandidateDate(changed);if(changed||session.timelinePending)refresh();render();}');
 html=patch(html,"el('skyMapRetry').hidden=true;map.redraw();}render();},onBlend", "el('skyMapRetry').hidden=true;map.redraw();}notifyCandidateDate(changed,false);render();},onBlend");
 html=patch(html,"onSettle:()=>{timelineMoving=false;if(!hasAccess()||!session||!active())return;if(session.timelinePending)", "onSettle:()=>{timelineMoving=false;if(!hasAccess()||!session||!active())return;notifyCandidateDate(false);if(session.timelinePending)");
 html=patch(html,' function renderCandidateDates(){'," function renderCandidateDates(){\n  if(globalThis.TrialExplore?.candidateWorkspace?.()?.active())return;");
 // Search selects a date independently of a shooting place. Keep the existing
 // calendar's date grid/moon drawing, without preview-only alignment statuses.
 html=patch(html,"draw(new Map());\n  if(!plan||!hasAccess())", "draw(new Map());\n  if(globalThis.TrialExplore?.candidateWorkspace?.()?.active()){status.textContent='';grid.setAttribute('aria-busy','false');return;}\n  if(!plan||!hasAccess())");
 html=patch(html,'  skyPlayback.stop(false);\n  session.observer=aimSavedFrom',"  document.dispatchEvent(new Event('astronotes-candidate-selecting'));\n  skyPlayback.stop(false);\n  session.observer=aimSavedFrom");
 html=patch(html,'map.setCenter(candidate.place.latitude,candidate.place.longitude);refresh();return true;','map.setCenter(candidate.place.latitude,candidate.place.longitude);refresh();document.dispatchEvent(new Event(\'astronotes-candidate-selected\'));return true;');
 html=patch(html,"const panels={recent:historyPanel,favorites:favPanel,candidates:candidatePanel};",`const recordsPanel=document.createElement('section');recordsPanel.id='recentRecordedPlaces';
 const recordSearch=document.createElement('input');recordSearch.type='search';recordSearch.className='fav-in';recordSearch.placeholder='記録の地点名で検索';recordSearch.setAttribute('aria-label','記録の撮影地点を検索');
 const recordList=document.createElement('div');recordList.setAttribute('aria-live','polite');recordsPanel.append(recordSearch,recordList);let recordOwner=null;
 function renderRecordedPlaces(){
  recordList.replaceChildren();const owner=auth?.token;
  if(recordOwner!==owner){recordOwner=owner;recordSearch.value='';}
  if(!owner||!toolAllowed('records'))return;
  const recordedIds=new Set((window.MyPlacesUI?.load()||[]).map(r=>r.placeId));
  const recorded=p=>recordedIds.has(p.id)||!!window.MyPlacesUI?.shapeFor(p);
  const query=recordSearch.value.normalize('NFKC').toLocaleLowerCase().trim();
  const points=favorites.filter(p=>recorded(p)&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude));
  const shown=points.filter(p=>[p.name,p.subtitle].join(' ').normalize('NFKC').toLocaleLowerCase().includes(query));
  if(!shown.length){const empty=document.createElement('p');empty.className='tiny';empty.textContent=points.length?'一致する記録の撮影地点はありません。':'記録に登録された撮影地点はありません。';recordList.append(empty);}
  for(const point of shown){const button=document.createElement('button');button.type='button';button.className='list-item';button.dataset.recordedPlace=point.id;
   const name=document.createElement('strong'),sub=document.createElement('span');name.textContent=point.name;sub.className='tiny sub-line';sub.textContent=point.subtitle||'記録の撮影地点';button.append(name,sub);
   button.onclick=()=>{if(!sheet.open||active!=='records'||auth?.token!==owner||!toolAllowed('records')||!['aim','skymap'].includes(placeSheetFor))return;const current=favorites.find(p=>p.id===point.id);if(!current)return;const ids=new Set((window.MyPlacesUI?.load()||[]).map(r=>r.placeId));if(!ids.has(current.id)&&!window.MyPlacesUI?.shapeFor(current))return;choosePlace(current);};recordList.append(button);
  }
 }
 recordSearch.oninput=renderRecordedPlaces;
 const panels={recent:historyPanel,favorites:favPanel,candidates:candidatePanel,records:recordsPanel};`);
 html=patch(html,"[['favorites','お気に入り'],['recent','履歴'],['candidates','この日の候補']]","[['favorites','お気に入り'],['records','記録'],['recent','履歴'],['candidates','この日の候補']]");
 html=patch(html,"function render(){\n  for(const [id,panel] of Object.entries(panels))",`function render(){
  if(active==='records'&&(!auth?.token||!toolAllowed('records')||!['aim','skymap'].includes(placeSheetFor)))active='favorites';
  renderRecordedPlaces();
  for(const [id,panel] of Object.entries(panels))`);
 html=html.replaceAll("for(const [id,panel] of Object.entries(panels))panel.hidden=id!==active;","for(const [id,panel] of Object.entries(panels))if(id!=='candidates'||!globalThis.TrialExplore?.candidateWorkspace?.())panel.hidden=id!==active;");
 html=patch(html,"b.hidden=b.dataset.historyPanel==='candidates'&&!['aim','skymap'].includes(placeSheetFor);","b.hidden=(b.dataset.historyPanel==='candidates'&&!['aim','skymap'].includes(placeSheetFor))||(b.dataset.historyPanel==='records'&&(!toolAllowed('records')||!['aim','skymap'].includes(placeSheetFor)));");
 html=patch(html,"(b.dataset.historyPanel==='candidates'&&!['aim','skymap'].includes(placeSheetFor))","(b.dataset.historyPanel==='candidates'&&(!['aim','skymap'].includes(placeSheetFor)||!!globalThis.TrialExplore?.candidateWorkspace?.()))");
 html=patch(html,"candidates(){active='candidates';render();","records(){active='records';render();for(const b of nav.children)if(b.dataset.historyPanel==='records')b.focus();},candidates(){active='candidates';render();");
 return html;
}
