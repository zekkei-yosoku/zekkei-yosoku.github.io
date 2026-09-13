/*
 * Sorami — 山を「点」ではなく「山体」として扱う
 *
 * 指示書（富士）§14「富士山を山頂1点で扱わない」・§15 Mountain Silhouette・
 * §16 Mountain Target Grid・§21 Geometric Visible Fraction・§22 FULL/PARTIAL/NONE。
 *
 * **なぜ要るか。** 山中湖（15km）から素朴に山頂1点で判定すると「隠れる」と出る。
 * 視線が火口をまたぐため、近い外輪（3670m）のほうが空では剣ヶ峰（3776m）より
 * 高い位置に来るからだ。事実としては正しいが、知りたいのは
 * 「富士山が見えるか」であって「剣ヶ峰の一点が見えるか」ではない。
 *
 * **観測地点は事前計算できないが、山は動かない。**
 * 山体の標高格子だけ先に持っておけば、どの地点からでも輪郭を計算できる。
 */
(function (global) {
  "use strict";

  const A = global.SoramiAstro
    || (typeof require !== "undefined" ? require("./sorami-astro.js") : null);
  const TR = global.SoramiTerrain
    || (typeof require !== "undefined" ? require("./sorami-terrain.js") : null);
  if (!A || !TR) throw new Error("sorami-astro.js と sorami-terrain.js が先に要ります");

  /**
   * 観測地点から見た山体の輪郭を作る。
   *
   * 格子の各マスを（方位・仰角）へ投げ、方位のビンごとに**最も高い仰角**を取る。
   * それが「空に対して山がどこまで届いているか」＝輪郭。
   *
   * @param {object} observer { latitude, longitude, elevation }
   * @param {object} grid  build-fuji-grid.mjs が作ったもの
   * @param {number} binDeg 方位の刻み（既定 0.05度。満月の直径の1/10）
   */
  /// 同梱の格子（Int16 を base64 にしたもの）を開く。**一度だけ開いて憶える。**
  const opened = new WeakMap();
  function openGrid(grid) {
    if (grid.cells) return grid;                    // 既に配列で持っているもの
    let g = opened.get(grid);
    if (g) return g;
    const bin = typeof atob === "function"
      ? Uint8Array.from(atob(grid.data), (c) => c.charCodeAt(0))
      : new Uint8Array(Buffer.from(grid.data, "base64"));
    g = { ...grid, values: new Int16Array(bin.buffer, bin.byteOffset, bin.byteLength / 2) };
    opened.set(grid, g);
    return g;
  }

  /// 格子のマスを順に返す（欠測と、低すぎて山体でないものは飛ばす）
  function* cellsOf(grid, minElevationM) {
    const g = openGrid(grid);
    if (g.cells) { for (const c of g.cells) if (c[2] >= minElevationM) yield c; return; }
    for (let r = 0; r < g.rows; r++) {
      const la = g.lat0 + r * g.dLat;
      for (let c = 0; c < g.cols; c++) {
        const v = g.values[r * g.cols + c];
        if (v === g.noData || v < minElevationM) continue;
        yield [la, g.lon0 + c * g.dLon, v];
      }
    }
  }

  function silhouette(observer, grid, { binDeg = 0.05, minElevationM = 1000, ...opts } = {}) {
    const bins = new Map();
    let nearestKm = Infinity, farthestKm = 0;
    for (const [la, lo, el] of cellsOf(grid, minElevationM)) {
      const d = TR.distanceKm(observer.latitude, observer.longitude, la, lo);
      if (d < 0.05) continue;                       // 山の上に立っている場合
      const az = TR.bearing(observer.latitude, observer.longitude, la, lo);
      const ang = A.targetElevationAngle(d, observer.elevation ?? 0, el, opts);
      const k = Math.round(az / binDeg);
      const cur = bins.get(k);
      if (!cur || ang > cur.angleDeg) {
        bins.set(k, { azimuth: k * binDeg, angleDeg: ang, distanceKm: d, elevationM: el });
      }
      nearestKm = Math.min(nearestKm, d);
      farthestKm = Math.max(farthestKm, d);
    }
    const outline = [...bins.values()].sort((a, b) => a.azimuth - b.azimuth);
    if (!outline.length) return null;

    // 方位が0/360をまたぐと並びが飛ぶので、連続する側へ寄せて幅を測る
    const azs = outline.map((o) => o.azimuth);
    let spanDeg = azs[azs.length - 1] - azs[0];
    if (spanDeg > 180) {
      const shifted = azs.map((a) => (a > 180 ? a - 360 : a)).sort((a, b) => a - b);
      spanDeg = shifted[shifted.length - 1] - shifted[0];
    }
    const top = outline.reduce((a, b) => (b.angleDeg > a.angleDeg ? b : a));
    return {
      outline, binDeg, spanDeg,
      apexAzimuth: top.azimuth, apexAngleDeg: top.angleDeg,
      apexDistanceKm: top.distanceKm, apexElevationM: top.elevationM,
      nearestKm, farthestKm,
    };
  }

  /**
   * 輪郭のうち、手前の地形より上に出ている割合（§21 Geometric Visible Fraction）。
   *
   * @param {object} sil silhouette() の結果
   * @param {function} horizonAt 方位 → 地形の地平線の高さ（度）
   */
  function visibleFraction(sil, horizonAt) {
    if (!sil) return { fraction: 0, classification: "NONE", visible: [], hidden: [] };
    const visible = [], hidden = [];
    let topVisible = null;
    for (const o of sil.outline) {
      const h = horizonAt(o.azimuth);
      if (o.angleDeg > h) {
        visible.push({ ...o, aboveDeg: o.angleDeg - h });
        if (!topVisible || o.angleDeg > topVisible.angleDeg) topVisible = o;
      } else {
        hidden.push({ ...o, belowDeg: h - o.angleDeg });
      }
    }
    const fraction = visible.length / sil.outline.length;
    // §22 の3分類。**「一部でも見える」と「ほぼ全部見える」を混ぜない**
    const classification = fraction >= 0.95 ? "FULL" : fraction > 0 ? "PARTIAL" : "NONE";
    return {
      fraction, classification, visible, hidden,
      topVisibleAngleDeg: topVisible ? topVisible.angleDeg : null,
      apexVisible: !!topVisible && Math.abs(topVisible.angleDeg - sil.apexAngleDeg) < 1e-9,
    };
  }

  /**
   * 見かけの大きさが、実用になるかどうか（§24-27 Practical Visibility Gate）。
   *
   * 遠すぎて豆粒にしか写らないなら「見える」と言っても意味が薄い。
   * **0点にはしない**（§109「Geometry対象外は0点ではない」）。区分を返すだけ。
   */
  const APPARENT_SIZE_BANDS = [
    { min: 3.0,  key: "dominant",  label: "大きく見える" },
    { min: 1.0,  key: "clear",     label: "はっきり分かる" },
    { min: 0.35, key: "small",     label: "小さい" },
    { min: 0.0,  key: "tiny",      label: "豆粒" },
  ];
  function apparentSize(sil) {
    if (!sil) return null;
    // **高さで測る。** 幅ではない。
    // 近くから見ると裾野が視野いっぱいに広がって幅は60度を超えるが、
    // それは「大きく見える」の意味ではない。山と分かるのは空へ立ち上がる高さのほう。
    const heightDeg = sil.apexAngleDeg - Math.min(...sil.outline.map((o) => o.angleDeg));
    const deg = heightDeg;
    const band = APPARENT_SIZE_BANDS.find((b) => deg >= b.min);
    return {
      widthDeg: sil.spanDeg, heightDeg, deg,
      moonDiameters: deg / 0.52,        // 満月いくつぶんか。人が想像しやすい単位
      key: band.key, label: band.label,
    };
  }

  /**
   * 幾何だけの判定を一式返す。**天気はここでは一切見ない**（§3「GeometryをWeatherより先に」）。
   */
  function geometry(observer, grid, horizonAt, opts = {}) {
    const sil = silhouette(observer, grid, opts);
    if (!sil) return { available: false, reason: "山体の格子に届く点が無い" };
    const vis = visibleFraction(sil, horizonAt);
    const size = apparentSize(sil);
    return {
      available: true,
      silhouette: sil,
      fraction: vis.fraction,
      classification: vis.classification,
      apexVisible: vis.apexVisible,
      topVisibleAngleDeg: vis.topVisibleAngleDeg,
      hiddenBins: vis.hidden.length,
      totalBins: sil.outline.length,
      apparentSize: size,
      distanceKm: sil.apexDistanceKm,
      azimuthDeg: sil.apexAzimuth,
    };
  }

  const SoramiMountain = {
    silhouette, visibleFraction, apparentSize, geometry, APPARENT_SIZE_BANDS, openGrid, cellsOf,
  };
  global.SoramiMountain = SoramiMountain;
  if (typeof module !== "undefined" && module.exports) module.exports = SoramiMountain;
})(typeof globalThis !== "undefined" ? globalThis : window);
