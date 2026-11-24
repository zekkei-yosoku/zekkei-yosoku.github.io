import {$,S,esc} from '../../ui/presentation-helpers.js';
import {viewState} from '../../app/browser-state.js';
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
async function planeLoadWind() {
  if (plane.dayMs <= Date.now()) await planeLoadMetar();
  const R = AstroNotesRoutes.AIRPORT;
  if (plane.wind && plane.wind.id === R.id && Date.now() - plane.wind.at < 30 * 60000) return plane.wind;
  const url = "https://api.open-meteo.com/v1/forecast?" + new URLSearchParams({
    latitude: R.latitude.toFixed(4), longitude: R.longitude.toFixed(4),
    hourly: "wind_direction_10m,wind_speed_10m", wind_speed_unit: "ms",
    timeformat: "unixtime", timezone: "Asia/Tokyo", forecast_days: "16", past_days: "2",
  });
  try {
    const res = await S.cachedFetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const h = j.hourly || {};
    plane.wind = { id: R.id, at: Date.now(), times: (h.time || []).map((s) => s * 1000),
      dir: h.wind_direction_10m || [], speed: h.wind_speed_10m || [] };
  } catch { plane.wind = { id: R.id, at: Date.now(), times: [], dir: [], speed: [] }; }
  return plane.wind;
}

/// その時刻の運用。**時刻ごとに決める**（風は一日のうちに変わり、南風の都心上空は15〜19時だけ）。
/// 風が分からない時刻は北風運用（羽田の基本）
function planeOpAt(at, { auto = false } = {}) {
  if (!AstroNotesRoutes.operationStatus(at).supported) return null;
  if (plane.op && !auto) return plane.op;
  const hour = new Date(at + 9 * 3600000).getUTCHours();
  const w = planeWindAt(at);
  if (!w) return null;
  return AstroNotesRoutes.operationFor(w.direction, w.speed, hour);
}

/// 運用の名前。南風の日は湾側と都心上空が時刻で入れ替わるので、まとめて「南風運用（湾側・都心上空）」と言う
function planeOpLabel(ops) {
  if (ops.length === 1 && ops[0]) return AstroNotesRoutes.OPERATIONS[ops[0]].name;
  ops = ops.filter(Boolean);
  if (AstroNotesRoutes.AIRPORT.id !== "RJTT") return ops.map((o) => AstroNotesRoutes.OPERATIONS[o]?.name).filter(Boolean).join("・");
  const south = ops.filter((o) => o !== "north").map((o) => (o === "south" ? "都心上空" : "湾側"));
  return [ops.includes("north") ? "北風運用" : null, south.length ? `南風運用（${south.join("・")}）` : null]
    .filter(Boolean).join("・");
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
  return AstroNotesRoutes.nearestAirport(P.latitude, P.longitude)?.airport.id || "RJTT";
}
function planeSyncAirport({ recenter = true } = {}) {
  const id = planeAirportId();
  const changed = AstroNotesRoutes.AIRPORT.id !== id;
  if (changed) { AstroNotesRoutes.selectAirport(id); plane.op = null; plane.wind = null; plane.metar = null; }
  if (changed || !$("planeOp").options.length) $("planeOp").innerHTML = '<option value="">風予報から推定</option>' + Object.entries(AstroNotesRoutes.OPERATIONS).map(([key, o]) => `<option value="${key}">${esc(o.name)}（手動）</option>`).join("");
  const sel = $("planeAirport");
  if (sel && !sel.options.length) sel.innerHTML = '<option value="">撮影地点に近い空港（自動）</option>' + [...AstroNotesRoutes.AIRPORTS].sort((a, b) => b.latitude - a.latitude).map((a) => `<option value="${a.id}">${esc(a.shortName)}（${esc(a.name)}・${a.id}）</option>`).join("");
  if (sel) { sel.value = plane.airport || ""; sel.options[0].textContent = `撮影地点に近い空港（自動・いまは${AstroNotesRoutes.AIRPORT.shortName}）`; }
  if (changed && recenter && viewState.plane) PlaneMap.open(AstroNotesRoutes.AIRPORT, 10);
  return changed;
}

async function planeApply() {
  if (!toolAllowed("plane")) return;
  planeSyncAirport();
  const seq = plane.seq.next();
  plane.mapSeq.cancel(); plane.map = null; plane.result = null; plane.observer = null;
  $("planeInfo").textContent = "この日の狙い目を計算中…";
  $("planeMapStatus").textContent = "空港の風と撮影地点の高さを確認中…";
  $("planeList").replaceChildren(); $("planeRouteDetails").replaceChildren(); PlaneMap.redraw();
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
  for (const op of new Set(spans.map(s=>s.op).filter(Boolean))) {
    for (const path of AstroNotesPlane.pathsFor(op, {landing:true,takeoff:true})) if (!paths.some(q=>q.id===path.id)) paths.push(path);
  }
  const activeAt = (path, at) => {
    const o = AstroNotesRoutes.OPERATIONS[planeOpAt(at)];
    return !!o && (path.kind === "landing" ? o.landing : o.takeoff).includes(path.runway);
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
  $("planeTimeRange").value = String((plane.at-plane.dayMs)/60000);
  $("planeTimeRange").setAttribute("aria-valuetext",S.JstCal.hhmm(plane.at));
}
function planeSetAt(at) {
  if (!Number.isFinite(at) || !toolAllowed("plane")) return;
  const day = S.Cal.startOfDay(at), changed = day !== plane.dayMs;
  plane.at=at; plane.dayMs=day; planeSyncTime();
  if(changed)planeApply(); else planeUpdateMap();
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
  plane.map=null;PlaneMap.redraw();$("planeRouteDetails").replaceChildren();
  const status=AstroNotesRoutes.operationStatus(at),op=planeOpAt(at),wind=planeWindAt(at);
  const o=AstroNotesRoutes.OPERATIONS[op];
  $("planeOp").options[0].textContent=wind&&op ? `${wind.observed?"観測":"予報"}：${AstroNotesRoutes.OPERATIONS[planeOpAt(at,{auto:true})]?.name||"運用不明"}` : "風予報なし：運用を選択";
  $("planeOpNote").textContent=(wind ? `${S.JstCal.hhmm(wind.at)}の${wind.observed?"観測風（METAR）":"風予報"} ${Math.round(wind.direction)}°から ${wind.speed.toFixed(1)}m/s` : "この時刻の風を取得できません")+(o?` ／ ${plane.op?"手動の想定":"予測"}：着陸 ${o.landing.join("・")}／離陸 ${o.takeoff.join("・")}`:"");
  const short=AstroNotesRoutes.AIRPORT.shortName,haneda=AstroNotesRoutes.AIRPORT.id==="RJTT";
  $("planeOpChip").textContent=short+"・"+(!status.supported?"深夜は未対応":o?(haneda?o.name.replace("運用","").replace(/（(.+?)(上空)?）/,"・$1"):o.name.replace(/運用（.*）$/,"")):"運用を選ぶ");$("planeOpMode").textContent=status.supported&&o?(plane.op?"手動":wind?.observed?"観測":"予報"):"";
  if(!status.supported){$("planeMapStatus").textContent="23〜6時の深夜経路は未対応のため、この時刻の範囲は計算できません。";return;}
  if(!o){$("planeMapStatus").textContent="風予報がないため運用を推定できません。運用を手動で選ぶと計算できます。";return;}
  const paths=AstroNotesPlane.pathsFor(op,{landing:true,takeoff:true});
  const overlap=AstroNotesPlane.routeOverlapAt(at,plane.observer,paths);
  plane.map={at,paths,overlap,polygons:[],pending:true,missing:0};
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
    const seaLevel=async url=>{const n=String(url).split('latitude=')[1].split('&')[0].split(',').length;return {ok:true,status:200,json:async()=>({elevation:new Array(n).fill(0)})};};
    try{heights=await AstroNotesTerrain.elevations(active,{zoom:13,indexedExactBatch:true,fetchImpl:seaLevel});}catch{heights=active.map(()=>null);}
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
function planeMapText(){
  const r=plane.map;if(!r)return;
  const m=r.overlap.moon,P=planeFromPoint(),parts=[`${S.JstCal.hhmm(r.at)} · ${P.name}から`];
  if(m&&Number.isFinite(m.apparentAltitude))parts.push(`月 方位${m.azimuth.toFixed(1)}°・高さ${m.apparentAltitude.toFixed(1)}°`);
  if(r.overlap.status==='missing-elevation')parts.push('標高が不明のため計算できません');
  else if(m&&r.overlap.status==='below-horizon')parts.push('月が地平線より下にあります');
  else parts.push(r.overlap.overlaps?.length?'金色の区間で月円盤と重なります':'この地点から重なる区間はありません');
  if(r.pending&&r.overlap.status==='ready')parts.push('地上の候補範囲を計算中…');
  else if(r.missing)parts.push('地形を確認できない部分は未表示');
  else if(r.overlap.status==='ready'&&!r.polygons.length&&!r.centerLines?.length)parts.push('対応範囲内に地上の候補なし');
  else if(r.centerLines?.length)parts.push('青い線の上に立つと月の中心に重なります');
  $("planeMapStatus").textContent=parts.join(' ／ ');
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
  const r=plane.map;if(!r||!toolAllowed("plane"))return;
  const cs=getComputedStyle(document.documentElement),sunC=cs.getPropertyValue('--ray-sun').trim(),ink=cs.getPropertyValue('--secondary').trim();
  const trace=points=>{ctx.beginPath();const xy=points.map(p=>project(p.latitude,p.longitude));if(!xy.length)return;ctx.moveTo(...xy[0]);
    // Midpoint quadratic smoothing keeps sampled curves round on screen without moving the endpoints.
    for(let i=1;i<xy.length-1;i++)ctx.quadraticCurveTo(xy[i][0],xy[i][1],(xy[i][0]+xy[i+1][0])/2,(xy[i][1]+xy[i+1][1])/2);
    if(xy.length>1)ctx.lineTo(...xy[xy.length-1]);};
  ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
  // Fade the base map so the overlays read first.
  ctx.fillStyle='rgba(255,255,255,.42)';ctx.fillRect(0,0,width,height);
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
function openPlane(){
  if(!renderToolAccess('plane')){plane.seq.cancel();plane.mapSeq.cancel();plane.playback?.stop(false);return;}
  if(!Number.isFinite(plane.at))plane.at=Date.now();plane.dayMs=S.Cal.startOfDay(plane.at);
  planeSyncAirport({recenter:false});
  if(!plane.wired){
    plane.wired=true;wirePlaneLayout();
    const row=$("planeTimeRow"),footer=$("planeTimeFooter");
    ToolDateTimeBar.decorate({footer,row,date:$("planeDate"),time:$("planeTime"),prev:$("planePrev"),next:$("planeNext"),more:$("planeTimeMore"),now:planeSetAt});
    const calendar=ToolDateTimeBar.calendar({button:$("planeDate"),getAt:()=>plane.at,setDay:day=>planeSetAt(day+(plane.at-plane.dayMs))});
    ToolDateTimeBar.editor({button:$("planeDate"),time:$("planeTime"),dialog:calendar});
    ToolDateTimeBar.details({button:$("planeTimeMore"),getText:()=>`${ToolDateTimeBar.label(plane.at)} ${S.JstCal.hhmm(plane.at)}（日本時間）\n${$("planeOpNote").textContent}\n${AstroNotesRoutes.operationStatus(plane.at).note}`});
    let tick=-1;
    plane.playback=ToolDateTimeBar.playback({row,footer,getAt:()=>plane.at,enabled:()=>viewState.plane&&toolAllowed('plane'),setAt:at=>{const second=Math.floor(at/10000);if(second===tick)return;tick=second;planeSetAt(at);},onStop:()=>planeUpdateMap()});
    $("planePrev").onclick=()=>planeSetAt(plane.at-86400000);$("planeNext").onclick=()=>planeSetAt(plane.at+86400000);
    $("planeTime").onchange=()=>{const [h,m]=$("planeTime").value.split(':').map(Number);if(Number.isFinite(h)&&Number.isFinite(m))planeSetAt(plane.dayMs+(h*60+m)*60000);};
    let scrub;
    $("planeTimeRange").oninput=()=>{plane.mapSeq.cancel();plane.map=null;PlaneMap.redraw();clearTimeout(scrub);scrub=setTimeout(()=>planeSetAt(plane.dayMs+Number($("planeTimeRange").value)*60000),150);};
    $("planeTimeRange").onchange=()=>{clearTimeout(scrub);planeSetAt(plane.dayMs+Number($("planeTimeRange").value)*60000);};
    $("planeOp").onchange=()=>{plane.op=$("planeOp").value||null;planeApply();};
    $("planeAirport").onchange=()=>{plane.airport=$("planeAirport").value||null;planeApply();};
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
