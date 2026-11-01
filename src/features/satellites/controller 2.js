import {$,S,esc} from '../../app/presentation-helpers.js';
import {store,viewState} from '../../app/browser-state.js';
import {lightTimingText,moonGlyphAt} from '../forecast/view.js';
import {routeFromHash} from '../../app/navigation.js';
import {inheritedPoint,renderPointCard} from '../places/controller.js';
import {createMapView} from '../../ui/map/picker.js';
import {AimMap,aim,aimCustomTarget,aimFavTarget,aimFavTargets,aimFillParts,aimFillSelects,aimIsMountain,aimLimbValue,aimMapLabel,aimRedrawLine,aimSideLabel,aimWithHeights,aimZoomFor} from '../framing/controller.js';
import {PlaneMap} from '../aircraft/controller.js';
import {aimFromPoint,aimRenderFrom,aimRenderSelectedPoint,aimRenderTargetCard,candidateWaitMarkup} from '../framing/observer.js';
import {aimCandidateAccessible,aimCandidateSiteSupported,aimPlaces,aimRefreshSheetCands,aimSideName} from '../framing/candidates.js';
import {aimAirEnsure,aimMapView,aimTitleFor} from '../framing/reverse-and-entry.js';
import {openPlaceSheet,placeIndex} from '../../services/place-search.js';
import {renderToolAccess,screenAllowed,toolAllowed} from '../account/session-and-access.js';
import {showSheet} from '../../app/overlays.js';
// ---------------------------------------------------------------- 人工衛星（旧 ISS の月面通過）
//
// 衛星の位置は CelesTrak の軌道要素（TLE）を SGP4（satellite.js）で進める。
// 軌道要素は日に数回更新され、宇宙ステーションはときどき高度を上げるので、**先の日ほど外れる**。
// 7日先まで出し、3日より先には「目安」と付ける。
// 2026-10-21 ユーザー「ISSを衛星を探す系のページにしたい」。ISS 専用だったのは取ってくる衛星番号だけなので、
// 衛星を選べるようにし、空を横切る「通過」の表示を足した。道・権限ID・保存キー（sorami.iss*）は互換のため変えない。
const ISS_PRESETS = [[25544, "ISS（国際宇宙ステーション）"], [48274, "天宮（中国の宇宙ステーション）"], [20580, "ハッブル宇宙望遠鏡"]];
const iss = { body: "moon", rangeKm: 150, sat: null, tle: null, result: [], pick: 0, seq: 0, wired: false,
              from: null,   // 探す範囲の中心。null ならAstroNotesの地点を引き継ぐ（ねらうと同じ。2026-10-01）
              tab: "pass", catnr: Number(store.get("sorami.issSat", 25544)) || 25544,
              extra: store.get("sorami.issSatExtra", null),   // 「衛星を選ぶ」で選んだ、よく見る3機以外の衛星 { catnr, name（CelesTrak の名前） }
              names: null,   // 番号→{ ja, en, alias }（data/satellite-names-ja.json）
              passes: [], passPick: 0, showAll: false, track: [] };
/// 選んでいる衛星の呼び名
function issSatName() {
  const p = ISS_PRESETS.find(([n]) => n === iss.catnr);
  if (p) return p[1].replace(/（.*）$/, "");
  const w = iss.names && iss.names.get(iss.catnr);
  if (w) return w.ja;
  return iss.extra && iss.extra.catnr === iss.catnr ? iss.extra.name : `衛星 ${iss.catnr}`;
}
/// 衛星のカード: 日本語名（無ければ CelesTrak の英語名）と、英語名・衛星番号
function issRenderSatCard() {
  const p = ISS_PRESETS.find(([n]) => n === iss.catnr);
  const w = iss.names && iss.names.get(iss.catnr);
  const ex = iss.extra && iss.extra.catnr === iss.catnr ? iss.extra : null;
  $("issSatName").textContent = p ? p[1] : w ? w.ja : ex ? ex.name : `衛星 ${iss.catnr}`;
  const en = (ex && ex.name) || (w && w.en) || "";
  $("issSatSub").textContent = [p || w ? en : "", `衛星番号 ${iss.catnr}`].filter(Boolean).join(" ・ ");
}
/// ISS の探す範囲の中心。替えていなければAstroNotesの地点。**観測地点ではない**（立つ場所は回ごとに帯の中から選ぶ）
function issFromPoint() { return iss.from || inheritedPoint(); }
function issSetFrom(p) {
  iss.from = p ? { name: p.name, subtitle: p.subtitle || "", latitude: p.latitude, longitude: p.longitude } : null;
  // 地図も新しい中心へ（帯はその近くに出る）
  const P = issFromPoint();
  IssMap.open({ latitude: P.latitude, longitude: P.longitude }, iss.tab === "pass" ? 5 : 8);
  // 「今夜見える」は前の地点で解いたものなので消す
  issPick.visSeq++; issPick.visible = null;
  issApply();
}
const IssMap = createMapView({ canvas: "issCanvas", zoomIn: "issIn", zoomOut: "issOut" });

// ---------------------------------------------------------------- ピンの位置を、ほかの地図アプリへ（2026-10-02）
//
// ユーザー「撮影ポイントをピンポイントに知りたい場合、詳細な緯度経度が欲しい」「他のMAPアプリに飛ばしたりとかってできるの？」
// →「座標コピーのボタンと、地図アプリで開くのボタン。押したら端末の標準か Google か Apple かを選ばせ、選んだアプリを常に使うか聞く。よくある仕様に」。
// 座標は小数第5位（約1m）。国土地理院の座標と Google・Apple の座標のずれは1m未満。
// 選べるアプリは端末で変わる: iPhone・Mac は標準が Apple マップ（「この端末の標準」と添える）、Android は geo: で端末の地図アプリ、
// それ以外（Windows など）は端末の標準が無いので Google と Apple
const IS_APPLE = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent), IS_ANDROID = /Android/.test(navigator.userAgent);
const coordText = (c) => `${c.latitude.toFixed(5)}, ${c.longitude.toFixed(5)}`;
const MAP_APPS = {
  device: { name: "この端末の地図アプリ", chipLabel: "地図アプリ", url: (t) => `geo:${t.replace(" ", "")}?q=${t.replace(" ", "")}` },
  google: { name: "Google マップ", chipLabel: "Google", url: (t) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t)}` },
  apple: { name: IS_APPLE ? "Apple マップ（この端末の標準）" : "Apple マップ", chipLabel: "Apple",
    url: (t) => `https://maps.apple.com/?ll=${t.replace(" ", "")}&q=${encodeURIComponent(t)}` },
};
const mapAppChoices = () => (IS_APPLE ? ["apple", "google"] : IS_ANDROID ? ["device", "google"] : ["google", "apple"]);
/// 「次からもこのアプリで開く」で覚えたアプリ（この端末で選べるものだけ）
const savedMapApp = () => { const k = store.get("sorami.mapApp", null); return mapAppChoices().includes(k) ? k : null; };
function openMapApp(app, t) {
  const url = MAP_APPS[app].url(t);
  if (url.startsWith("geo:")) { location.href = url; return; }
  // 押した操作の中で開く（アプリが入っていればアプリで開く）
  const a = document.createElement("a");
  a.href = url; a.target = "_blank"; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
}
let mapAppCoord = "";
function openMapAppSheet(t) {
  mapAppCoord = t;
  $("mapAppCoord").textContent = t;
  $("mapAppRemember").checked = !!savedMapApp();
  $("mapAppList").innerHTML = mapAppChoices()
    .map((k) => `<button class="fav-btn" data-map-app="${k}">${esc(MAP_APPS[k].name)}</button>`).join("");
  for (const b of $("mapAppList").querySelectorAll("[data-map-app]")) {
    b.onclick = () => {
      const k = b.dataset.mapApp;
      // 覚えるのは「次からも」に印があるときだけ。外して選んだら、覚えていたものも忘れる（次はまた聞く）
      store.set("sorami.mapApp", $("mapAppRemember").checked ? k : null);
      $("mapAppSheet").close();
      renderCoordRows();
      aimRefreshSheetCands();   // 地点の画面の候補地の釦の名前も（Google・Apple）
      openMapApp(k, mapAppCoord);
    };
  }
  showSheet($("mapAppSheet"));
}
$("mapAppClose").onclick = () => $("mapAppSheet").close();
/// 覚えたアプリがあれば「Google マップで開く」、無ければ「地図アプリで開く」。覚えているときだけ「開くアプリを変える」
function renderCoordRows() {
  const app = savedMapApp();
  for (const row of document.querySelectorAll(".coord-row")) {
    // 釦の名前は短く（Google・Apple）。「Google マップ」まで書くと 375px で座標と1行に並ばなかった。↗ の印で地図アプリへ飛ぶと分かる
    row.querySelector("[data-map-app-label]").textContent = app ? MAP_APPS[app].chipLabel : "地図アプリ";
    row.querySelector("[data-map-app-change]").hidden = !app;
    row.querySelector("[data-map-app-open]").classList.toggle("split", !!app);
  }
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch { /* 古い仕組みで写す */ }
  const ta = document.createElement("textarea");
  ta.value = t; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  ta.remove();
  return ok;
}
for (const row of document.querySelectorAll(".coord-row")) {
  // ISS は選んでいる回の立つ場所の例、ほかは地図の中心（ピン）
  const center = () => (row.dataset.map === "iss" ? issStandPoint() : ({ aim: AimMap, plane: PlaneMap })[row.dataset.map].center());
  const copy = row.querySelector("[data-coord-copy]");
  // 地図をまだ描いていない（座標が「—」）なら何もしない（見えていない初期位置を写さない）
  const ready = () => row.querySelector(".coord").textContent !== "—" && !!center();
  copy.onclick = async () => {
    if (!ready()) return;
    const ok = await copyText(coordText(center()));
    const done = copy.querySelector(".copied"), c = copy.querySelector(".coord");
    done.textContent = ok ? "コピーしました" : "コピーできませんでした";
    done.hidden = false; c.hidden = true;
    clearTimeout(copy.timer);
    copy.timer = setTimeout(() => { done.hidden = true; c.hidden = false; }, 1500);
  };
  row.querySelector("[data-map-app-open]").onclick = () => {
    if (!ready()) return;
    const app = savedMapApp(), t = coordText(center());
    if (app) openMapApp(app, t); else openMapAppSheet(t);
  };
  row.querySelector("[data-map-app-change]").onclick = () => { if (ready()) openMapAppSheet(coordText(center())); };
}
renderCoordRows();
/// ISS の座標の行: 選んでいる回の立つ場所の例。無ければ行を出さない
const issStandPoint = () => { const r = iss.result && iss.result[iss.pick]; return r && r.stand ? r.stand : null; };
function issCoordUpdate() {
  const st = issStandPoint();
  document.querySelector('.coord-row[data-map="iss"]').hidden = !st;
  $("issCoord").textContent = st ? coordText(st) : "—";
}

/// satellite.js は必要になったときだけ読む（vendor から。CSP は 'self' のまま）
async function issLoadSat() {
  if (iss.sat) return iss.sat;
  const [io, pr, tr] = await Promise.all([
    import("./vendor/satellite/io.js"), import("./vendor/satellite/propagation.js"),
    import("./vendor/satellite/transforms.js")]);
  iss.sat = { twoline2satrec: io.twoline2satrec, propagate: pr.propagate, gstime: pr.gstime,
              eciToEcf: tr.eciToEcf, ecfToLookAngles: tr.ecfToLookAngles };
  return iss.sat;
}

/// 軌道要素。**2時間は使い回す**（CelesTrak は同じ要素を短い間隔で何度も取りに来るのを嫌う）。衛星ごとに持つ
const issTleCache = () => store.get("sorami.issTles", {}) || {};
/// CelesTrak へ。応答が来ないと「計算しています…」のまま止まるので、15秒で諦めて手元の控えへ（2026-10-21 に止まるのを確認）
async function issFetchText(url) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(timer); }
}
function issKeepTle(catnr, text) {
  const all = issTleCache();
  all[catnr] = { at: Date.now(), text };
  // 選択肢の3機と、いま選んでいる1機のぶんだけ残す
  const keep = new Set([...ISS_PRESETS.map(([n]) => String(n)), String(iss.catnr), String(catnr)]);
  for (const k of Object.keys(all)) if (!keep.has(k)) delete all[k];
  store.set("sorami.issTles", all);
}
async function issLoadTle(catnr = iss.catnr) {
  // 以前の ISS だけの控え（sorami.issTle）も、取れないときの予備に使う
  const cached = issTleCache()[catnr] || (catnr === 25544 ? store.get("sorami.issTle", null) : null);
  if (cached && Date.now() - cached.at < 2 * 3600000 && cached.text) return AstroNotesISS.parseTle(cached.text);
  try {
    const text = await issFetchText(`https://celestrak.org/NORAD/elements/gp.php?CATNR=${Number(catnr)}&FORMAT=TLE`);
    const tle = AstroNotesISS.parseTle(text);
    if (!tle) throw new Error("軌道要素を読めません");
    issKeepTle(catnr, text);
    return tle;
  } catch (e) {
    // 取れなければ、古くても手元のものを使う（古さは画面に出す）
    return cached && cached.text ? AstroNotesISS.parseTle(cached.text) : null;
  }
}

/// 表示の切り替え（通過／月・太陽の前）。地図・凡例・題名の右の太陽／月もそれぞれに合わせる
function issSetTab(tab, focus = false) {
  iss.tab = tab;
  const pass = tab === "pass";
  $("issPassTab").setAttribute("aria-selected", String(pass)); $("issPassTab").tabIndex = pass ? 0 : -1;
  $("issTransitTab").setAttribute("aria-selected", String(!pass)); $("issTransitTab").tabIndex = pass ? -1 : 0;
  $("issPassPanel").hidden = !pass; $("issTransitPanel").hidden = pass;
  $("issBodySeg").hidden = pass; $("issTransitRange").hidden = pass;
  issPlaceDetail();
  if (focus) $(pass ? "issPassTab" : "issTransitTab").focus();
  issApply();
}

async function issApply() {
  if (!toolAllowed("iss")) return;
  const P = issFromPoint();
  if (!P) return;
  const seq = ++iss.seq;
  const name = issSatName();
  const pass = iss.tab === "pass";
  // 開いていた回の方角図と地図は一覧の中（行の下）にある。一覧を書き換える前に退避しないと地図ごと消える
  issParkDetail();
  // 前の衛星の回は捨てる（残すと、計算中に一覧が書き直されたとき前の衛星の回と地図が戻ってくる）
  if (pass) { iss.passes = []; iss.passPick = -1; iss.track = []; iss.passesReady = false; }
  $(pass ? "issPassList" : "issList").innerHTML = `<p class="tiny">計算しています…</p>`;
  // 探す範囲の中心のカード（地点カードと同じ形）。そこに立つわけではないので標高は書かない
  renderPointCard("issFrom", P, null, { elevation: false });
  issRenderSatCard();
  $("issMoon").setAttribute("aria-pressed", String(iss.body === "moon"));
  $("issMoon").innerHTML = moonGlyphAt(Date.now(), issFromPoint());
  $("issSun").setAttribute("aria-pressed", String(iss.body === "sun"));
  $("issSunWarn").hidden = pass || iss.body !== "sun";
  $("issCanvas").setAttribute("aria-label", pass ? `地図。${name}の真下の通り道です`
    : `地図。${name}が${iss.body === "sun" ? "太陽" : "月"}の前を横切って見える帯です`);
  $("issKey").className = `aim-k ${pass || iss.body === "moon" ? "moon" : "sun"}`;
  $("issKeyText").textContent = pass ? "真下の通り道（太い所が見える区間）" : "見える帯";
  document.querySelector('.coord-row[data-map="iss"]').hidden = true;
  $("issFrom").textContent = `${P.name}から${iss.rangeKm}km以内`;
  $("issPassFrom").textContent = `${P.name}で`;
  let sat, tle;
  try { [sat, tle] = await Promise.all([issLoadSat(), issLoadTle()]); } catch { sat = null; }
  if (seq !== iss.seq) return;
  if (!sat || !tle) {
    issParkDetail();
    $(pass ? "issPassList" : "issList").innerHTML = `<p class="tiny">${esc(name)}の軌道要素を取れませんでした。時間をおいて開き直してください。落下や運用終了で軌道要素が配られていない衛星もあります。</p>`;
    iss.passes = []; iss.result = []; iss.track = [];
    issDrawSky();
    return;
  }
  const ageH = (Date.now() - tle.epochMs) / 3600000;
  // 軌道要素の古さは、古いとき（1日より前）だけ一言（3日より先の回には「目安」が付く）
  $("issTle").textContent = ageH > 24 ? `軌道要素が${Math.round(ageH / 24)}日前のため目安` : "";
  // 画面を止めないよう、次の描画を待ってから解く（3日ぶんで0.2秒ほど）
  await new Promise((r) => setTimeout(r, 0));
  if (seq !== iss.seq) return;
  if (pass) return issApplyPasses(seq, sat, tle, P);
  return issApplyTransits(seq, sat, tle, P);
}

/// 月・太陽の前を横切る回（2026-09-30 からの計算をそのまま、選んだ衛星に）
async function issApplyTransits(seq, sat, tle, P) {
  let rows = [];
  try {
    rows = AstroNotesISS.transits(sat, tle, { center: { latitude: P.latitude, longitude: P.longitude },
      radiusKm: iss.rangeKm, fromMs: Date.now(), hours: 168, body: iss.body });
  } catch { rows = []; }
  if (seq !== iss.seq) return;
  // 昼の月も残す。高く昇った昼の月は見えていて、ISS の影は望遠で写る（月面通過の写真の多くは昼）。
  // 空の明るさは行に「昼・薄明・夜」で添える
  iss.result = rows; iss.pick = 0; iss.overWater = 0; iss.standsDone = false;
  issRender();
  if (rows.length) IssMap.open(rows[0].center, 9);
  else IssMap.open({ latitude: P.latitude, longitude: P.longitude }, 8);
  requestAnimationFrame(() => IssMap.redraw());
  if (!rows.length) return;
  // 立つ場所（陸の上）。地名の表と水域のタイルを読むので、行を先に出してから足す
  for (const r of rows) {
    try { r.stand = await issStand(r); } catch { r.stand = undefined; }
    if (seq !== iss.seq) return;
  }
  // 帯が水の上だけを通る回は、陸から見られないので並べない（何回外したかは書く）
  const pickedAt = rows[iss.pick] && rows[iss.pick].at;
  iss.result = rows.filter((r) => r.stand !== null);
  iss.overWater = rows.length - iss.result.length;
  iss.standsDone = true;
  iss.pick = Math.max(0, iss.result.findIndex((r) => r.at === pickedAt));
  issRender();
  const first = iss.result[iss.pick];
  if (first && first.stand) IssMap.open(first.stand, 9);
  requestAnimationFrame(() => IssMap.redraw());
}

/**
 * ISS の帯の中で、**陸の上に**立てる場所を選ぶ（2026-10-01 ユーザー「観測地点は陸上に。ISS が海の上になっていた」）。
 * 以前は「いまの地点から中心線へいちばん近い点」をそのまま出しており、東京湾や相模湾の上になることがあった。
 *
 *   1. 帯の芯（中心線から半幅の6割以内。軌道要素の誤差でずれても外れにくい）にある、名前のある場所
 *      （ねらうの候補地＝展望地・公園・海岸・川岸など、地名索引＝山・峠・展望地・岬・滝）を、いまの地点から近い順に。
 *      山頂は登らないと立てないので、1.6倍遠いものとして並べる。水の上のもの（橋・桟橋を除く）は外す
 *   2. 無ければ、中心線をいまの地点から近い順にたどって、最初の陸の点（名前なし）
 *   3. それも無ければ（帯が水の上だけを通る）、立つ場所は出さない（null）
 */
async function issStand(r) {
  const P = issFromPoint();
  const F = (la, lo) => [(lo - r.center.longitude) * 111.32 * Math.cos(r.center.latitude * Math.PI / 180), (la - r.center.latitude) * 110.54];
  const track = r.track.map((q) => F(q.latitude, q.longitude));
  const offKm = (la, lo) => {
    const [px, py] = F(la, lo);
    let d = Infinity;
    for (let k = 0; k + 1 < track.length; k++) {
      const [ax, ay] = track[k], [bx, by] = track[k + 1];
      const L2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / L2));
      d = Math.min(d, Math.hypot(px - ax - (bx - ax) * t, py - ay - (by - ay) * t));
    }
    return d;
  };
  const core = Math.max(0.15, r.halfWidthKm * 0.6);
  const lats = r.track.map((q) => q.latitude), lons = r.track.map((q) => q.longitude);
  const pad = core / 100 + 0.01;
  const inBox = (la, lo) => la >= Math.min(...lats) - pad && la <= Math.max(...lats) + pad
    && lo >= Math.min(...lons) - pad * 1.3 && lo <= Math.max(...lons) + pad * 1.3;
  const named = [];
  const add = (name, kind, la, lo) => {
    if (!name || !inBox(la, lo)) return;
    const off = offKm(la, lo);
    if (off > core) return;
    const away = AstroNotesTerrain.distanceKm(P.latitude, P.longitude, la, lo);
    if (away > iss.rangeKm) return;
    named.push({ name, kind, latitude: la, longitude: lo, offsetKm: off, fromHereKm: away,
      score: away * (kind === "山頂" || kind === "山" ? 1.6 : 1) + off * 2 });
  };
  try { for (const p of await aimPlaces()) add(p.name, p.kind, p.latitude, p.longitude); } catch { /* 無くても索引で探す */ }
  try {
    const idx = await placeIndex();
    for (const p of idx.places) add(p[1], idx.kinds[p[0]] || "", p[3] / 1e5, p[4] / 1e5);
  } catch { /* 無くても中心線で探す */ }
  named.sort((a, b) => a.score - b.score);
  // 同じ所が2つの表に入っていることがある。近いもの（300m）は1つに
  const picks = [];
  for (const n of named) {
    if (picks.some((q) => AstroNotesTerrain.distanceKm(q.latitude, q.longitude, n.latitude, n.longitude) < 0.3)) continue;
    picks.push(n);
    if (picks.length >= 8) break;
  }
  // 橋・桟橋も外す（ねらうと違って、ISS は川や海の上から見る理由が無い。陸の公園や展望地を先に出す）
  const water = await AstroNotesTerrain.waterAt(picks);
  const onLand = picks.filter((n, i) => water[i] !== true);
  if (onLand.length) return { ...onLand[0], others: onLand.slice(1, 3) };
  // 名前のある場所が無い。中心線を、いまの地点から近い順にたどる
  const line = r.track
    .map((q) => ({ latitude: q.latitude, longitude: q.longitude,
      fromHereKm: AstroNotesTerrain.distanceKm(P.latitude, P.longitude, q.latitude, q.longitude) }))
    .filter((q) => q.fromHereKm <= iss.rangeKm)
    .sort((a, b) => a.fromHereKm - b.fromHereKm);
  for (let i = 0; i < line.length; i += 12) {
    const batch = line.slice(i, i + 12);
    const w = await AstroNotesTerrain.waterAt(batch);
    const k = w.findIndex((v) => v === false);
    if (k >= 0) return { ...batch[k], name: "", kind: "", offsetKm: 0, others: [] };
  }
  return null;
}

function issRender() {
  const P = issFromPoint();
  const rows = iss.result;
  const overWater = iss.overWater
    ? `<p class="tiny" style="color:var(--tertiary)">海や湖の上だけを通る回（${iss.overWater}回）は除外</p>` : "";
  if (!rows.length) {
    $("issList").innerHTML = `<p class="tiny">この7日、${esc(P.name)}から${iss.rangeKm}km以内で${iss.body === "moon" ? "月" : "太陽"}の前を通る回はありません。</p>${overWater}`;
    return;
  }
  $("issList").innerHTML = rows.map((r, i) => {
    const t = new Date(r.at + 9 * 3600000);
    const hms = t.toISOString().slice(11, 19);
    // 立つ場所（陸の上）。探し終わるまでは「探しています」。水の上だけを通る回は並べないので、
    // 探し終わっても無いのは、確かめられなかったとき（通信の失敗など）
    const st = r.stand;
    const where = st === undefined || st === null
      ? `<span class="muted">${iss.standsDone ? "立つ場所を確かめられませんでした（地図の帯の中の陸で見てください）" : "立つ場所を探しています…"}</span>`
      : `<span class="muted">立つ場所の例：${st.name ? `<strong>${esc(st.name)}</strong>${st.kind ? `（${esc(st.kind)}）` : ""}` : "名前のない陸の上"}
          ・ ${issDirection(P, st)}へ ${st.fromHereKm.toFixed(1)}km ・ 中心線から${st.offsetKm < 0.05 ? "すぐ" : `${st.offsetKm.toFixed(1)}km`}${
          st.others && st.others.length ? `<br>ほかに：${st.others.map((o) => esc(o.name)).join("・")}` : ""}</span>`;
    const lit = r.illuminated !== null ? ` ・ ${moonGlyphAt(r.at, st || r.center)} 輝面${Math.round(r.illuminated * 100)}%` : "";
    const sky = r.sunAltitude < -6 ? "夜" : r.sunAltitude < 0 ? "薄明" : "昼";
    // 3日より先は軌道要素の誤差で数十秒・数kmずれうる。印だけ付ける
    const rough = r.at - Date.now() > 72 * 3600000 ? `<span class="tiny" style="color:var(--tertiary)">（目安）</span>` : "";
    return `<button class="al-row jump" data-iss="${i}">
      <span class="al-w"><strong>${S.Cal.monthDay(r.at)}(${S.Cal.weekday(r.at)}) ${hms}</strong>${rough}
        ${where}
        <span class="tiny">帯の幅 約${(r.halfWidthKm * 2).toFixed(1)}km ・ ${r.durationS.toFixed(1)}秒</span>
        <span class="tiny">${iss.body === "moon" ? "月" : "太陽"}の方位${Math.round(r.azimuth)}°・高さ${Math.round(r.altitude)}°${lit} ・ ${sky} ・ 衛星まで${r.rangeKm}km</span>
        ${iss.body === "moon" ? `<span class="tiny">${esc(lightTimingText(r.at, st || r.center))}</span>` : ""}</span>
      <span class="tiny">地図で見る →</span></button>`;
  }).join("") + overWater;
  for (const el of $("issList").querySelectorAll("[data-iss]")) {
    el.onclick = () => {
      iss.pick = +el.dataset.iss;
      const r = iss.result[iss.pick];
      issCoordUpdate();
      IssMap.open(r.stand || r.center, 11);
      requestAnimationFrame(() => IssMap.redraw());
    };
  }
  issCoordUpdate();
}

/// 方角を8方位で言う（いまの地点から、立つ場所へ）
function issDirection(from, to) {
  const b = AstroNotesTerrain.bearing(from.latitude, from.longitude, to.latitude, to.longitude);
  return ["北", "北東", "東", "南東", "南", "南西", "西", "北西"][Math.round(b / 45) % 8];
}

// ---------------------------------------------------------------- 人工衛星の通過（2026-10-21）
//
// 見えるのは、衛星に日が当たっていて、地上が暗い（太陽の高さ −6°以下）区間で、仰角10°以上のところ（判定は astronotes-iss.js）。
// 明るさ（等級）は衛星ごとの基準の明るさの出典を持っていないので出さない。
const ISS_DIR16 = ["北", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東", "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西"];
const issDir16 = (az) => ISS_DIR16[Math.round(az / 22.5) % 16];
const issHms = (ms) => new Date(ms + 9 * 3600000).toISOString().slice(11, 19);
const issHm = (ms) => new Date(ms + 9 * 3600000).toISOString().slice(11, 16);
const issShownPasses = () => (iss.showAll ? iss.passes : iss.passes.filter((p) => p.visible));
const issSky = (sunAlt) => (sunAlt < -6 ? "夜" : sunAlt < 0 ? "薄明" : "昼");

function issApplyPasses(seq, sat, tle, P) {
  // 1日に1.5周より遅い（静止衛星など）は空の同じ所に止まって見え、出入りが無い。いまの方角と高さだけ出す
  const revPerDay = Number(tle.line2.slice(52, 63));
  if (revPerDay < 1.5) {
    iss.passes = []; iss.tle = tle; iss.track = []; iss.passesReady = true;
    const rec = sat.twoline2satrec(tle.line1, tle.line2), d = new Date();
    const pv = sat.propagate(rec, d);
    const la = pv && pv.position ? sat.ecfToLookAngles({ latitude: P.latitude * Math.PI / 180, longitude: P.longitude * Math.PI / 180, height: (P.elevation || 0) / 1000 },
      sat.eciToEcf(pv.position, sat.gstime(d))) : null;
    const az = la ? ((la.azimuth * 180 / Math.PI) % 360 + 360) % 360 : 0, el = la ? la.elevation * 180 / Math.PI : -90;
    issParkDetail();
    $("issPassList").innerHTML = `<p class="tiny">${esc(issSatName())}は地球の自転と同じ速さで回る高い軌道の衛星で、空のほぼ同じ所に止まって見えます。${
      el > 0 ? `${esc(P.name)}からは${issDir16(az)}（方位${Math.round(az)}°）の高さ${Math.round(el)}°。肉眼では見えません。` : `${esc(P.name)}からは地平線の下です。`}</p>`;
    iss.passPick = -1;
    issPlaceDetail();
    return;
  }
  let rows = [];
  try {
    rows = AstroNotesISS.passes(sat, tle, { observer: { latitude: P.latitude, longitude: P.longitude, elevation: P.elevation || 0 },
      fromMs: Date.now(), hours: 168 });
  } catch { rows = []; }
  if (seq !== iss.seq) return;
  iss.passes = rows; iss.tle = tle; iss.passPick = -1; iss.track = []; iss.passesReady = true;
  issRenderPasses();
}

/// 方角図と地図の置き場所（2026-10-21 ユーザー「情報量が多くない？」）。
/// 月・太陽の前: 地図は一覧の上。通過: 押した回の行のすぐ下に方角図と地図を開く（押すまでは出さない）
function issParkDetail() {
  $("issPassPanel").append($("issPassDetail"));
  $("issPassDetail").hidden = true;
}
function issPlaceDetail() {
  const box = $("issMapBox");
  if (iss.tab !== "pass") { issParkDetail(); $("issMapHome").append(box); $("issMapHome").hidden = false; return; }
  $("issMapHome").hidden = true;
  const row = $("issPassList").querySelector(`[data-pass="${iss.passPick}"]`);
  if (!row) { issParkDetail(); return; }
  $("issPassDetail").append(box);
  row.after($("issPassDetail"));
  $("issPassDetail").hidden = false;
}

function issRenderPasses() {
  issParkDetail();   // 一覧を書き直すと、行の下に置いた詳しいことも消えるので先に退避
  const P = issFromPoint(), name = issSatName();
  const rows = issShownPasses();
  const hiddenN = iss.passes.length - rows.length;
  if (!rows.length) {
    $("issPassList").innerHTML = `<p class="tiny">この7日、${esc(P.name)}で${esc(name)}が見える回はありません${
      hiddenN ? `（日が当たらない・空が明るいなどで見えない回が${hiddenN}回）` : ""}。</p>`;
    return;
  }
  $("issPassList").innerHTML = rows.map((p, i) => {
    const v = p.visible;
    const rough = p.max.at - Date.now() > 72 * 3600000 ? `<span class="tiny" style="color:var(--tertiary)">（目安）</span>` : "";
    const day = `${S.Cal.monthDay(p.max.at)}(${S.Cal.weekday(p.max.at)})`;
    // 行は2段: 時刻と、方角の流れ（細かい時刻・距離は押すと開く）
    const open = i === iss.passPick;
    if (!v) {
      const why = p.sunAltitude > -6 ? "空が明るい" : !p.litAtMax ? "地球の影の中" : "日が当たる所が低い";
      return `<button class="al-row jump" data-pass="${i}" aria-expanded="${open}">
        <span class="al-w"><strong>${day} ${issHm(p.rise.at)}〜${issHm(p.set.at)}</strong>${rough}
          <span class="muted">見えない（${why}）・ 最大${Math.round(p.max.elevation)}° ${issDir16(p.max.azimuth)}</span></span>
        <span class="tiny">${open ? "閉じる" : "空の図"}</span></button>`;
    }
    return `<button class="al-row jump" data-pass="${i}" aria-expanded="${open}">
      <span class="al-w"><strong>${day} ${issHm(v.start.at)}〜${issHm(v.end.at)}</strong>${rough}
        <span class="muted">${issDir16(v.start.azimuth)} → ${issDir16(v.max.azimuth)} 高さ${Math.round(v.max.elevation)}° → ${
          issDir16(v.end.azimuth)}${v.entersShadow ? "（影に入って消える）" : ""}</span></span>
      <span class="tiny">${open ? "閉じる" : "空の図"}</span></button>`;
  }).join("") + (hiddenN && !iss.showAll ? `<p class="tiny" style="color:var(--tertiary)">見えない回（${hiddenN}回）は出していません</p>` : "");
  for (const el of $("issPassList").querySelectorAll("[data-pass]")) {
    el.onclick = () => {
      // 開いている行をもう一度押すと閉じる
      const i = +el.dataset.pass;
      issPickPass(i === iss.passPick ? -1 : i);
      if (iss.passPick >= 0) $("issPassDetail").scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
  }
  issPlaceDetail();
}

/// 回を選ぶ: 空の方角図と、地図の真下の通り道を描き直す
function issPickPass(i) {
  const p = issShownPasses()[i];
  iss.passPick = i;
  iss.track = p && iss.sat && iss.tle ? AstroNotesISS.groundTrack(iss.sat, iss.tle, p.rise.at, p.set.at, 10) : [];
  for (const el of $("issPassList").querySelectorAll("[data-pass]")) {
    const on = +el.dataset.pass === i;
    el.setAttribute("aria-expanded", String(on));
    el.lastElementChild.textContent = on ? "閉じる" : "空の図";
  }
  issPlaceDetail();
  const v = p && p.visible;
  $("issPassDetailText").textContent = !p ? "" : v
    ? `見える ${issHms(v.start.at)}〜${issHms(v.end.at)}（約${Math.max(1, Math.round((v.end.at - v.start.at) / 60000))}分）・ ${issSky(p.sunAltitude)} ・ 最も近いとき${Math.round(p.max.rangeKm)}km`
    : `地平線の上 ${issHm(p.rise.at)}〜${issHm(p.set.at)} ・ ${issSky(p.sunAltitude)}`;
  issDrawSky();
  const P = issFromPoint();
  if (p && iss.track.length && P) {
    const m = issTrackAt((p.visible ? p.visible.max : p.max).at);
    IssMap.open({ latitude: (P.latitude + m.latitude) / 2, longitude: (P.longitude + m.longitude) / 2 }, 5);
  }
  requestAnimationFrame(() => IssMap.redraw());
}

/// 空の方角図。真上が中心、外周が地平線。**上が北・右が東**（地図と同じ向き。見上げた空を下から見た向きではない）
function issDrawSky() {
  const cv = $("issSky");
  if (!cv || $("issPassDetail").hidden) return;
  const W = 280, dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(W * dpr); }
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, W);
  const cs = getComputedStyle(document.documentElement), css = (k, d) => cs.getPropertyValue(k).trim() || d;
  const R = 116, cx = W / 2, cy = W / 2;
  const xy = (az, el) => { const r = R * (90 - el) / 90, a = az * Math.PI / 180; return [cx + r * Math.sin(a), cy - r * Math.cos(a)]; };
  ctx.strokeStyle = css("--line", "#ccc"); ctx.lineWidth = 1;
  for (const el of [0, 30, 60]) { ctx.beginPath(); ctx.arc(cx, cy, R * (90 - el) / 90, 0, Math.PI * 2); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
  ctx.fillStyle = css("--secondary", "#666"); ctx.font = "600 12px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const [t, az] of [["北", 0], ["東", 90], ["南", 180], ["西", 270]]) { const [x, y] = xy(az, -10); ctx.fillText(t, x, y); }
  ctx.font = "10px system-ui, sans-serif";
  for (const el of [30, 60]) ctx.fillText(`${el}°`, cx + 10, cy - R * (90 - el) / 90 + 7);
  const p = issShownPasses()[iss.passPick];
  if (!p) { cv.setAttribute("aria-label", "空の方角図。選んでいる回はありません"); return; }
  const color = css("--ray-moon", "#2f7fd0");
  const line = (pts) => { ctx.beginPath(); pts.forEach((q, k) => { const [x, y] = xy(q.azimuth, Math.max(0, q.elevation)); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); };
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  ctx.setLineDash([4, 4]); ctx.strokeStyle = css("--tertiary", "#999"); ctx.lineWidth = 1.5; line(p.path); ctx.setLineDash([]);
  // 月が出ていれば、いちばん高いときの位置に（月の近くを通る回が分かる）
  const P = issFromPoint();
  const mo = AstroNotesAstro.moon(p.max.at, { latitude: P.latitude, longitude: P.longitude, elevation: P.elevation || 0 });
  if (mo.apparentAltitude > 0) {
    const [mx, my] = xy(mo.azimuth, mo.apparentAltitude);
    ctx.beginPath(); ctx.arc(mx, my, 6, 0, Math.PI * 2); ctx.fillStyle = "#e8e3c8"; ctx.fill();
    ctx.strokeStyle = css("--secondary", "#666"); ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = css("--secondary", "#666"); ctx.fillText("月", mx, my + 14);
  }
  const v = p.visible;
  if (v) {
    const seg = p.path.filter((q) => q.at >= v.start.at && q.at <= v.end.at);
    ctx.strokeStyle = color; ctx.lineWidth = 4; line(seg);
    // 進む向きの矢印（見える区間の終わり）
    if (seg.length >= 2) {
      const [x1, y1] = xy(seg[seg.length - 2].azimuth, seg[seg.length - 2].elevation), [x2, y2] = xy(v.end.azimuth, v.end.elevation);
      const a = Math.atan2(y2 - y1, x2 - x1);
      ctx.beginPath(); ctx.moveTo(x2 + Math.cos(a) * 6, y2 + Math.sin(a) * 6);
      ctx.lineTo(x2 + Math.cos(a + 2.5) * 8, y2 + Math.sin(a + 2.5) * 8); ctx.lineTo(x2 + Math.cos(a - 2.5) * 8, y2 + Math.sin(a - 2.5) * 8);
      ctx.closePath(); ctx.fillStyle = color; ctx.fill();
    }
    const [sx, sy] = xy(v.start.azimuth, v.start.elevation), [ex, ey] = xy(v.end.azimuth, v.end.elevation);
    ctx.beginPath(); ctx.arc(sx, sy, 3.5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    ctx.fillStyle = css("--text", "#222"); ctx.font = "600 11px system-ui, sans-serif";
    // 見える区間が短いと始めと終わりの時刻が重なる。近ければ1つにまとめる
    if (Math.hypot(ex - sx, ey - sy) < 48) ctx.fillText(`${issHm(v.start.at)}〜${issHm(v.end.at)}`, (sx + ex) / 2, (sy + ey) / 2 + ((sy + ey) / 2 > cy ? 14 : -14));
    else { ctx.fillText(issHm(v.start.at), sx, sy + (sy > cy ? 12 : -12)); ctx.fillText(issHm(v.end.at), ex, ey + (ey > cy ? 14 : -14)); }
  }
  cv.setAttribute("aria-label", v
    ? `空の方角図。${issHm(v.start.at)}に${issDir16(v.start.azimuth)}から現れ、${issDir16(v.max.azimuth)}の高さ${Math.round(v.max.elevation)}°を通り、${issHm(v.end.at)}に${issDir16(v.end.azimuth)}で見えなくなります`
    : `空の方角図。この回は見えません（地平線の上を${issDir16(p.rise.azimuth)}から${issDir16(p.set.azimuth)}へ）`);
}

/// 通り道の点のうち、その時刻にいちばん近いもの
const issTrackAt = (ms) => iss.track.reduce((a, b) => (Math.abs(b.at - ms) < Math.abs(a.at - ms) ? b : a));
/// 地図: 選んだ回の衛星の真下の通り道。見える区間を太く、いちばん高い時刻に印
function issDrawTrack(ctx, project, color, ink, width, height) {
  const p = issShownPasses()[iss.passPick], tr = iss.track;
  if (!p || tr.length < 2) return;
  const path = (pts) => { ctx.beginPath(); pts.forEach((q, k) => { const [x, y] = project(q.latitude, q.longitude); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); };
  ctx.save();
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  ctx.strokeStyle = ink; ctx.lineWidth = 3; path(tr);
  ctx.strokeStyle = color; ctx.lineWidth = 1.4; path(tr);
  const v = p.visible;
  if (v) {
    const seg = tr.filter((q) => q.at >= v.start.at && q.at <= v.end.at);
    if (seg.length >= 2) { ctx.strokeStyle = ink; ctx.lineWidth = 7; path(seg); ctx.strokeStyle = color; ctx.lineWidth = 5; path(seg); }
  }
  // 印は、見える回なら見える中でいちばん高い時刻、見えない回なら地平線の上でいちばん高い時刻
  const top = v ? v.max : p.max;
  const m = issTrackAt(top.at);
  const [mx, my] = project(m.latitude, m.longitude);
  ctx.beginPath(); ctx.arc(mx, my, 5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
  aimMapLabel(ctx, mx, my - 14, `${issHm(top.at)} 高さ${Math.round(top.elevation)}°`, "#fff", width, height, "center");
  ctx.restore();
}

// ---------------------------------------------------------------- 衛星を選ぶ（2026-10-21）
//
// ユーザー「なんで衛星の中で選択できないの？ジャンル分けして検索も出来るようにしたら探しやすくなる」「日本語名一覧とかないの？」。
// 上に名前・番号の検索、下に CelesTrak の GROUP ごとのジャンル。ジャンルは押したときだけ取る（2時間使い回す）。
// 日本語名は Wikidata（CC0）の衛星カタログ番号と日本語ラベルから作った表（build-satellite-names.mjs → data/satellite-names-ja.json）。
// 「今夜見える」はジャンルの中で解く。肉眼で見える衛星が多いのは宇宙ステーションと明るい衛星だけなので、その2つにだけ出す
const ISS_GROUPS = [
  ["stations", "宇宙ステーション", true], ["visual", "明るい衛星", true], ["weather", "気象", false],
  ["gnss", "測位（GPS・みちびき など）", false], ["science", "科学", false], ["amateur", "アマチュア無線", false]];
const issPick = { group: "all", list: [], remote: null, seq: 0, remoteSeq: 0, visSeq: 0, visible: null, timer: 0, limit: 200 };
/// お気に入りの衛星（この端末に保存。{ catnr, name }）
const issFavSats = () => { const v = store.get("sorami.issFavSats", []); return Array.isArray(v) ? v.filter((x) => x && Number.isInteger(x.catnr)) : []; };
function issToggleFav(catnr, name) {
  const favs = issFavSats(), at = favs.findIndex((x) => x.catnr === catnr);
  if (at >= 0) favs.splice(at, 1); else favs.unshift({ catnr, name: String(name || "").slice(0, 80) });
  store.set("sorami.issFavSats", favs);
  issPickRender();
}
let issNamesPromise = null;
/// 番号→{ ja, en, alias } の表。取れなくても英語名で動く（次に開いたときにまた読む）
function issLoadNames() {
  if (!issNamesPromise) {
    issNamesPromise = fetch("data/satellite-names-ja.json").then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { iss.names = new Map(d.names.map(([n, ja, en, alias]) => [n, { ja, en, alias: alias || [] }])); return iss.names; })
      .catch(() => { issNamesPromise = null; return iss.names || new Map(); });
  }
  return issNamesPromise;
}
/// 検索のために揃える: 全角半角・大文字小文字・ひらがな→カタカナ。空白と区切りの記号は外す
const issFold = (s) => String(s || "").normalize("NFKC").toLowerCase()
  .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
  .replace(/[\s\-_()（）・.,/]/g, "");
/// 一覧の1行の名前: 日本語名（よく見る3機の呼び名・Wikidata）を主に、CelesTrak の英語名と番号を添える
function issPickLabel(catnr, celestrakName) {
  const p = ISS_PRESETS.find(([n]) => n === catnr);
  const w = iss.names && iss.names.get(catnr);
  const main = p ? p[1] : w ? w.ja : celestrakName || `衛星 ${catnr}`;
  const en = celestrakName || (w && w.en) || "";
  return { main, sub: [p || w ? en : "", `衛星番号 ${catnr}`].filter(Boolean).join(" ・ ") };
}

/// 衛星を選ぶページへ。戻ってきたときに同じ位置へ戻すため、いまのスクロール位置を覚える
function issPickOpen() {
  $("issPickGroups").innerHTML = [["all", "すべて"], ["fav", "お気に入り"], ...ISS_GROUPS].map(([g, label]) =>
    `<button type="button" class="chip" data-group="${g}" aria-pressed="${issPick.group === g}">${esc(label)}</button>`).join("");
  for (const b of $("issPickGroups").querySelectorAll("[data-group]")) b.onclick = () => issPickGroup(b.dataset.group);
  $("issPickQuery").value = "";
  showSheet($("issPickSheet"));
  issPickGroup(issPick.group || "all");
  issLoadNames().then(() => { if ($("issPickSheet").open) issPickRender(); });
}
function issPickDone() { $("issPickSheet").close(); }

/// ジャンルの軌道要素（2時間使い回す）。取れなければ古い控え、それも無ければ null
async function issLoadGroup(g) {
  const key = `sorami.issGroup.${g}`, cached = store.get(key, null);
  if (cached && Date.now() - cached.at < 2 * 3600000 && cached.text) return AstroNotesISS.parseTleList(cached.text);
  try {
    const text = await issFetchText(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(g)}&FORMAT=TLE`);
    const list = AstroNotesISS.parseTleList(text);
    if (list.length) store.set(key, { at: Date.now(), text });   // 大きいジャンルは保存できないことがある（そのときは次も取りに行く）
    return list;
  } catch { return cached && cached.text ? AstroNotesISS.parseTleList(cached.text) : null; }
}

/// ジャンルを開く。all は6ジャンルを合わせた一覧、fav はお気に入り（取得しない）
async function issPickGroup(g) {
  const seq = ++issPick.seq;
  issPick.group = g; issPick.list = []; issPick.visible = null; issPick.visSeq++; issPick.limit = 200;
  for (const b of $("issPickGroups").querySelectorAll("[data-group]")) b.setAttribute("aria-pressed", String(b.dataset.group === g));
  $("issPickVisible").hidden = true;
  if (g === "fav") { issPick.loading = false; issPickRender(); return; }
  // 読み終わるのを待たずに描く（お気に入りと名前・番号の検索はすぐ使える。取れないときは15秒待つことになる）
  issPick.loading = true; issPickRender();
  const groups = g === "all" ? ISS_GROUPS.map(([k]) => k) : [g];
  const lists = await Promise.all(groups.map(issLoadGroup));
  if (seq !== issPick.seq) return;
  issPick.loading = false;
  const seen = new Set(), list = [];
  for (const l of lists) for (const t of l || []) if (!seen.has(t.catnr)) { seen.add(t.catnr); list.push(t); }
  issPick.list = list;
  issPick.failed = lists.filter((l) => !l || !l.length).length;
  if (g !== "all") { $("issPickVisible").hidden = !list.length || !ISS_GROUPS.find(([k]) => k === g)[2]; $("issPickVisible").disabled = false; }
  issPickRender();
}

/// CelesTrak の名前（英語）で探す。日本語名の表に無い衛星もこれで見つかる
async function issPickRemote(q) {
  const seq = ++issPick.remoteSeq;
  issPick.remote = { q, list: undefined };
  issPickRender();
  let list = null;
  try { list = AstroNotesISS.parseTleList(await issFetchText(`https://celestrak.org/NORAD/elements/gp.php?NAME=${encodeURIComponent(q)}&FORMAT=TLE`)); }
  catch { list = null; }
  if (seq !== issPick.remoteSeq) return;
  issPick.remote = { q, list };
  issPickRender();
}

function issPickRender() {
  const q = $("issPickQuery").value.trim(), f = issFold(q), favs = issFavSats(), favSet = new Set(favs.map((x) => x.catnr));
  const rows = [], seen = new Set();
  const add = (catnr, tle, name, head) => { if (!catnr || seen.has(catnr)) return; seen.add(catnr); rows.push({ catnr, tle, name, head }); };
  const tleOf = (n) => issPick.list.find((t) => t.catnr === n) || (issPick.remote && issPick.remote.list || []).find((t) => t.catnr === n);
  const wikiHit = (catnr) => { const w = iss.names && iss.names.get(catnr); return !!w && [w.ja, w.en, ...w.alias].some((s) => issFold(s).includes(f)); };
  const hit = (catnr, name) => issFold(name).includes(f) || wikiHit(catnr) || String(catnr) === q;
  const label = ISS_GROUPS.find(([k]) => k === issPick.group)?.[1];
  let info = "", visibleRows = null;
  if (!q && issPick.visible) visibleRows = issPick.visible;
  else if (issPick.group === "fav") {
    for (const x of favs) if (!q || hit(x.catnr, x.name)) add(x.catnr, tleOf(x.catnr), x.name);
    info = favs.length ? `お気に入り：${favs.length}機` : "お気に入りはまだありません。一覧の☆で追加できます。";
  } else {
    // すべて: お気に入りを先に、そのあと一覧（日本語名のあるものを五十音順、ほかは英語名の順）
    if (issPick.group === "all") for (const x of favs) if (!q || hit(x.catnr, x.name)) add(x.catnr, tleOf(x.catnr), x.name, "お気に入り");
    const ja = (t) => iss.names && iss.names.get(t.catnr)?.ja;
    const sorted = [...issPick.list].sort((a, b) => (ja(a) ? 0 : 1) - (ja(b) ? 0 : 1) || (ja(a) || a.name).localeCompare(ja(b) || b.name, "ja"));
    let first = true;
    for (const t of sorted) if (!q || hit(t.catnr, t.name)) { add(t.catnr, t, t.name, first && issPick.group === "all" && favs.length ? "すべて" : undefined); first = false; }
    if (q) {
      if (/^\d{1,6}$/.test(q)) add(Number(q), tleOf(Number(q)));
      // 一覧に無い衛星も日本語名の表から（すべてのとき）
      if (issPick.group === "all") for (const [n] of iss.names || []) if (wikiHit(n)) add(n, tleOf(n));
      if (issPick.remote && issPick.remote.q === q && issPick.remote.list) for (const t of issPick.remote.list) add(t.catnr, t);
    }
    const n = issPick.list.length;
    info = q ? (rows.length ? `${rows.length}件` : "見つかりません。") + (issPick.group !== "all" ? `（${label}の中）` : "")
      : issPick.group === "all" ? (n ? `すべて：${n}機` : "") : `${label}：${n}機`;
    if (issPick.loading) info = (q ? info + " " : "") + "一覧を読んでいます…";
    else if (!n && issPick.group !== "fav") info = (issPick.group === "all" ? "衛星の一覧" : "このジャンルの軌道要素") + "を取れませんでした。名前や番号で探すことはできます。" + (info && q ? ` ${info}` : "");
    else if (issPick.group === "all" && issPick.failed) info += `（${issPick.failed}ジャンルは取れませんでした）`;
    if (q && issPick.remote && issPick.remote.q === q && issPick.remote.list === undefined) info += " CelesTrak で探しています…";
    if (q && issPick.remote && issPick.remote.q === q && issPick.remote.list === null) info += " CelesTrak で探せませんでした。";
  }
  $("issPickInfo").textContent = visibleRows ? `これから24時間、${issFromPoint().name}で見える回（早い順）` : info;
  const canRemote = q && !visibleRows && /[a-z]/i.test(q) && !(issPick.remote && issPick.remote.q === q);
  const list = visibleRows
    ? visibleRows.map(({ tle, pass, with: others }) => {
      const v = pass.visible, { main } = issPickLabel(tle.catnr, tle.name);
      const names = others.map((t) => issPickLabel(t.catnr, t.name).main);
      const together = others.length ? ` ・ ほか${others.length}機が一緒に通る（${names.slice(0, 2).join("・")}${names.length > 2 ? " など" : ""}）` : "";
      return { catnr: tle.catnr, tle, main, sub: `${S.Cal.monthDay(v.start.at)}(${S.Cal.weekday(v.start.at)}) ${issHm(v.start.at)} ・ ${issDir16(v.start.azimuth)}→${issDir16(v.end.azimuth)} ・ 最大仰角${Math.round(v.max.elevation)}°${together}` };
    })
    // お気に入りに残した名前は日本語名のことがある。表にある衛星は表の英語名を添える（同じ名前を2回出さない）
    : rows.map(({ catnr, tle, name, head }) => ({ catnr, tle, head, ...issPickLabel(catnr, (tle && tle.name)
      || (ISS_PRESETS.some(([n]) => n === catnr) || iss.names?.has(catnr) ? "" : name)) }));
  if (visibleRows && !list.length) $("issPickInfo").textContent = `これから24時間、${issFromPoint().name}でこのジャンルの衛星が見える回はありません。`;
  // 多いときは200件ずつ（すべてで1000機ほど。一度に並べると重い）
  const shown = list.slice(0, issPick.limit);
  $("issPickList").innerHTML = shown.map((r, i) => `${r.head ? `<h3 class="iss-pick-head">${esc(r.head)}</h3>` : ""}<div class="iss-pick-row">
      <button class="al-row jump" data-pick="${i}"${r.catnr === iss.catnr ? ' aria-current="true"' : ""}>
        <span class="al-w"><strong>${esc(r.main)}</strong><span class="tiny">${esc(r.sub)}</span></span>
        <span class="tiny">${r.catnr === iss.catnr ? "選んでいます" : "選ぶ →"}</span></button>
      <button type="button" class="iss-star" data-star="${i}" aria-pressed="${favSet.has(r.catnr)}" aria-label="${esc(r.main)}を${favSet.has(r.catnr) ? "お気に入りから外す" : "お気に入りに追加"}">${favSet.has(r.catnr) ? "★" : "☆"}</button></div>`).join("")
    + (canRemote ? `<button type="button" class="fav-btn" id="issPickRemoteRun" style="margin-top:8px">CelesTrak で英語名「${esc(q)}」を探す</button>` : "");
  $("issPickMore").hidden = list.length <= issPick.limit;
  $("issPickMore").textContent = `さらに表示（あと${Math.max(0, list.length - issPick.limit)}機）`;
  for (const el of $("issPickList").querySelectorAll("[data-pick]")) el.onclick = () => { const r = shown[+el.dataset.pick]; issChoose(r.catnr, r.tle); };
  for (const el of $("issPickList").querySelectorAll("[data-star]")) el.onclick = () => { const r = shown[+el.dataset.star]; issToggleFav(r.catnr, r.main); };
  if (canRemote) $("issPickRemoteRun").onclick = () => issPickRemote(q);
}

/// 選ぶ。軌道要素が手元にあれば取り直さない
function issChoose(catnr, tle) {
  iss.catnr = catnr;
  if (!ISS_PRESETS.some(([n]) => n === catnr)) {
    iss.extra = { catnr, name: (tle && tle.name) || (iss.names && iss.names.get(catnr) && iss.names.get(catnr).en) || `衛星 ${catnr}` };
    store.set("sorami.issSatExtra", iss.extra);
  }
  store.set("sorami.issSat", catnr);
  if (tle) issKeepTle(catnr, `${tle.name}\n${tle.line1}\n${tle.line2}`);
  issPickDone();
  issApply();
}

/// 開いているジャンルで、これから24時間に見える回。全機を順に解くので押したときだけ
async function issPickFindVisible() {
  const seq = ++issPick.visSeq, P = issFromPoint(), list = issPick.list;
  $("issPickVisible").disabled = true;   // 押した瞬間に止める（計算の部品を読む間に2回目が走らないように）
  let sat = null;
  try { sat = await issLoadSat(); } catch { sat = null; }
  if (seq !== issPick.visSeq || !P || !list.length) { $("issPickVisible").disabled = false; return; }
  if (!sat) { $("issPickInfo").textContent = "計算の部品を読めませんでした。もう一度押してください。"; $("issPickVisible").disabled = false; return; }
  $("issPickQuery").value = "";
  const found = [], from = Date.now();
  const observer = { latitude: P.latitude, longitude: P.longitude, elevation: P.elevation || 0 };
  for (let i = 0; i < list.length; i++) {
    try {
      for (const p of AstroNotesISS.passes(sat, list[i], { observer, fromMs: from, hours: 24, stepS: 60, minEl: 15 })) {
        if (p.visible) found.push({ tle: list[i], pass: p });
      }
    } catch { /* 解けない要素（落下直前など）は飛ばす */ }
    if (i % 15 === 14) {
      $("issPickInfo").textContent = `計算しています…（${i + 1}/${list.length}機）`;
      await new Promise((r) => setTimeout(r, 0));
      if (seq !== issPick.visSeq) return;
    }
  }
  // 並びは「見え始めの分」→ よく見る3機 → 日本語名のある衛星 → 衛星番号。
  // 2026-10-21 ユーザー「連打すると順番が変わる」: ISS にドッキング中の宇宙船など一緒に飛ぶ機体は見え始めが1秒も違わず、
  // 押した時刻で計算の刻みがずれるたびに前後が入れ替わっていた（0.3〜0.6秒差の2機で再現）。秒は画面に出していないので分でそろえる
  const rank = (t) => (ISS_PRESETS.some(([n]) => n === t.catnr) ? 0 : iss.names && iss.names.has(t.catnr) ? 1 : 2);
  found.sort((a, b) => Math.floor(a.pass.visible.start.at / 60000) - Math.floor(b.pass.visible.start.at / 60000)
    || rank(a.tle) - rank(b.tle) || a.tle.catnr - b.tle.catnr);
  // 同じ分に同じ方角を同じ高さで通る機体は、空では1つの光（ISS とドッキング中の宇宙船など）。1行にまとめ、並びの先頭（よく見る・日本語名あり）を代表に
  // （2026-10-21 ユーザー採用「全部出していいよ」）
  const merged = [];
  for (const f of found) {
    const v = f.pass.visible, minute = Math.floor(v.start.at / 60000);
    const g = merged.find((x) => x.minute === minute && issDir16(x.pass.visible.start.azimuth) === issDir16(v.start.azimuth)
      && issDir16(x.pass.visible.end.azimuth) === issDir16(v.end.azimuth) && Math.abs(x.pass.visible.max.elevation - v.max.elevation) <= 2);
    if (g) g.with.push(f.tle); else merged.push({ ...f, minute, with: [] });
  }
  issPick.visible = merged.slice(0, 40);
  $("issPickVisible").disabled = false;
  issPickRender();
}

IssMap.setOverlay((ctx, { project, width, height }) => {
  const P = issFromPoint();
  if (!P) return;
  const rows = iss.tab === "pass" ? [] : iss.result || [];
  const cs = getComputedStyle(document.documentElement);
  const color = cs.getPropertyValue(iss.tab === "pass" || iss.body === "moon" ? "--ray-moon" : "--ray-sun").trim() || "#2f7fd0";
  const ink = "rgba(0,0,0,.55)";
  if (iss.tab === "pass") issDrawTrack(ctx, project, color, ink, width, height);
  rows.forEach((r, i) => {
    const on = i === iss.pick;
    // 帯: 中心線の左右に半幅ずつ。中心線の向きに直角な向きへずらして塗る
    const pts = r.track.map((q) => project(q.latitude, q.longitude));
    if (pts.length < 2) return;
    const [x0, y0] = project(r.center.latitude, r.center.longitude);
    const [x1, y1] = project(r.center.latitude + r.halfWidthKm / 111.2, r.center.longitude);
    const half = Math.max(2, Math.abs(y1 - y0));
    ctx.save();
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.globalAlpha = on ? 0.28 : 0.14;
    ctx.strokeStyle = color; ctx.lineWidth = half * 2;
    ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ink; ctx.lineWidth = on ? 4 : 3;
    ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = on ? 2 : 1.4; ctx.stroke();
    // 印は**立つ場所（陸の上）**に付ける。中心線のいちばん近い点は海の上のことがあるので印を付けない
    if (on && r.stand) {
      const [sx, sy] = project(r.stand.latitude, r.stand.longitude);
      ctx.beginPath(); ctx.arc(sx, sy, 6, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
      const hms = new Date(r.at + 9 * 3600000).toISOString().slice(11, 19);
      aimMapLabel(ctx, sx, sy - 16, r.stand.name ? `${r.stand.name} ${hms}` : hms, "#fff", width, height, "center");
    }
    ctx.restore();
  });
  // いまの地点
  const [px, py] = project(P.latitude, P.longitude);
  ctx.save();
  ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2);
  ctx.fillStyle = ink; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
  aimMapLabel(ctx, px, py + 14, P.name, "#fff", width, height, "center");
  ctx.restore();
});

function openIss() {
  if (!renderToolAccess("iss")) { iss.seq++; return; }
  // 以前の「衛星を選ぶ」の道（#/iss/pick）で開かれたら、人工衛星の画面にして衛星を選ぶページを重ねる
  const picking = !!routeFromHash()?.issPick;
  if (picking) history.replaceState(history.state, "", "#/iss");
  if (!iss.wired) {
    iss.wired = true;
    $("issMoon").onclick = () => { iss.body = "moon"; issApply(); };
    $("issSun").onclick = () => { iss.body = "sun"; issApply(); };
    $("issRange").onchange = () => { iss.rangeKm = Number($("issRange").value) || 150; issApply(); };
    // 探す範囲の中心: カードを押すと「地点」の画面（検索・現在地・地図で選ぶ・お気に入り。ねらうと同じ部品）。
    // 立つ点ではないので ☆ は付けない
    $("issFromButton").onclick = () => openPlaceSheet("iss");
    $("issSatButton").onclick = () => issPickOpen();
    $("issPickClose").onclick = () => issPickDone();
    $("issPickMore").onclick = () => { issPick.limit += 200; issPickRender(); };
    $("issPickQuery").oninput = () => { clearTimeout(issPick.timer); issPick.timer = setTimeout(issPickRender, 150); };
    $("issPickVisible").onclick = () => issPickFindVisible();
    for (const [id, tab] of [["issPassTab", "pass"], ["issTransitTab", "transit"]]) {
      $(id).onclick = () => issSetTab(tab);
      $(id).onkeydown = (e) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
        e.preventDefault();
        issSetTab(e.key === "Home" ? "pass" : e.key === "End" ? "transit" : iss.tab === "pass" ? "transit" : "pass", true);
      };
    }
    // 計算中に押されたら、覚えるだけ（出来上がった一覧に効く。ここで書き直すと「見える回はありません」と出ていた）
    $("issShowAll").onchange = () => { iss.showAll = $("issShowAll").checked; if (!iss.passesReady) return; iss.passPick = -1; iss.track = []; issRenderPasses(); };
  }
  // 日本語名の表は、読めたらカードと一覧の名前を差し替える（読めなくても英語名で動く）
  issLoadNames().then(() => { if (viewState.iss) { issRenderSatCard(); if (iss.tab === "pass" && iss.passes.length) issRenderPasses(); } });
  requestAnimationFrame(() => {
    if (!viewState.iss || !toolAllowed("iss")) return;
    // 通過の回をもう選んでいれば、その通り道に合わせた位置のまま（地点へ戻さない）
    if (iss.tab === "pass" && iss.track.length) return;
    const P = issFromPoint();
    IssMap.open({ latitude: P.latitude, longitude: P.longitude }, iss.tab === "pass" ? 5 : 8);
    requestAnimationFrame(() => IssMap.redraw());
  });
  issApply();
  if (picking) issPickOpen();
}

function aimApply({ redraw = true, recenter = false } = {}) {
  if(globalThis.TrialExplore?.ownsScene?.()??globalThis.TrialExplore?.active()){globalThis.TrialExplore.invalidate();return false;}
  aimRenderSelectedPoint();
  if (!AstroNotesBodies.definition(aim.body).limbs && !AstroNotesBodies.ready()) {
    const request = ++aim.bodySeq;
    AstroNotesBodies.ensure(aim.body).then(() => { if(request === aim.bodySeq) aimApply({redraw,recenter}); }).catch(() => {
      if(request === aim.bodySeq) $("aimLineInfo").textContent = "天体計算を読み込めませんでした。天体を選び直して再試行してください";
    });
    return false;
  }
  // お気に入りは増えたり消えたりする（ほかの画面・同期）ので、毎回組み直す。消えた目標を選んでいたら先頭へ
  aimFillSelects();
  const wanted = $("aimTarget").value;   // "" は未選択
  const isFuji = wanted === "fuji";
  // 次に開いたときも同じ目標で開く
  store.set("sorami.aimTarget", wanted);
  // 富士山: 太陽の釦はダイヤモンド富士、月の釦はパール富士の許可で出す（許可は2つのまま。ユーザー指定）。
  // どちらも無い（URL を直接開いた）ときは両方出す。いまの天体が許されていなければ、許されている方へ
  const sunOk = !isFuji || toolAllowed("diamond"), moonOk = !isFuji || toolAllowed("pearl");
  const anyOk = sunOk || moonOk;
  const previousBody = aim.body;
  const newBodyOk = toolAllowed("tower") || !screenAllowed("framing");
  for (const option of $("aimBody").options) {
    const allowed = option.value === "sun" ? (!anyOk || sunOk) : option.value === "moon" ? (!anyOk || moonOk) : newBodyOk;
    option.disabled = !allowed; option.hidden = !allowed;
  }
  if (!AstroNotesBodies.definition(aim.body).limbs && !newBodyOk) aim.body = sunOk ? "sun" : "moon";
  if (aim.body === "sun" && anyOk && !sunOk) aim.body = "moon";
  if (aim.body === "moon" && anyOk && !moonOk) aim.body = "sun";
  if (previousBody !== aim.body) {
    aim.limb = aim.limbsByBody[aim.body] || "center";
    $("aimLimb").innerHTML = "";
    aimFillSelects();
  }
  store.set("sorami.aimBody", aim.body);
  const favT = wanted.startsWith("fav:") ? aimFavTargets().find((f) => `fav:${f.id}` === wanted) : null;
  aim.target = !wanted ? { id: "", name: "", parts: [] } : wanted === aim.sharedTarget?.id ? aim.sharedTarget : wanted === "custom"
    ? (aimCustomTarget() || { id: "custom", name: "他の対象", parts: [] })
    : favT ? aimFavTarget(favT)
    : aimWithHeights(AstroNotesAlign.targetById(wanted) || AstroNotesAlign.TARGETS[0]);
  // 他の目標・お気に入りの目標のときだけ、目標の場所のカード・高さの入力・地図の「ここに重ねる」を出す
  const customOn = wanted === "custom" || !!favT;
  $("aimTargetCard").hidden = true;
  $("aimCustomRow").hidden = true;
  $("aimPickTarget").hidden = true;
  if (customOn) aimRenderTargetCard();
  // 目標の高さの注記（塔だけ。富士山の山頂は当たり前なので出さない）
  // 自分で置く目標は、場所のカードに標高と高さを書くので、ここには出さない
  // 目標の高さの内訳（「地上の高さ＋地面の標高およそ2m」）は出さない（2026-10-01 細かい説明文は出さない）。推定の高さは下の欄で直す
  $("aimTargetNote").hidden = true;
  // 題名はいつも目標を選ぶ枠。富士山のときは枠の字を「ダイヤモンド富士」「パール富士」にする（有名な呼び名を残す）。
  // 太陽／月は題名の右で同じ位置
  $("aimTargetLabel").textContent = aimTitleFor().title;
  const single = $("aimTarget").options.length < 2;
  $("aimTarget").disabled = single;
  document.querySelector("#aimTargetPick .aim-pick").classList.toggle("single", single);
  $("aimView").classList.toggle("moon", aim.body === "moon");
  $("aimBody").value = aim.body;
  aim.limb = aim.matchMode === "overlap" ? "center" : aimLimbValue() || AstroNotesAlign.LIMBS[0].id;
  // **選び直した高さは、選択肢を作り直す前に読む。** aimFillParts は aim.partId で選び直すので、
  // 後で読むと元の値（先端）に戻る（2026-09-25 から 10-01 まで高さを替えられなかった。
  // ユーザー「スカイツリーで場所は曽谷を選んで、どこに重ねるかが先端から動かせない」）
  if(aim.matchMode === "overlap") {aim.partId=aimIsMountain(aim.target)?null:"__whole";$("aimPart").value=aim.partId||"";}
  else aim.partId = $("aimPart").value || aim.partId;
  aimFillParts();
  $("aimAlignmentDetails").hidden = !(aim.target?.parts||[]).length;
  $("aimAlignmentSummary").textContent = "重ね方";
  // 高さが推定の部位だけ、直せるようにする
  const part = (aim.target.parts || []).find((p) => p.id === aim.partId);
  $("aimHeightRow").hidden = !(part && part.adjustable);
  // 高さを直せない目標へ替えたら、前の目標の注記を残さない（ティンカーベルから富士山へ替えて「53m は…」が残っていた）
  if (!(part && part.adjustable)) $("aimHeightNote").textContent = "";
  if (part && part.adjustable) {
    const g = aim.target.groundM || 0;
    $("aimHeightM").value = String(Math.round(part.m - g));
    // 「◯m は地図の中心（◯km先）から ◯°」は出さない（2026-10-03 ユーザーが選んだ「いらない説明文」）
    $("aimHeightNote").textContent = "";
  }
  const picked = $("aimDate").value ? Date.parse(`${$("aimDate").value}T00:00:00+09:00`) : null;
  aim.dayMs = Number.isFinite(picked) ? picked : S.Cal.startOfDay(Date.now());
  if(aimAirEnsure(aimFromPoint(),aim.dayMs))return false;
  $("aimKeySet").textContent = aimSideLabel("set");
  $("aimKeyRise").textContent = aimSideLabel("rise");
  $("aimCalendarOpen").innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6M17 2v6M3 11h18"/></svg>${$("aimDate").value.replaceAll("-", "/")}(${S.Cal.weekday(aim.dayMs)})`;
  $("aimCalendarOpen").setAttribute("aria-label", `${$("aimDate").value.replaceAll("-", "/")}(${S.Cal.weekday(aim.dayMs)})、重なる日カレンダーを開く`);
  // 目標が決まっていなければ線は引けない（高さが無い）
  if (!(aim.target.parts || []).length) {
    aim.seq++; aim.candSeq++;
    aim.cands = []; aim.candPick = null; aim.wantSpot = null; aim.wantKey = null;
    aim.lines = [];
    aimRenderFrom();
    // 地図をまだ開いていなければ（中心が無ければ）、どこから重ねるかの地点で開く
    const c = AimMap.center();
    if (!c || !Number.isFinite(c.latitude)) AimMap.open(...aimMapView());
    else AimMap.redraw();
    $("aimLineInfo").textContent = ""; // 未選択の案内は対象の選択欄に表示する。
    $("aimLineTable").hidden = true;
    $("aimLineTable").replaceChildren(document.createElement('tbody'));
    $("aimList").innerHTML = "";
    $("aimCandBox").hidden = true;
    $("aimListBox").hidden = true;
    aim.cands = []; aim.candBusy = false; aimRefreshSheetCands();
    return false;
  }
  $("aimCandBox").hidden = false;
  // 目標を替えたら、その目標の線が入る倍率で開き直す
  if (recenter && Number.isFinite(aim.target.latitude)) {
    AimMap.open({ latitude: aim.target.latitude, longitude: aim.target.longitude },
      aimZoomFor(aim.target, aim.partId));
  }
  if (redraw) { aimRedrawLine(); aimRenderList(); aimRenderFrom(); }
  return true;
}

/// 日付。**今年でなければ年も書く**（400日先まで並べるので、同じ月日が2回出ることがある）
function aimDateLabel(ms) {
  const y = new Date(ms + 9 * 3600000).getUTCFullYear();
  const now = new Date(Date.now() + 9 * 3600000).getUTCFullYear();
  return `${y === now ? "" : `${y}/`}${S.Cal.monthDay(ms)}(${S.Cal.weekday(ms)}) ${S.JstCal.hhmm(ms)}`;
}

/// ダイヤモンド富士・パール富士の一覧は、主な観測スポットごとに次の日を出す
const aimIsFuji = () => aim.target && aim.target.id === "fuji";

function aimRenderList() {
  // 撮影地点の提案は、記録した地点を使う地図の一覧へ集約。
  $("aimListBox").hidden = true;
  $("aimList").replaceChildren();
}

function aimShowDay(day, spot = null) {
  $("aimDate").value = new Date(day + 9 * 3600000).toISOString().slice(0, 10);
  aim.spot = spot;
  // その日の候補地が出そろったら、このスポットを選んだ状態にする
  aim.wantSpot = spot ? spot.id : null;
  if (spot) AimMap.open({ latitude: spot.latitude, longitude: spot.longitude }, Math.max(10, Math.round(AimMap.zoom())));
  aimApply();
  window.scrollTo({ top: $("aimCanvas").getBoundingClientRect().top + window.scrollY - 80, behavior: "smooth" });
}

/**
 * 主な観測スポットと、それぞれで次に重なる日（2026-09-30）。
 * 以前は「いま選んでいる地点から見た日」だけで、どこへ行けばよいかが分からなかった（ユーザー指摘）。
 * 23か所×1年を解くので、1か所ずつ間をあけて描く（画面を止めない）。
 */
function aimSpotKey(now = Date.now()) {
  return JSON.stringify([aim.target, aim.body, aim.limb, AstroNotesAtmosphere.dataKey(now), S.Cal.startOfDay(now)]);
}
async function aimSpotRows() {
  const now = Date.now(), key = aimSpotKey(now), old = aim.spotWork;
  if (old?.key === key && now < old.until) return old.rows || old.promise;
  const target = aim.target, body = aim.body, limb = aim.limb;
  const work = { key, until: Infinity, rows: null, promise: null };
  aim.spotWork = work;
  work.promise = (async () => {
    const rows = [];
    let missingGround = false, usablePlaces = 0;
    const places = await aimPlaces();
    if (aim.spotWork !== work || aimSpotKey() !== key) return null;
    for (const place of places.filter(aimCandidateSiteSupported)) {
      if (aim.spotWork !== work || aimSpotKey() !== key) return null;
      const groundM = await AstroNotesTerrain.groundElevation(place.latitude, place.longitude).catch(() => null);
      if (aim.spotWork !== work || aimSpotKey() !== key) return null;
      if (!Number.isFinite(groundM)) { missingGround = true; continue; }
      usablePlaces++;
      const sp = {...place, groundM};
      await new Promise(resolve => setTimeout(resolve, 0));
      if (aim.spotWork !== work || aimSpotKey() !== key) return null;
      let ev = [];
      try { ev = AstroNotesAlign.upcoming(AstroNotesAlign.spotObserver(sp), target, body,
        { from: now, days: 400, limit: body === "moon" ? 12 : 4, limb, stepMs: 3600000, eyeM: sp.heightBasis === "published-viewpoint" ? 0 : 1.5,
          acceptEvent: e => e.rank !== "graze" && (body !== "moon" || e.sunAltitude < 0) && aimCandidateAccessible(sp, e.at) }); } catch (error) { throw error; }
      ev = ev.filter(e => e.rank !== "graze" && (body !== "moon" || e.sunAltitude < 0) && aimCandidateAccessible(sp, e.at));
      if (ev.length) rows.push({ sp, ev: ev.slice(0, 2) });
    }
    if (aim.spotWork !== work || aimSpotKey() !== key) return null;
    rows.sort((a, b) => a.ev[0].at - b.ev[0].at);
    if (missingGround && !usablePlaces) throw new Error("候補地の標高を取得できませんでした");
    work.rows = rows;
    work.until = Math.min(missingGround ? now + 60000 : Infinity, S.Cal.startOfDay(now) + 86400000, ...rows.flatMap(r => r.ev.map(e => e.at)));
    return rows;
  })().catch(error => { if (aim.spotWork === work) aim.spotWork = null; throw error; });
  return work.promise;
}
async function aimRenderSpots() {
  const seq = ++aim.spotSeq;
  const moon = aim.body === "moon";
  $("aimListTitle").textContent = "定番スポット";
  $("aimListSub").textContent = !AstroNotesBodies.definition(aim.body).limbs ? "次に富士山を通る日" : moon ? "次にパール富士が見える日" : "次にダイヤモンド富士が見える日";
  $("aimList").innerHTML = candidateWaitMarkup("計算中です…");
  let rows;
  try { rows = await aimSpotRows(); } catch {
    if (seq !== aim.spotSeq || !aimIsFuji()) return;
    $("aimList").innerHTML = '<p class="tiny" role="status">定番スポットの候補日を計算できませんでした。</p><button type="button" class="fav-btn" data-spot-retry>再試行</button>';
    $("aimList").querySelector('[data-spot-retry]').onclick = () => aimRenderSpots();
    return;
  }
  if (seq !== aim.spotSeq || !aimIsFuji()) return;
  if (rows === null) { aim.spotWork = null; return aimRenderSpots(); }
  if (!rows.length) { $("aimList").innerHTML = `<p class="tiny">この1年、見通しを確認したスポットで重なる日は見つかりません。</p>`; return; }
  $("aimList").innerHTML = rows.map(({ sp, ev }, i) => {
    const when = ev.map((e) => {
      const lit = moon ? ` ${moonGlyphAt(e.at, AstroNotesAlign.spotObserver(sp))}輝面${Math.round(e.illuminated * 100)}%` : "";
      const light = moon ? `<span class="sub-line">${esc(lightTimingText(e.at, AstroNotesAlign.spotObserver(sp)))}</span>` : "";
      return `<button class="tiny aim-day" data-spot="${i}" data-day="${S.Cal.startOfDay(e.at)}">${aimDateLabel(e.at)}`
        + `${aimSideName(e.side)}${lit}${light}</button>`;
    }).join("");
    const tags = [sp.kind, sp.deckM ? `地上${sp.deckM}m` : null, sp.note].filter(Boolean).join(" ・ ");
    return `<div class="al-row aim-spot">
      <div class="al-w"><strong>${esc(sp.name)}</strong>
        <span class="tiny">${esc(sp.address)}</span>
        <span class="tiny" style="color:var(--tertiary)">${esc(tags)}</span>
        <div class="aim-days">${when}</div></div></div>`;
  }).join("");
  for (const el of $("aimList").querySelectorAll("[data-day]")) {
    el.onclick = () => aimShowDay(+el.dataset.day, rows[+el.dataset.spot].sp);
  }
}
export {MAP_APPS,aimApply,aimDateLabel,aimIsFuji,aimRenderList,coordText,iss,issFromPoint,issSetFrom,openIss,openMapApp,openMapAppSheet,savedMapApp};
