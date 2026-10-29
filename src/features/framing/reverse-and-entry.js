// ---------------------------------------------------------------- 撮れる場所を地図で探す（逆算の作り直し・2026-10-20 trial）
// 2026-10-20 ユーザー「逆算ってのがもっと簡単に今あるようにできたらいい」→「トライアルに作ってみて」：
// 置き方（重ね方＋少しずらす）を決める → 地図が下からせり上がり、その日にそう見える**陸の上の**線が出る →
// 線の上をタップすると、その撮影地点・その時刻の構図に戻る。選ばずに閉じれば何も変わらない
let aimLineSheetView = null, aimLineSheetSeq = 0;
const aimLineSheetCache = { key: null, runs: null };
function aimShiftSay() {
  if (!aimShift.x && !aimShift.y) return "ずらさない";
  const part = (v, plus, minus) => v ? `${v > 0 ? plus : minus} ${Math.round(Math.abs(v) * 50) / 100}` : "";
  return [part(aimShift.y, "上", "下"), part(aimShift.x, "右", "左")].filter(Boolean).join("・") + "（直径）";
}
// 置いた位置は、置いたときの目標・天体の重ね方。目標や天体を替えたら持ち越さない（別の目標に点線円が残っていた）
function aimShiftCheck() {
  if (!AIM_PLACE_ENABLED || !AstroNotesBodies.definition(aim.body).limbs || (aimShift.key && aimShift.key !== `${aim.target?.id}|${aim.body}`)) { aimShift.x = 0; aimShift.y = 0; aimShift.key = null; }
}
function aimShiftSync() {
  aimShiftCheck();
  $("aimShiftValue").textContent = aimShiftSay() === "ずらさない" ? "" : `検索する配置：${aimShiftSay()}`;
  $("aimLineOpen").textContent = aimShift.x || aimShift.y ? "調整した配置で撮れる場所を地図で探す" : "この重ね方で撮れる場所を地図で探す";
  $("aimLook")._redrawLook?.();
}
/// 図内で天体を置いた所（中心が先端から [右, 上] 何直径）を、いまの重ね方からのずらしにする
function aimShiftFromPlacement(x, y) {
  const sign = aim.matchMode === "overlap" ? 0 : AstroNotesAlign.limbById(aim.limb).sign;
  const clamp = (v) => Math.max(-20, Math.min(20, Math.round(v * 10) / 10));
  aimShift.x = clamp(2 * x); aimShift.y = clamp(2 * y - sign); aimShift.key = `${aim.target?.id}|${aim.body}`;
  aimShiftSync();
}
/// 置き方を、天体の中心が目標の先端から何直径ずれるか [右, 上] に直す（下の縁＝中心が半径ぶん上）
function aimPlacement() {
  aimShiftCheck();
  const sign = aim.matchMode === "overlap" ? 0 : AstroNotesAlign.limbById(aim.limb).sign;
  return [aimShift.x / 2, sign / 2 + aimShift.y / 2];
}
function aimPlacementSay() {
  const limb = aim.matchMode === "overlap" ? "真ん中" : AstroNotesAlign.limbById(aim.limb).name;
  return aimShift.x || aimShift.y ? `${limb}から${aimShiftSay().replace("（直径）", "")}` : limb;
}
/// 線を解いて、水の上を抜いた区間に分ける。区間は同じ側（出／入）の連続した陸の点
async function aimLineRuns(isCurrent) {
  const shift = aimPlacement(), partId = aim.partId === "__whole" ? null : aim.partId;
  const key = JSON.stringify([aim.target, aim.body, aim.dayMs, partId, shift, AstroNotesAtmosphere.dataKey()]);
  if (aimLineSheetCache.key === key) return aimLineSheetCache.runs;
  const lines = await AstroNotesAlign.line(aim.target, aim.body, aim.dayMs,
    { partId, limb: "center", shift, elevationAt: aimElevation, isCurrent });
  if (!isCurrent()) return null;
  const runs = [];
  for (const l of lines) {
    let water = [];
    try { water = await AstroNotesTerrain.waterAt(l.points); } catch { water = []; }
    if (!isCurrent()) return null;
    let run = [];
    l.points.forEach((p, i) => {
      // 分からない点（通信の失敗・国外）は残す。水と分かった点だけ抜く
      if (water[i] === true) { if (run.length) runs.push({ side: l.side, points: run }); run = []; }
      else run.push(p);
    });
    if (run.length) runs.push({ side: l.side, points: run });
  }
  aimLineSheetCache.key = key; aimLineSheetCache.runs = runs;
  return runs;
}
function aimLineSheetFit(runs) {
  const pts = [aim.target, ...runs.flatMap((r) => r.points)];
  const lat0 = Math.min(...pts.map((p) => p.latitude)), lat1 = Math.max(...pts.map((p) => p.latitude));
  const lon0 = Math.min(...pts.map((p) => p.longitude)), lon1 = Math.max(...pts.map((p) => p.longitude));
  const cv = $("aimLineCanvas"), w = (cv.clientWidth - 56) * 0.86, h = cv.clientHeight * 0.82;
  const y = (lat) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  const spanX = Math.max(1e-6, (lon1 - lon0) / 360), spanY = Math.max(1e-6, (y(lat1) - y(lat0)) / (2 * Math.PI));
  const zoom = Math.max(5, Math.min(15, Math.floor(Math.log2(Math.min(w / (256 * spanX), h / (256 * spanY))) * 4) / 4));
  aimLineSheetView.setView((lat0 + lat1) / 2, (lon0 + lon1) / 2, zoom);
  // 右端の地図の釦（幅 56）に線が隠れないよう、線の真ん中を釦の左の広さの中央へ寄せる
  const c = aimLineSheetView.coordinateAt(cv.clientWidth / 2 + 28, cv.clientHeight / 2);
  if (c) aimLineSheetView.setCenter(c.latitude, c.longitude);
}
function aimLineSheetDraw(ctx, { project }) {
  const runs = aimLineSheetCache.runs || [];
  const css = getComputedStyle(document.documentElement);
  const color = { rise: css.getPropertyValue("--good").trim() || "#f08529", set: css.getPropertyValue("--accent").trim() || "#426789" };
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const r of runs) {
    const xy = r.points.map((p) => project(p.latitude, p.longitude));
    ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 8;
    ctx.beginPath(); xy.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    ctx.strokeStyle = color[r.side]; ctx.lineWidth = 4;
    ctx.beginPath(); xy.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    if (xy.length === 1) { ctx.fillStyle = color[r.side]; ctx.beginPath(); ctx.arc(xy[0][0], xy[0][1], 5, 0, 7); ctx.fill(); }
  }
  if (aim.target) {
    const [x, y] = project(aim.target.latitude, aim.target.longitude);
    ctx.fillStyle = "#c0392b"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y - 9); ctx.lineTo(x + 7, y + 5); ctx.lineTo(x - 7, y + 5); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
}
/// タップした所にいちばん近い線の上の点（画面で 28px 以内）。区間の中は距離と時刻をなぞって補う
function aimLineNearest(px, py) {
  let best = null;
  for (const r of aimLineSheetCache.runs || []) {
    const xy = r.points.map((p) => aimLineSheetView.project(p.latitude, p.longitude));
    for (let i = 0; i < xy.length; i++) {
      const j = Math.min(xy.length - 1, i + 1), [ax, ay] = xy[i], [bx, by] = xy[j];
      const L = (bx - ax) ** 2 + (by - ay) ** 2;
      const f = L ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / L)) : 0;
      const d = Math.hypot(ax + (bx - ax) * f - px, ay + (by - ay) * f - py);
      if (!best || d < best.d) {
        const a = r.points[i], b = r.points[j], mix = (k) => a[k] + (b[k] - a[k]) * f;
        best = { d, side: r.side, latitude: mix("latitude"), longitude: mix("longitude"), distanceKm: mix("distanceKm"),
          at: mix("at"), elevationM: mix("elevationM"), radius: mix("radius") };
      }
    }
  }
  return best && best.d <= 28 ? best : null;
}
async function aimLineSheetPick(c, at) {
  if (!at || !aimLineSheetCache.runs?.length) return;
  const note = $("aimLineSheetNote"), hit = aimLineNearest(at.x, at.y);
  if (!hit) { note.textContent = "線の上をタップしてください"; return; }
  const seq = ++aimLineSheetSeq;
  note.textContent = "この地点の時刻を求めています…";
  const [sx, sy] = aimPlacement(), d = 2 * hit.radius;
  let r = null;
  try {
    // 線の点は標高をならして解いている。選んだ所の本当の地面の高さで、場所と時刻を解き直す
    r = await AstroNotesAlign.solveComposition(aim.target, aim.body, { around: hit, distanceKm: hit.distanceKm, at0: Math.round(hit.at),
      dx: sx * d, dy: sy * d, eyeM: 1.5, groundM: hit.elevationM, elevationAt: aimElevation, dayMs: aim.dayMs,
      partId: aim.partId === "__whole" ? null : aim.partId });
  } catch { r = null; }
  if (seq !== aimLineSheetSeq || !$("aimLineSheet").open) return;
  const p = r ? { latitude: r.latitude, longitude: r.longitude, at: r.at, side: r.side } : { ...hit, at: Math.round(hit.at) };
  const { name } = await nearName(p.latitude, p.longitude);
  if (seq !== aimLineSheetSeq || !$("aimLineSheet").open) return;
  $("aimLineSheet").close();
  aimSetFrom({ latitude: p.latitude, longitude: p.longitude, name, subtitle: "撮れる場所から選んだ地点", locationScope: "point" }, { keepMap: true });
  aim.candSide = p.side;
  aim.plannerTransfer = { at: p.at, body: aim.body, latitude: aim.from.latitude, longitude: aim.from.longitude, day: aim.dayMs };
  aimApply();
}
async function aimLineSheetOpen() {
  if (!AIM_PLACE_ENABLED) return;
  if (!aim.target || !Number.isFinite(aim.dayMs)) return;
  if (!aimLineSheetView) {
    aimLineSheetView = createMapView({ canvas: "aimLineCanvas", sheet: "aimLineSheet", zoomIn: "aimLineIn", zoomOut: "aimLineOut" });
    aimLineSheetView.setOverlay(aimLineSheetDraw);
    aimLineSheetView.onPick(aimLineSheetPick);
  }
  const seq = ++aimLineSheetSeq, note = $("aimLineSheetNote");
  $("aimLineSheetTitle").textContent = `撮れる場所 ・ ${aimPlacementSay()}`;
  note.textContent = "線を計算しています…";
  aimLineSheetView.open({ latitude: aim.target.latitude, longitude: aim.target.longitude }, 9);
  let runs = null;
  try { runs = await aimLineRuns(() => seq === aimLineSheetSeq); } catch { runs = null; }
  if (seq !== aimLineSheetSeq) return;
  if (runs === null) { note.textContent = "線を計算できませんでした。閉じてもう一度お試しください。"; return; }
  if (!runs.length) note.textContent = "この日・この重ね方では、陸の上から撮れる場所がありません。";
  else {
    const t = runs.flatMap((r) => r.points.map((p) => p.at));
    note.textContent = `${aimDateLabel(Math.min(...t)).replace(/\s.*$/, "")} ${S.JstCal.hhmm(Math.min(...t))}〜${S.JstCal.hhmm(Math.max(...t))} ・ 線の上をタップすると、その地点と時刻にします`;
  }
  requestAnimationFrame(() => { if (seq === aimLineSheetSeq) { if (runs.length) aimLineSheetFit(runs); aimLineSheetView.redraw(); } });
}
if ($("aimShift")) {
  $("aimLineOpen").onclick = aimLineSheetOpen;
  $("aimLineClose").onclick = () => { aimLineSheetSeq++; $("aimLineSheet").close(); };
  $("aimLineSheet").addEventListener("click", (e) => { if (e.target === $("aimLineSheet")) { aimLineSheetSeq++; $("aimLineSheet").close(); } });
}

function aimReverseClear() {
  if (!aim.reverse) return;
  aim.reverse = null;
  AimMap.redraw();
}

/// 線全体が入る大きさで地図を出し、地図の所まで送る
function aimReverseShow(r, points) {
  const cv = $("aimCanvas"), w = (cv && cv.clientWidth) || 340, h = (cv && cv.clientHeight) || 340;
  const la = points.map((p) => p.latitude), lo = points.map((p) => p.longitude);
  const la0 = Math.min(...la), la1 = Math.max(...la), lo0 = Math.min(...lo), lo1 = Math.max(...lo);
  const mid = { latitude: (la0 + la1) / 2, longitude: (lo0 + lo1) / 2 };
  const cosl = Math.cos(mid.latitude * Math.PI / 180);
  const zx = Math.log2(w * 0.8 * 360 / (256 * Math.max(lo1 - lo0, 1e-4)));
  const zy = Math.log2(h * 0.8 * 360 / (256 * Math.max((la1 - la0) / cosl, 1e-4)));
  AimMap.open(mid, Math.max(8, Math.min(16, Math.floor(Math.min(zx, zy)))));
  requestAnimationFrame(() => AimMap.redraw());
  window.scrollTo({ top: $("aimCanvas").getBoundingClientRect().top + window.scrollY - 80, behavior: "smooth" });
}

/// 逆引きを解き始めたときの条件（替わったら結果を捨てる）
const aimLookKey = () => `${aim.target && aim.target.id}|${aim.body}|${aim.dayMs}|${aim.limb}|${aim.partId}`;

/// 逆引きの結果: どこから・座標・時刻・目標の方角・地図
function aimLookFound(found, r, D) {
  const f = aimFromPoint();
  let from = "";
  if (f) {
    const m = AstroNotesTerrain.distanceKm(f.latitude, f.longitude, r.latitude, r.longitude) * 1000;
    const dir = AIM_DIR8[Math.round(AstroNotesTerrain.bearing(f.latitude, f.longitude, r.latitude, r.longitude) / 45) % 8];
    from = m < 5 ? `${f.name}とほぼ同じ所` : `${f.name}から${dir}へ約${m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.max(1, Math.round(m))}m`}`;
  }
  const toward = AIM_DIR8[Math.round(r.azimuth / 45) % 8];
  found.hidden = false;
  found.innerHTML = `<p class="aim-found-h"><strong>撮れる場所</strong>${from ? ` ・ ${esc(from)}` : ""}</p>`
    + `<p class="sub-line">${r.latitude.toFixed(5)}, ${r.longitude.toFixed(5)}</p>`
    + `<p class="sub-line">${aimLookHMS(r.at)} ${aimSideName(r.side)} ・ ${esc(aim.target.name)}は${toward}（${Math.round(r.azimuth)}°）・ ${aimKm(D)}km</p>`
    + (r.water ? `<p class="sub-line">水の上です</p>` : "")
    + (aim.reverse && aim.reverse.points.length > 1
      ? `<p class="sub-line">同じ見え方になる場所は、地図の線（対象から ${aimKm(aim.reverse.points[0].distanceKm)}〜${aimKm(aim.reverse.points[aim.reverse.points.length - 1].distanceKm)}km）。距離で時刻が変わります</p>` : "")
    + `<button type="button" class="chip" data-found-map>地図で見る</button>`;
  found.querySelector("[data-found-map]").onclick = () => {
    const pts = aim.reverse && aim.reverse.points.length > 1 ? aim.reverse.points : null;
    if (pts) { aimReverseShow(r, pts); return; }
    AimMap.open({ latitude: r.latitude, longitude: r.longitude }, 15);
    requestAnimationFrame(() => AimMap.redraw());
    window.scrollTo({ top: $("aimCanvas").getBoundingClientRect().top + window.scrollY - 80, behavior: "smooth" });
  };
}
let aimLookResize = 0;
window.addEventListener("resize", () => {
  clearTimeout(aimLookResize);
  aimLookResize = setTimeout(() => {
    for (const h of aimLookHosts) {
      if (!h.isConnected) { aimLookHosts.delete(h); continue; }
      // **幅が変わったときだけ描き直す。** iPhone はスクロールでツールバーが出入りするたびに resize が来て、選んだ時刻が戻っていた
      const cv = h.querySelector("canvas");
      if (!h.hidden && h._lookSpec && cv && Math.round(cv.clientWidth) !== h._lookW) aimLookRender(h, h._lookSpec);
    }
  }, 150);
});

let aimReady = false;
/**
 * 何を狙うか。**メニューから来たときは決まっている。**
 *   fuji    … 富士山に重ねる（太陽ならダイヤモンド富士、月ならパール富士）
 *   diamond・pearl … 前の URL。富士山に重ねるを太陽・月で開く
 *   tower   … 塔（既定はスカイツリーに太陽）
 */
const AIM_PRESETS = {
  // 前の URL（#/aim/fuji・#/aim/diamond・#/aim/pearl）は、富士山を選んだ状態で開く
  fuji: { target: "fuji", body: "sun" },
  diamond: { target: "fuji", body: "sun" },
  pearl: { target: "fuji", body: "moon" },
  // メニュー（#/aim/tower）は前に選んだ目標で開く。初めては富士山（許可が無ければ一覧の先頭）。選んだ天体も保持する
  tower: { target: null, body: null },
};

/**
 * 見出しは**いま選んでいるものから決める。**
 * 富士山×太陽なら「ダイヤモンド富士」、富士山×月なら「パール富士」。
 * 目標や天体を変えたら見出しも変わるので、いま何を見ているのか迷わない。
 */
function aimTitleFor() {
  const t = aim.target, sun = aim.body === "sun";
  // 太陽か月かは題名の右の切り替えで分かるので、添え書き（目標と天体）は持たない
  if (t && t.id === "fuji" && AstroNotesBodies.definition(aim.body).limbs) return { title: sun ? "ダイヤモンド富士" : "パール富士" };
  return { title: t && t.name ? t.name : "対象" };
}


// A single atmosphere provider is shared by candidates, inverse solutions and drawing.
const aimAirSettings={mode:"auto",temperatureC:10,pressureHPa:1010,...(store.get("sorami.aimAir",null)||{})};
if(!["auto","standard","none"].includes(aimAirSettings.mode))aimAirSettings.mode="auto";
try{AstroNotesAtmosphere.configure(aimAirSettings.mode,aimAirSettings);}catch{aimAirSettings.mode="auto";AstroNotesAtmosphere.configure("auto");}
let aimAirLoadKey="",aimAirLoadUntil=0,aimAirSeq=0,aimAirCompare=null;
const aimAirAngle=(...args)=>AstroNotesAstro.targetElevationAngle(...args,{k:AstroNotesAtmosphere.targetK()});
function aimAirDescribe(at,obs){
 const air=AstroNotesAtmosphere.at(at,obs),temp=Number.isFinite(air.temperatureC)?air.temperatureC.toFixed(1):"",pressure=Number.isFinite(air.pressureHPa)?Math.round(air.pressureHPa):"";
 // 視線上の上空の気温まで使えた時刻だけ「上空込み」。地上の値だけの日時（上空の予報が無い・候補地が遠い）と区別する
 const line=aimAirSettings.mode==="auto"&&!air.fallback?AstroNotesAtmosphere.lineInfo?.(at,obs):null;
 const modeName={auto:air.fallback?"予報なし・標準値を使用":`${temp}℃ / ${pressure}hPa${line?"・上空込み":""}`,standard:"標準値を使用",none:"補正なし"}[aimAirSettings.mode];
 const summary=$("aimAirSummary"),status=$("aimAirStatus");if(summary.textContent!==modeName)summary.textContent=modeName;
 const value=air.none?"天体・地上の対象とも屈折なし":aimAirSettings.mode==="auto"&&!air.fallback
  ?`${air.source} ・ 地上${temp}℃ / ${pressure}hPa ・ ${line?`上空の気温：視線上${line.points}地点（対象の先${Math.round(line.beyondKm)}kmまで）`:"上空の気温なし（地上の値で計算）"} ・ ${S.JstCal.hhmm(at)}`
  :`${air.source} ・ ${temp}℃ / ${pressure}hPa ・ ${S.JstCal.hhmm(at)}`;
 if(status.textContent!==value)status.textContent=value;
}
/// 視線上の気温を取る相手。目標の場所と高さ（海抜、いちばん上の部位）が決まっているときだけ
function aimAirTarget(){
 const t=aim.target,p=t&&(t.parts||[])[0];
 return p&&Number.isFinite(t.latitude)&&Number.isFinite(t.longitude)&&Number.isFinite(p.m)?{latitude:t.latitude,longitude:t.longitude,topM:p.m}:null;
}
function aimAirEnsure(f,day){
 if(aimAirSettings.mode!=="auto"||!f)return false;
 const target=aimAirTarget();
 const key=`${f.latitude},${f.longitude}|${day}|${target?`${target.latitude},${target.longitude},${target.topM}`:""}`;
 if(aimAirLoadKey===key&&Date.now()<aimAirLoadUntil)return false;
 aimAirLoadKey=key;aimAirLoadUntil=Infinity;const seq=++aimAirSeq;
 $("aimAirSummary").textContent="気象を取得中…"; $("aimAirStatus").textContent="選択地点・日時の気象を取得しています…";
 aim.seq++;aim.lineWork=null;aim.fromSeq++;aim.candSeq++;aim.lookSeq++;aim.spotSeq++;aimCal.seq++;
 (async()=>{try{
 const ground=await aimElevation(f.latitude,f.longitude);if(seq!==aimAirSeq)return;
 const result=await AstroNotesAtmosphere.load({latitude:f.latitude,longitude:f.longitude,elevation:ground},day,{target});
 if(seq!==aimAirSeq)return;
 aimAirLoadUntil=result.refreshAt??(result.loadedAt+(result.error&&result.error!=="予報期間外"?60000:3600000));
 // 長時間かかった取得でも、この完了描画で直ちに再取得をループしない。
 aimAirLoadUntil=Math.max(Date.now()+1000,aimAirLoadUntil);
 }catch{if(seq!==aimAirSeq)return;aimAirLoadUntil=Date.now()+60000;}
 if(seq!==aimAirSeq)return;aimApply();})();
 return true;
}
function aimAirChange(){
 const look=$("aimLook"),spec=look._lookSpec;
 if(spec&&Number.isFinite(look._lookAt))aimAirCompare={at:look._lookAt,latitude:spec.obs.latitude,longitude:spec.obs.longitude,day:S.JstCal.startOfDay(spec.at)};
 aimAirSeq++;aimAirLoadKey="";aimCal.seq++;aimCal.cache.clear();aim.spotCache=null;aimRidgeCache.clear();
 AstroNotesAtmosphere.configure(aimAirSettings.mode,aimAirSettings);store.set("sorami.aimAir",aimAirSettings);
 aimAirSync();
 aimApply();
}
function aimAirSync(){
 $("aimAirMode").value=aimAirSettings.mode;
}
function aimAirChoose(next){
 if(!["auto","standard","none"].includes(next))return;
 aimAirSettings.mode=next;aimAirChange();
}
$("aimAirMode").onchange=()=>aimAirChoose($("aimAirMode").value);
aimAirSync();

/// 構図を使えるかを画面へ出す。以前は openAim が aimView ごと隠していたが、直後の render() が
/// ルートだけで表示へ戻すため、未ログインの直URLで本体が「計算しています…」のまま止まっていた（2026-10-15）
function renderAimAccess() {
  const permitted = screenAllowed("framing");
  $("aimView").toggleAttribute("data-locked", !permitted);
  $("aimAccess").hidden = permitted;
  if (!permitted) {
    $("aimAccessMessage").textContent = auth?.token ? AstroNotesAccess.SCREENS.framing.label + "の利用が許可されていません" : "ログインすると利用権限を確認できます";
    $("aimAccessLogin").hidden = !!auth?.token;
  }
  return permitted;
}
$("aimAccessLogin").onclick = () => $("authButton").click();

function aimResetAlignment(){aim.matchMode='overlap';aim.limb='center';aim.partId=aimIsMountain(aim.target)?null:'__whole';$('aimPart').value=aim.partId||'';aim.plannerTransfer=null;aimApply();}

function openAim(preset) {
  if (!renderAimAccess()) { aim.bodySeq++; return; }
  aimRenderSelectedPoint();
  if (preset) aim.pendingModelPreset = preset;
  const entry = ++aim.bodySeq;
  if (!AstroNotesAssets.modelsReady()) {
    const token = auth?.token;
    $("aimLineInfo").textContent = "形状データを読み込んでいます…";
    AstroNotesAssets.ensureModels().then(() => {
      if (entry === aim.bodySeq && atAim && token === auth?.token) { $("aimLineInfo").textContent = ""; openAim(preset); }
    }).catch(() => {
      if (entry !== aim.bodySeq || !atAim || token !== auth?.token) return;
      $("aimFrom").innerHTML = "";
      $("aimLineInfo").textContent = "形状データを取得できませんでした。";
      const retry = document.createElement("button"); retry.type = "button"; retry.className = "chip"; retry.textContent = "再試行";
      retry.onclick = () => openAim(preset); $("aimLineInfo").append(retry);
      const reload = document.createElement("button"); reload.type = "button"; reload.className = "chip"; reload.textContent = "画面を更新";
      reload.onclick = () => location.reload(); $("aimLineInfo").append(reload);
    });
    return;
  }
  preset = preset ?? aim.pendingModelPreset ?? null; aim.pendingModelPreset = null;
  const body = AIM_PRESETS[preset]?.body || aim.body;
  if (!aimReady) {
    aimReady = true;
    aimFillSelects();
    for (const id of ["aimTarget", "aimPart", "aimDate"]) {
      $(id).onchange = () => {if(id==='aimPart')aim.matchMode='limb';if(id==='aimTarget'){aimCustomRequest++;aim.matchMode='overlap';}aim.plannerTransfer=null;aimApply({ recenter: id === "aimTarget" });};
    }
    $("aimLimb").onclick = (e) => {
      const b = e.target.closest("[data-limb]");
      if (!b) return;
      if(b.getAttribute("aria-pressed") === "true" && aim.matchMode !== "overlap"){aimResetAlignment();return;}
      aim.matchMode="limb";aim.plannerTransfer=null;
      for (const x of $("aimLimb").querySelectorAll("[data-limb]")) x.setAttribute("aria-pressed", String(x === b));
      aimApply();
    };
    $("aimBody").onchange = async () => {
      aim.matchMode='overlap';
      aim.plannerTransfer=null;
      const id = $("aimBody").value, request = ++aim.bodySeq;
      aim.limbsByBody[aim.body] = aimLimbValue() || aim.limb;
      $("aimLineInfo").textContent = "天体を読み込んでいます…";
      try {
        await AstroNotesBodies.ensure(id);
        if (request !== aim.bodySeq) return;
        aim.body = id; aim.limb = aim.limbsByBody[id] || "center";
        aim.candPick = null; aim.wantSpot = null; aim.wantKey = null; aim.spot = null;
        // Previous body's pressed button must not leak into the next body's controls.
        $("aimLimb").innerHTML = "";
        aimApply();
      } catch {
        if (request !== aim.bodySeq) return;
        $("aimBody").value = aim.body;
        $("aimLineInfo").textContent = "天体計算を読み込めませんでした。天体を選び直して再試行してください";
      }
    };
    $("aimHeightSet").onclick = () => {
      const m = Number($("aimHeightM").value);
      if (!Number.isFinite(m) || m < 1 || m > 1000) return;
      const hs = store.get("sorami.aimHeights", {});
      // 入れるのは地上からの高さ。憶えるのは計算に使う海面からの高さ
      hs[`${aim.target.id}:${aim.partId}`] = m + (aim.target.groundM || 0);
      store.set("sorami.aimHeights", hs);
      aimApply();
    };
    // 自分で置いた目標の高さ（地上から）を直す。場所はそのまま
    $("aimCustomSet").onclick = () => {
      const h = Number($("aimCustomH").value);
      // お気に入りの目標なら、お気に入りの高さを直す（同期で他の端末へも）
      const fv = $("aimTarget").value;
      // 欄が標高（山など地上 0m の目標）なら、標高を直す。地上の高さなら地上の高さを直す
      const elev = $("aimCustomH").dataset.mode === "elev";
      if (!Number.isFinite(h) || h < 0 || h > (elev ? 9000 : 1000)) {
        $("aimLineInfo").textContent = elev ? "標高（m）を入れてください。" : "高さ（地上から・m）を入れてください。"; return;
      }
      if (fv.startsWith("fav:")) {
        const i = favorites.findIndex((f) => `fav:${f.id}` === fv);
        if (i < 0) return;
        const before = favorites[i];
        favorites[i] = elev ? { ...before, elevation: h, targetHeightM: 0 } : { ...before, targetHeightM: h };
        if (!saveFavorites()) { favorites[i] = before; return; }
        queuePush("fav", favorites[i].id);
        delete $("aimCustomH").dataset.edited;
        aimApply();
        return;
      }
      const c = store.get("sorami.aimCustom", null);
      if (!c) { $("aimLineInfo").textContent = "先に重ねる対象の場所を選んでください。"; return; }
      store.set("sorami.aimCustom", elev ? { ...c, groundM: h, heightM: 0, heightAuto: false, topM: h }
        : { ...c, heightM: h, heightAuto: false, topM: (c.groundM || 0) + h });
      delete $("aimCustomH").dataset.edited;
      aimFillSelects(); $("aimTarget").value = "custom";
      aimApply();
    };
    // 地図の中心（ピン）を目標の場所にする（自分で置くときだけ出す）
    $("aimPickTarget").onclick = async () => {
      const c = AimMap.center();
      $("aimPickTarget").disabled = true;
      const n = await nearName(c.latitude, c.longitude);
      $("aimPickTarget").disabled = false;
      await aimSetCustomTarget({ name: n.name, subtitle: n.area, latitude: c.latitude, longitude: c.longitude, fromMap: true }, { keepMap: true });
    };
    $("aimPrev").onclick = () => { aim.dayMs -= 86400000; $("aimDate").value = new Date(aim.dayMs + 9 * 3600000).toISOString().slice(0, 10); aimApply(); };
    $("aimNext").onclick = () => { aim.dayMs += 86400000; $("aimDate").value = new Date(aim.dayMs + 9 * 3600000).toISOString().slice(0, 10); aimApply(); };
    // 地図の中心を観測地点にする（検索と同じ観測地点。アプリ全体の地点は変えない）
    $("aimPick").onclick = async () => {
      const c = AimMap.center();
      $("aimPick").disabled = true;
      const n = await nearName(c.latitude, c.longitude);
      $("aimPick").disabled = false;
      aimSetFrom({ name: n.name, subtitle: n.area || "地図の中心", latitude: c.latitude, longitude: c.longitude }, { keepMap: true });
      // 次に重なる日は上の「どこから重ねるか」の下に出る。地図を見ている人に、どこを見ればよいかを一瞬だけ言う
      ($("aimPick").querySelector("span") || $("aimPick")).textContent = "撮影地点にしました ↑";
      setTimeout(() => { ($("aimPick").querySelector("span") || $("aimPick")).textContent = "ここから重ねる"; }, 2500);
    };
    // 地図を動かすたび、中心が線からどれだけ離れているかを出す

    aim.target = AstroNotesAlign.targetById("fuji");
    aimFillParts();
  }
  if (!$("aimDate").value) $("aimDate").value = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  // メニューから来たときは、目標と天体を先に入れる
  const pre = preset && AIM_PRESETS[preset];
  // 許可はログインで変わるので、開くたびに目標の一覧を作り直す（選んでいたものは残る）
  aimFillSelects();
  if (aim.pendingPlan) {
    $("aimTarget").value = aim.sharedTarget.id;
    aim.partId = aim.pendingPlan.part;
    $("aimPart").value = aim.partId;
  }
  if (pre) {
    $("aimTarget").value = pre.target || store.get("sorami.aimTarget", "fuji");
    if (!$("aimTarget").value) $("aimTarget").selectedIndex = 0;
    if (pre.body && pre.body !== aim.body) {
      aim.limbsByBody[aim.body] = aimLimbValue() || aim.limb;
      aim.body = pre.body;
      aim.limb = aim.limbsByBody[aim.body] || "center";
      $("aimLimb").innerHTML = "";
    }
    aim.centerKey = null;
  }
  if (!AstroNotesBodies.definition(body).limbs && !AstroNotesBodies.ready()) {
    const request = entry;
    $("aimBody").value = body;
    $("aimLineInfo").textContent = "天体を読み込んでいます…";
    AstroNotesBodies.ensure(body).then(() => { if(request === aim.bodySeq) openAim(preset); }).catch(() => {
      if(request === aim.bodySeq) {
        $("aimFrom").innerHTML = "";
        $("aimLineInfo").textContent = "天体計算を読み込めませんでした。ページを再読み込みして再試行してください";
      }
    });
    return;
  }
  const ready = aimApply({ redraw: false });
  // ページとして開くので、地図は表示されてから測る（隠れている間は幅が 0）
  requestAnimationFrame(() => {
    AimMap.open(...aimMapView());
    requestAnimationFrame(() => AimMap.redraw());
  });
  // 目標の場所が決まっていなければ、線も一覧も出さない（aimApply が「重ねる目標の場所を選んでください」と出している）。
  // 計算すると「この日は、どこからも重なりません」「線が無いので候補地もありません」と、目標が無いだけなのに重ならないように読めた
  if (!ready) return;
  if ((aim.target.parts || []).length) { aimRedrawLine(); aimRenderList(); }
  aimRenderFrom();
}

/// 地図を開く中心と倍率。目標の場所が決まっていなければ（他の目標をまだ選んでいない）、どこから重ねるかの地点で開く
/// （2026-10-02 ユーザー「他の目標で現在地の場合、地図が何も表示されてない。もう一度現在地を選択すると表示される」。
/// 目標の座標が無いまま地図を開き、中心が無くて何も描かれなかった。地点を選び直すとその地点で開き直すので出ていた）
function aimMapView() {
  const t = aim.target;
  if (Number.isFinite(t.latitude) && Number.isFinite(t.longitude)) {
    return [{ latitude: t.latitude, longitude: t.longitude }, aimZoomFor(t, aim.partId)];
  }
  const f = aimFromPoint() || place;
  return [{ latitude: f ? f.latitude : 35.68, longitude: f ? f.longitude : 139.77 }, 12];
}

// ねらうの観測地点を決めるときは、いまの観測地点のところで地図を開く
// 道具の観測地点・目標を決めるときは、いまのその点のところで地図を開く
$("mapButton").onclick = () => MapPick.open(placeSheetFor && PLACE_PICKERS[placeSheetFor]
  ? (PLACE_PICKERS[placeSheetFor].point() || place) : place);
