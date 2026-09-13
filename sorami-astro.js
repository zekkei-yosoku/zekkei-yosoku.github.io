/*
 * Sorami — 天文と幾何の土台
 *
 * 月・富士山の可視予測のための計算層。**天気は一切扱わない。**
 *
 * なぜ sorami-core.js と別にするか:
 *   core の `Moon` は geocentric の簡易式（Schlyter 系）で、星空の月明かり計算が
 *   その出力に依存している（parity-test が Swift 版との一致を固定している）。
 *   月の可視予測の指示書 §4 は geocentric のみを明示的に禁止しているが、
 *   既存の出力を変えると 7 現象の点数が動く。**触らずに、別に足す。**
 *
 * 出典は Jean Meeus, *Astronomical Algorithms*, 2nd ed.（以下 AA）。
 * 章番号をコメントで示す。**根拠のない数値をここへ足さないこと。**
 */
(function (global) {
  "use strict";

  const DEG = Math.PI / 180;
  const sin = (d) => Math.sin(d * DEG);
  const cos = (d) => Math.cos(d * DEG);
  const tan = (d) => Math.tan(d * DEG);
  const norm = (d) => { const x = d % 360; return x < 0 ? x + 360 : x; };

  /// ユリウス日。AA 7.1
  const julianDay = (ms) => ms / 86400000 + 2440587.5;
  /// J2000.0 からのユリウス世紀
  const centuries = (ms) => (julianDay(ms) - 2451545) / 36525;

  // ------------------------------------------------------------------ 章立て
  // AA 22: 章動と黄道傾斜
  // AA 25: 太陽の位置
  // AA 47: 月の位置（ELP-2000/82 の切り詰め。経度 10"・距離 20km 程度）
  // AA 40: 視差（地心 → 地平座標の観測地補正）
  // AA 13: 赤道座標 → 地平座標
  // AA 16: 大気差
  // AA 48: 照らされている割合と bright limb

  /// 章動。主要項のみ（AA 22 の簡略版。精度 0.5" 程度で本用途には十分）
  function nutation(T) {
    const om = 125.04452 - 1934.136261 * T;
    const Ls = 280.4665 + 36000.7698 * T;
    const Lm = 218.3165 + 481267.8813 * T;
    return {
      dPsi: (-17.20 * sin(om) - 1.32 * sin(2 * Ls) - 0.23 * sin(2 * Lm) + 0.21 * sin(2 * om)) / 3600,
      dEps: (9.20 * cos(om) + 0.57 * cos(2 * Ls) + 0.10 * cos(2 * Lm) - 0.09 * cos(2 * om)) / 3600,
    };
  }

  /// 平均黄道傾斜。AA 22.2
  function meanObliquity(T) {
    const U = T / 100;
    return 23 + 26 / 60 + 21.448 / 3600
      + (-4680.93 * U - 1.55 * U ** 2 + 1999.25 * U ** 3 - 51.38 * U ** 4 - 249.67 * U ** 5
         - 39.05 * U ** 6 + 7.12 * U ** 7 + 27.87 * U ** 8 + 5.79 * U ** 9 + 2.45 * U ** 10) / 3600;
  }

  /// 太陽。AA 25（低精度式。0.01°）
  function sunPosition(ms) {
    const T = centuries(ms);
    const L0 = norm(280.46646 + 36000.76983 * T + 0.0003032 * T * T);
    const M = norm(357.52911 + 35999.05029 * T - 0.0001537 * T * T);
    const e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;
    const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * sin(M)
            + (0.019993 - 0.000101 * T) * sin(2 * M) + 0.000289 * sin(3 * M);
    const trueLon = L0 + C;
    const v = M + C;
    const R = 1.000001018 * (1 - e * e) / (1 + e * cos(v));   // AU
    const om = 125.04 - 1934.136 * T;
    const apparentLon = trueLon - 0.00569 - 0.00478 * sin(om);   // 光行差と章動
    return { longitude: norm(apparentLon), latitude: 0, distanceKm: R * 149597870.7, T };
  }

  // AA 表 47.A（D, M, M', F, Σl[1e-6 度], Σr[1e-3 km]）
  const TERMS_LR = [
    [0,0,1,0,6288774,-20905355],[2,0,-1,0,1274027,-3699111],[2,0,0,0,658314,-2955968],
    [0,0,2,0,213618,-569925],[0,1,0,0,-185116,48888],[0,0,0,2,-114332,-3149],
    [2,0,-2,0,58793,246158],[2,-1,-1,0,57066,-152138],[2,0,1,0,53322,-170733],
    [2,-1,0,0,45758,-204586],[0,1,-1,0,-40923,-129620],[1,0,0,0,-34720,108743],
    [0,1,1,0,-30383,104755],[2,0,0,-2,15327,10321],[0,0,1,2,-12528,0],
    [0,0,1,-2,10980,79661],[4,0,-1,0,10675,-34782],[0,0,3,0,10034,-23210],
    [4,0,-2,0,8548,-21636],[2,1,-1,0,-7888,24208],[2,1,0,0,-6766,30824],
    [1,0,-1,0,-5163,-8379],[1,1,0,0,4987,-16675],[2,-1,1,0,4036,-12831],
    [2,0,2,0,3994,-10445],[4,0,0,0,3861,-11650],[2,0,-3,0,3665,14403],
    [0,1,-2,0,-2689,-7003],[2,0,-1,2,-2602,0],[2,-1,-2,0,2390,10056],
    [1,0,1,0,-2348,6322],[2,-2,0,0,2236,-9884],[0,1,2,0,-2120,5751],
    [0,2,0,0,-2069,0],[2,-2,-1,0,2048,-4950],[2,0,1,-2,-1773,4130],
    [2,0,0,2,-1595,0],[4,-1,-1,0,1215,-3958],[0,0,2,2,-1110,0],
    [3,0,-1,0,-892,3258],[2,1,1,0,-810,2616],[4,-1,-2,0,759,-1897],
    [0,2,-1,0,-713,-2117],[2,2,-1,0,-700,2354],[2,1,-2,0,691,0],
    [2,-1,0,-2,596,0],[4,0,1,0,549,-1423],[0,0,4,0,537,-1117],
    [4,-1,0,0,520,-1571],[1,0,-2,0,-487,-1739],[2,1,0,-2,-399,0],
    [0,0,2,-2,-381,-4421],[1,1,1,0,351,0],[3,0,-2,0,-340,0],
    [4,0,-3,0,330,0],[2,-1,2,0,327,0],[0,2,1,0,-323,1165],
    [1,1,-1,0,299,0],[2,0,3,0,294,0],[2,0,-1,-2,0,8752],
  ];

  // AA 表 47.B（D, M, M', F, Σb[1e-6 度]）
  const TERMS_B = [
    [0,0,0,1,5128122],[0,0,1,1,280602],[0,0,1,-1,277693],[2,0,0,-1,173237],
    [2,0,-1,1,55413],[2,0,-1,-1,46271],[2,0,0,1,32573],[0,0,2,1,17198],
    [2,0,1,-1,9266],[0,0,2,-1,8822],[2,-1,0,-1,8216],[2,0,-2,-1,4324],
    [2,0,1,1,4200],[2,1,0,-1,-3359],[2,-1,-1,1,2463],[2,-1,0,1,2211],
    [2,-1,-1,-1,2065],[0,1,-1,-1,-1870],[4,0,-1,-1,1828],[0,1,0,1,-1794],
    [0,0,0,3,-1749],[0,1,-1,1,-1565],[1,0,0,1,-1491],[0,1,1,1,-1475],
    [0,1,1,-1,-1410],[0,1,0,-1,-1344],[1,0,0,-1,-1335],[0,0,3,1,1107],
    [4,0,0,-1,1021],[4,0,-1,1,833],[0,0,1,-3,777],[4,0,-2,1,671],
    [2,0,0,-3,607],[2,0,2,-1,596],[2,-1,1,-1,491],[2,0,-2,1,-451],
    [0,0,3,-1,439],[2,0,2,1,422],[2,0,-3,-1,421],[2,1,-1,1,-366],
    [2,1,0,1,-351],[4,0,0,1,331],[2,-1,1,1,315],[2,-2,0,-1,302],
    [0,0,1,3,-283],[2,1,1,-1,-229],[1,1,0,-1,223],[1,1,0,1,223],
    [0,1,-2,-1,-220],[2,1,-1,-1,-220],[1,0,1,1,-185],[2,-1,-2,-1,181],
    [0,1,2,1,-177],[4,0,-2,-1,176],[4,-1,-1,-1,166],[1,0,1,-1,-164],
    [4,0,1,-1,132],[1,0,-1,-1,-119],[4,-1,0,-1,115],[2,-2,0,1,107],
  ];

  /// 月の地心位置。AA 47
  function moonGeocentric(ms) {
    const T = centuries(ms);
    const Lp = norm(218.3164477 + 481267.88123421 * T - 0.0015786 * T ** 2
                    + T ** 3 / 538841 - T ** 4 / 65194000);
    const D = norm(297.8501921 + 445267.1114034 * T - 0.0018819 * T ** 2
                   + T ** 3 / 545868 - T ** 4 / 113065000);
    const M = norm(357.5291092 + 35999.0502909 * T - 0.0001536 * T ** 2 + T ** 3 / 24490000);
    const Mp = norm(134.9633964 + 477198.8675055 * T + 0.0087414 * T ** 2
                    + T ** 3 / 69699 - T ** 4 / 14712000);
    const F = norm(93.2720950 + 483202.0175233 * T - 0.0036539 * T ** 2
                   - T ** 3 / 3526000 + T ** 4 / 863310000);
    const A1 = norm(119.75 + 131.849 * T);
    const A2 = norm(53.09 + 479264.290 * T);
    const A3 = norm(313.45 + 481266.484 * T);
    // 地球軌道の離心率の変化。M を含む項に E^|M| を掛ける（AA 47 の注記）
    const E = 1 - 0.002516 * T - 0.0000074 * T * T;

    let sl = 0, sr = 0, sb = 0;
    for (const [d, m, mp, f, cl, cr] of TERMS_LR) {
      const e = m === 0 ? 1 : (Math.abs(m) === 1 ? E : E * E);
      const arg = d * D + m * M + mp * Mp + f * F;
      sl += cl * e * sin(arg);
      sr += cr * e * cos(arg);
    }
    for (const [d, m, mp, f, cb] of TERMS_B) {
      const e = m === 0 ? 1 : (Math.abs(m) === 1 ? E : E * E);
      sb += cb * e * sin(d * D + m * M + mp * Mp + f * F);
    }
    // 金星・木星と地球の扁平による付加項（AA 47）
    sl += 3958 * sin(A1) + 1962 * sin(Lp - F) + 318 * sin(A2);
    sb += -2235 * sin(Lp) + 382 * sin(A3) + 175 * sin(A1 - F) + 175 * sin(A1 + F)
        + 127 * sin(Lp - Mp) - 115 * sin(Lp + Mp);

    return {
      longitude: norm(Lp + sl / 1e6),
      latitude: sb / 1e6,
      distanceKm: 385000.56 + sr / 1000,
      T,
    };
  }

  /// 黄道座標 → 赤道座標。AA 13.3, 13.4
  function toEquatorial(lonDeg, latDeg, epsDeg) {
    const l = lonDeg * DEG, b = latDeg * DEG, e = epsDeg * DEG;
    const ra = Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
    const dec = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
    return { ra: norm(ra / DEG), dec: dec / DEG };
  }

  /// 見かけの恒星時（グリニッジ）。AA 12.4
  function apparentSiderealTime(ms, dPsi, epsDeg) {
    const jd = julianDay(ms), T = centuries(ms);
    const t0 = 280.46061837 + 360.98564736629 * (jd - 2451545)
             + 0.000387933 * T * T - T ** 3 / 38710000;
    return norm(t0 + dPsi * cos(epsDeg));
  }

  /// 観測地補正（視差）。AA 40.6
  /// 月は近いので、地心の位置をそのまま使うと地平線付近で1度近くずれる。
  function topocentric(raDeg, decDeg, distanceKm, latDeg, lonDeg, elevM, gastDeg) {
    const EARTH_EQ_KM = 6378.14, FLAT = 1 / 298.257;
    const u = Math.atan((1 - FLAT) * tan(latDeg));
    const rhoSin = (1 - FLAT) * Math.sin(u) + (elevM / 1000) / EARTH_EQ_KM * sin(latDeg);
    const rhoCos = Math.cos(u) + (elevM / 1000) / EARTH_EQ_KM * cos(latDeg);
    const sinPi = EARTH_EQ_KM / distanceKm;                 // 地平視差。AA 40.1
    const H = norm(gastDeg + lonDeg - raDeg);               // 地方時角
    const dRa = Math.atan2(-rhoCos * sinPi * sin(H), cos(decDeg) - rhoCos * sinPi * cos(H));
    const decT = Math.atan2((sin(decDeg) - rhoSin * sinPi) * Math.cos(dRa),
                            cos(decDeg) - rhoCos * sinPi * cos(H));
    // 時角は **引く**。H = θ + λ − α なので、α' = α + Δα なら H' = H − Δα。
    // ここを足し算にしていて、視差が月を「下げる」のではなく「上げて」いた
    // （2026-09-14、国立天文台の月出時刻と9分ずれて発覚）。
    return {
      ra: norm(raDeg + dRa / DEG),
      dec: decT / DEG,
      hourAngle: norm(H - dRa / DEG),
      horizontalParallax: Math.asin(sinPi) / DEG,
    };
  }

  /// 赤道座標 → 地平座標。AA 13.5, 13.6（方位は北から東回り）
  function toHorizontal(hourAngleDeg, decDeg, latDeg) {
    const H = hourAngleDeg * DEG, d = decDeg * DEG, p = latDeg * DEG;
    const alt = Math.asin(Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos(H));
    const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(p) - Math.tan(d) * Math.cos(p));
    return { altitude: alt / DEG, azimuth: norm(az / DEG + 180) };
  }

  /// 大気差（真高度 → 見かけ高度）。AA 16.4（Sæmundsson）
  /// **標準大気の値であって、実際の屈折ではない。** 指示書 §11 の要求により、
  /// 温度・気圧で補正できる形にし、屈折なしの値も返せるようにしてある。
  function refraction(trueAltDeg, { pressureHPa = 1010, temperatureC = 10 } = {}) {
    if (trueAltDeg < -2) return 0;
    const r = 1.02 / tan(trueAltDeg + 10.3 / (trueAltDeg + 5.11)) / 60;   // 度
    return r * (pressureHPa / 1010) * (283 / (273 + temperatureC));
  }

  const MOON_RADIUS_KM = 1737.4;
  /// 月の見かけ半径。距離で変わる（指示書 §6「見かけ半径は固定値にしない」）
  const moonAngularRadius = (distanceKm) => Math.asin(MOON_RADIUS_KM / distanceKm) / DEG;

  /**
   * 観測地から見た月。**topocentric**（指示書 §4-6）。
   * @param {number} ms   時刻（UNIXミリ秒）
   * @param {object} obs  { latitude, longitude, elevation }（elevation は m。既定 0）
   */
  function moon(ms, obs, air = {}) {
    const { latitude: lat, longitude: lon, elevation = 0 } = obs;
    const g = moonGeocentric(ms);
    const s = sunPosition(ms);
    const { dPsi, dEps } = nutation(g.T);
    const eps = meanObliquity(g.T) + dEps;

    const mEq = toEquatorial(g.longitude + dPsi, g.latitude, eps);
    const sEq = toEquatorial(s.longitude, 0, eps);
    const gast = apparentSiderealTime(ms, dPsi, eps);

    const topo = topocentric(mEq.ra, mEq.dec, g.distanceKm, lat, lon, elevation, gast);
    const hor = toHorizontal(topo.hourAngle, topo.dec, lat);
    const refr = refraction(hor.altitude, air);
    const semi = moonAngularRadius(g.distanceKm);

    // 位相角と照らされている割合。AA 48.2, 48.3
    const psi = Math.acos(Math.max(-1, Math.min(1,
      sin(sEq.dec) * sin(topo.dec) + cos(sEq.dec) * cos(topo.dec) * cos(sEq.ra - topo.ra)))) / DEG;
    const i = Math.atan2(s.distanceKm * sin(psi), g.distanceKm - s.distanceKm * cos(psi)) / DEG;
    const illuminated = (1 + cos(i)) / 2;

    // 明るい縁の位置角。AA 48.5（三日月で「どちら側が光っているか」）
    const chi = norm(Math.atan2(
      cos(sEq.dec) * sin(sEq.ra - topo.ra),
      sin(sEq.dec) * cos(topo.dec) - cos(sEq.dec) * sin(topo.dec) * cos(sEq.ra - topo.ra)) / DEG);
    // 天頂を基準にした角度（写真の構図で意味を持つのはこちら）
    const q = norm(Math.atan2(
      cos(lat) * sin(topo.hourAngle),
      sin(lat) * cos(topo.dec) - cos(lat) * sin(topo.dec) * cos(topo.hourAngle)) / DEG);

    return {
      // 位置
      azimuth: hor.azimuth,
      geometricAltitude: hor.altitude,          // 大気差なし（指示書 §12 の NoRefractionTime 用）
      apparentAltitude: hor.altitude + refr,    // 大気差あり
      refraction: refr,
      // 距離と大きさ
      distanceKm: g.distanceKm,
      angularRadius: semi,
      angularDiameter: semi * 2,
      horizontalParallax: topo.horizontalParallax,
      // 上端・下端（指示書 §6「点として扱わない」）
      upperLimbAltitude: hor.altitude + refr + semi,
      lowerLimbAltitude: hor.altitude + refr - semi,
      // 月相
      phaseAngle: i,
      illuminatedFraction: illuminated,
      brightLimbPositionAngle: chi,
      brightLimbZenithAngle: norm(chi - q),
      parallacticAngle: q,
      // 生の座標（構図計算で使う）
      rightAscension: topo.ra,
      declination: topo.dec,
      hourAngle: topo.hourAngle,
      eclipticLongitude: g.longitude,
      eclipticLatitude: g.latitude,
    };
  }

  // ------------------------------------------------------------------ 幾何
  const EARTH_R_KM = 6371.0088;
  /// 標準大気での屈折を含めた有効地球半径の係数。
  /// k=1 は屈折なし、7/6 が測量で使われる標準（指示書 §11・富士 §12）。
  const REFRACTION_K = 7 / 6;

  /**
   * 距離 d の地点にある高さ h の対象が、観測者から何度の高さに見えるか。
   * 地球の丸みと大気差を含む。**小角近似ではなく地心の式**を使う（100km 超で効く）。
   */
  function targetElevationAngle(distanceKm, observerHeightM, targetHeightM, { k = REFRACTION_K } = {}) {
    const R = EARTH_R_KM * k;
    const ro = R + observerHeightM / 1000;
    const rt = R + targetHeightM / 1000;
    const theta = distanceKm / R;                       // 地心角
    return Math.atan2(rt * Math.cos(theta) - ro, rt * Math.sin(theta)) / DEG;
  }

  /// 地平線までの距離。観測者の高さから
  function horizonDistanceKm(observerHeightM, { k = REFRACTION_K } = {}) {
    const R = EARTH_R_KM * k, h = observerHeightM / 1000;
    return R * Math.acos(R / (R + h));
  }

  /// 距離 d の地点が、観測者の水平面からどれだけ下がるか（丸みによる沈み込み）
  function curvatureDropM(distanceKm, { k = REFRACTION_K } = {}) {
    const R = EARTH_R_KM * k;
    return (R / Math.cos(distanceKm / R) - R) * 1000;
  }

  /**
   * **対象の山そのものを「遮る地形」から外す。**
   *
   * 山頂へ向かう視線は、当然その山の斜面の上を通る。近くから見るほど、
   * 山頂の少し手前の斜面のほうが「空では高い位置」に来る。素朴に判定すると
   * **富士山が富士山に隠される**（2026-09-14、山中湖から15kmで実際に起きた）。
   *
   * 対象の側から遡り、標高が単調に下がっている間は「その山の斜面」とみなして外す。
   *
   * **既定では使わない**（`excludeTargetSlope: true` を渡したときだけ）。
   * 富士山では火口で標高が窪むため、遡りが外輪の手前で止まってしまい、
   * 近い外輪が「遮蔽物」として残る。**それは事実としては正しい**
   * （剣ヶ峰そのものは北側の外輪に隠れうる）が、知りたいのは
   * 「富士山が見えるか」であって「剣ヶ峰の一点が見えるか」ではない。
   * 山体として扱う話は P1（Mountain Silhouette）で解く。ここでは点対象の
   * 判定を歪めないよう、既定を素通しにしてある。
   */
  function withoutTargetSlope(profile) {
    const p = [...profile].sort((a, b) => a.distanceKm - b.distanceKm);
    let i = p.length - 1;
    while (i > 0 && p[i - 1].elevationM <= p[i].elevationM) i--;
    return p.slice(0, i);
  }

  /**
   * 対象が地形に遮られていないかを見る。
   * @param {Array} profile [{ distanceKm, elevationM }] 観測者から対象へ向かう線上の標高
   * @returns {object} { blocked, byDistanceKm, marginDeg }
   */
  function terrainBlocks(profile, observerHeightM, targetDistanceKm, targetHeightM, opts = {}) {
    const target = targetElevationAngle(targetDistanceKm, observerHeightM, targetHeightM, opts);
    const use = opts.excludeTargetSlope ? withoutTargetSlope(profile) : profile;
    let worst = null;
    for (const p of use) {
      if (!(p.distanceKm > 0) || p.distanceKm >= targetDistanceKm) continue;
      const a = targetElevationAngle(p.distanceKm, observerHeightM, p.elevationM, opts);
      if (worst === null || a > worst.angle) worst = { angle: a, distanceKm: p.distanceKm };
    }
    if (!worst) return { blocked: false, byDistanceKm: null, marginDeg: null, targetAngleDeg: target };
    return {
      blocked: worst.angle >= target,
      byDistanceKm: worst.distanceKm,
      marginDeg: target - worst.angle,
      targetAngleDeg: target,
      horizonAngleDeg: worst.angle,
    };
  }

  // ------------------------------------------------------------- 出没イベント
  /**
   * 符号が変わる時刻を挟み撃ちで求める。
   * @param {function} f  時刻(ms) → 数値。0 を跨ぐところを探す
   */
  function findCrossing(f, t0, t1, { toleranceMs = 1000 } = {}) {
    let a = t0, b = t1, fa = f(a), fb = f(b);
    if (fa === 0) return a;
    if (fb === 0) return b;
    if (fa > 0 === fb > 0) return null;
    while (b - a > toleranceMs) {
      const m = (a + b) / 2, fm = f(m);
      if (fm === 0) return m;
      if (fa > 0 !== fm > 0) { b = m; fb = fm; } else { a = m; fa = fm; }
    }
    return (a + b) / 2;
  }

  /**
   * 指定した高さの基準を月が横切る時刻をすべて拾う。
   *
   * `horizonAt(azimuth)` を渡せば**地形の地平線**を基準にできる（指示書 §14）。
   * 月の方位は時間とともに変わるので、**固定の地平線高度を使わない**。
   *
   * @param {string} limb "upper" | "center" | "lower"
   */
  function moonCrossings(fromMs, toMs, obs, {
    limb = "upper", horizonAt = () => 0, stepMs = 300000, air = {},
  } = {}) {
    const key = limb === "upper" ? "upperLimbAltitude"
              : limb === "lower" ? "lowerLimbAltitude" : "apparentAltitude";
    const f = (t) => { const m = moon(t, obs, air); return m[key] - horizonAt(m.azimuth); };
    const events = [];
    let prev = f(fromMs);
    for (let t = fromMs + stepMs; t <= toMs; t += stepMs) {
      const cur = f(t);
      if (prev > 0 !== cur > 0) {
        const at = findCrossing(f, t - stepMs, t);
        if (at !== null) events.push({ at, kind: cur > prev ? "rise" : "set", limb });
      }
      prev = cur;
    }
    return events;
  }

  /**
   * 月出・月入の一式。**天文・地形・明るい縁を別のイベントとして返す**（指示書 §18）。
   *
   * 天文の月出は「平らで遮るもののない地平線」を前提にした基準時刻でしかない。
   * 実際に地形から出てくる時刻とは分単位で違うし、細い月では
   * 「円盤は出ているが光っている側はまだ山の裏」という状態がある（§8）。
   */
  function moonEvents(fromMs, toMs, obs, { horizonAt = null, air = {} } = {}) {
    const astronomical = moonCrossings(fromMs, toMs, obs, { limb: "upper", air });
    const out = {
      astronomical: astronomical.map((e) => ({ ...e, event: "astronomical" })),
      terrain: [],
      brightLimb: [],
    };
    if (!horizonAt) return out;

    for (const limb of ["upper", "center", "lower"]) {
      for (const e of moonCrossings(fromMs, toMs, obs, { limb, horizonAt, air })) {
        // 月出では 上端→中心→全体、月入では逆。名前を意味で付ける
        const name = e.kind === "rise"
          ? { upper: "firstLimb", center: "center", lower: "fullDisk" }[limb]
          : { lower: "start", center: "center", upper: "full" }[limb];
        out.terrain.push({ at: e.at, kind: e.kind, event: name });
      }
    }
    out.terrain.sort((a, b) => a.at - b.at);

    // 光っている縁が地形から出る時刻（§8, §17）。
    // 月の中心から見て、明るい側の縁がどれだけ上（＋）か下（−）かを高度へ直す。
    const brightEdge = (t) => {
      const m = moon(t, obs, air);
      const offset = m.angularRadius * cos(m.brightLimbZenithAngle);   // 天頂向きの成分
      return (m.apparentAltitude + offset) - horizonAt(m.azimuth);
    };
    let prev = brightEdge(fromMs);
    for (let t = fromMs + 300000; t <= toMs; t += 300000) {
      const cur = brightEdge(t);
      if (prev > 0 !== cur > 0) {
        const at = findCrossing(brightEdge, t - 300000, t);
        if (at !== null) out.brightLimb.push({ at, kind: cur > prev ? "rise" : "set", event: "brightLimb" });
      }
      prev = cur;
    }
    return out;
  }

  const SoramiAstro = {
    // 天文
    julianDay, centuries, nutation, meanObliquity,
    sunPosition, moonGeocentric, moon,
    toEquatorial, toHorizontal, topocentric, apparentSiderealTime,
    refraction, moonAngularRadius,
    findCrossing, moonCrossings, moonEvents,
    // 幾何
    EARTH_R_KM, REFRACTION_K,
    targetElevationAngle, horizonDistanceKm, curvatureDropM, terrainBlocks, withoutTargetSlope,
  };

  global.SoramiAstro = SoramiAstro;
  if (typeof module !== "undefined" && module.exports) module.exports = SoramiAstro;
})(typeof globalThis !== "undefined" ? globalThis : window);
