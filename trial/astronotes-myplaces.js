/* 観測記録と撮影ポイント（2026-10-16）。
   撮影ポイントはお気に入りそのもの（同期のまま、形を変えない）。観測記録は「どの地点から何が見えたか」で、
   このブラウザにログインID別に保存し、ログイン中はサーバーと同期する（2026-10-21〜。index.html の RecordSync）。
   撮影候補は新しく探さない。見えた組（地点×目標）で、既存の重なり計算を、記録された地点と目標に適用する。
   仕様: Vault「02_観測記録と撮影ポイント_仕様書」 */
(function () {
'use strict';
const RESULTS = { seen: { name: '見えた', mark: '◎' }, partial: { name: '一部隠れた', mark: '△' }, hidden: { name: '見えなかった', mark: '×' } };
const NEAR_KM = 0.02;            // お気に入りの同一判定（既存の ☆ と同じ 20m）
const MERGE_KM = 0.05;           // 記録するとき「近くの撮影ポイントに付けるか」を聞く距離
const DAY = 86400000;
const el = (id) => document.getElementById(id);
const key = () => AstroNotesLibrary.keys(auth?.loginId).observations;
const isText = (v, max = 2000) => typeof v === 'string' && v.length <= max;
const finite = (v) => Number.isFinite(v);

// 取り込んだものを信用しない（手で書き換えられる・壊れる）。描画側でも esc する
function clean(r) { return AstroNotesLibrary.cleanObservation(r); }
function load() { const raw = store.get(key(), []); return Array.isArray(raw) ? raw.map(clean).filter(Boolean) : []; }
let version = 0;
function save(list) { const ok = store.set(key(), list); if (ok) { version++; changed(); } return ok; }
const when = (r) => r.date ? Date.parse(r.date + 'T12:00:00+09:00') : r.createdAt;

const placeOf = (id) => favorites.find((f) => f.id === id) || null;
const placeNear = (p, km = NEAR_KM) => p && favorites.find((f) => AstroNotesTerrain.distanceKm(f.latitude, f.longitude, p.latitude, p.longitude) < km) || null;
// 地点×目標の状態は最新の記録で決める（古い記録は残す。木の伸び・工事で変わるため）
function statusOf(placeId, targetKey, list = load()) {
  let best = null;
  for (const r of list) if (r.placeId === placeId && r.target.key === targetKey && (!best || (r.registration&&!best.registration) || (r.registration===best.registration && (when(r) > when(best) || (when(r) === when(best) && r.updatedAt >= best.updatedAt))) || (!r.registration&&!best.registration&&(when(r)>when(best)||(when(r)===when(best)&&r.updatedAt>=best.updatedAt))))) best = r;
  const here = placeOf(placeId);
  if (best?.observer && here && (AstroNotesTerrain.distanceKm(here.latitude, here.longitude, best.observer.latitude, best.observer.longitude) >= NEAR_KM || Math.abs((here.eyeHeightAGL ?? 1.5) - best.observer.eyeHeightAGL) > 1)) return null;
  return best?.registration && best.removed ? null : best;
}
function placesFor(targetKey) {
  const list = load(), out = [];
  for (const f of favorites) { const r = statusOf(f.id, targetKey, list); if (r && r.result !== 'hidden') out.push({ place: withShape(f), record: r }); }
  return out;
}
function targetsSeenFrom(placeId) {
  const list = load(), keys = [...new Set(list.filter((r) => r.placeId === placeId).map((r) => r.target.key))];
  return keys.map((k) => statusOf(placeId, k, list)).filter(Boolean);
}
function badge(f) {
  const seen = targetsSeenFrom(f.id).filter((r) => r.result !== 'hidden');
  return [shapeFor(f)?shapeName(shapeFor(f)):'',seen.length?'見えた：'+seen.map(r=>r.target.name).join('・'):''].filter(Boolean).join(' ・ ');
}

// 目標は構図の一覧と同じもの（許可のある組み込み目標＋自分の目標）。自分で一時的に置いた目標は記録できない
const targetChoices = () => [...new Map([...aimTargetList(),...(sheetState?.targetDrafts||[]).map(x=>AstroNotesLibrary.targetFromFavorite(x.entry))].filter(t=>t.id!=='custom'&&finite(t.latitude)&&(t.parts||[]).length).map(t=>[t.id,t])).values()];
const resolveTarget = (k) => targetChoices().find((t) => t.id === k) || null;

// 検索・現在地・地図・既存地点を、従来の共通ピッカーから選ぶ。予測の地点は動かさない。
PLACE_PICKERS.records = { title: '撮影地点', custom: () => null, point: () => place,
  set: p => { if (!auth?.token || !toolAllowed('records')) return; if(sheetOwnerMatches()&&sheet?.open&&!sheetState.place.id){setDraftPlace(p);return;}recordFor(p, null, 'records'); } };
// Shape metadata follows the same account-local lifetime as visible targets.
const shapesKey=()=>AstroNotesLibrary.keys(auth?.loginId).shapes;
function shapeData(){const raw=store.get(shapesKey(),{});return raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};}
function shapeFor(f){const r=shapeData()[f?.id];return r&&r.latitude===f.latitude&&r.longitude===f.longitude?AstroNotesShooting.cleanShape(r.shape):null;}
const withShape=f=>({...f,...(shapeFor(f)?{shape:shapeFor(f)}:{})});
const shapeName=s=>s?.type==='line'?'線':s?.type==='area'?'範囲':'点';
const shapeKey=s=>JSON.stringify(s||null);
async function candidateElevation(lat,lon){try{const g=await AstroNotesTerrain.groundElevation(lat,lon);return Number.isFinite(g)?g:null;}catch{return null;}}
function shapeIssue(result){
 const issues=result.issues||[];
 return issues.some(x=>x.reason==='limit')?'広いため調べ切れていない場所があります。記録で線・範囲を小さく分けて再試行してください。':issues.some(x=>x.reason==='invalid')?'線・範囲の形を確認してください。':result.failed?'標高などを取得できず、調べ切れていない場所があります。再試行してください。':'';
}
let shapeDialog=null,shapeMap=null,shapeEdit=null;
const draftPoint=()=>Number.isFinite(sheetState?.place.latitude)&&Number.isFinite(sheetState?.place.longitude);
function setDraftPlace(p){
 if(!sheetOwnerMatches()||!AstroNotesShooting.point(p))return;
 const existing=placeNear(p);
 if(existing){openPlace(existing,'records');return;}
 sheetState.place={...p,id:null,name:sheetState.place.name||'',elevation:p.elevation??null,eyeHeightAGL:p.eyeHeightAGL??1.5};sheetState.newPlace=true;
 el('myRecordSaved').hidden=true;renderSheet();
}
function drawShape(ctx,project,s,{vertices=true,selected=-1}={}){
 if(!s?.vertices?.length)return;ctx.save();ctx.strokeStyle='#9ebed5';ctx.lineWidth=3;ctx.fillStyle='rgba(103,164,204,.18)';ctx.beginPath();
 s.vertices.forEach((p,i)=>{const q=project(p.latitude,p.longitude);if(i)ctx.lineTo(...q);else ctx.moveTo(...q);});
 if(s.type==='area'&&s.vertices.length>=3){ctx.closePath();ctx.fill();}ctx.stroke();
 if(vertices)s.vertices.forEach((p,i)=>{const q=project(p.latitude,p.longitude);ctx.beginPath();ctx.arc(...q,i===selected?9:6,0,Math.PI*2);ctx.fillStyle=i===selected?'#fff':'#9ebed5';ctx.fill();ctx.strokeStyle='#263441';ctx.lineWidth=2;ctx.stroke();ctx.font='bold 11px sans-serif';ctx.fillStyle='#fff';ctx.fillText(String(i+1),q[0]+10,q[1]-8);});ctx.restore();
}
function shapeModeMarkup(type){
 const path=type==='point'?'<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>':type==='line'?'<path d="M4 18L12 6l8 12"/><circle cx="4" cy="18" r="2"/><circle cx="12" cy="6" r="2"/><circle cx="20" cy="18" r="2"/>':'<rect x="5" y="5" width="14" height="14" rx="3"/>';
 return '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+path+'</svg>';
}
function buildShapeEditor(){
 shapeDialog=document.createElement('dialog');shapeDialog.className='sheet';shapeDialog.id='myShapeSheet';shapeDialog.setAttribute('aria-labelledby','myShapeTitle');
 shapeDialog.innerHTML=`<div class="sheet-head"><strong id="myShapeTitle">撮影地点を選ぶ</strong><button type="button" id="shapeCancel">キャンセル</button></div><div class="sheet-body"><section id="shapeLocationPanel"><div class="my-actions"><input id="shapePlaceSearch" type="search" class="fav-in" placeholder="住所・地名・座標を検索" aria-label="撮影地点を検索"><button type="button" class="chip" id="shapePlaceSearchGo">検索</button></div><div id="shapePlaceResults"></div><details id="shapeSavedMenu"><summary id="shapeSearch"><span>お気に入り・履歴から選ぶ</span><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary><div class="my-actions" role="group" aria-label="撮影地点の候補"><button type="button" class="chip" data-shape-source="favorites">お気に入り</button><button type="button" class="chip" data-shape-source="recent">履歴</button></div><div id="shapeSavedLocations" class="my-actions"></div></details></section><p class="tiny" id="shapeHelp"></p><div class="mapwrap"><canvas id="shapeCanvas" aria-label="地図を動かして中央のピンに撮影地点を合わせる"></canvas><svg id="shapeFixedPin" class="shape-fixed-pin" width="28" height="36" viewBox="0 0 24 30" aria-hidden="true"><path d="M12 29C9 23 2 16 2 10a10 10 0 0 1 20 0c0 6-7 13-10 19Z" fill="var(--accent)" stroke="var(--text)" stroke-width="1.5"/><circle cx="12" cy="10" r="3.5" fill="var(--bg)"/></svg><div class="mapzoom"><button id="shapeIn" type="button" aria-label="拡大">＋</button><button id="shapeOut" type="button" aria-label="縮小">−</button></div></div><details id="shapeTypeMenu" class="shape-options"><summary id="shapeTypeLabel">線・範囲で指定</summary><div class="my-actions" id="shapeModes" role="group" aria-label="場所の指定方法"></div></details><div id="shapeVertexTools" hidden><div class="my-actions"><button type="button" class="chip" id="shapeAddCenter">中心に点を追加</button><button type="button" class="chip" id="shapeUndo">1つ戻す</button></div><div class="my-actions"><select class="fav-in" id="shapeVertex" aria-label="編集する点"></select><button type="button" class="chip" id="shapeMove">選んだ点を中心へ</button><button type="button" class="chip" id="shapeRemove">点を削除</button></div></div><p class="tiny" id="shapeStatus" role="status"></p><button type="button" class="fav-btn primary" id="shapeApply">この地点にする</button><p class="tiny">戻った画面の「まとめて保存」で登録します。</p></div>`;

 document.body.append(shapeDialog);
 const oldModes=el('shapeTypeMenu'),modes=el('shapeModes'),toolbar=document.createElement('div');toolbar.className='map-shape-tools';
 const modeButton=document.createElement('button');modeButton.type='button';modeButton.id='shapeTypeLabel';modeButton.className='map-ctl';modeButton.setAttribute('aria-haspopup','menu');modeButton.setAttribute('aria-expanded','false');
 const modeMenu=document.createElement('div');modeMenu.id='shapeTypeMenu';modeMenu.className='map-layer-menu map-shape-menu';modeMenu.hidden=true;modeMenu.dataset.shapeMenu='';modeMenu.setAttribute('role','menu');modeMenu.setAttribute('aria-label','場所の指定方法');modeMenu.append(modes);oldModes.replaceWith(toolbar);toolbar.append(modeButton,modeMenu);el('shapeCanvas').closest('.mapwrap').append(toolbar);
 const closeModes=()=>{modeMenu.hidden=true;modeButton.setAttribute('aria-expanded','false');};
 modeButton.onclick=()=>{modeMenu.hidden=!modeMenu.hidden;modeButton.setAttribute('aria-expanded',String(!modeMenu.hidden));};
 document.addEventListener('pointerdown',e=>{if(!toolbar.contains(e.target))closeModes();});
 toolbar.addEventListener('keydown',e=>{if(e.key==='Escape'&&!modeMenu.hidden){e.preventDefault();e.stopPropagation();closeModes();modeButton.focus();}});
 shapeDialog.addEventListener('close',closeModes);

 for(const [type,label] of [['point','点'],['line','線'],['area','枠']]){const b=document.createElement('button');b.type='button';b.className='chip';b.innerHTML=shapeModeMarkup(type)+'<span>'+label+'</span>';b.setAttribute('role','menuitemradio');b.dataset.shapeMode=type;b.onclick=()=>{if(!shapeEditorCurrent())return;shapePointAtCenter();shapeEdit.undo.push(structuredClone(shapeEdit.value));shapeEdit.value.type=type;if(type==='point')shapeEdit.value.vertices=sheetState.place.id?[{latitude:sheetState.place.latitude,longitude:sheetState.place.longitude}]:[shapeMap.center()];shapeEdit.selected=-1;closeModes();renderShapeEditor();modeButton.focus({preventScroll:true});};el('shapeModes').append(b);}
 shapeMap=createMapView({canvas:'shapeCanvas',zoomIn:'shapeIn',zoomOut:'shapeOut'});
 shapeMap.setOverlay((ctx,{project,width,height})=>{if(!shapeEditorCurrent())return;if(shapeEdit.value.type==='point'){if(sheetState.place.id){const p=shapeEdit.value.vertices[0],q=project(p.latitude,p.longitude);ctx.save();ctx.beginPath();ctx.arc(q[0],q[1],7,0,Math.PI*2);ctx.fillStyle='#9ebed5';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();ctx.restore();}return;}drawShape(ctx,project,shapeEdit.value,{selected:shapeEdit.selected});ctx.save();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(width/2-8,height/2);ctx.lineTo(width/2+8,height/2);ctx.moveTo(width/2,height/2-8);ctx.lineTo(width/2,height/2+8);ctx.strokeStyle='#18212b';ctx.lineWidth=5;ctx.stroke();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();ctx.restore();});
 const change=fn=>{if(!shapeEditorCurrent())return;shapeEdit.undo.push(structuredClone(shapeEdit.value));fn();renderShapeEditor();};
 const add=p=>{change(()=>{if(shapeEdit.value.type==='point')shapeEdit.value.vertices=[p];else if(shapeEdit.value.vertices.length<200){const i=shapeEdit.selected;shapeEdit.value.vertices.splice(i>=0?i+1:shapeEdit.value.vertices.length,0,p);}shapeEdit.selected=-1;});};
 shapeMap.onMove(()=>shapePointAtCenter());
 shapeMap.onPick(()=>{if(!shapeEditorCurrent()||shapeEdit.value.type==='point')return;add(shapeMap.center());});
 el('shapeAddCenter').onclick=()=>{if(shapeEdit?.value.type==='point'&&sheetState.place.id)return;add(shapeMap.center());};
 el('shapeUndo').onclick=()=>{if(!shapeEditorCurrent()||!shapeEdit.undo.length)return;shapeEdit.value=shapeEdit.undo.pop();shapeEdit.selected=-1;renderShapeEditor();};
 el('shapeVertex').onchange=()=>{shapeEdit.selected=Number(el('shapeVertex').value);renderShapeEditor();};
 el('shapeMove').onclick=()=>change(()=>{if(shapeEdit.selected>=0)shapeEdit.value.vertices[shapeEdit.selected]=shapeMap.center();});
 el('shapeRemove').onclick=()=>change(()=>{if(shapeEdit.selected>=0)shapeEdit.value.vertices.splice(shapeEdit.selected,1);shapeEdit.selected=-1;});
 let clearSearch=null;
 const move=p=>{if(!shapeEditorCurrent()||!AstroNotesLibrary.point(p))return;clearSearch?.();el('shapePlaceSearch').blur?.();shapeEdit.searchName=p.name||'';shapeEdit.searchPlace=structuredClone(p);shapeMap.setView(p.latitude,p.longitude,p.zoom??16);shapePointAtCenter();el('shapeSavedMenu').open=false;};
 clearSearch=wireSearchBox('shapePlaceSearch','shapePlaceResults',move,move,{near:()=>shapeMap.center(),isCurrent:()=>shapeEditorCurrent()&&!el('shapeLocationPanel').hidden});
 el('shapeSavedMenu').addEventListener('toggle',renderLocations);
 function renderLocations(){
  if(!shapeEditorCurrent())return;
  const source=shapeEdit.locationSource||'favorites';
  for(const b of shapeDialog.querySelectorAll('[data-shape-source]'))b.setAttribute('aria-pressed',String(b.dataset.shapeSource===source));
  const rows=source==='favorites'?favorites:(typeof recentHistory!=='undefined'?recentHistory.history?.list('places')||[]:[]).map(r=>r.value);
  const list=el('shapeSavedLocations');list.replaceChildren();
  for(const f of rows){const b=document.createElement('button');b.type='button';b.className='chip';b.textContent=f.name;b.onclick=()=>move(f);list.append(b);}
  if(!rows.length){const empty=document.createElement('p');empty.className='tiny';empty.textContent=source==='favorites'?'お気に入りはありません。':'履歴はありません。';list.append(empty);}
 }
 for(const b of shapeDialog.querySelectorAll('[data-shape-source]'))b.onclick=()=>{if(!shapeEditorCurrent())return;shapeEdit.locationSource=b.dataset.shapeSource;renderLocations();};
 const closeShape=()=>{shapePointAtCenter();if(shapeEditorCurrent()&&shapeKey(shapeEdit.value)!==shapeEdit.initial&&!confirm('変更を保存せず閉じますか？'))return;shapeDialog.close();};
 el('shapeCancel').onclick=closeShape;
 shapeDialog.addEventListener('cancel',e=>{e.preventDefault();closeShape();});
 shapeDialog.addEventListener('close',()=>{shapeEdit=null;});
 el('shapeApply').onclick=()=>{
  if(!shapeEditorCurrent())return;
  shapePointAtCenter();
  const value=shapeEdit.value,shape=value.type==='point'?null:AstroNotesShooting.cleanShape(value);
  if(value.type==='point'?!value.vertices.length:!shape)return;
  if(!sheetState.place.id){
   const p=value.vertices[0],existing=placeNear(p),candidate=shapeEdit.searchPlace;
   if(existing){
    const ctx=sheetState.ctx,targets=sheetState.draftTargets,drafts=sheetState.targetDrafts||[];
    shapeDialog.close();openPlace(existing,ctx);
    sheetState.draftTargets=[...new Map([...sheetState.draftTargets,...targets].map(t=>[t.key,t])).values()];
    sheetState.targetDrafts=drafts;if(shape)sheetState.draftShape=shape;renderSheet();return;
   }
   const nearCandidate=candidate&&AstroNotesTerrain.distanceKm(candidate.latitude,candidate.longitude,p.latitude,p.longitude)<.02;
   const eye=nearCandidate?(candidate.eyeHeightAGL??aimObserverEye(aimSavedFrom(candidate))):sheetState.place.eyeHeightAGL??1.5;
   const ground=nearCandidate?candidate.groundManualM??candidate.elevation:null;
   sheetState.place={id:null,name:sheetState.place.name||'',latitude:p.latitude,longitude:p.longitude,elevation:ground??(p.latitude===sheetState.place.latitude&&p.longitude===sheetState.place.longitude?sheetState.place.elevation??null:null),eyeHeightAGL:eye};sheetState.newPlace=true;
  }
  sheetState.draftShape=shape;el('myRecordSaved').hidden=true;shapeDialog.close();renderSheet();
 };
}
function shapePointAtCenter(){
 if(!shapeEditorCurrent()||shapeEdit.value.type!=='point'||sheetState.place.id)return;
 const p=shapeMap.center();if(AstroNotesLibrary.point(p))shapeEdit.value.vertices=[{latitude:p.latitude,longitude:p.longitude}];
}
function shapeEditorCurrent(){return !!shapeEdit&&sheetOwnerMatches()&&shapeEdit.owner===auth?.token&&shapeEdit.state===sheetState;}
function renderShapeEditor(){
 if(!shapeEditorCurrent())return;const s=shapeEdit.value,type=s.type;
 el('shapeCanvas').setAttribute('aria-label',type==='point'?'地図を動かして中央のピンに撮影地点を合わせる':'地図を動かして中央の＋に追加する点を合わせる');
 el('shapeTypeLabel').innerHTML=shapeModeMarkup(type);el('shapeTypeLabel').setAttribute('aria-label','指定方法：'+({point:'点',line:'線',area:'枠'}[type]));el('shapeTypeLabel').title=el('shapeTypeLabel').getAttribute('aria-label');el('shapeFixedPin').toggleAttribute('hidden',type!=='point'||!!sheetState.place.id);el('shapeLocationPanel').hidden=type==='point'&&!!sheetState.place.id;el('shapeVertexTools').hidden=type==='point';el('shapeStatus').hidden=type==='point';el('shapeApply').textContent=type==='point'?(sheetState.place.id?'この地点のまま戻る':'この地点にする'):'この'+shapeName(s)+'にする';
 for(const b of el('shapeModes').children){b.setAttribute('aria-pressed',String(b.dataset.shapeMode===type));b.setAttribute('aria-checked',String(b.dataset.shapeMode===type));}
 el('shapeHelp').textContent=type==='point'?(sheetState.place.id?'登録済みの撮影地点です。線・範囲へ変更できます。':'地図を動かしてピンを撮影地点に合わせます。'):type==='line'?'地図を動かして中央の＋を合わせ、地図内のどこかをタップして順につなぎます。点は常に＋の位置に追加します。編集する点は下の一覧で選べます。':'地図を動かして中央の＋を外周に合わせ、地図内のどこかをタップして囲みます。点は常に＋の位置に追加します。最後と最初の点をつないだ内側が範囲です。';
 const select=el('shapeVertex');select.disabled=type==='point';select.replaceChildren(new Option('点を選んで編集','-1'),...s.vertices.map((_,i)=>new Option('点 '+(i+1),String(i))));select.value=String(shapeEdit.selected);
 el('shapeMove').disabled=el('shapeRemove').disabled=shapeEdit.selected<0;el('shapeUndo').disabled=!shapeEdit.undo.length;
 el('shapeAddCenter').disabled=type==='point'?!!sheetState.place.id:s.vertices.length>=200;el('shapeAddCenter').textContent=type==='point'?'中心を撮影地点にする':'中心に点を追加';
 const clean=type==='point'?null:AstroNotesShooting.cleanShape(s);el('shapeApply').disabled=type==='point'?!s.vertices.length:!clean;
 el('shapeStatus').textContent=type==='point'?(s.vertices.length?'点として登録できます。':'撮影地点を置いてください。'):`${s.vertices.length}点${clean?' ・ '+shapeName(clean)+'として登録できます':type==='line'?' ・ 2点以上を置いてください。同じ点は続けて置けません。':' ・ 3点以上で囲んでください。交差する枠は登録できません。'}`;
 shapeMap.redraw();
}
function openShapeEditor(mode){
 if(!sheetOwnerMatches())return;if(!shapeDialog)buildShapeEditor();
 const s=sheetState.draftShape;const center=draftPoint()?sheetState.place:place;shapeEdit={owner:auth.token,state:sheetState,selected:-1,undo:[],value:s?structuredClone(s):{type:'point',vertices:mode&&mode!=='point'?[]:[{latitude:center.latitude,longitude:center.longitude}]}};
 if(typeof mode==='string')shapeEdit.value.type=mode;
 // 既存地点の代表点は動かさず、形だけを編集する。新規では未保存のまま地図を開く。
 if(sheetState.place.id&&shapeEdit.value.type==='point')shapeEdit.value.vertices=[{latitude:sheetState.place.latitude,longitude:sheetState.place.longitude}];
 shapeEdit.initial=shapeKey(shapeEdit.value);
 el('shapeTypeMenu').open=false;el('shapeLocationPanel').hidden=false;el('shapeSavedMenu').open=false;el('shapePlaceSearch').value='';el('shapePlaceSearch').dispatchEvent(new Event('input'));
 showSheet(shapeDialog);shapeMap.open(s?.vertices[0]||(draftPoint()?sheetState.place:place),16);
 if(s){const v=s.vertices,lat0=Math.min(...v.map(p=>p.latitude)),lat1=Math.max(...v.map(p=>p.latitude)),lon0=Math.min(...v.map(p=>p.longitude)),lon1=Math.max(...v.map(p=>p.longitude)),lat=(lat0+lat1)/2;shapeMap.setView(lat,(lon0+lon1)/2,Math.min(17,Math.log2(220/(256*Math.max(.00001,(lon1-lon0)/360))),Math.log2(220/(256*Math.max(.00001,(lat1-lat0)/(360*Math.cos(lat*Math.PI/180)))))));}
 renderShapeEditor();
}

// ---------------------------------------------------------------- 記録：撮影ポイントへの入口
function notebookCheck(state=false){return '<svg class="notebook-check" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/>'+(state==='mixed'?'<path d="M7 12h10"/>':state?'<path d="m7 12 3.5 3.5L17 9"/>':'')+'</svg>';}
let notebookEdit=null,notebookGeneration=0,notebookNotice='';
function notebookStamp(ids){const selected=new Set(ids);return JSON.stringify([favorites.filter(f=>selected.has(f.id)),load().filter(r=>selected.has(r.placeId)),Object.entries(shapeData()).filter(([id])=>selected.has(id))]);}
function notebookCommit(mode,state,ids,stamp,targets=[],drafts=[]){
 if(notebookEdit!==state||state.owner!==auth?.token||!toolAllowed('records')||!viewState.records)return false;
 try{
  if(notebookStamp(ids)!==stamp)throw Error('選んだ地点が変更されました。選び直してください');
  const plan=AstroNotesLibrary.prepareNotebookBulk({owner:auth.loginId,favorites,observations:load(),shapes:shapeData(),placeIds:ids,mode,targets:targets.map(targetData),drafts,currentTargets:id=>savedTargets(id)});
  AstroNotesLibrary.transaction(localStorage,plan.entries);favorites=plan.favorites;
  if(typeof RecordSync!=='undefined')RecordSync.kick();
  for(const id of plan.changedFavorites)accountSync().queuePush('fav',id);
  notebookEdit=null;notebookGeneration++;notebookNotice=ids.length+'地点'+(mode==='delete'?'を記録から削除しました':'に対象を追加しました');
  version++;candidateCache.clear();changed();aimFillSelects();SkyMapUI?.refreshTargets?.();return true;
 }catch(e){state.error=e.message||'保存できませんでした。もう一度お試しください';renderRecordsHub();return false;}
}
function notebookAddTargets(button){
 const state=notebookEdit,ids=[...state.ids],stamp=notebookStamp(ids),generation=notebookGeneration;
 if(!ids.length)return;
 const targetBaselines=new Map(favorites.map(f=>[f.id,JSON.stringify(f)]));
 const available=new Map([...aimTargetList(),...(state.drafts||[]).map(d=>AstroNotesLibrary.targetFromFavorite(d.entry))].map(t=>[t.key||t.id,t]));
 const selected=(state.targets||[]).map(t=>available.get(t.key||t.id)).filter(Boolean);
 const source=document.createElement('select');
 AstroTargetPicker.open(source,null,button,{multiple:true,selected,drafts:state.drafts||[],title:ids.length+'地点に追加する対象',doneLabel:'選んだ地点に追加',getTargets:()=>aimTargetList().filter(t=>t.id!=='custom'&&finite(t.latitude)&&(t.parts||[]).length),onDone:(targets,drafts)=>{
  if(notebookEdit!==state||notebookGeneration!==generation||state.owner!==auth?.token||!viewState.records)return;
  state.targets=targets;state.drafts=drafts;
  if(!targets.length)return;
  if(targets.some(t=>{const key=t.key||t.id;if(!key.startsWith('fav:')||drafts.some(d=>'fav:'+d.entry.id===key))return false;const id=key.slice(4),current=placeOf(id);return !current||JSON.stringify(current)!==targetBaselines.get(id);})){
   state.error='追加する対象が変更されました。対象を選び直してください';state.targets=[];state.drafts=[];renderRecordsHub();return;
  }
  notebookCommit('add',state,ids,stamp,targets,drafts);
 }});
}
let recordsTargetFilter = '', recordsBodyFilter = '', recordsFilterOwner = null;
function renderRecordsHub() {
  transferRefresh();
  renderOpportunities();
  const host = el('myRecordsHub'); if (!host) return;
  host.replaceChildren();
  if (skyOwner !== auth?.token || !toolAllowed('skymap')) { leaveSky(); skyOwner=auth?.token; }
  if (sheet?.open && sheetState?.ownerToken !== auth?.token) sheet.close();
  if(shapeDialog?.open&&!shapeEditorCurrent())shapeDialog.close();
  // 非表示でも旧アカウントの地点・記録をDOMへ残さない。
  if(notebookEdit&&notebookEdit.owner!==auth?.token){notebookEdit=null;notebookGeneration++;notebookNotice='';}
  if (!auth?.token || !toolAllowed('records')) return;
  // 2026-10-20 ユーザー「不要な説明は消しといて」：冒頭の使い方の一文は出さない（タブ名と中身で分かる）
  const actions = document.createElement('div'); actions.className = 'my-head';
  const add = document.createElement('button'); add.type = 'button'; add.className = 'chip my-add-point'; add.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';add.setAttribute('aria-label','記録を追加');add.title='記録を追加';
  add.onclick = () => { if (auth?.token && toolAllowed('records')) openPlace(null,'records'); };
  if (toolAllowed('skymap')) { const map = document.createElement('button'); map.type = 'button'; map.className = 'chip'; map.textContent = '地図';map.setAttribute('aria-label','地図で場所を探す'); map.onclick = () => navigationHistory.pushRoute('#/skymap'); actions.append(map); }
  // 2026-10-21 ＋は撮影地点の操作行へ。タブで見出し高さを変えない。
  const edit=document.createElement('button');edit.type='button';edit.className='chip';edit.id='notebookEdit';edit.textContent=notebookEdit?'完了':'編集';edit.setAttribute('aria-pressed',String(!!notebookEdit));edit.onclick=()=>{notebookGeneration++;notebookNotice='';notebookEdit=notebookEdit?null:{owner:auth.token,ids:new Set(),error:''};renderRecordsHub();};
  actions.append(edit);appendRecordTransfer(actions);actions.append(add);if(notebookEdit){add.hidden=true;for(const b of actions.children)if(b!==edit&&b!==add)b.hidden=true;actions.classList.add('notebook-edit-head');const count=document.createElement('strong');count.id='notebookCount';count.setAttribute('role','status');count.setAttribute('aria-live','polite');count.textContent=notebookEdit.ids.size+'地点を選択中';actions.prepend(count);}
  host.append(actions);
  const list = document.createElement('div'); list.className = 'al my-list'; host.append(list);
  const records = load();
  // Favorites are location candidates, not records. Keep historical records
  // and explicitly saved line/area locations visible without adding bare favorites.
  const recordedIds=new Set(records.map(r=>r.placeId));
  const recordedPlaces=favorites.filter(f=>f.recordRegistered||recordedIds.has(f.id)||!!shapeFor(f));
  if(recordsFilterOwner!==auth.token){recordsFilterOwner=auth.token;recordsTargetFilter='';recordsBodyFilter='';}
  if(notebookEdit)for(const id of notebookEdit.ids)if(!recordedPlaces.some(f=>f.id===id))notebookEdit.ids.delete(id);
  if(notebookEdit)el('notebookCount').textContent=notebookEdit.ids.size+'地点を選択中';
  const filterTargets=[...new Map(recordedPlaces.flatMap(f=>targetsSeenFrom(f.id).filter(r=>r.result!=='hidden').map(r=>[r.target.key,r.target]))).values()];
  if(!filterTargets.some(t=>t.key===recordsTargetFilter))recordsTargetFilter='';
  const filters=document.createElement('div');filters.className='my-actions';
  const reset=document.createElement('button');reset.type='button';reset.className='chip';reset.textContent='すべて';reset.setAttribute('aria-pressed',String(!recordsTargetFilter&&!recordsBodyFilter));reset.onclick=()=>{recordsTargetFilter='';recordsBodyFilter='';renderRecordsHub();};
  const targetSelect=document.createElement('select');targetSelect.className='fav-in';targetSelect.setAttribute('aria-label','対象で絞り込む');targetSelect.replaceChildren(new Option('すべての対象',''),...filterTargets.map(t=>new Option(t.name,t.key)));targetSelect.value=recordsTargetFilter;targetSelect.onchange=()=>{recordsTargetFilter=targetSelect.value;renderRecordsHub();};
  const bodySelect=document.createElement('select');bodySelect.className='fav-in';bodySelect.setAttribute('aria-label','撮りたい天体で絞り込む');bodySelect.replaceChildren(new Option('すべての天体',''),...AstroNotesBodies.definitions.map(b=>new Option(b.name,b.id)));bodySelect.value=recordsBodyFilter;bodySelect.onchange=()=>{recordsBodyFilter=bodySelect.value;renderRecordsHub();};
  reset.hidden=!!notebookEdit;if(notebookEdit)filters.classList.add('notebook-edit-filters');
  filters.append(reset,targetSelect,bodySelect,...recordSortControl('recordPlaceSort',renderRecordsHub));host.insertBefore(filters,list);
  if(recordsBodyFilter){const hint=document.createElement('p');hint.className='tiny';hint.textContent='選んだ天体との重なりを調べられる対象がある撮影地点です。';host.insertBefore(hint,list);}
  const visiblePlaces=recordedPlaces.filter(f=>{const active=targetsSeenFrom(f.id).filter(r=>r.result!=='hidden'),matching=active.filter(r=>!recordsTargetFilter||r.target.key===recordsTargetFilter);return (!recordsTargetFilter||matching.length)&&(!recordsBodyFilter||planningPairs(matching,[recordsBodyFilter]).length);});
  if(notebookNotice){const notice=document.createElement('p');notice.className='tiny';notice.setAttribute('role','status');notice.textContent=notebookNotice;host.insertBefore(notice,list);}
  if(notebookEdit){
   const state=notebookEdit,bar=document.createElement('div');bar.className='my-actions notebook-bulk';bar.id='notebookBulk';bar.setAttribute('role','group');bar.setAttribute('aria-label','選んだ撮影地点を編集');
   const selectTools=document.createElement('div');selectTools.className='notebook-select-tools';
   const selectedVisible=visiblePlaces.filter(f=>state.ids.has(f.id)).length,allVisible=visiblePlaces.length>0&&selectedVisible===visiblePlaces.length;
   const master=document.createElement('button');master.type='button';master.className='chip';master.id='notebookSelectAll';master.setAttribute('role','checkbox');master.setAttribute('aria-checked',allVisible?'true':selectedVisible?'mixed':'false');master.disabled=!visiblePlaces.length;
   master.innerHTML=notebookCheck(allVisible?true:selectedVisible?'mixed':false);master.append(document.createTextNode(recordsTargetFilter||recordsBodyFilter?'表示中をすべて選択':'すべて選択'));
   master.onclick=()=>{for(const f of visiblePlaces)if(allVisible)state.ids.delete(f.id);else state.ids.add(f.id);state.error='';renderRecordsHub();el('notebookSelectAll')?.focus({preventScroll:true});};selectTools.append(master);
   const clear=document.createElement('button');clear.type='button';clear.id='notebookSelectNone';clear.className='chip';clear.textContent='選択を解除';clear.hidden=!state.ids.size;clear.onclick=()=>{state.ids.clear();state.error='';renderRecordsHub();el('notebookSelectAll')?.focus({preventScroll:true});};selectTools.append(clear);host.insertBefore(selectTools,list);
   const action=(id,label,run)=>{const b=document.createElement('button');b.type='button';b.className='chip';b.id=id;b.textContent=label;b.onclick=run;bar.append(b);return b;};
   const addTargets=action('notebookAddTargets','対象を一括追加',()=>notebookAddTargets(addTargets));addTargets.disabled=!state.ids.size;
   const remove=action('notebookDelete','削除',()=>{
    if(notebookEdit!==state||state.owner!==auth?.token||!state.ids.size)return;
    const ids=[...state.ids],stamp=notebookStamp(ids);
    if(!confirm(ids.length+'地点を記録から削除しますか？\nこの地点の対象登録・観測記録・線と範囲を削除します。お気に入りの候補と予定は残ります。'))return;
    notebookCommit('delete',state,ids,stamp);
   });remove.disabled=!state.ids.size;remove.style.color='var(--red)';
   host.append(bar);
   if(state.error){const error=document.createElement('p');error.id='notebookBulkError';error.className='warn';error.setAttribute('role','status');error.textContent=state.error;host.insertBefore(error,list);}
  }
  let matches=0;
  if (!recordedPlaces.length) { const empty = document.createElement('p'); empty.className = 'tiny'; empty.textContent = '撮影地点はまだありません。まず撮りたい場所と対象を探せます。'; list.append(empty);if(screenAllowed('framing')&&screenAllowed('skymap')){const find=document.createElement('button');find.type='button';find.className='chip';find.textContent='撮影機会を探す';find.onclick=()=>navigationHistory.pushRoute('#/explore');list.append(find);} }
  for (const f of sortRecordPlaces(recordedPlaces)) {
    const active=targetsSeenFrom(f.id).filter(r=>r.result!=='hidden');
    const matching=active.filter(r=>!recordsTargetFilter||r.target.key===recordsTargetFilter);
    if(recordsTargetFilter&&!matching.length)continue;
    if(recordsBodyFilter&&!planningPairs(matching,[recordsBodyFilter]).length)continue;
    matches++;
    const row = document.createElement('button'); row.type = 'button'; row.className = 'list-item my-place-row';
    const name = document.createElement('strong'); name.textContent = f.name;
    const sub = document.createElement('span'); sub.className = 'tiny sub-line';
    const mine = records.filter(r => r.placeId === f.id).sort((a,b) => when(b)-when(a));
    const targets=targetsSeenFrom(f.id).filter(r=>r.result!=='hidden');
    sub.textContent=shapeFor(f)?shapeName(shapeFor(f))+' ・ ':'';sub.textContent+=targets.length?`対象${targets.length}件 ・ ${targets.map(r=>r.target.name).join('・')}`:'対象は未登録';
    row.dataset.notebookPlace=f.id;
    if(notebookEdit){const state=notebookEdit;row.setAttribute('role','checkbox');row.setAttribute('aria-checked',String(state.ids.has(f.id)));row.insertAdjacentHTML('beforeend',notebookCheck(state.ids.has(f.id)));}
    row.append(name, sub); row.onclick = () => {if(notebookEdit){const state=notebookEdit;if(state.ids.has(f.id))state.ids.delete(f.id);else state.ids.add(f.id);state.error='';state.targets=[];state.drafts=[];renderRecordsHub();[...el('myRecordsHub').querySelectorAll('[data-notebook-place]')].find(r=>r.dataset.notebookPlace===f.id)?.focus({preventScroll:true});return;}openPlace(f, 'records');if(recordsBodyFilter){sheetState.bodies=[recordsBodyFilter];for(const check of sheet.querySelectorAll('[data-planning-body]'))check.checked=check.value===recordsBodyFilter;}};
    const group=document.createElement('div');group.className='journey-place-row';group.append(row);
    if(!notebookEdit&&planningPairs(targets,recordsBodyFilter?[recordsBodyFilter]:['sun','moon']).length){const find=document.createElement('button');find.type='button';find.className='chip journey-place-find';find.textContent='重なる日';find.setAttribute('aria-label',f.name+'の重なる日を一覧で見る');find.onclick=()=>openOpportunityList(f.id,recordsBodyFilter?[recordsBodyFilter]:['sun','moon']);group.append(find);}list.append(group);
  }
  if(recordedPlaces.length&&!matches){const empty=document.createElement('p');empty.className='tiny';empty.textContent='この条件の撮影地点はありません。';list.append(empty);}
  // 2026-10-20 ユーザー「出し方を変えた方がいいのも最適化して」：保存先の説明は常に出さず、データの控えの中へ

}
async function openFromRecords(place, target = null, row = null) {
  if (!screenAllowed('framing')) return;
  const token = auth?.token, openedSheet = sheetState;
  try {
    await AstroNotesAssets.ensureModels();
    if (token !== auth?.token || !screenAllowed('framing') || sheetState !== openedSheet || !sheet?.open || !viewState.records) return false;
    if (sheet?.open && sheetState === openedSheet) sheet.close();
    if(row?.shapeType)globalThis.TrialExplore?.preferMap();
    navigationHistory.pushRoute('#/aim');
    if (target) openWith(place, target, row, 'aim'); else openInAim(place, row);
  } catch { const error = sheet?.open ? el('myRecordError') : document.createElement('p'); error.textContent = '構図を開けませんでした。もう一度お試しください'; error.hidden = false; error.setAttribute('role','status'); if (!sheet?.open) el('myRecordsHub')?.append(error); }
}

// ---------------------------------------------------------------- 次に重なる日（見えた組だけ）
// 重なりの判定は構図と同じ条件にする。構図で選んでいる目標なら、その部位（建物全体を含む）と縁。
// ほかの目標は構図の既定と同じ（塔・建物は建物全体、山は山頂）
function matchOpts(t) {
  return {partId:t&&aimIsMountain(t)?null:'__whole',limb:'center',matchMode:'overlap'};
}
const cache = new Map();
let queue = Promise.resolve();
const sideName = (body, side) => !AstroNotesBodies.definition(body)?.limbs ? (side === 'set' ? '沈む側' : '昇る側')
  : body === 'moon' ? (side === 'set' ? '月の入' : '月の出') : (side === 'set' ? '日の入' : '日の出');
function dayText(at) {
  const y = new Date(at + 9 * 3600000).getUTCFullYear(), now = new Date(Date.now() + 9 * 3600000).getUTCFullYear();
  return `${y === now ? '' : y + '/'}${S.Cal.monthDay(at)}(${S.Cal.weekday(at)})`;
}
// Reuse the app's original Moon portrait at this candidate's time and coordinates.
function appendCandidateMoon(host, body, at, point) {
  if (body !== 'moon') return;
  const phase = document.createElement('span'); phase.className = 'record-candidate-moon';
  try {
    const moon = AstroNotesAstro.moon(at, {latitude:point.latitude, longitude:point.longitude, elevation:0});
    if (!Number.isFinite(moon.illuminatedFraction)) return;
    phase.innerHTML = moonGlyphAt(at, point);
    phase.append(document.createTextNode(' ' + Math.round(moon.illuminatedFraction * 100) + '%'));
    phase.setAttribute('aria-label', AstroNotesMoon.phaseOf(moon).name + '、輝面 ' + Math.round(moon.illuminatedFraction * 100) + '%');
    host.append(phase);
  } catch { /* Keep the candidate usable without inventing a phase. */ }
}
// 1組につき次の1回。400日で無ければ「重なりません」（既存の言い切りと同じ根拠）
function nextFor(place, target, body, { partId = null, limb = 'center', matchMode = 'overlap' } = {}) {
  const from = aimSavedFrom(AstroNotesShooting.savedObserver(place));
  if (!from || !target) return Promise.resolve(null);
  const top = (AstroNotesAlign.partOf(target, partId) || {}).m;
  const k = JSON.stringify([from.latitude, from.longitude, from.groundManualM, aimObserverEye(from), target.id, target.latitude, target.longitude, top, body, partId, limb, matchMode, S.Cal.startOfDay(Date.now())]);
  const hit = cache.get(k);
  if (hit && (!hit.until || Date.now() < hit.until)) return hit.promise;
  const entry = { until: 0, promise: null };
  entry.promise = queue = queue.catch(() => {}).then(async () => {
    await AstroNotesBodies.ensure(body);
    const ground = from.groundManualM ?? await aimElevation(from.latitude, from.longitude);
    const obs = aimObserverAt(from, ground);
    const rows = await aimBuildingDays(obs, target, body, partId, null, { from: Date.now(), days: 400, limit: 1, limb, matchMode, isCurrent: () => true });
    const row = rows[0] || null;
    entry.until = row ? row.at : S.Cal.startOfDay(Date.now()) + DAY;
    return row;
  });
  entry.promise.catch(() => cache.delete(k));
  cache.set(k, entry);
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return entry.promise;
}

// ---------------------------------------------------------------- 一覧の行（構図・地図・地点の画面で同じ形）
// rows: [{place, record}]、onPick(place,row)。計算が終わった行から埋める
function renderRows(box, rows, target, body, opts, onPick, token) {
  box.replaceChildren();
  const items = rows.map(({ place, record }) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'list-item my-place-row';
    const title = document.createElement('strong'); title.textContent = place.name;
    const mark = document.createElement('span'); mark.className = 'my-mark ' + record.result; mark.textContent = RESULTS[record.result].mark;
    mark.setAttribute('aria-label', RESULTS[record.result].name); title.prepend(mark);
    const sub = document.createElement('span'); sub.className = 'tiny sub-line'; sub.textContent = '次に重なる日を計算しています…';
    b.append(title, sub); box.append(b);
    return { b, sub, place, at: Infinity };
  });
  items.forEach((it) => {
    it.b.onclick = () => onPick(it.place, it.row || null);
    nextFor(it.place, target, body, opts).then((row) => {
      if (token && !token()) return;
      it.row = row; it.at = row ? row.at : Infinity;
      it.sub.textContent = row ? `${dayText(row.at)} ${sideName(body, row.side)} ${S.JstCal.hhmm(row.at)}` : '400日以内には重なりません';
      if(row)appendCandidateMoon(it.sub,body,row.at,it.place);
      // 早い順に並べ直す（計算が終わった順に入れ替わる）
      const sorted = [...items].sort((a, b) => a.at - b.at);
      if (sorted.some((x, i) => box.children[i] !== x.b)) box.append(...sorted.map((x) => x.b));
    }).catch(() => { if (!token || token()) it.sub.textContent = '計算できませんでした'; });
  });
}

// ---------------------------------------------------------------- 構図（どこから重ねるかの下）
function aimBox() {
  let box = el('myPlacesAim');
  if (box) return box;
  box = document.createElement('section'); box.id = 'myPlacesAim'; box.className = 'shooting-location-actions'; box.setAttribute('aria-label', '撮影地点を探す');
  el('aimFromButton').closest('.aim-say').after(box);
  return box;
}
function renderAim() {
  const box = aimBox(), t = aim.target, map=el('skyMapOpen')?.closest('.sky-map-link');
  box.replaceChildren();box.hidden=false;
  const candidates=document.createElement('button');candidates.type='button';candidates.className='chip';candidates.textContent='この日の候補から選ぶ';candidates.hidden=!t||!(t.parts||[]).length||t.id==='custom';candidates.onclick=()=>{openPlaceSheet('aim',{focusSearch:false});recentHistory.candidates();};box.append(candidates);
  if(map)box.append(map);
 if(t?.favId||t?.id==='custom'){const edit=document.createElement('button');edit.type='button';edit.className='chip';edit.textContent='対象を編集';edit.onclick=()=>AstroTargetPicker.edit(el('aimTarget'),t,edit);box.append(edit);}
}
function adoptOverlap(row) {
 if(row?.matchMode!=='overlap')return;
 aim.matchMode='overlap';aim.partId=row.partId??null;aim.limb='center';el('aimPart').value=aim.partId||'';el('aimLimb').innerHTML='';
}
function openInAim(place, row) {
  adoptOverlap(row);
  aimSetFrom(AstroNotesShooting.savedObserver(place), { keepMap: true });
  if (row) {
    aim.candPick = null; aim.spot = null; aim.wantSpot = null; aim.wantKey = null; aim.candSide = row.side;
    el('aimDate').value = new Date(S.Cal.startOfDay(row.at) + 9 * 3600000).toISOString().slice(0, 10);
    aim.plannerTransfer={at:row.at,body:aim.body,latitude:place.latitude,longitude:place.longitude,day:AstroNotesShooting.day(row.at)};
    aimApply();
  }
  requestAnimationFrame(() => el('aimLook')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }));
}

// ---------------------------------------------------------------- 地点の画面の「見えた地点」タブ（構図のどこから重ねるかで開いたとき）
let pickerToken = 0,pickerShapeId=null;
function selectShape(p,mode){if(!["aim","skymap"].includes(mode)||!shapeFor(p))return false;pickerShapeId=p.id;recentHistory.candidates();return true;}
function resetShapePicker(){pickerShapeId=null;}

async function renderPickerPanel(panel) {
 const token=++pickerToken,owner=auth?.token;
 let box=panel.querySelector('.my-picker');if(!box){box=document.createElement('div');box.className='my-picker';panel.prepend(box);}box.replaceChildren();
 const workspace=globalThis.TrialExplore?.candidateWorkspace?.(),workspaceEpoch=workspace?.epoch(),mode=placeSheetFor,isSky=!!workspace||mode==='skymap';
 if(workspace?.separateRecords)return;
 if(workspace&&(!workspace.active()||!workspace.visible()))return;
 const state=()=>isSky?skySession:{target:aim.target,body:aim.body,partId:aim.partId,limb:aim.limb,matchMode:aim.matchMode,at:aim.dayMs};
 const t=state()?.target,plan=globalThis.AstroNotesCandidatePicker?.registeredPlan?.(AstroNotesShooting.conditions(state()))||AstroNotesShooting.conditions(state()),selectedShape=pickerShapeId;
 const pickerPoints=s=>pointsForPlan(s).filter(x=>!selectedShape||x.place.id===selectedShape);
 const note=document.createElement('p');note.className='tiny';box.append(note);
 if(!plan||t.id==='custom'){note.textContent='対象を選び、自分の対象に登録すると、その対象が見えた撮影地点から候補を探せます。';return;}
 if(!owner||!screenAllowed(isSky?'skymap':'framing')){note.textContent='ログインして利用権限を確認してください。';return;}
 note.textContent=`${S.Cal.monthDay(plan.at)}・${AstroNotesBodies.definition(plan.body)?.name}を${t.name}に重ねる候補を確認しています…`;
 const query=()=>{const s=state();return s?.target?AstroNotesShooting.queryKey(s,pickerPoints(s),auth?.loginId,AstroNotesAtmosphere.dataKey(s.at)):'';};
 const key=query();
 const current=()=>token===pickerToken&&owner===auth?.token&&screenAllowed(isSky?'skymap':'framing')&&(workspace?workspace.epoch()===workspaceEpoch&&workspace.active()&&workspace.visible():el('placeSheet').open&&placeSheetFor===mode)&&key===query();
 try{
  const result=await AstroNotesShooting.candidates(plan,pickerPoints(plan),{align:AstroNotesAlign,isMountain:aimIsMountain,observerAt:(f,g)=>aimObserverAt(aimSavedFrom(f),g),elevationAt:candidateElevation,viewFor:(obs,p)=>aimShootingView(obs,p.target,p.body,p.partId,p.matchMode),ensure:b=>AstroNotesBodies.ensure(b),isCurrent:current,onProgress:p=>{if(current())note.textContent='線上・範囲内を確認しています… '+p.checked+'地点';}});
  if(!current()||result.cancelled)return;
  if(workspace)note.hidden=true;
  note.textContent=`${S.Cal.monthDay(plan.at)}・${AstroNotesBodies.definition(plan.body)?.name}を${t.name}に：${result.rows.length}件（絞り込み前）${selectedShape?'（'+(placeOf(selectedShape)?.name||'選んだ場所')+'）':''}`;
  if(!result.rows.length&&!workspace){const empty=document.createElement('p');empty.className='tiny';empty.textContent=result.failed?'確認できていない撮影地点があります。再試行してください。':'登録した地点に候補がありません。日付や対象を変えてください。';box.append(empty);}
  if(result.failed){const failed=document.createElement('p');failed.className='tiny';failed.textContent=shapeIssue(result)||`${result.failed}地点を確認できませんでした。`;box.append(failed);}
  for(const row of result.rows){const button=document.createElement('button');button.type='button';button.className='list-item my-place-row';const title=document.createElement('strong');title.textContent=row.place.name;const sub=document.createElement('span');sub.className='tiny sub-line';sub.textContent=`${S.JstCal.hhmm(row.event.at)}・${sideName(plan.body,row.event.side)}・${RESULTS[row.record.result].name}${row.shapeType?' ・ '+(row.shapeType==='line'?'線上':'範囲内')+' '+row.place.latitude.toFixed(5)+', '+row.place.longitude.toFixed(5):''}`;button.append(title,sub);button.onclick=()=>{if(!current()||workspace&&!workspace.selectable())return;if(isSky){if(SkyMapUI?.selectCandidate?.(row,contextOf(skySession)))el('placeSheet').close();}else{el('placeSheet').close();openInAim(row.place,row.event);}};box.append(button);}
  globalThis.AstroNotesCandidatePicker?.registerRegisteredFromSession(box,result.rows,plan,current);
  if(result.failed){const retry=document.createElement('button');retry.type='button';retry.className='chip';retry.textContent='再試行';retry.onclick=()=>renderPickerPanel(panel);box.append(retry);}
 }catch{if(current()){note.textContent='候補を確認できませんでした。';const retry=document.createElement('button');retry.type='button';retry.className='chip';retry.textContent='再試行';retry.onclick=()=>renderPickerPanel(panel);box.append(retry);}}
}

// ---------------------------------------------------------------- 地図：指定日の撮影ポイント候補
let skySession=null,skyKey='',skyToken=0,skyOwner=null;
function leaveSky(){el('skyMapAlignmentControls')?.replaceChildren();const alignmentDetail=el('skyMapAlignmentDetails');if(alignmentDetail)alignmentDetail.hidden=true;skySession=null;skyKey='';skyToken++;candidateState={status:'idle',rows:[],failed:0};candidateCache.clear();candidateSheet?.close();el('shootingCandidatesList')?.replaceChildren();const condition=el('shootingCandidatesCondition');if(condition)condition.textContent='';el('mySkyPlaces')?.replaceChildren();overlapGate(false,'');}
let pinsOn=store.get('sorami.candidatePins',true)!==false;
let candidateState={status:'idle',rows:[],failed:0},candidateSheet=null,selectedCandidate=null;
const candidateCache=new Map();
const overlapGate=AstroNotesShooting.hapticGate({vibrate:ms=>{if(!document.hidden&&store.get('sorami.haptic',true)!==false)navigator.vibrate?.(ms);}});
const contextOf=s=>JSON.stringify([s.body,s.target,s.partId,s.limb,AstroNotesShooting.day(s.at),s.matchMode||'limb']);
function pointsForPlan(s){
 return placesFor(s.target.id).filter(x=>x.record.observer&&finite(x.record.target.latitude)&&finite(x.record.target.longitude)&&AstroNotesTerrain.distanceKm(x.record.target.latitude,x.record.target.longitude,s.target.latitude,s.target.longitude)<NEAR_KM);
}
function currentSkyQuery(s){return AstroNotesShooting.queryKey(s,pointsForPlan(s),auth?.loginId,AstroNotesAtmosphere.dataKey(s.at));}
function drawCandidateList(){
 if(!candidateSheet?.open)return;
 const content=el('shootingCandidatesList');content.replaceChildren();
 const note=document.createElement('p');note.className='tiny';
 note.textContent=candidateState.status==='loading'?'この日に重なる撮影地点を確認しています…':candidateState.status==='error'?'候補を確認できませんでした。もう一度お試しください':candidateState.rows.length?'選ぶと、その撮影地点と重なる時刻へ移動します。':candidateState.failed?'確認できていない地点があります。再試行して候補を確認してください。':'登録した撮影地点に、この日の条件で重なる候補はありません。';content.append(note);
 if(candidateState.status==='error'||candidateState.failed){const retry=document.createElement('button');retry.type='button';retry.className='chip';retry.textContent=candidateState.failed?`${candidateState.failed}地点を確認できませんでした・再試行`:'再試行';retry.onclick=()=>{candidateCache.delete(skyKey);skyKey='';skyRender(skySession);};content.append(retry);}
 for(const row of candidateState.rows){
  const button=document.createElement('button');button.type='button';button.className='list-item my-place-row';
  const title=document.createElement('strong');title.textContent=row.place.name;
  const details=document.createElement('span');details.className='tiny sub-line';details.textContent=`${S.JstCal.hhmm(row.event.at)}・${sideName(skySession.body,row.event.side)}・${row.record.result==='partial'?'一部見える対象':'登録済みの対象'}${row.shapeType?' ・ '+(row.shapeType==='line'?'線上':'範囲内')+' '+row.place.latitude.toFixed(5)+', '+row.place.longitude.toFixed(5):''}`;
  button.append(title,details);button.onclick=()=>chooseCandidate(row);content.append(button);
 }
}
function chooseCandidate(row){
 if(candidateState.status!=='ready'||!candidateState.rows.includes(row)||!skySession||!auth?.token||currentSkyQuery(skySession)!==skyKey)return;
 if(SkyMapUI?.selectCandidate?.(row,contextOf(skySession))){selectedCandidate=row;candidateSheet?.close();}
}
function showCandidateList(){
 if(!candidateSheet){candidateSheet=document.createElement('dialog');candidateSheet.className='sheet';candidateSheet.id='shootingCandidates';candidateSheet.setAttribute('aria-labelledby','shootingCandidatesTitle');candidateSheet.innerHTML='<div class="sheet-head"><strong id="shootingCandidatesTitle">撮影地点の候補</strong><button type="button" data-close>閉じる</button></div><div class="sheet-body"><p class="tiny" id="shootingCandidatesCondition"></p><div id="shootingCandidatesList" class="al my-list"></div></div>';document.body.append(candidateSheet);candidateSheet.querySelector('[data-close]').onclick=()=>candidateSheet.close();}
 if(!skySession?.target)return;
 el('shootingCandidatesCondition').textContent=`${S.Cal.monthDay(skySession.at)}・${AstroNotesBodies.definition(skySession.body)?.name}を${skySession.target.name}に`;
 showSheet(candidateSheet);drawCandidateList();
}
function skyBox(){let box=el('mySkyPlaces');if(!box){box=document.createElement('section');box.id='mySkyPlaces';box.className='my-places';box.setAttribute('aria-label','撮影地点');const dates=el('skyMapDates').closest('.sky-map-candidates');dates.closest('.sky-map-footer')?dates.closest('#skyMapView').querySelector('.sky-map-wrap').before(box):dates.after(box);}return box;}
function updateCandidateUI(){
 const trigger=el('shootingCandidatesOpen');if(!trigger)return;
 trigger.textContent=candidateState.status==='loading'?'撮影地点：候補を確認中…':candidateState.status==='error'?'撮影地点：確認できません':`撮影地点：候補${candidateState.rows.length}件`;
 el('shootingPins').setAttribute('aria-pressed',String(pinsOn));el('shootingPins').setAttribute('aria-checked',String(pinsOn));el('shootingPins').textContent=pinsOn?'候補ピン：表示':'候補ピン：非表示';
 const state=el('shootingCandidateStatus');state.textContent=shapeIssue(candidateState)||(candidateState.stepM?'線上・範囲内から計算した候補です。地形や見通しは現地でも確認してください。':'');
 drawCandidateList();
}
function checkOverlap(s){
 const out=el('shootingOverlap');if(!out)return;if(!s.observer){overlapGate(false,'');out.textContent='';out.classList.remove('shooting-overlap-on');return;}if(!s.daily||!s.eye){if(!out.textContent)out.textContent='重なりを確認しています…';return;}
 let hit=null;
 if(s.daily&&s.eye&&s.target)try{const o=AstroNotesShooting.searchOptions(s,aimIsMountain);hit=o.broad&&o.disc?AstroNotesAlign.dailyView(s.eye,s.target,s.body,s.at,{partId:o.partId,eyeM:0,at:s.at})[0]:AstroNotesAlign.alignmentAt(s.eye,s.target,s.body,s.at,{partId:o.partId,limb:o.limb,eyeM:0});if(o.broad&&o.disc)hit={...hit,matched:!!hit?.intersects};}catch{}
 const matched=!!hit?.matched,key=JSON.stringify([auth?.loginId,s.observer,s.target,s.body,s.partId,s.limb,AstroNotesShooting.day(s.at)]);
 overlapGate(matched,key);
 const text=matched?'重なる位置です':hit?'時間を動かして重なりを確認':'重なりを確認しています…';
 if(out.textContent!==text)out.textContent=text;
 out.classList.toggle('shooting-overlap-on',matched);
}
function skyRender(s){
 if(skyOwner!==auth?.token){leaveSky();skyOwner=auth?.token;}
 skySession=s;if(!s||!auth?.token||!toolAllowed('skymap'))return;
 const box=skyBox(),t=s.target;
 const shareRow=el('skyMapShareRow');if(shareRow){shareRow.hidden=!s.observer||!t;for(const b of shareRow.querySelectorAll('[data-plan-action]'))b.disabled=!s.daily||!s.eye;}
 const detail=el('skyMapAlignmentDetails');renderSkyAlignment(s);renderPreviewEyeHeight(s);box.hidden=!t;
 if(!t){skyKey='';candidateState={status:'idle',rows:[],failed:0};box.replaceChildren();candidateSheet?.close();return;}
 const key=currentSkyQuery(s);
 if(key!==skyKey){
  skyKey=key;selectedCandidate=null;const token=++skyToken,owner=auth.token,plan=AstroNotesShooting.conditions(s),points=pointsForPlan(s);
  box.replaceChildren();
  const controls=document.createElement('div');controls.className='my-head';
  const trigger=document.createElement('button');trigger.type='button';trigger.className='fav-btn primary';trigger.id='shootingCandidatesOpen';trigger.onclick=showCandidateList;
  const toggle=document.createElement('button');toggle.type='button';toggle.className='chip';toggle.id='shootingPins';toggle.setAttribute('role','switch');toggle.setAttribute('aria-label','候補ピンを地図に表示');toggle.textContent='候補ピン';toggle.onclick=()=>{pinsOn=!pinsOn;store.set('sorami.candidatePins',pinsOn);updateCandidateUI();SkyMapUI?.redraw?.();};
  controls.append(trigger,toggle);box.append(controls);
  // Alignment controls retain their focused DOM while the candidate key changes.
  const status=document.createElement('p');status.className='tiny';status.id='shootingCandidateStatus';status.setAttribute('role','status');
  const overlap=document.createElement('p');overlap.className='tiny shooting-overlap';overlap.id='shootingOverlap';overlap.setAttribute('role','status');box.append(status,overlap);

  candidateState={status:'loading',rows:[],failed:0};updateCandidateUI();
  let job=candidateCache.get(key);
  if(!job){job=AstroNotesShooting.candidates(plan,points,{align:AstroNotesAlign,isMountain:aimIsMountain,observerAt:(f,g)=>aimObserverAt(aimSavedFrom(f),g),elevationAt:candidateElevation,viewFor:(obs,p)=>aimShootingView(obs,p.target,p.body,p.partId,p.matchMode),ensure:b=>AstroNotesBodies.ensure(b),isCurrent:()=>owner===auth?.token&&token===skyToken&&!!skySession&&currentSkyQuery(skySession)===key,onProgress:p=>{if(owner===auth?.token&&token===skyToken){const status=el('shootingCandidateStatus');if(status)status.textContent='線上・範囲内を確認しています… '+p.checked+'地点';}}});candidateCache.set(key,job);if(candidateCache.size>24)candidateCache.delete(candidateCache.keys().next().value);}
  job.then(result=>{if(owner!==auth?.token||token!==skyToken||skyKey!==key)return;if(result.cancelled){candidateCache.delete(key);skyKey='';skyRender(skySession);return;}candidateState={...result,status:'ready'};updateCandidateUI();SkyMapUI?.redraw?.();}).catch(()=>{candidateCache.delete(key);if(owner!==auth?.token||token!==skyToken||skyKey!==key)return;candidateState={status:'error',rows:[],failed:0};updateCandidateUI();});
 }
 checkOverlap(s);
}
function skyDraw(ctx,{project,width,height},s,pickMode){
 if(!s||pickMode||!pinsOn||candidateState.status!=='ready'||!skyKey||currentSkyQuery(s)!==skyKey)return;
 for(const entry of pointsForPlan(s))if(entry.place.shape)drawShape(ctx,project,entry.place.shape,{vertices:false});
 const drawn=new Set();for(const row of candidateState.rows){const f=row.place;const pinKey=f.id+':'+f.latitude+','+f.longitude;if(drawn.has(pinKey))continue;drawn.add(pinKey);
  const [x,y]=project(f.latitude,f.longitude);if(x<0||y<0||x>width||y>height)continue;
  ctx.save();ctx.beginPath();ctx.arc(x,y,7,0,Math.PI*2);ctx.fillStyle=row.record.result==='partial'?'#c07a00':'#32668b';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#fff';ctx.stroke();ctx.restore();
 }
}
function pickSky(pixel,project){
 if(!pinsOn||candidateState.status!=='ready'||!skySession||currentSkyQuery(skySession)!==skyKey)return false;
 let best=null,distance=22;for(const row of candidateState.rows){const p=project(row.place.latitude,row.place.longitude),d=Math.hypot(p[0]-pixel.x,p[1]-pixel.y);if(d<distance){best=row;distance=d;}}
 if(!best)return false;chooseCandidate(best);return true;
}
function openInSky(place,row){SkyMapUI?.setObserver?.(AstroNotesShooting.savedObserver(place));if(row)SkyMapUI?.setTime?.(row.at);}

// ---------------------------------------------------------------- 撮影ポイントの画面（記録と次に重なる日）
let sheet = null, sheetState = null, sheetToken = 0, undoRec = null;
// A place can have many visible targets; celestial bodies are planning filters,
// never a restriction on the saved visibility observation.
const inputRoleIcon = role => `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="#input-icon-${role}"/></svg>`;
function planningPairs(records, bodies) {
  return records.filter(r => r.result !== 'hidden').flatMap(record => bodies.filter(body => {
    if (!AstroNotesBodies.definition(body)) return false;
    return AstroNotesAccess.canFrame(toolAllowed, record.target.key, body);
  }).map(body => ({record, body})));
}
function recordGroups(records) {
  const groups=new Map();
  for(const r of records){if(!groups.has(r.target.key))groups.set(r.target.key,[]);groups.get(r.target.key).push(r);}
  return [...groups.values()].map(rows=>{rows.sort((a,b)=>when(b)-when(a)||b.updatedAt-a.updatedAt);return {latest:rows[0],records:rows};});
}
const targetData=t=>({key:t.key||t.id,name:t.name,latitude:t.latitude,longitude:t.longitude});
const targetSetKey=targets=>JSON.stringify(targets.map(targetData).sort((a,b)=>a.key.localeCompare(b.key)));
const savedTargets=placeId=>targetsSeenFrom(placeId).filter(r=>r.result!=='hidden').map(r=>targetData(r.target));
const draftChanged=()=>!!sheetState&&(recordBodyDirty()||recordHeightDirty()||recordAlignmentDirty()||(sheetState.targetDrafts||[]).length>0||sheetState.newPlace||(sheetState.place.name||'').trim()!==sheetState.initialName||targetSetKey(sheetState.draftTargets)!==sheetState.baseline||shapeKey(sheetState.draftShape)!==shapeKey(sheetState.initialShape));
function addDraftTarget(t){
  if(!sheetOwnerMatches()||!t)return;
  if(!sheetState.draftTargets.some(x=>x.key===(t.key||t.id)))sheetState.draftTargets.push(targetData(t));
  el('myRecordTarget').value='';el('myRecordError').hidden=true;el('myRecordSaved').hidden=true;renderSheet();
}
function showRecordEditor(){if(!sheetOwnerMatches())return;el('myTargetPicker').hidden=false;el('myRecordAdd').hidden=true;}
function discardDraft(){if(draftChanged()&&!confirm('変更を保存せず閉じますか？'))return false;return true;}
function registrationChanges(place,before,after,now=Date.now()){return AstroNotesLibrary.registrationChanges(place,before,after,now);}
const recordCoordinates=p=>`${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`;
const recordPlaceName=s=>(s.place.name||'').trim()||s.locationName||recordCoordinates(s.place);
function ensureRecordLocation(){
 if(!draftPoint())return;
 const s=sheetState,key=recordCoordinates(s.place);
 if(s.locationKey===key)return;
 s.locationAbort?.abort();s.locationKey=key;s.locationName=key;s.locationLabel=key;s.locationPending=true;
 const controller=new AbortController();s.locationAbort=controller;
 const timer=setTimeout(()=>controller.abort(),5000);
 nearName(s.place.latitude,s.place.longitude,{signal:controller.signal}).then(near=>{
  if(sheetState!==s||!sheetOwnerMatches()||!sheet.open||s.locationKey!==key)return;
  s.locationName=near.name||key;s.locationLabel=[near.area,near.name].filter((x,i,a)=>x&&a.indexOf(x)===i).join(' ・ ')||key;
 }).catch(()=>{/* 座標を代替名として保持する。 */}).finally(()=>{
  clearTimeout(timer);
  if(sheetState!==s||!sheetOwnerMatches()||!sheet.open||s.locationKey!==key)return;
  s.locationPending=false;renderSheet();
 });
}
function buildSheet() {
  sheet = document.createElement('dialog'); sheet.className = 'sheet'; sheet.id = 'myPlaceSheet'; sheet.tabIndex = -1; sheet.setAttribute('aria-labelledby', 'myPlaceTitle');
  sheet.innerHTML = `<div class="sheet-head"><strong id="myPlaceTitle">記録を追加</strong><button type="button" data-close aria-label="閉じる">閉じる</button></div>
  <div class="sheet-body">
    <p id="myPlanningPlace" class="journey-planning-place" hidden></p>
    <div class="my-input-field"><div class="condition-label">${inputRoleIcon('observer')}<span>撮影地点</span></div><button type="button" class="my-location-value" id="myPlaceName" aria-label="撮影地点を選ぶ"></button><label id="myNewPlaceNameLabel" hidden><span class="tiny">名前（任意）</span><input class="my-location-value" id="myNewPlaceName" maxlength="200" placeholder="空欄なら地点名を使います" aria-label="名前（任意）"></label></div>
    <div class="my-actions"><button type="button" class="chip" id="myShapeEdit">点・線・範囲</button><span class="tiny" id="myShapeSummary"></span></div><div id="myRecordLocationConfirm" hidden><p class="tiny">保存していない対象の編集を戻して、撮影地点を変更しますか？</p><button type="button" class="chip" id="myRecordLocationChange">変更する</button><button type="button" class="chip" id="myRecordLocationKeep">戻る</button></div>
    <div class="my-input-field"><div class="condition-label">${inputRoleIcon('target')}<span>対象</span></div><button type="button" class="my-location-value" id="myRecordPickTarget" aria-label="対象を選んで追加">対象を追加</button></div>
    <select id="myRecordTarget" hidden aria-label="対象"></select><button id="myRecordAdd" type="button" hidden>対象を追加</button><div id="myTargetPicker" hidden></div>
    <div id="myPlaceRecords"></div>
    <p class="warn" id="myRecordError" role="status" hidden></p><button type="button" class="chip" id="myRecordReuse" hidden>登録済みの地点で編集を続ける</button><p class="tiny" id="myRecordSaved" role="status" hidden></p>
    <div class="my-actions"><button type="button" class="fav-btn primary" id="myRecordSave">まとめて保存</button><button type="button" class="chip" id="myRecordCancel">キャンセル</button></div>
    <p class="tiny muted">対象はこの端末に保存し、ログイン中に同期します。登録日は保存時に自動で残します。</p>
    <details id="myPlacePlanning" class="my-secondary"><summary>この場所から撮る</summary><fieldset class="my-body-options"><legend class="condition-label">${inputRoleIcon('body')}<span>天体</span><span class="tiny">複数選択可</span></legend><div id="myPlaceBodies"></div></fieldset><button type="button" class="chip" id="myPlaceFind">次に重なる日を探す</button><h3 class="my-title">次に重なる日</h3><div class="al my-list" id="myPlaceNext"></div></details>
    <details id="myPlaceDetails" class="my-secondary"><summary>場所の詳細</summary><p class="tiny" id="myPlaceSub"></p></details>
  </div>`;
  document.body.append(sheet);buildRecordHeight();
  sheet.querySelector('[data-close]').onclick = () => {if(discardDraft())sheet.close();};
  sheet.addEventListener('cancel',e=>{if(!discardDraft())e.preventDefault();});
  el('myRecordAdd').onclick=()=>el('myRecordPickTarget').click();
  el('myPlaceName').onclick=()=>{if(sheetOwnerMatches())openShapeEditor();};
  el('myRecordLocationChange').onclick=()=>{if(!sheetOwnerMatches())return;el('myRecordLocationConfirm').hidden=true;openPlaceSheet('records');};
  el('myRecordLocationKeep').onclick=()=>{el('myRecordLocationConfirm').hidden=true;el('myPlaceName').focus();};
  el('myRecordCancel').onclick=()=>{sheetState.draftTargets=sheetState.initialTargets.map(t=>({...t}));sheetState.targetDrafts=[];el('myTargetPicker').hidden=true;el('myRecordAdd').hidden=true;el('myRecordError').hidden=true;el('myRecordSaved').hidden=true;sheet.close();};
  if(window.AstroTargetPicker)el('myRecordTarget').hidden=true;
  el('myRecordTarget').onchange=()=>addDraftTarget(resolveTarget(el('myRecordTarget').value));
  el('myRecordSave').onclick=saveRecord;
  el('myShapeEdit').onclick=()=>openShapeEditor();
  el('myNewPlaceName').oninput=()=>{if(sheetOwnerMatches()){sheetState.place.name=el('myNewPlaceName').value;el('myRecordSaved').hidden=true;el('myRecordSave').disabled=!draftPoint()||!!sheetState.locationPending||!draftChanged();}};
  sheet.addEventListener('close', () => { sheetState?.locationAbort?.abort();sheetToken++; undoRec = null; });
  for (const body of AstroNotesBodies.definitions) {
    const label=document.createElement('label'),check=document.createElement('input');
    check.type='checkbox';check.value=body.id;check.dataset.planningBody=body.id;
    check.onchange=()=>{if(!sheetOwnerMatches())return;sheetState.bodies=[...sheet.querySelectorAll('[data-planning-body]:checked')].map(n=>n.value);if(sheetState.ctx==='records'){if(sheetState.bodies.length)sheetState.place.planningBodies=sheetState.bodies.slice();else delete sheetState.place.planningBodies;}sheetState.planningRequested=false;renderSheet();};
    label.append(check,document.createTextNode(body.name));el('myPlaceBodies').append(label);
  }
  el('myPlaceFind').onclick=()=>{if(!sheetOwnerMatches())return;if(sheetState.ctx==='records'){if(draftChanged()||!sheetState.place.id)return;openOpportunityList(sheetState.place.id,sheetState.bodies);return;}sheetState.planningRequested=true;renderSheet();};
  el('myPlacePlanning').addEventListener('toggle',()=>{if(!sheetOwnerMatches())return;if(el('myPlacePlanning').open)renderSheet();else{sheetToken++;sheetState.planningRequested=false;}});
  el('myRecordPickTarget').onclick = () => {
    if (!sheetOwnerMatches()) { sheet.close(); return; }
    AstroTargetPicker.open(el('myRecordTarget'),null,el('myRecordPickTarget'),{multiple:true,selected:sheetState.draftTargets,getTargets:targetChoices,drafts:sheetState.targetDrafts||[],onDone:(targets,drafts)=>{
      if(!sheetOwnerMatches())return;sheetState.draftTargets=targets.map(targetData);sheetState.targetDrafts=drafts;el('myRecordSaved').hidden=true;renderSheet();
    }});
  };

}
const sheetOwnerMatches = () => !!auth?.token && sheetState?.ownerToken === auth.token;
function openPlace(place, ctx, targetKey = null, options = {}) {
  if (!sheet) buildSheet();
  sheet.dataset.planningOnly=String(!!options.planningOnly);
  place=place||{id:null,name:'',latitude:null,longitude:null};
  const current = ctx === 'sky' ? skySession?.target?.id : aim.target?.id;
  const initialTargets=savedTargets(place.id),initialShape=shapeFor(place);
  sheetState = {planningOnly:!!options.planningOnly,initialName:(place.name||'').trim(),targetDrafts:[],initialShape,draftShape:initialShape,shapeBaseline:shapeKey(initialShape),initialTargets,baseline:targetSetKey(initialTargets),draftTargets:initialTargets.map(t=>({...t})),place:{...place,name:place.id?place.name:''},ctx, ownerToken: auth?.token, bodies:ctx==='records'?(recordSavedBodies(place)||[aim.body]):[ctx === 'sky' ? (skySession?.body || 'sun') : aim.body], planningRequested:false };
  if(el('myRecordBodies'))el('myRecordBodies').open=false;
  el('myPlaceTitle').textContent = initialTargets.length?'記録を編集':'記録を追加';
  el('myRecordLocationConfirm').hidden=true;
  el('myPlaceName').textContent = place.name||'撮影地点を選ぶ';el('myPlaceName').classList.toggle('is-empty',!place.id);
  for(const check of sheet.querySelectorAll('[data-planning-body]'))check.checked=sheetState.bodies.includes(check.value);
  el('myPlaceSub').textContent = [place.subtitle, finite(place.latitude)&&finite(place.longitude)?`${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}`:'', finite(place.elevation) ? `標高 ${place.elevation}m` : '標高不明', recordHeightText(place) ].filter(Boolean).join(' ・ ');
  const choices = targetChoices(), select = el('myRecordTarget');
  select.replaceChildren(new Option('対象を選ぶ', ''), ...choices.map((t) => new Option(t.name, t.id)));
  const want = targetKey || (ctx === 'records' ? null : current);
  if (want) select.value = choices.some((t) => t.id === want) ? want : '';
  el('myRecordError').hidden=true;el('myRecordReuse').hidden=true;el('myRecordSaved').hidden=true;el('myTargetPicker').hidden=true;el('myRecordAdd').hidden=true;
  for(const id of ['myPlacePlanning','myPlaceDetails'])el(id).open=false;
  if(want&&resolveTarget(want))addDraftTarget(resolveTarget(want));else renderSheet();
  if (!sheet.open) showSheet(sheet);
}
function renderSheet() {
  renderRecordBodyPreferences();
  recordAlignmentInit();applyRecordAlignments();renderRecordHeight();
  const { place, ctx } = sheetState, token = ++sheetToken, list = load();
  el('myPlanningPlace').hidden=!sheetState.planningOnly;if(sheetState.planningOnly){el('myPlaceTitle').textContent='次に重なる日';el('myPlanningPlace').textContent=place.name+' ・ 地上から '+(place.eyeHeightAGL??1.5)+'m';}
  el('myPlaceSub').textContent=[place.subtitle,finite(place.latitude)&&finite(place.longitude)?`${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}`:'',finite(place.elevation)?`標高 ${place.elevation}m`:'標高不明',recordHeightText(place)].filter(Boolean).join(' ・ ');
  const recs=el('myPlaceRecords');recs.replaceChildren();
  ensureRecordLocation();
  el('myNewPlaceNameLabel').hidden=!draftPoint();el('myPlaceName').hidden=false;el('myNewPlaceName').value=place.name||'';
  el('myPlaceName').textContent=draftPoint()?(sheetState.locationLabel||recordCoordinates(place)):'撮影地点を選ぶ';
  el('myPlaceName').setAttribute('aria-label',draftPoint()?'撮影地点：'+el('myPlaceName').textContent+'、地図で変更':'撮影地点を選ぶ');el('myPlaceName').classList.toggle('is-empty',!draftPoint());
  el('myShapeEdit').hidden=!draftPoint();el('myShapeEdit').disabled=false;el('myShapeEdit').textContent=shapeName(sheetState.draftShape)+' ・ 地図で編集';el('myShapeSummary').textContent=sheetState.draftShape?sheetState.draftShape.vertices.length+'点をつないだ'+shapeName(sheetState.draftShape):'';
  if(!sheetState.draftTargets.length){const p=document.createElement('p');p.className='tiny';p.textContent=draftPoint()?'ここから見える対象を追加できます。複数選べます。':'撮影地点を選び、そこから見える対象を追加します。';recs.append(p);}
  for(const t of sheetState.draftTargets){
    const row=document.createElement('div');row.className='fav-row my-draft-target';const text=document.createElement('div');text.className='my-record';const name=document.createElement('strong');name.textContent=t.name;text.append(name);
    const stamps=list.filter(r=>r.placeId===place.id&&r.target.key===t.key&&!r.removed&&r.createdAt>0).map(r=>r.createdAt);
    const sub=document.createElement('span');sub.className='tiny sub-line';sub.textContent=stamps.length?'登録日 '+new Date(Math.min(...stamps)+32400000).toISOString().slice(0,10).replaceAll('-','/'):'未保存';text.append(sub);
    const remove=document.createElement('button');remove.type='button';remove.className='chip';remove.textContent='外す';remove.setAttribute('aria-label',t.name+'を対象から外す');remove.onclick=()=>{if(!sheetOwnerMatches())return;sheetState.draftTargets=sheetState.draftTargets.filter(x=>x.key!==t.key);el('myRecordSaved').hidden=true;renderSheet();};row.append(text,remove);appendRecordAlignment(row,t);recs.append(row);
  }
  el('myRecordSave').disabled=!draftPoint()||!!sheetState.locationPending||!draftChanged()||!!sheetState.heightLoading||!applyRecordHeightDraft()||!applyRecordAlignments();el('myRecordPickTarget').disabled=!draftPoint();el('myPlacePlanning').hidden=!place.id||draftChanged();el('myPlaceDetails').hidden=!place.id;if(!draftChanged())el('myRecordLocationConfirm').hidden=true;
  const next = el('myPlaceNext'); next.replaceChildren();
  if(!el('myPlacePlanning').open)return;
  const seen = targetsSeenFrom(place.id).filter((r) => r.result !== 'hidden');
  const pairs=planningPairs(seen,sheetState.bodies);
  el('myPlaceFind').disabled=!pairs.length;el('myPlaceFind').hidden=false;el('myPlaceBodies').closest('fieldset').hidden=false;el('myPlaceNext').previousElementSibling.hidden=false;if(ctx==='records'){el('myPlaceFind').disabled=!pairs.length||draftChanged()||!place.id;el('myPlaceFind').textContent=draftChanged()?'保存後に確認':'重なる日';next.hidden=true;next.previousElementSibling.hidden=true;return;}el('myPlaceFind').textContent='次に重なる日を探す';next.hidden=false;
  if (!seen.length || !pairs.length || !sheetState.planningRequested) {
    const p=document.createElement('p');p.className='tiny';
    p.textContent=!seen.length?'見えた対象を追加すると、次に重なる日を探せます。':!sheetState.bodies.length?'調べたい天体を選んでください。':!pairs.length?'選んだ天体と対象は、現在の権限では構図に使えません。':'この場所から見えた対象ごとに、選んだ天体が重なる日を調べます。';
    next.append(p);return;
  }
  if(sheetState.initialShape){renderShapeDates(next,pairs,token);return;}
  let pending=Promise.resolve();
  for (const {record:r,body} of pairs) {
    const t = resolveTarget(r.target.key);
    const b = document.createElement('button'); b.type = 'button'; b.className = 'list-item my-place-row';
    const strong = document.createElement('strong'); strong.textContent = `${r.target.name} × ${AstroNotesBodies.definition(body).name}`;
    const sub = document.createElement('span'); sub.className = 'tiny sub-line'; b.append(strong, sub); next.append(b);
    if (!t) { sub.textContent = 'この対象はいまの権限・一覧では使えません'; b.disabled = true; continue; }
    b.disabled = true;sub.textContent = '計算しています…';
    pending=pending.then(()=>{
      if(token!==sheetToken || !sheet.open || !sheetOwnerMatches())return;
      return nextFor(place, t, body, matchOpts(t)).then((row) => {
      if (token !== sheetToken || !sheet.open || !sheetOwnerMatches()) return;
      sub.textContent = row ? `${dayText(row.at)} ${sideName(body, row.side)} ${S.JstCal.hhmm(row.at)}` : '400日以内には重なりません';
      b.disabled = !row || (ctx === 'records' && !screenAllowed('framing'));
      if (ctx === 'records' && !screenAllowed('framing')) sub.textContent += '（構図の利用権限が必要です）';
      if(row)appendCandidateMoon(sub,body,row.at,place);
      b.onclick = () => {
        if(token!==sheetToken || !sheet.open || !sheetOwnerMatches() || !planningPairs([r],[body]).length)return;
        const current=statusOf(place.id,r.target.key);if(!current || current.id!==r.id || current.result==='hidden'){renderSheet();return;}
        if (ctx !== 'records') sheet.close();openWith(place, t, {...row,body}, ctx);
      };
      }).catch(() => { if (token === sheetToken) sub.textContent = '計算できませんでした。もう一度探してください'; });
    });
  }
}
// A shape is searched spatially for each day. Keep matched coordinates, not its saved anchor.
function renderShapeDates(host,pairs,token){
 const state=sheetState,place=withShape(state.place),shape=place.shape;if(!shape)return;
 state.shapePages||=new Map();let queue=Promise.resolve();
 for(const {record,body}of pairs){
  const target=resolveTarget(record.target.key),opts=matchOpts(target);
  const key=JSON.stringify([auth?.loginId,place,record,target,body,opts,AstroNotesAtmosphere.dataKey()]);
  let page=state.shapePages.get(key);if(!page){const now=Date.now();page={origin:now,cursor:now,end:S.Cal.startOfDay(now)+400*DAY,rows:[],partial:null,cache:{},unconfirmed:[]};state.shapePages.set(key,page);}
  page.run=(page.run||0)+1;const run=page.run;page.loading=false;
  const current=()=>sheetState===state&&sheetOwnerMatches()&&sheet.open&&token===sheetToken&&page.run===run&&state.planningRequested&&planningPairs([record],[body]).length&&statusOf(place.id,record.target.key)?.id===record.id&&shapeKey(shapeFor(place))===shapeKey(shape);
  const section=document.createElement('section');section.className='shape-next-group';const heading=document.createElement('h3');heading.className='my-title';heading.textContent=record.target.name+' × '+AstroNotesBodies.definition(body).name;
  const results=document.createElement('div'),status=document.createElement('p');status.className='tiny';status.setAttribute('role','status');const more=document.createElement('button');more.type='button';more.className='chip';const skip=document.createElement('button');skip.type='button';skip.className='chip';section.append(heading,results,status,more,skip);host.append(section);
  function draw(){
   if(!current())return;results.replaceChildren();
   for(const row of page.rows){
    const b=document.createElement('button');b.type='button';b.className='list-item my-place-row';b.dataset.shapeCandidate='';b.dataset.latitude=row.place.latitude;b.dataset.longitude=row.place.longitude;b.dataset.at=row.event.at;
    const title=document.createElement('strong');title.textContent=dayText(row.event.at)+' '+S.JstCal.hhmm(row.event.at);appendCandidateMoon(title,body,row.event.at,row.place);
    const sub=document.createElement('span');sub.className='tiny sub-line';sub.textContent=(shape.type==='line'?'線上':'範囲内')+' '+row.place.latitude.toFixed(5)+', '+row.place.longitude.toFixed(5)+' ・ 地図で確認';b.append(title,sub);
    b.onclick=()=>{if(!current()||!AstroNotesShooting.shapeContains(shape,row.place))return;const point={...row.place,id:'shape-candidate:'+place.id+':'+row.place.latitude+','+row.place.longitude};delete point.shape;openWith(point,target,{...row.event,body,shapeType:shape.type},state.ctx);};results.append(b);
   }
   const last=page.cursor>page.origin?new Date(page.cursor-1+9*3600000).toISOString().slice(0,10).replaceAll('-','/'):'';
   status.textContent=!target?'この対象は構図に使えません。':page.loading?'線上・範囲内を計算しています…':page.partial==='elevation'?'標高を取得できず、確認できていない位置があります。':page.partial==='invalid'?'線・範囲を編集して形を確認してください。':page.partial==='limit'?'広いため調べ切れていません。線・範囲を小さく分けて再試行してください。':page.partial?'候補を確認できませんでした。再試行してください。':(last?last+(page.unconfirmed.length?'まで探索（未確認日あり）。':'まで探索済み。'):'')+(!page.rows.length?'探索済みの期間では候補が見つかっていません。':'候補を押すと地図で位置を確認できます。');
   more.disabled=page.loading||!target||page.partial==='invalid';skip.hidden=!target||page.loading||!page.partial||page.partial==='invalid';skip.textContent='この日を未確認のまま次の日から探す';more.hidden=page.cursor>=aimCandidateSearchEnd();more.textContent=page.loading?'計算中…':page.partial?'再試行':'さらに先の候補を探す';
  }
  async function search(){
   if(!current()||page.loading||!target)return;page.loading=true;page.partial=null;if(page.cursor>=page.end)page.end=aimCandidatePageEnd(page.cursor);draw();
   try{
    const result=await AstroNotesShapePlanner.search({target,body,...opts}, {place,record},{from:page.cursor,end:page.end,limit:4,cache:page.cache,isCurrent:current,align:AstroNotesAlign,isMountain:aimIsMountain,observerAt:(f,g)=>aimObserverAt(aimSavedFrom(f),g),elevationAt:candidateElevation,viewFor:(obs,p)=>aimShootingView(obs,p.target,p.body,p.partId,p.matchMode),ensure:b=>AstroNotesBodies.ensure(b),onProgress:p=>{if(current())status.textContent='線上・範囲内を確認中… '+dayText(p.day)+' ・ '+p.checked+'位置';}});
    if(!current()||result.cancelled)return;
    for(const row of result.rows){const i=page.rows.findIndex(r=>S.Cal.startOfDay(r.event.at)===S.Cal.startOfDay(row.event.at));if(i<0)page.rows.push(row);else if(row.event.at<page.rows[i].event.at)page.rows[i]=row;}page.rows.sort((a,b)=>a.event.at-b.event.at);
    page.cursor=result.searchedUntil;page.partial=result.partial;
   }catch{if(current())page.partial='calculation';}
   finally{if(current()){page.loading=false;page.started=true;draw();}}
  }
  skip.onclick=()=>{if(!current()||page.loading||!page.partial)return;page.unconfirmed.push(S.Cal.startOfDay(page.cursor));page.cursor=S.Cal.startOfDay(page.cursor)+DAY;page.partial=null;draw();queue=queue.catch(()=>{}).then(search);};more.onclick=()=>{queue=queue.catch(()=>{}).then(search);};draw();if(!page.started)queue=queue.catch(()=>{}).then(search);
 }
}
// 次に重なる日を押したら、その目標・日・地点で開く（構図ならその日の見え方、地図ならその時刻）
function openWith(place, t, row, ctx) {
  if(row?.body && !planningPairs([{result:'seen',target:{key:t.id}}],[row.body]).length)return;
  if (ctx === 'records') { void openFromRecords(place, t, row); return; }
  if (ctx === 'sky') {
    if(row?.body){el('skyMapBody').value=row.body;el('skyMapBody').dispatchEvent(new Event('change',{bubbles:true}));}
    SkyMapUI?.setTarget?.(t.id);
    if(row?.matchMode)SkyMapUI?.setAlignment?.(row.partId??null,'center',row.matchMode);
    openInSky(place, row);
    return;
  }
  if(row?.body){aim.body=row.body;el('aimBody').value=row.body;}
  aimFillSelects();
  if (el('aimTarget').value !== t.id) { el('aimTarget').value = t.id; aim.partId = null; aim.partsTargetKey = null; el('aimPart').value = ''; }
  adoptOverlap(row);
  aimSetFrom(AstroNotesShooting.savedObserver(place), { keepMap: true });
  if (row) { aim.candPick = null; aim.spot = null; aim.wantSpot = null; aim.wantKey = null; aim.candSide = row.side; el('aimDate').value = new Date(S.Cal.startOfDay(row.at) + 9 * 3600000).toISOString().slice(0, 10); aim.plannerTransfer={at:row.at,body:aim.body,latitude:place.latitude,longitude:place.longitude,day:AstroNotesShooting.day(row.at)}; }
  aimApply();
}
// 新規の地点・形・対象は、最後の保存までお気に入りに追加しない。
function commitRecordDraft(current,isNew){
 const s=sheetState,err=el('myRecordError');
 try{
  const plan=prepareHeightRecord({owner:auth.loginId,favorites,observations:load(),shapes:shapeData(),place:current,isNew,initialTargets:s.initialTargets,targets:s.draftTargets,shape:s.draftShape,drafts:s.targetDrafts||[],cleanShape:AstroNotesShooting.cleanShape});
  AstroNotesLibrary.transaction(localStorage,plan.entries);favorites=plan.favorites;if(typeof RecordSync!=='undefined')RecordSync.kick();
  for(const id of plan.changedFavorites)accountSync().queuePush('fav',id);
  s.place={...placeOf(current.id)};s.initialName=s.place.name;s.newPlace=false;s.targetDrafts=[];s.initialShape=s.draftShape;s.shapeBaseline=shapeKey(s.initialShape);s.initialTargets=s.draftTargets.map(targetData);s.baseline=targetSetKey(s.initialTargets);
  version++;candidateCache.clear();changed();aimFillSelects();SkyMapUI?.refreshTargets?.();
  err.hidden=true;sheet.close();return true;
 }catch(e){err.textContent=e.message||'保存できませんでした。入力は残しています';err.hidden=false;return false;}
}
function saveNewRecord(){
 if(!sheetOwnerMatches()||!draftPoint())return false;
 const s=sheetState,err=el('myRecordError'),fail=text=>{err.textContent=text;err.hidden=false;return false;};
 if(s.locationPending)return fail('地点名を確認しています。少し待ってから保存してください');
 const name=recordPlaceName(s);
 if(s.draftShape&&!AstroNotesShooting.cleanShape(s.draftShape))return fail('線・範囲を確認してください');
 const existing=placeNear(s.place);
 if(existing){
  const reuse=el('myRecordReuse');reuse.hidden=false;reuse.onclick=()=>{
   if(!sheetOwnerMatches()||sheetState!==s)return;
   const current=placeOf(existing.id);if(!current||!placeNear(s.place)||placeNear(s.place).id!==current.id)return fail('登録済みの地点が変更されました。開き直してください');
   const targets=s.draftTargets.map(t=>({...t})),shape=s.draftShape,drafts=s.targetDrafts||[];
   openPlace(current,s.ctx);sheetState.targetDrafts=drafts;sheetState.draftTargets=[...new Map([...sheetState.draftTargets,...targets].map(t=>[t.key,t])).values()];if(shape)sheetState.draftShape=shape;renderSheet();
  };
  return fail('同じ場所「'+existing.name+'」が登録されています。入力した形と対象を引き継いで編集できます');
 }
 el('myRecordReuse').hidden=true;
 const current={...s.place,id:'map:'+s.place.latitude.toFixed(5)+','+s.place.longitude.toFixed(5),name,locationScope:'point',terrain:null,phenomena:[],note:''};
 return commitRecordDraft(current,true);
}
function saveRecord() {
  if(!sheetOwnerMatches()){sheet?.close();return false;}
  const s=sheetState,err=el('myRecordError'),current=placeOf(s.place.id);if(s.ctx==='records'&&s.heightLoading){err.textContent='標高を取得しています。完了を待つか、値を入力してください';err.hidden=false;return false;}if(!applyRecordHeightDraft(true)||!applyRecordAlignments()){err.textContent='高さや重ね方を確認してください';err.hidden=false;return false;}
  if(!s.place.id)return saveNewRecord();
  const fail=text=>{err.textContent=text;err.hidden=false;return false;};
  if(!current)return fail('この撮影地点は登録から外されています');
  if(s.ctx==='records'?(RecordHeight.key(current)!==s.heightBaseline||RecordAlignment.key(current)!==s.alignmentBaseline||recordBodyKey(current)!==s.bodyBaseline):(current.latitude!==s.place.latitude||current.longitude!==s.place.longitude||(current.eyeHeightAGL??1.5)!==(s.place.eyeHeightAGL??1.5)))return fail('地点が変更されました。開き直してください');
  if(targetSetKey(savedTargets(s.place.id))!==s.baseline)return fail('別の画面で対象が変更されました。開き直してください');
  if(shapeKey(shapeFor(current))!==s.shapeBaseline)return fail('別の画面で場所の形が変わりました。開き直してください');
  if(s.locationPending)return fail('地点名を確認しています。少し待ってから保存してください');
 const name=recordPlaceName(s);
  const renamed=name!==s.initialName;
  if(renamed&&current.name!==s.initialName)return fail('別の画面で場所の名前が変更されました。開き直してください');
  return commitRecordDraft(s.ctx==='records'?{...current,...s.place,name}:renamed?{...current,name}:current,false);
}

// 観測地点（または地図の観測地点）から記録する。撮影ポイントでなければ、まず ☆ と同じ画面で登録する
function recordFor(point, targetKey, ctx) {
  const requestOwner=auth?.token,requestState=sheetState;
  if (!point || !requireLoginForFavorites()) return;
  const exact = placeNear(point);
  if (exact) { openPlace(exact, ctx, targetKey); return; }
  const near = placeNear(point, MERGE_KM);
  if (near && confirm(`近くの撮影地点「${near.name}」（${Math.round(AstroNotesTerrain.distanceKm(near.latitude, near.longitude, point.latitude, point.longitude) * 1000)}m）に記録しますか？\nキャンセルすると、この位置を新しい撮影地点として登録します。`)) { openPlace(near, ctx, targetKey); return; }
  openPlace({...point,id:null},ctx,targetKey);sheetState.newPlace=true;renderSheet();
}

function quickRecord(observer,target){
 if(!auth?.token||!toolAllowed('records'))return {ok:false,error:'撮影地点を保存するには、記録を利用できるアカウントでログインしてください'};
 const owner={token:auth.token,loginId:auth.loginId,generation:accessState.generation};
 try{
  const plan=prepareAlignedQuickRecord({owner:auth.loginId,favorites,observations:load(),shapes:shapeData(),observer,target,knownTargets:[...AstroNotesAlign.TARGETS.map(aimWithHeights),...aimFavTargets().map(aimFavTarget)],currentTargets:savedTargets,cleanShape:AstroNotesShooting.cleanShape});
  if(owner.token!==auth?.token||owner.loginId!==auth?.loginId||owner.generation!==accessState.generation||!toolAllowed('records'))throw Error('アカウントまたは利用権限が変わりました。開き直してください');
  if(!plan.already){AstroNotesLibrary.transaction(localStorage,plan.entries);favorites=plan.favorites;if(typeof RecordSync!=='undefined')RecordSync.kick();for(const id of plan.changedFavorites)accountSync().queuePush('fav',id);version++;candidateCache.clear();changed();aimFillSelects();SkyMapUI?.refreshTargets?.();}
  return {ok:true,already:plan.already,placeId:plan.place.id};
 }catch(e){return {ok:false,error:e.message||'撮影地点を保存できませんでした'};}
}
function changed() {
 document.dispatchEvent(new Event('astronotes-records-change'));
  renderRecordsHub();
  skyKey = '';
  if (!el('aimView')?.hidden) renderAim();
  if (skySession && !el('skyMapView')?.hidden) { skyRender(skySession); SkyMapUI?.redraw?.(); }
}
// 別タブで記録した・同期でお気に入りが替わった
window.addEventListener('storage', (e) => { if (e.key === key() || e.key===shapesKey() || e.key === 'sorami.favorites') { version++; changed(); } });
// 同期で別の端末の記録・線や範囲が届いた（2026-10-21）
window.addEventListener('sorami:records-synced', () => { version++; changed(); });

const style = document.createElement('style');
style.textContent = `
#myRecordsHub .notebook-edit-head{flex-wrap:nowrap;min-height:44px;margin-bottom:12px}#notebookCount{font-size:15px;min-width:0;overflow-wrap:anywhere}#myRecordsHub .notebook-edit-head #notebookEdit{margin-left:auto;min-height:44px;flex:none}#myRecordsHub .notebook-edit-filters{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));margin-bottom:12px}#myRecordsHub .notebook-edit-filters select{width:100%;min-height:44px}#myRecordsHub .notebook-select-tools{display:flex;justify-content:space-between;gap:12px;align-items:center;border-bottom:1px solid var(--line);min-height:48px}#myRecordsHub .notebook-select-tools button{display:inline-flex;align-items:center;gap:12px;min-height:44px;padding:0;background:transparent}#myRecordsHub .notebook-select-tools #notebookSelectNone{font-size:13px;color:var(--accent)}#myRecordsHub .notebook-check{display:block;flex:none;color:var(--secondary)}#myRecordsHub [aria-checked=true]>.notebook-check,#myRecordsHub [aria-checked=mixed]>.notebook-check{color:var(--accent)}#myRecordsHub [data-notebook-place][role=checkbox]{display:grid;grid-template-columns:24px minmax(0,1fr);column-gap:12px;align-items:center;padding:14px 0;min-height:72px;scroll-margin-block:12px 110px}#myRecordsHub [data-notebook-place][role=checkbox]>.notebook-check{grid-column:1;grid-row:1/3}#myRecordsHub [data-notebook-place][role=checkbox]>strong,#myRecordsHub [data-notebook-place][role=checkbox]>.sub-line{grid-column:2;min-width:0}#myRecordsHub .notebook-bulk{position:sticky;bottom:0;z-index:2;display:flex;gap:12px;align-items:center;padding:12px 0 max(12px,env(safe-area-inset-bottom));margin:0;background:var(--card);border-top:1px solid var(--line)}#myRecordsHub .notebook-bulk button{flex:1;min-width:0;min-height:44px}@media(max-width:360px){#myRecordsHub .notebook-edit-filters{grid-template-columns:1fr}}

.alignment-heading{font-size:14px;color:var(--secondary);margin:8px 0 12px}.alignment-controls>.fav-in{display:block;width:100%;margin:10px 0}.alignment-controls .aim-limb button,#aimAlignmentDetails .aim-limb button{min-height:58px;flex-direction:row;justify-content:center;gap:6px;font-size:13px}@media(max-width:360px){.alignment-controls .aim-limb button,#aimAlignmentDetails .aim-limb button{font-size:12px;gap:3px}.alignment-controls .aim-limb svg,#aimAlignmentDetails .aim-limb svg{width:23px;height:23px}}.shooting-location-actions{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 14px}.shooting-location-actions .sky-map-link{margin:0}.shooting-alignment{display:flex;gap:8px;flex-wrap:wrap}.shooting-alignment select{min-width:0;flex:1;min-height:44px;font-size:16px}.shooting-overlap{padding:8px;border-radius:8px}.shooting-overlap-on{background:var(--accent);color:var(--on-accent,#fff);font-weight:bold}#aimView .preview-workspace{display:block}#aimView .preview-tabs{display:none}
/* Shooting-point details scroll only vertically, including native iOS date fields. */
#myShapeSheet [data-shape-mode][aria-pressed=true]{background:var(--accent);color:var(--bg);font-weight:700}#myShapeSheet{overflow:hidden;min-width:0}#myShapeSheet .sheet-body{overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain}#myShapeSheet .my-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}#myShapeSheet canvas{display:block;width:100%;height:320px;touch-action:none}#myShapeSheet .mapwrap{position:relative;overflow:hidden;border-radius:12px}#myShapeSheet select{flex:1;min-width:100px;width:0}#myShapeSheet button{min-height:44px}#myShapeSheet .shape-fixed-pin{position:absolute;left:50%;top:50%;transform:translate(-50%,-100%);pointer-events:none;filter:drop-shadow(0 1px 2px #0008)}#myShapeSheet .shape-fixed-pin[hidden]{display:none}#myShapeSheet .shape-options{margin:12px 0}#myShapeSheet .shape-options summary,#shapeSavedMenu>summary{min-height:44px;display:flex;align-items:center;cursor:pointer;font-size:13px;color:var(--accent)}#shapeSavedMenu{margin-top:6px}#myShapeSheet #shapeSavedMenu>summary{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:44px;padding:0 12px;border:1px solid var(--line);border-radius:10px;background:var(--sunk);color:var(--text);font-size:13px;font-weight:700;list-style:none}#shapeSavedMenu>summary::-webkit-details-marker{display:none}#shapeSavedMenu>summary>span{min-width:0;white-space:nowrap}#shapeSavedMenu>summary>svg{flex:none}#shapeSavedMenu[open]>summary>svg{transform:rotate(180deg)}#myShapeSheet #shapeSavedMenu>.my-actions{margin-top:8px}#myShapeSheet .shape-options .my-actions{margin-top:6px}#myShapeSheet #shapeHelp{margin:8px 0}#myShapeSheet #shapeApply{margin-top:8px}#myShapeSheet #shapeVertexTools[hidden]{display:none}#shapeLocationPanel [data-shape-source][aria-pressed=true]{background:var(--accent);color:var(--on-accent,#142332)}#myShapeSheet .mapzoom{position:absolute;right:8px;top:auto;bottom:8px;display:flex;flex-direction:column;gap:5px}#myShapeSheet .mapzoom button{width:44px;background:var(--card);color:var(--text)}#shapeSavedLocations .chip{max-width:100%;white-space:normal;overflow-wrap:anywhere}#shapeLocationPanel .my-actions input{flex:1;min-width:0;width:0;font-size:16px}#myShapeSheet #shapeApply{width:100%}#myNewPlaceNameLabel{display:block;min-width:0;grid-column:2}#myNewPlaceName{width:100%;font-size:16px}#myNewPlaceNameLabel[hidden],#myPlaceName[hidden]{display:none}
#myPlaceSheet{overflow:hidden;min-width:0}
#myPlaceSheet[open]{display:flex;flex-direction:column}
#myPlaceSheet .sheet-head{flex:none;min-width:0}
#myPlaceSheet .sheet-head strong{min-width:0;overflow-wrap:anywhere}
#myPlaceSheet .sheet-body{min-width:0;min-height:0;max-width:100%;overflow-x:hidden;overflow-y:auto;touch-action:pan-y;overscroll-behavior:contain}
#myPlaceSheet .my-form,#myPlaceSheet .fav-in{min-width:0;max-width:100%}
#myPlaceSheet input[type=date]{-webkit-appearance:none;appearance:none;display:block;min-height:44px}
#myPlaceSheet input[type=date]::-webkit-date-and-time-value{text-align:left}
#myPlaceSheet .my-actions{display:flex;flex-wrap:wrap;gap:6px}
.my-secondary{margin-top:12px;border-top:1px solid var(--line);padding-top:8px}.my-secondary>summary{min-height:36px;cursor:pointer;font-size:.81rem;color:var(--secondary)}
.my-places{margin:10px 0 4px;padding-top:8px;border-top:1px solid var(--line)}
.my-head{display:flex;align-items:center;gap:8px;justify-content:space-between;flex-wrap:wrap;margin:4px 0}
.my-status{margin:0;flex:1 1 180px}
#myRecordsHub .my-head .my-add-point{margin-left:auto;display:inline-flex;align-items:center;justify-content:center;flex:none;width:44px;min-width:44px;min-height:44px;padding:0;cursor:pointer}
.my-title{font-size:.95rem;margin:10px 0 4px}
.my-title .tiny{margin-left:4px;font-weight:normal}
.my-list .my-place-row{display:block;width:100%;text-align:left}
.my-mark{display:inline-block;min-width:1.4em}
.my-mark.seen{color:#2f9e5b}.my-mark.partial{color:#c07a00}.my-mark.hidden{color:var(--tertiary)}
.my-result{display:flex;gap:6px;margin:4px 0 8px}
.my-result button{flex:1 1 0;min-height:44px}
.my-result button[aria-pressed="true"]{background:var(--accent);color:var(--on-accent,#fff)}
.my-form{margin-top:14px}
#myPlaceSheet .condition-label{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:600;color:var(--muted);line-height:22px;margin-bottom:6px}
#myPlaceSheet .my-input-field{display:grid;grid-template-columns:22px minmax(0,1fr);gap:10px;align-items:center}
#myPlaceSheet .my-input-field > .condition-label{margin:0}
#myPlaceSheet .my-input-field > .condition-label > span{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
#myPlaceSheet #myRecordTarget:has(option:checked[value=""]){color:var(--tertiary)}
#myPlaceSheet #myRecordTarget option{color:var(--text)}
#myPlaceSheet .my-location-value{padding:14px 12px;border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--text);font-size:16px;overflow-wrap:anywhere;text-align:left;min-height:52px;width:100%;cursor:pointer}#myPlaceSheet #myRecordSave:disabled{opacity:.45;cursor:default}#myPlaceSheet .my-location-value.is-empty{color:var(--tertiary)}#myPlaceSheet .my-input-field{margin:12px 0}#myPlaceSheet .my-location-value:disabled{color:var(--tertiary);cursor:default}
#myPlaceSheet .my-record-editor{padding:14px 0;border-block:1px solid var(--line);margin:12px 0}#myPlaceSheet .my-record-editor[hidden]{display:none}#myPlaceSheet .my-target-record{padding:12px 0;border-bottom:1px solid var(--line)}#myPlaceSheet .my-target-record>summary{cursor:pointer;min-height:44px;padding:4px 0;list-style:none}#myPlaceSheet .my-target-record>summary::after{content:"記録を見る ▾";font-size:12px;color:var(--secondary)}#myPlaceSheet .my-target-record[open]>summary::after{content:"記録を閉じる ▴"}#myPlaceSheet .my-target-record .my-record{flex:1;min-width:0;overflow-wrap:anywhere}
#myPlaceSheet #myRecordTarget{min-height:52px;border-radius:12px;font-size:16px;margin:0}
.my-body-options{border:0;padding:0;margin:14px 0 8px;min-width:0}
#myPlaceBodies{display:flex;gap:6px;flex-wrap:wrap}
#myPlaceBodies label{display:flex;align-items:center;gap:6px;min-height:44px;padding:0 10px;border:1px solid var(--line);border-radius:10px;font-size:14px}
#myPlaceBodies label:has(:checked){border-color:var(--accent);background:var(--sunk)}
#myPlaceBodies input{accent-color:var(--accent);width:16px;height:16px;margin:0}
.my-form .fav-btn{margin-top:10px;width:100%}
.my-actions{margin:6px 0}
#myPlaceSheet .my-draft-target{align-items:center;gap:12px;padding:10px 0}#myPlaceSheet .my-draft-target .my-record{flex:1;min-width:0;overflow-wrap:anywhere}#myPlaceSheet .my-draft-target button{flex:none;min-width:60px;min-height:44px}
#myRecordsHub .my-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}#myRecordsHub .my-actions select{flex:1 1 130px;width:0;min-width:0}
.my-record{cursor:default}
.my-picker{margin-bottom:8px}
`;
style.textContent+="\n#recordOpportunities{max-width:780px;margin-inline:auto}\n.record-opportunity-controls{display:grid;gap:12px}\n.record-opportunity-period{display:grid;grid-template-columns:44px minmax(0,1fr) 44px 44px;gap:4px;align-items:center}\n.record-opportunity-period button{min-width:0;min-height:44px;padding:4px;font-size:14px}\n.record-opportunity-period button:is(#recordOpportunityPrev,#recordOpportunityNext){font-size:24px}\n.record-opportunity-date{position:relative;display:grid;place-items:center;min-width:0;height:44px;font-size:16px;font-weight:600;white-space:nowrap;border:1px solid var(--line);border-radius:10px;background:var(--card)}\n.record-opportunity-date input{position:absolute;inset:0;width:100%;height:44px;min-width:0;margin:0;opacity:0;font-size:16px;cursor:pointer}\n.record-opportunity-date:focus-within{outline:2px solid var(--accent);outline-offset:2px}\n.record-opportunity-filters{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px}\n.record-opportunity-filter{display:grid;gap:4px;min-width:0;font-size:12px;color:var(--secondary)}\n.record-opportunity-filters .record-opportunity-select{box-sizing:border-box;width:100%;min-width:0;min-height:44px;font-size:16px;margin:0;background-color:var(--card)}\n.record-opportunity-select{text-align:left;position:relative;padding:10px 30px 10px 12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text);border:1px solid var(--line);border-radius:10px}\n.record-opportunity-select::after{content:'';position:absolute;right:13px;top:17px;width:7px;height:7px;border-right:2px solid var(--secondary);border-bottom:2px solid var(--secondary);transform:rotate(45deg)}\n.record-opportunity-select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}\n.record-opportunity-picker{box-sizing:border-box;width:min(440px,calc(100vw - 28px));max-height:min(80dvh,640px);padding:16px;border:1px solid var(--line);border-radius:18px;background:var(--card);color:var(--text);overflow:hidden}\n.record-opportunity-picker[open]{display:flex;flex-direction:column;gap:12px}\n.record-opportunity-picker::backdrop{background:rgba(0,0,0,.6)}\n.record-opportunity-picker-head,.record-opportunity-picker-tools,.record-opportunity-picker-foot{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-shrink:0}\n.record-opportunity-picker h2{font-size:18px;margin:0}.record-opportunity-picker button{min-height:44px;font-size:14px}\n.record-opportunity-picker #recordOpportunityPickerSearch{box-sizing:border-box;width:100%;min-height:44px;font-size:16px;margin:0;flex-shrink:0}\n.record-opportunity-picker-tools{justify-content:flex-start}.record-opportunity-picker-tools button{flex:1}\n.record-opportunity-picker-list{overflow:auto;overscroll-behavior:contain;min-height:0;scroll-padding:6px}\n.record-opportunity-picker-item{display:flex;align-items:center;gap:12px;min-height:48px;padding:8px 4px;box-sizing:border-box;border-bottom:1px solid var(--line);overflow-wrap:anywhere;cursor:pointer}\n.record-opportunity-picker-item input{width:20px;height:20px;margin:0;flex-shrink:0;accent-color:var(--accent)}\n.record-opportunity-picker-foot #recordOpportunityPickerApply{min-width:96px;background:var(--accent);color:var(--accent-ink,var(--bg))}\n:is(#recordOpportunityStatus,#recordOpportunityNotice){margin:12px 0;color:var(--secondary)}:is(#recordOpportunityStatus,#recordOpportunityNotice):empty{display:none}\n#recordOpportunityList:not(:empty){margin-top:12px;border-top:1px solid var(--line)}\n.record-opportunity-day{margin:0;padding:12px 0 5px;font-size:14px;color:var(--secondary)}\n.record-opportunity-through{margin:10px 0 0;color:var(--secondary)}\n.record-opportunity-through:empty{display:none}\n#recordOpportunityMore{min-height:44px}\n.record-progress-count{margin-inline-start:6px;color:var(--secondary);font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}\n.record-opportunity-row{display:grid;grid-template-columns:52px minmax(0,1fr) 12px;grid-template-rows:auto auto;gap:2px 12px;align-items:center;width:100%;min-height:64px;padding:12px 0;border:0;border-bottom:1px solid var(--line);border-radius:0;text-align:left;background:transparent;color:var(--text)}\n.record-opportunity-time{grid-column:1;grid-row:1;align-self:end;font-size:16px;font-variant-numeric:tabular-nums;color:var(--accent)}\n.record-opportunity-body{grid-column:1;grid-row:2;align-self:start;font-size:12px;color:var(--secondary)}\n.record-opportunity-row strong{grid-column:2;grid-row:1/3;font-size:14px;line-height:1.6;overflow-wrap:anywhere}\n.record-opportunity-arrow{grid-column:3;grid-row:1/3;color:var(--secondary)}\n.record-opportunity-row.has-height strong{grid-row:1}.record-opportunity-height{grid-column:2;grid-row:2;font-size:12px;color:var(--secondary)}\n.record-opportunity-actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 0}.record-opportunity-actions:has(>button:not([hidden])){padding-bottom:4px}\n.record-opportunity-row:focus-visible{outline:2px solid var(--accent);outline-offset:2px}\n";style.textContent+="\n#myRecordHeight{min-width:0;border:0;border-block:1px solid var(--line);padding:14px 0;margin:14px 0}\n#myRecordHeight legend{float:left;width:100%;padding:0;margin:0 0 12px;font-size:14px;font-weight:600}\n#myRecordHeight legend+label{clear:both}\n.record-height-label{display:block;font-size:12px;color:var(--secondary);margin:10px 0 6px}\n.record-height-ground{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center}\n.record-height-number{display:flex;align-items:center;gap:8px;min-width:0;padding:0 12px;border:1px solid var(--line);border-radius:10px;background:var(--card)}\n#myRecordHeight input{box-sizing:border-box;min-width:0;width:100%;min-height:44px;margin:0;padding:8px 0;border:0;background:transparent;font-size:16px;color:var(--text)}\n.record-height-number>span{font-size:13px;color:var(--secondary)}\n.record-height-modes,.record-height-values{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;min-width:0}\n.record-height-modes{padding:3px;background:var(--sunk);border-radius:10px;margin-bottom:8px}\n#myRecordHeight button{min-height:44px;font-size:14px}\n.record-height-modes button{border:0;border-radius:8px;background:transparent;color:var(--secondary)}\n.record-height-modes button[aria-pressed=true]{background:var(--card);color:var(--accent);box-shadow:0 1px 4px #0002}\n.record-height-values>label{min-width:0}.record-height-values .tiny{display:block;margin:0 0 4px}\n#myHeightFixedFields{grid-template-columns:minmax(0,1fr);padding-top:20px}\n#myHeightFixedFields[hidden],#myHeightRangeFields[hidden],#myRecordHeight[hidden]{display:none!important}\n#myRecordHeight .warn{font-size:12px;margin:8px 0 0}\n";style.textContent+="\n.record-alignment-editor{flex-basis:100%;display:grid;grid-template-columns:minmax(0,1fr);gap:8px;padding:6px 0 2px;min-width:0}\n#myPlaceSheet .my-draft-target:has(.record-alignment-editor){flex-wrap:wrap}\n.record-alignment-position{display:grid;gap:4px;min-width:0;font-size:12px;color:var(--secondary)}\n.record-alignment-position select,.record-alignment-limbs select{box-sizing:border-box;width:100%;min-width:0;min-height:44px;margin:0;font-size:16px}\n.record-alignment-limbs{display:grid;grid-template-columns:minmax(0,1fr);gap:4px;min-width:0}\n.record-alignment-limbs[hidden]{display:none!important}\n#skyMapAlignmentControls{display:grid;gap:8px}\n#previewEyeHeightControls{margin:0 0 6px;padding:0;border:0;background:none;min-width:0}\n#previewEyeHeightControls[hidden]{display:none!important}\n.preview-eye-row{display:grid;grid-template-columns:minmax(0,1fr) 96px;column-gap:10px;align-items:end}\n.preview-eye-tools{min-width:0}.preview-eye-scale{display:block;font-size:11px;line-height:14px;color:var(--secondary);margin:0}\n.preview-eye-value,#aimLook .preview-focal-bar .preview-focal-value{display:flex;align-items:center;justify-content:flex-end;gap:2px;height:44px;min-width:0;font-size:15px;font-weight:600;font-variant-numeric:tabular-nums}\n#previewEyeValue,#aimLook .preview-focal-value [data-preview-focal-input]{box-sizing:border-box;width:0;flex:1;min-width:0;min-height:44px;padding:0;border:0;background:transparent;color:var(--text);text-align:right;font-size:15px;font-weight:600;appearance:textfield;border-radius:0}\n.preview-eye-value,#aimLook .preview-focal-bar .preview-focal-value{box-sizing:border-box;border:1px solid var(--line);border-radius:8px;background:var(--sunk);padding:0 6px;cursor:text}\n.preview-eye-value:focus-within,#aimLook .preview-focal-bar .preview-focal-value:focus-within{border-color:var(--accent);outline:2px solid color-mix(in srgb,var(--accent) 28%,transparent);outline-offset:1px}\n#previewEyeValue::-webkit-inner-spin-button,#previewEyeValue::-webkit-outer-spin-button{appearance:none;margin:0}\n.numeric-ruler-track{box-sizing:border-box;position:relative;min-width:0;height:46px;overflow:hidden;border:1px solid var(--line);border-radius:8px;background:var(--sunk)}\n.numeric-ruler-track .numeric-ruler{height:44px;width:100%;cursor:ew-resize;direction:ltr}\n.numeric-ruler-track .sky-map-timeline-center{top:4px;bottom:4px}.numeric-ruler-track .sky-timeline-label{top:20px}\n#previewEyeRuler .sky-timeline-tape{background-image:repeating-linear-gradient(to right,var(--line) 0 1px,transparent 1px calc(var(--timeline-unit)*5));background-size:calc(var(--timeline-unit)*5) 8px!important}\n#aimLook .preview-focal-tools{margin:0}\n#aimLook .aim-lens .preview-focal-bar{grid-template-columns:minmax(0,1fr) 96px;margin:0;column-gap:10px}\n#aimLook .preview-focal-scale{font-size:11px;line-height:14px}\n.preview-focal-tools .numeric-ruler-track{width:100%;height:46px}\n[data-focal-range][hidden]{display:none!important}\n#aimLook .preview-focal-bar .preview-focal-value{box-sizing:border-box;width:96px;min-width:96px;max-width:96px;height:44px;line-height:normal;padding-bottom:0;font-variant-numeric:tabular-nums}\n#previewEyeError{margin:4px 0 0;color:var(--secondary)}\n";style.textContent+="\n#myRecordsHub .my-head .record-transfer-more{display:grid;place-items:center;width:44px;min-width:44px;min-height:44px;padding:0;flex:none}\n.record-transfer-sheet{box-sizing:border-box;width:min(560px,calc(100vw - 24px));max-height:85dvh;border:1px solid var(--line);border-radius:16px;background:var(--card);color:var(--text);padding:0;overflow:auto}\n.record-transfer-sheet::backdrop{background:#0009}.record-transfer-sheet .sheet-head{position:sticky;top:0;z-index:1;background:var(--card);padding:12px 16px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line)}\n.record-transfer-sheet .sheet-head button{min-height:44px}.record-transfer-sheet .sheet-body{padding:12px 16px 16px;min-width:0}\n.record-transfer-sheet .transfer-menu-action{width:100%;min-height:52px;text-align:left;display:block;font-size:16px}\n.record-transfer-sheet .fav-btn{width:100%;min-height:44px;margin-top:12px}.record-transfer-sheet .transfer-select-tools{display:flex;gap:8px}.record-transfer-sheet .transfer-select-tools button{min-height:44px}\n.transfer-place-list{max-height:38dvh;overflow:auto;overscroll-behavior:contain;margin-top:8px}.transfer-place{display:flex;align-items:center;gap:12px;min-height:48px;padding:8px 0;border-bottom:1px solid var(--line);overflow-wrap:anywhere}.transfer-place input{width:20px;height:20px;margin:0;flex:none;accent-color:var(--accent)}\n.transfer-preview-place{display:grid;gap:4px;padding:12px 0;border-bottom:1px solid var(--line);overflow-wrap:anywhere}#myRecordBodies{margin:12px 0}#myRecordBodies>summary{min-height:44px;display:list-item;align-content:center;color:var(--text);font-size:14px}\n";style.textContent+="\n#myRecordsHub .my-actions select.record-sort-select,.record-sort-row select.record-sort-select{flex:0 0 auto;width:auto;min-width:96px;min-height:44px}\n.record-sort-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px}.record-sort-row input[type=search]{flex:1 1 160px;width:0;min-width:0}.record-sort-slot{display:contents}\n.record-sort-locate{min-height:44px}.record-sort-status{flex:1 0 100%;margin:0}\n";document.head.append(style);

const createServerOpportunityScan=function createServerOpportunityScan({api,start,end,bodies,placeIds,sourceRev,isCurrent,onStart=()=>{},onProgress=()=>{},onDay=()=>{},pollDelay=ms=>new Promise(r=>setTimeout(r,ms)),initialView=null}){
 const dayMs=86400000,date=at=>new Date(at+32400000).toISOString().slice(0,10),at=value=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))throw Error('invalid overlap day');const n=Date.parse(value+'T00:00:00+09:00');if(!Number.isFinite(n)||date(n)!==value)throw Error('invalid overlap day');return n;};
 const model='geometric-candidate-v1',state={model,day:start,end,through:start,rows:[],pending:[],failures:[],checked:0,total:0,done:false,running:false,cancelled:false,error:null,status:'preparing',viewId:null,nextCursor:null};
 let controller=new AbortController(),cursor=date(start),action='ensure',initial=initialView,generation=null,completedChecked=0;
 const seen=new Set(),settled=new Set();
 const current=()=>!state.cancelled&&!controller.signal.aborted&&isCurrent();
 const request=(method,path,body)=>api(method,path,body,controller.signal);
 function cancel(){state.cancelled=true;controller.abort();}
 async function assemble(response){
  if(!response?.transport)return response;
  const anchor=response,first=anchor.transport,invalid=()=>Error('計算結果の受信を確認できません。再試行してください。');
  if(typeof anchor.viewId!=='string'||typeof anchor.generation!=='string'||!['ready','partial'].includes(anchor.status)||!first||typeof first.id!=='string'||!/^([a-f0-9]{64})$/.test(first.id)||!Number.isInteger(first.count)||first.count<2||first.count>2048||first.index!==0)throw invalid();
  if(generation!==null&&generation!==anchor.generation)throw Object.assign(invalid(),{code:'overlap_stale'});
  const chunks=[],encoder=new TextEncoder();let bytes=0;
  for(let index=0;index<first.count;index++){
   if(!current())throw new DOMException('cancelled','AbortError');
   if(index)response=await request('GET','/overlaps?viewId='+encodeURIComponent(anchor.viewId)+'&cursor='+encodeURIComponent(cursor)+'&part='+index);
   if(!current())throw new DOMException('cancelled','AbortError');
   const part=response?.transport;
   if(response?.viewId!==anchor.viewId||response?.generation!==anchor.generation||response?.status!==anchor.status||!part||part.id!==first.id||part.index!==index||part.count!==first.count||part.nextPart!==(index+1<first.count?index+1:null)||typeof part.text!=='string')throw invalid();
   const size=encoder.encode(part.text).byteLength;bytes+=size;if(size>48*1024||bytes>64*1024*1024)throw invalid();chunks.push(part.text);
  }
  const raw=chunks.join(''),digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(raw)))].map(n=>n.toString(16).padStart(2,'0')).join('');
  if(!current())throw new DOMException('cancelled','AbortError');if(digest!==first.id)throw invalid();
  let page;try{page=JSON.parse(raw);}catch{throw invalid();}
  if(page?.transport||page?.viewId!==anchor.viewId||page?.generation!==anchor.generation||page?.status!==anchor.status)throw invalid();return page;
 }
 function ingest(response){
  if(!response||!['preparing','ready','partial','failed'].includes(response.status)||typeof response.viewId!=='string'||!Array.isArray(response.days)||response.days.length>7)throw Error('invalid overlap response');
  if(response.model!==model)throw Object.assign(Error('一覧の計算条件が更新されました。再試行してください。'),{code:'overlap_model_mismatch'});
  if(generation!==null&&generation!==response.generation)throw Object.assign(Error('結果の条件が変わりました。再試行してください。'),{code:'overlap_stale'});
  generation=response.generation;state.viewId=response.viewId;state.status=response.status;state.nextCursor=response.nextCursor??null;
  if(response.status==='failed')throw Object.assign(Error(response.error?.message||'計算の準備を完了できませんでした。再試行してください。'),{code:response.error?.code||'overlap_plan_failed'});
  let through=state.through;const accepted=[];
  for(const day of response.days){
   const stamp=at(day.day);if(stamp<start||stamp>=end||settled.has(day.day))continue;
   if(stamp!==through)throw Error('overlap days are not contiguous');
   // The API exposes only settled days. complete=false means unknown pairs,
   // not an unfinished day; keep these visible with an explicit warning.
   if(!Array.isArray(day.rows)||!Number.isFinite(day.unknownPairs)||!Number.isFinite(day.checkedPairs))throw Error('invalid overlap coverage');
   const rows=day.rows.map(row=>{if(!Number.isFinite(row.event?.at)||row.event.at<stamp||row.event.at>=stamp+dayMs||!row.place||!row.target||!bodies.includes(row.body)||(placeIds&&!placeIds.includes(row.sourcePlaceId)))throw Error('invalid overlap row');return {...row,id:row.id||JSON.stringify([row.pairId,row.event.at,row.place.latitude,row.place.longitude,row.place.groundManualM,row.place.eyeHeightAGL])};}).sort((a,b)=>a.event.at-b.event.at||String(a.place.name).localeCompare(String(b.place.name),'ja')||String(a.target.name).localeCompare(String(b.target.name),'ja'));
   accepted.push({day,stamp,rows});through=stamp+dayMs;
  }
  if(response.days.length){
   const boundary=at(response.coverage?.attemptedThroughExclusive);
   if(boundary!==through||response.nextCursor!==date(through))throw Error('invalid overlap cursor');
   // Validate the entire page before publishing any of its rows.
   for(const {day,stamp,rows}of accepted){for(const row of rows){if(seen.has(row.id))continue;seen.add(row.id);state.rows.push(row);}if(day.unknownPairs)state.failures.push({day:stamp,count:day.unknownPairs});settled.add(day.day);}
   completedChecked+=accepted.reduce((n,d)=>n+d.day.checkedPairs,0);state.checked=completedChecked;state.through=state.day=through;
   state.done=true;state.end=through;state.total=state.checked;onDay(state);
  }else{state.checked=completedChecked+(Number(response.coverage?.checkedPairs)||0);state.total=Math.max(state.checked,completedChecked+(Number(response.coverage?.totalPairs)||0));}
  onProgress(state);
 }
 async function advance(){
  if(state.running||state.done||!current())return state;
  state.running=true;state.error=null;
  try{
   onStart(state);
   while(current()){
    let response;
    if(initial){response=initial;initial=null;}
    else if(action==='ensure')response=await request('POST','/overlaps/ensure',{environment:'trial',startDay:date(start),bodies,placeIds,sourceRev});
    else if(action==='extend')response=await request('POST','/overlaps/extend',{viewId:state.viewId,cursor});
    else if(action==='retry')response=await request('POST','/overlaps/retry',{viewId:state.viewId});
    else response=await request('GET','/overlaps?viewId='+encodeURIComponent(state.viewId)+'&cursor='+encodeURIComponent(cursor));
    if(!current()){cancel();return state;}
    response=await assemble(response);if(!current()){cancel();return state;}
    ingest(response);action='poll';if(state.done)return state;
    // Cancellation releases the waiter immediately even if a custom clock is used.
    await new Promise(resolve=>{const finish=()=>{controller.signal.removeEventListener('abort',finish);resolve();};controller.signal.addEventListener('abort',finish,{once:true});Promise.resolve(pollDelay(Math.max(250,Math.min(10000,response.retryAfterMs||2000)))).then(finish,finish);});
   }
  }catch(error){if(!current()){cancel();return state;}state.error=error;state.done=true;state.status='error';}
  finally{state.running=false;}
  return state;
 }
 function extend(nextEnd){if(!state.done||state.running||state.error||state.cancelled||!state.nextCursor||nextEnd<=state.through)return false;cursor=state.nextCursor;state.end=nextEnd;end=nextEnd;state.done=false;action='extend';return true;}
 function retry(){if(state.running||state.cancelled)return false;state.rows=[];state.failures=[];state.checked=0;completedChecked=0;state.through=state.day=start;state.end=end=Math.max(end,start+7*dayMs);state.error=null;state.done=false;seen.clear();settled.clear();cursor=date(start);generation=null;action=state.viewId?'retry':'ensure';return true;}
 return {state,advance,extend,retry,cancel};
};
const geometricOpportunitySettings=function geometricOpportunitySettings(value={}){
 return {model:'geometric-candidate-v1',mode:'none',refractionCoefficient:0,effectiveEarthRadiusFactor:1,targetHeights:Object.fromEntries(Object.entries(value.targetHeights??{}).sort(([a],[b])=>a.localeCompare(b)).map(([key,height])=>[key,height]))};
};
const createServerOpportunityPreferences=function createServerOpportunityPreferences({api,getSession,getSettings,applySettings,sync,canUse=()=>true}){
 const state={enabled:null,prepare:false,settings:null,prefRev:null,sourceRev:null,error:null};
 const currentModel=value=>value?.model==='geometric-candidate-v1'&&value.mode==='none'&&value.refractionCoefficient===0&&value.effectiveEarthRadiusFactor===1&&Object.keys(value).every(k=>['model','mode','refractionCoefficient','effectiveEarthRadiusFactor','targetHeights'].includes(k));
 let owner=null,controller=null,flight=null,loaded=false,dirty=null,edit=0,epoch=0;
 const key=()=>JSON.stringify(getSession());
 function reset(){controller?.abort();controller=new AbortController();owner=key();flight=null;loaded=false;dirty=null;edit++;epoch++;Object.assign(state,{enabled:null,prepare:false,settings:null,prefRev:null,sourceRev:null,error:null});}
 function changed(){if(owner!==key())reset();const next=geometricOpportunitySettings(getSettings());if(state.settings&&JSON.stringify(next)===JSON.stringify(geometricOpportunitySettings(state.settings))&&!dirty)return false;dirty=next;edit++;return true;}
 async function prepare({refresh=false}={}){
  if(owner!==key())reset();if(!canUse())return state;if(flight)return flight;
  const ticket=owner,ticketEpoch=epoch,signal=controller.signal,current=()=>epoch===ticketEpoch&&owner===ticket&&key()===ticket&&!signal.aborted&&canUse();
  const call=(method,path,body)=>api(method,path,body,signal);
  flight=(async()=>{
   try{
    if(!loaded||refresh){const data=await call('GET','/overlap-preferences');if(!current())throw new DOMException('cancelled','AbortError');
     // The old API/test fixture omits enabled; only that explicit compatibility
     // response, or enabled=false, permits the on-device solver.
     if(!data||typeof data!=='object'||(state.enabled===true&&typeof data.enabled!=='boolean'))throw Error('サーバーの設定を確認できません。再試行してください。');
     Object.assign(state,{enabled:data.enabled===true,prepare:data.prepare===true,settings:data.settings??null,prefRev:data.prefRev??0,sourceRev:data.sourceRev??null});loaded=true;
     if((state.enabled||state.prepare)&&state.settings&&!dirty)applySettings(structuredClone(state.settings));
    }
    // During rollout the server may prepare results while the existing local
    // list remains active. Sync preferences without enabling remote reads.
    if(!state.enabled&&!state.prepare)return state;
    const migration=state.settings&&!currentModel(state.settings);
    if(!state.settings||dirty||migration){const value=dirty||geometricOpportunitySettings(state.settings||getSettings()),revision=edit;const data=await call('POST','/overlap-preferences',{environment:'trial',settings:value,expectedPrefRev:state.prefRev||0});if(!current())throw new DOMException('cancelled','AbortError');Object.assign(state,data);if(revision===edit){dirty=null;applySettings(structuredClone(state.settings));}else return await saveLatest();}
    if(!currentModel(state.settings))throw Error('一覧の計算条件を更新できません。再試行してください。');state.error=null;return state;
   }catch(error){if(current()){state.error=error;if(error.status===409){dirty=null;loaded=false;}}throw error;}
  })().finally(()=>{if(epoch===ticketEpoch&&owner===ticket)flight=null;});return flight;
  async function saveLatest(){while(dirty){const value=dirty,revision=edit;const data=await call('POST','/overlap-preferences',{environment:'trial',settings:value,expectedPrefRev:state.prefRev});if(!current())throw new DOMException('cancelled','AbortError');Object.assign(state,data);if(revision===edit){dirty=null;applySettings(structuredClone(state.settings));}}if(!currentModel(state.settings))throw Error('一覧の計算条件を更新できません。再試行してください。');state.error=null;return state;}
 }
 async function ready(){await prepare();if(!state.enabled)return state;const ticket=key();await sync();if(ticket!==key()||!canUse())throw new DOMException('cancelled','AbortError');return prepare({refresh:true});}
 function cancel(){reset();}
 return {state,prepare,ready,changed,cancel};
};
const createRecordHeightCandidates=function createRecordHeightCandidates(deps){
 const {shooting,align,bodies,atmosphere,astro,terrain=null,scanHeights,rangeOf,isMountain,observerAt,elevationAt,ensure,viewFor=null,mountainRidge=null,summitCapM=300,yieldTask=()=>new Promise(r=>setTimeout(r,0)),clock=()=>Date.now(),limits={}}=deps;
 const LIM={heights:48,positions:12000,shapeMs:45000,views:64,evaluations:512,regions:512,states:40000,coarseMs:600000,leafMs:20000,mergeMs:1800000,pointMs:15000,...limits};
 const DAY=86400000,RAD=Math.PI/180,DEG=180/Math.PI,MOON_KM=300000,EARTH_KM=6371.0088;
 const lru=n=>{const m=new Map();return {get(k){if(!m.has(k))return undefined;const v=m.get(k);m.delete(k);m.set(k,v);return v;},set(k,v){m.delete(k);m.set(k,v);while(m.size>n)m.delete(m.keys().next().value);return v;},delete(k){m.delete(k);},get size(){return m.size;}};};
 const views=lru(LIM.views),evals=lru(LIM.evaluations),regions=lru(LIM.regions),states=lru(LIM.states);
 const stats={realEvaluations:0,verifications:0,certificates:0,geometryBuilds:0,leafTests:0,bodyStates:0};
 const unit=(az,alt)=>{const a=az*RAD,h=alt*RAD;return [Math.cos(h)*Math.sin(a),Math.cos(h)*Math.cos(a),Math.sin(h)];};
 const angle=(u,v)=>{const c=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];return Math.atan2(Math.hypot(c[0],c[1],c[2]),u[0]*v[0]+u[1]*v[1]+u[2]*v[2])*DEG;};
 const altOf=u=>Math.asin(Math.max(-1,Math.min(1,u[2])))*DEG,azOf=u=>(Math.atan2(u[0],u[1])*DEG+360)%360;
 const azDiff=(a,b)=>((a-b+540)%360)-180;
 const cancelled=()=>Error('height-cancelled');
 const ready=()=>typeof align?.heightVertices==='function'&&typeof align?.viewProjector==='function'&&typeof atmosphere?.refractionBounds==='function'&&typeof bodies?.state==='function'&&typeof scanHeights==='function';
 const placeAt=(ctx,h)=>({...ctx.place,eyeHeightAGL:h,standAglM:h,stand:'ground',groundManualM:ctx.ground});
 // The eye height is the stand height itself. A second 1.5m must never be added.
 function observer(ctx,h){
  const obs=observerAt(placeAt(ctx,h),ctx.ground);
  if(!obs||Math.abs(obs.eyeM-h)>1e-9||Math.abs(obs.elevation-ctx.ground)>1e-9)throw Error('height-observer');
  return obs;
 }
 const viewOf=(obs,p)=>{
  const k=JSON.stringify([obs,p.target,p.body,p.partId,p.limb,p.matchMode??null,atmosphere.dataKey?.()??null]);let v=views.get(k);
  if(!v){v=Promise.resolve().then(async()=>{const prepared=viewFor?await viewFor(obs,p):null;if(prepared)return prepared;const o=shooting.searchOptions(p,isMountain);return o.broad&&o.disc||o.partId==='__whole'&&!isMountain(p.target)?align.prepareDailyView(obs,p.target,p.body,{partId:o.partId,eyeM:obs.eyeM}):null;}).catch(e=>{views.delete(k);throw e;});views.set(k,v);}
  return v;
 };
 const closeness=(ctx,e)=>ctx.family==='overlap'?(Number.isFinite(e.distanceToTarget)?e.distanceToTarget-(e.radius||0):Infinity):(Number.isFinite(e.gap)?Math.abs(e.gap)-Math.max(1/60,.2*(e.radius||0)):Infinity);
 const shapeOk=(ctx,e)=>!ctx.shape||e.spatialMatched!==false&&(!Number.isFinite(e.altitude)||ctx.o.disc||e.altitude>0)&&shooting.shapeContains(ctx.shape,ctx.place);
 // Same point path as Shooting.candidates: observerAt → viewFor → eventsFor → day window → matches.
 function real(ctx,h){
  const k=ctx.key+'|'+h.toFixed(1);ctx.heights.add(h);let r=evals.get(k);if(r)return r;
  r=(async()=>{
   const obs=observer(ctx,h),view=await viewOf(obs,ctx.p);stats.realEvaluations++;
   const events=shooting.eventsFor(ctx.p,obs,ctx.start,{align,isMountain,view}).filter(e=>e.at>=ctx.start&&e.at<ctx.start+DAY);
   const rows=events.filter(e=>shooting.matches(e,ctx.p,isMountain)&&shapeOk(ctx,e)).map(e=>({place:placeAt(ctx,h),record:ctx.entry.record,event:e,assumedObserver:obs}));
   return {rows,events,height:h};
  })().catch(e=>{evals.delete(k);throw e;});
  evals.set(k,r);return r;
 }
 async function verify(ctx,h,accept){
  stats.verifications++;
  const result=await shooting.candidates(ctx.plan,[{place:placeAt(ctx,h),record:ctx.entry.record}],{align,isMountain,observerAt,elevationAt,ensure,viewFor:viewOf,yieldTask:deps.yieldTask,isCurrent:ctx.isCurrent});
  if(result.cancelled||!ctx.isCurrent())throw cancelled();
  return result.rows.filter(r=>accept(r)&&shapeOk(ctx,r.event)).map(r=>({...r,...(ctx.shape?{shapeType:ctx.shape.type}:{}),heightSearch:{min:ctx.range.min,max:ctx.range.max,height:h}}));
 }
 // Geometric (airless) body direction at the reference position. Refraction is bounded separately.
 function stateAt(ctx,t,h){
  const e=ctx.ground+h,k=ctx.p.body+'|'+t+'|'+ctx.place.latitude+'|'+ctx.place.longitude+'|'+e;let s=states.get(k);
  if(!s){stats.bodyStates++;const st=bodies.state(ctx.p.body,t,{latitude:ctx.place.latitude,longitude:ctx.place.longitude,elevation:e},{refraction:false});s={u:unit(st.azimuth,st.apparentAltitude),alt:st.apparentAltitude,r:st.angularRadius||0};states.set(k,s);}
  return s;
 }
 const geoUnit=p=>unit(p.longitude,p.latitude);
 async function regionOf(ctx,a,b){
  const k=ctx.geometryKey+'|'+a+'|'+b;let r=regions.get(k);if(r!==undefined)return r;
  stats.geometryBuilds++;r=(async()=>{
   const oa=observer(ctx,a),ob=observer(ctx,b),t=ctx.p.target;
   if(ctx.family==='gap'){
    const ths=[],azs=[];
    for(const o of [oa,ob]){
     const g=align.geometryFrom(o,t,{partId:ctx.o.partId,eyeM:o.eyeM});if(g){ths.push(g.angle);azs.push(g.azimuth);}if(t.rim&&typeof align.rimOutline==='function'){const rim=align.rimOutline({...o,elevation:o.elevation+o.eyeM},t);if(rim)azs.push(rim.azimuth+rim.min,rim.azimuth+rim.max);}
     const hg=(await viewOf(o,ctx.p))?.heightGeometry;if(hg)ths.push(hg.angle);
     if(t.rim){if(typeof align.rimPoints!=='function'||!terrain)return null;for(const q of align.rimPoints(t.rim))ths.push(astro.targetElevationAngle(terrain.distanceKm(o.latitude,o.longitude,q.latitude,q.longitude),o.elevation+o.eyeM,q.m,{k:atmosphere.targetK()}));}
    }
    return ths.length&&ths.every(Number.isFinite)&&azs.every(Number.isFinite)?{family:'gap',thMin:Math.min(...ths),thMax:Math.max(...ths),azimuth:azs[0],azHalf:Math.max(...azs.map(a=>Math.abs(azDiff(a,azs[0]))))}:null;
   }
   const ga=(await viewOf(oa,ctx.p))?.heightGeometry,gb=(await viewOf(ob,ctx.p))?.heightGeometry;
   if(!ga||!gb||Math.abs(azDiff(ga.azimuth,gb.azimuth))>1e-9||ga.ridge!==gb.ridge)return null;
   const facePairs=[],verts=[],centers=[ga.centerAlt,gb.centerAlt];
   if(ga.ridge){
    // Each ridge column is a maximum of terrain angles, all falling with eye height: it lies between the two ends.
    if(!mountainRidge)return null;
    const ra=await mountainRidge(oa,t),rb=await mountainRidge(ob,t),A=ra?.ridge,B=rb?.ridge;
    if(!Array.isArray(A)||!Array.isArray(B)||A.length!==B.length||A.length<2||A.some((p,i)=>Math.abs(azDiff(p[0],B[i][0]))>1e-9))return null;
    const tops=(t.parts||[]).map(x=>x.m).filter(Number.isFinite),proven=!!ra.cap&&!!rb.cap&&tops.length&&t.parts[0].m>Math.max(...tops)-summitCapM;
    const bottom=proven?Math.min(ra.cap.base,rb.cap.base):Math.min(0,ra.cap?.base??0,rb.cap?.base??0);
    const used=new Set();A.forEach((p,i)=>{if(!proven||p[1]>bottom){used.add(i);if(i)used.add(i-1);if(i<A.length-1)used.add(i+1);}});
    if(!used.size)return null;
    for(const i of used)verts.push(A[i],B[i],[A[i][0],bottom]);
    verts.push([ga.azimuth,bottom],[ga.azimuth,Math.max(...verts.map(v=>v[1]))]);
    if(!proven)centers.push(ga.angle/2,gb.angle/2,(bottom+ga.angle)/2,(bottom+gb.angle)/2);
   }else for(const [o,g] of [[oa,ga],[ob,gb]]){
    const hv=align.heightVertices(o,t,{partId:g.partId,eyeM:g.eyeM,...(g.heightM!=null?{heightM:g.heightM}:{})});
    if(!hv?.vertices?.length)return null;verts.push(...hv.vertices);if(hv.polygons)facePairs.push(hv.polygons);
   }
   if(!centers.every(Number.isFinite))return null;
   const cLo=Math.min(...centers),cHi=Math.max(...centers),cq=(cLo+cHi)/2,project=align.viewProjector(ga.azimuth,cq);
   let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
   for(const v of verts){const xy=project(v[0],v[1]);if(!xy||!xy.every(Number.isFinite))return null;minX=Math.min(minX,xy[0]);maxX=Math.max(maxX,xy[0]);minY=Math.min(minY,xy[1]);maxY=Math.max(maxY,xy[1]);}
   if(ga.ridge){
    // Cap cut vertices interpolate in az/alt, not world coordinates. Enclose that angular rectangle too.
    const rel=verts.map(v=>azDiff(v[0],ga.azimuth)),alts=verts.map(v=>v[1]);if(rel.some(x=>Math.abs(x)>=89))return null;
    const corners=[Math.min(...rel),Math.max(...rel)].flatMap(a=>[Math.min(...alts),Math.max(...alts)].map(h=>unit(ga.azimuth+a,h))),q=unit(ga.azimuth,cq),theta=Math.max(...corners.map(v=>angle(q,v)));if(theta>=85)return null;const radius=Math.tan(theta*RAD)*DEG;minX=Math.min(minX,-radius);maxX=Math.max(maxX,radius);minY=Math.min(minY,-radius);maxY=Math.max(maxY,radius);
   }
   const thetaB=Math.max(...[[minX,minY],[minX,maxY],[maxX,minY],[maxX,maxY]].map(([x,y])=>Math.atan(Math.hypot(x,y)*RAD)*DEG));
   let boxes=null;
   if(facePairs.length===2&&facePairs[0].length===facePairs[1].length){
    const step=(maxY-minY)/32||1,bins=Array.from({length:32},()=>null);
    for(let i=0;i<facePairs[0].length;i++){
     const ps=[...facePairs[0][i],...facePairs[1][i]].map(v=>project(v[0],v[1]));if(ps.some(x=>!x))return null;
     const x0=Math.min(...ps.map(x=>x[0])),x1=Math.max(...ps.map(x=>x[0])),y0=Math.min(...ps.map(x=>x[1])),y1=Math.max(...ps.map(x=>x[1]));
     const lo=Math.max(0,Math.min(31,Math.floor((y0-minY)/step))),hi=Math.max(0,Math.min(31,Math.floor((y1-minY)/step)));
     for(let k=lo;k<=hi;k++){const b=bins[k];bins[k]={minX:Math.min(b?.minX??Infinity,x0),maxX:Math.max(b?.maxX??-Infinity,x1),minY:minY+k*step,maxY:minY+(k+1)*step};}
    }
    boxes=bins.filter(Boolean);
   }
   return {boxes,family:'overlap',qc:unit(ga.azimuth,cq),project,delta:(cHi-cLo)/2,bbox:{minX,maxX,minY,maxY},thetaB};
  })().catch(e=>{regions.delete(k);throw e;});
  regions.set(k,r);return r;
 }
 function groupOf(members){
  const ref=members[0],grounds=members.map(m=>m.ground);
  return {ref,members,observers:members.map(m=>({latitude:m.place.latitude,longitude:m.place.longitude})),groundMin:Math.min(...grounds),groundMax:Math.max(...grounds),
   // Local frames of two places differ by at most |Δlat|+|Δlon|; the Moon's parallax adds distance/356000km.
   spread:members.map(m=>Math.abs(m.place.latitude-ref.place.latitude)+Math.abs(m.place.longitude-ref.place.longitude)+angle(geoUnit(ref.place),geoUnit(m.place))*RAD*EARTH_KM/MOON_KM*DEG)};
 }
 // Can any member, at any lattice height in [a,b] and any instant in [t1,t2], meet the normal match condition?
 function leafTest(group,list,a,b,t1,t2){
  stats.leafTests++;
  const ref=group.ref,s=[stateAt(ref,t1,a),stateAt(ref,t2,a),stateAt(ref,t1,b),stateAt(ref,t2,b)],C=s[0].u;
  const rad=Math.max(...s.map(x=>angle(C,x.u))),chordA=angle(s[0].u,s[1].u),chordB=angle(s[2].u,s[3].u),chord=Math.max(chordA,chordB);
  // A short diurnal arc stays within half its chord of the chord; the Moon's parallax is height/356000km.
  const base=rad+chord/2+(group.groundMax-group.groundMin+(b-a))/(MOON_KM*1000)*DEG;
  const r=Math.max(...s.map(x=>x.r))*(1+1e-6),eMax=Math.max(...group.spread),xC=altOf(C),xLo=xC-base-eMax-r,xHi=xC+base+eMax+r;
  const sides=new Set();for(const [p,q,c] of [[s[0],s[1],chordA],[s[2],s[3],chordB]]){const d=q.alt-p.alt;if(d>c/2)sides.add('rise');else if(d<-c/2)sides.add('set');else{sides.add('rise');sides.add('set');}}
  const all={members:list.map((_,i)=>i),sides};
  if(Math.max(Math.abs(xLo),Math.abs(xHi))>=88)return all;
  const azHalf=Math.min(180,(base+eMax+r)/Math.cos(Math.max(Math.abs(xLo),Math.abs(xHi))*RAD));
  const rb=atmosphere.refractionBounds({xLo,xHi,msLo:t1,msHi:t2,h0Lo:group.groundMin+a,h0Hi:group.groundMax+b,observers:group.observers,azMid:azOf(C),azHalf});
  if(!rb)return all;
  // Raising every altitude by c changes lengths by at most max(1,cos c − tan(alt)·sin c) over the cap.
  const c=(rb.lo+rb.hi)/2,f=Math.max(1,Math.cos(c*RAD)-Math.tan(xLo*RAD)*Math.sin(c*RAD),Math.cos(c*RAD)-Math.tan(xHi*RAD)*Math.sin(c*RAD));
  const Capp=unit(azOf(C),xC+c),span=2*r+(rb.hi-rb.lo),members=[];
  for(let i=0;i<list.length;i++){
   const reg=list[i];if(!reg){members.push(i);continue;}
   const radApp=(base+group.spread[i]+r)*f+(rb.hi-rb.lo)/2+1e-9;
   if(reg.family==='gap'){
    if(Math.abs(azDiff(azOf(C),reg.azimuth))>reg.azHalf+azHalf+1e-6)continue;
    const lo=altOf(Capp)-radApp,hi=altOf(Capp)+radApp,tol=Math.max(1/60,.2*r)+1e-12;
    if(hi-reg.thMin<-tol||lo-reg.thMax>tol)continue;members.push(i);continue;
   }
   // Horizontal extent of the normal projected ellipse is ALWAYS tan(radius),
   // even when its vertical limb ratio is large near the projector horizon.
   // Test the homogeneous x coordinate before division so a horizon crossing
   // cannot turn an unrelated azimuth into an unbounded false possibility.
   const az=azOf(reg.qc)*RAD,right=[Math.cos(az),-Math.sin(az),0],dot=(a,b)=>a.reduce((n,x,k)=>n+x*b[k],0),eps=2*Math.sin((radApp+reg.delta)*RAD/2),den=dot(Capp,reg.qc),dHi=Math.min(1,den+eps),nx=dot(Capp,right),targetPad=reg.delta/Math.cos((reg.thetaB+reg.delta)*RAD)**2;
   if(dHi<=0)continue;
   const xlo=(reg.bbox.minX-targetPad-Math.tan(r*RAD)*DEG)*RAD,xhi=(reg.bbox.maxX+targetPad+Math.tan(r*RAD)*DEG)*RAD,products=[0,xlo*dHi,xhi*dHi];
   if(nx+eps<Math.min(...products)-1e-12||nx-eps>Math.max(...products)+1e-12)continue;
   const dLo=den-eps;
   if(dLo>0){
    const q=reg.qc,up=[-Math.sin(az)*q[2],-Math.cos(az)*q[2],Math.hypot(q[0],q[1])],ny=dot(Capp,up),ys=[(ny-eps)/dLo,(ny-eps)/dHi,(ny+eps)/dLo,(ny+eps)/dHi].map(x=>x*DEG),floor=.1*Math.tan(r*RAD)*DEG;
    if(Math.max(...ys)+floor<reg.bbox.minY-targetPad||Math.min(...ys)-floor>reg.bbox.maxY+targetPad)continue;
    if(reg.boxes&&!reg.boxes.some(box=>{
     if(Math.max(...ys)+floor<box.minY-targetPad||Math.min(...ys)-floor>box.maxY+targetPad)return false;
     const xl=(box.minX-targetPad-Math.tan(r*RAD)*DEG)*RAD,xh=(box.maxX+targetPad+Math.tan(r*RAD)*DEG)*RAD,prods=[xl*dLo,xl*dHi,xh*dLo,xh*dHi];return nx+eps>=Math.min(...prods)-1e-12&&nx-eps<=Math.max(...prods)+1e-12;
    }))continue;
   }
   const dC=angle(Capp,reg.qc);
   if(dC-radApp-reg.delta>=90)continue;           // beyond every projector hemisphere: distance is Infinity
   let thetaP=dC+radApp+reg.delta;if(thetaP>=89.9){members.push(i);continue;}
   // Plane-p length ≥ angle and ≤ angle·sec²θ. Limb midpoint (x of centre, y of limbs) may leave the limb arc by the limb span.
   const pad=span/Math.cos(thetaP*RAD)**2;
   const D=Math.max(Math.tan(r*RAD)*DEG,span/(2*Math.cos(thetaP*RAD)**2))+pad;
   let lb=dC-reg.thetaB;const xy=reg.project(azOf(Capp),altOf(Capp));
   if(xy){const {minX,maxX,minY,maxY}=reg.bbox,pd=Math.hypot(Math.max(minX-xy[0],0,xy[0]-maxX),Math.max(minY-xy[1],0,xy[1]-maxY)),ts=Math.max(Math.atan(Math.hypot(xy[0],xy[1])*RAD)*DEG,reg.thetaB);if(ts<89)lb=Math.max(lb,pd*Math.cos(ts*RAD)**2);}
   if(lb-radApp>D*(1+1e-9)+1e-12)continue;members.push(i);
  }
  return {members,sides};
 }
 async function leaves(group,a,b,from,to,ctl){
  stats.certificates++;
  const list=await Promise.all(group.members.map(m=>regionOf(m,a,b)));if(!ctl.isCurrent())throw cancelled();
  const out=[],stack=[];for(let t=from;t<to;t+=LIM.coarseMs)stack.push([t,Math.min(to,t+LIM.coarseMs)]);
  let n=0;
  while(stack.length){
   const [t1,t2]=stack.shift();
   if(++n%24===0){await yieldTask();if(!ctl.isCurrent())throw cancelled();if(ctl.deadline&&clock()>ctl.deadline)throw Error(ctl.kind==='point'?'height-limit':'shape-limit');}
   const res=leafTest(group,list,a,b,t1,t2);if(!res.members.length)continue;
   if(t2-t1<=LIM.leafMs){out.push({t1,t2,members:res.members,sides:res.sides});continue;}
   const m=Math.round((t1+t2)/2);stack.unshift([t1,m],[m,t2]);
  }
  return out;
 }
 function windowsOf(list){
  const out=[];for(const l of [...list].sort((x,y)=>x.t1-y.t1)){const w=out[out.length-1];if(w&&l.t1-w.to<=LIM.mergeMs){w.to=Math.max(w.to,l.t2);w.leaves.push(l);}else out.push({from:l.t1,to:l.t2,leaves:[l]});}
  return out;
 }
 // Whole-object fit uses the normal view's visual vertical centre; named parts
 // use the existing apparent limb gap. Feasibility is still the original match.
 async function fitResidual(ctx,result,accept){
  const matched=result.rows.filter(accept).map(r=>r.event),events=matched.length?matched:result.events.filter(e=>accept({event:e}));
  let center=null;if(ctx.family==='overlap'){const obs=observer(ctx,result.height);center=isMountain(ctx.p.target)?align.geometryFrom(obs,ctx.p.target,{partId:ctx.o.partId,eyeM:obs.eyeM})?.angle:(await viewOf(obs,ctx.p))?.heightGeometry?.centerAlt;}
  const values=events.map(e=>ctx.family==='overlap'?Number.isFinite(center)&&Number.isFinite(e.altitude)?e.altitude-center:null:Number.isFinite(e.gap)?e.gap:null).filter(Number.isFinite);
  return values.length?values.reduce((a,b)=>Math.abs(a)<=Math.abs(b)?a:b):null;
 }
 // A range returns verified representative heights for distinct possible time windows. Fixed mode is unchanged.
 async function solveMember(ctx,dayLeaves,issues,ctl){
  const rows=[],windows=windowsOf(dayLeaves),single=groupOf([ctx]);let checked=0;
  for(const w of windows){
   const accept=r=>r.event.at>=w.from&&r.event.at<=w.to;
   const evaluate=async h=>{await yieldTask();if(!ctl.isCurrent())throw cancelled();const x=await real(ctx,h),inside=x.events.filter(e=>e.at>=w.from&&e.at<=w.to);return {rows:x.rows.filter(accept),score:Math.min(Infinity,...inside.map(e=>closeness(ctx,e))),height:h,residual:await fitResidual(ctx,x,accept)};};
   const mayOverlap=async(lo,hi)=>(await leaves(single,lo,hi,w.from,w.to,ctl)).length?null:false;
   try{
    const res=await scanHeights({min:ctx.range.min,max:ctx.range.max,evaluate,mayOverlap,isCurrent:ctl.isCurrent,limit:LIM.heights});checked+=res.checked||0;
    if(res.rows?.length){
     let fit=deps.preferHeights?await deps.preferHeights({min:ctx.range.min,max:ctx.range.max,seed:res,evaluate,isCurrent:ctl.isCurrent,clock,deadline:clock()+6000}):res;
     let v=await verify(ctx,fit.height,accept);if(!v.length&&fit.height!==res.height){fit=res;v=await verify(ctx,res.height,accept);}
     if(v.length)rows.push(...v.map(row=>({...row,heightSearch:{...row.heightSearch,fit:fit.fit||'candidate',residualDeg:fit.residual??null,preferenceChecked:fit.fitChecked??0,preferenceIncomplete:!!fit.fitIncomplete}})));else issues.push({id:ctx.id,reason:'height-verify',at:w.from});
    }
    else if(res.failed)issues.push({id:ctx.id,reason:'height-limit',from:w.from,to:w.to});
   }catch(error){if(!['height-limit','shape-limit'].includes(error.message))throw error;issues.push({id:ctx.id,reason:error.message==='shape-limit'?'limit':'height-limit'});break;}
  }
  for(const h of ctx.heights){const x=await real(ctx,h);for(const r of x.rows)if(!windows.some(w=>r.event.at>=w.from&&r.event.at<=w.to)&&!rows.some(y=>y.event.side===r.event.side&&Math.abs(y.event.at-r.event.at)<3*3600000)){issues.push({id:ctx.id,reason:'height-certificate',at:r.event.at,height:h});const v=await verify(ctx,h,y=>Math.abs(y.event.at-r.event.at)<1000);rows.push(...v);}}
  return {rows,checked};
 }
 function makeCtx(base,entry,place,ground,shape){
  const p=base.p;
  // Prepared target geometry is independent of the day; event evaluations are not.
  // This memo remains private to one owner/revision/atmosphere job.
  const geometryKey=JSON.stringify([entry.place.id,place.latitude,place.longitude,ground,p.body,p.target,p.partId,p.limb,p.matchMode??null,atmosphere.dataKey?.()??null]);
  return {...base,entry,place,ground,shape,id:entry.place.id,heights:new Set(),geometryKey,key:geometryKey+'|'+base.start};
 }
 async function solvePoint(base,entry,range,ctl){
  const f=entry.place,ground=Number.isFinite(f.groundManualM)?f.groundManualM:Number.isFinite(f.elevation)?f.elevation:await elevationAt(f.latitude,f.longitude);
  if(!ctl.isCurrent())throw cancelled();
  if(!Number.isFinite(ground))return {rows:[],checked:0,issues:[{id:f.id,reason:'elevation'}]};
  const ctx=makeCtx({...base,range},entry,{...f},ground,null),issues=[];ctl={...ctl,kind:'point',deadline:clock()+LIM.pointMs};await real(ctx,range.min);await real(ctx,range.max);
  const ls=await leaves(groupOf([ctx]),range.min,range.max,base.start,base.start+DAY,ctl);
  const r=await solveMember(ctx,ls,issues,ctl);return {rows:r.rows,checked:r.checked,issues};
 }
 // Preserve the normal spatial solver, including crossings BETWEEN horizontal samples.
 // No negative certificate is inferred from sampled positions. An unsearched height band stays incomplete.
 async function solveShape(base,entry,range,ctl){
  if(!shooting.cleanShape(entry.place.shape))throw Error('shape-invalid');
  const deadline=clock()+LIM.shapeMs,issues=[],memo=new Map();let checked=0,bestRows=[];
  const evaluate=async height=>{
   if(memo.has(height))return memo.get(height);if(clock()>deadline)throw Error('shape-limit');
   const place={...entry.place,eyeHeightAGL:height,standAglM:height,stand:'ground'};
   const result=await shooting.candidates(base.plan,[{place,record:entry.record}],{align,isMountain,observerAt,elevationAt,ensure,viewFor:viewOf,yieldTask:deps.yieldTask,isCurrent:ctl.isCurrent});
   if(result.cancelled||!ctl.isCurrent())throw cancelled();
   stats.realEvaluations++;checked+=result.checked||0;
   if(result.failed)issues.push(...(result.issues||[{id:entry.place.id,reason:'calculation'}]));
   const rows=result.rows.map(row=>({...row,heightSearch:{min:range.min,max:range.max,height}})),values=[];
   for(const row of rows){
    const e=row.event,g=row.place.groundManualM??row.place.elevation,obs=row.assumedObserver||observerAt(row.place,g),view=await viewOf(obs,base.p),center=isMountain(base.p.target)?align.geometryFrom(obs,base.p.target,{partId:base.o.partId,eyeM:obs.eyeM})?.angle:view?.heightGeometry?.centerAlt;
    const residual=base.family==='overlap'?Number.isFinite(center)&&Number.isFinite(e.altitude)?e.altitude-center:null:Number.isFinite(e.gap)?e.gap:null;
    row.heightSearch.residualDeg=residual;if(Number.isFinite(residual))values.push(residual);
   }
   const value={rows,height,score:Infinity,residual:values.length?values.reduce((a,b)=>Math.abs(a)<=Math.abs(b)?a:b):null};memo.set(height,value);return value;
  };
  try{
   let result=await scanHeights({min:range.min,max:range.max,evaluate,isCurrent:ctl.isCurrent,limit:LIM.heights});bestRows=result.rows;
   if(result.rows?.length&&deps.preferHeights){result=await deps.preferHeights({min:range.min,max:range.max,seed:result,evaluate,isCurrent:ctl.isCurrent,clock,deadline});bestRows=result.rows;}
   if(result.failed)issues.push({id:entry.place.id,reason:'height-limit'});
   return {rows:bestRows.map(row=>({...row,heightSearch:{...row.heightSearch,fit:Number.isFinite(row.heightSearch.residualDeg)&&Math.abs(row.heightSearch.residualDeg)<=.01?'centered':result.fit==='range-edge'?'range-edge':'candidate',preferenceChecked:result.fitChecked??0,preferenceIncomplete:!!result.fitIncomplete}})),checked,issues};
  }catch(e){if(e.message!=='shape-limit')throw e;return {rows:bestRows,checked,issues:[...issues,{id:entry.place.id,reason:'limit'}]};}
 }
 async function candidates(plan,entries,{isCurrent=()=>true,onProgress=()=>{}}={}){
  const fixed=[],ranged=[],invalid=[];
  for(const e of entries){const r=rangeOf(e.place);if(r)ranged.push({entry:e,range:r});else if(e.place.eyeHeightRangeAGL!=null)invalid.push(e);else fixed.push(e);}
  const normal={align,isMountain,observerAt,elevationAt,ensure,viewFor:deps.fixedViewFor??viewFor,yieldTask:deps.yieldTask,isCurrent,onProgress};
  if(!ranged.length&&!invalid.length)return shooting.candidates(plan,entries,normal);
  if(ranged.length&&deps.ensureModels){await deps.ensureModels();if(!isCurrent())return {rows:[],failed:0,cancelled:true};}
  const off={rows:[],failed:0,cancelled:true};
  const out=fixed.length?await shooting.candidates(plan,fixed,normal):{rows:[],failed:0};
  if(out.cancelled||!isCurrent())return off;
  const p=shooting.conditions(plan);if(!p)return out;
  const rows=[...out.rows],issues=[...(out.issues||[]),...invalid.map(e=>({id:e.place.id,reason:'height-invalid'}))];let failed=(out.failed||0)+invalid.length,checked=out.checked||0,shaped=false;
  if(!ready()){for(const {entry}of ranged){failed++;issues.push({id:entry.place.id,reason:'height-geometry'});}return {rows,failed,issues,...(checked?{checked}:{})};}
  await ensure(p.body);if(!isCurrent())return off;
  const o=shooting.searchOptions(p,isMountain),base={plan,p,o,start:shooting.day(p.at),family:o.broad||o.partId==='__whole'?'overlap':'gap',isCurrent},ctl={isCurrent};
  for(const {entry,range} of ranged){
   await yieldTask();if(!isCurrent())return off;
   try{
    const r=entry.place.shape?(shaped=true,await solveShape(base,entry,range,ctl)):await solvePoint(base,entry,range,ctl);
    if(!isCurrent())return off;
    rows.push(...r.rows);checked+=r.checked||0;if(r.issues.length){failed++;issues.push(...r.issues);}
    onProgress({checked});
   }catch(e){
    if(e.message==='height-cancelled'||!isCurrent())return off;
    failed++;issues.push({id:entry.place.id,reason:e.message==='shape-limit'?'limit':e.message==='shape-invalid'?'invalid':e.message==='height-observer'?'height-observer':e.message==='height-limit'?'height-limit':'calculation'});
   }
  }
  if(!isCurrent())return off;
  rows.sort((a,b)=>a.event.at-b.event.at||a.place.name.localeCompare(b.place.name));
  return {rows,failed,...(issues.length?{issues}:{}),...(checked?{checked}:{}),...(shaped||out.stepM?{stepM:out.stepM||25}:{})};
 }
 return {candidates,ready,stats};
};
const scanRecordHeights=async function scanRecordHeights({min,max,evaluate,mayOverlap=async()=>null,isCurrent=()=>true,limit=48}){
 const lo=Math.round(min*10),hi=Math.round(max*10);if(!Number.isFinite(min)||!Number.isFinite(max)||lo<0||hi>7000||lo>=hi||Math.abs(lo-min*10)>1e-7||Math.abs(hi-max*10)>1e-7)throw Error('height-invalid');
 const memo=new Map();let checked=0;
 const at=async tick=>{if(!isCurrent())throw Error('height-cancelled');if(memo.has(tick))return memo.get(tick);if(checked>=limit)throw Error('height-limit');checked++;const result=await evaluate(tick/10);if(!isCurrent())throw Error('height-cancelled');memo.set(tick,result);return result;};
 const accepted=r=>Array.isArray(r?.rows)&&r.rows.length>0;
 const a=await at(lo);if(accepted(a))return {...a,checked};const b=await at(hi);if(accepted(b))return {...b,checked};
 const queue=[{lo,hi,a,b}];let incomplete=false;
 while(queue.length){
  if(!isCurrent())throw Error('height-cancelled');const item=queue.shift();if(item.hi-item.lo<=1)continue;
  const possible=await mayOverlap(item.lo/10,item.hi/10);if(!isCurrent())throw Error('height-cancelled');if(possible===false)continue;
  const mid=Math.floor((item.lo+item.hi)/2);let m;
  try{m=await at(mid);}catch(error){if(error.message==='height-limit'){incomplete=true;break;}throw error;}
  if(accepted(m))return {...m,checked};
  const children=[{lo:item.lo,hi:mid,a:item.a,b:m},{lo:mid,hi:item.hi,a:m,b:item.b}];
  queue.push(...children);queue.sort((x,y)=>Math.min(x.a?.score??Infinity,x.b?.score??Infinity)-Math.min(y.a?.score??Infinity,y.b?.score??Infinity)||(y.hi-y.lo)-(x.hi-x.lo));
 }
 return {rows:[],checked,failed:incomplete?1:0,...(incomplete?{issues:[{reason:'height-limit'}]}:{})};
};
const preferRecordHeight=async function preferRecordHeight({min,max,seed,evaluate,isCurrent=()=>true,limit=18,clock=()=>Date.now(),deadline=Infinity}){
 const lo=Math.round(min*10),hi=Math.round(max*10),memo=new Map(),valid=r=>r?.rows?.length&&Number.isFinite(r.residual),tick=h=>Math.max(lo,Math.min(hi,Math.round(h*10)));let best=seed,checked=0,incomplete=false;
 const improve=r=>{if(valid(r)&&(!valid(best)||Math.abs(r.residual)<Math.abs(best.residual)-1e-12||Math.abs(Math.abs(r.residual)-Math.abs(best.residual))<=1e-12&&r.height<best.height))best=r;};
 if(!Number.isFinite(seed?.residual))return {...seed,fit:'unavailable',fitChecked:0};
 memo.set(tick(seed.height),seed);improve(seed);
 const at=async k=>{if(!isCurrent())throw Error('height-cancelled');if(memo.has(k))return memo.get(k);if(checked>=limit||clock()>deadline){incomplete=true;return null;}checked++;const r=await evaluate(k/10);if(!isCurrent())throw Error('height-cancelled');memo.set(k,r);improve(r);return r;};
 await at(lo);await at(hi);await at(Math.floor((lo+hi)/2));
 const initial=[...memo.values()].filter(r=>Number.isFinite(r?.residual)).sort((a,b)=>a.height-b.height),sameSide=initial.length>=3&&initial.every(r=>r.residual>0)||initial.length>=3&&initial.every(r=>r.residual<0),deltas=initial.slice(1).map((r,i)=>r.residual-initial[i].residual),ordered=deltas.every(d=>d>=-1e-12)||deltas.every(d=>d<=1e-12);
 // These are measured fit choices, not negative/existence certificates.
 if(sameSide&&ordered&&(tick(best.height)===lo||tick(best.height)===hi))return {...best,fit:'range-edge',fitChecked:checked,fitIncomplete:incomplete};

 // A sign-changing bracket is refined to adjacent 0.1m ticks. Other intervals
 // stay eligible: discontinuous apparent limbs can make the closest tested fit differ.
 const visited=new Set();
 for(;;){
  const items=[...memo].filter(([,r])=>Number.isFinite(r?.residual)).sort((a,b)=>a[0]-b[0]),bands=[];
  for(let i=1;i<items.length;i++){const [a,A]=items[i-1],[b,B]=items[i];if(b-a<=1)continue;const k=a+':'+b;if(visited.has(k))continue;bands.push({a,b,k,sign:A.residual*B.residual<=0,score:Math.min(Math.abs(A.residual),Math.abs(B.residual))});}
  if(!bands.length||incomplete)break;
  bands.sort((a,b)=>Number(b.sign)-Number(a.sign)||a.score-b.score||(b.b-b.a)-(a.b-a.a));const band=bands[0];
  // Once a crossing has adjacent grid samples, prefer their actual verified rows.
  if(!band.sign&&items.some(([a,A],i)=>i&&a-items[i-1][0]<=1&&A.residual*items[i-1][1].residual<=0))break;
  visited.add(band.k);if(!await at(Math.floor((band.a+band.b)/2)))break;
 }
 const edge=tick(best.height)===lo||tick(best.height)===hi,fit=Number.isFinite(best.residual)&&Math.abs(best.residual)<=.01?'centered':edge?'range-edge':'closest-tested';
 return {...best,fit,fitChecked:checked,fitIncomplete:incomplete};
};
const RecordAlignment=(function createRecordAlignmentPolicy({isMountain,limbs}){
 const parts=t=>(t?.parts||[]).filter(p=>typeof p.id==='string'&&p.id!=='__whole'&&Number.isFinite(p.m));
 const whole=t=>({partId:isMountain(t)?null:'__whole',limb:'center',matchMode:'overlap'});
 function clean(t,v){if(!v)return whole(t);if(v.matchMode==='overlap'||v.partId==='__whole')return whole(t);const part=v.partId==null?parts(t)[0]:parts(t).find(p=>p.id===v.partId);if(v.matchMode!=='limb'||!part||!limbs.some(l=>l.id===v.limb))return null;return {partId:part.id,limb:v.limb,matchMode:'limb'};}
 const map=p=>p?.recordAlignments==null?{}:typeof p.recordAlignments==='object'&&!Array.isArray(p.recordAlignments)?p.recordAlignments:null;
 const key=p=>map(p)===null?'invalid:'+JSON.stringify(p.recordAlignments):JSON.stringify(Object.entries(map(p)).sort(([a],[b])=>a.localeCompare(b)).map(([id,v])=>[id,v?.partId??null,v?.limb,v?.matchMode]));
 const text=(t,v)=>v?.matchMode==='overlap'?'全体':(parts(t).find(p=>p.id===v?.partId)?.name||'部位')+'・'+(limbs.find(l=>l.id===v?.limb)?.name||'真ん中');
 return {parts,whole,clean,map,key,text};
})({isMountain:aimIsMountain,limbs:AstroNotesAlign.LIMBS});
function recordAlignmentInit(){const s=sheetState;if(!s||s.ctx!=='records'||s.alignmentDraft)return;s.alignmentDraft=structuredClone(RecordAlignment.map(s.place)||{});s.alignmentBaseline=RecordAlignment.key(placeOf(s.place.id)||s.place);}
function recordAlignmentDirty(){return sheetState?.ctx==='records'&&!!sheetState.alignmentDraft&&RecordAlignment.key({recordAlignments:sheetState.alignmentDraft})!==sheetState.alignmentBaseline;}
function applyRecordAlignments(){
 const s=sheetState;if(s?.ctx!=='records')return true;recordAlignmentInit();const selected=[];
 for(const t of s.draftTargets){const target=resolveTarget(t.key),value=RecordAlignment.clean(target,s.alignmentDraft[t.key]);if(!value)return false;if(value.matchMode!=='overlap')selected.push([t.key,value]);}
 if(selected.length)s.place.recordAlignments=Object.fromEntries(selected);else delete s.place.recordAlignments;return true;
}
function alignmentControls(host,target,value,{body=null,key='',summitOnly=false,change}){
 const options=[['__whole','全体'],...RecordAlignment.parts(target).map(p=>[p.id,p.name||p.id])],canonical=RecordAlignment.clean(target,value),signature=JSON.stringify([target?.id,options,!!AstroNotesBodies.definition(body)?.limbs,summitOnly]);
 if(host.dataset.alignmentSignature!==signature||!host.firstElementChild){
  host.dataset.alignmentSignature=signature;host.replaceChildren();const label=document.createElement('label');label.className='record-alignment-position';const title=document.createElement('span');title.className='tiny';title.textContent='重ねる位置';const select=document.createElement('select');select.className='fav-in';select.setAttribute('aria-label',target.name+'に重ねる位置');select.dataset.recordAlignment=key;select.replaceChildren(...options.map(([id,name])=>new Option(name,id)));label.append(title,select);const limbs=document.createElement('label');limbs.className='record-alignment-limbs';const limbSelect=document.createElement('select');limbSelect.className='fav-in';limbSelect.setAttribute('aria-label',target.name+'に合わせる天体の部分');for(const limb of AstroNotesAlign.LIMBS)limbSelect.add(new Option(limb.name,limb.id));limbs.append(limbSelect);if(summitOnly)label.style.display="none";host.append(label,limbs);
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
 const detail=el('skyMapAlignmentDetails'),host=el('skyMapAlignmentControls');const summitOnly=aimIsMountain(s?.target);detail.hidden=!s?.target||globalThis.AstroNotesTrialOverlap?.isAll(s)===true||summitOnly&&!AstroNotesBodies.definition(s.body)?.limbs;if(!el('skyMapAlignmentSummary').firstElementChild)el('skyMapAlignmentSummary').innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="8.5" cy="8.5" r="6.5"/><circle cx="15.5" cy="15.5" r="6.5"/></svg><span>重ね方</span>';if(detail.hidden){host.replaceChildren();delete host.dataset.alignmentSignature;return;}
 alignmentControls(host,s.target,s,{body:s.body,summitOnly,change:next=>{if(skySession!==s||!auth?.token||!toolAllowed('skymap'))return;SkyMapUI.setAlignment(next.partId,next.limb,next.matchMode);}});
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

// Temporary preview height. The registered height range remains a search condition.
let previewEyePending=null,previewEyeFrame=0,previewEyeRuler=null,previewEyeAdjustmentStamp=null;
function previewEyeStamp(s=SkyMapUI.selectionState()){return !s?.observer||!globalThis.TrialExplore?.active()||el('skyMapView').dataset.exploreStage!=='preview'||el('aimLook').hidden||!el('aimLook').querySelector('[data-look-canvas]')?null:JSON.stringify([auth?.token,auth?.loginId,accessState.generation,s.observer.latitude,s.observer.longitude,s.target?.id,s.body,s.partId,s.limb,s.matchMode]);}
function eyeAdjustmentFor(s){return !!previewEyeAdjustmentStamp&&previewEyeAdjustmentStamp===previewEyeStamp(s);}
function previewEyeValue(){const s=SkyMapUI.selectionState(),ground=SkyMapUI.workspaceHost()?.session.ground;return s?.observer?aimObserverAt(s.observer,ground).eyeM:NaN;}
function applyPreviewEyeHeight(value){
 value=String(value).normalize('NFKC').trim();
 const stamp=previewEyeStamp();if(!stamp)return;
 if(String(value).trim()===''||!Number.isFinite(Number(value))||Number(value)<0||Number(value)>700){el('previewEyeError').textContent='0〜700mで入力してください';el('previewEyeError').hidden=false;return;}
 const height=Math.round(Number(value)*10)/10;el('previewEyeError').hidden=true;previewEyePending={height,stamp};el('previewEyeValue').value=String(height);
 if(previewEyeFrame)cancelAnimationFrame(previewEyeFrame);
 previewEyeFrame=requestAnimationFrame(()=>{previewEyeFrame=0;const next=previewEyePending;previewEyePending=null;if(next&&next.stamp===previewEyeStamp()){previewEyeAdjustmentStamp=next.stamp;SkyMapUI.setEyeHeight(next.height);}});
}
function renderPreviewEyeHeight(){
 const look=el('aimLook'),scene=el('exploreScenePanel');if(!look||!scene)return;
 let box=el('previewEyeHeightControls');
 if(!box){
  previewEyeRuler?.destroy();
  box=document.createElement('section');box.id='previewEyeHeightControls';box.setAttribute('aria-label','目線の高さ');
  box.innerHTML='<div class="preview-eye-row"><div class="preview-eye-tools"><label class="preview-eye-scale" for="previewEyeValue">目線（地上から）</label><div class="numeric-ruler-track"><div id="previewEyeRuler" class="sky-map-timeline numeric-ruler" role="slider" tabindex="0" aria-label="目線の高さを横スクロールして調整"></div><span class="sky-map-timeline-center" aria-hidden="true"></span></div></div><label class="preview-eye-value"><input type="text" id="previewEyeValue" inputmode="decimal" min="0" max="700" step="0.1" aria-label="目線の高さ（地上からメートル）"><span>m</span></label></div><p id="previewEyeError" class="tiny" role="status" hidden></p>';
  AstroNotesScrollTimeline.focusEnd(box.querySelector('#previewEyeValue'));
  look.after(box);el('previewEyeValue').onchange=()=>applyPreviewEyeHeight(el('previewEyeValue').value);el('previewEyeValue').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();applyPreviewEyeHeight(el('previewEyeValue').value);}};

  const rulerRoot=el('previewEyeRuler');previewEyeRuler=AstroNotesScrollTimeline.mountNumeric({root:rulerRoot,numeric:{min:0,max:700,step:.1,precision:.1,pixels:4,labelEvery:10,label:'目線の高さを横スクロールして調整'},getAt:()=>previewEyePending?.height??previewEyeValue(),getObserver:previewEyeStamp,enabled:()=>rulerRoot.isConnected&&el('previewEyeRuler')===rulerRoot&&!!previewEyeStamp(),format:v=>String(Math.round(v*10)/10),describe:v=>v+'m',onChange:applyPreviewEyeHeight});
 }
 const stamp=previewEyeStamp();box.hidden=!stamp;
 if(previewEyePending&&previewEyePending.stamp!==stamp){if(previewEyeFrame)cancelAnimationFrame(previewEyeFrame);previewEyeFrame=0;previewEyePending=null;previewEyeRuler?.stop();}
 if(!stamp){if(previewEyeFrame)cancelAnimationFrame(previewEyeFrame);previewEyeFrame=0;previewEyePending=null;previewEyeRuler?.stop();previewEyeAdjustmentStamp=null;return;}
 const anchor=look.querySelector('.aim-lens')||look;if(box.previousElementSibling!==anchor)anchor.after(box);
 const height=previewEyePending?.height??previewEyeValue();if(Number.isFinite(height)){
  if(document.activeElement!==el('previewEyeValue'))el('previewEyeValue').value=String(Math.round(height*10)/10);
  previewEyeRuler?.sync(height,'number');
 }
}
document.addEventListener('astronotes-search-state',renderPreviewEyeHeight);
document.addEventListener('astronotes-preview-leave',()=>{if(previewEyeFrame)cancelAnimationFrame(previewEyeFrame);previewEyeFrame=0;previewEyePending=null;previewEyeAdjustmentStamp=null;previewEyeRuler?.stop();if(el('previewEyeHeightControls'))el('previewEyeHeightControls').hidden=true;});

const RecordHeight=(function createRecordHeightPolicy(){
 const finite=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
 const range=value=>value&&finite(value.min,0,700)&&finite(value.max,0,700)&&value.min<value.max&&Math.abs(value.min*10-Math.round(value.min*10))<1e-7&&Math.abs(value.max*10-Math.round(value.max*10))<1e-7?{min:Math.round(value.min*10)/10,max:Math.round(value.max*10)/10}:null;
 const key=p=>JSON.stringify([p?.latitude,p?.longitude,p?.elevation??null,p?.groundManualM??null,p?.eyeHeightAGL??1.5,p?.eyeHeightRangeAGL??null]);
 const draft=p=>({mode:p?.eyeHeightRangeAGL?'range':'fixed',ground:String(Number.isFinite(p?.groundManualM)?p.groundManualM:Number.isFinite(p?.elevation)?p.elevation:''),fixed:String(p?.eyeHeightAGL??1.5),min:String(p?.eyeHeightRangeAGL?.min??''),max:String(p?.eyeHeightRangeAGL?.max??'')});
 function parse(d,fallbackEye=1.5){
  const num=s=>typeof s==='string'&&s.trim()?Number(s):NaN,eye=num(d.fixed),g=num(d.ground);
  if(d.ground.trim()&&!finite(g,-500,9000))throw Error('標高は−500〜9000mで入力してください');
  if(d.mode==='range'){const value=range({min:num(d.min),max:num(d.max)});if(!value)throw Error('高さの下限と上限を0〜700m・0.1m単位で入力してください（下限＜上限）');return {ground:Number.isFinite(g)?g:null,eye:finite(eye,0,700)?eye:finite(fallbackEye,0,700)?fallbackEye:1.5,range:value};}
  if(!finite(eye,0,700))throw Error('目線の高さは0〜700mで入力してください');
  return {ground:Number.isFinite(g)?g:null,eye,range:null};
 }
 return {range,key,draft,parse};
})();
// Inside MyPlacesUI. Only the record editor exposes this policy; Explore stays fixed-height.
let recordHeightRequestSeq=0;
function recordHeightInit(){
 const s=sheetState;if(!s||s.ctx!=='records')return;const location=JSON.stringify([s.place.latitude,s.place.longitude]);
 if(s.heightDraft&&s.heightLocation===location)return;
 s.heightLocation=location;s.heightBaseline=RecordHeight.key(placeOf(s.place.id)||s.place);s.heightDraft=RecordHeight.draft(s.place);s.heightFallback=s.place.eyeHeightAGL??1.5;s.heightInitialDraft=JSON.stringify(s.heightDraft);s.heightGroundAttempted=false;s.heightGroundError='';s.heightRequest=++recordHeightRequestSeq;
}
function recordHeightDirty(){return sheetState?.ctx==='records'&&!!sheetState?.heightDraft&&(JSON.stringify(sheetState.heightDraft)!==sheetState.heightInitialDraft||RecordHeight.key(sheetState.place)!==sheetState.heightBaseline);}
function applyRecordHeightDraft(show=false){
 if(sheetState?.ctx!=='records'||!sheetState.heightDraft)return true;
 try{const value=RecordHeight.parse(sheetState.heightDraft,sheetState.heightFallback),p=sheetState.place;p.eyeHeightAGL=value.eye;sheetState.heightFallback=value.eye;p.elevation=value.ground;if(value.range)p.eyeHeightRangeAGL=value.range;else delete p.eyeHeightRangeAGL;if(show)el('myHeightError').hidden=true;return true;}
 catch(error){if(show){el('myHeightError').textContent=error.message;el('myHeightError').hidden=false;}return false;}
}
function recordHeightGround(retry=false){
 const s=sheetState;if(!sheetOwnerMatches()||!draftPoint()||s.heightLoading||(!retry&&s.heightGroundAttempted))return;
 s.heightGroundAttempted=true;s.heightLoading=true;s.heightGroundError='';const request=++recordHeightRequestSeq;s.heightRequest=request;const lat=s.place.latitude,lon=s.place.longitude;
 if(retry){s.heightDraft.ground='';s.place.elevation=null;s.place.groundManualM=null;}
 renderRecordHeight(false);
 void candidateElevation(lat,lon).then(value=>{
  if(sheetState!==s||!sheetOwnerMatches()||!sheet.open||request!==s.heightRequest||lat!==s.place.latitude||lon!==s.place.longitude)return;
  s.heightLoading=false;if(Number.isFinite(value)){s.heightDraft.ground=String(Math.round(value*10)/10);s.place.elevation=Math.round(value*10)/10;s.place.groundManualM=null;}else s.heightGroundError='標高を取得できませんでした。再取得または入力してください。';
  renderSheet();
 });
}
function buildRecordHeight(){
 const box=document.createElement('fieldset');box.id='myRecordHeight';box.className='record-height-editor';box.innerHTML=`<legend>撮影する高さ</legend><label class="record-height-label" for="myHeightGround">地面の標高</label><div class="record-height-ground"><label class="record-height-number"><input id="myHeightGround" type="number" inputmode="decimal" min="-500" max="9000" step="any" aria-label="地面の標高（メートル）"><span>m</span></label><button type="button" class="chip" id="myHeightGroundRetry">再取得</button></div><p class="tiny" id="myHeightGroundError" role="status" hidden></p><div class="record-height-label">目線（地上から）</div><div class="record-height-modes" role="group" aria-label="目線の高さの指定方法"><button type="button" id="myHeightFixedMode">固定</button><button type="button" id="myHeightRangeMode">範囲</button></div><div id="myHeightFixedFields" class="record-height-values"><label class="record-height-number"><input id="myHeightFixed" type="number" inputmode="decimal" min="0" max="700" step="any" aria-label="目線の高さ（メートル）"><span>m</span></label></div><div id="myHeightRangeFields" class="record-height-values" hidden><label><span class="tiny">下限</span><span class="record-height-number"><input id="myHeightMin" type="number" inputmode="decimal" min="0" max="700" step="0.1" aria-label="目線の高さの下限（メートル）"><span>m</span></span></label><label><span class="tiny">上限</span><span class="record-height-number"><input id="myHeightMax" type="number" inputmode="decimal" min="0" max="700" step="0.1" aria-label="目線の高さの上限（メートル）"><span>m</span></span></label></div><p id="myHeightError" class="warn" role="status" hidden></p>`;
 el('myRecordPickTarget').closest('.my-input-field').before(box);
 for(const [id,key]of [['myHeightGround','ground'],['myHeightFixed','fixed'],['myHeightMin','min'],['myHeightMax','max']])el(id).oninput=()=>{if(!sheetOwnerMatches())return;recordHeightInit();sheetState.heightDraft[key]=el(id).value;if(key==='ground'){sheetState.heightRequest=++recordHeightRequestSeq;sheetState.heightLoading=false;sheetState.heightGroundAttempted=true;sheetState.heightGroundError='';const n=Number(el(id).value);sheetState.place.groundManualM=el(id).value.trim()&&Number.isFinite(n)?n:null;}applyRecordHeightDraft(true);renderRecordHeight(false);el('myRecordSave').disabled=!draftPoint()||!!sheetState.locationPending||!draftChanged()||!!sheetState.heightLoading||!applyRecordHeightDraft();el('myPlacePlanning').hidden=!sheetState.place.id||draftChanged();};
 for(const [id,mode]of [['myHeightFixedMode','fixed'],['myHeightRangeMode','range']])el(id).onclick=()=>{if(!sheetOwnerMatches())return;recordHeightInit();sheetState.heightDraft.mode=mode;applyRecordHeightDraft();renderSheet();};
 el('myHeightGroundRetry').onclick=()=>recordHeightGround(true);
}
function renderRecordHeight(loadGround=true){
 if(!el('myRecordHeight')||!sheetState)return;const s=sheetState;el('myRecordHeight').hidden=s.ctx!=='records'||!draftPoint();if(el('myRecordHeight').hidden)return;recordHeightInit();const d=s.heightDraft;
 for(const [id,key]of [['myHeightGround','ground'],['myHeightFixed','fixed'],['myHeightMin','min'],['myHeightMax','max']])if(document.activeElement!==el(id))el(id).value=d[key];
 el('myHeightGround').placeholder=s.heightLoading?'取得中…':'標高を入力';el('myHeightGroundRetry').disabled=!!s.heightLoading;el('myHeightGroundError').textContent=s.heightGroundError;el('myHeightGroundError').hidden=!s.heightGroundError;
 el('myHeightFixedMode').setAttribute('aria-pressed',String(d.mode==='fixed'));el('myHeightRangeMode').setAttribute('aria-pressed',String(d.mode==='range'));el('myHeightFixedFields').hidden=d.mode!=='fixed';el('myHeightRangeFields').hidden=d.mode!=='range';
 applyRecordHeightDraft();
 if(loadGround&&!d.ground.trim()&&!s.heightGroundAttempted)recordHeightGround();
}
function prepareHeightRecord(args){
 if(sheetState?.ctx!=='records')return AstroNotesLibrary.prepareRecord(args);
 const policy=RecordHeight.range(args.place.eyeHeightRangeAGL);if(args.place.eyeHeightRangeAGL&&!policy)throw Error('高さの範囲を確認してください');
 const before=args.favorites.find(f=>f.id===args.place.id),plan=AstroNotesLibrary.prepareRecord(args),next=plan.favorites.find(f=>f.id===args.place.id);if(!next)return plan;
 const changed=!before||RecordHeight.key(before)!==RecordHeight.key(args.place);
 if(changed){next.elevation=args.place.elevation??null;next.groundManualM=args.place.groundManualM??null;next.eyeHeightAGL=args.place.eyeHeightAGL??1.5;if(policy)next.eyeHeightRangeAGL=policy;else delete next.eyeHeightRangeAGL;if(!plan.changedFavorites.includes(next.id))plan.changedFavorites.push(next.id);
  if(before&&(before.eyeHeightAGL!==next.eyeHeightAGL||before.elevation!==next.elevation)){const old=new Set(args.initialTargets.map(t=>t.key||t.id));plan.observations.push(...AstroNotesLibrary.registrationChanges(next,[],args.targets.filter(t=>old.has(t.key||t.id))));}
 }
 return saveRecordBodyMetadata(saveRecordAlignmentMetadata(plan,args),args);
}

function recordHeightText(p){const r=RecordHeight.range(p?.eyeHeightRangeAGL);return r?'地上から '+r.min+'〜'+r.max+'m':'地上から '+(p?.eyeHeightAGL??1.5)+'m';}

// A solver belongs to one caller's job: its bounded memo must never cross owner/revision/air epochs.
function recordHeightSolver(deps){
 return createRecordHeightCandidates({shooting:AstroNotesShooting,align:AstroNotesAlign,bodies:AstroNotesBodies,atmosphere:AstroNotesAtmosphere,astro:AstroNotesAstro,terrain:AstroNotesTerrain,scanHeights:scanRecordHeights,preferHeights:preferRecordHeight,rangeOf:p=>RecordHeight.range(p.eyeHeightRangeAGL),isMountain:aimIsMountain,ensureModels:()=>AstroNotesAssets.ensureModels(),mountainRidge:async(obs,target)=>{const eye=obs.elevation+obs.eyeM,ridge=await aimLookRidge(obs,eye,target,{});return ridge?{ridge,cap:aimSummitCap(ridge,obs,eye,target)}:null;},...deps});
}

const createRecordTransfer=function createRecordTransfer({library,cleanFavorite,cleanShape,cleanAlignment,rangeOf,bodyIds,builtins,currentStatus,makeId,now=()=>Date.now()}){
 const FORMAT='astronotes.places',VERSION=1,LIMIT=5000;
 const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
 const text=(v,n=200)=>typeof v==='string'&&v.length<=n;
 const number=(v,a,b)=>Number.isFinite(v)&&v>=a&&v<=b;
 const fail=message=>{throw Error(message);};
 const clone=v=>JSON.parse(JSON.stringify(v));
 const bodyValues=value=>value==null?null:Array.isArray(value)&&value.length>0&&value.length<=bodyIds.length&&value.every(x=>bodyIds.includes(x))?[...new Set(value)].sort((a,b)=>bodyIds.indexOf(a)-bodyIds.indexOf(b)):fail('天体の指定を確認してください');
 const savedBodyValues=value=>{try{return bodyValues(value);}catch{return null;}};
 function location(raw){
  if(!object(raw)||!library.point(raw)||!text(raw.name)||!raw.name.trim()||!text(raw.subtitle??'',2000)||!text(raw.note??'',2000))fail('撮影地点の名前・座標を確認してください');
  for(const key of ['elevation','groundManualM'])if(raw[key]!=null&&!number(raw[key],-500,9000))fail('地面の標高を確認してください');
  if(raw.eyeHeightAGL!=null&&!number(raw.eyeHeightAGL,0,700))fail('目線の高さを確認してください');
  const range=raw.eyeHeightRangeAGL==null?null:rangeOf(raw.eyeHeightRangeAGL);if(raw.eyeHeightRangeAGL!=null&&!range)fail('目線の高さの範囲を確認してください');
  const value={name:raw.name.trim(),subtitle:raw.subtitle??'',note:raw.note??'',latitude:raw.latitude,longitude:raw.longitude,elevation:raw.elevation??null,groundManualM:raw.groundManualM??null,eyeHeightAGL:raw.eyeHeightAGL??null,terrain:raw.terrain??null,phenomena:Array.isArray(raw.phenomena)?raw.phenomena:[],locationScope:raw.locationScope??'point',...(range?{eyeHeightRangeAGL:range}:{})};
  const cleaned=cleanFavorite({...value,id:'portable-validation'});if(!cleaned)fail('撮影地点の情報を確認してください');
  return Object.fromEntries(Object.keys(value).map(key=>[key,clone(Object.hasOwn(cleaned,key)?cleaned[key]:value[key])]));
 }
 function shapeValue(raw){if(raw==null)return null;const shape=cleanShape(raw);if(!shape)fail('線・範囲の形を確認してください');return shape;}
 function customDefinition(raw){
  if(!object(raw)||!number(raw.heightM,0,1000)||!text(raw.category??'',20))fail('独自対象の高さ・カテゴリを確認してください');
  return {location:location(raw.location),heightM:raw.heightM,category:raw.category??''};
 }
 const targetIdentity=entry=>JSON.stringify([entry.name,entry.latitude,entry.longitude,entry.elevation??null,entry.targetHeightM,entry.targetCategory??'']);
 const shapeAt=(place,shapes)=>{const row=shapes[place.id];return row&&row.latitude===place.latitude&&row.longitude===place.longitude?shapeValue(row.shape):null;};
 const baseIdentity=(place,shape)=>JSON.stringify([location(place),shape]);
 function validate(data){
  if(!object(data)||data.format!==FORMAT||data.version!==VERSION)fail('この撮影地点ファイルには対応していません');
  if(!Array.isArray(data.places)||!data.places.length||data.places.length>LIMIT||!Array.isArray(data.targets)||data.targets.length>LIMIT)fail('撮影地点ファイルの件数・形式を確認してください');
  const targets=new Map();for(const row of data.targets){
   if(!object(row)||!text(row.id)||!row.id||targets.has(row.id)||!text(row.name)||!row.name.trim())fail('対象の参照が重複・欠損しています');
   if(row.kind==='builtin'){if(!text(row.key)||!row.key)fail('対象の参照を確認してください');targets.set(row.id,{id:row.id,kind:'builtin',key:row.key,name:row.name});}
   else if(row.kind==='custom')targets.set(row.id,{id:row.id,kind:'custom',name:row.name,...customDefinition(row)});
   else fail('対象の種類を確認してください');
  }
  const ids=new Set(),places=data.places.map(row=>{
   if(!object(row)||!text(row.id)||!row.id||ids.has(row.id)||!Array.isArray(row.targets)||row.targets.length>500)fail('撮影地点の参照・対象を確認してください');ids.add(row.id);
   const refs=new Set(),bindings=row.targets.map(binding=>{
    if(!object(binding)||!targets.has(binding.ref)||refs.has(binding.ref)||!['seen','partial','hidden'].includes(binding.result))fail('撮影地点に結びつく対象を確認してください');refs.add(binding.ref);
    const a=binding.alignment;if(!object(a)||!['overlap','limb'].includes(a.matchMode)||!['onTop','center','behind'].includes(a.limb)||!(a.partId===null||text(a.partId)))fail('重ね方の指定を確認してください');
    return {ref:binding.ref,result:binding.result,alignment:{partId:a.partId,limb:a.limb,matchMode:a.matchMode}};
   });
   return {id:row.id,location:location(row.location),shape:shapeValue(row.shape),bodies:bodyValues(row.bodies),targets:bindings};
  });
  return {format:FORMAT,version:VERSION,places,targets:[...targets.values()]};
 }
 function exportPlaces({favorites,observations,shapes,placeIds}){
  const selected=new Set(placeIds),places=[],targets=[],refs=new Map();
  for(const favorite of favorites.filter(p=>selected.has(p.id))){
   const bindings=[];for(const key of new Set(observations.filter(r=>r.placeId===favorite.id).map(r=>r.target.key))){
    const record=currentStatus(favorite,key,observations);if(!record||record.removed)continue;
    let ref=refs.get(key);if(!ref){
     ref='t'+(targets.length+1);const builtin=builtins.find(t=>t.id===key);let definition;
     if(builtin)definition={id:ref,kind:'builtin',key,name:builtin.name};
     else {const f=key.startsWith('fav:')&&favorites.find(p=>p.id===key.slice(4));if(!f||!number(f.targetHeightM,0,1000))fail('対象「'+record.target.name+'」の定義がありません。対象を登録し直してください');definition={id:ref,kind:'custom',name:f.name,location:location(f),heightM:f.targetHeightM,category:f.targetCategory??''};}
     refs.set(key,ref);targets.push(definition);
    }
    const target=key.startsWith('fav:')?library.targetFromFavorite(favorites.find(p=>p.id===key.slice(4))):builtins.find(t=>t.id===key),alignment=cleanAlignment(target,favorite.recordAlignments?.[key]);
    if(!alignment)fail('「'+favorite.name+'」の重ね方を確認してください');bindings.push({ref,result:record.result,alignment});
   }
   places.push({id:'p'+(places.length+1),location:location(favorite),shape:shapeAt(favorite,shapes),bodies:savedBodyValues(favorite.planningBodies),targets:bindings});
  }
  if(!places.length)fail('撮影地点を選んでください');
  const data={format:FORMAT,version:VERSION,exportedAt:new Date(now()).toISOString(),places,targets};validate(data);return data;
 }
 function prepareImport(data,{favorites,observations,shapes,owner}){
  if(!owner)fail('記録を利用できるアカウントでログインしてください');
  data=validate(data);const nextFavorites=favorites.map(p=>clone(p)),nextObservations=observations.map(r=>clone(r)),nextShapes=Object.assign(Object.create(null),clone(shapes)),changed=new Set(),resolved=new Map(),unresolved=[],report={addedPlaces:0,reusedPlaces:0,duplicatePlaces:0,addedTargets:0,reusedTargets:0,addedBindings:0,variantPlaces:0};
  const used=new Set(data.places.flatMap(p=>p.targets.map(t=>t.ref))),ids=new Set([...favorites,...observations].map(x=>x.id));
  const uid=prefix=>{for(let i=0;i<20;i++){const id=makeId(prefix);if(text(id,80)&&id&&!ids.has(id)){ids.add(id);return id;}}return fail('新しい登録IDを作れませんでした');};
  const targetIndex=new Map();for(const p of nextFavorites)if(number(p.targetHeightM,0,1000)){const normalized=cleanFavorite(p);if(normalized&&!targetIndex.has(targetIdentity(normalized)))targetIndex.set(targetIdentity(normalized),p);}
  for(const definition of data.targets.filter(t=>used.has(t.id))){
   if(definition.kind==='builtin'){const target=builtins.find(t=>t.id===definition.key);if(!target){unresolved.push(definition.name);continue;}resolved.set(definition.id,target);}
   else {
    const f=cleanFavorite({...definition.location,id:'portable-validation',targetHeightM:definition.heightM,targetCategory:definition.category||null});if(!f)fail('独自対象の情報を確認してください');const same=targetIndex.get(targetIdentity(f));
    if(same){resolved.set(definition.id,library.targetFromFavorite(same));report.reusedTargets++;}
    else {f.id=uid('target-');nextFavorites.push(f);targetIndex.set(targetIdentity(f),f);changed.add(f.id);resolved.set(definition.id,library.targetFromFavorite(f));report.addedTargets++;}
   }
  }
  // A preview may explain missing definitions; it must never silently discard them.
  for(const place of data.places)for(const b of place.targets){const t=resolved.get(b.ref);if(t&&!cleanAlignment(t,b.alignment))unresolved.push(t.name+'：重ねる位置');}
  if(unresolved.length)return {canImport:false,unresolved:[...new Set(unresolved)],report,places:data.places,changedFavorites:[]};
  const placeIndex=new Map(),recordIndex=new Map(),statusCache=new Map(),originalPlaces=new Set(favorites.map(p=>p.id)),pairKey=(id,key)=>JSON.stringify([id,key]);
  for(const p of nextFavorites){try{const signature=baseIdentity(p,shapeAt(p,nextShapes));if(!placeIndex.has(signature))placeIndex.set(signature,[]);placeIndex.get(signature).push(p);}catch{/* Unrelated legacy data is retained, never used as an identity. */}}
  for(const r of nextObservations){const key=pairKey(r.placeId,r.target.key);if(!recordIndex.has(key))recordIndex.set(key,[]);recordIndex.get(key).push(r);}
  const status=(p,key)=>{const pair=pairKey(p.id,key);if(!statusCache.has(pair))statusCache.set(pair,currentStatus(p,key,recordIndex.get(pair)||[]));return statusCache.get(pair);};
  for(const input of data.places){
   const bindings=input.targets.map(b=>({...b,target:resolved.get(b.ref),alignment:cleanAlignment(resolved.get(b.ref),b.alignment)})),signature=baseIdentity(input.location,input.shape);
   const keys=bindings.map(b=>b.target.key||b.target.id);if(new Set(keys).size!==keys.length)fail('「'+input.location.name+'」の対象が重複しています');
   const sameBase=placeIndex.get(signature)||[];
   const matches=p=>{
    try{if(JSON.stringify(bodyValues(p.planningBodies))!==JSON.stringify(input.bodies))return false;}catch{return false;}
    return bindings.every(b=>{const key=b.target.key||b.target.id,r=status(p,key);return !r||(r.result===b.result&&JSON.stringify(cleanAlignment(b.target,p.recordAlignments?.[key]))===JSON.stringify(b.alignment));});
   };
   let place=sameBase.find(matches);
   if(place){if(originalPlaces.has(place.id))report.reusedPlaces++;else report.duplicatePlaces++;}
   else {place={...input.location,id:uid('point-'),recordRegistered:true,...(input.bodies?{planningBodies:input.bodies}:{})};nextFavorites.push(place);if(!placeIndex.has(signature))placeIndex.set(signature,[]);placeIndex.get(signature).push(place);changed.add(place.id);report.addedPlaces++;if(sameBase.length)report.variantPlaces++;if(input.shape)nextShapes[place.id]={latitude:place.latitude,longitude:place.longitude,shape:input.shape};}
   if(!place.recordRegistered){place.recordRegistered=true;changed.add(place.id);}
   const alignments={...(place.recordAlignments||{})};
   for(const binding of bindings){
    const t=binding.target,key=t.key||t.id;if(status(place,key))continue;
    if(binding.alignment.matchMode==='overlap'){if(Object.hasOwn(alignments,key)){delete alignments[key];changed.add(place.id);}}else {alignments[key]=binding.alignment;changed.add(place.id);}
    const pair=pairKey(place.id,key),previous=recordIndex.get(pair)||[],stamp=Math.max(now(),...previous.flatMap(r=>[r.createdAt||0,r.updatedAt||0]))+1,record=library.cleanObservation({id:uid('reg-'),placeId:place.id,target:{key,name:t.name,latitude:t.latitude,longitude:t.longitude},observer:place,registration:true,removed:false,result:binding.result,date:'',note:'',createdAt:stamp,updatedAt:stamp});if(!record)fail('対象の登録内容を確認してください');nextObservations.push(record);recordIndex.set(pair,[...previous,record]);statusCache.set(pair,record);report.addedBindings++;
   }
   if(Object.keys(alignments).length)place.recordAlignments=alignments;else delete place.recordAlignments;
   if(JSON.stringify(place).length>20000)fail('撮影地点の設定が多すぎて保存できません');
  }
  const k=library.keys(owner);return {canImport:true,unresolved:[],report,places:data.places,favorites:nextFavorites,observations:nextObservations,shapes:nextShapes,changedFavorites:[...changed],entries:[['sorami.favorites',nextFavorites],[k.observations,nextObservations],[k.shapes,nextShapes]]};
 }
 return {format:FORMAT,version:VERSION,maxBytes:5*1024*1024,bodyValues,savedBodyValues,validate,exportPlaces,prepareImport};
};
// Inside MyPlacesUI: portable registrations share the existing atomic store/sync.
let transferDialog=null,transferState=null,transferSequence=0;
const transferNode=(tag,props={},text)=>{const n=document.createElement(tag);Object.assign(n,props);if(text!=null)n.textContent=text;return n;};
const transferAllowed=()=>!!auth?.token&&toolAllowed('records')&&!!viewState.records&&(el('recordsView')?.dataset.tab||'points')==='points';
const transferOwner=()=>JSON.stringify([auth?.loginId,auth?.token,accessState.generation,auth?.tools]);
const transferStamp=()=>JSON.stringify([transferOwner(),favorites,load(),shapeData()]);
function transferPolicy(){return createRecordTransfer({library:AstroNotesLibrary,cleanFavorite,cleanShape:AstroNotesShooting.cleanShape,cleanAlignment:RecordAlignment.clean,rangeOf:RecordHeight.range,bodyIds:AstroNotesBodies.definitions.map(b=>b.id),builtins:AstroNotesAlign.TARGETS.map(aimWithHeights),currentStatus:(p,key,rows)=>statusOf(p.id,key,rows),makeId:prefix=>prefix+crypto.randomUUID()});}
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
 const button=transferNode('button',{type:'button',className:'chip record-transfer-more',id:'recordTransferOpen',title:'撮影地点の入出力'});button.setAttribute('aria-label','撮影地点の入出力');button.setAttribute('aria-haspopup','dialog');button.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';button.onclick=()=>openRecordTransfer(button);actions.append(button);
}
async function transferExport(){
 const state=transferState;if(!transferCurrent(state))return;el('recordTransferTitle').textContent='エクスポート';const content=el('recordTransferContent');content.replaceChildren();transferMessage('地点・高さ・対象・天体を保存します。');
 const rows=transferPlaces(),chosen=new Set(rows.map(p=>p.id)),tools=transferNode('div',{className:'transfer-select-tools'}),all=transferNode('button',{type:'button',className:'chip'},'全選択'),none=transferNode('button',{type:'button',className:'chip'},'全解除'),list=transferNode('div',{className:'transfer-place-list',id:'recordTransferPlaces'}),save=transferNode('button',{type:'button',className:'fav-btn primary',id:'recordTransferDownload'},'保存');
 const checks=[];const sync=()=>{for(const [id,check]of checks)check.checked=chosen.has(id);save.textContent=chosen.size+'地点を保存';save.disabled=!chosen.size;};
 for(const p of rows){const label=transferNode('label',{className:'transfer-place'}),check=transferNode('input',{type:'checkbox',checked:true}),caption=transferNode('span',{},p.name);check.value=p.id;check.onchange=()=>{if(check.checked)chosen.add(p.id);else chosen.delete(p.id);sync();};label.append(check,caption);list.append(label);checks.push([p.id,check]);}
 all.onclick=()=>{for(const p of rows)chosen.add(p.id);sync();};none.onclick=()=>{chosen.clear();sync();};tools.append(all,none);content.append(tools,list,save);sync();
 save.onclick=async()=>{
  if(!transferCurrent(state))return;save.disabled=true;
  try{await AstroNotesAssets.ensureModels();if(!transferCurrent(state))return;const live=transferPlaces();if([...chosen].some(id=>!live.some(p=>p.id===id)))throw Error('撮影地点が変更されました。開き直してください');
   const data=transferPolicy().exportPlaces({favorites,observations:load(),shapes:shapeData(),placeIds:[...chosen]}),blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='AstroNotes-撮影地点-'+new Date().toISOString().slice(0,10)+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);transferMessage(chosen.size+'地点をエクスポートしました。');
  }catch(e){if(transferCurrent(state))transferMessage(e.message||'保存できませんでした',true);}finally{if(transferCurrent(state))sync();}
 };
}
function transferImport(){
 const state=transferState;if(!transferCurrent(state))return;el('recordTransferTitle').textContent='インポート';const content=el('recordTransferContent');content.replaceChildren();
 const input=transferNode('input',{type:'file',id:'recordTransferFile',accept:'.json,application/json',hidden:true}),pick=transferNode('button',{type:'button',className:'fav-btn',id:'recordTransferChoose'},'ファイルを選ぶ'),preview=transferNode('div',{id:'recordTransferPreview'});pick.onclick=()=>input.click();content.append(pick,input,transferNode('p',{className:'tiny'},'AstroNotesでエクスポートしたJSONファイルに対応しています。'),preview);
 input.onchange=async()=>{
  const file=input.files?.[0];if(!file)return;const sequence=++transferSequence;preview.replaceChildren();pick.disabled=true;const current=()=>transferCurrent(state)&&sequence===transferSequence;
  try{
   const policy=transferPolicy();if(file.size>policy.maxBytes)throw Error('ファイルは5MB以内にしてください');const raw=await file.text();if(!current())return;const source=raw.replace(/^\uFEFF/,'').trimStart(),data=JSON.parse(source);await AstroNotesAssets.ensureModels();if(!current())return;
   const readyPolicy=transferPolicy(),stamp=transferStamp(),plan=readyPolicy.prepareImport(data,{favorites,observations:load(),shapes:shapeData(),owner:auth.loginId});
   const heading=transferNode('h3',{className:'my-title'},plan.places.length+'地点'),summary=transferNode('p',{className:'tiny',id:'recordTransferSummary'});preview.append(heading,summary);
   if(!plan.canImport){summary.textContent='対象の情報が不足しているため取り込めません。';const missing=transferNode('ul');for(const name of plan.unresolved)missing.append(transferNode('li',{},name));preview.append(missing);return;}
   const r=plan.report;summary.textContent='新しい地点 '+r.addedPlaces+'・登録済み '+r.reusedPlaces+'・対象を追加 '+r.addedTargets+'・対象の登録 '+r.addedBindings+(r.duplicatePlaces?'・ファイル内の重複 '+r.duplicatePlaces:'');
   if(r.variantPlaces)preview.append(transferNode('p',{className:'tiny'},'設定が違う'+r.variantPlaces+'地点は、別の撮影地点として追加します。'));
   if(r.addedTargets){const details=transferNode('details',{className:'my-secondary',id:'recordTransferNewTargets'});details.append(transferNode('summary',{},'追加する対象 '+r.addedTargets+'件'));for(const p of plan.favorites.filter(p=>Number.isFinite(p.targetHeightM)&&!favorites.some(f=>f.id===p.id))){const row=transferNode('div',{className:'transfer-preview-place'});row.append(transferNode('strong',{},p.name),transferNode('span',{className:'tiny'},'地上 '+p.targetHeightM+'m'+(Number.isFinite(p.elevation)?' ・ 標高 '+p.elevation+'m':'')));details.append(row);}preview.append(details);}
   const list=transferNode('div',{className:'transfer-place-list'});for(const p of plan.places){const row=transferNode('div',{className:'transfer-preview-place'}),name=transferNode('strong',{},p.location.name),sub=transferNode('span',{className:'tiny'},[p.shape?.type==='area'?'範囲':p.shape?.type==='line'?'線':'点',Number.isFinite(p.location.groundManualM??p.location.elevation)?(p.shape?'代表標高 ':'標高 ')+(p.location.groundManualM??p.location.elevation)+'m':'標高未設定',p.location.eyeHeightRangeAGL?'地上 '+p.location.eyeHeightRangeAGL.min+'〜'+p.location.eyeHeightRangeAGL.max+'m':'地上 '+(p.location.eyeHeightAGL??1.5)+'m',p.bodies?.map(id=>AstroNotesBodies.definition(id)?.name).join('・'),p.targets.length+'対象'].filter(Boolean).join(' ・ '));row.append(name,sub);list.append(row);}preview.append(list);
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

const createRecordSort=function createRecordSort({distanceKm,collator=new Intl.Collator('ja',{numeric:true,sensitivity:'base'})}){
 const MODES=[['name','名前順'],['address','住所順'],['near','近い順'],['added','追加順']],DEFAULT='added';
 const valid=mode=>MODES.some(([id])=>id===mode);
 const label=v=>typeof v==='string'?v.normalize('NFKC').trim():'';
 const point=p=>!!p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180&&!(p.latitude===0&&p.longitude===0);
 const text=(a,b)=>!a!==!b?(a?-1:1):collator.compare(a,b);
 function sort(places,mode,origin){
  const rows=places.map((place,index)=>({place,index,name:label(place?.name),address:label(place?.subtitle),km:mode==='near'&&point(origin)&&point(place)?distanceKm(origin.latitude,origin.longitude,place.latitude,place.longitude):null}));
  const added=(a,b)=>b.index-a.index,byName=(a,b)=>text(a.name,b.name)||added(a,b);
  const order={
   name:byName,
   address:(a,b)=>text(a.address,b.address)||byName(a,b),
   near:(a,b)=>!Number.isFinite(a.km)!==!Number.isFinite(b.km)?(Number.isFinite(a.km)?-1:1):(Number.isFinite(a.km)&&a.km-b.km)||byName(a,b),
   added
  }[valid(mode)?mode:DEFAULT];
  return rows.sort(order).map(r=>r.place);
 }
 return {modes:MODES.map(([id])=>id),options:MODES.map(([value,label])=>({value,label})),DEFAULT,valid,point,sort};
};
// Trial-only display order for registered places. favorites/records stay in stored order.
const recordSort=createRecordSort({distanceKm:(a,b,c,d)=>AstroNotesTerrain.distanceKm(a,b,c,d)});
const RECORD_SORT_KEY='sorami.placeSort';
// The device location is session-only and separate from the observer.
const recordSortState={origin:null,shown:null,pending:false,request:0,status:''};
function recordSortChoice(){const v=store.get(RECORD_SORT_KEY,recordSort.DEFAULT);return recordSort.valid(v)?v:recordSort.DEFAULT;}
function recordSortShown(){
 const choice=recordSortChoice();
 if(choice==='near'&&!recordSortState.origin&&typeof myPos!=='undefined'&&recordSort.point(myPos)&&Date.now()-myPos.at<120000)recordSortState.origin={latitude:myPos.latitude,longitude:myPos.longitude};
 if(choice!=='near'||recordSortState.origin)return choice;
 return recordSortState.shown&&recordSortState.shown!=='near'?recordSortState.shown:recordSort.DEFAULT;
}
function sortRecordPlaces(places){const mode=recordSortShown();recordSortState.shown=mode;return recordSort.sort(places,mode,recordSortState.origin);}
function recordSortRefresh(id,rerender){const had=document.activeElement?.id===id;rerender();if(had)document.getElementById(id)?.focus({preventScroll:true});}
function chooseRecordSort(mode,id,rerender){
 const request=++recordSortState.request;recordSortState.status='';recordSortState.pending=false;
 if(!recordSort.valid(mode))mode=recordSort.DEFAULT;
 if(mode!=='near'){store.set(RECORD_SORT_KEY,mode);recordSortState.shown=mode;recordSortRefresh(id,rerender);return;}
 const fail=()=>{if(request!==recordSortState.request)return;recordSortState.pending=false;recordSortState.status='現在地を取得できませんでした';recordSortRefresh(id,rerender);};
 if(!navigator.geolocation||typeof locateMe!=='function'){fail();return;}
 recordSortState.pending=true;recordSortState.status='現在地を取得中…';recordSortRefresh(id,rerender);
 locateMe().then(pos=>{
  if(request!==recordSortState.request)return;
  if(!recordSort.point(pos)){fail();return;}
  recordSortState.origin={latitude:pos.latitude,longitude:pos.longitude};recordSortState.pending=false;recordSortState.status='';
  store.set(RECORD_SORT_KEY,'near');recordSortState.shown='near';recordSortRefresh(id,rerender);
 },fail);
}
function recordSortControl(id,rerender){
 const select=document.createElement('select');select.className='fav-in record-sort-select';select.id=id;select.setAttribute('aria-label','並び順');
 for(const o of recordSort.options)select.append(new Option(o.label,o.value));
 const choice=recordSortChoice(),shown=recordSortShown();
 select.value=recordSortState.pending?'near':recordSortState.status?shown:choice;
 select.onchange=()=>chooseRecordSort(select.value,id,rerender);
 const nodes=[select];
 if(choice==='near'&&shown!=='near'&&!recordSortState.pending&&!recordSortState.status){const locate=document.createElement('button');locate.type='button';locate.className='chip record-sort-locate';locate.id=id+'Locate';locate.textContent='現在地で並べる';locate.onclick=()=>chooseRecordSort('near',id,rerender);nodes.push(locate);}
 if(recordSortState.status){const status=document.createElement('p');status.className='tiny record-sort-status';status.id=id+'Status';status.setAttribute('role','status');status.textContent=recordSortState.status;nodes.push(status);}
 return nodes;
}

const createOpportunityScan=function createOpportunityScan({pairs,start,end,notBefore=start,pageRows=Infinity,solve,isCurrent,ahead=()=>1,onStart=()=>{},onProgress=()=>{},onDay=()=>{},yieldTask=()=>new Promise(r=>setTimeout(r,0))}){
 const dayMs=86400000;
 const state={day:start,end,rowLimit:pageRows,index:0,checked:0,total:Math.ceil((end-start)/dayMs)*pairs.length,through:start,rows:[],pending:[],failures:[],done:false,running:false,cancelled:false};
 const seen=new Set(),flights=new Map();
 const started=(day,index)=>{const key=day+':'+index;if(!flights.has(key)){let p;try{p=Promise.resolve(solve(pairs[index],day,isCurrent));}catch(error){p=Promise.reject(error);}p.catch(()=>{});flights.set(key,p);}return flights.get(key);};
 async function advance(){
  if(state.running||state.done||state.cancelled)return state;
  state.running=true;
  try{
   onStart(state);
   if(!pairs.length){state.done=true;state.through=state.end;onDay(state);return state;}
   while(state.day<state.end){
    if(!isCurrent()){state.cancelled=true;return state;}
    const pair=pairs[state.index];let result;
    for(let k=state.index,last=Math.min(pairs.length,state.index+Math.max(1,ahead()|0));k<last;k++)started(state.day,k);
    const flight=started(state.day,state.index);flights.delete(state.day+':'+state.index);
    try{result=await flight;}catch(error){if(!isCurrent()){state.cancelled=true;return state;}result={rows:[],failed:1};}
    if(!isCurrent()||result?.cancelled){state.cancelled=true;return state;}
    if(result?.failed)state.failures.push({pairId:pair.id,day:state.day});
    for(const row of result?.rows||[]){
     const at=row.event?.at;
     if(!Number.isFinite(at)||at<Math.max(state.day,notBefore)||at>=Math.min(state.end,state.day+dayMs))continue;
     const id=JSON.stringify([pair.id,at,row.place?.latitude,row.place?.longitude,row.place?.groundManualM,row.place?.eyeHeightAGL]);
     if(seen.has(id))continue;seen.add(id);state.pending.push({...row,id,pairId:pair.id,body:pair.body,target:pair.target,sourcePlaceId:pair.sourcePlaceId});
    }
    state.checked++;state.index++;
    if(state.index===pairs.length){
     state.pending.sort((a,b)=>a.event.at-b.event.at||a.place.name.localeCompare(b.place.name,'ja')||a.target.name.localeCompare(b.target.name,'ja'));
     state.rows.push(...state.pending);state.pending=[];state.day+=dayMs;state.index=0;state.through=state.day;
     if(state.rows.length>=state.rowLimit){state.end=Math.min(state.end,state.day);state.total=state.checked;}
     onDay(state);
    }
    onProgress(state);
    if(state.day>=state.end){state.done=true;return state;}
    await yieldTask();
    if(!isCurrent()){state.cancelled=true;return state;}
   }
   state.done=true;return state;
  }finally{state.running=false;}
 }
 function extend(end,rows=pageRows){
  if(!state.done||state.running||state.cancelled||!pairs.length||!Number.isFinite(end)||end<=state.day)return false;
  state.end=end;state.rowLimit=state.rows.length+rows;state.done=false;
  state.total=state.checked+Math.ceil((end-state.day)/dayMs)*pairs.length;
  return true;
 }
 return {state,advance,extend};
};
const createRecordSearchCache=function createRecordSearchCache({limit=768,copy=structuredClone}={}){
 const results=new Map(),jobs=new Map(),cancelled=()=>({rows:[],failed:0,cancelled:true});
 const stats={hits:0,solves:0,joins:0};
 async function read(key,solve,current){
  if(!current())return cancelled();
  if(results.has(key)){const value=results.get(key);results.delete(key);results.set(key,value);stats.hits++;return copy(value);}
  let job=jobs.get(key);
  // An obsolete caller may still await I/O. It cannot hold a new search open.
  if(job&&![...job.watchers].some(w=>w()))job=null;
  const joined=!!job;
  if(job)stats.joins++;
  else{
   job={watchers:new Set()};jobs.set(key,job);
   const live=()=>[...job.watchers].some(w=>w());
   job.promise=Promise.resolve().then(()=>{if(!live())return cancelled();stats.solves++;return solve(live);}).then(value=>{
    if(live()&&!value.cancelled&&!value.failed&&!value.issues?.length&&value.rows.length<=256){results.set(key,copy(value));while(results.size>limit)results.delete(results.keys().next().value);}
    return value;
   }).finally(()=>{if(jobs.get(key)===job)jobs.delete(key);});
  }
  const watch=()=>current();job.watchers.add(watch);
  try{const value=await job.promise;if(!current())return cancelled();return joined&&value.cancelled?read(key,solve,current):copy(value);}
  finally{job.watchers.delete(watch);}
 }
 return {read,stats};
};
// One in-memory calculation session for both registered-place screens.
let recordSearchSession=null,recordIndexMemo=null;
const recordSearchFrame=()=>{
 let yielded=performance.now(),pending=null,finish=null,timer=null,ticket=0;
 const wake=id=>{if(!pending||id!==ticket)return;const done=finish;finish=null;pending=null;if(timer!==null)clearTimeout(timer);timer=null;yielded=performance.now();done();};
 const channel=new MessageChannel();channel.port1.onmessage=e=>wake(e.data);
 // A mobile page can suspend while its posted task is still pending. Neither
 // all future searches nor foreground recovery may depend on that one task.
 const resume=()=>{if(typeof document==='undefined'||!document.hidden)wake(ticket);};
 if(typeof document!=='undefined')document.addEventListener('visibilitychange',resume);
 globalThis.addEventListener?.('pageshow',resume);globalThis.addEventListener?.('focus',resume);
 return ()=>{
  if(pending)return pending;if(performance.now()-yielded<8)return Promise.resolve();
  const id=++ticket;pending=new Promise(resolve=>{finish=resolve;});
  timer=setTimeout(()=>wake(id),50);channel.port2.postMessage(id);return pending;
 };
};
const recordSearchYield=recordSearchFrame();
const recordSearchScope=()=>[auth?.token,auth?.loginId,accessState.generation,version,JSON.stringify([auth?.tools,aimAirSettings]),AstroNotesAtmosphere.dataKey(),globalThis.AstroNotesTowerModels,globalThis.AstroNotesCityModels];
const recordSameScope=(a,b)=>a?.length===b.length&&a.every((v,i)=>v===b[i]);
function recordSearchIndex(){
 const scope=[auth?.token,auth?.loginId,accessState.generation,version];
 if(!recordSameScope(recordIndexMemo?.scope,scope)){
  const records=load(),groups=new Map(),shapes=shapeData();
  for(const record of records){
   let targets=groups.get(record.placeId);if(!targets){targets=new Map();groups.set(record.placeId,targets);}
   let group=targets.get(record.target.key);if(!group){group=[];targets.set(record.target.key,group);}group.push(record);
  }
  recordIndexMemo={scope,records,groups,shapes};
 }
 return recordIndexMemo;
}
function recordSearchShape(f,shapes){const r=shapes[f.id];return r&&r.latitude===f.latitude&&r.longitude===f.longitude?AstroNotesShooting.cleanShape(r.shape):null;}
function recordBounded(map,key,build,limit){
 if(map.has(key)){const value=map.get(key);map.delete(key);map.set(key,value);return value;}
 const value=build();map.set(key,value);while(map.size>limit)map.delete(map.keys().next().value);return value;
}
// 2026-11-09 重なる日の一覧（opportunity）は、建物を位置ごとに1つの外形（輪郭点の凸包）で判定する
// （ユーザー「計算で使うのは一つの地点で一つの建物の縁とか稜線でいい。正確な見え方は見え方でわかる」）。
// 外形と山頂の稜線は日付・天体に依存しない。渡された分を使い、新しく作った分は呼び出し元へ返して
// 記録と一緒に同期する。見え方・探すの計算はこれを使わない。
const recordGeometry={known:new Map(),used:new Map(),collect:false};
function recordSilhouette(obs,target,opts){
 const key='sil:'+JSON.stringify([obs.latitude,obs.longitude,obs.elevation??0,opts.eyeM??1.5,target.id??null,target.latitude,target.longitude,target.groundM??null,(target.parts||[]).map(p=>[p.id,p.m]),opts.heightM??null,AstroNotesAtmosphere.targetK()]);
 if(recordGeometry.known.has(key)){const hit=recordGeometry.known.get(key);recordGeometry.used.set(key,hit);return hit;}
 const outline=AstroNotesAlign.towerOutline(obs,target,{eyeM:opts.eyeM??1.5,heightM:opts.heightM??null});
 let value=null;
 if(outline){const polygon=AstroNotesAlign.convexHull(outline.hitPolygons?outline.hitPolygons.flat():outline.hitPoints||outline.points||[]);if(polygon.length>=3&&Number.isFinite(outline.viewBaseAngle)&&Number.isFinite(outline.topAngle))value={viewBaseAngle:outline.viewBaseAngle,topAngle:outline.topAngle,approximate:!!outline.approximate,polygon};}
 recordGeometry.known.set(key,value);recordGeometry.used.set(key,value);return value;
}
// 2026-11-09 線・範囲の地点も一覧に出す（ユーザー「範囲とか線の時も出るようにできないの？」）。
// 立ち位置ごとの地面の高さと、そこから見た稜線・建物の外形は日付に依存しないので、範囲ごとに一度
// 作り、記録と一緒に同期する（"shp:"、立ち位置16個ずつ）。太陽・月の通り道は範囲内のどこでも
// ほぼ同じ（1km動いても月の直径の約3500分の1）なので、日ごとには代表点で1本だけ求め、
// 通り道が外形の近くを通る立ち位置だけを1点ずつの判定（見え方と同じ計算）で確かめる。
// 立ち位置の間隔は見え方の25mが基準で、対象が遠いほど広げる（対象の向きの変化が太陽の直径の1/4以内）。
const RECORD_SHAPE_MIN_STEP_M=25,RECORD_SHAPE_MAX_STEP_M=400,RECORD_SHAPE_STEP_RAD=.0023,RECORD_SHAPE_LIMIT=12000,RECORD_SHAPE_BLOCK=16,RECORD_SHAPE_UNIT=1e-4,RECORD_SHAPE_TOLERANCE=1e-3,RECORD_SHAPE_TRACK_MS=240000;
const recordShapeMemo=new Map();
function recordHash(text){
 let a=0x811c9dc5,b=0x9747b28c;
 for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);a=Math.imul(a^c,0x01000193);b=Math.imul(b^c,0x5bd1e995);b^=b>>>15;}
 return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
}
function recordShapeStep(s,target){
 const v=s.vertices,k=Math.cos(target.latitude*Math.PI/180),xy=p=>[(p.longitude-target.longitude)*111195*k,(p.latitude-target.latitude)*111195];
 let near=Infinity;
 const edge=(a,b)=>{const [ax,ay]=xy(a),[bx,by]=xy(b),dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy||1)));near=Math.min(near,Math.hypot(ax+t*dx,ay+t*dy));};
 for(let i=1;i<v.length;i++)edge(v[i-1],v[i]);
 if(s.type==='area'){edge(v[v.length-1],v[0]);if(AstroNotesShooting.shapeContains(s,target))near=0;}
 return Math.round(Math.max(RECORD_SHAPE_MIN_STEP_M,Math.min(RECORD_SHAPE_MAX_STEP_M,near*RECORD_SHAPE_STEP_RAD)));
}
// The preview's sampling (AstroNotesShooting.shapePaths) with a given step; 25 m gives the same points.
function recordShapePoints(s,step){
 const S=AstroNotesShooting,v=s.vertices,paths=[];let total=0;
 const add=(a,b)=>{const n=Math.max(1,Math.ceil(S.meters(a,b)/step));total+=n+1;if(total>RECORD_SHAPE_LIMIT)throw Error('shape-limit');paths.push(Array.from({length:n+1},(_,i)=>S.interpolate(a,b,i/n)));};
 for(let i=1;i<v.length;i++)add(v[i-1],v[i]);
 if(s.type==='area'){
  add(v[v.length-1],v[0]);
  const low=Math.min(...v.map(p=>p.latitude)),high=Math.max(...v.map(p=>p.latitude)),n=Math.max(1,Math.ceil((high-low)*111195/step));
  if(n>RECORD_SHAPE_LIMIT)throw Error('shape-limit');
  for(let row=1;row<n;row++){
   const latitude=low+(high-low)*row/n,x=[];
   for(let i=0,j=v.length-1;i<v.length;j=i++)if((v[i].latitude>latitude)!==(v[j].latitude>latitude))x.push(v[i].longitude+(v[j].longitude-v[i].longitude)*(latitude-v[i].latitude)/(v[j].latitude-v[i].latitude));
   x.sort((a,b)=>a-b);for(let i=0;i+1<x.length;i+=2)add({latitude,longitude:x[i]},{latitude,longitude:x[i+1]});
  }
 }
 const seen=new Map(),points=[];
 const order=paths.map(path=>path.map(q=>{const key=q.latitude.toFixed(9)+','+q.longitude.toFixed(9);if(!seen.has(key)){seen.set(key,points.length);points.push(q);}return seen.get(key);}));
 return {points,paths:order};
}
// Douglas-Peucker within 0.001° (0.4% of the sun's radius), then integers of 0.0001°.
function recordSimplify(points,closed){
 if(points.length<=3)return points.slice();
 const ref=points[0][0],k=Math.cos(points.reduce((s,p)=>s+p[1],0)/points.length*Math.PI/180),xy=points.map(([a,h])=>[(((a-ref)%360+540)%360-180)*k,h]),keep=new Uint8Array(points.length);
 const rdp=(i,j)=>{
  let best=-1,far=0;const [ax,ay]=xy[i],[bx,by]=xy[j],dx=bx-ax,dy=by-ay,len=Math.hypot(dx,dy);
  for(let m=i+1;m<j;m++){const [px,py]=xy[m],d=len?Math.abs(dx*(ay-py)-dy*(ax-px))/len:Math.hypot(px-ax,py-ay);if(d>far){far=d;best=m;}}
  if(best>=0&&far>RECORD_SHAPE_TOLERANCE){keep[best]=1;rdp(i,best);rdp(best,j);}
 };
 keep[0]=keep[points.length-1]=1;
 if(closed){let far=-1,m=1;for(let i=1;i<points.length;i++){const d=Math.hypot(xy[i][0]-xy[0][0],xy[i][1]-xy[0][1]);if(d>far){far=d;m=i;}}keep[m]=1;rdp(0,m);rdp(m,points.length-1);}
 else rdp(0,points.length-1);
 return points.filter((_,i)=>keep[i]);
}
const recordQ=v=>Math.round(v/RECORD_SHAPE_UNIT);
// 'r' summit ridge (or the whole ridge when the summit is hidden), 's' building outline,
// 'p' a target without an outline (a point), 'm' the full model (outline could not be reduced).
function recordShapeEncode(geo){
 if(geo.kind==='p'||geo.kind==='m')return geo.kind;
 const out=geo.kind==='r'?['r',recordQ(geo.base)]:['s',recordQ(geo.viewBaseAngle),recordQ(geo.topAngle),geo.approximate?1:0];
 let pa=0,ph=0;for(const [a,h] of recordSimplify(geo.points,geo.kind==='s')){const qa=recordQ(a),qh=recordQ(h);out.push(qa-pa,qh-ph);pa=qa;ph=qh;}
 return out;
}
function recordShapeDecode(q){
 if(q==='p'||q==='m')return {kind:q};
 if(!Array.isArray(q)||q.length>4000||(q[0]!=='r'&&q[0]!=='s'))return null;
 const head=q[0]==='r'?2:4,min=q[0]==='r'?2:3;
 if(q.length<head+2*min||(q.length-head)%2||!q.slice(1).every(Number.isSafeInteger)||(head===4&&q[3]!==0&&q[3]!==1))return null;
 const U=RECORD_SHAPE_UNIT,points=[];let a=0,h=0;for(let i=head;i<q.length;i+=2){a+=q[i];h+=q[i+1];points.push([a*U,h*U]);}
 return q[0]==='r'?{kind:'r',base:q[1]*U,points}:{kind:'s',viewBaseAngle:q[1]*U,topAngle:q[2]*U,approximate:q[3]===1,points};
}
function recordShapeBlockValid(value){
 if(!value||!Number.isInteger(value.i0)||value.i0<0||!Array.isArray(value.g)||!Array.isArray(value.q)||!value.g.length||value.g.length>RECORD_SHAPE_BLOCK||value.g.length!==value.q.length)return false;
 return value.g.every((g,i)=>Number.isFinite(g)&&!!recordShapeDecode(value.q[i]));
}
// Angular region holding the outline as seen from one position: azimuth span about c, altitude lo..hi.
// Great-circle edges bulge past their end points by at most (span)^2/16 radians.
function recordShapeBox(geo,g){
 if(geo.kind==='m')return null;
 if(geo.kind==='p')return {c:g.azimuth,w:0,lo:g.angle,hi:g.angle};
 const ref=geo.points[0][0];let a0=Infinity,a1=-Infinity,lo=geo.kind==='r'?geo.base:Infinity,hi=-Infinity;
 for(const [a,h] of geo.points){const d=(((a-ref)%360+540)%360)-180;a0=Math.min(a0,d);a1=Math.max(a1,d);lo=Math.min(lo,h);hi=Math.max(hi,h);}
 const w=(a1-a0)/2,bulge=(w*Math.PI/90)**2/16*180/Math.PI;
 return {c:ref+(a0+a1)/2,w,lo:lo-bulge,hi:hi+bulge};
}
// Exact spherical distance (degrees) from a direction to that region.
function recordBoxDistance(az,alt,b){
 const da=Math.abs((((az-b.c)%360+540)%360)-180)-b.w;
 if(da<=0)return alt>b.hi?alt-b.hi:alt<b.lo?b.lo-alt:0;
 if(da>=90)return 90;
 const D=Math.PI/180,phi=alt*D,dz=da*D,foot=Math.atan2(Math.sin(phi),Math.cos(phi)*Math.cos(dz))/D;
 if(foot>=b.lo&&foot<=b.hi)return Math.asin(Math.min(1,Math.cos(phi)*Math.sin(dz)))/D;
 const a2=(foot>b.hi?b.hi:b.lo)*D;
 return Math.acos(Math.max(-1,Math.min(1,Math.sin(phi)*Math.sin(a2)+Math.cos(phi)*Math.cos(a2)*Math.cos(dz))))/D;
}
const recordArc=(a,b)=>{const D=Math.PI/180;return Math.acos(Math.max(-1,Math.min(1,Math.sin(a.alt*D)*Math.sin(b.alt*D)+Math.cos(a.alt*D)*Math.cos(b.alt*D)*Math.cos((a.az-b.az)*D))))/D;};
// What one position's daily check uses (aimShootingView's summit cap, recordSilhouette's outline),
// without adding per-position entries to the synced geometry.
async function recordShapeGeometry(obs,target){
 if(aimIsMountain(target)){
  const eye=obs.elevation+obs.eyeM,fuji=target.id==='fuji';let cap=null;
  if(fuji){const collect=recordGeometry.collect;let pending;recordGeometry.collect=false;try{pending=aimIndexedCap(obs,eye,target);}finally{recordGeometry.collect=collect;}try{cap=await pending;}catch{/* The original sampler below. */}}
  if(!cap){const ridge=await aimLookRidge(obs,eye,target,{exactSearch:fuji});if(!ridge)throw Error('山の稜線を取得できませんでした');cap=aimSummitCap(ridge,obs,eye,target)||{ridge,base:0};}
  return {kind:'r',base:cap.base,points:cap.ridge};
 }
 const outline=AstroNotesAlign.towerOutline(obs,target,{eyeM:obs.eyeM??1.5,heightM:null});
 if(!outline)return {kind:'p'};
 const polygon=AstroNotesAlign.convexHull(outline.hitPolygons?outline.hitPolygons.flat():outline.hitPoints||outline.points||[]);
 return polygon.length>=3&&Number.isFinite(outline.viewBaseAngle)&&Number.isFinite(outline.topAngle)?{kind:'s',viewBaseAngle:outline.viewBaseAngle,topAngle:outline.topAngle,approximate:!!outline.approximate,points:polygon}:{kind:'m'};
}
async function recordShapeOpportunity(session,p,place,record,solver,live){
 const S=AstroNotesShooting,DAY=86400000,s=S.cleanShape(place.shape),target=p.target,o=S.searchOptions(p,aimIsMountain),start=S.day(p.at);
 if(!s)return {rows:[],failed:1,issues:[{id:place.id,reason:'invalid'}]};
 const cancelled={rows:[],failed:0,cancelled:true};
 try{
  const step=recordShapeStep(s,target),{points,paths}=recordShapePoints(s,step),mountain=aimIsMountain(target);
  const base=recordHash(JSON.stringify(['astronotes.shape-geometry.v1',s.type,s.vertices,step,target.id??null,target.latitude,target.longitude,target.groundM??null,(target.parts||[]).map(x=>[x.id,x.m]),!!target.rim,place.eyeHeightAGL??null,place.standAglM??null,place.stand??null,o.partId,aimIsMountain(target),AstroNotesAtmosphere.targetK()]));
  let memo=recordShapeMemo.get(base);
  if(!memo||memo.count!==points.length){
   const blocks=[];
   for(let i0=0;i0<points.length;i0+=RECORD_SHAPE_BLOCK){
    const key='shp:'+base+':'+i0,known=recordGeometry.known.get(key);
    if(recordShapeBlockValid(known)&&known.i0===i0&&known.g.length===Math.min(RECORD_SHAPE_BLOCK,points.length-i0)){blocks.push([key,known,true]);continue;}
    // A position whose ground could not be read is retried later and never kept or synced.
    const value={i0,g:[],q:[]};let complete=true;
    for(let i=i0;i<Math.min(points.length,i0+RECORD_SHAPE_BLOCK);i++){
     if(!live())return cancelled;
     const ground=await solver.elevationAt(points[i].latitude,points[i].longitude);
     if(!Number.isFinite(ground)){complete=false;value.g.push(null);value.q.push(null);continue;}
     const f={...place,...points[i],elevation:ground,groundManualM:ground,sourcePlaceId:place.id};delete f.shape;
     value.g.push(ground);value.q.push(recordShapeEncode(await recordShapeGeometry(aimObserverAt(aimSavedFrom(f),ground),target)));
     await recordSearchYield();
    }
    if(complete)recordGeometry.known.set(key,value);blocks.push([key,value,complete]);
   }
   memo={count:points.length,blocks,geometry:blocks.flatMap(([,value])=>value.q.map(q=>q===null?null:recordShapeDecode(q)))};
   if(blocks.every(b=>b[2])){recordShapeMemo.set(base,memo);while(recordShapeMemo.size>64)recordShapeMemo.delete(recordShapeMemo.keys().next().value);}
  }
  for(const [key,value,complete] of memo.blocks)if(complete)recordGeometry.used.set(key,value);
  const grounds=memo.blocks.flatMap(([,value])=>value.g),samples=[];let missing=0;
  for(let i=0;i<points.length;i++){
   const ground=grounds[i],geo=memo.geometry[i];if(ground===null||!geo){missing++;continue;}
   const f={...place,...points[i],elevation:ground,groundManualM:ground,sourcePlaceId:place.id};delete f.shape;
   const obs=aimObserverAt(aimSavedFrom(f),ground),g=AstroNotesAlign.geometryFrom(obs,target,{partId:o.partId,eyeM:obs.eyeM});
   // A narrow alignment between two positions is refined from both (below), so each position's
   // margin also covers how far the outline moves to the next position.
   const shift=g&&!mountain?Math.min(10,step/(g.distanceKm*1000)*(1+Math.abs(Math.tan(g.angle*Math.PI/180)))*180/Math.PI):0;
   samples.push({i,f,obs,geo,shift,box:g?recordShapeBox(geo,g):null});
  }
  if(!samples.length)return {rows:[],failed:missing?1:0,checked:0,stepM:step,...(missing?{issues:[{id:place.id,reason:'elevation',count:missing}]}:{})};
  await AstroNotesBodies.ensure(p.body);if(!live())return cancelled;
  // One path of the body per day, from the first position.
  const anchor=samples[0].obs,eyeObs={...anchor,elevation:anchor.elevation+anchor.eyeM},track=[];
  for(let at=start-RECORD_SHAPE_TRACK_MS;at<=start+DAY+RECORD_SHAPE_TRACK_MS;at+=RECORD_SHAPE_TRACK_MS){
   const st=AstroNotesBodies.state(p.body,at,eyeObs),up=st.upperAltitude??st.apparentAltitude+st.angularRadius,low=st.lowerAltitude??st.apparentAltitude-st.angularRadius;
   track.push({az:st.azimuth,alt:st.apparentAltitude,up,r:Math.max(st.angularRadius,up-st.apparentAltitude,st.apparentAltitude-low)+.01});
  }
  for(let i=0;i<track.length;i++)track[i].half=Math.max(i?recordArc(track[i-1],track[i]):0,i+1<track.length?recordArc(track[i],track[i+1]):0)/2;
  // Directions differ between positions by the vertical's tilt (0.009°/km), the moon's parallax
  // and refraction at another height; the margin covers all of them.
  const best=new Map(),evaluated=new Map();let checked=0;
  const optsOf=(obs,geo)=>geo.kind==='r'?{partId:null,eyeM:obs.eyeM,ridge:geo.points,ridgeBase:geo.base}:{partId:o.partId,eyeM:obs.eyeM,...(geo.kind==='s'?{silhouette:{viewBaseAngle:geo.viewBaseAngle,topAngle:geo.topAngle,approximate:geo.approximate,polygon:geo.points}}:{})};
  const consider=(events,f,obs)=>{
   for(const e of events){
    if(o.broad){e.matchMode='overlap';e.partId=o.partId;}
    if(!(e.at>=start&&e.at<start+DAY&&e.spatialMatched!==false&&(!Number.isFinite(e.altitude)||o.disc||e.altitude>0)&&S.matches(e,p,aimIsMountain)&&S.shapeContains(s,f)))continue;
    // The trial keeps daytime moons (build-candidate-trial). One row per side of the day:
    // the position where the body sits deepest in the outline.
    const now=best.get(e.side);
    if(!now||e.distanceToTarget<now.event.distanceToTarget||e.distanceToTarget===now.event.distanceToTarget&&e.at<now.event.at)best.set(e.side,{place:f,record,event:e,assumedObserver:obs,shapeType:s.type});
   }
  };
  for(const sample of samples){
   const margin=.05+sample.shift+.015*AstroNotesTerrain.distanceKm(anchor.latitude,anchor.longitude,sample.obs.latitude,sample.obs.longitude)+1e-4*Math.abs(sample.obs.elevation+sample.obs.eyeM-eyeObs.elevation);
   if(sample.box&&!track.some(t=>t.up+t.half+margin>0&&recordBoxDistance(t.az,t.alt,sample.box)<=t.r+t.half+margin))continue;
   if(!live())return cancelled;
   const {f,obs,geo}=sample,view=recordBounded(session.shapeSamples,base+':'+sample.i+':'+p.body,()=>AstroNotesAlign.prepareDailyView(obs,target,p.body,optsOf(obs,geo)),4096);
   const events=view(start);checked++;evaluated.set(sample.i,{f,events});consider(events,f,obs);
   if(checked%16===0)await recordSearchYield();
  }
  // As the preview does: where the body passes the top between two neighbouring positions
  // (its height minus the top's changes sign), halve the gap and check there. A narrow figure
  // can be met only between positions. Only for a side of the day still without a match, and
  // not for mountains, whose positions are spaced well inside the summit's width.
  if(!mountain)for(const path of paths)for(let k=1;k<path.length;k++){
   const A=evaluated.get(path[k-1]),B=evaluated.get(path[k]);if(!A||!B)continue;
   for(const a of A.events){
    if(best.has(a.side))continue;
    const near=list=>list.find(e=>e.side===a.side&&Math.abs(e.at-a.at)<3*3600000),b=near(B.events);
    if(!b||!Number.isFinite(a.gap)||!Number.isFinite(b.gap)||a.gap*b.gap>=0)continue;
    let left=A.f,right=B.f,le=a;
    for(let n=0;n<20&&S.meters(left,right)>.05&&!best.has(a.side);n++){
     if(!live())return cancelled;
     const position=S.interpolate(left,right,.5),ground=await solver.elevationAt(position.latitude,position.longitude);if(!Number.isFinite(ground))break;
     const f={...place,...position,elevation:ground,groundManualM:ground,sourcePlaceId:place.id};delete f.shape;
     const obs=aimObserverAt(aimSavedFrom(f),ground),geo=recordShapeDecode(recordShapeEncode(await recordShapeGeometry(obs,target)));
     const events=AstroNotesAlign.prepareDailyView(obs,target,p.body,optsOf(obs,geo))(start);consider(events,f,obs);checked++;
     const me=near(events);if(!me||!Number.isFinite(me.gap))break;
     if(le.gap*me.gap<=0)right=f;else{left=f;le=me;}
    }
   }
  }
  return {rows:[...best.values()].sort((a,b)=>a.event.at-b.event.at),failed:missing?1:0,checked:samples.length,candidates:checked,stepM:step,...(missing?{issues:[{id:place.id,reason:'elevation',count:missing}]}:{})};
 }catch(e){
  if(!live())return cancelled;
  return {rows:[],failed:1,issues:[{id:place.id,reason:e.message==='shape-limit'?'limit':'calculation'}]};
 }
}
function recordPrepared(session,shaped,obs,target,body,opts){
 const views=shaped?session.shapeViews:session.pointViews,key=JSON.stringify([obs,target,body,opts]);
 return recordBounded(views,key,()=>{session.prepares++;return AstroNotesAlign.prepareDailyView(obs,target,body,opts);},shaped?128:192);
}
function recordSolverFor(session,variant,shaped,override){
 const terrain=override||session.terrain,align=Object.create(AstroNotesAlign);
 const prepare=(obs,target,body,opts)=>{const silhouette=variant==='opportunity'&&!aimIsMountain(target)?recordSilhouette(obs,target,opts):null;return recordPrepared(session,shaped,obs,target,body,silhouette?{...opts,silhouette}:opts);};
 align.prepareDailyView=prepare;
 align.dailyView=(obs,target,body,day,{at,...opts}={})=>prepare(obs,target,body,opts)(day,at);
 const viewFor=(obs,p,indexed=false)=>{
  if(p.matchMode==='overlap'&&aimIsMountain(p.target)){
   if(indexed&&p.target.id==='fuji')return aimShootingView(obs,p.target,p.body,p.partId,p.matchMode,true);
   // Keep the registered-point set across date/body switches. Dense line/area
   // samples have a separate, smaller budget and cannot evict these views.
   const views=shaped?session.shapeMountains:session.mountains,key=JSON.stringify([obs,p.target,p.body,p.partId,p.matchMode]);
   return recordBounded(views,key,()=>{
    const pending=aimShootingView(obs,p.target,p.body,p.partId,p.matchMode).catch(e=>{if(views.get(key)===pending)views.delete(key);throw e;});
    return pending;
   },shaped?96:384);
  }
  // Explore's original spatial branch computes an exact gap for its crossing probes.
  // Keep that branch while sharing its prepareDailyView through align.dailyView.
  if(shaped&&variant==='discovery')return null;
  const o=AstroNotesShooting.searchOptions(p,aimIsMountain);
  if(!(o.broad&&o.disc||o.partId==='__whole'&&!aimIsMountain(p.target)))return null;
  return prepare(obs,p.target,p.body,{partId:o.partId,eyeM:obs.eyeM});
 };
 const elevationAt=(lat,lon)=>{
  const key=lat+','+lon;
  return recordBounded(terrain,key,()=>candidateElevation(lat,lon).then(value=>{if(!Number.isFinite(value))terrain.delete(key);return value;}),12000);
 };
 const solver=recordHeightSolver({align,observerAt:(f,g)=>aimObserverAt(aimSavedFrom(f),g),ensure:b=>AstroNotesBodies.ensure(b),viewFor,fixedViewFor:(obs,p)=>viewFor(obs,p,true),yieldTask:recordSearchYield,elevationAt});
 solver.elevationAt=elevationAt;return solver;
}
async function recordSearch(plan,entries,{isCurrent=()=>true,variant='discovery',terrainCache,onProgress=()=>{}}={}){
 const cancelled=()=>({rows:[],failed:0,cancelled:true});
 if(!isCurrent())return cancelled();
 const owner=auth?.token,loginId=auth?.loginId,generation=accessState.generation,revision=version;
 if(!owner||!toolAllowed('records'))return cancelled();
 const p=AstroNotesShooting.conditions(plan);if(!p)return {rows:[],failed:0};
 if(entries.length&&!AstroNotesAssets.modelsReady()){await AstroNotesAssets.ensureModels();if(!isCurrent()||owner!==auth?.token||loginId!==auth?.loginId||generation!==accessState.generation||revision!==version||!toolAllowed('records'))return cancelled();}
 const start=AstroNotesShooting.day(p.at),scope=recordSearchScope(),air=AstroNotesAtmosphere.dataKey(start);
 if(!recordSameScope(recordSearchSession?.scope,scope))recordSearchSession={scope,cache:createRecordSearchCache(),pointViews:new Map(),shapeViews:new Map(),mountains:new Map(),shapeMountains:new Map(),shapeSamples:new Map(),terrain:new Map(),solvers:new Map(),prepares:0};
 const session=recordSearchSession,current=()=>isCurrent()&&recordSearchSession===session&&recordSameScope(scope,recordSearchScope())&&air===AstroNotesAtmosphere.dataKey(start)&&toolAllowed('records');
 const planKey=JSON.stringify([start,air,p.target,p.body,p.partId,p.limb,p.matchMode]),rows=[],issues=[];
 let failed=0,checked=0,processed=0,stepM;
 for(const entry of entries){
  if(!current())return cancelled();
  const shaped=!!entry.place.shape,kind=shaped?variant:'point',solverKey=kind+(shaped?':shape':'');
  let solver=terrainCache?null:session.solvers.get(solverKey);
  if(!solver){solver=recordSolverFor(session,variant,shaped,terrainCache);if(!terrainCache)session.solvers.set(solverKey,solver);}
  const {discoveryKey,discoveryRecordIds,...place}=entry.place;
  const key=planKey+'|'+kind+'|'+JSON.stringify(Object.entries(place).sort(([a],[b])=>a.localeCompare(b)));
  const solve=async live=>{
   const value=variant==='opportunity'&&place.shape&&place.eyeHeightRangeAGL==null?await recordShapeOpportunity(session,{...p,at:start},place,entry.record,solver,live):await solver.candidates({...p,at:start},[{place,record:entry.record}],{isCurrent:live});
   const result=Array.isArray(value)?{rows:value,failed:0}:value;
   return {...result,rows:(result.rows||[]).map(({record,...row})=>row)};
  };
  const result=terrainCache?await solve(current):await session.cache.read(key,solve,current);
  if(!current()||result.cancelled)return cancelled();
  rows.push(...result.rows.map(row=>({...row,record:entry.record,...(discoveryKey?{place:{...row.place,discoveryKey,discoveryRecordIds}}:{})})));
  failed+=result.failed||0;checked+=result.checked||0;stepM=result.stepM??stepM;issues.push(...(result.issues||[]));
  onProgress({checked:++processed,total:entries.length});
  await recordSearchYield();
 }
 if(!current())return cancelled();
 rows.sort((a,b)=>a.event.at-b.event.at||a.place.name.localeCompare(b.place.name));
 return {rows,failed,...(checked?{checked}:{}),...(stepM?{stepM}:{}),...(issues.length?{issues}:{})};
}
// Use the forecast's existing mascot, speech bubble, track and motion rules.
function showRecordProgress(host,label,unit='件'){
 const element=(tag,cls)=>{const n=document.createElement(tag);n.className=cls;return n;};
 const node=element('div','note-wait record-search-progress'),character=element('span','note-wait-character'),bubble=element('div','note-wait-message'),headline=element('span','record-progress-title'),count=element('span','record-progress-count'),bar=element('div','note-progress'),fill=element('span','note-progress-fill');
 character.setAttribute('aria-hidden','true');count.setAttribute('aria-hidden','true');fill.setAttribute('aria-hidden','true');
 bar.setAttribute('role','progressbar');bar.setAttribute('aria-label','検索の進捗');bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax','100');
 bar.append(fill);bubble.append(headline,count,bar);node.append(character,bubble);host.replaceChildren(node);
 let last='';
 function update(n,total,message=label){
  const known=Number.isInteger(n)&&Number.isInteger(total)&&total>0&&n>=0&&n<=total,key=[n,total,message].join('|');if(last===key)return;last=key;
  if(headline.textContent!==message)headline.textContent=message;
  count.textContent=known?' '+n+' / '+total+unit:'';
  if(known)bar.setAttribute('aria-valuetext',n+' / '+total+unit);else bar.removeAttribute('aria-valuetext');
  if(known&&n>0){const percent=Math.min(99,Math.floor(n/total*100));bar.removeAttribute('data-indeterminate');bar.setAttribute('aria-valuenow',String(percent));fill.style.transform='scaleX('+percent/100+')';}
  else{bar.setAttribute('data-indeterminate','');bar.removeAttribute('aria-valuenow');fill.style.removeProperty('transform');}
 }
 update(0,0);return {node,update};
}
function recordSearchReset(){
 if(recordSearchSession&&!recordSameScope(recordSearchSession.scope,recordSearchScope()))recordSearchSession=null;
 if(recordIndexMemo&&!recordSameScope(recordIndexMemo.scope,[auth?.token,auth?.loginId,accessState.generation,version]))recordIndexMemo=null;
}

// This code runs inside the existing MyPlacesUI closure in the trial only.
const opportunityDateAt=at=>new Date(at+32400000).toISOString().slice(0,10);
const opportunityBounds=date=>{const [y,m,d]=date.split('-').map(Number),start=Date.UTC(y,m-1,d)-32400000;return [start,start+86400000];};
const opportunityPageRows=8;
const opportunityPageEnd=start=>Math.max(start,Math.min(aimCandidateSearchEnd(),start+7*DAY));
let opportunityDateChosen=false;
let opportunityOwner=null,opportunityOwnerId=null,opportunityEpoch=0,opportunityJob=null,opportunityHost=null,opportunityDom=null,opportunityReturn=null,opportunityOpenSeq=0,opportunityInputEpoch=0;
let opportunityPermittedBodies=[],opportunityPlaces=[],opportunityPicker=null,opportunityNotice='';
let opportunityFilters={date:opportunityDateAt(Date.now()),bodies:['sun','moon'],allBodies:false,places:[],allPlaces:true},opportunityRestore=null;
const opportunityCache=new Map();
let opportunityPairMemo=null;
const opportunityListSettings=()=>geometricOpportunitySettings({targetHeights:store.get('sorami.aimHeightsOwner',null)===auth?.loginId?store.get('sorami.aimHeights',{}):{}});
let opportunityListSettingsKey=JSON.stringify(opportunityListSettings());
// Server and device lists both use the geometric candidate model. The
// appearance view applies this device's refraction when a row is opened.
const opportunityAirKey=()=>JSON.stringify(opportunityListSettings());
const opportunityAllowed=()=>!!auth?.token&&toolAllowed('records');
const opportunityActive=()=>opportunityAllowed()&&!document.hidden&&!el('recordsView')?.hidden&&el('recordsView')?.dataset.tab==='opportunities';
let opportunityApplyingPreferences=false,opportunityWarmupKey='',opportunityWarmupFlight=null;
const opportunityServer=createServerOpportunityPreferences({
 api:(...args)=>apiTransport(...args),getSession:()=>[auth?.token,auth?.loginId,accessState.generation],canUse:opportunityAllowed,
 getSettings:opportunityListSettings,
 applySettings:settings=>{opportunityApplyingPreferences=true;try{store.set('sorami.aimHeights',settings.targetHeights??{});store.set('sorami.aimHeightsOwner',auth?.loginId??null);opportunityListSettingsKey=JSON.stringify(opportunityListSettings());}finally{opportunityApplyingPreferences=false;}},
 sync:async()=>{await accountSync().syncNow();if(syncError||pushQueue.length)throw Error('記録を同期できていません。通信を確認して再試行してください。');}
});
function opportunityWarmup(){
 opportunityGeometryHook();
 if(opportunityAllowed()&&!document.hidden&&opportunityServer.state.enabled===false)opportunityDeviceBackground();
 if(!opportunityAllowed()||document.hidden||opportunityWarmupFlight)return;
 const key=JSON.stringify([auth?.token,auth?.loginId,accessState.generation,opportunityDateAt(Date.now()),opportunityAirKey(true)]);
 if(opportunityWarmupKey===key)return;opportunityWarmupKey=key;
 const owner=auth.token,generation=accessState.generation;
 opportunityWarmupFlight=(async()=>{try{const prefs=await opportunityServer.ready();if(owner!==auth?.token||generation!==accessState.generation||!opportunityAllowed())return;if(!prefs.enabled)opportunityDeviceBackground();else await apiTransport('POST','/overlaps/ensure',{environment:'trial',intent:'background',startDay:opportunityDateAt(Date.now()),bodies:['sun','moon'],placeIds:null,sourceRev:prefs.sourceRev});opportunityWarmupKey=JSON.stringify([auth?.token,auth?.loginId,accessState.generation,opportunityDateAt(Date.now()),opportunityAirKey(true)]);}catch{/* The visible list reports failures and offers retry. */}finally{opportunityWarmupFlight=null;if(opportunityActive())renderOpportunities();}})();
}
// Device geometric engine: the same extracted bundle as the server, in a
// hidden same-origin frame. Complete results persist per account, engine,
// settings, pair and day, so closing the app resumes from the next pair.
const opportunityDeviceStats={hits:0,solves:0,failures:0,solveMs:0,frameMs:0,background:0};
globalThis.AstroNotesOverlapStats=opportunityDeviceStats;
let opportunityFrame=null,opportunityFrameSeq=0,opportunityDb=null,opportunityBackgroundFlight=null;
const opportunityDeviceQueue={high:[],low:[],running:0};
const opportunityDeviceFlights=new Map();
function opportunityFrameOpen(){
 if(opportunityFrame)return opportunityFrame.ready;
 const frame=document.createElement('iframe'),calls=new Map(),began=performance.now();
 frame.hidden=true;frame.setAttribute('aria-hidden','true');frame.tabIndex=-1;
 frame.src='overlap-calculation.html?v='+(document.querySelector('meta[name="app-version"]')?.content||'0');
 const state={frame,calls,engine:null};
 state.ready=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('calculation frame unavailable')),60000);
  state.listener=event=>{
   const message=event.data;if(event.source!==frame.contentWindow||event.origin!==location.origin||message?.type!=='astronotes-overlap')return;
   if('ready' in message){clearTimeout(timer);opportunityDeviceStats.frameMs=Math.round(performance.now()-began);if(message.ready&&/^[a-f0-9]{64}$/.test(message.engine||'')){state.engine=message.engine;resolve(state);}else reject(Error('calculation engine unavailable'));return;}
   const call=calls.get(message.id);if(!call)return;calls.delete(message.id);
   if(message.error)call.reject(Error(message.error));else call.resolve(message.result);
  };
  addEventListener('message',state.listener);
 });
 state.ready.catch(()=>{if(opportunityFrame===state)opportunityFrameClose();});
 opportunityFrame=state;document.body.append(frame);return state.ready;
}
function opportunityFrameClose(){
 const state=opportunityFrame;if(!state)return;opportunityFrame=null;removeEventListener('message',state.listener);state.frame.remove();
 for(const call of state.calls.values())call.reject(Error('calculation frame closed'));state.calls.clear();
}
// The frame runs one check at a time. A check that never settles would hold
// every later one, so it is abandoned with its frame and reported unchecked.
async function opportunityFrameSolve(input){
 const state=await opportunityFrameOpen(),id=++opportunityFrameSeq;
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{if(opportunityFrame===state)opportunityFrameClose();},120000);
  state.calls.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});
  state.frame.contentWindow.postMessage({type:'astronotes-overlap',id,op:'solve',input},location.origin);
 });
}
// 2026-11-09 Where the browser can decode terrain tiles off the main thread,
// the same engine runs in several workers and checks pairs in parallel. The
// frame remains the path for older browsers and for test fixtures, which
// substitute functions inside it (AstroNotesOverlapEngine='frame').
let opportunityWorkers=null,opportunityWorkerSeq=0,opportunityEngineMode=null;
function opportunityWorkerCount(){
 if(globalThis.AstroNotesOverlapEngine==='frame'||typeof Worker!=='function'||typeof OffscreenCanvas!=='function'||typeof createImageBitmap!=='function')return 0;
 const cores=Number(navigator.hardwareConcurrency)||2;return Math.max(1,Math.min(3,cores-1));
}
function opportunityWorkersOpen(){
 if(opportunityWorkers)return opportunityWorkers.ready;
 const count=opportunityWorkerCount(),began=performance.now(),url='overlap-calculation-worker.js?v='+(document.querySelector('meta[name="app-version"]')?.content||'0');
 const pool={slots:[],engine:null};
 pool.ready=Promise.all(Array.from({length:count},()=>new Promise((resolve,reject)=>{
  const worker=new Worker(url),slot={worker,calls:new Map(),engine:null};pool.slots.push(slot);
  const timer=setTimeout(()=>reject(Error('calculation worker unavailable')),60000);
  worker.onmessage=event=>{
   const message=event.data;if(message?.type!=='astronotes-overlap')return;
   if('ready' in message){clearTimeout(timer);if(message.ready&&/^[a-f0-9]{64}$/.test(message.engine||'')){slot.engine=message.engine;resolve(slot);}else reject(Error('calculation engine unavailable'));return;}
   const call=slot.calls.get(message.id);if(!call)return;slot.calls.delete(message.id);
   if(message.error)call.reject(Error(message.error));else call.resolve(message.result);
  };
  worker.onerror=event=>{event.preventDefault?.();clearTimeout(timer);reject(Error('calculation worker failed'));if(opportunityWorkers===pool)opportunityWorkersClose();};
 }))).then(slots=>{
  if(new Set(slots.map(slot=>slot.engine)).size!==1)throw Error('calculation engines differ');
  pool.engine=slots[0].engine;opportunityDeviceStats.frameMs=Math.round(performance.now()-began);opportunityDeviceStats.workers=slots.length;return pool;
 });
 pool.ready.catch(()=>{if(opportunityWorkers===pool)opportunityWorkersClose();});
 opportunityWorkers=pool;return pool.ready;
}
function opportunityWorkersClose(){
 const pool=opportunityWorkers;if(!pool)return;opportunityWorkers=null;
 for(const slot of pool.slots){slot.worker.terminate();for(const call of slot.calls.values())call.reject(Error('calculation worker closed'));slot.calls.clear();}
}
async function opportunityWorkerSolve(input){
 const pool=await opportunityWorkersOpen(),slot=pool.slots.reduce((a,b)=>b.calls.size<a.calls.size?b:a),id=++opportunityWorkerSeq;
 return new Promise((resolve,reject)=>{
  // A check that never settles is abandoned with the pool and reported unchecked.
  const timer=setTimeout(()=>{if(opportunityWorkers===pool)opportunityWorkersClose();},120000);
  slot.calls.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});
  slot.worker.postMessage({type:'astronotes-overlap',id,op:'solve',input});
 });
}
// Workers first; if they cannot start here, the frame for the rest of the session.
async function opportunityEngineOpen(){
 if(opportunityEngineMode===null)opportunityEngineMode=opportunityWorkerCount()?'workers':'frame';
 if(opportunityEngineMode==='workers'){try{return await opportunityWorkersOpen();}catch{opportunityEngineMode='frame';}}
 return opportunityFrameOpen();
}
const opportunityEngineSlots=()=>opportunityEngineMode==='workers'&&opportunityWorkers?Math.max(1,opportunityWorkers.slots.length):1;
function opportunityEngineSolve(input){return opportunityEngineMode==='workers'?opportunityWorkerSolve(input):opportunityFrameSolve(input);}
function opportunityDbOpen(){
 if(opportunityDb)return opportunityDb;
 opportunityDb=new Promise((resolve,reject)=>{
  if(typeof indexedDB==='undefined'){reject(Error('indexedDB unavailable'));return;}
  const request=indexedDB.open('astronotes-overlap-device',1);
  request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('results'))db.createObjectStore('results',{keyPath:'key'}).createIndex('day','day');};
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
 });
 opportunityDb.catch(()=>{opportunityDb=null;});
 return opportunityDb;
}
function opportunityDbDo(mode,work){
 return opportunityDbOpen().then(db=>new Promise((resolve,reject)=>{const tx=db.transaction('results',mode),store=tx.objectStore('results');let value;const request=work(store);if(request)request.onsuccess=()=>{value=request.result;};tx.oncomplete=()=>resolve(value);tx.onerror=tx.onabort=()=>reject(tx.error);}));
}
// Results belong to the signed-in account and the engine that made them.
// Anything else, and past days, is removed instead of being reused.
async function opportunityDbPrune(owner,engine){
 const today=opportunityDateAt(Date.now());
 await opportunityDbDo('readwrite',store=>{const request=store.openCursor();request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;const v=cursor.value;if(v.owner!==owner||v.engine!==engine||v.day<today)cursor.delete();cursor.continue();};return null;}).catch(()=>{});
}
function opportunityDeviceForget(){opportunityDbDo('readwrite',store=>store.clear()).catch(()=>{});opportunityGeometryDo('readwrite',store=>store.clear()).catch(()=>{});try{indexedDB.deleteDatabase('astronotes-ridge-caps');}catch{/* Unavailable storage has nothing to forget. */}}
// 2026-11-09 Date-independent geometry (one building outline or summit ridge per
// point, target and eye height) is kept per pair, sent with the records as
// rec:geom:<id> and received from them, so a later day or another device does not
// rebuild it from terrain and 3D models (ユーザー「記録に保存する時に稜線とか建物の縁とか
// 保持しておけば取りに行く必要はなくなる」「絶対に同期して」). Production ignores this kind.
const OPPORTUNITY_GEOMETRY_VERSION=1,opportunityGeometryRow=/^rec:geom:[a-f0-9]{40}$/,OPPORTUNITY_GEOMETRY_BODY=19000;
let opportunityGeometryDb=null,opportunityGeometryTimer=null,opportunityGeometryFlight=null;
function opportunityGeometryOpen(){
 if(opportunityGeometryDb)return opportunityGeometryDb;
 opportunityGeometryDb=new Promise((resolve,reject)=>{
  if(typeof indexedDB==='undefined'){reject(Error('indexedDB unavailable'));return;}
  const request=indexedDB.open('astronotes-overlap-geometry',1);
  request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('groups'))db.createObjectStore('groups',{keyPath:'id'});};
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
 });
 opportunityGeometryDb.catch(()=>{opportunityGeometryDb=null;});
 return opportunityGeometryDb;
}
function opportunityGeometryDo(mode,work){
 return opportunityGeometryOpen().then(db=>new Promise((resolve,reject)=>{const tx=db.transaction('groups',mode),store=tx.objectStore('groups');let value;const request=work(store);if(request)request.onsuccess=()=>{value=request.result;};tx.oncomplete=()=>resolve(value);tx.onerror=tx.onabort=()=>reject(tx.error);}));
}
// Body and labels do not change the geometry: the sun and moon pairs share one group.
async function opportunityGeometryId(pair){return 'rec:geom:'+(await opportunityDigest(['astronotes.overlap-geometry.v'+OPPORTUNITY_GEOMETRY_VERSION,{...opportunitySemantic(pair),body:undefined}])).slice(0,40);}
async function opportunityGeometryFor(pair){
 const id=await opportunityGeometryId(pair),owner=auth?.loginId,group=await opportunityGeometryDo('readonly',store=>store.get(id)).catch(()=>null);
 return {id,entries:group?.owner===owner&&group.entries&&typeof group.entries==='object'?group.entries:{}};
}
async function opportunityGeometryKeep(id,entries){
 const owner=auth?.loginId;if(!owner||!Object.keys(entries).length)return;
 await opportunityGeometryDo('readwrite',store=>{const request=store.get(id);request.onsuccess=()=>{const old=request.result?.owner===owner?request.result.entries:{};store.put({id,owner,entries:{...old,...entries},uploaded:false,updatedAt:Date.now()});};return null;}).catch(()=>{});
 clearTimeout(opportunityGeometryTimer);opportunityGeometryTimer=setTimeout(()=>void opportunityGeometryUpload(),3000);
}
// One synced row holds at most what fits the server's 20,000-character body. A larger
// group (a line or area: many positions) continues in rows that name it as their group.
function opportunityGeometryChunks(entries){
 const chunks=[];let chunk={},size=120;
 for(const key of Object.keys(entries).sort()){
  const add=JSON.stringify(key).length+JSON.stringify(entries[key]).length+2;if(120+add>OPPORTUNITY_GEOMETRY_BODY)continue;
  if(size+add>OPPORTUNITY_GEOMETRY_BODY){chunks.push(chunk);chunk={};size=120;}
  chunk[key]=entries[key];size+=add;
 }
 if(Object.keys(chunk).length||!chunks.length)chunks.push(chunk);
 return chunks;
}
async function opportunityGeometryPart(id,k){return k?'rec:geom:'+(await opportunityDigest(['astronotes.overlap-geometry-part.v1',id,k])).slice(0,40):id;}
async function opportunityGeometryUpload(){
 if(opportunityGeometryFlight)return opportunityGeometryFlight;
 const owner=auth?.loginId,token=auth?.token;if(!owner||!token)return;
 opportunityGeometryFlight=(async()=>{
  try{
   const pending=((await opportunityGeometryDo('readonly',store=>store.getAll()).catch(()=>[]))||[]).filter(g=>g.owner===owner&&!g.uploaded);
   for(let i=0;i<pending.length;){
    if(auth?.loginId!==owner||auth?.token!==token)return;
    const batch=[],rows=[];
    for(;i<pending.length&&(rows.length<80||!batch.length);i++){
     const g=pending[i],chunks=opportunityGeometryChunks(g.entries),ids=[];
     for(let k=0;k<chunks.length;k++){const id=await opportunityGeometryPart(g.id,k);ids.push(id);rows.push({id,body:{kind:'geom',value:{v:OPPORTUNITY_GEOMETRY_VERSION,entries:chunks[k],...(k?{group:g.id}:{})}},updated_at:Date.now(),deleted:false});}
     batch.push({g,ids});
    }
    const ok=new Set();
    for(let j=0;j<rows.length;j+=100){const res=await apiTransport('POST','/sync',{records:rows.slice(j,j+100)});for(const id of res?.accepted?.records||[])ok.add(id);}
    // A group that gained entries while sending stays pending for the next round.
    await opportunityGeometryDo('readwrite',store=>{for(const {g,ids} of batch){if(!ids.every(id=>ok.has(id)))continue;const request=store.get(g.id);request.onsuccess=()=>{const now=request.result;if(now&&now.updatedAt===g.updatedAt)store.put({...now,uploaded:true});};}return null;});
   }
  }catch{/* Kept on this device and sent after the next check. */}
  finally{opportunityGeometryFlight=null;}
 })();
 return opportunityGeometryFlight;
}
function opportunityGeometryReceive(rows){
 const owner=auth?.loginId;if(!owner||!Array.isArray(rows))return;
 const list=rows.filter(row=>row&&typeof row.id==='string'&&opportunityGeometryRow.test(row.id));if(!list.length)return;
 // Rows of one group are merged before writing; two reads of one record in a transaction see the same old value.
 const groups=new Map(),gone=[];
 for(const row of list){
  if(row.deleted){gone.push(row.id);continue;}
  let body;try{body=JSON.parse(row.body);}catch{continue;}
  const value=body?.kind==='geom'?body.value:null;
  if(value?.v!==OPPORTUNITY_GEOMETRY_VERSION||!value.entries||typeof value.entries!=='object'||Array.isArray(value.entries))continue;
  const id=typeof value.group==='string'&&opportunityGeometryRow.test(value.group)?value.group:row.id;
  groups.set(id,{...(groups.get(id)||{}),...value.entries});
 }
 void opportunityGeometryDo('readwrite',store=>{
  for(const id of gone)if(!groups.has(id))store.delete(id);
  for(const [id,entries] of groups){
   const request=store.get(id);
   request.onsuccess=()=>{const now=request.result?.owner===owner?request.result:null;store.put({id,owner,entries:{...entries,...(now?.entries||{})},uploaded:now?now.uploaded:true,updatedAt:now?now.updatedAt:Date.now()});};
  }
  return null;
 }).catch(()=>{});
}
// Rows of this kind arrive through the account sync; production code skips them.
function opportunityGeometryHook(){
 if(typeof RecordSync==='undefined'||RecordSync.opportunityGeometry)return;
 const apply=RecordSync.apply;RecordSync.apply=rows=>{opportunityGeometryReceive(rows);return apply(rows);};RecordSync.opportunityGeometry=true;
}
opportunityGeometryHook();
const opportunityGeometryTurns=new Map();
async function opportunityGeometryTurn(id){
 const before=opportunityGeometryTurns.get(id);let release;const mine=new Promise(resolve=>{release=resolve;}),chain=(before||Promise.resolve()).then(()=>mine);
 opportunityGeometryTurns.set(id,chain);if(before)await before;
 return ()=>{release();if(opportunityGeometryTurns.get(id)===chain)opportunityGeometryTurns.delete(id);};
}
async function opportunityDigest(value){const bytes=new TextEncoder().encode(JSON.stringify(value)),digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');}
function opportunitySemantic(pair){
 // The same fields the server's inputHash ignores: labels, record metadata.
 const value=structuredClone({...pair,id:undefined,record:undefined,sourcePlaceId:undefined});
 for(const obj of [value.place,value.target])for(const k of ['name','subtitle','note','phenomena','updatedAt','createdAt'])delete obj?.[k];
 return value;
}
function opportunityDeviceInput(pair,day){
 return {input:{...pair,contextFavorites:favorites.filter(f=>f.id===pair.target.favId).map(f=>({id:f.id,targetCategory:f.targetCategory}))},day:opportunityDateAt(day),pairId:pair.id,preferences:opportunityListSettings(),tools:(auth?.tools||[]).slice(),generation:accessState.generation,evaluationNow:Date.now()};
}
function opportunityDeviceRun(priority,work){
 return new Promise((resolve,reject)=>{opportunityDeviceQueue[priority].push({work,resolve,reject});opportunityDevicePump();});
}
// As many checks run at once as the engine has workers (one for the frame).
function opportunityDevicePump(){
 const q=opportunityDeviceQueue;
 while(q.running<opportunityEngineSlots()){
  const item=q.high.shift()||q.low.shift();if(!item)return;q.running++;
  Promise.resolve().then(item.work).then(item.resolve,item.reject).finally(()=>{q.running--;opportunityDevicePump();});
 }
}
// One (pair, day) check. Rows carry the current labels on a stored hit,
// since labels are not part of the calculation key.
async function opportunityDeviceSolve(pair,day,{priority='high',isCurrent=()=>true}={}){
 const owner=auth?.loginId;if(!owner)return {rows:[],failed:1};
 const state=await opportunityEngineOpen(),settings=opportunityListSettings();
 const key=await opportunityDigest(['astronotes.device-overlap.v1',state.engine,owner,(auth?.tools||[]).slice().sort(),settings,opportunitySemantic(pair),opportunityDateAt(day)]);
 const relabel=rows=>rows.map(row=>({...row,place:{...row.place,name:pair.place.name},target:pair.target}));
 let flight=opportunityDeviceFlights.get(key);
 if(!flight){
  flight=(async()=>{
   const saved=await opportunityDbDo('readonly',store=>store.get(key)).catch(()=>null);
   if(saved?.owner===owner&&saved.engine===state.engine){opportunityDeviceStats.hits++;return {rows:saved.rows,stored:true};}
   // A pair whose geometry is not built yet waits for the other body's check of the same
   // place and target, then uses what that check built instead of building it twice.
   const turn=Object.keys((await opportunityGeometryFor(pair)).entries).length?null:await opportunityGeometryTurn(await opportunityGeometryId(pair));
   try{return await opportunityDeviceRun(priority,async()=>{
    if(!isCurrent()||owner!==auth?.loginId)return {rows:[],cancelled:true};
    const geometry=await opportunityGeometryFor(pair);
    const began=performance.now(),result=await opportunityEngineSolve({...opportunityDeviceInput(pair,day),geometry:geometry.entries});
    opportunityDeviceStats.solves++;opportunityDeviceStats.solveMs+=Math.round(performance.now()-began);
    if(result.geometry&&typeof result.geometry==='object'&&Object.keys(result.geometry).length&&owner===auth?.loginId){opportunityDeviceStats.geometry=(opportunityDeviceStats.geometry||0)+Object.keys(result.geometry).length;await opportunityGeometryKeep(geometry.id,result.geometry);}
    if(result.status!=='complete'){opportunityDeviceStats.failures++;return {rows:result.rows||[],failed:1};}
    if(owner===auth?.loginId)await opportunityDbDo('readwrite',store=>store.put({key,owner,engine:state.engine,day:opportunityDateAt(day),savedAt:Date.now(),rows:result.rows})).catch(()=>{});
    return {rows:result.rows};
   });}finally{turn?.();}
  })().finally(()=>{if(opportunityDeviceFlights.get(key)===flight)opportunityDeviceFlights.delete(key);});
  opportunityDeviceFlights.set(key,flight);
 }
 const result=await flight;
 if(result.cancelled)return isCurrent()?opportunityDeviceSolve(pair,day,{priority,isCurrent}):{rows:[],cancelled:true};
 return {...result,rows:relabel(result.rows)};
}
// While the app is in front, the next seven days of sun/moon pairs fill in
// behind whatever screen is open. A visible list always runs first.
function opportunityDeviceBackground(){
 if(opportunityBackgroundFlight)return;
 const owner=auth?.loginId,token=auth?.token,generation=accessState.generation;
 const live=()=>!document.hidden&&opportunityAllowed()&&owner===auth?.loginId&&token===auth?.token&&generation===accessState.generation&&opportunityServer.state.enabled===false;
 let restart=false;
 opportunityBackgroundFlight=(async()=>{
  try{
   const state=await opportunityEngineOpen();await opportunityDbPrune(owner,state.engine);
   const signature=opportunitySignature(),{pairs}=opportunityPairSet(signature,['sun','moon']),[start]=opportunityBounds(opportunityDateAt(Date.now()));
   const tasks=[];for(let i=0;i<7;i++)for(const pair of pairs)tasks.push([pair,start+i*86400000]);
   let next=0;
   const lane=async()=>{
    for(let task;(task=tasks[next++]);){
     if(!live())return;if(signature!==opportunitySignature()){restart=true;return;}
     const result=await opportunityDeviceSolve(task[0],task[1],{priority:'low',isCurrent:live});
     if(!result.stored&&!result.cancelled)opportunityDeviceStats.background++;
     await recordSearchYield();
    }
   };
   await Promise.all(Array.from({length:opportunityEngineSlots()},lane));
  }catch{/* The visible list reports calculation failures. */}
  finally{opportunityBackgroundFlight=null;if(restart&&live())setTimeout(opportunityDeviceBackground,0);}
 })();
}
function opportunityPairs(bodies){
 const {groups,shapes}=recordSearchIndex(),pairs=[],unavailable=[];
 for(const favorite of favorites){
  const targets=groups.get(favorite.id);if(!targets)continue;
  // 2026-11-09 線・範囲の地点は範囲内の立ち位置で確かめる（ユーザー「範囲とか線の時も出るようにできないの？」）。
  // 立ち位置ごとの地面・稜線・外形は一度作って同期し、日ごとには太陽・月の通り道の近くだけを確かめる。
  const shape=recordSearchShape(favorite,shapes),saved=shape?{...favorite,shape}:favorite;
  for(const [targetKey,source] of targets){
   const group=source.slice().sort((a,b)=>Number(!!b.registration)-Number(!!a.registration)||when(b)-when(a)||b.updatedAt-a.updatedAt);
   const best=statusOf(favorite.id,targetKey,source);if(!best||best.result==='hidden')continue;
   const target=resolveTarget(targetKey),seen=new Set(),heightRange=RecordHeight.range(favorite.eyeHeightRangeAGL);if(favorite.eyeHeightRangeAGL!=null&&!heightRange){unavailable.push({placeId:favorite.id,targetKey,reason:'height'});continue;}if(target&&!recordMatchOpts(target,favorite)){unavailable.push({placeId:favorite.id,targetKey,reason:'alignment'});continue;}
   const savedTarget=best.target,targetMoved=target&&finite(savedTarget.latitude)&&finite(savedTarget.longitude)&&AstroNotesTerrain.distanceKm(savedTarget.latitude,savedTarget.longitude,target.latitude,target.longitude)>=NEAR_KM;
   if(!planningPairs([best],bodies).length){unavailable.push({placeId:favorite.id,targetKey,reason:'access'});continue;}if(!target||targetMoved){unavailable.push({placeId:favorite.id,targetKey,reason:'target'});continue;}
   for(const record of heightRange?[best]:group){
    if(record.removed||record.result==='hidden')continue;
    const o=heightRange||shape?favorite:record.observer||favorite;if(!shape&&AstroNotesTerrain.distanceKm(o.latitude,o.longitude,favorite.latitude,favorite.longitude)>=NEAR_KM){continue;}const place={...saved,latitude:o.latitude,longitude:o.longitude,elevation:o.elevation??favorite.elevation,groundManualM:o.elevation??favorite.groundManualM??favorite.elevation,eyeHeightAGL:o.eyeHeightAGL??favorite.eyeHeightAGL??1.5};
    place.standAglM=place.eyeHeightAGL;place.stand='ground';
    const observerKey=JSON.stringify([place.latitude,place.longitude,place.groundManualM,place.eyeHeightAGL,place.shape,heightRange]);
    if(seen.has(observerKey))continue;seen.add(observerKey);
    for(const {body}of planningPairs([record],bodies)){
     const opts=recordMatchOpts(target,favorite,body);if(!opts)continue;const id=JSON.stringify([favorite.id,targetKey,observerKey,body,opts]);pairs.push({id,sourcePlaceId:favorite.id,place,record,target,body,...opts});
    }
   }
  }
 }
 return {pairs,unavailable};
}
function opportunitySignature(){const {records,shapes}=recordSearchIndex();return JSON.stringify([auth?.loginId,accessState.generation,version,favorites,records,shapes,aimTargetList(),opportunityAirKey(),auth?.tools]);}
function opportunityPairSet(signature,bodies){
 if(opportunityPairMemo?.signature!==signature)opportunityPairMemo={signature,sets:new Map()};
 return recordBounded(opportunityPairMemo.sets,JSON.stringify(bodies),()=>opportunityPairs(bodies),4);
}
function opportunityRemember(job){
 if(!job?.scan||job.signature!==opportunitySignature())return;
 const {state}=job.scan;
 opportunityCache.set(job.key,job.remote?{remote:true,through:state.through}:{...state,rows:state.rows.slice(),pending:state.pending.slice(),failures:state.failures.slice()});
 while(opportunityCache.size>4)opportunityCache.delete(opportunityCache.keys().next().value);
}
function opportunityCancel(clear=false){if(clear)opportunityClosePicker();if(!clear)opportunityRemember(opportunityJob);opportunityJob?.scan?.cancel?.();opportunityJob?.controller?.abort();opportunityEpoch++;opportunityJob=null;if(clear){opportunityPairMemo=null;opportunityCache.clear();opportunityHost?.replaceChildren();opportunityDom=null;opportunityReturn=null;opportunityRestore=null;opportunityNotice='';}}
function opportunityCurrent(job){return opportunityActive()&&opportunityJob===job&&job.epoch===opportunityEpoch&&job.owner===auth?.token&&job.loginId===auth?.loginId&&job.generation===accessState.generation&&job.inputEpoch===opportunityInputEpoch&&job.revision===version&&job.air===opportunityAirKey(job.remote);}
function opportunityNode(tag,attrs={},text=''){const n=document.createElement(tag);Object.assign(n,attrs);n.textContent=text;return n;}
function opportunityClosePicker(){const picker=opportunityPicker;if(!picker)return;opportunityPicker=null;if(picker.dialog.open)picker.dialog.close();picker.dialog.remove();picker.trigger.setAttribute('aria-expanded','false');if(picker.trigger.isConnected&&opportunityActive())picker.trigger.focus({preventScroll:true});}
function opportunityPickerOptions(kind){return kind==='bodies'?AstroNotesBodies.definitions.filter(b=>opportunityPermittedBodies.includes(b.id)).map(b=>[b.id,b.name]):opportunityPlaces;}
function opportunityFilterLabel(kind){
 const options=opportunityPickerOptions(kind),all=kind==='bodies'?opportunityFilters.allBodies:opportunityFilters.allPlaces,ids=kind==='bodies'?opportunityFilters.bodies:opportunityFilters.places,selected=options.filter(([id])=>ids.includes(id));
 if(all)return 'すべて';
 if(!selected.length)return '選び直してください';
 if(selected.length===1)return selected[0][1];
 return kind==='bodies'&&selected.length===2?selected[0][1]+'・'+selected[1][1]:selected.length+(kind==='bodies'?'天体':'地点');
}
function opportunityPickerKey(kind){return JSON.stringify([auth?.loginId,accessState.generation,version,favorites,load(),shapeData(),aimTargetList(),auth?.tools,opportunityPickerOptions(kind)]);}
function opportunityOpenPicker(kind,trigger){
 if(!opportunityActive())return;opportunityClosePicker();opportunityNotice='';if(opportunityJob)opportunityDraw(opportunityJob);const options=opportunityPickerOptions(kind),ids=kind==='bodies'?opportunityFilters.bodies:opportunityFilters.places,all=kind==='bodies'?opportunityFilters.allBodies:opportunityFilters.allPlaces;
 const draft=new Set(all?options.map(([id])=>id):ids.filter(id=>options.some(([key])=>key===id))),dialog=opportunityNode('dialog',{id:'recordOpportunityPicker',className:'record-opportunity-picker'}),heading=opportunityNode('h2',{id:'recordOpportunityPickerTitle'},kind==='bodies'?'天体':'撮影地点'),close=opportunityNode('button',{type:'button',className:'chip',id:'recordOpportunityPickerClose'},'取消'),header=opportunityNode('div',{className:'record-opportunity-picker-head'});dialog.setAttribute('aria-labelledby',heading.id);header.append(heading,close);
 const search=opportunityNode('input',{type:'search',id:'recordOpportunityPickerSearch',className:'fav-in',placeholder:'地点名で検索'});search.setAttribute('aria-label','撮影地点を名前で検索');search.hidden=kind!=='places';
 const tools=opportunityNode('div',{className:'record-opportunity-picker-tools'}),selectAll=opportunityNode('button',{type:'button',className:'chip',id:'recordOpportunitySelectAll'},'全選択'),clear=opportunityNode('button',{type:'button',className:'chip',id:'recordOpportunityClearAll'},'全解除');tools.append(selectAll,clear);
 const list=opportunityNode('div',{className:'record-opportunity-picker-list',id:'recordOpportunityPickerList'}),footer=opportunityNode('div',{className:'record-opportunity-picker-foot'}),count=opportunityNode('span',{className:'tiny',id:'recordOpportunityPickerCount'}),apply=opportunityNode('button',{type:'button',className:'chip',id:'recordOpportunityPickerApply'},'適用');count.setAttribute('role','status');footer.append(count,apply);
 const update=()=>{count.textContent=draft.size+' / '+options.length+'件を選択';apply.disabled=!draft.size;selectAll.disabled=!options.length||draft.size===options.length;clear.disabled=!draft.size;};
 const draw=()=>{list.replaceChildren();const query=search.value.trim().normalize('NFKC').toLocaleLowerCase('ja');for(const [id,name]of options){if(query&&!name.normalize('NFKC').toLocaleLowerCase('ja').includes(query))continue;const label=opportunityNode('label',{className:'record-opportunity-picker-item'}),input=opportunityNode('input',{type:'checkbox',value:id,checked:draft.has(id)});input.onchange=()=>{if(input.checked)draft.add(id);else draft.delete(id);update();};label.append(input,opportunityNode('span',{},name));list.append(label);}if(!list.firstChild)list.append(opportunityNode('p',{className:'tiny'},options.length?'該当する地点がありません':'選択できる項目がありません'));update();};
 selectAll.onclick=()=>{for(const [id]of options)draft.add(id);draw();};clear.onclick=()=>{draft.clear();draw();};search.oninput=draw;close.onclick=opportunityClosePicker;dialog.addEventListener('cancel',e=>{e.preventDefault();opportunityClosePicker();});
 apply.onclick=()=>{if(!opportunityPicker||opportunityPicker.signature!==opportunityPickerKey(opportunityPicker.kind)||!opportunityActive()){opportunityClosePicker();opportunityNotice='登録内容や利用条件が変わりました。選択を開き直してください。';renderOpportunities();return;}const chosen=options.map(([id])=>id).filter(id=>draft.has(id));if(!chosen.length)return;const patch=kind==='bodies'?{bodies:chosen,allBodies:chosen.length===options.length}:{places:chosen,allPlaces:chosen.length===options.length};opportunityClosePicker();if(Object.entries(patch).every(([key,value])=>JSON.stringify(opportunityFilters[key])===JSON.stringify(value)))return;opportunitySet(patch);};
 dialog.append(header,search,tools,list,footer);opportunityDom.host.append(dialog);opportunityPicker={dialog,trigger,kind,signature:opportunityPickerKey(kind)};trigger.setAttribute('aria-expanded','true');draw();dialog.showModal();
}
function opportunityBuild(){
 const host=el('recordOpportunities');if(!host)return false;opportunityHost=host;
 if(opportunityDom?.host===host&&host.firstChild)return true;
 host.replaceChildren();const controls=opportunityNode('div',{className:'record-opportunity-controls'}),period=opportunityNode('div',{className:'record-opportunity-period'});
 const prev=opportunityNode('button',{type:'button',className:'chip'},'‹'),date=opportunityNode('input',{type:'date',id:'recordOpportunityDate',className:'fav-in'}),next=opportunityNode('button',{type:'button',className:'chip'},'›'),today=opportunityNode('button',{type:'button',className:'chip'},'今日');
 prev.id='recordOpportunityPrev';next.id='recordOpportunityNext';today.id='recordOpportunityToday';prev.setAttribute('aria-label','前の日');next.setAttribute('aria-label','次の日');date.setAttribute('aria-label','重なる日を調べる日付');
 const change=delta=>{const [start]=opportunityBounds(opportunityFilters.date);opportunitySet({date:opportunityDateAt(start+delta*86400000)});};prev.onclick=()=>change(-1);next.onclick=()=>change(1);date.onchange=()=>opportunitySet({date:date.value});today.onclick=()=>opportunitySet({date:opportunityDateAt(Date.now())});const dateWrap=opportunityNode('label',{className:'record-opportunity-date'}),dateLabel=opportunityNode('span');dateLabel.setAttribute('aria-hidden','true');dateWrap.append(dateLabel,date);period.append(prev,dateWrap,next,today);
 const filters=opportunityNode('div',{className:'record-opportunity-filters'}),body=opportunityNode('button',{type:'button',id:'recordOpportunityBody',className:'fav-in record-opportunity-select'}),place=opportunityNode('button',{type:'button',id:'recordOpportunityPlace',className:'fav-in record-opportunity-select'});
 for(const [control,label,kind]of [[body,'天体','bodies'],[place,'撮影地点','places']]){const wrap=opportunityNode('div',{className:'record-opportunity-filter'}),caption=opportunityNode('span',{id:control.id+'Label'},label);control.setAttribute('aria-labelledby',caption.id+' '+control.id);control.setAttribute('aria-haspopup','dialog');control.setAttribute('aria-expanded','false');control.onclick=()=>opportunityOpenPicker(kind,control);wrap.append(caption,control);filters.append(wrap);}
 const notice=opportunityNode('p',{id:'recordOpportunityNotice',className:'tiny'});notice.setAttribute('role','status');
 const modelNotice=opportunityNode('p',{id:'recordOpportunityModelNotice',className:'tiny',hidden:true},'軌道上の候補。大気差は見え方で確認');
 const status=opportunityNode('div',{id:'recordOpportunityStatus',className:'tiny'});status.setAttribute('role','status');
 const list=opportunityNode('div',{id:'recordOpportunityList'}),pending=opportunityNode('div',{id:'recordOpportunityPending'}),actions=opportunityNode('div',{className:'record-opportunity-actions'});
 const through=opportunityNode('p',{id:'recordOpportunityThrough',className:'tiny record-opportunity-through'});
 const retry=opportunityNode('button',{type:'button',id:'recordOpportunityRetry',className:'chip',hidden:true},'再試行');
 const more=opportunityNode('button',{type:'button',id:'recordOpportunityMore',className:'chip',hidden:true},'さらに先を探す');
 retry.onclick=()=>{
  const job=opportunityJob;if(!job||!opportunityCurrent(job)||job.scan.state.running)return;
  opportunityNotice='';if(job.remote&&(!job.scan.state.error||job.scan.state.error.code==='overlap_plan_failed')&&job.scan.retry?.()){opportunityDom.rendered=-1;void opportunityAdvance(job);return;}const end=job.scan.state.end;opportunityCancel();opportunityCache.delete(job.key);renderOpportunities(end);
 };
 more.onclick=()=>{
  const job=opportunityJob;if(!job||!opportunityCurrent(job))return;
  if(job.scan.extend(opportunityPageEnd(job.scan.state.through),opportunityPageRows))void opportunityAdvance(job);
 };
 actions.append(retry,more);controls.append(period,filters);host.append(controls,modelNotice,notice,status,list,pending,through,actions);
 opportunityDom={host,prev,date,dateLabel,next,today,body,place,modelNotice,notice,status,list,pending,through,retry,more,rendered:0,lastDay:null};return true;
}
function opportunitySet(patch){
 if(!opportunityAllowed())return;opportunityClosePicker();
 const date=patch.date??opportunityFilters.date;
 if(!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date)||date<'1900-01-01'||date>'2100-12-31'||opportunityDateAt(opportunityBounds(date)[0])!==date){if(opportunityDom)opportunityDom.date.value=opportunityFilters.date;return;}
 opportunityDateChosen=true;opportunityOpenSeq++;opportunityNotice='';opportunityFilters={...opportunityFilters,...patch,date};opportunityCancel();renderOpportunities();
}
function opportunityRow(row,job){
 const button=opportunityNode('button',{type:'button',className:'record-opportunity-row'}),time=opportunityNode('span',{className:'record-opportunity-time'},S.JstCal.hhmm(row.event.at)),name=opportunityNode('strong',{},row.place.name+' → '+row.target.name),body=opportunityNode('span',{className:'record-opportunity-body'},AstroNotesBodies.definition(row.body)?.name||row.body),arrow=opportunityNode('span',{className:'record-opportunity-arrow'},'›');arrow.setAttribute('aria-hidden','true');button.append(time,name,body,arrow);const details=[];if(!row.place.eyeHeightRangeAGL&&job.pairs.some(p=>p.sourcePlaceId===row.sourcePlaceId&&p.target.id===row.target.id&&p.place.eyeHeightAGL!==row.place.eyeHeightAGL))details.push('地上'+row.place.eyeHeightAGL+'m');if(row.event.matchMode==='limb')details.push(RecordAlignment.text(row.target,row.event));if(row.place.eyeHeightRangeAGL)details.push('地上'+row.place.eyeHeightAGL+'m');if(row.shapeType)details.push((row.shapeType==='line'?'線上':'範囲内')+' '+row.place.latitude.toFixed(5)+', '+row.place.longitude.toFixed(5));if(details.length){button.classList.add('has-height');button.append(opportunityNode('span',{className:'record-opportunity-height'},details.join(' ・ ')));}button.dataset.opportunityId=row.id;button.onclick=()=>openOpportunity(row,job);return button;
}
// Rows of the day still being checked appear below the confirmed days, so
// confirmed rows never move. They join the list in order once the day ends.
function opportunityDrawPending(job){
 const d=opportunityDom,s=job.scan.state,pending=!s.done&&!job.remote?(s.pending||[]).slice().sort((a,b)=>a.event.at-b.event.at):[];
 job.pendingDrawn=pending.length;d.pending.replaceChildren();if(!pending.length)return;
 d.pending.append(opportunityNode('h3',{className:'record-opportunity-day'},dayText(pending[0].event.at)+'（確認中）'));
 for(const row of pending)d.pending.append(opportunityRow(row,job));
}
function opportunityDraw(job){
 if(!opportunityCurrent(job)||!opportunityDom)return;
 const d=opportunityDom,s=job.scan.state,rows=s.rows;
 d.modelNotice.hidden=false;
 d.host.setAttribute('aria-busy',String(s.running&&!s.done));
 if(d.rendered<0){d.list.replaceChildren();d.rendered=0;d.lastDay=null;}
 for(const row of s.rows.slice(d.rendered)){
  const date=opportunityDateAt(row.event.at);if(d.lastDay!==date){d.lastDay=date;d.list.append(opportunityNode('h3',{className:'record-opportunity-day'},dayText(row.event.at)));}
  d.list.append(opportunityRow(row,job));
 }d.rendered=s.rows.length;
 opportunityDrawPending(job);
 const failures=s.failures.length+job.unavailable;
 d.notice.textContent=opportunityNotice;
 if(s.error){job.progressUi=null;d.status.textContent=s.error.message||'サーバーに接続できません。再試行してください。';}
 else if(!s.done&&(job.remote||job.pairs.length)){
  if(job.progressUi?.node.parentNode!==d.status)job.progressUi=showRecordProgress(d.status,job.remote?'サーバーで確認中':'確認中','組');
  job.progressUi.update(s.checked,s.total);
 }else{
  job.progressUi=null;d.status.textContent=!job.pairs.length?(!opportunityFilters.allPlaces&&!opportunityFilters.places.length?'撮影地点を選び直してください。':job.unavailable?(job.policyUnavailable?'撮影地点の高さや重ね方を確認してください。':job.accessUnavailable===job.unavailable?'現在の権限では、この組み合わせを確認できません':'対象の登録を確認してください。'):'この組み合わせで確認できる記録がありません'):failures?(s.failures.length?'確認できなかった組み合わせがあります':job.accessUnavailable===job.unavailable?'現在の権限では確認できない組み合わせがあります':'対象の登録を確認してください。'):rows.length?'':'確認した期間に重なる組み合わせはありません';
 }
 d.through.textContent=job.pairs.length&&s.through>job.start?opportunityDateAt(s.through-1).replaceAll('-','/')+(failures?'まで探索（未確認あり）':'まで確認'):'';
 d.retry.hidden=!s.done||(!s.failures.length&&!s.error);
 d.more.hidden=!job.pairs.length||s.done&&s.through>=aimCandidateSearchEnd();
 d.more.disabled=!s.done||s.running||!!s.error;d.more.textContent=s.running?'計算中…':'さらに先を探す';
 if(opportunityRestore!==null&&(s.done||document.scrollingElement.scrollHeight-innerHeight>=opportunityRestore)){const top=opportunityRestore;opportunityRestore=null;requestAnimationFrame(()=>{if(opportunityActive())scrollTo(0,top);});}
}
async function opportunityAdvance(job){
 if(!job||!opportunityCurrent(job)||job.scan.state.running)return;
 await job.scan.advance();if(!opportunityCurrent(job)){if(opportunityJob===job&&opportunityActive()&&job.air!==opportunityAirKey(job.remote)){opportunityCancel();renderOpportunities();}return;}
 if(job.scan.state.cancelled){opportunityCancel();renderOpportunities();return;}
 if(job.remote&&job.scan.state.done&&!job.scan.state.error&&job.restoreThrough>job.scan.state.through&&job.scan.extend(opportunityPageEnd(job.scan.state.through))){void opportunityAdvance(job);return;}
 if(job.scan.state.done)opportunityRemember(job);
 opportunityDraw(job);
}
function renderOpportunities(retryEnd){
 recordSearchReset();
 const owner=auth?.token;
 if(opportunityOwner!==owner||opportunityOwnerId!==auth?.loginId){if(opportunityOwnerId&&opportunityOwnerId!==auth?.loginId){opportunityBackgroundFlight=null;opportunityDeviceFlights.clear();opportunityDeviceForget();}opportunityCancel(true);opportunityServer.cancel();opportunityWarmupKey='';opportunityOwner=owner;opportunityOwnerId=auth?.loginId;opportunityDateChosen=false;opportunityFilters={date:opportunityDateAt(Date.now()),bodies:['sun','moon'],allBodies:false,places:[],allPlaces:true};}
 if(!opportunityActive()){if(opportunityAllowed())setTimeout(opportunityWarmup,0);opportunityClosePicker();if(opportunityJob)opportunityCancel();if(opportunityHost?.firstChild){opportunityHost.replaceChildren();opportunityDom=null;}return;}
 if(!opportunityDateChosen){const selected=typeof SkyMapUI!=='undefined'?SkyMapUI.selectionState?.():null;opportunityFilters.date=opportunityDateAt(Number.isFinite(selected?.at)?selected.at:Date.now());opportunityDateChosen=true;}
 if(!opportunityBuild())return;
 opportunityPermittedBodies=AstroNotesBodies.definitions.filter(b=>aimTargetList().some(t=>AstroNotesAccess.canFrame(toolAllowed,t.id,b.id))).map(b=>b.id);if(opportunityFilters.allBodies)opportunityFilters.bodies=opportunityPermittedBodies.slice();
 if(opportunityPicker&&opportunityPicker.signature!==opportunityPickerKey(opportunityPicker.kind)){opportunityClosePicker();opportunityNotice='登録内容や利用条件が変わりました。選択を開き直してください。';}
 const signature=opportunitySignature(),d=opportunityDom,{pairs:allPairs,unavailable}=opportunityPairSet(signature,opportunityFilters.bodies),available=opportunityPairSet(signature,opportunityPermittedBodies);
 opportunityPlaces=[...new Map([...available.pairs.map(p=>[p.sourcePlaceId,p.place.name]),...available.unavailable.map(p=>[p.placeId,placeOf(p.placeId)?.name||'撮影地点'])]).entries()];
 if(opportunityFilters.allPlaces)opportunityFilters.places=opportunityPlaces.map(([id])=>id);else opportunityFilters.places=opportunityFilters.places.filter(id=>opportunityPlaces.some(([key])=>key===id));
 d.body.textContent=opportunityFilterLabel('bodies');d.place.textContent=opportunityFilterLabel('places');d.body.dataset.values=JSON.stringify(opportunityFilters.bodies);d.place.dataset.values=JSON.stringify(opportunityFilters.places);d.body.disabled=!opportunityPermittedBodies.length;d.place.disabled=!opportunityPlaces.length;
 d.date.value=opportunityFilters.date;d.dateLabel.textContent=opportunityFilters.date.replaceAll('-','/');d.date.min='1900-01-01';d.date.max='2100-12-31';d.prev.disabled=opportunityFilters.date===d.date.min;d.next.disabled=opportunityFilters.date===d.date.max;
 const [start]=opportunityBounds(opportunityFilters.date),end=Number.isFinite(retryEnd)?retryEnd:opportunityPageEnd(start),key=JSON.stringify([signature,opportunityFilters]);
 if(opportunityJob?.key===key&&opportunityCurrent(opportunityJob)){opportunityDraw(opportunityJob);return;}
 opportunityCancel();d.list.replaceChildren();d.rendered=-1;
 const includesPlace=p=>opportunityFilters.places.includes(p.sourcePlaceId??p.placeId),pairs=allPairs.filter(includesPlace),missing=unavailable.filter(includesPlace).length;
 const scanStart=start,job={remote:opportunityServer.state.enabled!==false,key,signature,owner,loginId:auth?.loginId,generation:accessState.generation,epoch:opportunityEpoch,inputEpoch:opportunityInputEpoch,revision:version,air:opportunityAirKey(opportunityServer.state.enabled!==false),pairs,unavailable:missing,accessUnavailable:unavailable.filter(p=>includesPlace(p)&&p.reason==='access').length,policyUnavailable:unavailable.filter(p=>includesPlace(p)&&['height','alignment'].includes(p.reason)).length,start:scanStart};opportunityJob=job;
 job.controller=new AbortController();
 job.scan={state:{day:start,end,through:start,rows:[],pending:[],failures:[],checked:0,total:0,done:false,running:true,error:null},cancel:()=>job.controller.abort()};
 opportunityDraw(job);void opportunityStart(job,end,retryEnd);
}
async function opportunityStart(job,end,retryEnd){
 try{
  const prefs=await opportunityServer.ready();if(opportunityJob!==job||job.controller.signal.aborted||!opportunityActive()||job.owner!==auth?.token||job.loginId!==auth?.loginId||job.generation!==accessState.generation)return;
  // Applying an existing account preference can change targets and the cache
  // signature. Rebuild pair metadata before accepting any server results.
  if(job.signature!==opportunitySignature()){opportunityCancel();renderOpportunities(retryEnd);return;}
  job.remote=prefs.enabled;job.air=opportunityAirKey(job.remote);
  if(job.remote){const cached=opportunityCache.get(job.key);if(cached?.remote){job.restoreThrough=cached.through;opportunityCache.delete(job.key);}job.scan=createServerOpportunityScan({api:(...args)=>apiTransport(...args),start:job.start,end,bodies:opportunityFilters.bodies.slice(),placeIds:opportunityFilters.allPlaces?null:opportunityFilters.places.slice(),sourceRev:prefs.sourceRev,isCurrent:()=>opportunityCurrent(job),onStart:()=>opportunityDraw(job),onDay:()=>opportunityDraw(job),onProgress:()=>opportunityDraw(job)});}
  else{
   const solve=(pair,day,isCurrent)=>opportunityDeviceSolve(pair,day,{isCurrent});
   job.scan=createOpportunityScan({pairs:job.pairs,start:job.start,end,notBefore:job.start,pageRows:Number.isFinite(retryEnd)?Infinity:opportunityPageRows,solve,ahead:()=>opportunityEngineSlots()*2,isCurrent:()=>opportunityCurrent(job),yieldTask:recordSearchYield,onStart:()=>opportunityDraw(job),onDay:()=>opportunityDraw(job),onProgress:s=>{if(!opportunityCurrent(job))return;job.progressUi?.update(s.checked,s.total);if(s.pending.length!==job.pendingDrawn)opportunityDraw(job);}});
   const cached=opportunityCache.get(job.key);if(cached){opportunityCache.delete(job.key);Object.assign(job.scan.state,cached,{running:false,cancelled:false});opportunityDraw(job);}
  }
  if(!job.scan.state.done)void opportunityAdvance(job);
 }catch(error){
  if(opportunityJob!==job||job.controller.signal.aborted||!opportunityActive()||job.owner!==auth?.token||job.loginId!==auth?.loginId||job.generation!==accessState.generation||job.epoch!==opportunityEpoch||job.inputEpoch!==opportunityInputEpoch||job.revision!==version)return;
  // The GET may have applied the account's target heights before a migration
  // CAS failed. Keep that error visible instead of leaving the old key loading.
  job.air=opportunityAirKey(job.remote);job.signature=opportunitySignature();Object.assign(job.scan.state,{running:false,done:true,error});opportunityDraw(job);
 }

}
function openOpportunityList(placeId='',bodies=null){
 if(!opportunityAllowed())return;
 opportunityOpenSeq++;opportunityNotice='';opportunityFilters={...opportunityFilters,places:placeId?[placeId]:[],allPlaces:!placeId,...(bodies?.length?{bodies:bodies.filter(b=>AstroNotesBodies.definition(b)),allBodies:false}:{})};opportunityCancel();
 if(sheet?.open)sheet.close();setNotebookTab('opportunities');if(!viewState.records)navigationHistory.pushRoute('#/records');renderOpportunities();
 requestAnimationFrame(()=>{el('recordOpportunities')?.scrollIntoView({block:'start'});el('recordOpportunityPlace')?.focus({preventScroll:true});});
}
async function openOpportunity(row,job){
 if(!opportunityCurrent(job)){renderOpportunities();return;}if(!job.scan.state.rows.includes(row)&&!job.scan.state.pending?.includes(row)||!AstroNotesAccess.canFrame(toolAllowed,row.target.id,row.body))return;
 opportunityNotice='';const ticket=++opportunityOpenSeq,owner=auth?.token,loginId=auth?.loginId,generation=accessState.generation,signature=job.signature,top=scrollY;
 try{
  await AstroNotesAssets.ensureModels();
  if(ticket!==opportunityOpenSeq||!opportunityCurrent(job))return;
  opportunityReturn={owner,loginId,generation,signature,top,ticket};navigationHistory.pushRoute('#/explore');await SkyMapUI.open();
  if(ticket!==opportunityOpenSeq||owner!==auth?.token||loginId!==auth?.loginId||!globalThis.TrialExplore?.active())return;if(generation!==accessState.generation||signature!==opportunitySignature())throw Error('conditions changed');
  SkyMapUI.setTarget(row.target.id);if(SkyMapUI.selectionState()?.target?.id!==row.target.id)throw Error('target unavailable');
  const body=el('skyMapBody');body.value=row.body;body.dispatchEvent(new Event('change',{bubbles:true}));SkyMapUI.setAlignment(row.event.partId??matchOpts(row.target).partId,row.event.limb||'center',row.event.matchMode||'overlap');SkyMapUI.setObserver(AstroNotesShooting.savedObserver(row.place));SkyMapUI.setTime(row.event.at);TrialExplore.render();el('exploreShowResult').click();
 }catch{if(ticket!==opportunityOpenSeq||owner!==auth?.token||loginId!==auth?.loginId)return;opportunityNotice='条件が変わったか、見え方を開けませんでした。もう一度お試しください。';if(opportunityReturn?.ticket===ticket){opportunityRestore=top;opportunityReturn=null;opportunityNotice='条件が変わったか、見え方を開けませんでした。もう一度お試しください。';if(globalThis.TrialExplore?.active())navigationHistory.goBack();}renderOpportunities();}
}
function opportunityHasReturn(){return !!opportunityReturn&&opportunityReturn.owner===auth?.token&&opportunityReturn.loginId===auth?.loginId&&opportunityReturn.generation===accessState.generation;}
function opportunityReturnFromPreview(){if(!opportunityHasReturn()||!globalThis.TrialExplore?.active())return false;opportunityRestore=opportunityReturn.top;opportunityReturn=null;navigationHistory.goBack();return true;}
for(const type of ['pointerdown','wheel'])el('recordOpportunities').addEventListener(type,()=>{opportunityRestore=null;},{passive:true});
const opportunityWatch=new MutationObserver(()=>{renderOpportunities();});opportunityWatch.observe(el('recordsView'),{attributes:true,attributeFilter:['hidden','data-tab']});
document.addEventListener('astronotes-records-change',()=>{setTimeout(()=>{if(opportunityAllowed()&&!document.hidden&&opportunityServer.state.enabled===false)opportunityDeviceBackground();},0);if(opportunityJob?.remote&&opportunityJob.signature===opportunitySignature())return;opportunityInputEpoch++;if(opportunityActive())renderOpportunities();});document.addEventListener('visibilitychange',renderOpportunities);document.addEventListener('astronotes-opportunity-input',()=>{if(opportunityApplyingPreferences)return;if(opportunityJob?.remote&&opportunityJob.air===opportunityAirKey(true))return;opportunityInputEpoch++;if(opportunityActive())renderOpportunities();});document.addEventListener('astronotes-opportunity-settings',()=>{if(opportunityApplyingPreferences)return;const key=JSON.stringify(opportunityListSettings()),changed=key!==opportunityListSettingsKey;opportunityListSettingsKey=key;if(changed)opportunityServer.changed();if(!changed&&opportunityServer.state.enabled===true)return;opportunityInputEpoch++;opportunityWarmupKey='';if(opportunityActive())renderOpportunities();else opportunityWarmup();});window.addEventListener('focus',renderOpportunities);
window.addEventListener('pagehide',()=>{if(opportunityJob)opportunityCancel();});window.addEventListener('pageshow',renderOpportunities);
window.addEventListener('hashchange',()=>{if(viewState.records&&opportunityHasReturn()){opportunityRestore=opportunityReturn.top;opportunityReturn=null;}else if(!viewState.records&&!globalThis.TrialExplore?.active())opportunityReturn=null;renderOpportunities();});
setTimeout(()=>{startupSessionReady.then(opportunityWarmup);},0);
const opportunities={render:renderOpportunities,open:openOpportunityList,hasReturn:opportunityHasReturn,returnFromPreview:opportunityReturnFromPreview};

renderRecordsHub();

function discoveryPoints(){
 if(!auth?.token||!toolAllowed('records'))return [];
 const {groups,shapes}=recordSearchIndex(),out=[],seen=new Map();
 for(const f of favorites){
  const shape=recordSearchShape(f,shapes),saved=shape?{...f,shape}:f;
  const live=[...(groups.get(f.id)?.values()||[])].flatMap(source=>{const group=source.slice().sort((a,b)=>Number(!!b.registration)-Number(!!a.registration)||when(b)-when(a)||b.updatedAt-a.updatedAt);return group[0]?.removed?[]:group.filter(r=>!r.removed);});
  for(const r of (f.eyeHeightRangeAGL!=null?live.slice(0,1):live)){
   const o=f.eyeHeightRangeAGL!=null?f:r.observer||f,p={...saved,latitude:o.latitude,longitude:o.longitude,elevation:o.elevation??f.elevation,groundManualM:o.elevation??f.groundManualM??f.elevation,eyeHeightAGL:o.eyeHeightAGL??f.eyeHeightAGL};
   // Keep the actual recorded eye height, even if the current picker uses another floor.
   if(Number.isFinite(o.eyeHeightAGL)){p.standAglM=o.eyeHeightAGL;p.stand='ground';}
   const key=p.shape?JSON.stringify([f.id,p.eyeHeightAGL,p.eyeHeightRangeAGL,p.shape]):JSON.stringify([p.latitude,p.longitude,p.groundManualM,p.eyeHeightAGL,p.eyeHeightRangeAGL]);if(seen.has(key)){seen.get(key).place.discoveryRecordIds.push(r.id);continue;}p.discoveryKey=key;p.discoveryRecordIds=[r.id];const entry={place:p,record:r};seen.set(key,entry);out.push(entry);
  }
  if(shape&&!live.length){const p={...saved},key=JSON.stringify([p.latitude,p.longitude,p.elevation,p.eyeHeightAGL,p.shape]);if(!seen.has(key)){p.discoveryKey=key;p.discoveryRecordIds=[];const entry={place:p,record:{result:'seen'}};seen.set(key,entry);out.push(entry);}}
 }
 return out;
}
function discoveryRevision(){return version;}
function discoverySearch(plan,points,isCurrent,terrainCache,onProgress){return recordSearch(plan,points,{isCurrent,terrainCache,onProgress});}

window.MyPlacesUI = { discoveryPoints,discoverySearch,discoveryRevision, recordSortControl,sortRecordPlaces, eyeAdjustmentFor, opportunities,recordProgress:showRecordProgress, backupState:()=>({observations:load(),shapes:shapeData()}),imported:()=>{version++;candidateCache.clear();changed();},selectShape, resetShapePicker, shapeFor, withShape, drawShape, renderAim, renderPickerPanel, skyDraw, skyRender, leaveSky, pickSky, badge, openPlace, recordFor, quickRecord, load, renderRecordsHub };
// 読み込みより先に構図が描かれていたら、ここで一覧を出す
if (el('aimView') && !el('aimView').hidden) { try { renderAim(); } catch { /* 構図を止めない */ } }
// A map without an observer renders synchronously, before this deferred module arrives.
if (el('skyMapView') && !el('skyMapView').hidden) SkyMapUI?.render?.();
})();

/* Legacy global names remain aliases for cached integrations. */
if(typeof AstroNotesAlign!=='undefined')globalThis.SoramiAlign=AstroNotesAlign;if(typeof AstroNotesAssets!=='undefined')globalThis.SoramiAssets=AstroNotesAssets;if(typeof AstroNotesAtmosphere!=='undefined')globalThis.SoramiAtmosphere=AstroNotesAtmosphere;if(typeof AstroNotesBodies!=='undefined')globalThis.SoramiBodies=AstroNotesBodies;if(typeof AstroNotesLibrary!=='undefined')globalThis.SoramiLibrary=AstroNotesLibrary;if(typeof AstroNotesShooting!=='undefined')globalThis.SoramiShooting=AstroNotesShooting;if(typeof AstroNotesTerrain!=='undefined')globalThis.SoramiTerrain=AstroNotesTerrain;
