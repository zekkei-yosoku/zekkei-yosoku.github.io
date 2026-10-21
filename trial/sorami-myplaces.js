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
const key = () => SoramiLibrary.keys(auth?.loginId).observations;
const isText = (v, max = 2000) => typeof v === 'string' && v.length <= max;
const finite = (v) => Number.isFinite(v);

// 取り込んだものを信用しない（手で書き換えられる・壊れる）。描画側でも esc する
function clean(r) { return SoramiLibrary.cleanObservation(r); }
function load() { const raw = store.get(key(), []); return Array.isArray(raw) ? raw.map(clean).filter(Boolean) : []; }
let version = 0;
function save(list) { const ok = store.set(key(), list); if (ok) { version++; changed(); } return ok; }
const when = (r) => r.date ? Date.parse(r.date + 'T12:00:00+09:00') : r.createdAt;

const placeOf = (id) => favorites.find((f) => f.id === id) || null;
const placeNear = (p, km = NEAR_KM) => p && favorites.find((f) => SoramiTerrain.distanceKm(f.latitude, f.longitude, p.latitude, p.longitude) < km) || null;
// 地点×目標の状態は最新の記録で決める（古い記録は残す。木の伸び・工事で変わるため）
function statusOf(placeId, targetKey, list = load()) {
  let best = null;
  for (const r of list) if (r.placeId === placeId && r.target.key === targetKey && (!best || (r.registration&&!best.registration) || (r.registration===best.registration && (when(r) > when(best) || (when(r) === when(best) && r.updatedAt >= best.updatedAt))) || (!r.registration&&!best.registration&&(when(r)>when(best)||(when(r)===when(best)&&r.updatedAt>=best.updatedAt))))) best = r;
  const here = placeOf(placeId);
  if (best?.observer && here && (SoramiTerrain.distanceKm(here.latitude, here.longitude, best.observer.latitude, best.observer.longitude) >= NEAR_KM || Math.abs((here.eyeHeightAGL ?? 1.5) - best.observer.eyeHeightAGL) > 1)) return null;
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
const targetChoices = () => [...new Map([...aimTargetList(),...(sheetState?.targetDrafts||[]).map(x=>SoramiLibrary.targetFromFavorite(x.entry))].filter(t=>t.id!=='custom'&&finite(t.latitude)&&(t.parts||[]).length).map(t=>[t.id,t])).values()];
const resolveTarget = (k) => targetChoices().find((t) => t.id === k) || null;

// 検索・現在地・地図・既存地点を、従来の共通ピッカーから選ぶ。予測の地点は動かさない。
PLACE_PICKERS.records = { title: '撮影地点', custom: () => null, point: () => place,
  set: p => { if (!auth?.token || !toolAllowed('records')) return; if(sheetOwnerMatches()&&sheet?.open&&!sheetState.place.id){setDraftPlace(p);return;}recordFor(p, null, 'records'); } };
// Shape metadata follows the same account-local lifetime as visible targets.
const shapesKey=()=>SoramiLibrary.keys(auth?.loginId).shapes;
function shapeData(){const raw=store.get(shapesKey(),{});return raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};}
function shapeFor(f){const r=shapeData()[f?.id];return r&&r.latitude===f.latitude&&r.longitude===f.longitude?SoramiShooting.cleanShape(r.shape):null;}
const withShape=f=>({...f,...(shapeFor(f)?{shape:shapeFor(f)}:{})});
const shapeName=s=>s?.type==='line'?'線':s?.type==='area'?'範囲':'点';
const shapeKey=s=>JSON.stringify(s||null);
async function candidateElevation(lat,lon){try{const g=await SoramiTerrain.groundElevation(lat,lon);return Number.isFinite(g)?g:null;}catch{return null;}}
function shapeIssue(result){
 const issues=result.issues||[];
 return issues.some(x=>x.reason==='limit')?'広いため調べ切れていない場所があります。記録で線・範囲を小さく分けて再試行してください。':issues.some(x=>x.reason==='invalid')?'線・範囲の形を確認してください。':result.failed?'標高などを取得できず、調べ切れていない場所があります。再試行してください。':'';
}
let shapeDialog=null,shapeMap=null,shapeEdit=null;
const draftPoint=()=>Number.isFinite(sheetState?.place.latitude)&&Number.isFinite(sheetState?.place.longitude);
function setDraftPlace(p){
 if(!sheetOwnerMatches()||!SoramiShooting.point(p))return;
 const existing=placeNear(p);
 if(existing){openPlace(existing,'records');return;}
 sheetState.place={...p,id:null,elevation:p.elevation??null,eyeHeightAGL:p.eyeHeightAGL??1.5};sheetState.newPlace=true;
 el('myRecordSaved').hidden=true;renderSheet();
}
function drawShape(ctx,project,s,{vertices=true,selected=-1}={}){
 if(!s?.vertices?.length)return;ctx.save();ctx.strokeStyle='#9ebed5';ctx.lineWidth=3;ctx.fillStyle='rgba(103,164,204,.18)';ctx.beginPath();
 s.vertices.forEach((p,i)=>{const q=project(p.latitude,p.longitude);if(i)ctx.lineTo(...q);else ctx.moveTo(...q);});
 if(s.type==='area'&&s.vertices.length>=3){ctx.closePath();ctx.fill();}ctx.stroke();
 if(vertices)s.vertices.forEach((p,i)=>{const q=project(p.latitude,p.longitude);ctx.beginPath();ctx.arc(...q,i===selected?9:6,0,Math.PI*2);ctx.fillStyle=i===selected?'#fff':'#9ebed5';ctx.fill();ctx.strokeStyle='#263441';ctx.lineWidth=2;ctx.stroke();ctx.font='bold 11px sans-serif';ctx.fillStyle='#fff';ctx.fillText(String(i+1),q[0]+10,q[1]-8);});ctx.restore();
}
function buildShapeEditor(){
 shapeDialog=document.createElement('dialog');shapeDialog.className='sheet';shapeDialog.id='myShapeSheet';shapeDialog.setAttribute('aria-labelledby','myShapeTitle');
 shapeDialog.innerHTML=`<div class="sheet-head"><strong id="myShapeTitle">撮影地点を選ぶ</strong><button type="button" id="shapeCancel">キャンセル</button></div><div class="sheet-body"><p class="tiny" id="shapeHelp"></p><button type="button" class="my-location-value" id="shapeSearch" aria-label="撮影地点" aria-expanded="false">撮影地点</button><section id="shapeLocationPanel" hidden><div class="my-actions"><input id="shapePlaceSearch" type="search" class="fav-in" placeholder="地名・緯度経度・地図のURL" aria-label="地図の移動先を検索"><button type="button" class="chip" id="shapePlaceSearchGo">検索</button></div><div id="shapePlaceResults"></div><div class="my-actions" role="group" aria-label="撮影地点の候補"><button type="button" class="chip" data-shape-source="favorites">お気に入り</button><button type="button" class="chip" data-shape-source="recent">履歴</button></div><div id="shapeSavedLocations" class="my-actions"></div></section><div class="mapwrap"><canvas id="shapeCanvas" aria-label="タップして点を置く地図"></canvas><details id="shapeTypeMenu" class="shape-type-tool"><summary id="shapeTypeLabel">点</summary><div class="my-actions" id="shapeModes" role="group" aria-label="場所の形"></div></details><div class="map-cross" aria-hidden="true">＋</div><div class="mapzoom"><button id="shapeIn" type="button" aria-label="拡大">＋</button><button id="shapeOut" type="button" aria-label="縮小">−</button></div></div><div class="my-actions"><button type="button" class="chip" id="shapeAddCenter">中心に点を追加</button><button type="button" class="chip" id="shapeUndo">1つ戻す</button></div><div class="my-actions"><select class="fav-in" id="shapeVertex" aria-label="編集する点"></select><button type="button" class="chip" id="shapeMove">中心へ移動</button><button type="button" class="chip" id="shapeRemove">点を削除</button></div><p class="tiny" id="shapeStatus" role="status"></p><button type="button" class="fav-btn primary" id="shapeApply">この形にする</button><p class="tiny">形と対象はこのブラウザに保存します。「まとめて保存」で確定します。</p></div>`;
 document.body.append(shapeDialog);
 for(const [type,label] of [['point','点'],['line','線'],['area','範囲']]){const b=document.createElement('button');b.type='button';b.className='chip';b.textContent=label;b.dataset.shapeMode=type;b.onclick=()=>{if(!shapeEditorCurrent())return;shapeEdit.undo.push(structuredClone(shapeEdit.value));shapeEdit.value.type=type;if(type==='point')shapeEdit.value.vertices=sheetState.place.id?[{latitude:sheetState.place.latitude,longitude:sheetState.place.longitude}]:shapeEdit.value.vertices.slice(0,1);shapeEdit.selected=-1;el('shapeTypeMenu').open=false;renderShapeEditor();};el('shapeModes').append(b);}
 shapeMap=createMapView({canvas:'shapeCanvas',zoomIn:'shapeIn',zoomOut:'shapeOut'});
 shapeMap.setOverlay((ctx,{project,width,height})=>{if(!shapeEditorCurrent())return;drawShape(ctx,project,shapeEdit.value,{selected:shapeEdit.selected});ctx.save();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(width/2-8,height/2);ctx.lineTo(width/2+8,height/2);ctx.moveTo(width/2,height/2-8);ctx.lineTo(width/2,height/2+8);ctx.stroke();ctx.restore();});
 const change=fn=>{if(!shapeEditorCurrent())return;shapeEdit.undo.push(structuredClone(shapeEdit.value));fn();renderShapeEditor();};
 const add=p=>{change(()=>{if(shapeEdit.value.type==='point')shapeEdit.value.vertices=[p];else if(shapeEdit.value.vertices.length<200){const i=shapeEdit.selected;shapeEdit.value.vertices.splice(i>=0?i+1:shapeEdit.value.vertices.length,0,p);}shapeEdit.selected=-1;});};
 shapeMap.onPick((p,pixel)=>{if(!shapeEditorCurrent())return;if(shapeEdit.value.type==='point'){if(!sheetState.place.id)add(p);return;}const i=shapeEdit.value.vertices.findIndex(v=>{const q=shapeMap.project(v.latitude,v.longitude);return Math.hypot(q[0]-pixel.x,q[1]-pixel.y)<16;});if(i>=0){shapeEdit.selected=i;renderShapeEditor();}else add(p);});
 el('shapeAddCenter').onclick=()=>{if(shapeEdit?.value.type==='point'&&sheetState.place.id)return;add(shapeMap.center());};
 el('shapeUndo').onclick=()=>{if(!shapeEditorCurrent()||!shapeEdit.undo.length)return;shapeEdit.value=shapeEdit.undo.pop();shapeEdit.selected=-1;renderShapeEditor();};
 el('shapeVertex').onchange=()=>{shapeEdit.selected=Number(el('shapeVertex').value);renderShapeEditor();};
 el('shapeMove').onclick=()=>change(()=>{if(shapeEdit.selected>=0)shapeEdit.value.vertices[shapeEdit.selected]=shapeMap.center();});
 el('shapeRemove').onclick=()=>change(()=>{if(shapeEdit.selected>=0)shapeEdit.value.vertices.splice(shapeEdit.selected,1);shapeEdit.selected=-1;});
 const move=p=>{if(!shapeEditorCurrent()||!SoramiLibrary.point(p))return;shapeEdit.searchName=p.name||'';shapeEdit.searchPlace=structuredClone(p);shapeMap.setView(p.latitude,p.longitude,16);el('shapeLocationPanel').hidden=true;el('shapeSearch').setAttribute('aria-expanded','false');};
 wireSearchBox('shapePlaceSearch','shapePlaceResults',move,move,{near:()=>shapeMap.center(),isCurrent:()=>shapeEditorCurrent()&&!el('shapeLocationPanel').hidden});
 el('shapeSearch').onclick=()=>{
  if(!shapeEditorCurrent())return;const panel=el('shapeLocationPanel');panel.hidden=!panel.hidden;el('shapeSearch').setAttribute('aria-expanded',String(!panel.hidden));
  renderLocations();
 };
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
 el('shapeCancel').onclick=()=>shapeDialog.close();
 shapeDialog.addEventListener('close',()=>{shapeEdit=null;});
 el('shapeApply').onclick=()=>{
  if(!shapeEditorCurrent())return;
  const value=shapeEdit.value,shape=value.type==='point'?null:SoramiShooting.cleanShape(value);
  if(value.type==='point'?!value.vertices.length:!shape)return;
  if(!sheetState.place.id){
   const p=value.vertices[0],existing=placeNear(p),candidate=shapeEdit.searchPlace;
   if(existing){
    const ctx=sheetState.ctx,targets=sheetState.draftTargets,drafts=sheetState.targetDrafts||[];
    shapeDialog.close();openPlace(existing,ctx);
    sheetState.draftTargets=[...new Map([...sheetState.draftTargets,...targets].map(t=>[t.key,t])).values()];
    sheetState.targetDrafts=drafts;sheetState.draftShape=shape;renderSheet();return;
   }
   const nearCandidate=candidate&&SoramiTerrain.distanceKm(candidate.latitude,candidate.longitude,p.latitude,p.longitude)<.02;
   const eye=nearCandidate?(candidate.eyeHeightAGL??aimObserverEye(aimSavedFrom(candidate))):sheetState.place.eyeHeightAGL??1.5;
   const ground=nearCandidate?candidate.groundManualM??candidate.elevation:null;
   sheetState.place={id:null,name:sheetState.place.name||shapeEdit.searchName||(shape?shapeName(shape)+'の撮影地点':'撮影地点'),latitude:p.latitude,longitude:p.longitude,elevation:ground??(p.latitude===sheetState.place.latitude&&p.longitude===sheetState.place.longitude?sheetState.place.elevation??null:null),eyeHeightAGL:eye};sheetState.newPlace=true;
  }
  sheetState.draftShape=shape;el('myRecordSaved').hidden=true;shapeDialog.close();renderSheet();
 };
}
function shapeEditorCurrent(){return !!shapeEdit&&sheetOwnerMatches()&&shapeEdit.owner===auth?.token&&shapeEdit.state===sheetState;}
function renderShapeEditor(){
 if(!shapeEditorCurrent())return;const s=shapeEdit.value,type=s.type;
 el('shapeTypeLabel').textContent=shapeName(s);
 for(const b of el('shapeModes').children)b.setAttribute('aria-pressed',String(b.dataset.shapeMode===type));
 el('shapeHelp').textContent=type==='point'?(sheetState.place.id?'登録済みの撮影地点です。線・範囲へ変更できます。':'地図をタップして撮影地点を置きます。'):type==='line'?'地図をタップして順につなぎます。2点で直線、3点で折れ線。点を選ぶと、その後ろに追加できます。':'地図をタップして外周を囲みます。最後の点と最初の点をつないだ内側が範囲です。';
 const select=el('shapeVertex');select.disabled=type==='point';select.replaceChildren(new Option('点を選んで編集','-1'),...s.vertices.map((_,i)=>new Option('点 '+(i+1),String(i))));select.value=String(shapeEdit.selected);
 el('shapeMove').disabled=el('shapeRemove').disabled=shapeEdit.selected<0;el('shapeUndo').disabled=!shapeEdit.undo.length;
 el('shapeAddCenter').disabled=type==='point'?!!sheetState.place.id:s.vertices.length>=200;el('shapeAddCenter').textContent=type==='point'?'中心を撮影地点にする':'中心に点を追加';
 const clean=type==='point'?null:SoramiShooting.cleanShape(s);el('shapeApply').disabled=type==='point'?!s.vertices.length:!clean;
 el('shapeStatus').textContent=type==='point'?(s.vertices.length?'点として登録できます。':'撮影地点を置いてください。'):`${s.vertices.length}点${clean?' ・ '+shapeName(clean)+'として登録できます':type==='line'?' ・ 2点以上を置いてください。同じ点は続けて置けません。':' ・ 3点以上で囲んでください。交差する枠は登録できません。'}`;
 shapeMap.redraw();
}
function openShapeEditor(mode){
 if(!sheetOwnerMatches())return;if(!shapeDialog)buildShapeEditor();
 const s=sheetState.draftShape;shapeEdit={owner:auth.token,state:sheetState,selected:-1,undo:[],value:s?structuredClone(s):{type:'point',vertices:draftPoint()?[{latitude:sheetState.place.latitude,longitude:sheetState.place.longitude}]:[]}};
 if(typeof mode==='string')shapeEdit.value.type=mode;
 // 既存地点の代表点は動かさず、形だけを編集する。新規では未保存のまま地図を開く。
 if(sheetState.place.id&&shapeEdit.value.type==='point')shapeEdit.value.vertices=[{latitude:sheetState.place.latitude,longitude:sheetState.place.longitude}];
 el('shapeTypeMenu').open=false;el('shapeLocationPanel').hidden=true;el('shapeSearch').setAttribute('aria-expanded','false');el('shapePlaceSearch').value='';el('shapePlaceSearch').dispatchEvent(new Event('input'));
 showSheet(shapeDialog);shapeMap.open(s?.vertices[0]||(draftPoint()?sheetState.place:place),16);
 if(s){const v=s.vertices,lat0=Math.min(...v.map(p=>p.latitude)),lat1=Math.max(...v.map(p=>p.latitude)),lon0=Math.min(...v.map(p=>p.longitude)),lon1=Math.max(...v.map(p=>p.longitude)),lat=(lat0+lat1)/2;shapeMap.setView(lat,(lon0+lon1)/2,Math.min(17,Math.log2(220/(256*Math.max(.00001,(lon1-lon0)/360))),Math.log2(220/(256*Math.max(.00001,(lat1-lat0)/(360*Math.cos(lat*Math.PI/180)))))));}
 renderShapeEditor();
}

// ---------------------------------------------------------------- 記録：撮影ポイントへの入口
let recordsTargetFilter = '', recordsBodyFilter = '', recordsFilterOwner = null;
function renderRecordsHub() {
  const host = el('myRecordsHub'); if (!host) return;
  host.replaceChildren();
  if (skyOwner !== auth?.token || !toolAllowed('skymap')) { leaveSky(); skyOwner=auth?.token; }
  if (sheet?.open && sheetState?.ownerToken !== auth?.token) sheet.close();
  if(shapeDialog?.open&&!shapeEditorCurrent())shapeDialog.close();
  // 非表示でも旧アカウントの地点・記録をDOMへ残さない。
  if (!auth?.token || !toolAllowed('records')) return;
  // 2026-10-20 ユーザー「不要な説明は消しといて」：冒頭の使い方の一文は出さない（タブ名と中身で分かる）
  const actions = document.createElement('div'); actions.className = 'my-head';
  const add = document.createElement('button'); add.type = 'button'; add.className = 'chip my-add-point'; add.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';add.setAttribute('aria-label','記録を追加');add.title='記録を追加';
  add.onclick = () => { if (auth?.token && toolAllowed('records')) openPlace(null,'records'); };
  if (toolAllowed('skymap')) { const map = document.createElement('button'); map.type = 'button'; map.className = 'chip'; map.textContent = '地図で場所を探す'; map.onclick = () => pushRoute('#/skymap'); actions.append(map); }
  // 2026-10-21 ＋は撮影地点の操作行へ。タブで見出し高さを変えない。
  actions.append(add);
  host.append(actions);
  const list = document.createElement('div'); list.className = 'al my-list'; host.append(list);
  const records = load();
  // Favorites are location candidates, not records. Keep historical records
  // and explicitly saved line/area locations visible without adding bare favorites.
  const recordedIds=new Set(records.map(r=>r.placeId));
  const recordedPlaces=favorites.filter(f=>recordedIds.has(f.id)||!!shapeFor(f));
  if(recordsFilterOwner!==auth.token){recordsFilterOwner=auth.token;recordsTargetFilter='';recordsBodyFilter='';}
  const filterTargets=[...new Map(recordedPlaces.flatMap(f=>targetsSeenFrom(f.id).filter(r=>r.result!=='hidden').map(r=>[r.target.key,r.target]))).values()];
  if(!filterTargets.some(t=>t.key===recordsTargetFilter))recordsTargetFilter='';
  const filters=document.createElement('div');filters.className='my-actions';
  const reset=document.createElement('button');reset.type='button';reset.className='chip';reset.textContent='すべて';reset.setAttribute('aria-pressed',String(!recordsTargetFilter&&!recordsBodyFilter));reset.onclick=()=>{recordsTargetFilter='';recordsBodyFilter='';renderRecordsHub();};
  const targetSelect=document.createElement('select');targetSelect.className='fav-in';targetSelect.setAttribute('aria-label','対象で絞り込む');targetSelect.replaceChildren(new Option('すべての対象',''),...filterTargets.map(t=>new Option(t.name,t.key)));targetSelect.value=recordsTargetFilter;targetSelect.onchange=()=>{recordsTargetFilter=targetSelect.value;renderRecordsHub();};
  const bodySelect=document.createElement('select');bodySelect.className='fav-in';bodySelect.setAttribute('aria-label','撮りたい天体で絞り込む');bodySelect.replaceChildren(new Option('すべての天体',''),...SoramiBodies.definitions.map(b=>new Option(b.name,b.id)));bodySelect.value=recordsBodyFilter;bodySelect.onchange=()=>{recordsBodyFilter=bodySelect.value;renderRecordsHub();};
  filters.append(reset,targetSelect,bodySelect);host.insertBefore(filters,list);
  if(recordsBodyFilter){const hint=document.createElement('p');hint.className='tiny';hint.textContent='選んだ天体との重なりを調べられる対象がある撮影地点です。';host.insertBefore(hint,list);}
  let matches=0;
  if (!recordedPlaces.length) { const empty = document.createElement('p'); empty.className = 'tiny'; empty.textContent = '記録はまだありません。右上の＋から追加できます。'; list.append(empty); }
  for (const f of recordedPlaces) {
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
    row.append(name, sub); row.onclick = () => {openPlace(f, 'records');if(recordsBodyFilter){sheetState.bodies=[recordsBodyFilter];for(const check of sheet.querySelectorAll('[data-planning-body]'))check.checked=check.value===recordsBodyFilter;}}; list.append(row);
  }
  if(recordedPlaces.length&&!matches){const empty=document.createElement('p');empty.className='tiny';empty.textContent='この条件の撮影地点はありません。';list.append(empty);}
  // 2026-10-20 ユーザー「出し方を変えた方がいいのも最適化して」：保存先の説明は常に出さず、データの控えの中へ
  const note = document.createElement('p'); note.className = 'tiny'; note.textContent = '見える対象と線・範囲はこのブラウザに保存します。撮影地点の名前・代表位置（お気に入り）は同期します。';
  const backup=document.createElement('details');backup.className='my-secondary';const summary=document.createElement('summary');summary.textContent='データの控え';backup.append(summary,note);
  const hint=document.createElement('p');hint.className='tiny';hint.textContent='撮影地点・対象・線/範囲・予測の結果を保存します。写真ファイルは含みません。';backup.append(hint);
  const exportButton=document.createElement('button');exportButton.type='button';exportButton.className='chip';exportButton.textContent='書き出す';exportButton.onclick=downloadLibraryBackup;
  const importButton=document.createElement('button');importButton.type='button';importButton.className='chip';importButton.textContent='読み込む';importButton.onclick=()=>el('importFile').click();backup.append(exportButton,importButton);host.append(backup);
}
async function openFromRecords(place, target = null, row = null) {
  if (!screenAllowed('framing')) return;
  const token = auth?.token, openedSheet = sheetState;
  try {
    await SoramiAssets.ensureModels();
    if (token !== auth?.token || !screenAllowed('framing') || sheetState !== openedSheet || !sheet?.open || !atRecords) return false;
    if (sheet?.open && sheetState === openedSheet) sheet.close();
    pushRoute('#/aim');
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
const sideName = (body, side) => !SoramiBodies.definition(body)?.limbs ? (side === 'set' ? '沈む側' : '昇る側')
  : body === 'moon' ? (side === 'set' ? '月の入' : '月の出') : (side === 'set' ? '日の入' : '日の出');
function dayText(at) {
  const y = new Date(at + 9 * 3600000).getUTCFullYear(), now = new Date(Date.now() + 9 * 3600000).getUTCFullYear();
  return `${y === now ? '' : y + '/'}${S.Cal.monthDay(at)}(${S.Cal.weekday(at)})`;
}
// 1組につき次の1回。400日で無ければ「重なりません」（既存の言い切りと同じ根拠）
function nextFor(place, target, body, { partId = null, limb = 'center', matchMode = 'overlap' } = {}) {
  const from = aimSavedFrom(SoramiShooting.savedObserver(place));
  if (!from || !target) return Promise.resolve(null);
  const top = (SoramiAlign.partOf(target, partId) || {}).m;
  const k = JSON.stringify([from.latitude, from.longitude, from.groundManualM, aimObserverEye(from), target.id, target.latitude, target.longitude, top, body, partId, limb, matchMode, S.Cal.startOfDay(Date.now())]);
  const hit = cache.get(k);
  if (hit && (!hit.until || Date.now() < hit.until)) return hit.promise;
  const entry = { until: 0, promise: null };
  entry.promise = queue = queue.catch(() => {}).then(async () => {
    await SoramiBodies.ensure(body);
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
  aimSetFrom(SoramiShooting.savedObserver(place), { keepMap: true });
  if (row) {
    aim.candPick = null; aim.spot = null; aim.wantSpot = null; aim.wantKey = null; aim.candSide = row.side;
    el('aimDate').value = new Date(S.Cal.startOfDay(row.at) + 9 * 3600000).toISOString().slice(0, 10);
    aim.plannerTransfer={at:row.at,body:aim.body,latitude:place.latitude,longitude:place.longitude,day:SoramiShooting.day(row.at)};
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
 const mode=placeSheetFor,isSky=mode==='skymap';
 const state=()=>isSky?skySession:{target:aim.target,body:aim.body,partId:aim.partId,limb:aim.limb,matchMode:aim.matchMode,at:aim.dayMs};
 const t=state()?.target,plan=SoramiShooting.conditions(state()),selectedShape=pickerShapeId;
 const pickerPoints=s=>pointsForPlan(s).filter(x=>!selectedShape||x.place.id===selectedShape);
 const note=document.createElement('p');note.className='tiny';box.append(note);
 if(!plan||t.id==='custom'){note.textContent='対象を選び、自分の対象に登録すると、その対象が見えた撮影地点から候補を探せます。';return;}
 if(!owner||!screenAllowed(isSky?'skymap':'framing')){note.textContent='ログインして利用権限を確認してください。';return;}
 note.textContent=`${S.Cal.monthDay(plan.at)}・${SoramiBodies.definition(plan.body)?.name}を${t.name}に重ねる候補を確認しています…`;
 const query=()=>{const s=state();return s?.target?SoramiShooting.queryKey(s,pickerPoints(s),auth?.loginId,SoramiAtmosphere.dataKey(s.at)):'';};
 const key=query();
 const current=()=>token===pickerToken&&owner===auth?.token&&screenAllowed(isSky?'skymap':'framing')&&el('placeSheet').open&&placeSheetFor===mode&&key===query();
 try{
  const result=await SoramiShooting.candidates(plan,pickerPoints(plan),{align:SoramiAlign,isMountain:aimIsMountain,observerAt:(f,g)=>aimObserverAt(aimSavedFrom(f),g),elevationAt:candidateElevation,viewFor:(obs,p)=>aimShootingView(obs,p.target,p.body,p.partId,p.matchMode),ensure:b=>SoramiBodies.ensure(b),isCurrent:current,onProgress:p=>{if(current())note.textContent='線上・範囲内を確認しています… '+p.checked+'地点';}});
  if(!current()||result.cancelled)return;
  note.textContent=`${S.Cal.monthDay(plan.at)}・${SoramiBodies.definition(plan.body)?.name}を${t.name}に：${result.rows.length}件${selectedShape?'（'+(placeOf(selectedShape)?.name||'選んだ場所')+'）':''}`;
  if(!result.rows.length){const empty=document.createElement('p');empty.className='tiny';empty.textContent=result.failed?'確認できていない撮影地点があります。再試行してください。':'この日に重なる撮影地点はありません。日付や対象を変えるか、記録に撮影地点と見えた対象を追加してください。';box.append(empty);}
  if(result.failed){const failed=document.createElement('p');failed.className='tiny';failed.textContent=shapeIssue(result)||`${result.failed}地点を確認できませんでした。`;box.append(failed);}
  for(const row of result.rows){const button=document.createElement('button');button.type='button';button.className='list-item my-place-row';const title=document.createElement('strong');title.textContent=row.place.name;const sub=document.createElement('span');sub.className='tiny sub-line';sub.textContent=`${S.JstCal.hhmm(row.event.at)}・${sideName(plan.body,row.event.side)}・${RESULTS[row.record.result].name}${row.shapeType?' ・ '+(row.shapeType==='line'?'線上':'範囲内')+' '+row.place.latitude.toFixed(5)+', '+row.place.longitude.toFixed(5):''}`;button.append(title,sub);button.onclick=()=>{if(!current())return;if(isSky){if(SkyMapUI?.selectCandidate?.(row,contextOf(skySession)))el('placeSheet').close();}else{el('placeSheet').close();openInAim(row.place,row.event);}};box.append(button);}
  if(result.failed){const retry=document.createElement('button');retry.type='button';retry.className='chip';retry.textContent='再試行';retry.onclick=()=>renderPickerPanel(panel);box.append(retry);}
 }catch{if(current()){note.textContent='候補を確認できませんでした。';const retry=document.createElement('button');retry.type='button';retry.className='chip';retry.textContent='再試行';retry.onclick=()=>renderPickerPanel(panel);box.append(retry);}}
}

// ---------------------------------------------------------------- 地図：指定日の撮影ポイント候補
let skySession=null,skyKey='',skyToken=0,skyOwner=null;
function leaveSky(){el('skyMapAlignmentControls')?.replaceChildren();const alignmentDetail=el('skyMapAlignmentDetails');if(alignmentDetail)alignmentDetail.hidden=true;skySession=null;skyKey='';skyToken++;candidateState={status:'idle',rows:[],failed:0};candidateCache.clear();candidateSheet?.close();el('shootingCandidatesList')?.replaceChildren();const condition=el('shootingCandidatesCondition');if(condition)condition.textContent='';el('mySkyPlaces')?.replaceChildren();overlapGate(false,'');}
let pinsOn=store.get('sorami.candidatePins',true)!==false;
let candidateState={status:'idle',rows:[],failed:0},candidateSheet=null,selectedCandidate=null;
const candidateCache=new Map();
const overlapGate=SoramiShooting.hapticGate({vibrate:ms=>{if(!document.hidden&&store.get('sorami.haptic',true)!==false)navigator.vibrate?.(ms);}});
const contextOf=s=>JSON.stringify([s.body,s.target,s.partId,s.limb,SoramiShooting.day(s.at),s.matchMode||'limb']);
function pointsForPlan(s){
 return placesFor(s.target.id).filter(x=>x.record.observer&&finite(x.record.target.latitude)&&finite(x.record.target.longitude)&&SoramiTerrain.distanceKm(x.record.target.latitude,x.record.target.longitude,s.target.latitude,s.target.longitude)<NEAR_KM);
}
function currentSkyQuery(s){return SoramiShooting.queryKey(s,pointsForPlan(s),auth?.loginId,SoramiAtmosphere.dataKey(s.at));}
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
 el('shootingCandidatesCondition').textContent=`${S.Cal.monthDay(skySession.at)}・${SoramiBodies.definition(skySession.body)?.name}を${skySession.target.name}に`;
 showSheet(candidateSheet);drawCandidateList();
}
function skyBox(){let box=el('mySkyPlaces');if(!box){box=document.createElement('section');box.id='mySkyPlaces';box.className='my-places';box.setAttribute('aria-label','撮影地点');el('skyMapDates').closest('.sky-map-candidates').after(box);}return box;}
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
 if(s.daily&&s.eye&&s.target)try{const o=SoramiShooting.searchOptions(s,aimIsMountain);hit=o.broad&&o.disc?SoramiAlign.dailyView(s.eye,s.target,s.body,s.at,{partId:o.partId,eyeM:0,at:s.at})[0]:SoramiAlign.alignmentAt(s.eye,s.target,s.body,s.at,{partId:o.partId,limb:o.limb,eyeM:0});if(o.broad&&o.disc)hit={...hit,matched:!!hit?.intersects};}catch{}
 const matched=!!hit?.matched,key=JSON.stringify([auth?.loginId,s.observer,s.target,s.body,s.partId,s.limb,SoramiShooting.day(s.at)]);
 overlapGate(matched,key);
 const text=matched?'重なる位置です':hit?'時間を動かして重なりを確認':'重なりを確認しています…';
 if(out.textContent!==text)out.textContent=text;
 out.classList.toggle('shooting-overlap-on',matched);
}
function skyRender(s){
 if(skyOwner!==auth?.token){leaveSky();skyOwner=auth?.token;}
 skySession=s;if(!s||!auth?.token||!toolAllowed('skymap'))return;
 const box=skyBox(),t=s.target;
 const shareRow=el('skyMapShareRow');if(shareRow){shareRow.hidden=!s.observer||!t;const shareButton=shareRow.querySelector('button');if(shareButton)shareButton.disabled=!s.daily||!s.eye;}
 const detail=el('skyMapAlignmentDetails');detail.hidden=!t;el('skyMapAlignmentSummary').textContent='重ね方';
 if(!t){skyKey='';candidateState={status:'idle',rows:[],failed:0};box.textContent='何を・何に重ねるかと撮影日を選ぶと、記録した撮影地点から候補を出します。';candidateSheet?.close();return;}
 const key=currentSkyQuery(s);
 if(key!==skyKey){
  skyKey=key;selectedCandidate=null;const token=++skyToken,owner=auth.token,plan=SoramiShooting.conditions(s),points=pointsForPlan(s);
  box.replaceChildren();
  const controls=document.createElement('div');controls.className='my-head';
  const trigger=document.createElement('button');trigger.type='button';trigger.className='fav-btn primary';trigger.id='shootingCandidatesOpen';trigger.onclick=showCandidateList;
  const toggle=document.createElement('button');toggle.type='button';toggle.className='chip';toggle.id='shootingPins';toggle.setAttribute('role','switch');toggle.setAttribute('aria-label','候補ピンを地図に表示');toggle.textContent='候補ピン';toggle.onclick=()=>{pinsOn=!pinsOn;store.set('sorami.candidatePins',pinsOn);updateCandidateUI();SkyMapUI?.redraw?.();};
  controls.append(trigger,toggle);box.append(controls);
  const alignment=document.createElement('div');alignment.className='alignment-controls';
  const mountain=aimIsMountain(t),parts=t.parts||[],whole=parts.length>0&&!mountain;
  const part=document.createElement('select');part.className='fav-in';part.setAttribute('aria-label','重ねる対象の部位');part.replaceChildren(...parts.map(p=>new Option(`${p.name} ${Math.round(p.m-(t.groundM||0))}m`,p.id)),...(whole?[new Option(t.wholeLabel||'建物全体に重なる','__whole')]:[]));part.value=s.partId??parts[0]?.id??'';part.hidden=parts.length+(whole?1:0)<2;
  part.onchange=()=>SkyMapUI?.setAlignment?.(part.value||null,s.limb||'center','limb');alignment.append(part);
  const limbs=document.createElement('div');limbs.className='aim-limb';limbs.setAttribute('role','group');limbs.setAttribute('aria-label','天体のどこを合わせるか');limbs.hidden=s.partId==='__whole';
  for(const l of SoramiBodies.definition(s.body)?.limbs?SoramiAlign.LIMBS:SoramiAlign.LIMBS.filter(l=>l.id==='center')){
   const button=document.createElement('button');button.type='button';button.disabled=!SoramiBodies.definition(s.body)?.limbs;const on=s.matchMode!=='overlap'&&s.limb===l.id;button.setAttribute('aria-pressed',String(on));button.setAttribute('aria-label',aimLimbSay(l.id,mountain,s.body));button.innerHTML=aimLimbFigure(l.sign,mountain,`skyLimbMask-${l.id}`)+`<span>${esc(l.name)}</span>`;button.onclick=()=>SkyMapUI?.setAlignment?.(s.partId,l.id,on?'overlap':'limb');limbs.append(button);
  }
  alignment.append(limbs);el('skyMapAlignmentControls').replaceChildren(alignment);
  const status=document.createElement('p');status.className='tiny';status.id='shootingCandidateStatus';status.setAttribute('role','status');
  const overlap=document.createElement('p');overlap.className='tiny shooting-overlap';overlap.id='shootingOverlap';overlap.setAttribute('role','status');box.append(status,overlap);

  candidateState={status:'loading',rows:[],failed:0};updateCandidateUI();
  let job=candidateCache.get(key);
  if(!job){job=SoramiShooting.candidates(plan,points,{align:SoramiAlign,isMountain:aimIsMountain,observerAt:(f,g)=>aimObserverAt(aimSavedFrom(f),g),elevationAt:candidateElevation,viewFor:(obs,p)=>aimShootingView(obs,p.target,p.body,p.partId,p.matchMode),ensure:b=>SoramiBodies.ensure(b),isCurrent:()=>owner===auth?.token&&token===skyToken&&!!skySession&&currentSkyQuery(skySession)===key,onProgress:p=>{if(owner===auth?.token&&token===skyToken){const status=el('shootingCandidateStatus');if(status)status.textContent='線上・範囲内を確認しています… '+p.checked+'地点';}}});candidateCache.set(key,job);if(candidateCache.size>24)candidateCache.delete(candidateCache.keys().next().value);}
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
function openInSky(place,row){SkyMapUI?.setObserver?.(SoramiShooting.savedObserver(place));if(row)SkyMapUI?.setTime?.(row.at);}

// ---------------------------------------------------------------- 撮影ポイントの画面（記録と次に重なる日）
let sheet = null, sheetState = null, sheetToken = 0, undoRec = null;
// A place can have many visible targets; celestial bodies are planning filters,
// never a restriction on the saved visibility observation.
const inputRoleIcon = role => `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="#input-icon-${role}"/></svg>`;
function planningPairs(records, bodies) {
  return records.filter(r => r.result !== 'hidden').flatMap(record => bodies.filter(body => {
    if (!SoramiBodies.definition(body)) return false;
    return record.target.key === 'fuji' ? (body === 'sun' ? toolAllowed('diamond') : body === 'moon' ? toolAllowed('pearl') : toolAllowed('tower') && (toolAllowed('diamond') || toolAllowed('pearl'))) : toolAllowed('tower');
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
const draftChanged=()=>!!sheetState&&((sheetState.targetDrafts||[]).length>0||sheetState.newPlace||targetSetKey(sheetState.draftTargets)!==sheetState.baseline||shapeKey(sheetState.draftShape)!==shapeKey(sheetState.initialShape));
function addDraftTarget(t){
  if(!sheetOwnerMatches()||!t)return;
  if(!sheetState.draftTargets.some(x=>x.key===(t.key||t.id)))sheetState.draftTargets.push(targetData(t));
  el('myRecordTarget').value='';el('myRecordError').hidden=true;el('myRecordSaved').hidden=true;renderSheet();
}
function showRecordEditor(){if(!sheetOwnerMatches())return;el('myTargetPicker').hidden=false;el('myRecordAdd').hidden=true;}
function discardDraft(){if(draftChanged()&&!confirm('変更を保存せず閉じますか？'))return false;return true;}
function registrationChanges(place,before,after,now=Date.now()){return SoramiLibrary.registrationChanges(place,before,after,now);}
function buildSheet() {
  sheet = document.createElement('dialog'); sheet.className = 'sheet'; sheet.id = 'myPlaceSheet'; sheet.tabIndex = -1; sheet.setAttribute('aria-labelledby', 'myPlaceTitle');
  sheet.innerHTML = `<div class="sheet-head"><strong id="myPlaceTitle">記録を追加</strong><button type="button" data-close aria-label="閉じる">閉じる</button></div>
  <div class="sheet-body">

    <div class="my-input-field"><div class="condition-label">${inputRoleIcon('observer')}<span>撮影地点</span></div><button type="button" class="my-location-value" id="myPlaceName" aria-label="撮影地点を選ぶ"></button><label id="myNewPlaceNameLabel" hidden><input class="my-location-value" id="myNewPlaceName" maxlength="200" placeholder="場所の名前" aria-label="場所の名前"></label></div>
    <div class="my-actions"><button type="button" class="chip" id="myShapeEdit">点・線・範囲</button><span class="tiny" id="myShapeSummary"></span></div><div id="myRecordLocationConfirm" hidden><p class="tiny">保存していない対象の編集を戻して、撮影地点を変更しますか？</p><button type="button" class="chip" id="myRecordLocationChange">変更する</button><button type="button" class="chip" id="myRecordLocationKeep">戻る</button></div>
    <div class="my-input-field"><div class="condition-label">${inputRoleIcon('target')}<span>対象</span></div><button type="button" class="my-location-value" id="myRecordPickTarget" aria-label="対象を選んで追加">対象を追加</button></div>
    <select id="myRecordTarget" hidden aria-label="対象"></select><button id="myRecordAdd" type="button" hidden>対象を追加</button><div id="myTargetPicker" hidden></div>
    <div id="myPlaceRecords"></div>
    <p class="warn" id="myRecordError" role="status" hidden></p><button type="button" class="chip" id="myRecordReuse" hidden>登録済みの地点で編集を続ける</button><p class="tiny" id="myRecordSaved" role="status" hidden></p>
    <div class="my-actions"><button type="button" class="fav-btn primary" id="myRecordSave">まとめて保存</button><button type="button" class="chip" id="myRecordCancel">キャンセル</button></div>
    <p class="tiny muted">対象はこのブラウザに保存します。登録日は保存時に自動で残します。</p>
    <details id="myPlacePlanning" class="my-secondary"><summary>この場所から撮る</summary><div class="my-actions"><button type="button" class="chip" id="myPlaceUse">ここから見る</button><button type="button" class="chip" id="myPlaceMap">地図でここから見る</button></div><fieldset class="my-body-options"><legend class="condition-label">${inputRoleIcon('body')}<span>天体</span><span class="tiny">複数選択可</span></legend><div id="myPlaceBodies"></div></fieldset><button type="button" class="chip" id="myPlaceFind">次に重なる日を探す</button><h3 class="my-title">次に重なる日</h3><div class="al my-list" id="myPlaceNext"></div></details>
    <details id="myPlaceDetails" class="my-secondary"><summary>場所の詳細</summary><p class="tiny" id="myPlaceSub"></p></details>
  </div>`;
  document.body.append(sheet);
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
  el('myNewPlaceName').oninput=()=>{if(sheetOwnerMatches()&&!sheetState.place.id){sheetState.place.name=el('myNewPlaceName').value;el('myRecordSaved').hidden=true;}};
  sheet.addEventListener('close', () => { sheetToken++; undoRec = null; });
  for (const body of SoramiBodies.definitions) {
    const label=document.createElement('label'),check=document.createElement('input');
    check.type='checkbox';check.value=body.id;check.dataset.planningBody=body.id;
    check.onchange=()=>{if(!sheetOwnerMatches())return;sheetState.bodies=[...sheet.querySelectorAll('[data-planning-body]:checked')].map(n=>n.value);sheetState.planningRequested=false;renderSheet();};
    label.append(check,document.createTextNode(body.name));el('myPlaceBodies').append(label);
  }
  el('myPlaceFind').onclick=()=>{if(!sheetOwnerMatches())return;sheetState.planningRequested=true;renderSheet();};
  el('myPlacePlanning').addEventListener('toggle',()=>{if(!sheetOwnerMatches())return;if(el('myPlacePlanning').open)renderSheet();else{sheetToken++;sheetState.planningRequested=false;}});
  el('myRecordPickTarget').onclick = () => {
    if (!sheetOwnerMatches()) { sheet.close(); return; }
    AstroTargetPicker.open(el('myRecordTarget'),null,el('myRecordPickTarget'),{multiple:true,selected:sheetState.draftTargets,getTargets:targetChoices,drafts:sheetState.targetDrafts||[],onDone:(targets,drafts)=>{
      if(!sheetOwnerMatches())return;sheetState.draftTargets=targets.map(targetData);sheetState.targetDrafts=drafts;el('myRecordSaved').hidden=true;renderSheet();
    }});
  };
  el('myPlaceMap').onclick = () => {
    if (!sheetOwnerMatches() || !toolAllowed('skymap')) return;
    const saved = sheetState;
    sheet.close(); SkyMapUI?.enterRecords?.(saved.place,{shape:shapeFor(saved.place),targetIds:savedTargets(saved.place.id).map(t=>t.key)});
  };
  el('myPlaceUse').onclick = () => { const s = sheetState; if (s.ctx === 'records') { void openFromRecords(s.place); return; } sheet.close(); if (s.ctx === 'sky') openInSky(s.place, null); else openInAim(s.place, null); };
}
const sheetOwnerMatches = () => !!auth?.token && sheetState?.ownerToken === auth.token;
function openPlace(place, ctx, targetKey = null) {
  if (!sheet) buildSheet();
  place=place||{id:null,name:'',latitude:null,longitude:null};
  const current = ctx === 'sky' ? skySession?.target?.id : aim.target?.id;
  const initialTargets=savedTargets(place.id),initialShape=shapeFor(place);
  sheetState = {targetDrafts:[],initialShape,draftShape:initialShape,shapeBaseline:shapeKey(initialShape),initialTargets,baseline:targetSetKey(initialTargets),draftTargets:initialTargets.map(t=>({...t})),place:{...place},ctx, ownerToken: auth?.token, bodies:[ctx === 'sky' ? (skySession?.body || 'sun') : aim.body], planningRequested:false };
  el('myPlaceTitle').textContent = initialTargets.length?'記録を編集':'記録を追加';
  el('myRecordLocationConfirm').hidden=true;
  el('myPlaceName').textContent = place.name||'撮影地点を選ぶ';el('myPlaceName').classList.toggle('is-empty',!place.id);
  for(const check of sheet.querySelectorAll('[data-planning-body]'))check.checked=sheetState.bodies.includes(check.value);
  el('myPlaceSub').textContent = [place.subtitle, finite(place.latitude)&&finite(place.longitude)?`${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}`:'', finite(place.elevation) ? `標高 ${place.elevation}m` : '標高不明', `地上から ${place.eyeHeightAGL ?? 1.5}m` ].filter(Boolean).join(' ・ ');
  el('myPlaceMap').hidden = ctx === 'sky' || !toolAllowed('skymap');
  el('myPlaceUse').hidden = !!initialShape || ctx === 'records' && !screenAllowed('framing');
  el('myPlaceMap').textContent=initialShape?'地図でこの'+shapeName(initialShape)+'から探す':'地図でここから見る';
  el('myPlaceUse').textContent = ctx === 'sky' ? '地図でここから見る' : 'ここから重ねる';
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
  const { place, ctx } = sheetState, token = ++sheetToken, list = load();
  el('myPlaceSub').textContent=[place.subtitle,finite(place.latitude)&&finite(place.longitude)?`${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}`:'',finite(place.elevation)?`標高 ${place.elevation}m`:'標高不明',`地上から ${place.eyeHeightAGL??1.5}m`].filter(Boolean).join(' ・ ');
  el('myPlaceUse').hidden=!!sheetState.draftShape||ctx==='records'&&!screenAllowed('framing');
  el('myPlaceMap').textContent=sheetState.draftShape?'地図でこの'+shapeName(sheetState.draftShape)+'から探す':'地図でここから見る';
  const recs=el('myPlaceRecords');recs.replaceChildren();
  el('myNewPlaceNameLabel').hidden=!!place.id||!draftPoint();el('myPlaceName').hidden=!el('myNewPlaceNameLabel').hidden;el('myNewPlaceName').value=place.name||'';
  el('myPlaceName').textContent=draftPoint()?(place.name||'名前未入力'):'撮影地点を選ぶ';el('myPlaceName').classList.toggle('is-empty',!draftPoint());
  el('myShapeEdit').hidden=!draftPoint();el('myShapeEdit').disabled=false;el('myShapeEdit').textContent=shapeName(sheetState.draftShape)+' ・ 地図で編集';el('myShapeSummary').textContent=sheetState.draftShape?sheetState.draftShape.vertices.length+'点をつないだ'+shapeName(sheetState.draftShape):'';
  if(!sheetState.draftTargets.length){const p=document.createElement('p');p.className='tiny';p.textContent=draftPoint()?'ここから見える対象を追加できます。複数選べます。':'撮影地点を選び、そこから見える対象を追加します。';recs.append(p);}
  for(const t of sheetState.draftTargets){
    const row=document.createElement('div');row.className='fav-row my-draft-target';const text=document.createElement('div');text.className='my-record';const name=document.createElement('strong');name.textContent=t.name;text.append(name);
    const stamps=list.filter(r=>r.placeId===place.id&&r.target.key===t.key&&!r.removed&&r.createdAt>0).map(r=>r.createdAt);
    const sub=document.createElement('span');sub.className='tiny sub-line';sub.textContent=stamps.length?'登録日 '+new Date(Math.min(...stamps)+32400000).toISOString().slice(0,10).replaceAll('-','/'):'未保存';text.append(sub);
    const remove=document.createElement('button');remove.type='button';remove.className='chip';remove.textContent='削除';remove.setAttribute('aria-label',t.name+'を対象から外す');remove.onclick=()=>{if(!sheetOwnerMatches())return;sheetState.draftTargets=sheetState.draftTargets.filter(x=>x.key!==t.key);el('myRecordSaved').hidden=true;renderSheet();};row.append(text,remove);recs.append(row);
  }
  el('myRecordSave').disabled=!draftPoint()||!draftChanged();el('myRecordPickTarget').disabled=!draftPoint();el('myPlacePlanning').hidden=!place.id||draftChanged();el('myPlaceDetails').hidden=!place.id;if(!draftChanged())el('myRecordLocationConfirm').hidden=true;
  const next = el('myPlaceNext'); next.replaceChildren();
  if(!el('myPlacePlanning').open)return;
  const seen = targetsSeenFrom(place.id).filter((r) => r.result !== 'hidden');
  const pairs=planningPairs(seen,sheetState.bodies);
  el('myPlaceFind').disabled=!pairs.length||!!sheetState.initialShape;el('myPlaceFind').hidden=!!sheetState.initialShape;el('myPlaceBodies').closest('fieldset').hidden=!!sheetState.initialShape;el('myPlaceNext').previousElementSibling.hidden=!!sheetState.initialShape;
  if(sheetState.initialShape){const hint=document.createElement('p');hint.className='tiny';hint.textContent='線・範囲の候補は、地図で対象・天体・日付を選んで探せます。';next.append(hint);return;}
  if (!seen.length || !pairs.length || !sheetState.planningRequested) {
    const p=document.createElement('p');p.className='tiny';
    p.textContent=!seen.length?'見えた対象を追加すると、次に重なる日を探せます。':!sheetState.bodies.length?'調べたい天体を選んでください。':!pairs.length?'選んだ天体と対象は、現在の権限では構図に使えません。':'この場所から見えた対象ごとに、選んだ天体が重なる日を調べます。';
    next.append(p);return;
  }
  let pending=Promise.resolve();
  for (const {record:r,body} of pairs) {
    const t = resolveTarget(r.target.key);
    const b = document.createElement('button'); b.type = 'button'; b.className = 'list-item my-place-row';
    const strong = document.createElement('strong'); strong.textContent = `${r.target.name} × ${SoramiBodies.definition(body).name}`;
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
      b.onclick = () => {
        if(token!==sheetToken || !sheet.open || !sheetOwnerMatches() || !planningPairs([r],[body]).length)return;
        const current=statusOf(place.id,r.target.key);if(!current || current.id!==r.id || current.result==='hidden'){renderSheet();return;}
        if (ctx !== 'records') sheet.close();openWith(place, t, {...row,body}, ctx);
      };
      }).catch(() => { if (token === sheetToken) sub.textContent = '計算できませんでした。もう一度探してください'; });
    });
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
  aimSetFrom(SoramiShooting.savedObserver(place), { keepMap: true });
  if (row) { aim.candPick = null; aim.spot = null; aim.wantSpot = null; aim.wantKey = null; aim.candSide = row.side; el('aimDate').value = new Date(S.Cal.startOfDay(row.at) + 9 * 3600000).toISOString().slice(0, 10); aim.plannerTransfer={at:row.at,body:aim.body,latitude:place.latitude,longitude:place.longitude,day:SoramiShooting.day(row.at)}; }
  aimApply();
}
// 新規の地点・形・対象は、最後の保存までお気に入りに追加しない。
function commitRecordDraft(current,isNew){
 const s=sheetState,err=el('myRecordError');
 try{
  const plan=SoramiLibrary.prepareRecord({owner:auth.loginId,favorites,observations:load(),shapes:shapeData(),place:current,isNew,initialTargets:s.initialTargets,targets:s.draftTargets,shape:s.draftShape,drafts:s.targetDrafts||[],cleanShape:SoramiShooting.cleanShape});
  SoramiLibrary.transaction(localStorage,plan.entries);favorites=plan.favorites;if(typeof RecordSync!=='undefined')RecordSync.kick();
  for(const id of plan.changedFavorites)queuePush('fav',id);
  s.place={...placeOf(current.id)};s.newPlace=false;s.targetDrafts=[];s.initialShape=s.draftShape;s.shapeBaseline=shapeKey(s.initialShape);s.initialTargets=s.draftTargets.map(targetData);s.baseline=targetSetKey(s.initialTargets);
  version++;candidateCache.clear();changed();aimFillSelects();SkyMapUI?.refreshTargets?.();
  el('myPlaceTitle').textContent='記録を編集';err.hidden=true;el('myRecordSaved').textContent='保存しました';el('myRecordSaved').hidden=false;renderSheet();return true;
 }catch(e){err.textContent=e.message||'保存できませんでした。入力は残しています';err.hidden=false;return false;}
}
function saveNewRecord(){
 if(!sheetOwnerMatches()||!draftPoint())return false;
 const s=sheetState,err=el('myRecordError'),fail=text=>{err.textContent=text;err.hidden=false;return false;};
 const name=(s.place.name||'').trim();if(!name)return fail('場所の名前を入力してください');
 if(s.draftShape&&!SoramiShooting.cleanShape(s.draftShape))return fail('線・範囲を確認してください');
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
  const s=sheetState,err=el('myRecordError'),current=placeOf(s.place.id);
  if(!s.place.id)return saveNewRecord();
  const fail=text=>{err.textContent=text;err.hidden=false;return false;};
  if(!current)return fail('この撮影地点は登録から外されています');
  if(current.latitude!==s.place.latitude||current.longitude!==s.place.longitude||(current.eyeHeightAGL??1.5)!==(s.place.eyeHeightAGL??1.5))return fail('地点が変更されました。開き直してください');
  if(targetSetKey(savedTargets(s.place.id))!==s.baseline)return fail('別の画面で対象が変更されました。開き直してください');
  if(shapeKey(shapeFor(current))!==s.shapeBaseline)return fail('別の画面で場所の形が変わりました。開き直してください');
  return commitRecordDraft(current,false);
}

// 観測地点（または地図の観測地点）から記録する。撮影ポイントでなければ、まず ☆ と同じ画面で登録する
function recordFor(point, targetKey, ctx) {
  const requestOwner=auth?.token,requestState=sheetState;
  if (!point || !requireLoginForFavorites()) return;
  const exact = placeNear(point);
  if (exact) { openPlace(exact, ctx, targetKey); return; }
  const near = placeNear(point, MERGE_KM);
  if (near && confirm(`近くの撮影地点「${near.name}」（${Math.round(SoramiTerrain.distanceKm(near.latitude, near.longitude, point.latitude, point.longitude) * 1000)}m）に記録しますか？\nキャンセルすると、この位置を新しい撮影地点として登録します。`)) { openPlace(near, ctx, targetKey); return; }
  openPlace({...point,id:null},ctx,targetKey);sheetState.newPlace=true;renderSheet();
}

function changed() {
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
.alignment-heading{font-size:14px;color:var(--secondary);margin:8px 0 12px}.alignment-controls>.fav-in{display:block;width:100%;margin:10px 0}.alignment-controls .aim-limb button,#aimAlignmentDetails .aim-limb button{min-height:58px;flex-direction:row;justify-content:center;gap:6px;font-size:13px}@media(max-width:360px){.alignment-controls .aim-limb button,#aimAlignmentDetails .aim-limb button{font-size:12px;gap:3px}.alignment-controls .aim-limb svg,#aimAlignmentDetails .aim-limb svg{width:23px;height:23px}}.shooting-location-actions{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 14px}.shooting-location-actions .sky-map-link{margin:0}.shooting-alignment{display:flex;gap:8px;flex-wrap:wrap}.shooting-alignment select{min-width:0;flex:1;min-height:44px;font-size:16px}.shooting-overlap{padding:8px;border-radius:8px}.shooting-overlap-on{background:var(--accent);color:var(--on-accent,#fff);font-weight:bold}#aimView .preview-workspace{display:block}#aimView .preview-tabs{display:none}
/* Shooting-point details scroll only vertically, including native iOS date fields. */
#myShapeSheet [data-shape-mode][aria-pressed=true]{background:var(--accent);color:var(--bg);font-weight:700}#myShapeSheet{overflow:hidden;min-width:0}#myShapeSheet .sheet-body{overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain}#myShapeSheet .my-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}#myShapeSheet canvas{display:block;width:100%;height:320px;touch-action:none}#myShapeSheet .mapwrap{position:relative;overflow:hidden;border-radius:12px}#myShapeSheet select{flex:1;min-width:100px;width:0}#myShapeSheet button{min-height:44px}#myShapeSheet .map-cross{display:none}#myShapeSheet .shape-type-tool{position:absolute;left:8px;top:8px;z-index:2;border:1px solid var(--line);border-radius:10px;background:var(--card);padding:0 8px;max-width:calc(100% - 70px)}#myShapeSheet .shape-type-tool summary{min-height:44px;min-width:52px;align-content:center;cursor:pointer;font-size:14px;font-weight:700}#myShapeSheet .shape-type-tool .my-actions{padding:0 0 8px}#shapeLocationPanel [data-shape-source][aria-pressed=true]{background:var(--accent);color:var(--on-accent,#142332)}#myShapeSheet .mapzoom{position:absolute;right:8px;top:8px;display:grid;gap:5px}#myShapeSheet .mapzoom button{width:44px;background:var(--card);color:var(--text)}#shapeLocationPanel .my-actions input{flex:1;min-width:0;width:0;font-size:16px}#myShapeSheet #shapeApply{width:100%}#shapeSearch{width:100%;margin-bottom:12px;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--input);color:var(--text);font-size:16px;text-align:left}#myNewPlaceNameLabel{display:block;min-width:0;grid-column:2}#myNewPlaceName{width:100%;font-size:16px}#myNewPlaceNameLabel[hidden],#myPlaceName[hidden]{display:none}
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
document.head.append(style);

renderRecordsHub();
window.MyPlacesUI = { backupState:()=>({observations:load(),shapes:shapeData()}),imported:()=>{version++;candidateCache.clear();changed();},selectShape, resetShapePicker, shapeFor, withShape, drawShape, renderAim, renderPickerPanel, skyDraw, skyRender, leaveSky, pickSky, badge, openPlace, recordFor, load, renderRecordsHub };
// 読み込みより先に構図が描かれていたら、ここで一覧を出す
if (el('aimView') && !el('aimView').hidden) { try { renderAim(); } catch { /* 構図を止めない */ } }
// A map without an observer renders synchronously, before this deferred module arrives.
if (el('skyMapView') && !el('skyMapView').hidden) SkyMapUI?.render?.();
})();
