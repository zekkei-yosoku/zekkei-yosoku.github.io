// ---------------------------------------------------------------- 月丼
//
// 「ねらう」と同じ形。目標が**航路の上を動く点**になっただけ。
// 航路は `astronotes-routes.js` に形として持ってある（通信しない）。
// 運用の向き（北風・南風）はその日の風の予報から決める。
const plane = { dayMs: null, op: null, wind: null,
                result: null, seq: 0, wired: false, pick: 0,
                from: null };   // 撮影地点。null ならAstroNotesの地点を引き継ぐ（ねらうと同じ。2026-10-01）
/// 月丼の観測地点（候補の「ここ」）。替えていなければAstroNotesの地点
function planeFromPoint() { return plane.from || inheritedPoint(); }
function planeSetFrom(p) {
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
  if (plane.op && !auto) return plane.op;
  const w = plane.wind;
  const hour = new Date(at + 9 * 3600000).getUTCHours();
  if (!w || !w.times.length) return "north";
  let i = -1, best = Infinity;
  for (let k = 0; k < w.times.length; k++) {
    const d = Math.abs(w.times[k] - at);
    if (d < best) { best = d; i = k; }
  }
  if (i < 0 || best > 90 * 60000) return "north";
  return AstroNotesRoutes.operationFor(w.dir[i], w.speed[i], hour) || "north";
}

/// 運用の名前。南風の日は湾側と都心上空が時刻で入れ替わるので、まとめて「南風運用（湾側・都心上空）」と言う
function planeOpLabel(ops) {
  if (ops.length === 1) return AstroNotesRoutes.OPERATIONS[ops[0]].name;
  const south = ops.filter((o) => o !== "north").map((o) => (o === "south" ? "都心上空" : "湾側"));
  return [ops.includes("north") ? "北風運用" : null, south.length ? `南風運用（${south.join("・")}）` : null]
    .filter(Boolean).join("・");
}

/// その日の運用の移り変わり（「0〜14時 北風運用」のようにまとめる）
function planeOpSpans(dayMs, opts) {
  const out = [];
  for (let h = 0; h < 24; h++) {
    const op = planeOpAt(dayMs + h * 3600000, opts);
    const last = out[out.length - 1];
    if (last && last.op === op) last.to = h; else out.push({ op, from: h, to: h });
  }
  return out;
}

async function planeApply() {
  if (!toolAllowed("plane")) return;
  const seq = ++plane.seq;
  $("planeInfo").textContent = "狙い目を探しています…";
  $("planeList").innerHTML = "";
  const P = planeFromPoint();
  renderPointCard("planeFrom", P, Number.isFinite(P.groundManualM) ? P.groundManualM : P.elevation);
  await planeLoadWind();
  if (seq !== plane.seq) return;
  // その日に使われうる経路を全部並べ、**その時刻に使われている経路だけ**を数える
  const spans = planeOpSpans(plane.dayMs);
  const kind = { landing: true, takeoff: true };
  const paths = [];
  for (const op of new Set(spans.map((s) => s.op))) {
    for (const p of AstroNotesPlane.pathsFor(op, kind)) {
      if (!paths.some((q) => q.id === p.id)) paths.push(p);
    }
  }
  const activeAt = (path, at) => {
    const o = AstroNotesRoutes.OPERATIONS[planeOpAt(at)];
    return !!o && (path.kind === "landing" ? o.landing : o.takeoff).includes(path.runway);
  };
  // **名前のある場所の中から選ぶ。** 格子で探すと上位が東京湾の真ん中になる
  // （進入は湾の上を通るため）。「今日はここ」と言うには立てる場所が要る。
  // **いま選んでいる地点も候補に入れる。** 展望台を選んでいればその高さで効く
  // 観測地点（どこから重ねるか）。AstroNotesの地点を引き継いでいれば、展望台の高さと測ってある地平線（建物・地形）も使う
  let ground, agl, horizonAt;
  if (P.inherited) {
    const me = observerHere();
    ground = me.groundM; agl = me.eyeHeightAGL; horizonAt = moonHorizon || null;
  } else {
    const saved = aimSavedFrom(P);
    const measured = Number.isFinite(saved.groundManualM) ? saved.groundManualM : await aimElevation(P.latitude, P.longitude);
    const obs = aimObserverAt(saved, measured);
    ground = obs.elevation; agl = obs.eyeM; horizonAt = null;
    if (seq !== plane.seq) return;
  }
  renderPointCard("planeFrom", P, ground);
  const here = {
    id: "here", name: `${P.name}（撮影地点）`,
    latitude: P.latitude, longitude: P.longitude,
    elevationM: ground, deckM: agl,
    horizonAt,
    note: agl > 2 ? `地上${Math.round(agl)}m。目の高さ ${Math.round(ground + agl)}m`
      : `標高 ${Math.round(ground)}m`,
  };
  const spots = AstroNotesPlane.rankSpots(plane.dayMs, paths, [here, ...AstroNotesRoutes.SPOTS],
    { stepMin: 2, limit: 8, activeAt });
  if (seq !== plane.seq) return;
  const moon = AstroNotesAstro.moon(S.Cal.setHour(plane.dayMs, 21),
    { latitude: AstroNotesRoutes.RJTT.latitude, longitude: AstroNotesRoutes.RJTT.longitude, elevation: 0 });
  plane.result = { spots, paths, spans, illuminated: moon.illuminatedFraction };
  plane.pick = 0;
  planeRender();
  PlaneMap.redraw();
}

/// 期待機数の言い方。**確率ではなく、その時間に円盤の前を通る機数の平均。**
/// 1機に満たない日も多いので「約0機」とは言わない
function planeExpect(n) {
  if (!(n > 0)) return "通る機はまれ";
  if (n < 1) return `平均${n.toFixed(1)}機（${Math.round((1 - Math.exp(-n)) * 100)}%で1機以上）`;
  return `平均${n.toFixed(1)}機`;
}

function planeRender() {
  const r = plane.result;
  const opLine = (s) => {
    const o = AstroNotesRoutes.OPERATIONS[s.op];
    return `${s.from}〜${s.to + 1}時 ${o.name}・着陸 ${o.landing.join("・")}・離陸 ${o.takeoff.join("・")}`;
  };
  // 運用の欄は「風から決める」を出さず、**予報から決まる運用そのものを選んだ形**で出す
  // （2026-10-01 ユーザー「風から決めるはいらなくない？今の運用を自動で選択させたらいい」）。
  // 南風の日は 15〜19時だけ都心上空で、ほかは湾側。計算は今までどおり時刻ごとに切り替える
  const auto = planeOpSpans(plane.dayMs, { auto: true });
  const w = plane.wind;
  const covered = !!w && w.times.some((t) => t >= plane.dayMs && t < plane.dayMs + 86400000);
  $("planeOp").options[0].textContent = covered ? `予報：${planeOpLabel([...new Set(auto.map((x) => x.op))])}` : "予報なし：北風運用";
  // 下の一行は滑走路（と、切り替わる日は時刻）。運用の名前は欄に出ているので繰り返さない
  const runways = (op) => { const o = AstroNotesRoutes.OPERATIONS[op]; return `着陸 ${o.landing.join("・")}・離陸 ${o.takeoff.join("・")}`; };
  $("planeOpNote").textContent = r.spans.length === 1 ? runways(r.spans[0].op)
    : r.spans.map(opLine).join(" ／ ");
  $("planePick").innerHTML = "";
  $("planePick").hidden = true;
  $("planeList").replaceChildren();
  const P = planeFromPoint();
  if (!r.spots.length) {
    $("planeInfo").textContent = `この日は、${P.name}からも定番の場所からも重なりません。`;
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
  const missed = r.spots.some((sp) => sp.spot.id === "here") ? "" : `${P.name}からは、この日は重なりません。`;
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
      PlaneMap.open({ latitude: sp.spot.latitude, longitude: sp.spot.longitude }, 12);
      requestAnimationFrame(() => PlaneMap.redraw());
    };
  }
}

PlaneMap.setOverlay((ctx, { project, width, height }) => {
  const r = plane.result;
  if (!r) return;
  const cs = getComputedStyle(document.documentElement);
  const moonC = cs.getPropertyValue("--ray-moon").trim() || "#2f7fd0";
  const sunC = cs.getPropertyValue("--ray-sun").trim() || "#e8820e";
  const ink = "rgba(0,0,0,.55)";
  // 経路。着陸は実線、離陸は破線
  for (const path of r.paths) {
    const pts = path.points.map((p) => project(p.latitude, p.longitude));
    ctx.save();
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    if (path.kind === "takeoff") ctx.setLineDash([7, 6]);
    ctx.strokeStyle = ink; ctx.lineWidth = 5.5;
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    ctx.strokeStyle = moonC; ctx.lineWidth = 2.2; ctx.stroke();
    ctx.restore();
  }
  // 狙い目。番号は一覧と同じ
  r.spots.forEach((sp, i) => {
    const [x, y] = project(sp.spot.latitude, sp.spot.longitude);
    const on = i === plane.pick;
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, on ? 11 : 9, 0, Math.PI * 2);
    ctx.fillStyle = ink; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, on ? 9 : 7, 0, Math.PI * 2);
    ctx.fillStyle = sunC; ctx.fill();
    if (on) { ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke(); }
    ctx.fillStyle = "#1b1206";
    ctx.font = `700 ${on ? 12 : 10}px -apple-system, 'Hiragino Sans', sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), x, y + 0.5);
    ctx.restore();
  });
  // 空港の位置
  const [ax, ay] = project(AstroNotesRoutes.RJTT.latitude, AstroNotesRoutes.RJTT.longitude);
  ctx.save();
  ctx.beginPath(); ctx.arc(ax, ay, 5, 0, Math.PI * 2);
  ctx.fillStyle = ink; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
  aimMapLabel(ctx, ax, ay + 14, AstroNotesRoutes.RJTT.name, "#fff", width, height, "center");
  ctx.restore();
});

function openPlane() {
  if (!renderToolAccess("plane")) { plane.seq++; return; }
  if (!plane.dayMs) plane.dayMs = S.Cal.startOfDay(Date.now());
  $("planeDate").value = new Date(plane.dayMs + 9 * 3600000).toISOString().slice(0, 10);
  $("planeWeekday").textContent = S.Cal.relativeDay(plane.dayMs);
  if (!$("planeOp").options.length) {
    $("planeOp").innerHTML = `<option value="">予報</option>`
      + Object.entries(AstroNotesRoutes.OPERATIONS)
        .map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join("");
  }
  if (!plane.wired) {
    plane.wired = true;
    const setDay = (ms) => {
      plane.dayMs = ms;
      $("planeDate").value = new Date(ms + 9 * 3600000).toISOString().slice(0, 10);
      $("planeWeekday").textContent = S.Cal.relativeDay(ms);
      planeApply();
    };
    $("planePrev").onclick = () => setDay(plane.dayMs - 86400000);
    $("planeNext").onclick = () => setDay(plane.dayMs + 86400000);
    $("planeToday").onclick = () => setDay(S.Cal.startOfDay(Date.now()));
    $("planeDate").onchange = () => {
      const v = Date.parse(`${$("planeDate").value}T00:00:00+09:00`);
      if (Number.isFinite(v)) setDay(v);
    };
    $("planeOp").onchange = () => { plane.op = $("planeOp").value || null; planeApply(); };
    // 観測地点: カードを押すと「地点」の画面、☆ でお気に入り、地図の「ここから重ねる」（ねらうと同じ部品）
    $("planeFromButton").onclick = () => openPlaceSheet("plane");
    $("planeFromFav").onclick = () => favForPoint(planeFromPoint(), (entry) => { renameFromAfterFav(plane, entry); planeApply(); });
    $("planePickHere").onclick = async () => {
      const c = PlaneMap.center();
      $("planePickHere").disabled = true;
      const n = await nearName(c.latitude, c.longitude);
      $("planePickHere").disabled = false;
      planeSetFrom({ name: n.name, subtitle: n.area || "地図の中心", latitude: c.latitude, longitude: c.longitude });
    };
  }
  requestAnimationFrame(() => {
    if (!viewState.plane || !toolAllowed("plane")) return;
    PlaneMap.open({ latitude: AstroNotesRoutes.RJTT.latitude, longitude: AstroNotesRoutes.RJTT.longitude }, 10);
    requestAnimationFrame(() => PlaneMap.redraw());
  });
  planeApply();
}
