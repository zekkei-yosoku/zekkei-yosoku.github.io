/* 観測記録と撮影ポイント（2026-10-16）。
   撮影ポイントはお気に入りそのもの（同期のまま、形を変えない）。観測記録は「どの地点から何が見えたか」で、
   このブラウザにログインID別に保存する（APIは未対応）。
   撮影候補は新しく探さない。見えた組（地点×目標）で、既存の重なり計算を、記録された地点と目標に適用する。
   仕様: Vault「02_観測記録と撮影ポイント_仕様書」 */
(function () {
'use strict';
const RESULTS = { seen: { name: '見えた', mark: '◎' }, partial: { name: '一部隠れた', mark: '△' }, hidden: { name: '見えなかった', mark: '×' } };
const NEAR_KM = 0.02;            // お気に入りの同一判定（既存の ☆ と同じ 20m）
const MERGE_KM = 0.05;           // 記録するとき「近くの撮影ポイントに付けるか」を聞く距離
const DAY = 86400000;
const el = (id) => document.getElementById(id);
const key = () => 'sorami.observations.v1:' + encodeURIComponent(auth?.loginId || 'guest');
const isText = (v, max = 2000) => typeof v === 'string' && v.length <= max;
const finite = (v) => Number.isFinite(v);

// 取り込んだものを信用しない（手で書き換えられる・壊れる）。描画側でも esc する
function clean(r) {
  if (!r || typeof r !== 'object' || !isText(r.id, 80) || !r.id || !isText(r.placeId, 200) || !r.placeId) return null;
  const t = r.target;
  if (!t || !isText(t.key, 200) || !t.key || !isText(t.name, 200)) return null;
  if (!RESULTS[r.result]) return null;
  const date = isText(r.date, 10) && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : '';
  return { id: r.id, placeId: r.placeId, target: { key: t.key, name: t.name || '目標',
      latitude: finite(t.latitude) ? t.latitude : null, longitude: finite(t.longitude) ? t.longitude : null },
    observer: r.observer && finite(r.observer.latitude) && finite(r.observer.longitude) && Math.abs(r.observer.latitude) <= 90 && Math.abs(r.observer.longitude) <= 180 ? { latitude: r.observer.latitude, longitude: r.observer.longitude, elevation: finite(r.observer.elevation) ? r.observer.elevation : null, eyeHeightAGL: finite(r.observer.eyeHeightAGL) ? r.observer.eyeHeightAGL : 1.5 } : null,
    result: r.result, date, note: isText(r.note, 500) ? r.note : '',
    ...(r.registration === true ? {registration:true,removed:r.removed === true} : {}),
    createdAt: finite(r.createdAt) ? r.createdAt : 0, updatedAt: finite(r.updatedAt) ? r.updatedAt : 0 };
}
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
  for (const f of favorites) { const r = statusOf(f.id, targetKey, list); if (r && r.result !== 'hidden') out.push({ place: f, record: r }); }
  return out;
}
function targetsSeenFrom(placeId) {
  const list = load(), keys = [...new Set(list.filter((r) => r.placeId === placeId).map((r) => r.target.key))];
  return keys.map((k) => statusOf(placeId, k, list)).filter(Boolean);
}
function badge(f) {
  const seen = targetsSeenFrom(f.id).filter((r) => r.result !== 'hidden');
  return seen.length ? '見えた: ' + seen.map((r) => r.target.name).join('・') : '';
}

// 目標は構図の一覧と同じもの（許可のある組み込み目標＋自分の目標）。自分で一時的に置いた目標は記録できない
const targetChoices = () => aimTargetList().filter((t) => t.id !== 'custom' && finite(t.latitude) && (t.parts || []).length);
const resolveTarget = (k) => targetChoices().find((t) => t.id === k) || null;

// 検索・現在地・地図・既存地点を、従来の共通ピッカーから選ぶ。予測の地点は動かさない。
PLACE_PICKERS.records = { title: '撮影地点', custom: () => null, point: () => place,
  set: p => { if (auth?.token && toolAllowed('records')) recordFor(p, null, 'records'); } };
let targetDraft = null;
PLACE_PICKERS.recordTarget = { title: '見えた目標を選ぶ', custom: () => null, point: () => sheetState?.place || place,
  set: p => {
    const draft = targetDraft; if (!draft || !sheetOwnerMatches() || draft.ownerToken !== auth?.token || draft.placeId !== sheetState?.place.id) return;
    const existing=targetChoices().find(t=>SoramiTerrain.distanceKm(t.latitude,t.longitude,p.latitude,p.longitude)<NEAR_KM);
    if(existing){addDraftTarget(existing);return;}
    void favForPoint(p, entry => {
      if (!entry || !sheetOwnerMatches() || draft.ownerToken !== auth?.token || draft.placeId !== sheetState?.place.id) return;
      const select=el('myRecordTarget');select.replaceChildren(new Option('対象を選ぶ',''),...targetChoices().map(t=>new Option(t.name,t.id)));
      sheetState.draftTargets=draft.targets.map(t=>({...t}));sheetState.bodies=[...draft.bodies];
      addDraftTarget(resolveTarget(entry.targetKey||'fav:'+entry.id));
    }, { target: p.targetHeightM ?? p.structureM ?? 0 });
  } };

// ---------------------------------------------------------------- 記録：撮影ポイントへの入口
let recordsTargetFilter = '', recordsBodyFilter = '', recordsFilterOwner = null;
function renderRecordsHub() {
  const host = el('myRecordsHub'); if (!host) return;
  host.replaceChildren();el('recordsHeading')?.querySelector('.my-add-point')?.remove();
  if (skyOwner !== auth?.token || !toolAllowed('skymap')) { leaveSky(); skyOwner=auth?.token; }
  if (sheet?.open && sheetState?.ownerToken !== auth?.token) sheet.close();
  // 非表示でも旧アカウントの地点・記録をDOMへ残さない。
  if (!auth?.token || !toolAllowed('records')) return;
  const intro = document.createElement('p'); intro.className = 'tiny'; intro.textContent = 'どこから何が見えたかを残し、構図や地図で次の撮影につなげます。';
  const heading=el('recordsHeading');heading.querySelector('.my-add-point')?.remove();host.append(intro);
  const actions = document.createElement('div'); actions.className = 'my-head';
  const add = document.createElement('button'); add.type = 'button'; add.className = 'my-add-point'; add.textContent = '＋';add.setAttribute('aria-label','記録を追加');add.title='記録を追加';
  add.onclick = () => { if (auth?.token && toolAllowed('records')) openPlace(null,'records'); }; heading.append(add);
  if (toolAllowed('skymap')) { const map = document.createElement('button'); map.type = 'button'; map.className = 'chip'; map.textContent = '地図で場所を探す'; map.onclick = () => pushRoute('#/skymap'); actions.append(map); }
  host.append(actions);
  const list = document.createElement('div'); list.className = 'al my-list'; host.append(list);
  const records = load();
  if(recordsFilterOwner!==auth.token){recordsFilterOwner=auth.token;recordsTargetFilter='';recordsBodyFilter='';}
  const filterTargets=[...new Map(favorites.flatMap(f=>targetsSeenFrom(f.id).filter(r=>r.result!=='hidden').map(r=>[r.target.key,r.target]))).values()];
  if(!filterTargets.some(t=>t.key===recordsTargetFilter))recordsTargetFilter='';
  const filters=document.createElement('div');filters.className='my-actions';
  const reset=document.createElement('button');reset.type='button';reset.className='chip';reset.textContent='すべて';reset.setAttribute('aria-pressed',String(!recordsTargetFilter&&!recordsBodyFilter));reset.onclick=()=>{recordsTargetFilter='';recordsBodyFilter='';renderRecordsHub();};
  const targetSelect=document.createElement('select');targetSelect.className='fav-in';targetSelect.setAttribute('aria-label','対象で絞り込む');targetSelect.replaceChildren(new Option('すべての対象',''),...filterTargets.map(t=>new Option(t.name,t.key)));targetSelect.value=recordsTargetFilter;targetSelect.onchange=()=>{recordsTargetFilter=targetSelect.value;renderRecordsHub();};
  const bodySelect=document.createElement('select');bodySelect.className='fav-in';bodySelect.setAttribute('aria-label','撮りたい天体で絞り込む');bodySelect.replaceChildren(new Option('すべての天体',''),...SoramiBodies.definitions.map(b=>new Option(b.name,b.id)));bodySelect.value=recordsBodyFilter;bodySelect.onchange=()=>{recordsBodyFilter=bodySelect.value;renderRecordsHub();};
  filters.append(reset,targetSelect,bodySelect);host.insertBefore(filters,list);
  if(recordsBodyFilter){const hint=document.createElement('p');hint.className='tiny';hint.textContent='選んだ天体との重なりを調べられる対象がある撮影ポイントです。';host.insertBefore(hint,list);}
  let matches=0;
  if (!favorites.length) { const empty = document.createElement('p'); empty.className = 'tiny'; empty.textContent = '記録はまだありません。右上の＋から追加できます。'; list.append(empty); }
  for (const f of favorites) {
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
    sub.textContent=targets.length?`対象${targets.length}件 · ${targets.map(r=>r.target.name).join('・')}`:'対象は未登録';
    row.append(name, sub); row.onclick = () => {openPlace(f, 'records');if(recordsBodyFilter){sheetState.bodies=[recordsBodyFilter];for(const check of sheet.querySelectorAll('[data-planning-body]'))check.checked=check.value===recordsBodyFilter;}}; list.append(row);
  }
  if(favorites.length&&!matches){const empty=document.createElement('p');empty.className='tiny';empty.textContent='この条件の撮影ポイントはありません。';list.append(empty);}
  const note = document.createElement('p'); note.className = 'tiny muted'; note.textContent = '見えたものの記録はこのブラウザだけに保存します。撮影地点（お気に入り）は同期します。'; host.append(note);
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
let pickerToken = 0;
async function renderPickerPanel(panel) {
 const token=++pickerToken,owner=auth?.token;
 let box=panel.querySelector('.my-picker');if(!box){box=document.createElement('div');box.className='my-picker';panel.prepend(box);}box.replaceChildren();
 const mode=placeSheetFor,isSky=mode==='skymap';
 const state=()=>isSky?skySession:{target:aim.target,body:aim.body,partId:aim.partId,limb:aim.limb,matchMode:aim.matchMode,at:aim.dayMs};
 const t=state()?.target,plan=SoramiShooting.conditions(state());
 const note=document.createElement('p');note.className='tiny';box.append(note);
 if(!plan||t.id==='custom'){note.textContent='対象を選び、自分の目標に登録すると、その対象が見えた撮影ポイントから候補を探せます。';return;}
 if(!owner||!screenAllowed(isSky?'skymap':'framing')){note.textContent='ログインして利用権限を確認してください。';return;}
 note.textContent=`${S.Cal.monthDay(plan.at)}・${SoramiBodies.definition(plan.body)?.name}を${t.name}に重ねる候補を確認しています…`;
 const query=()=>{const s=state();return s?.target?SoramiShooting.queryKey(s,pointsForPlan(s),auth?.loginId,SoramiAtmosphere.dataKey(s.at)):'';};
 const key=query();
 const current=()=>token===pickerToken&&owner===auth?.token&&screenAllowed(isSky?'skymap':'framing')&&el('placeSheet').open&&placeSheetFor===mode&&key===query();
 try{
  const result=await SoramiShooting.candidates(plan,pointsForPlan(plan),{align:SoramiAlign,isMountain:aimIsMountain,observerAt:(f,g)=>aimObserverAt(aimSavedFrom(f),g),elevationAt:aimElevation,ensure:b=>SoramiBodies.ensure(b),isCurrent:current});
  if(!current()||result.cancelled)return;
  note.textContent=`${S.Cal.monthDay(plan.at)}・${SoramiBodies.definition(plan.body)?.name}を${t.name}に：${result.rows.length}件`;
  if(!result.rows.length){const empty=document.createElement('p');empty.className='tiny';empty.textContent=result.failed?'確認できていない撮影ポイントがあります。再試行してください。':'この日に重なる撮影ポイントはありません。日付や対象を変えるか、記録に撮影ポイントと見えた対象を追加してください。';box.append(empty);}
  if(result.failed){const failed=document.createElement('p');failed.className='tiny';failed.textContent=`${result.failed}地点を確認できませんでした。`;box.append(failed);}
  for(const row of result.rows){const button=document.createElement('button');button.type='button';button.className='list-item my-place-row';const title=document.createElement('strong');title.textContent=row.place.name;const sub=document.createElement('span');sub.className='tiny sub-line';sub.textContent=`${S.JstCal.hhmm(row.event.at)}・${sideName(plan.body,row.event.side)}・${RESULTS[row.record.result].name}`;button.append(title,sub);button.onclick=()=>{if(!current())return;if(isSky){if(SkyMapUI?.selectCandidate?.(row,contextOf(skySession)))el('placeSheet').close();}else{el('placeSheet').close();openInAim(row.place,row.event);}};box.append(button);}
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
 note.textContent=candidateState.status==='loading'?'この日に重なる撮影ポイントを確認しています…':candidateState.status==='error'?'候補を確認できませんでした。もう一度お試しください':candidateState.rows.length?'選ぶと、その撮影ポイントと重なる時刻へ移動します。':candidateState.failed?'確認できていない地点があります。再試行して候補を確認してください。':'登録した撮影ポイントに、この日の条件で重なる候補はありません。';content.append(note);
 if(candidateState.status==='error'||candidateState.failed){const retry=document.createElement('button');retry.type='button';retry.className='chip';retry.textContent=candidateState.failed?`${candidateState.failed}地点を確認できませんでした・再試行`:'再試行';retry.onclick=()=>{candidateCache.delete(skyKey);skyKey='';skyRender(skySession);};content.append(retry);}
 for(const row of candidateState.rows){
  const button=document.createElement('button');button.type='button';button.className='list-item my-place-row';
  const title=document.createElement('strong');title.textContent=row.place.name;
  const details=document.createElement('span');details.className='tiny sub-line';details.textContent=`${S.JstCal.hhmm(row.event.at)}・${sideName(skySession.body,row.event.side)}・${RESULTS[row.record.result].name}${row.record.date?'（'+row.record.date+'確認）':''}`;
  button.append(title,details);button.onclick=()=>chooseCandidate(row);content.append(button);
 }
}
function chooseCandidate(row){
 if(candidateState.status!=='ready'||!candidateState.rows.includes(row)||!skySession||!auth?.token||currentSkyQuery(skySession)!==skyKey)return;
 if(SkyMapUI?.selectCandidate?.(row,contextOf(skySession))){selectedCandidate=row;candidateSheet?.close();}
}
function showCandidateList(){
 if(!candidateSheet){candidateSheet=document.createElement('dialog');candidateSheet.className='sheet';candidateSheet.id='shootingCandidates';candidateSheet.setAttribute('aria-labelledby','shootingCandidatesTitle');candidateSheet.innerHTML='<div class="sheet-head"><strong id="shootingCandidatesTitle">撮影ポイントの候補</strong><button type="button" data-close>閉じる</button></div><div class="sheet-body"><p class="tiny" id="shootingCandidatesCondition"></p><div id="shootingCandidatesList" class="al my-list"></div></div>';document.body.append(candidateSheet);candidateSheet.querySelector('[data-close]').onclick=()=>candidateSheet.close();}
 if(!skySession?.target)return;
 el('shootingCandidatesCondition').textContent=`${S.Cal.monthDay(skySession.at)}・${SoramiBodies.definition(skySession.body)?.name}を${skySession.target.name}に`;
 showSheet(candidateSheet);drawCandidateList();
}
function skyBox(){let box=el('mySkyPlaces');if(!box){box=document.createElement('section');box.id='mySkyPlaces';box.className='my-places';box.setAttribute('aria-label','撮影ポイント');el('skyMapChoose').closest('.aim-say').after(box);}return box;}
function updateCandidateUI(){
 const trigger=el('shootingCandidatesOpen');if(!trigger)return;
 trigger.textContent=candidateState.status==='loading'?'撮影ポイント：候補を確認中…':candidateState.status==='error'?'撮影ポイント：確認できません':`撮影ポイント：候補${candidateState.rows.length}件`;
 el('shootingPins').setAttribute('aria-pressed',String(pinsOn));el('shootingPins').setAttribute('aria-checked',String(pinsOn));el('shootingPins').textContent=pinsOn?'候補ピン：表示':'候補ピン：非表示';
 const state=el('shootingCandidateStatus');state.textContent=candidateState.failed?`${candidateState.failed}地点は確認できていません`:'';
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
 if(!t){skyKey='';candidateState={status:'idle',rows:[],failed:0};box.textContent='何を・何に重ねるかと撮影日を選ぶと、記録した撮影ポイントから候補を出します。';candidateSheet?.close();return;}
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
  if(!job){job=SoramiShooting.candidates(plan,points,{align:SoramiAlign,isMountain:aimIsMountain,observerAt:(f,g)=>aimObserverAt(aimSavedFrom(f),g),elevationAt:aimElevation,ensure:b=>SoramiBodies.ensure(b),isCurrent:()=>owner===auth?.token&&token===skyToken&&!!skySession&&currentSkyQuery(skySession)===key});candidateCache.set(key,job);if(candidateCache.size>24)candidateCache.delete(candidateCache.keys().next().value);}
  job.then(result=>{if(owner!==auth?.token||token!==skyToken||skyKey!==key)return;if(result.cancelled){candidateCache.delete(key);skyKey='';skyRender(skySession);return;}candidateState={...result,status:'ready'};updateCandidateUI();SkyMapUI?.redraw?.();}).catch(()=>{candidateCache.delete(key);if(owner!==auth?.token||token!==skyToken||skyKey!==key)return;candidateState={status:'error',rows:[],failed:0};updateCandidateUI();});
 }
 checkOverlap(s);
}
function skyDraw(ctx,{project,width,height},s,pickMode){
 if(!s||pickMode||!pinsOn||candidateState.status!=='ready'||!skyKey||currentSkyQuery(s)!==skyKey)return;
 const drawn=new Set();for(const row of candidateState.rows){const f=row.place;if(drawn.has(f.id))continue;drawn.add(f.id);
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
const draftChanged=()=>!!sheetState&&targetSetKey(sheetState.draftTargets)!==sheetState.baseline;
function addDraftTarget(t){
  if(!sheetOwnerMatches()||!t)return;
  if(!sheetState.draftTargets.some(x=>x.key===(t.key||t.id)))sheetState.draftTargets.push(targetData(t));
  el('myRecordTarget').value='';el('myRecordError').hidden=true;el('myRecordSaved').hidden=true;renderSheet();
}
function showRecordEditor(){if(!sheetOwnerMatches())return;el('myTargetPicker').hidden=false;el('myRecordAdd').hidden=true;}
function discardDraft(){if(draftChanged()&&!confirm('変更を保存せず閉じますか？'))return false;return true;}
function registrationChanges(place,before,after,now=Date.now()){
  const changes=[],oldKeys=new Set(before.map(t=>t.key)),newKeys=new Set(after.map(t=>t.key));
  for(const [targets,removed] of [[before,true],[after,false]])for(const t of targets){
    if(removed?newKeys.has(t.key):oldKeys.has(t.key))continue;
    changes.push(clean({id:'reg-'+now.toString(36)+Math.random().toString(36).slice(2,8),placeId:place.id,target:targetData(t),registration:true,removed,result:'seen',date:'',note:'',observer:{latitude:place.latitude,longitude:place.longitude,elevation:place.elevation??null,eyeHeightAGL:place.eyeHeightAGL??1.5},createdAt:now,updatedAt:now}));
  }
  return changes;
}
function buildSheet() {
  sheet = document.createElement('dialog'); sheet.className = 'sheet'; sheet.id = 'myPlaceSheet'; sheet.tabIndex = -1; sheet.setAttribute('aria-labelledby', 'myPlaceTitle');
  sheet.innerHTML = `<div class="sheet-head"><strong id="myPlaceTitle">記録を追加</strong><button type="button" data-close aria-label="閉じる">閉じる</button></div>
  <div class="sheet-body">
    <div class="my-input-field"><div class="condition-label">${inputRoleIcon('observer')}<span>撮影地点</span></div><button type="button" class="my-location-value" id="myPlaceName" aria-label="撮影地点を選ぶ"></button></div>
    <div id="myRecordLocationConfirm" hidden><p class="tiny">保存していない対象の編集を戻して、撮影地点を変更しますか？</p><button type="button" class="chip" id="myRecordLocationChange">変更する</button><button type="button" class="chip" id="myRecordLocationKeep">戻る</button></div>
    <div class="my-input-field"><div class="condition-label">${inputRoleIcon('target')}<span>対象</span></div><button type="button" class="my-location-value" id="myRecordPickTarget" aria-label="対象を選んで追加">対象を追加</button></div>
    <select id="myRecordTarget" hidden aria-label="対象"></select><button id="myRecordAdd" type="button" hidden>対象を追加</button><div id="myTargetPicker" hidden></div>
    <div id="myPlaceRecords"></div>
    <p class="warn" id="myRecordError" role="status" hidden></p><p class="tiny" id="myRecordSaved" role="status" hidden></p>
    <div class="my-actions"><button type="button" class="fav-btn primary" id="myRecordSave">まとめて保存</button><button type="button" class="chip" id="myRecordCancel">キャンセル</button></div>
    <p class="tiny muted">対象はこのブラウザに保存します。登録日は保存時に自動で残します。</p>
    <details id="myPlacePlanning" class="my-secondary"><summary>この場所から撮る</summary><div class="my-actions"><button type="button" class="chip" id="myPlaceUse">ここから見る</button><button type="button" class="chip" id="myPlaceMap">地図でここから見る</button></div><fieldset class="my-body-options"><legend class="condition-label">${inputRoleIcon('body')}<span>天体</span><span class="tiny">複数選択可</span></legend><div id="myPlaceBodies"></div></fieldset><button type="button" class="chip" id="myPlaceFind">次に重なる日を探す</button><h3 class="my-title">次に重なる日</h3><div class="al my-list" id="myPlaceNext"></div></details>
    <details id="myPlaceDetails" class="my-secondary"><summary>場所の詳細</summary><p class="tiny" id="myPlaceSub"></p></details>
  </div>`;
  document.body.append(sheet);
  sheet.querySelector('[data-close]').onclick = () => {if(discardDraft())sheet.close();};
  sheet.addEventListener('cancel',e=>{if(!discardDraft())e.preventDefault();});
  el('myRecordAdd').onclick=()=>el('myRecordPickTarget').click();
  el('myPlaceName').onclick=()=>{if(!sheetOwnerMatches())return;if(draftChanged()){el('myRecordLocationConfirm').hidden=false;return;}openPlaceSheet('records');};
  el('myRecordLocationChange').onclick=()=>{if(!sheetOwnerMatches())return;el('myRecordLocationConfirm').hidden=true;openPlaceSheet('records');};
  el('myRecordLocationKeep').onclick=()=>{el('myRecordLocationConfirm').hidden=true;el('myPlaceName').focus();};
  el('myRecordCancel').onclick=()=>{sheetState.draftTargets=sheetState.initialTargets.map(t=>({...t}));el('myTargetPicker').hidden=true;el('myRecordAdd').hidden=true;el('myRecordError').hidden=true;el('myRecordSaved').hidden=true;sheet.close();};
  if(window.AstroTargetPicker)el('myRecordTarget').hidden=true;
  el('myRecordTarget').onchange=()=>addDraftTarget(resolveTarget(el('myRecordTarget').value));
  el('myRecordSave').onclick=saveRecord;
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
    targetDraft={ownerToken:auth.token,placeId:sheetState.place.id,targets:sheetState.draftTargets.map(t=>({...t})),bodies:[...sheetState.bodies]};
    if(window.AstroTargetPicker)AstroTargetPicker.open(el('myRecordTarget'),()=>openPlaceSheet('recordTarget'),el('myRecordPickTarget'));else openPlaceSheet('recordTarget');
  };
  el('myPlaceMap').onclick = () => {
    if (!sheetOwnerMatches() || !toolAllowed('skymap')) return;
    const saved = sheetState;
    sheet.close(); SkyMapUI?.enterRecords?.(saved.place);
  };
  el('myPlaceUse').onclick = () => { const s = sheetState; if (s.ctx === 'records') { void openFromRecords(s.place); return; } sheet.close(); if (s.ctx === 'sky') openInSky(s.place, null); else openInAim(s.place, null); };
}
const sheetOwnerMatches = () => !!auth?.token && sheetState?.ownerToken === auth.token;
function openPlace(place, ctx, targetKey = null) {
  if (!sheet) buildSheet();
  place=place||{id:null,name:'',latitude:null,longitude:null};
  const current = ctx === 'sky' ? skySession?.target?.id : aim.target?.id;
  const initialTargets=savedTargets(place.id);
  sheetState = {initialTargets,baseline:targetSetKey(initialTargets),draftTargets:initialTargets.map(t=>({...t})),place:{...place},ctx, ownerToken: auth?.token, bodies:[ctx === 'sky' ? (skySession?.body || 'sun') : aim.body], planningRequested:false };
  el('myPlaceTitle').textContent = initialTargets.length?'記録を編集':'記録を追加';
  el('myRecordLocationConfirm').hidden=true;
  el('myPlaceName').textContent = place.name||'撮影地点を選ぶ';el('myPlaceName').classList.toggle('is-empty',!place.id);
  for(const check of sheet.querySelectorAll('[data-planning-body]'))check.checked=sheetState.bodies.includes(check.value);
  el('myPlaceSub').textContent = [place.subtitle, finite(place.latitude)&&finite(place.longitude)?`${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}`:'', finite(place.elevation) ? `標高 ${place.elevation}m` : '標高不明', `地上から ${place.eyeHeightAGL ?? 1.5}m` ].filter(Boolean).join(' ・ ');
  el('myPlaceMap').hidden = ctx === 'sky' || !toolAllowed('skymap');
  el('myPlaceUse').hidden = ctx === 'records' && !screenAllowed('framing');
  el('myPlaceUse').textContent = ctx === 'sky' ? '地図でここから見る' : 'ここから重ねる';
  const choices = targetChoices(), select = el('myRecordTarget');
  select.replaceChildren(new Option('対象を選ぶ', ''), ...choices.map((t) => new Option(t.name, t.id)));
  const want = targetKey || (ctx === 'records' ? null : current);
  if (want) select.value = choices.some((t) => t.id === want) ? want : '';
  el('myRecordError').hidden=true;el('myRecordSaved').hidden=true;el('myTargetPicker').hidden=true;el('myRecordAdd').hidden=true;
  for(const id of ['myPlacePlanning','myPlaceDetails'])el(id).open=false;
  if(want&&resolveTarget(want))addDraftTarget(resolveTarget(want));else renderSheet();
  if (!sheet.open) showSheet(sheet);
}
function renderSheet() {
  const { place, ctx } = sheetState, token = ++sheetToken, list = load();
  const recs=el('myPlaceRecords');recs.replaceChildren();
  if(!sheetState.draftTargets.length){const p=document.createElement('p');p.className='tiny';p.textContent=place.id?'ここから見える対象を追加できます。複数選べます。':'撮影地点を選び、そこから見える対象を追加します。';recs.append(p);}
  for(const t of sheetState.draftTargets){
    const row=document.createElement('div');row.className='fav-row my-draft-target';const text=document.createElement('div');text.className='my-record';const name=document.createElement('strong');name.textContent=t.name;text.append(name);
    const stamps=list.filter(r=>r.placeId===place.id&&r.target.key===t.key&&!r.removed&&r.createdAt>0).map(r=>r.createdAt);
    const sub=document.createElement('span');sub.className='tiny sub-line';sub.textContent=stamps.length?'登録日 '+new Date(Math.min(...stamps)+32400000).toISOString().slice(0,10).replaceAll('-','/'):'未保存';text.append(sub);
    const remove=document.createElement('button');remove.type='button';remove.className='chip';remove.textContent='削除';remove.setAttribute('aria-label',t.name+'を対象から外す');remove.onclick=()=>{if(!sheetOwnerMatches())return;sheetState.draftTargets=sheetState.draftTargets.filter(x=>x.key!==t.key);el('myRecordSaved').hidden=true;renderSheet();};row.append(text,remove);recs.append(row);
  }
  el('myRecordSave').disabled=!place.id||!draftChanged();el('myRecordPickTarget').disabled=!place.id;el('myPlacePlanning').hidden=!place.id||draftChanged();el('myPlaceDetails').hidden=!place.id;if(!draftChanged())el('myRecordLocationConfirm').hidden=true;
  const next = el('myPlaceNext'); next.replaceChildren();
  if(!el('myPlacePlanning').open)return;
  const seen = targetsSeenFrom(place.id).filter((r) => r.result !== 'hidden');
  const pairs=planningPairs(seen,sheetState.bodies);
  el('myPlaceFind').disabled=!pairs.length;
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
function saveRecord() {
  if(!sheetOwnerMatches()){sheet?.close();return false;}
  const s=sheetState,err=el('myRecordError'),current=placeOf(s.place.id);
  const fail=text=>{err.textContent=text;err.hidden=false;return false;};
  if(!current)return fail('この撮影地点は登録から外されています');
  if(current.latitude!==s.place.latitude||current.longitude!==s.place.longitude||(current.eyeHeightAGL??1.5)!==(s.place.eyeHeightAGL??1.5))return fail('地点が変更されました。開き直してください');
  if(targetSetKey(savedTargets(s.place.id))!==s.baseline)return fail('別の画面で対象が変更されました。開き直してください');
  const changes=registrationChanges(current,s.initialTargets,s.draftTargets);
  if(changes.some(r=>!r))return fail('対象の情報を確認してください');
  if(changes.length&&!save([...load(),...changes]))return fail('保存できませんでした。入力は残しています。もう一度お試しください');
  s.initialTargets=s.draftTargets.map(t=>({...t}));s.baseline=targetSetKey(s.initialTargets);err.hidden=true;el('myRecordSaved').textContent='保存しました';el('myRecordSaved').hidden=false;el('myTargetPicker').hidden=true;el('myRecordAdd').hidden=true;renderSheet();el('myRecordPickTarget').focus();return true;
}

// 観測地点（または地図の観測地点）から記録する。撮影ポイントでなければ、まず ☆ と同じ画面で登録する
function recordFor(point, targetKey, ctx) {
  const requestOwner=auth?.token,requestState=sheetState;
  if (!point || !requireLoginForFavorites()) return;
  const exact = placeNear(point);
  if (exact) { openPlace(exact, ctx, targetKey); return; }
  const near = placeNear(point, MERGE_KM);
  if (near && confirm(`近くの撮影ポイント「${near.name}」（${Math.round(SoramiTerrain.distanceKm(near.latitude, near.longitude, point.latitude, point.longitude) * 1000)}m）に記録しますか？\nキャンセルすると、この位置を新しい撮影ポイントとして登録します。`)) { openPlace(near, ctx, targetKey); return; }
  favForPoint(point, (entry) => {
    if (!entry||requestOwner!==auth?.token||(ctx==='records'&&(!sheet?.open||sheetState!==requestState))) return;
    if (ctx === 'aim') { try { renameFromAfterFav(aim, entry); store.set('sorami.aimFrom', aim.from); aimRenderFrom(); } catch {} }
    openPlace(entry, ctx, targetKey);
  }, {shooting:ctx==='records'});
}

function changed() {
  renderRecordsHub();
  skyKey = '';
  if (!el('aimView')?.hidden) renderAim();
  if (skySession && !el('skyMapView')?.hidden) { skyRender(skySession); SkyMapUI?.redraw?.(); }
}
// 別タブで記録した・同期でお気に入りが替わった
window.addEventListener('storage', (e) => { if (e.key === key() || e.key === 'sorami.favorites') { version++; changed(); } });

const style = document.createElement('style');
style.textContent = `
.alignment-heading{font-size:14px;color:var(--secondary);margin:8px 0 12px}.alignment-controls>.fav-in{display:block;width:100%;margin:10px 0}.alignment-controls .aim-limb button,#aimAlignmentDetails .aim-limb button{min-height:58px;flex-direction:row;justify-content:center;gap:6px;font-size:13px}@media(max-width:360px){.alignment-controls .aim-limb button,#aimAlignmentDetails .aim-limb button{font-size:12px;gap:3px}.alignment-controls .aim-limb svg,#aimAlignmentDetails .aim-limb svg{width:23px;height:23px}}.shooting-location-actions{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 14px}.shooting-location-actions .sky-map-link{margin:0}.shooting-alignment{display:flex;gap:8px;flex-wrap:wrap}.shooting-alignment select{min-width:0;flex:1;min-height:44px;font-size:16px}.shooting-overlap{padding:8px;border-radius:8px}.shooting-overlap-on{background:var(--accent);color:var(--on-accent,#fff);font-weight:bold}#aimView .preview-workspace{display:block}#aimView .preview-tabs{display:none}
/* Shooting-point details scroll only vertically, including native iOS date fields. */
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
#recordsHeading .my-add-point{display:grid;place-items:center;flex:none;width:44px;height:44px;min-height:44px;padding:0;border:1px solid var(--line);border-radius:50%;background:var(--accent);color:var(--bg);font-size:28px;line-height:1;cursor:pointer}
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
window.MyPlacesUI = { renderAim, renderPickerPanel, skyDraw, skyRender, leaveSky, pickSky, badge, openPlace, recordFor, load, renderRecordsHub };
// 読み込みより先に構図が描かれていたら、ここで一覧を出す
if (el('aimView') && !el('aimView').hidden) { try { renderAim(); } catch { /* 構図を止めない */ } }
// A map without an observer renders synchronously, before this deferred module arrives.
if (el('skyMapView') && !el('skyMapView').hidden) SkyMapUI?.render?.();
})();
