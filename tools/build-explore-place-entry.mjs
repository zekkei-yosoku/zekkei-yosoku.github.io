// Trial-only adapters. The existing picker/session owns all selected places.
const patch=(source,from,to)=>{if(source.split(from).length!==2)throw Error('Explore place trial boundary changed: '+from.slice(0,90));return source.replace(from,to);};
const candidateWorkspaceSource=`
let candidateReturn=null,workspaceOwner=null,workspaceConditions=null,workspaceAction=null;
const candidateBack=node('button',{id:'exploreBackToCandidates',type:'button',className:'chip',hidden:true},'‹ 候補へ戻る');scene.prepend(candidateBack);
const workspaceCurrent=()=>active()&&auth?.loginId&&workspaceOwner===auth.loginId;
function syncWorkspace(){
 const sheet=$('placeSheet');
 if(workspaceOwner&&workspaceOwner!==auth?.loginId){workspaceOwner=null;candidateReturn=null;candidateBack.hidden=true;workspaceConditions?.querySelectorAll('select').forEach(n=>n.replaceChildren());if(sheet.open&&sheet.dataset.candidateWorkspace==='1')sheet.close();return;}
 if(candidateReturn&&(candidateReturn.owner!==auth?.loginId||candidateReturn.generation!==accessState.generation)){candidateReturn=null;candidateBack.hidden=true;}
 if(sheet.dataset.candidateWorkspace!=='1')return;
 if(!workspaceCurrent()){sheet.close();return;}
 for(const [id,sourceId] of [['candidateWorkspaceBody','skyMapBody'],['candidateWorkspaceTarget','skyMapTarget']]){
  const select=$(id),source=$(sourceId);if(!select||!source)continue;
  if(select.innerHTML!==source.innerHTML)select.innerHTML=source.innerHTML;select.value=source.value;
 }
 $('placeSheetTitle').textContent='候補を探す';
}
function ensureWorkspace(){
 if(workspaceConditions)return;
 const sheet=$('placeSheet'),body=sheet.querySelector(':scope > .sheet-body');
 workspaceConditions=node('section',{id:'candidateWorkspaceConditions',hidden:true});workspaceConditions.setAttribute('aria-label','候補の検索条件');
 for(const [id,sourceId,label] of [['candidateWorkspaceBody','skyMapBody','天体'],['candidateWorkspaceTarget','skyMapTarget','目標物']]){
  const field=node('label',{className:'tiny'},label),select=node('select',{id,className:'fav-in'});select.setAttribute('aria-label',label);
  select.onchange=()=>{if(!workspaceCurrent()||sheet.dataset.candidateWorkspace!=='1')return;const source=$(sourceId);source.value=select.value;source.dispatchEvent(new Event('change',{bubbles:true}));syncWorkspace();};field.append(select);workspaceConditions.append(field);
 }
 const date=node('div',{id:'candidateWorkspaceDate'});date.append(node('span',{className:'tiny'},'日付'));workspaceConditions.append(date);
 workspaceAction=node('div',{id:'candidateWorkspaceAction',hidden:true});body.prepend(workspaceConditions,workspaceAction);
 sheet.addEventListener('close',()=>{if(sheet.open)return;delete sheet.dataset.candidateWorkspace;workspaceConditions.hidden=true;workspaceAction.hidden=true;});
}
function openCandidateWorkspace(restore=false){
 if(!active())return;
 const saved=restore?candidateReturn:null;
 if(saved){
  if(saved.owner!==auth?.loginId||saved.generation!==accessState.generation)return;
  SkyMapUI.setTarget(saved.targetId);const body=$('skyMapBody');body.value=saved.body;body.dispatchEvent(new Event('change',{bubbles:true}));
  SkyMapUI.setAlignment(saved.partId,saved.limb,saved.matchMode);SkyMapUI.setTime(saved.at);
 }else{candidateReturn=null;candidateBack.hidden=true;}
 workspaceOwner=auth.loginId;ensureWorkspace();openPlaceSheet('skymap');
 const sheet=$('placeSheet');sheet.dataset.candidateWorkspace='1';workspaceConditions.hidden=false;workspaceAction.hidden=false;
 recentHistory.candidates();syncWorkspace();
 requestAnimationFrame(()=>{if(sheet.open&&sheet.dataset.candidateWorkspace==='1'){sheet.querySelector('.sheet-body').scrollTop=saved?.scrollTop||0;if(!saved)$('candidateWorkspaceBody').focus({preventScroll:true});}});
}
candidateBack.onclick=()=>openCandidateWorkspace(true);
document.addEventListener('astronotes-candidate-selected',()=>{
 const sheet=$('placeSheet');if(!workspaceCurrent()||!sheet.open||sheet.dataset.candidateWorkspace!=='1')return;
 const s=SkyMapUI.selectionState();candidateReturn={owner:auth.loginId,generation:accessState.generation,body:s.body,targetId:s.target.id,partId:s.partId,limb:s.limb,matchMode:s.matchMode,at:s.at,scrollTop:sheet.querySelector('.sheet-body').scrollTop};
 requestAnimationFrame(()=>{if(active()&&!sheet.open&&candidateReturn?.owner===auth?.loginId){candidateBack.hidden=false;showResult();}});
});
`;
export function explorePlaceSource(path,source){
 if(path.endsWith('/features/explore/layout.js')){
  source=patch(source,"fields.append(controls,observer,alignment);conditions.append(fields);",`fields.append(controls,observer,alignment);conditions.append(fields);
  const placeActions=node('div',{className:'explore-place-actions'});
  for(const [id,label,action] of [['exploreRecordedPlace','記録から選ぶ',deps.openRecordedPlace],['exploreFindCandidates','候補を探す',deps.openCandidates]]){const button=node('button',{id,type:'button',className:'chip'},label);button.onclick=action;placeActions.append(button);}
  observer.querySelector('.place-row').after(placeActions);`);
  source=patch(source,'if(!mounted)return;invalidate();mounted=false;','if(!mounted)return;invalidate();mounted=false;mapView.querySelectorAll(\'.explore-place-actions\').forEach(n=>n.remove());');
 }
 if(path.endsWith('/features/explore/controller.js')){
  source="import {openPlaceSheet} from '../places/search.js';\nimport {recentHistory} from '../framing/presentation.js';\n"+source;
  source=patch(source,' showResult,candidateChosen,addSaveAction,',' openRecordedPlace:()=>{if(!active()||!toolAllowed(\'records\'))return;openPlaceSheet(\'skymap\');recentHistory.records();},openCandidates:()=>openCandidateWorkspace(),showResult,candidateChosen,addSaveAction,');
  source=patch(source,'const layout=AstroNotesExploreLayout.create(',candidateWorkspaceSource+'\nconst layout=AstroNotesExploreLayout.create(');
  source=patch(source,'else{layout.unmount();promote();}',"else{candidateReturn=null;candidateBack.hidden=true;layout.unmount();promote();}");
  source=patch(source,"const confirm=$('exploreShowResult');",`const records=$('exploreRecordedPlace');if(records)records.hidden=!toolAllowed('records');
 const candidates=$('exploreFindCandidates');if(candidates)candidates.disabled=!s?.target;
 syncWorkspace();const confirm=$('exploreShowResult');`);
  source=patch(source,"'.explore-show-result{",`'.explore-place-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.explore-place-actions>button{flex:1;min-width:120px;min-height:44px}.explore-show-result{`);
  source=patch(source,"'.explore-tabs{scroll-margin-top:12px}",`'#placeSheet[data-candidate-workspace="1"] .place-search-tools,#placeSheet[data-candidate-workspace="1"] .place-tabs{display:none!important}'+
 '#candidateWorkspaceConditions{display:grid;gap:12px;padding-bottom:12px}#candidateWorkspaceConditions label{display:grid;gap:4px}#candidateWorkspaceConditions select{width:100%;min-width:0;min-height:44px;font-size:16px}#candidateWorkspaceConditions[hidden],#candidateWorkspaceAction[hidden],#placeSheet:not([data-candidate-workspace="1"]) #candidateWorkspaceConditions,#placeSheet:not([data-candidate-workspace="1"]) #candidateWorkspaceAction{display:none!important}'+
 '#candidateWorkspaceAction #candidateSearchAction{width:100%;min-height:44px}#exploreBackToCandidates{min-height:44px;margin:0 0 12px}'+
 '#placeSheet[data-candidate-workspace="1"]>.sheet-body{display:block;overflow-y:auto}#placeSheet[data-candidate-workspace="1"] .place-tab-panels{display:block;overflow:visible}#placeSheet[data-candidate-workspace="1"] #recentCandidates{overflow:visible}'+
 '.explore-tabs{scroll-margin-top:12px}`);
 }
 return source;
}
export function explorePlaceHtml(html){
 html=patch(html,'  skyPlayback.stop(false);\n  session.observer=aimSavedFrom',"  document.dispatchEvent(new Event('astronotes-candidate-selected'));\n  skyPlayback.stop(false);\n  session.observer=aimSavedFrom");
 html=patch(html,'  placeSheetFor = mode;$("geoStatus")', '  delete $("placeSheet").dataset.candidateWorkspace;\n  placeSheetFor = mode;$("geoStatus")');
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
 html=patch(html,"b.hidden=b.dataset.historyPanel==='candidates'&&!['aim','skymap'].includes(placeSheetFor);","b.hidden=(b.dataset.historyPanel==='candidates'&&!['aim','skymap'].includes(placeSheetFor))||(b.dataset.historyPanel==='records'&&(!toolAllowed('records')||!['aim','skymap'].includes(placeSheetFor)));");
 html=patch(html,"candidates(){active='candidates';render();","records(){active='records';render();for(const b of nav.children)if(b.dataset.historyPanel==='records')b.focus();},candidates(){active='candidates';render();");
 return html;
}
