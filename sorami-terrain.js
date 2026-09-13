/*
 * Sorami — 地形（DEM）
 *
 * 「その方角の地平線は何度の高さにあるか」を求める。月が地形から出てくる時刻（月 §14-16）と、
 * 富士山が手前の山に隠れていないか（富士 §19-21）の両方がこれを要る。
 *
 * **事前計算はできない。** 2026-09-07 に内蔵スポット一覧を画面から外し、利用者が
 * OpenStreetMap で世界中の任意地点を登録する形になった。地点が決め打ちでない以上、
 * 出荷時に地形を焼き込むことができない。
 *
 * そこで **要る方角だけを、その場で測って憶える**。
 *   月の出   … 月の方位のまわり ±10度ほど
 *   富士山   … 富士山の方角ひとつ
 * 全周360度を測る必要は無い。地形は変わらないので、一度測れば使い回せる。
 *
 * 標高は Open-Meteo Elevation API（Copernicus DEM 相当・約90m）。
 * **1回のリクエストで100点まで**（2026-09-14 実測。101点以上は 400 が返る）。
 */
(function (global) {
  "use strict";

  const A = global.SoramiAstro
    || (typeof require !== "undefined" ? require("./sorami-astro.js") : null);
  if (!A) throw new Error("sorami-astro.js が先に要ります");

  const DEG = Math.PI / 180;
  const EARTH_KM = 6371.0088;
  const MAX_POINTS = 100;            // Open-Meteo の上限（実測）
  const ENDPOINT = "https://api.open-meteo.com/v1/elevation";

  /// 方位と距離から緯度経度を出す（大円）
  function destination(lat, lon, bearingDeg, distanceKm) {
    const ang = distanceKm / EARTH_KM, b = bearingDeg * DEG;
    const p1 = lat * DEG, l1 = lon * DEG;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(ang) + Math.cos(p1) * Math.sin(ang) * Math.cos(b));
    const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(ang) * Math.cos(p1),
                               Math.cos(ang) - Math.sin(p1) * Math.sin(p2));
    let lo = (l2 / DEG) % 360; if (lo > 180) lo -= 360; if (lo < -180) lo += 360;
    return { latitude: p2 / DEG, longitude: lo };
  }

  /// 2点間の方位角（北から東回り）
  function bearing(aLat, aLon, bLat, bLon) {
    const p1 = aLat * DEG, p2 = bLat * DEG, dl = (bLon - aLon) * DEG;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return ((Math.atan2(y, x) / DEG) % 360 + 360) % 360;
  }

  /// 大円距離
  function distanceKm(aLat, aLon, bLat, bLon) {
    const p1 = aLat * DEG, p2 = bLat * DEG;
    const dp = p2 - p1, dl = (bLon - aLon) * DEG;
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /**
   * 標高をまとめて引く。**100点ずつに割って投げる。**
   * @param {Array} points [{latitude, longitude}]
   * @returns {Promise<number[]>} 標高[m]。取れなかった点は null
   */
  async function fetchElevations(points, { fetchImpl = global.fetch, timeoutMs = 20000 } = {}) {
    const out = [];
    for (let i = 0; i < points.length; i += MAX_POINTS) {
      const chunk = points.slice(i, i + MAX_POINTS);
      const q = `latitude=${chunk.map((p) => p.latitude.toFixed(5)).join(",")}`
              + `&longitude=${chunk.map((p) => p.longitude.toFixed(5)).join(",")}`;
      // 429（呼びすぎ）は待って試し直す。**黙って諦めない、無限に叩かない。**
      let res = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        res = await fetchImpl(`${ENDPOINT}?${q}`, { signal: AbortSignal.timeout(timeoutMs) });
        if (res.ok) break;
        if (res.status !== 429 && res.status < 500) break;
        await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
      }
      if (!res || !res.ok) throw new Error(`標高が取れません（HTTP ${res ? res.status : "?"}）`);
      const j = await res.json();
      if (!Array.isArray(j.elevation) || j.elevation.length !== chunk.length) {
        throw new Error(`標高の件数が合いません（要求 ${chunk.length} / 応答 ${j.elevation?.length}）`);
      }
      out.push(...j.elevation);
    }
    return out;
  }

  /**
   * 観測者の目の高さを決める（富士 §7・§8）。
   *
   *   目の高さ = 地面の標高（DEM）+ 立っている高さ
   *
   * **地面の標高は DEM から取る。手入力の数字を使わない。**
   * 食い違うと、すぐ脇に幻の壁が立つか、逆に無い視界が開ける。
   * 2026-09-14 に河口湖の座標で 172m ずれ、100m先に 50度の壁ができて
   * 「富士山がまったく見えない」と出た。
   *
   * 手入力の値は「DEM と大きく違わないか」の確認にだけ使う。
   *
   * @param {number} eyeHeightAGL 地面からの目の高さ[m]。展望台やビルならその高さ
   */
  async function resolveObserver(latitude, longitude, { eyeHeightAGL = 1.5, statedElevation = null, ...opts } = {}) {
    const [ground] = await fetchElevations([{ latitude, longitude }], opts);
    if (ground === null || ground === undefined) {
      if (statedElevation === null) throw new Error("地面の標高が取れませんでした");
      return { latitude, longitude, groundM: statedElevation, eyeHeightAGL,
               elevation: statedElevation + eyeHeightAGL, source: "手入力（DEMが取れず）", mismatchM: null };
    }
    const mismatch = statedElevation === null ? null : Math.round(statedElevation - ground);
    return {
      latitude, longitude, groundM: ground, eyeHeightAGL,
      elevation: ground + eyeHeightAGL,
      source: "DEM",
      mismatchM: mismatch,
      // 大きくずれていたら座標を疑う。**黙って進めない**
      warning: mismatch !== null && Math.abs(mismatch) > 30
        ? `手入力の標高 ${statedElevation}m と DEM の ${Math.round(ground)}m が ${Math.abs(mismatch)}m 違います。座標を確かめてください`
        : null,
    };
  }

  /**
   * 見る距離の刻み。
   *
   * **近いほど細かく。** 500m の丘でも 10km なら 2.8度で、100km 先の富士山（1.8度）を隠す。
   * 近くを粗く見ると地平線を取り違える。遠方は「高い山がそこにあるか」だけなので粗くてよい。
   *
   * 既定は22点。**細い尾根は取りこぼし得る**（DEM 90m に対して間隔が広い区間がある）。
   * 精度が要る用途（富士山への視線）は `step` を指定して等間隔で密に取る。
   */
  const DEFAULT_STEPS = [0.1, 0.2, 0.35, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5, 7, 9,
                         12, 16, 20, 26, 33, 42, 55, 70, 100];

  function stepsFor({ maxKm = 100, step = null } = {}) {
    if (step) {
      const out = [];
      for (let d = step; d <= maxKm + 1e-9; d += step) out.push(Number(d.toFixed(4)));
      return out;
    }
    return DEFAULT_STEPS.filter((d) => d <= maxKm);
  }

  /**
   * 指定した方位の地平線の高さ（度）を測る。
   * @param {object} observer { latitude, longitude, elevation }（elevation は m）
   * @param {number[]} azimuths 測る方位
   */
  async function measureHorizon(observer, azimuths, opts = {}) {
    const dists = stepsFor(opts);
    const points = [];
    for (const az of azimuths) {
      for (const d of dists) points.push(destination(observer.latitude, observer.longitude, az, d));
    }
    const elevs = await fetchElevations(points, opts);

    const result = [];
    let i = 0;
    for (const az of azimuths) {
      let best = { angle: -90, distanceKm: null, elevationM: null };
      for (const d of dists) {
        const e = elevs[i++];
        if (e === null || e === undefined) continue;
        const a = A.targetElevationAngle(d, observer.elevation ?? 0, e, opts);
        if (a > best.angle) best = { angle: a, distanceKm: d, elevationM: e };
      }
      // 地形が観測者より低いだけなら、地平線は「海の地平線」まで下がる
      const seaHorizon = -A.targetElevationAngle(
        A.horizonDistanceKm(Math.max(0, observer.elevation ?? 0), opts), observer.elevation ?? 0, 0, opts);
      result.push({
        azimuth: az,
        horizonAngleDeg: Math.max(best.angle, -Math.abs(seaHorizon)),
        byDistanceKm: best.distanceKm,
        byElevationM: best.elevationM,
        samples: dists.length,
      });
    }
    return result;
  }

  /**
   * 測った地平線から「方位 → 高さ」の関数を作る。**間は線形で埋める。**
   * 月の方位は連続的に変わるので、測った方位に無い値も要る（月 §14）。
   */
  function horizonFunction(profile) {
    if (!profile || !profile.length) return () => 0;
    const pts = [...profile].sort((a, b) => a.azimuth - b.azimuth);
    return (az) => {
      const x = ((az % 360) + 360) % 360;
      let lo = pts[pts.length - 1], hi = pts[0];
      for (let i = 0; i < pts.length; i++) {
        if (pts[i].azimuth <= x) lo = pts[i];
        if (pts[i].azimuth >= x) { hi = pts[i]; break; }
      }
      if (lo === hi) return lo.horizonAngleDeg;
      let span = hi.azimuth - lo.azimuth; if (span < 0) span += 360;
      let off = x - lo.azimuth; if (off < 0) off += 360;
      if (span === 0) return lo.horizonAngleDeg;
      const t = off / span;
      return lo.horizonAngleDeg * (1 - t) + hi.horizonAngleDeg * t;
    };
  }

  /**
   * 対象へ向かう視線上の地形を取る（富士 §19「Terrain LOS」）。
   * 方位ひとつなので**密に取れる**。
   */
  async function profileToward(observer, target, opts = {}) {
    const az = bearing(observer.latitude, observer.longitude, target.latitude, target.longitude);
    const total = distanceKm(observer.latitude, observer.longitude, target.latitude, target.longitude);
    // 100点に収まる刻みにする（1リクエストで済ませる）
    const step = opts.step ?? Math.max(0.09, total / (MAX_POINTS - 1));
    const dists = stepsFor({ maxKm: total * 0.999, step });
    const pts = dists.map((d) => destination(observer.latitude, observer.longitude, az, d));
    const elevs = await fetchElevations(pts, opts);
    return {
      azimuth: az,
      totalKm: total,
      stepKm: step,
      profile: dists.map((d, i) => ({ distanceKm: d, elevationM: elevs[i] }))
                    .filter((p) => p.elevationM !== null && p.elevationM !== undefined),
    };
  }

  const SoramiTerrain = {
    MAX_POINTS, DEFAULT_STEPS,
    destination, bearing, distanceKm,
    fetchElevations, resolveObserver, measureHorizon, horizonFunction, profileToward, stepsFor,
  };
  global.SoramiTerrain = SoramiTerrain;
  if (typeof module !== "undefined" && module.exports) module.exports = SoramiTerrain;
})(typeof globalThis !== "undefined" ? globalThis : window);
