import {$,S,esc} from '../../app/presentation-helpers.js';
import {aimCustomRequest,nextAimCustomRequest,store,viewState} from '../../app/browser-state.js';
import {moonGlyphAt} from '../forecast/view.js';
import {favForPoint,renameFromAfterFav,renderFavStar,renderPointCard} from '../places/controller.js';
import {AimMap,aim,aimElevCache,aimElevation,aimFillSelects,aimIsMountain,aimTargetInfo} from './controller.js';
import {aimApply} from '../satellites/controller.js';
import {aimBuildingAt,aimSideName,aimUpdateLook} from './candidates.js';
import {aimLookRidge} from '../../ui/scene/terrain.js';
import {aimAirAngle} from './reverse-and-entry.js';
import {auth} from '../account/session-and-access.js';
import {showSheet} from '../../app/overlays.js';
import {recentHistory,resetAimCalSwipe} from './presentation.js';
// ---------------------------------------------------------------- どこから重ねるか（観測地点・2026-10-01）
//
// 「曽谷から見て、スカイツリーに重なるのはいつか。富士山に重なるのはいつか」（ユーザー）。
// 計算は定番スポットの次の日と同じ（AstroNotesAlign.upcoming。前後の日は1回にまとめる）。
// **最初はAstroNotesの地点を引き継ぎ、欄に名前を入れておく**（ユーザー「各ツールで場所を引き継ぐのはいいけど、
// それはどこから重ねるかの枠に入れておく」）。検索か地図の中心で替えると、この画面ではそれを使う
// （アプリ全体の地点＝地点カードは変えない）。どこからの結果かは必ず名前で書く。
// 候補日は幾何学的な重なりを示す。未検証の遮蔽推定で見えないと断定しない。
// 観測地点の高さは「標高」（地面だけ）と「地上から」（目の高さ1.5m＋立つ所の高さ）に分けて持つ（2026-10-06 ユーザー「標高は標高だけ。展望台の高さは目線のところに」）。
//   stand         … 立つ所。"ground"（地面）か展望台の名前。null は既定（展望台があれば先頭、無ければ地面）
//   standAglM     … 地上からを手で入れた値（null は立つ所から自動）
//   groundManualM … 標高を手で入れた値（null は地図の標高）
// 床高には目の高さ1.5mを足す。公称眺望高さは既に視点なので足さない（候補地を解く AstroNotesAlign と同じ。それまでは普通の地点が0m、展望台は床の高さそのままだった）。
// 手で入れた値は同じ地点だけ（別の地点を選んだら自動に戻る）。
function aimSavedFrom(p) {
  if (!p || !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude) || Math.abs(p.latitude)>90 || Math.abs(p.longitude)>180) return null;
  const name = typeof p.name === "string" ? p.name : "選択地点";
  const validEye = v => Number.isFinite(v) && v >= 0 && v <= 700;
  const decks = (Array.isArray(p.decks) ? p.decks : AstroNotesTerrain.decksFor(name) || [])
    .filter(d => d && validEye(d.aglM)).map(d => ({ name: typeof d.name === "string" ? d.name : "展望台", aglM: d.aglM, ...(d.heightBasis === "published-viewpoint" ? {heightBasis:d.heightBasis} : {}) }));
  let stand = p.stand === "ground" || decks.some(d => d.name === p.stand) ? p.stand : null;
  let standAglM = validEye(p.standAglM) ? p.standAglM : null;
  // 検索・地点カード・お気に入り・前の保存の eyeHeightAGL（展望台の床の高さか目の高さ）は、立つ所に読み替える。
  // 0m・1.5m は地面（前のねらうは普通の地点を0mにしていた）。どれにも当たらない高さ（屋上など）は手で入れた地上からとして残す
  if (!stand && standAglM === null && validEye(p.eyeHeightAGL)) {
    const d = decks.find(d => d.aglM === p.eyeHeightAGL || d.aglM + AIM_EYE_M === p.eyeHeightAGL);
    if (d) stand = d.name;
    else if (p.eyeHeightAGL === 0 || p.eyeHeightAGL === AIM_EYE_M) stand = decks.length ? "ground" : null;
    else standAglM = p.eyeHeightAGL;
  }
  const validGround = v => Number.isFinite(v) && v >= -500 && v <= 9000;
  return { name, subtitle: typeof p.subtitle === "string" ? p.subtitle : "", latitude:p.latitude, longitude:p.longitude,
    decks: decks.length ? decks : null, stand, standAglM, groundManualM: validGround(p.groundManualM) ? p.groundManualM : null,
    // 2026-10-04〜06 の観測標高（海抜で1つ）。新しい欄で入れ直すまでは、地面を自動のまま地上からに読み替えて使う
    observationElevationM: validGround(p.observationElevationM) ? p.observationElevationM : null };
}
// 地盤標高と地上の目の高さを分け、候補・カレンダー・図へ同じ値を渡す。
function aimObserverEye(f) {
  if (Number.isFinite(f?.standAglM) && f.standAglM >= 0 && f.standAglM <= 700) return f.standAglM;
  const deck = aimStandDeck(f);
  return deck?.heightBasis === "published-viewpoint" ? deck.aglM : (deck?.aglM ?? 0) + AIM_EYE_M;
}
const AIM_EYE_M = 1.5;
/// 地点の展望台。aimSavedFrom を通った地点は decks が決まっている（無ければ null。名前で引き直さない＝候補地の「東京タワー」の公園に展望台を付けない）
const aimDecksOf = (f) => (f && f.decks !== undefined ? f.decks || [] : AstroNotesTerrain.decksFor(f?.name) || []);
/// 立つ所の展望台（地面なら null）
function aimStandDeck(f) {
  const decks = aimDecksOf(f);
  if (f?.stand === "ground") return null;
  return decks.find(d => d.name === f?.stand) || decks.find(d => Number.isFinite(d?.aglM) && d.aglM >= 0 && d.aglM <= 700) || null;
}
const aimLegacyHeight = (f) => Number.isFinite(f?.observationElevationM) && !Number.isFinite(f?.standAglM) && !Number.isFinite(f?.groundManualM);
function aimObserverAt(f, ground) {
  const elevation = Number.isFinite(f.groundManualM) ? f.groundManualM : Number.isFinite(ground) ? ground : 0;
  return { latitude: f.latitude, longitude: f.longitude, elevation, eyeM: aimLegacyHeight(f) ? f.observationElevationM - elevation : aimObserverEye(f) };
}
aim.from = aimSavedFrom(store.get("sorami.aimFrom", null)); // 明示的な撮影地点は再読み込みでも保持
aim.fromSeq = 0;
aim.fromAppend = false;
aim.fromGround = null;
const aimM = (v) => String(Math.round(v * 10) / 10);
function aimRenderObserverHeight(f, ground) {
  const gIn = $("aimGroundHeight"), sIn = $("aimStandHeight");
  const ready = !!f && Number.isFinite(ground);
  $("aimObserverSummary").textContent = "撮影地点の高さ";
  aim.fromGround = ready ? ground : null;
  // 立つ所（展望台の登録がある施設だけ）。地面と、展望台ごとの床の高さ
  const decks = f ? aimDecksOf(f) : [];
  const manualStand = Number.isFinite(f?.standAglM) || aimLegacyHeight(f);
  const cur = manualStand ? undefined : aimStandDeck(f)?.name ?? "ground";
  $("aimStand").innerHTML = !f || !decks.length ? "" : [["ground", "地上", 0], ...decks.map(d => [d.name, AstroNotesTerrain.deckLabel(d.name, f.name), d.aglM])]
    .map(([v, label, m]) => `<button type="button" data-stand="${esc(v)}" aria-pressed="${v === cur}">${esc(label)}<span class="sub-line">${m}m</span></button>`).join("");
  for (const b of $("aimStand").querySelectorAll("[data-stand]")) b.onclick = () => aimSetStand(b.dataset.stand);
  gIn.disabled = sIn.disabled = !ready;
  $("aimGroundAuto").disabled = !ready || !Number.isFinite(f?.groundManualM);
  $("aimStandAuto").disabled = !ready || !manualStand;
  if (!ready) { gIn.value = ""; sIn.value = ""; $("aimObserverHeightHint").textContent = ""; return; }
  const obs = aimObserverAt(f, ground);
  gIn.value = aimM(obs.elevation); sIn.value = aimM(obs.eyeM);
  $("aimObserverSummary").textContent = `高さ：標高 ${gIn.value}m・地上から ${sIn.value}m`;
  gIn.dataset.validValue = gIn.value; sIn.dataset.validValue = sIn.value;
  $("aimObserverHeightHint").textContent = `撮影位置の標高 ${aimM(obs.elevation + obs.eyeM)}m ・ ${aimStandDeck(f)?.heightBasis === "published-viewpoint" && !Number.isFinite(f?.standAglM) ? "地上からは公称の眺望高さ" : `地上からは目の高さ${AIM_EYE_M}m込み`}`;
}
/// 観測地点の高さを替える。図・候補日・カレンダーは同じ地点で解き直す
function aimSetFromHeight(change) {
  const f = aimFromPoint();
  if (!f) return false;
  $("aimObserverHeightError").hidden = true;
  aim.candPick = null; aim.spot = null; aim.wantSpot = null;
  // 前の観測標高（海抜で1つ）は、いまの地上からに置き換えてから消す
  const legacy = aimLegacyHeight(f) && Number.isFinite(aim.fromGround) ? { standAglM: Math.round((f.observationElevationM - aim.fromGround) * 10) / 10 } : {};
  aimSetFrom({ ...f, ...legacy, observationElevationM: null, ...change }, { keepMap: true });
  return true;
}
function aimSetStand(stand) { return aimSetFromHeight({ stand, standAglM: null }); }
function aimSetGround(value) {
  if (value !== null && (!Number.isFinite(value) || value < -500 || value > 9000)) return false;
  return aimSetFromHeight({ groundManualM: value });
}
function aimSetStandAgl(value) {
  if (value !== null && (!Number.isFinite(value) || value < 0 || value > 700)) return false;
  return aimSetFromHeight({ standAglM: value });
}
function aimCommitHeight(input, set, message) {
  // Enter で確定すると描き直しで欄が一度空になり（標高を取り直す間）、続く blur の change が空欄として届く。描き直し中は受けない
  if (input.disabled) return;
  if (!input.value.trim() || !input.checkValidity()) {
    input.value = input.dataset.validValue || "";
    const error = $("aimObserverHeightError");
    error.textContent = message; error.hidden = false;
    return;
  }
  if (input.value !== input.dataset.validValue) set(input.valueAsNumber);
}
for (const [id, set, message] of [["aimGroundHeight", aimSetGround, "標高は−500〜1000mで入力してください。"],
                                  ["aimStandHeight", aimSetStandAgl, "地上からは0〜700mで入力してください。"]]) {
  const input = $(id), commit = () => aimCommitHeight(input, set, message);
  input.onchange = commit;
  input.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); commit(); input.blur(); } };
}
$("aimGroundAuto").onclick = () => aimSetGround(null);
$("aimStandAuto").onclick = () => aimSetFromHeight({ standAglM: null });

/// 撮影地点の明示選択。未選択では予測地点を補完しない。
function aimFromPoint() {
  return aim.from || null;
}
function aimSetFrom(p, { keepMap = false } = {}) {
  aim.plannerTransfer=null;
  aim.candPick=null;aim.spot=null;aim.wantSpot=null;aim.wantKey=null;aim.fromEvents=[];aim.fromDays=null;aim.lookSeq++;
  aim.from = aimSavedFrom(p);
  try { if(aim.from)recentHistory.rememberPlace({...aim.from,elevation:p.groundManualM??p.elevation??null,eyeHeightAGL:aimObserverEye(aim.from)},{observer:true}); } catch { /* Keep observer selection independent of history. */ }
  store.set("sorami.aimFrom", aim.from);
  aimRenderFrom();
  // 検索で選んだら地図をその地点へ寄せる（線との位置関係が見える）。地図の中心で選んだときは動かさない
  if (keepMap) AimMap.redraw();
  else if(p) AimMap.open({ latitude: p.latitude, longitude: p.longitude }, Math.max(11, Math.round(AimMap.zoom())));
  else AimMap.redraw();
}
// 月の中の各日を計算する。帯の4件/連続期間の代表日で月を埋めない。
const aimCal = { year: 0, month: 0, seq: 0, events: new Map(), cache: new Map() };
function aimCalMonthStart(year, month) { return Date.UTC(year, month, 1) - 9 * 3600000; }
// owner（aimCalGridHtml は plan/observer）は探す画面など別の条件の持ち主。既定はねらうの条件と撮影地点。
function aimCalRows(obs, target, body, year, month, partId, view = null, owner = aim) {
  if (owner.matchMode === "overlap") {
    const rows=[], plan={target,body,partId,limb:owner.limb,matchMode:"overlap"};
    for(let day=aimCalMonthStart(year,month),end=aimCalMonthStart(year,month+1);day<end;day+=86400000){
      for(const e of AstroNotesShooting.eventsFor(plan,obs,day,{align:AstroNotesAlign,isMountain:aimIsMountain,view})){
        if(e.at>=day&&e.at<day+86400000&&((body!=="sun"&&body!=="moon")||e.nearTarget)&&(body!=="moon"||e.sunAltitude<0))rows.push({...e,selectedMatch:AstroNotesShooting.matches(e,plan,aimIsMountain)});
      }
    }
    return rows;
  }
  const start = aimCalMonthStart(year, month), end = aimCalMonthStart(year, month + 1);
  if (!aimIsMountain(target)) {
    const rows = [];
    for (let day = start; day < end; day += 86400000) rows.push(...AstroNotesAlign.dailyView(obs, target, body, day, { partId, eyeM: obs.eyeM }));
    const selected = partId === "__whole" ? [] : AstroNotesAlign.upcoming(obs,target,body,{eyeM:obs.eyeM,from:start,days:Math.round((end-start)/86400000),limit:Infinity,groupDays:false,partId,limb:owner.limb,stepMs:3600000}).filter(e => aimCandidateMatch(e,false,owner));
    for (const row of rows) {
      const match = selected.find(e => S.JstCal.sameDay(e.at,row.at) && e.side === row.side);
      row.selectedMatch = partId === "__whole" ? row.intersects : !!match;
      if(match) row.at=match.at;
    }
    return rows.filter((e) => e.nearTarget && (body !== "moon" || e.sunAltitude < 0));
  }
  return AstroNotesAlign.upcoming(obs, target, body, { eyeM: obs.eyeM, from: start, days: Math.round((end - start) / 86400000),
    limit: Infinity, limb: "center", partId, stepMs: 3600000, groupDays: false })
    .filter((e) => e.at >= start && e.at < end && (body !== "moon" || e.sunAltitude < 0));
}
// 見え方と同じ2半径内の候補を扱い、円盤が届く日と近接通過を区別する。
function aimCalSolid(e) { return e.selectedMatch ?? e.intersects ?? (Math.abs(e.gap) <= (e.radius === 0 ? 1e-5 : 1.2 * e.radius)); }
// observer 省略時の撮影地点は月の形を描くときだけ引く（null を渡せば地点なし）
function aimCalGridHtml(year, month, events, selected, today, plan = aim, observer) {
  const moonObserver = plan.body === "moon" ? (observer === undefined ? aimFromPoint() : observer) : null;
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  let html = Array.from({ length: first }, () => '<span aria-hidden="true"></span>').join("");
  for (let d = 1; d <= days; d++) {
    const at = aimCalMonthStart(year, month) + (d - 1) * 86400000;
    const rows = events.get(at) || [], on = S.JstCal.sameDay(at, selected), now = S.JstCal.sameDay(at, today);
    const solid = rows.some(aimCalSolid);
    // 候補日はその時刻、他の日はJST正午の月の形。既存の月相判定を使う。
    const phase = moonObserver ? AstroNotesMoon.phaseOf(AstroNotesBodies.state("moon", rows[0]?.at ?? at + 12 * 3600000, { ...moonObserver, elevation: 0 })) : null;
    const label = `${year}年${month + 1}月${d}日${phase ? "、" + phase.name : ""}${rows.length ? (solid ? "、重なる日、" : "、近くを通る日、") + rows.map((e) => `${plan === aim ? aimSideName(e.side) : aimSideName(e.side, plan.body)} ${S.JstCal.hhmm(e.at)}${!AstroNotesBodies.definition(plan.body).limbs ? " " + AstroNotesBodies.sky(e.sunAltitude) : ""}`).join("、") : ""}`;
    html += `<button type="button" data-cal-day="${at}"${rows.length ? ' class="has-event"' : ""} aria-label="${esc(label)}" aria-pressed="${on}"${now ? ' aria-current="date"' : ""}><span>${d}</span><span class="aim-cal-mark"${phase ? " data-moon-phase" : ""} aria-hidden="true">${phase ? '<canvas class="aim-cal-moon" width="40" height="40" data-cal-moon="'+(rows[0]?.at ?? at + 12 * 3600000)+'"></canvas> ' : ""}${rows.length ? (solid ? "●" : "○") : ""}</span>${rows.length ? `<span class="aim-cal-time">${S.JstCal.hhmm(rows[0].at)}</span><span class="aim-cal-sky">${!AstroNotesBodies.definition(plan.body).limbs ? AstroNotesBodies.sky(rows[0].sunAltitude) : ""}</span>` : ""}</button>`;
  }
  return html;
}
function aimCalDraw() {
  $("aimCalGrid").innerHTML = aimCalGridHtml(aimCal.year, aimCal.month, aimCal.events, aim.dayMs, Date.now());
  const moonObserver=aimFromPoint();
  if(aim.body==="moon"&&moonObserver)for(const canvas of $("aimCalGrid").querySelectorAll("[data-cal-moon]")){
    const state=AstroNotesBodies.state("moon",+canvas.dataset.calMoon,{...moonObserver,elevation:0});
    const paint=()=>{if(canvas.isConnected&&$("aimCalendar").open){const image=AstroNotesCalendarMoon.request(state,paint);canvas.getContext("2d").drawImage(image.canvas,0,0,40,40);canvas.dataset.portraitStatus=image.status;}};
    paint();
  }
  for (const button of $("aimCalGrid").querySelectorAll("[data-cal-day]")) button.onclick = () => {
    const day = +button.dataset.calDay, rows = aimCal.events.get(day) || [];
    const event = rows.find((e) => e.side === aim.candSide) || rows[0];
    aim.candPick = null; aim.spot = null; aim.wantSpot = null; aim.wantKey = null;
    aim.candSide = event ? event.side : null;
    $("aimDate").value = new Date(day + 9 * 3600000).toISOString().slice(0, 10);
    if(!$("aimCalendar").dataset?.datetimeEditor)$("aimCalendar").close();
    aimApply();
    if($("aimCalendar").dataset?.datetimeEditor)aimCalDraw();
  };
}
async function aimCalRender() {
  const seq = ++aimCal.seq, year = aimCal.year, month = aimCal.month;
  aimCal.events = new Map();
  const baseYear = new Date(Date.now() + 9 * 3600000).getUTCFullYear();
  const years = Array.from({ length: Math.max(baseYear + 10, year + 2) - Math.min(baseYear - 2, year) + 1 }, (_, i) => Math.min(baseYear - 2, year) + i);
  $("aimCalYear").innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join("");
  $("aimCalYear").value = String(year);
  $("aimCalMonth").innerHTML = Array.from({ length: 12 }, (_, i) => `<option value="${i}">${i + 1}</option>`).join("");
  $("aimCalMonth").value = String(month);
  const f = aimFromPoint(), target = aim.target, body = aim.body, partId = aim.partId;
  $("aimCalContext").textContent = f && target ? `${f.name}から ${target.name}に${AstroNotesBodies.definition(body).name}を重ねる` : "撮影地点と対象を選んでください";
  $("aimCalGrid").setAttribute("aria-busy", "true");
  $("aimCalStatus").innerHTML = candidateWaitMarkup("重なる日を計算中…");
  aimCalDraw();
  const valid = () => seq === aimCal.seq && $("aimCalendar").open;
  try {
    if (!f) {$("aimCalStatus").textContent="日付を選んで、この日の候補から撮影地点を探せます。";return;}
    if (!(target?.parts || []).length) throw new Error("対象を選んでください");
    const ground = await aimElevation(f.latitude, f.longitude);
    if (!valid()) return;
    const obs = aimObserverAt(f, ground);
    const key = JSON.stringify([obs, target, body, partId, aim.limb, aim.matchMode, year, month, AstroNotesAtmosphere.dataKey()]);
    let rows = aimCal.cache.get(key);
    if (!rows) {
      // 開いたことを描いてから計算する。閉じた/月を替えた待ちは捨てる。
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (!valid()) return;
      const view=await aimShootingView(obs,target,body,partId,aim.matchMode);
      if(!valid())return;
      rows = aimCalRows(obs, target, body, year, month, partId, view);
      aimCal.cache.set(key, rows);
      if (aimCal.cache.size > 24) aimCal.cache.delete(aimCal.cache.keys().next().value);
    }
    if (!valid()) return;
    for (const row of rows) {
      const day = S.Cal.startOfDay(row.at);
      if (!aimCal.events.has(day)) aimCal.events.set(day, []);
      aimCal.events.get(day).push(row);
    }
    aimCalDraw();
    const solidDays = [...aimCal.events.values()].filter((rows) => rows.some(aimCalSolid)).length;
    const nearDays = aimCal.events.size - solidDays;
    $("aimCalStatus").textContent = aimCal.events.size ? `重なる日 ${solidDays}日${nearDays ? ` ・ 近くを通る日 ${nearDays}日` : ""}${body === "moon" ? "（暗い空の時間）" : ""}` : "この月は候補日がありません";
  } catch (err) {
    if (!valid()) return;
    $("aimCalStatus").textContent = err.message === "撮影地点と対象を選んでください" ? err.message : "計算できませんでした。月を選び直して再試行してください";
  } finally { if (valid()) $("aimCalGrid").setAttribute("aria-busy", "false"); }
}
function aimCalMove(offset) {
  const date = new Date(Date.UTC(aimCal.year, aimCal.month + offset, 1));
  aimCal.year = date.getUTCFullYear(); aimCal.month = date.getUTCMonth();
  aimCalRender();
}
$("aimCalendarOpen").onclick = () => {
  const date = new Date((aim.dayMs ?? Date.now()) + 9 * 3600000);
  aimCal.year = date.getUTCFullYear(); aimCal.month = date.getUTCMonth();
  showSheet($("aimCalendar")); aimCalRender();
};
$("aimCalClose").onclick = () => $("aimCalendar").close();
$("aimCalendar").addEventListener("close", () => { aimCal.seq++; resetAimCalSwipe(); $("aimCalendarOpen").focus({ preventScroll: true }); });
$("aimCalPrev").onclick = () => aimCalMove(-1);
$("aimCalNext").onclick = () => aimCalMove(1);
for (const id of ["aimCalYear", "aimCalMonth"]) $(id).onchange = () => {
  aimCal.year = +$("aimCalYear").value; aimCal.month = +$("aimCalMonth").value; aimCalRender();
};
$("aimCalToday").onclick = () => {
  const day = S.JstCal.startOfDay(Date.now());
  aim.candPick = null; aim.spot = null; aim.wantSpot = null; aim.wantKey = null; aim.candSide = null;
  $("aimDate").value = new Date(day + 9 * 3600000).toISOString().slice(0, 10);
  if(!$("aimCalendar").dataset?.datetimeEditor)$("aimCalendar").close();
  aimApply();
  if($("aimCalendar").dataset?.datetimeEditor){const d=new Date(day+32400000);aimCal.year=d.getUTCFullYear();aimCal.month=d.getUTCMonth();aimCalRender();}
};

/// 他の目標の場所を決める（「地点」の画面・お気に入り・地図の「ここに重ねる」から）。
/// 高さ（**地上から**。地面の標高は自動で足す）は、次の順で決める:
///   お気に入りに登録した高さ・検索で選んだ建物の地図の高さ → 先に打ち込んだ高さ → **その点に建つ建物の高さ（自動）** → 0（山の頂や地面そのもの）
/// （2026-10-01 ユーザー「建物なら元から情報を取っておけるよね？その建物の高さがわかるなら自動で入力がいいな」）
async function aimSetCustomTarget(p, { keepMap = false } = {}) {
  const request=nextAimCustomRequest(),owner=auth?.token,selected=$("aimTarget").value;
  const current=()=>request===aimCustomRequest&&owner===auth?.token&&viewState.aim&&$("aimTarget").value===selected;
  const input = $("aimCustomH"), typed = Number(input.value);
  // 打ち込んだ値を使うのは、欄が「地上からの高さ」のときだけ（山のときの欄は標高）
  const typedNow = input.dataset.edited === "1" && input.dataset.mode !== "elev" && Number.isFinite(typed) && typed > 0;
  // お気に入りに 0m（山の頂など）で登録したものは 0 のまま置く
  let h = Number.isFinite(p.heightM) && p.heightM >= 0 ? p.heightM : typedNow ? typed : null;
  let auto = false;
  // 山・峠など地面そのものが目標なら、地上 0m（標高がそのまま重ねる高さ）。建物は探さない
  if (h === null && p.natural) h = 0;
  // 検索で選んだ目標物に Wikidata の参照があれば、まずその高さ（OSM に高さが無くても取れる。大平和祈念塔 180m）
  if (h === null && p.wikidata) {
    $("aimTargetSub").textContent = "高さを調べています…";
    const wd = await AstroNotesTerrain.wikidataHeight(p.wikidata);
    if(!current())return;
    if (wd && wd.heightM) { h = Math.round(wd.heightM); auto = "wikidata"; }
  }
  if (h === null) {
    $("aimTargetSub").textContent = "高さを調べています…";
    const b = await aimBuildingAt(p.latitude, p.longitude);
    if(!current())return;
    if (b) { h = Math.round(b.heightM); auto = b.from === "wikidata" ? "wikidata" : b.estimated ? "estimated" : true; }
    // 地図で置いたときの名前は住所（「阿倍野筋」）なので、建物に名前があればそれにする（「あべのハルカス」）
    if (b && b.name && p.fromMap) p = { ...p, name: b.name };
  }
  if (h === null) h = 0;
  // 山・峠は地名の一覧の標高（頂の値）を使う。地図の標高タイルは地名の点の値で、点が頂から少しずれていると低く出る
  // （羊蹄山は地名の点で 1703m、山頂は 1898m。2026-10-01）
  const ground = p.natural && Number.isFinite(p.elevation) ? p.elevation : await aimElevation(p.latitude, p.longitude);
  if(!current())return;
  delete input.dataset.edited;
  store.set("sorami.aimCustom", { latitude: p.latitude, longitude: p.longitude, name: p.name || "他の対象",
    subtitle: p.subtitle || "", heightM: h, heightAuto: auto, groundM: ground, topM: ground + h });
  aimFillSelects();
  $("aimTarget").value = "custom";
  aimApply({ recenter: !keepMap });
}
/// 目標の場所のカード（地点カードと同じ形）。高さの欄にも今の値を入れる
function aimRenderTargetCard() {
  const c = aimTargetInfo();
  $("aimTargetName").textContent = c ? c.name || "他の対象" : "重ねる対象の場所を選ぶ";
  // 地上の高さが 0m なのは、山の頂など地面そのものが目標のとき（羊蹄山なら標高がそのまま重ねる高さ）。
  // そのときは「高さを入れてください」と促さない（2026-10-01 ユーザー「羊蹄山を入れたら高さが空欄。高さを入れてくださいはいらない」）。
  // 欄にも 0 を入れて、空欄にしない。
  // 地上の高さは下の欄に入っているので、ここには書かない（2026-10-02 ユーザー「そもそも自動入力で入ってるから不要」）
  $("aimTargetSub").textContent = c
    ? [c.subtitle, `標高 ${Math.round(c.groundM || 0)}m`].filter(Boolean).join(" ・ ")
    : "検索するか、地図の「ここに重ねる」";
  // 欄には、その目標で知られている数字を入れる: 建物は地上の高さ、山（地上 0m）は標高（富士山「山頂 3776m」・スカイツリー「先端 634m」と同じ）。
  // 山だけ空欄にすると、建物は入って山は入らない一貫しない画面になる（2026-10-01 ユーザー「山の標高入れておけばいいんじゃない？」）
  const elevMode = !!c && !c.heightM;
  const input = $("aimCustomH");
  input.dataset.mode = elevMode ? "elev" : "agl";
  input.placeholder = elevMode ? "標高" : "高さ（地上から）";
  input.setAttribute("aria-label", elevMode ? "対象の標高（メートル）" : "対象の高さ（地上から・メートル）");
  if (c && document.activeElement !== input) input.value = String(Math.round(elevMode ? c.groundM || 0 : c.heightM));
  $("aimTargetFav").hidden = !c;
  if (c) renderFavStar("aimTargetFav", c);
}
// 打ち込んだ高さは、次に場所を選んだときに使う（打ってから場所を選ぶ人のため）。画面が書き換えた値は使わない
$("aimCustomH").addEventListener("input", () => { $("aimCustomH").dataset.edited = "1"; });
// 他の目標を、高さごとお気に入りに。保存したら付けた名前と登録した高さで置き直す
$("aimTargetFav").onclick = () => {
  const c = aimTargetInfo();
  if (!c) return;
  favForPoint({ name: c.name, subtitle: c.subtitle, latitude: c.latitude, longitude: c.longitude, groundM: c.groundM }, (entry) => {
    if(entry?.targetKey){aimFillSelects();$("aimTarget").value=entry.targetKey;aimApply();return;}
    if (entry && Number.isFinite(entry.targetHeightM)
        && AstroNotesTerrain.distanceKm(entry.latitude, entry.longitude, c.latitude, c.longitude) < 0.02) {
      // 目標として登録したら、プルダウンの「お気に入り」のそれを選ぶ。他の目標は空ける（同じものを2つ並べない）
      if (!c.fav) store.set("sorami.aimCustom", null);
      aimFillSelects();
      $("aimTarget").value = `fav:${entry.id}`;
    }
    // 消したときは、プルダウンから外れて先頭へ戻る（aimApply が組み直す）
    aimApply();
  }, { target: c.heightM || 0 });
};
/// 検索結果の住所を「千葉県市川市」まで縮める（OSM の住所は「曽谷, 市川柏線, 宮久保四丁目, 市川市, 千葉県, 272-0822, 日本」と長い）
function aimAreaOf(r) {
  if (r.muni) return r.muni;
  const parts = String(r.detail || "").split(/\s*[,、・]\s*/);
  const pref = parts.find((x) => /[都道府県]$/.test(x)) || "";
  // 市・区を先に（「本町」のような町名を市より先に拾わない）。無ければ町・村
  const muni = parts.find((x) => /[市区]$/.test(x) && x !== pref) || parts.find((x) => /[町村]$/.test(x)) || "";
  return pref + muni;
}
$("aimFromFav").onclick = () => favForPoint(aimFromPoint(), (entry) => { renameFromAfterFav(aim, entry); store.set("sorami.aimFrom", aim.from); aimRenderFrom(); });

/// 見通しを確かめた観測地点・目標・部位（替わったら前の結果は使わない）
const aimSightKey = (f) => `${f.latitude},${f.longitude}|${aim.target && aim.target.id}|${aim.partId}`;

// 候補帯は選択部位と縁の一致。輪郭全体の日はカレンダー/全体モードへ。
function aimCandidateMatch(e, whole = aim.partId === "__whole", plan = aim) {
  if(e.matchMode === "overlap")return AstroNotesShooting.matches(e,{...plan,matchMode:"overlap"},aimIsMountain);
  if (whole) return !!e.intersects;
  const tolerance = Math.max(1 / 60, 0.2 * (e.radius || 0));
  return Number.isFinite(e.gap) && Math.abs(e.gap) <= tolerance;
}
// 400日探索は最大8日、重い天体では約1フレームごとに操作へ制御を返す。
// 「指定なし」の山の候補は山頂付近だけで判定する（2026-10-20 ユーザー「マジの稜線を全部入れてるでしょ。ここら辺（山頂の周り）を想定してる」）。
// 山頂から標高差 AIM_SUMMIT_CAP_M までの稜線を見かけの角度に直し、その上の部分（山頂の帽子）に天体が掛かる日だけを候補にする。
// 描く稜線（見た目）は全体のまま。
const AIM_SUMMIT_CAP_M = 300;
function aimSummitCap(ridge, obs, eye, target) {
  if (!Array.isArray(ridge) || ridge.length < 2) return null;
  const D = AstroNotesTerrain.distanceKm(obs.latitude, obs.longitude, target.latitude, target.longitude);
  const top = Math.max(...(target.parts || []).map((p) => p.m).filter(Number.isFinite));
  if (!Number.isFinite(top)) return null;
  const base = aimAirAngle(D, eye, top - AIM_SUMMIT_CAP_M);
  let peak = 0; for (let i = 1; i < ridge.length; i++) if (ridge[i][1] > ridge[peak][1]) peak = i;
  if (!(ridge[peak][1] > base)) return null;
  let lo = peak, hi = peak;
  while (lo > 0 && ridge[lo - 1][1] > base) lo--;
  while (hi < ridge.length - 1 && ridge[hi + 1][1] > base) hi++;
  // 境目は基準の高さで切る（隣の点との間を直線で補う）
  const cut = (a, b) => { const f = (base - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * f, base]; };
  const cap = ridge.slice(lo, hi + 1);
  cap.unshift(lo > 0 ? cut(ridge[lo - 1], ridge[lo]) : [ridge[0][0], base]);
  cap.push(hi < ridge.length - 1 ? cut(ridge[hi + 1], ridge[hi]) : [ridge[ridge.length - 1][0], base]);
  return { ridge: cap, base };
}
async function aimShootingView(obs, target, body, partId, matchMode) {
  if(matchMode!=='overlap'||!aimIsMountain(target))return null;
  const eye=obs.elevation+obs.eyeM,ridge=await aimLookRidge(obs,eye,target,{});
  if(!ridge)throw Error('山の稜線を取得できませんでした。再試行してください');
  const cap=aimSummitCap(ridge,obs,eye,target);
  return AstroNotesAlign.prepareDailyView(obs,target,body,cap?{partId:null,eyeM:obs.eyeM,ridge:cap.ridge,ridgeBase:cap.base}:{partId:null,eyeM:obs.eyeM,ridge});
}
async function aimBuildingDays(obs, target, body, partId, seq, { from = Date.now(), limb = aim.limb, matchMode = aim.matchMode || 'limb', isCurrent = () => seq === aim.fromSeq, days = 400, limit = 4, onScanned = () => {} } = {}) {
  const start = S.Cal.startOfDay(from), rows = [];
  const cache=aimBuildingDays.cache||(aimBuildingDays.cache=new Map());
  const cacheKey=JSON.stringify([start,days,limit,obs,target,body,partId,limb,matchMode,typeof AstroNotesAtmosphere==='undefined'?null:AstroNotesAtmosphere.dataKey()]);
  const saved=cache.get(cacheKey);
  if(saved&&start>=saved.from&&start<saved.until&&isCurrent()){onScanned(saved.scanned);return saved.rows.map(e=>({...e}));}
  let scanned=start;
  const whole = partId === "__whole", mountain = typeof aimIsMountain === "function" && aimIsMountain(target);
  // Match eventsFor/searchOptions: overlap uses the whole building, or the mountain rim.
  const options = {partId:matchMode==='overlap'?(mountain?null:'__whole'):partId,eyeM:obs.eyeM};
  const useView = matchMode === 'overlap' || whole&&!mountain;
  const mountainView=useView&&mountain&&matchMode==='overlap'?await aimShootingView(obs,target,body,partId,matchMode):null;
  if(!isCurrent())return [];
  const view = mountainView || (useView && typeof AstroNotesAlign.prepareDailyView==='function' ? AstroNotesAlign.prepareDailyView(obs,target,body,options) : null);
  let yieldedAt = 0;
  for (let i = 0; i < days && rows.length < limit; i++) {
    if (i % 8 === 0 || Date.now() - yieldedAt >= 16) { await new Promise((resolve) => setTimeout(resolve, 0)); if (!isCurrent()) return []; yieldedAt = Date.now(); }
    const day = start + i * 86400000;
    const plan={target,body,partId,limb,matchMode};
    const events = matchMode === 'overlap' ? AstroNotesShooting.eventsFor(plan,obs,day,{align:AstroNotesAlign,isMountain:aimIsMountain,view}) : whole && !mountain ? (view?view(day):AstroNotesAlign.dailyView(obs, target, body, day, options))
      : AstroNotesAlign.upcoming(obs, target, body, {eyeM:obs.eyeM,from:day,days:1,limit:Infinity,groupDays:false,partId,limb,stepMs:3600000});
    // 候補日はJST日単位。同じ日なら今の時刻に関係なく同じ日集合にする（その日の過ぎた時刻の候補も残す）
    const row = events.find((e) => e.at >= start && (matchMode === 'overlap' ? AstroNotesShooting.matches(e,plan,aimIsMountain) : aimCandidateMatch(e,whole,plan)) && (body !== "moon" || e.sunAltitude < 0));
    if (row) rows.push(row);
    scanned=day+86400000;onScanned(scanned);
  }
  if(isCurrent()){
    cache.delete(cacheKey);cache.set(cacheKey,{from:start,until:start+86400000,scanned,rows:rows.map(e=>({...e}))});
    while(cache.size>8)cache.delete(cache.keys().next().value);
  }
  return rows;
}
// 表示日を替えても検索条件は同じ。地形・標高・有効な大気データが替われば再探索する。
function aimDaysInputKey(f, now = Date.now(), plan = aim) {
  if (!f) return null;
  return JSON.stringify([f.latitude, f.longitude, f.groundManualM, f.observationElevationM,
    f.standAglM, aimObserverEye(f), plan.target, plan.body, plan.partId,
    plan.partId === "__whole" ? null : plan.limb, plan.matchMode || 'limb',
    AstroNotesAtmosphere.dataKey(now), S.Cal.startOfDay(now)]);
}
function candidateWaitMarkup(message = '候補日時を計算中…') {
  return `<div class="note-wait candidate-wait" role="status"><span class="note-wait-character" aria-hidden="true"></span><span class="note-wait-message">${esc(message)}</span></div>`;
}
function aimSyncFromDay() {
  for (const el of $("aimFrom").querySelectorAll("[data-from-day]")) {
    el.setAttribute("aria-pressed", String(S.JstCal.sameDay(+el.dataset.fromDay, aim.dayMs)));
  }
}
async function aimDaysFor(obs, inputKey) {
  const now = Date.now(), key = JSON.stringify([inputKey, obs]);
  const previous = aim.fromDays;
  if (previous && previous.key === key && now < previous.until) return previous.rows || previous.promise;
  // 別条件の古い候補を新条件の操作に使わせない。
  $("aimFrom").innerHTML = candidateWaitMarkup("候補日時を計算中…");
  const target = aim.target, body = aim.body, partId = aim.partId, limb = aim.limb, matchMode = aim.matchMode;
  const entry = { key, inputKey, until: Infinity, rows: null, promise: null, searchedUntil: S.Cal.startOfDay(now), origin: now, morePromise: null };
  aim.fromDays = entry;
  entry.promise = (async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    if (aim.fromDays !== entry) return null;
    if (aimDaysInputKey(aimFromPoint()) !== inputKey) { aim.fromDays = null; return null; }
    const rows = await aimBuildingDays(obs, target, body, partId, null,
      { from: now, limb, matchMode, isCurrent: () => aim.fromDays === entry && aimDaysInputKey(aimFromPoint()) === inputKey, onScanned: end => { entry.searchedUntil = end; } });
    if (aim.fromDays !== entry) return null;
    // 探索中のデータ更新・失効を混ぜた結果は再利用しない。
    if (aimDaysInputKey(aimFromPoint()) !== inputKey) { aim.fromDays = null; return null; }
    entry.rows = rows;
    // 候補日はJST日単位。候補の時刻では失効させず、日を跨いだら再探索する。
    entry.until = S.Cal.startOfDay(now) + 86400000;
    return entry.rows;
  })().catch(error => { if (aim.fromDays === entry) aim.fromDays = null; throw error; });
  return entry.promise;
}
// 続きは未探索日から2暦年ずつ。終端は翌日0時(JST)で排他的。
function aimCandidateSearchEnd(){return Date.UTC(2101,0,1)-9*3600000;}
function aimCandidatePageEnd(from){
  const d=new Date(S.Cal.startOfDay(from)+9*3600000),year=d.getUTCFullYear()+2,month=d.getUTCMonth();
  const day=Math.min(d.getUTCDate(),new Date(Date.UTC(year,month+1,0)).getUTCDate());
  return Math.min(Date.UTC(year,month,day)-9*3600000,aimCandidateSearchEnd());
}
function aimAppendCandidatePage(entry,rows,scanned){
  entry.rows=[...entry.rows,...rows];entry.searchedUntil=scanned;
}
async function aimMoreDays() {
  const entry = aim.fromDays, f = aimFromPoint();
  if (!entry?.rows || entry.morePromise || Date.now() >= entry.until || entry.inputKey !== aimDaysInputKey(f)) return aimRenderFrom();
  const current = () => aim.fromDays === entry && entry.inputKey === aimDaysInputKey(aimFromPoint()) && Date.now() < entry.until;
  const from = entry.searchedUntil, end = aimCandidatePageEnd(from);
  if (from >= end) return;
  const target = aim.target, body = aim.body, partId = aim.partId, limb = aim.limb, matchMode = aim.matchMode;
  const button = $("aimFrom").querySelector('[data-from-more]');
  if (button) { button.disabled = true; button.textContent = "先の候補を計算しています…"; }
  entry.morePromise = (async () => {
    const ground = await aimElevation(f.latitude, f.longitude);
    if (!current()) return;
    const obs = aimObserverAt(f, ground), days = Math.ceil((end - from) / 86400000);
    let scanned = from;
    const rows = await aimBuildingDays(obs, target, body, partId, null,
      { from, days, limit: 4, limb, matchMode, isCurrent: current, onScanned: value => { scanned = value; } });
    if (!current()) return;
    aimAppendCandidatePage(entry,rows,scanned);
  })();
  // aimRenderFromが開始時に消費する。trialで描画しなかった時も次の通常描画へ残さない。
  const renderAppended = async () => { aim.fromAppend = true; try { await aimRenderFrom(); } finally { aim.fromAppend = false; } };
  try { await entry.morePromise; }
  catch { if (current()) { entry.morePromise = null; await renderAppended(); const retry = $("aimFrom").querySelector('[data-from-more]'); if (retry) retry.textContent = "計算できませんでした。再試行"; } return; }
  finally { entry.morePromise = null; }
  if (current()) await renderAppended();
  else if (aim.fromDays === entry) await aimRenderFrom();
}
function candidateDatesMarkup(ev, entry, plan, at) {
  const thisYear = new Date(Date.now() + 9 * 3600000).getUTCFullYear();
  const chips = ev.map((e) => {
    const y = new Date(e.at + 9 * 3600000).getUTCFullYear();
    const lit = plan.body === "moon" ? ` ${moonGlyphAt(e.at, plan.observer || plan.from)}<span class="aim-day-lit">${Math.round(e.illuminated * 100)}%</span>` : "";
    const on = S.JstCal.sameDay(e.at, at);
    return `<button type="button" class="tiny aim-day" data-from-day="${S.Cal.startOfDay(e.at)}" data-from-at="${e.at}" data-from-side="${e.side}" aria-pressed="${on}">`
      + `${y === thisYear ? "" : `${y}/`}${S.Cal.monthDay(e.at)}(${S.Cal.weekday(e.at)})`
      + `<span class="sub-line">${aimSideName(e.side,plan.body)} ${S.JstCal.hhmm(e.at)}${!AstroNotesBodies.definition(plan.body).limbs ? " " + AstroNotesBodies.sky(e.sunAltitude) : ""}${lit}</span></button>`;
  }).join("");
  const complete=entry&&entry.searchedUntil>=aimCandidateSearchEnd();
  const last=entry&&entry.searchedUntil>S.Cal.startOfDay(entry.origin)?new Date(entry.searchedUntil-86400000+9*3600000).toISOString().slice(0,10).replaceAll('-','/'):'';
  const scanned=`<div class="candidate-heading"><span>重なる日時</span><span role="status">${last?last+"まで探索済み":""}</span></div>`;
  const none=ev.length?'':'<p class="tiny">探索済みの期間には候補がありません。</p>';
  const more=complete?'<p class="tiny">対応する日付の終わり（2100年）まで探索しました。</p>':`<button type="button" class="fav-btn tiny" data-from-more${entry?.morePromise?' disabled':''}>${entry?.morePromise?'先の候補を計算しています…':'さらに先の候補を探す'}</button>`;
  return scanned+(chips?`<div class="aim-days strip">${chips}</div>`:none)+more;
}
// 続きの候補は今の帯の末尾へ足す。帯を作り直すと横位置（待ち中の手動scrollも）と慣性scrollを失う。
// 既存の釦が新しい並びの先頭と一致しなければ何もせずfalseを返し、呼出側が従来どおり作り直す。
function candidateDatesAppend(box, ev, entry, plan, at) {
  const strip = box.querySelector('.aim-days.strip');
  if (!strip) return false;
  const t = document.createElement('template');
  t.innerHTML = candidateDatesMarkup(ev, entry, plan, at);
  const next = t.content.querySelector('.aim-days.strip'), old = [...strip.querySelectorAll('[data-from-day]')];
  const fresh = next ? [...next.querySelectorAll('[data-from-day]')] : [];
  if (!next || old.length > fresh.length || old.some((b, i) => b.dataset.fromAt !== fresh[i].dataset.fromAt)) return false;
  const before = [], after = [];
  let seen = false;
  for (const n of [...t.content.childNodes]) { if (n === next) seen = true; else (seen ? after : before).push(n); }
  const left = strip.scrollLeft;
  candidateDatesHoldSnap(strip);
  strip.querySelector('[data-from-more]')?.remove();
  for (const n of [...box.childNodes]) if (n !== strip) n.remove();
  strip.before(...before); strip.after(...after);
  strip.append(...fresh.slice(old.length));
  strip.scrollLeft = left;
  return true;
}
// 右端（scrollLeftが上限で止まった位置）では、x proximityのsnapが末尾追加後に先の釦の頭へ再snapして飛ぶ。
// 追加の間はsnapを止め、利用者自身が次にscrollし終えた時だけ戻す（プログラムのscrollでは戻さない）。
function candidateDatesHoldSnap(strip) {
  if (strip._snapHeld) return;
  strip._snapHeld = true;
  strip.style.scrollSnapType = 'none';
  const inputs = ['pointerdown', 'touchstart', 'wheel', 'keydown'];
  let user = false, timer = 0;
  const arm = () => { user = true; };
  const release = () => {
    for (const name of inputs) strip.removeEventListener(name, arm);
    strip.removeEventListener('scroll', settle);
    strip.style.scrollSnapType = '';
    strip._snapHeld = false;
  };
  const settle = () => { if (!user) return; clearTimeout(timer); timer = setTimeout(release, 150); };
  for (const name of inputs) strip.addEventListener(name, arm, { passive: true });
  strip.addEventListener('scroll', settle, { passive: true });
}
// The selected place is already known; displaying it must not wait for models, weather or terrain.
function aimRenderSelectedPoint() {
  const f=aimFromPoint();
  const ground=f?(Number.isFinite(f.groundManualM)?f.groundManualM:aimElevCache.get(`${f.latitude.toFixed(6)},${f.longitude.toFixed(6)}`)):null;
  renderPointCard("aimFrom",f,ground);
  $("aimFromClear").hidden=!f;$("aimFromFav").hidden=!f;
  $("aimObserverDetails").hidden=!f;
  // Show feedback before waiting for city models, body engines or terrain.
  const ready=!!f&&!!(aim.target?.parts||[]).length;$("aimFrom").hidden=!ready;
  if(ready&&(!aim.fromDays?.rows||aim.fromDays.inputKey!==aimDaysInputKey(f)))
    $("aimFrom").innerHTML=candidateWaitMarkup();
  else if(!ready) $("aimFrom").innerHTML="";
  return f;
}
async function aimRenderFrom() {
  if(globalThis.TrialExplore?.ownsScene?.()??globalThis.TrialExplore?.active()){globalThis.TrialExplore.sync();return;}
  // aimMoreDaysの直後の1回だけ末尾追加にする。他の描画は従来どおり作り直す。
  const append = aim.fromAppend === true;
  aim.fromAppend = false;
  const seq = ++aim.fromSeq;
  const f = aimFromPoint();
  // 地点カードと同じ形: 名前と、住所・標高（標高は読めたら足す）
  $("aimAlignmentDetails").hidden = !(aim.target?.parts||[]).length;
  $("aimObserverDetails").hidden = !f;
  renderPointCard("aimFrom", f);
  $("aimFromClear").hidden=!f;$("aimFromFav").hidden=!f;
  for(const row of $("aimView").querySelectorAll(".aim-observer-height"))row.hidden=!f;
  try { window.MyPlacesUI?.renderAim(); } catch { /* trial: 自分の地点の一覧で構図を止めない */ }
  aimRenderObserverHeight(f, null);
  $("aimObserverHeightError").hidden = true;

  const moon = aim.body === "moon";
  // 2026-10-20 ユーザー「不要な説明は消しといて」：未選択時の使い方の一文は出さない（入力欄とボタンで分かる）
  $("aimFrom").hidden=!f||!(aim.target?.parts||[]).length;
  if ($("aimFrom").hidden) { $("aimFrom").innerHTML = ""; $("aimLook").hidden = true; }
  if (!f) return;
  // Publish the wait state before starting the selected-day diagram or search.
  if (!$("aimFrom").hidden && aim.fromDays?.rows) aimSyncFromDay();
  if (!$("aimFrom").hidden && (!aim.fromDays || aim.fromDays.inputKey !== aimDaysInputKey(f))) {
    $("aimFrom").innerHTML = candidateWaitMarkup("候補日時を計算中…");
  }
  await new Promise((r) => setTimeout(r, 0));
  if (seq !== aim.fromSeq) return;
  // The selected day's diagram still does not wait for the long candidate search.
  aimUpdateLook();
  const ground = await aimElevation(f.latitude, f.longitude);
  if (seq !== aim.fromSeq) return;
  const obs = aimObserverAt(f, ground);
  if (Number.isFinite(ground)) renderPointCard("aimFrom", f, ground);
  aimRenderObserverHeight(f, ground);
  if (!(aim.target?.parts || []).length) { $("aimFrom").innerHTML = ""; $("aimFrom").hidden=true; $("aimLook").hidden = true; return; }
  // 候補帯は選択した高さ・縁に近い日、全体モードだけ輪郭通過の日を出す。
  let ev = [];
  try {
    ev = await aimDaysFor(obs, aimDaysInputKey(f));
  } catch {
    if (seq !== aim.fromSeq) return;
    aim.fromEvents = [];
    $("aimFrom").innerHTML = '<p class="tiny" role="status">候補日を計算できませんでした。</p><button type="button" class="fav-btn" data-from-retry>再試行</button>';
    $("aimFrom").querySelector('[data-from-retry]').onclick = () => aimRenderFrom();
    return;
  }
  if (seq !== aim.fromSeq) return;
  if (ev === null) return aimRenderFrom();
  const all = ev;
  // 明るい空の月は出さない
  ev = ev.filter((e) => aimCandidateMatch(e) && (!moon || e.sunAltitude < 0));
  // 帯の上の「◯◯から見た◯◯ ・ ◯◯まで Nkm」は出さない（2026-10-03 ユーザーが選んだ「いらない説明文」。地点と題名の繰り返し）
  aim.fromEvents = ev;
  // 横に流す帯（2026-10-03 ユーザー「候補日はプルダウンにしたら？」→ Codex と相談し、4件ほどなら一目で比べて1回で選べる帯）。
  // 釦は日付と側の2段だけ。通り方・動き方は、選んだ日のぶんだけ見え方の図の上の一行に書く。押すとその日（図・日付・地図・候補地）
  // 続きの探索結果は押した時の横位置・選択のまま末尾へ足す（2026-10-30）
  const appended = append && candidateDatesAppend($("aimFrom"), ev, aim.fromDays, aim, aim.dayMs);
  if (appended) aimSyncFromDay();
  else $("aimFrom").innerHTML = candidateDatesMarkup(ev, aim.fromDays, aim, aim.dayMs);
  const moreButton = $("aimFrom").querySelector("[data-from-more]");
  if (moreButton) moreButton.onclick = aimMoreDays;
  // 選んでいる日の釦が見える所まで帯を送る
  const onChip = appended ? null : $("aimFrom").querySelector('.aim-day[aria-pressed="true"]');
  if (onChip) onChip.parentElement.scrollLeft = Math.max(0, onChip.offsetLeft - 8);
  for (const el of $("aimFrom").querySelectorAll("[data-from-day]")) {
    el.onclick = () => {
      // その日へ。候補地の選択はやめる（見え方は観測地点の近く）。地図へは送らない（図がすぐ下で変わる）。
      // 候補地は押した日の側（日の入の日を押したのに日の出側の候補地が出ていた）
      aim.candPick = null; aim.spot = null; aim.wantSpot = null; aim.wantKey = null; aim.candSide = el.dataset.fromSide;
      $("aimDate").value = new Date(+el.dataset.fromDay + 9 * 3600000).toISOString().slice(0, 10);
      const at = +el.dataset.fromAt, obs = aimObserverAt(f, ground);
      aim.plannerTransfer = {at, body:aim.body, latitude:obs.latitude, longitude:obs.longitude, day:+el.dataset.fromDay};
      aimApply();
    };
  }
  // 候補帯の描画は見え方の条件を変えない。図は冒頭の1回で更新済み。

}
export {aimAppendCandidatePage,aimAreaOf,aimBuildingDays,aimCal,aimCalGridHtml,aimCalMove,aimCalRows,aimCalSolid,aimCandidateMatch,aimCandidatePageEnd,aimCandidateSearchEnd,aimDaysInputKey,aimFromPoint,aimM,aimObserverAt,aimObserverEye,aimRenderFrom,aimRenderSelectedPoint,aimRenderTargetCard,aimSavedFrom,aimSetCustomTarget,aimSetFrom,aimShootingView,candidateDatesAppend,candidateDatesMarkup,candidateWaitMarkup};
