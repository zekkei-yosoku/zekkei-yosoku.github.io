import {$,S,esc} from '../../ui/presentation-helpers.js';
import {viewState} from '../../app/browser-state.js';
import {lightTimingText,moonGlyphAt,moonHorizon,observerHere} from '../forecast/view.js';
import {favForPoint,inheritedPoint,renameFromAfterFav,renderPointCard} from '../places/controller.js';
import {createMapView} from '../../ui/map/picker.js';
import {aimMapLabel} from '../framing/controller.js';
import {aimObserverAt,aimSavedFrom} from '../framing/observer.js';
import {nearName,openPlaceSheet} from '../places/search.js';
import {renderToolAccess,toolAllowed} from '../account/session-and-access.js';
// ---------------------------------------------------------------- 月丼
//
// 「ねらう」と同じ形。目標が**航路の上を動く点**になっただけ。
// 航路は `astronotes-routes.js` に形として持ってある（通信しない）。
// 運用の向き（北風・南風）はその日の風の予報から決める。
const plane = { dayMs: null, at: null, op: null, wind: null, map: null, observer: null, playback: null, mapSeq: AstroNotesLibrary.gate(), groundOverride: null, eyeOverride: null,
                result: null, seq: AstroNotesLibrary.gate(), wired: false, pick: 0,
                from: null };   // 撮影地点。null ならAstroNotesの地点を引き継ぐ（ねらうと同じ。2026-10-01）
/// 月丼の観測地点（候補の「ここ」）。替えていなければAstroNotesの地点
function planeFromPoint() { return plane.from || inheritedPoint(); }
function planeSetFrom(p) {
  plane.groundOverride = null; plane.eyeOverride = null;
  plane.from = p ? { ...p, name: p.name, subtitle: p.subtitle || "", latitude: p.latitude, longitude: p.longitude } : null;
  planeApply();
}

const PlaneMap = createMapView({ canvas: "planeCanvas", coord: "planeCoord", zoomIn: "planeIn", zoomOut: "planeOut" });

/// **羽田の**風。いま選んでいる地点の風ではない（長野を選んでいても、効くのは羽田の風）。
/// 以前は地点の予報を流用し、しかも**風向を数字で平均**していた。350°と10°の北風が
/// 平均で180°＝南風運用に化ける（2026-09-28 修正）。風だけの小さな取得で、30分使い回す
async function planeLoadWind() {
  if (plane.wind && Date.now() - plane.wind.at < 30 * 60000) return plane.wind;
  const R = AstroNotesRoutes.RJTT;
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
    plane.wind = { at: Date.now(), times: (h.time || []).map((s) => s * 1000),
      dir: h.wind_direction_10m || [], speed: h.wind_speed_10m || [] };
  } catch { plane.wind = { at: Date.now(), times: [], dir: [], speed: [] }; }
  return plane.wind;
}

/// その時刻の運用。**時刻ごとに決める**（風は一日のうちに変わり、南風の都心上空は15〜19時だけ）。
/// 風が分からない時刻は北風運用（羽田の基本）
function planeOpAt(at, { auto = false } = {}) {
  if (!AstroNotesRoutes.operationStatus(at).supported) return null;
  if (plane.op && !auto) return plane.op;
  const w = plane.wind;
  const hour = new Date(at + 9 * 3600000).getUTCHours();
  if (!AstroNotesRoutes.operationStatus(at).supported || !w || !w.times.length) return null;
  let i = -1, best = Infinity;
  for (let k = 0; k < w.times.length; k++) {
    const d = Math.abs(w.times[k] - at);
    if (d < best) { best = d; i = k; }
  }
  if (i < 0 || best > 60 * 60000) return null;
  return AstroNotesRoutes.operationFor(w.dir[i], w.speed[i], hour);
}

/// 運用の名前。南風の日は湾側と都心上空が時刻で入れ替わるので、まとめて「南風運用（湾側・都心上空）」と言う
function planeOpLabel(ops) {
  if (ops.length === 1 && ops[0]) return AstroNotesRoutes.OPERATIONS[ops[0]].name;
  ops = ops.filter(Boolean);
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

async function planeApply() {
  if (!toolAllowed("plane")) return;
  const seq = plane.seq.next();
  plane.mapSeq.cancel(); plane.map = null; plane.result = null; plane.observer = null;
  $("planeInfo").textContent = "この日の狙い目を計算中…";
  $("planeMapStatus").textContent = "空港の風と撮影地点の高さを確認中…";
  $("planeList").replaceChildren(); $("planeRouteDetails").replaceChildren(); PlaneMap.redraw();
  const P = planeFromPoint();
  renderPointCard("planeFrom", P, null);
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
  renderPointCard("planeFrom", P, ground);
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
  const w = plane.wind;
  const covered = !!w && w.times.some((t) => t >= plane.dayMs && t < plane.dayMs + 86400000);
  $("planeOp").options[0].textContent = covered ? `予報：${planeOpLabel([...new Set(auto.map((x) => x.op))])}` : "風予報なし：運用を選択";
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
      plane.pick = Number(el.dataset.spot);
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
  const w=plane.wind;if(!w)return null;
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
  $("planeOp").options[0].textContent=wind&&op ? `予報：${AstroNotesRoutes.OPERATIONS[planeOpAt(at,{auto:true})]?.name||"運用不明"}` : "風予報なし：運用を選択";
  $("planeOpNote").textContent=(wind ? `${S.JstCal.hhmm(wind.at)}の風予報 ${Math.round(wind.direction)}°から ${wind.speed.toFixed(1)}m/s` : "この時刻の風予報を取得できません")+(o?` ／ ${plane.op?"手動の想定":"予測"}：着陸 ${o.landing.join("・")}／離陸 ${o.takeoff.join("・")}`:"");
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
    try{heights=await AstroNotesTerrain.elevations(active,{zoom:13,indexedExactBatch:true});}catch{heights=active.map(()=>null);}
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
  plane.map={at,paths,overlap,polygons,pending:false,missing:samples.filter(s=>s.failed||!s.terrainVerified).length};
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
  else if(r.overlap.status==='ready'&&!r.polygons.length)parts.push('対応範囲内に地上の候補なし');
  $("planeMapStatus").textContent=parts.join(' ／ ');
  $("planeRouteDetails").textContent=r.paths.map(p=>`${p.runway} ${p.kind==='landing'?'着陸':'離陸'}`).join(' · ');
}
PlaneMap.setOverlay((ctx,{project,width,height})=>{
  const r=plane.map;if(!r||!toolAllowed("plane"))return;
  const cs=getComputedStyle(document.documentElement),moonC=cs.getPropertyValue('--ray-moon').trim(),sunC=cs.getPropertyValue('--ray-sun').trim(),ink=cs.getPropertyValue('--secondary').trim();
  const trace=points=>{ctx.beginPath();points.forEach((p,i)=>{const [x,y]=project(p.latitude,p.longitude);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});};
  ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
  ctx.fillStyle=moonC;ctx.globalAlpha=.3;
  for(const polygon of r.polygons){trace(polygon.points);ctx.closePath();ctx.fill();}
  ctx.globalAlpha=1;
  for(const path of r.paths){
    ctx.setLineDash(path.kind==='takeoff'?[7,6]:[]);ctx.strokeStyle='rgba(255,255,255,.8)';ctx.lineWidth=5.5;trace(path.points);ctx.stroke();ctx.strokeStyle=ink;ctx.lineWidth=2.2;ctx.stroke();ctx.setLineDash([]);
    // Landing data runs outward from the threshold, opposite actual flight.
    for(let i=4;i<path.points.length;i+=10){const [x,y]=project(path.points[i].latitude,path.points[i].longitude),q=path.points[i+(path.kind==='landing'?-1:1)];if(!q)continue;const [qx,qy]=project(q.latitude,q.longitude),a=Math.atan2(qy-y,qx-x);ctx.beginPath();ctx.moveTo(x-7*Math.cos(a-.55),y-7*Math.sin(a-.55));ctx.lineTo(x,y);ctx.lineTo(x-7*Math.cos(a+.55),y-7*Math.sin(a+.55));ctx.stroke();}
  }
  for(const segment of r.overlap.overlaps||[]){ctx.setLineDash(segment.kind==='takeoff'?[7,6]:[]);ctx.strokeStyle=sunC;ctx.lineWidth=7;trace(segment.points);ctx.stroke();}ctx.setLineDash([]);
  const P=planeFromPoint(),[x,y]=project(P.latitude,P.longitude);ctx.beginPath();ctx.arc(x,y,7,0,Math.PI*2);ctx.fillStyle=sunC;ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='white';ctx.stroke();
  aimMapLabel(ctx,x,y+18,P.name,sunC,width,height,'center');
  const A=AstroNotesRoutes.RJTT,[ax,ay]=project(A.latitude,A.longitude);ctx.beginPath();ctx.arc(ax,ay,5,0,Math.PI*2);ctx.fillStyle=ink;ctx.fill();aimMapLabel(ctx,ax,ay+15,A.name,'white',width,height,'center');
  ctx.restore();
});
function openPlane(){
  if(!renderToolAccess('plane')){plane.seq.cancel();plane.mapSeq.cancel();plane.playback?.stop(false);return;}
  if(!Number.isFinite(plane.at))plane.at=Date.now();plane.dayMs=S.Cal.startOfDay(plane.at);
  if(!$("planeOp").options.length)$("planeOp").innerHTML='<option value="">風予報から推定</option>'+Object.entries(AstroNotesRoutes.OPERATIONS).map(([key,o])=>`<option value="${key}">${esc(o.name)}（手動）</option>`).join('');
  if(!plane.wired){
    plane.wired=true;
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
    $("planeFromButton").onclick=()=>openPlaceSheet('plane');
    $("planeFromFav").onclick=()=>favForPoint(planeFromPoint(),entry=>{renameFromAfterFav(plane,entry);planeApply();});
    $("planePickHere").onclick=async()=>{const c=PlaneMap.center(),request=plane.seq.next();$("planePickHere").disabled=true;try{const n=await nearName(c.latitude,c.longitude);if(plane.seq.current(request)&&toolAllowed('plane')&&viewState.plane)planeSetFrom({...c,name:n.name,subtitle:n.subtitle||n.area||'地図の中心'});}finally{$("planePickHere").disabled=false;}};
    const heights=()=>{const g=$("planeGround").value.trim(),e=$("planeEye").value.trim(),ground=g===''?null:Number(g),eye=Number(e);if((ground!==null&&(!Number.isFinite(ground)||ground< -500||ground>9000))||e===''||!Number.isFinite(eye)||eye<0||eye>700){$("planeHeightError").textContent='標高は−500〜9,000m、レンズ高は0〜700mで入力してください';return;}$("planeHeightError").textContent='';plane.groundOverride=ground;plane.eyeOverride=eye;planeApply();};
    $("planeGround").onchange=heights;$("planeEye").onchange=heights;$("planeHeightAuto").onclick=()=>{plane.groundOverride=null;plane.eyeOverride=null;$("planeHeightError").textContent='';planeApply();};
  }
  planeSyncTime();
  requestAnimationFrame(()=>{if(!viewState.plane||!toolAllowed('plane'))return;PlaneMap.open(AstroNotesRoutes.RJTT,10);});
  planeApply();
}
export {PlaneMap,openPlane,plane,planeFromPoint,planeSetFrom};
