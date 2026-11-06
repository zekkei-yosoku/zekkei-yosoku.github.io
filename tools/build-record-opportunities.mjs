import {readFileSync} from 'node:fs';
import {createOpportunityScan} from './record-opportunity-scan.mjs';
const patch=(s,from,to)=>{if(s.split(from).length!==2)throw Error('Record opportunities boundary changed: '+from.slice(0,80));return s.replace(from,to);};
const style=String.raw`
#recordOpportunities{max-width:780px;margin-inline:auto}
.record-opportunity-controls{display:grid;gap:12px}
.record-opportunity-period{display:grid;grid-template-columns:44px minmax(0,1fr) 44px 44px;gap:4px;align-items:center}
.record-opportunity-period button{min-width:0;min-height:44px;padding:4px;font-size:14px}
.record-opportunity-period button:is(#recordOpportunityPrev,#recordOpportunityNext){font-size:24px}
.record-opportunity-month{position:relative;display:grid;place-items:center;min-width:0;height:44px;font-size:16px;font-weight:600;white-space:nowrap;border:1px solid var(--line);border-radius:10px;background:var(--card)}
.record-opportunity-month input{position:absolute;inset:0;width:100%;height:44px;min-width:0;margin:0;opacity:0;font-size:16px;cursor:pointer}
.record-opportunity-month:focus-within{outline:2px solid var(--accent);outline-offset:2px}
.record-opportunity-filters{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px}
.record-opportunity-filter{display:grid;gap:4px;min-width:0;font-size:12px;color:var(--secondary)}
.record-opportunity-filters .record-opportunity-select{box-sizing:border-box;width:100%;min-width:0;min-height:44px;font-size:16px;margin:0;background-color:var(--card)}
.record-opportunity-select{text-align:left;position:relative;padding:10px 30px 10px 12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text);border:1px solid var(--line);border-radius:10px}
.record-opportunity-select::after{content:'';position:absolute;right:13px;top:17px;width:7px;height:7px;border-right:2px solid var(--secondary);border-bottom:2px solid var(--secondary);transform:rotate(45deg)}
.record-opportunity-select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.record-opportunity-picker{box-sizing:border-box;width:min(440px,calc(100vw - 28px));max-height:min(80dvh,640px);padding:16px;border:1px solid var(--line);border-radius:18px;background:var(--card);color:var(--text);overflow:hidden}
.record-opportunity-picker[open]{display:flex;flex-direction:column;gap:12px}
.record-opportunity-picker::backdrop{background:rgba(0,0,0,.6)}
.record-opportunity-picker-head,.record-opportunity-picker-tools,.record-opportunity-picker-foot{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-shrink:0}
.record-opportunity-picker h2{font-size:18px;margin:0}.record-opportunity-picker button{min-height:44px;font-size:14px}
.record-opportunity-picker #recordOpportunityPickerSearch{box-sizing:border-box;width:100%;min-height:44px;font-size:16px;margin:0;flex-shrink:0}
.record-opportunity-picker-tools{justify-content:flex-start}.record-opportunity-picker-tools button{flex:1}
.record-opportunity-picker-list{overflow:auto;overscroll-behavior:contain;min-height:0;scroll-padding:6px}
.record-opportunity-picker-item{display:flex;align-items:center;gap:12px;min-height:48px;padding:8px 4px;box-sizing:border-box;border-bottom:1px solid var(--line);overflow-wrap:anywhere;cursor:pointer}
.record-opportunity-picker-item input{width:20px;height:20px;margin:0;flex-shrink:0;accent-color:var(--accent)}
.record-opportunity-picker-foot #recordOpportunityPickerApply{min-width:96px;background:var(--accent);color:var(--accent-ink,var(--bg))}
:is(#recordOpportunityStatus,#recordOpportunityNotice){margin:12px 0;color:var(--secondary)}:is(#recordOpportunityStatus,#recordOpportunityNotice):empty{display:none}
.record-opportunity-day{margin-top:20px}.record-opportunity-day h3{font-size:16px;margin:0 0 6px;font-weight:600}
.record-opportunity-row{display:grid;grid-template-columns:52px minmax(0,1fr) 12px;grid-template-rows:auto auto;gap:2px 12px;align-items:center;width:100%;min-height:64px;padding:12px 0;border:0;border-bottom:1px solid var(--line);border-radius:0;text-align:left;background:transparent;color:var(--text)}
.record-opportunity-time{grid-column:1;grid-row:1;align-self:end;font-size:16px;font-variant-numeric:tabular-nums;color:var(--accent)}
.record-opportunity-body{grid-column:1;grid-row:2;align-self:start;font-size:12px;color:var(--secondary)}
.record-opportunity-row strong{grid-column:2;grid-row:1/3;font-size:14px;line-height:1.6;overflow-wrap:anywhere}
.record-opportunity-arrow{grid-column:3;grid-row:1/3;color:var(--secondary)}
.record-opportunity-row.has-height strong{grid-row:1}.record-opportunity-height{grid-column:2;grid-row:2;font-size:12px;color:var(--secondary)}
.record-opportunity-actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 0}.record-opportunity-actions:has(>button:not([hidden])){padding-bottom:4px}
.record-opportunity-row:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
`;
export function recordOpportunitiesMyplaces(s){
 const runtime=readFileSync(new URL('./record-opportunities-runtime.js',import.meta.url),'utf8');
 s=patch(s,'renderRecordsHub();\nwindow.MyPlacesUI = {','const createOpportunityScan='+createOpportunityScan.toString()+';\n'+runtime+'\nrenderRecordsHub();\nwindow.MyPlacesUI = { opportunities,');
 s=patch(s,'function renderRecordsHub() {','function renderRecordsHub() {\n  renderOpportunities();');
 s=patch(s,'document.head.append(style);','style.textContent+='+JSON.stringify(style)+';document.head.append(style);');
 const start=s.indexOf('    if(!notebookEdit&&planningPairs(targets,recordsBodyFilter?'),end=s.indexOf('list.append(group);',start);
 if(start<0||end<0)throw Error('Record place opportunity action boundary changed');
 s=s.slice(0,start)+`    if(!notebookEdit&&planningPairs(targets,recordsBodyFilter?[recordsBodyFilter]:['sun','moon']).length){const find=document.createElement('button');find.type='button';find.className='chip journey-place-find';find.textContent='重なる日';find.setAttribute('aria-label',f.name+'の重なる日を一覧で見る');find.onclick=()=>openOpportunityList(f.id,recordsBodyFilter?[recordsBodyFilter]:['sun','moon']);group.append(find);}`+s.slice(end);
 s=patch(s,"el('myPlaceFind').onclick=()=>{if(!sheetOwnerMatches())return;sheetState.planningRequested=true;renderSheet();};", "el('myPlaceFind').onclick=()=>{if(!sheetOwnerMatches())return;if(sheetState.ctx==='records'){if(draftChanged()||!sheetState.place.id)return;openOpportunityList(sheetState.place.id,sheetState.bodies);return;}sheetState.planningRequested=true;renderSheet();};");
 s=patch(s,"el('myPlaceNext').previousElementSibling.hidden=false;", "el('myPlaceNext').previousElementSibling.hidden=false;if(ctx==='records'){el('myPlaceFind').disabled=!pairs.length||draftChanged()||!place.id;el('myPlaceFind').textContent=draftChanged()?'保存後に確認':'重なる日';next.hidden=true;next.previousElementSibling.hidden=true;return;}el('myPlaceFind').textContent='次に重なる日を探す';next.hidden=false;");
 return s;
}
export function recordOpportunitiesHtml(html){
 html=patch(html,'if(seq!==aimAirSeq)return;aimApply();})();','if(seq!==aimAirSeq)return;document.dispatchEvent(new Event("astronotes-opportunity-input"));aimApply();})();');
 html=patch(html,'AstroNotesAtmosphere.configure(aimAirSettings.mode,aimAirSettings);store.set("sorami.aimAir",aimAirSettings);','AstroNotesAtmosphere.configure(aimAirSettings.mode,aimAirSettings);store.set("sorami.aimAir",aimAirSettings);document.dispatchEvent(new Event("astronotes-opportunity-input"));');
 html=patch(html,'<div id="myRecordsHub" class="card" role="tabpanel" aria-labelledby="notebookPointsTab"></div>','<div id="recordOpportunities" class="card" role="tabpanel" aria-labelledby="notebookOpportunitiesTab" hidden></div>\n    <div id="myRecordsHub" class="card" role="tabpanel" aria-labelledby="notebookPointsTab"></div>');
 html=patch(html,'<button type="button" role="tab" id="notebookPlansTab"', '<button type="button" role="tab" id="notebookOpportunitiesTab" aria-selected="false" aria-controls="recordOpportunities" tabindex="-1">重なる日</button><button type="button" role="tab" id="notebookPlansTab"');
 html=patch(html,"notebookTab=tab==='plans'?'plans':'points';", "notebookTab=['points','opportunities','plans'].includes(tab)?tab:'points';");
 const tabs="[['notebookPointsTab','points'],['notebookPlansTab','plans']]";if(html.split(tabs).length!==3)throw Error('Notebook tab owner changed');html=html.replaceAll(tabs,"[['notebookPointsTab','points'],['notebookOpportunitiesTab','opportunities'],['notebookPlansTab','plans']]");
 html=patch(html,"$('myRecordsHub').hidden=notebookTab!=='points';$('scheduleHub').hidden=notebookTab!=='plans';", "$('myRecordsHub').hidden=notebookTab!=='points';$('scheduleHub').hidden=notebookTab!=='plans';$('recordOpportunities').hidden=notebookTab!=='opportunities';globalThis.MyPlacesUI?.opportunities?.render();");
 html=patch(html,"notebookTab==='points'?'plans':'points',true)", "['points','opportunities','plans'][(['points','opportunities','plans'].indexOf(notebookTab)+(e.key==='ArrowRight'?1:2))%3],true)");
 html=patch(html,'function renderNotebook(){','function renderNotebook(){\n  globalThis.MyPlacesUI?.opportunities?.render();');
 return html;
}
