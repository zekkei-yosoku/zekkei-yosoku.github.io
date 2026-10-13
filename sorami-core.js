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
    // HH:MM。時も0を付けて桁を揃える（05:51。2026-10-13 ユーザー指定、月日と同じ理由）。
    // 画面ごとに付けると必ずどこかで抜けるので、ここだけで付ける。
    hhmm(ms) {
      const d = new Date(ms + tzOffset);
      return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
    },
    // 表示は分に四捨五入。切り捨てると暦の表記と1分ずれる。
    hhmmRounded(ms) { return Cal.hhmm(Math.round(ms / 60000) * 60000); },
    // mm/dd。1桁の月日も0を付けて桁を揃える（ユーザーの指定）。
    // 桁が揃うと、14日ぶんを縦横に並べたとき数字の位置がぶれない。
    monthDay(ms) {
      const d = new Date(ms + tzOffset);
      return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
    },
    month(ms) { return new Date(ms + tzOffset).getUTCMonth() + 1; },
    weekday(ms) { return "日月火水木金土"[new Date(ms + tzOffset).getUTCDay()]; },
    // 日付で言い切る。「今日」「明日」は使わない。
    //
    // 週間の帯は 09/07 と日付で出しているのに、その下の詳細だけ「今日」と
    // 出ていた。09/07 を押して「今日」が出ると、読む側が毎回translateすることになる。
    // 近い2日だけ言い方が変わるので、揃っていないのがいちばん目立つ場所でもある。
    // 今日がどれかは、帯の枠と曜日で分かる。
    // 正本: [[システム/04_ユーザー設定#日付の表記]]
    relativeDay(ms) { return `${Cal.monthDay(ms)}(${Cal.weekday(ms)})`; },
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

  // ---------------------------------------------------------------- 閾値（出典付き。ここが正本）
  const T = {
    seaOfClouds: { minElevation: 250 },
    rime: { minElevation: 500 },
  };
  const f1 = (v) => v.toFixed(1);

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
    // Open-Meteo hourly: 降水は直前1時間の合計、日射は直前1時間の平均。
    // https://open-meteo.com/en/docs — Hourly Parameter Definition
    // 雲量等の瞬時値は従来の前方バケットを維持する（補間は別変更）。
    intervalAt(v, i) {
      const t = this.times[i];
      return ["precipitation", "showers", "direct_radiation"].includes(v)
        ? [t - 3600000, t] : [t, t + this.stepMs];
    }
    indices(startMs, endMs, v = null) {
      if (endMs <= startMs) return [];
      const out = [];
      this.times.forEach((t, i) => {
        const [start, end] = this.intervalAt(v, i);
        if (start < endMs && end > startMs) out.push(i);
      });
      return out;
    }
    // 一部欠測の窓が減点を免れて「最良」になるのを防ぐ。
    covers(v, startMs, endMs) {
      let coveredTo = startMs;
      for (const i of this.indices(startMs, endMs, v)) {
        const [start, end] = this.intervalAt(v, i);
        if (!Number.isFinite(this.valueAtIndex(v, i))) continue;
        if (start > coveredTo) return false;
        coveredTo = Math.max(coveredTo, end);
      }
      return endMs > startMs && coveredTo >= endMs;
    }
    values(v, s, e) { return this.indices(s, e, v).map((i) => this.valueAtIndex(v, i)).filter((x) => x !== null); }
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
    // 風向は**羽田の運用の向き（北風・南風）**を決めるのに使う（月丼）。
    // 採点には使わないが、1項目ぶんなので同じ取得に載せる
    "wind_speed_10m", "wind_direction_10m", "surface_pressure", "direct_radiation", "showers",
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

  // ---------------------------------------------------------------- Open-Meteo の応答を使い回す
  // Open-Meteo の無料枠は回線ごとに 600回/分。1回開くだけで換算 約155回ぶん使う
  // （8モデル×15日×地点数で重く数えられる）のに、起動・地点の切り替え・配信後の
  // 読み直しのたびに全部を取り直していて、1分に3〜4回開き直すと
  // "Minutely API request limit exceeded" で「予測に失敗しました」になっていた（2026-09-22）。
  //
  // **URL ごとに応答を30分とっておく。** モデルの更新は数時間おきなので、30分では古くならない。
  // localStorage は約5MBで、アンサンブルだけで1MB前後あるため使わない（Cache Storage を使う）。
  // Cache Storage の無い環境（node・古いブラウザ）では、これまでどおり毎回取りに行く。
  const OM_CACHE = "sorami-open-meteo-v1";
  const OM_CACHE_TTL_MS = 30 * 60 * 1000;
  const OM_AT = "x-sorami-fetched-at";
  const isOpenMeteo = (url) => /^https:\/\/([a-z-]+\.)?open-meteo\.com\//.test(String(url));
  const cacheStore = () => (typeof caches !== "undefined" && caches && typeof caches.open === "function"
    ? caches : null);

  /// fetch と同じ形で返す。Open-Meteo の成功した応答だけを保存・再利用する。
  /// 返す Response には取得時刻（ミリ秒）を `x-sorami-fetched-at` に付ける。
  /**
   * 429（呼びすぎ）のときだけ、少し待って取り直す。
   *
   * Open-Meteo の無料枠は回線ごとに 600/分・5,000/時・10,000/日で、
   * 1回開くと換算155回ぶん使う（2026-09-22 実測）。家族が同時に開くと分あたりの枠に
   * 当たり、その回の表示が丸ごと「取得エラー」になっていた。
   * **枠は時間で回復する**ので、待てば通る。待たずに諦める理由がない。
   *
   * 待ちは 0.8秒 → 2秒 の2回だけ。それ以上ねばると、画面が固まったように見える。
   * 429以外の失敗（通信断・500）は**取り直さない**（待っても変わらない）。
   */
  const RETRY_WAIT_MS = [800, 2000];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function fetchWithRetry(url, init = {}) {
    let res = await fetch(url, init);
    for (let i = 0; res.status === 429 && i < RETRY_WAIT_MS.length; i++) {
      await sleep(RETRY_WAIT_MS[i]);
      res = await fetch(url, init);
    }
    return res;
  }

  async function cachedFetch(url, init = {}) {
    const store = isOpenMeteo(url) && !(init.method && init.method !== "GET") ? cacheStore() : null;
    if (!store) return isOpenMeteo(url) ? fetchWithRetry(url, init) : fetch(url, init);
    let cache = null;
    try {
      cache = await store.open(OM_CACHE);
      const hit = await cache.match(url);
      const at = hit ? Number(hit.headers.get(OM_AT)) : NaN;
      if (hit && Date.now() - at < OM_CACHE_TTL_MS && Date.now() >= at) return hit;
    } catch { cache = null; }       // 保存領域が使えなくても、取得は止めない
    const res = await fetchWithRetry(url, init);
    if (!res.ok || !cache) return res;
    const text = await res.text();
    const at = String(Date.now());
    const headers = { "content-type": "application/json", [OM_AT]: at };
    try {
      await cache.put(url, new Response(text, { status: 200, headers }));
      pruneOpenMeteoCache(cache);
    } catch { /* 容量超過など。使い回せないだけで、今回の結果は返す */ }
    return new Response(text, { status: 200, headers });
  }

  /// 期限切れを消す。放っておくと地点を変えるたびに増え続ける。
  let pruning = false;
  async function pruneOpenMeteoCache(cache) {
    if (pruning) return;
    pruning = true;
    try {
      for (const req of await cache.keys()) {
        const r = await cache.match(req);
        const at = r ? Number(r.headers.get(OM_AT)) : NaN;
        if (!(Date.now() - at < OM_CACHE_TTL_MS)) await cache.delete(req);
      }
    } catch { /* 掃除は補助 */ } finally { pruning = false; }
  }

  /// 応答の取得時刻。使い回した応答なら、最初に取った時刻になる。
  const fetchedAtOf = new WeakMap();

  async function fetchJSON(url) {
    const res = await cachedFetch(url);
    const body = await res.json();
    if (!res.ok || body.error) throw new Error(body.reason || `HTTP ${res.status}`);
    const at = Number(res.headers?.get?.(OM_AT));
    if (body && typeof body === "object" && Number.isFinite(at)) fetchedAtOf.set(body, at);
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
      // 使い回した応答があれば、その取得時刻（いちばん古いもの）。「◯時点の予測」に出す
      fetchedAt: Math.min(now, ...[homeRaw, sunsetRaw, sunriseRaw]
        .map((r) => fetchedAtOf.get(r)).filter(Number.isFinite)),
    };
  }

  const RANKS = [
    { key: "spectacular", label: "絶景", min: 85 },
    { key: "good", label: "良好", min: 65 },
    { key: "fair", label: "平凡", min: 40 },
    { key: "poor", label: "不向き", min: -1 },
  ];
  const rankOf = (score) => RANKS.find((r) => score >= r.min);
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

  const SCORERS = Object.fromEntries(['sunset','sunrise','starrySky','seaOfClouds','cityCloudSea','rainbow','rime','diamondDust'].map(id=>[id,{id}]));

  const PHENOMENA = {
    sunset: { name: "夕焼け", icon: "🌇", order: 1, record: "quality", timeOfDay: "夕方",
      ranks: ["圧巻", "よく染まる", "ほんのり", "期待薄"],
      says: ["空一面が燃えるように染まるかもしれません",
             "きれいに色づきそうです",
             "淡く色づく程度になりそうです",
             "色づきは弱そうです"] },
    starrySky: { name: "星空", icon: "✨", order: 2, record: "quality", timeOfDay: "夜",
      ranks: ["満天", "よく見える", "そこそこ", "期待薄"],
      says: ["数えきれないほどの星が見えるかもしれません",
             "主な星座はよく見えそうです",
             "明るい星なら見えそうです",
             "星は見えにくそうです"] },
    sunrise: { name: "朝焼け", icon: "🌅", order: 0, record: "quality", timeOfDay: "明け方",
      ranks: ["圧巻", "よく染まる", "ほんのり", "期待薄"],
      says: ["朝の空が一面染まるかもしれません",
             "きれいに色づきそうです",
             "淡く色づく程度になりそうです",
             "色づきは弱そうです"] },
    // 富士山と月は sorami-fuji.js / sorami-moon.js が採点する（core は採点しない）。
    // **表に並べるための名前と語彙はここに置く。** 器を分けると、行の見た目が揃わない。
    //
    // `highlight: false` は「次の見どころ」に出さない印。
    // 他の現象は起きるか起きないかで、起きれば出かける理由になる。
    // 月と富士山は**晴れていればだいたい見える**ので、条件の良い日は必ず上位へ来て
    // 見どころの枠を占め続ける。雲海や虹のような「その日だけ」を押し出してしまう。
    // 表の行としては同じ重みで並べたままにする（消すわけではない）。
    fuji: { name: "富士山", icon: "🗻", order: 5, record: "occurrence", highlight: false,
      ranks: ["くっきり", "よく見える", "うっすら", "望み薄"],
      says: ["輪郭まではっきり見えそうです",
             "しっかり見えそうです",
             "霞んで見える程度かもしれません",
             "雲か霞で隠れていそうです"] },
    moon: { name: "月", icon: "🌙", order: 3, record: "quality", highlight: false, timeOfDay: "夜",
      ranks: ["よく見える", "見えそう", "薄ぼんやり", "期待薄"],
      says: ["澄んだ空にくっきり浮かびそうです",
             "普通に見えそうです",
             "雲や霞ごしになりそうです",
             "見えにくそうです"] },
    // 笠雲も「次の見どころ」には出さない（`highlight: false`、2026-09-17 ユーザー判断）。
    // 月・富士山とは理由が違う。笠雲は材料が揃った日にだけ出る現象だが、**高い点でも実際に
    // 見えるのは 85点以上で約8%・65点以上で約6%**（日単位、2026-09-17）。見どころの先頭に
    // 出すと「行けば見られる」と誘う形になり、十数回に1回しか当たらない。表の行には残す。
    // 採点は sorami-capcloud.js。**実地精度は未検証**（2026-09-15 ユーザー判断で導入）。
    // **「笠雲」だけでは何の笠雲か分からない。** だが一覧の列は 84px（アイコンを引いて
    // 実質48px）しかなく、「富士山の笠雲」は75pxで省略されて **「富士山の…」** になる。
    // すぐ上の「富士山」と見分けがつかず、かえって悪い（2026-09-15に実測）。
    // **場所で使い分ける。** `name` は一覧の列（短い）、`longName` は詳細の見出しと
    // 見どころ（幅がある）。`longName` が無い現象は `name` をそのまま使う。
    // 絵文字は **富士山と同じ 🗻**。デザイン定義の「絵文字は現象の識別にだけ使う」の例外で、
    // ここでは**同じ絵文字であること自体が「同じ山の話」を伝える**。
    // 名前（富士山 / 笠雲）が隣にあるので行は見分けられる。
    capCloud: { name: "笠雲", longName: "富士山の笠雲", icon: "🗻", order: 5.5, record: "occurrence", highlight: false,
      // ランク名も「かかる」と約束しない（2026-09-17 ユーザー選択。旧「みごとな笠／かかりそう」）。
      // 「好条件」は虹・ダイヤモンドダストと同じ語で、条件が良いことまでしか言わない。
      ranks: ["好条件", "出やすい", "わずかに", "望み薄"],
      // **「かかる」と言わない。** 笠雲が見える日は50日に1日ほどで、85点以上でも実際に
      // 見えるのは約8%、65点以上で約6%（日単位、2026-09-17）。言えるのは「出やすさ」まで
      says: ["笠雲がとても出やすい条件です（ふだんの4倍ほど）",
             "笠雲が出やすい条件です（ふだんの3倍ほど）",
             "少し出やすい条件です",
             "笠雲は出にくそうです"] },
    seaOfClouds: { name: "雲海", icon: "🌫️", order: 4, record: "occurrence", timeOfDay: "明け方",
      ranks: ["大雲海", "出そう", "五分五分", "期待薄"],
      says: ["谷を埋めつくす雲海が期待できます",
             "雲海が出る条件が揃っています",
             "出るかどうかは五分五分です",
             "雲海は出にくそうです"] },
    // 盆地の雲海のすぐ下。**同じ「雲海」でも見る場所も成因も違う**ので行を分ける
    cityCloudSea: { name: "街の雲海", icon: "🌁", order: 4.5, record: "occurrence", timeOfDay: "明け方",
      ranks: ["街が沈む", "出そう", "五分五分", "期待薄"],
      says: ["街がすっぽり霧に沈み、ビルの頭だけが出るかもしれません",
             "低い霧が広がりそうです",
             "出るかどうかは五分五分です",
             "低い霧は出にくそうです"] },
    rainbow: { name: "虹", icon: "🌈", order: 3, record: "occurrence", timeOfDay: "日中",
      ranks: ["好条件", "出るかも", "わずかに", "期待薄"],
      says: ["日差しと雨が重なり、虹が架かるかもしれません",
             "日差しと雨が重なりそうです",
             "条件がわずかに揃っています",
             "虹は出にくそうです"] },
    // 寒さの2つ（霧氷・ダイヤモンドダスト）は**隣どうしで、いちばん下**。
    // 季節が限られていて、ほとんどの日は対象外か0点になるため（2026-09-27 ユーザー指定）。
    rime: { name: "霧氷", icon: "❄️", order: 7, record: "occurrence", timeOfDay: "早朝",
      ranks: ["見頃", "着きそう", "わずかに", "期待薄"],
      says: ["枝が白く覆われた霧氷が期待できます",
             "枝が白くなりそうです",
             "うっすら着く程度かもしれません",
             "霧氷は着きにくそうです"] },
    diamondDust: { name: "ダイヤモンドダスト", icon: "💠", order: 8, record: "occurrence", timeOfDay: "早朝",
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
    quality: [["better", "期待以上"], ["asExpected", "予測通り"], ["worse", "期待外れ"],
              ["unchecked", "確認せず"]],
  };
  /// 幅のある場所で出す名前。無ければ短いほうを使う
  const longNameOf = (id) => PHENOMENA[id]?.longName ?? PHENOMENA[id]?.name ?? id;
  const recordKind = (id) => PHENOMENA[id]?.record ?? "occurrence";
  const outcomesFor = (id) => RECORD_OUTCOMES[recordKind(id)];

  // 実際は何点だったか（2026-10-02 ユーザー「選択式じゃなくて何点だったかをゲージで選ばせたら」
  // 「予測通りってボタンと、違うならゲージ」）。答えは actualScore（0〜100、予測と同じ物差し）で持ち、
  // 帯グラフの答え（RECORD_OUTCOMES のキー）はそこから出す。前の記録（答えだけのもの）もそのまま描ける。
  //   quality … 予測との差が ±10 以内なら予測通り、上なら期待以上、下なら期待外れ
  //   occurrence … 40 以上なら見えた。40 は RANKS の「平凡」の境で、この現象の言い方では「わずかに」
  //     （雲海なら出る見込みが少しある）。予測通りを押した 30 点（期待薄）が「見えた」にならないように
  const ACTUAL_WORDS = {
    quality: [[85, "絶景"], [65, "よかった"], [40, "まずまず"], [0, "いまひとつ"]],
    occurrence: [[85, "絶景"], [65, "よく見えた"], [40, "わずかに見えた"], [0, "見えなかった"]],
  };
  const actualWord = (id, v) => (ACTUAL_WORDS[recordKind(id)].find(([min]) => v >= min) || [0, ""])[1];
  function outcomeFromActual(id, predicted, actual) {
    if (!Number.isFinite(actual)) return "unchecked";
    if (recordKind(id) === "occurrence") return actual >= 40 ? "seen" : "missed";
    const d = actual - predicted;
    return d > 10 ? "better" : d < -10 ? "worse" : "asExpected";
  }
  // `longNameOf` は下の公開オブジェクトから出す


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
    CLOUD_LAYERS, SCORERS, PHENOMENA, RANKS, RECORD_OUTCOMES, recordKind, outcomesFor, longNameOf, actualWord, outcomeFromActual,
    decodeLocation, buildURL, fetchForecast, cachedFetch, fetchWithRetry, RETRY_WAIT_MS, OM_CACHE_TTL_MS, readingAt,
    setTimezoneOffset, rankOf, reliabilityGrade, phrasing,
    fetchEnsemble, ENSEMBLE_VARS, ENSEMBLE_MEMBERS, ENSEMBLE_MODEL,
    Amedas, LightPollution,
  };
  global.Sorami = Sorami;
  if (typeof module !== "undefined" && module.exports) module.exports = Sorami;
})(typeof globalThis !== "undefined" ? globalThis : window);
