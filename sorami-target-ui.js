/* Shared target selection/editor. Search moves its own map; editing never opens a place/favorite sheet. */
(function(root){
'use strict';
function mount(deps){
 const L=root.SoramiLibrary,d=document,by=id=>d.getElementById(id),make=(tag,props={})=>Object.assign(d.createElement(tag),props);
 const dialog=make('dialog',{id:'previewTargetDialog',className:'sheet preview-body-dialog'});dialog.setAttribute('aria-labelledby','previewTargetTitle');
 dialog.innerHTML=`<div class="sheet-head"><strong id="previewTargetTitle">対象を選ぶ</strong><button type="button" data-target-close>キャンセル</button></div><div class="sheet-body"><section data-target-list-panel><input type="search" class="fav-in target-search" aria-label="対象を検索" placeholder="対象名・場所で検索"><div class="preview-target-list"></div><p class="tiny" data-target-empty hidden>見つかりませんでした。</p><div class="my-actions"><button type="button" class="chip" data-target-new>＋ 対象を追加</button><button type="button" class="chip" data-target-clear>選択を解除</button><button type="button" class="fav-btn primary" data-target-done>完了</button></div></section><section data-target-editor hidden><div class="target-location-search"><input id="targetPlaceSearch" type="search" class="fav-in" placeholder="地名・緯度経度・地図のURL" aria-label="対象の場所を検索"><button type="button" class="chip" id="targetPlaceSearchGo">検索</button></div><div id="targetPlaceResults"></div><div class="mapwrap"><canvas id="targetEditorCanvas" aria-label="対象の位置を選ぶ地図"></canvas><div class="map-cross" aria-hidden="true">＋</div><div class="mapzoom"><button type="button" id="targetEditorIn" aria-label="拡大">＋</button><button type="button" id="targetEditorOut" aria-label="縮小">−</button></div></div><label>名前<input type="text" class="fav-in" data-target-name maxlength="200" placeholder="対象の名前"></label><label>地上からの高さ（m）<input type="number" class="fav-in" data-target-height min="0" max="1000" step="any" value="0"></label><p class="tiny" data-target-coordinate></p><p class="warn" data-target-error role="status" hidden></p><div data-target-duplicates hidden></div><div class="my-actions"><button type="button" class="chip" data-target-back>戻る</button><button type="button" class="fav-btn primary" data-target-add>対象を追加</button></div></section></div>`;
 d.body.append(dialog);
 const q=s=>dialog.querySelector(s),list=q('.preview-target-list'),search=q('.target-search'),editor=q('[data-target-editor]'),panel=q('[data-target-list-panel]');
 const request=L.gate();let state=null,map=null;
 const valid=s=>state===s&&s?.owner===deps.owner()&&dialog.open;
 const targets=()=>{const rows=state?.options.getTargets?.()||deps.targets();const extra=(state?.drafts||[]).map(x=>L.targetFromFavorite(x.entry));return [...new Map([...rows,...extra].filter(t=>t.id!=='custom').map(t=>[t.id||t.key,t])).values()];};
 const targetKey=t=>t.key||t.id;
 const selected=()=>new Set((state?.selected||[]).map(targetKey));
 const describe=t=>state?.drafts.some(x=>'fav:'+x.entry.id===t.id)?'未保存 ・ '+t.latitude.toFixed(5)+', '+t.longitude.toFixed(5):deps.describe(t);
 function close(){request.cancel();dialog.close();}
 function choose(t){
  const s=state;if(!valid(s))return;
  if(s.options.multiple){const key=targetKey(t),at=s.selected.findIndex(x=>targetKey(x)===key);if(at>=0)s.selected.splice(at,1);else s.selected.push(t);render();return;}
  deps.select(s.source,targetKey(t));close();
 }
 function render(){
  if(!state)return;const s=state,filter=L.nameKey(search.value),checked=selected();list.replaceChildren();let count=0;
  for(const t of targets()){
   if(!L.nameKey(t.name+' '+describe(t)).includes(filter))continue;
   if(!s.options.multiple&&![...s.source.options].some(o=>o.value===t.id&&!o.disabled))continue;
   count++;const row=make('div',{className:'target-choice-row'}),button=make('button',{type:'button',className:'preview-body-choice',textContent:t.name});
   button.setAttribute('aria-pressed',String(s.options.multiple?checked.has(targetKey(t)):s.source.value===t.id));
   if(s.options.multiple){button.removeAttribute('aria-pressed');button.setAttribute('role','checkbox');button.setAttribute('aria-checked',String(checked.has(targetKey(t))));}
   const sub=make('span',{className:'tiny sub-line',textContent:describe(t)});button.append(sub);button.onclick=()=>choose(t);row.append(button);
   if(t.favId){const edit=make('button',{type:'button',className:'chip',textContent:'編集'});edit.setAttribute('aria-label',t.name+'を編集');edit.onclick=()=>openEditor(t);row.append(edit);}list.append(row);
  }
  q('[data-target-empty]').hidden=count>0;q('[data-target-done]').hidden=!s.options.multiple;
  q('[data-target-clear]').hidden=s.options.multiple||![...s.source.options].some(o=>o.value==='');
  q('[data-target-done]').textContent='完了'+(s.selected.length?'（'+s.selected.length+'件）':'');
 }
 function listMode(){request.cancel();editor.hidden=true;panel.hidden=false;q('#previewTargetTitle').textContent='対象を選ぶ';render();}
 function move(p){
  const s=state;if(!valid(s)||!p||!L.point(p))return;
  request.cancel();s.searchPoint=p;map.setView(p.latitude,p.longitude,16);
  const input=q('[data-target-name]');if(!input.value.trim()||input.dataset.auto==='true'){input.value=p.name||'';input.dataset.auto='true';}
  const h=p.targetHeightM??p.structureM;if(L.height(h))q('[data-target-height]').value=String(h);
  q('[data-target-coordinate]').textContent=p.latitude.toFixed(5)+', '+p.longitude.toFixed(5);
 }
 function openEditor(target=null){
  const s=state;if(!valid(s))return;request.cancel();s.editing=target;
  s.searchPoint=target?deps.favorite(target.favId)||{...target,elevation:target.groundM}:null;q('[data-target-name]').value=target?.name||'';q('[data-target-name]').dataset.auto='true';
  q('[data-target-height]').value=String(target?((s.drafts.find(x=>x.entry.id===target.favId)?.entry||deps.favorite(target.favId))?.targetHeightM??Math.max(0,(target.parts?.[0]?.m??0)-(target.groundM??0))):0);
  by('targetPlaceSearch').value='';by('targetPlaceResults').replaceChildren();q('[data-target-error]').hidden=true;q('[data-target-duplicates]').hidden=true;
  panel.hidden=true;editor.hidden=false;q('#previewTargetTitle').textContent=target?'対象を編集':'対象を追加';q('[data-target-add]').textContent=target?'変更を適用':'対象を追加';
  if(!map){map=deps.createMap({canvas:'targetEditorCanvas',zoomIn:'targetEditorIn',zoomOut:'targetEditorOut'});map.onPick(p=>{if(valid(state)){request.cancel();map.setCenter(p.latitude,p.longitude);}});
   map.onMove?.(()=>request.cancel());
   deps.wireSearch('targetPlaceSearch','targetPlaceResults',move,move,{near:()=>map.center(),isCurrent:()=>valid(state)&&!editor.hidden});
  }
  by('targetPlaceSearch').dispatchEvent(new Event('input'));
  const center=s.searchPoint||deps.center(s.source);map.open(L.point(center)?center:{latitude:35.68,longitude:139.76},16);
 }
 function useTarget(t){
  const s=state;if(!valid(s))return;
  if(s.options.multiple){if(s.editing)s.selected=s.selected.filter(x=>targetKey(x)!==s.editing.id);if(!selected().has(targetKey(t)))s.selected.push(t);listMode();}else choose(t);
 }
 function duplicates(name,exclude,proceed){
  const matches=L.matchingNames(targets(),name,exclude);if(!matches.length)return false;
  const host=q('[data-target-duplicates]');host.replaceChildren();host.hidden=false;host.append(make('p',{className:'tiny',textContent:'同じ名前の対象があります。場所を確認してください。'}));
  for(const t of matches){const b=make('button',{type:'button',className:'list-item',textContent:t.name+' ・ '+describe(t)+' ・ この対象を使う'});b.onclick=()=>{const s=state;if(!valid(s))return;useTarget(t);};host.append(b);}
  const b=make('button',{type:'button',className:'chip',textContent:'別の対象として追加'});b.onclick=proceed;host.append(b);return true;
 }
 async function submit(approved=null){
  const s=state;if(!valid(s))return;const name=q('[data-target-name]').value.trim(),heightM=Number(q('[data-target-height]').value),p=map.center(),signature=JSON.stringify([name,heightM,p,s.editing?.id]);
  const error=q('[data-target-error]'),fail=text=>{error.textContent=text;error.hidden=false;};error.hidden=true;
  if(!name||!q('[data-target-height]').value.trim()||!L.height(heightM))return fail('名前と、地上からの高さ（0〜1000m）を確認してください');
  const existing=L.nearby(targets().filter(t=>t.id!==s.editing?.id),p);
  if(existing){useTarget(existing);return;}
  if(approved!==signature&&duplicates(name,s.editing?.id,()=>submit(signature)))return;
  const ticket=request.next();q('[data-target-add]').disabled=true;
  try{
   const ground=s.searchPoint&&L.distance(s.searchPoint,p)<1&&Number.isFinite(s.searchPoint.elevation)?s.searchPoint.elevation:await deps.elevation(p.latitude,p.longitude);
   if(!valid(s)||!request.current(ticket))return;
   if(!Number.isFinite(ground))throw Error('標高を取得できませんでした。もう一度お試しください');
   const previous=s.drafts.find(x=>x.entry.id===s.editing?.favId),draft=L.targetDraft({...p,elevation:ground,subtitle:s.searchPoint?.subtitle||''},{name,heightM,favorites:deps.favorites(),id:s.editing?.favId});
   if(previous)draft.baseline=previous.baseline;
   if(s.options.multiple){s.drafts=s.drafts.filter(x=>x.entry.id!==draft.entry.id);s.drafts.push(draft);const target=L.targetFromFavorite(draft.entry);s.selected=s.selected.filter(x=>targetKey(x)!==target.id);s.selected.push(target);listMode();}
   else{deps.persist(draft);deps.refresh();deps.select(s.source,'fav:'+draft.entry.id);close();}
  }catch(e){if(valid(s)&&request.current(ticket))fail(e.message||'対象を保存できませんでした');}
  finally{q('[data-target-add]').disabled=false;}
 }
 search.oninput=render;q('[data-target-new]').onclick=()=>openEditor();q('[data-target-back]').onclick=listMode;q('[data-target-add]').onclick=()=>submit();q('[data-target-name]').oninput=e=>{e.target.dataset.auto='false';q('[data-target-duplicates]').hidden=true;};
 q('[data-target-close]').onclick=close;q('[data-target-clear]').onclick=()=>{if(valid(state)){deps.select(state.source,'');close();}};
 q('[data-target-done]').onclick=()=>{const s=state;if(!valid(s))return;const chosen=selected();s.options.onDone?.(s.selected,s.drafts.filter(x=>chosen.has('fav:'+x.entry.id)));close();};
 dialog.addEventListener('close',()=>{request.cancel();if(!dialog.open){const focus=state?.focus;state=null;focus?.focus({preventScroll:true});}});
 const open=(source,onNew,focus,options={})=>{state={source,focus,owner:deps.owner(),options,selected:[...(options.selected||[])],drafts:[...(options.drafts||[])]};search.value='';editor.hidden=true;panel.hidden=false;render();deps.show(dialog);};
 const style=make('style',{textContent:'.target-choice-row{display:flex;gap:8px;align-items:center}.target-choice-row>.preview-body-choice{flex:1;min-width:0;text-align:left}.target-choice-row>.chip{min-height:44px}.target-location-search{display:flex;gap:8px}.target-location-search input{min-width:0;flex:1}#previewTargetDialog [data-target-editor] label{display:block;margin:12px 0}#previewTargetDialog [data-target-editor] input{font-size:16px;width:100%}#previewTargetDialog .mapwrap{position:relative;overflow:hidden;border-radius:12px;margin:12px 0}#targetEditorCanvas{width:100%;height:260px;display:block;touch-action:none}#previewTargetDialog .map-cross{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:none;font-size:24px;text-shadow:0 1px 3px #fff;color:#111}#previewTargetDialog .mapzoom{position:absolute;right:8px;top:8px;display:grid;gap:5px}#previewTargetDialog button{min-height:44px}#previewTargetDialog .my-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}#previewTargetDialog [data-target-editor][hidden],#previewTargetDialog [data-target-list-panel][hidden]{display:none}'});d.head.append(style);
 return {open,edit(source,target,focus){open(source,null,focus);openEditor(target);},authChanged(){if(state&&state.owner!==deps.owner())close();}};
}
root.SoramiTargetUI={mount};
})(globalThis);
