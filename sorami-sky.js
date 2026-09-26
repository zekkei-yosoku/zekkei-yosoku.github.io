/*
 * Sorami — 空の展開図（パノラマ）の元データ
 *
 * 「ねらう」が地図の上で**どこに立つか**を出すのに対して、こちらは
 * **その場所で空がどう見えるか**を出す。横軸に方位、縦軸に高度を取り、
 * 地形と建物の稜線の上に、太陽と月の通り道を重ねる。
 *
 * 稜線は既に測ってある（月の判定で全周1度刻みの `measureHorizon` と、
 * 建物の `urbanHorizon` を合成した関数）。**ここでは通信しない。**
 *
 * 方位は 0〜360 で折り返すので、そのまま繋ぐと画面の端から端へ線が飛ぶ。
 * 描くための連続した座標 `x` を別に持たせる（`unwrap`）。
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

  /// いちばん高くなる点
  function peak(points) {
    return points.reduce((a, b) => (b.altitude > a.altitude ? b : a), points[0]) || null;
  }

  /**
   * 描く範囲。**主役は稜線の上にいる区間**なので、そこが収まるように取る。
   * 収まらないほど広いとき（1日で方位が180度動く）は `maxSpanDeg` で切って、
   * 呼び手が時刻で動かす。
   */
  function frame(points, spans, { maxSpanDeg = 140, minSpanDeg = 60, padDeg = 8 } = {}) {
    const inSpan = spans.length
      ? points.filter((p) => spans.some((s) => p.at >= s.from && p.at <= s.to))
      : points;
    const use = inSpan.length ? inSpan : points;
    let lo = Math.min(...use.map((p) => p.x)), hi = Math.max(...use.map((p) => p.x));
    let span = Math.min(maxSpanDeg, Math.max(minSpanDeg, hi - lo + padDeg * 2));
    const center = (lo + hi) / 2;
    const top = Math.max(30, Math.ceil((peak(use) || { altitude: 0 }).altitude / 10) * 10 + 10);
    return { centerX: center, spanDeg: span, topDeg: Math.min(90, top), bottomDeg: -6 };
  }

  /**
   * 稜線の並び。`from`〜`to` は連続した方位（360を超えてよい）。
   * 稜線の関数は 0〜360 で持っているので、折り返して引く。
   */
  function skyline(horizonAt, fromX, toX, stepDeg = 0.5) {
    const h = horizonOf(horizonAt);
    const out = [];
    for (let x = fromX; x <= toX + 1e-9; x += stepDeg) {
      out.push({ x, angle: h(((x % 360) + 360) % 360) });
    }
    return out;
  }

  /// 32方位のうち8つ。目盛りに使う
  const COMPASS = [
    { deg: 0, name: "北" }, { deg: 45, name: "北東" }, { deg: 90, name: "東" },
    { deg: 135, name: "南東" }, { deg: 180, name: "南" }, { deg: 225, name: "南西" },
    { deg: 270, name: "西" }, { deg: 315, name: "北西" },
  ];
  /// `fromX`〜`toX` に入る方位の目盛り（連続座標で返す）
  function compassTicks(fromX, toX) {
    const out = [];
    const start = Math.floor(fromX / 45) * 45;
    for (let x = start; x <= toX; x += 45) {
      if (x < fromX) continue;
      const deg = ((x % 360) + 360) % 360;
      const c = COMPASS.find((v) => v.deg === deg);
      if (c) out.push({ x, name: c.name, deg });
    }
    return out;
  }

  /**
   * 方位と高度を、観測点を原点にした3Dの向きへ。
   * three.js に合わせて **北が -Z・東が +X・上が +Y**（右手系）。
   * @returns {{x:number,y:number,z:number}} 長さ `r` のベクトル
   */
  function direction(azimuthDeg, altitudeDeg, r = 1) {
    const a = azimuthDeg * Math.PI / 180, h = altitudeDeg * Math.PI / 180;
    const c = Math.cos(h) * r;
    return { x: c * Math.sin(a), y: Math.sin(h) * r, z: -c * Math.cos(a) };
  }

  /**
   * 地形のかたち（3D用の格子）。
   *
   * 高さは標高そのものではなく**見上げ角から**出す。角度には地球の丸みと大気差が
   * 入っているので、こうすると**展開図と3Dが必ず同じ稜線になる**。
   * 標高をそのまま y にすると、遠くの山が実際より高く見える（丸みのぶん）。
   *
   * @param {number[]} azimuths 方位（度）。一周ぶん渡すと端がつながる
   * @param {number[]} distancesKm 近い順
   * @param {function} angleAt (方位の番号, 距離の番号) → 見上げ角（度）
   */
  function meshGrid(azimuths, distancesKm, angleAt) {
    const na = azimuths.length, nd = distancesKm.length;
    const positions = new Float32Array(na * nd * 3);
    let k = 0;
    for (let i = 0; i < na; i++) {
      for (let j = 0; j < nd; j++) {
        const d = distancesKm[j];
        const v = direction(azimuths[i], angleAt(i, j), d);
        positions[k++] = v.x; positions[k++] = v.y; positions[k++] = v.z;
      }
    }
    // 四角ごとに三角2枚。方位は一周して最初へ戻す（つなぎ目を作らない）
    const indices = [];
    for (let i = 0; i < na; i++) {
      const i2 = (i + 1) % na;
      for (let j = 0; j < nd - 1; j++) {
        const a = i * nd + j, b = i * nd + j + 1, c = i2 * nd + j, e = i2 * nd + j + 1;
        indices.push(a, b, c, c, b, e);
      }
    }
    return { positions, indices: new Uint32Array(indices), na, nd };
  }

  const SoramiSky = { track, unwrap, visibleSpans, peak, frame, skyline, compassTicks, COMPASS,
                      direction, meshGrid };
  global.SoramiSky = SoramiSky;
  if (typeof module !== "undefined" && module.exports) module.exports = SoramiSky;
})(typeof globalThis !== "undefined" ? globalThis : this);
