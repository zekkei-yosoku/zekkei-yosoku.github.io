/*
 * Sorami — 月が見えるか
 *
 * 指示書（月）§21-47。**月出時刻を表示する機能ではない**（§100）。
 *
 *   天文の月出 → 地形の月出 → 明るい縁が出る → 雲を抜けて見える → 写真に撮れる
 *
 * この順序を崩さない（§18・§100）。前の段が済んでいないのに次は来ない。
 *
 * 幾何（sorami-astro.js）と地形（sorami-terrain.js）の上に、雲と霞を重ねる。
 */
(function (global) {
  "use strict";

  const A = global.SoramiAstro || (typeof require !== "undefined" ? require("./sorami-astro.js") : null);
  const TR = global.SoramiTerrain || (typeof require !== "undefined" ? require("./sorami-terrain.js") : null);
  const FJ = global.SoramiFuji || (typeof require !== "undefined" ? require("./sorami-fuji.js") : null);
  if (!A || !TR || !FJ) throw new Error("astro / terrain / fuji が先に要ります");

  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  /**
   * 月の明るさ（§30）。**輝面比に比例させてはいけない。**
   *
   * 満月は半月の2倍ではなく約10倍明るい。月面の反射は位相角に強く依存する
   * （衝効果）。ここでは月の視等級の実測式を使う。
   *   m ≈ -12.73 + 0.026|α| + 4e-9 α^4    （α は位相角[度]）
   * 距離の違いも入れる（近地点と遠地点で 30% 違う）。
   */
  function brightness(moon) {
    const a = Math.abs(moon.phaseAngle);
    const mag = -12.73 + 0.026 * a + 4e-9 * a ** 4
              + 5 * Math.log10(moon.distanceKm / 384400);
    // 満月を 1 とした相対的な明るさ
    return { magnitude: mag, relative: Math.pow(10, -0.4 * (mag - (-12.73))) };
  }

  /**
   * 空の明るさに対して月が目立つか（§37 Moon / Sky Contrast・§36 Daytime Moon）。
   *
   * **昼の月も扱う**（§36 が明示的に要求している）。細い月は昼に見えない。
   */
  function skyContrast(moon, sunAltitude) {
    const b = brightness(moon);
    // 空の明るさの目安。太陽高度で段階的に変わる
    const sky = sunAltitude > 0 ? 1
      : sunAltitude > -6 ? 0.35            // 市民薄明
      : sunAltitude > -12 ? 0.10           // 航海薄明
      : sunAltitude > -18 ? 0.03 : 0.01;   // 天文薄明・夜
    // 昼間は明るい月しか見えない。夜はほとんどの月が見える
    const ratio = b.relative / sky;
    return { value: clamp01(Math.log10(Math.max(ratio, 1e-4) * 10) / 2),
             relativeBrightness: b.relative, magnitude: b.magnitude, skyLevel: sky };
  }

  /**
   * 月の方向の雲（§22-26）。
   *
   * **全天の雲量で判定してはいけない**（§22）。月の方位・高度の側の雲を見る。
   * 月が低いほど視線は遠くの雲を通る（§24）。
   */
  function cloudTransmission(reading, moon) {
    if (!reading) return { p: null, why: "予報が無い" };
    const alt = Math.max(0.1, moon.apparentAltitude);
    // 視線が各層を横切る距離。低いほど長い（airmass に近い考え方）
    const slant = 1 / Math.sin(alt * Math.PI / 180);
    let p = 1;
    const notes = [];
    for (const [name, band, label] of [
      ["low", "cloud_cover_low", "低い雲"],
      ["mid", "cloud_cover_mid", "中くらいの雲"],
      ["high", "cloud_cover_high", "高い雲"],
    ]) {
      const c = reading[band];
      if (!Number.isFinite(c)) continue;
      // 斜めに見るほど雲に当たりやすい。ただし頭打ちにする（水平で無限にはならない）
      const effective = clamp01((c / 100) * Math.min(3, slant) / 1.6);
      // **月は明るいので薄い雲は透ける**（§28）。高い雲ほど透けやすい
      const thin = name === "high" ? 0.55 : name === "mid" ? 0.3 : 0.12;
      p *= clamp01((1 - effective) + effective * thin);
      if (c >= 30) notes.push(`${label} ${Math.round(c)}%`);
    }
    if (Number.isFinite(reading.precipitation) && reading.precipitation > 0.1) {
      p *= 0.15; notes.push("降水");
    }
    return { p: clamp01(p), why: notes.join(" / ") || "月の方向に目立つ雲なし", slant };
  }

  /**
   * 低い高度での減光（§31-35）。月出・月入では大気を長く通る。
   */
  function extinction(reading, air, moon) {
    const alt = moon.apparentAltitude;
    if (alt < -0.5) return { p: 0, why: "地平線の下" };
    // 低高度対応の airmass（Kasten & Young 1989）。sec(z) は地平線付近で破綻する（§32）
    const z = 90 - Math.max(0, alt);
    const am = 1 / (Math.cos(z * Math.PI / 180) + 0.50572 * Math.pow(96.07995 - z, -1.6364));
    const aod = air && Number.isFinite(air.aerosol_optical_depth) ? air.aerosol_optical_depth : 0.15;
    const rh = reading && Number.isFinite(reading.relative_humidity_2m) ? reading.relative_humidity_2m : 60;
    const growth = 1 + Math.max(0, (rh - 60) / 40) * 1.2;      // §34 RH × エアロゾル
    const tau = (aod * growth + 0.12) * am;                    // 0.12 はレイリー＋オゾン
    let p = Math.exp(-tau * 0.6);                              // 見えなくなるのは減光そのものより遅い
    const notes = [`大気の厚み ${am.toFixed(1)}倍`];
    if (air && Number.isFinite(air.dust) && air.dust > 20) {   // §35 Dust
      p *= clamp01(1 - air.dust / 250); notes.push(`ダスト ${Math.round(air.dust)}`);
    }
    return { p: clamp01(p), why: notes.join(" / "), airmass: am, opticalDepth: tau };
  }

  /**
   * ある時刻に月が見えるか。
   *
   * @param {number} ms   時刻
   * @param {object} obs  { latitude, longitude, elevation }（elevation は目の高さ）
   * @param {function} horizonAt 方位 → 地形の地平線[度]
   */
  function evaluateAt(ms, obs, { horizonAt = () => 0, reading = null, air = null } = {}) {
    const m = A.moon(ms, obs);
    const sun = A.sunPosition ? null : null;
    const horizon = horizonAt(m.azimuth);
    const aboveTerrain = m.upperLimbAltitude - horizon;

    if (aboveTerrain <= 0) {
      return { ms, moon: m, visible: false, aboveTerrainDeg: aboveTerrain,
               pVisible: 0, pPhoto: 0, score: 0, reason: "まだ地形の下" };
    }
    const cloud = cloudTransmission(reading, m);
    const ext = extinction(reading, air, m);
    const sunAlt = sunAltitude(ms, obs);
    const contrast = skyContrast(m, sunAlt);

    const pVisible = clamp01((cloud.p ?? 0.6) * ext.p * clamp01(0.25 + 0.75 * contrast.value));
    // **写真に撮れるかは、見えるかとは別**（§9）。薄雲でも眼では見えるが写真は眠くなる
    const pPhoto = clamp01(pVisible * (cloud.p ?? 0.6) * clamp01(0.15 + 0.85 * contrast.value));
    // 月の一部だけ地形から出ている間は割り引く
    const emerged = clamp01(aboveTerrain / Math.max(0.05, m.angularDiameter));
    const score = Math.round(100 * pVisible * (0.4 + 0.6 * emerged));

    return {
      ms, moon: m, visible: true, aboveTerrainDeg: aboveTerrain, emergedFraction: emerged,
      pVisible, pPhoto, score,
      clarity: Math.round(100 * clamp01(ext.p * (cloud.p ?? 0.6))),
      parts: [
        { key: "cloud", label: "月の方向の雲", p: cloud.p, why: cloud.why },
        { key: "air", label: "大気の澄み具合", p: ext.p, why: ext.why },
        { key: "contrast", label: "空に対する明るさ", p: contrast.value,
          why: `輝面 ${Math.round(m.illuminatedFraction * 100)}% / 太陽高度 ${sunAlt.toFixed(0)}度` },
      ],
      sunAltitude: sunAlt,
    };
  }

  /// 太陽の高度（薄明の判定に要る）
  function sunAltitude(ms, obs) {
    const s = A.sunPosition(ms);
    const T = A.centuries(ms);
    const { dPsi, dEps } = A.nutation(T);
    const eps = A.meanObliquity(T) + dEps;
    const eq = A.toEquatorial(s.longitude, 0, eps);
    const gast = A.apparentSiderealTime(ms, dPsi, eps);
    const H = ((gast + obs.longitude - eq.ra) % 360 + 360) % 360;
    return A.toHorizontal(H, eq.dec, obs.latitude).altitude;
  }

  const SoramiMoon = {
    brightness, skyContrast, cloudTransmission, extinction, evaluateAt, sunAltitude,
  };
  global.SoramiMoon = SoramiMoon;
  if (typeof module !== "undefined" && module.exports) module.exports = SoramiMoon;
})(typeof globalThis !== "undefined" ? globalThis : window);
