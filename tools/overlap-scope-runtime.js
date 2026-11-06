/* Trial-only "重ねる対象". Display set = existing SkyMap main target + scene extras.
   One member: the existing main target (single solver, alignment and saving unchanged).
   All: OR of the members' exact per-target results; see overlap-scope-policy.mjs. */
(()=>{
'use strict';
const P=(/* OVERLAP_POLICY */)();
const state={notice:'',noticeOwner:'',lastAccent:null};
// Classic-script globals of the inline document (lexical bindings are reachable by name, not via globalThis).
const G={auth:()=>typeof auth==='undefined'?null:auth,store:()=>typeof store==='undefined'?null:store,aimSceneExtrasAllowed:()=>typeof aimSceneExtrasAllowed==='undefined'?null:aimSceneExtrasAllowed,aimIsMountain:()=>typeof aimIsMountain==='undefined'?null:aimIsMountain,aimSceneExtraTargets:()=>typeof aimSceneExtraTargets==='undefined'?null:aimSceneExtraTargets,aimSetSceneExtras:()=>typeof aimSetSceneExtras==='undefined'?null:aimSetSceneExtras,aimTargetList:()=>typeof aimTargetList==='undefined'?null:aimTargetList};
const ref=name=>G[name]();
const owner=()=>ref('auth')?.loginId||'guest';
const storeKey=()=>'sorami.sceneOverlap:'+encodeURIComponent(owner());
const allowed=()=>{const f=ref('aimSceneExtrasAllowed');return typeof f!=='function'||f();};
const current=()=>typeof SkyMapUI==='undefined'?null:SkyMapUI.selectionState?.()||null;
const isMountain=t=>{const f=ref('aimIsMountain');return typeof f==='function'&&!!f(t);};
function members(s=current()){
 if(!s?.target||!allowed())return [];const f=ref('aimSceneExtraTargets'),out=[s.target];
 for(const t of typeof f==='function'?f(s.target.id):[])if(t&&!out.some(x=>x.id===t.id))out.push(t);
 return out;
}
const flag=()=>{const v=ref('store')?.get(storeKey(),null);return v?.all===true;};
function setFlag(all){ref('store')?.set(storeKey(),{all:!!all});}
const usable=(s,list)=>typeof toolAllowed!=='function'||!globalThis.AstroNotesAccess?.canFrame||list.every(t=>AstroNotesAccess.canFrame(toolAllowed,t.id,s?.body));
function isAll(s=current()){const list=members(s);return list.length>=2&&flag()&&usable(s,list);}
function key(s=current()){return isAll(s)?JSON.stringify(['all',members(s).map(t=>[t.id,t.latitude,t.longitude,t.groundM,t.parts,t.widthM])]):null;}
function label(s=current()){return isAll(s)?'全てに重なる':null;}
const memberEntry=t=>({target:t,partId:P.wholePart(t,isMountain),profile:isMountain(t)?'summit-contact':'building-near'});
function searchPlan(s=current()){return isAll(s)?{overlapMembers:members(s).map(memberEntry),composition:null,compositionInvalid:false}:null;}
function notify(){document.dispatchEvent(new Event('astronotes-composition-change'));globalThis.TrialExplore?.invalidate?.();SkyMapUI?.render?.();}
function setNotice(text){state.notice=text;state.noticeOwner=owner();}
// Called from the target picker: keep the overlap target if it is still shown.
function chooseMain(ids,previous){
 const r=P.chooseMain(ids,previous);
 if(r.fallback)setNotice('重ねる対象を外したため「'+(ref('aimTargetList')?.().find(t=>t.id===r.main)?.name||r.main)+'」に重ねます');
 if(new Set(ids).size<2&&flag())setFlag(false);
 return r.main||null;
}
// A custom (map-placed) target shown as an extra must be the Explore session's own geometry.
function custom(){return SkyMapUI?.workspaceHost?.()?.session?.customTarget||null;}
let field=null,select=null,noticeNode=null,syncing=false;
function ensureField(){
 if(field?.isConnected)return field;const source=document.getElementById('skyMapTarget'),home=source?.closest('.condition-field');if(!home)return null;
 field=document.createElement('div');field.id='skyMapOverlapField';field.className='aim-say condition-field overlap-target-field';field.hidden=true;
 select=document.createElement('select');select.id='skyMapOverlapTarget';select.className='fav-in overlap-target-select';select.setAttribute('aria-labelledby','skyMapOverlapLabel');
 const lab=document.createElement('span');lab.className='aim-say-v condition-label';lab.id='skyMapOverlapLabel';lab.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="12" r="5.5"/><circle cx="15" cy="12" r="5.5"/></svg><span>重ねる対象</span>';
 noticeNode=document.createElement('p');noticeNode.id='skyMapOverlapNotice';noticeNode.className='tiny overlap-target-notice';noticeNode.setAttribute('role','status');noticeNode.hidden=true;
 field.append(select,lab,noticeNode);home.after(field);
 select.onchange=()=>choose(select.value);
 const style=document.createElement('style');style.textContent=`#skyMapOverlapField[hidden]{display:none!important}
#skyMapOverlapField .overlap-target-select{box-sizing:border-box;width:100%;min-width:0;min-height:44px;margin:0;font-size:16px}
#skyMapOverlapField .overlap-target-notice{grid-column:1/-1;margin:2px 0 0;color:var(--secondary)}
.overlap-alignment-all{margin:4px 0;color:var(--text)}`;document.head.append(style);
 return field;
}
function choose(value){
 const s=current(),list=members(s);if(!s?.target||list.length<2||!ref('auth')?.token)return sync();
 setNotice('');
 if(value==='__all'&&!usable(s,list)){setFlag(false);setNotice('選択した対象を利用する権限がありません');notify();return sync();}
 if(value==='__all'){setFlag(true);SkyMapUI.setAlignment('__whole','center','overlap');notify();return sync();}
 const next=list.find(t=>t.id===value);if(!next)return sync();setFlag(false);
 if(next.id!==s.target.id){
  // The display set is unchanged; only the solver's main target moves. Its alignment restarts at 全体.
  ref('aimSetSceneExtras')?.(list.map(t=>t.id).filter(id=>id!==next.id));SkyMapUI.setTarget(next.id);
  if(SkyMapUI.selectionState()?.target?.id!==next.id){ref('aimSetSceneExtras')?.(list.filter(t=>t.id!==s.target.id).map(t=>t.id));setNotice('この対象を重ねる対象にできませんでした');}
 }
 notify();sync();
}
function sync(){
 if(syncing)return;syncing=true;
 try{
  const host=ensureField();const s=current(),list=members(s);
  if(state.noticeOwner!==owner())state.notice='';
  if(!host)return;
  host.hidden=list.length<2;
  if(list.length>=2){
   const all=isAll(s),sig=JSON.stringify(list.map(t=>[t.id,t.name]));
   if(select.dataset.sig!==sig){select.dataset.sig=sig;select.replaceChildren(...list.map(t=>new Option(t.name,t.id)),new Option('全て','__all'));}
   const value=all?'__all':s.target.id;if(select.value!==value)select.value=value;
   select.setAttribute('aria-label','重ねる対象：'+(all?'全て（'+list.map(t=>t.name).join('、')+'）':s.target.name));
   if(all&&s.matchMode!=='overlap')SkyMapUI.setAlignment('__whole','center','overlap');
  }
  noticeNode.textContent=state.notice;noticeNode.hidden=!state.notice||list.length<1;
 }finally{syncing=false;}
}
// 全て: only the union's whole silhouette has a defined meaning. Parts and limbs
// of one member are not reused, and the in-figure position editor is disabled.
function renderAlignment(host,s){
 if(!isAll(s)){if(host.dataset.alignmentSignature==='overlap-all'){delete host.dataset.alignmentSignature;host.replaceChildren();}return false;}
 if(host.dataset.alignmentSignature!=='overlap-all'){host.dataset.alignmentSignature='overlap-all';host.replaceChildren();const label=document.createElement('label');label.className='record-alignment-position';const title=document.createElement('span');title.className='tiny';title.textContent='重ねる位置';const p=document.createElement('select');p.className='fav-in';p.id='skyMapOverlapAlignment';p.setAttribute('aria-label','全てに重ねる位置');p.add(new Option('全体','__whole'));p.disabled=true;label.append(title,p);host.append(label);}
 return true;
}
// Candidate dates: union of each member's own day scan.
function buildingDays(fn,plan){
 if(!isAll(plan))return null;const list=members(plan);
 return async(obs,_target,body,_partId,seq,opts={})=>{
  const limit=opts.limit??4,scanned=list.map(()=>null);
  const report=()=>{if(scanned.every(Number.isFinite))opts.onScanned?.(Math.min(...scanned));};
  const results=await Promise.all(list.map(async(t,i)=>({rows:await fn(obs,t,body,P.wholePart(t,isMountain),seq,{...opts,limb:'center',matchMode:'overlap',onScanned:end=>{scanned[i]=end;report();}})})));
  results.forEach((r,i)=>{r.scanned=scanned[i];});
  if(opts.isCurrent&&!opts.isCurrent())return [];
  const rows=P.mergeDays(results,limit),until=P.scannedUntil(results,rows,limit);if(Number.isFinite(until))opts.onScanned?.(until);
  return rows.map(r=>({...r,overlapTargetId:list[r.overlapMember]?.id??null}));
 };
}
function memberPlan(plan,i){
 const list=plan.overlapMembers,m=list[i];
 const next={...plan,target:m.target,partId:m.partId,limb:'center',matchMode:'overlap',profile:m.profile,composition:null,compositionInvalid:false,extraTargets:list.filter((_,j)=>j!==i).map(x=>x.target),requireAllTargets:false,lens:plan.lens?{...plan.lens,targetExtent:'whole'}:plan.lens};
 delete next.overlapMembers;if(i)next.overlapAnchor={target:list[0].target,partId:list[0].partId};return next;
}
function inverse(plan,fn){if(!plan?.overlapMembers)return null;return (async()=>{const out=[];for(let i=0;i<plan.overlapMembers.length;i++)out.push(await fn(memberPlan(plan,i)));return P.mergeSeeds(out);})();}
function evaluate(plan,fn){if(!plan?.overlapMembers)return null;return (async()=>{const out=[];for(let i=0;i<plan.overlapMembers.length;i++)out.push(await fn(memberPlan(plan,i)));return P.mergeEvaluations(out,{partId:plan.overlapMembers[0].partId},plan.overlapMembers.map(m=>m.target.id));})();}
// Registered places from 探す: union of the existing per-target solver.
function discovery(plan,run){
 if(!plan?.overlapMembers)return null;
 return (async()=>{const out=[];for(const m of plan.overlapMembers){const r=await run({...plan,target:m.target,partId:m.partId,limb:'center',matchMode:'overlap',overlapMembers:undefined});if(r?.cancelled)return {cancelled:true};out.push(r);}return P.mergeRows(out,{partId:plan.overlapMembers[0].partId},plan.overlapMembers.map(m=>m.target.id));})();
}
// Figure accent: the selected member's silhouette, or the outline of the union
// (internal borders removed) when 全て. Drawn only when several targets are shown.
function accentColor(){return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()||'#3b8cff';}
function accent(ctx,{scene,t,shape,sceneBottom}){
 const s=current(),list=members(s);state.lastAccent=null;if(list.length<2||!t||!scene)return;
 const all=isAll(s),ids=new Set(all?list.map(x=>x.id):[t.id]),canvas=ctx.canvas,w=canvas.width,h=canvas.height,m=ctx.getTransform();
 const mask=document.createElement('canvas');mask.width=w;mask.height=h;const mc=mask.getContext('2d');mc.setTransform(m);mc.fillStyle='#000';const drawn=[];
 for(const item of scene){
  if(!ids.has(item.target.id))continue;
  if(item.polygons?.length&&item.solidSilhouette){const k=item.solidSilhouette;mc.drawImage(k.canvas,k.x,k.y,k.width,k.height);drawn.push(item.target.id);continue;}
  const pts=item.target.id===t.id?shape:item.shape;if(!pts||pts.length<2)continue;
  mc.beginPath();if(!item.outline){mc.moveTo(pts[0][0],sceneBottom);for(const [x,y]of pts)mc.lineTo(x,y);mc.lineTo(pts[pts.length-1][0],sceneBottom);}else{mc.moveTo(pts[0][0],pts[0][1]);for(const [x,y]of pts)mc.lineTo(x,y);}
  mc.closePath();mc.fill();drawn.push(item.target.id);
 }
 state.lastAccent={mode:all?'all':'one',ids:[...ids],drawn};if(!drawn.length)return;
 const ring=document.createElement('canvas');ring.width=w;ring.height=h;const rc=ring.getContext('2d'),r=Math.max(1,Math.round(2*Math.hypot(m.a,m.b)));
 for(let dx=-r;dx<=r;dx++)for(let dy=-r;dy<=r;dy++)if((dx||dy)&&dx*dx+dy*dy<=r*r+1)rc.drawImage(mask,dx,dy);
 rc.globalCompositeOperation='source-in';rc.fillStyle=accentColor();rc.fillRect(0,0,w,h);rc.globalCompositeOperation='destination-out';rc.drawImage(mask,0,0);
 ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(ring,0,0);ctx.restore();
}
// Share / plan payload: v1 codec keeps unknown fields losslessly.
function annotate(kind,s,payload){
 const sel=current();if(!payload||payload.kind!=='aim'||!isAll(sel)||payload.t?.id!==sel.target.id)return;
 const list=members(sel);if(list.length>16)throw Error('共有できる対象は16件までです');const names=list.map(t=>t.name).join('、');payload.ov=P.payloadExt(list);
 s.title=s.title.replace(/ × .*$/,' × 全て（'+names+'）');
 for(const row of s.rows||[]){if(row[0]==='対象・重ね方')row[1]='全て（'+names+'） / 全体 / 全ての対象を合わせた輪郭に重なる';else if(row[0]==='重ね方')row[1]='全て（'+names+'）を合わせた輪郭に重なる';}
}
function restore(p){
 if(p?.kind!=='aim')return;const ext=P.parseExt(p.ov),list=ref('aimTargetList')?.()||[];
 if(!ext){setFlag(false);return;}
 const anchor=ext.find(m=>m.id===p.t.id),others=ext.filter(m=>m.id!==p.t.id),resolved=anchor?P.resolveMembers(others,list):null;
 if(!resolved||resolved.length!==ext.length-1){setFlag(false);setNotice('共有された「全て」の対象の一部をこの端末で表示できないため、'+p.t.name+'に重ねます');return;}
 ref('aimSetSceneExtras')?.(resolved.map(t=>t.id));setFlag(true);setNotice('');
}
// Recording 全て registers every member at this place with 全体; a partial
// failure is reported, never presented as a complete save.
function quickRecord(cur){
 const ext=P.parseExt(cur?.payload?.ov);if(!ext)return null;const sel=current(),list=members(sel);
 if(!isAll(sel)||JSON.stringify(list.map(t=>t.id))!==JSON.stringify(ext.map(m=>m.id)))return {ok:false,error:'重ねる対象が変わりました。見え方を開き直してください'};
 const observer={...sel.observer,...cur.observer,elevation:cur.payload.o[3],eyeHeightAGL:cur.payload.o[4]};let already=true,placeId=null;const saved=[];
 for(const t of list){const r=MyPlacesUI.quickRecord(observer,t.id===cur.target.id?cur.target:t);if(!r?.ok)return {ok:false,error:(r?.error||'撮影地点を保存できませんでした')+(saved.length?'（'+saved.join('、')+'は登録済み）':'')};already=already&&r.already;placeId=placeId||r.placeId;saved.push(t.name);}
 return {ok:true,already,placeId};
}
for(const type of ['astronotes-search-state','astronotes-composition-change','astronotes-records-change'])document.addEventListener(type,()=>queueMicrotask(sync));
globalThis.AstroNotesTrialOverlap={policy:P,members,isAll,key,label,searchPlan,chooseMain,custom,sync,renderAlignment,buildingDays,inverse,evaluate,discovery,accent,annotate,restore,quickRecord,get lastAccent(){return state.lastAccent;}};
sync();
})();
