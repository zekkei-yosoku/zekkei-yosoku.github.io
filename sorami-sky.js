/*
 * Sorami — 太陽・月の通り道と、山・建物の稜線より上にいる区間
 *
 * 詳細の「光の時間」の「この場所では 日の出・日の入」に使う（稜線は月の判定で測ったもの。ここでは通信しない）。
 * もとは「空の見え方」（方位×高さの展開図と3D）の元データだったが、その画面は 2026-10-02 になくした
 * （ユーザー「空の見え方ってなに。もういらないんじゃないの。使い物になってない」→ なくすを選んだ）。
 * 描くための関数（枠・稜線の並び・目盛り・3Dの向きと格子）も一緒に外した。
 *
 * 方位は 0〜360 で折り返すので、連続した座標 `x` を別に持たせる（`unwrap`）。
 */
(function (global) {
  "use strict";

  const A = global.SoramiAstro || (typeof require !== "undefined" ? require("./sorami-astro.js") : null);
  if (!A) throw new Error("astro が先に要ります");

  const stateAt = (body, ms, obs) => (body === "moon" ? A.moon(ms, obs) : A.sun(ms, obs));

  /**
   * その日の通り道。既定は5分刻み（1日で289点）。
   * @returns {Array} {at, azimuth, altitude, radius, illuminated, x}
   */
  function track(body, dayMs, obs, { stepMin = 5, hours = 24 } = {}) {
    const step = stepMin * 60000;
    const out = [];
    for (let t = dayMs; t <= dayMs + hours * 3600000; t += step) {
      const st = stateAt(body, t, obs);
      out.push({
        at: t,
        azimuth: st.azimuth,
        altitude: st.apparentAltitude,
        radius: st.angularRadius,
        illuminated: body === "moon" ? st.illuminatedFraction : null,
      });
    }
    return unwrap(out);
  }

  /**
   * 方位の折り返しをほどく。隣どうしの差が180度を超えたら、一周ぶん足し引きする。
   * `x` は「連続した方位」で、360を超えたり負になったりする。**描画用の座標。**
   */
  function unwrap(points) {
    let turns = 0;
    for (let i = 0; i < points.length; i++) {
      if (i > 0) {
        const d = points[i].azimuth - points[i - 1].azimuth;
        if (d > 180) turns -= 1; else if (d < -180) turns += 1;
      }
      points[i].x = points[i].azimuth + turns * 360;
    }
    return points;
  }

  /// 稜線の高さ。関数が無ければ平らな0度
  const horizonOf = (horizonAt) => (typeof horizonAt === "function" ? horizonAt : () => 0);

  /**
   * 稜線より上にいる区間。**「地平線の上」ではなく「その場所で見えるか」。**
   * 端の時刻は、隣り合う標本のあいだを二分して詰める（標本の刻みで丸めない）。
   */
  function visibleSpans(points, horizonAt, body, obs) {
    const h = horizonOf(horizonAt);
    const above = (p) => p.altitude > h(p.azimuth);
    const at = (ms) => {
      const st = stateAt(body, ms, obs);
      return st.apparentAltitude > h(st.azimuth);
    };
    const edge = (a, b) => {                 // a と b のあいだの境目
      let lo = a.at, hi = b.at;
      const want = above(b);
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (at(mid) === want) hi = mid; else lo = mid;
      }
      return Math.round(hi);
    };
    const spans = [];
    let open = null;
    for (let i = 0; i < points.length; i++) {
      const now = above(points[i]);
      if (now && open === null) {
        open = i === 0 ? points[i].at : edge(points[i - 1], points[i]);
      } else if (!now && open !== null) {
        spans.push({ from: open, to: edge(points[i - 1], points[i]) });
        open = null;
      }
    }
    if (open !== null) spans.push({ from: open, to: points[points.length - 1].at });
    return spans;
  }

  const SoramiSky = { track, unwrap, visibleSpans };
  global.SoramiSky = SoramiSky;
  if (typeof module !== "undefined" && module.exports) module.exports = SoramiSky;
})(typeof globalThis !== "undefined" ? globalThis : this);
