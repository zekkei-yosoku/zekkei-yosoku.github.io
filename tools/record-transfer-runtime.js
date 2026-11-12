// Inside MyPlacesUI: portable registrations share the existing atomic store/sync.
let transferDialog=null,transferState=null,transferSequence=0;
const transferNode=(tag,props={},text)=>{const n=document.createElement(tag);Object.assign(n,props);if(text!=null)n.textContent=text;return n;};
const transferAllowed=()=>!!auth?.token&&toolAllowed('records')&&!!viewState.records&&(el('recordsView')?.dataset.tab||'points')==='points';
const transferOwner=()=>JSON.stringify([auth?.loginId,auth?.token,accessState.generation,auth?.tools]);
const transferStamp=()=>JSON.stringify([transferOwner(),favorites,load(),shapeData()]);
function transferPolicy(){return createRecordTransfer({library:AstroNotesLibrary,cleanFavorite,cleanShape:AstroNotesShooting.cleanShape,cleanAlignment:RecordAlignment.clean,rangeOf:RecordHeight.range,bodyIds:AstroNotesBodies.definitions.map(b=>b.id),
builtins:AstroNotesAlign.TARGETS.map(aimWithHeights),currentStatus:(p,key,rows)=>statusOf(p.id,key,rows),makeId:prefix=>prefix+crypto.randomUUID()});}
function transferPlaces(){const ids=new Set(load().map(r=>r.placeId));return favorites.filter(p=>p.recordRegistered||ids.has(p.id)||!!shapeFor(p));}
function transferRefresh(){if(transferDialog?.open&&(!transferAllowed()||transferState?.owner!==transferOwner()))transferDialog.close();}
function transferBuild(){
 if(transferDialog)return;transferDialog=transferNode('dialog',{id:'recordTransferDialog',className:'sheet record-transfer-sheet',tabIndex:-1});transferDialog.setAttribute('aria-labelledby','recordTransferTitle');
 transferDialog.innerHTML='<div class="sheet-head"><strong id="recordTransferTitle">撮影地点の入出力</strong><button type="button" class="chip" data-transfer-close aria-label="閉じる">閉じる</button></div><div class="sheet-body" id="recordTransferContent"></div>';
 document.body.append(transferDialog);transferDialog.querySelector('[data-transfer-close]').onclick=()=>transferDialog.close();
 transferDialog.addEventListener('close',()=>{const opener=transferState?.opener;transferState=null;transferSequence++;el('recordTransferContent').replaceChildren();if(opener?.isConnected)opener.focus({preventScroll:true});});
}
function transferMessage(message,error=false){const n=transferNode('p',{className:error?'warn':'tiny'},message);n.setAttribute('role','status');el('recordTransferContent').append(n);return n;}
function transferCurrent(state){return transferState===state&&transferDialog?.open&&transferAllowed()&&state.owner===transferOwner();}
function openRecordTransfer(opener){
 if(!transferAllowed())return;transferBuild();transferState={owner:transferOwner(),opener};el('recordTransferTitle').textContent='撮影地点の入出力';const content=el('recordTransferContent');content.replaceChildren();
 const exportButton=transferNode('button',{type:'button',className:'list-item transfer-menu-action',id:'recordTransferExport'},'エクスポート'),importButton=transferNode('button',{type:'button',className:'list-item transfer-menu-action',id:'recordTransferImport'},'インポート');
 exportButton.disabled=!transferPlaces().length;exportButton.onclick=()=>transferExport();importButton.onclick=()=>transferImport();content.append(exportButton,importButton);showSheet(transferDialog);
}
function appendRecordTransfer(actions){
 const button=transferNode('button',{type:'button',className:'chip record-transfer-more',id:'recordTransferOpen',title:'撮影地点の入出力'});button.setAttribute('aria-label','撮影地点の入出力');button.setAttribute('aria-haspopup','dialog');
 button.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';button.onclick=()=>openRecordTransfer(button);actions.append(button);
}
async function transferExport(){
 const state=transferState;if(!transferCurrent(state))return;el('recordTransferTitle').textContent='エクスポート';const content=el('recordTransferContent');content.replaceChildren();transferMessage('地点・高さ・対象・天体を保存します。');
 const rows=transferPlaces(),chosen=new Set(rows.map(p=>p.id)),tools=transferNode('div',{className:'transfer-select-tools'}),all=transferNode('button',{type:'button',className:'chip'},'全選択'),none=transferNode('button',{type:'button',className:'chip'},'全解除'),list=transferNode('div',{
 className:'transfer-place-list',id:'recordTransferPlaces'}),save=transferNode('button',{type:'button',className:'fav-btn primary',id:'recordTransferDownload'},'保存');
 const checks=[];const sync=()=>{for(const [id,check]of checks)check.checked=chosen.has(id);save.textContent=chosen.size+'地点を保存';save.disabled=!chosen.size;};
 for(const p of rows){const label=transferNode('label',{className:'transfer-place'}),check=transferNode('input',{type:'checkbox',checked:true}),caption=transferNode('span',{},p.name);check.value=p.id;check.onchange=()=>{if(check.checked)chosen.add(p.id);else chosen.delete(p.id);sync();};
 label.append(check,caption);list.append(label);checks.push([p.id,check]);}
 all.onclick=()=>{for(const p of rows)chosen.add(p.id);sync();};none.onclick=()=>{chosen.clear();sync();};tools.append(all,none);content.append(tools,list,save);sync();
 save.onclick=async()=>{
  if(!transferCurrent(state))return;save.disabled=true;
  try{await AstroNotesAssets.ensureModels();if(!transferCurrent(state))return;const live=transferPlaces();if([...chosen].some(id=>!live.some(p=>p.id===id)))throw Error('撮影地点が変更されました。開き直してください');
   const data=transferPolicy().exportPlaces({favorites,observations:load(),shapes:shapeData(),placeIds:[...chosen]}),blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),link=document.createElement('a');link.href=URL.createObjectURL(blob);
   link.download='AstroNotes-撮影地点-'+new Date().toISOString().slice(0,10)+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);transferMessage(chosen.size+'地点をエクスポートしました。');
  }catch(e){if(transferCurrent(state))transferMessage(e.message||'保存できませんでした',true);}finally{if(transferCurrent(state))sync();}
 };
}
function transferImport(){
 const state=transferState;if(!transferCurrent(state))return;el('recordTransferTitle').textContent='インポート';const content=el('recordTransferContent');content.replaceChildren();
 const input=transferNode('input',{type:'file',id:'recordTransferFile',accept:'.json,application/json',hidden:true}),pick=transferNode('button',{type:'button',className:'fav-btn',id:'recordTransferChoose'},'ファイルを選ぶ'),preview=transferNode('div',{id:'recordTransferPreview'});
 pick.onclick=()=>input.click();content.append(pick,input,transferNode('p',{className:'tiny'},'AstroNotesでエクスポートしたJSONファイルに対応しています。'),preview);
 input.onchange=async()=>{
  const file=input.files?.[0];if(!file)return;const sequence=++transferSequence;preview.replaceChildren();pick.disabled=true;const current=()=>transferCurrent(state)&&sequence===transferSequence;
  try{
   const policy=transferPolicy();if(file.size>policy.maxBytes)throw Error('ファイルは5MB以内にしてください');const raw=await file.text();if(!current())return;const source=raw.replace(/^\uFEFF/,'').trimStart(),data=JSON.parse(source);await AstroNotesAssets.ensureModels();if(!current())return;
   const readyPolicy=transferPolicy(),stamp=transferStamp(),plan=readyPolicy.prepareImport(data,{favorites,observations:load(),shapes:shapeData(),owner:auth.loginId});
   const heading=transferNode('h3',{className:'my-title'},plan.places.length+'地点'),summary=transferNode('p',{className:'tiny',id:'recordTransferSummary'});preview.append(heading,summary);
   if(!plan.canImport){summary.textContent='対象の情報が不足しているため取り込めません。';const missing=transferNode('ul');for(const name of plan.unresolved)missing.append(transferNode('li',{},name));preview.append(missing);return;}
   const r=plan.report;summary.textContent='新しい地点 '+r.addedPlaces+'・登録済み '+r.reusedPlaces+'・対象を追加 '+r.addedTargets+'・対象の登録 '+r.addedBindings+(r.duplicatePlaces?'・ファイル内の重複 '+r.duplicatePlaces:'');
   if(r.variantPlaces)preview.append(transferNode('p',{className:'tiny'},'設定が違う'+r.variantPlaces+'地点は、別の撮影地点として追加します。'));
   if(r.addedTargets){const details=transferNode('details',{className:'my-secondary',id:'recordTransferNewTargets'});details.append(transferNode('summary',{},'追加する対象 '+r.addedTargets+'件'));
   for(const p of plan.favorites.filter(p=>Number.isFinite(p.targetHeightM)&&!favorites.some(f=>f.id===p.id))){const row=transferNode('div',{className:'transfer-preview-place'});
   row.append(transferNode('strong',{},p.name),transferNode('span',{className:'tiny'},'地上 '+p.targetHeightM+'m'+(Number.isFinite(p.elevation)?' ・ 標高 '+p.elevation+'m':'')));details.append(row);}preview.append(details);}
   const list=transferNode('div',{className:'transfer-place-list'});
   for(const p of plan.places){const row=transferNode('div',{className:'transfer-preview-place'}),name=transferNode('strong',{},p.location.name),sub=transferNode('span',{className:'tiny'},[p.shape?.type==='area'?'範囲':p.shape?.type==='line'?'線':'点',
   Number.isFinite(p.location.groundManualM??p.location.elevation)?(p.shape?'代表標高 ':'標高 ')+(p.location.groundManualM??p.location.elevation)+'m':'標高未設定',
   p.location.eyeHeightRangeAGL?'地上 '+p.location.eyeHeightRangeAGL.min+'〜'+p.location.eyeHeightRangeAGL.max+'m':'地上 '+(p.location.eyeHeightAGL??1.5)+'m',p.bodies?.map(id=>AstroNotesBodies.definition(id)?.name).join('・'),p.targets.length+'対象'].filter(Boolean).join(' ・ '));row.append(name,sub);
   list.append(row);}preview.append(list);
   const apply=transferNode('button',{type:'button',className:'fav-btn primary',id:'recordTransferApply'},'インポート');preview.append(apply);apply.onclick=()=>{
    if(!current())return;
    try{
     if(stamp!==transferStamp())throw Error('登録内容が変わりました。ファイルを選び直してください');
     if(!plan.changedFavorites.length&&!r.addedPlaces&&!r.addedBindings){notebookNotice='すべて登録済みです';transferDialog.close();renderRecordsHub();return;}
     const queue=pushQueue.slice();for(const id of plan.changedFavorites){const at=queue.findIndex(q=>q.kind==='fav'&&q.id===id),change={kind:'fav',id};if(at<0)queue.push(change);else queue[at]=change;}
     AstroNotesLibrary.transaction(localStorage,[...plan.entries,['sorami.queue',queue]]);favorites=plan.favorites;pushQueue=queue;
    }catch(e){if(current()){apply.disabled=true;preview.append(transferNode('p',{className:'warn',role:'status'},e.message||'取り込めませんでした'));}return;}
    // Storage has committed. A subsequent refresh/sync failure cannot undo it.
    version++;candidateCache.clear();notebookNotice=plan.places.length+'地点をインポートしました';transferDialog.close();
    try{if(typeof RecordSync!=='undefined')RecordSync.kick();changed();aimFillSelects();SkyMapUI?.refreshTargets?.();renderAuthButton();void accountSync().syncNow().catch(()=>{});}
    catch{notebookNotice=plan.places.length+'地点を保存しました。画面を再読み込みしてください';renderRecordsHub();}
   };
  }catch(e){if(current())preview.append(transferNode('p',{className:'warn',role:'status'},e instanceof SyntaxError?'ファイルの形式を確認してください。AstroNotesでエクスポートしたJSONファイルを選んでください。':e.message||'読み込めませんでした'));}
  finally{if(current()){pick.disabled=false;input.value='';}}
 };
}
window.addEventListener('hashchange',transferRefresh);window.addEventListener('popstate',transferRefresh);
function recordSavedBodies(place){return transferPolicy().savedBodyValues(place?.planningBodies);}
function recordBodyKey(place){return JSON.stringify(recordSavedBodies(place));}
function recordBodyDirty(){return sheetState?.ctx==='records'&&sheetState.bodyBaseline!==undefined&&recordBodyKey(sheetState.place)!==sheetState.bodyBaseline;}
function renderRecordBodyPreferences(){
 const s=sheetState;if(!s)return;let details=el('myRecordBodies'),fieldset=el('myPlaceBodies')?.closest('fieldset');if(!fieldset)return;
 if(s.ctx!=='records'){if(details)details.hidden=true;if(fieldset.parentElement!==el('myPlacePlanning'))el('myPlaceFind').before(fieldset);return;}
 if(s.bodyBaseline===undefined)s.bodyBaseline=recordBodyKey(placeOf(s.place.id)||s.place);
 if(!details){details=transferNode('details',{id:'myRecordBodies',className:'my-secondary'});details.append(transferNode('summary'));el('myRecordPickTarget').closest('.my-input-field').before(details);}
 details.hidden=false;if(fieldset.parentElement!==details)details.append(fieldset);fieldset.hidden=false;details.querySelector('summary').textContent='天体：'+(s.bodies.map(id=>AstroNotesBodies.definition(id)?.name).filter(Boolean).join('・')||'指定なし');
}
function saveRecordBodyMetadata(plan,args){
 const next=plan.favorites.find(p=>p.id===args.place.id);if(!next)return plan;const bodies=recordSavedBodies(args.place);
 if(recordBodyKey(next)!==JSON.stringify(bodies)){if(bodies)next.planningBodies=bodies;else delete next.planningBodies;if(!plan.changedFavorites.includes(next.id))plan.changedFavorites.push(next.id);}return plan;
}
