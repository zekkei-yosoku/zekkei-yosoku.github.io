import {readFileSync} from 'node:fs';import {createRecordAlignmentPolicy} from './record-alignment-policy.mjs';
const patch=(s,a,b)=>{if(s.split(a).length!==2)throw Error('Record alignment boundary changed: '+a.slice(0,100));return s.replace(a,b);};
const style=String.raw`
.record-alignment-editor{flex-basis:100%;display:grid;grid-template-columns:minmax(0,1fr);gap:8px;padding:6px 0 2px;min-width:0}
#myPlaceSheet .my-draft-target:has(.record-alignment-editor){flex-wrap:wrap}
.record-alignment-position{display:grid;gap:4px;min-width:0;font-size:12px;color:var(--secondary)}
.record-alignment-position select,.record-alignment-limbs select{box-sizing:border-box;width:100%;min-width:0;min-height:44px;margin:0;font-size:16px}
.record-alignment-limbs{display:grid;grid-template-columns:minmax(0,1fr);gap:4px;min-width:0}
.record-alignment-limbs[hidden]{display:none!important}
#skyMapAlignmentControls{display:grid;gap:8px}
#previewEyeHeightControls{margin:0 0 6px;padding:0;border:0;background:none;min-width:0}
#previewEyeHeightControls[hidden]{display:none!important}
.preview-eye-row{display:grid;grid-template-columns:minmax(0,1fr) 96px;column-gap:10px;align-items:end}
.preview-eye-tools{min-width:0}.preview-eye-scale{display:block;font-size:11px;line-height:14px;color:var(--secondary);margin:0}
.preview-eye-value,#aimLook .preview-focal-bar .preview-focal-value{display:flex;align-items:center;justify-content:flex-end;gap:2px;height:44px;min-width:0;font-size:15px;font-weight:600;font-variant-numeric:tabular-nums}
#previewEyeValue,#aimLook .preview-focal-value [data-preview-focal-input]{box-sizing:border-box;width:0;flex:1;min-width:0;min-height:44px;padding:0;border:0;background:transparent;color:var(--text);text-align:right;font-size:15px;font-weight:600;appearance:textfield;border-radius:0}
.preview-eye-value,#aimLook .preview-focal-bar .preview-focal-value{box-sizing:border-box;border:1px solid var(--line);border-radius:8px;background:var(--sunk);padding:0 6px;cursor:text}
.preview-eye-value:focus-within,#aimLook .preview-focal-bar .preview-focal-value:focus-within{border-color:var(--accent);outline:2px solid color-mix(in srgb,var(--accent) 28%,transparent);outline-offset:1px}
#previewEyeValue::-webkit-inner-spin-button,#previewEyeValue::-webkit-outer-spin-button{appearance:none;margin:0}
.numeric-ruler-track{box-sizing:border-box;position:relative;min-width:0;height:46px;overflow:hidden;border:1px solid var(--line);border-radius:8px;background:var(--sunk)}
.numeric-ruler-track .numeric-ruler{height:44px;width:100%;cursor:ew-resize;direction:ltr}
.numeric-ruler-track .sky-map-timeline-center{top:4px;bottom:4px}.numeric-ruler-track .sky-timeline-label{top:20px}
#previewEyeRuler .sky-timeline-tape{background-image:repeating-linear-gradient(to right,var(--line) 0 1px,transparent 1px calc(var(--timeline-unit)*5));background-size:calc(var(--timeline-unit)*5) 8px!important}
#aimLook .preview-focal-tools{margin:0}
#aimLook .aim-lens .preview-focal-bar{grid-template-columns:minmax(0,1fr) 96px;margin:0;column-gap:10px}
#aimLook .preview-focal-scale{font-size:11px;line-height:14px}
.preview-focal-tools .numeric-ruler-track{width:100%;height:46px}
[data-focal-range][hidden]{display:none!important}
#aimLook .preview-focal-bar .preview-focal-value{box-sizing:border-box;width:96px;min-width:96px;max-width:96px;height:44px;line-height:normal;padding-bottom:0;font-variant-numeric:tabular-nums}
#previewEyeError{margin:4px 0 0;color:var(--secondary)}
`;
export function recordAlignmentMyplaces(s){
 const runtime=readFileSync(new URL('./record-alignment-runtime.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('./preview-eye-height-runtime.js',import.meta.url),'utf8');
 s=patch(s,'const RecordHeight=','const RecordAlignment=('+createRecordAlignmentPolicy.toString()+')({isMountain:aimIsMountain,limbs:AstroNotesAlign.LIMBS});\n'+runtime+'\nconst RecordHeight=');
 s=patch(s,'  renderRecordHeight();','  recordAlignmentInit();applyRecordAlignments();renderRecordHeight();');
 s=patch(s,'recordHeightDirty()||','recordHeightDirty()||recordAlignmentDirty()||');
 s=patch(s,'row.append(text,remove);recs.append(row);','row.append(text,remove);appendRecordAlignment(row,t);recs.append(row);');
 s=patch(s,'!draftChanged()||!!sheetState.heightLoading||!applyRecordHeightDraft();el(\'myRecordPickTarget\')','!draftChanged()||!!sheetState.heightLoading||!applyRecordHeightDraft()||!applyRecordAlignments();el(\'myRecordPickTarget\')');
 s=patch(s,'current=placeOf(s.place.id);if(!applyRecordHeightDraft(true))return false;',"current=placeOf(s.place.id);if(s.ctx==='records'&&s.heightLoading){err.textContent='標高を取得しています。完了を待つか、値を入力してください';err.hidden=false;return false;}if(!applyRecordHeightDraft(true)||!applyRecordAlignments()){err.textContent='高さや重ね方を確認してください';err.hidden=false;return false;}");
 s=patch(s,'RecordHeight.key(current)!==s.heightBaseline:','(RecordHeight.key(current)!==s.heightBaseline||RecordAlignment.key(current)!==s.alignmentBaseline):');
 s=patch(s,' return plan;\n}\n\nfunction recordHeightText',' return saveRecordAlignmentMetadata(plan,args);\n}\n\nfunction recordHeightText');
 s=patch(s,"const detail=el('skyMapAlignmentDetails');detail.hidden=true;el('skyMapAlignmentSummary').textContent='重ね方';box.hidden=!t;", "const detail=el('skyMapAlignmentDetails');renderSkyAlignment(s);renderPreviewEyeHeight(s);box.hidden=!t;");
 s=patch(s,"  el('skyMapAlignmentControls').replaceChildren();",'  // Alignment controls retain their focused DOM while the candidate key changes.');
 s=patch(s,'const plan=AstroNotesLibrary.prepareQuickRecord({owner:', 'const plan=prepareAlignedQuickRecord({owner:');
 s=patch(s,'window.MyPlacesUI = {','window.MyPlacesUI = { eyeAdjustmentFor,');
 s=patch(s,'document.head.append(style);','style.textContent+='+JSON.stringify(style)+';document.head.append(style);');return s;
}
