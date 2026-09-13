/*
 * Sorami — 富士山が見えるか
 *
 * 幾何（見えるはずか）と天気（実際に見えるか）を**別々に**扱う。
 * 指示書（富士）§3「GeometryをWeatherより先に処理する」・§29「GeometryとWeather Partialを区別する」。
 *
 * 幾何は地形と地球の丸みだけで決まり、**その地点では二度と変わらない**。
 * 一度測って憶える（§28 Geometry Cache）。天気は毎回変わる。
 */
(function (global) {
  "use strict";

  const A = global.SoramiAstro || (typeof require !== "undefined" ? require("./sorami-astro.js") : null);
  const TR = global.SoramiTerrain || (typeof require !== "undefined" ? require("./sorami-terrain.js") : null);
  const MT = global.SoramiMountain || (typeof require !== "undefined" ? require("./sorami-mountain.js") : null);
  if (!A || !TR || !MT) throw new Error("astro / terrain / mountain が先に要ります");

  const FUJI = { latitude: 35.360555, longitude: 138.727363, summitM: 3776, name: "富士山" };

  // 雲の層が実際に何mにあるか。ECMWF / Open-Meteo の区分に合わせる。
  //   low  … 800hPa より下（およそ 0〜2km）
  //   mid  … 800〜450hPa（およそ 2〜6km）
  //   high … 450hPa より上（およそ 6km 以上）
  // **富士山は 3776m。** 低層と中層は視線を塞ぐが、高層は山より上にあって塞がない。
  // 「全天の雲量」で判定してはいけない理由がこれ（§45）。
  const CLOUD_BANDS = {
    low:  { baseM: 0,    topM: 2000, key: "cloud_cover_low" },
    mid:  { baseM: 2000, topM: 6000, key: "cloud_cover_mid" },
    high: { baseM: 6000, topM: 13000, key: "cloud_cover_high" },
  };

  /// 視線の高さ。距離 d のところで、視線は地面から何mの高さを通るか。
  /// 地球の丸みぶんを足す（遠いほど地面が下がるので、視線は相対的に高くなる）
  function sightLineHeightM(distanceKm, observerEyeM, targetDistanceKm, targetTopM, opts = {}) {
    const ang = A.targetElevationAngle(targetDistanceKm, observerEyeM, targetTopM, opts);
    return observerEyeM + distanceKm * 1000 * Math.tan(ang * Math.PI / 180)
         + A.curvatureDropM(distanceKm, opts);
  }

  /**
   * 視線の回廊に置く観測点（§35 3D Atmospheric Corridor・§38 LOS Sampling）。
   *
   * **1点では足りない。** 手前が晴れていても中ほどに雲の壁があれば見えない。
   * 遠いほど視線は高くなるので、同じ雲でも効き方が変わる（§24）。
   */
  function corridorPoints(observer, { count = 3, targetDistanceKm = null } = {}) {
    const az = TR.bearing(observer.latitude, observer.longitude, FUJI.latitude, FUJI.longitude);
    const total = targetDistanceKm
      ?? TR.distanceKm(observer.latitude, observer.longitude, FUJI.latitude, FUJI.longitude);
    const out = [];
    for (let i = 1; i <= count; i++) {
      const f = i / (count + 1);                 // 均等。両端は自地点と富士山が別に持つ
      const d = total * f;
      const p = TR.destination(observer.latitude, observer.longitude, az, d);
      out.push({ ...p, distanceKm: d, fraction: f });
    }
    return { azimuth: az, totalKm: total, points: out };
  }

  /// 富士山まわりで要る気象要素。**気圧面の高度も取る**（雲の高さを知るため）
  const FUJI_VARS = [
    "cloud_cover", "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high",
    "precipitation", "visibility", "relative_humidity_2m",
    "geopotential_height_700hPa", "relative_humidity_700hPa",
    "geopotential_height_500hPa", "relative_humidity_500hPa",
  ];
  const CORRIDOR_VARS = ["cloud_cover_low", "cloud_cover_mid", "cloud_cover_high",
                         "precipitation", "visibility"];

  /**
   * 富士山と回廊の天気を取る。
   * 自地点は既存の bundle が持っているので、ここでは取らない。
   */
  async function fetchFujiWeather(observer, S, { days = 8, count = 3 } = {}) {
    const corr = corridorPoints(observer, { count });
    const coords = [{ latitude: FUJI.latitude, longitude: FUJI.longitude },
                    ...corr.points.map((p) => ({ latitude: p.latitude, longitude: p.longitude }))];
    // 富士山は山頂の標高で計算させる。回廊は各点の地形に任せる（標高を渡さない）
    const [fujiRaw, corrRaw] = await Promise.all([
      fetch(S.buildURL([coords[0]], FUJI_VARS, days, 0, FUJI.summitM)).then((r) => r.json()),
      coords.length > 1
        ? fetch(S.buildURL(coords.slice(1), CORRIDOR_VARS, days, 0)).then((r) => r.json())
        : Promise.resolve([]),
    ]);
    const asList = (raw) => (Array.isArray(raw) ? raw : [raw]).map(S.decodeLocation);
    return {
      summit: asList(fujiRaw)[0],
      corridor: asList(corrRaw).map((s, i) => ({ ...corr.points[i], series: s })),
      azimuth: corr.azimuth, totalKm: corr.totalKm,
      fetchedAt: Date.now(),
    };
  }

  /**
   * 8モデルの**中央値**を取る（既存の `readingAt` と同じ作法）。
   *
   * 1モデルだけ見ると、そのモデルの癖がそのまま点数になる。
   * 既存の7現象がすべて中央値で動いているので、ここだけ変えない。
   */
  function median(values) {
    const v = values.filter((x) => x !== null && x !== undefined && Number.isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }
  /// 地点（decodeLocation の結果）から、その時刻の値をまとめて読む
  function readAt(loc, ms, vars) {
    const out = {};
    if (!loc || !loc.byModel) return out;
    for (const v of vars) {
      out[v] = median(Object.values(loc.byModel)
        .filter((sr) => sr.isSupported(v))
        .map((sr) => sr.valueAt(v, ms)));
    }
    return out;
  }
  const HOME_NEEDS = ["visibility", "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high",
                      "relative_humidity_2m", "precipitation", "boundary_layer_height"];
  const AIR_NEEDS = ["aerosol_optical_depth", "dust"];

  // ------------------------------------------------------------------ 採点
  //
  // **掛け算にする**（§103）。足し算だと「視点が霧の中」と「富士山が雲の中」が
  // 相殺してしまい、どちらか一方でも致命的なのに中くらいの点が出る（§104）。
  //
  //   見える確率 = 視点が晴れている × 回廊が抜けている × 富士山が出ている
  //
  // 0〜100 の点は確率そのものではない（§108）。確率に「くっきり度」を掛けたもの。

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  /// 雲量[%] → その層を見通せる確率。**雲があれば見えない、ではない**（§50 半透明の雲）
  const seeThrough = (coverPct, { thin = 0.25 } = {}) => {
    const c = clamp01((coverPct ?? 0) / 100);
    // 全天を覆っていても薄ければ透ける余地を残す。完全に0にはしない
    return clamp01((1 - c) + c * thin);
  };

  /// 視点が霧・雲の中にいないか（§32 Viewpoint State・§33 P(ViewpointClear)）
  function viewpointClear(reading, observerEyeM) {
    if (!reading || !Object.values(reading).some((x) => x !== null)) return { p: null, why: "自地点の予報が無い" };
    const vis = reading.visibility;               // m
    const low = reading.cloud_cover_low;
    const rh = reading.relative_humidity_2m;
    let p = 1;
    const notes = [];
    // 視程が短い＝霧か雨。**遠くを見る話なので、ここは効き方が強い**
    if (Number.isFinite(vis)) {
      const v = vis / 1000;                       // km
      const q = clamp01((v - 2) / 18);            // 2km で 0、20km で 1
      p *= 0.1 + 0.9 * q;
      notes.push(`視程 ${v.toFixed(0)}km`);
    }
    // 低い雲が濃いと、山にいる観測者は雲の中に入る
    if (Number.isFinite(low)) { p *= seeThrough(low, { thin: 0.35 }); notes.push(`低い雲 ${Math.round(low)}%`); }
    if (Number.isFinite(rh) && rh >= 95) { p *= 0.7; notes.push(`湿度 ${Math.round(rh)}%`); }
    return { p: clamp01(p), why: notes.join(" / ") };
  }

  /// 回廊が抜けているか（§35-39・§44 Cloud Intersection）
  function corridorClear(weather, ms, observerEyeM, targetDistanceKm, opts = {}) {
    if (!weather || !weather.corridor.length) return { p: null, why: "回廊の予報が無い" };
    let p = 1;
    const notes = [];
    for (const c of weather.corridor) {
      const r = readAt(c.series, ms, CORRIDOR_VARS);
      if (!Object.values(r).some((x) => x !== null)) continue;
      const losM = sightLineHeightM(c.distanceKm, observerEyeM, targetDistanceKm, FUJI.summitM, opts);
      // **視線が通る高さにある層だけを見る**（§26 Cloud Topだけで判定しない）
      for (const [name, band] of Object.entries(CLOUD_BANDS)) {
        if (losM < band.baseM || losM > band.topM) continue;
        const cover = r[band.key];
        if (!Number.isFinite(cover)) continue;
        p *= seeThrough(cover);
        if (cover >= 40) notes.push(`${c.distanceKm.toFixed(0)}km地点の${name === "low" ? "低い" : name === "mid" ? "中くらいの" : "高い"}雲 ${Math.round(cover)}%`);
      }
      // 視線上の降水は決定的（§55 Precipitation on LOS）
      if (Number.isFinite(r.precipitation) && r.precipitation > 0.2) {
        p *= clamp01(1 - Math.min(1, r.precipitation / 3) * 0.8);
        notes.push(`${c.distanceKm.toFixed(0)}km地点で雨`);
      }
    }
    return { p: clamp01(p), why: notes.join(" / ") || "視線上に目立つ雲なし", losHeights:
      weather.corridor.map((c) => ({ distanceKm: c.distanceKm,
        losM: Math.round(sightLineHeightM(c.distanceKm, observerEyeM, targetDistanceKm, FUJI.summitM, opts)) })) };
  }

  /// 富士山自身が雲をかぶっていないか（§56-58 Fuji Local Zone・Summit Cloud）
  function summitClear(weather, ms) {
    if (!weather || !weather.summit) return { p: null, why: "富士山の予報が無い" };
    const r = readAt(weather.summit, ms, FUJI_VARS);
    if (!Object.values(r).some((x) => x !== null)) return { p: null, why: "富士山の予報が無い" };
    let p = 1;
    const notes = [];
    // 山頂は 3776m。**中層の雲がそのまま笠雲・山体を隠す雲になる**
    if (Number.isFinite(r.cloud_cover_mid)) { p *= seeThrough(r.cloud_cover_mid, { thin: 0.3 }); notes.push(`山頂の中層雲 ${Math.round(r.cloud_cover_mid)}%`); }
    if (Number.isFinite(r.cloud_cover_low)) { p *= seeThrough(r.cloud_cover_low, { thin: 0.5 }); notes.push(`山腹の雲 ${Math.round(r.cloud_cover_low)}%`); }
    if (Number.isFinite(r.precipitation) && r.precipitation > 0.2) { p *= 0.3; notes.push("山頂で降水"); }
    return { p: clamp01(p), why: notes.join(" / ") };
  }

  /**
   * 空気の澄み具合（§62 Atmospheric Contrast・§70-73 Aerosol Vertical Distribution）。
   *
   * **見えるかどうかとは別**（§84）。見えていても霞んでいれば「くっきり度」が下がる。
   *
   * **地上の視程をそのまま距離に掛けてはいけない**（§66・§69）。最初そうやったら、
   * 東京から富士山は常に「くっきり度 0」になった。地上視程は Open-Meteo では
   * **24km で頭打ち**（しかもGFSしか返さない）で、晴れの日の差が出ない。
   * そもそも地上の水平視程は、山を空を背景に斜めに見る話とは別物。
   *
   * 正しくは（§70-73）:
   *   エアロゾルは**境界層の下**に溜まっている。視線は登っていくので、
   *   途中で境界層を抜ける。抜けたあとの空気はずっと澄んでいる。
   *   だから「境界層の中を通った距離」だけに濃い消散を掛ける。
   *
   *   消散係数[/km] = AOD / 境界層の高さ[km] × 湿度による膨らみ
   *   光学的厚さ    = 消散係数 × 境界層内の距離 + 上空の薄い消散 × 残り
   *   見え方        = exp(-光学的厚さ)
   */
  const FREE_AIR_EXTINCTION_PER_KM = 0.012;   // 境界層より上。レイリー散乱がほぼ全部
  const CONTRAST_THRESHOLD = 0.02;            // 肉眼で見分けられる限界（Koschmieder）

  /**
   * エアロゾルの鉛直分布（§70-72）。**段差で切らない。**
   *
   * 最初「境界層より上なら消散ゼロ」という段差にしたら、朝の浅い境界層
   * （150m）で目の高さ 171m が上に出てしまい、**東京から富士山がくっきり100**
   * と出た（2026-09-14）。夜の浅い層の上にも日中のエアロゾルは残っている。
   *
   * 指数分布にする。σ(z) = σ0 exp(-z/H)。
   * 鉛直に積むと AOD になるので σ0 = AOD / H。H は境界層の高さを目安にする。
   */
  const aerosolScaleHeightKm = (pblM) => Math.min(2.0, Math.max(0.3, (pblM ?? 900) / 1000));

  function clarityOf(reading, air, distanceKm, { observerEyeM = 0, targetTopM = FUJI.summitM } = {}) {
    if (!reading) return { value: null, why: "自地点の予報が無い" };
    const aod = air && Number.isFinite(air.aerosol_optical_depth) ? air.aerosol_optical_depth : null;
    if (aod === null) return { value: null, why: "エアロゾルの予報が無い" };
    const rh = Number.isFinite(reading.relative_humidity_2m) ? reading.relative_humidity_2m : null;
    const pbl = Number.isFinite(reading.boundary_layer_height) ? reading.boundary_layer_height : null;

    const H = aerosolScaleHeightKm(pbl);
    // 吸湿成長（§75）。湿度が高いとエアロゾルが水を吸って大きくなり、よく散乱する
    const growth = rh === null ? 1 : 1 + Math.max(0, (rh - 60) / 40) * 1.2;
    const sigma0 = (aod / H) * growth;                 // 地面での消散係数 [/km]

    // 視線に沿って積む。**水平に近い経路は、鉛直の何十倍もの厚みを通る**
    const steps = 60;
    let tauAerosol = 0;
    for (let i = 0; i < steps; i++) {
      const d = distanceKm * (i + 0.5) / steps;
      const zKm = sightLineHeightM(d, observerEyeM, distanceKm, targetTopM) / 1000;
      tauAerosol += sigma0 * Math.exp(-Math.max(0, zKm) / H) * (distanceKm / steps);
    }
    const tau = tauAerosol + FREE_AIR_EXTINCTION_PER_KM * distanceKm;
    const contrast = Math.exp(-tau);
    // 0.02 でようやく見分けられ、0.35 なら十分くっきり
    let q = clamp01(Math.log(Math.max(contrast, 1e-12) / CONTRAST_THRESHOLD)
                    / Math.log(0.35 / CONTRAST_THRESHOLD));
    const notes = [`エアロゾル ${aod.toFixed(2)}`];
    if (rh !== null) notes.push(`湿度 ${Math.round(rh)}%`);
    if (pbl !== null) notes.push(`境界層 ${Math.round(pbl)}m`);
    if (air && Number.isFinite(air.dust) && air.dust > 20) {          // §76 黄砂
      q *= clamp01(1 - air.dust / 200); notes.push(`ダスト ${Math.round(air.dust)}`);
    }
    return { value: clamp01(q), why: notes.join(" / "),
             opticalDepth: tau, contrast, surfaceExtinctionPerKm: sigma0, scaleHeightKm: H };
  }

  /// 点数の帯（§111）。**0点は「対象外」ではない**（§109・§110）
  const BANDS = [
    { min: 85, key: "superb",  label: "くっきり",   says: "輪郭まではっきり見えそうです" },
    { min: 65, key: "good",    label: "よく見える", says: "しっかり見えそうです" },
    { min: 40, key: "fair",    label: "うっすら",   says: "霞んで見える程度かもしれません" },
    { min: 15, key: "poor",    label: "厳しい",     says: "見えない可能性が高いです" },
    { min: 0,  key: "none",    label: "望み薄",     says: "雲か霞で隠れていそうです" },
  ];
  const bandOf = (score) => BANDS.find((b) => score >= b.min);

  /**
   * 富士山が見えるかを採点する。
   *
   * **掛け算にする**（§103）。足し算だと「視点が霧の中」と「富士山が雲の中」が
   * 相殺して、どちらか一方でも致命的なのに中くらいの点が出る（§104）。
   *
   * @param {object} geom  SoramiMountain.geometry() の結果（幾何。天気を含まない）
   * @param {object} weather fetchFujiWeather() の結果
   * @param {object} home  自地点の Series
   * @param {number} index home の時刻の添字
   */
  function evaluateFuji(geom, weather, home, ms, { air = null, observerEyeM = 0, ...opts } = {}) {
    if (!geom || !geom.available) {
      return { available: false, reason: geom?.reason || "幾何が計算できていない" };
    }
    // **幾何で見えないなら、天気を見るまでもない**（§3・§109）
    if (geom.classification === "NONE") {
      return { available: true, score: 0, classification: "NONE",
        pVisible: 0, clarity: null, confidence: "A",
        band: bandOf(0), blockedByTerrain: true,
        why: "この地点からは地形に隠れて富士山が見えません（天気によらず）",
        parts: [] };
    }
    const r = readAt(home, ms, HOME_NEEDS);
    // 大気組成は地点ひとつぶんの Series（モデル分割が無い）
    const a = air ? Object.fromEntries(AIR_NEEDS.map((v) => [v, air.isSupported(v) ? air.valueAt(v, ms) : null])) : null;
    const vp = viewpointClear(r, observerEyeM);
    const co = corridorClear(weather, ms, observerEyeM, geom.distanceKm, opts);
    const su = summitClear(weather, ms);
    const cl = clarityOf(r, a, geom.distanceKm, { observerEyeM });

    const parts = [
      { key: "viewpoint", label: "自分のいる場所", p: vp.p, why: vp.why },
      { key: "corridor",  label: "富士山までの空", p: co.p, why: co.why },
      { key: "summit",    label: "富士山そのもの", p: su.p, why: su.why },
    ];
    const known = parts.filter((x) => x.p !== null);
    if (!known.length) return { available: false, reason: "天気の予報が取れていない" };
    const pVisible = known.reduce((m, x) => m * x.p, 1);

    // 幾何で一部しか見えない地点は、そのぶん上限を下げる（§29・§95）
    const geomCap = geom.classification === "FULL" ? 1 : 0.55 + 0.45 * geom.fraction;
    const clarity = cl.value;
    // 点数 = 見える確率 × くっきり度 × 幾何の頭打ち。**確率そのものではない**（§108）
    const score = Math.round(100 * pVisible * (clarity === null ? 0.8 : 0.35 + 0.65 * clarity) * geomCap);

    // 分からない要素があるほど信頼度を下げる（§113・§116）
    const missing = parts.length - known.length + (clarity === null ? 1 : 0);
    const confidence = missing === 0 ? "A" : missing === 1 ? "B" : "C";

    return {
      available: true, score, classification: geom.classification,
      pVisible, clarity, confidence, band: bandOf(score),
      blockedByTerrain: false,
      geometryFraction: geom.fraction,
      apparentSize: geom.apparentSize,
      distanceKm: geom.distanceKm,
      losHeights: co.losHeights || null,
      parts: parts.map((x) => ({ ...x, pct: x.p === null ? null : Math.round(x.p * 100) })),
      clarityWhy: cl.why,
    };
  }

  const SoramiFuji = {
    FUJI, CLOUD_BANDS, FUJI_VARS, CORRIDOR_VARS,
    sightLineHeightM, corridorPoints, fetchFujiWeather,
    viewpointClear, corridorClear, summitClear, seeThrough,
    clarityOf, evaluateFuji, BANDS, bandOf, readAt, median,
    FREE_AIR_EXTINCTION_PER_KM, CONTRAST_THRESHOLD, HOME_NEEDS, aerosolScaleHeightKm,
  };
  global.SoramiFuji = SoramiFuji;
  if (typeof module !== "undefined" && module.exports) module.exports = SoramiFuji;
})(typeof globalThis !== "undefined" ? globalThis : window);
