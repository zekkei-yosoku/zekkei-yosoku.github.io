/*
 * Sorami — 構図（パール富士・ダイヤモンド富士など）
 *
 * 指示書（月）§81-83。**構図が成立することと、撮れることは別**（§82）。
 *
 *   構図の幾何（重なる瞬間）
 *   + 月／太陽が実際に見えるか
 *   + 写真として使えるか
 *   = 撮影のチャンス
 *
 * 「その瞬間に月が山頂へ重なる」は天文と地形だけで決まるので**何年先でも計算できる**。
 * 「そのとき晴れているか」は予報の届く範囲でしか分からない。混ぜない。
 */
(function (global) {
  "use strict";

  const A = global.SoramiAstro || (typeof require !== "undefined" ? require("./sorami-astro.js") : null);
  const TR = global.SoramiTerrain || (typeof require !== "undefined" ? require("./sorami-terrain.js") : null);
  const MT = global.SoramiMountain || (typeof require !== "undefined" ? require("./sorami-mountain.js") : null);
  if (!A || !TR || !MT) throw new Error("astro / terrain / mountain が先に要ります");

  const norm = (d) => ((d % 360) + 360) % 360;
  /// 方位の差。-180〜180 で返す
  const azDiff = (a, b) => { let d = norm(a) - norm(b); if (d > 180) d -= 360; if (d < -180) d += 360; return d; };

  /**
   * 対象（山頂など）の見かけの位置。
   * @returns {{azimuth:number, altitude:number, distanceKm:number}}
   */
  function targetView(observer, target, opts = {}) {
    const d = TR.distanceKm(observer.latitude, observer.longitude, target.latitude, target.longitude);
    return {
      azimuth: TR.bearing(observer.latitude, observer.longitude, target.latitude, target.longitude),
      altitude: A.targetElevationAngle(d, observer.elevation ?? 0, target.elevationM, opts),
      distanceKm: d,
    };
  }

  /**
   * 月（または太陽）が対象へ重なる瞬間を探す。
   *
   * **「近い」ではなく「重なる」を探す。** 月の見かけ半径は約0.26度しかないので、
   * 方位が1度ずれれば別物になる。角距離で見る。
   *
   * @param {string} body "moon" | "sun"
   * @param {number} toleranceDeg 許容する角距離。既定は月の半径ぶん
   */
  function findAlignments(body, observer, target, fromMs, toMs, {
    stepMs = 60000, toleranceDeg = null, ...opts
  } = {}) {
    const tv = targetView(observer, target, opts);
    const positionOf = (ms) => {
      if (body === "moon") {
        const m = A.moon(ms, observer);
        return { azimuth: m.azimuth, altitude: m.apparentAltitude, radius: m.angularRadius, moon: m };
      }
      const alt = sunView(ms, observer);
      return { azimuth: alt.azimuth, altitude: alt.altitude, radius: 0.266, sun: alt };
    };
    const sep = (ms) => {
      const p = positionOf(ms);
      // 角距離（小さい角なので平面近似で十分）
      const dAz = azDiff(p.azimuth, tv.azimuth) * Math.cos(p.altitude * Math.PI / 180);
      const dAlt = p.altitude - tv.altitude;
      return { value: Math.hypot(dAz, dAlt), p, dAz, dAlt };
    };

    const out = [];
    let prev = sep(fromMs), rising = null;
    for (let t = fromMs + stepMs; t <= toMs; t += stepMs) {
      const cur = sep(t);
      if (rising === null) rising = cur.value > prev.value;
      // 谷（いちばん近づいた瞬間）を拾う
      if (!rising && cur.value > prev.value) {
        // 谷は t-stepMs のあたり。細かく詰める
        let a = t - 2 * stepMs, b = t, best = prev, bestT = t - stepMs;
        for (let i = 0; i < 12; i++) {
          const m1 = a + (b - a) / 3, m2 = b - (b - a) / 3;
          const s1 = sep(m1), s2 = sep(m2);
          if (s1.value < s2.value) { b = m2; if (s1.value < best.value) { best = s1; bestT = m1; } }
          else { a = m1; if (s2.value < best.value) { best = s2; bestT = m2; } }
        }
        // 既定の許容は**天体の直径ぶん**。
        // 半径＋0.15度（＝0.41度）にしたら、田貫湖から1年で1回も見つからなかった
        // （実測の最接近は 0.44度）。定点からのパール富士は年に数回しかない。
        // 山頂の一点ではなく山頂付近に重なれば構図としては成立する（§14）。
        const tol = toleranceDeg ?? (best.p.radius * 2 + 0.1);
        if (best.value <= tol) {
          out.push({
            at: bestT, body, separationDeg: best.value,
            azimuthOffsetDeg: best.dAz, altitudeOffsetDeg: best.dAlt,
            bodyAzimuth: best.p.azimuth, bodyAltitude: best.p.altitude,
            bodyRadiusDeg: best.p.radius,
            targetAzimuth: tv.azimuth, targetAltitude: tv.altitude, targetDistanceKm: tv.distanceKm,
            // 山頂に「乗る」か「重なる」か
            kind: best.dAlt > best.p.radius * 0.5 ? "above"
                : best.dAlt < -best.p.radius * 0.5 ? "behind" : "on",
            illuminatedFraction: best.p.moon ? best.p.moon.illuminatedFraction : null,
          });
        }
      }
      rising = cur.value > prev.value;
      prev = cur;
    }
    return out;
  }

  /// 太陽の見かけの位置
  function sunView(ms, obs) {
    const s = A.sunPosition(ms);
    const T = A.centuries(ms);
    const { dPsi, dEps } = A.nutation(T);
    const eps = A.meanObliquity(T) + dEps;
    const eq = A.toEquatorial(s.longitude, 0, eps);
    const gast = A.apparentSiderealTime(ms, dPsi, eps);
    const H = norm(gast + obs.longitude - eq.ra);
    const h = A.toHorizontal(H, eq.dec, obs.latitude);
    return { azimuth: h.azimuth, altitude: h.altitude + A.refraction(h.altitude) };
  }

  /// 名前。パール富士＝月、ダイヤモンド富士＝太陽
  function nameOf(body, target, kind) {
    const isFuji = target.name === "富士山";
    if (isFuji) return body === "moon" ? "パール富士" : "ダイヤモンド富士";
    return body === "moon" ? `月と${target.name}` : `太陽と${target.name}`;
  }

  const SoramiComposition = {
    targetView, findAlignments, sunView, nameOf, azDiff,
  };
  global.SoramiComposition = SoramiComposition;
  if (typeof module !== "undefined" && module.exports) module.exports = SoramiComposition;
})(typeof globalThis !== "undefined" ? globalThis : window);
