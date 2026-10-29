// ---------------------------------------------------------------- 描画
function upcoming(entries, now) {
  return entries.find((e) => !e.evaluation.unavailable && e.evaluation.window[1] > now)
      || entries.find((e) => !e.evaluation.unavailable) || entries[0];
}

// ------------------------------------------------------- 富士山と月（表の行）
//
// **既存の7現象と同じ行として一覧に並べる。** 器を分けない。
// ただし採点に必要なものが違う:
//   富士山 … 地形の測定（通信）＋ 富士山と回廊の予報（通信）
//   月     … 地形の測定（通信）
// どちらも予報の描画を待たせられないので、**あとから足して描き直す**。
//
// 地形はその地点で二度と変わらないので、一度測って憶える（富士 §28）。
let fujiGeom = null, fujiGrid = null;
// ダイヤモンド富士・パール富士。地点ごとに1回だけ計算する（天気と無関係で、年単位で変わらない）
let fujiAlign = null, fujiAlignKey = null;
let fujiAlignObs = null; // 富士山が見えると分かった観測者。ここが決まるまで重なる日は計算できない

/// ダイヤモンド富士・パール富士の計算を始める。
///
/// **道具として許されていなければ計算もしない。** 呼ぶのは2か所:
/// 富士山の見え方が決まったとき（loadExtras）と、使える道具が変わったとき（ログインなど）。
/// loadExtras は走っているあいだ再入しないので、ログインがその途中に来ると
/// 「描き直しで戻ってくる」を当てにできない（2026-10-01）。
function startFujiAlign() {
  if (!toolAllowed("diamond") && !toolAllowed("pearl")) return;
  if (!fujiAlignObs || !fujiGeom || fujiAlignKey === extraKey) return;
  const key = fujiAlignKey = extraKey;
  // 地域の代表地点では出さない。**1km違うと日付が9日ずれる**ので、代表点では嘘になる
  // （田貫湖で実測。→ test-diamond.mjs「立つ場所で日付が変わる」）。
  if (AstroNotesTerrain.locationScope(place) === "area") {
    fujiAlign = { area: true };
    if (picked === "fuji") redrawDayDetail();
    return;
  }
  fujiAlign = { loading: true };
  const obs = fujiAlignObs, geom = fujiGeom;
  // 月まで入れると数百ms。描画を止めないよう、次の間合いへ回す。
  // 捨てるかどうかは地点で見る（回数で見ると、同じ地点の取り直しで「計算しています…」のまま残る）
  setTimeout(() => {
    if (fujiAlignKey !== key) return;
    try { fujiAlign = AstroNotesFuji.alignments(obs, geom, { from: Date.now(), days: 400, limit: 2 }); }
    catch { fujiAlign = null; }
    if (picked === "fuji") redrawDayDetail();
  }, 0);
}
let moonHorizon = null;
let moonObs = null;      // 地平線を測ったときの観測者。詳細の月の出入り計算が同じ前提を使う
let moonUrbanMeta = null; // 建物層の内訳（何棟・推定が何棟・いちばん高いもの）
let moonTerrainProfile = null; // 地形だけの地平線。建物が届いたら重ねて作り直す
let moonUrbanTried = false;    // 建物の取得は地点ごとに1回だけ
let moonUrbanProfile = null, moonPredictionPlace = null, moonEvalSeq = 0, moonWeeklySeq = 0, moonAcceptedSeq = 0;
const moonVisibility = new Map(), moonDetailPending = new Map();
let moonDetailKey = null;

// 建物の地平線。地点ごとに localStorage へ置く。
//
// **毎回引かない。** 半径1kmで 410KB（新宿・gzip後）あり、建物はほぼ動かない。
// 版を上げれば作り直す。建物は数mで変わるため座標を丸めない。
const URBAN_CACHE_KEY = "sorami.urbanHorizon";
const URBAN_CACHE_VERSION = 2;
const URBAN_MAX_AGE_MS = 180 * 86400000;   // 半年

function cachedUrbanHorizon(obs) {
  if (AstroNotesTerrain.locationScope(obs) === "area") return null;
  const key = AstroNotesTerrain.urbanCacheKey(obs), box = store.get(URBAN_CACHE_KEY, null);
  const hit = box?.v === URBAN_CACHE_VERSION ? box.items?.[key] : null;
  if (!hit || Date.now() - hit.at >= URBAN_MAX_AGE_MS) return null;
  const prof = hit.profile; prof.meta = hit.meta; return prof;
}
const urbanPending = new Map();
function loadUrbanHorizon(obs) {
  const key = AstroNotesTerrain.urbanCacheKey(obs);
  if (urbanPending.has(key)) return urbanPending.get(key);
  const job = computeUrbanHorizon(obs).finally(() => { if (urbanPending.get(key) === job) urbanPending.delete(key); });
  urbanPending.set(key, job); return job;
}
async function computeUrbanHorizon(obs) {
  if (AstroNotesTerrain.locationScope(obs) === "area") return null;
  const cached = cachedUrbanHorizon(obs); if (cached) return cached;
  const key = AstroNotesTerrain.urbanCacheKey(obs), box = store.get(URBAN_CACHE_KEY, null);
  // 1km が通らない時間帯があるので段階で試す（内訳にどの半径を使ったか残る）
  const prof = await AstroNotesTerrain.urbanHorizon(obs, { radiusM: [1000, 400] });
  if (!prof) return null;
  // 保存するのは方位と角度だけ（0.01度で丸める）。生の建物は持たない
  const slim = prof.map((x) => ({ azimuth: x.azimuth,
                                  horizonAngleDeg: Math.round(x.horizonAngleDeg * 100) / 100 }));
  const next = (box && box.v === URBAN_CACHE_VERSION) ? box : { v: URBAN_CACHE_VERSION, items: {} };
  next.items[key] = { at: Date.now(), profile: slim, meta: prof.meta };
  // 地点を増やしすぎない。古いものから落とす
  const keys = Object.keys(next.items);
  if (keys.length > 12) {
    keys.sort((a, b) => next.items[a].at - next.items[b].at);
    for (const k of keys.slice(0, keys.length - 12)) delete next.items[k];
  }
  store.set(URBAN_CACHE_KEY, next);
  slim.meta = prof.meta;
  return slim;
}
let extrasRunning = false, extrasRunningSeq = -1;   // 再入を防ぐ（render は何度も呼ばれる）
let extraKey = null;         // どの地点のものか
let extraSeq = 0;            // 地点を切り替えたときに、遅れて来た結果を捨てる

const groundDemCache = new Map();   // 地点の座標 → DEM の地面の標高（測れなければ null）
// **地面の標高は DEM から取る。**
// `bundle.home.grid.elevation` は「予報を取った地点」のもので、地点を切り替えた直後は
// 前の地点の値が残る。山中湖で東京の 30m を使い、富士山が地形に隠れる判定になった
// （2026-09-14）。手入力の標高も、座標がずれていれば嘘になる（富士 §7・§8）。
/// 立つ場所の地面の標高。国土地理院の標高APIで、その地点で最も精度の高いDEM（1m→5m→10mメッシュ）。
/// 海と取れない所は null（呼び手が地点の標高などで補う）。2026-10-05 まで10mメッシュのタイル z13（1画素 約16m）だった
async function groundAt(lat, lon) {
  try {
    const v = await AstroNotesTerrain.groundElevation(lat, lon, { withSource: true });
    return v && v.source !== "海" && Number.isFinite(v.elevation) ? v.elevation : null;
  } catch { return null; }
}
/// いまの地点の地面を DEM で測っておく。富士山・月の計算（loadExtras）の最初に待つ
async function measureGroundHere() {
  const key = `${place.latitude},${place.longitude}`;
  if (groundDemCache.has(key)) return;
  groundDemCache.set(key, await groundAt(place.latitude, place.longitude));
}
/**
 * **いま選んでいる地点の「目の高さ」。** 展望台を選んでいればその高さを足す。
 *
 * 地面の標高は DEM（測る前・測れなければ地点の標高、無ければ予報の格子）。**ここを1か所にまとめる。**
 * 画面ごとに `place.elevation ?? 0` と書いていたため、富士山と月は展望台を見て、
 * 「ねらう」と「空の見え方」は見ていない、という食い違いが起きていた
 * （2026-09-28 ユーザー指摘で発覚）。
 *
 * **同じ名前の関数を2つ置かない。** 2026-09-28 にこの同期版を別の場所に足したら、
 * 先にあった DEM を測る非同期版を上書きし（後から書いた宣言が勝つ）、富士山と月の計算が
 * 予報の格子の標高に戻っていた。地点の範囲（locationScope）も渡らず、町の代表点でも
 * 近くの建物を取りに行っていた（詳細には「含めていません」と書いたまま）。2026-10-01 に1つへまとめた
 */
function observerHere() {
  const ground = groundDemCache.get(`${place.latitude},${place.longitude}`)
    ?? place.elevation ?? bundle?.home.grid.elevation ?? 0;
  return { latitude: place.latitude, longitude: place.longitude,
           groundM: ground, eyeHeightAGL: place.eyeHeightAGL ?? 1.5,
           locationScope: AstroNotesTerrain.locationScope(place),
           elevation: ground + (place.eyeHeightAGL ?? 1.5) };
}

async function loadFujiGrid() {
  if (fujiGrid) return fujiGrid;
  try {
    const r = await fetch("data/fuji-grid.json");
    if (!r.ok) return null;
    fujiGrid = await r.json();
  } catch { fujiGrid = null; }
  return fujiGrid;
}

const readingFor = (t) => AstroNotesFuji.readAt(bundle.home, t, AstroNotesFuji.HOME_NEEDS);
const airFor = (t) => (bundle.air
  ? { aerosol_optical_depth: bundle.air.isSupported("aerosol_optical_depth") ? bundle.air.valueAt("aerosol_optical_depth", t) : null,
      dust: bundle.air.isSupported("dust") ? bundle.air.valueAt("dust", t) : null }
  : null);

async function updateMoonPrediction(obs, forPlace, seq) {
  const mine = ++moonWeeklySeq, terrain = moonTerrainProfile, urban = moonUrbanProfile;
  const dto = await AstroNotesPrediction.visibility({ kind: "moon", place: forPlace, observer: obs,
    terrain, urban, geometry: null });
  if (seq !== extraSeq || mine < moonAcceptedSeq) return;
  moonAcceptedSeq = mine; moonTerrainProfile = terrain; moonUrbanProfile = urban;
  moonHorizon = AstroNotesTerrain.combinedHorizon({ terrain: terrain || AstroNotesTerrain.flatProfile(), urban });
  moonPredictionPlace = forPlace;
  weeks.moon = dto.weeks.moon;
  const detailKey = `${dto.visibilityKey}:${dto.asOf}:${dto.bundle.fetchedAt}`;
  if (moonDetailKey !== detailKey) { moonDetailKey = detailKey; ++moonEvalSeq; moonVisibility.clear(); moonDetailPending.clear(); }
  rerenderList(); refreshLightTimes();
}

function requestMoonDetails(dayMs) {
  if (!moonObs || !moonPredictionPlace || !forecastDays.includes(dayMs)) return;
  if (moonVisibility.has(dayMs) || moonDetailPending.has(dayMs)) return;
  const seq = extraSeq, mine = moonEvalSeq, obs = moonObs, forPlace = moonPredictionPlace;
  const job = AstroNotesPrediction.visibility({ kind: "moonDetail", place: forPlace, observer: obs,
    terrain: moonTerrainProfile, urban: moonUrbanProfile, geometry: null, dayMs });
  moonDetailPending.set(dayMs, job);
  job.then(dto => {
    if (seq !== extraSeq || mine !== moonEvalSeq) return;
    moonVisibility.set(dayMs, dto.moonVisibility[0]); refreshLightTimes();
  }).catch(() => {
    if (seq !== extraSeq || mine !== moonEvalSeq) return;
    moonVisibility.set(dayMs, { failed: true }); refreshLightTimes();
  }).finally(() => { if (moonDetailPending.get(dayMs) === job) moonDetailPending.delete(dayMs); });
}

/// 富士山と月の行を作って `weeks` へ入れ、表を描き直す
async function loadExtras() {
  if (!bundle) return;
  const seq = extraSeq;
  await measureGroundHere();
  if (seq !== extraSeq) return;
  const obs = observerHere();
  const forPlace = predictionPlace || place;
  const key = `${AstroNotesTerrain.urbanCacheKey(obs)}:${obs.locationScope}`;
  // 地点が変わったら**全部捨てる**。建物の取得フラグを残すと、引っ越しても
  // 前の場所の地平線のままになる
  if (key !== extraKey) {
    fujiGeom = null;
    fujiAlign = null; fujiAlignKey = null; fujiAlignObs = null;
    moonHorizon = null; moonObs = null;
    moonTerrainProfile = null; moonUrbanMeta = null; moonUrbanTried = false;
    moonUrbanProfile = null; moonPredictionPlace = null; moonEvalSeq++;
    moonVisibility.clear(); moonDetailPending.clear();
    extraKey = key;
  }
  const days = forecastDays.length ? forecastDays : weeks[Object.keys(weeks)[0]]?.map((e) => e.dayMs) ?? [];
  if (!days.length) return;

  // ---- 月。地形の地平線は、月が出入りする方角だけ測る
  if (!moonHorizon) {
    let fn = () => 0;
    try {
      // 全周を1度刻みで測る。
      //
      // 以前は「今日の月の出入り方位 ±8度」だけを測っていたが、月の出の方位は
      // 14日で 45度以上動く（東京: 79.9〜125.3度、月の入 234.6〜284.3度）。
      // 測っていない方位は `horizonFunction` が**線形補間で埋める**ので、
      // 表の後ろのほうの日は、実際には測っていない地平線で判定していた。
      //
      // 方位を増やしてもDEMタイルは共有される。実測（z11・maxKm 40）:
      //   27方位 → 11枚 / 全周1度 360方位 → 24枚（全周2度も同じ24枚）
      // 増えるのは13枚ぶんで、しかも遅延読み込み。補間をやめる価値のほうが大きい。
      const azs = [];
      for (let a = 0; a < 360; a += 1) azs.push(a);
      const prof = await AstroNotesTerrain.measureHorizon(obs, azs, { maxKm: 40 });
      if (seq !== extraSeq) return;

      fn = AstroNotesTerrain.combinedHorizon({ terrain: prof });
      moonTerrainProfile = prof;
    } catch { /* 測れなくても平らな地平線で出す。**黙って消さない** */ }
    if (seq !== extraSeq) return;
    moonHorizon = fn;
  }
  if (seq !== extraSeq) return;
  moonObs = obs;
  const savedUrban = cachedUrbanHorizon(obs);
  if (savedUrban) { moonUrbanTried = true; moonUrbanMeta = savedUrban.meta; moonUrbanProfile = savedUrban; }

  // 建物は**待たない**。
  //
  // 新宿中央公園では月が地平線より上にいる時間の 31.3% が建物の裏で、
  // 地形だけだと市街地の地平線はほぼ 0度。見えない時間を見えると言ってしまうので
  // 建物は要る。だが Overpass は混むと 30秒返ってこない（実測）。
  // 待ってから月の行を作ると、その間ずっと行が出ない。
  // **先に地形だけで出して、建物が届いたら差し替える。**
  //
  // **地形が取れたかどうかと切り離す。** 地形の測定は標高APIが混むと 429 で落ちるが、
  // 市街地の地平線を決めているのは地形ではなく建物。地形が無いことを理由に
  // 建物まで諦めると、いちばん効く層を捨てることになる（2026-09-14 実際にそうなっていた）。
  if ((!moonUrbanTried || urbanPending.has(AstroNotesTerrain.urbanCacheKey(obs))) && !moonUrbanProfile && obs.locationScope !== "area") {
    moonUrbanTried = true;
    loadUrbanHorizon(obs).then(async (urban) => {
      if (seq !== extraSeq) return;
      if (!urban) { moonUrbanTried = false; extrasRetry.schedule(); return; }
      // **建物だけで地平線を作らない。** 建物の無い方位は −90（何も言わない）なので、
      // 下敷きが無いと月が常に地平線の上になる。地形が測れていなければ平らな 0 を敷く。
      moonHorizon = AstroNotesTerrain.combinedHorizon({
        terrain: moonTerrainProfile || AstroNotesTerrain.flatProfile(), urban });
      moonUrbanMeta = urban.meta;
      moonUrbanProfile = urban;
      // **効くのは主に時刻で、点数ではない。**
      // `evaluateDay` は1日を走査して最良の時刻を採るので、低空が塞がれても
      // 月が高く昇れば点数は変わらない。変わるのは月の出入りと「見え始め」の時刻。
      // 実測（芝公園・西南西にザ・プリンス パークタワー 117.5m）:
      //   月の出はほぼ動かず（0〜5分）、**月の入りが 80〜130分早まる**。
      // 点数が動くのは「その日ずっと建物の裏」のときだけ。それでも付け直すのは、
      // 代表時刻（peak）が変わるのと、その「ずっと裏」の日を拾うため。
      await updateMoonPrediction(obs, forPlace, seq);
    }).catch(() => { if (seq === extraSeq) { moonUrbanTried = false; extrasRetry.schedule(); } });
  }
  try { await updateMoonPrediction(obs, forPlace, seq); } catch { if (seq === extraSeq) extrasRetry.schedule(); }
  if (seq !== extraSeq) return;

  // ---- 富士山。日本の外なら出さない
  if (!AstroNotesTerrain.inJapan(obs.latitude, obs.longitude)) { delete weeks.fuji; delete weeks.capCloud; return; }
  const grid = await loadFujiGrid();
  if (seq !== extraSeq) return;
  if (!grid) { extrasRetry.schedule(); return; }
  if (!fujiGeom) {
    let resolved = null;
    try { resolved = await AstroNotesFuji.resolveGeometry(obs, grid, { store: window.localStorage }); }
    catch { /* Geometry may be unavailable. */ }
    if (seq !== extraSeq) return;
    fujiGeom = resolved;
  }
  // 地形で見えないなら行ごと出さない。「見えません」を14日ぶん並べても邪魔なだけ
  if (!fujiGeom || !fujiGeom.available || fujiGeom.classification === "NONE") { delete weeks.fuji; delete weeks.capCloud; return; }
  // ---- ダイヤモンド富士・パール富士。**天気と無関係**なので、予報を待たずに始める。
  // 地域の代表地点では出さない。**1km違うと日付が9日ずれる**ので、代表点では嘘になる
  // （田貫湖で実測。→ test-diamond.mjs「立つ場所で日付が変わる」）。
  fujiAlignObs = obs;
  startFujiAlign();

  try {
    const dto = await AstroNotesPrediction.visibility({ kind: "fuji", place: forPlace, observer: obs,
      terrain: null, urban: null, geometry: fujiGeom });
    if (seq !== extraSeq) return;
    weeks.fuji = dto.weeks.fuji;
    if (dto.weeks.capCloud) weeks.capCloud = dto.weeks.capCloud;
    else {
      delete weeks.capCloud;
      if (dto.retryAt) extrasRetry.schedule(dto.retryAt - dto.asOf);
    }
  } catch { if (seq === extraSeq) extrasRetry.schedule(); }

  if (seq === extraSeq) rerenderList();
}

/// 一覧の表だけ描き直す。**詳細を開いている最中は触らない**（読んでいる画面を奪わない）
/// 現象のアイコン。**月だけはその日の満ち欠けを出す。**
/// 満月か細い月かは「行くかどうか」を左右するので、装飾ではなく識別の一部
/// （04_デザイン定義「絵文字は現象の識別にだけ使う」）。
/// 名前が隣にあるので、絵文字が日によって変わっても行は見分けられる。
function iconFor(id, atMs, { text = false, observer = null, portrait = false } = {}) {
  const meta = S.PHENOMENA[id];
  if (!meta) return '';
  if (id === "moon" && typeof AstroNotesMoon !== "undefined") {
    try {
      const point = observer || place;
      const obs = { latitude: point.latitude, longitude: point.longitude, elevation: 0 };
      const moon = AstroNotesAstro.moon(atMs ?? Date.now(), obs);
      if (text) return AstroNotesMoon.phaseOf(moon).name;
      if (portrait && typeof AstroNotesCalendarMoon !== "undefined") return AstroNotesCalendarMoon.markup(moon);
      return typeof AstroNotesIcons === "undefined" ? "月" : AstroNotesIcons.moon(moon);
    } catch { /* Keep an unquantified moon, never invent a phase. */ }
  }
  return text || typeof AstroNotesIcons === "undefined" ? (id === "moon" ? "月" : meta.icon) : AstroNotesIcons.icon(id);
}
// Owned UI markup only. Text exports use iconFor(..., {text:true}) for phase names.
const moonGlyphAt = (atMs, observer) => iconFor("moon", atMs, { observer, portrait: true });
/// 月を撮る時刻の空の明るさの手がかり。「日の入の25分後 ・ 月の出の1時間10分後」
/// （2026-10-01 ユーザー「月系は空の明るさが重要だから、日の出何分後とか月の出何分後とかの情報をサクッと書いておいてほしい」）。
/// 太陽は前後6時間の日の出入りからの差（20時台でも「日の入の3時間27分後」と言える。真夜中だけ「夜のまんなか」）、
/// 太陽が10°より高ければ「日中」（分は写りに効かない）。月の出入りは3時間以内だけ（それより先は高く昇っている）。
/// 月の結果を出すところ（パール富士・ねらうの月・月丼・ISS の月）は全部これを使う
/// 日付の目盛りの間を動かしている間だけ、前後の日の同じ時刻の位置を見た目で結ぶ（2026-10-15 ユーザー採用）。
/// 途中は実在の時刻の位置ではない。指を離すと正確な日時の計算へ戻る
function blendBodyState(a, b, f) {
  const out = { ...(f < 0.5 ? a : b) };
  const wrap = (x, y) => { const d = (((y - x) % 360) + 540) % 360 - 180; return (((x + d * f) % 360) + 360) % 360; };
  for (const k of ["azimuth", "brightLimbZenithAngle"]) if (Number.isFinite(a[k]) && Number.isFinite(b[k])) out[k] = wrap(a[k], b[k]);
  for (const k of ["altitude", "apparentAltitude", "geometricAltitude", "illuminatedFraction", "angularRadius", "upperRadius", "lowerRadius"])
    if (Number.isFinite(a[k]) && Number.isFinite(b[k])) out[k] = a[k] + (b[k] - a[k]) * f;
  return out;
}
function lightTimingText(atMs, obs) {
  let r;
  try {
    r = AstroNotesAstro.nearestRiseSet(atMs, { latitude: obs.latitude, longitude: obs.longitude,
      elevation: obs.elevation ?? obs.elevationM ?? 0 }, { windowMs: 6 * 3600000 });
  } catch { return ""; }
  const dur = (m) => (m < 60 ? `${m}分` : `${Math.floor(m / 60)}時間${m % 60 ? `${m % 60}分` : ""}`);
  const say = (e, rise, set) => {
    const name = e.kind === "rise" ? rise : set;
    return e.minutes === 0 ? `${name}ちょうど` : `${name}の${dur(Math.abs(e.minutes))}${e.minutes > 0 ? "後" : "前"}`;
  };
  return [r.sunAltitude > 10 ? "日中" : r.sun ? say(r.sun, "日の出", "日の入") : r.sunAltitude > 0 ? "日中" : "夜のまんなか",
    r.moon && Math.abs(r.moon.minutes) <= 180 ? say(r.moon, "月の出", "月の入") : ""].filter(Boolean).join(" ・ ");
}
/// 月相の呼び名（詳細で添える）
function phaseNameFor(atMs) {
  try {
    const obs = { latitude: place.latitude, longitude: place.longitude, elevation: 0 };
    const m = AstroNotesAstro.moon(atMs, obs);
    return `${AstroNotesMoon.phaseOf(m).name}・輝面 ${Math.round(m.illuminatedFraction * 100)}%`;
  } catch { return ""; }
}

/// 詳細の下半分だけ描き直す。あとから届いた計算（ダイヤモンド富士など）を反映するため。
/// 一覧を見ているときや、別の現象を見ているときは何もしない。
/// 稜線が届いたら、詳細の「光の時間」だけを描き直す（「この場所では 日の出・日の入」が稜線を使う）。
/// 詳細を丸ごと描き直すと、記録のゲージを動かしている途中で消えるので、カードだけ差し替える
function refreshLightTimes() {
  const lt = $("lightTimes");
  if (!picked || !weeks[picked] || document.querySelector("#detailView[hidden]")) return;
  const sel = weeks[picked].find((e) => e.dayMs === selectedDay[picked]) || upcoming(weeks[picked], Date.now());
  if (!sel) return;
  const html = renderLightTimes(sel.dayMs, Date.now(), picked);
  if (html && lt) { lt.outerHTML = html; wireMoonTimeRetry($("lightTimes")); }
  const mt = $("moonTimes");
  if (mt && picked === "moon") { mt.outerHTML = renderMoonTimes(sel.dayMs); wireMoonTimeRetry($("moonTimes")); }
}
function redrawDayDetail() {
  if (!picked || !weeks[picked]) return;
  const host = $("dayDetail");
  if (!host || document.querySelector("#detailView[hidden]")) return;
  const dayMs = selectedDay[picked];
  const sel = weeks[picked].find((e) => e.dayMs === dayMs) || weeks[picked][0];
  if (!sel) return;
  host.innerHTML = renderDayDetail(picked, weeks[picked], sel, Date.now());
  wireDayDetail(host);
}

function rerenderList() {
  if (!bundle) return;
  const inDetail = !!document.querySelector("#detailView:not([hidden])");
  if (inDetail) return;
  render();
}

/**
 * 画面の一覧。**上から順に強い**（詳細を開いていれば、ほかの指定より詳細が勝つ）。
 * 画面を足すときは、ここに1行足して `routeFromHash` に道を足すだけにする。
 */
const VIEWS = [
  { id: "almanac", el: "almanacView", on: () => atAlmanac },
  { id: "detail",  el: "detailView",  on: () => !!(picked && weeks[picked]) },
  { id: "admin",   el: "adminView",   on: () => atAdmin },
  { id: "records", el: "recordsView", on: () => atRecords },
  { id: "answers", el: "answersView", on: () => atAnswers },
  { id: "skymap",  el: "skyMapView",  on: () => atSkyMap },
  { id: "aim",     el: "aimView",     on: () => atAim },
  { id: "plane",   el: "planeView",   on: () => atPlane },
  { id: "iss",     el: "issView",     on: () => atIss },
  { id: "list",    el: "listView",    on: () => true },
];


function renderForecastTabs(view) {
  const visible=view==='list'||view==='answers';
  $("forecastTabs").hidden=!visible;
  for(const id of ["forecastTab","resultsTab"]){const selected=(id==='resultsTab')===(view==='answers');$(id).setAttribute('aria-selected',String(selected));$(id).tabIndex=selected?0:-1;}
}
function selectForecastTab(results){
  const hash=results?'#/forecast/results':'#/';
  if((results&&atAnswers)||(!results&&currentView==='list'))return;
  pushRoute(hash);
}
$("forecastTab").onclick=()=>selectForecastTab(false);
$("resultsTab").onclick=()=>selectForecastTab(true);
$("forecastTabs").onkeydown=e=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
  e.preventDefault();const results=e.key==='End'?true:e.key==='Home'?false:document.activeElement?.id==='forecastTab';
  selectForecastTab(results);$(results?'resultsTab':'forecastTab').focus();
};

function render() {
  if (!routeFromHash() || routeFromHash().id || (atAnswers && toolAllowed("records"))) void savedRoundClient.ensure(place, () => render());
  const now = Date.now();
  $("placeName").textContent = place.name;
  const subParts = [];
  if (place.subtitle) subParts.push(place.subtitle);
  const elev = place.elevation ?? bundle?.home.grid.elevation;
  if (elev !== null && elev !== undefined) subParts.push(`標高 ${Math.round(elev)}m`);
  // 展望台の上に立っているなら、そう書く。**地平線も月の出も変わる**ので黙らない
  const agl = place.eyeHeightAGL;
  if (Number.isFinite(agl) && agl > 2) {
    const deck = (place.decks || []).find((d) => d.aglM === agl);
    subParts.push(deck
      ? `${AstroNotesTerrain.deckLabel(deck.name, place.name)} 地上${agl}m`
      : `立つ高さ 地上${agl}m`);
  }
  // 時刻はすべて【その地点の現地時間】。端末の時差と違うときは、そう書かないと
  // 「今日 18:44」を自分の時計の時刻だと読んでしまう。
  if (bundle && bundle.utcOffsetSeconds !== null && bundle.utcOffsetSeconds !== undefined) {
    const deviceOffset = -new Date().getTimezoneOffset() * 60;
    const diffHours = (bundle.utcOffsetSeconds - deviceOffset) / 3600;
    if (Math.abs(diffHours) >= 0.5) {
      const h = Math.abs(diffHours) % 1 === 0 ? Math.abs(diffHours) : Math.abs(diffHours).toFixed(1);
      subParts.push(`時刻は現地時間（お使いの端末より${h}時間${diffHours > 0 ? "先" : "前"}）`);
    }
  }
  $("placeSub").textContent = subParts.join(" ・ ");

  // **メニューはどの画面でも出す。** 描き直しのたびに見直しておけば、
  // ログインの復帰がいつ終わっても、画面を移っても、取りこぼさない
  renderTools();
  renderDeckRow();
  const best = pickHighlight(weeks, now);
  // 並び: 見られる見込みのあるものが先 → あとは PHENOMENA.order（似たものが隣）。
  //
  // 以前は「直近に起きる順」で並べていたが、7日ぶんを一度に見る表では
  // どの行も同じ7日を持つので「直近」に意味がない。しかも日をまたぐたびに
  // 行が入れ替わり、いつも同じ場所を見れば済むという利点を失っていた。
  // 固定順にして、行の位置が動かないようにする。
  //
  // 対象外（標高が足りない・氷点下にならない等）だけ最後へ回す。
  // その行はセルが無く1本のメッセージになるので、間に挟まると表が分断される。
  //
  // 並び替えを選んでいるときも、この「対象外は最後」だけは変えない。
  // 点数の付かない行を点数順の途中へ挟むと、並べた意味が消える。
  const key = SORTS[sortMode] && SORTS[sortMode].key;
  const order = Object.keys(weeks).sort((a, b) => {
    const ua = upcoming(weeks[a], now), ub = upcoming(weeks[b], now);
    const aOk = ua && !ua.evaluation.unavailable, bOk = ub && !ub.evaluation.unavailable;
    if (aOk !== bOk) return aOk ? -1 : 1;
    if (key && aOk) {
      const d = key(ua) - key(ub);
      if (d) return d;
    }
    return S.PHENOMENA[a].order - S.PHENOMENA[b].order;
  });
  // 選択中の現象。未選択なら見どころ、それも無ければ評価できる最初のもの。
  const evaluable = order.filter((id) => {
    const u = upcoming(weeks[id], now);
    return u && !u.evaluation.unavailable;
  });
  // **出す画面は1つ。上から順に強い。**
  // 以前は画面ごとに「他の画面でないこと」を条件へ書き足しており、
  // 6画面で15個の比較になっていた。画面を足すたびに既存の6行を直す必要があり、
  // 順番を間違えても気づけない。**表に1行足すだけ**にする（2026-09-28）。
  const view = VIEWS.find((v) => v.on()).id;
  for (const v of VIEWS) $(v.el).hidden = v.id !== view;
  globalThis.TrialExplore?.render();globalThis.AstroNotesJourney?.render();
  // 表示はルートだけで決まるので、構図の権限はここでも当て直す。ログアウトした直後も本体を出さない
  if (view === "aim") renderAimAccess();
  for (const id of ["plane", "iss", "records", "answers"]) renderToolAccess(id);
  // 一覧以外の画面では、題名の帯の下に「← 戻る」
  $("backBar").hidden = isMenuPage();
  renderForecastTabs(view);
  const inDetail = view === "detail";
  // 地点と実況は判断のための情報。**その地点が主語の画面（一覧・詳細・空の見え方）だけに出す。**
  // ダイヤモンド富士や月丼の上に出すと、何の地点なのか分からなかった（2026-09-30 ユーザー指摘）。
  // それらの道具は自分のスポット一覧を持つ
  currentView = view;
  if (view === "almanac") renderAlmanac();
  $("placeRow").hidden = !placeCardShown();
  // 展望台の選択は地点カードの続き。地点を出さない画面では一緒に隠す
  if (!placeCardShown()) $("deckRow").hidden = true; else renderDeckRow();

  if (inDetail) {
    $("detailPane").innerHTML = renderDetailPane(picked, now);
    if ($("dayDetail")) wireDayDetail($("dayDetail"));
    // 直接リンクで遠い日を開いても、選択したボタンを横スクロール内に出す。
    const strip = $("detailWeek").querySelector(".days");
    const active = strip.querySelector('[aria-pressed="true"]');
    if (active) strip.scrollLeft = Math.max(0, active.offsetLeft - strip.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2);
    for (const el of strip.querySelectorAll("[data-day]")) {
      el.onclick = () => {
        const dayMs = +el.dataset.day;
        const sel = weeks[picked].find((e) => e.dayMs === dayMs);
        if (!sel) return;
        selectedDay[picked] = dayMs;
        // hashchange で画面全体を再描画すると横位置・フォーカス・縦位置が戻る。
        // 履歴の深さ（history.state）は残す。null で置き換えると、一覧へ戻る釦が戻る段数を失う
        history.replaceState(history.state, "", `#/${picked}/${dayMs}`);
        for (const day of strip.querySelectorAll("[data-day]")) {
          day.setAttribute("aria-pressed", String(+day.dataset.day === dayMs));
        }
        $("dayDetail").innerHTML = renderDayDetail(picked, weeks[picked], sel, Date.now());
        wireDayDetail($("dayDetail"));
              $("dayAnnouncement").textContent = `${S.Cal.monthDay(dayMs)} ${S.Cal.weekday(dayMs)}の詳細に切り替えました。${sel.evaluation.unavailable ? sel.evaluation.unavailable.message : S.phrasing(picked, sel.evaluation.rank).label}`;
      };
    }
  } else if (!bundle) {
    $("bestNote").hidden = true;
    $("cards").innerHTML = renderSkeleton(now);
  } else {
    renderBestNote(best, now);
    // 表ごと作り直すと、選んでいた並び替えから焦点が外れる。描き直しは
    // 並べ替えたとき以外（予報の到着・同期）にも走るので、ここで見て戻す。
    const sortHadFocus = document.activeElement && document.activeElement.id === "sortSelect";
    $("cards").innerHTML = renderMatrix(order, now);
    // 並び替えは表の左上にある。表ごと作り直されるので、毎回つなぎ直す
    const sel = $("sortSelect");
    if (sel) {
      sel.innerHTML = Object.entries(SORTS).map(([id, o]) =>
        `<option value="${id}">${o.label}</option>`).join("");
      sel.value = sortMode;
      if (sortHadFocus) sel.focus();
    }
    for (const el of $("bestNote").querySelectorAll("[data-cell]")) {
      el.onclick = () => { const [id, d] = el.dataset.cell.split("|"); pick(id, now, +d); };
    }
    // 横スクロールしているかどうかで、現象名の右のぼかしを出し分ける。
    // #cards は描き直すたびに中身が入れ替わるので、ここで毎回つなぐ。
    const mxs = $("cards").querySelector(".mxscroll");
    if (mxs) {
      const syncFade = () => mxs.classList.toggle("scrolled", mxs.scrollLeft > 0);
      mxs.addEventListener("scroll", syncFade, { passive: true });
      syncFade();
    }
    for (const el of $("cards").querySelectorAll("[data-cell]")) {
      el.onclick = () => {
        const [id, dayMs] = el.dataset.cell.split("|");
        pick(id, now, +dayMs);
      };
    }
    if (sel) sel.onchange = () => {
      sortMode = SORTS[sel.value] ? sel.value : "standard";
      store.set("sorami.sort", sortMode);
      render();
      // 何順になったかは、行が動いただけでは読み上げられない。
      $("listAnnouncement").textContent = `${SORTS[sortMode].label}で並べ替えました`;
    };
  }

  // **一覧のときだけ出す。** recPending は listView の外にある独立したカードなので、
  // listView を隠しても消えない。隠す画面を並べて書いていたため、あとから足した道具の画面
  // （ねらう・空の見え方・月丼・ISS）の下に「実際はどうでしたか？」が出ていた（2026-10-01）。
  // 詳細には詳細の中に同じ入口がある
  renderRecords(now, view !== "list");
  // ホームと記録画面の「実際はどうでしたか？」も同じ配線に乗せるため、
  // 描画をすべて終えてから束ねる。
  wireOutcomes(document.querySelector("main"));
  // 一覧の下は、何時の予報かと出典だけを「出典」に畳んで置く（2026-10-01 ユーザー「細かい説明文ってこのApp上はいらない」
  // 「出しておいた方がいいなら畳んでおいてほしい」）。計算の仕組み・信頼度の説明・断り書きの段落は外した（A/B/C は表の凡例にある）。
  // **出典は消さない。** Open-Meteo・OSM・国土地理院・気象庁は出典の表示が利用の条件で、加工したらその旨も書く
  $("footerBody").innerHTML =
    `${bundle ? S.JstCal.hhmm(bundle.fetchedAt) : "—"} 時点の予報をもとにこのアプリで点数化<br>`
    + `予報：Open-Meteo ／ 光害：<a href="https://djlorenz.github.io/astronomy/lp/">Lorenz Light Pollution Atlas 2025</a>（VIIRS） ／ 検索：OSM Nominatim ・ 標高：国土地理院 ・ 都庁3D：<a href="https://www.geospatial.jp/ckan/dataset/plateau-13104-shinjuku-ku-2025">PLATEAU 新宿区2025</a>（抽出・加工、<a href="https://www.mlit.go.jp/plateau/site-policy/">利用条件</a>） ・ 4施設3D：PLATEAU <a href="https://www.geospatial.jp/ckan/dataset/plateau-13113-shibuya-ku-2025">渋谷区</a>・<a href="https://www.geospatial.jp/ckan/dataset/plateau-13103-minato-ku-2025">港区</a>・新宿区2025（抽出・加工） ・ 2塔3D：自作（格子・細部は推定）、寸法：<a href="https://www.tokyotower.co.jp/guidance/">東京タワー</a>・<a href="https://www.tokyo-skytree.jp/floor/">スカイツリー</a>、外形参考：PLATEAU港区・墨田区2025 ・ タワー・オブ・テラー3D：自作、航空写真参考：<a href="https://maps.gsi.go.jp/">国土地理院</a>（全国最新写真） ・ 補完：<a href="https://www.city.kawasaki.jp/530/page/0000170254.html">川崎市</a>・<a href="https://yakei-navi.com/saginumakita/">夜景Navi</a>`;

  // 富士山は通信が要るので、予報の描画を待たせない。**失敗しても本体を巻き込まない**
  // 富士山と月は通信が要るので、予報の描画を待たせない。
  // 用意ができたら `weeks` へ足して、一覧だけ描き直す
  kickExtras();
}

/// 詳細の下半分の釦をつなぐ。下半分は日を替えるたび・計算が届くたびに作り直されるので、
/// **作り直したら必ずここを通す。** 重なる日の行は、最初の描画でつないでいなかった
function kickExtras() {
  if (!["list", "detail"].includes(currentView) || !predictionNeeded()) return;
  if ((extrasRunning && extrasRunningSeq === predictionLoadSeq) || !bundle || extrasLoadedSeq === predictionLoadSeq) return;
  const started = predictionLoadSeq;
  extrasLoadedSeq = started; extrasRunning = true; extrasRunningSeq = started;
  loadExtras().catch((e) => console.warn("富士山・月の判定に失敗:", e))
    .finally(() => { if (extrasRunningSeq === started) extrasRunning = false; });
}

function wireMoonTimeRetry(host) {
  if (!host) return;
  for (const el of host.querySelectorAll("[data-moon-time-retry]")) el.onclick = () => {
    const dayMs = Number(el.dataset.moonTimeRetry);
    moonVisibility.delete(dayMs);
    requestMoonDetails(dayMs);
    refreshLightTimes();
  };
}
function wireDayDetail(host) {
  wireMoonTimeRetry(host);
  wireOutcomes(host);
  wireAlignmentJump(host);
}

/// ダイヤモンド富士の行から、その日の詳細へ飛ぶ
function wireAlignmentJump(root) {
  for (const el of (root || document).querySelectorAll("[data-jump]")) {
    el.onclick = () => {
      const dayMs = +el.dataset.jump;
      const strip = $("detailWeek") && $("detailWeek").querySelector(`[data-day="${dayMs}"]`);
      if (strip) { strip.click(); strip.scrollIntoView({ block: "nearest", inline: "center" }); return; }
      const sel = (weeks.fuji || []).find((e) => e.dayMs === dayMs);
      if (sel) { selectedDay.fuji = dayMs; redrawDayDetail(); }
    };
  }
}
