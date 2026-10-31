import {$,S,esc} from '../../app/presentation-helpers.js';
import {favorites,place,sightings,store,viewState} from '../../app/browser-state.js';
import {bundle,load} from '../forecast/load.js';
import {iconFor,render} from '../forecast/view.js';
import {renderAlmanac} from '../home/controller.js';
import {MapPick} from '../../ui/map/picker.js';
import {AimMap,aim,aimElevation,aimFillSelects,matchingTargetNames,targetLocationLabel} from '../framing/controller.js';
import {plane,planeFromPoint,planeSetFrom} from '../aircraft/controller.js';
import {aimApply,iss,issFromPoint,issSetFrom} from '../satellites/controller.js';
import {aimAreaOf,aimFromPoint,aimObserverEye,aimSetCustomTarget,aimSetFrom} from '../framing/observer.js';
import {favUndo,placeSheetFor,refreshPlacePickerActions,renderFavToggle} from '../../services/place-search.js';
import {auth} from '../account/session-and-access.js';
import {showSheet} from '../../app/overlays.js';
import {accountSync} from '../account/sync-bridge.js';
import {recentHistory} from '../framing/presentation.js';
let almanacPoint = null;
let selectedDay = {};    // phenomenon → dayMs
// ---------------------------------------------------------------- 地点
/// 地点の画面を、何の地点を決めるために開いているか。null はAstroNotesの地点（地点カード）、"aim" はねらうの「どこから重ねるか」。
/// 画面は1つを使い回す（検索・現在地・地図で選ぶ・お気に入り。2026-10-01 ユーザー「新しいレイアウト作る必要ないよね」）
/// 地点の画面で選んだ場所を、開いた目的の方へ渡す
function choosePlace(p, { keepSheet = false } = {}) {
  if(globalThis.MyPlacesUI?.selectShape?.(p,placeSheetFor))return;
  try { recentHistory.rememberPlace(p,{observer:placeSheetFor==='aim'||(!placeSheetFor&&!aim.from)}); } catch { /* History must not prevent choosing a place. */ }
  const picker = placeSheetFor && PLACE_PICKERS[placeSheetFor];
  if (picker) {
    if (!keepSheet) $("placeSheet").close(); // Map confirmation returns to the existing place picker.
    // 地名の一覧の山・峠・岬・滝は、地面そのものが目標（建物を探さない）
    picker.set({ id: p.id, natural: /^(山|峠|岬|滝)( ・|$)/.test(p.subtitle || ""), wikidata: p.wikidata ?? null,
      // 階数からの見積もりは「分からない」として扱い、Wikidata・地図の建物で取り直す
      structureFrom: p.structureFrom ?? null,
      name: p.name, subtitle: aimAreaOf({ detail: p.subtitle || "" }) || p.subtitle || "",
      latitude: p.latitude, longitude: p.longitude, elevation: Number.isFinite(p.elevation) ? p.elevation : null,
      structureM: p.structureM ?? null, targetHeightM: p.targetHeightM ?? null,
      decks: p.decks ?? null, eyeHeightAGL: p.eyeHeightAGL ?? null });
    if (keepSheet) refreshPlacePickerActions(picker);
    return;
  }
  selectPlace(p);
}
/// 地点の画面を道具から開くときの行き先。**道具の観測地点は、AstroNotesの地点を引き継いで地点カードと同じ形で出す**
/// （ねらう・ISS・月丼で同じ部品。2026-10-01 ユーザー「月丼とかISSとかのレイアウトも統一感あるように」）。
///   title  … 地点の画面の題名
///   custom … AstroNotesの地点から替えているか（替えていれば「AstroNotesの地点に戻す」行を出す）
///   point  … 地図で選ぶを開く場所
///   set    … 選んだ場所を渡す ／ reset … AstroNotesの地点に戻す
const PLACE_PICKERS = {
  almanac: { title: "観測地点", custom: () => almanacPoint, point: () => almanacPoint || place,
    set: p => { almanacPoint = p; renderAlmanac(); }, reset: () => { almanacPoint = null; renderAlmanac(); } },
  aim: { title: "撮影地点", custom: () => aim.from, point: () => aimFromPoint(),
    set: (p) => aimSetFrom(p),
    resetLabel: "撮影地点の選択を解除", reset: () => aimSetFrom(null) },
  // お気に入りから選んだら、登録した高さで置く
  // 目標として登録したお気に入りを選んだら、プルダウンの「お気に入り」のそれにする（他の目標へ写さない）
  aimTarget: { title: "どこに重ねるか", custom: () => null, point: () => store.get("sorami.aimCustom", null) || AimMap.center(),
    set: (p) => {
      const f = favorites.find((x) => x.id === p.id && Number.isFinite(x.targetHeightM));
      if (f) { aimFillSelects(); $("aimTarget").value = `fav:${f.id}`; aimApply({ recenter: true }); return; }
      aimSetCustomTarget({ ...p, heightM: p.targetHeightM ?? (p.structureFrom === "levels" ? null : p.structureM) });
    } },
  iss: { title: "どこの近くで探すか", custom: () => iss.from, point: () => issFromPoint(),
    set: (p) => issSetFrom(p), reset: () => issSetFrom(null) },
  plane: { title: "撮影地点", custom: () => plane.from, point: () => planeFromPoint(),
    set: (p) => planeSetFrom(p), reset: () => planeSetFrom(null) },
};
/// AstroNotesの地点（地点カードの地点）を、道具の観測地点として引き継ぐ形にする
function inheritedPoint() {
  return Number.isFinite(place.latitude)
    // 住所は検索のときと同じく都道府県＋市区町村まで（地点カードの説明は「山 ・ 東京都八王子市」と種類も入る）
    ? { name: place.name, subtitle: aimAreaOf({ detail: place.subtitle || "" }) || place.subtitle || "",
        latitude: place.latitude, longitude: place.longitude, decks: place.decks ?? null,
        eyeHeightAGL: place.eyeHeightAGL === 1.5 ? 0 : place.eyeHeightAGL ?? null, inherited: true }
    : null;
}
/// 観測地点のカード（地点カードと同じ形）を描く。名前と、住所・標高・引き継ぎ。☆ はお気に入りに入っていれば ★
function renderPointCard(prefix, f, groundM = null, { elevation = true, ids = null } = {}) {
  const shooting=prefix === "aimFrom" || prefix === "skyMapObserver";
  const nameId=ids?.name||`${prefix}Name`,subId=ids?.sub||`${prefix}Sub`,favId=ids?.fav||`${prefix}Fav`;
  // 引き継いだ地点の標高は、地点カードと同じ値を出す（道具ごとに数m違って見えないように）
  const g = !elevation ? null : shooting ? groundM : f && f.inherited ? place.elevation ?? bundle?.home.grid.elevation ?? groundM : groundM;
  $(nameId).textContent = f ? f.name : shooting ? "撮影地点を選ぶ" : "撮影地点を選んでください";
  $(subId).textContent = f ? [f.subtitle, Number.isFinite(g) ? `標高 ${shooting ? Math.round(g * 10) / 10 : Math.round(g)}m` : "",
    f.inherited ? "AstroNotesの地点" : ""].filter(Boolean).join(" ・ ") : "";
  if ($(favId)) renderFavStar(favId, f);
}
function renderFavStar(id, f) {
  const favOn = f && favorites.some((x) => AstroNotesTerrain.distanceKm(x.latitude, x.longitude, f.latitude, f.longitude) < 0.02);
  $(id).textContent = favOn ? "★" : "☆";
  $(id).classList.toggle("on", !!favOn);
  $(id).setAttribute("aria-label", favOn ? "お気に入りを編集" : "お気に入りに登録");
}
/// ☆ を押したら: 登録済みなら編集、まだなら観測地点（座標）を雛形に登録の画面を開く。after は閉じたあとの出し直し。
/// target は「他の目標」から開いたときの今の高さ（地上から）。登録の画面に高さの欄を出し、立つ場所の項目は隠す
async function favForPoint(f, after, { target = null, shooting = false } = {}) {
  if (!requireLoginForFavorites() || !f) return;
  const i = favorites.findIndex((x) => AstroNotesTerrain.distanceKm(x.latitude, x.longitude, f.latitude, f.longitude) < 0.02);
  if (i >= 0) { openFavSheet(i, { after, target, shooting }); return; }
  // AstroNotesの地点を引き継いでいるなら、地点カードの ☆ と同じ（地点そのものを雛形に）
  if (f.inherited) { openFavSheet(-1, { after, shooting }); return; }
  // 目標の地面の標高が分かっていればそれ（山は頂の標高）。無ければ地図の標高タイル
  const owner=auth?.token;
  const e = f.groundManualM ?? f.elevation ?? f.groundM ?? await aimElevation(f.latitude, f.longitude);
  if(owner!==auth?.token)return;
  openFavSheet(-1, { after, target, shooting, point: {
    id: `map:${f.latitude.toFixed(5)},${f.longitude.toFixed(5)}`, name: f.name, subtitle: f.subtitle || "",
    latitude: f.latitude, longitude: f.longitude, elevation: Number.isFinite(e) ? Math.round(e * 10) / 10 : null,
    terrain: null, phenomena: [], eyeHeightAGL: Number.isFinite(f.eyeHeightAGL)?f.eyeHeightAGL:aimObserverEye(f), locationScope: "point" } });
}
/// お気に入りを保存・削除したあと、道具の観測地点がその点なら付けた名前にする
function renameFromAfterFav(holder, entry) {
  if (entry && holder.from && AstroNotesTerrain.distanceKm(entry.latitude, entry.longitude, holder.from.latitude, holder.from.longitude) < 0.02) {
    holder.from = { ...holder.from, name: entry.name, subtitle: aimAreaOf({ detail: entry.subtitle }) || entry.subtitle };
  }
}
function selectPlace(p) {
  place = p;
  store.set("sorami.place", p);
  $("placeSheet").close();
  selectedDay = {};
  if(viewState.answers)render();else load(true);
}
// astronotes-core の閾値の写し。ずれると説明が嘘になるので test-layout.mjs で突き合わせている。
//   雲海 T.seaOfClouds.minElevation = 250 ／ 霧氷 T.rime.minElevation = 500
const MIN_ELEV = { seaOfClouds: 250, rime: 500 };
// 地形を選んだ結果どうなるかを、その地点の標高込みで言う。
// 「山頂なら霧氷も対象」は誤り。霧氷の標高判定は地形に関係なく効く（astronotes-core:1403）。
function terrainEffect(terrain, elevation) {
  const el = elevation == null ? null : Math.round(elevation);
  const shortfall = (min) => `標高 ${min}m 以上が必要（ここは ${el == null ? "不明" : el + "m"}）`;
  const sea = ["basinFloor", "plain", "coast"].includes(terrain) ? "見下ろせる地形ではないので対象外"
    : terrain ? "対象"
    : (el == null || el < MIN_ELEV.seaOfClouds) ? shortfall(MIN_ELEV.seaOfClouds) : "対象";
  const rime = ["plain", "coast"].includes(terrain) ? "山地ではないので対象外"
    : (el == null || el < MIN_ELEV.rime) ? shortfall(MIN_ELEV.rime) : "対象";
  return `雲海：${sea}　霧氷：${rime}`;
}
const PHENOMENA_ORDER = Object.entries(S.PHENOMENA).sort((a, b) => a[1].order - b[1].order);

let favDraft = null;   // 編集中のお気に入り。index が -1 なら新規。
let favMapReturn = false; // 位置変更の地図を閉じたら編集フォームへ戻す
function clearFavMapReturn() { favMapReturn = false; }

let favFilter = null;   // 地点の絞り込み（画面を開いている間だけ）
function renderSheet() {
  // 消した直後の取り消し。数秒で消えるトーストにすると、押す前に消えて戻せない。
  $("favUndo").innerHTML = favUndo.map((u, i) =>
    `<div class="undo-row"><span><strong>${esc(u.entry.name)}</strong> を消しました</span>
      <button data-undo="${i}">元に戻す</button></div>`).join("");
  for (const el of $("favUndo").querySelectorAll("[data-undo]")) el.onclick = () => {
    const u = favUndo[+el.dataset.undo];
    const at = Math.min(u.index, favorites.length);
    favorites.splice(at, 0, u.entry);
    if (!saveFavorites()) { favorites.splice(at, 1); return; }
    accountSync().queuePush("fav", u.entry.id);
    favUndo.splice(+el.dataset.undo, 1);
    renderFavToggle();
    renderSheet();
  };

  const tagged = [...new Set(favorites.flatMap((f) => f.phenomena || []))]
    .filter((p) => S.PHENOMENA[p]).sort((a, b) => S.PHENOMENA[a].order - S.PHENOMENA[b].order);
  const filter = tagged.includes(favFilter) ? favFilter : (favFilter = null);
  // 絞り込み中はチップを必ず出す。タグが1種類に減ったからと隠すと、
  // 絞り込みだけ残ってタグ無しの地点が見えなくなる。
  $("favChips").innerHTML = tagged.length > 1 || filter
    ? `<button class="${!filter ? "on" : ""}" aria-pressed="${!filter}" data-chip="">すべて</button>`
      + tagged.map((p) => `<button class="${filter === p ? "on" : ""}" aria-pressed="${filter === p}" data-chip="${p}">${S.PHENOMENA[p].name}</button>`).join("")
    : "";
  for (const el of $("favChips").querySelectorAll("[data-chip]")) {
    el.onclick = () => { favFilter = el.dataset.chip || null; renderSheet(); };
  }

  const shown = favorites.map((f, i) => ({ f, i }))
    .filter(({ f }) => !filter || (f.phenomena || []).includes(filter));
  $("favList").innerHTML = !favorites.length
    ? `<p class="tiny">地点名の横の ☆、または「＋ いまの地点を登録」から追加できます。<br>
        現象・地形・メモを付けておくと、自分だけの絶景スポット帳になります。</p>`
    : !shown.length ? `<p class="tiny">この現象で登録した地点はありません</p>`
    : shown.map(({ f, i }) => {
        const icons = (f.phenomena || []).filter((p) => S.PHENOMENA[p]).map((p) => iconFor(p)).join("");
        const meta = [f.subtitle, f.elevation != null ? `標高${Math.round(f.elevation)}m` : "",
          f.targetHeightM ? `高さ${Math.round(f.targetHeightM)}m` : "", window.MyPlacesUI ? MyPlacesUI.badge(f) : ""].filter(Boolean).join(" ・ ");
        return `<div class="fav-row">
          <button class="list-item" data-fav="${i}"><strong>${esc(f.name)}</strong> <span class="tiny">${icons}</span>
            <span class="tiny sub-line">${esc(meta)}${f.note ? " ー " + esc(f.note) : ""}</span></button>
          <button class="tap fav-edit" data-editfav="${i}">編集</button>
          <button class="fav-del" data-delfav="${i}" aria-label="${esc(f.name)} をお気に入りから外す">✕</button></div>`;
      }).join("");
  for (const el of $("favList").querySelectorAll("[data-fav]")) el.onclick = () => choosePlace(favorites[+el.dataset.fav]);
  for (const el of $("favList").querySelectorAll("[data-editfav]")) el.onclick = () => openFavSheet(+el.dataset.editfav);
  // 1タップで消して、取り消しで戻す。確認を挟まないぶん速く、押し間違えても失わない。
  for (const el of $("favList").querySelectorAll("[data-delfav]")) el.onclick = () => removeFavorite(+el.dataset.delfav);
}

// 保存に失敗したら、画面の見た目とlocalStorageが食い違わないよう配列も戻す。
// 表示だけ成功しているように見えるのが一番たちが悪い。
function saveFavorites() {
  const okay = store.set("sorami.favorites", favorites);
  // 登録シートは地点シートの上に重なる。前面に出ていない側だけに書いても見えない。
  for (const el of document.querySelectorAll(".save-err")) el.hidden = okay;
  return okay;
}
function removeFavorite(index) {
  if (!Number.isInteger(index) || index < 0 || index >= favorites.length) return true;
  const entry = favorites[index];
  favorites.splice(index, 1);
  if (!saveFavorites()) { favorites.splice(index, 0, entry); return false; }
  accountSync().queuePush("fav", entry.id);      // 消したことも同期する。しないと別端末から復活する
  favUndo.push({ entry, index });
  renderFavToggle();
  renderSheet();
  return true;
}

// お気に入りはアカウントに紐づくもの。**未ログインでは増やさない。**
// 端末にだけ溜めても、消えるか、あとで混ざるかのどちらかになる。
// すでに端末にあるものは見えるし選べる（消さない）。
/**
 * ログインしていなければ案内して止める。
 * **記録もお気に入りも、サーバーに持つもの**なのでアカウントが要る。
 * 端末のブラウザだけに貯めると、しばらく開かないと消える（iOS は7日）。
 */
function requireLogin(what) {
  if (auth) return true;
  if (confirm(`${what}にはログインが要ります。\n`
    + "ログインすると、他の端末でも同じものが使えます。\n\nいまログインしますか？")) {
    if ($("placeSheet").open) $("placeSheet").close();
    $("authButton").click();
  }
  return false;
}
const requireLoginForFavorites = () => requireLogin("お気に入りの登録");
/// お気に入りの登録・編集を開く。新規はふつう地点カードの地点を雛形にする。
/// `point` を渡すと、その点を雛形にする（ねらうの「どこから重ねるか」。座標そのものに名前を付けて残す。2026-10-01）。
/// `after` は閉じたあとの戻り先（地点の一覧を開き直さず、道具の画面で出し直す。保存なら entry、削除なら null を渡す）
function openFavSheet(index, { point = null, after = null, target = null, replacePoint = false, shooting = false } = {}) {
  if (!requireLoginForFavorites()) return;
  // 新規は、いま見ている地点をそのまま雛形にする。標高は予報の格子から借りる
  // （評価側も place.elevation が無ければ同じ値を使うので、点数は変わらない）。
  const gridElev = bundle?.home.grid.elevation ?? null;
  const base = replacePoint && point ? point : index >= 0 ? favorites[index]
    : point ? point
    : { ...place, elevation: place.elevation ?? gridElev };
  favDraft = { index, ...base, ownerToken:auth?.token, locationScope: AstroNotesTerrain.locationScope(base), phenomena: [...(base.phenomena || [])],
               eyeHeightAGL: base.eyeHeightAGL ?? 1.5, after,
               // 目標の高さは、登録済みならその値、まだなら今ねらうで使っている高さ
               targetHeightM: base.targetHeightM ?? (target !== null ? target : null) };
  // 入力途中で閉じたときに「変えたかどうか」を判定するための元の値。
  favDraft.origin = { name: base.name || "", note: base.note || "",
    terrain: base.terrain || "", phenomena: [...(base.phenomena || [])].join(","),
    eyeHeightAGL: base.eyeHeightAGL ?? 1.5, targetHeightM: favDraft.targetHeightM,
    latitude: base.latitude, longitude: base.longitude };
  $("favSheetTitle").textContent = index >= 0 ? "お気に入りを編集" : "お気に入りに登録";
  $("favName").value = favDraft.name || "";
  $("favNote").value = favDraft.note || "";
  $("favNameErr").hidden = true;
  $("favDuplicateTargets")?.remove();
  // 標高が予報の格子由来なら「推定」と断る。検索結果は町の代表点のことがあり、
  // 実際に立つ場所の標高とはずれる。
  const estimated = index < 0 && !point && place.elevation == null && gridElev != null;
  $("favWhere").textContent = [favDraft.subtitle,
    favDraft.elevation != null ? `標高 ${Math.round(favDraft.elevation*10)/10}m${estimated ? "（推定）" : ""}` : ""]
    .filter(Boolean).join(" ・ ");
  $("favCoord").textContent = `${favDraft.latitude.toFixed(4)}, ${favDraft.longitude.toFixed(4)}`;
  $("favCoordDetails").open = false;
  $("favHeightDetails").open = false;
  $("favOptionalDetails").open = false;
  $("favLocationEdit").hidden = index < 0;
  $("favEye").innerHTML = eyeOptions(favDraft).map(([v, label, m]) =>
    `<option value="${v}"${(favDraft.eyeHeightAGL ?? 1.5) === m ? " selected" : ""}>${esc(label)}</option>`).join("");
  $("favDelete").hidden = index < 0;
  // 目標として開いたら、立って見る場所の項目（地形・立つ高さ・狙う現象）は出さない。値は消さずに持っておく
  $("favTargetBox").hidden = target === null && favDraft.targetHeightM === null;
  $("favTargetH").value = favDraft.targetHeightM !== null ? String(Math.round(favDraft.targetHeightM)) : "";
  $("favStandBox").hidden = $("favPhBox").hidden = target !== null || shooting;
  $("favOptionalDetails").hidden=shooting;
  $("favNote").hidden=shooting;document.querySelector('label[for="favNote"]').hidden=shooting;
  if(shooting)$("favSheetTitle").textContent="撮影地点を登録";
  renderFavPhenomena();
  renderEyeNote();
  showSheet($("favSheet"));
}
// チップは innerHTML で作り直すと、押した瞬間にボタンが消えてフォーカスが飛ぶ。
// 一度だけ描いて、以後は状態だけ書き換える。
function renderFavPhenomena() {
  $("favPhenomena").innerHTML = PHENOMENA_ORDER.map(([id, p]) =>
    `<button type="button" data-p="${id}" aria-pressed="false">${iconFor(id)} ${p.name}</button>`).join("");
  for (const el of $("favPhenomena").querySelectorAll("[data-p]")) {
    el.onclick = () => {
      const i = favDraft.phenomena.indexOf(el.dataset.p);
      if (i >= 0) favDraft.phenomena.splice(i, 1); else favDraft.phenomena.push(el.dataset.p);
      favDraft.phenomena.sort((a, b) => S.PHENOMENA[a].order - S.PHENOMENA[b].order);
      syncFavPhenomena();
    };
  }
  syncFavPhenomena();
}
function syncFavPhenomena() {
  for (const el of $("favPhenomena").querySelectorAll("[data-p]")) {
    const on = favDraft.phenomena.includes(el.dataset.p);
    el.classList.toggle("on", on);
    el.setAttribute("aria-pressed", String(on));
  }
}
// 地面からの目の高さ。**地面の標高とは別の話。**
// 標高は座標から分かるが、その上に何m立っているかは分からない。
// 東京タワーの地面は18mで、メインデッキは+150m。ここを聞かないと、
// 「山に隠れて見えない」と「展望台からなら見える」を取り違える。
const EYE_HEIGHTS = [
  ["", "地面に立って（既定）", 1.5],
  ["car", "車の中から", 1.2],
  ["roof2", "2階・低い展望台", 5],
  ["roof5", "5階建ての屋上", 15],
  ["tower50", "50m ほどの展望台", 50],
  ["tower100", "100m ほどの展望台", 100],
  ["tower150", "150m ほどの展望台", 150],
  ["tower250", "250m ほどの展望台", 250],
  ["tower350", "350m 以上の展望台", 350],
];
/**
 * 立つ高さの選択肢。**その地点に展望台があれば、公表値を先頭に足す。**
 * 「100mほどの展望台」ではなく「メインデッキ 150m」と書けるほうが選びやすいし、
 * 実際の高さがそのまま入る。
 */
function eyeOptions(p) {
  const decks = Array.isArray(p?.decks) ? p.decks : AstroNotesTerrain.decksFor(p?.name) || [];
  const extra = decks.map((d, i) =>
    [`deck${i}`, `${AstroNotesTerrain.deckLabel(d.name, p && p.name)} ${d.aglM}m`, d.aglM]);
  // Keep the actual saved height visible even for renamed places or manual heights.
  const current=p?.eyeHeightAGL;
  if(Number.isFinite(current)&&!extra.some(([, ,m])=>m===current)&&!EYE_HEIGHTS.some(([, ,m])=>m===current))
    extra.push(["saved", `地上から ${current}m（保存する高さ）`, current]);
  // 同じ高さが既定の一覧にもあれば、重複を避ける
  const base = EYE_HEIGHTS.filter(([, , m]) => !extra.some(([, , em]) => em === m));
  return [...extra, ...base];
}

function eyeNote() {
  const m = favDraft.eyeHeightAGL ?? 1.5;
  const ground = favDraft.elevation;
  const display=n=>String(Math.round(n*10)/10);
  if (!Number.isFinite(ground)) return `地上から ${display(m)}m ・ 地面の標高は未取得`;
  return `地上から ${display(m)}m ・ 撮影位置の標高 ${display(ground+m)}m`;
}
function renderEyeNote() { $("favEyeNote").textContent = eyeNote(); }
$("favEye").onchange = () => {
  const found = eyeOptions(favDraft).find(([v]) => v === $("favEye").value);
  favDraft.eyeHeightAGL = found ? found[2] : 1.5;
  renderEyeNote();
};

// 入力途中で閉じたら黙って消える、を避ける。消した登録は戻せるが、打った文字は戻せない。
function favDirty() {
  const o = favDraft.origin;
  return $("favName").value.trim() !== o.name || $("favNote").value.trim() !== o.note
    || (favDraft.terrain || "") !== o.terrain || favDraft.phenomena.join(",") !== o.phenomena
    || (favDraft.eyeHeightAGL ?? 1.5) !== (o.eyeHeightAGL ?? 1.5)
    || favTargetHeight() !== o.targetHeightM
    || favDraft.latitude !== o.latitude || favDraft.longitude !== o.longitude;
}
/// 登録の画面の「重ねる目標の高さ」。欄を出していなければ元の値のまま、空なら持たない
function favTargetHeight() {
  if ($("favTargetBox").hidden) return favDraft.targetHeightM;
  const v = $("favTargetH").value.trim(), n = Number(v);
  return v !== "" && Number.isFinite(n) && n >= 0 && n <= 1000 ? n : null;
}
function closeFavSheet() {
  if (favDirty() && !confirm("入力した内容を破棄しますか？")) return false;
  $("favSheet").close();
  return true;
}
$("favCancel").onclick = () => closeFavSheet();
$("favSheet").addEventListener("cancel", (e) => { e.preventDefault(); closeFavSheet(); });
$("favLocationEdit").onclick = () => {
  if (!favDraft || favDraft.index < 0) return;
  favMapReturn = true;
  $("favSheet").close();
  MapPick.open({ latitude: favDraft.latitude, longitude: favDraft.longitude }, 16);
};
$("mapClose").onclick = () => {
  $("mapSheet").close();
  if (favMapReturn) { favMapReturn = false; showSheet($("favSheet")); }
};
$("mapSheet").addEventListener("cancel", (e) => { e.preventDefault(); $("mapClose").click(); });

// 名前は記録の照合キー（findSighting）でもある。改名で過去の記録を見失わないよう、
// 同じ座標で記録したものだけを新しい名前へ移す。別地点の同名記録は動かさない。
function renameSightings(oldName, newName, lat, lon) {
  if (!oldName || oldName === newName) return 0;
  const near = (a, b) => Math.abs(a - b) < 0.0005;   // 約50m
  let n = 0;
  for (const s of sightings) {
    if (s.placeName === oldName && near(s.latitude, lat) && near(s.longitude, lon)) { s.placeName = newName; n++; }
  }
  if (n) store.set("sorami.sightings", sightings);
  return n;
}

function commitFavorite(approvedNames = null) {
  if(!favDraft || favDraft.ownerToken!==auth?.token)return;
  const name = $("favName").value.trim();
  $("favNameErr").hidden = !!name;
  if (!name) { $("favName").focus(); return; }
  if(!$("favTargetBox").hidden){
    const matches=matchingTargetNames(name,favDraft.index>=0?`fav:${favDraft.id}`:null);
    const signature=JSON.stringify([name,favDraft.latitude,favDraft.longitude,matches.map(t=>t.id)]);
    if(matches.length&&approvedNames!==signature){
      $("favDuplicateTargets")?.remove();const panel=document.createElement('section');panel.id='favDuplicateTargets';panel.className='my-secondary';panel.setAttribute('aria-label','同じ名前の対象を確認');
      const title=document.createElement('p');title.textContent='同じ名前の対象が登録されています。場所を確認してください。';panel.append(title);
      const owner=auth.token,draft=favDraft;
      for(const t of matches){const b=document.createElement('button');b.type='button';b.className='list-item';const n=document.createElement('strong');n.textContent=t.name;const sub=document.createElement('span');sub.className='tiny sub-line';sub.textContent=targetLocationLabel(t);const action=document.createElement('span');action.className='tiny sub-line';action.textContent='この対象を使う';b.append(n,sub,action);b.onclick=()=>{
        if(auth?.token!==owner||favDraft!==draft)return;
        const current=matchingTargetNames($("favName").value,draft.index>=0?`fav:${draft.id}`:null).find(x=>x.id===t.id);if(!current){commitFavorite();return;}
        $("favSheet").close();if(draft.after)draft.after({...current,id:current.favId||current.id,targetKey:current.id,targetHeightM:current.parts?.[0]?.m-current.groundM});
      };panel.append(b);}
      const separate=document.createElement('button');separate.type='button';separate.className='chip';separate.textContent='別の対象として登録する';separate.onclick=()=>{if(auth?.token===owner&&favDraft===draft)commitFavorite(signature);};panel.append(separate);$("favSave").before(panel);panel.scrollIntoView({block:'nearest'});return;
    }
  }
  // **位置ではなくIDで探す。** 編集している間に同期が走ると配列が組み直され、
  // 覚えていた位置が別のお気に入りを指す（調査 C-4）。
  const at = favDraft.index >= 0 ? favorites.findIndex((f) => f.id === favDraft.id) : favorites.findIndex(f => f.id === favDraft.id || AstroNotesTerrain.distanceKm(f.latitude,f.longitude,favDraft.latitude,favDraft.longitude)<0.02);
  const before = at >= 0 ? favorites[at] : null;
  const entry = { ...(before || {}), id: before?.id || favDraft.id, name, subtitle: favDraft.subtitle || "",
    latitude: favDraft.latitude, longitude: favDraft.longitude,
    locationScope: favDraft.locationScope,
    terrain: favDraft.terrain || null, elevation: favDraft.elevation ?? null,
    eyeHeightAGL: favDraft.eyeHeightAGL ?? null, targetHeightM: favTargetHeight() ?? before?.targetHeightM ?? null,
    phenomena: favDraft.phenomena, note: $("favNote").value.trim() };
  if (at >= 0) favorites[at] = entry; else favorites.push(entry);
  if (!saveFavorites()) {
    if (before) favorites[at] = before; else favorites.pop();
    return;   // 入力はそのまま残す。閉じてしまうと打ち直しになる。
  }
  accountSync().queuePush("fav", entry.id);
  const moved = before ? renameSightings(before.name, name, entry.latitude, entry.longitude) : 0;
  $("favSheet").close();
  // 表示中の地点そのものを編集したなら、画面にも反映する。
  // 地形と標高は取りに行くデータ（鉛直分布）ごと変えるので、取り直さないと嘘の点数が残る。
  if (place.id === entry.id) {
    const refetch = place.latitude !== entry.latitude || place.longitude !== entry.longitude
      || (place.terrain || null) !== entry.terrain
      || (place.elevation ?? null) !== entry.elevation
      || (place.eyeHeightAGL ?? 1.5) !== (entry.eyeHeightAGL ?? 1.5);
    place = { ...place, name: entry.name, subtitle: entry.subtitle,
      latitude: entry.latitude, longitude: entry.longitude,
      terrain: entry.terrain, elevation: entry.elevation,
      locationScope: entry.locationScope, eyeHeightAGL: entry.eyeHeightAGL };
    store.set("sorami.place", place);
    if (refetch) { $("placeSheet").close(); load(true); renderFavToggle(); return; }
    $("placeName").textContent = place.name;
  }
  renderFavToggle();
  renderSheet();
  if (moved) $("favNotice").textContent = `${moved}件の記録を新しい名前へ移しました`;
  // 道具の画面（どこから重ねるか・他の目標）から登録したなら、付けた名前で出し直す
  if (favDraft.after) favDraft.after(entry);
}
$("favSave").onclick=()=>commitFavorite();
$("favDelete").onclick = () => {
  // ここもIDで引き直す。同期で位置がずれていると、隣を消してしまう
  if (!removeFavorite(favorites.findIndex((f) => f.id === favDraft.id))) return;
  $("favSheet").close();
  // ねらうから開いていたら、ねらうの画面に残る（地点の一覧は開かない）
  if (favDraft.after) { favDraft.after(null); return; }
  // 取り消しは一覧の上に出る。★ から開いていた場合も、そこへ着地させる。
  if (!$("placeSheet").open) showSheet($("placeSheet"));
};
export {PLACE_PICKERS,almanacPoint,choosePlace,clearFavMapReturn,favDraft,favForPoint,favMapReturn,inheritedPoint,openFavSheet,renameFromAfterFav,renderFavStar,renderPointCard,renderSheet,requireLogin,requireLoginForFavorites,saveFavorites,selectPlace,selectedDay};
