/*
 * Sorami Web — ロジック層
 *
 * Swift 版 SoramiCore（テスト108件で検証済み）からの移植。数式・閾値・文言を揃えてあり、
 * parity-test.mjs が Swift 側の出力（parity-expected.json）と突き合わせて一致を検証する。
 * 閾値には出典があり、根拠のない数値をここへ足さないこと（Thresholds のコメント参照）。
 */
(function (global) {
  "use strict";

  // 暦は【見ている地点の時差】で動かす。
  //
  // 日本固定にしていたが、地点検索は OpenStreetMap で世界中を引ける。
  // 海外を選ぶと「今日／明日」の区切りが日本時間のままずれた。
  // Open-Meteo は timezone=auto を付けているので、その地点の時差を
  // utc_offset_seconds で返してくる。使っていなかっただけ。
  //
  // 既定は +9時間。地点の時差が分かるまで（＝最初の取得が終わるまで）は日本として扱う。
  let tzOffset = 9 * 3600 * 1000;
  function setTimezoneOffset(seconds) {
    if (typeof seconds === "number" && Number.isFinite(seconds)) tzOffset = seconds * 1000;
  }
  const DEG = Math.PI / 180;

  // ---------------------------------------------------------------- Geo
  const Geo = {
    earthRadiusKm: 6371.0088,
    normalizeDegrees(d) { const x = d % 360; return x < 0 ? x + 360 : x; },
    normalizeLongitude(lon) { let l = lon % 360; if (l > 180) l -= 360; if (l < -180) l += 360; return l; },
    destination(lat, lon, bearingDeg, distanceKm) {
      const ang = distanceKm / Geo.earthRadiusKm, b = bearingDeg * DEG;
      const p1 = lat * DEG, l1 = lon * DEG;
      const p2 = Math.asin(Math.sin(p1) * Math.cos(ang) + Math.cos(p1) * Math.sin(ang) * Math.cos(b));
      const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(ang) * Math.cos(p1),
                                 Math.cos(ang) - Math.sin(p1) * Math.sin(p2));
      return { latitude: p2 / DEG, longitude: Geo.normalizeLongitude(l2 / DEG) };
    },
    distanceKm(aLat, aLon, bLat, bLon) {
      const p1 = aLat * DEG, p2 = bLat * DEG;
      const dp = p2 - p1, dl = (bLon - aLon) * DEG;
      const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
      return 2 * Geo.earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(h)));
    },
  };

  // ---------------------------------------------------------------- JST 暦
  // JST は夏時間が無いので固定 +9h で暦日計算ができる。
  const Cal = {
    startOfDay(ms) { return Math.floor((ms + tzOffset) / 86400000) * 86400000 - tzOffset; },
    addDays(ms, n) { return ms + n * 86400000; },
    setHour(dayStartMs, hour) { return dayStartMs + hour * 3600000; },
    sameDay(a, b) { return Cal.startOfDay(a) === Cal.startOfDay(b); },
    hhmm(ms) {
      const d = new Date(ms + tzOffset);
      return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
    },
    // 表示は分に四捨五入。切り捨てると暦の表記と1分ずれる。
    hhmmRounded(ms) { return Cal.hhmm(Math.round(ms / 60000) * 60000); },
    // mm/dd。1桁の月日も0を付けて桁を揃える（ユーザーの指定）。
    // 桁が揃うと、14日ぶんを縦横に並べたとき数字の位置がぶれない。
    monthDay(ms) {
      const d = new Date(ms + tzOffset);
      return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
    },
    weekday(ms) { return "日月火水木金土"[new Date(ms + tzOffset).getUTCDay()]; },
    relativeDay(ms, nowMs) {
      const target = Cal.startOfDay(ms), today = Cal.startOfDay(nowMs);
      if (target === today) return "今日";
      if (target === today + 86400000) return "明日";
      return `${Cal.monthDay(ms)}(${Cal.weekday(ms)})`;
    },
  };

  // ---------------------------------------------------------------- 太陽（NOAA/Meeus）
  const Sun = {
    julianDay(ms) { return ms / 86400000 + 2440587.5; },
    fromJulianDay(jd) { return (jd - 2440587.5) * 86400000; },
    julianCentury(jd) { return (jd - 2451545.0) / 36525; },
    apparentLongitude(t) {
      const l0 = Geo.normalizeDegrees(280.46646 + t * (36000.76983 + t * 0.0003032));
      const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
      const mr = m * DEG;
      const c = Math.sin(mr) * (1.914602 - t * (0.004817 + 0.000014 * t))
              + Math.sin(2 * mr) * (0.019993 - 0.000101 * t)
              + Math.sin(3 * mr) * 0.000289;
      return l0 + c - 0.00569 - 0.00478 * Math.sin((125.04 - 1934.136 * t) * DEG);
    },
    obliquityCorrected(t) {
      const seconds = 21.448 - t * (46.815 + t * (0.00059 - t * 0.001813));
      const mean = 23 + (26 + seconds / 60) / 60;
      return mean + 0.00256 * Math.cos((125.04 - 1934.136 * t) * DEG);
    },
    declination(t) {
      const lambda = Sun.apparentLongitude(t) * DEG;
      const eps = Sun.obliquityCorrected(t) * DEG;
      return Math.asin(Math.sin(eps) * Math.sin(lambda)) / DEG;
    },
    equationOfTime(t) {
      const eps = Sun.obliquityCorrected(t) * DEG;
      const l0 = Geo.normalizeDegrees(280.46646 + t * (36000.76983 + t * 0.0003032)) * DEG;
      const m = (357.52911 + t * (35999.05029 - 0.0001537 * t)) * DEG;
      const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
      const y = Math.tan(eps / 2) ** 2;
      const v = y * Math.sin(2 * l0) - 2 * e * Math.sin(m)
              + 4 * e * y * Math.sin(m) * Math.cos(2 * l0)
              - 0.5 * y * y * Math.sin(4 * l0) - 1.25 * e * e * Math.sin(2 * m);
      return v * 4 / DEG;
    },
    refraction(elevation) {
      if (elevation > 85) return 0;
      const te = Math.tan(elevation * DEG);
      let arcsec;
      if (elevation > 5) arcsec = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
      else if (elevation > -0.575)
        arcsec = 1735 + elevation * (-518.2 + elevation * (103.4 + elevation * (-12.79 + elevation * 0.711)));
      else arcsec = -20.772 / te;
      return arcsec / 3600;
    },
    position(ms, lat, lon) {
      const jd = Sun.julianDay(ms), t = Sun.julianCentury(jd);
      const decl = Sun.declination(t), eqTime = Sun.equationOfTime(t);
      const minutesUTC = (jd - Math.floor(jd - 0.5) - 0.5) * 1440;
      let tst = (minutesUTC + eqTime + 4 * lon) % 1440;
      if (tst < 0) tst += 1440;
      let ha = tst / 4 - 180;
      if (ha < -180) ha += 360;
      const latR = lat * DEG, declR = decl * DEG, haR = ha * DEG;
      const cosZen = Math.min(1, Math.max(-1,
        Math.sin(latR) * Math.sin(declR) + Math.cos(latR) * Math.cos(declR) * Math.cos(haR)));
      const zenith = Math.acos(cosZen) / DEG;
      const rawElevation = 90 - zenith;
      let azimuth;
      const sinZen = Math.sin(zenith * DEG);
      if (Math.abs(sinZen) < 1e-9 || Math.abs(Math.cos(latR)) < 1e-9) {
        azimuth = ha > 0 ? 180 : 0;
      } else {
        const cosAz = Math.min(1, Math.max(-1, (Math.sin(latR) * cosZen - Math.sin(declR)) / (Math.cos(latR) * sinZen)));
        const a = Math.acos(cosAz) / DEG;
        azimuth = ha > 0 ? Geo.normalizeDegrees(a + 180) : Geo.normalizeDegrees(540 - a);
      }
      return { elevation: rawElevation + Sun.refraction(rawElevation), azimuth, declination: decl };
    },
    EVENTS: {
      sunrise: { zenith: 90.833, morning: true }, sunset: { zenith: 90.833, morning: false },
      civilDawn: { zenith: 96, morning: true }, civilDusk: { zenith: 96, morning: false },
      nauticalDawn: { zenith: 102, morning: true }, nauticalDusk: { zenith: 102, morning: false },
      astronomicalDawn: { zenith: 108, morning: true }, astronomicalDusk: { zenith: 108, morning: false },
      // 写真の光。天頂角 = 90 − 太陽高度。
      //   ゴールデンアワー … 高度 −4°〜+6°（天頂角 94〜84）
      //   ブルーアワー     … 高度 −6°〜−4°（天頂角 96〜94。96 は市民薄明と同じ）
      goldenDawn: { zenith: 84, morning: true }, goldenDusk: { zenith: 84, morning: false },
      lowSunDawn: { zenith: 94, morning: true }, lowSunDusk: { zenith: 94, morning: false },
    },

    /// その日の光の時間帯。極夜・白夜では太陽がその高度に届かず null になる。
    lightWindows(dayMs, lat, lon) {
      const at = (name) => Sun.eventTime(name, dayMs, lat, lon);
      const pair = (a, b) => { const x = at(a), y = at(b); return x !== null && y !== null ? [x, y] : null; };
      return {
        sunrise: at("sunrise"), sunset: at("sunset"),
        goldenMorning: pair("lowSunDawn", "goldenDawn"),
        goldenEvening: pair("goldenDusk", "lowSunDusk"),
        blueMorning: pair("civilDawn", "lowSunDawn"),
        blueEvening: pair("lowSunDusk", "civilDusk"),
      };
    },
    hourAngle(zenith, lat, decl) {
      const cosH = (Math.cos(zenith * DEG) - Math.sin(lat * DEG) * Math.sin(decl * DEG))
                 / (Math.cos(lat * DEG) * Math.cos(decl * DEG));
      if (cosH < -1 || cosH > 1) return null;
      return Math.acos(cosH) / DEG;
    },
    // 基準 0h UTC は対象ローカル暦日から 1 度だけ決めて固定する。
    // 反復のたびに取り直すと JST では基準日が 1 日ずつ後退する（Swift 版で実際に踏んだバグ）。
    eventTime(eventName, dayMs, lat, lon) {
      const spec = Sun.EVENTS[eventName];
      const noonLocal = Cal.setHour(Cal.startOfDay(dayMs), 12);
      const anchor = Math.floor(Sun.julianDay(noonLocal) - 0.5) + 0.5;
      let guess = noonLocal;
      for (let i = 0; i < 3; i++) {
        const t = Sun.julianCentury(Sun.julianDay(guess));
        const ha = Sun.hourAngle(spec.zenith, lat, Sun.declination(t));
        if (ha === null) return null;
        const eqTime = Sun.equationOfTime(t);
        const offsetMinutes = 720 - 4 * (lon + (spec.morning ? ha : -ha)) - eqTime;
        guess = Sun.fromJulianDay(anchor + offsetMinutes / 1440);
      }
      return guess;
    },
  };

  // ---------------------------------------------------------------- 月（Schlyter）
  const Moon = {
    state(ms, lat, lon) {
      const d = Sun.julianDay(ms) - 2451543.5;
      const rad = DEG;
      const wSun = 282.9404 + 4.70935e-5 * d;
      const eSun = 0.016709 - 1.151e-9 * d;
      const mSun = Geo.normalizeDegrees(356.0470 + 0.9856002585 * d);
      const eAnomS = mSun + eSun / rad * Math.sin(mSun * rad) * (1 + eSun * Math.cos(mSun * rad));
      const xvS = Math.cos(eAnomS * rad) - eSun;
      const yvS = Math.sqrt(1 - eSun * eSun) * Math.sin(eAnomS * rad);
      const vS = Math.atan2(yvS, xvS) / rad;
      const lonSun = Geo.normalizeDegrees(vS + wSun);
      const lSun = Geo.normalizeDegrees(mSun + wSun);

      const nM = 125.1228 - 0.0529538083 * d;
      const iM = 5.1454;
      const wM = 318.0634 + 0.1643573223 * d;
      const aM = 60.2666, eM = 0.054900;
      const mM = Geo.normalizeDegrees(115.3654 + 13.0649929509 * d);
      let eA = mM + eM / rad * Math.sin(mM * rad) * (1 + eM * Math.cos(mM * rad));
      eA -= (eA - eM / rad * Math.sin(eA * rad) - mM) / (1 - eM * Math.cos(eA * rad));
      const x = aM * (Math.cos(eA * rad) - eM);
      const y = aM * Math.sqrt(1 - eM * eM) * Math.sin(eA * rad);
      const v = Math.atan2(y, x) / rad;
      let r = Math.sqrt(x * x + y * y);
      const vw = (v + wM) * rad, nR = nM * rad, iR = iM * rad;
      const xe = r * (Math.cos(nR) * Math.cos(vw) - Math.sin(nR) * Math.sin(vw) * Math.cos(iR));
      const ye = r * (Math.sin(nR) * Math.cos(vw) + Math.cos(nR) * Math.sin(vw) * Math.cos(iR));
      const ze = r * Math.sin(vw) * Math.sin(iR);
      let mlon = Math.atan2(ye, xe) / rad;
      let mlat = Math.atan2(ze, Math.sqrt(xe * xe + ye * ye)) / rad;

      const lM = Geo.normalizeDegrees(mM + wM + nM);
      const D = lM - lSun, F = lM - nM;
      mlon += -1.274 * Math.sin((mM - 2 * D) * rad) + 0.658 * Math.sin(2 * D * rad)
            - 0.186 * Math.sin(mSun * rad) - 0.059 * Math.sin((2 * mM - 2 * D) * rad)
            - 0.057 * Math.sin((mM - 2 * D + mSun) * rad) + 0.053 * Math.sin((mM + 2 * D) * rad)
            + 0.046 * Math.sin((2 * D - mSun) * rad) + 0.041 * Math.sin((mM - mSun) * rad)
            - 0.035 * Math.sin(D * rad) - 0.031 * Math.sin((mM + mSun) * rad)
            - 0.015 * Math.sin((2 * F - 2 * D) * rad) + 0.011 * Math.sin((mM - 4 * D) * rad);
      mlat += -0.173 * Math.sin((F - 2 * D) * rad) - 0.055 * Math.sin((mM - F - 2 * D) * rad)
            - 0.046 * Math.sin((mM + F - 2 * D) * rad) + 0.033 * Math.sin((F + 2 * D) * rad)
            + 0.017 * Math.sin((2 * mM + F) * rad);
      r += -0.58 * Math.cos((mM - 2 * D) * rad) - 0.46 * Math.cos(2 * D * rad);
      mlon = Geo.normalizeDegrees(mlon);

      const obl = (23.4393 - 3.563e-7 * d) * rad;
      const xh = r * Math.cos(mlon * rad) * Math.cos(mlat * rad);
      const yh = r * Math.sin(mlon * rad) * Math.cos(mlat * rad);
      const zh = r * Math.sin(mlat * rad);
      const xEq = xh, yEq = yh * Math.cos(obl) - zh * Math.sin(obl), zEq = yh * Math.sin(obl) + zh * Math.cos(obl);
      const ra = Geo.normalizeDegrees(Math.atan2(yEq, xEq) / rad);
      const dec = Math.atan2(zEq, Math.sqrt(xEq * xEq + yEq * yEq)) / rad;

      const gmst0 = Geo.normalizeDegrees(lSun + 180);
      const utHours = (d - Math.floor(d)) * 24;
      const lst = Geo.normalizeDegrees(gmst0 + utHours * 15 + lon);
      const haR = (lst - ra) * rad;
      const latR = lat * rad, decR = dec * rad;
      const cx = Math.cos(haR) * Math.cos(decR), cy = Math.sin(haR) * Math.cos(decR), cz = Math.sin(decR);
      const xHor = cx * Math.sin(latR) - cz * Math.cos(latR);
      const yHor = cy;
      const zHor = cx * Math.cos(latR) + cz * Math.sin(latR);
      const elevation = Math.asin(Math.min(1, Math.max(-1, zHor))) / rad;
      const azimuth = Geo.normalizeDegrees(Math.atan2(yHor, xHor) / rad + 180);
      const elong = Math.acos(Math.min(1, Math.max(-1, Math.cos((lonSun - mlon) * rad) * Math.cos(mlat * rad)))) / rad;
      const phaseAngle = 180 - elong;
      const illuminated = (1 + Math.cos(phaseAngle * rad)) / 2;
      const age = Geo.normalizeDegrees(mlon - lonSun) / 360 * 29.530588;
      return {
        elevation, azimuth, illuminatedFraction: illuminated, age,
        skyBrightnessFactor: elevation > 0 ? illuminated * Math.sin(elevation * rad) : 0,
      };
    },
    peakBrightness(startMs, endMs, lat, lon, stepMs = 600000) {
      let peak = 0;
      for (let t = startMs; t <= endMs; t += stepMs) {
        peak = Math.max(peak, Moon.state(t, lat, lon).skyBrightnessFactor);
      }
      return peak;
    },
  };

  // ---------------------------------------------------------------- スコア曲線
  const Curve = {
    triangular(v, low, peak, high) {
      if (v <= low || v >= high) return 0;
      return v < peak ? (v - low) / (peak - low) : (high - v) / (high - peak);
    },
    ramp(v, from, to) {
      if (from === to) return v >= from ? 1 : 0;
      return Math.min(1, Math.max(0, (v - from) / (to - from)));
    },
    band(v, lo, hi, tolerance) {
      if (v >= lo && v <= hi) return 1;
      const distance = v < lo ? lo - v : v - hi;
      return Math.max(0, 1 - distance / tolerance);
    },
    clamp(v, lo = 0, hi = 100) { return Math.min(hi, Math.max(lo, v)); },
    median(values) {
      if (!values.length) return null;
      const s = [...values].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
    },
  };

  // ---------------------------------------------------------------- 閾値（出典付き。Swift 版 Thresholds と同値）
  const T = {
    sunset: {
      base: 50,
      highCloudLow: 10, highCloudPeak: 45, highCloudHigh: 85, highCloudBonus: 25,
      midCloudLow: 5, midCloudPeak: 30, midCloudHigh: 70, midCloudBonus: 10,
      canvasVividMinimum: 20, canvasPresentMinimum: 8, noVividCeiling: 78, clearSkyCeiling: 62,
      midCloudCanvasWeight: 0.7,
      highCloudOvercastStart: 85, highCloudOvercastPenalty: 12,
      lowCloudClear: 20, lowCloudBonus: 10, lowCloudPenaltyStart: 40, lowCloudPenaltyFull: 85, lowCloudPenalty: 30,
      sunwardLowPenaltyStart: 40, sunwardLowPenaltyFull: 80, sunwardLowPenalty: 35, sunwardHighBonus: 10,
      overcastRH: 90, upperRH: [50, 70], midRH: [60, 80], lowerRH: [80, 90], rhTolerance: 25,
      upperRHBonus: 8, midRHBonus: 8, lowerRHBonus: 5, overcastRHPenalty: 10,
      obscuredStart: 40, obscuredFull: 90,
      precipThreshold: 0.1, precipFull: 2.0, precipPenalty: 40, precipCeiling: 30,
      visGood: 20000, visPoor: 10000, visBonus: 5, visPenalty: 10,

      // エアロゾルとオゾン。夕焼けの色はレイリー散乱・オゾン吸収・エアロゾル消散で決まる。
      // JAMC 2026 の観測研究は、最も価値のある class 1（焼け雲）が
      // 「高い視程・低いエアロゾル光学的厚さ・低い対流性降水・低い全雲量」と
      // 密接に関連すると報告している。空気が濁っていると光が減衰し、色が乗らない。
      // 配点（±10 / ±6）は本アプリの見立てで、論文が示すのは向きと関連の強さまで。
      aodClean: 0.15, aodHazy: 0.60, aodBonus: 10, aodPenalty: 10,
      // 黄砂は強く濁らせる。
      dustHeavy: 20, dustPenalty: 8,
      // オゾンは薄明の青〜紫に効く（チャップイス吸収帯）が、地上付近の濃度から
      // 成層圏の光路を推し量ることはできず、実データでも常に満点になって
      // 情報にならなかったため採用しない。全量オゾン（total column ozone）が
      // 取れるようになれば再検討する。

      windowBefore: 20 * 60000, windowAfter: 15 * 60000,
      source: "SunsetWx特許 US10459119 と、薄明の色の観測研究（JAMC 2026）に基づく",
    },
    starry: {
      base: 100, cloudPenalty: 60, precipThreshold: 0.1, precipPenalty: 40,
      moonlightPenalty: 25, humidityStart: 85, visPoor: 15000, atmospherePenalty: 10,
      elevStart: 1000, elevFull: 2500, elevBonus: 5,
      // 夜通しの平均で採点していたが、それでは
      // 「前半は快晴・後半は曇り」と「一晩じゅう半分曇り」が同じ点数になる。
      // 星を見るのに一晩ずっと晴れている必要はない。まとまった時間があればいい。
      // 夜のうち最も条件の良い連続 3 時間を探し、その時間帯で採点する。
      // 3 時間は「見に行くだけの価値がある最短のまとまり」としての設定で、
      // 文献値ではない。短くすると雲の切れ間を拾いすぎ、
      // 長くすると短夜（夏至前後）や薄明の長い高緯度で窓が取れなくなる。
      windowHours: 3,
      // 雲と月を単純に足していたため、全天曇りでも月が無ければ 100-60=40点、
      // ランクでいう「そこそこ」が付いていた。雲に覆われていれば月の有無に関係なく
      // 星は見えない。虹で日光を上限として効かせたのと同じ形にする（第34節）。
      //
      // 全天が塞がるまでは切らない。5〜7割の雲なら晴れ間から見える。
      // 8割から効かせ、10割で 3点。8割という区切りは、
      // 航空気象の OVC（全天を覆う）が 8/8 であることに合わせた。
      overcastFrom: 80, overcastCeiling: 3,
      // 光害。天頂の空の明るさ mpsas（等級/平方秒）で減点する。
      // 22.0 が自然の空、都心は 17 前後（対数尺度で約100倍明るい）。
      // 減点幅 45 は本アプリの見立て（文献値ではない）。都心では晴れて無月でも
      // 「平凡」止まりになる設計で、それが実際の星の見え方に近い。
      lpPristine: 21.9, lpWorst: 17.0, lpMaxPenalty: 45,
      source: "雲量・降水・月明かり（輝面比×高度）・視程・光害（Lorenz光害アトラス2025）から算出",
    },
    seaOfClouds: {
      rangeThreshold: 10.2, rangeFull: 16,
      // windCalm 0.85 は宙畑・秩父の決定木の第2分岐。ただしこれは
      // 【秩父アメダス＝盆地底の観測値】で、アプリが読むのは
      // 展望台（尾根）の予測値。同じ量ではない。
      // 2025年11月の竹田城跡で 0.85 を下回った日は 30日中 0日（実測）。
      // 30点ぶんの加点が事実上死んでいる。谷が静穏かどうかは、
      // 逆転層の有無のほうが直接の証拠になる（aboveBonus）。
      windCalm: 0.85, windFail: 2.5,
      prevRainMm: 0.5, humidityThreshold: 90, nightCloudClear: 30, nightCloudFail: 80,
      minElevation: 250,
    // 展望台が雲頂よりこれだけ高ければ「見下ろせる」。
    // 面の間隔が 230m ほどあるので、余裕を持たせる。
    aboveMargin: 100,
    // 逆転とみなす気温の上がり幅[K]。数値の揺らぎを拾わない程度に。
    inversionMinK: 0.3,
    // これより上の逆転は雲海の天井ではない（境界層の外）。
    inversionMaxHeight: 2500,
    // 逆転層が展望台より下にあることは、雲海の直接の証拠。
    // 谷が静穏で安定していなければ逆転層はできないので、
    // 実質死んでいる風の条件（下記）を物理的に肩代わりする。
    aboveBonus: 25,
    // 見下ろせないときの上限。雲海の中に立つなら、条件が揃っていても見られない。
    insideCeiling: 20, aboveCeilingFull: 100,
 base: 10, rangeBonus: 35, windBonus: 30,
      humidityBonus: 12, prevRainBonus: 8, nightCloudBonus: 15,
      source: "宙畑・秩父の決定木（気温差>10.2℃ かつ 風速<0.85m/s）に基づく経験則。地形依存が大きい",
    },
    diamondDust: {
      extremeCold: -15, extremeProb: 0.84, coldHumidTemp: -10, coldHumidHumidity: 90, coldHumidProb: 0.17,
      clearSkyCloud: 20, calmWind: 2, windowStart: 6, windowEnd: 9, clearBonus: 8, calmBonus: 7,
      source: "北海道立総合研究機構・旭川2シーズン観測（最低気温≤−15℃で発生確率84%、16/19日）",
    },
    rime: {
      tempThreshold: -5, tempFull: -12, windLo: 1, windHi: 5, windTolerance: 4,
      saturation: 95, humidityFloor: 85, minElevation: 500,
      base: 5, tempBonus: 35, windBonus: 25, humidityBonus: 30, durationFull: 8, durationBonus: 10,
      source: "気温≤−5℃・風速1〜5m/s・過冷却水滴（湿度≥95%で代替）。蔵王の樹氷研究に基づく",
    },
    rainbow: {
      maxSunElev: 42, optSunElev: 15, minSunElev: 0, precipThreshold: 0.1,
      base: 20, sunBonus: 25, precipBonus: 30, sunlightBonus: 25,
      // 直射日光の判定: 晴天時の直達日射の目安 900×sin(太陽高度) W/m² に対する比で見る。
      // 厳密な大気透過モデルではなく目安（比 5% で 0、35% 以上で満点となる傾斜）。
      // 雨の1時間平均に直達が残っている＝セルの合間に日が差す（にわか雨型）ことの代理。
      clearSkyDirectMax: 900, sunlightFitLo: 0.05, sunlightFitHi: 0.35,
    // 直射日光の絶対量。快晴時比だけで見ていたため、太陽高度 1°（快晴でも
    // 15W/m² 程度）のときに 12W/m² で満点が付いていた。
    // 日没間際の「赤い虹」は実在するので一律に切らず、量に応じて弱める。
    directLo: 10, directHi: 100,
    // 日が差していなければ虹は出ない。0W/m² で 75点「良好」が出ていた。
    noSunDirect: 3, noSunCeiling: 25,
    // 日射を返さないモデルがある（気象庁GSMは全時刻、MSM・英国気象局・ARPEGE は一部）。
    // その時間は必須条件を確かめられないので、良い方へは丸めない。
    unverifiedSunCeiling: 50,
      source: "太陽高度≤42°・降水・直射日光から推定。雨域が対日点の方角にあるかはモデル解像度では解けないため参考値",
    },
  };

  // ---------------------------------------------------------------- 時系列
  // 欠測は null のまま運ぶ。0 に丸めると「視程 0km＝濃霧」のような正反対の意味になる。
  class Series {
    constructor(times, columns) { this.times = times; this.columns = columns; }
    get stepMs() { return this.times.length >= 2 ? this.times[1] - this.times[0] : 3600000; }
    isSupported(v) { const c = this.columns[v]; return !!c && c.some((x) => x !== null && x !== undefined); }
    valueAtIndex(v, i) {
      const c = this.columns[v];
      if (!c || i < 0 || i >= c.length) return null;
      const x = c[i];
      return x === undefined ? null : x;
    }
    indexNearest(ms) {
      if (!this.times.length) return null;
      let best = 0, bestDelta = Infinity;
      this.times.forEach((t, i) => { const d = Math.abs(t - ms); if (d < bestDelta) { bestDelta = d; best = i; } });
      return bestDelta <= 1800000 ? best : null;
    }
    valueAt(v, ms) { const i = this.indexNearest(ms); return i === null ? null : this.valueAtIndex(v, i); }
    // 時別値は「その1時間を代表する値」。バケット [t, t+step) と窓の重なりで選ぶ。
    // 点包含にすると、日の入り前後 20 分のような正時をまたがない窓が 1 件も拾えない。
    indices(startMs, endMs) {
      const step = this.stepMs, out = [];
      this.times.forEach((t, i) => { if (t < endMs && t + step > startMs) out.push(i); });
      return out;
    }
    values(v, s, e) { return this.indices(s, e).map((i) => this.valueAtIndex(v, i)).filter((x) => x !== null); }
    mean(v, s, e) { const a = this.values(v, s, e); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }
    max(v, s, e) { const a = this.values(v, s, e); return a.length ? Math.max(...a) : null; }
    min(v, s, e) { const a = this.values(v, s, e); return a.length ? Math.min(...a) : null; }
    sum(v, s, e) { const a = this.values(v, s, e); return a.length ? a.reduce((x, y) => x + y, 0) : null; }
  }

  // 用語の使い分け:
  //   予報 … 気象庁・ECMWF などが出しているもの。このアプリが材料にする
  //   予測 … このアプリが独自に点数を付けたもの
  // 画面では区別して書く。混ぜると、誰が何を言っているのか分からなくなる。
  //
  // 数値予報モデル。中央値を採る設計なので、独立性の高いモデルが増えるほど
  // 外れ値に引きずられにくくなる。2026-08-22 の東京の大雨では jma_msm が
  // 降水 0.0mm、icon が 3.1mm と割れた（単独モデルは実際に外す）。
  const MODELS = [
    "jma_msm",                 // 気象庁 MSM（日本域 5km）
    "jma_gsm",                 // 気象庁 GSM（全球）
    "icon_seamless",           // DWD ICON
    "ecmwf_ifs025",            // ECMWF IFS
    "ecmwf_aifs025_single",    // ECMWF AIFS（機械学習ベース。従来手法と系統誤差が異なる）
    "gfs_seamless",            // NOAA GFS
    "ukmo_global_deterministic_10km", // 英国気象局
    "meteofrance_arpege_world",// フランス ARPEGE
    // カナダ GEM は採用しない。verify.mjs による検証（10地点30日・270標本）で
    // 上層の雲が MAE 46.07・偏り −45.9 と突出して外れていた。診断したところ
    // 上層雲が平均 4.2%・最大 38% しか出ておらず（他モデルは最大100%）、
    // 変数の定義かスケールが他と異なる。夕焼けで最重要の要素なので中央値を汚す。
  ];
  const MODEL_NAMES = {
    jma_msm: "気象庁MSM", jma_gsm: "気象庁GSM", icon_seamless: "ICON",
    ecmwf_ifs025: "ECMWF", ecmwf_aifs025_single: "ECMWF AI", gfs_seamless: "GFS",
    ukmo_global_deterministic_10km: "英国気象局", meteofrance_arpege_world: "ARPEGE",
  };
  const HOME_VARS = [
    "temperature_2m", "relative_humidity_2m", "dew_point_2m", "precipitation", "weather_code",
    "cloud_cover", "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high", "visibility",
    "wind_speed_10m", "surface_pressure", "direct_radiation", "showers",
    "relative_humidity_925hPa", "relative_humidity_850hPa", "relative_humidity_700hPa",
    "relative_humidity_500hPa", "relative_humidity_300hPa", "relative_humidity_200hPa",
  ];
  const OFFSET_VARS = ["cloud_cover_low", "cloud_cover_mid", "cloud_cover_high", "precipitation"];

  // 雲海のための鉛直分布。
  //
  // 雲海が見えるには3つ要る（三菱自動車「雲海の仕組み」）:
  //   1. 低いところで霧ができる
  //   2. 逆転層が天井になって雲頂高度が決まる
  //   3. 観察者がその雲頂より高い位置にいる
  // これまで 3 をまったく見ておらず、標高 250m 以上という粗い代理で済ませていた。
  // 点数が高くても現地では霧の中に立っている、ということが起こり得た。
  //
  // 気圧面の湿度と高度から、飽和している層の上端＝雲頂高度を読む。
  // エマグラムで逆転層の高さを読む手順を、数値でやっているのと同じ。
  //
  // 気象庁MSM・ICON・GFS は 975/950/900hPa（≈300/530/1010m）も返す。
  // ECMWF は 1000/925/850 だけなので、そのモデルでは粗い推定になる（実測確認済み）。
  const PROFILE_LEVELS = [1000, 975, 950, 925, 900, 850];
  const PROFILE_VARS = PROFILE_LEVELS.flatMap((l) => [
    `geopotential_height_${l}hPa`, `relative_humidity_${l}hPa`, `temperature_${l}hPa`,
  ]).filter((v) => !HOME_VARS.includes(v));

  // 雲海を見下ろせる可能性がある地点でだけ取る。平地では丸ごと不要。
  function needsProfile(place) {
    if (!place) return false;
    if (["basinFloor", "plain", "coast"].includes(place.terrain)) return false;
    if (place.terrain) return true;
    return (place.elevation ?? 0) >= T.seaOfClouds.minElevation;
  }
  // 大気組成（CAMS）。夕焼けの色はレイリー散乱・オゾン吸収・エアロゾル消散で決まる。
  // 出典: A New Twilight Sky Color Prediction Model Based on Machine Learning Methods,
  //       J. Appl. Meteor. Climatol. 65(5), 2026. doi:10.1175/JAMC-D-25-0206.1
  const AIR_VARS = ["aerosol_optical_depth", "dust"];

  // ECMWF アンサンブル（51メンバー）。初期値を摂動させた 51 通りの計算で、
  // 大気そのものの予測不確実性を測ったもの。8 モデルの「見解の割れ」とは別物。
  //
  // 使うのは【信頼度のみ】。スコアの本体は 8 モデルの中央値のままにしてある。
  // アンサンブル中央値は 8 モデル中央値より平均 13.2 点低く出る（偏り −9.4、
  // 53% が 10 点以上ずれる。20地点×7日=140標本で実測）が、アンサンブルAPIには
  // 過去アーカイブが無く（start_date も previous_dayN も全 null を返すことを実測確認）、
  // ERA5 と突き合わせて【どちらが正しいか判定できない】。
  // 検証できないものでスコアを動かさない。8/22 の失敗と同じ轍を踏まないため。
  //
  // ばらつきは幅（max−min）ではなく四分位範囲（IQR）を使う。51 本の max−min は
  // 外れメンバー 2 本で決まってしまい、8 本の幅とも比較できない（標本数依存）。
  const ENSEMBLE_MODEL = "ecmwf_ifs025";
  const ENSEMBLE_MEMBERS = 51;
  // visibility はアンサンブルでは全 null（実測確認済み）。freezing_level_height も同様。
  const ENSEMBLE_VARS = [
    "cloud_cover", "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high",
    "precipitation", "temperature_2m", "relative_humidity_2m",
    "wind_speed_10m", "direct_radiation",
  ];
  // 特許 US10459119 の可視距離式 d[mile] = 1.32 × √(高度[ft]) → km。
  const CLOUD_LAYERS = [
    { key: "low", altitudeFt: 6000, variable: "cloud_cover_low" },
    { key: "mid", altitudeFt: 15000, variable: "cloud_cover_mid" },
    { key: "high", altitudeFt: 30000, variable: "cloud_cover_high" },
  ].map((l) => ({ ...l, offsetKm: 1.32 * Math.sqrt(l.altitudeFt) * 1.609344 }));

  // ---------------------------------------------------------------- Open-Meteo
  function decodeLocation(payload) {
    const times = payload.hourly.time.map((t) => t * 1000);
    const byModel = {};
    for (const model of MODELS) {
      const columns = {};
      // 鉛直分布は地点によって要求していないので、来ていれば拾う形にする。
      for (const v of [...HOME_VARS, ...PROFILE_VARS]) {
        const c = payload.hourly[`${v}_${model}`];
        if (c) columns[v] = c;
      }
      if (Object.keys(columns).length) byModel[model] = new Series(times, columns);
    }
    return {
      grid: { latitude: payload.latitude, longitude: payload.longitude, elevation: payload.elevation },
      byModel,
    };
  }

  // 地点の標高が分かっているなら渡す。渡さないとモデルは自前の 90m DEM の値を使う。
  //
  // 効果は小さい。spots.js の33地点はすべて DEM と 50m 以内（最大38m）で一致しており、
  // 2026年1〜2月で霧氷の該当日が変わったのは高見山の +3日/59日だけ、
  // ダイヤモンドダストは全地点で変化なし（2026-09-06 実測）。
  //
  // それでも渡すのは、画面に出している標高・aboveMargin の比較・アメダスの減率補正が
  // すべて place.elevation を基準にしており、気象値だけ別の高さで計算されていると
  // 系統的なずれの温床になるため。数値の改善ではなく前提を揃えるための指定。
  //
  // 注意: 補正は標準減率による外挿で、逆転層のある朝は符号が逆になり得る。
  // 逆転の判定は気圧面（絶対高度）で行っており、そちらはこの補正の影響を受けない。
  const usableElevation = (e) =>
    typeof e === "number" && Number.isFinite(e) && e >= -500 && e <= 9000 ? Math.round(e) : null;

  function buildURL(coords, vars, days, pastDays, elevation = null) {
    const p = new URLSearchParams({
      latitude: coords.map((c) => c.latitude.toFixed(4)).join(","),
      longitude: coords.map((c) => c.longitude.toFixed(4)).join(","),
      hourly: vars.join(","),
      models: MODELS.join(","),
      timezone: "auto",
      // unixtime は真の UTC エポックで返る（実測確認済み）。文字列時刻のローカル解釈を避ける。
      timeformat: "unixtime", wind_speed_unit: "ms",
      forecast_days: String(days),
    });
    if (pastDays > 0) p.set("past_days", String(pastDays));
    const e = usableElevation(elevation);
    if (e !== null) p.set("elevation", String(e));
    return `https://api.open-meteo.com/v1/forecast?${p}`;
  }

  async function fetchJSON(url) {
    const res = await fetch(url);
    const body = await res.json();
    if (!res.ok || body.error) throw new Error(body.reason || `HTTP ${res.status}`);
    return body;
  }

  // 自地点＋夕焼け方位＋朝焼け方位の 3 リクエスト。
  // オフセット点は雲量 4 要素のみに絞って転送量とAPIコストを抑える。
  /// 大気組成の予報。取れなくても致命的ではないので、失敗したら null を返す。
  async function fetchAir(lat, lon, days) {
    const p = new URLSearchParams({
      latitude: lat.toFixed(4), longitude: lon.toFixed(4),
      hourly: AIR_VARS.join(","), timezone: "auto", timeformat: "unixtime",
      forecast_days: String(Math.min(days, 5)),   // 大気質は5日まで
    });
    try {
      const raw = await fetchJSON(`https://air-quality-api.open-meteo.com/v1/air-quality?${p}`);
      const times = raw.hourly.time.map((t) => t * 1000);
      const columns = {};
      for (const v of AIR_VARS) if (raw.hourly[v]) columns[v] = raw.hourly[v];
      return new Series(times, columns);
    } catch { return null; }
  }

  /// 51 メンバーのアンサンブル。取れなくても致命的ではない（信頼度が
  /// 従来の「8モデルの幅＋日数の下駄」へ落ちるだけ）ので、失敗したら null を返す。
  async function fetchEnsemble(lat, lon, days, elevation = null) {
    const p = new URLSearchParams({
      latitude: lat.toFixed(4), longitude: lon.toFixed(4),
      hourly: ENSEMBLE_VARS.join(","), models: ENSEMBLE_MODEL,
      timezone: "auto", timeformat: "unixtime", wind_speed_unit: "ms", forecast_days: String(days),
      past_days: "1",   // 雲海が前日の最高気温を読む。無いと当日ぶんが全メンバー欠測になる
      // 3 時間値にすると転送量は 350KB→135KB に減るが、IQR の相関が 0.515・
      // 平均絶対差 8.6 点まで崩れる（10地点×7日で実測）。閾値の間隔と同じ大きさなので使えない。
    });
    // 本体と同じ高さで計算させる。揃えないと、ばらつきだけ別の場所のものになる。
    const ee = usableElevation(elevation);
    if (ee !== null) p.set("elevation", String(ee));
    try {
      const raw = await fetchJSON(`https://ensemble-api.open-meteo.com/v1/ensemble?${p}`);
      const times = raw.hourly.time.map((t) => t * 1000);
      const out = [];
      for (let i = 0; i < ENSEMBLE_MEMBERS; i++) {
        // 無印キーはコントロールラン（中央値ではない。実測で中央値50に対し19だった）。
        const suffix = i === 0 ? "" : `_member${String(i).padStart(2, "0")}`;
        const columns = {};
        for (const v of ENSEMBLE_VARS) {
          const c = raw.hourly[`${v}${suffix}`];
          if (c && c.some((x) => x !== null)) columns[v] = c;
        }
        if (Object.keys(columns).length) out.push(new Series(times, columns));
      }
      return out.length >= 10 ? { members: out, elevation: raw.elevation } : null;
    } catch { return null; }
  }

  async function fetchForecast(lat, lon, days = 8, place = null) {
    const now = Date.now();
    const sunsetAt = Sun.eventTime("sunset", now, lat, lon);
    const sunriseAt = Sun.eventTime("sunrise", now, lat, lon);
    const sunsetBearing = sunsetAt ? Sun.position(sunsetAt, lat, lon).azimuth : 270;
    const sunriseBearing = sunriseAt ? Sun.position(sunriseAt, lat, lon).azimuth : 90;
    const offsetsFor = (bearing) => CLOUD_LAYERS.map((l) => Geo.destination(lat, lon, bearing, l.offsetKm));

    const [homeRaw, sunsetRaw, sunriseRaw, air, ensemble] = await Promise.all([
      // 標高を渡すのは自地点だけ。太陽方位側の 165/260/368km 先は別の場所で、
      // そこの標高までこちらの値にしたら嘘になる。
      fetchJSON(buildURL([{ latitude: lat, longitude: lon }],
        needsProfile(place) ? [...HOME_VARS, ...PROFILE_VARS] : HOME_VARS, days, 1, place?.elevation)),
      fetchJSON(buildURL(offsetsFor(sunsetBearing), OFFSET_VARS, days, 0)),
      fetchJSON(buildURL(offsetsFor(sunriseBearing), OFFSET_VARS, days, 0)),
      fetchAir(lat, lon, days),
      fetchEnsemble(lat, lon, days, place?.elevation),
    ]);
    // 地点の時差を暦へ反映する。以降の「今日／明日」はその地点の暦で動く。
    const homeMeta = Array.isArray(homeRaw) ? homeRaw[0] : homeRaw;
    if (homeMeta) setTimezoneOffset(homeMeta.utc_offset_seconds);
    const asList = (raw) => (Array.isArray(raw) ? raw : [raw]).map(decodeLocation);
    const toOffsets = (list) => Object.fromEntries(CLOUD_LAYERS.map((l, i) => [l.key, list[i]]));
    return {
      home: asList(homeRaw)[0],
      sunsetOffsets: toOffsets(asList(sunsetRaw)),
      sunriseOffsets: toOffsets(asList(sunriseRaw)),
      air,
      ensemble,
      sunsetBearing, sunriseBearing,
      utcOffsetSeconds: homeMeta ? homeMeta.utc_offset_seconds : null,
      timezone: homeMeta ? homeMeta.timezone : null,
      fetchedAt: now,
    };
  }

  // ---------------------------------------------------------------- ModelScore
  // 上下限で切り詰めた差分は「頭打ち」「下支え」の明示行にする。
  // 黙って切ると内訳の合計が表示スコアと合わず、「なぜこの点数か」が説明できない。
  function buildScore(base, factors, ceiling, ceilingReason, refinedWindow) {
    const raw = factors.reduce((s, f) => s + f.c, base);
    let final = Curve.clamp(raw);
    if (ceiling !== null && ceiling !== undefined) final = Math.min(final, ceiling);
    const ordered = [...factors].sort((a, b) => Math.abs(b.c) - Math.abs(a.c));
    if (Math.abs(final - raw) > 0.005) {
      const capped = final < raw;
      // 「頭打ち」「下支え」は内部用語で、利用者には何のことか伝わらない。
      // 理由そのものを見出しにして、補足で仕組みを説明する。
      ordered.push({
        label: capped ? (ceilingReason || "この条件では上限まで") : "ここが下限",
        c: final - raw,
        detail: capped
          ? "この条件では、ほかが良くてもここまでにとどめています"
          : "これ以上は下がりません",
      });
    }
    return { score: final, base, factors: ordered, unavailable: null, refinedWindow: refinedWindow || null };
  }
  const unavailable = (kind, message) => ({ score: 0, base: 0, factors: [], unavailable: { kind, message }, refinedWindow: null });
  const pct = (v) => `${Math.round(v)}%`;
  const f1 = (v) => v.toFixed(1);
  // 負のゼロを正のゼロへ（UI に -0.0 と出さない）。
  const factor = (label, c, detail) => ({ label, c: c === 0 ? 0 : c, detail: detail || "" });

  // ---------------------------------------------------------------- スコアラ
  // リードタイム（何日先か）による信頼度の減衰。
  //
  // verify-leadtime.mjs による実測（10地点×過去60日＝550標本、日の入り時刻、
  // 実況は ERA5 再解析）:
  //
  //   何日前  全雲量の相関  降水の相関
  //     0        0.613       0.604
  //     1        0.592       0.408
  //     2        0.440       0.292
  //     3        0.580       0.260
  //     4        0.510       0.146
  //     5        0.466       0.188
  //     6        0.281       0.148
  //     7        0.325       0.283
  //
  // 降水は1日先で既に相関が3分の2へ落ち、3日先で半分以下になる。
  // 雲量も6日先で相関 0.28 まで落ちる。
  // モデル間のばらつきだけでは、この劣化が信頼度に反映されない
  //（実測でばらつき幅は +0日 54.8 → +6日 67.4 とほとんど広がらなかった）。
  // そこで、ばらつき幅に日数ぶんの下駄を履かせる。
  // 係数は上の相関の落ち方に合わせた本アプリの見立てで、文献値ではない。
  const LEAD_TIME_PENALTY = [0, 6, 12, 16, 20, 23, 26, 28];

  function leadTimePenalty(daysAhead) {
    const i = Math.max(0, Math.min(LEAD_TIME_PENALTY.length - 1, Math.round(daysAhead)));
    return LEAD_TIME_PENALTY[i];
  }

  const RANKS = [
    { key: "spectacular", label: "絶景", min: 85 },
    { key: "good", label: "良好", min: 65 },
    { key: "fair", label: "平凡", min: 40 },
    { key: "poor", label: "不向き", min: -1 },
  ];
  const rankOf = (score) => RANKS.find((r) => score >= r.min);
  // 信頼度の境界。
  // 当初は 15/30 としていたが、実測すると当日でさえ5地点中4つが「低」になり、
  // 警告として意味を失っていた（常に赤なら誰も見ない）。
  // 8モデルのばらつき幅は実際に 50〜70 程度あるのが普通なので、実態に合わせる。
  // モデルの割れ方から出す信頼度。
  //
  // 幅だけでは足りない。ランクの帯は20〜25点間隔なので、幅が25点でも
  // 全モデルが同じ帯に収まっていることもあれば、幅が10点でも境目をまたいで
  // 評価が割れていることもある。アンサンブル側は rankAgreement で
  // この取りこぼしを塞いでいる。同じ確認をこちらにも置く。
  // （雲海はアンサンブルを使えないので、必ずこちらを通る）
  const confidenceOf = (width, agreement) => {
    let key = width < 30 ? "high" : width < 55 ? "medium" : "low";
    let capped = false;
    if (agreement !== null && agreement !== undefined) {
      if (agreement < AGREE_LOW) { key = "low"; capped = true; }
      else if (agreement < AGREE_HIGH && key === "high") { key = "medium"; capped = true; }
    }
    return { key, label: key === "high" ? "高" : key === "medium" ? "中" : "低",
             caption: key === "high" ? "モデルの見解が揃っています"
               : key === "medium" ? "モデルの見解に幅があります" : "モデルの見解が割れています",
             cappedByDisagreement: capped };
  };

  // --- アンサンブル（51メンバー）を使うときの信頼度 ---
  //
  // 抽象的な「ばらつき幅」ではなく【スコアが何点ずれそうか】へ変換して扱う。
  // 利用者にとっても「±10点くらい」のほうが意味が取れるし、
  // ランク幅（絶景85/良好65/平凡40＝20〜25点間隔）と直接比べられる。
  //
  // 変換: 正規分布なら p90 − p10 = 2.563σ、平均絶対誤差 = √(2/π)σ = 0.7979σ。
  //       よって 予測誤差 ≒ (p90 − p10) × 0.7979 / 2.563 = (p90 − p10) × 0.3113。
  //
  // 【四分位範囲では駄目だった】
  //   降水などで上限に張り付くと、多数のメンバーが同じ点数に積み上がる。
  //   実測では 294 標本のうち 67 件（23%）で 4 割以上のメンバーが中央値と同値だった。
  //   そうなると四分位が全部その山の中に入り IQR が 0 になる。
  //   実例: 51 メンバーが 9〜83 点に散らばっているのに IQR が 0 で「信頼度 高」。
  //         11 本（22%）は別の評価を指していた。
  //   p10–p90 なら山の外まで届くので潰れない。
  //
  // 【実測との一致】
  //   当日〜翌日の予測誤差の中央値 8.7 点。
  //   実測したスコア誤差（10地点×61日＝610標本、ERA5比）は MAE 9.5 点。
  //   IQR 版（8.3点）より近い。
  //
  // 日数ぶんの下駄は【足さない】。散らばり自身が日数とともに広がるうえ、
  // 当日で較正が合っている量に、測っていない補正を足せばその一致を壊すだけになる。
  const SPREAD_TO_EXPECTED_ERROR = 0.3113;
  const ENS_HIGH_THRESHOLD = 10;    // ±10点未満ならランクは動かない
  const ENS_MEDIUM_THRESHOLD = 20;  // ランク境界の間隔が20〜25点

  // 点数の幅が小さくても、評価が割れていることがある。
  // 上限に張り付いた分布では幅が縮む一方、外れた側は別のランクを指す。
  // 「評価は動かない」と言う以上、メンバーの多数が同じ評価であることを確かめる。
  const AGREE_HIGH = 0.7;   // これ未満なら「高」とは言わない
  const AGREE_LOW = 0.5;    // 表示している評価が少数派なら「低」

  /// 51 メンバーを本体スコアへ重ね直し、同じ評価になる割合を返す。
  /// メンバーは太陽方位オフセットを持たないぶん絶対値がずれるので、
  /// 画面のヒストグラムと同じように中央を合わせてから比べる。
  function rankAgreement(scores, memberMedian, shownScore) {
    if (!scores || !scores.length) return null;
    const shift = shownScore - memberMedian;
    const target = rankOf(shownScore).key;
    let same = 0;
    for (const v of scores) {
      const moved = Curve.clamp(v + shift);
      if (rankOf(moved).key === target) same++;
    }
    return same / scores.length;
  }

  const confidenceOfEnsemble = (expectedError, agreement) => {
    let key = expectedError < ENS_HIGH_THRESHOLD ? "high"
      : expectedError < ENS_MEDIUM_THRESHOLD ? "medium" : "low";
    let capped = false;
    if (agreement !== null && agreement !== undefined) {
      if (agreement < AGREE_LOW) { key = "low"; capped = true; }
      else if (agreement < AGREE_HIGH && key === "high") { key = "medium"; capped = true; }
    }
    const caption = key === "high" ? "51通りの計算がよく揃っています"
      : key === "medium" ? "51通りの計算に幅があり、評価が1段変わり得ます"
      : "51通りの計算が割れています";
    return { key, label: key === "high" ? "高" : key === "medium" ? "中" : "低",
             caption, cappedByDisagreement: capped };
  };

  // 信頼度を1文字で出す。14日ぶん並べたとき、どこから先を鵜呑みにしないかが
  // ひと目で分かるようにするため。
  //
  // **3段階にしてある。** 実測で区別がついたのが3つだからで、5段階にはしない。
  //   - 評価の帯は20〜25点間隔。±10点未満なら評価は動かない（A）
  //   - ±20点までなら評価が1段変わり得る（B）
  //   - それ以上は評価そのものが当てにならない（C）
  // 境目は 610標本の実測に基づく既存の閾値をそのまま使う。
  // 段階を増やすと、根拠のない境目を2つ足すことになる。
  //
  // モデル数による頭打ちを別に置く。先の日ほどモデルが落ち、
  // 9日目以降は4本以下（うち2本は ECMWF 系で互いに近い）。
  // 51メンバーの散らばりは大気の不確かさを測れていても、
  // 「8モデルの中央値」という土台のほうが崩れているので A とは言わない。
  const GRADE_MIN_MODELS = 5;
  function reliabilityGrade(confidence, models) {
    const base = confidence.key === "high" ? "A" : confidence.key === "medium" ? "B" : "C";
    const capped = typeof models === "number" && models > 0 && models < GRADE_MIN_MODELS
      && base === "A" ? "B" : base;
    return {
      key: capped,
      capped: capped !== base,
      caption: capped === "A" ? "評価はほぼ動きません"
        : capped === "B" ? "評価が1段変わり得ます"
        : "評価そのものが当てになりません",
    };
  }

  function cloudDetail(raw, overcast, heavilyObscured, absent, present) {
    // 空一面かどうかを先に見る。覆い尽くしでも三角カーブは 0 を返すため、
    // 順序を逆にすると「一面の巻層雲」を「雲がない」と説明してしまう。
    if (overcast > 1) return "空一面を覆い、光が散って平板な空になります";
    if (raw <= 0) return absent;
    if (heavilyObscured) return "低い雲に隠れて見えにくい状態です";
    return present;
  }

  function afterglowScorer(kind) {
    const eventName = kind === "sunset" ? "sunset" : "sunrise";
    return {
      id: kind, source: T.sunset.source,
      window(dayMs, input) {
        const ev = Sun.eventTime(eventName, dayMs, input.lat, input.lon);
        if (ev === null) return null;
        const s = T.sunset;
        return kind === "sunset"
          ? [ev - s.windowBefore, ev + s.windowAfter]
          : [ev - s.windowAfter, ev + s.windowBefore];
      },
      peak(dayMs, window, input) {
        return Sun.eventTime(eventName, dayMs, input.lat, input.lon) ?? window[0];
      },
      score(window, input) {
        const s = T.sunset, series = input.home, [ws, we] = window;
        const high = series.mean("cloud_cover_high", ws, we);
        const mid = series.mean("cloud_cover_mid", ws, we);
        const low = series.mean("cloud_cover_low", ws, we);
        if (high === null || mid === null || low === null) return unavailable("missingData", "雲量が得られませんでした");

        const factors = [];
        const visibleFraction = 1 - Curve.ramp(low, s.obscuredStart, s.obscuredFull);
        const heavilyObscured = visibleFraction < 0.7;

        const highRaw = Curve.triangular(high, s.highCloudLow, s.highCloudPeak, s.highCloudHigh);
        const highOvercast = Curve.ramp(high, s.highCloudOvercastStart, 100) * s.highCloudOvercastPenalty;
        const highBonus = highRaw * s.highCloudBonus * visibleFraction - highOvercast;
        factors.push(factor(`上層の雲 ${pct(high)}`, highBonus,
          cloudDetail(highRaw, highOvercast, heavilyObscured,
            high < s.highCloudPeak ? "光を受ける雲が空高くにない" : "雲が多すぎて光が抜けません",
            "すじ雲が夕日を受ける面になります")));

        const midRaw = Curve.triangular(mid, s.midCloudLow, s.midCloudPeak, s.midCloudHigh);
        const midBonus = midRaw * s.midCloudBonus * visibleFraction;
        factors.push(factor(`中層の雲 ${pct(mid)}`, midBonus,
          cloudDetail(midRaw, 0, heavilyObscured,
            mid < s.midCloudLow ? "中層に雲がほとんどありません" : "雲が多すぎて光が抜けません",
            "空に奥行きが出ます")));

        if (low <= s.lowCloudClear) {
          factors.push(factor(`下層の雲 ${pct(low)}`, s.lowCloudBonus, "頭上は開けています"));
        } else if (low >= s.lowCloudPenaltyStart) {
          const ratio = Curve.ramp(low, s.lowCloudPenaltyStart, s.lowCloudPenaltyFull);
          factors.push(factor(`下層の雲 ${pct(low)}`, -ratio * s.lowCloudPenalty, "低い雲が頭上を覆っています"));
        } else {
          const ratio = 1 - Curve.ramp(low, s.lowCloudClear, s.lowCloudPenaltyStart);
          factors.push(factor(`下層の雲 ${pct(low)}`, ratio * s.lowCloudBonus, "頭上は開けています"));
        }

        const sunwardLow = input.offsets?.low?.mean("cloud_cover_low", ws, we) ?? null;
        if (sunwardLow !== null) {
          const penalty = -Curve.ramp(sunwardLow, s.sunwardLowPenaltyStart, s.sunwardLowPenaltyFull) * s.sunwardLowPenalty;
          factors.push(factor(`日の入り方向の下層雲 ${pct(sunwardLow)}`, penalty,
            penalty < -1 ? "約165km先で夕日がさえぎられます" : "夕日の通り道は開けています"));
        }
        const sunwardHigh = input.offsets?.high?.mean("cloud_cover_high", ws, we) ?? null;
        if (sunwardHigh !== null) {
          const bonus = Curve.triangular(sunwardHigh, s.highCloudLow, s.highCloudPeak, s.highCloudHigh) * s.sunwardHighBonus;
          factors.push(factor(`日の入り方向の上層雲 ${pct(sunwardHigh)}`, bonus, "約368km先で夕日を受ける雲があります"));
        }

        // 気圧面の相対湿度。モデルが返さない面がある（jma_msm の 200hPa は全 null）ので取れた面だけ平均する。
        const levels = [
          ["上層", ["relative_humidity_300hPa", "relative_humidity_200hPa"], s.upperRH, s.upperRHBonus],
          ["中層", ["relative_humidity_500hPa", "relative_humidity_700hPa"], s.midRH, s.midRHBonus],
          ["下層", ["relative_humidity_925hPa", "relative_humidity_850hPa"], s.lowerRH, s.lowerRHBonus],
        ];
        for (const [name, vars, band, bonus] of levels) {
          const available = vars
            .filter((v) => series.isSupported(v))
            .map((v) => series.mean(v, ws, we))
            .filter((x) => x !== null);
          if (!available.length) continue;
          const rh = available.reduce((a, b) => a + b, 0) / available.length;
          if (rh > s.overcastRH) {
            factors.push(factor(`${name}の湿り ${pct(rh)}`, -s.overcastRHPenalty, "90%超は曇りの空気です"));
          } else {
            const fit = Curve.band(rh, band[0], band[1], s.rhTolerance);
            factors.push(factor(`${name}の湿り ${pct(rh)}`, fit * bonus, `ちょうどよいのは ${band[0]}〜${band[1]}%`));
          }
        }

        // 光を受ける面。特許は高層雲を vivid に必須とし、雲ひとつない夕空を "average" とする。
        // 単一の上限にすると全モデルが同じ値へ張り付き、モデル差が消えて誤った「信頼度高」になる。
        let ceiling = null, ceilingReason = "";
        const canvas = Math.max(high, mid * s.midCloudCanvasWeight);
        if (canvas < s.canvasPresentMinimum) {
          ceiling = s.clearSkyCeiling; ceilingReason = "頭上に光を受ける雲がない（快晴の夕空）";
        } else if (canvas < s.canvasVividMinimum) {
          ceiling = s.noVividCeiling; ceilingReason = "光を受ける雲が薄く、絶景までは届かない";
        }

        const precip = series.max("precipitation", ws, we);
        if (precip !== null && precip > s.precipThreshold) {
          const ratio = Curve.ramp(precip, s.precipThreshold, s.precipFull);
          factors.push(factor(`降水 ${f1(precip)}mm`, -(0.4 + 0.6 * ratio) * s.precipPenalty, "雨が降っていると空は染まりません"));
          ceiling = Math.min(ceiling ?? Infinity, s.precipCeiling);
          ceilingReason = "降水があると焼けない";
        }

        if (series.isSupported("visibility")) {
          const vis = series.mean("visibility", ws, we);
          if (vis !== null) {
            if (vis >= s.visGood) factors.push(factor(`視程 ${Math.round(vis / 1000)}km`, s.visBonus, "遠くまで見通せます"));
            else if (vis <= s.visPoor) factors.push(factor(`視程 ${Math.round(vis / 1000)}km`, -s.visPenalty, "かすんで色が乗りにくい状態です"));
          }
        }

        // --- 空気の濁り（エアロゾル・黄砂・オゾン） ---
        const air = input.air;
        if (air) {
          const aod = air.mean("aerosol_optical_depth", ws, we);
          if (aod !== null) {
            // 澄んでいるほど光が減衰せず、雲が鮮やかに染まる。
            const clean = 1 - Curve.ramp(aod, s.aodClean, s.aodHazy);
            const contribution = clean * s.aodBonus - (1 - clean) * s.aodPenalty;
            // 説明は寄与の向きに合わせる。同じ「やや濁っています」を
            // 加点にも減点にも付けると、記号と文が食い違って読めなくなる。
            const detail = contribution > 3 ? "よく澄んでいて、光がまっすぐ届きます"
              : contribution > 0 ? "まずまず澄んでいます"
              : contribution > -5 ? "やや濁っていて、色が乗りにくくなります"
              : "空気が濁っていて、光が減って色が乗りにくい状態です";
            factors.push(factor(`空気の澄み（エアロゾル ${aod.toFixed(2)}）`, contribution, detail));
          }
          const dust = air.mean("dust", ws, we);
          if (dust !== null && dust > 1) {
            factors.push(factor(`黄砂 ${Math.round(dust)}μg/m³`,
              -Curve.ramp(dust, 1, s.dustHeavy) * s.dustPenalty,
              "砂じんが光をさえぎり、色が濁ります"));
          }
        }

        return buildScore(s.base, factors, ceiling, ceilingReason);
      },
    };
  }

  const starrySkyScorer = {
    id: "starrySky", source: T.starry.source,
    window(dayMs, input) {
      const nextDay = Cal.addDays(dayMs, 1);
      const pairs = [["astronomicalDusk", "astronomicalDawn"], ["nauticalDusk", "nauticalDawn"], ["civilDusk", "civilDawn"]];
      for (const [dusk, dawn] of pairs) {
        const s = Sun.eventTime(dusk, dayMs, input.lat, input.lon);
        const e = Sun.eventTime(dawn, nextDay, input.lat, input.lon);
        if (s !== null && e !== null && e > s) return [s, e];
      }
      return null;
    },
    // 曇っているほど月明かりは関係なくなる。塞がった空の下では月の有無で見え方は変わらない。
    moonWeight(cloud) { return 1 - Curve.ramp(cloud, 0, 100); },
    // 全天が雲で塞がれば、条件が何であれ星は見えない。上限として効かせる。
    overcastCeiling(cloud) {
      const s = T.starry;
      return s.base - (s.base - s.overcastCeiling) * Curve.ramp(cloud, s.overcastFrom, 100);
    },
    // 夜のうち、いちばん条件の良い連続 windowHours を探す。
    // 選ぶ基準は採点そのものと同じ（雲と月の減点の合計が最小）。
    // 別の基準で窓を選ぶと、選んだ窓と出す点数が食い違う。
    bestWindow(window, input) {
      const s = T.starry, series = input.home, [ws, we] = window;
      const span = s.windowHours * 3600000;
      if (we - ws <= span) return [ws, we];
      // 夜通しでも同じ良さなら絞らない。一様に晴れた夜に「19:00〜22:00が狙いめ」と
      // 出すのは嘘で、実際は一晩じゅう見える。
      const valueOf = (start, end) => {
        const cloud = series.mean("cloud_cover", start, end);
        if (cloud === null) return null;
        const moon = Moon.peakBrightness(start, end, input.lat, input.lon);
        return Math.min(starrySkyScorer.overcastCeiling(cloud),
          s.base - Curve.ramp(cloud, 0, 100) * s.cloudPenalty
                 - moon * starrySkyScorer.moonWeight(cloud) * s.moonlightPenalty);
      };
      const wholeValue = valueOf(ws, we);
      let best = null;
      for (let start = ws; start + span <= we; start += 3600000) {
        // 採点と同じ式で比べる。別の基準で選ぶと、選んだ窓と出す点数が食い違う。
        const value = valueOf(start, start + span);
        if (value === null) continue;
        if (!best || value > best.value) best = { start, end: start + span, value };
      }
      if (!best) return [ws, we];
      // 1点にも満たない差で時間帯を絞らない。
      if (wholeValue !== null && best.value - wholeValue < 1) return [ws, we];
      return [best.start, best.end];
    },
    score(window, input) {
      const s = T.starry, series = input.home;
      const [ws, we] = starrySkyScorer.bestWindow(window, input);
      const cloud = series.mean("cloud_cover", ws, we);
      if (cloud === null) return unavailable("missingData", "雲量が得られませんでした");
      const factors = [];
      const nightHours = (window[1] - window[0]) / 3600000;
      const whole = we - ws >= window[1] - window[0] - 60000;
      factors.push(factor(`雲量 ${pct(cloud)}`, -Curve.ramp(cloud, 0, 100) * s.cloudPenalty,
        (cloud < 20 ? "ほとんど雲がありません" : cloud > 70 ? "厚い雲に覆われます" : "雲が出たり入ったりします")
        + (whole ? `。夜のあいだ（約${Math.round(nightHours)}時間）ずっとの値です`
                 : `。${Cal.hhmmRounded(ws)}〜${Cal.hhmmRounded(we)} の値です（この夜でいちばん条件の良い時間帯）`)));
      const precip = series.max("precipitation", ws, we);
      if (precip !== null && precip > s.precipThreshold) {
        factors.push(factor(`降水 ${f1(precip)}mm`, -s.precipPenalty, "雨では星は見えません"));
      }
      const moonPeak = Moon.peakBrightness(ws, we, input.lat, input.lon);
      const moonState = Moon.state(ws + (we - ws) / 2, input.lat, input.lon);
      const moonWeight = starrySkyScorer.moonWeight(cloud);
      factors.push(factor(`月明かり 輝面比${pct(moonState.illuminatedFraction * 100)}`,
        -moonPeak * moonWeight * s.moonlightPenalty,
        moonPeak < 0.05 ? "月明かりの影響はほぼありません"
          : moonWeight < 0.3 ? `月齢${Math.round(moonState.age)}。ただし雲に覆われるので月の有無は効きません`
          : `月齢${Math.round(moonState.age)}。この時間帯で月がいちばん高いときで見ています`));
      let atmospherePenalty = 0, atmosphereDetail = "";
      const humidity = series.mean("relative_humidity_2m", ws, we);
      if (humidity !== null && humidity > s.humidityStart) {
        atmospherePenalty = Curve.ramp(humidity, s.humidityStart, 100) * s.atmospherePenalty;
        atmosphereDetail = `湿度 ${pct(humidity)}。かすみやすい空気です`;
      }
      if (series.isSupported("visibility")) {
        const vis = series.mean("visibility", ws, we);
        if (vis !== null && vis < s.visPoor) {
          const p = Curve.ramp(vis, s.visPoor, 0) * s.atmospherePenalty;
          if (p > atmospherePenalty) { atmospherePenalty = p; atmosphereDetail = `視程 ${Math.round(vis / 1000)}km`; }
        }
      }
      if (atmospherePenalty > 0) factors.push(factor("空気の澄み", -atmospherePenalty, atmosphereDetail));
      // 光害はその地点の素質。天気と違い日ごとには変わらないが、
      // 同じ快晴・無月でも都心と山では見える星がまるで違う。それをスコアに反映する。
      if (input.lightPollution) {
        const { mpsas } = input.lightPollution;
        const penalty = Curve.ramp(s.lpPristine - mpsas, 0, s.lpPristine - s.lpWorst) * s.lpMaxPenalty;
        factors.push(factor(`光害 ${LightPollution.zoneLabel(mpsas)}`, -penalty,
          `天頂の空の明るさ ${mpsas.toFixed(1)} 等級/平方秒（22が自然の空。VIIRS衛星実測由来）`));
      }
      const elevation = input.elevation;
      if (elevation > s.elevStart) {
        factors.push(factor(`標高 ${Math.round(elevation)}m`,
          Curve.ramp(elevation, s.elevStart, s.elevFull) * s.elevBonus, "空気が薄く、空が暗くなります"));
      }
      const result = buildScore(s.base, factors);
      const ceiling = starrySkyScorer.overcastCeiling(cloud);
      if (result.score > ceiling) {
        result.factors.push(factor(`空が塞がる（雲量 ${pct(cloud)}）`, ceiling - result.score,
          "全天が雲に覆われると、ほかの条件が揃っていても星は見えません"));
        result.score = ceiling;
      }
      // 夜全体ではなくこの時間帯の話であることを、表示側へも伝える。
      if (!whole) result.refinedWindow = [ws, we];
      return result;
    },
  };

  /// 雲海の成因を推定する。種類が見え方そのものになる。
  ///
  /// 出典: 三菱自動車「雲海の種類」（6分類）
  ///   https://www.mitsubishi-motors.co.jp/special/weekend-explorer/unkai/kind.html
  ///
  /// これまでは放射霧だけを想定し、前日の雨を「放射霧への加点」として混ぜていた。
  /// だが雨上がりの雲海は別の型で、水蒸気が既にあるぶん放射冷却への要求が軽い。
  /// 移流霧にいたっては放射冷却を必要としないので、気温差を主軸にした判定では
  /// ほぼ 0 点になる（トマム山の「太平洋型」がこれ）。
  ///
  /// 断定はしない。データが支持している成因を名指しするだけ。
  function cloudSeaKind({ range, prevRain, nightCloud, humidity, month, hasInversion }) {
    // 風は型の判別に使わない。展望台（尾根）の風は盆地底の風とは別の量で、
    // 「できた雲海が崩れるか」の話であって「どの型ができるか」とは関係がない。
    const s = T.seaOfClouds;
    const radiative = range >= s.rangeThreshold
      && (nightCloud === null || nightCloud < s.nightCloudFail);
    const rained = prevRain !== null && prevRain > s.prevRainMm;
    const damp = humidity !== null && humidity >= s.humidityThreshold;

    if (rained && radiative) {
      return { key: "afterRain", name: "雨上がりの雲海",
               note: "前日の雨が残した水蒸気が、冷え込みで霧になります。境界のはっきりした雲海になりやすい型です" };
    }
    if (radiative) {
      return { key: "radiation", name: "放射霧",
               note: "晴れて冷え込んだ盆地にたまる、もっとも一般的な雲海です。局地的で比較的厚くなります" };
    }
    if (rained && damp) {
      return { key: "afterRain", name: "雨上がりの雲海",
               note: "前日の雨で水蒸気が多い状態です。ただし冷え込みは弱いので、出るかどうかは五分五分です" };
    }
    // 放射冷却が効いていないのに下層が飽和している。夏の北日本太平洋側などで、
    // 暖湿気が冷たい海の上を通って霧になる型（移流霧）がこれにあたる。
    if (hasInversion && damp && (month >= 5 && month <= 9)) {
      return { key: "advection", name: "移流霧かもしれません",
               note: "冷え込みは弱いのに下層が湿っています。暖かく湿った空気が冷たい海や地面の上を流れてできる型です" };
    }
    if (damp) {
      return { key: "damp", name: "湿りはあります",
               note: "空気は湿っていますが、冷え込みが足りません" };
    }
    if (range < s.rangeThreshold) {
      return { key: "noCooling", name: "冷え込みが足りません",
               note: "前日との気温差が小さく、霧のもとになる冷え込みがありません" };
    }
    return { key: "none", name: "条件が揃っていません", note: "" };
  }

  /// 気圧面の気温分布から【逆転層の底】を読む。そこが雲海の天井になる。
  ///
  /// エマグラムで雲海を読む手順そのもの。逆転層より上には雲が育たないので、
  /// その高さより上に立てば見下ろせる（三菱自動車「雲海の仕組み」条件2・3）。
  ///
  /// 【モデルに霧そのものを予測させない】のが要点。
  /// 最初は「気圧面の湿度が90%以上の層＝雲」として雲頂を取ろうとしたが、
  /// 放射霧は 5km 格子・面の間隔 230m のモデルが解像できないほど浅く局地的で、
  /// 下層の湿度は霧の日でも 90% に届かない。
  /// その条件を課したら雲海スポット10地点×7日のうち69件が「下層が乾いている」になり、
  /// 全部 15点になった（実データで確認）。機能を殺していた。
  ///
  /// 霧ができるかは地上の条件（放射冷却・弱風・湿度）で判断し、
  /// 分布からは【天井の高さ】だけを読む。役割を分ける。
  // 逆転層を読むのに足りる気圧面がそろっているか。inversionBase と同じ条件で数える。
  function profileLevelCount(series, ws, we) {
    let n = 0;
    for (const l of PROFILE_LEVELS) {
      if (series.mean(`geopotential_height_${l}hPa`, ws, we) !== null
          && series.mean(`temperature_${l}hPa`, ws, we) !== null) n++;
    }
    return n;
  }

  function inversionBase(series, ws, we) {
    const rows = [];
    for (const l of PROFILE_LEVELS) {
      const h = series.mean(`geopotential_height_${l}hPa`, ws, we);
      const t = series.mean(`temperature_${l}hPa`, ws, we);
      if (h === null || t === null) continue;
      rows.push({ h, t });
    }
    if (rows.length < 3) return null;
    rows.sort((a, b) => a.h - b.h);
    const s = T.seaOfClouds;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].h > s.inversionMaxHeight) break;
      if (rows[i].t > rows[i - 1].t + s.inversionMinK) {
        // 逆転が始まる面の下端。ここが天井。
        return { height: rows[i - 1].h, strength: rows[i].t - rows[i - 1].t, levels: rows.length };
      }
    }
    return { height: null, strength: 0, levels: rows.length };
  }

  const seaOfCloudsScorer = {
    id: "seaOfClouds", source: T.seaOfClouds.source,
    window(dayMs, input) {
      const sunrise = Sun.eventTime("sunrise", dayMs, input.lat, input.lon);
      return sunrise === null ? null : [sunrise - 3600000, sunrise + 3600000];
    },
    peak(dayMs, window, input) { return Sun.eventTime("sunrise", dayMs, input.lat, input.lon) ?? window[0]; },
    // 雲海だけは、逆転層（雲海の天井）が展望台より上か下かで答えが裏返る。
    // 上なら他の条件がどれだけ揃っていても見下ろせない。
    // 51メンバーは気圧面を1面も持たないので、この判定を一度もできない。
    // 判定できない集団が揃っているのは当たり前で、それを「揃っている」と
    // 読むと、8モデルが割れている日に「評価はほぼ動きません」と出る。
    // 【実測】美の山公園・2026-09-09: 8モデルの幅 43点（気象庁MSMは
    // 「雲海の中に入る」）に対し、51メンバーの幅 5点 → A。
    ensembleBlind(member, window) {
      return profileLevelCount(member, window[0], window[1]) >= 3
        ? null : "51通りの計算は気圧面を持たず、雲海の天井を判定できません";
    },
    score(window, input) {
      const s = T.seaOfClouds, series = input.home, [ws, we] = window;
      if (["basinFloor", "plain", "coast"].includes(input.terrain)) {
        return unavailable("terrain", "雲海を見下ろせる地形ではありません");
      }
      if (!input.terrain && input.elevation < s.minElevation) {
        return unavailable("terrain", `標高 ${Math.round(input.elevation)}m。雲海を見下ろすには低すぎます`);
      }
      const todayStart = Cal.startOfDay(ws);
      const prevStart = Cal.addDays(todayStart, -1);
      const previousMax = series.max("temperature_2m", prevStart, todayStart);
      if (previousMax === null) return unavailable("missingData", "前日の気温が得られませんでした（過去分の取得が必要）");
      const todayMin = series.min("temperature_2m", todayStart, we);
      if (todayMin === null) return unavailable("missingData", "当日の気温が得られませんでした");

      const factors = [];
      const range = previousMax - todayMin;
      const rangeFit = Curve.ramp(range, s.rangeThreshold - 3, s.rangeFull);
      const nightCloudForText = series.mean("cloud_cover", todayStart, ws);
      const cloudyNight = nightCloudForText !== null && nightCloudForText >= s.nightCloudFail;
      factors.push(factor(`気温差 ${f1(range)}℃`, rangeFit * s.rangeBonus,
        range > s.rangeThreshold
          ? (cloudyNight
              ? `前日最高 ${f1(previousMax)}℃ → 当日最低 ${f1(todayMin)}℃。ただし夜間は曇っており、放射冷却ではなく寒気の入れ替わりによる差です`
              : `前日最高 ${f1(previousMax)}℃ → 当日最低 ${f1(todayMin)}℃。放射冷却の目安 10.2℃ を超える`)
          : "放射冷却の目安 10.2℃ に届かない"));
      const wind = series.mean("wind_speed_10m", ws, we);
      if (wind !== null) {
        const calm = 1 - Curve.ramp(wind, s.windCalm, s.windFail);
        factors.push(factor(`風速 ${f1(wind)}m/s`, calm * s.windBonus,
          wind < s.windCalm ? "ほぼ無風。雲海が崩れません"
            : "風があると雲海は流されます（展望台の高さの風です。谷底はこれより弱いのが普通）"));
      }
      const humidity = series.mean("relative_humidity_2m", ws, we);
      if (humidity !== null) {
        factors.push(factor(`早朝の湿度 ${pct(humidity)}`,
          Curve.ramp(humidity, s.humidityThreshold - 10, 100) * s.humidityBonus, "朝もやが立ちこめるだけの湿りがあります"));
      }
      const prevRain = series.sum("precipitation", prevStart, todayStart);
      if (prevRain !== null) {
        factors.push(factor(`前日の降水 ${f1(prevRain)}mm`,
          Curve.ramp(prevRain, 0, s.prevRainMm * 6) * s.prevRainBonus,
          prevRain > s.prevRainMm ? "前日の雨が水蒸気を残しています" : "もとになる水蒸気が足りません"));
      }
      const nightCloud = series.mean("cloud_cover", todayStart, ws);
      if (nightCloud !== null) {
        const clear = 1 - Curve.ramp(nightCloud, s.nightCloudClear, s.nightCloudFail);
        factors.push(factor(`夜間の雲量 ${pct(nightCloud)}`, clear * s.nightCloudBonus,
          nightCloud < s.nightCloudClear ? "晴れて地面が冷え込みます" : "雲が布団になって冷え込みません"));
      }

      // --- 雲海の天井（逆転層）と展望台の高さ（3条件の 2 と 3） ---
      //
      // これまでは「霧ができるか」だけを見ていた。だが雲頂が展望台より高ければ、
      // 条件が揃っていても見下ろせない。中に立つことになる。
      //
      // 逆転層が見つかったときだけ効かせる。見つからないのは
      // 「天井が無い」のか「モデルが捉えていない」のか区別できないので、
      // その場合は何も足さない・引かない。分かることだけで判断する。
      const elevation = input.elevation;
      const inv = inversionBase(series, ws, we);
      let ceiling = null, ceilingReason = "";
      if (inv && inv.height !== null && elevation !== null && elevation !== undefined) {
        const margin = elevation - inv.height;
        if (margin >= s.aboveMargin) {
          factors.push(factor(`雲海の天井 約${Math.round(inv.height)}m`, s.aboveBonus,
            `逆転層がここにあり、雲はこれより上へ育ちません。展望台（${Math.round(elevation)}m）はその上なので見下ろせます`));
        } else {
          factors.push(factor(`雲海の天井 約${Math.round(inv.height)}m`, 0,
            `逆転層がここにあり、展望台（${Math.round(elevation)}m）はその${margin >= 0 ? "すぐ上で縁になります" : "下。霧の中に入ります"}`));
          ceiling = s.insideCeiling;
          ceilingReason = margin >= 0 ? "雲海の縁で見下ろせない" : "雲海の中に入ってしまう";
        }
      }

      // 成因を名指しする。種類が見え方そのものになるので、点数だけより役に立つ。
      const kind = cloudSeaKind({
        range, prevRain, nightCloud, humidity,
        month: new Date(ws).getMonth() + 1,
        hasInversion: !!(inv && inv.height !== null),
      });
      if (kind.note) factors.push(factor(`型: ${kind.name}`, 0, kind.note));
      return buildScore(s.base, factors, ceiling, ceilingReason);
    },
  };

  const diamondDustScorer = {
    id: "diamondDust", source: T.diamondDust.source,
    window(dayMs, input) {
      const start = Cal.setHour(Cal.startOfDay(dayMs), T.diamondDust.windowStart);
      return [start, Cal.setHour(Cal.startOfDay(dayMs), T.diamondDust.windowEnd)];
    },
    score(window, input) {
      const s = T.diamondDust, series = input.home, [ws, we] = window;
      const dayStart = Cal.startOfDay(ws);
      const minTemp = series.min("temperature_2m", dayStart, we);
      if (minTemp === null) return unavailable("missingData", "気温が得られませんでした");
      if (minTemp > 0) return unavailable("outOfSeason", `最低気温 ${f1(minTemp)}℃。氷点下になりません`);
      const factors = [];
      let base;
      if (minTemp <= s.extremeCold) {
        base = s.extremeProb * 100;
        factors.push(factor(`最低気温 ${f1(minTemp)}℃`, 0, "−15℃以下。旭川2シーズンの観測で 16/19日（84%）が発生"));
      } else if (minTemp <= s.coldHumidTemp) {
        base = s.coldHumidProb * 100;
        factors.push(factor(`最低気温 ${f1(minTemp)}℃`, 0, "−15〜−10℃。この帯の発生は 7/41日（17%）"));
        const humidity = series.mean("relative_humidity_2m", ws, we);
        if (humidity !== null && humidity > s.coldHumidHumidity) {
          factors.push(factor(`湿度 ${pct(humidity)}`, 25, "論文は高湿度日の発生を確認（条件付き確率は未公表）"));
        }
      } else {
        base = 3;
        factors.push(factor(`最低気温 ${f1(minTemp)}℃`, 0, "発生条件の −10℃ に届かない"));
      }
      const cloud = series.mean("cloud_cover", ws, we);
      if (cloud !== null) {
        factors.push(factor(`雲量 ${pct(cloud)}`, (1 - Curve.ramp(cloud, s.clearSkyCloud, 80)) * s.clearBonus,
          "晴れて冷え込み、氷の粒が日射できらめきます"));
      }
      const wind = series.mean("wind_speed_10m", ws, we);
      if (wind !== null) {
        factors.push(factor(`風速 ${f1(wind)}m/s`, (1 - Curve.ramp(wind, s.calmWind, 6)) * s.calmBonus, "風が弱いほど出やすくなります"));
      }
      return buildScore(base, factors);
    },
  };

  const rimeScorer = {
    id: "rime", source: T.rime.source,
    window(dayMs) {
      const d = Cal.startOfDay(dayMs);
      return [Cal.setHour(d, 0), Cal.setHour(d, 9)];
    },
    score(window, input) {
      const s = T.rime, series = input.home, [ws, we] = window;
      if (["plain", "coast"].includes(input.terrain)) return unavailable("terrain", "霧氷が着く山地ではありません");
      if (input.elevation < s.minElevation) {
        return unavailable("terrain", `標高 ${Math.round(input.elevation)}m。霧氷はおもに標高 500m 以上で見られます`);
      }
      const temp = series.mean("temperature_2m", ws, we);
      if (temp === null) return unavailable("missingData", "気温が得られませんでした");
      if (temp > 5) return unavailable("outOfSeason", `気温 ${f1(temp)}℃。霧氷の季節ではありません`);
      const factors = [];
      factors.push(factor(`気温 ${f1(temp)}℃`, Curve.ramp(temp, s.tempThreshold, s.tempFull) * s.tempBonus,
        temp <= s.tempThreshold ? "−5℃以下。霧氷が育つ寒さです" : "−5℃に届かず、着きにくい寒さです"));
      const humidity = series.mean("relative_humidity_2m", ws, we);
      if (humidity !== null) {
        factors.push(factor(`湿度 ${pct(humidity)}`, Curve.ramp(humidity, s.humidityFloor, s.saturation) * s.humidityBonus,
          humidity >= s.saturation ? "霧の中とみなせる湿りです" : "湿りが足りません（地上の湿度で代用しています）"));
      }
      const wind = series.mean("wind_speed_10m", ws, we);
      if (wind !== null) {
        factors.push(factor(`風速 ${f1(wind)}m/s`, Curve.band(wind, s.windLo, s.windHi, s.windTolerance) * s.windBonus,
          wind >= s.windLo && wind <= s.windHi ? "1〜5m/s。霧が運ばれて育ちます"
            : wind < s.windLo ? "弱すぎて霧が運ばれません" : "強すぎて、ごつごつした氷になります"));
      }
      let qualifying = 0;
      for (const i of series.indices(ws, we)) {
        const t = series.valueAtIndex("temperature_2m", i);
        const h = series.valueAtIndex("relative_humidity_2m", i);
        const w = series.valueAtIndex("wind_speed_10m", i);
        if (t !== null && h !== null && w !== null
            && t <= s.tempThreshold && h >= s.saturation && w >= s.windLo && w <= s.windHi) qualifying++;
      }
      if (qualifying > 0) {
        factors.push(factor(`条件成立 ${qualifying}時間`,
          Curve.ramp(qualifying, 0, s.durationFull) * s.durationBonus, "霧氷は時間をかけて育ちます"));
      }
      return buildScore(s.base, factors);
    },
  };

  const rainbowScorer = {
    id: "rainbow", source: T.rainbow.source,
    window(dayMs, input) {
      const sunrise = Sun.eventTime("sunrise", dayMs, input.lat, input.lon);
      const sunset = Sun.eventTime("sunset", dayMs, input.lat, input.lon);
      return sunrise !== null && sunset !== null && sunset > sunrise ? [sunrise, sunset] : null;
    },
    score(window, input) {
      const s = T.rainbow, series = input.home, [ws, we] = window;
      const indices = series.indices(ws, we);
      if (!indices.length) return unavailable("missingData", "日中の予報が得られませんでした");

      // 「雨の予報がない」は評価不能ではなく、虹が出ないという**評価**。
      // unavailable にするとそのモデルがアンサンブルの母数から黙って抜け、
      // 残った雨予報のモデルだけで高スコアが出る（4モデル中3が雨なしの日に
      // 1モデルの81点がそのまま表示される事故が実際に起きた）。
      let sawRain = false, sawRainHighSun = false;
      let best = null;
      for (const i of indices) {
        const hourStart = series.times[i];
        const mid = hourStart + series.stepMs / 2;
        const precip = series.valueAtIndex("precipitation", i);
        if (precip === null || precip <= s.precipThreshold) continue;
        sawRain = true;
        const sun = Sun.position(mid, input.lat, input.lon);
        if (sun.elevation <= s.minSunElev) continue;
        if (sun.elevation > s.maxSunElev) { sawRainHighSun = true; continue; }

        const factors = [];
        const elevFit = 1 - Curve.ramp(sun.elevation, s.optSunElev, s.maxSunElev);
        factors.push(factor(`太陽高度 ${Math.round(sun.elevation)}°`, elevFit * s.sunBonus,
          `42°以下。対日点は方位 ${Math.round(Geo.normalizeDegrees(sun.azimuth + 180))}° の方向`));

        // にわか雨（対流性）はセルの合間に日が差す虹の典型パターン。層状の雨と言い分ける。
        const showers = series.valueAtIndex("showers", i);
        const convective = showers !== null && showers >= precip * 0.5;
        factors.push(factor(`${convective ? "にわか雨" : "降水"} ${f1(precip)}mm`,
          Curve.ramp(precip, s.precipThreshold, 2.0) * s.precipBonus,
          convective ? "にわか雨。雲の切れ間から日が差しやすく、虹の出やすい降り方です" : "雨粒がなければ虹は出ません"));

        // 直射日光。太陽を背にした観測者に日が当たっていることが虹の必須条件。
        //
        // 見るのは2つ。
        //   相対 … 晴天時の目安（900×sin高度）に対する比。雲を抜けて日が差しているか
        //   絶対 … 実際の量。虹を光らせるだけの光があるか
        // 相対だけで見ていたため、太陽高度 1°（快晴でも 15W/m² 程度）のときに
        // 12W/m² が「比 0.76」で満点になっていた。両方を満たしたときだけ加点する。
        const direct = series.valueAtIndex("direct_radiation", i);
        let ceiling = null, ceilingReason = "";
        if (direct !== null) {
          const potential = s.clearSkyDirectMax * Math.sin(sun.elevation * DEG);
          const relative = potential > 0 ? Curve.ramp(direct / potential, s.sunlightFitLo, s.sunlightFitHi) : 0;
          const absolute = Curve.ramp(direct, s.directLo, s.directHi);
          const fit = Math.min(relative, absolute);
          factors.push(factor(`直射日光 ${Math.round(direct)}W/m²`, fit * s.sunlightBonus,
            fit > 0.5 ? "雨のあいだも日が差しそうです"
              : direct < s.noSunDirect ? "日が差していません。虹は日光が雨粒に当たって初めて見えます"
              : "日は差しているものの弱く、虹が見えても淡いものになります"));
          // 日光は虹の【必須条件】。加点として足すだけだと、
          // 基準20＋太陽高度25＋降水22 で日射がほぼ無くても「良好」に届いてしまう
          //（12W/m² で 67点になっていた）。上限として効かせる。
          ceiling = s.noSunCeiling + (100 - s.noSunCeiling) * fit;
          ceilingReason = direct < s.noSunDirect
            ? "日が差していないと虹は出ない" : "日差しが弱いと虹も淡い";
        } else {
          // 日射の予報が無いモデルでは、虹の必須条件を確かめられない。
          // 何も足さないだけだと 基準20＋太陽高度25＋降水30＝75 で「良好」に届く。
          // 確かめられないものを良い方へ丸めない。
          factors.push(factor("直射日光 —", 0, "このモデルは日射を予報していません"));
          ceiling = s.unverifiedSunCeiling;
          ceilingReason = "日が差すか確かめられない";
        }

        const candidate = buildScore(s.base, factors, ceiling, ceilingReason, [hourStart, hourStart + series.stepMs]);
        if (!best || candidate.score > best.score) best = candidate;
      }
      if (best) return best;
      // 条件不成立も点数として返す（母数に残す）。
      // 条件不成立は「加点」ではなく低い基準点そのもの。
      // 寄与を付けると記号が ◎ になり、雨が無いのに好条件のように見えてしまう。
      if (sawRainHighSun) {
        return buildScore(5, [factor("雨は太陽が高い時間帯だけ", 0,
          "太陽が高すぎると、虹は地平線の下に隠れます")]);
      }
      if (sawRain) {
        return buildScore(2, [factor("雨は夜のあいだだけ", 0, "太陽が出ていなければ虹は出ません")]);
      }
      return buildScore(2, [factor("雨の予報がない", 0, "雨粒がなければ虹は出ません")]);
    },
  };

  const SCORERS = {
    sunset: afterglowScorer("sunset"),
    sunrise: afterglowScorer("sunrise"),
    starrySky: starrySkyScorer,
    seaOfClouds: seaOfCloudsScorer,
    rainbow: rainbowScorer,
    rime: rimeScorer,
    diamondDust: diamondDustScorer,
  };
  // 現象ごとのランク名と一言。
  // 「絶景／良好／平凡／不向き」のような事務的な語だと、点数が何を意味するのかが伝わらない。
  // その現象で実際に何が見られそうかを、そのまま言葉にする。
  // 並びは [spectacular, good, fair, poor]。
  //
  // order は画面での並び順。似たものを隣に置く。
  //   朝焼け・夕焼け … 同じ判定（SunsetWx特許）で、見え方も対になる
  //   星空           … 夜
  //   虹             … 昼
  //   雲海・霧氷・ダイヤモンドダスト … 地形と寒さに依存し、行ける場所が限られる
  //
  // 「直近に起きる順」で並べ替えていた時期があるが、7日ぶんを一度に見る表では
  // どの行も同じ7日を持つので「直近」に意味がなく、開くたびに行が入れ替わって
  // 目で追えなくなる。位置が動かないほうが読みやすい。
  const PHENOMENA = {
    sunset: { name: "夕焼け", icon: "🌇", order: 1, record: "quality",
      ranks: ["圧巻", "よく染まる", "ほんのり", "期待薄"],
      says: ["空一面が燃えるように染まるかもしれません",
             "きれいに色づきそうです",
             "淡く色づく程度になりそうです",
             "色づきは弱そうです"] },
    starrySky: { name: "星空", icon: "✨", order: 2, record: "quality",
      ranks: ["満天", "よく見える", "そこそこ", "期待薄"],
      says: ["数えきれないほどの星が見えるかもしれません",
             "主な星座はよく見えそうです",
             "明るい星なら見えそうです",
             "星は見えにくそうです"] },
    sunrise: { name: "朝焼け", icon: "🌅", order: 0, record: "quality",
      ranks: ["圧巻", "よく染まる", "ほんのり", "期待薄"],
      says: ["朝の空が一面染まるかもしれません",
             "きれいに色づきそうです",
             "淡く色づく程度になりそうです",
             "色づきは弱そうです"] },
    seaOfClouds: { name: "雲海", icon: "🌫️", order: 4, record: "occurrence",
      ranks: ["大雲海", "出そう", "五分五分", "期待薄"],
      says: ["谷を埋めつくす雲海が期待できます",
             "雲海が出る条件が揃っています",
             "出るかどうかは五分五分です",
             "雲海は出にくそうです"] },
    rainbow: { name: "虹", icon: "🌈", order: 3, record: "occurrence",
      ranks: ["好条件", "出るかも", "わずかに", "期待薄"],
      says: ["日差しと雨が重なり、虹が架かるかもしれません",
             "日差しと雨が重なりそうです",
             "条件がわずかに揃っています",
             "虹は出にくそうです"] },
    rime: { name: "霧氷", icon: "❄️", order: 5, record: "occurrence",
      ranks: ["見頃", "着きそう", "わずかに", "期待薄"],
      says: ["枝が白く覆われた霧氷が期待できます",
             "枝が白くなりそうです",
             "うっすら着く程度かもしれません",
             "霧氷は着きにくそうです"] },
    diamondDust: { name: "ダイヤモンドダスト", icon: "💠", order: 6, record: "occurrence",
      ranks: ["好条件", "期待できる", "わずかに", "期待薄"],
      says: ["空気中の氷がきらめくかもしれません",
             "条件はまずまず整っています",
             "発生する可能性は低めです",
             "発生しにくい条件です"] },
  };

  // 記録で何を訊くか。点数の意味が現象で違うので、質問も変える。
  //
  //   occurrence（雲海・霧氷・ダイヤモンドダスト・虹）
  //     出るか出ないかの現象。点数は「出る見込み」に近いので「見えたか」で確かめられる。
  //     外すと未明の移動が無駄になる側でもあり、記録の価値がいちばん高い。
  //
  //   quality（朝焼け・夕焼け・星空）
  //     点数は「どれくらい染まるか／どれくらい見えるか」という質。
  //     日はほぼ毎日沈み多少は色づくので、「見えたか」を訊くと何点でも
  //     ほぼ100%になり、点数の甘辛が測れない。期待に対してどうだったかを訊く。
  const RECORD_OUTCOMES = {
    occurrence: [["seen", "見えた"], ["missed", "見えなかった"], ["unchecked", "確認せず"]],
    quality: [["better", "期待以上"], ["asExpected", "想定どおり"], ["worse", "期待外れ"],
              ["unchecked", "確認せず"]],
  };
  const recordKind = (id) => PHENOMENA[id]?.record ?? "occurrence";
  const outcomesFor = (id) => RECORD_OUTCOMES[recordKind(id)];


  /// その現象での言い方を返す。汎用の RANKS より、こちらを画面に出す。
  function phrasing(phenomenonId, rank) {
    const meta = PHENOMENA[phenomenonId];
    const i = { spectacular: 0, good: 1, fair: 2, poor: 3 }[rank.key];
    return { label: meta.ranks[i], say: meta.says[i] };
  }

  // ---------------------------------------------------------------- アンサンブル
  // 中央値を採るのは 2026-08-22 18:00 JST の実測（jma_msm 0.0mm vs icon 3.1mm）に基づく。
  // 単一モデルに賭けない。内訳は中央値に最も近い 1 モデルを基準にし、
  // 表示する中央値との差を明示的な1行として加える（内訳の合計を保つため）。
  // 51 メンバーを、8 モデルと同じ窓・同じ採点器にかけ、スコアの四分位範囲を返す。
  // メンバー側は太陽方位オフセットを取っていないので、その加点減点は効かない。
  // ばらつきの尺度としてのみ使うので支障はない（全メンバーが同条件なため）。
  function ensembleSpread(scorer, window, bundle, place, elevationFallback) {
    const ens = bundle.ensemble;
    if (!ens) return null;
    const scores = [];
    for (const member of ens.members) {
      const r = scorer.score(window, {
        home: member, offsets: {},
        lat: place.latitude, lon: place.longitude,
        terrain: place.terrain || null,
        elevation: place.elevation ?? ens.elevation ?? elevationFallback,
        lightPollution: place.lightPollution || null,
        air: bundle.air || null,
      });
      if (!r.unavailable) scores.push(r.score);
    }
    // 半数以上のメンバーが採点できないなら、ばらつきの推定として信用しない。
    if (scores.length < ens.members.length / 2) return null;
    scores.sort((a, b) => a - b);
    const q = (p) => scores[Math.round((scores.length - 1) * p)];
    // 10点刻みのヒストグラム。画面で「51通りがどこに固まっているか」を見せる。
    const histogram = Array(10).fill(0);
    for (const v of scores) histogram[Math.min(9, Math.floor(v / 10))]++;
    return {
      iqr: q(0.75) - q(0.25), p1090: q(0.9) - q(0.1),
      median: q(0.5), members: scores.length,
      p10: q(0.1), p25: q(0.25), p75: q(0.75), p90: q(0.9), histogram,
      // 画面側で「本体スコアを中心に重ねる」ために生値も渡す。
      // メンバーの絶対値は本体スコアと比べられない（太陽方位オフセットと視程を
      // 持たず、ECMWF 単独のため）。使ってよいのは散らばりの形だけ。
      scores: scores.map((v) => Math.round(v)),
    };
  }

  function evaluate(scorerId, dayMs, bundle, place) {
    const scorer = SCORERS[scorerId];
    const offsets = scorerId === "sunrise" ? bundle.sunriseOffsets : bundle.sunsetOffsets;
    const models = MODELS.filter((m) => bundle.home.byModel[m]);
    if (!models.length) return null;

    const makeInput = (model) => ({
      home: bundle.home.byModel[model],
      offsets: offsets
        ? Object.fromEntries(Object.entries(offsets).map(([k, loc]) => [k, loc.byModel[model]]).filter(([, s]) => s))
        : {},
      lat: place.latitude, lon: place.longitude,
      terrain: place.terrain || null,
      elevation: place.elevation ?? bundle.home.grid.elevation,
      lightPollution: place.lightPollution || null,
      air: bundle.air || null,
    });

    const reference = makeInput(models[0]);
    const window = scorer.window(dayMs, reference);
    if (!window) return null;

    const results = {};
    for (const m of models) results[m] = scorer.score(window, makeInput(m));
    const evaluated = Object.entries(results).filter(([, r]) => !r.unavailable);
    const peakOf = (win) => (scorer.peak ? scorer.peak(dayMs, win, reference) : win[0]);

    if (!evaluated.length) {
      const reason = Object.values(results).find((r) => r.unavailable).unavailable;
      return { phenomenon: scorerId, window, peak: peakOf(window), unavailable: reason,
               score: 0, base: 0, factors: [], perModel: {}, models: 0, spread: [0, 0],
               confidence: confidenceOf(999), uncertainty: null, source: scorer.source };
    }
    const scores = evaluated.map(([, r]) => r.score);
    const median = Curve.median(scores);
    const low = Math.min(...scores), high = Math.max(...scores);
    // 何日先か。先の日ほど、モデルが揃っていても当たらない。
    const daysAhead = Math.max(0, Math.round(
      (Cal.startOfDay(dayMs) - Cal.startOfDay(Date.now())) / 86400000));

    let representative = evaluated[0];
    for (const entry of evaluated) {
      const da = Math.abs(entry[1].score - median), db = Math.abs(representative[1].score - median);
      if (da < db || (da === db && entry[0] < representative[0])) representative = entry;
    }

    // 信頼度の出どころは2系統。アンサンブルが取れればそちらを優先する。
    // 8 モデルの「見解の割れ」は、モデルの作りの違いも混ざった量で、
    // 大気そのものの予測不確実性ではない。51 メンバーは後者を直接測ったもの。
    // 取れなかった場合は従来方式へ落ちる（機能を落として動き続ける）。
    // メンバーがこの現象の決め手を持っていなければ、揃い具合は使わない。
    // 分かることだけで判断する（モデルの割れ方へ落ちる）。
    const ensembleBlind = scorer.ensembleBlind && bundle.ensemble && bundle.ensemble.members.length
      ? scorer.ensembleBlind(bundle.ensemble.members[0], window) : null;
    const ens = ensembleBlind
      ? null : ensembleSpread(scorer, window, bundle, place, bundle.home.grid.elevation);
    const modelWidth = high - low;
    const effectiveWidth = modelWidth + leadTimePenalty(daysAhead);
    const shown = median;
    const agreement = ens ? rankAgreement(ens.scores, ens.median, shown) : null;
    // モデル側の一致率。中央値をずらさずそのまま比べる（同じ採点式・同じ地点なので）。
    const modelAgreement = scores.length
      ? scores.filter((v) => rankOf(v).key === rankOf(shown).key).length / scores.length : null;
    const expectedError = ens ? ens.p1090 * SPREAD_TO_EXPECTED_ERROR : null;
    const confidence = ens
      ? confidenceOfEnsemble(expectedError, agreement)
      : confidenceOf(effectiveWidth, modelAgreement);
    const displayWindow = representative[1].refinedWindow || window;
    const factors = [...representative[1].factors];
    const medianAdjustment = median - representative[1].score;
    if (Math.abs(medianAdjustment) > 0.005) {
      factors.push({
        label: "モデル中央値との差",
        c: medianAdjustment,
        detail: "内訳は中央値に最も近いモデルを基準にし、表示スコアをモデル中央値へ合わせています",
      });
      factors.sort((a, b) => Math.abs(b.c) - Math.abs(a.c));
    }
    // 虹は「その1時間」を特定できたときだけ時刻に意味がある。
    // 雨の予報がない日に日の出時刻を出すと、いかにもその時刻に出そうに見えてしまう。
    const specificTime = scorerId !== "rainbow" || !!representative[1].refinedWindow;
    return {
      phenomenon: scorerId,
      window: displayWindow,
      peak: peakOf(displayWindow),
      specificTime,
      unavailable: null,
      score: median,
      base: representative[1].base,
      factors,
      perModel: Object.fromEntries(evaluated.map(([m, r]) => [m, r.score])),
      // 何モデルの中央値かは日によって変わる。先の日ほどモデルが落ちるので
      // （気象庁MSMは4日、ARPEGEは5日、英国気象局は7日、ICONは8日で終わる）、
      // 同じ「中央値」でも中身が違う。表示側がそれを言えるように持ち回す。
      models: evaluated.length,
      spread: [low, high],
      daysAhead,
      confidence,
      // 信頼度の根拠を画面へ出すために持ち回す。
      // 「モデルが割れている」と「51通りが割れている」は利用者にとって意味が違う。
      uncertainty: {
        basis: ens ? "ensemble" : "models",
        ensembleBlind,                        // メンバーが決め手を見られない理由。無ければ null
        modelWidth,
        ensembleIqr: ens ? ens.iqr : null,
        ensembleMembers: ens ? ens.members : 0,
        ensembleMedian: ens ? ens.median : null,
        ensembleBand: ens ? [ens.p10, ens.p25, ens.p75, ens.p90] : null,
        ensembleHistogram: ens ? ens.histogram : null,
        ensembleScores: ens ? ens.scores : null,
        expectedError,                        // 何点ずれそうか。ens が無ければ null
        agreement,                            // 同じ評価になるメンバーの割合
        modelAgreement,                       // 同じ評価になるモデルの割合
        fallbackWidth: effectiveWidth,
      },
      source: scorer.source,
      rank: rankOf(median),
    };
  }

  function evaluateWeek(scorerId, bundle, place, days = 14, nowMs = Date.now()) {
    const out = [];
    for (let i = 0; i < days; i++) {
      const dayMs = Cal.addDays(Cal.startOfDay(nowMs), i);
      const e = evaluate(scorerId, dayMs, bundle, place);
      if (e) out.push({ dayMs, evaluation: e });
    }
    return out;
  }

  // 週間表に出す気象値（モデル横断の中央値。表示スコアと考え方を揃える）。
  function readingAt(bundle, scorerId, ms) {
    const offsets = scorerId === "sunrise" ? bundle.sunriseOffsets : bundle.sunsetOffsets;
    const med = (loc, v) => {
      if (!loc) return null;
      const values = Object.values(loc.byModel)
        .filter((s) => s.isSupported(v))
        .map((s) => s.valueAt(v, ms))
        .filter((x) => x !== null);
      return Curve.median(values);
    };
    return {
      temperature: med(bundle.home, "temperature_2m"),
      humidity: med(bundle.home, "relative_humidity_2m"),
      precipitation: med(bundle.home, "precipitation"),
      visibility: med(bundle.home, "visibility"),
      cloudLow: med(bundle.home, "cloud_cover_low"),
      cloudMid: med(bundle.home, "cloud_cover_mid"),
      cloudHigh: med(bundle.home, "cloud_cover_high"),
      sunwardLow: med(offsets?.low, "cloud_cover_low"),
      sunwardMid: med(offsets?.mid, "cloud_cover_mid"),
      sunwardHigh: med(offsets?.high, "cloud_cover_high"),
    };
  }

  // ---------------------------------------------------------------- 光害（Lorenz 光害アトラス 2025）
  // David Lorenz が VIIRS 衛星実測（NOAA/コロラド鉱山大学 EOG の年次データ）から作成し
  // GitHub Pages で公開しているアトラス。600×600 点・1/120° 解像度の 5°×5° バイナリタイル。
  // 復号方式は公開ページの実装から採った（左下隅が2バイト実値、以降は隣接差分の1バイト列）。
  // 実測検証: 東京駅 17.2 mpsas（都心）/ 阿智村 21.5（日本有数の暗さ）— 既知の明暗と一致。
  const LightPollution = {
    year: 2025,
    _cache: {},
    tileFor(lat, lon) {
      const lonFDL = ((lon + 180) % 360 + 360) % 360;
      const latFS = lat + 65;
      return { tx: Math.floor(lonFDL / 5) + 1, ty: Math.floor(latFS / 5) + 1, lonFDL, latFS };
    },
    decode(int8, ix, iy) {
      let value = 128 * int8[0] + int8[1];
      for (let i = 1; i < iy; i++) value += int8[600 * i + 1];
      for (let i = 1; i < ix; i++) value += int8[600 * (iy - 1) + 1 + i];
      const ratio = (5 / 195) * (Math.exp(0.0195 * value) - 1);   // 人工光/自然光 比
      const mpsas = 22.0 - 5.0 * Math.log(1.0 + ratio) / Math.log(100);  // 等級/平方秒
      return { ratio, mpsas };
    },
    zoneLabel(mpsas) {
      if (mpsas >= 21.7) return "ほぼ天然の暗さ";
      if (mpsas >= 21.0) return "暗い空";
      if (mpsas >= 20.0) return "郊外の空";
      if (mpsas >= 18.5) return "市街地の明るい空";
      return "都心の空";
    },
    async lookup(lat, lon) {
      const { tx, ty, lonFDL, latFS } = LightPollution.tileFor(lat, lon);
      if (ty < 1 || ty > 28) return null;
      const key = `${tx}_${ty}`;
      if (!LightPollution._cache[key]) {
        const url = `https://djlorenz.github.io/astronomy/binary_tiles/${LightPollution.year}/binary_tile_${key}.dat.gz`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const stream = res.body.pipeThrough(new DecompressionStream("gzip"));
        const buf = await new Response(stream).arrayBuffer();
        LightPollution._cache[key] = new Int8Array(buf);
      }
      const ix = Math.round(120 * (lonFDL - 5 * (tx - 1) + 1 / 240));
      const iy = Math.round(120 * (latFS - 5 * (ty - 1) + 1 / 240));
      return LightPollution.decode(LightPollution._cache[key], ix, iy);
    },
  };

  // ---------------------------------------------------------------- アメダス実況
  // 公式APIではない（気象庁サイトの内部エンドポイント）。取れなければ黙って機能を落とす。
  const Amedas = {
    base: "https://www.jma.go.jp/bosai/amedas",
    async latestTime() {
      const res = await fetch(`${Amedas.base}/data/latest_time.txt`);
      if (!res.ok) throw new Error("latest_time");
      return new Date((await res.text()).trim()).getTime();
    },
    async stations() {
      const raw = await fetchJSON(`${Amedas.base}/const/amedastable.json`);
      const out = [];
      for (const [id, e] of Object.entries(raw)) {
        if (!Array.isArray(e.lat) || !Array.isArray(e.lon) || !e.kjName) continue;
        out.push({
          id, name: e.kjName, kana: e.knName || "",
          latitude: e.lat[0] + e.lat[1] / 60, longitude: e.lon[0] + e.lon[1] / 60,
          elevation: e.alt ?? 0,
        });
      }
      return out;
    },
    blockURL(stationId, ms) {
      const d = new Date(ms + tzOffset);
      const day = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
      const block = Math.floor(d.getUTCHours() / 3) * 3;
      return `${Amedas.base}/data/point/${stationId}/${day}_${String(block).padStart(2, "0")}.json`;
    },
    qcValue(entry, key) {
      const pair = entry[key];
      if (!Array.isArray(pair) || pair.length < 2) return null;
      const [value, flag] = pair;
      // QCフラグ 0 以外は採用しない。null は欠測のまま。
      return typeof value === "number" && flag === 0 ? value : null;
    },
    async observation(station, distanceKm, ms) {
      // 観測がブロック先頭に留まる時間帯（毎時0〜十数分）は当該ブロックがまだ無い。前へ戻す。
      for (const offset of [0, -3 * 3600000]) {
        const res = await fetch(Amedas.blockURL(station.id, ms + offset));
        if (!res.ok) continue;
        const raw = await res.json();
        const keys = Object.keys(raw).sort();
        if (!keys.length) continue;
        const latest = keys[keys.length - 1];
        const e = raw[latest];
        const y = +latest.slice(0, 4), mo = +latest.slice(4, 6), da = +latest.slice(6, 8);
        const hh = +latest.slice(8, 10), mi = +latest.slice(10, 12);
        const observedAt = Date.UTC(y, mo - 1, da, hh, mi) - tzOffset;
        return {
          station, distanceKm, observedAt,
          temperature: Amedas.qcValue(e, "temp"),
          humidity: Amedas.qcValue(e, "humidity"),
          precipitation10m: Amedas.qcValue(e, "precipitation10m"),
          precipitation1h: Amedas.qcValue(e, "precipitation1h"),
          sunshine1h: Amedas.qcValue(e, "sun1h"),
          wind: Amedas.qcValue(e, "wind"),
          supplementedFrom: {},
        };
      }
      return null;
    },
    // 要素ごとに、その要素を観測している最寄り点を採る。
    // 観測要素は地点により揃っておらず、単一地点固定だと「最寄りが雨量計だけ」が実際に起きる
    // （大江山の最寄り・坂浦 4km がそうだった）。補完元は距離と標高差を添えて明示する。
    maxSupplementKm: 50,
    merge(primary, candidates, targetElevation) {
      const merged = { ...primary, supplementedFrom: {}, fieldStation: {},
                       targetElevation: typeof targetElevation === "number" ? targetElevation : null };
      const fields = [
        ["temperature", "気温"], ["humidity", "湿度"], ["precipitation1h", "降水"],
        ["sunshine1h", "日照"], ["wind", "風"],
      ];
      // 補完した値だけでなく、最寄り地点が出した値も出所を残す。
      // 出所を残していなかったため、山上の予報を谷底の観測と比べていることに気づけなかった。
      for (const [key] of fields) if (primary[key] !== null) merged.fieldStation[key] = primary.station;
      for (const c of candidates) {
        if (c.station.id === primary.station.id) continue;
        if (c.distanceKm > Amedas.maxSupplementKm) continue;
        let label = `${c.station.name} ${Math.round(c.distanceKm)}km`;
        if (targetElevation !== null && targetElevation !== undefined) {
          const diff = c.station.elevation - targetElevation;
          if (Math.abs(diff) >= 200) label += `・標高差${diff > 0 ? "+" : ""}${Math.round(diff)}m`;
        }
        for (const [key, jp] of fields) {
          if (merged[key] === null && c[key] !== null) {
            merged[key] = c[key];
            merged.supplementedFrom[jp] = label;
            merged.fieldStation[key] = c.station;
          }
        }
        if (merged.precipitation10m === null && c.precipitation10m !== null) merged.precipitation10m = c.precipitation10m;
      }
      return merged;
    },
    // 標準大気の気温減率。標高差のある観測点の値をその地点の高さへ直すのに使う。
    lapseRateCPerKm: 6.5,
    // アメダスは平地に多い。山の上の地点では最寄りでも1000m以上低いことがあり、
    // 谷底の気温をその地点の実況として出すと10℃近く違う。
    // 「ここは何℃低い見込み」と注記するだけでは、見出しに違う数字が残る。
    // 標準大気の減率でその地点の高さへ直した値を出す。観測ではなく推定なので「約」を付ける。
    estimatedTemperature(obs) {
      const st = obs.fieldStation?.temperature;
      if (!st || typeof st.elevation !== "number") return null;
      if (obs.temperature === null) return null;
      if (obs.targetElevation === null || obs.targetElevation === undefined) return null;
      const dz = obs.targetElevation - st.elevation;         // ここ - 観測点
      if (Math.abs(dz) < 300) return null;
      return { value: obs.temperature - Amedas.lapseRateCPerKm * dz / 1000,
               raw: obs.temperature, dz, station: st };
    },
    // 何をどう直した値なのかを書く。天気と湿度は直しようがないので、
    // ふもとのままであることも併せて言う。
    elevationNote(obs) {
      const est = Amedas.estimatedTemperature(obs);
      if (!est) return null;
      return `気温は ${est.station.name}（標高${Math.round(est.station.elevation)}m）の ${f1(est.raw)}℃ から、`
        + `${Math.round(Math.abs(est.dz))}m ${est.dz > 0 ? "高い" : "低い"}ぶんを補正した推定です。`
        + `天気・湿度はふもとの値です。`;
    },
    supplementSummary(obs) {
      const order = ["気温", "湿度", "降水", "日照", "風"];
      const groups = {};
      for (const [k, v] of Object.entries(obs.supplementedFrom)) (groups[v] = groups[v] || []).push(k);
      return Object.entries(groups)
        .map(([source, keys]) => `${keys.sort((a, b) => order.indexOf(a) - order.indexOf(b)).join("・")} は ${source}`)
        .sort();
    },
    condition(obs, isDaytime) {
      const rain = obs.precipitation10m ?? obs.precipitation1h;
      if (rain !== null && rain > 0) {
        if (obs.temperature !== null && obs.temperature <= 1.0) return "雪";
        const r = obs.precipitation1h ?? rain;
        if (r < 1) return "弱い雨"; if (r < 10) return "雨"; if (r < 20) return "やや強い雨";
        if (r < 30) return "強い雨"; if (r < 50) return "激しい雨"; if (r < 80) return "非常に激しい雨";
        return "猛烈な雨";
      }
      if (!isDaytime) return "降水なし";
      if (obs.sunshine1h === null) return "降水なし";
      return obs.sunshine1h > 0 ? "晴れ" : "くもり";
    },
    async nearest(lat, lon, stations, observedAt, targetElevation, maxProbes = 6) {
      const ordered = stations
        .map((s) => ({ s, d: Geo.distanceKm(lat, lon, s.latitude, s.longitude) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, maxProbes);
      const collected = [];
      const hasCore = () => collected.some((o) => o.temperature !== null)
        && collected.some((o) => o.precipitation1h !== null)
        && collected.some((o) => o.humidity !== null);
      for (const { s, d } of ordered) {
        try {
          const obs = await Amedas.observation(s, d, observedAt);
          if (obs) collected.push(obs);
        } catch (e) { /* 個別地点の失敗は飛ばす */ }
        if (hasCore()) break;
      }
      const primary = collected.find((o) => o.temperature !== null || o.precipitation1h !== null) || collected[0];
      if (!primary) throw new Error("近傍に観測値のある地点がありませんでした");
      return Amedas.merge(primary, collected, targetElevation);
    },
  };

  const Sorami = {
    Geo, Cal, JstCal: Cal, Sun, Moon, Curve, T, Series, MODELS, MODEL_NAMES,
    HOME_VARS, OFFSET_VARS, PROFILE_LEVELS, PROFILE_VARS, needsProfile,
    CLOUD_LAYERS, SCORERS, PHENOMENA, RANKS, RECORD_OUTCOMES, recordKind, outcomesFor,
    decodeLocation, buildURL, fetchForecast, evaluate, evaluateWeek, readingAt,
    setTimezoneOffset, rankOf, confidenceOf, confidenceOfEnsemble, reliabilityGrade, phrasing, leadTimePenalty,
    ensembleSpread, fetchEnsemble, profileLevelCount, ENSEMBLE_VARS, ENSEMBLE_MEMBERS, ENSEMBLE_MODEL,
    SPREAD_TO_EXPECTED_ERROR, rankAgreement,
    Amedas, LightPollution,
  };
  global.Sorami = Sorami;
  if (typeof module !== "undefined" && module.exports) module.exports = Sorami;
})(typeof globalThis !== "undefined" ? globalThis : window);
