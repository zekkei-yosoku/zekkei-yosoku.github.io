import {readFileSync} from 'node:fs';import {createRecordAlignmentPolicy} from './record-alignment-policy.mjs';
const patch=(s,a,b)=>{if(s.split(a).length!==2)throw Error('Record alignment boundary changed: '+a.slice(0,100));return s.replace(a,b);};
const style=String.raw`
.record-alignment-editor{flex-basis:100%;display:grid;grid-template-columns:minmax(0,1fr);gap:8px;padding:6px 0 2px;min-width:0}
#myPlaceSheet .my-draft-target:has(.record-alignment-editor){flex-wrap:wrap}
.record-alignment-position{display:grid;gap:4px;min-width:0;font-size:12px;color:var(--secondary)}
.record-alignment-position select{box-sizing:border-box;width:100%;min-width:0;min-height:44px;margin:0;font-size:16px}
.record-alignment-limbs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;min-width:0}
.record-alignment-limbs[hidden]{display:none!important}.record-alignment-limbs button{min-width:0;min-height:44px;font-size:13px;padding:6px}
.record-alignment-limbs button[aria-pressed=true]{color:var(--accent);border-color:var(--accent)}
#skyMapAlignmentControls{display:grid;gap:8px}
`;
export function recordAlignmentMyplaces(s){
 const runtime=readFileSync(new URL('./record-alignment-runtime.js',import.meta.url),'utf8');
 s=patch(s,'const RecordHeight=','const RecordAlignment=('+createRecordAlignmentPolicy.toString()+')({isMountain:aimIsMountain,limbs:AstroNotesAlign.LIMBS});\n'+runtime+'\nconst RecordHeight=');
 s=patch(s,'  renderRecordHeight();','  recordAlignmentInit();applyRecordAlignments();renderRecordHeight();');
 s=patch(s,'recordHeightDirty()||','recordHeightDirty()||recordAlignmentDirty()||');
 s=patch(s,'row.append(text,remove);recs.append(row);','row.append(text,remove);appendRecordAlignment(row,t);recs.append(row);');
 s=patch(s,'!draftChanged()||!!sheetState.heightLoading||!applyRecordHeightDraft();el(\'myRecordPickTarget\')','!draftChanged()||!!sheetState.heightLoading||!applyRecordHeightDraft()||!applyRecordAlignments();el(\'myRecordPickTarget\')');
 s=patch(s,'current=placeOf(s.place.id);if(!applyRecordHeightDraft(true))return false;',"current=placeOf(s.place.id);if(s.ctx==='records'&&s.heightLoading){err.textContent='標高を取得しています。完了を待つか、値を入力してください';err.hidden=false;return false;}if(!applyRecordHeightDraft(true)||!applyRecordAlignments()){err.textContent='高さや重ね方を確認してください';err.hidden=false;return false;}");
 s=patch(s,'RecordHeight.key(current)!==s.heightBaseline:','(RecordHeight.key(current)!==s.heightBaseline||RecordAlignment.key(current)!==s.alignmentBaseline):');
 s=patch(s,' return plan;\n}\n\nfunction recordHeightText',' return saveRecordAlignmentMetadata(plan,args);\n}\n\nfunction recordHeightText');
 s=patch(s,"const detail=el('skyMapAlignmentDetails');detail.hidden=true;el('skyMapAlignmentSummary').textContent='重ね方';box.hidden=!t;", "const detail=el('skyMapAlignmentDetails');renderSkyAlignment(s);box.hidden=!t;");
 s=patch(s,"  el('skyMapAlignmentControls').replaceChildren();",'  // Alignment controls retain their focused DOM while the candidate key changes.');
 s=patch(s,'const plan=AstroNotesLibrary.prepareQuickRecord({owner:', 'const plan=prepareAlignedQuickRecord({owner:');
 s=patch(s,'document.head.append(style);','style.textContent+='+JSON.stringify(style)+';document.head.append(style);');return s;
}
