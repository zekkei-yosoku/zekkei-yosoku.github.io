import {readFileSync} from 'node:fs';
import {createRecordSort} from './record-sort-policy.mjs';
const patch=(s,a,b)=>{if(s.split(a).length!==2)throw Error('Record sort boundary changed: '+a.slice(0,95));return s.replace(a,b);};
const style=String.raw`
#myRecordsHub .my-actions select.record-sort-select,.record-sort-row select.record-sort-select{flex:0 0 auto;width:auto;min-width:96px;min-height:44px}
.record-sort-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px}.record-sort-row input[type=search]{flex:1 1 160px;width:0;min-width:0}.record-sort-slot{display:contents}
.record-sort-locate{min-height:44px}.record-sort-status{flex:1 0 100%;margin:0}
`;
export function recordSortMyplaces(s){
 const runtime=readFileSync(new URL('./record-sort-runtime.js',import.meta.url),'utf8');
 s=patch(s,'const createOpportunityScan=','const createRecordSort='+createRecordSort.toString()+';\n'+runtime+'\nconst createOpportunityScan=');
 s=patch(s,'filters.append(reset,targetSelect,bodySelect);','filters.append(reset,targetSelect,bodySelect,...recordSortControl(\'recordPlaceSort\',renderRecordsHub));');
 s=patch(s,'  for (const f of recordedPlaces) {','  for (const f of sortRecordPlaces(recordedPlaces)) {');
 s=patch(s,'window.MyPlacesUI = {','window.MyPlacesUI = { recordSortControl,sortRecordPlaces,');
 s=patch(s,'document.head.append(style);','style.textContent+='+JSON.stringify(style)+';document.head.append(style);');
 return s;
}
export function recordSortHtml(s){
 s=patch(s,'recordsPanel.append(recordSearch,recordList);','const recordSortRow=document.createElement(\'div\'),recordSortSlot=document.createElement(\'span\');recordSortRow.className=\'record-sort-row\';recordSortSlot.className=\'record-sort-slot\';recordSortRow.append(recordSearch,recordSortSlot);recordsPanel.append(recordSortRow,recordList);');
 s=patch(s,"  recordList.replaceChildren();const owner=auth?.token;","  recordList.replaceChildren();recordSortSlot.replaceChildren();const owner=auth?.token;");
 s=patch(s,"  if(!owner||!toolAllowed('records'))return;\n  const recordedIds=new Set((window.MyPlacesUI?.load()||[]).map(r=>r.placeId));","  if(!owner||!toolAllowed('records'))return;\n  if(window.MyPlacesUI?.recordSortControl)recordSortSlot.replaceChildren(...window.MyPlacesUI.recordSortControl('recordPickerSort',renderRecordedPlaces));\n  const recordedIds=new Set((window.MyPlacesUI?.load()||[]).map(r=>r.placeId));");
 s=patch(s,"  const shown=points.filter(p=>[p.name,p.subtitle]","  const shown=(window.MyPlacesUI?.sortRecordPlaces||(x=>x))(points).filter(p=>[p.name,p.subtitle]");
 return s;
}
