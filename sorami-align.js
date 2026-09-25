/*
 * Sorami — ダイヤモンド／パールの「どこから見えるか」
 *
 * 富士山の詳細に出している `SoramiFuji.alignments()` は「この地点でいつか」。
 * こちらは逆で、**日付を決めて、その日に重なる観測点の並び（線）**を出す。
 *
 * 考え方は1つだけ。
 *   目標までの距離が決まれば、目標の先端を見上げる角度が決まる。
 *   その高度を天体が通る時刻が決まり、そのときの天体の方位が決まる。
 *   観測者は、目標から見てその方位の**反対側**にいる。
 * 距離を変えながらこれを解くと、観測点が並んで線になる。
 *
 * 観測者の標高で見上げ角が変わるので、標高タイルを読んで解き直す（2回）。
 * 天体の位置は観測者の場所でわずかに変わるので、そこも解き直す。
 *
 * 答え合わせ: 2026-12-22 の富士山の線は**高尾山から 0.2km**（16:09）を通る。
 * 高尾山の冬至のダイヤモンド富士と一致する。
 */
(function (global) {
  "use strict";

  const A = global.SoramiAstro || (typeof require !== "undefined" ? require("./sorami-astro.js") : null);
  const TR = global.SoramiTerrain || (typeof require !== "undefined" ? require("./sorami-terrain.js") : null);
  if (!A || !TR) throw new Error("astro / terrain が先に要ります");

  /**
   * 目標。`topM` は**海面からの高さ**（先端の標高）。
   * 塔は「地上◯m」で語られるので、地面の標高を足した値を持つ。
   */
  const TARGETS = [
    { id: "fuji", name: "富士山", latitude: 35.360555, longitude: 138.727363,
      note: "山頂（剣ヶ峰）3776m",
      parts: [{ id: "summit", name: "山頂", m: 3776 }] },
    { id: "skytree", name: "東京スカイツリー", latitude: 35.710063, longitude: 139.810700,
      note: "地上の高さ ＋ 地面の標高およそ2m",
      parts: [{ id: "tip", name: "先端", m: 636 },
              { id: "gallery", name: "天望回廊（第二展望台）", m: 452 },
              { id: "deck", name: "天望デッキ", m: 352 }] },
    { id: "tokyotower", name: "東京タワー", latitude: 35.658581, longitude: 139.745433,
      note: "地上の高さ ＋ 地面の標高およそ20m",
      parts: [{ id: "tip", name: "先端", m: 353 },
              { id: "top", name: "トップデッキ", m: 270 },
              { id: "main", name: "メインデッキ", m: 170 }] },
    { id: "cinderella", name: "シンデレラ城", latitude: 35.632896, longitude: 139.880394,
      note: "高さ51m ＋ 地面の標高およそ3m",
      parts: [{ id: "tip", name: "てっぺん", m: 54 }] },
    // 東京ディズニーランドホテルの避雷針の先端。ティンカーベルの像が載る。
    // **公表された高さが無い**ので推定（OpenStreetMap の建物高さ60m）。画面で直せる
    { id: "tinkerbell", name: "ティンカーベル", latitude: 35.637031, longitude: 139.878077,
      note: "東京ディズニーランドホテルの避雷針の先端。高さは推定なので、合わせながら直せます",
      parts: [{ id: "tip", name: "避雷針の先端", m: 60, adjustable: true }] },
  ];
  const targetById = (id) => TARGETS.find((t) => t.id === id) || null;
  const partOf = (target, partId) =>
    (target.parts || []).find((p) => p.id === partId) || (target.parts || [])[0] || null;

  /**
   * 天体のどこを合わせるか。**「てっぺんに乗る」と「重なる」は別の位置**。
   *   onTop  … 天体の下端が先端に接する（乗っかって見える）→ 中心は半径ぶん上
   *   center … 中心がその高さに重なる
   *   behind … 天体の上端がその高さ（＝その高さの裏に隠れる直前）→ 中心は半径ぶん下
   */
  const LIMBS = [
    { id: "onTop", name: "てっぺんに乗る", sign: 1 },
    { id: "center", name: "中心が重なる", sign: 0 },
    { id: "behind", name: "裏に隠れる", sign: -1 },
  ];
  const limbById = (id) => LIMBS.find((l) => l.id === id) || LIMBS[1];

  const bodyAt = (body, ms, obs) => (body === "moon" ? A.moon(ms, obs) : A.sun(ms, obs));

  /**
   * その日、天体の見かけの高度が `alt` を通る時刻。
   * @param {string} side "set"=下降中 / "rise"=上昇中
   */
  function altitudeCrossing(body, dayMs, obs, alt, side, stepMs = 120000) {
    let prev = null;
    for (let t = dayMs; t <= dayMs + 86400000; t += stepMs) {
      const cur = bodyAt(body, t, obs).apparentAltitude;
      if (prev !== null) {
        const falling = cur < prev.alt;
        const crossed = (prev.alt - alt) * (cur - alt) <= 0;
        if (crossed && ((side === "set" && falling) || (side === "rise" && !falling))) {
          let lo = prev.t, hi = t, loDiff = prev.alt - alt;
          for (let i = 0; i < 30; i++) {
            const mid = (lo + hi) / 2;
            const d = bodyAt(body, mid, obs).apparentAltitude - alt;
            if (d * loDiff > 0) { lo = mid; loDiff = d; } else hi = mid;
          }
          return (lo + hi) / 2;
        }
      }
      prev = { t, alt: cur };
    }
    return null;
  }

  /**
   * 距離 d の観測点を1つ解く。
   * @param {function} elevationAt  (lat, lon) => 標高[m]（省略可。既定は 0m）
   */
  async function solvePoint(target, body, dayMs, distanceKm, side, opts = {}) {
    const { eyeM = 1.5, elevationAt = null, rounds = 3, heightM = null, limb = "center" } = opts;
    const topM = heightM !== null ? heightM : (partOf(target, opts.partId) || {}).m;
    if (!Number.isFinite(topM)) return null;
    const sign = limbById(limb).sign;
    let guess = { latitude: target.latitude, longitude: target.longitude };
    let obsM = 0, at = null, azimuth = null, alpha = null;
    for (let i = 0; i < rounds; i++) {
      if (elevationAt) {
        const e = await elevationAt(guess.latitude, guess.longitude);
        if (Number.isFinite(e)) obsM = e;
      }
      const obs0 = { latitude: guess.latitude, longitude: guess.longitude, elevation: obsM + eyeM };
      // その高さを見上げる角度。乗せる／隠れるは、天体の半径ぶんずらした高度を狙う
      const base = A.targetElevationAngle(distanceKm, obsM + eyeM, topM);
      const probe = bodyAt(body, dayMs + 43200000, obs0);
      alpha = base + sign * probe.angularRadius;
      at = altitudeCrossing(body, dayMs, obs0, alpha, side);
      if (at === null) return null;
      const st = bodyAt(body, at, obs0);
      azimuth = st.azimuth;
      // 観測者から見て天体（＝目標）が方位 azimuth にある。目標から見ると反対側
      guess = TR.destination(target.latitude, target.longitude, (azimuth + 180) % 360, distanceKm);
    }
    const obs = { latitude: guess.latitude, longitude: guess.longitude, elevation: obsM + eyeM };
    const st = bodyAt(body, at, obs);
    return {
      latitude: guess.latitude, longitude: guess.longitude,
      at, distanceKm, elevationM: obsM, targetTopM: topM, limb,
      azimuth: st.azimuth, altitude: st.apparentAltitude,
      radius: st.angularRadius,
      illuminated: body === "moon" ? st.illuminatedFraction : null,
      sunAltitude: body === "moon" ? A.sun(at, obs).apparentAltitude : null,
    };
  }

  /**
   * 線を引く距離の範囲。**目標の高さで決まる。**
   * 高さ h を見上げる角度は距離で決まるので、使える角度の帯（約20°〜1°）を距離に直す。
   * 60mの避雷針を120km先から見上げても地平線の下で、3776mの富士山を8km先から
   * 見上げるのは山の中腹。同じ距離を全部の目標に当てると、どちらかが無駄になる。
   */
  function lineRange(topM) {
    const near = Math.max(0.3, (topM / 1000) / Math.tan(20 * Math.PI / 180));
    const far = Math.min(150, (topM / 1000) / Math.tan(1.0 * Math.PI / 180));
    return { minKm: Math.round(near * 10) / 10, maxKm: Math.round(far) };
  }

  /**
   * 線を解く距離の並び。**等間隔ではなく、近いほど細かく取る。**
   * 線は近いほど強く曲がる（見上げ角が急に変わるので、天体の方位も急に変わる）。
   * 等間隔だと、その曲がる区間が数点しか無くて折れ線に見える。
   */
  function lineDistances(minKm, maxKm, count = 36) {
    const r = (maxKm / minKm) ** (1 / (count - 1));
    return Array.from({ length: count }, (_, i) => minKm * r ** i);
  }

  /**
   * その日の線。距離を変えながら観測点を並べる。
   * 距離を渡さなければ、目標の高さから決める（`lineRange`）。
   * @returns {Promise<{side:string, points:Array}>[]} 日の出側・日の入側それぞれ
   */
  async function line(target, body, dayMs, opts = {}) {
    const auto = lineRange(((partOf(target, opts.partId) || {}).m) || 0);
    const { minKm = auto.minKm, maxKm = auto.maxKm, stepKm = null, sides = ["rise", "set"] } = opts;
    const dists = stepKm
      ? Array.from({ length: Math.floor((maxKm - minKm) / stepKm) + 1 }, (_, i) => minKm + i * stepKm)
      : lineDistances(minKm, maxKm);
    const out = [];
    for (const side of sides) {
      const points = [];
      for (const d of dists) {
        const p = await solvePoint(target, body, dayMs, d, side, opts);
        // 地平線より下、または天体が出ていない側は線にならない
        if (p && p.altitude > -1) points.push({ ...p, side });
      }
      if (points.length >= 2) out.push({ side, points });
    }
    return out;
  }

  /// 観測地点から見た目標の幾何（方位と見上げ角）。**地形は見ない**（線と一覧の両方で使う素の値）
  function geometryFrom(observer, target, opts = {}) {
    const { eyeM = 1.5, partId = null, heightM = null } = opts;
    const topM = heightM !== null ? heightM : (partOf(target, partId) || {}).m;
    if (!Number.isFinite(topM)) return null;
    const distanceKm = TR.distanceKm(observer.latitude, observer.longitude, target.latitude, target.longitude);
    return {
      distanceKm,
      azimuth: TR.bearing(observer.latitude, observer.longitude, target.latitude, target.longitude),
      angle: A.targetElevationAngle(distanceKm, (observer.elevation ?? 0) + eyeM, topM),
      topM,
    };
  }

  const azDiff = (a, b) => ((a - b + 540) % 360) - 180;

  /**
   * その地点で、次に重なる日を並べる（「ダイヤモンド◯◯一覧」「パール◯◯一覧」）。
   * 判定は `SoramiFuji.alignments()` と同じ考え方で、幾何だけ目標ごとに作る。
   */
  function upcoming(observer, target, body, opts = {}) {
    const { from = Date.now(), days = 400, limit = 6, limb = "center", stepMs = null } = opts;
    const g = geometryFrom(observer, target, opts);
    if (!g) return [];
    const sign = limbById(limb).sign;
    const step = stepMs ?? (body === "moon" ? 900000 : 600000);
    const obs = { latitude: observer.latitude, longitude: observer.longitude,
                  elevation: (observer.elevation ?? 0) + (opts.eyeM ?? 1.5) };
    const out = [];
    let group = null;
    for (let i = 0; i < days && out.length < limit; i++) {
      const dayMs = from + i * 86400000;
      // その日、天体が目標の方位を横切る時刻
      let prev = null;
      for (let t = dayMs; t <= dayMs + 86400000; t += step) {
        const diff = azDiff(bodyAt(body, t, obs).azimuth, g.azimuth);
        if (prev && Math.sign(prev.diff) !== Math.sign(diff) && Math.abs(diff - prev.diff) < 90) {
          let lo = prev.t, hi = t, loDiff = prev.diff;
          for (let k = 0; k < 36; k++) {
            const mid = (lo + hi) / 2;
            const md = azDiff(bodyAt(body, mid, obs).azimuth, g.azimuth);
            if (Math.sign(md) === Math.sign(loDiff)) { lo = mid; loDiff = md; } else hi = mid;
          }
          const at = (lo + hi) / 2;
          const st = bodyAt(body, at, obs);
          const gap = st.apparentAltitude - (g.angle + sign * st.angularRadius);
          const within = Math.abs(gap) <= 2 * st.angularRadius;
          if (within && st.apparentAltitude > -1) {
            const later = bodyAt(body, at + 60000, obs).apparentAltitude;
            const row = { at, gap, radius: st.angularRadius,
              rank: (Math.abs(gap) <= 0.5 * st.angularRadius ? "center"
                : Math.abs(gap) <= st.angularRadius ? "overlap" : "graze"),
              side: later < st.apparentAltitude ? "set" : "rise",
              altitude: st.apparentAltitude,
              illuminated: body === "moon" ? st.illuminatedFraction : null,
              sunAltitude: body === "moon" ? A.sun(at, obs).apparentAltitude : null };
            if (group && at - group.last <= 40 * 3600000) {
              group.last = at;
              if (Math.abs(row.gap) < Math.abs(group.best.gap)) group.best = row;
              if (row.rank !== "graze") group.solid.push(row);
            } else {
              if (group) out.push(group);
              group = { best: row, first: at, last: at, solid: row.rank !== "graze" ? [row] : [] };
            }
          }
        }
        prev = { t, diff };
      }
    }
    if (group && out.length < limit) out.push(group);
    return out.slice(0, limit).map((x) => ({
      ...x.best, distanceKm: g.distanceKm, targetAngle: g.angle, targetTopM: g.topM,
      from: x.solid.length ? x.solid[0].at : x.best.at,
      to: x.solid.length ? x.solid[x.solid.length - 1].at : x.best.at,
      dayCount: Math.max(1, x.solid.length),
    }));
  }

  const SoramiAlign = { TARGETS, targetById, partOf, LIMBS, limbById, line, lineRange, lineDistances, solvePoint,
                        altitudeCrossing, geometryFrom, upcoming };
  global.SoramiAlign = SoramiAlign;
  if (typeof module !== "undefined" && module.exports) module.exports = SoramiAlign;
})(typeof globalThis !== "undefined" ? globalThis : window);
