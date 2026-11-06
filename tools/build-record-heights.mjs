import {createRecordHeightCandidates} from './record-height-candidates.mjs';
import {scanRecordHeights} from './record-height-scan.mjs';
import {readFileSync} from 'node:fs';
import {createRecordHeightPolicy} from './record-height-policy.mjs';
const patch=(s,a,b)=>{if(s.split(a).length!==2)throw Error('Record height boundary changed: '+a.slice(0,100));return s.replace(a,b);};
const style=String.raw`
#myRecordHeight{min-width:0;border:0;border-block:1px solid var(--line);padding:14px 0;margin:14px 0}
#myRecordHeight legend{float:left;width:100%;padding:0;margin:0 0 12px;font-size:14px;font-weight:600}
#myRecordHeight legend+label{clear:both}
.record-height-label{display:block;font-size:12px;color:var(--secondary);margin:10px 0 6px}
.record-height-ground{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center}
.record-height-number{display:flex;align-items:center;gap:8px;min-width:0;padding:0 12px;border:1px solid var(--line);border-radius:10px;background:var(--card)}
#myRecordHeight input{box-sizing:border-box;min-width:0;width:100%;min-height:44px;margin:0;padding:8px 0;border:0;background:transparent;font-size:16px;color:var(--text)}
.record-height-number>span{font-size:13px;color:var(--secondary)}
.record-height-modes,.record-height-values{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;min-width:0}
.record-height-modes{padding:3px;background:var(--sunk);border-radius:10px;margin-bottom:8px}
#myRecordHeight button{min-height:44px;font-size:14px}
.record-height-modes button{border:0;border-radius:8px;background:transparent;color:var(--secondary)}
.record-height-modes button[aria-pressed=true]{background:var(--card);color:var(--accent);box-shadow:0 1px 4px #0002}
.record-height-values>label{min-width:0}.record-height-values .tiny{display:block;margin:0 0 4px}
#myHeightFixedFields{grid-template-columns:minmax(0,1fr);padding-top:20px}
#myHeightFixedFields[hidden],#myHeightRangeFields[hidden],#myRecordHeight[hidden]{display:none!important}
#myRecordHeight .warn{font-size:12px;margin:8px 0 0}
`;
export function recordHeightMyplaces(s){
 const runtime=readFileSync(new URL('./record-height-editor-runtime.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('./record-height-runtime.js',import.meta.url),'utf8');
 s=patch(s,'const createOpportunityScan=','const createRecordHeightCandidates='+createRecordHeightCandidates.toString()+';\nconst scanRecordHeights='+scanRecordHeights.toString()+';\nconst RecordHeight=('+createRecordHeightPolicy.toString()+')();\n'+runtime+'\nconst createOpportunityScan=');
 s=patch(s,'document.body.append(sheet);','document.body.append(sheet);buildRecordHeight();');
 s=patch(s,'function renderSheet() {','function renderSheet() {\n  renderRecordHeight();');
 s=patch(s,"const draftChanged=()=>!!sheetState&&(","const draftChanged=()=>!!sheetState&&(recordHeightDirty()||");
 s=patch(s,"el('myRecordSave').disabled=!draftPoint()||!!sheetState.locationPending||!draftChanged();el('myRecordPickTarget')", "el('myRecordSave').disabled=!draftPoint()||!!sheetState.locationPending||!draftChanged()||!!sheetState.heightLoading||!applyRecordHeightDraft();el('myRecordPickTarget')");
 s=patch(s,"const plan=AstroNotesLibrary.prepareRecord({owner:auth.loginId,favorites,observations:load(),shapes:shapeData(),place:current,isNew,", "const plan=prepareHeightRecord({owner:auth.loginId,favorites,observations:load(),shapes:shapeData(),place:current,isNew,");
 s=patch(s,"const s=sheetState,err=el('myRecordError'),current=placeOf(s.place.id);", "const s=sheetState,err=el('myRecordError'),current=placeOf(s.place.id);if(!applyRecordHeightDraft(true))return false;");
 const old="current.latitude!==s.place.latitude||current.longitude!==s.place.longitude||(current.eyeHeightAGL??1.5)!==(s.place.eyeHeightAGL??1.5)";
 s=patch(s,'if('+old+")return fail('地点が変更されました。開き直してください');", "if(s.ctx==='records'?RecordHeight.key(current)!==s.heightBaseline:("+old+"))return fail('地点が変更されました。開き直してください');");
 s=patch(s,'return commitRecordDraft(renamed?{...current,name}:current,false);',"return commitRecordDraft(s.ctx==='records'?{...current,...s.place,name}:renamed?{...current,name}:current,false);");
 s=s.replaceAll('`地上から ${place.eyeHeightAGL ?? 1.5}m`','recordHeightText(place)').replaceAll('`地上から ${place.eyeHeightAGL??1.5}m`','recordHeightText(place)');
 s=patch(s,'document.head.append(style);','style.textContent+='+JSON.stringify(style)+';document.head.append(style);');
 return s;
}
