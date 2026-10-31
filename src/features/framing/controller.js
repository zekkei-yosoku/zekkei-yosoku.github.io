// ---------------------------------------------------------------- ねらう（ダイヤモンド／パール）
//
// 目標（富士山・塔・城…）に太陽や月が重なる日と、**その日に見える場所の線**を出す。
// 計算は `astronotes-align.js`。ここは画面だけ。
//
// 線の考え方: 目標までの距離が決まれば見上げ角が決まり、その高度を天体が通る時刻と方位が決まる。
// 観測者は目標から見てその方位の反対側にいる。距離を変えながら解くと線になる。
// Retired shooting-map adapter: old call sites retain coordinates, never create another map.
const AimMap = (() => { let center=null,zoom=14;return {center:()=>center,zoom:()=>zoom,open:(p,z)=>{center=p;if(Number.isFinite(z))zoom=z;},setView:(lat,lon,z)=>{center={latitude:lat,longitude:lon};zoom=z;},redraw(){},setOverlay(){},onPick(){},onDoubleTap(){},attach(){}}; })();

// 逆算の「少しずらす」。半直径きざみ（1 = 直径の半分）。右・上が正。aimFillSelects から読むので aim と一緒に先に置く
const aimShift = { x: 0, y: 0 };
const aim = { target: null, body: AstroNotesBodies.definition(store.get("sorami.aimBody", "sun")) ? store.get("sorami.aimBody", "sun") : "sun", partId: null, limb: "center", matchMode: "overlap", dayMs: null, lines: [], seq: 0,
              spotSeq: 0, spotCache: null, spot: null, preset: null,
              cands: [], candSeq: 0, candPick: null, wantSpot: null,
              // 候補地で見ている側（rise / set）、見え方の図の描き直しの番号、この地点で重なる日（帯）
              candSide: null, lookSeq: 0, fromEvents: [] };

aim.bodySeq = 0; aim.limbsByBody = {};

/// 目標の高さで線の長さが変わる（富士山は150km、避雷針は3km）ので、地図の倍率も合わせる
function aimZoomFor(target, partId) {
  const m = (AstroNotesAlign.partOf(target, partId) || {}).m;
  if (!Number.isFinite(m)) return 9;
  const farKm = AstroNotesAlign.lineRange(m).maxKm;
  const w = $("aimCanvas").clientWidth || 360;
  const mPerPx = 156543 * Math.cos(target.latitude * Math.PI / 180);
  return Math.max(7, Math.min(16, Math.round(Math.log2(mPerPx * w / (1200 * farKm)))));
}

/// その地点の標高（線を解くのに使う）。同じ点は読み直さない
const aimElevCache = new Map();
async function aimElevation(lat, lon) {
  const key = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  if (aimElevCache.has(key)) return aimElevCache.get(key);
  let v = 0;
  // 国土地理院の標高API（その地点で最も精度の高い1m→5m→10mメッシュ）。2026-10-05 まで10mメッシュのタイルz13で、鷺沼北公園の撮影地が約5m低く出ていた
  try { const e = await AstroNotesTerrain.groundElevation(lat, lon); if (Number.isFinite(e)) v = e; } catch { v = 0; }
  aimElevCache.set(key, v);
  return v;
}

/// 自分で置いた目標（ティンカーベルのように、組み込みに無いもの）。端末に憶える
function aimCustomTarget() {
  const c = store.get("sorami.aimCustom", null);
  if (!c || !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude) || !Number.isFinite(c.topM)) return null;
  return { id: "custom", name: c.name || "他の対象",
    latitude: c.latitude, longitude: c.longitude,
    note: `地上 ${Math.round(c.heightM)}m ＋ 地面の標高およそ${Math.round(c.groundM)}m`,
    groundM: c.groundM, parts: [{ id: "tip", name: "てっぺん", m: c.topM }] };
}
/// 目標として登録したお気に入り（高さつき）。題名のプルダウンの「お気に入り」に並べる
/// （2026-10-01 ユーザー「お気に入りに入れたやつは保存しておいてプルダウンに表示するようにしたら。そのお気に入りはちゃんと消したりできるように」）。
/// 消すのは、選んだときに出るカードの ★ →「お気に入りから外す」（地点の画面のお気に入りの ✕ でも消える）
const aimFavTargets = () => favorites.filter((f) => Number.isFinite(f.targetHeightM));
// ---------------------------------------------------------------- 対象のカテゴリ（2026-10-21）
//
// ユーザー「対象は建物なのか山なのかカテゴリ分けできたらいい。カテゴリなしもあっていい。ユーザーがカテゴリ作れてカスタマイズできたら」。
// 山・建物は最初からある（組み込みの対象は富士山が山、ほかは建物）。自分の対象には、そのどちらか・自分で作ったカテゴリ・なしを付ける。
// 付けたカテゴリはお気に入りの本文（targetCategory）に入れるので、ほかの端末へも同期される（API は本文を中身を見ずに保存する）。
// 自分で作ったカテゴリの一覧はこの端末に持ち、ほかの端末では対象に付いているカテゴリから集める（中身の無いカテゴリはこの端末だけ）
const TARGET_FIXED_CATEGORIES = ["山", "建物"];
function targetCategoryOf(t) {
  if (t.favId) return favorites.find((f) => f.id === t.favId)?.targetCategory || "";
  if (AstroNotesAlign.targetById(t.id)) return t.id === "fuji" ? "山" : "建物";
  return "";
}
function targetUserCategories() {
  const raw = store.get("sorami.targetCategories", []);
  const mine = (Array.isArray(raw) ? raw : []).filter((c) => typeof c === "string" && c && c.length <= 20 && !TARGET_FIXED_CATEGORIES.includes(c));
  for (const f of favorites) {
    const c = f.targetCategory;
    if (c && !TARGET_FIXED_CATEGORIES.includes(c) && !mine.includes(c)) mine.push(c);
  }
  return mine;
}
const targetCategoryList = () => [...TARGET_FIXED_CATEGORIES, ...targetUserCategories()];
/// カテゴリを作る・名前を変える・削除する。名前を変える・削除するときは、そのカテゴリの対象も直して同期する
function editTargetCategory(op, name, next) {
  let mine = targetUserCategories();
  if (op === "add" && !mine.includes(name)) mine.push(name);
  if (op === "rename") mine = mine.map((c) => (c === name ? next : c));
  if (op === "remove") mine = mine.filter((c) => c !== name);
  store.set("sorami.targetCategories", mine);
  if (op === "add") return;
  const changed = favorites.filter((f) => f.targetCategory === name);
  if (!changed.length) return;
  const nextFavs = favorites.map((f) => (f.targetCategory === name ? { ...f, targetCategory: op === "rename" ? next : null } : f));
  AstroNotesLibrary.transaction(localStorage, [["sorami.favorites", nextFavs]]);
  favorites = nextFavs;
  for (const f of changed) accountSync().queuePush("fav", f.id);
  renderSheet();
  globalThis.MyPlacesUI?.renderRecordsHub?.();
}

function aimFavTarget(f) {
  const ground = Number.isFinite(f.elevation) ? f.elevation : 0;
  return { id: `fav:${f.id}`, favId: f.id, name: f.name, latitude: f.latitude, longitude: f.longitude, groundM: ground,
    parts: [{ id: "tip", name: "てっぺん", m: ground + f.targetHeightM }] };
}
/// いま選んでいる他の目標・お気に入りの目標の中身（カードに出す形）。どちらでもなければ null
function aimTargetInfo() {
  const v = $("aimTarget").value;
  if (v.startsWith("fav:")) {
    const f = favorites.find((x) => `fav:${x.id}` === v);
    return f ? { fav: f, name: f.name, subtitle: aimAreaOf({ detail: f.subtitle }) || f.subtitle,
      latitude: f.latitude, longitude: f.longitude, groundM: Number.isFinite(f.elevation) ? f.elevation : 0, heightM: f.targetHeightM } : null;
  }
  return v === "custom" ? store.get("sorami.aimCustom", null) : null;
}
/// 高さを直した目標。避雷針の先端のように**公表値が無いもの**は、端末に憶えた値を使う
function aimWithHeights(t) {
  const hs = store.get("sorami.aimHeights", {});
  if (!(t.parts || []).some((p) => p.adjustable)) return t;
  return { ...t, parts: t.parts.map((p) => {
    const m = p.adjustable ? Number(hs[`${t.id}:${p.id}`]) : NaN;
    return Number.isFinite(m) ? { ...p, m } : p;
  }) };
}
const targetNameKey = AstroNotesLibrary.nameKey;
function matchingTargetNames(name, excludeId = null) { return AstroNotesLibrary.matchingNames(aimTargetList(),name,excludeId); }
function persistTargetDraft(draft){
 if(!auth?.token)throw Error('ログインしてから登録してください');
 const next=AstroNotesLibrary.applyDrafts(favorites,[draft]);
 AstroNotesLibrary.transaction(localStorage,[['sorami.favorites',next]]);favorites=next;accountSync().queuePush('fav',draft.entry.id);renderSheet();globalThis.MyPlacesUI?.renderRecordsHub?.();
}
// 対象の行の補足は住所（2026-10-21 ユーザー「組み込みはいらない。座標じゃなくて住所が出てほしい」）。
// 組み込みの対象の住所は国土地理院の逆ジオコーダ（LonLatToAddress と市区町村コード表 muni.js、2026-10-21 取得）。
// 富士山の山頂は市町村の境が決まっていないので県だけ。自分の対象は登録したときの住所、無ければ座標
const TARGET_ADDRESSES = {
  fuji: "静岡県・山梨県", skytree: "東京都墨田区押上一丁目", tokyotower: "東京都港区芝公園四丁目",
  "tocho-building": "東京都新宿区西新宿二丁目", "shibuya-sky": "東京都渋谷区渋谷二丁目", "azabudai-hills": "東京都港区麻布台一丁目",
  "kabukicho-tower": "東京都新宿区歌舞伎町一丁目", "tower-terror": "千葉県浦安市舞浜", cinderella: "千葉県浦安市舞浜", tinkerbell: "千葉県浦安市舞浜",
};
const targetLocationLabel = (t) => {
  if (TARGET_ADDRESSES[t.id]) return TARGET_ADDRESSES[t.id];
  const sub = (t.favId ? favorites.find((f) => f.id === t.favId)?.subtitle : t.subtitle) || "";
  if (sub && !/^(緯度経度|地図で選んだ)/.test(sub)) return sub;
  return Number.isFinite(t.latitude) && Number.isFinite(t.longitude) ? `${t.latitude.toFixed(5)}, ${t.longitude.toFixed(5)}` : "";
};
function aimTargetList() {
  const custom = aimCustomTarget();
  // 富士山も同じ一覧の先頭に置く（2026-10-01「天体を重ねる」にまとめた）。**許可のある目標だけ出す**:
  // 富士山はダイヤモンド富士かパール富士、そのほか（塔・他の目標）は tower。どれも無い（URL を直接開いた）ときは全部
  const fujiOk = toolAllowed("diamond") || toolAllowed("pearl"), towerOk = toolAllowed("tower");
  const all = !fujiOk && !towerOk;
  return [...(aim.sharedTarget && !AstroNotesAlign.targetById(aim.sharedTarget.id) ? [aim.sharedTarget] : []), ...AstroNotesAlign.TARGETS.filter((t) => (t.id === "fuji" ? fujiOk : towerOk) || all).map(t => aim.sharedTarget?.id === t.id ? aim.sharedTarget : aimWithHeights(t)),
    ...(towerOk || all ? [...aimFavTargets().map(aimFavTarget), custom || { id: "custom", name: "他の対象", parts: [] }] : [])];
}
function aimFillSelects() {
  // 他の目標（2026-10-01 に「自分で置く」から改名。ユーザーが候補から選んだ）は、一覧では「他の目標（◯◯）」。題名の枠には◯◯（場所の名前）だけ
  const custom = aimCustomTarget();
  // 作り直しても選んでいたものは残す（他の目標を置き直すたびに、合わせ方が最初の選択肢へ戻っていた）
  // 作り直すときは今の値（解除した "" も）を残す。初めて作るときは保存した値、無ければ富士山（解除した人は "" が保存されている）
  const keep = { target: $("aimTarget").options.length ? $("aimTarget").value : $("aimTarget").value || store.get("sorami.aimTarget", "fuji"), limb: aimLimbValue() };
  const list = aimTargetList();
  const opt = (t) => `<option value="${esc(t.id)}">${esc(t.id === "custom" ? (custom ? `他の対象（${t.name}）` : "他の対象") : t.name)}</option>`;
  const favs = list.filter((t) => t.favId);
  // 先頭は未選択（2026-10-21 ユーザー「構図と地図で選択を解除のボタンの有無の差異がある」→ 構図も対象を外せる）
  $("aimTarget").innerHTML = `<option value="">対象を選ぶ</option>` + list.filter((t) => !t.favId && t.id !== "custom").map(opt).join("")
    + (favs.length ? `<optgroup label="自分の対象">${favs.map(opt).join("")}</optgroup>` : "")
    + list.filter((t) => t.id === "custom").map(opt).join("");
  $("aimTarget").value = keep.target || "";
  // 許可が変わって前の目標が一覧から消えたら、未選択へ（対象を選ぶまで線・候補・見え方は出さない）
  if ($("aimTarget").selectedIndex < 0) $("aimTarget").value = "";
  // どこに重ねるかの釦。名前は山も塔も同じで、図だけ目標の形（山は台形・塔は縦線）にする
  const sel = list.find((t) => t.id === $("aimTarget").value);
  const mountain = !!sel && aimIsMountain(sel);
  const cur = AstroNotesBodies.definition(aim.body).limbs ? (keep.limb || aim.limb || AstroNotesAlign.LIMBS[0].id) : "center";
  $("aimLimb").innerHTML = (AstroNotesBodies.definition(aim.body).limbs ? AstroNotesAlign.LIMBS : AstroNotesAlign.LIMBS.filter(l => l.id === "center")).map((l) => `<button type="button" data-limb="${l.id}" aria-pressed="${l.id === cur && aim.matchMode !== 'overlap'}"`
    + ` ${!AstroNotesBodies.definition(aim.body).limbs ? "disabled" : ""} aria-label="${esc(aimLimbSay(l.id, mountain))}">${aimLimbFigure(l.sign, mountain, `aimLimbMask-${l.id}`)}<span>${esc(l.name)}</span></button>`).join("");
  if (typeof aimShiftSync === "function") aimShiftSync();
}
/// いま押している合わせ方
const aimLimbValue = () => ($("aimLimb").querySelector('[aria-pressed="true"]') || {}).dataset?.limb || "";
/// 読み上げる説明（画面では図が言う）
function aimLimbSay(id, mountain, body = aim.body) {
  const b = AstroNotesBodies.definition(body).name;
  return id === "onTop" ? `下の縁：${b}がてっぺんに乗る`
    : id === "center" ? `真ん中：てっぺんが${b}の真ん中`
    : mountain ? `上の縁：${b}が山の裏へ沈む・山の裏から昇る瞬間` : `上の縁：てっぺんが${b}の上の縁`;
}
/// 図（40×28）。円が太陽・月、山は台形・塔は細い尖塔（縦線だけだと地点の印に見えた）。目標の手前にある所は円を描かない（mask）。
/// 山の裏に入った円は点線の輪郭だけ（上の縁＝沈みきる・出始める瞬間）
function aimLimbFigure(sign, mountain, maskId) {
  const r = 6, tipY = 13, cy = tipY - sign * r;
  const shape = mountain ? `M2 28 L15 ${tipY} H25 L38 28 Z` : `M16.5 28 L20 ${tipY} L23.5 28 Z`;
  return `<svg viewBox="0 0 40 28" width="40" height="28" aria-hidden="true">`
    + `<defs><mask id="${maskId}"><rect width="40" height="28" fill="#fff"/>`
    + `<path d="${shape}" fill="#000" stroke="#000" stroke-width="${mountain ? 0 : 1.5}"/></mask></defs>`
    + `<circle cx="20" cy="${cy}" r="${r}" fill="currentColor" mask="url(#${maskId})"/>`
    + `<path d="${shape}" fill="currentColor" opacity="${mountain ? 0.4 : 0.55}"/>`
    + (mountain && sign < 0 ? `<circle cx="20" cy="${cy}" r="${r - 0.75}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 2"/>` : "")
    + `</svg>`;
}
/// 山（地面そのものが目標）か。富士山と、地上の高さが 0m の目標（羊蹄山など。てっぺんの高さ＝地面の標高）
const aimIsMountain = (t) => !!t && (t.id === "fuji"
  || (Number.isFinite(t.groundM) && (t.parts || []).length === 1 && Math.abs(t.parts[0].m - t.groundM) < 0.5));
/// 天体で言い方を変える。**月に「日の入側」と書かない**
const aimSideLabel = (side) => (!AstroNotesBodies.definition(aim.body).limbs ? (side === "set" ? "沈む側" : "昇る側") : aim.body === "moon"
  ? (side === "set" ? "月の入側" : "月の出側")
  : (side === "set" ? "日の入側" : "日の出側"));

function aimFillParts() {
  // 新しく選ぶ建物・像は全体を既定にする。手動選択と共有・履歴の復元は保持する。
  const targetKey = `${aim.target.id}:${aim.target.latitude}:${aim.target.longitude}`;
  if (aim.partsTargetKey && aim.partsTargetKey !== targetKey && !aim.pendingPlan) aim.partId = null;
  aim.partsTargetKey = targetKey;
  const parts = aim.target.parts || [];
  // 高さは**地上から**で出す（スカイツリーの先端は 634m。計算に使う m は海面から＝636m。2026-10-01 ユーザー指摘）
  const g = aim.target.groundM || 0;
  const whole = parts.length > 0 && !aimIsMountain(aim.target);
  $("aimPart").innerHTML = parts.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} ${Math.round(p.m - g)}m</option>`).join("") + (whole ? `<option value="__whole">${esc(aim.target.wholeLabel || '建物全体に重なる')}</option>` : "");
  $("aimPart").disabled = parts.length + (whole ? 1 : 0) < 2;
  // 選べるものが1つしか無い（富士山の山頂など）なら、選ぶ欄を出さない
  $("aimPart").hidden = parts.length + (whole ? 1 : 0) < 2;
  $("aimPartRow").hidden = parts.length + (whole ? 1 : 0) < 2;
  if (!(whole && aim.partId === "__whole") && !parts.some((p) => p.id === aim.partId)) aim.partId = whole ? "__whole" : (parts[0] ? parts[0].id : null);
  $("aimPart").value = aim.partId || "";
  $("aimLimb").hidden = aim.partId === "__whole";
}

/// 近い目標は1km未満から始まるので、小さい値は小数で書く
const aimKm = (km) => (km < 10 ? Math.round(km * 10) / 10 : Math.round(km));

/// 線を引き直す。地図の重ね描きは、線の点を結ぶだけ
async function aimRedrawLine() {
  aim.lines=[];aim.cands=[];aim.candBusy=false;$("aimLineInfo").textContent="";$("aimLineTable").hidden=true;$("aimLineTable").innerHTML="";return;
  // Historical implementation retained for rollback; no map/line discovery is run.

  const key = JSON.stringify([aim.target, aim.body, aim.dayMs, aim.partId, aim.limb, AstroNotesAtmosphere.dataKey()]);
  if (aim.lineWork?.key === key && aim.lineWork.seq === aim.seq && Date.now() < aim.lineWork.until) {
    // 再タップで候補選択が解除されても、同じ線/見通しを解き直さない。
    if (aim.wantSpot && !aim.candBusy) {
      const want = (aim.cands || []).findIndex(c => c.place.id === aim.wantSpot);
      aim.wantSpot = null; aim.wantKey = null; aim.candPick = want >= 0 ? want : null;
      aimUpdateLook();
    }
    aimRenderCands(); AimMap.redraw();
    return aim.lineWork.promise;
  }
  const work = { key, until: Infinity, promise: null };
  aim.lineWork = work;
  work.promise = (async () => {
  const seq = ++aim.seq; work.seq = seq;
  $("aimLineInfo").textContent = "線を計算しています…";
  $("aimLineTable").hidden = true;
  $("aimLineTable").querySelector("tbody").innerHTML = "";
  // **前の線の候補地を残さない。** 線を解き直す数秒のあいだ、前の画面（ダイヤモンド富士）の候補が
  // 新しい見出し（パール富士）の下に見えていた（2026-10-01 本番で確認）。探している途中の計算も捨てる
  aim.candSeq++;
  // 合わせ方・高さだけを替えたとき（同じ目標・天体・日）は、選んでいた候補地が新しい候補にもあれば選び直す
  // （図が観測地点へ飛んで戻らないように。日付を替えたときは選び直さない）
  const keyNow = `${aim.target.id}|${aim.body}|${aim.dayMs}`;
  const was = aim.candPick !== null ? (aim.cands || [])[aim.candPick] : null;
  // 選び直しを待っている間に日付・天体・目標を替えたら、その待ちは捨てる（Codex の点検: 別の日に持ち越していた）。
  // 定番スポットから来た待ち（wantKey なし）は日付を替えて来るので捨てない
  if (aim.wantKey && aim.wantKey !== keyNow) { aim.wantSpot = null; aim.wantKey = null; }
  if (was && !aim.wantSpot && aim.candKey === keyNow) { aim.wantSpot = was.place.id; aim.wantKey = keyNow; }
  aim.candKey = keyNow;
  aim.cands = []; aim.candPick = null;
  $("aimCandList").innerHTML = ""; $("aimSideSeg").innerHTML = "";
  $("aimCandInfo").textContent = "候補地を探しています…";
  aim.candBusy = true; aimRefreshSheetCands();
  aim.lines = [];
  AimMap.redraw();
  let lines = [];
  try {
    lines = await AstroNotesAlign.line(aim.target, aim.body, aim.dayMs,
      { partId: aim.partId, limb: aim.limb, elevationAt: aimElevation, isCurrent: () => seq === aim.seq });
  } catch {
    if (seq !== aim.seq) return;
    if (aim.lineWork === work) aim.lineWork = null;
    $("aimLineInfo").textContent = "線を計算できませんでした。条件を選び直して再試行してください。";
    $("aimCandInfo").textContent = "";
    aim.candBusy = false; aimRefreshSheetCands();
    return;
  }
  if (seq !== aim.seq) return;
  aim.lines = lines;
  AimMap.redraw();
  aimFindCandidates();
  if (!lines.length) {
    $("aimLineInfo").textContent = "この日は、どこからも重なりません。";
    $("aimLineTable").hidden = true;
    return;
  }
  // 説明の文は出さない（2026-09-30）。月の輝面も出さない（見え方の図の上の行と重なる。2026-10-03 ユーザーが選んだ「いらない説明文」）
  $("aimLineInfo").textContent = "";
  $("aimLineTable").hidden = false;
  $("aimLineTable").querySelector("tbody").innerHTML = lines.map((l) => {
    const first = l.points[0], last = l.points[l.points.length - 1];
    // 近い側と遠い側で時刻の前後が入れ替わる。早い方から書く
    const t0 = Math.min(first.at, last.at), t1 = Math.max(first.at, last.at);
    const a0 = Math.round(Math.min(first.azimuth, last.azimuth));
    const a1 = Math.round(Math.max(first.azimuth, last.azimuth));
    return `<tr><td><i class="k ${l.side === "rise" ? "rise" : ""}"></i>${esc(aimSideLabel(l.side))}</td>
      <td>${aimKm(first.distanceKm)}〜${aimKm(last.distanceKm)}km</td>
      <td>${S.JstCal.hhmm(t0)}〜${S.JstCal.hhmm(t1)}</td>
      <td>${a0}°〜${a1}°</td></tr>`;
  }).join("");

  })().finally(() => { work.until = Date.now() + 300000; });
  return work.promise;
}

/// 地図の線。**中心（目標）から伸びる光線**として描く。
/// 目標に印が無いと、どの線がどこを向いているのかが読めない。
/// 解いた区間（観測点の並び）は太く光らせ、そこへ届くまでと反対側は細く薄く。
/// 距離の目盛りを打つのは、地図の上で「目標から何kmか」が読めないと場所を選べないため。
function aimFitLines(lines) {
 const points=[aim.target,...lines.flatMap(l=>l.points)].filter(p=>Number.isFinite(p?.latitude)&&Number.isFinite(p?.longitude));
 if(points.length<2)return;
 const lat0=Math.min(...points.map(p=>p.latitude)),lat1=Math.max(...points.map(p=>p.latitude)),lon0=Math.min(...points.map(p=>p.longitude)),lon1=Math.max(...points.map(p=>p.longitude)),lat=(lat0+lat1)/2,lon=(lon0+lon1)/2,cv=$('aimCanvas');
 const dx=Math.max(.00001,(lon1-lon0)/360),dy=Math.max(.00001,(lat1-lat0)/(360*Math.cos(lat*Math.PI/180))),zoom=Math.min(Math.log2(Math.max(160,cv.clientWidth)*.75/(256*dx)),Math.log2(Math.max(200,cv.clientHeight)*.75/(256*dy)));
 AimMap.setView(lat,lon,zoom);
}
// 計算済みの点列の中だけで時刻を補間する。折り返しは複数地点を返す。
function aimLineAtTime(points, at) {
  if (!Number.isFinite(at)) return [];
  const found=[];
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i];
    if(!Number.isFinite(a.at)||!Number.isFinite(b.at)||at<Math.min(a.at,b.at)||at>Math.max(a.at,b.at))continue;
    if(a.at===b.at)continue;
    const f=(at-a.at)/(b.at-a.at),p={latitude:a.latitude+(b.latitude-a.latitude)*f,longitude:a.longitude+(b.longitude-a.longitude)*f};
    if(!found.some(q=>Math.abs(q.latitude-p.latitude)+Math.abs(q.longitude-p.longitude)<1e-9))found.push(p);
  }
  return found;
}
AimMap.setOverlay((ctx, { project, width, height }) => {
  const t = aim.target;
  if (!t || !Number.isFinite(t.latitude)) return;
  const cs = getComputedStyle(document.documentElement);
  // **色は :root のトークンから取る。** 生の16進を置かない（デザイン定義）
  const color = (cs.getPropertyValue(aim.body === "moon" ? "--ray-moon" : "--ray-sun").trim())
    || "#e8820e";
  const [cx, cy] = project(t.latitude, t.longitude);
  const ink = "rgba(0,0,0,.55)";

  for (const l of aim.lines || []) {
    const pts = l.points.map((p) => project(p.latitude, p.longitude));
    const far = pts[pts.length - 1], near = pts[0];
    const farPt = l.points[l.points.length - 1];
    // 日の出側は破線。**同じ色のまま線種で分ける**ので、配色を増やさない
    const dash = l.side === "set" ? [] : [11, 7];
    ctx.save();
    ctx.lineJoin = "round"; ctx.lineCap = "round";

    // 目標から線の手前まで（近すぎて解かない区間）は細く。
    // **目標を挟んだ反対側には引かない。** 反対側はもう一方の線（出／入）が占めていて、
    // 補助の点線を足すと、どちらが観測点の並びなのか読めなくなる。
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1.5; ctx.strokeStyle = color;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(near[0], near[1]); ctx.stroke();
    ctx.globalAlpha = 1;

    // 観測点の並び。地図の地から浮かせるため、暗い縁取り → 光 → 芯 の順に重ねる
    const path = () => { ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); };
    ctx.setLineDash(dash);
    ctx.strokeStyle = ink; ctx.lineWidth = 5.5; path(); ctx.stroke();
    ctx.globalAlpha = 0.35; ctx.strokeStyle = color; ctx.lineWidth = 7; path(); ctx.stroke();
    ctx.globalAlpha = 0.5; ctx.strokeStyle = color; ctx.lineWidth = 2.2; path(); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);

    // 距離の目盛り。線に直交する短い棒を、切りのよい距離に打つ
    for (const km of aimTicks(l.points[0].distanceKm, farPt.distanceKm)) {
      const i = l.points.findIndex((p) => p.distanceKm >= km);
      if (i <= 0) continue;
      const [x, y] = pts[i], [px, py] = pts[i - 1];
      const dx = x - px, dy = y - py, n = Math.hypot(dx, dy) || 1;
      ctx.strokeStyle = ink; ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(x - dy / n * 7, y + dx / n * 7); ctx.lineTo(x + dy / n * 7, y - dx / n * 7);
      ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = 2.2; ctx.stroke();
    }

    // 遠い端に印だけ。**数字は地図に載せない**（線の上に時刻や方位を並べると読めなくなる。
    // 側ごとの時刻・方位・距離は地図の下の表に、いま見ている場所の値は中心の行に出す）
    ctx.beginPath(); ctx.arc(far[0], far[1], 4, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = ink; ctx.stroke();
    ctx.restore();
  }

  // いまの時刻に対応する計算済み区間上の撮影位置。区間外は描かない。
  const timeState=aim.mapTime;
  if(timeState&&timeState.day===aim.dayMs&&timeState.body===aim.body&&timeState.target===t.id){
    for(const line of aim.lines||[])for(const p of aimLineAtTime(line.points,timeState.at)){
      const [x,y]=project(p.latitude,p.longitude);
      ctx.save();ctx.setLineDash(line.side==='rise'?[7,5]:[]);ctx.strokeStyle=ink;ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(x,y);ctx.stroke();ctx.strokeStyle=color;ctx.lineWidth=2.5;ctx.stroke();ctx.setLineDash([]);
      ctx.beginPath();ctx.arc(x,y,9,0,Math.PI*2);ctx.fillStyle=ink;ctx.fill();ctx.beginPath();ctx.arc(x,y,6,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
      aimMapLabel(ctx,x,y-16,`${aimSideLabel(line.side)} ${aimLookHMS(timeState.at)}`,'#fff',width,height,'center');ctx.restore();
    }
  }

  // この日の候補地。一覧と同じ番号を、**立つ位置**に振る。選んだものは大きく。日の出／日の入の切り替えで選んでいる側だけ
  (aim.cands || []).map((c, i) => ({ c, i })).filter((x) => !aim.candSide || x.c.side === aim.candSide).forEach(({ c, i }, k) => {
    const sp = { latitude: c.stand.latitude, longitude: c.stand.longitude, name: aimCandName(c) };
    const [x, y] = project(sp.latitude, sp.longitude);
    const on = aim.candPick === i;
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, on ? 10 : 8, 0, Math.PI * 2);
    ctx.fillStyle = ink; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, on ? 8 : 6, 0, Math.PI * 2);
    ctx.fillStyle = "#fff"; ctx.fill();
    ctx.fillStyle = "#111";
    ctx.font = `700 ${on ? 11 : 9}px -apple-system, 'Hiragino Sans', sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(String(k + 1), x, y + 0.5);
    if (on) aimMapLabel(ctx, x, y - 16, sp.name, "#fff", width, height, "center");
    ctx.restore();
  });

  // 確定した見え方になる場所（見え方の図で円盤を動かして確定したもの）。線は距離ごとの解、丸はいま見ている図の場所
  const rv = aim.reverse;
  if (rv && rv.points.length) {
    const rc = cs.getPropertyValue("--accent").trim() || "#2a7de1";
    const rp = rv.points.map((p) => project(p.latitude, p.longitude));
    ctx.save();
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    if (rp.length > 1) {
      const trace = () => { ctx.beginPath(); rp.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); };
      ctx.strokeStyle = ink; ctx.lineWidth = 7; trace(); ctx.stroke();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 4; trace(); ctx.stroke();
      ctx.strokeStyle = rc; ctx.lineWidth = 2; trace(); ctx.stroke();
      const e0 = rp[0], e1 = rp[rp.length - 1];
      aimMapLabel(ctx, e0[0], e0[1] + 14, `${aimKm(rv.points[0].distanceKm)}km`, "#fff", width, height, "center");
      aimMapLabel(ctx, e1[0], e1[1] + 14, `${aimKm(rv.points[rv.points.length - 1].distanceKm)}km`, "#fff", width, height, "center");
    }
    const [qx, qy] = project(rv.at.latitude, rv.at.longitude);
    ctx.beginPath(); ctx.arc(qx, qy, 9, 0, Math.PI * 2); ctx.fillStyle = ink; ctx.fill();
    ctx.beginPath(); ctx.arc(qx, qy, 6.5, 0, Math.PI * 2); ctx.fillStyle = rc; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
    aimMapLabel(ctx, qx, qy - 17, `撮れる場所 ${S.JstCal.hhmm(rv.at.at)}`, "#fff", width, height, "center");
    ctx.restore();
  }

  // 観測地点。どこから見た日なのかを地図でも分かるように、白い縁の点＋名前
  const fromPt = aimFromPoint();
  if (fromPt) {
    const [fx, fy] = project(fromPt.latitude, fromPt.longitude);
    ctx.save();
    ctx.beginPath(); ctx.arc(fx, fy, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = ink; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
    aimMapLabel(ctx, fx, fy + 15, fromPt.name, "#fff", width, height, "center");
    ctx.restore();
  }

  // 目標の印は線の上に置く。二重丸＋名前
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, 7.5, 0, Math.PI * 2);
  ctx.fillStyle = ink; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fillStyle = color; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
  aimMapLabel(ctx, cx, cy + 16, t.name, "#fff", width, height, "center");
  ctx.restore();
});

/// 目盛りを打つ距離。1・2・5 の刻みから、線の長さに合うものを選ぶ
function aimTicks(nearKm, farKm) {
  const steps = [0.5, 1, 2, 5, 10, 20, 50, 100];
  const step = steps.find((v) => (farKm - nearKm) / v <= 6) || 100;
  const out = [];
  for (let km = Math.ceil(nearKm / step) * step; km <= farKm; km += step) out.push(km);
  return out;
}

/// 地図に乗せる短い文字。地の色が分からないので、暗い座布団を敷く
function aimMapLabel(ctx, x, y, text, color, width, height, place = "right") {
  if (!text) return;
  ctx.save();
  ctx.font = "700 11px -apple-system, 'Hiragino Sans', sans-serif";
  const w = ctx.measureText(text).width + 10, h = 18;
  let lx = place === "center" ? x - w / 2 : place === "left" ? x - 8 - w : x + 8;
  let ly = y - h / 2;
  lx = Math.max(2, Math.min(width - w - 2, lx));
  ly = Math.max(2, Math.min(height - h - 2, ly));
  ctx.fillStyle = "rgba(0,0,0,.66)";
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(lx, ly, w, h, 5); else ctx.rect(lx, ly, w, h);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, lx + 5, ly + h / 2 + 0.5);
  ctx.restore();
}

/// 地図の中心が線からどれだけ離れているか。**動かしながら合わせる**ための数字
