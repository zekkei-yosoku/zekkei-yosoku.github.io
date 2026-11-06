import {readFileSync} from 'node:fs';
import {createRecordTransfer} from './record-transfer-policy.mjs';
const patch=(s,a,b)=>{if(s.split(a).length!==2)throw Error('Record transfer boundary changed: '+a.slice(0,95));return s.replace(a,b);};
const style=String.raw`
#myRecordsHub .my-head .record-transfer-more{display:grid;place-items:center;width:44px;min-width:44px;min-height:44px;padding:0;flex:none}
.record-transfer-sheet{box-sizing:border-box;width:min(560px,calc(100vw - 24px));max-height:85dvh;border:1px solid var(--line);border-radius:16px;background:var(--card);color:var(--text);padding:0;overflow:auto}
.record-transfer-sheet::backdrop{background:#0009}.record-transfer-sheet .sheet-head{position:sticky;top:0;z-index:1;background:var(--card);padding:12px 16px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line)}
.record-transfer-sheet .sheet-head button{min-height:44px}.record-transfer-sheet .sheet-body{padding:12px 16px 16px;min-width:0}
.record-transfer-sheet .transfer-menu-action{width:100%;min-height:52px;text-align:left;display:block;font-size:16px}
.record-transfer-sheet .fav-btn{width:100%;min-height:44px;margin-top:12px}.record-transfer-sheet .transfer-select-tools{display:flex;gap:8px}.record-transfer-sheet .transfer-select-tools button{min-height:44px}
.transfer-place-list{max-height:38dvh;overflow:auto;overscroll-behavior:contain;margin-top:8px}.transfer-place{display:flex;align-items:center;gap:12px;min-height:48px;padding:8px 0;border-bottom:1px solid var(--line);overflow-wrap:anywhere}.transfer-place input{width:20px;height:20px;margin:0;flex:none;accent-color:var(--accent)}
.transfer-preview-place{display:grid;gap:4px;padding:12px 0;border-bottom:1px solid var(--line);overflow-wrap:anywhere}#myRecordBodies{margin:12px 0}#myRecordBodies>summary{min-height:44px;display:list-item;align-content:center;color:var(--text);font-size:14px}
`;
export function recordTransferMyplaces(s){
 const runtime=readFileSync(new URL('./record-transfer-runtime.js',import.meta.url),'utf8');
 s=patch(s,'const createOpportunityScan=','const createRecordTransfer='+createRecordTransfer.toString()+';\n'+runtime+'\nconst createOpportunityScan=');
 s=patch(s,'function renderRecordsHub() {','function renderRecordsHub() {\n  transferRefresh();');
 s=patch(s,'actions.append(edit,add);if(notebookEdit)','actions.append(edit);appendRecordTransfer(actions);actions.append(add);if(notebookEdit)');
 s=patch(s,"map.textContent = '地図で場所を探す';", "map.textContent = '地図';map.setAttribute('aria-label','地図で場所を探す');");
 s=patch(s,'favorites.filter(f=>recordedIds.has(f.id)||!!shapeFor(f))','favorites.filter(f=>f.recordRegistered||recordedIds.has(f.id)||!!shapeFor(f))');
 const a=s.indexOf('  const note = document.createElement(\'p\'); note.className = \'tiny\'; note.textContent = \'撮影地点・見える対象'),b=s.indexOf('host.append(backup);',a);if(a<0||b<0)throw Error('Record backup footer changed');s=s.slice(0,a)+s.slice(b+'host.append(backup);'.length);
 s=patch(s,'function renderSheet() {','function renderSheet() {\n  renderRecordBodyPreferences();');
 s=patch(s,'recordHeightDirty()||','recordBodyDirty()||recordHeightDirty()||');
 s=patch(s,"bodies:[ctx === 'sky' ? (skySession?.body || 'sun') : aim.body]", "bodies:ctx==='records'?(recordSavedBodies(place)||[aim.body]):[ctx === 'sky' ? (skySession?.body || 'sun') : aim.body]");
 s=patch(s,"el('myPlaceTitle').textContent = initialTargets.length?'記録を編集':'記録を追加';", "if(el('myRecordBodies'))el('myRecordBodies').open=false;\n  el('myPlaceTitle').textContent = initialTargets.length?'記録を編集':'記録を追加';");
 s=patch(s,"sheetState.planningRequested=false;renderSheet();};", "if(sheetState.ctx==='records'){if(sheetState.bodies.length)sheetState.place.planningBodies=sheetState.bodies.slice();else delete sheetState.place.planningBodies;}sheetState.planningRequested=false;renderSheet();};");
 s=patch(s,'RecordAlignment.key(current)!==s.alignmentBaseline)', 'RecordAlignment.key(current)!==s.alignmentBaseline||recordBodyKey(current)!==s.bodyBaseline)');
 s=patch(s,'return saveRecordAlignmentMetadata(plan,args);','return saveRecordBodyMetadata(saveRecordAlignmentMetadata(plan,args),args);');
 s=patch(s,'document.head.append(style);','style.textContent+='+JSON.stringify(style)+';document.head.append(style);');return s;
}
export function recordTransferLibrary(s){
 s=patch(s,'!observations.some(r=>r.placeId===p.id)&&!shapes[p.id]', '!observations.some(r=>r.placeId===p.id)&&!shapes[p.id]&&!p.recordRegistered');
 s=patch(s,'for(const id of ids)delete nextShapes[id];',"for(const id of ids)delete nextShapes[id];nextFavorites=favorites.map(f=>{if(!ids.has(f.id)||(!f.recordRegistered&&!f.recordAlignments&&!f.planningBodies))return f;const next={...f};delete next.recordRegistered;delete next.recordAlignments;delete next.planningBodies;changedFavorites.push(f.id);return next;});");return s;
}
export function recordTransferHtml(s){return patch(s,"recordedIds.has(p.id)||!!window.MyPlacesUI?.shapeFor(p)","p.recordRegistered||recordedIds.has(p.id)||!!window.MyPlacesUI?.shapeFor(p)");}
