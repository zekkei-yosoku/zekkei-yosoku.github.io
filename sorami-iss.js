/*
 * Sorami — ISS が月（太陽）の前を横切る場所と時刻
 *
 * **考え方。** 月の中心から ISS を通る直線を地面まで伸ばすと、そこに立つ人には
 * ISS がちょうど月の中心を横切って見える。時刻を進めるとその点が地面を走り、
 * **中心線**ができる。中心線から左右に少しずれても、月の円盤の中は通る。その幅が**見える帯**。
 *
 * ISS の位置は CelesTrak の軌道要素（TLE）を SGP4 で進めて出す（`satellite.js`、MIT。vendor に同梱）。
 * 月と太陽は `sorami-astro.js`（JPL Horizons と照合済み、ずれ 0.001° 程度）。
 *
 * **当たるのは1〜3日先まで。** ISS はときどき高度を上げる（リブースト）し、
 * 軌道要素は日に何度も更新される。当日にもう一度開き直すこと。
 *
 * `sat` は satellite.js の関数（twoline2satrec / propagate / gstime / eciToEcf / ecfToLookAngles）を
 * 入れた入れ物。画面は動的 import で、検査は Node の import で渡す。
 */
(function (global) {
  "use strict";

  const A = global.SoramiAstro || (typeof require !== "undefined" ? require("./sorami-astro.js") : null);
  if (!A) throw new Error("astro が先に要ります");

  const DEG = Math.PI / 180;
  // WGS84
  const WGS_A = 6378.137, WGS_F = 1 / 298.257223563, WGS_E2 = WGS_F * (2 - WGS_F);
  const WGS_B = WGS_A * (1 - WGS_F);

  /// CelesTrak の3行（名前・1行目・2行目）を読む
  function parseTle(text) {
    const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const i = lines.findIndex((l) => l.startsWith("1 "));
    if (i < 0 || !lines[i + 1] || !lines[i + 1].startsWith("2 ")) return null;
    const l1 = lines[i], l2 = lines[i + 1];
    // 元期: 年の下2桁＋年内の日（小数）
    const yy = Number(l1.slice(18, 20)), doy = Number(l1.slice(20, 32));
    const year = yy < 57 ? 2000 + yy : 1900 + yy;
    const epochMs = Date.UTC(year, 0, 1) + (doy - 1) * 86400000;
    return { name: i > 0 ? lines[i - 1] : "ISS", line1: l1, line2: l2, epochMs };
  }

  /// 緯度・経度・高さ[km] → 地球固定座標[km]
  function geodeticToEcef(latDeg, lonDeg, hKm = 0) {
    const la = latDeg * DEG, lo = lonDeg * DEG;
    const N = WGS_A / Math.sqrt(1 - WGS_E2 * Math.sin(la) ** 2);
    return { x: (N + hKm) * Math.cos(la) * Math.cos(lo), y: (N + hKm) * Math.cos(la) * Math.sin(lo),
             z: (N * (1 - WGS_E2) + hKm) * Math.sin(la) };
  }

  /// 地球固定座標 → 緯度・経度（Bowring。地表の点なので1回で十分）
  function ecefToGeodetic({ x, y, z }) {
    const p = Math.hypot(x, y);
    const th = Math.atan2(z * WGS_A, p * WGS_B);
    const ep2 = (WGS_A * WGS_A - WGS_B * WGS_B) / (WGS_B * WGS_B);
    const lat = Math.atan2(z + ep2 * WGS_B * Math.sin(th) ** 3, p - WGS_E2 * WGS_A * Math.cos(th) ** 3);
    return { latitude: lat / DEG, longitude: Math.atan2(y, x) / DEG };
  }

  /**
   * 天体の中心 B から衛星 S を通る直線が、地面（楕円体）に当たる点。
   * S の先（B から見て S より遠い側）で、いちばん手前の交点。無ければ null。
   */
  function groundPoint(B, S) {
    const d = { x: S.x - B.x, y: S.y - B.y, z: S.z - B.z };
    const a2 = WGS_A * WGS_A, b2 = WGS_B * WGS_B;
    const qa = (d.x * d.x + d.y * d.y) / a2 + d.z * d.z / b2;
    const qb = 2 * ((B.x * d.x + B.y * d.y) / a2 + B.z * d.z / b2);
    const qc = (B.x * B.x + B.y * B.y) / a2 + B.z * B.z / b2 - 1;
    const disc = qb * qb - 4 * qa * qc;
    if (disc < 0) return null;
    const u = (-qb - Math.sqrt(disc)) / (2 * qa);   // 天体の側から見て最初に当たる点
    if (!(u > 1)) return null;                       // 衛星より手前では意味がない
    return { x: B.x + u * d.x, y: B.y + u * d.y, z: B.z + u * d.z };
  }

  /// 地表の2点の距離[km]（球で十分）
  function distanceKm(aLat, aLon, bLat, bLon) {
    const dLat = (bLat - aLat) * DEG, dLon = (bLon - aLon) * DEG;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * DEG) * Math.cos(bLat * DEG) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /// 衛星の地球固定座標[km]
  function satEcef(sat, rec, ms) {
    const date = new Date(ms);
    const pv = sat.propagate(rec, date);
    if (!pv || !pv.position) return null;
    const e = sat.eciToEcf(pv.position, sat.gstime(date));
    return { x: e.x, y: e.y, z: e.z };
  }

  /// 観測点から見た2つの方向（地球固定座標）の角度[度]
  function separationDeg(O, P, Q) {
    const a = { x: P.x - O.x, y: P.y - O.y, z: P.z - O.z }, b = { x: Q.x - O.x, y: Q.y - O.y, z: Q.z - O.z };
    const c = (a.x * b.x + a.y * b.y + a.z * b.z) / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z));
    return Math.acos(Math.max(-1, Math.min(1, c))) / DEG;
  }

  /// 観測点から見た方向の高度[度]（大気差なし）
  function altitudeDeg(O, P, latDeg, lonDeg) {
    const la = latDeg * DEG, lo = lonDeg * DEG;
    const d = { x: P.x - O.x, y: P.y - O.y, z: P.z - O.z };
    const up = Math.cos(la) * Math.cos(lo) * d.x + Math.cos(la) * Math.sin(lo) * d.y + Math.sin(la) * d.z;
    return Math.asin(up / Math.hypot(d.x, d.y, d.z)) / DEG;
  }

  /**
   * その観測点で、ISS が天体の円盤の中を通る時間[秒]と、いちばん近づく角度[度]。
   * 中心線の点で呼ぶと通過の長さ、ずらした点で呼ぶと帯の縁を探せる。
   */
  function passAt(sat, rec, body, obsLat, obsLon, tCenter, { spanS = 6, stepS = 0.02 } = {}) {
    const O = geodeticToEcef(obsLat, obsLon, 0);
    let best = { sep: 99, t: tCenter }, inside = 0;
    const radius = body === "moon" ? A.moonAngularRadius(A.bodyEcef("moon", tCenter).distanceKm)
      : A.sunAngularRadius(A.bodyEcef("sun", tCenter).distanceKm);
    for (let t = tCenter - spanS * 1000; t <= tCenter + spanS * 1000; t += stepS * 1000) {
      const S = satEcef(sat, rec, t); if (!S) continue;
      const sep = separationDeg(O, S, A.bodyEcef(body, t));
      if (sep < best.sep) best = { sep, t };
      if (sep < radius) inside += stepS;
    }
    return { minSep: best.sep, at: best.t, durationS: inside, radius };
  }

  /**
   * これからの通過を探す。
   * @param {object} sat     satellite.js の関数
   * @param {object} tle     parseTle の結果
   * @param {object} opts    { center:{latitude,longitude}, radiusKm, fromMs, hours, body, minAltDeg }
   * @returns {Array} 近い順ではなく時刻順。各回に中心線・帯の幅・通過の長さ・天体の高さ
   */
  function transits(sat, tle, {
    center, radiusKm = 150, fromMs = Date.now(), hours = 72, body = "moon", minAltDeg = 5, coarseS = 5,
  } = {}) {
    const rec = sat.twoline2satrec(tle.line1, tle.line2);
    const out = [];
    let run = null;
    const flush = () => { if (run) { const t = refine(sat, rec, body, run, center, radiusKm, minAltDeg); if (t) out.push(t); run = null; } };
    for (let t = fromMs; t <= fromMs + hours * 3600000; t += coarseS * 1000) {
      const S = satEcef(sat, rec, t);
      const g = S && groundPoint(A.bodyEcef(body, t), S);
      const p = g && ecefToGeodetic(g);
      // 粗い刻みでは点が数百kmずつ跳ぶので、広めの円で拾ってから細かく解く
      const near = p && distanceKm(center.latitude, center.longitude, p.latitude, p.longitude) < radiusKm + 400;
      if (near) { if (!run) run = { from: t, to: t }; else run.to = t; }
      else flush();
    }
    flush();
    return out;
  }

  /// 粗く拾った区間を 0.2秒刻みで解き直し、中心線と、観測点にいちばん近い点を出す
  function refine(sat, rec, body, run, center, radiusKm, minAltDeg) {
    const track = [];
    for (let t = run.from - 10000; t <= run.to + 10000; t += 200) {
      const S = satEcef(sat, rec, t);
      const B = A.bodyEcef(body, t);
      const g = S && groundPoint(B, S);
      if (!g) continue;
      const p = ecefToGeodetic(g);
      const alt = altitudeDeg(g, B, p.latitude, p.longitude);
      if (alt < minAltDeg) continue;
      track.push({ ...p, at: t, altitude: alt, rangeKm: Math.hypot(S.x - g.x, S.y - g.y, S.z - g.z) });
    }
    if (track.length < 2) return null;
    let bi = 0, bd = Infinity;
    track.forEach((q, i) => { const d = distanceKm(center.latitude, center.longitude, q.latitude, q.longitude); if (d < bd) { bd = d; bi = i; } });
    if (bd > radiusKm) return null;
    const c = track[bi];
    const pass = passAt(sat, rec, body, c.latitude, c.longitude, c.at);
    // 帯の半幅: 中心線に直角な向きへずらし、ISS がちょうど円盤の縁をかすめる距離
    const a = track[Math.max(0, bi - 1)], b = track[Math.min(track.length - 1, bi + 1)];
    const dirN = (b.latitude - a.latitude), dirE = (b.longitude - a.longitude) * Math.cos(c.latitude * DEG);
    const n = Math.hypot(dirN, dirE) || 1;
    const perpN = -dirE / n, perpE = dirN / n;     // 中心線に直角（北・東の成分）
    const off = (km) => ({ latitude: c.latitude + perpN * km / 111.2,
                           longitude: c.longitude + perpE * km / (111.2 * Math.cos(c.latitude * DEG)) });
    let lo = 0, hi = 30;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2, q = off(mid);
      const pa = passAt(sat, rec, body, q.latitude, q.longitude, c.at, { spanS: 4, stepS: 0.05 });
      if (pa.minSep < pa.radius) lo = mid; else hi = mid;
    }
    const B = A.bodyEcef(body, c.at);
    const obs = { latitude: c.latitude, longitude: c.longitude, elevation: 0 };
    const st = body === "moon" ? A.moon(c.at, obs) : A.sun(c.at, obs);
    return {
      body, at: pass.at, durationS: Math.round(pass.durationS * 100) / 100,
      center: { latitude: c.latitude, longitude: c.longitude },
      distanceKm: Math.round(bd * 10) / 10,
      halfWidthKm: Math.round(lo * 100) / 100,
      rangeKm: Math.round(c.rangeKm),
      altitude: st.apparentAltitude, azimuth: st.azimuth,
      illuminated: body === "moon" ? st.illuminatedFraction : null,
      sunAltitude: A.sun(c.at, obs).apparentAltitude,
      bodyDistanceKm: B.distanceKm,
      track: track.map((q) => ({ latitude: q.latitude, longitude: q.longitude, at: q.at })),
    };
  }

  const SoramiISS = { parseTle, transits, passAt, groundPoint, geodeticToEcef, ecefToGeodetic, distanceKm, separationDeg };
  global.SoramiISS = SoramiISS;
  if (typeof module !== "undefined" && module.exports) module.exports = SoramiISS;
})(typeof globalThis !== "undefined" ? globalThis : this);
