// Trial-only adapters. The existing picker/session owns all selected places.
const patch=(source,from,to)=>{if(source.split(from).length!==2)throw Error('Explore place trial boundary changed: '+from.slice(0,90));return source.replace(from,to);};
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
  source=patch(source,' showResult,candidateChosen,addSaveAction,',' openRecordedPlace:()=>{if(!active()||!toolAllowed(\'records\'))return;openPlaceSheet(\'skymap\');recentHistory.records();},openCandidates:()=>{if(!active())return;openPlaceSheet(\'skymap\');recentHistory.candidates();},showResult,candidateChosen,addSaveAction,');
  source=patch(source,"const confirm=$('exploreShowResult');",`const records=$('exploreRecordedPlace');if(records)records.hidden=!toolAllowed('records');
 const candidates=$('exploreFindCandidates');if(candidates)candidates.disabled=!s?.target;
 const confirm=$('exploreShowResult');`);
  source=patch(source,"'.explore-show-result{",`'.explore-place-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.explore-place-actions>button{flex:1;min-width:120px;min-height:44px}.explore-show-result{`);
 }
 return source;
}
export function explorePlaceHtml(html){
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
