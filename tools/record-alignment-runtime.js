function recordAlignmentInit(){const s=sheetState;if(!s||s.ctx!=='records'||s.alignmentDraft)return;s.alignmentDraft=structuredClone(RecordAlignment.map(s.place)||{});s.alignmentBaseline=RecordAlignment.key(placeOf(s.place.id)||s.place);}
function recordAlignmentDirty(){return sheetState?.ctx==='records'&&!!sheetState.alignmentDraft&&RecordAlignment.key({recordAlignments:sheetState.alignmentDraft})!==sheetState.alignmentBaseline;}
function applyRecordAlignments(){
 const s=sheetState;if(s?.ctx!=='records')return true;recordAlignmentInit();const selected=[];
 for(const t of s.draftTargets){const target=resolveTarget(t.key),value=RecordAlignment.clean(target,s.alignmentDraft[t.key]);if(!value)return false;if(value.matchMode!=='overlap')selected.push([t.key,value]);}
 if(selected.length)s.place.recordAlignments=Object.fromEntries(selected);else delete s.place.recordAlignments;return true;
}
function alignmentControls(host,target,value,{body=null,key='',change}){
 const options=[['__whole','全体'],...RecordAlignment.parts(target).map(p=>[p.id,p.name||p.id])],canonical=RecordAlignment.clean(target,value),signature=JSON.stringify([target?.id,options,!!AstroNotesBodies.definition(body)?.limbs]);
 if(host.dataset.alignmentSignature!==signature||!host.firstElementChild){
  host.dataset.alignmentSignature=signature;host.replaceChildren();const label=document.createElement('label');label.className='record-alignment-position';const title=document.createElement('span');title.className='tiny';title.textContent='重ねる位置';const select=document.createElement('select');select.className='fav-in';select.setAttribute('aria-label',target.name+'に重ねる位置');select.dataset.recordAlignment=key;select.replaceChildren(...options.map(([id,name])=>new Option(name,id)));label.append(title,select);const limbs=document.createElement('label');limbs.className='record-alignment-limbs';const limbSelect=document.createElement('select');limbSelect.className='fav-in';limbSelect.setAttribute('aria-label',target.name+'に合わせる天体の部分');for(const limb of AstroNotesAlign.LIMBS)limbSelect.add(new Option(limb.name,limb.id));limbs.append(limbSelect);host.append(label,limbs);
 }
 const select=host.querySelector('select'),limbHost=host.querySelector('.record-alignment-limbs');
 const invalid=select.querySelector('option[value="invalid"]');if(invalid)invalid.remove();if(!canonical){const o=new Option('部位を選び直してください','invalid');o.disabled=true;select.prepend(o);}select.value=canonical?.matchMode==='overlap'?'__whole':canonical?.partId||'invalid';
 select.onchange=()=>{const next=select.value==='__whole'?RecordAlignment.whole(target):RecordAlignment.clean(target,{partId:select.value,limb:canonical?.limb||'center',matchMode:'limb'});if(next)change(next,'part');};
 limbHost.hidden=!canonical||canonical.matchMode==='overlap'||(body!==null&&!AstroNotesBodies.definition(body)?.limbs);const limbSelect=limbHost.querySelector('select');limbSelect.value=canonical?.limb||'center';limbSelect.onchange=()=>{if(canonical)change({...canonical,limb:limbSelect.value},'limb');};
}
function appendRecordAlignment(row,t){
 if(sheetState?.ctx!=='records')return;recordAlignmentInit();const target=resolveTarget(t.key);if(!target)return;const box=document.createElement('div');box.className='record-alignment-editor';row.append(box);
 alignmentControls(box,target,sheetState.alignmentDraft[t.key],{key:t.key,change:(next,field)=>{if(!sheetOwnerMatches())return;if(next.matchMode==='overlap')delete sheetState.alignmentDraft[t.key];else sheetState.alignmentDraft[t.key]=next;applyRecordAlignments();renderSheet();requestAnimationFrame(()=>{const nextBox=[...sheet.querySelectorAll('[data-record-alignment]')].find(n=>n.dataset.recordAlignment===t.key)?.closest('.record-alignment-editor');(field==='part'?nextBox?.querySelector('select'):nextBox?.querySelector('.record-alignment-limbs select'))?.focus({preventScroll:true});});}});
}
function renderSkyAlignment(s){
 const detail=el('skyMapAlignmentDetails'),host=el('skyMapAlignmentControls');detail.hidden=!s?.target;if(!el('skyMapAlignmentSummary').firstElementChild)el('skyMapAlignmentSummary').innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="8.5" cy="8.5" r="6.5"/><circle cx="15.5" cy="15.5" r="6.5"/></svg><span>重ね方</span>';if(!s?.target){host.replaceChildren();delete host.dataset.alignmentSignature;return;}
 if(globalThis.AstroNotesTrialOverlap?.renderAlignment?.(host,s))return;
 alignmentControls(host,s.target,s,{body:s.body,change:next=>{if(skySession!==s||!auth?.token||!toolAllowed('skymap'))return;SkyMapUI.setAlignment(next.partId,next.limb,next.matchMode);}});
}
function recordMatchOpts(target,place,body){
 const map=RecordAlignment.map(place);if(map===null)return null;const value=RecordAlignment.clean(target,map[target.key||target.id]);if(!value)return null;return body&&!AstroNotesBodies.definition(body)?.limbs?{...value,limb:'center'}:value;
}
function saveRecordAlignmentMetadata(plan,args){
 const before=args.favorites.find(f=>f.id===args.place.id),next=plan.favorites.find(f=>f.id===args.place.id);if(!next)return plan;
 if(RecordAlignment.key(before)!==RecordAlignment.key(args.place)){if(args.place.recordAlignments)next.recordAlignments=structuredClone(args.place.recordAlignments);else delete next.recordAlignments;if(!plan.changedFavorites.includes(next.id))plan.changedFavorites.push(next.id);}
 if(JSON.stringify(next).length>20000)throw Error('撮影地点の設定が多すぎて保存できません。重ね方の指定を減らしてください');return plan;
}
function prepareAlignedQuickRecord(args){
 const plan=AstroNotesLibrary.prepareQuickRecord(args),s=globalThis.TrialExplore?.active()?SkyMapUI.selectionState():null;
 if(!s?.target||s.target.id!==args.target.id)return plan;
 const value=RecordAlignment.clean(args.target,s);if(!value)throw Error('重ね方を確認してください');const knownKey=args.target.key||args.target.id,records=plan.observations.filter(r=>r.placeId===plan.place.id&&!r.removed),added=plan.observations.slice(args.observations.length).filter(r=>r.placeId===plan.place.id&&!r.removed),matching=records.filter(r=>r.target.latitude===args.target.latitude&&r.target.longitude===args.target.longitude&&r.target.name===args.target.name),keys=[...new Set(matching.map(r=>r.target.key))];const targetKey=records.some(r=>r.target.key===knownKey)?knownKey:added.length===1?added[0].target.key:keys.length===1?keys[0]:null;if(!targetKey){if(value.matchMode==='overlap')return plan;throw Error('重ね方を保存できません。記録の編集から対象を追加してください');}
 const next=plan.favorites.find(f=>f.id===plan.place.id),old=RecordAlignment.key(next),map={...(next.recordAlignments||{})};if(value.matchMode==='overlap')delete map[targetKey];else map[targetKey]=value;if(Object.keys(map).length)next.recordAlignments=map;else delete next.recordAlignments;
 if(old!==RecordAlignment.key(next)){plan.already=false;if(!plan.changedFavorites.includes(next.id))plan.changedFavorites.push(next.id);}if(JSON.stringify(next).length>20000)throw Error('撮影地点の設定が多すぎて保存できません。重ね方の指定を減らしてください');return plan;
}

function recordEventOptions(result,opts){const map=rows=>(rows||[]).map(row=>({...row,event:{...row.event,partId:opts.partId,limb:opts.limb,matchMode:opts.matchMode}}));return Array.isArray(result)?map(result):{...result,rows:map(result?.rows)};}
