import {$,S,esc} from '../../ui/presentation-helpers.js';
import {place,viewState} from '../../app/browser-state.js';
import {lightTimingText,moonGlyphAt,moonHorizon,observerHere} from '../forecast/view.js';
import {favForPoint,inheritedPoint,renameFromAfterFav,renderPointCard} from '../places/controller.js';
import {createMapView} from '../../ui/map/picker.js';
import {aimMapLabel} from '../framing/controller.js';
import {aimObserverAt,aimSavedFrom} from '../framing/observer.js';
import {nearName,openPlaceSheet} from '../places/search.js';
import {apiTransport,renderToolAccess,toolAllowed} from '../account/session-and-access.js';
// ---------------------------------------------------------------- 月丼
//
// 「ねらう」と同じ形。目標が**航路の上を動く点**になっただけ。
// 航路は `astronotes-routes.js` に形として持ってある（通信しない）。
// 運用の向き（北風・南風）はその日の風の予報から決める。
const plane = { dayMs: null, at: null, op: null, wind: null, map: null, observer: null, playback: null, mapSeq: AstroNotesLibrary.gate(), groundOverride: null, eyeOverride: null,
                result: null, seq: AstroNotesLibrary.gate(), wired: false, pick: 0,
                from: null,
                airport: null };   // 空港。null なら撮影地点にいちばん近い空港（2026-11-24 全空港へ）   // 撮影地点。null ならAstroNotesの地点を引き継ぐ（ねらうと同じ。2026-10-01）
/// 月丼の観測地点（候補の「ここ」）。替えていなければAstroNotesの地点
function planeFromPoint() { return plane.from || inheritedPoint(); }
function planeSetFrom(p) {
  plane.groundOverride = null; plane.eyeOverride = null;
  plane.from = p ? { ...p, name: p.name, subtitle: p.subtitle || "", latitude: p.latitude, longitude: p.longitude } : null;
  planeApply();
}

const PlaneMap = createMapView({ canvas: "planeCanvas", coord: "planeCoord", zoomIn: "planeIn", zoomOut: "planeOut" });

/// **空港の**風。いま選んでいる地点の風ではない（長野を選んでいても、効くのは空港の風）。
/// 以前は地点の予報を流用し、しかも**風向を数字で平均**していた。350°と10°の北風が
/// 平均で180°＝南風運用に化ける（2026-09-28 修正）。風だけの小さな取得で、30分使い回す
/// 空港で観測した風（METAR、過去7日）。今と過去の時刻は予報ではなくこれで運用を推定する（2026-11-24）。
/// ブラウザからは直接読めないので API を通す。取れなければ予報だけで続ける
async function planeLoadMetar() {
  const id = AstroNotesRoutes.AIRPORT.id;
  if (plane.metar && plane.metar.id === id && Date.now() - plane.metar.at < 10 * 60000) return plane.metar;
  let obs = [];
  try { obs = (await apiTransport("GET", `/aviation/metar?icao=${id}`))?.observations || []; } catch { obs = []; }
  plane.metar = { id, at: Date.now(), obs: obs.filter((o) => Number.isFinite(o.t) && Number.isFinite(o.wdir) && Number.isFinite(o.wspdKt)) };
  return plane.metar;
}
/// 羽田の実際の運用（国交省 羽田空港飛行コースホームページ、ATISに基づく30分ごとの表示・72時間分）。API を通す。
/// 今と過去72時間はこれで線を引き、無い時刻（未来・取れない時）は風と天候から推定する（2026-11-25）
async function planeLoadOps() {
  if (AstroNotesRoutes.AIRPORT.id !== "RJTT") return null;
  if (plane.ops && Date.now() - plane.ops.at < 10 * 60000) return plane.ops;
  let body = null;
  try { body = await apiTransport("GET", "/aviation/haneda-ops"); } catch { body = null; }
  const history = (body?.history || []).filter((e) => Number.isFinite(e.at) && Array.isArray(e.landing) && Array.isArray(e.takeoff));
  plane.ops = { at: Date.now(), fetchedAt: body?.fetchedAt ?? Date.now(), history, source: body?.source || "" };
  return plane.ops;
}
async function planeLoadWind() {
  if (plane.dayMs <= Date.now()) await Promise.all([planeLoadMetar(), planeLoadOps()]);
  const R = AstroNotesRoutes.AIRPORT;
  if (plane.wind && plane.wind.id === R.id && Date.now() - plane.wind.at < 30 * 60000) return plane.wind;
  const url = "https://api.open-meteo.com/v1/forecast?" + new URLSearchParams({
    latitude: R.latitude.toFixed(4), longitude: R.longitude.toFixed(4),
    hourly: "wind_direction_10m,wind_speed_10m,cloud_cover_low,precipitation", wind_speed_unit: "ms",
    timeformat: "unixtime", timezone: "Asia/Tokyo", forecast_days: "16", past_days: "2",
  });
  try {
    const res = await S.cachedFetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const h = j.hourly || {};
    plane.wind = { id: R.id, at: Date.now(), times: (h.time || []).map((s) => s * 1000),
      dir: h.wind_direction_10m || [], speed: h.wind_speed_10m || [], low: h.cloud_cover_low || [], rain: h.precipitation || [] };
  } catch { plane.wind = { id: R.id, at: Date.now(), times: [], dir: [], speed: [], low: [], rain: [] }; }
  return plane.wind;
}

/// その時刻の運用。**時刻ごとに決める**（風は一日のうちに変わり、南風の都心上空は15〜19時だけ）。
/// 風が分からない時刻は北風運用（羽田の基本）
function planeOpAt(at, { auto = false } = {}) {
  if (!AstroNotesRoutes.operationStatus(at).supported) return null;
  const local = new Date(at + 9 * 3600000), hour = local.getUTCHours() + local.getUTCMinutes() / 60;
  if (plane.op && !auto) return AstroNotesRoutes.operationChoice(plane.op, hour);
  const actual = planeActualAt(at);
  if (actual) return actual.op;
  const w = planeWindAt(at);
  if (!w) return null;
  if (AstroNotesRoutes.AIRPORT.id !== "RJTT") return AstroNotesRoutes.operationFor(w.direction, w.speed, hour);
  return AstroNotesRoutes.operationFor(w.direction, w.speed, hour, { fine: planeSkyAt(at)?.fine ?? true });
}

/// 国交省の表示のその時刻の行（30分ごと）。最後の行から35分より先は使わない（未来は推定に戻す）
function planeActualAt(at) {
  const o = plane.ops;
  if (!o || AstroNotesRoutes.AIRPORT.id !== "RJTT" || !o.history.length || at < o.history[0].at || at > o.history[o.history.length - 1].at + 35 * 60000) return null;
  let row = null;
  for (const e of o.history) { if (e.at <= at) row = e; else break; }
  if (!row) return null;
  return { ...row, op: planeOpOfRow(row, at) };
}
/// 表示の記号を区分の鍵へ。深夜（non）は着陸滑走路で北風・南風を分ける。知らない記号は滑走路と進入方式から読む
function planeOpOfRow(row, at) {
  const ops = AstroNotesRoutes.OPERATIONS;
  if (ops[row.code]) return row.code;
  const south = row.landing.some((r) => /^(16|22|23)/.test(r)), local = new Date(at + 9 * 3600000), hour = local.getUTCHours() + local.getUTCMinutes() / 60;
  if (row.code === "non") return south ? "nonS" : "nonN";
  const fine = /ILS X|HIGHWAY|LDA|RNP/.test(row.approach);
  if (south && row.landing.some((r) => r.startsWith("16"))) return fine ? "dsfi2" : "dsfo2";
  return AstroNotesRoutes.operationKey(south ? "south" : "north", hour, fine);
}

/// 好天か好天時以外か。国交省の72時間の区分と観測を突き合わせて決めた目安（2026-11-25、日中112件中101件一致）：
/// 曇り・ほぼ曇り（BKN/OVC）の雲底が8000ft未満か、雨・雪・霧があれば好天時以外。未来は予報の下層雲（63%以上＝BKN相当）と降水で同じ判定をする
function planeSkyAt(at) {
  const m = plane.metar;
  if (m && m.id === AstroNotesRoutes.AIRPORT.id && at <= Date.now() + 15 * 60000) {
    let best = null; for (const o of m.obs) { const d = Math.abs(o.t - at); if (d <= 45 * 60000 && (!best || d < Math.abs(best.t - at))) best = o; }
    if (best && (Number.isFinite(best.ceilingFt) || best.ceilingFt === null)) {
      const wet = /(RA|DZ|SN|SG|GR|GS|PL|TS|FG)/.test(best.weather || ""), low = Number.isFinite(best.ceilingFt) && best.ceilingFt < 8000;
      return { fine: !wet && !low, observed: true, at: best.t, text: `${Number.isFinite(best.ceilingFt) ? `雲底${best.ceilingFt}ft` : "低い雲なし"}${best.weather ? "・" + best.weather : ""}` };
    }
  }
  const w = plane.wind; if (!w || w.id !== AstroNotesRoutes.AIRPORT.id) return null;
  let index = -1, delta = Infinity;
  w.times.forEach((time, i) => { const d = Math.abs(time - at); if (d < delta) { delta = d; index = i; } });
  if (index < 0 || delta > 3600000 || !Number.isFinite(w.low?.[index])) return null;
  const rain = w.rain?.[index] ?? 0, low = w.low[index];
  return { fine: !(rain >= 0.1) && low < 63, observed: false, at: w.times[index], text: `下層雲${Math.round(low)}%${rain >= 0.1 ? `・降水${rain.toFixed(1)}mm` : ""}` };
}
/// その時刻の経路。国交省の表示があれば、その時に使っていた滑走路だけ（着陸が1本だけの時間もある）
function planePathsAt(at, op) {
  const paths = AstroNotesPlane.pathsFor(op, { landing: true, takeoff: true }), row = planeActualAt(at);
  if (!row || row.op !== op || plane.op) return paths;
  const kept = paths.filter((p) => (p.kind === "landing" ? row.landing : row.takeoff).includes(p.runway));
  return kept.length ? kept : paths;
}

/// 運用の名前。一日のうちに入れ替わる日は、出てくる順に並べる
function planeOpLabel(ops) {
  return [...new Set(ops.filter(Boolean))].map((o) => AstroNotesRoutes.OPERATIONS[o]?.name).filter(Boolean).join("・");
}
/// 上の釦に出す短い名前（例「北風新経路・悪天」）。羽田以外は運用の名前のまま
function planeOpShort(op) {
  const o = AstroNotesRoutes.OPERATIONS[op]; if (!o) return "";
  if (AstroNotesRoutes.AIRPORT.id !== "RJTT") return o.name.replace(/運用（.*）$/, "");
  if (o.night) return `深夜・${o.wind === "south" ? "南風" : "北風"}`;
  return `${o.wind === "south" ? "南風" : "北風"}${o.departure ? "新経路" : ""}・${o.arrival === "fine" ? "好天" : "悪天"}`;
}

/// その日の運用の移り変わり（「0〜14時 北風運用」のようにまとめる）
function planeOpSpans(dayMs, opts) {
  const out = [];
  for (let h = 0; h < 24; h += 0.5) {
    const op = planeOpAt(dayMs + h * 3600000, opts);
    const last = out[out.length - 1];
    if (last && last.op === op) last.to = h; else out.push({ op, from: h, to: h });
  }
  return out;
}

/// 撮影地点に合わせて空港を選ぶ（手で選んでいればそれ）。空港が替われば運用・風・地図を合わせ直す
function planeAirportId() {
  if (plane.airport && AstroNotesRoutes.airportById(plane.airport)) return plane.airport;
  const P = planeFromPoint();
  return AstroNotesRoutes.airportFor(P.latitude, P.longitude)?.airport.id || "RJTT";
}
function planeSyncAirport({ recenter = true } = {}) {
  const id = planeAirportId();
  const changed = AstroNotesRoutes.AIRPORT.id !== id;
  if (changed) { AstroNotesRoutes.selectAirport(id); plane.op = null; plane.wind = null; plane.metar = null; }
  if (changed || !$("planeOp").options.length) $("planeOp").innerHTML = '<option value="">風予報から推定</option>' + Object.entries(AstroNotesRoutes.OPERATIONS).filter(([, o]) => !o.night).map(([key, o]) => `<option value="${key}">${esc(o.name)}（手動）</option>`).join("");
  const A = AstroNotesRoutes.AIRPORT;
  // 2026-11-25 ユーザー「空港今はとかいらなくない？…自動選択（空港名）でよくない？」
  $("planeAirportNow").textContent = plane.airport ? A.shortName : `自動選択（${A.shortName}）`;
  $("planeAirportAuto").hidden = !plane.airport;
  planeAirportList();
  if (changed && recenter && viewState.plane) PlaneMap.open(AstroNotesRoutes.AIRPORT, 10);
  return changed;
}

/// 空港の候補。文字があれば名前・略称・IATA・ICAO で絞り、無ければ撮影地点から近い順
function planeAirportList() {
  const box = $("planeAirportResults"); if (!box) return;
  const q = $("planeAirportSearch").value.trim().toUpperCase().replace(/\s+/g, "");
  const P = planeFromPoint(), km = (a) => Math.hypot(a.latitude - P.latitude, (a.longitude - P.longitude) * Math.cos(P.latitude * Math.PI / 180)) * 111.2;
  let list = AstroNotesRoutes.AIRPORTS.map((a) => ({ a, d: km(a) }));
  if (q) {
    const score = ({ a }) => [a.id, a.iata].some((x) => x && x.toUpperCase() === q) ? 0 : a.shortName.toUpperCase().startsWith(q) || a.name.toUpperCase().startsWith(q) ? 1
      : [a.shortName, a.name, a.id, a.iata].some((x) => x && x.toUpperCase().includes(q)) ? 2 : 9;
    list = list.map((x) => ({ ...x, s: score(x) })).filter((x) => x.s < 9).sort((x, y) => x.s - y.s || x.d - y.d);
  } else list.sort((x, y) => x.d - y.d);
  const cur = AstroNotesRoutes.AIRPORT.id;
  box.innerHTML = list.length ? list.slice(0, 8).map(({ a, d }) => `<button type="button" role="listitem" data-airport="${a.id}" aria-current="${a.id === cur}"><span>${esc(a.shortName)}<small>　${esc(a.name)}</small></span><small>${a.iata ? esc(a.iata) + "・" : ""}${a.id}・${Math.round(d)}km</small></button>`).join("")
    : '<p>見つかりません。空港名・IATA（HND）・ICAO（RJTT）で探せます</p>';
}

// keepMap: 日付だけが変わった時。撮影地点は同じなので、新しい日の線ができるまで今の線と地点を残す
async function planeApply({keepMap = false} = {}) {
  if (!toolAllowed("plane")) return;
  planeSyncAirport();
  const seq = plane.seq.next();
  plane.result = null;
  if (!keepMap) { plane.mapSeq.cancel(); plane.map = null; plane.observer = null;
    $("planeMapStatus").textContent = "空港の風と撮影地点の高さを確認中…"; $("planeRouteDetails").replaceChildren(); PlaneMap.redraw(); }
  $("planeInfo").textContent = "この日の狙い目を計算中…";
  $("planeList").replaceChildren();
  const P = planeFromPoint();
  renderPointCard("planeFrom", P, null);$("planeFromChip").textContent = P.name;
  const saved = aimSavedFrom(P);
  let ground = plane.groundOverride ?? saved?.groundManualM;
  if (!Number.isFinite(ground)) {
    try { ground = await AstroNotesTerrain.groundElevation(P.latitude, P.longitude); } catch { ground = null; }
  }
  if (!plane.seq.current(seq) || !toolAllowed("plane")) return;
  const local = aimObserverAt(saved, ground);
  const agl = plane.eyeOverride ?? (P.inherited ? observerHere().eyeHeightAGL : local.eyeM);
  plane.observer = { latitude:P.latitude, longitude:P.longitude, groundM:ground, eyeHeightAGL:agl };
  $("planeGround").value = plane.groundOverride ?? saved?.groundManualM ?? "";
  $("planeGround").placeholder = Number.isFinite(ground) ? ground.toFixed(1) : "標高を取得できません";
  $("planeEye").value = String(agl);
  $("planeHeightSummary").textContent = Number.isFinite(ground) ? `標高 ${ground.toFixed(1)}m ＋ レンズ高 ${agl.toFixed(1)}m` : "標高を取得できません — 手入力できます";
  renderPointCard("planeFrom", P, ground);$("planeFromChip").textContent = P.name;
  await planeLoadWind();
  if (!plane.seq.current(seq) || !toolAllowed("plane")) return;
  const spans = planeOpSpans(plane.dayMs);
  const paths = [];
  // 同じ滑走路でも区分で経路が違う（好天は ILS X、悪天は ILS Z など）。区分ごとに別の経路として持つ
  for (const op of new Set(spans.map(s=>s.op).filter(Boolean))) {
    for (const path of AstroNotesPlane.pathsFor(op, {landing:true,takeoff:true})) { const p = { ...path, id: `${path.id}｜${op}`, op }; if (!paths.some(q=>q.id===p.id)) paths.push(p); }
  }
  const activeAt = (path, at) => {
    const op = planeOpAt(at);
    return path.op === op && planePathsAt(at, op).some((q) => q.kind === path.kind && q.runway === path.runway);
  };
  const here = {id:"here",name:`${P.name}（撮影地点）`,latitude:P.latitude,longitude:P.longitude,elevationM:ground,eyeHeightAGL:agl,
    horizonAt:P.inherited ? moonHorizon : null,note:`標高 ${Math.round(ground)}m・レンズ高 ${agl.toFixed(1)}m`};
  let spotGrounds;
  try { spotGrounds = await AstroNotesTerrain.elevations(AstroNotesRoutes.SPOTS,{zoom:13,indexedExactBatch:true}); } catch { spotGrounds = []; }
  if (!plane.seq.current(seq) || !toolAllowed("plane")) return;
  const measuredSpots = AstroNotesRoutes.SPOTS.map((spot,i)=>({...spot,elevationM:spotGrounds[i]})).filter(spot=>Number.isFinite(spot.elevationM));
  const known = Number.isFinite(ground) ? [here,...measuredSpots] : measuredSpots;
  const spots = paths.length ? AstroNotesPlane.rankSpots(plane.dayMs,paths,known,{stepMin:2,limit:8,activeAt}) : [];
  const moon = AstroNotesAstro.moon(plane.at,{latitude:P.latitude,longitude:P.longitude,elevation:Number.isFinite(ground)?ground+agl:0});
  plane.result = {spots,paths,spans,missingSpots:AstroNotesRoutes.SPOTS.length-measuredSpots.length,illuminated:moon.illuminatedFraction};
  plane.pick = -1; planeRender();
  planeUpdateMap();
}

/// 期待機数の言い方。**確率ではなく、その時間に円盤の前を通る機数の平均。**
/// 1機に満たない日も多いので「約0機」とは言わない
function planeExpect(n) {
  if (!AstroNotesRoutes.HAS_TRAFFIC) return "便数は未確認（時刻表と照らしてください）";
  if (!(n > 0)) return "通る機はまれ";
  if (n < 1) return `便数の目安 ${n.toFixed(1)}機`;
  return `便数の目安 ${n.toFixed(1)}機`;
}

function planeRender() {
  const r = plane.result;
  const opLine = (s) => {
    const o = AstroNotesRoutes.OPERATIONS[s.op];
    if (!o) return `${s.from}〜${s.to + 0.5}時 未計算`;
    return `${s.from}〜${s.to + 0.5}時 ${o.name}・着陸 ${o.landing.join("・")}・離陸 ${o.takeoff.join("・")}`;
  };
  // 運用の欄は「風から決める」を出さず、**予報から決まる運用そのものを選んだ形**で出す
  // （2026-10-01 ユーザー「風から決めるはいらなくない？今の運用を自動で選択させたらいい」）。
  // 南風の日は 15〜19時だけ都心上空で、ほかは湾側。計算は今までどおり時刻ごとに切り替える
  const auto = planeOpSpans(plane.dayMs, { auto: true });
  const w = plane.wind, m = plane.metar;
  const covered = !!w && w.times.some((t) => t >= plane.dayMs && t < plane.dayMs + 86400000);
  const observed = !!m && m.id === AstroNotesRoutes.AIRPORT.id && m.obs.some((o) => o.t >= plane.dayMs && o.t < plane.dayMs + 86400000);
  const kind = observed && plane.dayMs + 86400000 <= Date.now() ? "観測" : observed ? "観測と予報" : "予報";
  $("planeOp").options[0].textContent = covered || observed ? `${kind}：${planeOpLabel([...new Set(auto.map((x) => x.op))])}` : "風予報なし：運用を選択";
  // 下の一行は滑走路（と、切り替わる日は時刻）。運用の名前は欄に出ているので繰り返さない
  const runways = (op) => { const o = AstroNotesRoutes.OPERATIONS[op]; return o ? `着陸 ${o.landing.join("・")}・離陸 ${o.takeoff.join("・")}` : "運用不明"; };
  $("planeOpNote").textContent = r.spans.filter(s=>s.op).map(opLine).join(" ／ ") || "風を取得できない場合は想定する運用を選べます";
  $("planePick").innerHTML = "";
  $("planePick").hidden = true;
  $("planeList").replaceChildren();
  const P = planeFromPoint();
  if (!r.spots.length) {
    $("planeInfo").textContent = r.paths.length ? (r.missingSpots ? "一部の候補地点は標高を取得できませんでした。計算できた地点では候補がありません。" : "対応する時間帯・代表経路では、この日の候補が見つかりませんでした。") : "この日の運用を推定できないため、狙い目を計算できません。";
    return;
  }
  // The recommended first row is also the selectable map result; do not repeat it above the list.
  const top = r.spots[0];
  // **重なる瞬間を言う。** 月の通り道と航路の交点を解いているので、分まで出せる
  const b = top.best;
  const sun0 = b.sunAltitude;
  const half = (b.windowMin || 0) * 30000;
  const lit = r.illuminated !== null && r.illuminated !== undefined
    ? `${moonGlyphAt(b.at, P)} 月の輝面 ${Math.round(r.illuminated * 100)}%。` : "";
  // 説明の段落は出さない（2026-09-30 ユーザー指摘「説明する必要がないもの多い」）。輝面だけ
  // 観測地点から重ならない日は、そう言う（定番の場所だけが並んで、観測地点の結果が黙って消えないように）
  const missed = r.spots.some((sp) => sp.spot.id === "here") ? "" : Number.isFinite(plane.observer?.groundM) ? `${P.name}からは対応時間帯の候補がありません。` : "撮影地点の標高が不明です。";
  $("planeInfo").innerHTML = (esc(missed) + lit).replace(/。$/, "");
  $("planeList").innerHTML = r.spots.map((sp, i) => {
    const when = sp.windows.map((w) => (w.from === w.to
      ? S.JstCal.hhmm(w.from) : `${S.JstCal.hhmm(w.from)}〜${S.JstCal.hhmm(w.to)}`)).join("、");
    const sun = sp.best.sunAltitude;
    const light = sun < -6 ? "夜" : sun < 0 ? "薄明" : "昼";
    return `<button class="al-row jump" data-spot="${i}" aria-pressed="${i===plane.pick}">
      <span class="al-w"><strong>${i===0?'おすすめ ・ ':''}${i + 1}. ${esc(sp.spot.name)}</strong>
        <span class="muted">${S.JstCal.hhmm(sp.best.at)}に重なる ・ ${when} ・ ${light} ・ ${planeExpect(sp.planes)}</span>
        <span class="muted">${esc(lightTimingText(sp.best.at, sp.spot))}</span>
        <span class="muted">機まで ${sp.best.planeKm.toFixed(1)}km（高度 ${Math.round(sp.best.altitudeM)}m）
        ・${moonGlyphAt(sp.best.at, sp.spot)} 月 方位${Math.round(sp.best.moonAz)}°・高さ${Math.round(sp.best.moonAlt)}°
        ・${esc(sp.paths.join("・"))}</span>
        <span class="muted">${esc(sp.spot.note)}</span>
      </span>
      <span class="tiny" data-plane-map-label>${i===plane.pick?'表示中':'地図に表示'}</span>
    </button>`;
  }).join("");
  for (const el of $("planeList").querySelectorAll("[data-spot]")) {
    el.onclick = () => {
      plane.pick = Number(el.dataset.spot);planeSheet(null);
      for(const row of $("planeList").querySelectorAll('[data-spot]')){const on=Number(row.dataset.spot)===plane.pick;row.setAttribute('aria-pressed',String(on));row.querySelector('[data-plane-map-label]').textContent=on?'表示中':'地図に表示';}
      const sp = plane.result.spots[plane.pick];
      plane.playback?.stop(false);
      plane.at = sp.best.at; plane.dayMs = S.Cal.startOfDay(plane.at); planeSyncTime();
      const chosen = sp.spot;
      planeSetFrom({name:chosen.name.replace(/（撮影地点）$/, ''),latitude:chosen.latitude,longitude:chosen.longitude,groundManualM:chosen.elevationM,standAglM:chosen.eyeHeightAGL ?? ((chosen.deckM||0)+1.5)});
      PlaneMap.open({ latitude: sp.spot.latitude, longitude: sp.spot.longitude }, 12);
      requestAnimationFrame(() => PlaneMap.redraw());
    };
  }
}

// Both map layers use this one instant and one observer-height contract.
function planeSyncTime() {
  ToolDateTimeBar.dateText($("planeDate"),plane.at);
  $("planeDate").setAttribute("aria-label",ToolDateTimeBar.label(plane.at));
  $("planeTime").value = S.JstCal.hhmm(plane.at);
  if(plane.timeline){ToolDateTimeBar.modeButton($("planeScrubMode"),plane.scrub);if(!plane.scrubbing)plane.timeline.sync(plane.at,plane.scrub);}
}
function planeSetAt(at) {
  if (!Number.isFinite(at) || !toolAllowed("plane")) return;
  const day = S.Cal.startOfDay(at), changed = day !== plane.dayMs;
  plane.at=at; plane.dayMs=day; planeSyncTime();
  if(changed)planeApply({keepMap:!!plane.observer}); else planeUpdateMap();
}
function planeWindAt(at) {
  // 今より前で、45分以内の観測があればそれ（METARは30分ごと）
  const m=plane.metar;
  if(m&&m.id===AstroNotesRoutes.AIRPORT.id&&at<=Date.now()+15*60000){
    let best=null;for(const o of m.obs){const d=Math.abs(o.t-at);if(d<=45*60000&&(!best||d<Math.abs(best.t-at)))best=o;}
    if(best)return {at:best.t,direction:best.wdir,speed:best.wspdKt*0.514444,observed:true};
  }
  const w=plane.wind;if(!w||w.id!==AstroNotesRoutes.AIRPORT.id)return null;
  let index=-1,delta=Infinity;
  w.times.forEach((time,i)=>{const d=Math.abs(time-at);if(d<delta){delta=d;index=i;}});
  if(index<0||delta>3600000||!Number.isFinite(w.dir[index])||!Number.isFinite(w.speed[index]))return null;
  return {at:w.times[index],direction:w.dir[index],speed:w.speed[index]};
}
async function planeUpdateMap() {
  if(!toolAllowed("plane")||!plane.observer)return;
  const token=plane.mapSeq.next(),at=plane.at;
  const current=()=>plane.mapSeq.current(token)&&toolAllowed("plane")&&viewState.plane;
  // 前の時刻の線は、新しい時刻の線ができるまで残す（2026-11-25 ユーザー「時間を動かすと一回一回線が消えたり出たり」）
  const status=AstroNotesRoutes.operationStatus(at),op=planeOpAt(at),wind=planeWindAt(at);
  const o=AstroNotesRoutes.OPERATIONS[op];
  // 決め方は3つ：国交省の実際の運用（今と過去72時間）、観測（METAR）、予報。手動で選べばそれ
  const actual=plane.op?null:planeActualAt(at),sky=AstroNotesRoutes.AIRPORT.id==="RJTT"?planeSkyAt(at):null;
  const mode=plane.op?"手動":actual?"実際":wind?.observed?"観測":"予報";
  const autoOp=planeOpAt(at,{auto:true});
  $("planeOp").options[0].textContent=autoOp?`${actual?"実際（国交省）":wind?.observed?"観測":"予報"}：${AstroNotesRoutes.OPERATIONS[autoOp]?.name||"運用不明"}`:"風予報なし：運用を選択";
  const basis=actual?`${S.JstCal.hhmm(actual.at)}の国交省の表示：${actual.approach}`
    :[wind?`${S.JstCal.hhmm(wind.at)}の${wind.observed?"観測風（METAR）":"風予報"} ${Math.round(wind.direction)}°から ${wind.speed.toFixed(1)}m/s`:"この時刻の風を取得できません",
      sky?`${sky.observed?"観測":"予報"}の${sky.text}→${sky.fine?"好天":"好天時以外"}`:""].filter(Boolean).join("・");
  const lands=actual?actual.landing:o?.landing,takes=actual?actual.takeoff:o?.takeoff;
  $("planeOpNote").textContent=basis+(o?` ／ ${mode}：着陸 ${lands.join("・")}／離陸 ${takes.join("・")}`:"");
  const short=AstroNotesRoutes.AIRPORT.shortName;
  $("planeOpChip").textContent=short+"・"+(!status.supported?"深夜は未対応":o?planeOpShort(op):"運用を選ぶ");$("planeOpMode").textContent=status.supported&&o?mode:"";
  if(!status.supported){plane.map=null;PlaneMap.redraw();$("planeRouteDetails").replaceChildren();$("planeMapStatus").textContent="23〜6時の深夜経路は未対応のため、この時刻の範囲は計算できません。";return;}
  if(!o){plane.map=null;PlaneMap.redraw();$("planeRouteDetails").replaceChildren();$("planeMapStatus").textContent="風予報がないため運用を推定できません。運用を手動で選ぶと計算できます。";return;}
  const paths=planePathsAt(at,op);
  const overlap=AstroNotesPlane.routeOverlapAt(at,plane.observer,paths);
  // 立ち位置の帯は地形で確かめ終わるまで前の時刻のものを出しておく（数分の差なら位置はほぼ同じ）
  const prev=plane.map;plane.map={at,paths,overlap,polygons:prev?.polygons||[],centerLines:prev?.centerLines||[],pending:true,missing:0};
  planeMapText();PlaneMap.redraw();
  if(overlap.status==="invalid-time")return;
  // Start from inverse rays, then resolve each vertex against actual terrain. A seed is never a colored result.
  const seeds=AstroNotesPlane.groundRibbonSeedsAt(at,paths,{eyeHeightAGL:plane.observer.eyeHeightAGL,stepKm:0.5,minPlaneKm:2,maxPlaneKm:20,capSteps:6});
  let samples=seeds.seeds.map(s=>({...s}));
  for(let pass=0;pass<4;pass++){
    if(!current())return;
    const active=samples.filter(s=>Number.isFinite(s.latitude)&&Number.isFinite(s.longitude)&&!s.failed);
    if(!active.length)break;
    let heights;
    // Points whose 10 m DEM tile does not exist are open sea (Tokyo Bay). Answer them as sea level instead of
    // falling back to Open-Meteo, which rate-limits (429) when a route runs over the bay.
    // 国土地理院の標高タイルに値が無い所は海。そこには立てないので候補にしない（2026-11-25 ユーザー「海の上になったら行けないからなくていい」）。
    // 予備の標高サービスへは問い合わせない（海の点で429になり、陸まで欠けていた）
    const noFallback=async url=>{const n=String(url).split('latitude=')[1].split('&')[0].split(',').length;return {ok:true,status:200,json:async()=>({elevation:new Array(n).fill(null)})};};
    try{heights=await AstroNotesTerrain.elevations(active,{zoom:13,indexedExactBatch:true,fetchImpl:noFallback});}catch{heights=active.map(()=>null);}
    if(!current())return;
    for(let i=0;i<active.length;i++){
      const sample=active[i],ground=heights[i];
      if(!Number.isFinite(ground)){sample.failed=true;continue;}
      const inverse=AstroNotesPlane.inverseGroundAt(at,sample.planePoint,{groundM:ground,eyeHeightAGL:plane.observer.eyeHeightAGL,anchor:sample,diskAngle:sample.diskAngle,minPlaneKm:2,maxPlaneKm:20});
      if(!["ready","out-of-range"].includes(inverse.status)){sample.failed=true;continue;}
      const delta=Number.isFinite(sample.groundM)?Math.abs(sample.groundM-ground):Infinity;
      Object.assign(sample,inverse,{terrainVerified:pass>0&&delta<1});
    }
    if(samples.every(s=>s.failed||s.terrainVerified))break;
  }
  if(!current())return;
  const byId=new Map(samples.map(s=>[s.id,s])),polygons=[];
  const known=id=>{const p=byId.get(id);return p&&!p.failed&&p.terrainVerified&&p.status==="ready"?p:null;};
  // The ribbon is only as wide as the Moon's disk (tens of metres), so its verified centre is drawn as a line.
  const centerLines=[];
  for(const ribbon of seeds.ribbons){
    let run=[];
    for(const section of ribbon.sections){const c=known(section.centerId);if(c)run.push(c);else{if(run.length>1)centerLines.push({pathId:ribbon.pathId,kind:ribbon.kind,points:run});run=[];}}
    if(run.length>1)centerLines.push({pathId:ribbon.pathId,kind:ribbon.kind,points:run});
  }
  for(const ribbon of seeds.ribbons){
    for(let i=1;i<ribbon.sections.length;i++){
      const a=ribbon.sections[i-1],b=ribbon.sections[i];
      const vertices=[known(a.leftId),known(b.leftId),known(b.rightId),known(a.rightId)];
      if(vertices.every(Boolean))polygons.push({pathId:ribbon.pathId,points:vertices});
    }
    for(const ids of [ribbon.startCapIds,ribbon.endCapIds]){
      const vertices=(ids||[]).map(known);if(vertices.length>=3&&vertices.every(Boolean))polygons.push({pathId:ribbon.pathId,points:vertices});
    }
  }
  plane.map={at,paths,overlap,polygons,centerLines,pending:false,missing:samples.filter(s=>s.failed||!s.terrainVerified).length};
  planeMapText();PlaneMap.redraw();
}
// この日、選んだ地点で月が航路に重なる時刻（1分刻み）。運用は各時刻の風で決める
// 2026-11-25 ユーザー「重なるなら重なる目安の時間を表示してよ」
function planeWindowKey(){return JSON.stringify([plane.dayMs,plane.observer,plane.op,AstroNotesRoutes.AIRPORT.id,plane.metar?.obs?.length||0,plane.wind?.at||0,plane.ops?.history?.length||0,plane.ops?.history?.at(-1)?.at||0]);}
function planeWindows(){
  if(!plane.observer||!Number.isFinite(plane.dayMs))return null;
  const key=planeWindowKey();
  if(plane.windows?.key===key)return plane.windows.list;
  const job={key,list:null};plane.windows=job;
  const hits=[],cache={},end=plane.dayMs+86400000;let t=plane.dayMs;
  const step=()=>{
    if(plane.windows!==job)return;
    for(const stop=Math.min(end,t+180*60000);t<stop;t+=60000){
      const op=planeOpAt(t);if(!op)continue;
      const row=planeActualAt(t),k=row&&!plane.op?`${op}|${row.landing}|${row.takeoff}`:op;
      const paths=cache[k]||(cache[k]=planePathsAt(t,op));
      if(AstroNotesPlane.routeOverlapAt(t,plane.observer,paths).overlaps?.length){const last=hits[hits.length-1];if(last&&t-last[1]<=60000)last[1]=t;else hits.push([t,t]);}
    }
    if(t<end){setTimeout(step,0);return;}
    job.list=hits;if(plane.map&&!plane.map.pending)planeMapText();
  };
  setTimeout(step,0);
  return null;
}
// 撮影地点から青い中心線までの最短距離と方角
function planeNearestLine(P,lines){
  if(!P||!lines?.length)return null;
  const kx=111.32*Math.cos(P.latitude*Math.PI/180),ky=110.57,xy=q=>[(q.longitude-P.longitude)*kx,(q.latitude-P.latitude)*ky];
  let best=null;
  for(const line of lines)for(let i=1;i<line.points.length;i++){
    const [ax,ay]=xy(line.points[i-1]),[bx,by]=xy(line.points[i]),dx=bx-ax,dy=by-ay,L=dx*dx+dy*dy;
    const t=L?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/L)):0,x=ax+t*dx,y=ay+t*dy,km=Math.hypot(x,y);
    if(!best||km<best.km)best={km,x,y};
  }
  if(!best)return null;
  const deg=(Math.atan2(best.x,best.y)*180/Math.PI+360)%360;
  return {km:best.km,dir:['北','北東','東','南東','南','南西','西','北西'][Math.round(deg/45)%8]};
}
function planeMapText(){
  const r=plane.map;if(!r)return;
  // 短い行だけにする（2026-11-25 ユーザー「13:38 · 現在地からっている？」「月 方位…／重なる目安…みたいな感じでシンプルに」）。
  // 時刻と地点は下の時間バーと上の釦にある。海の上を出さない説明は凡例・出典へ
  const m=r.overlap.moon,P=planeFromPoint(),w=planeWindows(),fmt=km=>km<1?Math.round(km*1000)+'m':km.toFixed(1)+'km';
  let first,second,third='';
  if(r.overlap.status==='missing-elevation'){first='標高が不明のため計算できません';second='';}
  else{
    first=m&&Number.isFinite(m.apparentAltitude)?`月 方位${m.azimuth.toFixed(1)}°・高さ${m.apparentAltitude.toFixed(1)}°`:'月の位置を計算中…';
    if(r.overlap.overlaps?.length)first+=' ・ 今、金色の区間で重なります';
    second=w?(w.length?'重なる目安 '+w.slice(0,3).map(([a,b])=>a===b?S.JstCal.hhmm(a)+'頃':S.JstCal.hhmm(a)+'〜'+S.JstCal.hhmm(b)).join('、')+(w.length>3?' ほか':''):'この日はここで重なる時刻なし'):'重なる時刻を計算中…';
    const n=!r.pending&&!r.overlap.overlaps?.length&&r.overlap.status==='ready'?planeNearestLine(P,r.centerLines):null;
    if(n)third=`今は青い線まで${n.dir}へ${fmt(n.km)}`;
  }
  $("planeMapStatus").textContent=[first,second,third].filter(Boolean).join('\n');
  const kinds=[['landing','着陸'],['takeoff','離陸']].filter(([k])=>r.paths.some(p=>p.kind===k));
  $("planeRouteDetails").innerHTML=kinds.map(([k,label])=>`<span style="display:inline-flex;align-items:center;gap:5px;margin-right:12px;white-space:nowrap"><svg width="26" height="8" aria-hidden="true"><line x1="2" y1="4" x2="24" y2="4" stroke="${PLANE_ROUTE_COLORS[k]}" stroke-width="4" stroke-linecap="round"${k==='takeoff'?' stroke-dasharray="6 4"':''}/></svg><b>${label}</b> ${r.paths.filter(p=>p.kind===k).map(p=>esc(p.runway)).join('・')}</span>`).join('')
    +`<span style="display:inline-flex;align-items:center;gap:5px;margin-right:12px;white-space:nowrap"><svg width="26" height="14" aria-hidden="true"><line x1="6" y1="7" x2="20" y2="7" stroke="#2f7fd0" stroke-opacity=".38" stroke-width="12" stroke-linecap="round"/></svg><b>立ち位置</b></span>`
    +(r.overlap.overlaps?.length?`<span style="display:inline-flex;align-items:center;gap:5px;margin-right:12px;white-space:nowrap"><svg width="26" height="10" aria-hidden="true"><line x1="3" y1="5" x2="23" y2="5" stroke="white" stroke-width="9" stroke-linecap="round"/><line x1="3" y1="5" x2="23" y2="5" stroke="var(--ray-sun)" stroke-width="5" stroke-linecap="round"/></svg><b>月と重なる区間</b></span>`:'')
    +`<div class="tiny">${r.paths.map(p=>`${esc(p.runway)} ${p.kind==='landing'?'着陸':'離陸'}：${p.model==='procedure'?esc(p.source):'滑走路の延長の直線のみ（公表の経路は未反映）'}`).join(' · ')}</div>`;
}
// Landings purple and solid, take-offs teal and dashed. The soft blue band is where to stand, gold the overlap.
const PLANE_ROUTE_COLORS={landing:'#7b3fbf',takeoff:'#00897b'};
function planeRouteColor(paths,path){return PLANE_ROUTE_COLORS[path.kind]||PLANE_ROUTE_COLORS.landing;}
PlaneMap.setOverlay((ctx,{project,width,height})=>{
  if(!toolAllowed("plane")||!planeFromPoint())return;
  // 計算の間も撮影地点と空港は描く（2026-11-25 ユーザー「撮影地点も消えたり出たり」）
  const r=plane.map||{paths:[],polygons:[],centerLines:[],overlap:{overlaps:[]}};
  const cs=getComputedStyle(document.documentElement),sunC=cs.getPropertyValue('--ray-sun').trim(),ink=cs.getPropertyValue('--secondary').trim();
  const trace=points=>{ctx.beginPath();const xy=points.map(p=>project(p.latitude,p.longitude));if(!xy.length)return;ctx.moveTo(...xy[0]);
    // Midpoint quadratic smoothing keeps sampled curves round on screen without moving the endpoints.
    for(let i=1;i<xy.length-1;i++)ctx.quadraticCurveTo(xy[i][0],xy[i][1],(xy[i][0]+xy[i+1][0])/2,(xy[i][1]+xy[i+1][1])/2);
    if(xy.length>1)ctx.lineTo(...xy[xy.length-1]);};
  ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
  // 地図を白く薄める層は置かない（2026-11-25 ユーザー「地図の上に薄く白い何かがかかってる…いらないのでは」）
  // Where to stand is an area, drawn as a soft wide band under the crisp, cased flight lines.
  // Painted opaque on a separate layer and laid down once, so crossing bands do not darken each other.
  const band=document.createElement('canvas');band.width=ctx.canvas.width;band.height=ctx.canvas.height;
  const main=ctx;ctx=band.getContext('2d');ctx.setTransform(main.getTransform());ctx.lineCap='round';ctx.lineJoin='round';
  // The base map stays light in dark mode, so the band keeps the light-theme blue.
  const bandC='#2f7fd0';ctx.fillStyle=bandC;ctx.globalAlpha=.6;
  for(const polygon of r.polygons){ctx.beginPath();polygon.points.forEach((p,i)=>{const [x,y]=project(p.latitude,p.longitude);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.closePath();ctx.fill();}
  ctx.globalAlpha=1;ctx.strokeStyle=bandC;ctx.lineWidth=16;
  for(const line of r.centerLines||[]){trace(line.points);ctx.stroke();}
  ctx=main;ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=.38;ctx.drawImage(band,0,0);ctx.restore();
  // 帯は見やすさのための太さ。実際に重なる幅は数十mなので、中心を細い線で示す（2026-11-25 ユーザー「青いところにあるのに重ならない」）
  ctx.strokeStyle='#1d5fa8';ctx.lineWidth=2;for(const line of r.centerLines||[]){trace(line.points);ctx.stroke();}
  for(const path of r.paths){
    const color=planeRouteColor(r.paths,path),dash=path.kind==='takeoff'?[12,9]:[];
    ctx.setLineDash(dash);ctx.strokeStyle='rgba(255,255,255,.9)';ctx.lineWidth=8;trace(path.points);ctx.stroke();ctx.strokeStyle=color;ctx.lineWidth=4;ctx.stroke();
    // The straight final before touchdown is drawn solid and heavier.
    const near=path.kind==='landing'?path.points.filter(p=>p.distanceKm<=8):[];
    if(near.length>1){ctx.setLineDash([]);trace(near);ctx.strokeStyle='rgba(255,255,255,.95)';ctx.lineWidth=11;ctx.stroke();ctx.strokeStyle=color;ctx.lineWidth=6;ctx.stroke();}
    ctx.setLineDash([]);
    // One arrow per route, on a straight stretch. The smoothed trace passes exactly through each segment's midpoint
    // with that segment's direction, so the arrow sits on the drawn line and points along it.
    const xy=path.points.map(p=>project(p.latitude,p.longitude)),seg=[0];
    for(let i=1;i<xy.length;i++)seg.push(seg[i-1]+Math.hypot(xy[i][0]-xy[i-1][0],xy[i][1]-xy[i-1][1]));
    const total=seg[seg.length-1];if(total<80)continue;
    const dir=i=>Math.atan2(xy[i][1]-xy[i-1][1],xy[i][0]-xy[i-1][0]),turn=(a,b)=>Math.abs(((b-a)+3*Math.PI)%(2*Math.PI)-Math.PI);
    const target=total*(path.kind==='landing'?.45:.4);let best=null;
    for(let i=1;i<xy.length;i++){
      const m=(seg[i-1]+seg[i])/2;if(m<total*.2||m>total*.8||seg[i]-seg[i-1]<1)continue;
      // Largest heading change of any segment within 40 px either side.
      let bend=0;for(let j=1;j<xy.length;j++)if(Math.abs((seg[j-1]+seg[j])/2-m)<=40&&seg[j]-seg[j-1]>=.5)bend=Math.max(bend,turn(dir(i),dir(j)));
      const score=bend*200+Math.abs(m-target)/total;if(!best||score<best.score)best={i,score};
    }
    if(!best)continue;
    const i=best.i,x=(xy[i-1][0]+xy[i][0])/2,y=(xy[i-1][1]+xy[i][1])/2,a=dir(i)+(path.kind==='landing'?Math.PI:0);
    ctx.beginPath();ctx.moveTo(x+9*Math.cos(a),y+9*Math.sin(a));ctx.lineTo(x-9*Math.cos(a)+8*Math.cos(a+Math.PI/2),y-9*Math.sin(a)+8*Math.sin(a+Math.PI/2));
    ctx.lineTo(x-9*Math.cos(a)-8*Math.cos(a+Math.PI/2),y-9*Math.sin(a)-8*Math.sin(a+Math.PI/2));ctx.closePath();
    ctx.fillStyle=color;ctx.strokeStyle='white';ctx.lineWidth=2.5;ctx.lineJoin='round';ctx.fill();ctx.stroke();
  }
  for(const segment of r.overlap.overlaps||[]){trace(segment.points);ctx.strokeStyle='white';ctx.lineWidth=12;ctx.stroke();ctx.strokeStyle=sunC;ctx.lineWidth=7;ctx.stroke();}
  const P=planeFromPoint(),[x,y]=project(P.latitude,P.longitude);ctx.beginPath();ctx.arc(x,y,7,0,Math.PI*2);ctx.fillStyle=sunC;ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='white';ctx.stroke();
  aimMapLabel(ctx,x,y+18,P.name,sunC,width,height,'center');
  const A=AstroNotesRoutes.AIRPORT,[ax,ay]=project(A.latitude,A.longitude);ctx.beginPath();ctx.arc(ax,ay,5,0,Math.PI*2);ctx.fillStyle=ink;ctx.fill();aimMapLabel(ctx,ax,ay+15,A.name,'white',width,height,'center');
  ctx.restore();
});
// 引き継いだ地点が「現在地」なら、開くたびに今の位置へ取り直す。アプリの地点は前に現在地を押した時の位置のままなので、
// 移動した後に開くと前の場所（例: 東京駅）になっていた（2026-11-25 ユーザー「開くと現在地が東京駅になるんだけど」）。
// 位置情報が許可済みの時だけ（ここで許可を求めない）。取れなければ今の地点のまま
let planeHereRequest=0;
async function planeRefreshHere(){
  const here=plane.from?.here,base=here?plane.from:place;
  if(plane.from&&!here||!(here||String(place.id||'').startsWith('geo:')||place.name==='現在地')||!navigator.geolocation)return;
  try{if((await navigator.permissions?.query({name:'geolocation'}))?.state!=='granted')return;}catch{return;/* permissions API unavailable: do not prompt from here */}
  const request=++planeHereRequest;
  navigator.geolocation.getCurrentPosition(async pos=>{
    if(request!==planeHereRequest||plane.from&&!plane.from.here||!viewState.plane)return;
    const {latitude,longitude}=pos.coords;
    if(AstroNotesTerrain.distanceKm(latitude,longitude,base.latitude,base.longitude)<0.05)return;
    let area='';try{area=(await nearName(latitude,longitude)).area||'';}catch{area='';/* the address is optional */}
    if(request!==planeHereRequest||plane.from&&!plane.from.here||!viewState.plane)return;
    planeSetFrom({name:'現在地',subtitle:area,latitude,longitude,here:true});
    PlaneMap.open({latitude,longitude},12);
  },()=>{/* no fix: keep the inherited point */},{timeout:10000,maximumAge:120000});
}
function openPlane(){
  if(!renderToolAccess('plane')){plane.seq.cancel();plane.mapSeq.cancel();plane.playback?.stop(false);return;}
  if(!Number.isFinite(plane.at))plane.at=Date.now();plane.dayMs=S.Cal.startOfDay(plane.at);
  planeSyncAirport({recenter:false});
  void planeRefreshHere();
  if(!plane.wired){
    plane.wired=true;wirePlaneLayout();
    const row=$("planeTimeRow"),footer=$("planeTimeFooter");
    ToolDateTimeBar.decorate({footer,row,track:$("planeTrack"),date:$("planeDate"),time:$("planeTime"),prev:$("planePrev"),next:$("planeNext"),more:$("planeTimeMore"),now:planeSetAt});
    const calendar=ToolDateTimeBar.calendar({button:$("planeDate"),getAt:()=>plane.at,setDay:day=>planeSetAt(day+(plane.at-plane.dayMs))});
    ToolDateTimeBar.editor({button:$("planeDate"),time:$("planeTime"),dialog:calendar});
    ToolDateTimeBar.details({button:$("planeTimeMore"),getText:()=>`${ToolDateTimeBar.label(plane.at)} ${S.JstCal.hhmm(plane.at)}（日本時間）\n${$("planeOpNote").textContent}\n${AstroNotesRoutes.operationStatus(plane.at).note}`});
    let tick=-1;
    plane.playback=ToolDateTimeBar.playback({row,footer,getAt:()=>plane.at,enabled:()=>viewState.plane&&toolAllowed('plane'),setAt:at=>{const second=Math.floor(at/10000);if(second===tick)return;tick=second;planeSetAt(at);},onStop:()=>planeUpdateMap()});
    $("planePrev").onclick=()=>planeSetAt(plane.at-86400000);$("planeNext").onclick=()=>planeSetAt(plane.at+86400000);
    $("planeTime").onchange=()=>{const [h,m]=$("planeTime").value.split(':').map(Number);if(Number.isFinite(h)&&Number.isFinite(m))planeSetAt(plane.dayMs+(h*60+m)*60000);};
    plane.scrub=plane.scrub||'time';
    let scrub;
    const label=at=>ToolDateTimeBar.label(at)+' '+S.JstCal.hhmm(at);
    plane.timeline=AstroNotesScrollTimeline.mount({root:$("planeTimeline"),getAt:()=>plane.at,getMode:()=>plane.scrub,enabled:()=>viewState.plane&&toolAllowed('plane'),
      getObserver:()=>{const p=planeFromPoint();return p?{latitude:p.latitude,longitude:p.longitude,elevation:0}:null;},sun:(at,o)=>AstroNotesAstro.sun(at,o),
      onChange:at=>{plane.playback?.stop(false);plane.at=at;plane.scrubbing=true;planeSyncTime();plane.scrubbing=false;clearTimeout(scrub);scrub=setTimeout(()=>planeSetAt(plane.at),150);},
      onSettle:at=>{clearTimeout(scrub);planeSetAt(at);},
      format:(at,mode)=>mode==='date'?new Date(at+32400000).toISOString().slice(5,10).replace('-','/'):S.JstCal.hhmm(at),describe:(at,mode)=>mode==='date'?ToolDateTimeBar.label(at):label(at)});
    $("planeScrubMode").onclick=()=>{plane.timeline.stop();plane.scrub=ToolDateTimeBar.nextMode(plane.scrub);planeSyncTime();};
    $("planeOp").onchange=()=>{plane.op=$("planeOp").value||null;planeApply();};
    $("planeAirportSearch").oninput=planeAirportList;
    $("planeAirportResults").onclick=e=>{const b=e.target.closest('[data-airport]');if(!b)return;plane.airport=b.dataset.airport;$("planeAirportSearch").value='';planeApply();};
    $("planeAirportAuto").onclick=()=>{plane.airport=null;$("planeAirportSearch").value='';planeApply();};
    $("planeFromButton").onclick=()=>openPlaceSheet('plane');
    $("planeFromFav").onclick=()=>favForPoint(planeFromPoint(),entry=>{renameFromAfterFav(plane,entry);planeApply();});
    $("planePickHere").onclick=async()=>{const c=PlaneMap.center(),request=plane.seq.next();$("planePickHere").disabled=true;try{const n=await nearName(c.latitude,c.longitude);if(plane.seq.current(request)&&toolAllowed('plane')&&viewState.plane)planeSetFrom({...c,name:n.name,subtitle:n.subtitle||n.area||'地図の中心'});}finally{$("planePickHere").disabled=false;}};
    const heights=()=>{const g=$("planeGround").value.trim(),e=$("planeEye").value.trim(),ground=g===''?null:Number(g),eye=Number(e);if((ground!==null&&(!Number.isFinite(ground)||ground< -500||ground>9000))||e===''||!Number.isFinite(eye)||eye<0||eye>700){$("planeHeightError").textContent='標高は−500〜9,000m、レンズ高は0〜700mで入力してください';return;}$("planeHeightError").textContent='';plane.groundOverride=ground;plane.eyeOverride=eye;planeApply();};
    $("planeGround").onchange=heights;$("planeEye").onchange=heights;$("planeHeightAuto").onclick=()=>{plane.groundOverride=null;plane.eyeOverride=null;$("planeHeightError").textContent='';planeApply();};
  }
  planeSyncTime();
  requestAnimationFrame(()=>{if(!viewState.plane||!toolAllowed('plane'))return;planeLayout();PlaneMap.open(AstroNotesRoutes.AIRPORT,10);});
  planeApply();
}
// The map fills the space between the masthead and the time bar; the settings open as one sheet above the bar.
function planeSheet(pane){
  const sheet=$("planeSheet");if(!sheet)return;
  const open=pane&&sheet.hidden||pane&&sheet.dataset.pane!==pane?pane:null;
  sheet.dataset.pane=open||'';sheet.hidden=!open;
  for(const el of sheet.querySelectorAll('[data-pane]'))el.hidden=el.dataset.pane!==open;
  for(const b of $("planeView").querySelectorAll('button[data-plane-pane]'))b.setAttribute('aria-expanded',String(b.dataset.planePane===open));
  if(open){$("planeSheetTitle").textContent=sheet.querySelector(`[data-pane="${open}"]`).dataset.title;sheet.scrollTop=0;}
}
function planeLayout(){
  const view=$("planeView");if(!view||view.hidden)return;
  const head=document.querySelector('main>.masthead'),foot=$("planeTimeFooter");
  view.style.setProperty('--plane-top',Math.max(0,Math.round(head?head.getBoundingClientRect().bottom:0))+'px');
  view.style.setProperty('--plane-foot',Math.round(foot?Math.max(0,innerHeight-foot.getBoundingClientRect().top):0)+'px');
  PlaneMap.redraw();
}
function wirePlaneLayout(){
  for(const el of $("planeView").querySelectorAll('[data-plane-pane]'))el.addEventListener('click',()=>planeSheet(el.dataset.planePane));
  $("planeSheetClose").onclick=()=>planeSheet(null);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&viewState.plane&&!$("planeSheet").hidden){planeSheet(null);}});
  const observer=new ResizeObserver(()=>planeLayout());observer.observe($("planeTimeFooter"));
  const head=document.querySelector('main>.masthead');if(head)observer.observe(head);
  addEventListener('resize',planeLayout);
}
export {PlaneMap,openPlane,plane,planeFromPoint,planeSetFrom};
